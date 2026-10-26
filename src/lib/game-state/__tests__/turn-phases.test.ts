/**
 * Comprehensive unit tests for Turn Phases System
 * Issue #323: Add comprehensive unit tests for game engine modules
 *
 * Tests turn structure including:
 * - Phase progression
 * - Phase-specific rules
 * - Priority timing
 * - Extra turns
 */

import {
  getNextPhase,
  getPreviousPhase,
  isMainPhase,
  isCombatPhase,
  playersGetPriority,
  playerDrawsCard,
  createTurn,
  advancePhase,
  startNextTurn,
  addExtraTurn,
  hasExtraTurn,
  canCastSorcerySpeedSpells,
  canCastInstantSpeedSpells,
  isCombatDamageStep,
  isBeginningPhase,
  isEndingPhase,
  getPhaseName,
  getPhaseShortName,
} from '../turn-phases';
import { Phase } from '../types';
import {
  createInitialGameState,
  startGame,
  passPriority,
  checkStateBasedActions,
} from '../game-state';
import { createCardInstance } from '../card-instance';
import { dealDamageToCard } from '../keyword-actions';
import type { GameState, PlayerId, ScryfallCard } from '../types';

/**
 * Mock creature card data for the cleanup-step tests (CR 514.2, #2873).
 */
function mockCreature(name: string, power: number, toughness: number): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type_line: 'Creature — Test',
    power: power.toString(),
    toughness: toughness.toString(),
    keywords: [],
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
    legalities: { standard: 'legal', commander: 'legal' },
    card_faces: undefined,
    layout: 'normal',
  } as ScryfallCard;
}

/**
 * Put a creature with `damage` marked on the given player's battlefield.
 */
function putDamagedCreature(
  state: GameState,
  playerId: PlayerId,
  damage: number,
  toughness = 4,
): { state: GameState; cardId: string } {
  const data = mockCreature('Damaged Bear', 2, toughness);
  const zoneKey = `${playerId}-battlefield`;
  const card = createCardInstance(data, playerId, playerId, {
    currentZoneKey: zoneKey,
  });
  const damaged = { ...card, damage };

  const cards = new Map(state.cards);
  cards.set(card.id, damaged);
  const zones = new Map(state.zones);
  const zone = zones.get(zoneKey)!;
  zones.set(zoneKey, { ...zone, cardIds: [...zone.cardIds, card.id] });

  return {
    state: { ...state, cards, zones },
    cardId: card.id,
  };
}

/**
 * Advance the game until the turn reaches `target` by passing priority for
 * the player who currently holds it (CR 117.4).
 */
function advanceToPhase(state: GameState, target: Phase): GameState {
  let current = state;
  for (let i = 0; i < 60 && current.turn.currentPhase !== target; i++) {
    const holder = current.priorityPlayerId!;
    current = passPriority(current, holder);
  }
  return current;
}

describe('Turn Phases - Phase Progression', () => {
  describe('getNextPhase', () => {
    it('should return correct next phase for untap', () => {
      expect(getNextPhase(Phase.UNTAP)).toBe(Phase.UPKEEP);
    });

    it('should return correct next phase for upkeep', () => {
      expect(getNextPhase(Phase.UPKEEP)).toBe(Phase.DRAW);
    });

    it('should return correct next phase for draw', () => {
      expect(getNextPhase(Phase.DRAW)).toBe(Phase.PRECOMBAT_MAIN);
    });

    it('should return correct next phase for precombat main', () => {
      expect(getNextPhase(Phase.PRECOMBAT_MAIN)).toBe(Phase.BEGIN_COMBAT);
    });

    it('should return correct next phase for begin combat', () => {
      expect(getNextPhase(Phase.BEGIN_COMBAT)).toBe(Phase.DECLARE_ATTACKERS);
    });

    it('should return correct next phase for declare attackers', () => {
      expect(getNextPhase(Phase.DECLARE_ATTACKERS)).toBe(Phase.DECLARE_BLOCKERS);
    });

    it('should return correct next phase for declare blockers', () => {
      expect(getNextPhase(Phase.DECLARE_BLOCKERS)).toBe(Phase.COMBAT_DAMAGE_FIRST_STRIKE);
    });

    it('should return correct next phase for first strike damage', () => {
      expect(getNextPhase(Phase.COMBAT_DAMAGE_FIRST_STRIKE)).toBe(Phase.COMBAT_DAMAGE);
    });

    it('should return correct next phase for combat damage', () => {
      expect(getNextPhase(Phase.COMBAT_DAMAGE)).toBe(Phase.END_COMBAT);
    });

    it('should return correct next phase for end combat', () => {
      expect(getNextPhase(Phase.END_COMBAT)).toBe(Phase.POSTCOMBAT_MAIN);
    });

    it('should return correct next phase for postcombat main', () => {
      expect(getNextPhase(Phase.POSTCOMBAT_MAIN)).toBe(Phase.END);
    });

    it('should return correct next phase for end', () => {
      expect(getNextPhase(Phase.END)).toBe(Phase.CLEANUP);
    });

    it('should return null for cleanup (last phase)', () => {
      expect(getNextPhase(Phase.CLEANUP)).toBe(null);
    });
  });

  describe('getPreviousPhase', () => {
    it('should return null for untap (first phase)', () => {
      expect(getPreviousPhase(Phase.UNTAP)).toBe(null);
    });

    it('should return correct previous phase for upkeep', () => {
      expect(getPreviousPhase(Phase.UPKEEP)).toBe(Phase.UNTAP);
    });

    it('should return correct previous phase for cleanup', () => {
      expect(getPreviousPhase(Phase.CLEANUP)).toBe(Phase.END);
    });

    it('should return correct previous phase for combat damage', () => {
      expect(getPreviousPhase(Phase.COMBAT_DAMAGE)).toBe(Phase.COMBAT_DAMAGE_FIRST_STRIKE);
    });
  });
});

describe('Turn Phases - Phase Classification', () => {
  describe('isMainPhase', () => {
    it('should return true for precombat main', () => {
      expect(isMainPhase(Phase.PRECOMBAT_MAIN)).toBe(true);
    });

    it('should return true for postcombat main', () => {
      expect(isMainPhase(Phase.POSTCOMBAT_MAIN)).toBe(true);
    });

    it('should return false for other phases', () => {
      expect(isMainPhase(Phase.UNTAP)).toBe(false);
      expect(isMainPhase(Phase.UPKEEP)).toBe(false);
      expect(isMainPhase(Phase.DRAW)).toBe(false);
      expect(isMainPhase(Phase.BEGIN_COMBAT)).toBe(false);
      expect(isMainPhase(Phase.DECLARE_ATTACKERS)).toBe(false);
      expect(isMainPhase(Phase.END)).toBe(false);
    });
  });

  describe('isCombatPhase', () => {
    it('should return true for combat phases', () => {
      expect(isCombatPhase(Phase.BEGIN_COMBAT)).toBe(true);
      expect(isCombatPhase(Phase.DECLARE_ATTACKERS)).toBe(true);
      expect(isCombatPhase(Phase.DECLARE_BLOCKERS)).toBe(true);
      expect(isCombatPhase(Phase.COMBAT_DAMAGE_FIRST_STRIKE)).toBe(true);
      expect(isCombatPhase(Phase.COMBAT_DAMAGE)).toBe(true);
      expect(isCombatPhase(Phase.END_COMBAT)).toBe(true);
    });

    it('should return false for non-combat phases', () => {
      expect(isCombatPhase(Phase.UNTAP)).toBe(false);
      expect(isCombatPhase(Phase.UPKEEP)).toBe(false);
      expect(isCombatPhase(Phase.DRAW)).toBe(false);
      expect(isCombatPhase(Phase.PRECOMBAT_MAIN)).toBe(false);
      expect(isCombatPhase(Phase.POSTCOMBAT_MAIN)).toBe(false);
      expect(isCombatPhase(Phase.END)).toBe(false);
      expect(isCombatPhase(Phase.CLEANUP)).toBe(false);
    });
  });

  describe('isBeginningPhase', () => {
    it('should return true for beginning phases', () => {
      expect(isBeginningPhase(Phase.UNTAP)).toBe(true);
      expect(isBeginningPhase(Phase.UPKEEP)).toBe(true);
      expect(isBeginningPhase(Phase.DRAW)).toBe(true);
    });

    it('should return false for non-beginning phases', () => {
      expect(isBeginningPhase(Phase.PRECOMBAT_MAIN)).toBe(false);
      expect(isBeginningPhase(Phase.BEGIN_COMBAT)).toBe(false);
      expect(isBeginningPhase(Phase.END)).toBe(false);
    });
  });

  describe('isEndingPhase', () => {
    it('should return true for ending phases', () => {
      expect(isEndingPhase(Phase.END)).toBe(true);
      expect(isEndingPhase(Phase.CLEANUP)).toBe(true);
    });

    it('should return false for non-ending phases', () => {
      expect(isEndingPhase(Phase.PRECOMBAT_MAIN)).toBe(false);
      expect(isEndingPhase(Phase.BEGIN_COMBAT)).toBe(false);
      expect(isEndingPhase(Phase.DRAW)).toBe(false);
    });
  });

  describe('isCombatDamageStep', () => {
    it('should return true for combat damage steps', () => {
      expect(isCombatDamageStep(Phase.COMBAT_DAMAGE_FIRST_STRIKE)).toBe(true);
      expect(isCombatDamageStep(Phase.COMBAT_DAMAGE)).toBe(true);
    });

    it('should return false for non-damage steps', () => {
      expect(isCombatDamageStep(Phase.DECLARE_ATTACKERS)).toBe(false);
      expect(isCombatDamageStep(Phase.DECLARE_BLOCKERS)).toBe(false);
      expect(isCombatDamageStep(Phase.END_COMBAT)).toBe(false);
    });
  });
});

describe('Turn Phases - Priority', () => {
  describe('playersGetPriority', () => {
    it('should return false for untap step', () => {
      expect(playersGetPriority(Phase.UNTAP)).toBe(false);
    });

    it('should return false for cleanup step', () => {
      expect(playersGetPriority(Phase.CLEANUP)).toBe(false);
    });

    it('should return true for phases where players get priority', () => {
      expect(playersGetPriority(Phase.UPKEEP)).toBe(true);
      expect(playersGetPriority(Phase.DRAW)).toBe(true);
      expect(playersGetPriority(Phase.PRECOMBAT_MAIN)).toBe(true);
      expect(playersGetPriority(Phase.BEGIN_COMBAT)).toBe(true);
      expect(playersGetPriority(Phase.DECLARE_ATTACKERS)).toBe(true);
      expect(playersGetPriority(Phase.DECLARE_BLOCKERS)).toBe(true);
      expect(playersGetPriority(Phase.COMBAT_DAMAGE)).toBe(true);
      expect(playersGetPriority(Phase.POSTCOMBAT_MAIN)).toBe(true);
      expect(playersGetPriority(Phase.END)).toBe(true);
    });
  });

  describe('canCastSorcerySpeedSpells', () => {
    it('should return true for main phase with empty stack', () => {
      expect(canCastSorcerySpeedSpells(Phase.PRECOMBAT_MAIN, true)).toBe(true);
      expect(canCastSorcerySpeedSpells(Phase.POSTCOMBAT_MAIN, true)).toBe(true);
    });

    it('should return false for main phase with non-empty stack', () => {
      expect(canCastSorcerySpeedSpells(Phase.PRECOMBAT_MAIN, false)).toBe(false);
      expect(canCastSorcerySpeedSpells(Phase.POSTCOMBAT_MAIN, false)).toBe(false);
    });

    it('should return false for non-main phases', () => {
      expect(canCastSorcerySpeedSpells(Phase.UPKEEP, true)).toBe(false);
      expect(canCastSorcerySpeedSpells(Phase.BEGIN_COMBAT, true)).toBe(false);
      expect(canCastSorcerySpeedSpells(Phase.END, true)).toBe(false);
    });
  });

  describe('canCastInstantSpeedSpells', () => {
    it('should return true for phases where players get priority', () => {
      expect(canCastInstantSpeedSpells(Phase.UPKEEP)).toBe(true);
      expect(canCastInstantSpeedSpells(Phase.DRAW)).toBe(true);
      expect(canCastInstantSpeedSpells(Phase.PRECOMBAT_MAIN)).toBe(true);
      expect(canCastInstantSpeedSpells(Phase.BEGIN_COMBAT)).toBe(true);
      expect(canCastInstantSpeedSpells(Phase.END)).toBe(true);
    });

    it('should return false for phases where no priority is given', () => {
      expect(canCastInstantSpeedSpells(Phase.UNTAP)).toBe(false);
      expect(canCastInstantSpeedSpells(Phase.CLEANUP)).toBe(false);
    });
  });
});

describe('Turn Phases - Turn Management', () => {
  describe('createTurn', () => {
    it('should create a turn with correct initial values', () => {
      const turn = createTurn('player-1', 1, false);
      
      expect(turn.activePlayerId).toBe('player-1');
      expect(turn.currentPhase).toBe(Phase.UNTAP);
      expect(turn.turnNumber).toBe(1);
      expect(turn.extraTurns).toBe(0);
      expect(turn.isFirstTurn).toBe(false);
      expect(turn.startedAt).toBeDefined();
    });

    it('should create first turn correctly', () => {
      const turn = createTurn('player-1', 1, true);
      
      expect(turn.isFirstTurn).toBe(true);
    });
  });

  describe('advancePhase', () => {
    it('should advance to next phase', () => {
      const turn = createTurn('player-1', 1, false);
      turn.currentPhase = Phase.UPKEEP;
      
      const advanced = advancePhase(turn);
      
      expect(advanced.currentPhase).toBe(Phase.DRAW);
    });

    it('should not change turn when at cleanup', () => {
      const turn = createTurn('player-1', 1, false);
      turn.currentPhase = Phase.CLEANUP;
      
      const advanced = advancePhase(turn);
      
      // At cleanup, getNextPhase returns null, so turn stays the same
      expect(advanced.currentPhase).toBe(Phase.CLEANUP);
    });
  });

  describe('startNextTurn', () => {
    it('should start next player\'s turn', () => {
      const turn = createTurn('player-1', 1, false);
      
      const nextTurn = startNextTurn(turn, 'player-2', false);
      
      expect(nextTurn.activePlayerId).toBe('player-2');
      expect(nextTurn.currentPhase).toBe(Phase.UNTAP);
      expect(nextTurn.turnNumber).toBe(2);
    });

    it('should handle first turn of game', () => {
      const turn = createTurn('player-1', 1, true);
      
      const nextTurn = startNextTurn(turn, 'player-2', true);
      
      expect(nextTurn.isFirstTurn).toBe(true);
      expect(nextTurn.turnNumber).toBe(1); // Still turn 1 for first turn of game
    });

    it('should decrement extra turns', () => {
      const turn = createTurn('player-1', 1, false);
      turn.extraTurns = 2;
      
      const nextTurn = startNextTurn(turn, 'player-2', false);
      
      expect(nextTurn.extraTurns).toBe(1);
    });
  });

  describe('addExtraTurn', () => {
    it('should add extra turns', () => {
      const turn = createTurn('player-1', 1, false);
      
      const withExtra = addExtraTurn(turn, 2);
      
      expect(withExtra.extraTurns).toBe(2);
    });

    it('should accumulate extra turns', () => {
      const turn = createTurn('player-1', 1, false);
      turn.extraTurns = 1;
      
      const withExtra = addExtraTurn(turn, 3);
      
      expect(withExtra.extraTurns).toBe(4);
    });

    it('should default to adding 1 extra turn', () => {
      const turn = createTurn('player-1', 1, false);
      
      const withExtra = addExtraTurn(turn);
      
      expect(withExtra.extraTurns).toBe(1);
    });
  });

  describe('hasExtraTurn', () => {
    it('should return true when extra turns available', () => {
      const turn = createTurn('player-1', 1, false);
      turn.extraTurns = 2;
      
      expect(hasExtraTurn(turn)).toBe(true);
    });

    it('should return false when no extra turns', () => {
      const turn = createTurn('player-1', 1, false);
      
      expect(hasExtraTurn(turn)).toBe(false);
    });
  });

  describe('playerDrawsCard', () => {
    it('should return false for first turn', () => {
      const turn = createTurn('player-1', 1, true);
      
      expect(playerDrawsCard(turn)).toBe(false);
    });

    it('should return true for subsequent turns', () => {
      const turn = createTurn('player-1', 2, false);
      
      expect(playerDrawsCard(turn)).toBe(true);
    });
  });
});

describe('Turn Phases - Display Names', () => {
  describe('getPhaseName', () => {
    it('should return correct display names', () => {
      expect(getPhaseName(Phase.UNTAP)).toBe('Untap');
      expect(getPhaseName(Phase.UPKEEP)).toBe('Upkeep');
      expect(getPhaseName(Phase.DRAW)).toBe('Draw');
      expect(getPhaseName(Phase.PRECOMBAT_MAIN)).toBe('Pre-Combat Main');
      expect(getPhaseName(Phase.BEGIN_COMBAT)).toBe('Begin Combat');
      expect(getPhaseName(Phase.DECLARE_ATTACKERS)).toBe('Declare Attackers');
      expect(getPhaseName(Phase.DECLARE_BLOCKERS)).toBe('Declare Blockers');
      expect(getPhaseName(Phase.COMBAT_DAMAGE_FIRST_STRIKE)).toBe('Combat Damage (First Strike)');
      expect(getPhaseName(Phase.COMBAT_DAMAGE)).toBe('Combat Damage');
      expect(getPhaseName(Phase.END_COMBAT)).toBe('End Combat');
      expect(getPhaseName(Phase.POSTCOMBAT_MAIN)).toBe('Post-Combat Main');
      expect(getPhaseName(Phase.END)).toBe('End');
      expect(getPhaseName(Phase.CLEANUP)).toBe('Cleanup');
    });
  });

  describe('getPhaseShortName', () => {
    it('should return correct short names', () => {
      expect(getPhaseShortName(Phase.PRECOMBAT_MAIN)).toBe('Main 1');
      expect(getPhaseShortName(Phase.POSTCOMBAT_MAIN)).toBe('Main 2');
      expect(getPhaseShortName(Phase.COMBAT_DAMAGE_FIRST_STRIKE)).toBe('First Strike');
      expect(getPhaseShortName(Phase.COMBAT_DAMAGE)).toBe('Damage');
    });
  });
});

describe('Turn Phases - Edge Cases', () => {
  it('should handle full turn cycle', () => {
    let turn = createTurn('player-1', 1, false);
    
    // Advance through all phases
    const phases = [
      Phase.UNTAP,
      Phase.UPKEEP,
      Phase.DRAW,
      Phase.PRECOMBAT_MAIN,
      Phase.BEGIN_COMBAT,
      Phase.DECLARE_ATTACKERS,
      Phase.DECLARE_BLOCKERS,
      Phase.COMBAT_DAMAGE_FIRST_STRIKE,
      Phase.COMBAT_DAMAGE,
      Phase.END_COMBAT,
      Phase.POSTCOMBAT_MAIN,
      Phase.END,
      Phase.CLEANUP,
    ];
    
    for (const expectedPhase of phases) {
      expect(turn.currentPhase).toBe(expectedPhase);
      turn = advancePhase(turn);
    }
    
    // After cleanup, should still be at cleanup (getNextPhase returns null)
    expect(turn.currentPhase).toBe(Phase.CLEANUP);
  });

  it('should handle multiple extra turns', () => {
    let turn = createTurn('player-1', 1, false);
    turn = addExtraTurn(turn, 3);
    
    expect(hasExtraTurn(turn)).toBe(true);
    expect(turn.extraTurns).toBe(3);
    
    // Simulate taking extra turns
    turn = startNextTurn(turn, 'player-1', false);
    expect(turn.extraTurns).toBe(2);
    
    turn = startNextTurn(turn, 'player-1', false);
    expect(turn.extraTurns).toBe(1);
    
    turn = startNextTurn(turn, 'player-1', false);
    expect(turn.extraTurns).toBe(0);
    expect(hasExtraTurn(turn)).toBe(false);
  });
});
describe('Cleanup step - CR 514.2 damage removal (issue #2873)', () => {
  function setup(damage = 3, toughness = 4) {
    let state = startGame(createInitialGameState(['Alice', 'Bob'], 20, false));
    const aliceId = Array.from(state.players.keys())[0] as PlayerId;
    const placed = putDamagedCreature(state, aliceId, damage, toughness);
    return { state: placed.state, cardId: placed.cardId, aliceId };
  }

  it('removes marked damage when the phase advances into cleanup, and not before', () => {
    const { state, cardId } = setup(3, 4);

    const midTurn = advanceToPhase(state, Phase.POSTCOMBAT_MAIN);
    expect(midTurn.turn.currentPhase).toBe(Phase.POSTCOMBAT_MAIN);
    expect(midTurn.cards.get(cardId as never)?.damage).toBe(3);

    const cleanup = advanceToPhase(midTurn, Phase.CLEANUP);
    expect(cleanup.turn.currentPhase).toBe(Phase.CLEANUP);
    expect(cleanup.cards.get(cardId as never)?.damage).toBe(0);
  });

  it('a creature at toughness - damage = 1 is not killed by a 1-damage ping after cleanup', () => {
    const { state, cardId, aliceId } = setup(3, 4);

    const cleanup = advanceToPhase(state, Phase.CLEANUP);
    expect(cleanup.cards.get(cardId as never)?.damage).toBe(0);

    // Advance into the next turn.
    let next = cleanup;
    for (let i = 0; i < 80 && next.turn.turnNumber < 2; i++) {
      next = passPriority(next, next.priorityPlayerId!);
    }
    expect(next.turn.turnNumber).toBe(2);
    expect(next.cards.get(cardId as never)?.damage).toBe(0);

    // A fresh 1-damage ping is not lethal on its own terms (1 < 4).
    const pinged = dealDamageToCard(next, cardId as never, 1);
    expect(pinged.success).toBe(true);
    const afterSba = checkStateBasedActions(pinged.state);
    const battlefield = afterSba.zones.get(`${aliceId}-battlefield`)!;
    expect(battlefield.cardIds).toContain(cardId);
    expect(afterSba.cards.get(cardId as never)?.damage).toBe(1);
  });
});
