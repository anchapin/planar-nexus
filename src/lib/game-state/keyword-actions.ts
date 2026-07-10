/**
 * Keyword Actions System
 *
 * Implements standard MTG keyword actions as described in the Comprehensive Rules.
 * Reference: CR 701 - Keyword Actions
 *
 * Keyword actions include:
 * - Destroy (with regeneration/indestructible handling)
 * - Exile (with face-up/face-down options)
 * - Sacrifice
 * - Draw (with replacement effects)
 * - Discard
 * - Create token
 * - Counter (spell or ability)
 * - Regenerate
 */

import type {
  GameState,
  CardInstance,
  CardInstanceId,
  Counter,
  PlayerId,
  Target,
  Zone,
  ScryfallCard,
} from "./types";
import { ZoneType, Phase } from "./types";
import {
  createToken,
  getToughness,
  addCounters,
  removeCounters,
  hasCounter,
  initializePlaneswalkerLoyalty,
} from "./card-instance";
import { moveCardBetweenZones, isForetoldCard, shuffleZone } from "./zones";
import { spendMana } from "./mana";
import {
  parseForetell,
  parseCycling,
  CyclingVariant,
  type CyclingInfo,
} from "./oracle-text-parser";
import { castSpell } from "./spell-casting";
import {
  hasPersist,
  canPersistTrigger,
  shouldPreventDamageToTarget,
  hasDeathtouch,
} from "./evergreen-keywords";

/**
 * Result of a keyword action
 */
export interface KeywordActionResult {
  /** Whether the action was successful */
  success: boolean;
  /** Updated game state */
  state: GameState;
  /** Description of what happened */
  description: string;
  /** Cards that were affected */
  affectedCards?: CardInstanceId[];
  /** Error message if failed */
  error?: string;
}

/**
 * Check if a card has indestructible
 */
export function hasIndestructible(card: CardInstance): boolean {
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
  const keywords = card.cardData.keywords || [];

  return (
    keywords.includes("Indestructible") || oracleText.includes("indestructible")
  );
}

/**
 * Check if a card can be regenerated (has regenerate ability)
 */
export function canBeRegenerated(card: CardInstance): boolean {
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
  return oracleText.includes("regenerate");
}

/**
 * Destroy a permanent
 * Handles indestructible and regeneration
 */
export function destroyCard(
  state: GameState,
  cardId: CardInstanceId,
  ignoreIndestructible: boolean = false,
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

  // Check for indestructible
  if (!ignoreIndestructible && hasIndestructible(card)) {
    return {
      success: false,
      state,
      description: `${card.cardData.name} is indestructible and cannot be destroyed`,
    };
  }

  // Check for replacement effects (e.g., "If a creature would be destroyed, exile it instead")
  const replacementEvent = {
    type: "destroy" as const,
    amount: 0,
    timestamp: Date.now(),
    targetId: cardId,
  };

  const rem = state.replacementEffectManager;
  const apnapOrder = rem.createAPNAPOrder(
    state.turn.activePlayerId,
    Array.from(state.players.keys()),
  );
  const processedEvent = rem.processEvent(replacementEvent, apnapOrder);

  if (processedEvent.type === "exile") {
    // Replacement effect changed destroy to exile
    return exileCard(state, cardId);
  }

  // Move card to graveyard
  return moveCardToZone(state, cardId, "graveyard");
}

/**
 * Exile a card
 * Can be face-up or face-down
 */
export function exileCard(
  state: GameState,
  cardId: CardInstanceId,
  faceDown: boolean = false,
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

  // Use cached zone key for O(1) lookup if available, otherwise search
  let currentZone: Zone | null = null;
  let currentZoneKey: string | null = card.currentZoneKey;

  if (currentZoneKey) {
    currentZone = state.zones.get(currentZoneKey) ?? null;
  }

  if (!currentZone) {
    // Fallback: search all zones (for cards created before cache existed)
    for (const [zoneKey, zone] of state.zones) {
      if (zone.cardIds.includes(cardId)) {
        currentZone = zone;
        currentZoneKey = zoneKey;
        break;
      }
    }
  }

  if (!currentZone || !currentZoneKey) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} is not in any zone`,
    };
  }

  // Determine exile zone (player's exile or shared exile)
  const exileZoneKey = card.controllerId
    ? `${card.controllerId}-exile`
    : "exile";

  const exileZone = state.zones.get(exileZoneKey);

  if (!exileZone) {
    return {
      success: false,
      state,
      description: "",
      error: `Exile zone not found`,
    };
  }

  // Update card state
  const updatedCard = {
    ...card,
    isFaceDown: faceDown,
    attachedToId: null, // Detach from any attachments
    attachedCardIds: [], // Remove any attachments
    currentZoneKey: exileZoneKey,
  };

  // Update zones
  const updatedCurrentZone = {
    ...currentZone,
    cardIds: currentZone.cardIds.filter((id) => id !== cardId),
  };

  const updatedExileZone = {
    ...exileZone,
    cardIds: [...exileZone.cardIds, cardId],
  };

  const updatedZones = new Map(state.zones);
  updatedZones.set(currentZoneKey, updatedCurrentZone);
  updatedZones.set(exileZoneKey, updatedExileZone);

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  const faceDownText = faceDown ? " face down" : "";

  return {
    success: true,
    state: {
      ...state,
      zones: updatedZones,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Exiled ${card.cardData.name}${faceDownText}`,
    affectedCards: [cardId],
  };
}

/**
 * Sacrifice a permanent
 * The controller of the sacrificed card chooses what to sacrifice
 */
export function sacrificeCard(
  state: GameState,
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

  // Move to graveyard (sacrificed cards go to owner's graveyard)
  return moveCardToZone(state, cardId, "graveyard");
}

// ---------------------------------------------------------------------------
// Blitz (CR 702.150)
//
// Blitz is an alternative cost. When a creature is cast for its blitz cost it
// gains haste, a "When this creature dies, draw a card" triggered ability, and
// a delayed "sacrifice it at the beginning of the next end step" trigger. The
// `blitz` marker on the CardInstance (set in spell-casting at resolution) is
// the single source of truth; the helpers below consume it so the effects fire
// exactly once and only for creatures actually cast via the blitz cost.
// ---------------------------------------------------------------------------

/**
 * Whether this permanent was cast for its blitz cost (CR 702.150) this turn.
 */
export function hasBlitzMarker(card: CardInstance): boolean {
  return card.blitz === true;
}

/**
 * Result of a Blitz-coupled effect (dies-draw or end-step sacrifice).
 */
export interface BlitzEffectResult {
  /** Updated game state */
  state: GameState;
  /** Card IDs that were sacrificed, or cards drawn from the dies-trigger */
  affectedIds: CardInstanceId[];
  /** Whether the blitz effect actually applied */
  applied: boolean;
}

/**
 * CR 702.150a — the "When this creature dies, draw a card" delayed trigger.
 *
 * Call whenever a creature dies (any cause: lethal damage, destroy, sacrifice,
 * 0-toughness, etc.). If the dead creature carried the blitz marker, its
 * controller draws a card and the marker is consumed (so a reanimated or
 * re-played creature does not draw again).
 */
export function resolveBlitzDeathDraw(
  state: GameState,
  deadCardId: CardInstanceId,
): BlitzEffectResult {
  const card = state.cards.get(deadCardId);
  if (!card || card.blitz !== true) {
    return { state, affectedIds: [], applied: false };
  }

  const controllerId = card.controllerId;
  // Consume the marker so the draw cannot fire more than once for this cast.
  const clearedCards = new Map(state.cards);
  clearedCards.set(deadCardId, { ...card, blitz: false });
  let currentState: GameState = { ...state, cards: clearedCards };

  const draw = drawCards(currentState, controllerId, 1);
  currentState = draw.state;

  return {
    state: currentState,
    affectedIds: draw.affectedCards ?? [],
    applied: draw.success,
  };
}

/**
 * CR 702.150a — "Sacrifice it at the beginning of the next end step" delayed
 * trigger.
 *
 * Sacrifices every battlefield creature carrying the blitz marker and resolves
 * the coupled dies-draw for each (sacrificing a creature causes it to die, so
 * the controller draws a card). Because sacrificed creatures leave the
 * battlefield, this naturally fires exactly once — at the first end step the
 * blitz creature survives to — modelling the "next end step" delayed trigger
 * without a separate delayed-trigger registry.
 */
export function applyBlitzEndStepSacrifice(
  state: GameState,
): BlitzEffectResult {
  const blitzIds: CardInstanceId[] = [];
  for (const [, zone] of state.zones) {
    if (zone.type !== ZoneType.BATTLEFIELD) continue;
    for (const cardId of zone.cardIds) {
      const card = state.cards.get(cardId);
      if (card && card.blitz === true) {
        blitzIds.push(cardId);
      }
    }
  }

  if (blitzIds.length === 0) {
    return { state, affectedIds: [], applied: false };
  }

  let currentState = state;
  const sacrificed: CardInstanceId[] = [];
  for (const cardId of blitzIds) {
    const sac = sacrificeCard(currentState, cardId);
    if (sac.success) {
      currentState = sac.state;
      sacrificed.push(cardId);
      // Sacrifice causes the creature to die → coupled dies-draw (CR 702.150a).
      const draw = resolveBlitzDeathDraw(currentState, cardId);
      currentState = draw.state;
    }
  }

  return { state: currentState, affectedIds: sacrificed, applied: true };
}

// ---------------------------------------------------------------------------
// Foretell (CR 702.142)
//
// Foretell is a two-step mechanic:
//   1. CR 702.142b — the keyword ACTION: a player may, once per turn, on their
//      turn, during a main phase while the stack is empty (sorcery timing), pay
//      {2} and exile a card from their hand FACE DOWN. It becomes "foretold":
//      hidden from other players, visible to its owner.
//   2. CR 702.142c — the ALTERNATE CAST: on a later turn, that player may cast
//      the foretold card FROM EXILE by paying its printed foretell cost
//      (revealing it as it is announced). Casting otherwise follows normal
//      timing/stack rules.
//
// A foretold card is modelled as a normal card in its owner's exile zone that
// is flagged `foretold === true` and `isFaceDown === true` (see zones.ts). The
// per-turn limit is tracked on the player as `foretoldThisTurn` (reset each
// turn alongside `landsPlayedThisTurn`).
// ---------------------------------------------------------------------------

/** The constant {2} generic mana cost to exile a card face down (CR 702.142b). */
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
  if (state.priorityPlayerId !== playerId) {
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

/**
 * Draw cards for a player
 * Handles replacement effects (e.g., "If you would draw a card, draw two instead")
 */
export function drawCards(
  state: GameState,
  playerId: PlayerId,
  count: number = 1,
): KeywordActionResult {
  const player = state.players.get(playerId);

  if (!player) {
    return {
      success: false,
      state,
      description: "",
      error: `Player ${playerId} not found`,
    };
  }

  let cardsDrawn = 0;
  let currentState = state;
  const drawnCardIds: CardInstanceId[] = [];

  for (let i = 0; i < count; i++) {
    // Check for replacement effects
    const replacementEvent = {
      type: "draw_card" as const,
      timestamp: Date.now(),
      targetId: playerId,
      amount: 1,
    };

    const rem = currentState.replacementEffectManager;
    const apnapOrder = rem.createAPNAPOrder(
      currentState.turn.activePlayerId,
      Array.from(currentState.players.keys()),
    );
    const processedEvent = rem.processEvent(replacementEvent, apnapOrder);
    const drawAmount = processedEvent.amount;

    // Draw each card
    for (let j = 0; j < drawAmount; j++) {
      const result = drawSingleCard(currentState, playerId);

      if (result.success) {
        currentState = result.state;
        if (result.affectedCards) {
          drawnCardIds.push(...result.affectedCards);
        }
        cardsDrawn++;
      }
    }
  }

  return {
    success: cardsDrawn > 0,
    state: currentState,
    description: `Drew ${cardsDrawn} card${cardsDrawn !== 1 ? "s" : ""} for ${player.name}`,
    affectedCards: drawnCardIds,
  };
}

/**
 * Draw a single card (internal function)
 */
function drawSingleCard(
  state: GameState,
  playerId: PlayerId,
): KeywordActionResult {
  const libraryZoneKey = `${playerId}-library`;
  const handZoneKey = `${playerId}-hand`;

  const library = state.zones.get(libraryZoneKey);
  const hand = state.zones.get(handZoneKey);

  if (!library || !hand) {
    return {
      success: false,
      state,
      description: "",
      error: `Library or hand zone not found for player`,
    };
  }

  if (library.cardIds.length === 0) {
    // Player loses the game when they cannot draw (state-based action)
    // Mark this in game state for SBA to handle
    return {
      success: false,
      state,
      description: `${state.players.get(playerId)?.name} cannot draw - library is empty`,
    };
  }

  // Draw from top of library
  const cardId = library.cardIds[library.cardIds.length - 1];
  const card = state.cards.get(cardId);

  const updatedLibrary = {
    ...library,
    cardIds: library.cardIds.slice(0, -1),
  };

  const updatedHand = {
    ...hand,
    cardIds: [...hand.cardIds, cardId],
  };

  const updatedZones = new Map(state.zones);
  updatedZones.set(libraryZoneKey, updatedLibrary);
  updatedZones.set(handZoneKey, updatedHand);

  return {
    success: true,
    state: {
      ...state,
      zones: updatedZones,
      lastModifiedAt: Date.now(),
    },
    description: card ? `Drew ${card.cardData.name}` : "Drew a card",
    affectedCards: cardId ? [cardId] : [],
  };
}

/**
 * Discard cards from a player's hand
 */
export function discardCards(
  state: GameState,
  playerId: PlayerId,
  count: number = 1,
  random: boolean = false,
): KeywordActionResult {
  const player = state.players.get(playerId);
  const handZoneKey = `${playerId}-hand`;
  const hand = state.zones.get(handZoneKey);

  if (!player) {
    return {
      success: false,
      state,
      description: "",
      error: `Player ${playerId} not found`,
    };
  }

  if (!hand) {
    return {
      success: false,
      state,
      description: "",
      error: `Hand zone not found for player`,
    };
  }

  if (hand.cardIds.length === 0) {
    return {
      success: false,
      state,
      description: `${player.name} has no cards to discard`,
    };
  }

  let cardsToDiscard: CardInstanceId[];

  if (random && hand.cardIds.length > 0) {
    // Random discard (mind rot effect)
    const randomIndex = Math.floor(Math.random() * hand.cardIds.length);
    cardsToDiscard = [hand.cardIds[randomIndex]];
  } else {
    // Controller chooses (for effects like "discard your hand")
    // In this case, we discard from the top (end of array)
    cardsToDiscard = hand.cardIds.slice(-count);
  }

  const discardedCards: CardInstanceId[] = [];

  for (const cardId of cardsToDiscard) {
    const result = moveCardToZone(state, cardId, "graveyard");
    if (result.success) {
      state = result.state;
      if (result.affectedCards) {
        discardedCards.push(...result.affectedCards);
      }
    }
  }

  return {
    success: discardedCards.length > 0,
    state,
    description: `Discarded ${discardedCards.length} card${discardedCards.length !== 1 ? "s" : ""} from ${player.name}'s hand`,
    affectedCards: discardedCards,
  };
}

/**
 * Create a token on the battlefield
 */
export function createTokenCard(
  state: GameState,
  tokenData: ScryfallCard,
  controllerId: PlayerId,
  ownerId: PlayerId,
  count: number = 1,
): KeywordActionResult {
  const player = state.players.get(controllerId);

  if (!player) {
    return {
      success: false,
      state,
      description: "",
      error: `Player ${controllerId} not found`,
    };
  }

  const battlefieldZoneKey = `${controllerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldZoneKey);

  if (!battlefield) {
    return {
      success: false,
      state,
      description: "",
      error: `Battlefield zone not found`,
    };
  }

  const tokenIds: CardInstanceId[] = [];
  const updatedCards = new Map(state.cards);

  for (let i = 0; i < count; i++) {
    const token = createToken(tokenData, controllerId, ownerId);
    tokenIds.push(token.id);
    updatedCards.set(token.id, token);
  }

  const updatedBattlefield = {
    ...battlefield,
    cardIds: [...battlefield.cardIds, ...tokenIds],
  };

  const updatedZones = new Map(state.zones);
  updatedZones.set(battlefieldZoneKey, updatedBattlefield);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      zones: updatedZones,
      lastModifiedAt: Date.now(),
    },
    description: `Created ${count} ${tokenData.name} token${count !== 1 ? "s" : ""}`,
    affectedCards: tokenIds,
  };
}

/**
 * Counter a spell or ability on the stack
 */
export function counterSpell(
  state: GameState,
  stackObjectId: string,
): KeywordActionResult {
  const stackIndex = state.stack.findIndex((s) => s.id === stackObjectId);

  if (stackIndex === -1) {
    return {
      success: false,
      state,
      description: "",
      error: `Stack object ${stackObjectId} not found`,
    };
  }

  const stackObject = state.stack[stackIndex];

  // Mark as countered
  const updatedStackObject = {
    ...stackObject,
    isCountered: true,
  };

  const updatedStack = [
    ...state.stack.slice(0, stackIndex),
    updatedStackObject,
    ...state.stack.slice(stackIndex + 1),
  ];

  return {
    success: true,
    state: {
      ...state,
      stack: updatedStack,
      lastModifiedAt: Date.now(),
    },
    description: `Countered ${stackObject.name}`,
  };
}

/**
 * Regenerate a permanent
 * Creates a "regeneration shield" that prevents destruction
 */
export function regenerateCard(
  state: GameState,
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

  // Check if the card has regenerate ability
  // In a full implementation, this would check if the ability was activated
  // For now, we allow regeneration if the card could theoretically have it

  // Remove all damage
  const updatedCard = {
    ...card,
    damage: 0,
    isTapped: false, // Untap the card
  };

  // Add regeneration shield counter (using a special counter type)
  const updatedCardWithShield = addCounters(
    updatedCard,
    "regeneration-shield",
    1,
  );

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCardWithShield);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Regenerated ${card.cardData.name}`,
    affectedCards: [cardId],
  };
}

/**
 * Check and consume regeneration shield
 * Called when a card would be destroyed
 */
export function consumeRegenerationShield(
  state: GameState,
  cardId: CardInstanceId,
): { hasShield: boolean; state: GameState } {
  const card = state.cards.get(cardId);

  if (!card) {
    return { hasShield: false, state };
  }

  if (hasCounter(card, "regeneration-shield")) {
    // Remove one regeneration shield
    const updatedCard = removeCounters(card, "regeneration-shield", 1);
    const updatedCards = new Map(state.cards);
    updatedCards.set(cardId, updatedCard);

    return {
      hasShield: true,
      state: {
        ...state,
        cards: updatedCards,
        lastModifiedAt: Date.now(),
      },
    };
  }

  return { hasShield: false, state };
}

/**
 * Move a card to a specific zone
 */
export function moveCardToZone(
  state: GameState,
  cardId: CardInstanceId,
  targetZoneType: "graveyard" | "exile" | "hand" | "library" | "battlefield",
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

  // Use cached zone key for O(1) lookup if available, otherwise search
  let currentZone: Zone | null = null;
  let currentZoneKey: string | null = card.currentZoneKey;

  if (currentZoneKey) {
    currentZone = state.zones.get(currentZoneKey) ?? null;
  }

  if (!currentZone) {
    // Fallback: search all zones (for cards created before cache exists)
    for (const [zoneKey, zone] of state.zones) {
      if (zone.cardIds.includes(cardId)) {
        currentZone = zone;
        currentZoneKey = zoneKey;
        break;
      }
    }
  }

  if (!currentZone || !currentZoneKey) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} is not in any zone`,
    };
  }

  // Determine target zone
  let targetZoneKey: string;

  if (targetZoneType === "library") {
    // Libraries are always player's own
    targetZoneKey = `${card.ownerId}-library`;
  } else if (targetZoneType === "graveyard") {
    // Graveyards are owner's
    targetZoneKey = `${card.ownerId}-graveyard`;
  } else if (targetZoneType === "exile") {
    // Exile can be controller's or shared
    targetZoneKey = card.controllerId ? `${card.controllerId}-exile` : "exile";
  } else if (targetZoneType === "hand") {
    targetZoneKey = `${card.controllerId}-hand`;
  } else if (targetZoneType === "battlefield") {
    targetZoneKey = `${card.controllerId}-battlefield`;
  } else {
    return {
      success: false,
      state,
      description: "",
      error: `Invalid target zone: ${targetZoneType}`,
    };
  }

  const targetZone = state.zones.get(targetZoneKey);

  if (!targetZone) {
    return {
      success: false,
      state,
      description: "",
      error: `Target zone ${targetZoneKey} not found`,
    };
  }

  // Handle special cases
  let updatedCard = { ...card };

  if (targetZoneType === "graveyard" || targetZoneType === "library") {
    // Reset certain states when moving to graveyard or library
    updatedCard = {
      ...card,
      isTapped: false,
      isFaceDown: false,
      attachedToId: null,
      attachedCardIds: [],
      damage: 0,
      counters: [], // Remove counters
    };
  } else if (targetZoneType === "battlefield") {
    // Set summoning sickness for permanents entering battlefield
    updatedCard = {
      ...card,
      hasSummoningSickness: true,
      enteredBattlefieldTimestamp: Date.now(),
    };
    // Initialize loyalty counters for planeswalkers (CR 306.5b)
    updatedCard = initializePlaneswalkerLoyalty(updatedCard);
  }

  // Update zones
  const updatedCurrentZone = {
    ...currentZone,
    cardIds: currentZone.cardIds.filter((id) => id !== cardId),
  };

  const updatedTargetZone = {
    ...targetZone,
    cardIds: [...targetZone.cardIds, cardId],
  };

  const updatedZones = new Map(state.zones);
  updatedZones.set(currentZoneKey, updatedCurrentZone);
  updatedZones.set(targetZoneKey, updatedTargetZone);

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  const zoneNames: Record<string, string> = {
    graveyard: "graveyard",
    exile: "exile",
    hand: "hand",
    library: "library",
    battlefield: "battlefield",
  };

  return {
    success: true,
    state: {
      ...state,
      zones: updatedZones,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Moved ${card.cardData.name} to ${zoneNames[targetZoneType]}`,
    affectedCards: [cardId],
  };
}

/**
 * Deal damage to a card (creature, planeswalker)
 */
export function dealDamageToCard(
  state: GameState,
  cardId: CardInstanceId,
  damage: number,
  isCombatDamage: boolean = false,
  sourceId?: CardInstanceId,
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

  // CR 702.16C: Check if damage should be prevented due to protection
  // Protection from a color prevents all damage from sources of that color
  if (sourceId) {
    const source = state.cards.get(sourceId);
    if (source && shouldPreventDamageToTarget(card, source)) {
      return {
        success: true,
        state,
        description: `Damage prevented by protection from ${card.cardData.oracle_text?.match(/protection from (\w+)/)?.[1] || "color"}`,
      };
    }
  }

  // Check for prevention effects
  const replacementEvent = {
    type: "damage" as const,
    timestamp: Date.now(),
    sourceId,
    targetId: cardId,
    amount: damage,
    isCombatDamage,
    damageTypes: (isCombatDamage ? ["combat"] : ["noncombat"]) as (
      "combat" | "noncombat"
    )[],
  };

  const rem = state.replacementEffectManager;
  const apnapOrder = rem.createAPNAPOrder(
    state.turn.activePlayerId,
    Array.from(state.players.keys()),
  );
  const processedEvent = rem.processEvent(replacementEvent, apnapOrder);
  const actualDamage = processedEvent.amount;

  // Apply damage
  let updatedCard = {
    ...card,
    damage: card.damage + actualDamage,
  };

  // Planeswalker damage reduces loyalty (CR 119.3c)
  const isPlaneswalker = card.cardData.type_line
    ?.toLowerCase()
    .includes("planeswalker");
  if (isPlaneswalker) {
    const loyaltyCounter = updatedCard.counters?.find(
      (c) => c.type === "loyalty",
    );
    if (loyaltyCounter) {
      const currentLoyalty = loyaltyCounter.count || 0;
      const newLoyalty = currentLoyalty - actualDamage;
      updatedCard = {
        ...updatedCard,
        counters:
          updatedCard.counters
            ?.filter((c) => c.type !== "loyalty")
            .concat([{ type: "loyalty", count: newLoyalty }]) || [],
      };
    }
  }

  // Check for deathtouch on the source - lethal damage is 1 or more
  // CR 702.2b: Any nonzero amount of combat damage assigned by a source with deathtouch is considered lethal damage
  if (sourceId) {
    const sourceCard = state.cards.get(sourceId);
    if (sourceCard) {
      const sourceHasDeathtouch = hasDeathtouch(sourceCard);

      if (sourceHasDeathtouch && actualDamage > 0) {
        // With deathtouch, any amount of damage is lethal
        // CR 702.2b: Any nonzero amount of combat damage from a deathtouch source is lethal
        const lethalDamage = getToughness(card);
        updatedCard = {
          ...updatedCard,
          damage: Math.max(updatedCard.damage, lethalDamage),
        };
      }
    }
  }

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  const damageType = isCombatDamage ? "combat damage" : "damage";

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `${card.cardData.name} dealt ${actualDamage} ${damageType}`,
    affectedCards: [cardId],
  };
}

/**
 * Add a counter to a card
 */
export function addCounterToCard(
  state: GameState,
  cardId: CardInstanceId,
  counterType: string,
  count: number = 1,
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

  const updatedCard = addCounters(card, counterType, count);

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Added ${count} ${counterType} counter${count !== 1 ? "s" : ""} to ${card.cardData.name}`,
    affectedCards: [cardId],
  };
}

/**
 * Remove a counter from a card
 */
export function removeCounterFromCard(
  state: GameState,
  cardId: CardInstanceId,
  counterType: string,
  count: number = 1,
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

  const updatedCard = removeCounters(card, counterType, count);

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Removed ${count} ${counterType} counter${count !== 1 ? "s" : ""} from ${card.cardData.name}`,
    affectedCards: [cardId],
  };
}

/**
 * Tap a card
 */
export function tapCardAction(
  state: GameState,
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

  if (card.isTapped) {
    return {
      success: false,
      state,
      description: `${card.cardData.name} is already tapped`,
    };
  }

  const updatedCard = {
    ...card,
    isTapped: true,
  };

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Tapped ${card.cardData.name}`,
    affectedCards: [cardId],
  };
}

/**
 * Untap a card
 */
export function untapCardAction(
  state: GameState,
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

  if (!card.isTapped) {
    return {
      success: false,
      state,
      description: `${card.cardData.name} is already untapped`,
    };
  }

  const updatedCard = {
    ...card,
    isTapped: false,
  };

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Untapped ${card.cardData.name}`,
    affectedCards: [cardId],
  };
}

/**
 * Handle persist keyword when a creature dies
 * CR 702.78: When a creature with persist dies, if it had no -1/-1 counters on it,
 * return it to the battlefield with a -1/-1 counter on it.
 *
 * `countersAtDeath` is the counters the creature had on the battlefield at the
 * moment it died. It MUST be supplied by death-path callers (e.g. state-based
 * actions), because destroyCard()/moveCardToZone() clears counters when moving
 * the card to the graveyard. Without it the intervening-"if" (CR 603.4) could
 * never fail and persist would wrongly re-trigger on a creature that died with
 * a -1/-1 counter. Callers that operate on a card whose counters are still
 * intact (e.g. direct unit tests) may omit it.
 */
export function handlePersist(
  state: GameState,
  deadCardId: CardInstanceId,
  countersAtDeath?: Counter[],
): {
  state: GameState;
  persistedCards: CardInstanceId[];
  descriptions: string[];
} {
  const card = state.cards.get(deadCardId);
  const persistedCards: CardInstanceId[] = [];
  const descriptions: string[] = [];

  if (!card) {
    return { state, persistedCards, descriptions };
  }

  // Only creatures can have persist
  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  if (!typeLine.includes("creature")) {
    return { state, persistedCards, descriptions };
  }

  // Check if the card has persist
  if (!hasPersist(card)) {
    return { state, persistedCards, descriptions };
  }

  // Check if persist can trigger (creature must NOT have -1/-1 counter at death)
  if (!canPersistTrigger(card, countersAtDeath)) {
    descriptions.push(
      `${card.cardData.name} had a -1/-1 counter, persist did not trigger`,
    );
    return { state, persistedCards, descriptions };
  }

  // Find the graveyard zone
  const graveyardKey = `${card.ownerId}-graveyard`;
  const graveyardZone = state.zones.get(graveyardKey);

  if (!graveyardZone || !graveyardZone.cardIds.includes(deadCardId)) {
    return { state, persistedCards, descriptions };
  }

  // Remove card from graveyard
  const updatedGraveyardZone = {
    ...graveyardZone,
    cardIds: graveyardZone.cardIds.filter((id) => id !== deadCardId),
  };

  // Add card to battlefield with -1/-1 counter
  const battlefieldKey = `${card.controllerId}-battlefield`;
  const battlefieldZone = state.zones.get(battlefieldKey);

  if (!battlefieldZone) {
    return { state, persistedCards, descriptions };
  }

  const updatedBattlefieldZone = {
    ...battlefieldZone,
    cardIds: [...battlefieldZone.cardIds, deadCardId],
  };

  // Update the card with -1/-1 counter and battlefield state
  const updatedCard: CardInstance = {
    ...card,
    counters: [{ type: "-1/-1", count: 1 }],
    hasSummoningSickness: true,
    damage: 0,
    isTapped: false,
    attachedToId: null,
    attachedCardIds: [],
    enteredBattlefieldTimestamp: Date.now(),
  };

  // Update state
  const updatedZones = new Map(state.zones);
  updatedZones.set(graveyardKey, updatedGraveyardZone);
  updatedZones.set(battlefieldKey, updatedBattlefieldZone);

  const updatedCards = new Map(state.cards);
  updatedCards.set(deadCardId, updatedCard);

  const updatedState = {
    ...state,
    zones: updatedZones,
    cards: updatedCards,
    lastModifiedAt: Date.now(),
  };

  persistedCards.push(deadCardId);
  descriptions.push(
    `${card.cardData.name} returned to battlefield with -1/-1 counter (Persist)`,
  );

  return { state: updatedState, persistedCards, descriptions };
}

// ===========================================================================
// Cycling (CR 702.30) + Typecycling / Landcycling / Basic landcycling
// (CR 702.31)
//
// "Cycling {cost}" is an activated ability that may be activated from a
// player's hand only. The cost is {cost} + discard this card; the effect is to
// draw a card (CR 702.30a). Typecycling / Landcycling / Basic landcycling are
// defined in CR 702.31 and replace the draw with a library search for a card
// of the named type. The cycle ability uses the stack (CR 602.2), so it can be
// responded to like any other activated ability.
//
// Like other activated abilities with discard costs, cycling can only be
// activated at sorcery timing — the active player during a main phase while
// the stack is empty (CR 117.1a). The implementation enforces that here and
// surfaces it via canCycleCard so callers (UI, AI) can gate the action.
// ===========================================================================

/**
 * Parse the cycling keyword from oracle text. Thin convenience wrapper around
 * `parseCycling` returning the legacy `number | null` shape — used by
 * tests/UI that pre-date the CyclingInfo object.
 */
export function parseCyclingCost(
  text: string | null | undefined,
): number | null {
  if (!text) return null;
  const info = parseCycling(text);
  if (!info.hasCycling || !info.cost) return null;
  return info.cost.generic;
}

/**
 * Internal: read the ScryfallCard-shaped `cardData` block off either a
 * CardInstance or a ScryfallCard. Both types expose the same fields we need
 * (oracle_text, keywords, type_line) so we treat them uniformly.
 */
function getCyclingCardData(card: CardInstance | ScryfallCard): ScryfallCard {
  if ("cardData" in card && card.cardData) {
    return card.cardData as ScryfallCard;
  }
  return card as ScryfallCard;
}

/**
 * Return true if the card has any cycling variant (Cycling / Typecycling /
 * Landcycling / Basic landcycling) parsed from oracle text or the keywords
 * array. CR 702.30-31.
 */
export function hasCycling(card: CardInstance | ScryfallCard): boolean {
  const data = getCyclingCardData(card);
  const oracleText = data.oracle_text ?? "";
  const keywords = data.keywords ?? [];
  if (oracleText && parseCycling(oracleText).hasCycling) {
    return true;
  }
  return keywords.some((k) => /cycling/i.test(k));
}

/**
 * Return true if the card has a Landcycling variant (either bare
 * "Landcycling" or "[Type] landcycling" / "Basic landcycling"). If `landType`
 * is supplied, only return true when the parsed variant is restricted to that
 * specific basic land subtype.
 */
export function hasLandcycling(
  card: CardInstance | ScryfallCard,
  landType?: string,
): boolean {
  const data = getCyclingCardData(card);
  const oracleText = data.oracle_text ?? "";
  if (!oracleText) return false;
  const info = parseCycling(oracleText);
  if (
    !info.hasCycling ||
    (info.variant !== CyclingVariant.LANDCYCLING &&
      info.variant !== CyclingVariant.BASIC_LANDCYCLING)
  ) {
    return false;
  }
  if (landType !== undefined) {
    return info.basicLandType === landType;
  }
  return true;
}

/**
 * Return true if the card has a Typecycling variant (e.g. Wizardcycling,
 * Slivercycling). When `cardType` is supplied, only return true when the
 * parsed cycling variant targets that specific card type.
 */
export function hasTypecycling(
  card: CardInstance | ScryfallCard,
  cardType?: string,
): boolean {
  const data = getCyclingCardData(card);
  const oracleText = data.oracle_text ?? "";
  if (!oracleText) return false;
  const info = parseCycling(oracleText);
  if (!info.hasCycling || info.variant !== CyclingVariant.TYPECYCLING) {
    return false;
  }
  if (cardType !== undefined) {
    return info.type === cardType;
  }
  return true;
}

/**
 * Return the parsed cycling mana cost as a `ParsedManaCost`, or `null` if the
 * card does not have cycling. The "discard this card" portion of the cost is
 * implicit (CR 702.30a) and is not included in the returned object.
 */
export function getCyclingCost(
  card: CardInstance | ScryfallCard,
): CyclingInfo["cost"] {
  const data = getCyclingCardData(card);
  const oracleText = data.oracle_text ?? "";
  if (!oracleText) return null;
  return parseCycling(oracleText).cost;
}

/**
 * Return the full parsed cycling descriptor for the card (variant + cost +
 * named type). Useful when the caller needs to distinguish the variants (e.g.
 * to drive the correct effect after the cost is paid).
 */
export function getCyclingVariant(
  card: CardInstance | ScryfallCard,
): CyclingInfo {
  const data = getCyclingCardData(card);
  const oracleText = data.oracle_text ?? "";
  if (!oracleText) {
    return {
      hasCycling: false,
      variant: null,
      cost: null,
      costString: null,
      type: null,
      basicLandType: null,
      description: "",
    };
  }
  return parseCycling(oracleText);
}

/**
 * Check whether `playerId` may cycle `card` right now.
 *
 * CR 702.30a: Cycling functions only while the card is in a player's hand.
 * CR 117.1a / 602.2: Activated abilities follow normal timing — sorcery
 * timing applies (active player, main phase, empty stack, player has
 * priority). CR 602.5b: A cost requiring a payment (e.g. discard) can only
 * be activated when the payment can be made; we additionally require the
 * player can pay the mana cost.
 */
export function canCycleCard(
  state: GameState,
  playerId: PlayerId,
  card: CardInstance,
): boolean {
  if (!state || !card) return false;
  if (card.controllerId !== playerId && card.ownerId !== playerId) return false;

  // CR 702.30a: cycling is hand-only.
  const handZone = state.zones.get(`${playerId}-hand`);
  if (!handZone || !handZone.cardIds.includes(card.id)) {
    return false;
  }

  // Must have cycling.
  if (!hasCycling(card)) return false;

  // Sorcery-speed timing (active player, main phase, empty stack, priority).
  if (state.status !== "in_progress") return false;
  if (state.turn.activePlayerId !== playerId) return false;
  if (
    state.turn.currentPhase !== Phase.PRECOMBAT_MAIN &&
    state.turn.currentPhase !== Phase.POSTCOMBAT_MAIN
  ) {
    return false;
  }
  if (state.stack.length > 0) return false;
  if (state.priorityPlayerId !== playerId) return false;

  // Must be able to pay the cycling mana cost.
  const cost = getCyclingCost(card);
  if (cost) {
    const player = state.players.get(playerId);
    if (!player) return false;
    const pool = player.manaPool;
    const coloredShortfall =
      cost.white > pool.white ||
      cost.blue > pool.blue ||
      cost.black > pool.black ||
      cost.red > pool.red ||
      cost.green > pool.green ||
      cost.colorless > pool.colorless;
    if (coloredShortfall) return false;
    const availableGeneric =
      pool.generic +
      pool.white +
      pool.blue +
      pool.black +
      pool.red +
      pool.green;
    if (cost.generic > availableGeneric) return false;
  }

  return true;
}

/**
 * Activate Cycling / Typecycling / Landcycling on `cardId` (CR 702.30-31).
 *
 * Steps (in order):
 *  1. Verify the card exists, is in the player's hand, and has cycling.
 *  2. Verify sorcery-speed timing (active player, main phase, empty stack,
 *     player has priority).
 *  3. Pay the cycling mana cost from the player's mana pool.
 *  4. Move the cycled card from hand → graveyard (the discard is a cost of
 *     the ability, CR 601.2g, and does not use the stack).
 *  5. Resolve the effect:
 *       - CYCLING              → draw a card (CR 702.30a).
 *       - LANDCYCLING /
 *         BASIC_LANDCYCLING   → search library for a land of the named type
 *                                (or any basic land for the bare form), reveal
 *                                it, put it into hand, then shuffle (CR
 *                                702.31b/c). The library search uses the
 *                                controller's library; this implementation
 *                                moves the first matching land instance to
 *                                hand and shuffles. If no matching land is
 *                                present, the library is still shuffled (CR
 *                                702.31c, last sentence) and no card is
 *                                drawn.
 *       - TYPECYCLING          → search library for a card of the named type,
 *                                reveal it, put it into hand, shuffle (CR
 *                                702.31a). Same library-search semantics as
 *                                Landcycling above.
 *
 * The result is a `KeywordActionResult` carrying the updated state. An
 * `error` is set if any precondition fails; the input `state` is returned
 * unchanged on failure.
 */
export function cycleCard(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  options: {
    /**
     * Optional pre-selected card instance ID for Typecycling / Landcycling
     * library searches. When supplied, that card is the one found and
     * revealed; when omitted, the engine picks the first card in the library
     * whose type line matches the cycling variant (or any land for the bare
     * Landcycling form).
     */
    selectedFoundCardId?: CardInstanceId;
  } = {},
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

  const info = parseCycling(card.cardData.oracle_text || "");
  if (!info.hasCycling) {
    return {
      success: false,
      state,
      description: "",
      error: `${card.cardData.name} does not have cycling.`,
    };
  }

  // CR 702.30a: cycling is hand-only.
  const handZoneKey = `${playerId}-hand`;
  const handZone = state.zones.get(handZoneKey);
  if (!handZone || !handZone.cardIds.includes(cardId)) {
    return {
      success: false,
      state,
      description: "",
      error: "Cycling can only be activated from your hand.",
    };
  }

  // Sorcery-speed timing (CR 117.1a).
  if (state.status !== "in_progress") {
    return {
      success: false,
      state,
      description: "",
      error: "Cycling can only be activated during an in-progress game.",
    };
  }
  if (state.turn.activePlayerId !== playerId) {
    return {
      success: false,
      state,
      description: "",
      error: "You can cycle only on your turn.",
    };
  }
  if (
    state.turn.currentPhase !== Phase.PRECOMBAT_MAIN &&
    state.turn.currentPhase !== Phase.POSTCOMBAT_MAIN
  ) {
    return {
      success: false,
      state,
      description: "",
      error: "Cycling can only be activated during a main phase.",
    };
  }
  if (state.stack.length > 0) {
    return {
      success: false,
      state,
      description: "",
      error: "Cycling can only be activated when the stack is empty.",
    };
  }
  if (state.priorityPlayerId !== playerId) {
    return {
      success: false,
      state,
      description: "",
      error: "You do not have priority.",
    };
  }

  // Pay the cycling mana cost.
  let workingState = state;
  if (info.cost) {
    const payment = {
      generic: info.cost.generic,
      white: info.cost.white,
      blue: info.cost.blue,
      black: info.cost.black,
      red: info.cost.red,
      green: info.cost.green,
      colorless: info.cost.colorless,
    };
    const spend = spendMana(workingState, playerId, payment);
    if (!spend.success) {
      return {
        success: false,
        state,
        description: "",
        error: "Not enough mana to cycle.",
      };
    }
    workingState = spend.state;
  }

  // Pay the discard cost: move the cycled card to the graveyard.
  const discard = moveCardToZone(workingState, cardId, "graveyard");
  if (!discard.success) {
    return {
      success: false,
      state,
      description: "",
      error: discard.error ?? "Failed to discard the cycled card.",
    };
  }
  workingState = discard.state;

  // Resolve the cycling effect based on the variant.
  switch (info.variant) {
    case CyclingVariant.CYCLING: {
      const draw = drawCards(workingState, playerId, 1);
      if (!draw.success) {
        // The discard already happened — surface a clear error so the caller
        // knows to undo. We still return the state with the cycled card in
        // the graveyard (it was paid as a cost) so the caller can decide.
        return {
          success: false,
          state: draw.state,
          description: `Cycled ${card.cardData.name}, but could not draw a card`,
          error: draw.error ?? "Could not draw a card.",
          affectedCards: [cardId],
        };
      }
      return {
        success: true,
        state: draw.state,
        description: `Cycled ${card.cardData.name} and drew a card`,
        affectedCards: [cardId, ...(draw.affectedCards ?? [])],
      };
    }
    case CyclingVariant.TYPECYCLING:
    case CyclingVariant.LANDCYCLING:
    case CyclingVariant.BASIC_LANDCYCLING: {
      const search = searchLibraryForCycling(
        workingState,
        playerId,
        info,
        options.selectedFoundCardId,
      );
      if (!search.success) {
        return {
          success: false,
          state: search.state,
          description: `Cycled ${card.cardData.name}, but library search failed`,
          error: search.error,
          affectedCards: [cardId],
        };
      }
      const moved = search.movedCardId
        ? ` and put ${search.movedCardName ?? "a card"} into hand`
        : "";
      return {
        success: true,
        state: search.state,
        description: `Cycled ${card.cardData.name}${moved}`,
        affectedCards: search.movedCardId
          ? [cardId, search.movedCardId]
          : [cardId],
      };
    }
    default:
      return {
        success: false,
        state: workingState,
        description: "",
        error: `Unknown cycling variant: ${String(info.variant)}`,
        affectedCards: [cardId],
      };
  }
}

/**
 * Internal: library search for Typecycling / Landcycling. Reveals the chosen
 * card, moves it to the controller's hand, and shuffles the library (CR
 * 702.31a-c). The "reveal" step is tracked by adding the revealed card ID to
 * the result; a full implementation would broadcast the reveal to opponents,
 * which is out of scope for the engine API.
 *
 * If `selectedFoundCardId` is supplied, that card is the one moved. Otherwise
 * the engine scans the library (top of the array == bottom of the library)
 * for the first card whose type line matches the cycling variant's predicate.
 * If no match exists, the library is still shuffled (CR 702.31c, "If you
 * don't, shuffle your library.") and no card moves to hand.
 */
function searchLibraryForCycling(
  state: GameState,
  playerId: PlayerId,
  info: CyclingInfo,
  selectedFoundCardId?: CardInstanceId,
): {
  success: boolean;
  state: GameState;
  movedCardId?: CardInstanceId;
  movedCardName?: string;
  error?: string;
} {
  const libraryKey = `${playerId}-library`;
  const handKey = `${playerId}-hand`;
  const library = state.zones.get(libraryKey);
  const hand = state.zones.get(handKey);

  if (!library || !hand) {
    return {
      success: false,
      state,
      error: "Library or hand zone missing.",
    };
  }

  const predicate = buildLibrarySearchPredicate(info);

  // Resolve which card to move. If a selected ID is supplied, validate it is
  // still in the library and matches the predicate. Otherwise pick the first
  // matching card in the library (top of array = bottom of library; the
  // specific position is irrelevant for game-logic correctness here, since
  // the library is going to be shuffled anyway).
  let chosenId: CardInstanceId | null = null;
  if (selectedFoundCardId !== undefined) {
    if (!library.cardIds.includes(selectedFoundCardId)) {
      return {
        success: false,
        state,
        error: "Selected card is not in your library.",
      };
    }
    const chosen = state.cards.get(selectedFoundCardId);
    if (!chosen || !predicate(chosen.cardData)) {
      return {
        success: false,
        state,
        error: "Selected card does not match the cycling variant.",
      };
    }
    chosenId = selectedFoundCardId;
  } else {
    for (const id of library.cardIds) {
      const candidate = state.cards.get(id);
      if (candidate && predicate(candidate.cardData)) {
        chosenId = id;
        break;
      }
    }
  }

  const nextLibrary: Zone = shuffleZone(library);

  if (chosenId === null) {
    // CR 702.31c: even when no matching card is found, the player still
    // shuffles the library. The discard-as-cost already moved the cycled
    // card to the graveyard.
    return {
      success: true,
      state: {
        ...state,
        zones: new Map(state.zones).set(libraryKey, nextLibrary),
        lastModifiedAt: Date.now(),
      },
    };
  }

  // Move the chosen card from library to hand.
  const nextLibraryCardIds = nextLibrary.cardIds.filter(
    (id) => id !== chosenId,
  );
  const movedCard = state.cards.get(chosenId);
  const movedCardName = movedCard?.cardData.name;
  const nextLibrary2: Zone = {
    ...nextLibrary,
    cardIds: nextLibraryCardIds,
  };
  const nextHand: Zone = {
    ...hand,
    cardIds: [...hand.cardIds, chosenId],
  };
  const nextZones = new Map(state.zones);
  nextZones.set(libraryKey, nextLibrary2);
  nextZones.set(handKey, nextHand);

  return {
    success: true,
    state: {
      ...state,
      zones: nextZones,
      lastModifiedAt: Date.now(),
    },
    movedCardId: chosenId,
    movedCardName,
  };
}

/**
 * Build a predicate that matches a card's ScryfallCard data against the
 * cycling variant's search target. Centralises the type-line checks so each
 * search variant shares the same fallback semantics.
 */
function buildLibrarySearchPredicate(
  info: CyclingInfo,
): (cardData: ScryfallCard) => boolean {
  switch (info.variant) {
    case CyclingVariant.TYPECYCLING:
      return (cardData) => {
        const typeLine = (cardData.type_line || "").toLowerCase();
        const wanted = (info.type || "").toLowerCase();
        if (!wanted) return false;
        // Match against the full type line (so "Wizard Subtype" still matches
        // wizardcycling). Allow multi-word types too.
        return typeLine.includes(wanted);
      };
    case CyclingVariant.LANDCYCLING:
      return (cardData) => {
        const typeLine = (cardData.type_line || "").toLowerCase();
        if (info.basicLandType) {
          // "[Type] landcycling" — restrict to lands with that basic subtype.
          const wanted = info.basicLandType.toLowerCase();
          return typeLine.includes("land") && typeLine.includes(wanted);
        }
        // Bare "Landcycling" — any land.
        return typeLine.includes("land");
      };
    case CyclingVariant.BASIC_LANDCYCLING:
      return (cardData) => {
        const typeLine = (cardData.type_line || "").toLowerCase();
        return typeLine.startsWith("basic land");
      };
    default:
      return () => false;
  }
}

/** @deprecated Stub - hand filter not yet implemented */
export function getHandFilterForCard(cardName: string): any {
  return null;
}

// ============================================================================
// Monarchy helpers (CR 704.5p, CR 714)
// Issue #1225.
//
// The monarchy is a designation transferred by a state-based action when the
// current monarch is dealt combat damage by an opponent. Cards such as
// `Regal Behemoth`, `Court of Ambition`, and `Archpriest of Iona` use these
// helpers when their oracle text says "you become the monarch".
//
// We deliberately keep these helpers thin wrappers around the `Player`
// `isMonarch` flag rather than wrapping a separate registry — the rules text
// is the source of truth, and any SBA, triggered ability, or card effect
// resolves through a single channel.
// ============================================================================

/**
 * Result of a monarchy mutation. Carries enough context for callers to detect
 * that the monarchy ACTUALLY changed so they can fire triggers/auditors
 * without having to diff the full player map again.
 */
export interface MonarchyChangeResult {
  success: boolean;
  state: GameState;
  /** ID of the player who IS the monarch after the operation (null if cleared) */
  monarchId: PlayerId | null;
  /** True iff this call changed who held the monarchy. */
  changed: boolean;
  description: string;
  error?: string;
}

/**
 * Resolve the current monarch id (or `null` if no monarch is set).
 *
 * At most one player should hold the monarchy at any time. We defensively
 * pick the lowest-id holder when something already corrupted the state so
 * downstream SBAs can still converge.
 */
export function getMonarchId(state: GameState): PlayerId | null {
  let firstMonarch: PlayerId | null = null;
  for (const [id, player] of state.players) {
    if (player.isMonarch) {
      if (firstMonarch === null) {
        firstMonarch = id;
      } else {
        return id;
      }
    }
  }
  return firstMonarch;
}

/**
 * Set the given player as the monarch, clearing the flag from every other
 * player. This is the single write-path for `isMonarch` — all monarchy
 * transitions route through it so that downstream subsystems (triggers,
 * state-hash diffs, history) only need to observe one well-defined API.
 *
 * Returns `changed=false` if the requested player was already monarch.
 */
export function setMonarch(
  state: GameState,
  newMonarchId: PlayerId,
): MonarchyChangeResult {
  const newMonarch = state.players.get(newMonarchId);
  if (!newMonarch) {
    return {
      success: false,
      state,
      monarchId: getMonarchId(state),
      changed: false,
      description: `Monarchy unchanged: player ${newMonarchId} not found`,
      error: `Player ${newMonarchId} not found`,
    };
  }

  const previousMonarchId = getMonarchId(state);
  if (previousMonarchId === newMonarchId) {
    return {
      success: true,
      state,
      monarchId: newMonarchId,
      changed: false,
      description: `${newMonarch.name} is already the monarch`,
    };
  }

  const updatedPlayers = new Map(state.players);
  if (previousMonarchId !== null) {
    const previousMonarch = updatedPlayers.get(previousMonarchId);
    if (previousMonarch) {
      updatedPlayers.set(previousMonarchId, {
        ...previousMonarch,
        isMonarch: false,
      });
    }
  }
  updatedPlayers.set(newMonarchId, {
    ...newMonarch,
    isMonarch: true,
  });

  const nextState: GameState = {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };

  return {
    success: true,
    state: nextState,
    monarchId: newMonarchId,
    changed: true,
    description: `${newMonarch.name} becomes the monarch`,
  };
}

/**
 * Clear the monarchy flag from every player. Used when the game advances out
 * of monarchy territory (formats that don't use it, the active player
 * intentionally resigned the designation, etc.).
 */
export function clearMonarch(state: GameState): MonarchyChangeResult {
  const previousMonarchId = getMonarchId(state);
  if (previousMonarchId === null) {
    return {
      success: true,
      state,
      monarchId: null,
      changed: false,
      description: "No monarch to clear",
    };
  }

  const updatedPlayers = new Map(state.players);
  for (const [id, player] of updatedPlayers) {
    if (player.isMonarch) {
      updatedPlayers.set(id, { ...player, isMonarch: false });
    }
  }

  const nextState: GameState = {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };

  return {
    success: true,
    state: nextState,
    monarchId: null,
    changed: true,
    description: "Monarchy cleared",
  };
}

/**
 * Reset per-turn monarchy tracking on every player so old "who last hit me"
 * memory doesn't survive turn boundaries.
 *
 * Called by turn-phase transitions (end of turn / cleanup step) so the
 * CR 704.5p SBA does not transfer the monarchy based on stale damage.
 * Optional internal callers (tests, the SBA implementation) can invoke
 * `setMonarch` directly without touching this counter.
 */
export function resetMonarchyTracking(state: GameState): GameState {
  let mutated = false;
  const updatedPlayers = new Map(state.players);
  for (const [id, player] of updatedPlayers) {
    if (player.lastCombatDamageFromPlayer != null) {
      updatedPlayers.set(id, {
        ...player,
        lastCombatDamageFromPlayer: null,
      });
      mutated = true;
    }
  }
  if (!mutated) return state;
  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Result of resolving the monarchy end-step draw.
 */
export interface MonarchEndStepDrawResult {
  state: GameState;
  /** True iff the monarch drew a card during this call. */
  drewCard: boolean;
  description: string;
  /** Number of cards actually drawn (0 if no monarch / deck was empty). */
  drawnCount: number;
}

/**
 * Apply the CR 714.3 "monarch draws" effect at the beginning of the
 * monarch's end step.
 *
 * Callers invoke this once per turn transition into the `END` phase for the
 * player who currently holds the monarchy. If no monarch exists, this is a
 * no-op (the rule is conditional on a player being the monarch).
 *
 * We deliberately funnel the draw through `drawCards` so replacement
 * effects ("If you would draw a card, draw two instead") still apply.
 */
export function applyMonarchEndStepDraw(
  state: GameState,
): MonarchEndStepDrawResult {
  const monarchId = getMonarchId(state);
  if (monarchId === null) {
    return {
      state,
      drewCard: false,
      description: "No monarch — end step draw skipped",
      drawnCount: 0,
    };
  }
  const monarch = state.players.get(monarchId);
  if (!monarch) {
    return {
      state,
      drewCard: false,
      description: "Monarch id not found — end step draw skipped",
      drawnCount: 0,
    };
  }
  const libraryKey = `${monarchId}-${ZoneType.LIBRARY}`;
  const library = state.zones.get(libraryKey);
  const beforeHandSize =
    state.zones.get(`${monarchId}-${ZoneType.HAND}`)?.cardIds.length ?? 0;
  if (!library || library.cardIds.length === 0) {
    return {
      state,
      drewCard: false,
      description: `${monarch.name} (monarch) cannot draw from empty library`,
      drawnCount: 0,
    };
  }

  const drawResult = drawCards(state, monarchId, 1);
  const afterHandSize =
    drawResult.state.zones.get(`${monarchId}-${ZoneType.HAND}`)?.cardIds
      .length ?? beforeHandSize;
  const drawn = afterHandSize > beforeHandSize;
  return {
    state: drawResult.state,
    drewCard: drawn,
    drawnCount: drawn ? 1 : 0,
    description: drawn
      ? `${monarch.name} draws a card at end step (CR 714.3, the monarch)`
      : `${monarch.name} (monarch) did not draw`,
  };
}
