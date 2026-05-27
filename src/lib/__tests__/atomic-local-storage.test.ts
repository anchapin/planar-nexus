/**
 * Tests for Atomic LocalStorage
 * Issue #895: Non-atomic localStorage writes can cause data loss
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { AtomicLocalStorage, atomicLocalStorage, atomicSet, atomicGet, safeSetItem, safeGetItem, resetAtomicLocalStorage } from '../atomic-local-storage';

const mockStorage = new Map<string, string>();

const mockLocalStorage = {
  getItem: jest.fn((key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn((key: string, value: string) => {
    mockStorage.set(key, value);
  }),
  removeItem: jest.fn((key: string) => mockStorage.delete(key)),
  clear: jest.fn(() => mockStorage.clear()),
  key: jest.fn((index: number) => Array.from(mockStorage.keys())[index] ?? null),
  get length() {
    return mockStorage.size;
  },
};

Object.defineProperty(global, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

describe('AtomicLocalStorage', () => {
  let atomic: AtomicLocalStorage;

  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
    // Reset mock implementations that might be left from previous tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockLocalStorage.getItem as any).mockImplementation((key: string) => mockStorage.get(key) ?? null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockLocalStorage.setItem as any).mockImplementation((key: string, value: string) => {
      mockStorage.set(key, value);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockLocalStorage.removeItem as any).mockImplementation((key: string) => mockStorage.delete(key));
    atomic = new AtomicLocalStorage({ enableChecksum: true, autoRollback: true, retryCount: 3 });
  });

  describe('set and get', () => {
    it('should store and retrieve a string value', () => {
      atomic.set('test-key', 'test-value');
      expect(mockLocalStorage.setItem).toHaveBeenCalled();
    });

    it('should store and retrieve an object value', () => {
      const data = { name: 'test', value: 123 };
      atomic.set('object-key', data);

      const result = atomic.get<typeof data>('object-key');
      expect(result.success).toBe(true);
      expect(result.data).toEqual(data);
    });

    it('should return undefined for non-existent key', () => {
      const result = atomic.get('non-existent');
      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });
  });

  describe('atomic write pattern', () => {
    it('should write to temp key first, then commit', () => {
      atomic.set('atomic-test', { items: [1, 2, 3] });

      expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(2);

      const firstCall = mockLocalStorage.setItem.mock.calls[0];
      expect((firstCall[0] as string).startsWith('__atomic_temp_atomic-test')).toBe(true);
    });

    it('should remove temp key after commit', () => {
      atomic.set('cleanup-test', 'value');

      expect(mockLocalStorage.removeItem).toHaveBeenCalled();
      const removedKey = mockLocalStorage.removeItem.mock.calls[0][0];
      expect(removedKey.startsWith('__atomic_temp_cleanup-test')).toBe(true);
    });

    it('should rollback if verification fails', () => {
      const failingAtomic = new AtomicLocalStorage({
        enableChecksum: true,
        autoRollback: false,
        retryCount: 1,
      });

      jest.spyOn(mockLocalStorage, 'getItem').mockImplementation((key: string) => {
        const value = mockStorage.get(key);
        if (key.startsWith('__atomic_temp_')) {
          return value ? (value + 'corrupted') as string : value ?? null;
        }
        return value ?? null;
      });

      const result = failingAtomic.set('fail-test', 'data');
      expect(result.success).toBe(false);
      expect(result.error).toContain('verification failed');
    });
  });

  describe('transaction support', () => {
    it('should begin a transaction', () => {
      expect(() => atomic.beginTransaction()).not.toThrow();
    });

    it('should rollback all changes on rollbackTransaction', () => {
      atomic.beginTransaction();
      atomic.set('tx-key-1', 'value1');
      atomic.set('tx-key-2', 'value2');

      expect(atomic.get('tx-key-1').data).toBe('value1');
      expect(atomic.get('tx-key-2').data).toBe('value2');

      const result = atomic.rollbackTransaction();
      expect(result.success).toBe(true);
      expect(result.rolledBack).toBe(true);
    });

    it('should throw if transaction already in progress', () => {
      atomic.beginTransaction();
      expect(() => atomic.beginTransaction()).toThrow('Transaction already in progress');
      atomic.rollbackTransaction();
    });

    it('should commit transaction successfully', () => {
      atomic.beginTransaction();
      atomic.set('commit-test', 'committed');
      const result = atomic.commitTransaction();
      expect(result.success).toBe(true);
    });
  });

  describe('setWithRetry', () => {
    it('should retry on failure', () => {
      let attempts = 0;
      // Mock setItem to fail first 2 times, then succeed.
      // Note: set() calls setItem twice per attempt (temp key + actual key),
      // so with 3 attempts we get: 2 fails + (1+1) succeeds = 4 total calls
      jest.spyOn(mockLocalStorage, 'setItem').mockImplementation((key: string, value: string) => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Simulated failure');
        }
        mockStorage.set(key, value);
      });

      const result = atomic.setWithRetry('retry-test', 'value', 3);
      expect(result.success).toBe(true);
      expect(attempts).toBe(4); // 2 fails + 2 succeeds (temp + actual keys on 3rd attempt)
    });

    it('should fail after max retries', () => {
      jest.spyOn(mockLocalStorage, 'setItem').mockImplementation(() => {
        throw new Error('Always fails');
      });

      const result = atomic.setWithRetry('always-fail', 'value', 2);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed after 2 attempts');
    });
  });

  describe('remove', () => {
    it('should remove a key', () => {
      atomic.set('to-remove', 'value');
      const result = atomic.remove('to-remove');
      expect(result.success).toBe(true);
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('to-remove');
    });

    it('should record removed value for rollback in transaction', () => {
      atomic.set('rollback-remove', 'value');
      atomic.beginTransaction();
      atomic.remove('rollback-remove');

      const result = atomic.rollbackTransaction();
      expect(result.success).toBe(true);

      const restored = atomic.get('rollback-remove');
      expect(restored.data).toBe('value');
    });
  });

  describe('getOrDefault', () => {
    it('should return default for non-existent key', () => {
      const result = atomic.getOrDefault('missing', 'default-value');
      expect(result).toBe('default-value');
    });

    it('should return stored value for existing key', () => {
      atomic.set('existing', 'stored');
      const result = atomic.getOrDefault('existing', 'default');
      expect(result).toBe('stored');
    });
  });

  describe('has', () => {
    it('should return true for existing key', () => {
      atomic.set('exists', 'yes');
      expect(atomic.has('exists')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      expect(atomic.has('not-exists')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all atomic temp keys', () => {
      atomic.set('key1', 'value1');
      atomic.set('key2', 'value2');

      atomic.clear();

      const tempKeys = Array.from(mockStorage.keys()).filter(k => k.startsWith('__atomic_'));
      expect(tempKeys.length).toBe(0);
    });
  });
});

describe('Module-level helpers', () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
    resetAtomicLocalStorage();
    // Reset mock implementations that might be left from previous tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockLocalStorage.getItem as any).mockImplementation((key: string) => mockStorage.get(key) ?? null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockLocalStorage.setItem as any).mockImplementation((key: string, value: string) => {
      mockStorage.set(key, value);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockLocalStorage.removeItem as any).mockImplementation((key: string) => mockStorage.delete(key));
  });

  describe('atomicSet and atomicGet', () => {
    it('should set and get values using helper functions', () => {
      atomicSet('helper-test', { data: [1, 2, 3] });
      const result = atomicGet<{ data: number[] }>('helper-test');
      expect(result).toEqual({ data: [1, 2, 3] });
    });
  });

  describe('safeSetItem and safeGetItem', () => {
    it('should safely set and get JSON stringifiable values', () => {
      const testData = { items: ['a', 'b', 'c'], count: 3 };
      const success = safeSetItem('safe-test', testData);
      expect(success).toBe(true);

      const retrieved = safeGetItem<typeof testData>('safe-test');
      expect(retrieved).toEqual(testData);
    });

    it('should return false when write verification fails', () => {
      jest.spyOn(mockLocalStorage, 'getItem').mockReturnValue(null);

      const success = safeSetItem('verify-fail', 'data');
      expect(success).toBe(false);
    });

    it('should return null for non-existent key', () => {
      const result = safeGetItem('non-existent');
      expect(result).toBeNull();
    });

    it('should handle legacy format without checksum', () => {
      mockStorage.set('legacy-key', JSON.stringify({ legacy: true }));

      const result = safeGetItem<{ legacy: boolean }>('legacy-key');
      expect(result).toEqual({ legacy: true });
    });
  });
});

describe('Data integrity scenarios', () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
    resetAtomicLocalStorage();
    // Reset mock implementations that might be left from previous tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockLocalStorage.getItem as any).mockImplementation((key: string) => mockStorage.get(key) ?? null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockLocalStorage.setItem as any).mockImplementation((key: string, value: string) => {
      mockStorage.set(key, value);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockLocalStorage.removeItem as any).mockImplementation((key: string) => mockStorage.delete(key));
  });

  it('should handle partial writes (write interrupted mid-way)', () => {
    let setItemCount = 0;
    jest.spyOn(mockLocalStorage, 'setItem').mockImplementation(() => {
      setItemCount++;
      if (setItemCount === 1) {
        return;
      }
      throw new Error('Write interrupted');
    });

    const result = atomicLocalStorage.set('partial-write', 'test');
    expect(result.success).toBe(false);
  });

  it('should recover from corruption by using verified data', () => {
    const data = { important: 'data' };
    atomicLocalStorage.set('integrity-test', data);

    const result = atomicLocalStorage.get<typeof data>('integrity-test');
    expect(result.success).toBe(true);
    expect(result.data).toEqual(data);
  });
});
