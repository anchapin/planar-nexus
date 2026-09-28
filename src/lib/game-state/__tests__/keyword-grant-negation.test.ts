/**
 * Shared grant/negation-aware oracle detection (issue #2348).
 *
 * This module replaced two byte-identical private regex lists — the one in
 * `keyword-actions/infect.ts` (#2351) and the one in
 * `keyword-actions/indestructible.ts` (#2350) — with a single parameterized
 * implementation. The tests below pin three things:
 *
 *   1. The five phrase classes behave identically for EVERY keyword, including
 *      multi-word ones ("first strike", "double strike"), which is the whole
 *      reason the helper is parameterized.
 *   2. The false-negative direction is protected. A genuine keyword card whose
 *      parsed `keywords` array is missing must still resolve true — bare "has
 *      KW" is deliberately NOT a grant/negation phrase, and a real keyword tag
 *      short-circuits before the guard is ever consulted.
 *   3. Every gate wired to the helper agrees on the same corpus, so two copies
 *      of a gate can never drift apart again (the defect class behind #2346 and
 *      #2350).
 */
import {
  isKeywordGrantOrNegationPhrase,
  oracleTextDeclaresOwnKeyword,
} from "../keyword-actions/grant-negation";
import {
  hasInfect,
  hasHexproof,
  hasShroud,
  hasProwess,
  isIndestructible,
} from "../evergreen-keywords";
import { hasMutate } from "../mutate";
import {
  hasHexproof as hasHexproofTargeting,
  hasShroud as hasShroudTargeting,
} from "../targeting-validation";
import { createCardInstance } from "../card-instance";
import type { CardInstance, ScryfallCard } from "../types";

function makeInstance(over: Partial<ScryfallCard> = {}): CardInstance {
  return createCardInstance(
    {
      id: "test-card",
      name: "Test Card",
      type_line: "Creature — Test",
      oracle_text: "",
      keywords: [],
      ...over,
    } as ScryfallCard,
    "p1" as CardInstance["ownerId"],
    "p1" as CardInstance["controllerId"],
  );
}

/** Every keyword the guard is currently wired to, plus multi-word stress cases. */
const KEYWORDS = [
  "indestructible",
  "infect",
  "hexproof",
  "shroud",
  "prowess",
  "mutate",
  "deathtouch",
  "trample",
  "vigilance",
  "first strike",
  "double strike",
] as const;

// ---------------------------------------------------------------------------
// 1. The phrase classes, per keyword
// ---------------------------------------------------------------------------

describe("isKeywordGrantOrNegationPhrase — phrase classes", () => {
  /** Each entry is one of the five classes, with {K} standing for the keyword. */
  const REJECTED: Array<[string, string]> = [
    ["gains?", "This creature gains {K} until end of turn."],
    ["gains? (stem form)", "This creature gain {K}."],
    ["lose[sd]?", "Creatures your opponents control lose {K}."],
    ["lose[sd]? (stem form)", "Other creatures lose {K}."],
    ["have", "Other creatures you control have {K}."],
    ["with", "Creatures you control with {K} get +1/+1 until end of turn."],
    [
      "has ... as long as",
      "This creature has {K} as long as an opponent is poisoned.",
    ],
  ];

  it.each(KEYWORDS)(
    "rejects every grant/negation class for '%s'",
    (keyword) => {
      for (const [label, template] of REJECTED) {
        const text = template.replace(/\{K\}/g, keyword);
        expect({
          label,
          text,
          result: isKeywordGrantOrNegationPhrase(keyword, text),
        }).toEqual({ label, text, result: true });
      }
    },
  );

  /** Bare "has" and the bare keyword are self-declarations, never grants. */
  const ACCEPTED: Array<[string, string]> = [
    ["bare keyword", "{K}"],
    ["bare has", "This creature has {K}."],
    ["compound with keyword", "Indestructible and hexproof."],
    ["empty", ""],
  ];

  it.each(KEYWORDS)("accepts self-declarations for '%s'", (keyword) => {
    for (const [label, template] of ACCEPTED) {
      const text = template.replace(/\{K\}/g, keyword);
      expect({
        label,
        text,
        result: isKeywordGrantOrNegationPhrase(keyword, text),
      }).toEqual({ label, text, result: false });
    }
  });

  it("is case-insensitive on the keyword argument", () => {
    expect(isKeywordGrantOrNegationPhrase("INDESTRUCTIBLE", "gains it")).toBe(
      false,
    );
    expect(
      isKeywordGrantOrNegationPhrase(
        "Indestructible",
        "Other creatures you control have indestructible.",
      ),
    ).toBe(true);
  });

  it("does not let a keyword be interpreted as a regex", () => {
    // The keyword is embedded literally, so a metacharacter cannot widen the
    // pattern. "double strike" contains a space, not a character class.
    expect(isKeywordGrantOrNegationPhrase("a.c", "gains a.c")).toBe(true);
    expect(isKeywordGrantOrNegationPhrase("a.c", "gains abc")).toBe(false);
  });

  it("handles a missing/empty oracle text without throwing", () => {
    expect(isKeywordGrantOrNegationPhrase("hexproof", "")).toBe(false);
    expect(oracleTextDeclaresOwnKeyword("hexproof", "")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The composed fallback arm
// ---------------------------------------------------------------------------

describe("oracleTextDeclaresOwnKeyword", () => {
  it("requires the keyword to be a standalone token", () => {
    expect(oracleTextDeclaresOwnKeyword("hexproof", "Hexproofbreaker")).toBe(
      false,
    );
    expect(oracleTextDeclaresOwnKeyword("shroud", "Enshrouded in mist.")).toBe(
      false,
    );
    expect(
      oracleTextDeclaresOwnKeyword("shroud", "This creature is unshrouded."),
    ).toBe(false);
    expect(
      oracleTextDeclaresOwnKeyword("shroud", "Shrouding the temple."),
    ).toBe(false);
  });

  it("accepts a genuine self-declaration", () => {
    expect(
      oracleTextDeclaresOwnKeyword("indestructible", "Indestructible"),
    ).toBe(true);
    expect(
      oracleTextDeclaresOwnKeyword(
        "indestructible",
        "This creature has indestructible.",
      ),
    ).toBe(true);
  });

  it("rejects a grant even when the keyword appears elsewhere in the text too", () => {
    // The guard scans the whole sentence, so a real declaration in a
    // grant-bearing text still loses on the untagged path. The strict arm is
    // what rescues a genuine card — see the gates describe below.
    expect(
      oracleTextDeclaresOwnKeyword(
        "hexproof",
        "Other creatures you control have hexproof. This creature has hexproof.",
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Every wired gate agrees
// ---------------------------------------------------------------------------

describe("gates wired to the shared guard agree on the same corpus", () => {
  interface Gate {
    name: string;
    keyword: string;
    has: (card: CardInstance) => boolean;
  }

  const GATES: Gate[] = [
    { name: "infect", keyword: "infect", has: hasInfect },
    {
      name: "indestructible",
      keyword: "indestructible",
      has: isIndestructible,
    },
    { name: "mutate", keyword: "mutate", has: hasMutate },
    { name: "shroud", keyword: "shroud", has: hasShroud },
    { name: "hexproof", keyword: "hexproof", has: hasHexproof },
  ];

  /** The five grant/negation classes — must all be rejected when untagged. */
  const REJECTED: Array<[string, string]> = [
    ["self-grant", "This creature gains {K} until end of turn."],
    ["other-grant", "Other creatures you control have {K}."],
    ["negation", "Creatures your opponents control lose {K}."],
    ["negation stem", "Other creatures lose {K}."],
    ["with-reference", "Creatures you control with {K} get +1/+1."],
    [
      "conditional",
      "This creature has {K} as long as an opponent is poisoned.",
    ],
  ];

  /**
   * Self-declarations — must be ACCEPTED when untagged. This is the
   * false-negative direction the whole design protects: bare "has KW" is
   * deliberately NOT in the guard's phrase list, so a genuine keyword card
   * whose parsed tag is missing still resolves true.
   */
  const ACCEPTED: Array<[string, string]> = [
    ["bare has", "This creature has {K}."],
    ["bare keyword", "{K}"],
  ];

  for (const gate of GATES) {
    describe(gate.name, () => {
      for (const [label, template] of REJECTED) {
        const text = template.replace(/\{K\}/g, gate.keyword);
        it(`rejects ${label} on the untagged path`, () => {
          expect(
            gate.has(makeInstance({ keywords: [], oracle_text: text })),
          ).toBe(false);
        });

        it(`accepts ${label} when the keyword tag is present`, () => {
          // The strict arm answers first, so the guard is unreachable for a
          // genuine card. This is what makes the tightening cheap.
          expect(
            gate.has(
              makeInstance({
                keywords: [gate.keyword],
                oracle_text: text,
              }),
            ),
          ).toBe(true);
        });
      }

      for (const [label, template] of ACCEPTED) {
        const text = template.replace(/\{K\}/g, gate.keyword);
        it(`accepts ${label} on the untagged path (no false negative)`, () => {
          expect(
            gate.has(makeInstance({ keywords: [], oracle_text: text })),
          ).toBe(true);
        });
      }
    });
  }

  it("a real keyword card is unaffected by a grant-bearing oracle text", () => {
    // The most important safety property: the guard only ever fires on cards
    // whose parsed tag is missing, so tightening cannot break a real card.
    const card = makeInstance({
      keywords: ["Hexproof"],
      oracle_text: "Other creatures you control have hexproof.",
    });
    expect(hasHexproof(card)).toBe(true);
    expect(hasHexproofTargeting(card)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. The two copy-pairs cannot drift
// ---------------------------------------------------------------------------

describe("divergent gate copies now agree", () => {
  const CORPUS = [
    "Shroud",
    "This creature is unshrouded.",
    "Shrouding the temple.",
    "Enshrouded in mist.",
    "The shroud is lifted.",
    "This creature loses shroud.",
    "Other creatures you control have shroud.",
    "Hexproof",
    "Hexproof from green.",
    "Other creatures you control have hexproof.",
    "Creatures your opponents control lose hexproof.",
  ];

  it.each(CORPUS)("hasShroud copies agree on %s", (oracle_text) => {
    const card = makeInstance({ keywords: [], oracle_text });
    expect(hasShroud(card)).toBe(hasShroudTargeting(card));
  });

  it.each(CORPUS)("hasHexproof copies agree on %s", (oracle_text) => {
    const card = makeInstance({ keywords: [], oracle_text });
    expect(hasHexproof(card)).toBe(hasHexproofTargeting(card));
  });
});

describe("prowess — closed by #2348", () => {
  it("does not fire for a creature that only grants prowess", () => {
    // This was live stat corruption: `applyProwessBoost` stamped a +1/+1 on a
    // lord that only granted prowess to others.
    const card = makeInstance({
      keywords: [],
      oracle_text: "Other creatures you control have prowess.",
    });
    expect(hasProwess(card)).toBe(false);
  });

  it("still fires for a genuine untagged prowess creature", () => {
    const card = makeInstance({
      keywords: [],
      oracle_text: "This creature has prowess.",
    });
    expect(hasProwess(card)).toBe(true);
  });
});
