/**
 * Unit tests for the format-aware mana curve optimization added in issue #998.
 * Covers OPTIMAL_MANA_CURVES, normalizeDeckFormat, compareToOptimal,
 * describeGap, getManaCurveTips, and the deck-level analyzeDeck suggestions.
 */

import {
  OPTIMAL_MANA_CURVES,
  normalizeDeckFormat,
  getManaCurveTips,
  compareToOptimal,
  describeGap,
  analyzeDeck,
  type DeckFormat,
  type ManaCurveGap,
} from '../deck-analyzer';
import type { DeckCard } from '@/app/actions';

const card = (overrides: Partial<DeckCard> = {}): DeckCard => ({
  id: 'card-1',
  name: 'Test Card',
  cmc: 0,
  type_line: 'Creature',
  colors: [],
  color_identity: [],
  legalities: {},
  mana_cost: '',
  count: 1,
  ...overrides,
});

describe('OPTIMAL_MANA_CURVES', () => {
  it('defines commander, standard, and modern profiles', () => {
    expect(OPTIMAL_MANA_CURVES.commander).toBeDefined();
    expect(OPTIMAL_MANA_CURVES.standard).toBeDefined();
    expect(OPTIMAL_MANA_CURVES.modern).toBeDefined();
  });

  it('has buckets 1..7 with target counts and a lands target', () => {
    for (const format of Object.keys(OPTIMAL_MANA_CURVES) as DeckFormat[]) {
      const profile = OPTIMAL_MANA_CURVES[format];
      for (let cmc = 1; cmc <= 7; cmc++) {
        const bucket = profile.buckets[cmc];
        expect(bucket).toBeDefined();
        expect(bucket.min).toBeLessThanOrEqual(bucket.target);
        expect(bucket.target).toBeLessThanOrEqual(bucket.max);
      }
      expect(profile.lands.target).toBeGreaterThan(0);
      expect(profile.tips.length).toBeGreaterThan(0);
    }
  });

  it('gives commander a higher curve than modern', () => {
    const cmdHigh = OPTIMAL_MANA_CURVES.commander.buckets[7].target;
    const modHigh = OPTIMAL_MANA_CURVES.modern.buckets[7].target;
    expect(cmdHigh).toBeGreaterThan(modHigh);
  });
});

describe('normalizeDeckFormat', () => {
  it.each([
    ['commander', 'commander'],
    ['legendary-commander', 'commander'],
    ['standard', 'standard'],
    ['constructed-core', 'standard'],
    ['constructed-pioneer', 'standard'],
    ['modern', 'modern'],
    ['constructed-extended', 'modern'],
    ['', 'commander'],
    [undefined, 'commander'],
    [null, 'commander'],
  ])('maps %s -> %s', (input, expected) => {
    expect(normalizeDeckFormat(input as string)).toBe(expected);
  });
});

describe('getManaCurveTips', () => {
  it('returns tips for a known format', () => {
    const tips = getManaCurveTips('standard');
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.every((t) => typeof t === 'string')).toBe(true);
  });

  it('normalizes unknown formats to commander tips', () => {
    expect(getManaCurveTips('brawl')).toEqual(OPTIMAL_MANA_CURVES.commander.tips);
  });
});

describe('compareToOptimal', () => {
  it('reports no gaps for a perfectly-tuned standard curve', () => {
    const deck: DeckCard[] = [
      card({ name: 'Plains', type_line: 'Land', count: 25 }),
      card({ name: '1d', cmc: 1, count: 7 }),
      card({ name: '2d', cmc: 2, count: 8 }),
      card({ name: '3d', cmc: 3, count: 6 }),
      card({ name: '4d', cmc: 4, count: 4 }),
      card({ name: '5d', cmc: 5, count: 3 }),
      card({ name: '6d', cmc: 6, count: 1 }),
      card({ name: '7d', cmc: 7, count: 1 }),
    ];

    const result = compareToOptimal(deck, 'standard');

    expect(result.format).toBe('standard');
    expect(result.gaps).toHaveLength(0);
    expect(result.landGap).toBeNull();
    expect(result.totalGap).toBe(0);
  });

  it('flags too few low drops in modern', () => {
    const deck: DeckCard[] = [
      card({ name: 'Mountain', type_line: 'Land', count: 23 }),
      // Only one 1-drop where modern wants ~9.
      card({ name: 'lonely one drop', cmc: 1, count: 1 }),
      card({ name: '4d', cmc: 4, count: 12 }),
      card({ name: '5d', cmc: 5, count: 12 }),
    ];

    const result = compareToOptimal(deck, 'modern');
    const oneDropGap = result.gaps.find((g) => g.cmc === 1);
    expect(oneDropGap).toBeDefined();
    expect(oneDropGap!.difference).toBeGreaterThan(0);
    expect(oneDropGap!.severity).toBe('high');
  });

  it('flags too many high drops in commander', () => {
    const deck: DeckCard[] = [
      card({ name: 'Swamp', type_line: 'Land', count: 38 }),
      card({ name: 'big1', cmc: 7, count: 20 }),
      card({ name: 'big2', cmc: 8, count: 10 }),
    ];

    const result = compareToOptimal(deck, 'commander');
    const highGap = result.gaps.find((g) => g.cmc === 7);
    expect(highGap).toBeDefined();
    expect(highGap!.difference).toBeLessThan(0); // need to cut
  });

  it('flags a land shortfall', () => {
    const deck: DeckCard[] = [
      card({ name: 'Island', type_line: 'Land', count: 20 }),
      card({ name: '2d', cmc: 2, count: 9 }),
      card({ name: '3d', cmc: 3, count: 9 }),
    ];

    const result = compareToOptimal(deck, 'commander');
    expect(result.landGap).not.toBeNull();
    expect(result.landGap!.difference).toBeGreaterThan(0);
  });

  it('respects card counts when flattening', () => {
    const deck: DeckCard[] = [
      card({ name: 'Forest', type_line: 'Land', count: 25 }),
      card({ name: 'two drop', cmc: 2, count: 4 }),
    ];
    const result = compareToOptimal(deck, 'standard');
    const twoGap = result.gaps.find((g) => g.cmc === 2);
    expect(twoGap).toBeDefined();
    // standard target is 8, we have 4 -> difference 4
    expect(twoGap!.current).toBe(4);
    expect(twoGap!.target).toBe(OPTIMAL_MANA_CURVES.standard.buckets[2].target);
  });
});

describe('describeGap', () => {
  it('describes an add recommendation with a range', () => {
    const gap: ManaCurveGap = {
      cmc: 2,
      label: '2-drop',
      current: 3,
      target: 8,
      difference: 5,
      severity: 'high',
    };
    const text = describeGap(gap);
    expect(text).toContain('Add');
    expect(text).toContain('4-5');
    expect(text).toContain('2-drop');
  });

  it('describes a cut recommendation', () => {
    const gap: ManaCurveGap = {
      cmc: 7,
      label: '7+-drop',
      current: 15,
      target: 8,
      difference: -7,
      severity: 'high',
    };
    const text = describeGap(gap);
    expect(text).toContain('Cut');
    expect(text).toMatch(/6-7/);
  });

  it('reports on-target without a range for difference 0', () => {
    const gap: ManaCurveGap = {
      cmc: 3,
      label: '3-drop',
      current: 6,
      target: 6,
      difference: 0,
      severity: 'low',
    };
    expect(describeGap(gap)).toBe('3-drop are on target');
  });
});

describe('analyzeDeck suggestions (issue #998 acceptance)', () => {
  it('emits "Add more Y-drops" style suggestions for a gappy curve', () => {
    const deck: DeckCard[] = [
      card({ name: 'Mountain', type_line: 'Land', count: 23 }),
      // Far too few 1- and 2-drops for modern.
      card({ name: 'heavy1', cmc: 5, count: 8 }),
      card({ name: 'heavy2', cmc: 6, count: 8 }),
      card({ name: 'heavy3', cmc: 7, count: 8 }),
    ];

    const analysis = analyzeDeck(deck, 'modern');
    const curveSuggestions = analysis.suggestions.filter((s) => s.category === 'Mana Curve');
    expect(curveSuggestions.length).toBeGreaterThan(0);
    expect(curveSuggestions.some((s) => /1-drop/i.test(s.title))).toBe(true);
    expect(curveSuggestions.some((s) => /Add.*1-drop/i.test(s.title))).toBe(true);
    // Each such suggestion should mention a concrete count.
    expect(curveSuggestions.some((s) => /\d/.test(s.description))).toBe(true);
  });

  it('is format-aware: commander vs modern differ', () => {
    // 38 lands + heavy top-end is fine-ish for commander but bad for modern.
    const deck: DeckCard[] = [
      card({ name: 'Swamp', type_line: 'Land', count: 38 }),
      card({ name: 'big', cmc: 7, count: 12 }),
      card({ name: 'big2', cmc: 6, count: 8 }),
    ];

    const modernResult = compareToOptimal(deck, 'modern');
    const commanderResult = compareToOptimal(deck, 'commander');

    expect(modernResult.totalGap).toBeGreaterThan(commanderResult.totalGap);
  });

  it('attaches gaps and format to the mana curve analysis', () => {
    const deck: DeckCard[] = [
      card({ name: 'Plains', type_line: 'Land', count: 20 }),
      card({ name: 'd2', cmc: 2, count: 2 }),
    ];
    const analysis = analyzeDeck(deck, 'standard');
    expect(analysis.manaCurve.format).toBe('standard');
    expect(Array.isArray(analysis.manaCurve.gaps)).toBe(true);
    expect(analysis.manaCurve.gaps!.length).toBeGreaterThan(0);
  });
});
