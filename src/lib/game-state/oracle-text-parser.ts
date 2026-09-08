/**
 * Oracle Text Parser
 *
 * Parses Magic: The Gathering Oracle text into structured game mechanics.
 * Reference: CR 112 - Card Types, CR 113 - Abilities, CR 608 - Handling Spells and Abilities
 *
 * This parser handles:
 * - Activated abilities (cost: effect format)
 * - Triggered abilities (when/whenever/at)
 * - Static abilities
 * - Keyword extraction from text
 * - Reminder text exclusion
 */
//
// Issue #1725: this module was decomposed into per-family files under
// oracle-text-parser/. This file remains the module entrypoint so every existing
// relative and barrel import keeps working unchanged — it is a pure
// re-export surface. New code belongs in the family file that owns the
// concern.
//
export * from './oracle-text-parser/core';
export * from './oracle-text-parser/keywords';
export * from './oracle-text-parser/abilities';
export * from './oracle-text-parser/mana-cost';
export * from './oracle-text-parser/modes';
export * from './oracle-text-parser/casting-keywords';
export * from './oracle-text-parser/alternative-costs';
export * from './oracle-text-parser/escape';
export * from './oracle-text-parser/cycling';
export * from './oracle-text-parser/tribute-renown';
