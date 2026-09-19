/**
 * Issue #1937 — torn-schema self-heal and VersionError recovery helpers.
 *
 * Extracted from `IndexedDBStorage` (issue #1946): this code only runs on
 * the rare recovery paths — a torn schema left behind by an aborted
 * versionchange transaction (Firefox/WebKit can abort the upgrade when
 * the document is destroyed mid-upgrade, leaving the database at the NEW
 * version with only part of the store set committed), or a database
 * living ABOVE `config.version` because an earlier session self-healed
 * past it. Keeping it here, behind a dynamic `import()` at the point of
 * use in `IndexedDBStorage.openWithSchemaHeal()`, keeps these bytes out
 * of the shared client chunk every route pays for on first load, while
 * the eager hot path keeps only a name check and a store-list
 * comparison.
 *
 * Behavior contract (unchanged from the pre-extraction inline code):
 *   - `reopenAtDiskVersion`: probe the on-disk version with an
 *     unversioned open (never upgrades, never creates stores), then
 *     re-open at that version with the full upgrade handler.
 *   - `healTornSchema`: log, close the torn connection, and re-open at
 *     `db.version + 1` so `onupgradeneeded` re-runs and the upgrade
 *     handler's create-missing-store loop rebuilds the schema in one
 *     transaction. A `VersionError` on that re-open (another tab healed
 *     even higher inside the close/open race window) falls back to the
 *     on-disk version.
 */

/** Open function handed in by the caller: full upgrade handler attached. */
type OpenAtVersion = (version: number) => Promise<IDBDatabase>;

/**
 * Unversioned open used only to discover the on-disk version (it never
 * upgrades and never creates stores). Closed immediately.
 */
async function probeCurrentVersion(dbName: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = indexedDB.open(dbName);
    probe.onsuccess = () => {
      const current = probe.result.version;
      probe.result.close();
      resolve(current);
    };
    probe.onerror = () => {
      const error = new Error(`Failed to open IndexedDB: ${probe.error}`);
      error.name = probe.error?.name ?? "Error";
      reject(error);
    };
  });
}

/**
 * Open at `version`; on `VersionError` — the on-disk database is NEWER
 * than `version` — probe and re-open at the on-disk version instead of
 * failing (a lower-version open is a hard IndexedDB error).
 */
async function openWithVersionRetry(
  open: OpenAtVersion,
  dbName: string,
  version: number,
): Promise<IDBDatabase> {
  try {
    return await open(version);
  } catch (error) {
    if ((error as { name?: string }).name === "VersionError") {
      return open(await probeCurrentVersion(dbName));
    }
    throw error;
  }
}

/**
 * Issue #1937 recovery for a database living above `config.version`
 * (an earlier session self-healed a torn schema past it): re-open at
 * the on-disk version. Without this retry every subsequent open would
 * fail with a native `VersionError`.
 */
export async function reopenAtDiskVersion(
  open: OpenAtVersion,
  dbName: string,
): Promise<IDBDatabase> {
  return open(await probeCurrentVersion(dbName));
}

/**
 * Issue #1937 recovery for a torn schema: the database opened at the
 * expected version but stores are missing. Close and re-open at
 * `db.version + 1` — a same-version re-open never re-runs
 * `onupgradeneeded`, so the version bump is what makes the upgrade
 * handler's create-missing-store loop rebuild the schema in one
 * transaction. Healed databases then live at a version ABOVE
 * `config.version`, which `reopenAtDiskVersion` handles on every later
 * session.
 */
export async function healTornSchema(
  open: OpenAtVersion,
  db: IDBDatabase,
  missing: string[],
): Promise<IDBDatabase> {
  console.warn(
    `[indexeddb-storage] schema self-heal (#1937): store(s) missing at version ${db.version} (${missing.join(", ")}) — re-opening at version ${db.version + 1} to rebuild`,
  );
  db.close();
  return openWithVersionRetry(open, db.name, db.version + 1);
}
