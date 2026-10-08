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
 * What a scripted Destroy or Exile may sweep (#2594 follow-up, lane 12).
 * "Destroy all creatures" (Day of Judgment, Fumigate) and "destroy all
 * artifacts" (Ultima) need a "all <type>" target. The engine iterates the
 * battlefield for the matching controller filter and applies the operation
 * to each permanent. Regen shields (`indestructible`, `regenerate`) are
 * still respected by `destroyCard`. The `controller` field of the schema
 * narrows which player's battlefield is swept.
 *
 * Sweeper targets intentionally do NOT include "planeswalker" alone — the
 * drafter surfaces a "destroy all" gap for creatures, artifacts,
 * enchantments, and nonland permanents. Add to this list as new sweeper
 * cards are surfaced.
 */
export const REMOVAL_ALL_TARGETS = [
  "all_creatures",
  "all_artifacts",
  "all_enchantments",
  "all_nonland_permanents",
] as const;
export type RemovalAllTarget = (typeof REMOVAL_ALL_TARGETS)[number];

/**
 * A removal target plus optional power bounds ("creature with power 4 or
 * greater"). Power bounds only match creatures. `target` accepts both the
 * single-target set (`RemovalTarget`) and the sweeper set
 * (`RemovalAllTarget`) — engine code paths distinguish by which set the
 * value belongs to.
 */
export interface RemovalFilter {
  target: RemovalTarget | RemovalAllTarget;
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
    // Sweeper targets (lane 12, #2594 follow-up). The same predicate
    // shape as the single-target case; the engine iterates over the
    // battlefield in the sweeper branch.
    case "all_creatures":
      typeOk = isCreature(card);
      break;
    case "all_artifacts":
      typeOk = hasType(card, "Artifact");
      break;
    case "all_enchantments":
      typeOk = hasType(card, "Enchantment");
      break;
    case "all_nonland_permanents":
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
