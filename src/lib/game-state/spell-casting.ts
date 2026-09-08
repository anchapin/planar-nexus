/**
 * Spell Casting System
 *
 * This module implements the spell casting system for Magic: The Gathering,
 * including cost validation, stack management, and timing restrictions.
 *
 * Reference: CR 601 - Casting Spells
 */
//
// Issue #1725: this module was decomposed into per-family files under
// spell-casting/. This file remains the module entrypoint so every existing
// relative and barrel import keeps working unchanged — it is a pure
// re-export surface. New code belongs in the family file that owns the
// concern.
//
export * from './spell-casting/cast';
export * from './spell-casting/board-sweepers';
export * from './spell-casting/resolve';
export * from './spell-casting/targeting';
export * from './spell-casting/choices';
