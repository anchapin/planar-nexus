/**
 * "Becomes the target" triggers (#2614 Surrak, Elusive Hunter):
 * "Whenever a creature you control or a creature spell you control becomes
 * the target of a spell or ability an opponent controls, ..." (CR 603.2,
 * 115.1). Fired when a spell or ability with card targets is put on the
 * stack (or gets its targets chosen there), once per targeted creature.
 */
import type { GameState, PlayerId, StackObject } from "../types";
import { isOnBattlefield } from "../types";
import { detectTriggeredAbilities } from "../abilities/triggered";
import { putTriggersOnStack } from "../trigger-system/stack-ops";

/** True for a creature permanent, or a creature card on the stack as a spell. */
function isTargetableCreature(state: GameState, cardId: string): boolean {
  const card = state.cards.get(cardId);
  if (!card) return false;
  if (!(card.cardData.type_line ?? "").toLowerCase().includes("creature")) {
    return false;
  }
  return (
    isOnBattlefield(state, cardId) ||
    state.stack.some((o) => o.sourceCardId === cardId && o.type === "spell")
  );
}

/** Put every "becomes the target" trigger raised by this stack object on the stack. */
export function fireTargetedTriggers(
  state: GameState,
  stackObject: Pick<StackObject, "targets" | "controllerId">,
): GameState {
  const targeter: PlayerId = stackObject.controllerId;
  const seen = new Set<string>();
  let s = state;
  for (const target of stackObject.targets ?? []) {
    if (target.type !== "card" || seen.has(target.targetId)) continue;
    seen.add(target.targetId);
    if (!isTargetableCreature(s, target.targetId)) continue;
    const triggers = detectTriggeredAbilities(s, "targeted", {
      targetedCardId: target.targetId,
      targetingPlayerId: targeter,
    });
    if (triggers.length > 0) s = putTriggersOnStack(s, triggers).state;
  }
  return s;
}
