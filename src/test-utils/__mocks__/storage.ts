/**
 * Storage mocks for localStorage and sessionStorage
 * 
 * Provides mock implementations for browser storage APIs
 * to enable testing without actual browser storage.
 */

/**
 * Type for storage item
 */
type StorageItem = string | null;

/**
 * Mock storage class
 */
class MockStorage {
  private store: Map<string, StorageItem> = new Map();
  
  /**
   * Get item from storage
   */
  getItem(key: string): StorageItem {
    return this.store.get(key) ?? null;
  }
  
  /**
   * Set item in storage
   */
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  
  /**
   * Remove item from storage
   */
  removeItem(key: string): void {
    this.store.delete(key);
  }
  
  /**
   * Clear all items
   */
  clear(): void {
    this.store.clear();
  }
  
  /**
   * Get key by index
   */
  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }
  
  /**
   * Get number of items
   */
  get length(): number {
    return this.store.size;
  }
  
  /**
   * Get all keys
   */
  getAllKeys(): string[] {
    return Array.from(this.store.keys());
  }
  
  /**
   * Get all items as object
   */
  toObject(): Record<string, string> {
    const obj: Record<string, string> = {};
    this.store.forEach((value, key) => {
      if (value !== null) {
        obj[key] = value;
      }
    });
    return obj;
  }
  
  /**
   * Reset to initial state
   */
  reset(): void {
    this.store.clear();
  }
}

/**
 * localStorage mock instance
 */
export const mockLocalStorage = new MockStorage();

/**
 * sessionStorage mock instance
 */
export const mockSessionStorage = new MockStorage();

/**
 * Create a mock storage with optional initial data
 * 
 * @param initialData - Initial data to populate the storage with
 * @returns A new MockStorage instance
 */
export function createStorageMock(
  initialData?: Record<string, string>
): MockStorage {
  const storage = new MockStorage();
  
  if (initialData) {
    Object.entries(initialData).forEach(([key, value]) => {
      storage.setItem(key, value);
    });
  }
  
  return storage;
}

/**
 * Helper to mock localStorage in tests
 * 
 * @example
 * beforeEach(() => {
 *   mockLocalStorageForTesting();
 * });
 * 
 * afterEach(() => {
 *   restoreLocalStorage();
 * });
 */
export function mockLocalStorageForTesting(): void {
  // Store original localStorage
  const originalLocalStorage = global.localStorage;
  
  // Mock localStorage
  global.localStorage = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'getItem') {
        return mockLocalStorage.getItem.bind(mockLocalStorage);
      }
      if (prop === 'setItem') {
        return mockLocalStorage.setItem.bind(mockLocalStorage);
      }
      if (prop === 'removeItem') {
        return mockLocalStorage.removeItem.bind(mockLocalStorage);
      }
      if (prop === 'clear') {
        return mockLocalStorage.clear.bind(mockLocalStorage);
      }
      if (prop === 'key') {
        return mockLocalStorage.key.bind(mockLocalStorage);
      }
      if (prop === 'length') {
        return mockLocalStorage.length;
      }
      return undefined;
    },
  }) as Storage;
}

/**
 * Helper to mock sessionStorage in tests
 */
export function mockSessionStorageForTesting(): void {
  // Store original sessionStorage
  const originalSessionStorage = global.sessionStorage;
  
  // Mock sessionStorage
  global.sessionStorage = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'getItem') {
        return mockSessionStorage.getItem.bind(mockSessionStorage);
      }
      if (prop === 'setItem') {
        return mockSessionStorage.setItem.bind(mockSessionStorage);
      }
      if (prop === 'removeItem') {
        return mockSessionStorage.removeItem.bind(mockSessionStorage);
      }
      if (prop === 'clear') {
        return mockSessionStorage.clear.bind(mockSessionStorage);
      }
      if (prop === 'key') {
        return mockSessionStorage.key.bind(mockSessionStorage);
      }
      if (prop === 'length') {
        return mockSessionStorage.length;
      }
      return undefined;
    },
  }) as Storage;
}


/**
 * Mock both localStorage and sessionStorage for testing
 * Note: This is a simple wrapper that should be used with beforeEach/afterEach
 */
export function mockStorageForTesting(): void {
  mockLocalStorageForTesting();
  mockSessionStorageForTesting();
}

/**
 * Pre-populate localStorage with test data
 * 
 * @param data - Data to set in localStorage
 */
export function setLocalStorageData(data: Record<string, string>): void {
  Object.entries(data).forEach(([key, value]) => {
    mockLocalStorage.setItem(key, value);
  });
}

/**
 * Pre-populate sessionStorage with test data
 * 
 * @param data - Data to set in sessionStorage
 */
export function setSessionStorageData(data: Record<string, string>): void {
  Object.entries(data).forEach(([key, value]) => {
    mockSessionStorage.setItem(key, value);
  });
}

/**
 * Get data from localStorage as object
 */
export function getLocalStorageData(): Record<string, string> {
  return mockLocalStorage.toObject();
}

/**
 * Get data from sessionStorage as object
 */
export function getSessionStorageData(): Record<string, string> {
  return mockSessionStorage.toObject();
}

export default {
  mockLocalStorage,
  mockSessionStorage,
  createStorageMock,
  mockLocalStorageForTesting,
  mockSessionStorageForTesting,
  mockStorageForTesting,
  setLocalStorageData,
  setSessionStorageData,
  getLocalStorageData,
  getSessionStorageData,
};
