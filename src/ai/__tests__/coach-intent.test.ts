/**
 * @fileoverview Unit tests for the coach intent classifier (issue #1387).
 *
 * Covers at least two phrasings per supported intent, the ambiguous /
 * low-confidence `unknown` fallback, the deck-card-mention promotion
 * heuristic, and the requirement that sanitized (redacted) injection phrases
 * do not produce a misleading high-confidence intent.
 */

import { describe, it, expect } from "@jest/globals";
import {
  classifyCoachIntent,
  MIN_CONFIDENCE,
  type CoachIntent,
} from "@/ai/coach-intent";

describe("classifyCoachIntent — supported intents (issue #1387)", () => {
  const cases: Array<{
    intent: CoachIntent;
    phrasings: string[];
  }> = [
    {
      intent: "analyze",
      phrasings: [
        "Can you analyze my deck?",
        "Give me a review of how this deck looks",
        "What do you think of my deck overall?",
      ],
    },
    {
      intent: "wincon",
      phrasings: [
        "How does this deck win?",
        "What is my win condition here?",
      ],
    },
    {
      intent: "cut",
      phrasings: [
        "What should I cut?",
        "Which cards are weakest so I can remove them?",
      ],
    },
    {
      intent: "swap",
      phrasings: [
        "What should I add to improve the deck?",
        "Any upgrades you'd recommend swapping in?",
      ],
    },
    {
      intent: "card-analysis",
      phrasings: [
        "Is Lightning Bolt good in this deck?",
        "Should I keep Ragavan here?",
      ],
    },
    {
      intent: "sideboard",
      phrasings: [
        "What should I put in my sideboard?",
        "How do I board out against aggro?",
      ],
    },
    {
      intent: "mulligan",
      phrasings: [
        "Should I keep this opening hand?",
        "Is this a mulligan?",
      ],
    },
    {
      intent: "rules",
      phrasings: [
        "How does the stack work when I respond?",
        "Does this trigger go on the stack?",
      ],
    },
    {
      intent: "matchup",
      phrasings: [
        "How do I beat mono-red aggro?",
        "What's the matchup like versus control?",
      ],
    },
    {
      intent: "meta",
      phrasings: [
        "Is this deck viable in the current meta?",
        "What's the metagame breakdown right now?",
      ],
    },
  ];

  for (const { intent, phrasings } of cases) {
    describe(`intent: ${intent}`, () => {
      for (const phrase of phrasings) {
        it(`classifies "${phrase}" as ${intent}`, () => {
          const result = classifyCoachIntent(phrase);
          expect(result.intent).toBe(intent);
          expect(result.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
          expect(result.matchedSignals.length).toBeGreaterThan(0);
        });
      }
    });
  }
});

describe("classifyCoachIntent — fallback & confidence", () => {
  it("returns unknown for empty/blank input", () => {
    expect(classifyCoachIntent("").intent).toBe("unknown");
    expect(classifyCoachIntent("   ").intent).toBe("unknown");
    expect(classifyCoachIntent(null).intent).toBe("unknown");
  });

  it("returns unknown for ambiguous / non-coaching text", () => {
    const result = classifyCoachIntent("hello there, nice weather");
    expect(result.intent).toBe("unknown");
    expect(result.confidence).toBeLessThan(MIN_CONFIDENCE);
  });

  it("returns matchedSignals describing what fired", () => {
    const result = classifyCoachIntent("what should I cut from this deck?");
    expect(result.intent).toBe("cut");
    expect(result.matchedSignals.join(", ")).toBeTruthy();
  });

  it("confidence is within [0, 1]", () => {
    const result = classifyCoachIntent("how do I win?");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe("classifyCoachIntent — deck-card promotion heuristic", () => {
  it("promotes a bare deck-card mention toward card-analysis", () => {
    const result = classifyCoachIntent("so, llanowar elves?", {
      deckCardNames: ["Llanowar Elves", "Forest"],
    });
    expect(result.intent).toBe("card-analysis");
  });

  it("does not let the card heuristic override a clear cut intent", () => {
    const result = classifyCoachIntent(
      "should I cut Llanowar Elves from this deck?",
      { deckCardNames: ["Llanowar Elves"] },
    );
    expect(result.intent).toBe("cut");
  });
});

describe("classifyCoachIntent — sanitization interaction (#1107)", () => {
  it("does not classify a redacted injection override as a real intent", () => {
    // After sanitizeUserInput, an override phrase becomes "[redacted: ...]".
    // The classifier should treat that as non-coaching text → unknown.
    const redacted =
      "[redacted: possible instruction-override attempt] and then what should I cut";
    // The trailing "what should I cut" *will* still classify as cut — that's
    // fine; the point is the redacted prefix does not corrupt classification.
    const result = classifyCoachIntent(redacted);
    expect(["cut", "unknown"]).toContain(result.intent);
  });

  it("a purely-redacted payload classifies as unknown", () => {
    const result = classifyCoachIntent(
      "[redacted: possible system-prompt exfiltration attempt]",
    );
    expect(result.intent).toBe("unknown");
  });
});
