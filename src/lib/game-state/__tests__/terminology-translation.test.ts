/**
 * Tests for Terminology Translation Layer
 *
 * Issue #442: Unit 8 - Terminology Translation Layer
 */

import {
  translateToGeneric,
  translateFromGeneric,
  translateTerm,
  translateZone,
  translatePhase,
  translateAction,
  translateCardState,
  getCardStateDescription,
  translateRuleText,
  translateBatch,
  isMTGTerm,
  getAllMTGTerms,
} from '../terminology-translation';

describe('Terminology Translation Layer', () => {
  describe('translateToGeneric', () => {
    it('should translate tap to activate', () => {
      expect(translateToGeneric('Tap this card')).toBe('Activate this card');
    });

    it('should translate untap to deactivate', () => {
      expect(translateToGeneric('Untap this card')).toBe('Deactivate this card');
    });

    it('should translate battlefield to play area', () => {
      expect(translateToGeneric('Enter the battlefield')).toBe('Enter the play area');
    });

    it('should translate graveyard to discard pile', () => {
      expect(translateToGeneric('Move to graveyard')).toBe('Move to discard pile');
    });

    it('should translate library to deck', () => {
      expect(translateToGeneric('Search your library')).toBe('Search your deck');
    });

    it('should translate summoning sickness to deployment restriction', () => {
      expect(translateToGeneric('Has summoning sickness')).toBe('Has deployment restriction');
    });

    it('should translate multiple terms in one sentence', () => {
      const input = 'Tap your lands, then untap your creatures on the battlefield';
      const expected = 'Activate your lands, then deactivate your creatures on the play area';
      expect(translateToGeneric(input)).toBe(expected);
    });

    it('should preserve case when appropriate', () => {
      expect(translateToGeneric('Tap')).toBe('Activate');
      expect(translateToGeneric('tap')).toBe('activate');
      expect(translateToGeneric('TAP')).toBe('ACTIVATE'); // All caps preserved
    });

    it('should handle empty strings', () => {
      expect(translateToGeneric('')).toBe('');
    });

    it('should handle strings with no MTG terms', () => {
      expect(translateToGeneric('Draw a card')).toBe('Draw a card');
    });
  });

  describe('translateFromGeneric', () => {
    it('should translate activate back to tap', () => {
      expect(translateFromGeneric('Activate this card')).toBe('Tap this card');
    });

    it('should translate deactivate back to untap', () => {
      expect(translateFromGeneric('Deactivate this card')).toBe('Untap this card');
    });

    it('should translate play area back to battlefield', () => {
      expect(translateFromGeneric('Enter the play area')).toBe('Enter the battlefield');
    });

    it('should translate discard pile back to graveyard', () => {
      expect(translateFromGeneric('Move to discard pile')).toBe('Move to graveyard');
    });
  });

  describe('translateTerm', () => {
    it('should translate single terms', () => {
      expect(translateTerm('tap')).toBe('activate');
      expect(translateTerm('untap')).toBe('deactivate');
      expect(translateTerm('battlefield')).toBe('play area');
    });

    it('should return original term if no mapping exists', () => {
      expect(translateTerm('flying')).toBe('flying');
      expect(translateTerm('keyword')).toBe('keyword');
    });

    it('should be case-insensitive', () => {
      expect(translateTerm('Tap')).toBe('activate');
      expect(translateTerm('BATTLEFIELD')).toBe('play area');
    });
  });

  describe('translateZone', () => {
    it('should translate library to Deck', () => {
      expect(translateZone('library')).toBe('Deck');
    });

    it('should translate hand to Hand', () => {
      expect(translateZone('hand')).toBe('Hand');
    });

    it('should translate battlefield to Play Area', () => {
      expect(translateZone('battlefield')).toBe('Play Area');
    });

    it('should translate graveyard to Discard Pile', () => {
      expect(translateZone('graveyard')).toBe('Discard Pile');
    });

    it('should translate exile to Void', () => {
      expect(translateZone('exile')).toBe('Void');
    });

    it('should translate stack to Action Stack', () => {
      expect(translateZone('stack')).toBe('Action Stack');
    });

    it('should translate command to Reserve Zone', () => {
      expect(translateZone('command')).toBe('Reserve Zone');
    });

    it('should return original zone name if no mapping exists', () => {
      expect(translateZone('unknown')).toBe('unknown');
    });
  });

  describe('translatePhase', () => {
    it('should translate untap to Reactivation', () => {
      expect(translatePhase('untap')).toBe('Reactivation');
    });

    it('should translate upkeep to Maintenance', () => {
      expect(translatePhase('upkeep')).toBe('Maintenance');
    });

    it('should translate draw to Draw', () => {
      expect(translatePhase('draw')).toBe('Draw');
    });

    it('should translate precombat_main to Pre-Combat Main', () => {
      expect(translatePhase('precombat_main')).toBe('Pre-Combat Main');
    });

    it('should translate declare_attackers to Declare Attackers', () => {
      expect(translatePhase('declare_attackers')).toBe('Declare Attackers');
    });

    it('should translate declare_blockers to Declare Blockers', () => {
      expect(translatePhase('declare_blockers')).toBe('Declare Blockers');
    });

    it('should translate combat_damage to Combat Damage', () => {
      expect(translatePhase('combat_damage')).toBe('Combat Damage');
    });

    it('should translate end to End', () => {
      expect(translatePhase('end')).toBe('End');
    });

    it('should translate cleanup to Cleanup', () => {
      expect(translatePhase('cleanup')).toBe('Cleanup');
    });

    it('should return original phase name if no mapping exists', () => {
      expect(translatePhase('unknown')).toBe('unknown');
    });
  });

  describe('translateAction', () => {
    it('should translate tap_card to Activate card', () => {
      expect(translateAction('tap_card')).toBe('Activate card');
    });

    it('should translate untap_card to Deactivate card', () => {
      expect(translateAction('untap_card')).toBe('Deactivate card');
    });

    it('should translate cast_spell to Play card effect', () => {
      expect(translateAction('cast_spell')).toBe('Play card effect');
    });

    it('should translate exile_card to Send to void', () => {
      expect(translateAction('exile_card')).toBe('Send to void');
    });

    it('should translate add_counter to Add marker', () => {
      expect(translateAction('add_counter')).toBe('Add marker');
    });

    it('should translate pay_mana to Pay energy', () => {
      expect(translateAction('pay_mana')).toBe('Pay energy');
    });

    it('should translate add_mana to Add energy', () => {
      expect(translateAction('add_mana')).toBe('Add energy');
    });

    it('should return original action name if no mapping exists', () => {
      expect(translateAction('unknown')).toBe('unknown');
    });
  });

  describe('translateCardState', () => {
    it('should translate tapped card state', () => {
      const state = {
        isTapped: true,
        hasSummoningSickness: false,
        isPhasedOut: false,
      };
      const result = translateCardState(state);
      expect(result).toEqual({
        activation: 'activated',
        deployment: 'ready',
        visibility: 'visible',
      });
    });

    it('should translate untapped card with summoning sickness', () => {
      const state = {
        isTapped: false,
        hasSummoningSickness: true,
        isPhasedOut: false,
      };
      const result = translateCardState(state);
      expect(result).toEqual({
        activation: 'deactivated',
        deployment: 'restricted',
        visibility: 'visible',
      });
    });

    it('should translate phased out card', () => {
      const state = {
        isTapped: false,
        hasSummoningSickness: false,
        isPhasedOut: true,
      };
      const result = translateCardState(state);
      expect(result).toEqual({
        activation: 'deactivated',
        deployment: 'ready',
        visibility: 'phased out',
      });
    });
  });

  describe('getCardStateDescription', () => {
    it('should return "Activated" for tapped card', () => {
      const state = {
        isTapped: true,
        hasSummoningSickness: false,
      };
      expect(getCardStateDescription(state)).toBe('Activated');
    });

    it('should return "Has deployment restriction" for card with summoning sickness', () => {
      const state = {
        isTapped: false,
        hasSummoningSickness: true,
      };
      expect(getCardStateDescription(state)).toBe('Has deployment restriction');
    });

    it('should return both states for tapped card with summoning sickness', () => {
      const state = {
        isTapped: true,
        hasSummoningSickness: true,
      };
      expect(getCardStateDescription(state)).toBe('Activated, Has deployment restriction');
    });

    it('should return "Ready" for ready card', () => {
      const state = {
        isTapped: false,
        hasSummoningSickness: false,
      };
      expect(getCardStateDescription(state)).toBe('Ready');
    });
  });

  describe('translateRuleText', () => {
    it('should translate rule text with MTG terminology', () => {
      const rule = 'At the beginning of your upkeep, tap target creature an opponent controls.';
      const expected = 'At the beginning of your maintenance, activate target creature an opponent controls.';
      expect(translateRuleText(rule)).toBe(expected);
    });

    it('should handle complex rule text', () => {
      const rule = 'When this card enters the battlefield, you may tap or untap target permanent.';
      const expected = 'When this card enters the play area, you may activate or deactivate target permanent.';
      expect(translateRuleText(rule)).toBe(expected);
    });
  });

  describe('translateBatch', () => {
    it('should translate array of strings', () => {
      const texts = ['Tap this card', 'Untap that card', 'Move to graveyard'];
      const expected = ['Activate this card', 'Deactivate that card', 'Move to discard pile'];
      expect(translateBatch(texts)).toEqual(expected);
    });

    it('should handle empty array', () => {
      expect(translateBatch([])).toEqual([]);
    });
  });

  describe('isMTGTerm', () => {
    it('should return true for MTG terms', () => {
      expect(isMTGTerm('tap')).toBe(true);
      expect(isMTGTerm('untap')).toBe(true);
      expect(isMTGTerm('battlefield')).toBe(true);
      expect(isMTGTerm('graveyard')).toBe(true);
      expect(isMTGTerm('summoning sickness')).toBe(true);
    });

    it('should return false for non-MTG terms', () => {
      expect(isMTGTerm('flying')).toBe(false);
      expect(isMTGTerm('creature')).toBe(false);
      expect(isMTGTerm('player')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isMTGTerm('Tap')).toBe(true);
      expect(isMTGTerm('BATTLEFIELD')).toBe(true);
    });
  });

  describe('getAllMTGTerms', () => {
    it('should return array of all MTG terms', () => {
      const terms = getAllMTGTerms();
      expect(Array.isArray(terms)).toBe(true);
      expect(terms.length).toBeGreaterThan(0);
      expect(terms).toContain('tap');
      expect(terms).toContain('untap');
      expect(terms).toContain('battlefield');
      expect(terms).toContain('graveyard');
    });
  });

  describe('Round-trip translation', () => {
    it('should translate to generic and back correctly', () => {
      const original = 'Tap this creature, then untap it on the battlefield';
      const generic = translateToGeneric(original);
      const restored = translateFromGeneric(generic);
      expect(restored).toBe(original);
    });

    it('should handle complex round-trip', () => {
      const original = 'When this card enters the battlefield, you may tap target permanent. If you do, untap another target permanent.';
      const generic = translateToGeneric(original);
      const restored = translateFromGeneric(generic);
      expect(restored).toBe(original);
    });
  });
});
