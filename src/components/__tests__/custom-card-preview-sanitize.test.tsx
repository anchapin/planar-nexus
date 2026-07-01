/**
 * Render-time integration tests for sanitization at the React layer (issue #1276).
 *
 * Renders the `CustomCardPreview` with a deliberately malicious custom-card
 * definition (script tags, `onerror=` handlers, javascript: URLs, mixed-case
 * Unicode escapes, bidi controls, etc.) and asserts that the DOM after the
 * render contains no executable HTML tags or live event handlers.
 *
 * These tests are the integration complement to the unit tests in
 * `__tests__/sanitize-text.test.ts`. They exercise the actual JSX path:
 *   - the data layer sanitizes via `saveCustomCard` / `importCustomCards`
 *   - the component re-sanitizes at render
 *   - React's JSX auto-escaping neutralises whatever slips through
 */

import { render, screen } from "@testing-library/react";
import { CustomCardPreview } from "../custom-card-preview";
import { saveCustomCard } from "@/lib/custom-card-storage";
import { clearAllCustomCards } from "@/lib/custom-card-storage";
import type { CustomCardDefinition } from "@/lib/custom-card";
import { DEFAULT_CUSTOM_CARD } from "@/lib/custom-card";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const now = Date.now();

function makeMaliciousCard(overrides: Partial<CustomCardDefinition> = {}): CustomCardDefinition {
  return {
    ...(DEFAULT_CUSTOM_CARD as Omit<CustomCardDefinition, "id" | "createdAt" | "updatedAt">),
    id: "evil-card",
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

/**
 * Recursively walk the rendered DOM and confirm that no element has a
 * tag name that is part of the unsafe-tag deny list AND that no
 * `on*` event-handler attribute is present on any element.
 */
function expectNoExecutableDom(container: HTMLElement): void {
  const unsafe = new Set([
    "script",
    "iframe",
    "object",
    "embed",
    "form",
    "style",
    "svg",
    "math",
    "video",
    "audio",
  ]);
  // No element with an unsafe tag name.
  container.querySelectorAll("*").forEach((el) => {
    expect(unsafe.has(el.tagName.toLowerCase())).toBe(false);
  });
  // No element with any `on*` event-handler attribute (the React `on*`
  // synthetic-event props are NOT serialised to DOM, so anything here
  // would be an injected attribute).
  container.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      expect(/^on/i.test(attr.name)).toBe(false);
    }
  });
  // No element with a `javascript:` href.
  container.querySelectorAll("a[href]").forEach((a) => {
    expect((a as HTMLAnchorElement).href.toLowerCase()).not.toMatch(/^javascript:/);
  });
}

describe("CustomCardPreview — render-time sanitization", () => {
  beforeEach(() => {
    clearAllCustomCards();
  });

  afterEach(() => {
    clearAllCustomCards();
  });

  const xssVectors: Array<{ name: string; payload: (key: keyof CustomCardDefinition) => string }> = [
    {
      name: "script tag in name",
      payload: () => "Evil <script>alert('xss-name')</script>",
    },
    {
      name: "img onerror in oracleText",
      payload: () => "<img src=x onerror=fetch('/leak')>",
    },
    {
      name: "javascript: URL in imageUrl",
      payload: () => "javascript:alert(1)",
    },
    {
      name: "iframe injection in flavorText",
      payload: () => "<iframe src='https://evil/'></iframe>",
    },
    {
      name: "mixed-case Unicode escape in name",
      payload: () => "<\u0053cript>alert(1)</\u0053cript>",
    },
    {
      name: "bidi control smuggling in name",
      payload: () => "Card\u202E<script>alert(1)</script>",
    },
  ];

  for (const vector of xssVectors) {
    it(`does not execute ${vector.name}`, () => {
      const overrides: Partial<CustomCardDefinition> = {};
      // Pick a sensible field for each vector.
      const target: keyof CustomCardDefinition =
        vector.name.includes("imageUrl")
          ? "art"
          : vector.name.includes("oracleText")
            ? "oracleText"
            : vector.name.includes("flavorText")
              ? "flavorText"
              : "name";
      if (target === "art") {
        overrides.art = {
          ...DEFAULT_CUSTOM_CARD.art,
          useProceduralArt: false,
          imageUrl: vector.payload("art"),
        };
      } else {
        (overrides as Record<string, unknown>)[target] = vector.payload(target);
      }
      const card = makeMaliciousCard(overrides);
      // Persist through the storage layer (data-layer sanitization).
      saveCustomCard(card);

      const { container } = render(<CustomCardPreview card={card} />);

      // Render-site sanitization should also have run; either layer is
      // sufficient to neutralize the payload, but the DOM must be clean
      // regardless of which layer was the gate.
      expectNoExecutableDom(container);

      // Additionally assert that no visible text on the page contains
      // a raw `<script>` substring (i.e. unescaped tag markers).
      const text = container.textContent ?? "";
      expect(text).not.toContain("<script>");
      expect(text).not.toContain("</script>");
    });
  }

  it("preserves Scryfall reminder-symbol arrows through render", () => {
    const card = makeMaliciousCard({
      oracleText: "{T}: Add {C}{C} → {W} or {U}. (→ is a reminder arrow.)",
    });
    saveCustomCard(card);
    const { container } = render(<CustomCardPreview card={card} />);
    const text = container.textContent ?? "";
    expect(text).toContain("→");
    expect(text).toContain("{T}");
    expectNoExecutableDom(container);
  });
});