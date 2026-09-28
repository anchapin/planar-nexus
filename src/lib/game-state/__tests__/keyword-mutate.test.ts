/**
 * Mutate keyword enforcement (CR 702.140) — issue #2346.
 *
 * Pins the two defects fixed in this epic iteration:
 *
 *   1. FALSE POSITIVES — the old fallback was an **unanchored** substring scan
 *      (`oracle_text.includes("mutate")`), so the substring `mutate` inside
 *      `mutates`, `Unmutated`, `commutates` and the negation "This creature
 *      can't be mutated." all read as the keyword.
 *   2. FALSE NEGATIVES — the old `mutate.ts` keyword arm was
 *      `keywords.includes("Mutate")`, **case-SENSITIVE**, so a card tagged
 *      `keywords: ["mutate"]` with no oracle text was rejected by the live
 *      casting gate even though it genuinely has the keyword. Worse, the
 *      duplicate `evergreen-keywords.hasMutate` disagreed with it — the same
 *      card returned `false` from one export and `true` from the other.
 *
 * Per the epic convention, this file's helpers do **NOT** backfill `oracle_text`
 * from the keyword list, so each case states exactly the card data under test.
 * (`createMockCreature` in `keyword-enforcement.test.ts` *does* backfill and is
 * deliberately not used here.)
 */
import { describe, it, expect } from "@jest/globals";
import type { CardInstance, ScryfallCard } from "../types";
import { hasMutateStrict } from "../keyword-actions/mutate";
import { hasMutate as hasMutateEngine } from "../mutate";
import { hasMutate as hasMutateEvergreen } from "../evergreen-keywords";

function instance(over: Partial<ScryfallCard>): CardInstance {
  const cardData = {
    id: `mut-pin-${over.name ?? "card"}-${Math.random().toString(36).slice(2)}`,
    name: "Mutate Pin Card",
    type_line: "Creature — Beast",
    keywords: [],
    oracle_text: "",
    mana_cost: "{2}{U}",
    cmc: 3,
    colors: ["U"],
    color_identity: ["U"],
    legalities: { standard: "legal", commander: "legal" },
    ...over,
  } as ScryfallCard;

  return {
    id: cardData.id,
    cardData,
    ownerId: "player1",
    controllerId: "player1",
    zone: "hand",
    counters: [],
    statusFlags: {},
    mutatedCardIds: [],
    mutateBaseId: null,
    isMutated: false,
    highestCmcComponentId: null,
    attackedLastTurn: false,
  } as unknown as CardInstance;
}

/** Both production gates, so divergence between them is caught directly. */
const GATES: Array<[string, (c: CardInstance) => boolean]> = [
  ["mutate.ts#hasMutate", hasMutateEngine],
  ["evergreen-keywords#hasMutate", hasMutateEvergreen],
];

describe.each(GATES)("CR 702.140 mutate — %s", (_name, hasMutate) => {
  describe("true positives (genuinely has mutate)", () => {
    it("accepts the real Scryfall shape: keyword tag + 'Mutate {cost}'", () => {
      const card = instance({
        keywords: ["Mutate"],
        oracle_text: "Mutate {2}{U}",
      });
      expect(hasMutate(card)).toBe(true);
    });

    it("accepts a keyword tag with no oracle text", () => {
      const card = instance({ keywords: ["Mutate"], oracle_text: "" });
      expect(hasMutate(card)).toBe(true);
    });

    it("accepts a null/absent oracle text when the keyword is tagged", () => {
      const card = instance({ keywords: ["Mutate"], oracle_text: undefined });
      expect(hasMutate(card)).toBe(true);
    });

    it("accepts an untagged card whose text is exactly 'Mutate {cost}'", () => {
      const card = instance({ keywords: [], oracle_text: "Mutate {3}{U}" });
      expect(hasMutate(card)).toBe(true);
    });

    it("accepts the keyword when it is one of several tags", () => {
      const card = instance({ keywords: ["Flying", "Mutate", "Trample"] });
      expect(hasMutate(card)).toBe(true);
    });

    it("matches the text fallback case-insensitively", () => {
      const card = instance({ oracle_text: "mutate {2}{R}" });
      expect(hasMutate(card)).toBe(true);
    });
  });

  describe("false positives — substring `mutate` in a longer word", () => {
    it("rejects 'mutates'", () => {
      const card = instance({
        keywords: [],
        oracle_text: "This creature mutates at the end of turn.",
      });
      expect(hasMutate(card)).toBe(false);
    });

    it("rejects 'Unmutated'", () => {
      const card = instance({
        keywords: [],
        oracle_text: "Unmutated creatures gain flying.",
      });
      expect(hasMutate(card)).toBe(false);
    });

    it("rejects 'commutates'", () => {
      const card = instance({
        keywords: [],
        oracle_text: "The aether commutates.",
      });
      expect(hasMutate(card)).toBe(false);
    });

    it('rejects the negation "This creature can\'t be mutated."', () => {
      const card = instance({
        keywords: [],
        oracle_text: "This creature can't be mutated.",
      });
      expect(hasMutate(card)).toBe(false);
    });

    it("rejects 'mutation' (the old arm let this one through)", () => {
      const card = instance({
        keywords: [],
        oracle_text:
          "At the beginning of upkeep, each opponent loses 1 life for each mutation counter on it.",
      });
      // `includes("mutate")` did NOT match `mutation` (mutat-ion), so this case
      // documents behaviour that was already correct — kept as a regression
      // guard against a future looser regex.
      expect(hasMutate(card)).toBe(false);
    });
  });

  describe("false negatives — case-variant keyword tags", () => {
    it("accepts a lowercase 'mutate' tag with no oracle text", () => {
      const card = instance({ keywords: ["mutate"], oracle_text: "" });
      expect(hasMutate(card)).toBe(true);
    });

    it("accepts an uppercase 'MUTATE' tag with no oracle text", () => {
      const card = instance({ keywords: ["MUTATE"], oracle_text: "" });
      expect(hasMutate(card)).toBe(true);
    });

    it("accepts a mixed-case 'Mutate' tag with no oracle text", () => {
      const card = instance({ keywords: ["MutATE"], oracle_text: "" });
      expect(hasMutate(card)).toBe(true);
    });

    it("accepts a tag with surrounding whitespace", () => {
      const card = instance({ keywords: ["  Mutate  "], oracle_text: "" });
      expect(hasMutate(card)).toBe(true);
    });
  });

  describe("true negatives (genuinely has no mutate)", () => {
    it("rejects a plain creature with no keyword and no text", () => {
      const card = instance({ keywords: [], oracle_text: "" });
      expect(hasMutate(card)).toBe(false);
    });

    it("rejects a creature with unrelated keywords", () => {
      const card = instance({
        keywords: ["Flying", "Deathtouch"],
        oracle_text: "Flying. Deathtouch",
      });
      expect(hasMutate(card)).toBe(false);
    });
  });

  describe("KNOWN LIMIT — grant text (deliberate, see #2346)", () => {
    it("still matches a card that GRANTS mutate to others", () => {
      const card = instance({
        keywords: [],
        oracle_text: "Other creatures you control have mutate.",
      });
      // Anchoring cannot fix this: `mutate` here IS a standalone word, it is
      // simply not the keyword of *this* card. Fixing it needs a
      // grant/negation-aware oracle parse, not keyword parsing — the same
      // limitation already recorded for `hexproof from`, `lose shroud` and
      // prowess. Pinned so the behaviour cannot drift silently.
      expect(hasMutate(card)).toBe(true);
    });
  });
});

describe("CR 702.140 mutate — the two hasMutate exports agree", () => {
  /** The core #2346 defect: the two same-named exports used to diverge. */
  const CASES: Array<[string, Partial<ScryfallCard>]> = [
    [
      "real Scryfall shape",
      { keywords: ["Mutate"], oracle_text: "Mutate {2}{U}" },
    ],
    ["lowercase tag, no text", { keywords: ["mutate"], oracle_text: "" }],
    ["uppercase tag, no text", { keywords: ["MUTATE"], oracle_text: "" }],
    ["untagged, cost text", { keywords: [], oracle_text: "Mutate {3}{U}" }],
    ["plain creature", { keywords: [], oracle_text: "" }],
    ["substring 'mutates'", { keywords: [], oracle_text: "It mutates." }],
    [
      "negation",
      { keywords: [], oracle_text: "This creature can't be mutated." },
    ],
  ];

  it.each(CASES)("agrees on: %s", (_label, over) => {
    const card = instance(over);
    expect(hasMutateEngine(card)).toBe(hasMutateEvergreen(card));
  });
});

describe("CR 702.140 mutate — hasMutateStrict", () => {
  it("is true for a canonical 'Mutate' tag", () => {
    expect(hasMutateStrict(instance({ keywords: ["Mutate"] }))).toBe(true);
  });

  it("is case-insensitive and trims", () => {
    expect(hasMutateStrict(instance({ keywords: ["  mUtAtE "] }))).toBe(true);
  });

  it("never consults oracle text", () => {
    // The strict check is the anti-substring guarantee: text alone is never
    // enough, which is what makes it the right basis for the FP pins above.
    expect(
      hasMutateStrict(instance({ keywords: [], oracle_text: "Mutate {2}{U}" })),
    ).toBe(false);
  });

  it("tolerates a missing keywords array", () => {
    const card = instance({ keywords: undefined, oracle_text: "" });
    expect(hasMutateStrict(card)).toBe(false);
  });

  it("rejects a longer keyword token that merely starts with 'mutate'", () => {
    expect(hasMutateStrict(instance({ keywords: ["mutates"] }))).toBe(false);
  });
});
