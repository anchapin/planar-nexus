/**
 * Tests for src/lib/security/sanitize-text.ts (issue #1276)
 *
 * Cover at least 6 XSS attack vectors per public function:
 *   - <script>alert(1)</script>
 *   - <img src=x onerror=fetch('/leak')>
 *   - javascript: URLs
 *   - on*= event handlers
 *   - data: URIs (text/html)
 *   - mixed-case and unicode-escape variants
 */

import {
  escapeHtml,
  sanitizeCardText,
  sanitizeMarkdown,
  sanitizeUrl,
  sanitizeImageUrl,
  sanitizeCustomCardFields,
  DEFAULT_MAX_CARD_TEXT_LENGTH,
  DEFAULT_MAX_MARKDOWN_LENGTH,
  __testing__,
} from "../sanitize-text";

/**
 * Assert that the given HTML string contains no element from the
 * deny-list of tags that would constitute an XSS vector if present in the
 * DOM. `sanitizeMarkdown` outputs HTML intentionally, so we cannot blanket
 * forbid all tags — we forbid only the unsafe ones.
 */
function expectNoUnsafeTags(html: string): void {
  const tagPattern = /<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/g;
  let m: RegExpExecArray | null;
  while ((m = tagPattern.exec(html)) !== null) {
    const tagName = m[1]!.toLowerCase();
    expect(__testing__.UNSAFE_TAGS.has(tagName)).toBe(false);
  }
}

describe("security/sanitize-text", () => {
  describe("escapeHtml", () => {
    it("escapes the five HTML-significant characters", () => {
      expect(escapeHtml(`<script>"&'<\``)).toBe(
        "&lt;script&gt;&quot;&amp;&#39;&lt;&#96;",
      );
    });

    it("returns an empty string for non-string inputs", () => {
      expect(escapeHtml(undefined)).toBe("");
      expect(escapeHtml(null)).toBe("");
      expect(escapeHtml(42)).toBe("");
      expect(escapeHtml({})).toBe("");
      expect(escapeHtml([])).toBe("");
    });

    it("leaves a string with no special characters untouched", () => {
      expect(escapeHtml("Lightning Bolt deals 3 damage.")).toBe(
        "Lightning Bolt deals 3 damage.",
      );
    });

    it("does not double-escape ampersands (single pass)", () => {
      expect(escapeHtml("a &amp; b")).toBe("a &amp;amp; b");
    });
  });

  describe("sanitizeCardText — XSS vectors", () => {
    const vectors: Array<{ name: string; payload: string }> = [
      {
        name: "script tag",
        payload: "Lightning Bolt <script>alert(1)</script>",
      },
      {
        name: "img onerror handler",
        payload: "<img src=x onerror=fetch('/leak')>",
      },
      {
        name: "javascript: URL",
        payload: "Click <a href=javascript:alert(1)>here</a>",
      },
      {
        name: "iframe injection",
        payload: "<iframe src='https://evil/'></iframe>",
      },
      {
        name: "svg with onload",
        payload: "<svg onload=alert(1)></svg>",
      },
      {
        name: "mixed-case Unicode escape trick",
        payload: "<\u0053cript>alert(1)</\u0053cript>",
      },
      {
        name: "HTML entity attempt in attribute",
        payload: "<a href=\"javascript&#58;alert(1)\">x</a>",
      },
      {
        name: "null byte injection",
        payload: "Good text\u0000<script>alert(1)</script>",
      },
      {
        name: "bidi override smuggling",
        payload: "Card\u202Etext<script>alert(1)</script>",
      },
      {
        name: "zero-width joiner hiding payload",
        payload: "Card\u200B<script>alert(1)</script>",
      },
    ];

    for (const v of vectors) {
      it(`strips ${v.name}`, () => {
        const out = sanitizeCardText(v.payload);
        // No raw HTML-significant character survives — every < and > must
        // have been escaped to &lt; / &gt;. This is the actual XSS gate.
        expect(out).not.toMatch(/<(?:[a-zA-Z/!]|\?)/);
        // Output must never contain a real HTML tag fragment.
        expect(out).not.toMatch(__testing__.HTML_RESIDUE);
        // Null/bidi/zero-width characters must be stripped.
        // eslint-disable-next-line no-control-regex -- C0/bidi/zero-width are the targets
        expect(out).not.toMatch(/[\u0000\u202A-\u202E\u200B-\u200D\uFEFF]/);
      });
    }

    it("preserves Scryfall reminder-symbol arrows and mana braces", () => {
      const text = "{T}: Add {C}{C} → {W} or {U}. (→ is reminder.)";
      const out = sanitizeCardText(text);
      expect(out).toContain("{T}");
      expect(out).toContain("{C}");
      expect(out).toContain("→");
      expect(out).toContain("{W}");
      expect(out).toContain("{U}");
    });

    it("coerces non-string inputs safely", () => {
      expect(sanitizeCardText(undefined)).toBe("");
      expect(sanitizeCardText(null)).toBe("");
      expect(sanitizeCardText(42)).toBe("42");
      expect(sanitizeCardText(true)).toBe("true");
    });

    it("clamps length with truncation marker", () => {
      const long = "x".repeat(DEFAULT_MAX_CARD_TEXT_LENGTH + 100);
      const out = sanitizeCardText(long);
      expect(out.length).toBeLessThanOrEqual(DEFAULT_MAX_CARD_TEXT_LENGTH + 16);
      expect(out).toContain("…[truncated]");
    });

    it("respects a custom maxLength", () => {
      const out = sanitizeCardText("abcdefghij", 5);
      expect(out).toBe("abcde…[truncated]");
    });
  });

  describe("sanitizeUrl — URI scheme XSS vectors", () => {
    const blocked: string[] = [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "data:application/javascript,alert(1)",
      "file:///etc/passwd",
      "about:blank",
    ];
    for (const url of blocked) {
      it(`rejects ${JSON.stringify(url)}`, () => {
        expect(sanitizeUrl(url)).toBe("");
      });
    }

    const allowed: Array<[string, string]> = [
      ["https://example.com/card", "https://example.com/card"],
      ["http://example.com/x", "http://example.com/x"],
      ["mailto:hello@example.com", "mailto:hello@example.com"],
      ["/relative/path", "/relative/path"],
      ["#anchor", "#anchor"],
      ["?query=1", "?query=1"],
    ];
    for (const [input, expected] of allowed) {
      it(`accepts ${input}`, () => {
        expect(sanitizeUrl(input)).toBe(expected);
      });
    }

    it("escapes quotes in attribute-safe form", () => {
      const out = sanitizeUrl(`https://example.com/?a=1"b`);
      expect(out).not.toContain('"');
      expect(out).toContain("&quot;");
    });

    it("returns empty string for non-strings", () => {
      expect(sanitizeUrl(undefined)).toBe("");
      expect(sanitizeUrl(null)).toBe("");
      expect(sanitizeUrl(42)).toBe("");
    });
  });

  describe("sanitizeImageUrl", () => {
    it("allows data:image/png", () => {
      const png = "data:image/png;base64,iVBORw0KGgo=";
      expect(sanitizeImageUrl(png)).toBe(png);
    });

    it("rejects data:text/html", () => {
      expect(sanitizeImageUrl("data:text/html,<script>alert(1)</script>")).toBe("");
    });

    it("rejects javascript: scheme in image src", () => {
      expect(sanitizeImageUrl("javascript:alert(1)")).toBe("");
    });
  });

  describe("sanitizeMarkdown — XSS vectors", () => {
    const vectors: Array<{ name: string; payload: string; mustNotContain: string[] }> = [
      {
        name: "<script> tag in markdown",
        payload: "**bold** <script>alert(1)</script>",
        mustNotContain: ["<script>", "</script>"],
      },
      {
        name: "img onerror in markdown",
        payload: "Look <img src=x onerror=fetch('/leak')> here",
        mustNotContain: ["<img", "onerror=", "fetch("],
      },
      {
        name: "javascript: link",
        payload: "[click](javascript:alert(1))",
        mustNotContain: ["javascript:", "alert(1)"],
      },
      {
        name: "data:text/html link",
        payload: "[evil](data:text/html,<script>alert(1)</script>)",
        mustNotContain: ["<script>", "data:text/html"],
      },
      {
        name: "auto-link with javascript:",
        payload: "<javascript:alert(1)>",
        mustNotContain: ["<a href=\"javascript:", "alert(1)"],
      },
      {
        name: "raw HTML heading",
        payload: "<h1>Header</h1>",
        mustNotContain: ["<h1>", "</h1>"],
      },
      {
        name: "style tag injection",
        payload: "<style>body{display:none}</style>",
        mustNotContain: ["<style", "</style>"],
      },
      {
        name: "iframe injection",
        payload: "Note <iframe src='https://evil/'></iframe>",
        mustNotContain: ["<iframe", "src='https://evil/'"],
      },
      {
        name: "bidi control smuggling",
        payload: "Title\u202E<script>alert(1)</script>",
        mustNotContain: ["\u202E", "<script>"],
      },
      {
        // CodeQL js/incomplete-multi-character-sanitization regression —
        // a leading `<` plus a tag like `<script>` can leave a stray
        // `<` after a single strip pass. The sanitizer must loop until
        // stable to defeat these.
        name: "nested-tag prefix smuggle",
        payload: "<<script>alert(1)</script>",
        mustNotContain: ["<script>", "</script>"],
      },
      {
        name: "bare script prefix (no closing >)",
        payload: "<script",
        mustNotContain: ["<script"],
      },
      {
        name: "double-nested script smuggle",
        payload: "<scr<script>ipt>alert(1)</script>",
        mustNotContain: ["<script>", "ipt>"],
      },
    ];
    for (const v of vectors) {
      it(`strips ${v.name}`, () => {
        const out = sanitizeMarkdown(v.payload);
        for (const fragment of v.mustNotContain) {
          expect(out).not.toContain(fragment);
        }
        expectNoUnsafeTags(out);
      });
    }

    it("renders safe markdown subset: bold", () => {
      expect(sanitizeMarkdown("**Lightning Bolt**")).toBe(
        "<p><strong>Lightning Bolt</strong></p>",
      );
    });

    it("renders safe markdown subset: italic", () => {
      expect(sanitizeMarkdown("*draw two cards*")).toBe(
        "<p><em>draw two cards</em></p>",
      );
    });

    it("renders safe markdown subset: inline code", () => {
      expect(sanitizeMarkdown("Use `{T}` to add mana")).toBe(
        "<p>Use <code>{T}</code> to add mana</p>",
      );
    });

    it("renders headings up to h3", () => {
      expect(sanitizeMarkdown("# Title")).toBe("<h1>Title</h1>");
      expect(sanitizeMarkdown("## Subtitle")).toBe("<h2>Subtitle</h2>");
      expect(sanitizeMarkdown("### Section")).toBe("<h3>Section</h3>");
    });

    it("renders unordered lists", () => {
      const md = "- one\n- two\n- three";
      expect(sanitizeMarkdown(md)).toBe(
        "<ul><li>one</li><li>two</li><li>three</li></ul>",
      );
    });

    it("renders ordered lists", () => {
      const md = "1. first\n2. second";
      expect(sanitizeMarkdown(md)).toBe(
        "<ol><li>first</li><li>second</li></ol>",
      );
    });

    it("renders safe https links with rel/target", () => {
      const md = "[Scryfall](https://scryfall.com/card)";
      const out = sanitizeMarkdown(md);
      expect(out).toContain('<a href="https://scryfall.com/card"');
      expect(out).toContain('rel="noopener noreferrer nofollow"');
      expect(out).toContain('target="_blank"');
      expect(out).toContain("Scryfall");
    });

    it("drops link text when URL is unsafe but keeps sanitized text", () => {
      const md = "[click](javascript:alert(1))";
      const out = sanitizeMarkdown(md);
      expect(out).not.toContain("javascript:");
      // The link target is dropped; only the escaped link text remains.
      expect(out).toContain("click");
    });

    it("coerces non-string inputs to empty", () => {
      expect(sanitizeMarkdown(undefined)).toBe("");
      expect(sanitizeMarkdown(null)).toBe("");
      expect(sanitizeMarkdown(42)).toBe("<p>42</p>");
    });

    it("clamps length with truncation marker", () => {
      const long = "x".repeat(DEFAULT_MAX_MARKDOWN_LENGTH + 100);
      const out = sanitizeMarkdown(long);
      expect(out.length).toBeLessThanOrEqual(DEFAULT_MAX_MARKDOWN_LENGTH + 32);
      expect(out).toContain("…[truncated]");
    });
  });

  describe("sanitizeCustomCardFields", () => {
    it("sanitizes all user-controllable string fields", () => {
      const card = {
        id: "c-1",
        name: "<script>alert(1)</script>",
        typeLine: "Creature — <b>Beast</b>",
        oracleText: "Destroy <img src=x onerror=alert(1)> target.",
        flavorText: "Hello <iframe></iframe> world.",
        power: "1+1",
        toughness: "1",
        loyalty: "3",
        manaCost: "{1}{R}",
        artist: "<b>Bad</b>",
        copyright: "© <script>x</script>",
        rarity: "rare",
      };
      const out = sanitizeCustomCardFields(card);
      expect(out.name).not.toContain("<script>");
      expect(out.typeLine).not.toContain("<b>");
      expect(out.oracleText).not.toContain("<img");
      expect(out.flavorText).not.toContain("<iframe");
      expect(out.artist).not.toContain("<b>");
      expect(out.copyright).not.toContain("<script>");
      expect(out.rarity).toBe("rare"); // untouched
    });

    it("returns the input unchanged for null / non-object", () => {
      expect(sanitizeCustomCardFields(null as unknown as Record<string, unknown>)).toBeNull();
      expect(sanitizeCustomCardFields(undefined as unknown as Record<string, unknown>)).toBeUndefined();
    });
  });
});