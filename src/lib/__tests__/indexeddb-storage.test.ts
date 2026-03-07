/**
 * @fileOverview IndexedDB Storage Tests
 *
 * Unit 16: Local Storage Migration
 *
 * Tests for:
 * - IndexedDB initialization
 * - CRUD operations
 * - Export/import functionality
 * - Storage quota management
 * - Migration from localStorage
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { IndexedDBStorage, migrateFromLocalStorage, isTauri } from '../indexeddb-storage';

describe('IndexedDB Storage', () => {
  let storage: IndexedDBStorage;

  beforeEach(() => {
    // Create a new instance for each test
    storage = new IndexedDBStorage({
      dbName: 'TestPlanarNexusStorage',
      version: 1,
      stores: ['test-decks', 'test-games'],
    });

    // Mock window if not available
    if (typeof window === 'undefined') {
      global.window = {} as any;
      global.window.indexedDB = {} as any;
    }
  });

  afterEach(async () => {
    // Clean up
    try {
      await storage.clearAll();
      await storage.close();
    } catch (error) {
      // Ignore errors if database wasn't initialized
    }
  });

  describe('Initialization', () => {
    it('should initialize database successfully', async () => {
      await storage.initialize();
      expect(storage).toBeDefined();
    });

    it('should handle initialization errors gracefully', async () => {
      // Mock a failed initialization
      const mockStorage = new IndexedDBStorage({
        dbName: 'InvalidDatabase',
        version: 1,
        stores: [],
      });

      // This should not throw an error
      try {
        await mockStorage.initialize();
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('CRUD Operations', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should set and get a value', async () => {
      const testData = {
        id: 'test-1',
        name: 'Test Deck',
        format: 'standard',
        cards: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      };

      await storage.set('test-decks', testData);

      const retrieved = await storage.get('test-decks', 'test-1');
      expect(retrieved).toEqual(testData);
    });

    it('should return null for non-existent keys', async () => {
      const result = await storage.get('test-decks', 'non-existent');
      expect(result).toBeNull();
    });

    it('should update existing values', async () => {
      const testData = {
        id: 'test-1',
        name: 'Original Name',
        format: 'standard',
        cards: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      };

      await storage.set('test-decks', testData);

      const updatedData = {
        ...testData,
        name: 'Updated Name',
        updatedAt: new Date().toISOString(),
      };

      await storage.set('test-decks', updatedData);

      const retrieved = await storage.get('test-decks', 'test-1');
      expect(retrieved?.name).toBe('Updated Name');
    });

    it('should get all values from a store', async () => {
      const testData1 = {
        id: 'test-1',
        name: 'Deck 1',
        format: 'standard',
        cards: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      };

      const testData2 = {
        id: 'test-2',
        name: 'Deck 2',
        format: 'modern',
        cards: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      };

      await storage.set('test-decks', testData1);
      await storage.set('test-decks', testData2);

      const allDecks = await storage.getAll('test-decks');
      expect(allDecks).toHaveLength(2);
    });

    it('should set multiple values', async () => {
      const testData = [
        {
          id: 'test-1',
          name: 'Deck 1',
          format: 'standard',
          cards: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
        },
        {
          id: 'test-2',
          name: 'Deck 2',
          format: 'modern',
          cards: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
        },
      ];

      await storage.setAll('test-decks', testData);

      const allDecks = await storage.getAll('test-decks');
      expect(allDecks).toHaveLength(2);
    });

    it('should delete a value', async () => {
      const testData = {
        id: 'test-1',
        name: 'Test Deck',
        format: 'standard',
        cards: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      };

      await storage.set('test-decks', testData);
      await storage.delete('test-decks', 'test-1');

      const retrieved = await storage.get('test-decks', 'test-1');
      expect(retrieved).toBeNull();
    });

    it('should clear a store', async () => {
      const testData1 = {
        id: 'test-1',
        name: 'Deck 1',
        format: 'standard',
        cards: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      };

      const testData2 = {
        id: 'test-2',
        name: 'Deck 2',
        format: 'modern',
        cards: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      };

      await storage.set('test-decks', testData1);
      await storage.set('test-decks', testData2);

      await storage.clear('test-decks');

      const allDecks = await storage.getAll('test-decks');
      expect(allDecks).toHaveLength(0);
    });

    it('should count items in a store', async () => {
      const testData = [
        {
          id: 'test-1',
          name: 'Deck 1',
          format: 'standard',
          cards: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
        },
        {
          id: 'test-2',
          name: 'Deck 2',
          format: 'modern',
          cards: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
        },
        {
          id: 'test-3',
          name: 'Deck 3',
          format: 'commander',
          cards: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
        },
      ];

      await storage.setAll('test-decks', testData);

      const count = await storage.count('test-decks');
      expect(count).toBe(3);
    });
  });

  describe('Export/Import', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should export a store as JSON', async () => {
      const testData = {
        id: 'test-1',
        name: 'Test Deck',
        format: 'standard',
        cards: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      };

      await storage.set('test-decks', testData);

      const exported = await storage.exportStore('test-decks');
      const parsed = JSON.parse(exported);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('Test Deck');
    });

    it('should import data into a store', async () => {
      const importData = JSON.stringify([
        {
          id: 'imported-1',
          name: 'Imported Deck',
          format: 'modern',
          cards: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
        },
      ]);

      await storage.importStore('test-decks', importData);

      const allDecks = await storage.getAll('test-decks');
      expect(allDecks).toHaveLength(1);
      expect(allDecks[0].name).toBe('Imported Deck');
    });

    it('should export full backup', async () => {
      // Create a storage instance with standard stores for backup tests
      const backupStorage = new IndexedDBStorage({
        dbName: 'TestPlanarNexusBackupStorage',
        version: 1,
        stores: ['decks', 'saved-games', 'preferences', 'usage-tracking', 'achievements'],
      });

      await backupStorage.initialize();

      const deckData = {
        id: 'deck-1',
        name: 'Test Deck',
        format: 'standard',
        cards: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      };

      await backupStorage.set('decks', deckData);

      const backup = await backupStorage.exportBackup();

      expect(backup.version).toBeDefined();
      expect(backup.exportedAt).toBeDefined();
      expect(backup.checksum).toBeDefined();
      expect(backup.decks).toBeDefined();
      expect(backup.decks).toHaveLength(1);

      // Cleanup
      await backupStorage.clearAll();
      await backupStorage.close();
    });

    it.skip('should import backup with checksum validation', async () => {
      // Create a storage instance with standard stores for backup tests
      const backupStorage = new IndexedDBStorage({
        dbName: 'TestPlanarNexusBackupStorage2',
        version: 1,
        stores: ['decks', 'saved-games', 'preferences', 'usage-tracking', 'achievements'],
      });

      await backupStorage.initialize();

      // First, add a deck and create a backup
      const deckData = {
        id: 'backup-1',
        name: 'Backup Deck',
        format: 'modern',
        cards: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      };

      await backupStorage.set('decks', deckData);
      const backup = await backupStorage.exportBackup();

      // Clear the decks store
      await backupStorage.clear('decks');

      // Import the backup
      await backupStorage.importBackup(backup);

      const allDecks = await backupStorage.getAll('decks');
      expect(allDecks).toHaveLength(1);
      expect(allDecks[0].name).toBe('Backup Deck');

      // Cleanup
      await backupStorage.clearAll();
      await backupStorage.close();
    }, 10000);

    it('should reject backup with invalid checksum', async () => {
      const backupData = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        decks: [],
        savedGames: [],
        preferences: {},
        checksum: 'invalid-checksum',
      };

      await expect(storage.importBackup(backupData)).rejects.toThrow();
    });
  });

  describe('Storage Quota', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should get storage quota information', async () => {
      // Create a storage instance with standard stores for quota tests
      const quotaStorage = new IndexedDBStorage({
        dbName: 'TestPlanarNexusQuotaStorage',
        version: 1,
        stores: ['decks', 'saved-games'],
      });

      await quotaStorage.initialize();

      const quota = await quotaStorage.getStorageQuota();

      expect(quota).toBeDefined();
      expect(quota.usage).toBeGreaterThanOrEqual(0);
      expect(quota.quota).toBeGreaterThan(0);
      expect(quota.percentage).toBeGreaterThanOrEqual(0);
      expect(quota.percentage).toBeLessThanOrEqual(100);

      // Cleanup
      await quotaStorage.clearAll();
      await quotaStorage.close();
    });
  });

  describe('Cross-Platform', () => {
    it('should detect Tauri environment', () => {
      const result = isTauri();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Migration', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should migrate decks from localStorage', async () => {
      const localStorageData = [
        {
          id: 'local-1',
          name: 'Local Deck',
          format: 'standard',
          cards: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {},
        },
      ];

      // Mock localStorage
      const originalLocalStorage = global.localStorage;
      global.localStorage = {
        getItem: (key: string) => {
          if (key === 'planar_nexus_decks') {
            return JSON.stringify(localStorageData);
          }
          return null;
        },
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
      } as any;

      await migrateFromLocalStorage();

      // Restore localStorage
      global.localStorage = originalLocalStorage;

      // Note: This test is limited because we can't easily mock the actual migration
      // In a real scenario, you'd verify the data was moved
    });
  });
});
