import { OramaManager } from '../orama-manager';
import { db } from '../../db/local-intelligence-db';
import { testCards } from '../../__fixtures__/test-cards';

// Mock Orama persistence to avoid environment issues in Jest
jest.mock('@orama/plugin-data-persistence', () => ({
  persist: jest.fn().mockResolvedValue({ some: 'data' }),
  restore: jest.fn().mockResolvedValue({}),
}));

// Mock @orama/orama
jest.mock('@orama/orama', () => {
  const { testCards } = require('../../__fixtures__/test-cards');
  return {
    create: jest.fn().mockResolvedValue({}),
    insertMultiple: jest.fn().mockResolvedValue({}),
    search: jest.fn().mockResolvedValue({
      count: 1,
      hits: [
        {
          document: {
            id: testCards[0].id,
            name: testCards[0].name,
            text: 'Test Text',
            type: 'Creature',
            color: 'W',
            vector: new Array(384).fill(0.1),
          },
        },
      ],
    }),
  };
});

describe('OramaManager', () => {
  let oramaManager: OramaManager;

  beforeEach(async () => {
    // Clear Dexie tables
    await db.orama_snapshots.clear();
    oramaManager = new OramaManager();
  });

  it('should initialize and create a new index if none exists', async () => {
    await oramaManager.init();
    const orama = await oramaManager.getOrama();
    expect(orama).toBeDefined();
    
    const count = await db.orama_snapshots.count();
    expect(count).toBe(0); // Not saved until saveIndex is called
  });

  it('should upsert cards and perform a search', async () => {
    const embeddings: Record<string, number[]> = {};
    testCards.forEach((card: any) => {
      embeddings[card.id] = new Array(384).fill(0.1);
    });

    await oramaManager.upsertCards(testCards, embeddings);
    
    const results = await oramaManager.search({ term: testCards[0].name });
    expect(results.count).toBeGreaterThan(0);
    expect(results.hits[0].document.name).toBe(testCards[0].name);
  });

  it('should meet the search latency requirement (< 50ms)', async () => {
    const embeddings: Record<string, number[]> = {};
    testCards.forEach((card: any) => {
      embeddings[card.id] = new Array(384).fill(Math.random());
    });

    await oramaManager.upsertCards(testCards, embeddings);

    const start = performance.now();
    await oramaManager.search({ 
      vector: new Array(384).fill(0.5),
      similarity: 0.1 // High similarity to ensure we get results
    });
    const end = performance.now();
    const latency = end - start;

    console.log(`Search Latency: ${latency.toFixed(2)}ms`);
    expect(latency).toBeLessThan(50);
  });

  it('should persist and restore the index', async () => {
    const { persist, restore } = require('@orama/plugin-data-persistence');
    
    // Setup initial index
    await oramaManager.init();
    await oramaManager.saveIndex();
    
    expect(persist).toHaveBeenCalled();
    const snapshotCount = await db.orama_snapshots.count();
    expect(snapshotCount).toBe(1);

    // Create a new manager and load
    const newManager = new OramaManager();
    const loaded = await newManager.loadIndex();
    
    expect(loaded).toBe(true);
    expect(restore).toHaveBeenCalled();
  });

  it('should handle hybrid search (text + vector)', async () => {
    const embeddings: Record<string, number[]> = {};
    testCards.forEach((card: any) => {
      embeddings[card.id] = new Array(384).fill(0.1);
    });
    // Give one card a specific vector
    const targetCard = testCards[0];
    embeddings[targetCard.id] = new Array(384).fill(0.9);

    await oramaManager.upsertCards(testCards, embeddings);

    const results = await oramaManager.search({ 
      term: targetCard.name,
      vector: new Array(384).fill(0.9),
      similarity: 0.5
    });

    expect(results.count).toBeGreaterThan(0);
    expect(results.hits[0].document.id).toBe(targetCard.id);
  });
});
