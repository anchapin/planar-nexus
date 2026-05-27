/**
 * Atomic LocalStorage Wrapper
 *
 * Issue #895: Non-atomic localStorage writes can cause data loss
 */

import { createChecksum, verifyChecksum } from './utils';

/**
 * Atomic storage configuration
 */
export interface AtomicStorageConfig {
  enableChecksum: boolean;
  autoRollback: boolean;
  retryCount: number;
}

export interface AtomicResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  rolledBack?: boolean;
}

const DEFAULT_CONFIG: AtomicStorageConfig = {
  enableChecksum: true,
  autoRollback: true,
  retryCount: 3,
};

interface TransactionRecord {
  key: string;
  previousValue: string | null;
  timestamp: number;
}

export class AtomicLocalStorage {
  private config: AtomicStorageConfig;
  private activeTransaction: TransactionRecord[] = [];
  private inTransaction: boolean = false;

  constructor(config: Partial<AtomicStorageConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Reset instance state - useful for testing
   */
  reset(): void {
    this.activeTransaction = [];
    this.inTransaction = false;
  }

  private getTempKey(key: string): string {
    return `__atomic_temp_${key}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private wrapWithChecksum(data: string): string {
    if (!this.config.enableChecksum) {
      return data;
    }
    const checksum = createChecksum(data);
    return JSON.stringify({ data, checksum });
  }

  private unwrapWithChecksum<T>(wrapped: string): { data: T; valid: boolean } {
    if (!this.config.enableChecksum) {
      try {
        return { data: JSON.parse(wrapped) as T, valid: true };
      } catch {
        return { data: undefined as T, valid: false };
      }
    }

    try {
      const parsed = JSON.parse(wrapped);
      if (typeof parsed !== 'object' || parsed === null || !('data' in parsed) || !('checksum' in parsed)) {
        return { data: parsed as T, valid: true };
      }

      const { data, checksum } = parsed;
      const isValid = verifyChecksum(data, checksum);
      return { data: data as T, valid: isValid };
    } catch {
      return { data: undefined as T, valid: false };
    }
  }

  beginTransaction(): void {
    if (this.inTransaction) {
      throw new Error('Transaction already in progress');
    }
    this.inTransaction = true;
    this.activeTransaction = [];
  }

  commitTransaction(): AtomicResult {
    if (!this.inTransaction) {
      return { success: false, error: 'No active transaction' };
    }

    try {
      this.inTransaction = false;
      this.activeTransaction = [];
      return { success: true };
    } catch (error) {
      this.inTransaction = false;
      this.activeTransaction = [];
      return { success: false, error: String(error) };
    }
  }

  rollbackTransaction(): AtomicResult {
    if (!this.inTransaction) {
      return { success: false, error: 'No active transaction' };
    }

    try {
      for (const record of this.activeTransaction) {
        if (record.previousValue === null) {
          localStorage.removeItem(record.key);
        } else {
          localStorage.setItem(record.key, record.previousValue);
        }
      }
      this.inTransaction = false;
      this.activeTransaction = [];
      return { success: true, rolledBack: true };
    } catch (error) {
      this.inTransaction = false;
      this.activeTransaction = [];
      return { success: false, error: String(error), rolledBack: true };
    }
  }

  private recordForRollback(key: string): void {
    if (this.inTransaction) {
      const existingValue = localStorage.getItem(key);
      this.activeTransaction.push({
        key,
        previousValue: existingValue,
        timestamp: Date.now(),
      });
    }
  }

  set<T>(key: string, value: T): AtomicResult<T> {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    const wrapped = this.wrapWithChecksum(stringValue);
    const tempKey = this.getTempKey(key);

    try {
      this.recordForRollback(key);
      localStorage.setItem(tempKey, wrapped);

      const verified = localStorage.getItem(tempKey);
      if (verified !== wrapped) {
        localStorage.removeItem(tempKey);
        if (this.config.autoRollback && this.inTransaction) {
          this.rollbackTransaction();
        }
        return { success: false, error: 'Write verification failed - data corrupted during write' };
      }

      localStorage.setItem(key, wrapped);
      localStorage.removeItem(tempKey);

      return { success: true, data: value };
    } catch (error) {
      try {
        localStorage.removeItem(tempKey);
      } catch {
        // Ignore cleanup errors
      }

      if (this.config.autoRollback && this.inTransaction) {
        this.rollbackTransaction();
      }

      return { success: false, error: String(error) };
    }
  }

  setWithRetry<T>(key: string, value: T, retries?: number): AtomicResult<T> {
    const maxRetries = retries ?? this.config.retryCount;
    let lastError: string = '';

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const result = this.set(key, value);
      if (result.success) {
        return result;
      }
      lastError = result.error || 'Unknown error';

      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 10;
        const start = Date.now();
        while (Date.now() - start < delay) {
          // Busy wait
        }
      }
    }

    return { success: false, error: `Failed after ${maxRetries} attempts: ${lastError}` };
  }

  get<T>(key: string): AtomicResult<T> {
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) {
        return { success: true, data: undefined as T };
      }

      const { data, valid } = this.unwrapWithChecksum<T>(stored);

      if (!valid) {
        return {
          success: false,
          error: 'Data integrity check failed - checksum mismatch',
          data: undefined as T
        };
      }

      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          return { success: true, data: parsed as T };
        } catch {
          return { success: true, data: data as T };
        }
      }

      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  remove(key: string): AtomicResult {
    try {
      this.recordForRollback(key);
      localStorage.removeItem(key);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  getOrDefault<T>(key: string, defaultValue: T): T {
    const result = this.get<T>(key);
    if (result.success) {
      return result.data ?? defaultValue;
    }
    return defaultValue;
  }

  has(key: string): boolean {
    return localStorage.getItem(key) !== null;
  }

  clear(): AtomicResult {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('__atomic_') || key.startsWith('__temp_'))) {
          keysToRemove.push(key);
        }
      }

      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

export const atomicLocalStorage = new AtomicLocalStorage();

export function resetAtomicLocalStorage(): void {
  atomicLocalStorage.reset();
}

export function atomicSet<T>(key: string, value: T): boolean {
  return atomicLocalStorage.set(key, value).success;
}

export function atomicGet<T>(key: string): T | undefined {
  return atomicLocalStorage.get<T>(key).data;
}

export function safeSetItem<T>(key: string, value: T): boolean {
  const stringValue = JSON.stringify(value);
  const wrapped = JSON.stringify({ data: stringValue, checksum: createChecksum(stringValue) });
  const tempKey = `__safe_${key}_${Date.now()}`;

  try {
    localStorage.setItem(tempKey, wrapped);

    const verified = localStorage.getItem(tempKey);
    if (verified !== wrapped) {
      localStorage.removeItem(tempKey);
      return false;
    }

    localStorage.setItem(key, wrapped);
    localStorage.removeItem(tempKey);
    return true;
  } catch {
    try {
      localStorage.removeItem(tempKey);
    } catch {
      // Ignore
    }
    return false;
  }
}

export function safeGetItem<T>(key: string): T | null {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const parsed = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) {
      return parsed as T;
    }

    if ('data' in parsed && 'checksum' in parsed) {
      const { data, checksum } = parsed;
      if (!verifyChecksum(data, checksum)) {
        console.error(`Checksum verification failed for key: ${key}`);
        return null;
      }
      return JSON.parse(data) as T;
    }

    return parsed as T;
  } catch {
    return null;
  }
}

export function atomicSetItem(key: string, value: string): boolean {
  return safeSetItem(key, value);
}

export function atomicGetItem(key: string): string | null {
  return safeGetItem<string>(key);
}
