import type { CardInstance } from "../types";
import { getPower, isCreature, isPlaneswalker } from "../card-instance";

/**
 * Whose permanent a targeted effect may pick (#2532): "you" is "target
 * creature you control"; "opponent" is "an opponent controls" or "you don't
 * control" (the same thing in a two-player game).
 */
export const TARGET_CONTROLLERS = ["you", "opponent"] as const;
export type TargetController = (typeof TARGET_CONTROLLERS)[number];

/** True when `card` is controlled by the right player relative to `playerId`. */
export function matchesController(
  card: CardInstance,
  controller: TargetController | undefined,
  playerId: string,
): boolean {
  if (!controller) return true;
  return controller === "you"
    ? card.controllerId === playerId
    : card.controllerId !== playerId;
}

/** What a scripted Destroy or Exile may target (#2528). */
export const REMOVAL_TARGETS = [
  "creature",
  "artifact",
  "enchantment",
  "artifact_or_enchantment",
  "nonland_permanent",
  "nonbasic_land",
  // #2594 #14: "destroy target planeswalker" (Hero's Downfall, Deadly
  // Plot) and the "planeswalker target" gap surfaced by the drafter.
  // The engine's `destroyCard` / `exileCard` already work on any
  // permanent type; this is a filter-level addition.
  "planeswalker",
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
    case "nonbasic_land":
      // Demolition Field (#2614). "Basic" is a supertype (CR 205.4a).
      typeOk = hasType(card, "Land") && !hasType(card, "Basic");
      break;
    case "planeswalker":
      // #2594 #14: "destroy target planeswalker" (Hero's Downfall,
      // Deadly Plot). `isPlaneswalker` checks the type line for
      // "Planeswalker".
      typeOk = isPlaneswalker(card);
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
