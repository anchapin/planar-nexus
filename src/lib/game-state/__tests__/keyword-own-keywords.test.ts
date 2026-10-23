/**
 * Anchored own-keyword resolution (issue #2641).
 *
 * The engine decided "does this card have keyword X" with four unanchored
 * oracle-text scans:
 *
 *     oracleText.includes(keyword.toLowerCase())   // hasKeyword fallback
 *     oracleText.includes(kw)                      // getAllKeywords scan
 *     oracleText.includes("boast")                 // hasBoast
 *     oracleText.includes("toxic")                 // getToxicLevel
 *
 * A substring scan cannot tell the card's OWN keyword from a MENTION of the
 * word in the rules text, so these cards acquired the keyword:
 *
 *     "Target creature loses flying."                    -> flying
 *     "creatures without flying"                         -> flying
 *     "can't be blocked except by creatures with reach"  -> reach
 *
 * These tests pin the anchored contract:
 *
 *   1. a keyword counts only when the parsed `keywords` array says so, or
 *      when it heads the card's OWN keyword line (start of the oracle text or
 *      start of a line, comma/"and"-separated, optional parameter);
 *   2. a keyword mentioned inside a rules sentence never counts;
 *   3. boast / toxic are read from the same resolver, so a mention of the
 *      word is not a keyword;
 *   4. the parsed keyword array stays authoritative and is read live, so an
 *      effect that strips abilities is still honoured.
 */
import {
  hasKeyword,
  hasFlying,
  hasReach,
  hasBoast,
  getToxicLevel,
  getAllKeywords,
} from "../evergreen-keywords";
import {
  resolveOwnKeywords,
  hasOwnKeyword,
} from "../keyword-actions/own-keywords";
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

// ---------------------------------------------------------------------------
// 1. A mention in the rules text is not a keyword
// ---------------------------------------------------------------------------

describe("anchored own-keyword resolution — mentions are not keywords (#2641)", () => {
  it("does not grant flying from 'Target creature loses flying.'", () => {
    const card = makeInstance({
      oracle_text: "Target creature loses flying.",
    });
    expect(hasFlying(card)).toBe(false);
    expect(hasKeyword(card, "flying")).toBe(false);
    expect(hasOwnKeyword(card, "flying")).toBe(false);
  });

  it("does not grant flying from 'creatures without flying'", () => {
    const card = makeInstance({
      oracle_text: "creatures without flying",
    });
    expect(hasFlying(card)).toBe(false);
    expect(hasKeyword(card, "flying")).toBe(false);
  });

  it("does not grant reach from 'can't be blocked except by creatures with reach'", () => {
    const card = makeInstance({
      oracle_text:
        "This creature can't be blocked except by creatures with reach.",
    });
    expect(hasReach(card)).toBe(false);
    expect(hasKeyword(card, "reach")).toBe(false);
  });

  it("does not grant flying from a grant aimed at other creatures", () => {
    const card = makeInstance({
      oracle_text: "Other creatures you control have flying.",
    });
    expect(hasFlying(card)).toBe(false);
  });

  it("grants flying from a first-person self statement", () => {
    // "This creature has flying." is the card stating its OWN keyword in
    // prose (some printings write the keyword out instead of listing it).
    // The repo's established contract pins this as a grant: see
    // evergreen-keywords.test.ts "should detect keywords in oracle text"
    // and the keyword-haste / keyword-deathtouch suites ("This creature
    // has haste." -> true).
    const card = makeInstance({
      oracle_text: "This creature has flying and deathtouch.",
    });
    expect(hasKeyword(card, "flying")).toBe(true);
    expect(hasKeyword(card, "deathtouch")).toBe(true);
  });

  it("does not grant reach from a sentence that merely starts with the word", () => {
    const card = makeInstance({
      oracle_text: "Reach for the stars, then strike.",
    });
    expect(hasReach(card)).toBe(false);
  });

  it("does not grant flash from 'Flashback'", () => {
    const card = makeInstance({
      oracle_text: "Flashback {3}{R}",
    });
    expect(hasKeyword(card, "flash")).toBe(false);
  });

  it("does not report a mentioned keyword through getAllKeywords", () => {
    const card = makeInstance({
      oracle_text: "Target creature loses flying.",
    });
    expect(getAllKeywords(card).map((k) => k.toLowerCase())).not.toContain(
      "flying",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. The card's own keyword line DOES grant the keyword
// ---------------------------------------------------------------------------

describe("anchored own-keyword resolution — the own keyword line grants (#2641)", () => {
  it("grants flying when the oracle text's keyword line is 'Flying'", () => {
    const card = makeInstance({ oracle_text: "Flying" });
    expect(hasFlying(card)).toBe(true);
    expect(hasOwnKeyword(card, "flying")).toBe(true);
  });

  it("grants flying when the keyword line heads the oracle text", () => {
    const card = makeInstance({
      oracle_text: "Flying\n{G}: This creature gets +1/+1 until end of turn.",
    });
    expect(hasFlying(card)).toBe(true);
  });

  it("grants every keyword of a comma-separated keyword line", () => {
    const card = makeInstance({ oracle_text: "Flying, Haste" });
    expect(hasKeyword(card, "flying")).toBe(true);
    expect(hasKeyword(card, "haste")).toBe(true);
  });

  it("grants every keyword of an 'and'-separated keyword line", () => {
    const card = makeInstance({ oracle_text: "FLYING and HASTE" });
    expect(hasKeyword(card, "flying")).toBe(true);
    expect(hasKeyword(card, "haste")).toBe(true);
  });

  it("grants every keyword of a space-separated keyword line", () => {
    const card = makeInstance({ oracle_text: "First strike Double strike" });
    expect(hasKeyword(card, "first strike")).toBe(true);
    expect(hasKeyword(card, "double strike")).toBe(true);
  });

  it("grants a keyword written on its own line", () => {
    const card = makeInstance({
      oracle_text:
        "When this creature enters the battlefield, draw a card.\nTrample",
    });
    expect(hasKeyword(card, "trample")).toBe(true);
  });

  it("keeps the parsed keywords array authoritative", () => {
    // The parsed array wins even when the rules text only mentions the word.
    const card = makeInstance({
      keywords: ["Flying"],
      oracle_text: "Target creature loses flying.",
    });
    expect(hasFlying(card)).toBe(true);
    expect(hasKeyword(card, "flying")).toBe(true);
  });

  it("resolves the card's own keywords through the shared resolver", () => {
    const card = makeInstance({
      keywords: ["Deathtouch"],
      oracle_text: "Flying, Haste",
    });
    const own = resolveOwnKeywords(card);
    expect(own.has("deathtouch")).toBe(true);
    expect(own.has("flying")).toBe(true);
    expect(own.has("haste")).toBe(true);
    expect(own.has("reach")).toBe(false);
  });

  it("reads the parsed keywords array live, so a stripped keyword is gone", () => {
    // The engine mutates `cardData.keywords` (a layer-6 "strip abilities"
    // effect empties it), so the resolver must not cache that array.
    const card = makeInstance({
      keywords: ["Defender"],
      oracle_text: "",
    });
    expect(hasKeyword(card, "defender")).toBe(true);
    card.cardData.keywords = [];
    expect(hasKeyword(card, "defender")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Boast and toxic come from the same anchored resolver
// ---------------------------------------------------------------------------

describe("anchored own-keyword resolution — boast and toxic (#2641)", () => {
  it("grants boast from the card's own keyword line", () => {
    const card = makeInstance({
      oracle_text:
        "Boast — {2}{R}: This creature gets +3/+0 until end of turn.",
    });
    expect(hasBoast(card)).toBe(true);
  });

  it("grants boast from the parsed keywords array", () => {
    const card = makeInstance({ keywords: ["Boast"], oracle_text: "" });
    expect(hasBoast(card)).toBe(true);
  });

  it("does not grant boast from a mention in the rules text", () => {
    const card = makeInstance({
      oracle_text: "The creature boasts whenever it attacks.",
    });
    expect(hasBoast(card)).toBe(false);
  });

  it("reads the toxic level from the card's own keyword line", () => {
    expect(getToxicLevel(makeInstance({ oracle_text: "Toxic 2" }))).toBe(2);
    expect(getToxicLevel(makeInstance({ oracle_text: "Toxic" }))).toBe(1);
  });

  it("reads the toxic level from the parsed keywords array", () => {
    expect(getToxicLevel(makeInstance({ keywords: ["Toxic 3"] }))).toBe(3);
    expect(getToxicLevel(makeInstance({ keywords: ["Toxic"] }))).toBe(1);
  });

  it("does not grant toxic from a mention in the rules text", () => {
    const card = makeInstance({
      oracle_text: "Creatures with toxic poison the player they damage.",
    });
    expect(getToxicLevel(card)).toBe(0);
  });

  it("does not read a toxic level from a mention with a number", () => {
    const card = makeInstance({
      oracle_text: "Each opponent loses 2 life. Toxic 2 creatures poison.",
    });
    expect(getToxicLevel(card)).toBe(0);
  });
});
