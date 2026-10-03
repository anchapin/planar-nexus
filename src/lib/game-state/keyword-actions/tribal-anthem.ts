/**
 * "Other <Type>s you control get +N/+N" lord effects (issue #2300, found on
 * Stormscale Scion: "Other Dragons you control get +1/+1"). Storm already
 * copies a permanent spell into tokens; this makes the scion and its token
 * copies pump each other.
 *
 * A continuous effect from a static ability (CR 611.3), applied in layer 7c.
 * `getEffectivePower` only sees the card, so the summed bonus is kept on
 * `CardInstance.tribalAnthemPT` and refreshed with the state-based-action
 * pass, the same way threshold and domain values are.
 */
import type { CardInstance, GameState, PlayerId } from "../types";

export interface TribalAnthem {
  subtype: string;
  power: number;
  toughness: number;
}

const OTHER_TYPE_ANTHEM =
  /\b[Oo]ther ([A-Z][a-z]+) you control get \+(\d+)\/\+(\d+)\b/g;

const IRREGULAR_PLURALS: Record<string, string> = {
  elves: "Elf",
  wolves: "Wolf",
  dwarves: "Dwarf",
  werewolves: "Werewolf",
};

/** Singular creature type from its plural in rules text ("Dragons" -> "Dragon"). */
export function singularSubtype(plural: string): string {
  const irregular = IRREGULAR_PLURALS[plural.toLowerCase()];
  if (irregular) return irregular;
  return plural.endsWith("s") ? plural.slice(0, -1) : plural;
}

const SELF_PER_OTHER_TYPE =
  /\b[Tt]his creature gets \+(\d+)\/\+(\d+) for each other ([A-Z][a-z]+) you control\b/g;

/**
 * Every "This creature gets +N/+N for each other <Type> you control" clause
 * (issue #2428, Persistent Marshstalker). `subtype` is the counted type.
 */
export function parseSelfPerOtherType(oracleText: string): TribalAnthem[] {
  const out: TribalAnthem[] = [];
  for (const m of oracleText.matchAll(SELF_PER_OTHER_TYPE)) {
    if (m[3].toLowerCase() === "creature") continue;
    out.push({
      subtype: singularSubtype(m[3]),
      power: parseInt(m[1], 10),
      toughness: parseInt(m[2], 10),
    });
  }
  return out;
}

/** Every "Other <Type>s you control get +N/+N" clause in the text. */
export function parseOtherTypeAnthems(oracleText: string): TribalAnthem[] {
  const out: TribalAnthem[] = [];
  for (const m of oracleText.matchAll(OTHER_TYPE_ANTHEM)) {
    // "Other creatures" is a general anthem, not a creature type.
    if (m[1].toLowerCase() === "creatures") continue;
    out.push({
      subtype: singularSubtype(m[1]),
      power: parseInt(m[2], 10),
      toughness: parseInt(m[3], 10),
    });
  }
  return out;
}

function subtypesOf(card: CardInstance): string[] {
  const typeLine = card.cardData.type_line ?? "";
  const after = typeLine.split(/\s+[\u2014-]\s+/)[1] ?? "";
  return after.split(/\s+/).filter(Boolean);
}

function isCreature(card: CardInstance): boolean {
  return /\bCreature\b/.test(card.cardData.type_line ?? "");
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
 * Recompute `tribalAnthemPT` for every card. Returns the same state object
 * when nothing changed.
 */
export function refreshTribalAnthems(state: GameState): GameState {
  const onField = battlefieldCards(state);
  const sources: { card: CardInstance; anthems: TribalAnthem[] }[] = [];
  for (const card of onField) {
    const anthems = parseOtherTypeAnthems(card.cardData.oracle_text ?? "");
    if (anthems.length > 0) sources.push({ card, anthems });
  }

  const bonus = new Map<string, { power: number; toughness: number }>();
  for (const target of onField) {
    if (!isCreature(target)) continue;
    const types = subtypesOf(target);
    let power = 0;
    let toughness = 0;
    for (const { card, anthems } of sources) {
      if (card.id === target.id) continue;
      if (card.controllerId !== target.controllerId) continue;
      for (const a of anthems) {
        if (types.includes(a.subtype)) {
          power += a.power;
          toughness += a.toughness;
        }
      }
    }
    // "This creature gets +N/+N for each other <Type> you control."
    for (const self of parseSelfPerOtherType(
      target.cardData.oracle_text ?? "",
    )) {
      const count = onField.filter(
        (c) =>
          c.id !== target.id &&
          c.controllerId === target.controllerId &&
          isCreature(c) &&
          subtypesOf(c).includes(self.subtype),
      ).length;
      power += self.power * count;
      toughness += self.toughness * count;
    }
    if (power || toughness) bonus.set(target.id, { power, toughness });
  }

  let cards: GameState["cards"] | null = null;
  for (const [cardId, card] of state.cards) {
    const next = bonus.get(cardId);
    const prev = card.tribalAnthemPT;
    if (
      (prev?.power ?? 0) === (next?.power ?? 0) &&
      (prev?.toughness ?? 0) === (next?.toughness ?? 0)
    ) {
      continue;
    }
    cards ??= new Map(state.cards);
    const updated = { ...card };
    if (next) updated.tribalAnthemPT = next;
    else delete updated.tribalAnthemPT;
    cards.set(cardId, updated);
  }
  return cards ? { ...state, cards } : state;
}

export type { PlayerId };
