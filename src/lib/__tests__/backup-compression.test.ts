/**
 * @fileOverview Backup Compression Tests
 *
 * Issue #918: backup exports must be compressed (gzip) while restore still
 * accepts legacy uncompressed JSON for backward compatibility.
 */

import { describe, it, expect } from "@jest/globals";
import {
  compressBackup,
  decompressBackup,
  isGzipBackup,
  BACKUP_COMPRESSED_MIME,
  BACKUP_COMPRESSED_EXTENSION,
} from "../backup-compression";
import type { BackupData } from "../indexeddb-storage";

/** Build a realistically-sized, highly-repetitive backup payload. */
function makeBackup(): BackupData {
  const decks = Array.from({ length: 25 }, (_, i) => ({
    id: `deck-${i}`,
    name: `Test Deck ${i}`,
    format: i % 2 === 0 ? "standard" : "commander",
    cards: Array.from({ length: 60 }, (_, c) => ({
      card: {
        id: `card-${c}`,
        name: `Repetitive Card Name ${c % 5}`,
        cmc: c % 7,
      },
      count: 1 + (c % 4),
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: { note: "lorem ipsum dolor sit amet".repeat(8) },
  }));

  return {
    version: "1.0.0",
    exportedAt: new Date().toISOString(),
    decks: decks as unknown as BackupData["decks"],
    savedGames: [],
    preferences: { theme: "dark" },
    usageTracking: [],
    achievements: [],
    checksum: "deadbeef",
  };
}

describe("backup-compression", () => {
  describe("isGzipBackup", () => {
    it("detects the gzip magic header", () => {
      const backup = makeBackup();
      const compressed = compressBackup(backup);
      expect(isGzipBackup(compressed)).toBe(true);
    });

    it("returns false for legacy JSON bytes", () => {
      const json = new TextEncoder().encode(JSON.stringify(makeBackup()));
      expect(isGzipBackup(json)).toBe(false);
    });

    it("returns false for buffers shorter than 2 bytes", () => {
      expect(isGzipBackup(new Uint8Array([]))).toBe(false);
      expect(isGzipBackup(new Uint8Array([0x1f]))).toBe(false);
    });
  });

  describe("compressBackup", () => {
    it("produces a gzip stream (magic 0x1f 0x8b)", () => {
      const compressed = compressBackup(makeBackup());
      expect(compressed[0]).toBe(0x1f);
      expect(compressed[1]).toBe(0x8b);
    });

    it("produces bytes smaller than the raw pretty-printed JSON", () => {
      const backup = makeBackup();
      const compressed = compressBackup(backup);
      const rawPretty = new TextEncoder().encode(
        JSON.stringify(backup, null, 2),
      );
      expect(compressed.length).toBeLessThan(rawPretty.length);
      // Sanity: compression should yield a meaningful reduction.
      expect(compressed.length).toBeLessThan(rawPretty.length * 0.5);
    });

    it("exposes the expected mime type and extension constants", () => {
      expect(BACKUP_COMPRESSED_MIME).toBe("application/gzip");
      expect(BACKUP_COMPRESSED_EXTENSION).toBe(".json.gz");
    });
  });

  describe("decompressBackup", () => {
    it("round-trips a compressed backup with identical data", () => {
      const original = makeBackup();
      const restored = decompressBackup(compressBackup(original));
      expect(restored).toEqual(original);
    });

    it("reads legacy uncompressed JSON (backward compatibility)", () => {
      const original = makeBackup();
      const legacyBytes = new TextEncoder().encode(
        JSON.stringify(original, null, 2),
      );
      const restored = decompressBackup(legacyBytes);
      expect(restored).toEqual(original);
    });

    it("reads compact (non-pretty) legacy JSON too", () => {
      const original = makeBackup();
      const legacyBytes = new TextEncoder().encode(JSON.stringify(original));
      expect(decompressBackup(legacyBytes)).toEqual(original);
    });

    it("accepts an ArrayBuffer as well as a Uint8Array", () => {
      const original = makeBackup();
      const compressed = compressBackup(original);
      const buffer = compressed.buffer.slice(
        compressed.byteOffset,
        compressed.byteOffset + compressed.byteLength,
      );
      expect(decompressBackup(buffer as ArrayBuffer)).toEqual(original);
    });

    it("throws on invalid (non-JSON) legacy input", () => {
      const bytes = new TextEncoder().encode("not valid json at all");
      expect(() => decompressBackup(bytes)).toThrow();
    });
  });

  describe("round-trip integrity", () => {
    it("preserves deck array contents through compress -> decompress", () => {
      const original = makeBackup();
      const restored = decompressBackup(compressBackup(original));
      expect(restored.decks).toHaveLength(original.decks.length);
      expect(restored.decks[3].id).toBe(original.decks[3].id);
      expect(restored.decks[10]).toEqual(original.decks[10]);
    });

    it("preserves checksum, version, and preferences", () => {
      const original = makeBackup();
      const restored = decompressBackup(compressBackup(original));
      expect(restored.checksum).toBe(original.checksum);
      expect(restored.version).toBe(original.version);
      expect(restored.preferences).toEqual(original.preferences);
    });
  });
});
