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

import { useState, useCallback, useEffect } from "react";
import {
  indexedDBStorage,
  BackupData,
  IncrementalBackupData,
  BackupManifest,
  StorageQuotaInfo,
  formatBytes,
} from "@/lib/indexeddb-storage";
import {
  compressData,
  decompressData,
  BACKUP_COMPRESSED_MIME,
  BACKUP_COMPRESSED_EXTENSION,
} from "@/lib/backup-compression";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Backup operation status
 */
export type BackupStatus =
  | "idle"
  | "preparing"
  | "exporting"
  | "importing"
  | "validating"
  | "complete"
  | "error";

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
export type ConflictResolution = "skip" | "overwrite" | "rename" | "merge";

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

/**
 * Which backup strategy the export control should use.
 *
 * - `full` — export every record (existing behavior, wraps `exportBackup`).
 * - `incremental` — export only records changed since the last backup,
 *   wrapping the existing `exportIncrementalBackup` lib capability.
 */
export type BackupMode = "full" | "incremental";

/**
 * Summary of the most recent incremental export, surfaced to the UI so the
 * user can see what the delta actually contained.
 */
export interface IncrementalResult {
  /** ISO timestamp the delta was computed from. */
  since: string;
  /** When the export ran. */
  exportedAt: string;
  /** Number of changed decks in the delta. */
  deckCount: number;
  /** Number of changed saved games in the delta. */
  savedGameCount: number;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for storage backup and restore operations
 */
export function useStorageBackup() {
  const [status, setStatus] = useState<BackupStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<BackupError | null>(null);
  const [quota, setQuota] = useState<StorageQuotaInfo | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [backupMode, setBackupMode] = useState<BackupMode>("full");
  const [backupManifest, setBackupManifest] = useState<BackupManifest | null>(
    null,
  );
  const [lastIncrementalResult, setLastIncrementalResult] =
    useState<IncrementalResult | null>(null);

  // Initialize storage on mount
  useEffect(() => {
    indexedDBStorage.initialize().then(() => {
      setIsInitialized(true);
      loadStorageQuota();
      refreshBackupManifest();
    });
  }, []);

  /**
   * Refresh the cached backup manifest (tracks last full/incremental times).
   */
  const refreshBackupManifest = useCallback(async () => {
    try {
      const manifest = await indexedDBStorage.getBackupManifest();
      setBackupManifest(manifest);
    } catch (err) {
      // The manifest is informational only; don't surface a hard error.
      console.error("Failed to load backup manifest:", err);
    }
  }, []);

  /**
   * Load current storage quota information
   */
  const loadStorageQuota = useCallback(async () => {
    try {
      const quotaInfo = await indexedDBStorage.getStorageQuota();
      setQuota(quotaInfo);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("Failed to load storage quota:", err);
      setError({
        message: `Failed to load storage quota: ${errorMessage}`,
        code: "QUOTA_LOAD_FAILED",
        details: err,
      });
    }
  }, []);

  /**
   * Export only the records changed since the last backup (incremental).
   *
   * Wraps the existing `indexedDBStorage.exportIncrementalBackup` capability.
   * The `since` baseline is derived from the backup manifest — the last
   * incremental time if present, otherwise the last full backup time, falling
   * back to the epoch so a first-time incremental captures everything as a
   * baseline delta.
   */
  const exportIncrementalData = useCallback(
    async (filename?: string): Promise<void> => {
      setStatus("preparing");
      setProgress(0);
      setError(null);
      setLastIncrementalResult(null);

      try {
        setStatus("exporting");
        setProgress(20);

        // Read the manifest fresh so the baseline is never stale.
        const manifest = await indexedDBStorage.getBackupManifest();
        const sinceISO =
          manifest?.lastIncrementalBackupAt ??
          manifest?.lastFullBackupAt ??
          null;
        const since = sinceISO ? new Date(sinceISO) : new Date(0);

        const incrementalData =
          await indexedDBStorage.exportIncrementalBackup(since);
        setProgress(60);

        const compressed = compressData(incrementalData);
        const blob = new Blob([compressed as BlobPart], {
          type: BACKUP_COMPRESSED_MIME,
        });
        setProgress(80);

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const timestamp = new Date().toISOString().split("T")[0];
        a.download =
          filename ||
          `planar-nexus-incremental-${timestamp}${BACKUP_COMPRESSED_EXTENSION}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setProgress(100);
        setStatus("complete");

        setLastIncrementalResult({
          since: incrementalData.since,
          exportedAt: incrementalData.exportedAt,
          deckCount: incrementalData.decks.length,
          savedGameCount: incrementalData.savedGames.length,
        });

        await Promise.all([loadStorageQuota(), refreshBackupManifest()]);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        setError({
          message: `Failed to export incremental backup: ${errorMessage}`,
          code: "EXPORT_INCREMENTAL_FAILED",
          details: err,
        });
        setStatus("error");
        console.error("Incremental export failed:", err);
      }
    },
    [loadStorageQuota, refreshBackupManifest],
  );

  /**
   * Export all user data to a JSON/zip file.
   *
   * Routes to {@link exportIncrementalData} when `backupMode` is
   * `'incremental'`; otherwise performs a full export.
   */
  const exportData = useCallback(
    async (filename?: string): Promise<void> => {
      if (backupMode === "incremental") {
        return exportIncrementalData(filename);
      }

      setStatus("preparing");
      setProgress(0);
      setError(null);
      setLastIncrementalResult(null);

      try {
        setStatus("exporting");
        setProgress(20);

        // Get backup data
        const backupData = await indexedDBStorage.exportBackup();
        setProgress(60);

        // Compress the backup (gzip) to keep export files small.
        const compressed = compressData(backupData);
        const blob = new Blob([compressed as BlobPart], {
          type: BACKUP_COMPRESSED_MIME,
        });
        setProgress(80);

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().split("T")[0];
        a.download =
          filename ||
          `planar-nexus-backup-${timestamp}${BACKUP_COMPRESSED_EXTENSION}`;

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setProgress(100);
        setStatus("complete");

        // Reload quota after export
        await Promise.all([loadStorageQuota(), refreshBackupManifest()]);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        setError({
          message: "Failed to export data",
          code: "EXPORT_FAILED",
          details: err,
        });
        setStatus("error");
        console.error("Export failed:", err);
      }
    },
    [
      backupMode,
      exportIncrementalData,
      loadStorageQuota,
      refreshBackupManifest,
    ],
  );

  /**
   * Import data from a file
   */
  const importData = useCallback(
    async (file: File, options: Partial<ImportOptions> = {}): Promise<void> => {
      setStatus("preparing");
      setProgress(0);
      setError(null);

      // Merge with default options
      const importOptions: ImportOptions = {
        conflictResolution: "overwrite",
        importDecks: true,
        importSavedGames: true,
        importPreferences: true,
        importUsageTracking: true,
        importAchievements: true,
        ...options,
      };

      try {
        // Read file
        setStatus("importing");
        setProgress(20);

        // Read as raw bytes so we can detect and handle both the new
        // gzip-compressed format and legacy uncompressed JSON.
        const buffer = await file.arrayBuffer();
        setProgress(40);

        // Parse and validate (auto-detects compressed vs legacy JSON).
        // Generic decompress so we can then branch on full vs incremental.
        setStatus("validating");
        const parsed = decompressData<BackupData | IncrementalBackupData>(
          buffer,
        );
        const isIncremental =
          "type" in parsed &&
          (parsed as IncrementalBackupData).type === "incremental";

        if (isIncremental) {
          const incremental = parsed as IncrementalBackupData;
          // Validate incremental structure.
          if (
            !incremental.version ||
            !incremental.exportedAt ||
            !incremental.checksum ||
            !Array.isArray(incremental.decks) ||
            !Array.isArray(incremental.savedGames)
          ) {
            throw new Error("Invalid incremental backup file format");
          }
          setProgress(60);
          // Merge the delta without clearing existing data.
          await indexedDBStorage.importIncrementalBackup(incremental);
        } else {
          const backupData = parsed as BackupData;
          // Validate backup structure
          if (!backupData.version || !backupData.exportedAt) {
            throw new Error("Invalid backup file format");
          }

          setProgress(60);

          // Check conflicts if needed
          if (importOptions.conflictResolution === "merge") {
            // For merge strategy, we'd need more complex logic
            // For now, we'll use overwrite
            console.warn(
              "Merge strategy not fully implemented, using overwrite",
            );
          }

          // Import data
          await indexedDBStorage.importBackup(backupData);
        }
        setProgress(90);

        setProgress(100);
        setStatus("complete");

        // Reload quota and manifest after import
        await Promise.all([loadStorageQuota(), refreshBackupManifest()]);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        setError({
          message: `Failed to import data: ${errorMessage}`,
          code: "IMPORT_FAILED",
          details: err,
        });
        setStatus("error");
        console.error("Import failed:", err);
      }
    },
    [loadStorageQuota, refreshBackupManifest],
  );

  /**
   * Get backup size estimate
   */
  const getBackupSize = useCallback(async (): Promise<number> => {
    try {
      const backupData = await indexedDBStorage.exportBackup();
      // Report the compressed size since that is what gets downloaded.
      return compressData(backupData).length;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("Failed to estimate backup size:", err);
      setError({
        message: `Failed to estimate backup size: ${errorMessage}`,
        code: "SIZE_ESTIMATE_FAILED",
        details: err,
      });
      return 0;
    }
  }, []);

  /**
   * Clear all data
   */
  const clearAllData = useCallback(async (): Promise<void> => {
    setStatus("preparing");
    setProgress(0);
    setError(null);

    try {
      await indexedDBStorage.clearAll();
      setStatus("complete");

      // Reload quota after clear
      await loadStorageQuota();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError({
        message: `Failed to clear data: ${errorMessage}`,
        code: "CLEAR_FAILED",
        details: err,
      });
      setStatus("error");
      console.error("Clear failed:", err);
    }
  }, [loadStorageQuota]);

  /**
   * Reset status to idle
   */
  const reset = useCallback(() => {
    setStatus("idle");
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
    backupMode,
    backupManifest,
    lastIncrementalResult,

    // Actions
    exportData,
    exportIncrementalData,
    importData,
    getBackupSize,
    clearAllData,
    loadStorageQuota,
    refreshBackupManifest,
    setBackupMode,
    reset,

    // Computed
    isProcessing:
      status !== "idle" && status !== "complete" && status !== "error",
    isComplete: status === "complete",
    isApproachingLimit: quota?.approachingLimit || false,
    storageUsage: quota ? formatBytes(quota.usage) : "Unknown",
    storageQuota: quota ? formatBytes(quota.quota) : "Unknown",
    storagePercentage: quota?.percentage.toFixed(1) || "0",
    hasIncrementalBaseline: Boolean(
      backupManifest?.lastIncrementalBackupAt ||
      backupManifest?.lastFullBackupAt,
    ),
    lastBackupAt:
      backupManifest?.lastIncrementalBackupAt ??
      backupManifest?.lastFullBackupAt ??
      null,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validate backup file structure
 *
 * Supports both the new gzip-compressed format and legacy uncompressed JSON.
 */
export function validateBackupFile(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        // Result is raw bytes; decompressBackup handles compressed and
        // legacy formats transparently.
        const bytes = new Uint8Array(e.target?.result as ArrayBuffer);
        const data = decompressData<BackupData>(bytes);

        // Check required fields
        const isValid =
          data.version !== undefined &&
          data.exportedAt !== undefined &&
          data.checksum !== undefined;

        resolve(isValid);
      } catch (err) {
        console.error("Failed to validate backup file:", err);
        resolve(false);
      }
    };

    reader.onerror = () => {
      console.error("Failed to read backup file");
      resolve(false);
    };

    // Read as ArrayBuffer to support binary gzip files as well as text JSON.
    reader.readAsArrayBuffer(file);
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
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
