/**
 * @fileOverview Tests for the native gzip helper (issue #1423)
 *
 * Covers each direction of {@link gzipCompress} / {@link gzipDecompress} and
 * the {@link injectGzipComment} header splicer that preserves the
 * `pn1:sha256=<hex>` integrity contract from issue #1084.
 *
 * The `CompressionStream` / `DecompressionStream` globals are polyfilled in
 * `jest.setup.js` (jsdom does not implement them) so these tests exercise the
 * real production code path.
 */

import { describe, it, expect } from "@jest/globals";
import {
  gzipCompress,
  gzipDecompress,
  injectGzipComment,
} from "../native-gzip";

describe("native-gzip (issue #1423)", () => {
  describe("gzipCompress", () => {
    it("produces a gzip stream (magic 0x1f 0x8b)", async () => {
      const out = await gzipCompress("hello world");
      expect(out[0]).toBe(0x1f);
      expect(out[1]).toBe(0x8b);
    });

    it("emits the minimal 10-byte header with FLG=0 (no FCOMMENT)", async () => {
      const out = await gzipCompress("{}");
      // ID1 ID2 CM FLG MTIME(4) XFL OS — FLG byte at offset 3 must be 0.
      expect(out.length).toBeGreaterThanOrEqual(10);
      expect(out[2]).toBe(0x08); // CM = deflate
      expect(out[3]).toBe(0x00); // FLG = 0 (no FCOMMENT, FNAME, FEXTRA, FHCRC)
    });

    it("shrinks highly-repetitive input", async () => {
      const payload = "AAAA".repeat(10_000);
      const out = await gzipCompress(payload);
      expect(out.length).toBeLessThan(payload.length);
      expect(out.length).toBeLessThan(payload.length * 0.1);
    });

    it("handles empty input", async () => {
      const out = await gzipCompress("");
      expect(out[0]).toBe(0x1f);
      expect(out[1]).toBe(0x8b);
    });
  });

  describe("gzipDecompress", () => {
    it("round-trips a payload through compress -> decompress", async () => {
      const payload = '{"gameId":"abc","turn":42}';
      const compressed = await gzipCompress(payload);
      const restored = await gzipDecompress(compressed);
      expect(new TextDecoder().decode(restored)).toBe(payload);
    });

    it("preserves unicode strings losslessly", async () => {
      const payload = "⚡ Lantern 日本語 café — Sørling";
      const restored = await gzipDecompress(await gzipCompress(payload));
      expect(new TextDecoder().decode(restored)).toBe(payload);
    });

    it("preserves large arrays element-for-element", async () => {
      const payload = JSON.stringify(
        Array.from({ length: 5000 }, (_, i) => ({ id: `x-${i}`, v: i * 2 })),
      );
      const restored = await gzipDecompress(await gzipCompress(payload));
      expect(new TextDecoder().decode(restored)).toBe(payload);
    });

    it("rejects a corrupted gzip stream", async () => {
      const compressed = await gzipCompress("payload");
      // Flip a byte in the deflate body.
      compressed[compressed.length - 5] ^= 0xff;
      await expect(gzipDecompress(compressed)).rejects.toThrow();
    });

    it("rejects a truncated gzip stream", async () => {
      const compressed = await gzipCompress("payload");
      const truncated = compressed.slice(0, Math.floor(compressed.length / 2));
      await expect(gzipDecompress(truncated)).rejects.toThrow();
    });
  });

  describe("injectGzipComment", () => {
    it("sets the FLG.FCOMMENT bit and inserts the comment + null terminator", async () => {
      const compressed = await gzipCompress("{}");
      const injected = injectGzipComment(compressed, "pn1:sha256=abc");
      // FLG byte at offset 3 must now carry the FCOMMENT bit.
      expect(injected[3] & 0x10).toBe(0x10);
      // Comment text begins immediately after the 10-byte fixed header.
      const commentStart = 10;
      const commentText = Array.from(
        injected.subarray(commentStart, commentStart + "pn1:sha256=abc".length),
      )
        .map((b) => String.fromCharCode(b))
        .join("");
      expect(commentText).toBe("pn1:sha256=abc");
      // Followed by a null terminator.
      expect(injected[commentStart + "pn1:sha256=abc".length]).toBe(0x00);
    });

    it("grows the stream by comment.length + 1 (null terminator)", async () => {
      const compressed = await gzipCompress("hello");
      const comment = "pn1:sha256=" + "a".repeat(64);
      const injected = injectGzipComment(compressed, comment);
      expect(injected.length).toBe(compressed.length + comment.length + 1);
    });

    it("keeps the gzip stream decompressible (CRC-32 + ISIZE unchanged)", async () => {
      const payload = '{"decks":[1,2,3]}';
      const compressed = await gzipCompress(payload);
      const injected = injectGzipComment(
        compressed,
        "pn1:sha256=deadbeef".padEnd(78, "0"),
      );
      const restored = await gzipDecompress(injected);
      expect(new TextDecoder().decode(restored)).toBe(payload);
    });

    it("preserves the gzip magic and CM byte", async () => {
      const compressed = await gzipCompress("{}");
      const injected = injectGzipComment(compressed, "x");
      expect(injected[0]).toBe(0x1f);
      expect(injected[1]).toBe(0x8b);
      expect(injected[2]).toBe(0x08);
    });

    it("throws when the input is not a gzip stream", () => {
      const notGzip = new TextEncoder().encode("{not gzip}");
      expect(() => injectGzipComment(notGzip, "x")).toThrow(/gzip stream/);
    });

    it("throws when the input already carries an FCOMMENT field", async () => {
      const compressed = await gzipCompress("{}");
      const already = injectGzipComment(compressed, "first");
      expect(() => injectGzipComment(already, "second")).toThrow(/FCOMMENT/);
    });
  });

  describe("end-to-end with an embedded pn1:sha256 marker", () => {
    it("compresses with a checksum, decompresses, and verifies the marker", async () => {
      const payload = JSON.stringify({ decks: [{ id: "d1" }], savedGames: [] });
      // Compute SHA-256 of the UTF-8 payload the same way the production
      // compress path does.
      const encoder = new TextEncoder();
      const digestBuffer = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(payload),
      );
      const digestHex = Array.from(new Uint8Array(digestBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const compressed = await gzipCompress(payload);
      const marked = injectGzipComment(compressed, `pn1:sha256=${digestHex}`);

      // Read the FCOMMENT field back out of the marked header.
      const commentStart = 10;
      const commentEnd = marked.indexOf(0x00, commentStart);
      const comment = Array.from(marked.subarray(commentStart, commentEnd))
        .map((b) => String.fromCharCode(b))
        .join("");
      expect(comment).toBe(`pn1:sha256=${digestHex}`);

      // Round-trip the payload.
      const restored = await gzipDecompress(marked);
      expect(new TextDecoder().decode(restored)).toBe(payload);
    });
  });
});
