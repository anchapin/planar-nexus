/**
 * Threshold ability word (issue #2300, Standard remainder slice).
 *
 * "Threshold — ... as long as there are seven or more cards in your
 * graveyard". This module covers the static form on the creature itself:
 * a power/toughness bonus, granted keywords (flying, deathtouch, ...) and
 * "can't be blocked". Threshold intervening-if triggers are handled by
 * `evaluateInterveningIfClause`.
 *
 * Power/toughness reads don't take the game state, so the active bonus is
 * stored on the card (`thresholdBonus`) and refreshed by
 * `refreshThresholdBonuses`, which state-based action checks call.
 */
import type {
  GameState,
  PlayerId,
  CardInstance,
  CardInstanceId,
} from "../types";

export const THRESHOLD_GRAVEYARD_COUNT = 7;

export interface ThresholdBonus {
  power: number;
  toughness: number;
  /** Lowercase keyword names granted while threshold is active. */
  keywords: string[];
  unblockable: boolean;
}

export function graveyardCount(state: GameState, playerId: PlayerId): number {
  return state.zones.get(`${playerId}-graveyard`)?.cardIds.length ?? 0;
}

export function hasThreshold(state: GameState, playerId: PlayerId): boolean {
  return graveyardCount(state, playerId) >= THRESHOLD_GRAVEYARD_COUNT;
}

/** The text after "Threshold —" on its line, lowercased, or null. */
export function getThresholdClause(
  oracleText: string | undefined,
): string | null {
  if (!oracleText) return null;
  for (const line of oracleText.split("\n")) {
    const m = /^threshold\s*[—–-]\s*(.+)$/i.exec(line.trim());
    if (m) return m[1].toLowerCase();
  }
  return null;
}

const STATIC_CONDITION =
  /\bas long as there are seven or more cards in your graveyard\b/;

/**
 * The bonus a threshold static ability gives the creature itself, or null
 * when the card has no such ability (triggers, activated abilities, cast
 * restrictions and effects on other creatures are not static self-bonuses).
 */
export function parseThresholdStatic(
  oracleText: string | undefined,
): ThresholdBonus | null {
  const clause = getThresholdClause(oracleText);
  if (!clause || !STATIC_CONDITION.test(clause)) return null;
  if (/^(when|whenever|at)\b/.test(clause) || clause.includes(":")) return null;
  if (!/\bthis creature\b/.test(clause)) return null;

  const pt = /\bgets \+(\d+)\/\+(\d+)/.exec(clause);
  const body = clause.replace(STATIC_CONDITION, "").replace(/[.,]+\s*$/, "");
  const keywords: string[] = [];
  const has = /\bhas ([a-z ,]+?)(?:\s*$|\s*,?\s*and can't|\.)/.exec(body);
  if (has) {
    for (const k of has[1].split(/,|\band\b/)) {
      const kw = k.trim();
      if (kw) keywords.push(kw);
    }
  }
  const unblockable = /\bcan't be blocked\b/.test(clause);
  if (!pt && keywords.length === 0 && !unblockable) return null;
  return {
    power: pt ? Number(pt[1]) : 0,
    toughness: pt ? Number(pt[2]) : 0,
    keywords,
    unblockable,
  };
}

/**
 * True when `keyword` appears in the card's text only inside its threshold
 * clause, so it must not count unless threshold is active.
 */
export function isThresholdOnlyKeyword(
  card: CardInstance,
  keyword: string,
): boolean {
  const text = card.cardData.oracle_text ?? "";
  const clause = getThresholdClause(text);
  const kw = keyword.toLowerCase();
  if (!clause || !clause.includes(kw)) return false;
  const rest = text
    .split("\n")
    .filter((l) => !/^threshold\s*[—–-]/i.test(l.trim()))
    .join("\n")
    .toLowerCase();
  const own = (card.cardData.keywords ?? []).some(
    (k) => k.toLowerCase() === kw,
  );
  return !own && !rest.includes(kw);
}

function sameBonus(a?: ThresholdBonus, b?: ThresholdBonus): boolean {
  if (!a || !b) return a === b;
  return (
    a.power === b.power &&
    a.toughness === b.toughness &&
    a.unblockable === b.unblockable &&
    a.keywords.join(",") === b.keywords.join(",")
  );
}

/**
 * Set or clear `thresholdBonus` on every battlefield creature with a
 * threshold static ability, based on its controller's graveyard. Returns the
 * same state object when nothing changed.
 */
export function refreshThresholdBonuses(state: GameState): GameState {
  let cards: Map<CardInstanceId, CardInstance> | null = null;
  for (const playerId of state.players.keys()) {
    const zone = state.zones.get(`${playerId}-battlefield`);
    for (const id of zone?.cardIds ?? []) {
      const card = state.cards.get(id);
      if (!card) continue;
      const parsed = parseThresholdStatic(card.cardData.oracle_text);
      if (!parsed && !card.thresholdBonus) continue;
      const next =
        parsed && hasThreshold(state, card.controllerId) ? parsed : undefined;
      if (sameBonus(card.thresholdBonus, next)) continue;
      cards ??= new Map(state.cards);
      cards.set(id, { ...card, thresholdBonus: next });
    }
  }
  return cards ? { ...state, cards } : state;
}

/** "This creature can't be blocked" from threshold being active. */
export function isThresholdUnblockable(card: CardInstance): boolean {
  return Boolean(card.thresholdBonus?.unblockable);
}
