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

// Export card instance utilities
export * from "./card-instance";

// Export zone management
export * from "./zones";

// Export turn phase management
export * from "./turn-phases";

// Export main game state class and functions
export * from "./game-state";

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
