/**
 * Blitz keyword actions: the blitz death-trigger draw and end-step sacrifice (CR 702.7).
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, CardInstance, CardInstanceId } from '../types';
import { ZoneType } from '../types';
import { drawCards } from './draw';
import { sacrificeCard } from './removal';

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
