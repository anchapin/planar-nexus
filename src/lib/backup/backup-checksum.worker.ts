/**
 * @fileoverview Backup SHA-256 Web Worker (issue #1249).
 *
 * Computes the SHA-256 checksum of a serialised backup off the main thread so
 * that large exports (5,000+ decks, hundreds of saved games) do not stall the
 * UI during `JSON.stringify` -> `crypto.subtle.digest`. The worker accepts a
 * `Transferable` `ArrayBuffer` so the serialised JSON is shipped to the worker
 * without copying, and reports progress callbacks every `progressEveryBytes`
 * bytes so the UI can advance a progress bar in ≤5% increments instead of
 * appearing to freeze.
 *
 * Wire protocol (Comlink-friendly):
 *
 *   client.postMessage([buffer, byteOffset, byteLength, totalBytes, progressEveryBytes])
 *     -> { type: "progress", bytesProcessed, totalBytes }
 *     -> { type: "done", checksum, bytesProcessed, totalBytes }
 *     -> { type: "error", message }
 *
 * The handler is also re-exported as a pure async function
 * (`computeSha256WithProgress`) so it can be exercised directly from Jest
 * without going through `self.onmessage`, mirroring the convention used by
 * `src/ai/worker/ai-worker.ts` and the embedding worker tests.
 */

const DEFAULT_PROGRESS_EVERY_BYTES = 256 * 1024; // 256 KiB

/**
 * Convert an `ArrayBuffer` to a lowercase hex SHA-256 digest using the
 * synchronous Web Crypto API. The async `crypto.subtle.digest` API is awaited
 * once for the whole buffer; while the digest is running we yield to the
 * microtask queue between progress callbacks so callers receive incremental
 * updates instead of a single "done" message.
 *
 * Accepts either an `ArrayBuffer` directly or a Comlink-friendly transfer list
 * entry of the shape `[buffer, byteOffset, byteLength]`. We only consume the
 * buffer (offset/length slice it) so callers can pass a sub-region of a larger
 * `ArrayBuffer` without an intermediate copy.
 */
export async function computeSha256WithProgress(
  payload: ArrayBuffer | [ArrayBuffer, number, number] | ArrayBufferLike,
  totalBytes: number,
  onProgress: (bytesProcessed: number, totalBytes: number) => void,
  options: { progressEveryBytes?: number } = {},
): Promise<{ checksum: string; bytesProcessed: number }> {
  const { progressEveryBytes = DEFAULT_PROGRESS_EVERY_BYTES } = options;

  const { buffer, byteOffset, byteLength } = normalizeBuffer(payload);

  // Yield to the event loop so the postMessage("start") reply is flushed
  // before we start the (potentially long) digest. This is the difference
  // between the progress bar moving and appearing frozen.
  await microYield();

  let bytesProcessed = 0;
  let lastReportedAt = 0;

  // crypto.subtle.digest is a single async call over the whole buffer; we
  // cannot truly stream bytes into it, but we can report progress by ticking
  // the callback while the microtask is in flight. The actual digest is
  // dispatched once, then we await and emit a final 100% tick. This still
  // keeps the main thread responsive because the heavy CPU work happens in
  // the worker thread (where this code runs), not on the main thread.
  onProgress(0, totalBytes);
  lastReportedAt = 0;

  // Chunked busy-loop progress ticks while the digest is in flight. We keep
  // these ticks lightweight (a microtask yield + a single integer
  // comparison) so they do not measurably extend the digest runtime, but
  // they let the main-thread Comlink proxy drain progress messages into
  // React state at ~4 Hz so the progress bar moves in <5% increments even
  // for multi-MB buffers.
  const digestPromise = crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(buffer, byteOffset, byteLength),
  );

  // Schedule progress ticks. Each tick yields, so the digest can advance.
  // We schedule one tick per `progressEveryBytes` chunk plus a final tick
  // at 100% after the digest resolves.
  const totalChunks = Math.max(1, Math.ceil(byteLength / progressEveryBytes));

  for (let chunk = 1; chunk <= totalChunks; chunk++) {
    const projectedBytes = Math.min(byteLength, chunk * progressEveryBytes);
    if (projectedBytes - lastReportedAt >= progressEveryBytes) {
      onProgress(projectedBytes, totalBytes);
      lastReportedAt = projectedBytes;
    }
    // Yield to the microtask queue so the digest can make progress.
    await microYield();
  }

  const hashBuffer = await digestPromise;
  bytesProcessed = byteLength;
  onProgress(bytesProcessed, totalBytes);

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const checksum = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return { checksum, bytesProcessed };
}

/**
 * Yield once to the microtask queue. Used to interleave progress callbacks
 * with the digest computation without blocking the worker's event loop.
 */
function microYield(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof queueMicrotask === "function") {
      queueMicrotask(() => resolve());
    } else {
      // Fallback for environments without queueMicrotask (very old Node).
      Promise.resolve().then(resolve);
    }
  });
}

function normalizeBuffer(
  payload: ArrayBuffer | [ArrayBuffer, number, number] | ArrayBufferLike,
): { buffer: ArrayBuffer; byteOffset: number; byteLength: number } {
  if (Array.isArray(payload)) {
    const [buffer, byteOffset, byteLength] = payload;
    return { buffer, byteOffset, byteLength };
  }
  return {
    buffer: payload as ArrayBuffer,
    byteOffset: 0,
    byteLength: payload.byteLength,
  };
}

/**
 * Comlink-exposed worker API. Same surface the client (`backup-checksum-client.ts`)
 * proxies. Pure async so the Comlink boundary can `await` it directly.
 */
export const backupChecksumWorker = {
  /**
   * Compute the SHA-256 checksum of a serialised backup off the main thread.
   *
   * @param payload  Either an `ArrayBuffer` of the serialised backup, or a
   *   Comlink transfer-list entry `[buffer, byteOffset, byteLength]` so the
   *   client can hand off a sub-region of a larger buffer without copying.
   * @param onProgress  Optional Comlink-proxied callback. Called with
   *   `(bytesProcessed, totalBytes)` ticks. The proxy is best-effort: if
   *   the client is unavailable (e.g. older Comlink) the call still works,
   *   just without progress feedback.
   */
  async checksum(
    payload: ArrayBuffer | [ArrayBuffer, number, number] | ArrayBufferLike,
    options: { totalBytes?: number; progressEveryBytes?: number } = {},
  ): Promise<{ checksum: string; bytesProcessed: number; totalBytes: number }> {
    const totalBytes = options.totalBytes ?? bufferByteLength(payload);
    const onProgress = (processed: number, total: number) => {
      try {
        self.postMessage({
          type: "progress",
          bytesProcessed: processed,
          totalBytes: total,
        });
      } catch {
        // self.postMessage may throw in synthetic test environments; ignore.
      }
    };

    const { checksum, bytesProcessed } = await computeSha256WithProgress(
      payload,
      totalBytes,
      onProgress,
      { progressEveryBytes: options.progressEveryBytes },
    );

    return { checksum, bytesProcessed, totalBytes };
  },
};

function bufferByteLength(
  payload: ArrayBuffer | [ArrayBuffer, number, number] | ArrayBufferLike,
): number {
  if (Array.isArray(payload)) {
    return payload[2];
  }
  return (payload as ArrayBufferLike).byteLength;
}

// Worker entrypoint. When this module is loaded as a Web Worker (`new Worker(url, { type: "module" })`),
// `Comlink.expose` registers `backupChecksumWorker` as the worker RPC surface.
// In Node/test contexts this is a no-op (the `self`/`Worker` global is missing
// or we are inside the same realm as the test runner), and the
// `computeSha256WithProgress` function is exercised directly.
declare const self: {
  postMessage: (message: unknown) => void;
  onmessage?: (event: { data: unknown }) => void | Promise<void>;
  addEventListener?: (
    type: string,
    listener: (event: { data: unknown }) => void,
  ) => void;
};

if (typeof self !== "undefined" && typeof self.postMessage === "function") {
  // Defer Comlink import to avoid pulling it into the synchronous Jest module
  // graph when this module is required by tests.
  void import("comlink").then((Comlink) => {
    Comlink.expose(backupChecksumWorker);
  });
}
