/**
 * Keyword Actions System
 *
 * Implements standard MTG keyword actions as described in the Comprehensive Rules.
 * Reference: CR 701 - Keyword Actions
 *
 * Keyword actions include:
 * - Destroy (with regeneration/indestructible handling)
 * - Exile (with face-up/face-down options)
 * - Sacrifice
 * - Draw (with replacement effects)
 * - Discard
 * - Create token
 * - Counter (spell or ability)
 * - Regenerate
 */
//
// Issue #1725: this module was decomposed into per-family files under
// keyword-actions/. This file remains the module entrypoint so every existing
// relative and barrel import keeps working unchanged — it is a pure
// re-export surface. New code belongs in the family file that owns the
// concern.
//
export * from './keyword-actions/shared';
export * from './keyword-actions/dungeon';
export * from './keyword-actions/removal';
export * from './keyword-actions/blitz';
export * from './keyword-actions/foretell';
export * from './keyword-actions/draw';
export * from './keyword-actions/tokens';
export * from './keyword-actions/counters';
export * from './keyword-actions/counter-spell';
export * from './keyword-actions/damage-tap';
export * from './keyword-actions/persist';
export * from './keyword-actions/cycling';
export * from './keyword-actions/monarchy';
export * from './keyword-actions/tribute-renown';
