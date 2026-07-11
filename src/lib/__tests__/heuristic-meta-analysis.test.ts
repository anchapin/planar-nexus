/**
 * @fileOverview Tests for heuristic meta analysis module
 */

import { describe, it, expect } from '@jest/globals';
import { analyzeMetaHeuristic } from '../heuristic-meta-analysis';

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
});
