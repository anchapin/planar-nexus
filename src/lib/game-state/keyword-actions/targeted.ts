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
import { getCardScript } from "../card-scripts/registry";

/**
 * CR 700.13: a player commits a crime when they target one or more
 * opponents, anything an opponent controls, or cards in an opponent's
 * graveyard (#2614 Magda, the Hoardmaster).
 */
function isCrime(
  state: GameState,
  targeter: PlayerId,
  targets: StackObject["targets"],
): boolean {
  for (const t of targets ?? []) {
    if (t.type === "player") {
      if (t.targetId !== targeter && state.players.has(t.targetId as PlayerId))
        return true;
      continue;
    }
    if (t.type !== "card") continue;
    const card = state.cards.get(t.targetId);
    if (!card) continue;
    const zone = card.currentZoneKey ?? "";
    if (zone.endsWith("-graveyard")) {
      if (card.ownerId !== targeter) return true;
    } else if (
      (zone.endsWith("-battlefield") || zone === "stack" || zone === "") &&
      card.controllerId !== targeter
    ) {
      // Permanents and spells an opponent controls. Cards in exile, hands
      // or libraries don't count (CR 700.13 names only graveyards).
      return true;
    }
  }
  return false;
}

/** True when a crime trigger on this card is limited to once each turn. */
function crimeOncePerTurn(state: GameState, cardId: string): boolean {
  const card = state.cards.get(cardId);
  return !!getCardScript(card?.cardData.name ?? "")?.triggers?.some(
    (t) => t.event === "crime" && t.once_per_turn,
  );
}

/** Put "whenever you commit a crime" triggers on the stack (CR 700.13). */
function fireCrimeTriggers(
  state: GameState,
  targeter: PlayerId,
  targets: StackObject["targets"],
): GameState {
  if (!isCrime(state, targeter, targets)) return state;
  const turn = state.turn.turnNumber;
  const triggers = detectTriggeredAbilities(state, "crime", {
    targetingPlayerId: targeter,
  }).filter(
    (t) =>
      !crimeOncePerTurn(state, t.sourceCardId) ||
      state.cards.get(t.sourceCardId)?.crimeTriggerTurn !== turn,
  );
  if (triggers.length === 0) return state;
  const cards = new Map(state.cards);
  for (const t of triggers) {
    const c = cards.get(t.sourceCardId);
    if (c && crimeOncePerTurn(state, t.sourceCardId))
      cards.set(t.sourceCardId, { ...c, crimeTriggerTurn: turn });
  }
  return putTriggersOnStack({ ...state, cards }, triggers).state;
}

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
  return fireCrimeTriggers(s, targeter, stackObject.targets);
}
