/**
 * Tests for src/lib/security/chat-sanitize.ts (issue #1428)
 *
 * The chat sanitizer is the application-layer defense for the only P2P
 * message type with arbitrary peer-controlled content. These tests pin its
 * contract: control-char / bidi / zero-width stripping, raw-markup removal,
 * whitespace collapse, NFC normalization, length capping, idempotence, and
 * safe coercion of non-string input.
 */

import {
  sanitizeChatMessage,
  capMessageLength,
  MAX_CHAT_MESSAGE_LENGTH,
} from "../chat-sanitize";

describe("security/chat-sanitize — MAX_CHAT_MESSAGE_LENGTH", () => {
  it("defaults to 500 (sensible UI line count, below wire-size thresholds)", () => {
    expect(MAX_CHAT_MESSAGE_LENGTH).toBe(500);
  });
});

describe("security/chat-sanitize — sanitizeChatMessage", () => {
  it("passes normal text through unchanged", () => {
    expect(sanitizeChatMessage("hello world")).toBe("hello world");
    expect(sanitizeChatMessage("gg, nice play!")).toBe("gg, nice play!");
  });

  it("is idempotent (sanitize twice === sanitize once)", () => {
    const payloads = [
      "hello\x00world<script>",
      "a   b\u202E<c>",
      "\uFEFF\u200Bclean\u0007",
    ];
    for (const p of payloads) {
      const once = sanitizeChatMessage(p);
      const twice = sanitizeChatMessage(once);
      expect(twice).toBe(once);
    }
  });

  it("strips C0 control chars except tab/newline/cr", () => {
    // NUL, BEL, ESC, GS stripped...
    expect(sanitizeChatMessage("hello\x00world")).toBe("helloworld");
    expect(sanitizeChatMessage("a\x07b\x1Bc")).toBe("abc");
    // ...while \n \r \t are preserved (chat is line-oriented).
    expect(sanitizeChatMessage("line1\nline2")).toBe("line1\nline2");
    expect(sanitizeChatMessage("a\tb")).toBe("a\tb");
    expect(sanitizeChatMessage("a\rb")).toBe("a\rb");
  });

  it("strips DEL and the C1 (0x80-0x9F) 8-bit control range", () => {
    expect(sanitizeChatMessage("a\x7Fb")).toBe("ab");
    expect(sanitizeChatMessage("a\x80b")).toBe("ab");
    expect(sanitizeChatMessage("a\x9Fb")).toBe("ab");
  });

  it("strips bidi override / embedding controls (Trojan-source defense)", () => {
    // U+202E RLO, U+202D LRO, U+2066 LRI ... U+2069 PDI
    expect(sanitizeChatMessage("a\u202Eb")).toBe("ab");
    expect(sanitizeChatMessage("a\u202Db")).toBe("ab");
    expect(sanitizeChatMessage("a\u2066b\u2069")).toBe("ab");
  });

  it("strips zero-width and BOM characters", () => {
    // U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+FEFF BOM
    expect(sanitizeChatMessage("a\u200Bb")).toBe("ab");
    expect(sanitizeChatMessage("a\u200Cb\u200Dc")).toBe("abc");
    expect(sanitizeChatMessage("\uFEFFhi")).toBe("hi");
  });

  it("strips raw HTML/markup-significant chars (<, >, backtick)", () => {
    expect(sanitizeChatMessage("<img src=x>")).toBe("img src=x");
    expect(sanitizeChatMessage("<script>alert(1)</script>")).toBe(
      "scriptalert(1)/script",
    );
    expect(sanitizeChatMessage("a`b`c")).toBe("abc");
  });

  it("collapses runs of 2+ horizontal whitespace into a single space", () => {
    expect(sanitizeChatMessage("a    b")).toBe("a b");
    expect(sanitizeChatMessage("a\t\t\tb")).toBe("a b"); // tabs collapse too
    expect(sanitizeChatMessage("a b")).toBe("a b"); // single space preserved
  });

  it("preserves newlines through whitespace collapsing", () => {
    expect(sanitizeChatMessage("line1\nline2\n\nline4")).toBe(
      "line1\nline2\n\nline4",
    );
  });

  it("normalizes to NFC so decomposed forms cannot smuggle confusables", () => {
    // é as decomposed (e + U+0301 combining acute) vs precomposed (U+00E9).
    const decomposed = "e\u0301";
    const precomposed = "\u00E9";
    expect(sanitizeChatMessage(decomposed)).toBe(precomposed);
  });

  it("coerces non-string input safely to an empty (or stringified) result", () => {
    expect(sanitizeChatMessage(undefined)).toBe("");
    expect(sanitizeChatMessage(null)).toBe("");
    expect(sanitizeChatMessage(42)).toBe("42");
    expect(sanitizeChatMessage({ x: 1 })).toBe("[object Object]");
  });

  it("strips a combined malicious payload down to safe text", () => {
    // control char + HTML tag + bidi override + zero-width, all in one.
    const payload = "hi\x00<svg/onload=alert(1)>\u202E\u200Bboom";
    expect(sanitizeChatMessage(payload)).toBe("hisvg/onload=alert(1)boom");
  });
});

describe("security/chat-sanitize — capMessageLength", () => {
  it("leaves messages at or under the limit untouched", () => {
    expect(capMessageLength("short")).toBe("short");
    expect(capMessageLength("x".repeat(500), 500)).toBe("x".repeat(500));
  });

  it("truncates over-length messages and stays within the budget", () => {
    const out = capMessageLength("x".repeat(501), 500);
    expect(out.length).toBe(500);
    expect(out.endsWith("…")).toBe(true);
    expect(out.startsWith("x")).toBe(true);
  });

  it("defaults to MAX_CHAT_MESSAGE_LENGTH when no max given", () => {
    const out = capMessageLength("y".repeat(600));
    expect(out.length).toBe(MAX_CHAT_MESSAGE_LENGTH);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns empty string for a non-positive max length", () => {
    expect(capMessageLength("abc", 0)).toBe("");
    expect(capMessageLength("abc", -5)).toBe("");
  });

  it("coerces non-string input", () => {
    expect(capMessageLength(123, 500)).toBe("123");
    expect(capMessageLength(null, 500)).toBe("");
  });

  it("composes with sanitizeChatMessage on the receive path", () => {
    // Mirrors the receiver: sanitize first, then cap.
    const malicious = "a".repeat(495) + "<x>\x00" + "b".repeat(100);
    const sanitized = sanitizeChatMessage(malicious);
    const capped = capMessageLength(sanitized, 500);
    expect(capped.length).toBeLessThanOrEqual(500);
    expect(capped).not.toMatch(/[<>]/);
    expect(capped).not.toContain("\x00");
    expect(capped.endsWith("…")).toBe(true);
  });
});
