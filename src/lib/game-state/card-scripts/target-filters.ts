import type { CardInstance } from "../types";
import { getPower, isCreature } from "../card-instance";

/** What a scripted Destroy or Exile may target (#2528). */
export const REMOVAL_TARGETS = [
  "creature",
  "artifact",
  "enchantment",
  "artifact_or_enchantment",
  "nonland_permanent",
] as const;
export type RemovalTarget = (typeof REMOVAL_TARGETS)[number];

/**
 * A removal target plus optional power bounds ("creature with power 4 or
 * greater"). Power bounds only match creatures.
 */
export interface RemovalFilter {
  target: RemovalTarget;
  min_power?: number;
  max_power?: number;
}

function hasType(card: CardInstance, type: string): boolean {
  const line = (card.cardData.type_line ?? "").split("//")[0];
  return new RegExp(`\\b${type}\\b`, "i").test(line);
}

/** True when the permanent `card` is a legal target for `filter`. */
export function matchesRemovalFilter(
  card: CardInstance,
  filter: RemovalFilter,
): boolean {
  let typeOk: boolean;
  switch (filter.target) {
    case "creature":
      typeOk = isCreature(card);
      break;
    case "artifact":
      typeOk = hasType(card, "Artifact");
      break;
    case "enchantment":
      typeOk = hasType(card, "Enchantment");
      break;
    case "artifact_or_enchantment":
      typeOk = hasType(card, "Artifact") || hasType(card, "Enchantment");
      break;
    case "nonland_permanent":
      typeOk = !hasType(card, "Land");
      break;
  }
  if (!typeOk) return false;
  if (filter.min_power === undefined && filter.max_power === undefined)
    return true;
  if (!isCreature(card)) return false;
  const power = getPower(card);
  return (
    (filter.min_power === undefined || power >= filter.min_power) &&
    (filter.max_power === undefined || power <= filter.max_power)
  );
}
