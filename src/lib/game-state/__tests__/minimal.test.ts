/**
 * Minimal reproduction test
 */
import {
  createInitialGameState,
  startGame,
} from '../game-state';
import { createCardInstance } from '../card-instance';
import type { ScryfallCard } from '@/app/actions';

const mockCard: ScryfallCard = {
  id: 'mock-creature',
  name: 'Test Creature',
  type_line: 'Creature — Test',
  power: '2',
  toughness: '2',
  keywords: [],
  oracle_text: '{T}: Deal 1 damage',
  mana_cost: '{1}',
  cmc: 1,
  colors: ['R'],
  color_identity: ['R'],
  legalities: { standard: 'legal', commander: 'legal' },
  card_faces: undefined,
  layout: 'normal',
} as ScryfallCard;

describe('Minimal reproduction', () => {
  it('should create correct battlefield zone key', () => {
    let state = createInitialGameState(['Alice', 'Bob'], 20, false);
    state = startGame(state);
    
    const playerIds = Array.from(state.players.keys());
    const aliceId = playerIds[0];
    
    console.log('All zone keys:', Array.from(state.zones.keys()));
    console.log('Alice ID:', aliceId);
    console.log('Looking for battlefield:', `${aliceId}-battlefield`);
    console.log('Found battlefield?:', state.zones.has(`${aliceId}-battlefield`));
    
    const bf1 = state.zones.get(`${aliceId}-battlefield`);
    console.log('Zone with aliceId-battlefield:', bf1 ? 'found' : 'not found');
    
    const bf2 = state.zones.get(`battlefield-${aliceId}`);
    console.log('Zone with battlefield-aliceId:', bf2 ? 'found' : 'not found');
    
    // Now add a card
    const creature = createCardInstance(mockCard, aliceId, aliceId);
    state.cards.set(creature.id, creature);
    
    if (bf1) {
      state.zones.set(`${aliceId}-battlefield`, {
        ...bf1,
        cardIds: [...bf1.cardIds, creature.id],
      });
    }
    
    const updatedBf = state.zones.get(`${aliceId}-battlefield`);
    console.log('Updated battlefield cardIds:', updatedBf?.cardIds);
    
    expect(updatedBf).toBeDefined();
    expect(updatedBf?.cardIds).toContain(creature.id);
  });
});
