/**
 * Foretell keyword actions: foretelling a card and casting the foretold card (CR 702.146).
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, CardInstanceId, PlayerId, Target } from '../types';
import { Phase } from '../types';
import { moveCardBetweenZones, isForetoldCard } from '../zones';
import { spendMana } from '../mana';
import { parseForetell } from '../oracle-text-parser';
import { castSpell } from '../spell-casting';
import { isPriorityPlayer } from '../priority-guard';
import { KeywordActionResult } from './shared';

const FORETELL_EXILE_COST = 2;

/**
 * CR 702.142b — the Foretell keyword action (a special action).
 *
 * Validates and performs foretelling a card from `playerId`'s hand: pay {2},
 * exile the card face down, flag it foretold, record the foretell turn, and
 * consume the once-per-turn allowance. Returns a failing `KeywordActionResult`
 * for any illegal invocation (wrong zone, no Foretell ability, not your turn,
 * non-main phase, non-empty stack, no priority, already foretold this turn, or
 * insufficient mana).
 */
export function foretellCard(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): KeywordActionResult {
  const card = state.cards.get(cardId);
  if (!card) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} not found`,
    };
  }

  // CR 702.142a/b: Foretell functions from a player's hand. The card must be in
  // this player's hand.
  const handZone = state.zones.get(`${playerId}-hand`);
  if (!handZone || !handZone.cardIds.includes(cardId)) {
    return {
      success: false,
      state,
      description: "",
      error: "Card is not in your hand.",
    };
  }

  // The card must actually have the Foretell ability and a parseable cost.
  const foretellInfo = parseForetell(card.cardData.oracle_text || "");
  if (!foretellInfo.hasForetell || !foretellInfo.foretellCost) {
    return {
      success: false,
      state,
      description: "",
      error: `${card.cardData.name} does not have Foretell.`,
    };
  }

  const player = state.players.get(playerId);
  if (!player) {
    return {
      success: false,
      state,
      description: "",
      error: `Player ${playerId} not found`,
    };
  }

  // CR 702.142b: only on your turn.
  if (state.turn.activePlayerId !== playerId) {
    return {
      success: false,
      state,
      description: "",
      error: "You can foretell only on your turn.",
    };
  }

  // Sorcery timing: a main phase (CR 702.142b / 117).
  if (
    state.turn.currentPhase !== Phase.PRECOMBAT_MAIN &&
    state.turn.currentPhase !== Phase.POSTCOMBAT_MAIN
  ) {
    return {
      success: false,
      state,
      description: "",
      error: "Foretell can be used only during a main phase.",
    };
  }

  // The stack must be empty (sorcery speed).
  if (state.stack.length > 0) {
    return {
      success: false,
      state,
      description: "",
      error: "Foretell can be used only when the stack is empty.",
    };
  }

  // The player must have priority.
  if (!isPriorityPlayer(state, playerId)) {
    return {
      success: false,
      state,
      description: "",
      error: "You do not have priority.",
    };
  }

  // CR 702.142b: at most one card foretold each turn.
  if ((player.foretoldThisTurn ?? 0) >= 1) {
    return {
      success: false,
      state,
      description: "",
      error: "You have already foretold a card this turn.",
    };
  }

  // CR 702.142b: pay {2} (generic) to exile the card face down.
  const spendResult = spendMana(state, playerId, {
    generic: FORETELL_EXILE_COST,
  });
  if (!spendResult.success) {
    return {
      success: false,
      state,
      description: "",
      error: "Not enough mana to foretell (costs {2}).",
    };
  }

  let currentState = spendResult.state;

  // Exile the card face down as foretold: hand -> owner's exile.
  const exileZoneKey = `${playerId}-exile`;
  const exileZone = currentState.zones.get(exileZoneKey);
  if (!exileZone) {
    return {
      success: false,
      state,
      description: "",
      error: "Exile zone not found.",
    };
  }

  const moved = moveCardBetweenZones(handZone, exileZone, cardId);

  const updatedZones = new Map(currentState.zones);
  updatedZones.set(`${playerId}-hand`, moved.from);
  updatedZones.set(exileZoneKey, moved.to);

  // Flag the card foretold + face down and record the foretell turn so the
  // later-turn cast restriction (CR 702.142c) can be enforced.
  const updatedCards = new Map(currentState.cards);
  updatedCards.set(cardId, {
    ...card,
    isFaceDown: true,
    foretold: true,
    foretoldTurn: currentState.turn.turnNumber,
    currentZoneKey: exileZoneKey,
  });

  // Consume the once-per-turn foretell allowance.
  const updatedPlayers = new Map(currentState.players);
  const spendingPlayer = currentState.players.get(playerId)!;
  updatedPlayers.set(playerId, {
    ...spendingPlayer,
    foretoldThisTurn: (spendingPlayer.foretoldThisTurn ?? 0) + 1,
  });

  currentState = {
    ...currentState,
    zones: updatedZones,
    cards: updatedCards,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };

  return {
    success: true,
    state: currentState,
    description: `${player.name} foretells a card (pays {2}).`,
    affectedCards: [cardId],
  };
}

/**
 * CR 702.142c — Cast a foretold card from exile for its printed foretell cost.
 *
 * Validates that the card is foretold, in this player's exile, owned by them,
 * has a foretell cost, and is being cast on a later turn (not the turn it was
 * foretold), then delegates to the spell-casting machinery via the `foretell`
 * alternative cost. The reveal (face up, foretold cleared) is applied as the
 * card is announced on the stack inside `castSpell`.
 */
export function castForetoldCard(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  targets: Target[] = [],
  chosenModes: string[] = [],
  xValue: number = 0,
): { success: boolean; state: GameState; error?: string } {
  const card = state.cards.get(cardId);
  if (!card) {
    return { success: false, state, error: `Card ${cardId} not found` };
  }

  // Must currently be foretold (face down in exile, flagged).
  if (!isForetoldCard(card)) {
    return {
      success: false,
      state,
      error: "That card is not foretold.",
    };
  }

  // CR 702.142c: cast from exile. The card must be in this player's exile.
  const exileZoneKey = `${playerId}-exile`;
  const exileZone = state.zones.get(exileZoneKey);
  if (!exileZone || !exileZone.cardIds.includes(cardId)) {
    return {
      success: false,
      state,
      error: "Foretold card is not in your exile.",
    };
  }

  // Only the owner who foretold it may cast it.
  if (card.ownerId !== playerId) {
    return {
      success: false,
      state,
      error: "You can cast only your own foretold cards.",
    };
  }

  // CR 702.142c: not the turn it was foretold — only a strictly later turn.
  if (
    card.foretoldTurn !== undefined &&
    state.turn.turnNumber <= card.foretoldTurn
  ) {
    return {
      success: false,
      state,
      error: "A foretold card can be cast only on a later turn.",
    };
  }

  // Must have a foretell cost to pay.
  const foretellInfo = parseForetell(card.cardData.oracle_text || "");
  if (!foretellInfo.hasForetell || !foretellInfo.foretellCost) {
    return {
      success: false,
      state,
      error: "That card has no foretell cost.",
    };
  }

  // Delegate to the casting machinery using the foretell alternative cost.
  // castSpell handles the exile source zone, the foretell-cost replacement, and
  // the on-cast reveal (CR 702.142c).
  return castSpell(
    state,
    playerId,
    cardId,
    targets,
    chosenModes,
    xValue,
    false,
    {
      type: "foretell",
    },
  );
}

