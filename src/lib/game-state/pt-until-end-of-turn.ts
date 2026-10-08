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

/**
 * Marker kept in `untilEndOfTurnKeywords` for "can't be blocked this turn"
 * (#2614). Not a keyword (CR 702), but it shares the keyword buffer so the
 * cleanup step clears it with the rest.
 */
export const CANT_BE_BLOCKED = "can't be blocked";

/** True when `card` can't be blocked this turn (#2614). */
export function cantBeBlockedThisTurn(card: {
  untilEndOfTurnKeywords?: string[];
}): boolean {
  return Boolean(card.untilEndOfTurnKeywords?.includes(CANT_BE_BLOCKED));
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
    if (
      !card.untilEndOfTurnPT &&
      !card.untilEndOfTurnKeywords &&
      !card.animatedUntilEndOfTurn
    )
      continue;
    cards ??= new Map(state.cards);
    const updated = {
      ...card,
      untilEndOfTurnPT: undefined,
      untilEndOfTurnKeywords: undefined,
    };
    if (card.animatedUntilEndOfTurn) {
      updated.cardData = card.animatedUntilEndOfTurn.cardData;
      delete updated.animatedUntilEndOfTurn;
    }
    cards.set(id, updated);
  }
  return cards ? { ...state, cards } : state;
}

/**
 * "This land becomes a P/T creature until end of turn" (#2614 Soulstone
 * Sanctuary, CR 611.2a). The printed card data is kept so end of turn, or
 * leaving the battlefield, restores it; a second activation the same turn
 * resets base P/T from the printed card, not the animated one.
 */
export function animateUntilEndOfTurn(
  state: GameState,
  cardId: CardInstanceId,
  opts: { power: number; toughness: number; allCreatureTypes: boolean },
): GameState {
  const card = state.cards.get(cardId);
  if (!card) return state;
  const printed = card.animatedUntilEndOfTurn?.cardData ?? card.cardData;
  const [types, subtypes] = (printed.type_line ?? "").split(/\s+[\u2014-]\s+/);
  const typeLine = /\bCreature\b/.test(types ?? "")
    ? (printed.type_line ?? "")
    : `${types} Creature${subtypes ? ` \u2014 ${subtypes}` : ""}`;
  const cards = new Map(state.cards);
  cards.set(cardId, {
    ...card,
    cardData: {
      ...printed,
      type_line: typeLine,
      power: String(opts.power),
      toughness: String(opts.toughness),
    },
    animatedUntilEndOfTurn: {
      cardData: printed,
      ...(opts.allCreatureTypes ? { allCreatureTypes: true } : {}),
    },
  });
  return { ...state, cards };
}

/**
 * An animated permanent that left the battlefield is a new object with its
 * printed characteristics (CR 400.7): restore them. Returns the same state
 * when nothing changed.
 */
export function restoreAnimatedOffBattlefield(state: GameState): GameState {
  let cards: GameState["cards"] | null = null;
  for (const [id, card] of state.cards) {
    if (!card.animatedUntilEndOfTurn) continue;
    if (card.currentZoneKey?.endsWith("-battlefield")) continue;
    cards ??= new Map(state.cards);
    const updated = { ...card, cardData: card.animatedUntilEndOfTurn.cardData };
    delete updated.animatedUntilEndOfTurn;
    cards.set(id, updated);
  }
  return cards ? { ...state, cards } : state;
}

/**
 * Append keywords to a card's until-end-of-turn keyword list (CR 611.2a,
 * layer 6, #2564). Used by the scripted `Pump` op when its `keywords`
 * field is set (e.g. Divine Resilience's lifelink). The layer-6 keyword
 * read path (`evergreen-keywords.hasKeyword`) unions these onto the card's
 * keyword set until end of turn; `clearUntilEndOfTurnKeywords` drops them.
 */
export function addUntilEndOfTurnKeywords(
  state: GameState,
  cardId: CardInstanceId,
  keywords: readonly string[],
): GameState {
  if (keywords.length === 0) return state;
  const card = state.cards.get(cardId);
  if (!card) return state;
  const lower = keywords.map((k) => k.toLowerCase());
  const prev = card.untilEndOfTurnKeywords ?? [];
  const merged = Array.from(new Set([...prev, ...lower]));
  const cards = new Map(state.cards);
  cards.set(cardId, { ...card, untilEndOfTurnKeywords: merged });
  return { ...state, cards };
}

/** End-of-turn cleanup: drop every until-end-of-turn keyword grant. */
export function clearUntilEndOfTurnKeywords(state: GameState): GameState {
  let cards: GameState["cards"] | null = null;
  for (const [id, card] of state.cards) {
    if (!card.untilEndOfTurnKeywords) continue;
    cards ??= new Map(state.cards);
    cards.set(id, { ...card, untilEndOfTurnKeywords: undefined });
  }
  return cards ? { ...state, cards } : state;
}
