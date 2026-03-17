/**
 * @fileOverview Comprehensive IndexedDB Storage Implementation
 *
 * Unit 16: Local Storage Migration
 *
 * Provides:
 * - IndexedDB wrapper for large datasets
 * - Cross-platform compatibility (browser + Tauri)
 * - Export/import functionality for backups
 * - Storage quota management
 * - Migration from localStorage
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Storage configuration
 */
export interface StorageConfig {
  /** Database name */
  dbName: string;
  /** Database version */
  version: number;
  /** Object store names */
  stores: string[];
}

/**
 * Export data format for backups
 */
export interface BackupData {
  /** Backup version */
  version: string;
  /** When exported */
  exportedAt: string;
  /** All decks */
  decks: StoredDeck[];
  /** All saved games */
  savedGames: StoredGame[];
  /** User preferences */
  preferences: Record<string, unknown>;
  /** Usage tracking */
  usageTracking?: UsageRecord[];
  /** Achievements */
  achievements?: PlayerAchievements[];
  /** Integrity checksum */
  checksum: string;
}

/**
 * Stored deck schema
 */
export interface StoredDeck {
  /** Unique identifier */
  id: string;
  /** Deck name */
  name: string;
  /** Format */
  format: string;
  /** Cards with quantities */
  cards: DeckCard[];
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

/**
 * Deck card with quantity
 */
export interface DeckCard {
  /** Card object */
  card: {
    id: string;
    name: string;
    cmc: number;
    colors: string[];
    color_identity: string[];
    type_line: string;
    image_uris?: {
      normal?: string;
      large?: string;
    };
    card_faces?: Array<{
      image_uris?: {
        normal?: string;
        large?: string;
      };
    }>;
  };
  /** Quantity */
  count: number;
}

/**
 * Stored game schema
 */
export interface StoredGame {
  /** Unique identifier */
  id: string;
  /** Game name/title */
  name: string;
  /** Game format */
  format: string;
  /** Player names */
  playerNames: string[];
  /** When saved */
  savedAt: number;
  /** When created */
  createdAt: number;
  /** Current turn */
  turnNumber: number;
  /** Current phase */
  currentPhase: string;
  /** Game status */
  status: 'not_started' | 'in_progress' | 'paused' | 'completed';
  /** Winners */
  winners?: string[];
  /** Auto-save flag */
  isAutoSave: boolean;
  /** Auto-save slot */
  autoSaveSlot?: number;
  /** Game state (serialized) */
  gameStateJson: string;
  /** Replay data (optional) */
  replayJson?: string;
  /** Metadata */
  metadata: Record<string, unknown>;
}

/**
 * Usage record for AI tracking
 */
export interface UsageRecord {
  id: string;
  provider: string;
  timestamp: number;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
  model?: string;
  feature?: string;
}

/**
 * Player achievements data
 */
export interface PlayerAchievements {
  id: string;
  playerId: string;
  achievements: Array<{
    achievementId: string;
    currentProgress: number;
    unlocked: boolean;
    unlockedAt?: number;
  }>;
  totalPoints: number;
  lastUpdated: number;
}

/**
 * Storage quota info
 */
export interface StorageQuotaInfo {
  /** Current usage in bytes */
  usage: number;
  /** Quota in bytes */
  quota: number;
  /** Usage percentage */
  percentage: number;
  /** Is approaching limit */
  approachingLimit: boolean;
}

// ============================================================================
// INDEXEDDB STORAGE CLASS
// ============================================================================

/**
 * IndexedDB storage implementation with backup support
 */
export class IndexedDBStorage {
  private config: StorageConfig;
  private db: IDBDatabase | null = null;

  constructor(config: StorageConfig) {
    this.config = config;
  }

  /**
   * Initialize database connection
   */
  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, this.config.version);

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object stores if they don't exist
        for (const storeName of this.config.stores) {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: 'id' });

            // Create indexes for common queries
            if (storeName === 'decks') {
              store.createIndex('name', 'name', { unique: false });
              store.createIndex('format', 'format', { unique: false });
              store.createIndex('createdAt', 'createdAt', { unique: false });
              store.createIndex('updatedAt', 'updatedAt', { unique: false });
            } else if (storeName === 'saved-games') {
              store.createIndex('name', 'name', { unique: false });
              store.createIndex('format', 'format', { unique: false });
              store.createIndex('status', 'status', { unique: false });
              store.createIndex('savedAt', 'savedAt', { unique: false });
              store.createIndex('isAutoSave', 'isAutoSave', { unique: false });
            } else if (storeName === 'usage-tracking') {
              store.createIndex('provider', 'provider', { unique: false });
              store.createIndex('timestamp', 'timestamp', { unique: false });
            } else if (storeName === 'game-history') {
              store.createIndex('date', 'date', { unique: false });
              store.createIndex('result', 'result', { unique: false });
              store.createIndex('mode', 'mode', { unique: false });
            }
          }
        }
      };
    });
  }

  /**
   * Ensure database is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.db) {
      await this.initialize();
    }
  }

  /**
   * Get a single item by key
   */
  async get<T>(storeName: string, key: string): Promise<T | null> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(new Error(`Failed to get item: ${request.error}`));
      };
    });
  }

  /**
   * Set a single item
   */
  async set<T>(storeName: string, value: T & { id: string }): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(value);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to set item: ${request.error}`));
      };
    });
  }

  /**
   * Get all items from a store
   */
  async getAll<T>(storeName: string): Promise<T[]> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(new Error(`Failed to get all items: ${request.error}`));
      };
    });
  }

  /**
   * Set multiple items in a store
   */
  async setAll<T>(storeName: string, values: (T & { id: string })[]): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);

      let completed = 0;
      let error: Error | null = null;

      for (const value of values) {
        const request = store.put(value);

        request.onsuccess = () => {
          completed++;
          if (completed === values.length) {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          }
        };

        request.onerror = () => {
          if (!error) {
            error = new Error(`Failed to set item: ${request.error}`);
          }
        };
      }
    });
  }

  /**
   * Delete a single item
   */
  async delete(storeName: string, key: string): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to delete item: ${request.error}`));
      };
    });
  }

  /**
   * Clear all items from a store
   */
  async clear(storeName: string): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to clear store: ${request.error}`));
      };
    });
  }

  /**
   * Get count of items in a store
   */
  async count(storeName: string): Promise<number> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.count();

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new Error(`Failed to count items: ${request.error}`));
      };
    });
  }

  /**
   * Query items using an index
   */
  async queryByIndex<T>(
    storeName: string,
    indexName: string,
    value: IDBValidKey | IDBKeyRange,
    count?: number
  ): Promise<T[]> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);

      const request = index.getAll(value, count);

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(new Error(`Failed to query by index: ${request.error}`));
      };
    });
  }

  /**
   * Export a store as JSON
   */
  async exportStore(storeName: string): Promise<string> {
    const items = await this.getAll(storeName);
    return JSON.stringify(items, null, 2);
  }

  /**
   * Import data into a store
   */
  async importStore(storeName: string, data: string): Promise<void> {
    const items = JSON.parse(data) as Array<{ id: string }>;
    await this.setAll(storeName, items);
  }

  /**
   * Export all user data as backup
   */
  async exportBackup(): Promise<BackupData> {
    const decks = await this.getAll<StoredDeck>('decks');
    const savedGames = await this.getAll<StoredGame>('saved-games');
    const preferences = await this.getAll<Record<string, unknown>>('preferences');
    const usageTracking = await this.getAll<UsageRecord>('usage-tracking');
    const achievements = await this.getAll<PlayerAchievements>('achievements');

    const backupData: BackupData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      decks,
      savedGames,
      preferences: preferences.reduce((acc, pref) => {
        if (pref && typeof pref === 'object' && 'id' in pref && pref.id) {
          acc[pref.id as string] = pref as { id: string } & Record<string, unknown>;
        }
        return acc;
      }, {} as Record<string, { id: string } & Record<string, unknown>>),
      usageTracking,
      achievements,
      checksum: '',
    };

    // Calculate checksum
    backupData.checksum = await this.calculateChecksum(backupData);

    return backupData;
  }

  /**
   * Import data from backup
   */
  async importBackup(backupData: BackupData): Promise<void> {
    // Verify checksum
    const checksum = await this.calculateChecksum(backupData);
    if (checksum !== backupData.checksum) {
      throw new Error('Backup integrity check failed: checksum mismatch');
    }

    // Import decks
    if (backupData.decks) {
      await this.clear('decks');
      await this.setAll('decks', backupData.decks);
    }

    // Import saved games
    if (backupData.savedGames) {
      await this.clear('saved-games');
      await this.setAll('saved-games', backupData.savedGames);
    }

    // Import preferences
    if (backupData.preferences) {
      await this.clear('preferences');
      for (const [key, value] of Object.entries(backupData.preferences)) {
        await this.set('preferences', { id: key, ...value as Record<string, unknown> });
      }
    }

    // Import usage tracking
    if (backupData.usageTracking) {
      await this.clear('usage-tracking');
      await this.setAll('usage-tracking', backupData.usageTracking);
    }

    // Import achievements
    if (backupData.achievements) {
      await this.clear('achievements');
      await this.setAll('achievements', backupData.achievements);
    }
  }

  /**
   * Calculate checksum for backup integrity
   */
  private async calculateChecksum(data: BackupData): Promise<string> {
    // Create a copy without the checksum field
    const { checksum, ...dataToHash } = data;
    const json = JSON.stringify(dataToHash);

    // Use Web Crypto API for SHA-256 hash
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(json);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Get storage quota information
   */
  async getStorageQuota(): Promise<StorageQuotaInfo> {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const percentage = quota > 0 ? (usage / quota) * 100 : 0;

      return {
        usage,
        quota,
        percentage,
        approachingLimit: percentage > 80,
      };
    }

    // Fallback: estimate based on IndexedDB size
    const decks = await this.getAll('decks');
    const savedGames = await this.getAll('saved-games');
    const json = JSON.stringify({ decks, savedGames });
    const usage = new Blob([json]).size;

    return {
      usage,
      quota: 50 * 1024 * 1024, // Assume 50MB quota
      percentage: (usage / (50 * 1024 * 1024)) * 100,
      approachingLimit: false,
    };
  }

  /**
   * Clear all stores
   */
  async clearAll(): Promise<void> {
    for (const storeName of this.config.stores) {
      await this.clear(storeName);
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// ============================================================================
// DEFAULT INSTANCE
// ============================================================================

/**
 * Default storage configuration for Planar Nexus
 */
const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  dbName: 'PlanarNexusStorage',
  version: 2,
  stores: ['decks', 'saved-games', 'preferences', 'usage-tracking', 'achievements', 'game-history'],
};

/**
 * Default IndexedDB storage instance
 */
export const indexedDBStorage = new IndexedDBStorage(DEFAULT_STORAGE_CONFIG);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if running in Tauri environment
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && (window as { __TAURI__?: unknown }).__TAURI__ !== undefined;
}

/**
 * Get appropriate storage implementation
 */
export async function getStorage(): Promise<IndexedDBStorage> {
  // For now, we always use IndexedDB
  // In the future, this could return FileSystemStorage for Tauri
  return indexedDBStorage;
}

/**
 * Migrate game history from localStorage to IndexedDB
 */
export async function migrateGameHistoryToIndexedDB(storageInstance?: IndexedDBStorage): Promise<void> {
  const storage = storageInstance || await getStorage();
  const gameHistoryKey = 'planar-nexus-game-history';
  const gameHistoryData = localStorage.getItem(gameHistoryKey);

  if (gameHistoryData) {
    try {
      const gameHistory = JSON.parse(gameHistoryData);
      if (Array.isArray(gameHistory)) {
        await storage.setAll('game-history', gameHistory);
        // localStorage.removeItem(gameHistoryKey);
      }
    } catch (error) {
      console.error('Failed to migrate game history:', error);
    }
  }
}

/**
 * Migrate data from localStorage to IndexedDB
 */
export async function migrateFromLocalStorage(): Promise<void> {
  const storage = await getStorage();

  // Migrate game history
  await migrateGameHistoryToIndexedDB();

  // Migrate decks
  const decksKey = 'planar_nexus_decks';
  const decksData = localStorage.getItem(decksKey);
  if (decksData) {
    try {
      const decks = JSON.parse(decksData);
      if (Array.isArray(decks)) {
        await storage.setAll('decks', decks);
        // Keep localStorage for now for backward compatibility
        // localStorage.removeItem(decksKey);
      }
    } catch (error) {
      console.error('Failed to migrate decks:', error);
    }
  }

  // Migrate saved games
  const savedGamesKey = 'planar_nexus_saved_games';
  const savedGamesData = localStorage.getItem(savedGamesKey);
  if (savedGamesData) {
    try {
      const savedGames = JSON.parse(savedGamesData);
      if (Array.isArray(savedGames)) {
        await storage.setAll('saved-games', savedGames);
        // localStorage.removeItem(savedGamesKey);
      }
    } catch (error) {
      console.error('Failed to migrate saved games:', error);
    }
  }

  // Migrate usage tracking
  const usageKey = 'planar_nexus_ai_usage';
  const usageData = localStorage.getItem(usageKey);
  if (usageData) {
    try {
      const usageRecords = JSON.parse(usageData);
      if (Array.isArray(usageRecords)) {
        // Add id to each record for IndexedDB
        const recordsWithIds = usageRecords.map((record, index) => ({
          ...record,
          id: `usage_${record.timestamp}_${index}`,
        }));
        await storage.setAll('usage-tracking', recordsWithIds);
        // localStorage.removeItem(usageKey);
      }
    } catch (error) {
      console.error('Failed to migrate usage tracking:', error);
    }
  }

  // Migrate achievements
  const achievementsPattern = /^planar_nexus_achievements_/;
  const achievementKeys = Object.keys(localStorage).filter(key =>
    achievementsPattern.test(key)
  );

  for (const key of achievementKeys) {
    try {
      const playerId = key.replace('planar_nexus_achievements_', '');
      const data = localStorage.getItem(key);
      if (data) {
        const achievement = JSON.parse(data);
        await storage.set('achievements', {
          id: playerId,
          ...achievement,
        });
        // localStorage.removeItem(key);
      }
    } catch (error) {
      console.error(`Failed to migrate achievements for ${key}:`, error);
    }
  }

  console.log('Migration from localStorage to IndexedDB completed');
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
