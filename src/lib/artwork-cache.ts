/**
 * Artwork Cache System
 *
 * Manages caching of procedurally generated card artwork to improve performance.
 * Uses IndexedDB for persistent storage and in-memory cache for fast access.
 */

import { ProceduralArtworkConfig, generateProceduralArtwork, svgToDataUri } from './procedural-art-generator';

// Cache configuration
const CACHE_DB_NAME = 'PlanarNexusArtworkCache';
const CACHE_DB_VERSION = 1;
const CACHE_STORE_NAME = 'artwork';

// In-memory cache for fast access
const memoryCache = new Map<string, string>();
const MAX_MEMORY_CACHE_SIZE = 100;

// Cache entry interface
interface CacheEntry {
  key: string;
  dataUri: string;
  timestamp: number;
  accessCount: number;
}

// IndexedDB instance
let cacheDB: IDBDatabase | null = null;
let isInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the artwork cache
 */
export async function initializeArtworkCache(): Promise<void> {
  if (isInitialized) {
    return initPromise || Promise.resolve();
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // Open IndexedDB
      cacheDB = await openCacheDatabase();

      // Load frequently accessed artwork into memory
      await loadFrequentlyAccessedArtwork();

      isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize artwork cache:', error);
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Open IndexedDB for caching
 */
async function openCacheDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Create object store for artwork cache
      if (!database.objectStoreNames.contains(CACHE_STORE_NAME)) {
        const store = database.createObjectStore(CACHE_STORE_NAME, { keyPath: 'key' });

        // Create indexes for efficient queries
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('accessCount', 'accessCount', { unique: false });
      }
    };
  });
}

/**
 * Load frequently accessed artwork into memory cache
 */
async function loadFrequentlyAccessedArtwork(): Promise<void> {
  if (!cacheDB) return;

  return new Promise((resolve, reject) => {
    const transaction = cacheDB!.transaction([CACHE_STORE_NAME], 'readonly');
    const store = transaction.objectStore(CACHE_STORE_NAME);
    const index = store.index('accessCount');

    // Get top entries by access count
    const request = index.openCursor(null, 'prev');
    const entries: CacheEntry[] = [];

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor && entries.length < MAX_MEMORY_CACHE_SIZE) {
        entries.push(cursor.value);
        cursor.continue();
      } else {
        // Add to memory cache
        entries.forEach((entry) => {
          memoryCache.set(entry.key, entry.dataUri);
        });
        resolve();
      }
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Generate cache key from configuration
 */
function getCacheKey(config: ProceduralArtworkConfig): string {
  return `${config.cardName}-${config.typeLine}-${config.colors.join('-')}-${config.cmc}-${config.variant || 0}`;
}

/**
 * Get artwork from cache
 */
export async function getArtworkFromCache(
  config: ProceduralArtworkConfig
): Promise<string | null> {
  // Ensure cache is initialized
  if (!isInitialized) {
    await initializeArtworkCache();
  }

  const key = getCacheKey(config);

  // Check memory cache first
  if (memoryCache.has(key)) {
    return memoryCache.get(key) || null;
  }

  // Check IndexedDB
  if (cacheDB) {
    try {
      const entry = await getCacheEntry(key);
      if (entry) {
        // Update access count
        await updateAccessCount(key, entry.accessCount + 1);

        // Add to memory cache
        if (memoryCache.size < MAX_MEMORY_CACHE_SIZE) {
          memoryCache.set(key, entry.dataUri);
        }

        return entry.dataUri;
      }
    } catch (error) {
      console.error('Failed to get artwork from cache:', error);
    }
  }

  return null;
}

/**
 * Get or generate artwork (with caching)
 */
export async function getOrGenerateArtwork(
  config: ProceduralArtworkConfig
): Promise<string> {
  // Try to get from cache first
  const cached = await getArtworkFromCache(config);
  if (cached) {
    return cached;
  }

  // Generate new artwork
  const svg = generateProceduralArtwork(config);
  const dataUri = svgToDataUri(svg);

  // Cache the generated artwork
  await cacheArtwork(config, dataUri);

  return dataUri;
}

/**
 * Cache generated artwork
 */
export async function cacheArtwork(
  config: ProceduralArtworkConfig,
  dataUri: string
): Promise<void> {
  // Ensure cache is initialized
  if (!isInitialized) {
    await initializeArtworkCache();
  }

  const key = getCacheKey(config);

  // Add to memory cache
  if (memoryCache.size >= MAX_MEMORY_CACHE_SIZE) {
    // Remove oldest entry (first in Map)
    const firstKey = memoryCache.keys().next().value;
    memoryCache.delete(firstKey);
  }
  memoryCache.set(key, dataUri);

  // Add to IndexedDB
  if (cacheDB) {
    try {
      await putCacheEntry({
        key,
        dataUri,
        timestamp: Date.now(),
        accessCount: 1,
      });
    } catch (error) {
      console.error('Failed to cache artwork:', error);
    }
  }
}

/**
 * Get cache entry from IndexedDB
 */
function getCacheEntry(key: string): Promise<CacheEntry | undefined> {
  return new Promise((resolve, reject) => {
    if (!cacheDB) {
      resolve(undefined);
      return;
    }

    const transaction = cacheDB!.transaction([CACHE_STORE_NAME], 'readonly');
    const store = transaction.objectStore(CACHE_STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Put cache entry to IndexedDB
 */
function putCacheEntry(entry: CacheEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!cacheDB) {
      resolve();
      return;
    }

    const transaction = cacheDB!.transaction([CACHE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(CACHE_STORE_NAME);
    const request = store.put(entry);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update access count for a cache entry
 */
function updateAccessCount(key: string, count: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!cacheDB) {
      resolve();
      return;
    }

    const transaction = cacheDB!.transaction([CACHE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(CACHE_STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => {
      const entry = request.result;
      if (entry) {
        entry.accessCount = count;
        store.put(entry);
      }
      resolve();
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear all cached artwork
 */
export async function clearArtworkCache(): Promise<void> {
  // Clear memory cache
  memoryCache.clear();

  // Clear IndexedDB
  if (cacheDB) {
    try {
      await clearCacheStore();
    } catch (error) {
      console.error('Failed to clear artwork cache:', error);
    }
  }
}

/**
 * Clear cache store in IndexedDB
 */
function clearCacheStore(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!cacheDB) {
      resolve();
      return;
    }

    const transaction = cacheDB!.transaction([CACHE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(CACHE_STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get cache statistics
 */
export async function getArtworkCacheStats(): Promise<{
  memoryCacheSize: number;
  dbCacheSize: number;
  totalSizeEstimate: string;
}> {
  const memoryCacheSize = memoryCache.size;
  let dbCacheSize = 0;

  if (cacheDB) {
    dbCacheSize = await getCacheStoreSize();
  }

  // Estimate total size (each entry ~5-10KB on average)
  const totalSizeBytes = (memoryCacheSize + dbCacheSize) * 7500;
  const totalSizeMB = (totalSizeBytes / 1024 / 1024).toFixed(2);

  return {
    memoryCacheSize,
    dbCacheSize,
    totalSizeEstimate: `${totalSizeMB} MB`,
  };
}

/**
 * Get cache store size
 */
function getCacheStoreSize(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!cacheDB) {
      resolve(0);
      return;
    }

    const transaction = cacheDB!.transaction([CACHE_STORE_NAME], 'readonly');
    const store = transaction.objectStore(CACHE_STORE_NAME);
    const request = store.count();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear old cache entries (older than specified days)
 */
export async function clearOldArtworkCache(days: number = 30): Promise<number> {
  const cutoffTimestamp = Date.now() - (days * 24 * 60 * 60 * 1000);
  let deletedCount = 0;

  if (!cacheDB) {
    return 0;
  }

  try {
    const transaction = cacheDB.transaction([CACHE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(CACHE_STORE_NAME);
    const index = store.index('timestamp');

    // Find and delete old entries
    const request = index.openCursor();

    await new Promise<void>((resolve, reject) => {
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const entry = cursor.value as CacheEntry;
          if (entry.timestamp < cutoffTimestamp) {
            cursor.delete();
            deletedCount++;
            // Also remove from memory cache
            memoryCache.delete(entry.key);
          }
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Failed to clear old artwork cache:', error);
  }

  return deletedCount;
}

/**
 * Check if artwork cache is initialized
 */
export function isArtworkCacheReady(): boolean {
  return isInitialized;
}

/**
 * Pre-generate artwork for multiple cards
 */
export async function preGenerateArtwork(
  configs: ProceduralArtworkConfig[]
): Promise<void> {
  // Ensure cache is initialized
  if (!isInitialized) {
    await initializeArtworkCache();
  }

  // Generate artwork for all configurations
  await Promise.all(
    configs.map(async (config) => {
      try {
        await getOrGenerateArtwork(config);
      } catch (error) {
        console.error(`Failed to pre-generate artwork for ${config.cardName}:`, error);
      }
    })
  );
}

/**
 * Export all cached artwork (for backup/transfer)
 */
export async function exportArtworkCache(): Promise<Record<string, string>> {
  const exported: Record<string, string> = {};

  if (!cacheDB) {
    return exported;
  }

  try {
    const transaction = cacheDB.transaction([CACHE_STORE_NAME], 'readonly');
    const store = transaction.objectStore(CACHE_STORE_NAME);
    const request = store.getAll();

    const entries = await new Promise<CacheEntry[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    entries.forEach((entry) => {
      exported[entry.key] = entry.dataUri;
    });
  } catch (error) {
    console.error('Failed to export artwork cache:', error);
  }

  return exported;
}

/**
 * Import artwork cache (from backup/transfer)
 */
export async function importArtworkCache(
  imported: Record<string, string>
): Promise<void> {
  // Ensure cache is initialized
  if (!isInitialized) {
    await initializeArtworkCache();
  }

  // Import each entry
  for (const [key, dataUri] of Object.entries(imported)) {
    try {
      await putCacheEntry({
        key,
        dataUri,
        timestamp: Date.now(),
        accessCount: 1,
      });

      // Add to memory cache if space available
      if (memoryCache.size < MAX_MEMORY_CACHE_SIZE) {
        memoryCache.set(key, dataUri);
      }
    } catch (error) {
      console.error(`Failed to import artwork cache entry ${key}:`, error);
    }
  }
}
