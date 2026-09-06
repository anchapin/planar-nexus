/**
 * @fileOverview Tests for heuristic meta analysis module
 */

import { describe, it, expect } from '@jest/globals';
import {
  analyzeMetaHeuristic,
  detectDeckArchetype,
} from '../heuristic-meta-analysis';

describe('heuristic-meta-analysis', () => {
  const sampleDeck = [
    { name: 'Sol Ring', count: 1, id: '1', cmc: 1, colors: [], legalities: {}, type_line: 'Artifact', mana_cost: '{1}', color_identity: [] },
    { name: 'Counterspell', count: 4, id: '2', cmc: 2, colors: ['U'], legalities: {}, type_line: 'Instant', mana_cost: '{U}{U}', color_identity: ['U'] },
    { name: 'Thoughtseize', count: 2, id: '3', cmc: 1, colors: ['B'], legalities: {}, type_line: 'Sorcery', mana_cost: '{B}', color_identity: ['B'] },
  ];

  describe('analyzeMetaHeuristic', () => {
    it('should return a valid MetaAnalysisOutput structure', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring\n4 Counterspell', 'commander', sampleDeck);

      expect(result).toHaveProperty('currentMeta');
      expect(result).toHaveProperty('archetypes');
      expect(result).toHaveProperty('recommendations');
      expect(typeof result.currentMeta).toBe('string');
      expect(Array.isArray(result.archetypes)).toBe(true);
      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    it('should provide metagame overview', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);

      expect(result.currentMeta).toBeDefined();
      expect(result.currentMeta.length).toBeGreaterThan(0);
    });

    it('should provide format-specific metagame data', () => {
      const commanderResult = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);
      expect(commanderResult.archetypes.length).toBeGreaterThan(0);

      const modernResult = analyzeMetaHeuristic('1 Sol Ring', 'modern', sampleDeck);
      expect(modernResult.archetypes.length).toBeGreaterThan(0);

      const standardResult = analyzeMetaHeuristic('1 Sol Ring', 'standard', sampleDeck);
      expect(standardResult.archetypes.length).toBeGreaterThan(0);
    });

    it('should generate recommendations', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);

      expect(result.recommendations.length).toBeGreaterThan(0);
      result.recommendations.forEach(rec => {
        expect(rec).toHaveProperty('title');
        expect(rec).toHaveProperty('description');
        expect(rec).toHaveProperty('cardsToAdd');
        expect(rec).toHaveProperty('cardsToRemove');
        expect(rec).toHaveProperty('matchup');
      });
    });

    it('should handle focus archetype parameter', () => {
      const controlResult = analyzeMetaHeuristic('1 Sol Ring', 'modern', sampleDeck, 'control');
      expect(controlResult.recommendations.length).toBeGreaterThan(0);

      const aggroResult = analyzeMetaHeuristic('1 Sol Ring', 'modern', sampleDeck, 'aggro');
      expect(aggroResult.recommendations.length).toBeGreaterThan(0);
    });

    it('should detect deck archetype correctly', () => {
      const controlDeck = [
        { name: 'Counterspell', count: 4, id: '1', cmc: 2, colors: ['U'], legalities: {}, type_line: 'Instant', mana_cost: '{U}{U}', color_identity: ['U'] },
        { name: 'Brainstorm', count: 4, id: '2', cmc: 1, colors: ['U'], legalities: {}, type_line: 'Instant', mana_cost: '{U}', color_identity: ['U'] },
      ];
      const result = analyzeMetaHeuristic('4 Counterspell', 'legacy', controlDeck);

      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('should provide matchup strategies', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);

      result.recommendations.forEach(rec => {
        expect(rec.matchup).toHaveProperty('against');
        expect(rec.matchup).toHaveProperty('strategy');
        expect(typeof rec.matchup.against).toBe('string');
        expect(typeof rec.matchup.strategy).toBe('string');
      });
    });

    it('should suggest card additions and removals', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);

      result.recommendations.forEach(rec => {
        const hasAdditions = rec.cardsToAdd && rec.cardsToAdd.length > 0;
        const hasRemovals = rec.cardsToRemove && rec.cardsToRemove.length > 0;

        expect(hasAdditions || hasRemovals).toBe(true);

        if (hasAdditions) {
          rec.cardsToAdd.forEach(card => {
            expect(card).toHaveProperty('name');
            expect(card).toHaveProperty('quantity');
            expect(typeof card.name).toBe('string');
            expect(typeof card.quantity).toBe('number');
          });
        }

        if (hasRemovals) {
          rec.cardsToRemove.forEach(card => {
            expect(card).toHaveProperty('name');
            expect(card).toHaveProperty('quantity');
            expect(typeof card.name).toBe('string');
            expect(typeof card.quantity).toBe('number');
          });
        }
      });
    });

    it('should handle empty deck gracefully', () => {
      const result = analyzeMetaHeuristic('', 'commander', []);

      expect(result).toBeDefined();
      expect(result.currentMeta).toBeDefined();
      expect(result.archetypes).toBeDefined();
      expect(result.recommendations).toBeDefined();
    });

    it('should provide archetypes with required properties', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);

      result.archetypes.forEach(archetype => {
        expect(archetype).toHaveProperty('name');
        expect(archetype).toHaveProperty('prevalence');
        expect(archetype).toHaveProperty('playstyle');
        expect(archetype).toHaveProperty('keyCards');
        expect(archetype).toHaveProperty('weaknesses');
      });
    });

    it('should include key cards in archetypes', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);

      result.archetypes.forEach(archetype => {
        expect(archetype.keyCards).toBeInstanceOf(Array);
        expect(archetype.keyCards.length).toBeGreaterThan(0);
      });
    });

    it('should include weaknesses in archetypes', () => {
      const result = analyzeMetaHeuristic('1 Sol Ring', 'commander', sampleDeck);

      result.archetypes.forEach(archetype => {
        expect(archetype.weaknesses).toBeInstanceOf(Array);
        expect(archetype.weaknesses.length).toBeGreaterThan(0);
      });
    });
  });

  /**
   * Issue #1445 — three concrete defects in the heuristic archetype engine:
   *
   *   1. `MATCHUP_GUIDE` is keyed with capitalized names (`Control`, `Aggro`,
   *      ...) but `detectDeckArchetype` returns lowercase keys, so every deck
   *      silently fell back to the Midrange strategy.
   *   2. `analyzeMetaAndSuggest` fed the heuristic cards with `type_line:
   *      'Unknown'` placeholders, so the creature/instant ratio bonuses
   *      could never fire from the AI flow path.
   *   3. The ramp keyword list contained a bare `'x'`, which matched the
   *      substring `x` in any card name and inflated the ramp score.
   *
   * These tests pin the corrected behavior end-to-end via the public API.
   * The strategy strings come straight from MATCHUP_GUIDE; if any future
   * change edits the strategy copy, the assertions will need to follow.
   */
  describe('issue #1445 — archetype detection and matchup lookup', () => {
    const CONTROL_STRATEGY =
      'Play slowly and protect your threats. Use countermagic strategically on key spells. Draw cards to find answers.';
    const AGGRO_STRATEGY =
      'Apply pressure early and often. Don\'t overextend into mass removal. Save burn for reach.';
    const MIDRANGE_STRATEGY =
      'Play value creatures and generate card advantage. Use removal efficiently. Be patient.';
    const COMBO_STRATEGY =
      'Find combo pieces quickly with card draw and tutors. Protect combo with countermagic. Have backup plans.';
    const RAMP_STRATEGY =
      'Ramp early and play big threats. Use card draw to find bombs. Protect ramp with countermagic.';

    const card = (
      name: string,
      count: number,
      type_line: string,
    ): {
      name: string;
      count: number;
      id: string;
      cmc: number;
      colors: string[];
      legalities: Record<string, string>;
      type_line: string;
      mana_cost: string;
      color_identity: string[];
    } => ({
      name,
      count,
      id: name,
      cmc: 0,
      colors: [],
      legalities: {},
      type_line,
      mana_cost: '{0}',
      color_identity: [],
    });

    it('returns the Control matchup strategy for a control-heavy decklist', () => {
      // High Instant ratio + 'counter' / 'wrath' keywords in card names →
      // creatureRatio below the aggro threshold, instantRatio above 0.15,
      // no ramp / tribal signals → archetype must be 'control' and the
      // recommendation strategy must come from MATCHUP_GUIDE.Control.
      const deck = [
        card('Counterspell', 4, 'Instant'),
        card('Force of Will', 4, 'Instant'),
        card('Brainstorm', 4, 'Instant'),
        card('Ponder', 4, 'Instant'),
        card('Doom Blade', 4, 'Instant'),
        card('Wrath of God', 4, 'Sorcery'),
        card('Island', 2, 'Basic Land'),
      ];
      const result = analyzeMetaHeuristic(
        '4 Counterspell\n4 Force of Will\n4 Brainstorm\n4 Ponder\n4 Doom Blade\n4 Wrath of God\n2 Island',
        'modern',
        deck,
      );

      expect(result.recommendations.length).toBeGreaterThan(0);
      // Pre-#1445 every deck received the Midrange strategy because the
      // MATCHUP_GUIDE lookup was case-mismatched. Pin every recommendation.
      result.recommendations.forEach(rec => {
        expect(rec.matchup.strategy).toBe(CONTROL_STRATEGY);
      });
    });

    it('returns the Aggro matchup strategy for a creature-heavy decklist', () => {
      // Creature ratio > 0.4 → +5 aggro, +3 tribal. Plus 'burn' keyword in
      // Burning-Tree Emissary. instantRatio stays above 0.15 too, so the
      // control bonus fires — but the aggro total still wins. Tribal (3)
      // loses to aggro (9).
      const deck = [
        card('Burning-Tree Emissary', 4, 'Creature'),
        card('Anax, Hardened in the Forge', 4, 'Creature'),
        card('Earthshaker Khenra', 4, 'Creature'),
        card('Soul-Scar Mage', 4, 'Creature'),
        card('Akoum Hellhound', 4, 'Creature'),
        card('Lightning Bolt', 4, 'Instant'),
        card('Lava Spike', 4, 'Sorcery'),
        card('Searing Blaze', 4, 'Instant'),
        card('Boros Charm', 4, 'Instant'),
        card('Mountain', 2, 'Basic Land'),
      ];
      const result = analyzeMetaHeuristic(
        '4 Burning-Tree Emissary\n4 Anax\n4 Earthshaker Khenra\n4 Soul-Scar Mage\n4 Akoum Hellhound\n4 Lightning Bolt\n4 Lava Spike\n4 Searing Blaze\n4 Boros Charm\n2 Mountain',
        'modern',
        deck,
      );

      expect(result.recommendations.length).toBeGreaterThan(0);
      result.recommendations.forEach(rec => {
        expect(rec.matchup.strategy).toBe(AGGRO_STRATEGY);
      });
    });

    it('returns the Midrange matchup strategy for a midrange decklist', () => {
      // No extreme creature/instant ratios (creatureRatio = 0.333, instantRatio
      // = 0). Midrange wins purely on the 'mid' keyword hitting "Midnight
      // Clock" + "Midnight Reaper". Aggro/Control bonuses do not fire.
      // Three creatures × 4 = 12 / 36 total = 0.333 (under the 0.4 aggro
      // threshold).
      const deck = [
        card('Midnight Clock', 4, 'Artifact'),
        card('Midnight Reaper', 4, 'Creature'),
        card('Tarmogoyf', 4, 'Creature'),
        card('Snapcaster Mage', 4, 'Creature'),
        card('Liliana of the Veil', 4, 'Planeswalker'),
        card('Karn Liberated', 4, 'Planeswalker'),
        card('Thoughtseize', 4, 'Sorcery'),
        card('Inquisition of Kozilek', 4, 'Sorcery'),
        card('Wastes', 4, 'Basic Land'),
      ];
      const result = analyzeMetaHeuristic(
        '4 Midnight Clock\n4 Midnight Reaper\n4 Tarmogoyf\n4 Snapcaster Mage\n4 Liliana of the Veil\n4 Karn Liberated\n4 Thoughtseize\n4 Inquisition of Kozilek\n4 Wastes',
        'modern',
        deck,
      );

      expect(result.recommendations.length).toBeGreaterThan(0);
      result.recommendations.forEach(rec => {
        expect(rec.matchup.strategy).toBe(MIDRANGE_STRATEGY);
      });
    });

    it('returns the Combo matchup strategy for a combo decklist', () => {
      // Cards containing 'engine' → high combo score. No creatures/instants
      // → no aggro/control bonuses fire. Combo must win.
      const deck = [
        card('Paradox Engine', 4, 'Artifact'),
        card('Engineered Explosives', 4, 'Artifact'),
        card('Sai, Master Thopterist', 4, 'Creature'),
        card('Ornithopter', 4, 'Artifact Creature'),
        card('Memnite', 4, 'Artifact Creature'),
        card('Chromatic Star', 4, 'Artifact'),
        card('Chromatic Sphere', 4, 'Artifact'),
        card('Darksteel Citadel', 4, 'Artifact'),
        card('Mox Opal', 4, 'Artifact'),
        card('Springleaf Drum', 4, 'Artifact'),
      ];
      const result = analyzeMetaHeuristic(
        '4 Paradox Engine\n4 Engineered Explosives\n4 Sai, Master Thopterist\n4 Ornithopter\n4 Memnite\n4 Chromatic Star\n4 Chromatic Sphere\n4 Darksteel Citadel\n4 Mox Opal\n4 Springleaf Drum',
        'modern',
        deck,
      );

      expect(result.recommendations.length).toBeGreaterThan(0);
      result.recommendations.forEach(rec => {
        expect(rec.matchup.strategy).toBe(COMBO_STRATEGY);
      });
    });

    it('does not classify cards containing "x" as ramp', () => {
      // Regression test for the `'x'` substring bug. Before the fix each
      // card below contributed a ramp point per occurrence of the letter
      // 'x', so a deck of exploration-themed cards was mis-classified as
      // ramp and received the Ramp strategy. After the fix the 'x' token
      // is dropped from the ramp keyword list and the strategy must NOT
      // be the Ramp strategy for this deck.
      const deck = [
        card('Explore', 4, 'Sorcery'),
        card('Expressive Iteration', 4, 'Sorcery'),
        card('Ponder', 4, 'Sorcery'),
        card('Brainstorm', 4, 'Instant'),
      ];
      const result = analyzeMetaHeuristic(
        '4 Explore\n4 Expressive Iteration\n4 Ponder\n4 Brainstorm',
        'modern',
        deck,
      );

      expect(result.recommendations.length).toBeGreaterThan(0);
      result.recommendations.forEach(rec => {
        expect(rec.matchup.strategy).not.toBe(RAMP_STRATEGY);
      });
    });
  });

  /**
   * Issue #1564 — surface `confidence` (level + normalised score) and
   * `runnerUp` from `detectDeckArchetype` so the UI can flag weak detections.
   *
   * Design notes:
   *   - All test decks use cards whose `type_line` is `'Artifact'` so the
   *     creature/instant ratio bonuses (`aggro +5 / tribal +3 / control +5`)
   *     never fire. That way the keyword totals are exactly the count of
   *     keyword substring matches in the deck name corpus and we can pin
   *     the 2-point boundary deterministically.
   *   - The heuristic engine lowercases every card NAME (not weighted by
   *     `count`) and runs a global substring match against each keyword.
   *     To get N hits for a keyword we therefore emit N unique card names
   *     that each contain the keyword exactly once. The helpers
   *     `aggroNames(n)` / `controlNames(n)` below build those names —
   *     e.g. `'Burn-One'` and `'Counterpart-One'` each match one keyword.
   *
   * Boundary table (margin = topScore − runnerUpScore):
   *   margin <  2            → 'low'
   *   2 <= margin <= 4       → 'medium'
   *   margin >= 5            → 'high'
   *   totalHits == 0         → 'none' (primary falls back to 'midrange')
   */
  describe('issue #1564 — detectDeckArchetype confidence + runner-up', () => {
    /** Helper: build a minimal card stub. `type_line: 'Artifact'` keeps the
     *  creature/instant ratio bonuses dormant. */
    const stub = (
      name: string,
      count: number,
    ): {
      name: string;
      count: number;
      id: string;
      cmc: number;
      colors: string[];
      legalities: Record<string, string>;
      type_line: string;
      mana_cost: string;
      color_identity: string[];
    } => ({
      name,
      count,
      id: name,
      cmc: 0,
      colors: [],
      legalities: {},
      type_line: 'Artifact',
      mana_cost: '{0}',
      color_identity: [],
    });

    /** `n` unique aggro-signal card names (each matches 'burn' exactly once). */
    const aggroNames = (n: number): string[] =>
      Array.from({ length: n }, (_, i) => `Burn-${i + 1}`);
    /** `n` unique control-signal card names (each matches 'counter' exactly once). */
    const controlNames = (n: number): string[] =>
      Array.from({ length: n }, (_, i) => `Counterpart-${i + 1}`);

    /** Build a deck with `aggro` aggro-signal cards and `control`
     *  control-signal cards. Type is non-Creature / non-Instant so the
     *  ratio bonuses never fire. */
    const deck = (
      aggro: number,
      control: number,
    ): ReturnType<typeof stub>[] => [
      ...aggroNames(aggro).map((n) => stub(n, 1)),
      ...controlNames(control).map((n) => stub(n, 1)),
    ];

    // ---------------------------------------------------------------------
    // 2-point threshold — the deterministic boundary at issue #1564 AC.
    // ---------------------------------------------------------------------
    it('marks margin === 1 as low confidence (below the 2-point threshold)', () => {
      // 4 aggro-signal cards + 3 control-signal cards → margin = 4 - 3 = 1.
      const result = detectDeckArchetype(deck(4, 3));
      expect(result.primary).toBe('aggro');
      expect(result.runnerUp).toBe('control');
      expect(result.confidence.margin).toBe(1);
      expect(result.confidence.level).toBe('low');
      // Normalised score must lie in [0, 1].
      expect(result.confidence.score).toBeGreaterThanOrEqual(0);
      expect(result.confidence.score).toBeLessThanOrEqual(1);
    });

    it('marks margin === 2 as medium confidence (at-or-above the 2-point threshold)', () => {
      // 4 aggro + 2 control → margin = 2.
      // Issue #1564 AC: "differ by fewer than 2 points" → 'low'. Strict <
      // means a gap of exactly 2 is NOT low — it is the first 'medium' band.
      const result = detectDeckArchetype(deck(4, 2));
      expect(result.primary).toBe('aggro');
      expect(result.runnerUp).toBe('control');
      expect(result.confidence.margin).toBe(2);
      expect(result.confidence.level).toBe('medium');
    });

    it('marks margin === 4 as medium confidence (still below the 5-point band)', () => {
      const result = detectDeckArchetype(deck(5, 1));
      expect(result.primary).toBe('aggro');
      expect(result.runnerUp).toBe('control');
      expect(result.confidence.margin).toBe(4);
      expect(result.confidence.level).toBe('medium');
    });

    it('marks margin === 5 as high confidence (at the 5-point threshold)', () => {
      // Issue #1564 AC: "exceeds the runner-up by 5 or more" → 'high'.
      const result = detectDeckArchetype(deck(6, 1));
      expect(result.primary).toBe('aggro');
      expect(result.runnerUp).toBe('control');
      expect(result.confidence.margin).toBe(5);
      expect(result.confidence.level).toBe('high');
    });

    it('marks margin === 8 as high confidence (well above the 5-point band)', () => {
      const result = detectDeckArchetype(deck(9, 1));
      expect(result.primary).toBe('aggro');
      expect(result.runnerUp).toBe('control');
      expect(result.confidence.margin).toBe(8);
      expect(result.confidence.level).toBe('high');
    });

    // ---------------------------------------------------------------------
    // Runner-up selection — correctness + edge cases.
    // ---------------------------------------------------------------------
    it('returns the second-highest archetype as runnerUp when scores are distinct', () => {
      // control('counter') = 5, aggro('burn') = 3, combo('engine') = 1.
      // Two distinct runners exist; runnerUp must be strictly the 2nd.
      // We append a single combo-signal card so control/aggro are the top 2.
      const result = detectDeckArchetype([
        ...controlNames(5).map((n) => stub(n, 1)),
        ...aggroNames(3).map((n) => stub(n, 1)),
        stub('Engine-One', 1), // 'engine' → combo +1
      ]);
      expect(result.primary).toBe('control');
      expect(result.runnerUp).toBe('aggro');
      expect(result.confidence.margin).toBe(2);
    });

    it('returns runnerUp = null when scores are tied at the top', () => {
      // aggro('burn') = 1, control('counter') = 1 → tied at the top.
      // The strict `<` check in the runner-up logic means a tie yields null.
      const result = detectDeckArchetype(deck(1, 1));
      expect(result.primary).toBe('aggro');
      expect(result.runnerUp).toBeNull();
      expect(result.confidence.margin).toBe(0);
      expect(result.confidence.level).toBe('low');
    });

    it('returns runnerUp = null when only one archetype has any hits', () => {
      // 4 aggro-signal cards, zero control-signal → there is no second place.
      const result = detectDeckArchetype(deck(4, 0));
      expect(result.primary).toBe('aggro');
      expect(result.runnerUp).toBeNull();
      // No runner-up means the heuristic is fully committed to the top
      // pick — normalised score must equal 1.0.
      expect(result.confidence.score).toBe(1);
      expect(result.confidence.margin).toBe(4);
    });

    // ---------------------------------------------------------------------
    // Fallback behaviour (issue #1564 AC: "primary falls back to 'midrange'").
    // ---------------------------------------------------------------------
    it("returns primary = 'midrange' and level = 'none' for an empty deck", () => {
      const result = detectDeckArchetype([]);
      expect(result.primary).toBe('midrange');
      expect(result.runnerUp).toBeNull();
      expect(result.confidence.level).toBe('none');
      expect(result.confidence.score).toBe(0);
      expect(result.confidence.margin).toBe(0);
    });

    it("returns primary = 'midrange' and level = 'none' when no keyword hits", () => {
      // 'Sol Ring' contains none of the keyword tokens in the archetype
      // detection sets (no 'counter', 'burn', 'engine', 'mana', 'lord', …).
      const result = detectDeckArchetype([stub('Sol Ring', 1)]);
      expect(result.primary).toBe('midrange');
      expect(result.runnerUp).toBeNull();
      expect(result.confidence.level).toBe('none');
    });

    // ---------------------------------------------------------------------
    // Normalised score — stays in [0, 1] across all bands.
    // ---------------------------------------------------------------------
    it('always returns confidence.score in the closed interval [0, 1]', () => {
      const cases: Array<ReturnType<typeof stub>[]> = [
        deck(4, 3), // margin 1 → low
        deck(4, 2), // margin 2 → medium
        deck(9, 1), // margin 8 → high
        deck(4, 0), // single-archetype → 1.0
        deck(1, 1), // tied → 0
        [], // empty → 0
      ];
      for (const d of cases) {
        const { score } = detectDeckArchetype(d).confidence;
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });

    // ---------------------------------------------------------------------
    // `scores` payload — exposes every archetype so callers can render their
    // own UI (e.g. a bar chart) without re-running the algorithm.
    // ---------------------------------------------------------------------
    it('exposes the full per-archetype score map in `scores`', () => {
      const result = detectDeckArchetype(deck(4, 3));
      expect(result.scores).toEqual({
        aggro: 4,
        control: 3,
        midrange: 0,
        combo: 0,
        ramp: 0,
        tribal: 0,
      });
    });

    // ---------------------------------------------------------------------
    // Plumbing — the structured result must reach the public analyzer.
    // ---------------------------------------------------------------------
    it('forwards the structured detection result on analyzeMetaHeuristic', () => {
      const out = analyzeMetaHeuristic(
        '4 Burn-1\n4 Burn-2\n4 Burn-3\n4 Burn-4\n3 Counterpart-1\n3 Counterpart-2\n3 Counterpart-3',
        'modern',
        deck(4, 3),
      );
      expect(out.deckArchetypeDetection).toBeDefined();
      expect(out.deckArchetypeDetection?.primary).toBe('aggro');
      expect(out.deckArchetypeDetection?.runnerUp).toBe('control');
      expect(out.deckArchetypeDetection?.confidence.level).toBe('low');
      // Existing fields are unchanged — backward compatibility for the
      // legacy contract (string archetype lookup).
      expect(out.currentMeta).toEqual(expect.any(String));
      expect(out.archetypes.length).toBeGreaterThan(0);
      expect(out.recommendations.length).toBeGreaterThan(0);
    });
  });
});
