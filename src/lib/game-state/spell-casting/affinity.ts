/**
 * Affinity for <subtype> (CR 702.41, #2614 Sapling Nursery): "This spell
 * costs {1} less to cast for each <subtype> you control." Only generic
 * mana is reduced (CR 702.41a, 601.2f).
 */
import type { CardInstance, GameState, PlayerId } from "../types";
import { getCardScript } from "../card-scripts/registry";

/** True when the card's type line lists `subtype` after the dash. */
export function hasSubtype(card: CardInstance, subtype: string): boolean {
  const typeLine = card.cardData.type_line || "";
  const front = typeLine.split(" // ")[0];
  const parts = front.split(/\s+[—-]\s+/);
  if (parts.length < 2) return false;
  const want = subtype.toLowerCase();
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
