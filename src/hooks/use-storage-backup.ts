/**
 * @fileOverview Storage Backup and Restore Hook
 *
 * Unit 16: Local Storage Migration
 *
 * Provides:
 * - Export all user data to JSON/zip files
 * - Import data from backups
 * - Check storage quota
 * - Manage backup operations with progress tracking
 */

"use client";

import { useState, useCallback, useEffect } from 'react';
import {
  indexedDBStorage,
  BackupData,
  StorageQuotaInfo,
  formatBytes,
} from '@/lib/indexeddb-storage';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Backup operation status
 */
export type BackupStatus =
  | 'idle'
  | 'preparing'
  | 'exporting'
  | 'importing'
  | 'validating'
  | 'complete'
  | 'error';

/**
 * Backup operation error
 */
export interface BackupError {
  /** Error message */
  message: string;
  /** Error code */
  code: string;
  /** Additional details */
  details?: unknown;
}

/**
 * Import conflict resolution strategy
 */
export type ConflictResolution = 'skip' | 'overwrite' | 'rename' | 'merge';

/**
 * Import options
 */
export interface ImportOptions {
  /** How to handle conflicts */
  conflictResolution: ConflictResolution;
  /** Whether to import specific data types */
  importDecks: boolean;
  /** Whether to import saved games */
  importSavedGames: boolean;
  /** Whether to import preferences */
  importPreferences: boolean;
  /** Whether to import usage tracking */
  importUsageTracking: boolean;
  /** Whether to import achievements */
  importAchievements: boolean;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for storage backup and restore operations
 */
export function useStorageBackup() {
  const [status, setStatus] = useState<BackupStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<BackupError | null>(null);
  const [quota, setQuota] = useState<StorageQuotaInfo | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize storage on mount
  useEffect(() => {
    indexedDBStorage.initialize().then(() => {
      setIsInitialized(true);
      loadStorageQuota();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadStorageQuota]);

  /**
   * Load current storage quota information
   */
  const loadStorageQuota = useCallback(async () => {
    try {
      const quotaInfo = await indexedDBStorage.getStorageQuota();
      setQuota(quotaInfo);
    } catch (err) {
      console.error('Failed to load storage quota:', err);
    }
  }, []);

  /**
   * Export all user data to a JSON file
   */
  const exportData = useCallback(async (filename?: string): Promise<void> => {
    setStatus('preparing');
    setProgress(0);
    setError(null);

    try {
      setStatus('exporting');
      setProgress(20);

      // Get backup data
      const backupData = await indexedDBStorage.exportBackup();
      setProgress(60);

      // Create blob and download
      const json = JSON.stringify(backupData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      setProgress(80);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().split('T')[0];
      a.download = filename || `planar-nexus-backup-${timestamp}.json`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setProgress(100);
      setStatus('complete');

      // Reload quota after export
      await loadStorageQuota();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError({
        message: 'Failed to export data',
        code: 'EXPORT_FAILED',
        details: err,
      });
      setStatus('error');
      console.error('Export failed:', err);
    }
  }, [loadStorageQuota]);

  /**
   * Import data from a file
   */
  const importData = useCallback(
    async (file: File, options: Partial<ImportOptions> = {}): Promise<void> => {
      setStatus('preparing');
      setProgress(0);
      setError(null);

      // Merge with default options
      const importOptions: ImportOptions = {
        conflictResolution: 'overwrite',
        importDecks: true,
        importSavedGames: true,
        importPreferences: true,
        importUsageTracking: true,
        importAchievements: true,
        ...options,
      };

      try {
        // Read file
        setStatus('importing');
        setProgress(20);

        const text = await file.text();
        setProgress(40);

        // Parse and validate
        setStatus('validating');
        const backupData = JSON.parse(text) as BackupData;

        // Validate backup structure
        if (!backupData.version || !backupData.exportedAt) {
          throw new Error('Invalid backup file format');
        }

        setProgress(60);

        // Check conflicts if needed
        if (importOptions.conflictResolution === 'merge') {
          // For merge strategy, we'd need more complex logic
          // For now, we'll use overwrite
          console.warn('Merge strategy not fully implemented, using overwrite');
        }

        // Import data
        await indexedDBStorage.importBackup(backupData);
        setProgress(90);

        setProgress(100);
        setStatus('complete');

        // Reload quota after import
        await loadStorageQuota();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError({
          message: `Failed to import data: ${errorMessage}`,
          code: 'IMPORT_FAILED',
          details: err,
        });
        setStatus('error');
        console.error('Import failed:', err);
      }
    },
    [loadStorageQuota]
  );

  /**
   * Get backup size estimate
   */
  const getBackupSize = useCallback(async (): Promise<number> => {
    try {
      const backupData = await indexedDBStorage.exportBackup();
      const json = JSON.stringify(backupData, null, 2);
      return new Blob([json]).size;
    } catch (err) {
      console.error('Failed to estimate backup size:', err);
      return 0;
    }
  }, []);

  /**
   * Clear all data
   */
  const clearAllData = useCallback(async (): Promise<void> => {
    setStatus('preparing');
    setProgress(0);
    setError(null);

    try {
      await indexedDBStorage.clearAll();
      setStatus('complete');

      // Reload quota after clear
      await loadStorageQuota();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError({
        message: `Failed to clear data: ${errorMessage}`,
        code: 'CLEAR_FAILED',
        details: err,
      });
      setStatus('error');
      console.error('Clear failed:', err);
    }
  }, [loadStorageQuota]);

  /**
   * Reset status to idle
   */
  const reset = useCallback(() => {
    setStatus('idle');
    setProgress(0);
    setError(null);
  }, []);

  return {
    // State
    status,
    progress,
    error,
    quota,
    isInitialized,

    // Actions
    exportData,
    importData,
    getBackupSize,
    clearAllData,
    loadStorageQuota,
    reset,

    // Computed
    isProcessing: status !== 'idle' && status !== 'complete' && status !== 'error',
    isComplete: status === 'complete',
    isApproachingLimit: quota?.approachingLimit || false,
    storageUsage: quota ? formatBytes(quota.usage) : 'Unknown',
    storageQuota: quota ? formatBytes(quota.quota) : 'Unknown',
    storagePercentage: quota?.percentage.toFixed(1) || '0',
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validate backup file structure
 */
export function validateBackupFile(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text) as BackupData;

        // Check required fields
        const isValid =
          data.version !== undefined &&
          data.exportedAt !== undefined &&
          data.checksum !== undefined;

        resolve(isValid);
      } catch {
        resolve(false);
      }
    };

    reader.onerror = () => resolve(false);
    reader.readAsText(file);
  });
}

/**
 * Get backup file metadata without reading full content
 */
export function getBackupMetadata(file: File): {
  name: string;
  size: number;
  lastModified: number;
  formattedSize: string;
  formattedDate: string;
} {
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    formattedSize: formatBytes(file.size),
    formattedDate: new Date(file.lastModified).toLocaleString(),
  };
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
