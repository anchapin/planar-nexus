/**
 * Static power/toughness bonuses that Auras grant the creature they enchant
 * (CR 303.4, CR 613.4c), e.g. Ethereal Armor: "Enchanted creature gets +1/+1
 * for each enchantment you control" (issue #2453).
 *
 * The summed bonus is stored on `CardInstance.auraPT` and refreshed with the
 * state-based-action pass, like the threshold and tribal anthem statics.
 */
import type { CardInstance, GameState } from "../types";

export interface AuraPT {
  power: number;
  toughness: number;
  /** "for each enchantment you control": multiply by that count. */
  perEnchantment: boolean;
}

const AURA_PT =
  /\b[Ee]nchanted creature gets ([+-]\d+)\/([+-]\d+)( for each enchantment you control)?/g;

/** Every "Enchanted creature gets +N/+N [for each enchantment you control]" clause. */
export function parseAuraPT(oracleText: string): AuraPT[] {
  const out: AuraPT[] = [];
  for (const m of oracleText.matchAll(AURA_PT)) {
    out.push({
      power: parseInt(m[1], 10),
      toughness: parseInt(m[2], 10),
      perEnchantment: Boolean(m[3]),
    });
  }
  return out;
}

/**
 * Keywords an Aura grants: "Enchanted creature ... has first strike"
 * (Ethereal Armor, issue #2464). Only evergreen keywords are kept.
 */
const GRANTABLE = [
  "first strike",
  "double strike",
  "flying",
  "vigilance",
  "trample",
  "lifelink",
  "deathtouch",
  "haste",
  "menace",
  "reach",
  "hexproof",
  "indestructible",
];
const AURA_HAS = /\b[Ee]nchanted creature (?:gets [^.]*? and )?has ([^.]+)\./g;

export function parseAuraKeywords(oracleText: string): string[] {
  const out: string[] = [];
  for (const m of oracleText.matchAll(AURA_HAS)) {
    for (const part of m[1].toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/)) {
      const kw = part.trim();
      if (GRANTABLE.includes(kw) && !out.includes(kw)) out.push(kw);
    }
  }
  return out;
}

function isEnchantment(card: CardInstance): boolean {
  return /\bEnchantment\b/.test(card.cardData.type_line ?? "");
}

function battlefieldCards(state: GameState): CardInstance[] {
  const out: CardInstance[] = [];
  for (const [key, zone] of state.zones) {
    if (!key.endsWith("-battlefield")) continue;
    for (const id of zone.cardIds) {
      const card = state.cards.get(id);
      if (card) out.push(card);
    }
  }
  return out;
}

/**
 * Recompute `auraPT` for every card from the Auras attached to it. "You" in
 * the Aura's text is the Aura's controller. Returns the same state object
 * when nothing changed.
 */
export function refreshAuraBonuses(state: GameState): GameState {
  const onField = battlefieldCards(state);
  const onFieldIds = new Set(onField.map((c) => c.id));
  const bonus = new Map<string, { power: number; toughness: number }>();
  const keywords = new Map<string, string[]>();

  for (const aura of onField) {
    const target = aura.attachedToId;
    if (!target || !onFieldIds.has(target)) continue;
    const text = aura.cardData.oracle_text ?? "";
    const granted = parseAuraKeywords(text);
    if (granted.length > 0) {
      const kws = keywords.get(target) ?? [];
      for (const k of granted) if (!kws.includes(k)) kws.push(k);
      keywords.set(target, kws);
    }
    const clauses = parseAuraPT(text);
    if (clauses.length === 0) continue;
    const enchantments = onField.filter(
      (c) => c.controllerId === aura.controllerId && isEnchantment(c),
    ).length;
    const prev = bonus.get(target) ?? { power: 0, toughness: 0 };
    for (const c of clauses) {
      const n = c.perEnchantment ? enchantments : 1;
      prev.power += c.power * n;
      prev.toughness += c.toughness * n;
    }
    bonus.set(target, prev);
  }

  let cards: GameState["cards"] | null = null;
  for (const [cardId, card] of state.cards) {
    const next = bonus.get(cardId);
    const was = card.auraPT;
    const nextKw = keywords.get(cardId) ?? [];
    const wasKw = card.auraKeywords ?? [];
    if (
      (was?.power ?? 0) === (next?.power ?? 0) &&
      (was?.toughness ?? 0) === (next?.toughness ?? 0) &&
      nextKw.join("|") === wasKw.join("|")
    ) {
      continue;
    }
    cards ??= new Map(state.cards);
    const updated = { ...card };
    if (next && (next.power || next.toughness)) updated.auraPT = next;
    else delete updated.auraPT;
    if (nextKw.length > 0) updated.auraKeywords = nextKw;
    else delete updated.auraKeywords;
    cards.set(cardId, updated);
  }
  return cards ? { ...state, cards } : state;
}
