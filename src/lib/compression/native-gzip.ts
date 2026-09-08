/**
 * Facade for the engine-owned native gzip helpers (issue #1724).
 *
 * The rules engine consumes these helpers for deterministic game-state
 * serialization compression, so the definitions moved INTO the engine
 * (src/lib/game-state/native-gzip.ts) to keep the engine self-contained.
 * This module re-exports them so existing consumers
 * (src/lib/backup-compression.ts and the native-gzip test suite) keep
 * importing from their historical path unchanged.
 */
export {
  gzipCompress,
  gzipDecompress,
  injectGzipComment,
} from "@/lib/game-state";
