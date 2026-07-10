/**
 * @fileOverview Tests for `src/lib/anti-meta.ts`.
 *
 * Regression coverage for issue #1405: the dashboard archetype ids in
 * `src/lib/meta.ts` (e.g. `std-aggro-1`) and the anti-meta record ids in
 * `src/lib/anti-meta.ts` (e.g. `std-aggro-red`) shipped under two different
 * naming schemes. `getCounterRecommendations` / `getManaBaseRecommendations`
 * used to filter by exact id match, so the Counter / Sideboard / Mana Base
 * tabs in `AntiMetaRecommendations` rendered empty for every archetype.
 *
 * The fix introduces an alias resolver inside `anti-meta.ts` plus five new
 * Commander anti-meta + mana-base records. These tests pin down:
 *   - the alias resolver maps each dashboard id to a populated record,
 *   - unknown ids pass through unchanged (defensive fallback),
 *   - every dashboard archetype id resolves to at least one counter rec and
 *     one mana-base rec in every format (acceptance criterion #4 of #1405).
 */

import { describe, it, expect } from '@jest/globals';
import {
  getCounterRecommendations,
  getManaBaseRecommendations,
  getAllCounterRecommendations,
  getAllManaBaseRecommendations,
  getSideboardRecommendations,
} from '../anti-meta';
import { getMetaData, MagicFormat, DeckArchetype } from '../meta';

const FORMATS: MagicFormat[] = ['standard', 'modern', 'commander'];

function archetypesFor(format: MagicFormat): DeckArchetype[] {
  return getMetaData(format, 'alltime').archetypes;
}

describe('anti-meta — issue #1405 (alias resolver)', () => {
  describe('getCounterRecommendations', () => {
    it('returns the Red Aggro record for std-aggro-1 (dashboard id)', () => {
      const recs = getCounterRecommendations('std-aggro-1', 'standard');
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0].archetypeId).toBe('std-aggro-red');
      expect(recs[0].archetypeName).toBe('Red Aggro');
    });

    it('returns the Burn record for mod-aggro-1 (dashboard id)', () => {
      const recs = getCounterRecommendations('mod-aggro-1', 'modern');
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0].archetypeId).toBe('mod-aggro-red');
      expect(recs[0].archetypeName).toBe('Burn');
    });

    it('returns the Edgar Markov record for edh-aggro-1 (commander alias)', () => {
      const recs = getCounterRecommendations('edh-aggro-1', 'commander');
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0].archetypeId).toBe('cmdr-aggro-markov');
      expect(recs[0].archetypeName).toBe('Edgar Markov');
    });

    it('returns the Teferi record for edh-control-1 (commander alias)', () => {
      const recs = getCounterRecommendations('edh-control-1', 'commander');
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0].archetypeId).toBe('cmdr-control-teferi');
      expect(recs[0].archetypeName).toBe('Teferi, Temporal Archmage');
    });

    it('returns the Krenko Mob Boss record for edh-combo-1 (commander alias)', () => {
      const recs = getCounterRecommendations('edh-combo-1', 'commander');
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0].archetypeId).toBe('cmdr-combo-krenko');
      expect(recs[0].archetypeName).toBe('Krenko, Mob Boss');
    });

    it('passes through ids that already match (no alias needed)', () => {
      const recs = getCounterRecommendations('std-aggro-red', 'standard');
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0].archetypeId).toBe('std-aggro-red');
    });

    it('returns [] for an unknown archetype id (defensive fallback)', () => {
      const recs = getCounterRecommendations('does-not-exist', 'standard');
      expect(recs).toEqual([]);
    });
  });

  describe('getManaBaseRecommendations', () => {
    it('returns the Red Aggro mana profile for std-aggro-1 (dashboard id)', () => {
      const rec = getManaBaseRecommendations('std-aggro-1', 'standard');
      expect(rec).not.toBeNull();
      expect(rec?.archetypeId).toBe('std-aggro-red');
      expect(rec?.archetypeName).toBe('Red Aggro');
      expect(rec?.recommendedLands).toBe(22);
    });

    it('returns the Izzet Tempo mana profile for std-tempo-1 (dashboard id)', () => {
      const rec = getManaBaseRecommendations('std-tempo-1', 'standard');
      expect(rec).not.toBeNull();
      expect(rec?.archetypeId).toBe('std-tempo-blue-red');
    });

    it('returns the Burn mana profile for mod-aggro-1 (dashboard id)', () => {
      const rec = getManaBaseRecommendations('mod-aggro-1', 'modern');
      expect(rec).not.toBeNull();
      expect(rec?.archetypeId).toBe('mod-aggro-red');
      expect(rec?.recommendedLands).toBe(20);
    });

    it('returns the Grixis Twin mana profile for mod-combo-1 (dashboard id)', () => {
      const rec = getManaBaseRecommendations('mod-combo-1', 'modern');
      expect(rec).not.toBeNull();
      expect(rec?.archetypeId).toBe('mod-combo-twin');
    });

    it('returns the Chatterfang mana profile for edh-midrange-1 (commander alias)', () => {
      const rec = getManaBaseRecommendations('edh-midrange-1', 'commander');
      expect(rec).not.toBeNull();
      expect(rec?.archetypeId).toBe('cmdr-midrange-chatterfang');
    });

    it('returns the Malcolm mana profile for edh-tempo-1 (commander alias)', () => {
      const rec = getManaBaseRecommendations('edh-tempo-1', 'commander');
      expect(rec).not.toBeNull();
      expect(rec?.archetypeId).toBe('cmdr-tempo-malcolm');
    });

    it('returns null for an unknown archetype id', () => {
      const rec = getManaBaseRecommendations('does-not-exist', 'standard');
      expect(rec).toBeNull();
    });
  });

  describe('getSideboardRecommendations (transitive alias resolution)', () => {
    it('returns a populated sideboard guide via the alias-resolved counter lookup', () => {
      const sideboard = getSideboardRecommendations(
        'std-aggro-1',
        'std-control-blue',
        'standard'
      );
      expect(sideboard).not.toBeNull();
      expect(sideboard!.in.length).toBeGreaterThan(0);
      expect(sideboard!.notes).not.toBe('');
    });
  });

  describe('coverage — every dashboard archetype resolves to populated records (acceptance #1405)', () => {
    for (const format of FORMATS) {
      it(`every ${format} archetype has at least one counter recommendation`, () => {
        const archetypes = archetypesFor(format);
        expect(archetypes.length).toBeGreaterThan(0);
        const missing: string[] = [];
        for (const a of archetypes) {
          const recs = getCounterRecommendations(a.id, format);
          if (recs.length === 0) missing.push(a.id);
        }
        expect({ format, missing }).toEqual({ format, missing: [] });
      });

      it(`every ${format} archetype has a non-null mana-base recommendation`, () => {
        const archetypes = archetypesFor(format);
        expect(archetypes.length).toBeGreaterThan(0);
        const missing: string[] = [];
        for (const a of archetypes) {
          const rec = getManaBaseRecommendations(a.id, format);
          if (!rec) missing.push(a.id);
        }
        expect({ format, missing }).toEqual({ format, missing: [] });
      });
    }
  });

  describe('getAllCounterRecommendations / getAllManaBaseRecommendations', () => {
    it('returns a non-empty list per format', () => {
      for (const format of FORMATS) {
        const counters = getAllCounterRecommendations(format);
        const manas = getAllManaBaseRecommendations(format);
        expect(counters.length).toBeGreaterThan(0);
        expect(manas.length).toBeGreaterThan(0);
      }
    });
  });
});