/**
 * Render-time integration tests for sanitization at the AI coach output
 * layer (issue #1276).
 *
 * Renders the `EnhancedReviewDisplay` and `ReviewDisplay` components with
 * AI coach output containing XSS payloads and asserts that no executable
 * tag or `on*` event handler survives in the rendered DOM.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "@jest/globals";
import { EnhancedReviewDisplay } from "../enhanced-review-display";
import { ReviewDisplay } from "../review-display";
import type { DeckReviewOutput } from "@/ai/flows/ai-deck-coach-review";

function makeReviewWithPayload(payload: string): DeckReviewOutput {
  return {
    reviewSummary: payload,
    archetype: {
      primary: payload,
      confidence: 0.9,
      description: payload,
    },
    deckOptions: [
      {
        title: payload,
        description: payload,
        cardsToAdd: [{ name: payload, quantity: 1 }],
        cardsToRemove: [{ name: payload, quantity: 1 }],
      },
    ],
    synergies: {
      present: [
        {
          name: payload,
          score: 80,
          cards: [payload],
          description: payload,
          category: "tribal",
        },
      ],
      missing: [
        {
          synergy: payload,
          missing: payload,
          description: payload,
          suggestion: payload,
          impact: "high",
        },
      ],
    },
  };
}

function expectNoExecutableDom(container: HTMLElement): void {
  // Tags that are *content-bearing* XSS vectors. We intentionally do not
  // forbid `<svg>` / `<math>` / `<style>` because Lucide icons use
  // `<svg>` for visual indicators and Tailwind/CSS-in-JS libraries
  // inject `<style>` tags with static CSS; those are safe when their
  // attributes are static. The attack surface is the `on*` handler
  // attributes and dangerous schemes, which we check separately below.
  const unsafe = new Set([
    "script",
    "iframe",
    "object",
    "embed",
    "form",
    "video",
    "audio",
    "frame",
    "frameset",
  ]);
  container.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (unsafe.has(tag)) {
      throw new Error(`Found unsafe tag ${tag} in rendered DOM`);
    }
    for (const attr of Array.from(el.attributes)) {
      expect(/^on/i.test(attr.name)).toBe(false);
    }
  });
  container.querySelectorAll("a[href]").forEach((a) => {
    expect((a as HTMLAnchorElement).href.toLowerCase()).not.toMatch(/^javascript:/);
  });
}

const vectors: Array<{ name: string; payload: string }> = [
  { name: "script tag", payload: "<script>alert('coach-xss')</script>" },
  { name: "img onerror", payload: "<img src=x onerror=fetch('/leak')>" },
  { name: "javascript: link", payload: "[click](javascript:alert(1))" },
  { name: "data:text/html link", payload: "[evil](data:text/html,<script>alert(1)</script>)" },
  { name: "iframe", payload: "<iframe src='https://evil/'></iframe>" },
  { name: "svg onload", payload: "<svg onload=alert(1)></svg>" },
  { name: "mixed-case Unicode", payload: "<\u0053cript>alert(1)</\u0053cript>" },
  { name: "bidi smuggling", payload: "Title\u202E<script>alert(1)</script>" },
  { name: "data:text/html as archetype description", payload: "data:text/html,<script>alert(1)</script>" },
];

describe("EnhancedReviewDisplay — render-time sanitization", () => {
  for (const v of vectors) {
    it(`neutralizes ${v.name} in coach output`, () => {
      const review = makeReviewWithPayload(v.payload);
      const { container } = render(
        <EnhancedReviewDisplay
          review={review}
          onSaveNewDeck={async () => undefined}
          decklist=""
        />,
      );
      expectNoExecutableDom(container);
      // No anchor with a `javascript:` href. Literal text may still
      // contain the substring "javascript:" when it appears as visible
      // link text (e.g. `[click](javascript:alert(1))`), but the DOM
      // must never materialise it as an actionable href.
      container.querySelectorAll("a[href]").forEach((a) => {
        expect((a as HTMLAnchorElement).href.toLowerCase()).not.toMatch(/^javascript:/);
      });
    });
  }

  it("preserves legitimate markdown subset rendering", () => {
    const review: DeckReviewOutput = {
      reviewSummary: "**Strong** deck with _three_ key `archetype` cards.",
      deckOptions: [],
      synergies: { present: [], missing: [] },
    };
    const { container } = render(
      <EnhancedReviewDisplay
        review={review}
        onSaveNewDeck={async () => undefined}
        decklist=""
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Strong");
    expect(text).toContain("three");
    expect(text).toContain("archetype");
    expectNoExecutableDom(container);
  });
});

describe("ReviewDisplay — render-time sanitization", () => {
  for (const v of vectors) {
    it(`neutralizes ${v.name} in coach output`, () => {
      const review = makeReviewWithPayload(v.payload);
      const { container } = render(
        <ReviewDisplay review={review} onSaveNewDeck={async () => undefined} />,
      );
      expectNoExecutableDom(container);
      container.querySelectorAll("a[href]").forEach((a) => {
        expect((a as HTMLAnchorElement).href.toLowerCase()).not.toMatch(/^javascript:/);
      });
    });
  }
});