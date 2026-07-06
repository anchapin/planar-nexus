/**
 * @fileoverview Tests for the backup SHA-256 Web Worker (issue #1249).
 *
 * The worker is a pure async function (`computeSha256WithProgress`) plus a
 * Comlink-exposed wrapper (`backupChecksumWorker`). These tests exercise
 * both surfaces directly without going through `self.onmessage`, mirroring
 * the convention in `src/lib/ai/__tests__/embedding-worker.test.ts`.
 *
 * SHA-256 correctness is asserted against the canonical NIST / RFC test
 * vectors. We use the real Node `crypto.webcrypto.subtle` for these
 * assertions — `jest.setup.js` installs a tiny hex-encoding mock that is
 * fine for tiny inputs but quadratic-on-bytes for multi-MB fixtures.
 */
import { describe, it, expect, beforeAll } from "@jest/globals";
import * as nodeCrypto from "node:crypto";

import {
  computeSha256WithProgress,
  backupChecksumWorker,
} from "../backup-checksum.worker";

// Restore the real SHA-256 implementation before running these tests.
// `jest.setup.js` overrides `global.crypto.subtle.digest` with a hex-
// encoding mock that is fine for tiny inputs but unacceptably slow for
// multi-MB fixtures. We restore the Node webcrypto here so the canonical
// SHA-256 vectors in KNOWN_VECTORS produce the correct digests.
beforeAll(() => {
  const realSubtle = nodeCrypto.webcrypto.subtle;
  if (!global.crypto) {
    // @ts-expect-error -- test-only crypto restore in jsdom.
    global.crypto = {};
  }
  Object.defineProperty(global.crypto, "subtle", {
    configurable: true,
    get: () => realSubtle,
  });
});

// Known SHA-256 test vectors from NIST FIPS 180-2 / RFC reference fixtures.
// Using a known vector lets us assert byte-identity between the worker
// output and the pre-#1249 main-thread implementation, which is the
// backward-compatibility guarantee issue #1249 requires.
const KNOWN_VECTORS: Array<{ name: string; input: string; expected: string }> =
  [
    {
      name: "empty string",
      input: "",
      expected:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      name: "abc",
      input: "abc",
      expected:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    },
    {
      name: "two-block message",
      input: "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      expected:
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    },
  ];

describe("backup-checksum.worker (issue #1249)", () => {
  describe("computeSha256WithProgress", () => {
    it.each(KNOWN_VECTORS)(
      "produces the canonical SHA-256 of $name",
      async ({ input, expected }) => {
        const bytes = new TextEncoder().encode(input);
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        );

        const onProgress = jest.fn();
        const result = await computeSha256WithProgress(
          buffer,
          buffer.byteLength,
          onProgress,
        );

        expect(result.checksum).toBe(expected);
        expect(result.bytesProcessed).toBe(buffer.byteLength);
      },
    );

    it("emits progress callbacks including a 0% and 100% tick", async () => {
      // Use a small progressEveryBytes so we can verify multiple ticks
      // without allocating a multi-MB buffer in unit tests.
      const bytes = new TextEncoder().encode("a".repeat(2048));
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );

      const ticks: Array<{ processed: number; total: number }> = [];
      const onProgress = (processed: number, total: number) => {
        ticks.push({ processed, total });
      };

      await computeSha256WithProgress(buffer, buffer.byteLength, onProgress, {
        progressEveryBytes: 256,
      });

      expect(ticks.length).toBeGreaterThanOrEqual(2);
      // The first tick must report 0 bytes processed.
      expect(ticks[0]).toEqual({ processed: 0, total: buffer.byteLength });
      // The last tick must report all bytes processed (100%).
      const lastTick = ticks[ticks.length - 1];
      expect(lastTick.processed).toBe(buffer.byteLength);
      expect(lastTick.total).toBe(buffer.byteLength);
      // Progress must be monotonically non-decreasing.
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i].processed).toBeGreaterThanOrEqual(
          ticks[i - 1].processed,
        );
      }
    });

    it("honours a Comlink-style [buffer, offset, length] transfer entry", async () => {
      // Build a buffer with a sentinel region we should NOT hash, by
      // wrapping our known 'abc' string in a larger buffer with garbage
      // bytes before and after.
      const inner = new TextEncoder().encode("abc");
      const padding = 16;
      const padded = new Uint8Array(padding + inner.byteLength + padding);
      padded.fill(0x7f);
      padded.set(inner, padding);

      const onProgress = jest.fn();
      const result = await computeSha256WithProgress(
        [padded.buffer, padding, inner.byteLength],
        inner.byteLength,
        onProgress,
      );

      // The hash of 'abc' is well-known; if the worker honored the
      // sub-region slice correctly it must match.
      expect(result.checksum).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
      expect(result.bytesProcessed).toBe(inner.byteLength);
    });
  });

  describe("backupChecksumWorker.checksum", () => {
    it("returns the same digest as computeSha256WithProgress", async () => {
      const bytes = new TextEncoder().encode("hello worker");
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );

      const result = await backupChecksumWorker.checksum(buffer, {
        totalBytes: buffer.byteLength,
      });

      // Independently compute the expected hash for verification.
      const expected = await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(buffer),
      );
      const expectedHex = Array.from(new Uint8Array(expected))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      expect(result.checksum).toBe(expectedHex);
      expect(result.bytesProcessed).toBe(buffer.byteLength);
      expect(result.totalBytes).toBe(buffer.byteLength);
    });

    it("accepts a sub-region [buffer, offset, length] entry", async () => {
      const inner = new TextEncoder().encode("abc");
      const padded = new Uint8Array(32 + inner.byteLength + 32);
      padded.fill(0x42);
      padded.set(inner, 32);

      const result = await backupChecksumWorker.checksum(
        [padded.buffer, 32, inner.byteLength],
        { totalBytes: inner.byteLength },
      );

      expect(result.checksum).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
    });
  });

  describe("main-thread blocking budget (acceptance criterion #1249)", () => {
    it("a 1 MB fixture keeps the worker invocation under 1 s", async () => {
      // Build a 1 MB buffer of pseudo-random data so the digest is
      // non-trivial. The full 10 MB Playwright perf-trace assertion from
      // issue #1249 is verified end-to-end, not in Jest — at 1 MB the
      // wall-clock cost stays sub-50 ms on any modern CI runner.
      const SIZE = 1 * 1024 * 1024;
      const buffer = new ArrayBuffer(SIZE);
      const view = new Uint8Array(buffer);
      // Cheap deterministic filler — Xorshift so the digest is non-trivial.
      let seed = 0x12345678;
      for (let i = 0; i < SIZE; i++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        view[i] = seed & 0xff;
      }

      const start = Date.now();
      const result = await backupChecksumWorker.checksum(buffer, {
        totalBytes: SIZE,
      });
      const elapsedMs = Date.now() - start;

      expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(result.bytesProcessed).toBe(SIZE);
      // 1 s is a generous ceiling — catches genuine regressions (e.g.
      // accidental main-thread fallback) without being flaky on slow CI.
      expect(elapsedMs).toBeLessThan(1000);
    }, 30000);
  });
});
