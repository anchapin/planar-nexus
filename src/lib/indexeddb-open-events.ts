/**
 * @fileOverview Shared IndexedDB open-lifecycle helpers (issue #1709).
 *
 * Both primary storage layers (`card-database.ts` and
 * `indexeddb-storage.ts`) open IndexedDB with a fixed schema version. When
 * tab A holds an older database version open and an updated tab B opens
 * with a higher version, B's open request fires a `blocked` event and —
 * without a handler — NEVER settles, wedging storage init for the rest of
 * the session. The reverse direction is equally unhandled by default: an
 * open connection that ignores `versionchange` keeps the OTHER tab's
 * upgrade blocked indefinitely.
 *
 * This module centralizes the two event-lifecycle behaviors every storage
 * open in this codebase must have:
 *
 *   1. `onblocked` → reject the open with {@link IndexedDBBlockedError}, a
 *      stable, actionable error ("another tab holds an older version") so
 *      retry logic (e.g. the #1726 card-database init retry) can recover
 *      once the other tab closes, instead of pending forever.
 *   2. `onversionchange` → close our connection immediately (unblocking
 *      the other tab's upgrade) and notify the UI via a custom DOM event
 *      so it can offer a reload. The storage layer deliberately does NOT
 *      render UI — it only broadcasts.
 *
 * Scope note (#1709): this is event-lifecycle plumbing only. Persistence
 * unification across the storage layers is tracked separately (#1722).
 */

/**
 * Stable `name` for open-blocked rejections. Callers and tests match on
 * this string rather than on message text, so the copy can evolve
 * without breaking retry / UI logic (see {@link IndexedDBBlockedError}).
 */
export const INDEXEDDB_BLOCKED_ERROR_NAME = "IndexedDBBlockedError";

/**
 * Error thrown/rejected when an IndexedDB open with a higher schema
 * version is BLOCKED by another tab holding an older version open.
 *
 * The open request has NOT failed permanently — it is waiting for the
 * other tab to close its connection. Callers should surface the message
 * to the user ("close the other tab") and retry the open; the #1726
 * card-database init retry, for example, re-runs the open automatically
 * on the next call once the other tab is gone.
 */
export class IndexedDBBlockedError extends Error {
  /** Name of the database whose upgrade was blocked. */
  readonly dbName: string;

  constructor(dbName: string) {
    super(
      `Cannot upgrade the "${dbName}" database: another tab (or window) is ` +
        `holding an older version open. Close the other tab, then retry.`,
    );
    this.name = INDEXEDDB_BLOCKED_ERROR_NAME;
    this.dbName = dbName;
  }
}

/**
 * Custom DOM event broadcast when OUR open connection is asked to close
 * because another tab wants to upgrade the schema (the `versionchange`
 * side of issue #1709). The connection is closed automatically before
 * the event is dispatched; UI layers may listen for it to offer a
 * reload prompt (e.g. "Planar Nexus was updated in another tab — reload
 * to pick up the new version").
 *
 * The event bubbles off `window` (falling back to `globalThis` for
 * non-DOM hosts) with `detail: { dbName }` naming the database.
 */
export const DB_VERSIONCHANGE_EVENT = "planar-nexus:db-versionchange";

/** Payload carried on {@link DB_VERSIONCHANGE_EVENT} events. */
export interface DBVersionChangeEventDetail {
  /** Name of the database another tab is upgrading. */
  dbName: string;
}

/**
 * Broadcast {@link DB_VERSIONCHANGE_EVENT}. Never throws — a failed UI
 * notification must not break the connection close that precedes it.
 */
export function dispatchDbVersionChangeEvent(dbName: string): void {
  try {
    const target: EventTarget | undefined =
      typeof window !== "undefined"
        ? window
        : typeof globalThis.dispatchEvent === "function"
          ? globalThis
          : undefined;
    if (!target || typeof CustomEvent === "undefined") return;
    target.dispatchEvent(
      new CustomEvent<DBVersionChangeEventDetail>(DB_VERSIONCHANGE_EVENT, {
        detail: { dbName },
      }),
    );
  } catch {
    // Swallow: best-effort UI notification only (issue #1709).
  }
}

/**
 * Register the `onversionchange` handler on a successfully opened
 * database connection: when another tab requests a version upgrade,
 * close this connection immediately (unblocking the other tab) and
 * dispatch {@link DB_VERSIONCHANGE_EVENT} so the UI can offer a reload.
 *
 * The optional `onClose` callback runs AFTER the close, letting callers
 * reset any state that tracks the connection (e.g. nulling a cached
 * handle so the next use re-opens at the new version).
 */
export function registerVersionChangeClose(
  db: IDBDatabase,
  onClose?: () => void,
): void {
  db.onversionchange = () => {
    try {
      db.close();
    } catch {
      // Already closed (e.g. a second versionchange) — nothing to do.
    }
    dispatchDbVersionChangeEvent(db.name);
    onClose?.();
  };
}
