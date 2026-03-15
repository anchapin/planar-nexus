
import { getDatabaseStatus, getAllCards, initializeCardDatabase, clearDatabase } from '../card-database';
import { testCards } from '../__fixtures__/test-cards';

describe('Global Test Seeding', () => {
  beforeEach(async () => {
    // Reset database for each test
    await clearDatabase();
  });

  it('should seed data using global seedTestData', async () => {
    await global.seedTestData();
    
    await initializeCardDatabase();
    const status = await getDatabaseStatus();
    const allCards = await getAllCards();
    
    expect(status.loaded).toBe(true);
    expect(allCards.length).toBe(testCards.length);
    
    // Check if some expected cards are present
    const cardNames = allCards.map(c => c.name);
    expect(cardNames).toContain('Plains');
    expect(cardNames).toContain('Test Creature');
  });

  it('should seed custom cards using global seedTestData', async () => {
    const customCards = [
      {
        id: 'custom-1',
        name: 'Custom Card 1',
        cmc: 1,
        type_line: 'Creature',
        oracle_text: 'Test',
        colors: ['W'],
        color_identity: ['W'],
        legalities: { commander: 'legal' }
      }
    ];
    
    await global.seedTestData(customCards);
    
    await initializeCardDatabase();
    const allCards = await getAllCards();
    
    expect(allCards.length).toBe(1);
    expect(allCards[0].name).toBe('Custom Card 1');
  });

  it('should clear data using global clearTestData', async () => {
    // First seed some data
    await (global as any).seedTestData();
    
    // Then clear it
    (global as any).clearTestData();
    
    // Check mock database status
    // @ts-expect-error - mockCardDatabase is not in the global type definition
    expect(global.mockCardDatabase.cards.length).toBe(0);
    // @ts-expect-error - mockCardDatabase is not in the global type definition
    expect(global.mockCardDatabase.isInitialized).toBe(false);
  });
});
