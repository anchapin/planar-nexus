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
  type KeywordActionResult
} from './keyword-actions';
import {
  type GameState,
  type PlayerId,
  type Player,
  type CardInstance,
  type Phase,
} from './types';
import {
  createInitialGameState,
  loadDeckForPlayer,
  startGame,
  drawCard,
  passPriority,
  concede,
} from './game-state';
import { checkStateBasedActions, canDraw, drawWithSBAChecking } from "./state-based-actions";
import {
  serializeGameState,
  deserializeGameState,
} from "./serialization";
import {
  playLand,
  activateManaAbility,
} from "./mana";
import {
  castSpell,
} from "./spell-casting";
import {
  isLand,
} from "./card-instance";

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
export { moveCardBetweenZones, createZone, createPlayerZones, createSharedZones } from "./zones";
export * from "./turn-phases";
export * from "./game-state";
export * from "./state-hash";
export * from "./deterministic-sync";
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
export * from "./combat";
export * from "./state-based-actions";
export * from "./oracle-text-parser";
export * from "./mana";
export * from "./spell-casting";
export * from "./abilities"
export * from "./evergreen-keywords"
export * from './replacement-examples';
export * from "./terminology-translation";

// Local exports for common functions with consistent naming
export { tapCard, untapCard, checkStateBasedActions };
