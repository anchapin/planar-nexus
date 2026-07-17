/**
 * Integration test: storage backup compress / decompress roundtrip.
 *
 * Exercises the real cross-module data flow used by the storage backup feature:
 *   in-memory BackupData
 *     -> backup-compression.compressBackup  (native gzip, RFC-1952 magic header)
 *     -> isGzipBackup                        (format detection)
 *     -> backup-compression.decompressBackup (restore, auto-detects gzip vs legacy JSON)
 *
 * It also covers the legacy uncompressed-JSON backward-compatibility path and
 * the generic compressData/decompressData helpers. Resolves issue #931.
 *
 * Issue #1423: the compress/decompress entry points are now `async` (they
 * drive the native `CompressionStream` / `DecompressionStream` APIs).
 */

import { describe, it, expect } from "@jest/globals";

import {
  compressBackup,
  decompressBackup,
  compressData,
  decompressData,
  isGzipBackup,
} from "@/lib/backup-compression";
import type { BackupData } from "@/lib/indexeddb-storage";

function buildBackup(): BackupData {
  return {
    version: "2.0.0",
    exportedAt: "2026-06-24T00:00:00.000Z",
    decks: [
      {
        id: "deck-burn-001",
        name: "Mono-Red Burn",
        format: "constructed-core",
        cards: [],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    ] as unknown as BackupData["decks"],
    savedGames: [] as BackupData["savedGames"],
    preferences: {
      theme: "dark",
      soundEnabled: true,
      lastFormat: "constructed-core",
    },
    checksum: "sha256:deadbeefcafef00d",
  };
}

describe("backup compress / decompress roundtrip", () => {
  const data = buildBackup();

  it("compresses a backup into a gzip stream marked by the RFC-1952 magic bytes", async () => {
    const compressed = await compressBackup(data);
    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed.length).toBeGreaterThan(2);
    expect(isGzipBackup(compressed)).toBe(true);
    // gzip magic header doubles as the format marker.
    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);
  });

  it("restores a compressed backup byte-for-byte (deep equality)", async () => {
    const compressed = await compressBackup(data);
    const restored = await decompressBackup(compressed);
    expect(restored).toEqual(data);
    expect(restored.decks[0].name).toBe("Mono-Red Burn");
    expect(restored.preferences).toEqual(data.preferences);
  });

  it("restores legacy uncompressed-JSON backups for backward compatibility", async () => {
    // Legacy backups were raw UTF-8 JSON (no gzip magic) -> must not be detected as gzip.
    const legacyBytes = new TextEncoder().encode(JSON.stringify(data));
    expect(isGzipBackup(legacyBytes)).toBe(false);

    const restored = await decompressData<BackupData>(legacyBytes);
    expect(restored).toEqual(data);
  });

  it("accepts ArrayBuffer input (the shape produced by File.arrayBuffer())", async () => {
    const compressed = await compressBackup(data);
    // Reconstruct a standalone ArrayBuffer the same way File.arrayBuffer() would.
    const buf = new ArrayBuffer(compressed.byteLength);
    new Uint8Array(buf).set(compressed);
    const restored = await decompressBackup(buf);
    expect(restored).toEqual(data);
  });

  it("meaningfully compresses large repetitive payloads", async () => {
    const large = {
      repeat: "ABCD".repeat(5000),
      nested: { values: Array.from({ length: 1000 }, (_, i) => i) },
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(large)).length;
    const compressed = await compressData(large);
    expect(isGzipBackup(compressed)).toBe(true);
    // gzip should crush 20KB of repetition to a small fraction of its size.
    expect(compressed.length).toBeLessThan(jsonBytes * 0.1);
  });

  it("round-trips arbitrary typed payloads through the generic helpers", async () => {
    const payload = { count: 42, items: ["a", "b", "c"], flag: false };
    const restored = await decompressData<typeof payload>(
      await compressData(payload),
    );
    expect(restored).toEqual(payload);
  });
});
