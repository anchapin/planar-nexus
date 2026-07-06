/**
 * @fileoverview Backup checksum bridge (issue #1249).
 *
 * Single seam between the main thread and the backup SHA-256 Web Worker.
 * Mirrors `src/ai/worker/synergy-worker-bridge.ts` (#1079) and
 * `src/ai/worker/trigger-chain-worker-bridge.ts` (#1080) — the established
 * pattern for offloading CPU-heavy work to a worker with a transparent
 * main-thread fallback:
 *
 * - Resolves the worker client lazily through an injectable resolver so the
 *   worker path and the fallback path can be unit-tested without a real
 *   `Worker` global (jsdom does not provide one).
 * - The default resolver dynamic-imports the real client so this module is
 *   Jest-safe (`import.meta.url` cannot be statically required under
 *   ts-jest CommonJS).
 * - Any resolver or worker error is swallowed and routed to the main-thread
 *   fallback. A one-shot `console.warn` keeps the noise down on tight loops.
 * - The returned checksum is byte-identical between the worker path and the
 *   fallback path: both use the same `crypto.subtle.digest("SHA-256", ...)`
 *   primitive.
 *
 * The bridge also exposes an optional `onProgress` callback that fires
 * `{bytesProcessed, totalBytes}` ticks from the worker so the UI can update
 * its progress bar in ≤5% increments during a 10 MB export (acceptance
 * criterion from issue #1249).
 */

import type { BackupData } from "../indexeddb-storage";
import type { ChecksumWorkerEvent } from "./backup-checksum-client";

// Note: `BackupData` and `ChecksumWorkerEvent` are `import type` so the
// runtime circular import between `indexeddb-storage.ts` and this module
// is broken at compile time. The real client is loaded via dynamic
// import inside the default resolver (see below) — the same Jest-safe
// pattern used by `src/ai/worker/synergy-worker-bridge.ts` (#1079) and
// `src/ai/worker/trigger-chain-worker-bridge.ts` (#1080).

/**
 * Minimal shape of the backup checksum client surface this bridge needs.
 * Declared locally (rather than importing the real client type) so tests
 * can inject a plain stub without pulling the import.meta-based client
 * module into the Jest module graph.
 */
export interface BackupChecksumClient {
  getChecksumApi(): {
    checksum(
      payload: ArrayBufferLike,
      options?: { totalBytes?: number; progressEveryBytes?: number },
    ): Promise<{
      checksum: string;
      bytesProcessed: number;
      totalBytes: number;
    }>;
  } | null;
  on(listener: (event: ChecksumWorkerEvent) => void): () => void;
}

export type BackupChecksumClientResolver =
  () => Promise<BackupChecksumClient | null>;

/**
 * Optional progress callback shape. `bytesProcessed` and `totalBytes` are
 * always defined; `phase` distinguishes the cheaper "stringifying" phase
 * (main thread) from the worker digest phase so callers can drive a more
 * granular progress bar.
 */
export interface CalculateChecksumProgress {
  phase: "stringify" | "digest";
  bytesProcessed: number;
  totalBytes: number;
}

export interface CalculateChecksumOptions {
  /**
   * Fires periodically during the digest. The bridge guarantees at least
   * one tick at 0% and one at 100%; intermediate ticks are best-effort and
   * depend on the worker's `progressEveryBytes` setting (default 256 KiB).
   */
  onProgress?: (progress: CalculateChecksumProgress) => void;
}

let fallbackWarningLogged = false;

/**
 * Default resolver: dynamic-import the real client (browser / Next.js).
 * Dynamic import keeps this module Jest-safe — see fileoverview. In
 * ts-jest CommonJS mode the static `import` of the client would attempt
 * to evaluate `new URL(..., import.meta.url)` at parse time and crash;
 * a dynamic `import()` is only resolved when the resolver runs at
 * runtime, so test environments that never call it (and that inject
 * their own resolver) never trip on `import.meta`.
 */
const defaultResolver: BackupChecksumClientResolver = async () => {
  try {
    const mod = await import("./backup-checksum-client");
    return mod.backupChecksumWorkerClient as unknown as BackupChecksumClient;
  } catch {
    return null;
  }
};

let clientResolver: BackupChecksumClientResolver = defaultResolver;

/**
 * Replace the client resolver. @internal — used by unit tests to inject a
 * stub worker client and exercise both the worker path and the fallback
 * path without a real Worker global.
 */
export function _setBackupChecksumClientResolver(
  resolver: BackupChecksumClientResolver,
): void {
  clientResolver = resolver;
}

/**
 * Restore the default resolver and reset the one-shot fallback warning.
 * @internal — call this in `afterEach` of tests that use the setter.
 */
export function _resetBackupChecksumClientResolver(): void {
  clientResolver = defaultResolver;
  fallbackWarningLogged = false;
}

/**
 * Synchronous main-thread fallback for the SHA-256 checksum. Identical to
 * the pre-#1249 `calculateChecksum` implementation in `indexeddb-storage.ts`
 * so old backups verify correctly against new ones.
 */
async function computeChecksumOnMainThread(
  jsonBytes: ArrayBuffer,
): Promise<{ checksum: string; bytesProcessed: number; totalBytes: number }> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(jsonBytes),
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const checksum = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return {
    checksum,
    bytesProcessed: jsonBytes.byteLength,
    totalBytes: jsonBytes.byteLength,
  };
}

/**
 * Serialise the backup payload to JSON, stripping the `checksum` field so
 * the digest is stable across re-exports. Done on the main thread because
 * `JSON.stringify` is synchronous and unavoidable — the issue (#1249)
 * targets the SHA-256 hash, not the JSON serialisation.
 *
 * Exposed for tests so they can assert the bridge does not re-serialise
 * inside the worker (it does not — the worker receives bytes, not objects).
 */
export function serialiseBackupForChecksum(data: BackupData): string {
  return JSON.stringify(data, (key, value) =>
    key === "checksum" ? undefined : value,
  );
}

/**
 * Compute the SHA-256 checksum for a backup payload, off the main thread
 * when the worker is available; otherwise on the main thread with identical
 * results.
 *
 * @param data  The backup payload to checksum. The `checksum` field is
 *   stripped before serialisation so the digest is stable across re-exports.
 * @param options  Optional progress callback. See `CalculateChecksumOptions`.
 * @returns  The lowercase hex SHA-256 digest.
 *
 * Guarantees:
 * - The returned digest is value-identical to the pre-#1249 synchronous
 *   implementation (`crypto.subtle.digest("SHA-256", ...)` over the
 *   serialised JSON). Backups created before this change verify correctly
 *   against backups created after this change.
 * - Never throws due to worker unavailability. Any resolver/client error
 *   is swallowed and routed to the main-thread fallback.
 * - At most one `console.warn` is emitted for fallback usage across the
 *   page lifetime.
 */
export async function calculateChecksumAsync(
  data: BackupData,
  options: CalculateChecksumOptions = {},
): Promise<string> {
  const { onProgress } = options;

  // Step 1: serialise the JSON on the main thread. This is the one
  // unavoidable synchronous cost, but we report `phase: "stringify"` so
  // callers can show meaningful progress.
  const json = serialiseBackupForChecksum(data);
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(json);
  const buffer = jsonBytes.buffer.slice(
    jsonBytes.byteOffset,
    jsonBytes.byteOffset + jsonBytes.byteLength,
  ) as ArrayBuffer;

  onProgress?.({
    phase: "stringify",
    bytesProcessed: 0,
    totalBytes: buffer.byteLength,
  });
  onProgress?.({
    phase: "stringify",
    bytesProcessed: buffer.byteLength,
    totalBytes: buffer.byteLength,
  });

  // Step 2: resolve the worker client.
  let client: BackupChecksumClient | null = null;
  try {
    client = await clientResolver();
  } catch {
    client = null;
  }

  // Step 3: try the worker; fall back to main thread on any error.
  if (client) {
    const api = client.getChecksumApi();
    if (api) {
      try {
        let unsubscribe: (() => void) | null = null;
        if (onProgress) {
          unsubscribe = client.on((event) => {
            if (event.type === "progress") {
              onProgress({
                phase: "digest",
                bytesProcessed: event.bytesProcessed,
                totalBytes: event.totalBytes,
              });
            }
          });
        }

        try {
          const result = await api.checksum(buffer, {
            totalBytes: buffer.byteLength,
          });
          onProgress?.({
            phase: "digest",
            bytesProcessed: result.bytesProcessed,
            totalBytes: result.totalBytes,
          });
          return result.checksum;
        } finally {
          if (unsubscribe) unsubscribe();
        }
      } catch (error) {
        if (!fallbackWarningLogged) {
          console.warn(
            "[backup-checksum] Worker digest failed; falling back to main-thread SHA-256:",
            error,
          );
          fallbackWarningLogged = true;
        }
        // Fall through to main-thread fallback.
      }
    } else {
      if (!fallbackWarningLogged) {
        console.warn(
          "[backup-checksum] Worker client has no checksum API; falling back to main-thread SHA-256.",
        );
        fallbackWarningLogged = true;
      }
    }
  }

  const fallback = await computeChecksumOnMainThread(buffer);
  onProgress?.({
    phase: "digest",
    bytesProcessed: fallback.bytesProcessed,
    totalBytes: fallback.totalBytes,
  });
  return fallback.checksum;
}
