/**
 * Game State Management Module
 *
 * This module provides comprehensive data structures and utilities for managing
 * the complete state of a tabletop card game.
 *
 * @module game-state
 */

import {
  tapCardAction as tapCard,
  untapCardAction as untapCard,
} from "./keyword-actions";
import { checkStateBasedActions } from "./state-based-actions";

// Export everything from game-state modules
export * from "./types";
export {
  isLand,
  isCreature,
  isArtifact,
  isEnchantment,
  isPlaneswalker,
  isPermanent,
} from "./card-instance";
export {
  moveCardBetweenZones,
  createZone,
  createPlayerZones,
  createSharedZones,
} from "./zones";
export * from "./turn-phases";
export * from "./game-state";
export * from "./state-hash";
// deterministic-sync / delta-sync moved to src/lib/sync/ (issue #1716):
// P2P networking machinery no longer lives on the engine surface. Import
// the versioned sync API from "@/lib/sync" instead. The engine barrel
// still exports the hash types deterministic-sync used to re-export
// (HashComparisonResult / HashDiscrepancy come from "./state-hash" above).
export * from "./replay";
export * from "./serialization";
export * from "./replacement-effects";
export * from "./layer-system";
export {
  destroyCard as destroyPermanentAction,
  sacrificeCard as sacrificePermanentAction,
  exileCard as exilePermanentAction,
  discardCards as discardCardsAction,
} from "./keyword-actions";
// #1710: star-export the raw keyword-actions surface alongside the curated
// `…Action` aliases above (explicit exports win over `*`, so the aliases and
// the collision disambiguations at the bottom of this file stay intact).
// Collision analysis (drawCards vs ./zones etc.) lives with the
// disambiguation block below.
export * from "./keyword-actions";
export * from "./combat";
export * from "./state-based-actions";
export * from "./oracle-text-parser";
export * from "./mana";
export * from "./spell-casting";
export * from "./effect-resolution";
export * from "./abilities";
export { getEffectivePower, getEffectiveToughness } from "./layer-system";
export * from "./replacement-examples";
export * from "./terminology-translation";
export * from "./phasing";
export { shouldAutoPassPriority } from "./auto-pass-priority";
export type { AutoPassContext } from "./auto-pass-priority";
export * from "./priority-guard";
// #1710: the remaining engine modules join the barrel surface. Collision
// analysis ran over all of them; the disambiguation block below wins over
// `*` for any overlapping names (drawCards, canAttack, canBlock, …).
export * from "./card-instance";
export * from "./zones";
export * from "./ward-system";
export * from "./replay-compression";

// Local exports for common functions with consistent naming
export { tapCard, untapCard, checkStateBasedActions };

/**
 * #1710 disambiguation: these names are declared by more than one
 * star-exported module above, so `export *` silently EXCLUDES them from
 * the barrel surface. Explicit re-exports restore deterministic
 * resolution: the canonical (unaliased) name is the module external
 * consumers actually relied on before the barrel migration; the other
 * declarations remain reachable under `…From<Module>` aliases.
 *
 * NOTE: the bare `checkStateBasedActions` above resolves to
 * `state-based-actions` (long-standing barrel semantics, see the import
 * at the top of this file); the `GameState -> GameState` wrapper defined
 * in `game-state.ts` is exported as `checkStateBasedActionsFromGameState`.
 */
export { drawCards } from "./zones";
export { drawCards as drawCardsFromKeywordActions } from "./keyword-actions";
export { checkStateBasedActions as checkStateBasedActionsFromGameState } from "./game-state";
export { canAttack, canBlock } from "./card-instance";
export {
  canAttack as canAttackFromCombat,
  canBlock as canBlockFromCombat,
} from "./combat";
export { getManaValue } from "./card-instance";
export { getManaValue as getManaValueFromOracleTextParser } from "./oracle-text-parser";
