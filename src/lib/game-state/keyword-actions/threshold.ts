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

/**
 * The oracle text of the card's current face. Adventure and prepare cards
 * (Most Decrepit Old Bird, Theorix Metamage, Void Extrapolator) carry no
 * top-level oracle_text; their creature text lives on `card_faces`.
 */
export function cardOracleText(card: CardInstance): string {
  if (card.cardData.oracle_text) return card.cardData.oracle_text;
  const faces = card.cardData.card_faces;
  if (!faces || faces.length === 0) return "";
  const face = faces[Math.min(card.currentFaceIndex ?? 0, faces.length - 1)];
  return face?.oracle_text ?? "";
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
  const text = cardOracleText(card);
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

const SIGNED = "([+-]\\d+)";
const OPPONENT_ANTHEM = new RegExp(
  `\\bcreatures your opponents control get ${SIGNED}\\/${SIGNED}\\b`,
);

/**
 * The power/toughness change a threshold static ability gives creatures
 * the card's opponents control (Mindwhisker: "As long as there are seven or
 * more cards in your graveyard, creatures your opponents control get
 * -1/-0."), or null.
 */
export function parseThresholdOpponentAnthem(
  oracleText: string | undefined,
): { power: number; toughness: number } | null {
  const clause = getThresholdClause(oracleText);
  if (!clause || !STATIC_CONDITION.test(clause)) return null;
  if (/^(when|whenever|at)\b/.test(clause) || clause.includes(":")) return null;
  const m = OPPONENT_ANTHEM.exec(clause);
  if (!m) return null;
  // `|| 0` turns "-0" into 0.
  return { power: Number(m[1]) || 0, toughness: Number(m[2]) || 0 };
}

function isCreature(card: CardInstance): boolean {
  return /\bcreature\b/i.test(card.cardData.type_line ?? "");
}

function battlefieldCards(state: GameState): CardInstance[] {
  const out: CardInstance[] = [];
  for (const playerId of state.players.keys()) {
    const zone = state.zones.get(`${playerId}-battlefield`);
    for (const id of zone?.cardIds ?? []) {
      const card = state.cards.get(id);
      if (card) out.push(card);
    }
  }
  return out;
}

/**
 * Set or clear `thresholdBonus` on every battlefield creature with a
 * threshold static ability, and `thresholdAnthemPT` on creatures affected
 * by an opponent's active threshold anthem, based on each controller's
 * graveyard. Returns the same state object when nothing changed.
 */
export function refreshThresholdBonuses(state: GameState): GameState {
  let cards: Map<CardInstanceId, CardInstance> | null = null;
  const onBattlefield = battlefieldCards(state);

  // Active anthems, summed per controller of the threshold card.
  const anthemByController = new Map<
    PlayerId,
    { power: number; toughness: number }
  >();
  for (const card of onBattlefield) {
    const anthem = parseThresholdOpponentAnthem(cardOracleText(card));
    if (!anthem || !hasThreshold(state, card.controllerId)) continue;
    const prev = anthemByController.get(card.controllerId) ?? {
      power: 0,
      toughness: 0,
    };
    anthemByController.set(card.controllerId, {
      power: prev.power + anthem.power,
      toughness: prev.toughness + anthem.toughness,
    });
  }

  for (const card of onBattlefield) {
    const parsed = parseThresholdStatic(cardOracleText(card));
    const nextBonus =
      parsed && hasThreshold(state, card.controllerId) ? parsed : undefined;

    let nextAnthem: { power: number; toughness: number } | undefined;
    if (isCreature(card)) {
      for (const [controllerId, pt] of anthemByController) {
        if (controllerId === card.controllerId) continue;
        nextAnthem = {
          power: (nextAnthem?.power ?? 0) + pt.power,
          toughness: (nextAnthem?.toughness ?? 0) + pt.toughness,
        };
      }
    }

    const bonusSame = sameBonus(card.thresholdBonus, nextBonus);
    const anthemSame =
      card.thresholdAnthemPT?.power === nextAnthem?.power &&
      card.thresholdAnthemPT?.toughness === nextAnthem?.toughness;
    if (bonusSame && anthemSame) continue;
    cards ??= new Map(state.cards);
    cards.set(card.id, {
      ...card,
      thresholdBonus: nextBonus,
      thresholdAnthemPT: nextAnthem,
    });
  }
  return cards ? { ...state, cards } : state;
}

/**
 * The condition in an activated ability's "Activate only if <condition>"
 * clause (CR 602.5b), lowercased, or null. The activated-ability parser
 * drops this sentence, so it is read back from the ability's oracle line,
 * matched by the start of its effect text. "and only once" is stripped;
 * that once-per-game limit is not tracked yet.
 */
export function getActivationCondition(
  card: CardInstance,
  effect: string,
): string | null {
  const key = effect.toLowerCase().slice(0, 24);
  if (!key) return null;
  for (const raw of cardOracleText(card).split("\n")) {
    const line = raw.trim().toLowerCase();
    if (!line.includes(":") || !line.includes(key)) continue;
    const m = /\bactivate only if (.+?)(?:\s+and only once)?\.?\s*$/.exec(line);
    return m ? m[1] : null;
  }
  return null;
}

/** "This creature can't be blocked" from threshold being active. */
export function isThresholdUnblockable(card: CardInstance): boolean {
  return Boolean(card.thresholdBonus?.unblockable);
}
