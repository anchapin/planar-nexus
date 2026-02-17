/**
 * Game State Management Module
 *
 * This module provides comprehensive data structures and utilities for managing
 * the complete state of a Magic: The Gathering game.
 *
 * @module game-state
 */

// Export all types
export * from "./types";

// Export card instance utilities (excluding canAttack/canBlock)
export {
  generateCardInstanceId,
  createCardInstance,
  createToken,
  tapCard,
  untapCard,
  flipCard,
  turnFaceDown,
  turnFaceUp,
  addCounters,
  removeCounters,
  markDamage,
  resetDamage,
  attachCard,
  detachCard,
  changeController,
  isCreature,
  isLand,
  isPlaneswalker,
  isArtifact,
  isEnchantment,
  isInstantOrSorcery,
  isPermanent,
  getPower,
  getToughness,
  hasLethalDamage,
  getManaValue,
  isDoubleFaced,
  transformCard,
  setCardFace,
  getCurrentFaceName,
  phaseOut,
  phaseIn,
  addPowerModifier,
  addToughnessModifier,
  setPowerModifier,
  setToughnessModifier,
  clearSummoningSickness,
  hasCounter,
  getCounterCount,
  isAttached,
  hasAttachments,
} from "./card-instance";

// Export zone management
export {
  createZone,
  createPlayerZones,
  createSharedZones,
  addCardToZone,
  removeCardFromZone,
  moveCardBetweenZones,
  getTopCard,
  getBottomCard,
  getTopCards,
  shuffleZone,
  countCards,
  zoneContainsCard,
  getCardPosition,
  reorderCards,
  revealZone,
  hideZone,
  setZoneVisibility,
  canPlayerSeeZone,
  millCards,
  exileCards,
} from "./zones";

// Export turn phase management
export * from "./turn-phases";

// Export main game state class and functions (excluding checkStateBasedActions)
export {
  createInitialGameState,
  loadDeckForPlayer,
  startGame,
  drawCard,
  passPriority,
  dealDamageToPlayer,
  gainLife,
  concede,
  getPlayerLibrary,
  getPlayerHand,
  getPlayerBattlefield,
  getPlayerGraveyard,
  getPlayerExile,
  offerDraw,
  acceptDraw,
  declineDraw,
  canOfferDraw,
  canAcceptDraw,
} from "./game-state";

// Re-export checkStateBasedActions from state-based-actions to avoid conflict
export { checkStateBasedActions, canDraw, drawWithSBAChecking } from "./state-based-actions";

// Export state hash verification for P2P
export * from "./state-hash";

// Export replay system
export * from "./replay";

// Export serialization for save/load
export * from "./serialization";

// Export replacement and prevention effects (CR 614)
export * from "./replacement-effects";

// Export layer system for continuous effects (CR 613)
export * from "./layer-system";

// Export keyword actions (CR 701)
export * from "./keyword-actions";

// Export combat system (CR 506-510)
export * from "./combat";

// Export state-based actions (CR 704)
export * from "./state-based-actions";

// Export Oracle text parser (CR 112, 113, 608)
export * from "./oracle-text-parser";

// Export mana system (CR 106 - Mana, CR 305 - Lands)
export * from "./mana";
