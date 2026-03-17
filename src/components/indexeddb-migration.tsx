'use client';

import { useEffect, useState } from 'react';
import { migrateGameHistoryToIndexedDB } from '@/lib/indexeddb-storage';

/**
 * IndexedDB Migration Component
 * 
 * Runs the migration from localStorage to IndexedDB on app mount.
 * This component doesn't render anything - it just handles the migration.
 */
export function IndexedDBMigration() {
  const [migrated, setMigrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if migration has already run in this session
    const alreadyMigrated = sessionStorage.getItem('indexeddb-migration-complete');
    if (alreadyMigrated) {
      setMigrated(true);
      return;
    }

    // Run migration
    migrateGameHistoryToIndexedDB()
      .then(() => {
        setMigrated(true);
        sessionStorage.setItem('indexeddb-migration-complete', 'true');
      })
      .catch((err) => {
        console.error('IndexedDB migration failed:', err);
        setError(err instanceof Error ? err.message : 'Migration failed');
        // Don't block the app - continue even if migration fails
        setMigrated(true);
      });
  }, []);

  // This component doesn't render anything
  return null;
}
