/**
 * Static power/toughness and keyword bonuses that scripted Equipment grant
 * the creature they are attached to (issue #2561). Mirrors
 * `refreshAuraBonuses`: layer 6 (keywords) and layer 7c (P/T) per CR 613.3.
 *
 * The summed bonus is stored on `CardInstance.equipmentPT` and
 * `CardInstance.equipmentKeywords`, refreshed with the state-based-action
 * pass alongside Auras. Kept separate from `auraPT` so an "Enchantments
 * lose all abilities" effect can drop Auras without dropping the
 * Equipment.
 */
import type { CardInstance, GameState } from "../types";
import { getCardScript } from "../card-scripts/registry";

function isEquipment(card: CardInstance): boolean {
  return (card.cardData.type_line ?? "").toLowerCase().includes("equipment");
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
 * Recompute `equipmentPT` and `equipmentKeywords` for every card from the
 * scripted Equipment attached to it. Returns the same state object when
 * nothing changed.
 */
export function refreshEquipmentBonuses(state: GameState): GameState {
  const onField = battlefieldCards(state);
  const onFieldIds = new Set(onField.map((c) => c.id));
  const bonus = new Map<string, { power: number; toughness: number }>();
  const keywords = new Map<string, string[]>();

  for (const eq of onField) {
    if (!isEquipment(eq)) continue;
    const target = eq.attachedToId;
    if (!target || !onFieldIds.has(target)) continue;
    const script = getCardScript(eq.cardData.name);
    const stat = script?.equipment?.attachedStatic;
    if (!stat) continue;
    if (stat.power !== undefined || stat.toughness !== undefined) {
      const prev = bonus.get(target) ?? { power: 0, toughness: 0 };
      prev.power += stat.power ?? 0;
      prev.toughness += stat.toughness ?? 0;
      bonus.set(target, prev);
    }
    if (stat.keywords && stat.keywords.length > 0) {
      const kws = keywords.get(target) ?? [];
      for (const k of stat.keywords) {
        const norm = k.toLowerCase();
        if (!kws.includes(norm)) kws.push(norm);
      }
      keywords.set(target, kws);
    }
  }

  let cards: GameState["cards"] | null = null;
  for (const [cardId, card] of state.cards) {
    const next = bonus.get(cardId);
    const was = card.equipmentPT;
    const nextKw = keywords.get(cardId) ?? [];
    const wasKw = card.equipmentKeywords ?? [];
    if (
      (was?.power ?? 0) === (next?.power ?? 0) &&
      (was?.toughness ?? 0) === (next?.toughness ?? 0) &&
      nextKw.join("|") === wasKw.join("|")
    ) {
      continue;
    }
    cards ??= new Map(state.cards);
    const updated = { ...card };
    if (next && (next.power || next.toughness)) updated.equipmentPT = next;
    else delete updated.equipmentPT;
    if (nextKw.length > 0) updated.equipmentKeywords = nextKw;
    else delete updated.equipmentKeywords;
    cards.set(cardId, updated);
  }
  return cards ? { ...state, cards } : state;
}
