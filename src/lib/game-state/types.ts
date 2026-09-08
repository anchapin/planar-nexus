/**
 * Core type definitions for the Planar Nexus game state engine.
 * These types represent the complete state of a tabletop card game.
 *
 * Note: Internal type names may reference MTG terminology for backward compatibility
 * and implementation clarity. All user-facing text should use generic terminology
 * via the translation layer (see terminology-translation.ts).
 */
// Re-export ScryfallCard for use in other game-state modules
export type { ScryfallCard } from "@/lib/card-database";
//
// Issue #1725: this module was decomposed into per-family files under
// types/. This file remains the module entrypoint so every existing
// relative and barrel import keeps working unchanged — it is a pure
// re-export surface. New code belongs in the family file that owns the
// concern.
//
export * from './types/cards';
export * from './types/dungeon';
export * from './types/zones';
export * from './types/players';
export * from './types/turn';
export * from './types/stack';
export * from './types/combat';
export * from './types/choices';
export * from './types/linked-effects';
export * from './types/game';
export * from './types/ai';
