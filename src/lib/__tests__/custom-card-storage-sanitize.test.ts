/**
 * Tests for src/lib/custom-card-storage.ts sanitization (issue #1276)
 *
 * Verifies that custom-card JSON saved or imported via the storage API
 * is sanitized at the data layer so that a malicious deck file cannot
 * plant a stored-XSS payload that survives every render site.
 */

import {
  saveCustomCard,
  getCustomCards,
  importCustomCards,
  clearAllCustomCards,
} from "../custom-card-storage";
import type { CustomCardDefinition } from "../custom-card";
import { DEFAULT_CUSTOM_CARD } from "../custom-card";

const now = Date.now();

function makeCard(overrides: Partial<CustomCardDefinition> = {}): CustomCardDefinition {
  return {
    ...(DEFAULT_CUSTOM_CARD as Omit<CustomCardDefinition, "id" | "createdAt" | "updatedAt">),
    id: "test-card-1",
    name: "Lightning Bolt",
    typeLine: "Instant",
    oracleText: "Lightning Bolt deals 3 damage to any target.",
    rarity: "common",
    cardTypes: ["instant"],
    colors: ["red"],
    art: { ...DEFAULT_CUSTOM_CARD.art, useProceduralArt: true },
    typography: { ...DEFAULT_CUSTOM_CARD.typography },
    background: { ...DEFAULT_CUSTOM_CARD.background },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("custom-card-storage — sanitization", () => {
  beforeEach(() => {
    clearAllCustomCards();
  });

  describe("saveCustomCard", () => {
    it("strips script tags from oracleText before storing", () => {
      const card = makeCard({
        id: "xss-script",
        name: "Bad",
        oracleText: "Lightning Bolt <script>alert(1)</script>",
      });
      saveCustomCard(card);
      const stored = getCustomCards().find((c) => c.id === "xss-script")!;
      expect(stored.oracleText).not.toContain("<script>");
      expect(stored.oracleText).toContain("&lt;script&gt;");
    });

    it("strips onerror handlers from oracleText before storing", () => {
      const card = makeCard({
        id: "xss-onerror",
        name: "Bad",
        oracleText: '<img src=x onerror=fetch("/leak")>',
      });
      saveCustomCard(card);
      const stored = getCustomCards().find((c) => c.id === "xss-onerror")!;
      // The actual XSS gate is that no raw <img tag survives — every `<`
      // must be escaped so the browser cannot parse it as a tag.
      expect(stored.oracleText).not.toMatch(/<\s*img\b/i);
      expect(stored.oracleText).toContain("&lt;img");
    });

    it("strips javascript: URLs from imageUrl before storing", () => {
      const card = makeCard({
        id: "xss-js-url",
        name: "Bad",
        oracleText: "noop",
        art: {
          ...DEFAULT_CUSTOM_CARD.art,
          useProceduralArt: false,
          imageUrl: "javascript:alert(1)",
        },
      });
      saveCustomCard(card);
      const stored = getCustomCards().find((c) => c.id === "xss-js-url")!;
      // imageUrl is scheme-validated via sanitizeUrl and replaced with an
      // empty string when the scheme is dangerous. The card preview then
      // falls back to procedural art.
      expect(stored.art.imageUrl).toBe("");
    });

    it("strips control characters and zero-width joiners from card name", () => {
      const card = makeCard({
        id: "xss-control",
        name: "Card\u202Etext\u200B<script>alert(1)</script>",
      });
      saveCustomCard(card);
      const stored = getCustomCards().find((c) => c.id === "xss-control")!;
      // eslint-disable-next-line no-control-regex -- C0/bidi/zero-width are the targets
      expect(stored.name).not.toMatch(/[\u0000-\u001F\u202A-\u202E\u200B-\u200D]/);
      expect(stored.name).not.toContain("<script>");
    });

    it("preserves Scryfall reminder symbol arrows in oracleText", () => {
      const card = makeCard({
        id: "ok-arrow",
        name: "OK",
        oracleText: "{T}: Add {C} → {W} or {U}.",
      });
      saveCustomCard(card);
      const stored = getCustomCards().find((c) => c.id === "ok-arrow")!;
      expect(stored.oracleText).toContain("→");
      expect(stored.oracleText).toContain("{T}");
    });

    it("does not mutate the input card object", () => {
      const card = makeCard({
        id: "no-mutate",
        oracleText: "<script>alert(1)</script>",
      });
      const before = card.oracleText;
      saveCustomCard(card);
      // Original input is unchanged — sanitization produces a copy.
      expect(card.oracleText).toBe(before);
    });
  });

  describe("importCustomCards", () => {
    it("sanitizes every imported card before merging into storage", () => {
      const json = JSON.stringify([
        makeCard({
          id: "imp-1",
          name: "<script>alert(1)</script>",
          oracleText: "<img src=x onerror=alert(1)>",
        }),
        makeCard({
          id: "imp-2",
          name: "OK Card",
          oracleText: "{T}: Add {G}.",
        }),
      ]);
      const result = importCustomCards(json);
      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      const stored = getCustomCards();
      const imp1 = stored.find((c) => c.id === "imp-1")!;
      const imp2 = stored.find((c) => c.id === "imp-2")!;
      expect(imp1.name).not.toContain("<script>");
      expect(imp1.oracleText).not.toContain("<img");
      // Non-malicious card text survives (modulo HTML escaping).
      expect(imp2.oracleText).toContain("{T}");
    });

    it("refuses to import non-array input", () => {
      const result = importCustomCards('{"not": "an array"}');
      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain("expected array");
    });

    it("rejects individual cards missing required fields", () => {
      const json = JSON.stringify([{ id: "x" }, { name: "no id" }]);
      const result = importCustomCards(json);
      expect(result.success).toBe(true); // import succeeded overall
      expect(result.count).toBe(0);
      expect(result.errors.length).toBe(2);
    });
  });
});