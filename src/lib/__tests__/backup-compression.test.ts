/**
 * @fileOverview Backup Compression Tests
 *
 * - Issue #918: backup exports must be compressed (gzip) while restore still
 *   accepts legacy uncompressed JSON for backward compatibility.
 * - Issue #1084: compressed backups embed a SHA-256 integrity checksum;
 *   restore verifies it and refuses corrupted backups. Round-trip and
 *   corruption-detection tests prove lossless restore and tamper rejection.
 */

import { describe, it, expect, jest } from "@jest/globals";
import { gzip } from "pako";
import {
  compressBackup,
  decompressBackup,
  compressData,
  decompressData,
  isGzipBackup,
  hasIntegrityChecksum,
  sha256Hex,
  BackupIntegrityError,
  BACKUP_COMPRESSED_MIME,
  BACKUP_COMPRESSED_EXTENSION,
  BACKUP_CHECKSUM_PREFIX,
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

/** UTF-8 encode a string the same way the compress path does. */
function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Build a "corrupted checksum" copy: same valid gzip payload, but the
 * `pn1:sha256=` marker is overwritten with a different (wrong) digest. The
 * gzip stream stays structurally valid, so decompression succeeds and the
 * MISMATCH must be caught by the integrity check rather than by gzip itself.
 */
function tamperChecksum(bytes: Uint8Array): Uint8Array {
  const prefix = BACKUP_CHECKSUM_PREFIX;
  const out = new Uint8Array(bytes); // copies the source buffer
  for (let i = 0; i <= out.length - prefix.length - 64; i++) {
    let matches = true;
    for (let j = 0; j < prefix.length; j++) {
      if (out[i + j] !== prefix.charCodeAt(j)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      // Overwrite the 64 hex chars with "f"s (a wrong, but well-formed, hash).
      for (let k = 0; k < 64; k++) {
        out[i + prefix.length + k] = "f".charCodeAt(0);
      }
      return out;
    }
  }
  throw new Error("test fixture: checksum prefix not found in backup");
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

  // -------------------------------------------------------------------------
  // Issue #1084 — integrity checksum + round-trip restore tests
  // -------------------------------------------------------------------------

  describe("sha256Hex", () => {
    it("matches the published SHA-256 test vectors (FIPS 180-2)", () => {
      expect(sha256Hex(utf8(""))).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
      expect(sha256Hex(utf8("abc"))).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
      expect(sha256Hex(utf8("a".repeat(1000000)))).toBe(
        "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
      );
    });

    it("hashes multi-block UTF-8 payloads deterministically (64 hex chars)", () => {
      const payload =
        '{"decks":[{"id":"⚡","name":"Sørling / 日本語 — café"}]}';
      const digest = sha256Hex(utf8(payload));
      expect(digest).toHaveLength(64);
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      // Deterministic: same input yields the same digest.
      expect(sha256Hex(utf8(payload))).toBe(digest);
      // Avalanche sanity: a tiny change produces a completely different digest.
      expect(sha256Hex(utf8(payload + " "))).not.toBe(digest);
    });
  });

  describe("integrity checksum presence", () => {
    it("embeds a pn1:sha256 checksum in new compressed backups", () => {
      const compressed = compressBackup(makeBackup());
      expect(hasIntegrityChecksum(compressed)).toBe(true);
      // The marker should also be readable from the raw comment bytes.
      const asLatin1 = Array.from(compressed)
        .map((b) => String.fromCharCode(b))
        .join("");
      expect(asLatin1).toContain(BACKUP_CHECKSUM_PREFIX);
    });

    it("reports no checksum for old compressed backups (pre-#1084)", () => {
      const oldCompressed = gzip(JSON.stringify(makeBackup()));
      expect(hasIntegrityChecksum(oldCompressed)).toBe(false);
    });

    it("reports no checksum for legacy raw-JSON backups", () => {
      const legacy = new TextEncoder().encode(JSON.stringify(makeBackup()));
      expect(hasIntegrityChecksum(legacy)).toBe(false);
    });

    it("computes the checksum over the decompressed JSON payload", () => {
      const backup = makeBackup();
      const compressed = compressBackup(backup);
      const expected = sha256Hex(utf8(JSON.stringify(backup)));
      const comment = Array.from(compressed)
        .map((b) => String.fromCharCode(b))
        .join("");
      expect(comment).toContain(`${BACKUP_CHECKSUM_PREFIX}${expected}`);
    });
  });

  describe("round-trip restore (deep equality)", () => {
    it("compress -> restore === original for nested structures", () => {
      const original = makeBackup();
      const restored = decompressBackup(compressBackup(original));
      expect(restored).toEqual(original); // deep equality
    });

    it("preserves unicode strings losslessly", () => {
      const original = makeBackup();
      original.decks[0].name = "⚡ Lantern 日本語 café — Sørling";
      original.decks[0].metadata = { glyph: "Æ\nΩ\t\"" };
      const restored = decompressBackup(compressBackup(original));
      expect(restored).toEqual(original);
      expect(restored.decks[0].name).toBe("⚡ Lantern 日本語 café — Sørling");
    });

    it("preserves large arrays element-for-element", () => {
      const original = makeBackup();
      const big = Array.from({ length: 5000 }, (_, i) => ({
        id: `bulk-${i}`,
        value: i * 2,
      }));
      original.decks[0].metadata = { bulk: big };
      const restored = decompressBackup(compressBackup(original));
      expect(restored).toEqual(original);
      const bulk = restored.decks[0].metadata.bulk as Array<{
        id: string;
        value: number;
      }>;
      expect(bulk).toHaveLength(5000);
      expect(bulk[4999]).toEqual({
        id: "bulk-4999",
        value: 9998,
      });
    });

    it("works generically via compressData/decompressData for any payload", () => {
      const payload = {
        arbitrary: true,
        nested: { a: [1, 2, { b: "x" }], unicode: "🚀" },
        n: 42,
      };
      const restored = decompressData(compressData(payload));
      expect(restored).toEqual(payload);
    });
  });

  describe("corruption detection", () => {
    it("rejects a backup whose stored checksum does not match the payload", () => {
      const compressed = compressBackup(makeBackup());
      const tampered = tamperChecksum(compressed);
      // gzip is still valid here, so decompression succeeds; the integrity
      // check itself must catch the mismatch.
      expect(() => decompressBackup(tampered)).toThrow(BackupIntegrityError);
      expect(() => decompressBackup(tampered)).toThrow(/integrity/i);
    });

    it("rejects a backup with a byte-flipped payload", () => {
      const compressed = new Uint8Array(compressBackup(makeBackup()));
      // Flip a byte in the deflate payload region (past the header).
      const mid = Math.floor(compressed.length / 2);
      compressed[mid] ^= 0xff;
      expect(() => decompressBackup(compressed)).toThrow();
    });

    it("rejects a truncated (incomplete) backup", () => {
      const compressed = compressBackup(makeBackup());
      const truncated = compressed.slice(
        0,
        Math.floor(compressed.length / 2),
      );
      expect(() => decompressBackup(truncated)).toThrow();
    });

    it("does not return partial or incorrect data on corruption", () => {
      const compressed = compressBackup(makeBackup());
      const tampered = tamperChecksum(compressed);
      let leaked: unknown = "untouched";
      try {
        leaked = decompressBackup(tampered);
      } catch {
        // expected
      }
      expect(leaked).toBe("untouched"); // nothing was returned
    });
  });

  describe("backward compatibility", () => {
    it("restores an old checksum-less compressed backup with a warning", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const original = makeBackup();
      // Simulate a pre-#1084 backup: gzip without the integrity comment.
      const oldCompressed = gzip(JSON.stringify(original));
      expect(hasIntegrityChecksum(oldCompressed)).toBe(false);

      const restored = decompressBackup(oldCompressed);
      expect(restored).toEqual(original);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("restores legacy raw JSON with a warning", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const original = makeBackup();
      const legacy = new TextEncoder().encode(JSON.stringify(original));
      const restored = decompressBackup(legacy);
      expect(restored).toEqual(original);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("does not warn when restoring a verified (checksummed) backup", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const original = makeBackup();
      decompressBackup(compressBackup(original));
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
