/**
 * Affinity for <subtype> (CR 702.41, #2614 Sapling Nursery): "This spell
 * costs {1} less to cast for each <subtype> you control." Only generic
 * mana is reduced (CR 702.41a, 601.2f).
 */
import type { CardInstance, GameState, PlayerId } from "../types";
import { getCardScript } from "../card-scripts/registry";

/** True when the card's type line lists `subtype` after the dash. */
/**
 * Subtypes that belong to other card types (CR 205.3g-k), which "all
 * creature types" doesn't grant. Not exhaustive: the land, artifact and
 * enchantment subtypes the engine's cards check.
 */
const NONCREATURE_SUBTYPES = new Set([
  "plains",
  "island",
  "swamp",
  "mountain",
  "forest",
  "desert",
  "gate",
  "cave",
  "town",
  "equipment",
  "vehicle",
  "treasure",
  "food",
  "clue",
  "aura",
  "saga",
  "class",
  "room",
  "shrine",
  "case",
  "background",
]);

export function hasSubtype(card: CardInstance, subtype: string): boolean {
  // "All creature types" (#2614 Soulstone Sanctuary, CR 205.3m).
  if (
    card.animatedUntilEndOfTurn?.allCreatureTypes &&
    !NONCREATURE_SUBTYPES.has(subtype.toLowerCase())
  )
    return true;
  const want = subtype.toLowerCase();
  if (card.untilEndOfTurnSubtypes?.some((t) => t.toLowerCase() === want))
    return true;
  const typeLine = card.cardData.type_line || "";
  const front = typeLine.split(" // ")[0];
  const parts = front.split(/\s+[—-]\s+/);
  if (parts.length < 2) return false;
  return parts[1].split(/\s+/).some((w) => w.toLowerCase() === want);
}

/** Generic mana an affinity card saves for `playerId` right now. */
export function affinityReduction(
  state: GameState,
  playerId: PlayerId,
  cardName: string,
): number {
  const affinity = getCardScript(cardName)?.affinity;
  if (!affinity) return 0;
  const battlefield = state.zones.get(`${playerId}-battlefield`);
  if (!battlefield) return 0;
  let count = 0;
  for (const id of battlefield.cardIds) {
    const card = state.cards.get(id);
    if (
      card &&
      card.controllerId === playerId &&
      hasSubtype(card, affinity.subtype)
    ) {
      count++;
    }
  }
  return count;
}
