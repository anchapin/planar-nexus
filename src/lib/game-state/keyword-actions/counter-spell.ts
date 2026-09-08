/**
 * Counter keyword action (CR 701.5a): countering a spell or ability on the stack.
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, CardInstance, PlayerId } from '../types';
import { KeywordActionResult } from './shared';

/**
 * Counter a spell or ability on the stack
 *
 * CR 701.5a — a countered ability ceases to exist (it is removed from the
 * stack and nothing else happens).
 * CR 701.5b — a countered spell is removed from the stack and its card is
 * put into its OWNER's graveyard (not its controller's) as part of resolving
 * the counter.
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

  // CR 701.5 — remove the countered object from the stack so subsequent
  // stack walks (cascade, copies, resolution sweeps) never observe the
  // stale entry.
  const updatedStack = [
    ...state.stack.slice(0, stackIndex),
    ...state.stack.slice(stackIndex + 1),
  ];

  let currentState: GameState = { ...state, stack: updatedStack };

  // CR 701.5b — a countered SPELL's card goes to its owner's graveyard.
  // Countered abilities (CR 701.5a) simply cease to exist: no card moves.
  if (stackObject.type === "spell" && stackObject.sourceCardId) {
    const card = state.cards.get(stackObject.sourceCardId);

    if (card) {
      // Graveyards are keyed by the card's OWNER (CR 701.5b), even when
      // the spell is controlled by someone else. Fall back to the recorded
      // controller for legacy card instances lacking ownership data.
      const ownerId: PlayerId = card.ownerId || card.controllerId;
      const graveyardKey = `${ownerId}-graveyard`;
      const graveyardZone = state.zones.get(graveyardKey);
      const stackZone = state.zones.get("stack");

      if (graveyardZone) {
        const updatedZones = new Map(state.zones);

        // Remove the card from the shared stack zone (where castSpell
        // parks it while the spell awaits resolution).
        if (stackZone && stackZone.cardIds.includes(card.id)) {
          updatedZones.set("stack", {
            ...stackZone,
            cardIds: stackZone.cardIds.filter((id) => id !== card.id),
          });
        }

        updatedZones.set(graveyardKey, {
          ...graveyardZone,
          cardIds: [...graveyardZone.cardIds, card.id],
        });

        // Reset transient spell/permanent state on the way down, mirroring
        // the graveyard-move convention in moveCardToZone.
        const updatedCard: CardInstance = {
          ...card,
          isTapped: false,
          isFaceDown: false,
          attachedToId: null,
          attachedCardIds: [],
          damage: 0,
          counters: [],
          currentZoneKey: graveyardKey,
        };

        const updatedCards = new Map(state.cards);
        updatedCards.set(card.id, updatedCard);

        currentState = {
          ...currentState,
          zones: updatedZones,
          cards: updatedCards,
        };
      }
    }
  }

  return {
    success: true,
    state: {
      ...currentState,
      lastModifiedAt: Date.now(),
    },
    description: `Countered ${stackObject.name}`,
  };
}

