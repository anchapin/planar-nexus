/**
 * @fileOverview Tests for `src/lib/meta.ts`.
 *
 * Regression coverage for issue #1446. Before the fix:
 *   - `getMetaData(format, dateRange)` accepted a `dateRange` argument but the
 *     only thing it did with it was echo it back into the returned object —
 *     `risingArchetypes`, `decliningArchetypes`, `cardTrends`, and
 *     `lastUpdated` were identical across `'7days' | '30days' | 'alltime'`.
 *   - `generateCardTrends()` built every inclusion-rate point with
 *     `Math.random()`, so two successive `getMetaData` calls with the same
 *     args returned different `cardTrends`, breaking React/SSR hydration
 *     stability and any chance of stable snapshot tests.
 *
 * The fix:
 *   - makes `cardTrends` and the rising/declining trend deltas range-dependent,
 *     so the dashboard toggle actually changes the rendered output;
 *   - replaces `Math.random()` with a seeded mulberry32 PRNG, so repeated calls
 *     with the same `dateRange` return deep-equal output;
 *   - exposes an optional `{ now, random }` dependency-injection seam so tests
 *     can pin `lastUpdated` and/or the noise band.
 *
 * These tests pin down all four acceptance criteria from #1446.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  getMetaData,
  MagicFormat,
  DateRange,
  MetaData,
} from '../meta';

const FORMATS: MagicFormat[] = ['standard', 'modern', 'commander'];
const RANGES: DateRange[] = ['7days', '30days', 'alltime'];

describe('meta — issue #1446 (dateRange + deterministic card trends)', () => {
  describe('AC1: 7days vs alltime produce observably different output', () => {
    for (const format of FORMATS) {
      it(`${format}: getMetaData(f, '7days').cardTrends differs from getMetaData(f, 'alltime').cardTrends`, () => {
        const sevenDays = getMetaData(format, '7days');
        const allTime = getMetaData(format, 'alltime');

        // Window length is the cheapest, most reliable range signal.
        expect(sevenDays.cardTrends[0].data.length).not.toBe(
          allTime.cardTrends[0].data.length,
        );

        // Per-card slopes also scale with dateRange, so even at week index 0
        // the delver/reclamation/etc. inclusion rate should differ.
        const sevenDelver = sevenDays.cardTrends.find(c => c.cardName === 'Delver of Secrets')!;
        const allTimeDelver = allTime.cardTrends.find(c => c.cardName === 'Delver of Secrets')!;
        const sevenFinal = sevenDelver.data.at(-1)!.inclusionRate;
        const allTimeFinal = allTimeDelver.data.at(-1)!.inclusionRate;
        expect(sevenFinal).not.toBe(allTimeFinal);
      });

      it(`${format}: risingArchetypes differ between '7days' and 'alltime'`, () => {
        const sevenDays = getMetaData(format, '7days');
        const allTime = getMetaData(format, 'alltime');

        // The rising/declining deltas scale with dateRange, so every rising
        // archetype's `change` should be observably different.
        expect(sevenDays.risingArchetypes.length).toBeGreaterThan(0);
        for (let i = 0; i < sevenDays.risingArchetypes.length; i++) {
          const s = sevenDays.risingArchetypes[i];
          const a = allTime.risingArchetypes[i];
          expect(s.archetypeId).toBe(a.archetypeId);
          expect(s.change).not.toBe(a.change);
          expect(s.previousMetaShare).not.toBe(a.previousMetaShare);
        }
      });

      it(`${format}: decliningArchetypes differ between '7days' and 'alltime'`, () => {
        const sevenDays = getMetaData(format, '7days');
        const allTime = getMetaData(format, 'alltime');

        expect(sevenDays.decliningArchetypes.length).toBeGreaterThan(0);
        for (let i = 0; i < sevenDays.decliningArchetypes.length; i++) {
          const s = sevenDays.decliningArchetypes[i];
          const a = allTime.decliningArchetypes[i];
          expect(s.archetypeId).toBe(a.archetypeId);
          expect(s.change).not.toBe(a.change);
          expect(s.previousMetaShare).not.toBe(a.previousMetaShare);
        }
      });

      it(`${format}: dateRange is reflected in the returned MetaData.dateRange`, () => {
        expect(getMetaData(format, '7days').dateRange).toBe('7days');
        expect(getMetaData(format, '30days').dateRange).toBe('30days');
        expect(getMetaData(format, 'alltime').dateRange).toBe('alltime');
      });
    }
  });

  describe('AC2: Two successive calls with identical args return deep-equal cardTrends', () => {
    for (const format of FORMATS) {
      for (const range of RANGES) {
        it(`${format}/${range}: cardTrends are deep-equal across two calls`, () => {
          const first = getMetaData(format, range);
          const second = getMetaData(format, range);
          expect(second.cardTrends).toEqual(first.cardTrends);
        });

        it(`${format}/${range}: rising/declining trends are deep-equal across two calls`, () => {
          const first = getMetaData(format, range);
          const second = getMetaData(format, range);
          expect(second.risingArchetypes).toEqual(first.risingArchetypes);
          expect(second.decliningArchetypes).toEqual(first.decliningArchetypes);
        });
      }
    }
  });

  describe('AC3: generateCardTrends contains no Math.random() call', () => {
    it('source file has no Math.random outside of comments', () => {
      const source = readFileSync(
        resolve(__dirname, '..', 'meta.ts'),
        'utf8',
      );
      // Strip block + line comments so we only assert against executable code.
      const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(stripped).not.toMatch(/Math\.random\s*\(/);
    });
  });

  describe('AC4: lastUpdated can be supplied deterministically', () => {
    it('uses the injected `now` factory for lastUpdated', () => {
      const pinned = new Date('2026-01-15T12:00:00.000Z');
      const data = getMetaData('standard', '30days', { now: () => pinned });
      expect(data.lastUpdated).toBe(pinned.toISOString());
    });

    it('different now() calls produce different lastUpdated', () => {
      const a = getMetaData('standard', '30days', {
        now: () => new Date('2026-01-15T12:00:00.000Z'),
      });
      const b = getMetaData('standard', '30days', {
        now: () => new Date('2026-02-20T08:30:00.000Z'),
      });
      expect(a.lastUpdated).not.toBe(b.lastUpdated);
    });

    it('without an injected clock, lastUpdated is still a valid ISO string', () => {
      const data = getMetaData('standard', '30days');
      // Round-trip through Date to confirm it's a real ISO timestamp.
      expect(Number.isNaN(Date.parse(data.lastUpdated))).toBe(false);
    });
  });

  describe('bonus: injectable PRNG lets tests assert on the noise band', () => {
    it('a fixed `random` produces a fixed cardTrends noise band', () => {
      const fixedRandom = () => 0.5;
      const a = getMetaData('standard', '30days', { random: fixedRandom });
      const b = getMetaData('standard', '30days', { random: fixedRandom });
      expect(b.cardTrends).toEqual(a.cardTrends);

      // With random() === 0.5 the noise band adds exactly 1.0 to every value,
      // so a Delver W1 point must equal `65 + 0*3.5*0.7 + 1.0` rounded to 1dp.
      const delver = a.cardTrends.find(c => c.cardName === 'Delver of Secrets')!;
      expect(delver.data[0].inclusionRate).toBe(66);
    });

    it('different `random` injections produce different cardTrends', () => {
      const allZeros = getMetaData('standard', '30days', { random: () => 0 });
      const allOnes = getMetaData('standard', '30days', { random: () => 1 });
      expect(allZeros.cardTrends).not.toEqual(allOnes.cardTrends);
    });
  });

  describe('range-dependent week window length', () => {
    it("7days → 4 weeks, 30days → 8 weeks, alltime → 12 weeks", () => {
      for (const format of FORMATS) {
        expect(getMetaData(format, '7days').cardTrends[0].data.length).toBe(4);
        expect(getMetaData(format, '30days').cardTrends[0].data.length).toBe(8);
        expect(getMetaData(format, 'alltime').cardTrends[0].data.length).toBe(12);
      }
    });

    it('every card has the same week-window length within a single call', () => {
      for (const format of FORMATS) {
        for (const range of RANGES) {
          const data: MetaData = getMetaData(format, range);
          const lengths = new Set(
            data.cardTrends.map(c => c.data.length),
          );
          expect(lengths.size).toBe(1);
        }
      }
    });
  });
});