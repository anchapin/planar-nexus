/**
 * Sagas (CR 714, #2614 Summon: Esper Maduin).
 *
 * - As a Saga enters the battlefield, its controller puts a lore counter on
 *   it (CR 714.3a); after their draw step, at the start of the precombat
 *   main phase, they put one on each Saga they control (CR 714.3b).
 * - A chapter ability triggers when lore counters bring the count from
 *   below its chapter number to at least it (CR 714.2b).
 * - A Saga whose lore count is at least its final chapter number, with no
 *   chapter ability of it on the stack, is sacrificed (CR 714.4, an SBA).
 *
 * Chapter abilities come from card scripts (`event: "chapter"`).
 */
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
} from "../types";
import { detectTriggeredAbilities } from "../abilities/triggered";
import { putTriggersOnStack } from "../trigger-system/stack-ops";
import { getCardScript } from "../card-scripts/registry";

const ROMAN: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
};

export function isSaga(card: CardInstance): boolean {
  return /\bSaga\b/.test(card.cardData.type_line ?? "");
}

/** The final chapter number: from the script, else "Sacrifice after III." */
export function sagaFinalChapter(card: CardInstance): number {
  const chapters = (getCardScript(card.cardData.name)?.triggers ?? [])
    .map((t) => t.chapter ?? 0)
    .filter((n) => n > 0);
  if (chapters.length > 0) return Math.max(...chapters);
  const m = /sacrifice after (VI|IV|V|III|II|I)\b/i.exec(
    card.cardData.oracle_text ?? "",
  );
  return m ? ROMAN[m[1].toUpperCase()] : 0;
}

export function loreCount(card: CardInstance): number {
  return card.counters?.find((c) => c.type === "lore")?.count ?? 0;
}

/** Put `amount` lore counters on a Saga and its chapter abilities on the stack. */
export function addLoreCounters(
  state: GameState,
  sagaId: CardInstanceId,
  amount = 1,
): GameState {
  const card = state.cards.get(sagaId);
  if (!card || !isSaga(card) || amount <= 0) return state;
  const from = loreCount(card);
  const to = from + amount;
  const others = (card.counters ?? []).filter((c) => c.type !== "lore");
  const cards = new Map(state.cards);
  cards.set(sagaId, {
    ...card,
    counters: [...others, { type: "lore", count: to }],
  });
  const next: GameState = { ...state, cards };
  const triggers = detectTriggeredAbilities(next, "chapter", {
    sourceCardId: sagaId,
    loreFrom: from,
    loreTo: to,
  });
  return triggers.length > 0 ? putTriggersOnStack(next, triggers).state : next;
}

/** CR 714.3b: a lore counter on each Saga the active player controls. */
export function addPrecombatMainLoreCounters(
  state: GameState,
  playerId: PlayerId,
): GameState {
  const battlefield = state.zones.get(`${playerId}-battlefield`);
  if (!battlefield) return state;
  let next = state;
  for (const id of battlefield.cardIds) {
    const card = next.cards.get(id);
    if (card && card.controllerId === playerId && isSaga(card)) {
      next = addLoreCounters(next, id);
    }
  }
  return next;
}

/** CR 714.4: lore at or past the final chapter and no chapter ability on the stack. */
export function isFinishedSaga(state: GameState, card: CardInstance): boolean {
  if (!isSaga(card)) return false;
  const final = sagaFinalChapter(card);
  if (final <= 0 || loreCount(card) < final) return false;
  return !state.stack.some((o) => o.sourceCardId === card.id);
}
