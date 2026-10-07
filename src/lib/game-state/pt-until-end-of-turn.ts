/**
 * "Target creature gets +X/+Y until end of turn" from triggered and
 * activated abilities (CR 611.2a, layer 7c; issue #2300).
 *
 * The effect is parsed from the ability text, applied to the chosen target
 * on resolution, and cleared at end of turn. A trailing "If <condition>,
 * that creature gets +X/+Y until end of turn instead." sentence (Tragic
 * Banshee's morbid clause) is checked on resolution, not when the ability
 * triggers.
 */
import type { GameState, CardInstanceId } from "./types";

export interface PTUntilEndOfTurn {
  power: number;
  toughness: number;
  /** "If <condition>, ... instead": the alternative used when it holds. */
  instead?: { condition: string; power: number; toughness: number };
}

// "+X/+X" (Primal Might, issue #2451) takes X from the spell as cast.
const SIGNED = "([+-](?:\\d+|x))\\/([+-](?:\\d+|x))";
const TARGETED = new RegExp(
  `\\btarget creature\\b[^.]*?\\bgets ${SIGNED} until end of turn\\b`,
);
const INSTEAD = new RegExp(
  `\\bif ([^,.]+), (?:that creature|it) gets ${SIGNED} until end of turn instead\\b`,
);

/**
 * The targeted until-end-of-turn P/T change in an ability's text, or null.
 * Counter placement ("put a -1/-1 counter") is not this effect.
 */
export function parseTargetedPTUntilEndOfTurn(
  text: string,
  x = 0,
): PTUntilEndOfTurn | null {
  const lower = text.toLowerCase();
  const m = TARGETED.exec(lower);
  if (!m) return null;
  const num = (v: string) =>
    v.endsWith("x") ? (v.startsWith("-") ? -x : x) : Number(v);
  const result: PTUntilEndOfTurn = {
    power: num(m[1]),
    toughness: num(m[2]),
  };
  const alt = INSTEAD.exec(lower);
  if (alt) {
    result.instead = {
      condition: alt[1].trim(),
      power: num(alt[2]),
      toughness: num(alt[3]),
    };
  }
  return result;
}

/** Add an until-end-of-turn P/T change to a card. */
export function addUntilEndOfTurnPT(
  state: GameState,
  cardId: CardInstanceId,
  power: number,
  toughness: number,
): GameState {
  const card = state.cards.get(cardId);
  if (!card) return state;
  const prev = card.untilEndOfTurnPT ?? { power: 0, toughness: 0 };
  const cards = new Map(state.cards);
  cards.set(cardId, {
    ...card,
    untilEndOfTurnPT: {
      power: prev.power + power,
      toughness: prev.toughness + toughness,
    },
  });
  return { ...state, cards };
}

/** Grant a keyword to a card until end of turn (#2567). */
export function addUntilEndOfTurnKeyword(
  state: GameState,
  cardId: CardInstanceId,
  keyword: string,
): GameState {
  const card = state.cards.get(cardId);
  if (!card) return state;
  const k = keyword.toLowerCase();
  const prev = card.untilEndOfTurnKeywords ?? [];
  if (prev.includes(k)) return state;
  const cards = new Map(state.cards);
  cards.set(cardId, { ...card, untilEndOfTurnKeywords: [...prev, k] });
  return { ...state, cards };
}

/**
 * End-of-turn cleanup: drop every until-end-of-turn P/T change and keyword
 * grant (CR 514.2).
 */
export function clearUntilEndOfTurnPT(state: GameState): GameState {
  let cards: GameState["cards"] | null = null;
  for (const [id, card] of state.cards) {
    if (!card.untilEndOfTurnPT && !card.untilEndOfTurnKeywords) continue;
    cards ??= new Map(state.cards);
    cards.set(id, {
      ...card,
      untilEndOfTurnPT: undefined,
      untilEndOfTurnKeywords: undefined,
    });
  }
  return cards ? { ...state, cards } : state;
}
