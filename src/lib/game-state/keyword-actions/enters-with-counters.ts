/**
 * "Enters with +1/+1 counters" (CR 614.1c, issue #2300).
 *
 * A permanent that "enters with N +1/+1 counters on it" is a replacement
 * effect: the counters are already there as it enters, before any ETB
 * trigger looks at it. Covers the fixed-count wording, X, raid's
 * "If you attacked this turn, ... enters with" and converge's
 * "for each color of mana spent to cast it".
 *
 * Only self-referential wording is handled ("this creature", "it", or the
 * card's own name). Other conditional forms ("if it was kicked", ...) are
 * left alone rather than guessed at.
 */
import type { GameState, CardInstanceId } from "../types";
import { addCounters } from "../card-instance";
import { hasAttackedThisTurn } from "./raid";

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const ENTERS_WITH =
  /\benters(?: the battlefield)? with (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) \+1\/\+1 counters? on it( for each color of mana spent to cast it)?/i;

const RAID_CONDITION = /^if you attacked this turn,\s*/i;
const ABILITY_WORD = /^[a-z][a-z ]*\s+[\u2014-]\s*/i;

export interface EntersWithContext {
  /** Distinct colors of mana spent to cast it (StackObject.colorsSpent). */
  colorsSpent?: number;
  /** The X chosen when it was cast. */
  xValue?: number | null;
}

function isSelfSubject(subject: string, name: string): boolean {
  const s = subject.trim().toLowerCase();
  if (
    s === "" ||
    s === "it" ||
    /^this (?:creature|permanent|artifact|vehicle|land)$/.test(s)
  ) {
    return true;
  }
  const n = name.toLowerCase();
  if (s === n) return true;
  // Legendary short names ("Anim Pakal" for "Anim Pakal, Thousandth Moon").
  const short = n.split(",")[0].trim();
  return short.length > 0 && s === short;
}

/**
 * How many +1/+1 counters the card enters with, given how it entered.
 * Returns 0 when its text has no matching clause or its condition fails.
 */
export function entersWithCountersCount(
  state: GameState,
  cardId: CardInstanceId,
  ctx: EntersWithContext = {},
): number {
  const card = state.cards.get(cardId);
  if (!card) return 0;
  const oracle = card.cardData.oracle_text ?? "";
  const name = card.cardData.name ?? "";
  let total = 0;
  for (const sentence of oracle.split(/\n|(?<=\.)\s+/)) {
    const match = ENTERS_WITH.exec(sentence);
    if (!match) continue;
    let subject = sentence.slice(0, match.index).replace(ABILITY_WORD, "");
    if (RAID_CONDITION.test(subject)) {
      if (!hasAttackedThisTurn(state, card.controllerId)) continue;
      subject = subject.replace(RAID_CONDITION, "");
    }
    if (!isSelfSubject(subject, name)) continue;
    // Trailing condition: "... on it if you attacked this turn." (raid).
    // Any other trailing "if" is unsupported, so skip it.
    const rest = sentence.slice(match.index + match[0].length);
    if (/^\s*if you attacked this turn\b/i.test(rest)) {
      if (!hasAttackedThisTurn(state, card.controllerId)) continue;
    } else if (/^\s*(?:if|unless)\b/i.test(rest)) {
      continue;
    }
    const word = match[1].toLowerCase();
    let count =
      word === "x"
        ? Math.max(0, ctx.xValue ?? 0)
        : (NUMBER_WORDS[word] ?? Number(word));
    if (match[2]) count *= Math.max(0, ctx.colorsSpent ?? 0);
    if (Number.isFinite(count) && count > 0) total += count;
  }
  return total;
}

/** Put the card's "enters with" +1/+1 counters on it. */
export function applyEntersWithCounters(
  state: GameState,
  cardId: CardInstanceId,
  ctx: EntersWithContext = {},
): GameState {
  const count = entersWithCountersCount(state, cardId, ctx);
  if (count <= 0) return state;
  const card = state.cards.get(cardId)!;
  const cards = new Map(state.cards);
  cards.set(cardId, addCounters(card, "+1/+1", count));
  return { ...state, cards };
}
