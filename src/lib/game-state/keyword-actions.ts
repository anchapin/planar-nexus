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
import { moveCardBetweenZones, isForetoldCard } from "./zones";
import { spendMana } from "./mana";
import { parseForetell } from "./oracle-text-parser";
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
      | "combat"
      | "noncombat"
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
 */
export function handlePersist(
  state: GameState,
  deadCardId: CardInstanceId,
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

  // Check if persist can trigger (creature must NOT have -1/-1 counter)
  if (!canPersistTrigger(card)) {
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

/** @deprecated Stub - cycling mechanic not yet implemented */
export function hasCycling(card: any): boolean {
  return false;
}

/** @deprecated Stub - cycling mechanic not yet implemented */
export function hasLandcycling(card: any, landType?: string): boolean {
  return false;
}

/** @deprecated Stub - cycling mechanic not yet implemented */
export function getCyclingCost(card: any): number | null {
  return null;
}

/** @deprecated Stub - cycling mechanic not yet implemented */
export function canCycleCard(state: any, playerId: any, card: any): boolean {
  return false;
}

/** @deprecated Stub - cycling mechanic not yet implemented */
export function cycleCard(state: any, playerId: any, cardId: any): any {
  return { success: false, error: "not implemented" };
}

/** @deprecated Stub - cycling mechanic not yet implemented */
export function parseCyclingCost(text: any): number | null {
  return null;
}

/** @deprecated Stub - hand filter not yet implemented */
export function getHandFilterForCard(cardName: string): any {
  return null;
}
