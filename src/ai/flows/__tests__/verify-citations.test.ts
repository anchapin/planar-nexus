/**
 * Tests for the local citation verification gate (issue #1072).
 *
 * The core {@link verifyCitations} function is pure given an injectable
 * {@link CardLookupFn}, so these tests stub the lookup directly — no IndexedDB
 * and no module mocks are required for the verification logic. The
 * free-text extraction / annotation helpers and the default local resolver
 * (which DOES touch `@/lib/card-database`) are covered separately.
 */

jest.mock("@/lib/card-database", () => ({
  getCardByName: jest.fn(),
  getDatabaseStatus: jest.fn(),
}));

import {
  verifyCitations,
  summarizeVerifications,
  extractCitedCards,
  annotateAdviceWithVerification,
  createLocalCardLookup,
  type CardLookupFn,
  type CitedCard,
  type CitationLookupResult,
} from "../verify-citations";
import { getCardByName, getDatabaseStatus } from "@/lib/card-database";
import type { MinimalCard } from "@/lib/card-database";

const mockedGetCardByName = getCardByName as jest.MockedFunction<
  typeof getCardByName
>;
const mockedGetDatabaseStatus = getDatabaseStatus as jest.MockedFunction<
  typeof getDatabaseStatus
>;

/** Build a stub lookup that resolves a fixed map of name → card. */
function stubLookup(
  cards: Record<string, MinimalCard>,
  dbHasCards = true,
): CardLookupFn {
  return async (name: string): Promise<CitationLookupResult> => {
    const match = Object.entries(cards).find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    )?.[1];
    return { found: Boolean(match), card: match, dbHasCards };
  };
}

function makeCard(overrides: Partial<MinimalCard> = {}): MinimalCard {
  return {
    id: "id-1",
    name: "Lightning Bolt",
    cmc: 1,
    type_line: "Instant",
    colors: ["R"],
    color_identity: ["R"],
    legalities: { modern: "legal" },
    mana_cost: "{R}",
    oracle_text: "Lightning Bolt deals 3 damage to any target.",
    ...overrides,
  };
}

describe("verifyCitations — core resolution", () => {
  it("verifies a name-only citation when the card exists in the DB", async () => {
    const lookup = stubLookup({ "Lightning Bolt": makeCard() });
    const results = await verifyCitations([{ name: "Lightning Bolt" }], lookup);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("verified");
    expect(results[0].corrections).toEqual([]);
    expect(results[0].resolved?.name).toBe("Lightning Bolt");
  });

  it("verifies a citation whose claimed attributes all match the DB", async () => {
    const lookup = stubLookup({ "Lightning Bolt": makeCard() });
    const results = await verifyCitations(
      [
        {
          name: "Lightning Bolt",
          manaCost: "{R}",
          type: "Instant",
          cmc: 1,
          oracleText: "Lightning Bolt deals 3 damage to any target.",
        },
      ],
      lookup,
    );
    expect(results[0].status).toBe("verified");
    expect(results[0].corrections).toEqual([]);
  });

  it("flags a card NOT in a populated DB as not-found (hallucination)", async () => {
    const lookup = stubLookup({ "Lightning Bolt": makeCard() });
    const results = await verifyCitations(
      [{ name: "Totally Fake Card" }],
      lookup,
    );
    expect(results[0].status).toBe("not-found");
    expect(results[0].resolved).toBeUndefined();
    expect(results[0].note).toContain("likely fabricated");
  });

  it("reports unverifiable (not not-found) when the local DB is empty", async () => {
    // Empty DB: even a real card name cannot be confirmed or refuted.
    const lookup = stubLookup({}, false);
    const results = await verifyCitations(
      [{ name: "Lightning Bolt" }],
      lookup,
    );
    expect(results[0].status).toBe("unverifiable");
    expect(results[0].resolved).toBeUndefined();
    expect(results[0].note).toContain("empty");
  });

  it("corrects a mismatched mana cost to the authoritative DB value", async () => {
    const lookup = stubLookup({ "Lightning Bolt": makeCard() });
    const results = await verifyCitations(
      [{ name: "Lightning Bolt", manaCost: "{1}{R}", cmc: 1 }],
      lookup,
    );
    expect(results[0].status).toBe("mismatch");
    const manaFix = results[0].corrections.find((c) => c.field === "manaCost");
    expect(manaFix).toBeDefined();
    expect(manaFix?.claimed).toBe("{1}{R}");
    expect(manaFix?.actual).toBe("{R}");
  });

  it("corrects mismatched type and oracle text", async () => {
    const lookup = stubLookup({ "Lightning Bolt": makeCard() });
    const results = await verifyCitations(
      [
        {
          name: "Lightning Bolt",
          type: "Sorcery",
          oracleText: "Deal 3 damage.",
        },
      ],
      lookup,
    );
    expect(results[0].status).toBe("mismatch");
    const fields = results[0].corrections.map((c) => c.field).sort();
    expect(fields).toEqual(["oracleText", "type"]);
    const typeFix = results[0].corrections.find((c) => c.field === "type");
    expect(typeFix?.actual).toBe("Instant");
  });

  it("compares mana costs space/case-insensitively ({R} == {r})", async () => {
    const lookup = stubLookup({ "Lightning Bolt": makeCard({ mana_cost: "{R}" }) });
    const results = await verifyCitations(
      [{ name: "Lightning Bolt", manaCost: "{r}" }],
      lookup,
    );
    expect(results[0].status).toBe("verified");
  });

  it("flags a mismatched CMC", async () => {
    const lookup = stubLookup({ "Lightning Bolt": makeCard({ cmc: 1 }) });
    const results = await verifyCitations(
      [{ name: "Lightning Bolt", cmc: 3 }],
      lookup,
    );
    expect(results[0].status).toBe("mismatch");
    const cmcFix = results[0].corrections.find((c) => c.field === "cmc");
    expect(cmcFix?.claimed).toBe(3);
    expect(cmcFix?.actual).toBe(1);
  });
});

describe("verifyCitations — batch behaviour", () => {
  it("handles a mixed batch of verified, mismatched, and hallucinated cards", async () => {
    const lookup = stubLookup({
      "Lightning Bolt": makeCard(),
      "Counterspell": makeCard({
        id: "id-2",
        name: "Counterspell",
        mana_cost: "{U}{U}",
        cmc: 2,
        type_line: "Instant",
        oracle_text: "Counter target spell.",
      }),
    });
    const results = await verifyCitations(
      [
        { name: "Lightning Bolt" }, // verified
        { name: "Counterspell", manaCost: "{1}{U}" }, // mismatch
        { name: "Fake Dragon" }, // not-found
      ],
      lookup,
    );
    expect(results.map((r) => r.status)).toEqual([
      "verified",
      "mismatch",
      "not-found",
    ]);
  });

  it("returns an empty array for an empty citation list", async () => {
    const lookup = stubLookup({});
    const results = await verifyCitations([], lookup);
    expect(results).toEqual([]);
  });

  it("treats a non-array input as an empty list (defensive)", async () => {
    const lookup = stubLookup({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = await verifyCitations(null as any, lookup);
    expect(results).toEqual([]);
  });
});

describe("summarizeVerifications", () => {
  it("counts statuses and collects non-verified entries as flagged", () => {
    const verifications = [
      { status: "verified" as const, cited: { name: "A" }, corrections: [], note: "" },
      { status: "verified" as const, cited: { name: "B" }, corrections: [], note: "" },
      { status: "mismatch" as const, cited: { name: "C" }, corrections: [], note: "" },
      { status: "not-found" as const, cited: { name: "D" }, corrections: [], note: "" },
      { status: "unverifiable" as const, cited: { name: "E" }, corrections: [], note: "" },
    ];
    const summary = summarizeVerifications(verifications);
    expect(summary.total).toBe(5);
    expect(summary.verified).toBe(2);
    expect(summary.mismatched).toBe(1);
    expect(summary.notFound).toBe(1);
    expect(summary.unverifiable).toBe(1);
    expect(summary.flagged.map((f) => f.cited.name)).toEqual(["C", "D", "E"]);
  });

  it("returns zeros for an empty list", () => {
    const summary = summarizeVerifications([]);
    expect(summary).toEqual({
      total: 0,
      verified: 0,
      mismatched: 0,
      notFound: 0,
      unverifiable: 0,
      flagged: [],
    });
  });
});

describe("extractCitedCards", () => {
  it("extracts wiki-link, quoted, backtick, and bold citations", () => {
    const text =
      "Add [[Lightning Bolt]] for reach. \"Counterspell\" is great. " +
      "Try `Delver of Secrets` and **Brainstorm** too.";
    const cards = extractCitedCards(text);
    const names = cards.map((c) => c.name);
    expect(names).toEqual([
      "Lightning Bolt",
      "Counterspell",
      "Delver of Secrets",
      "Brainstorm",
    ]);
  });

  it("de-duplicates case-insensitively, preserving first casing", () => {
    const text = 'Use "Lightning Bolt" and then [[lightning bolt]] again.';
    const cards = extractCitedCards(text);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("Lightning Bolt");
  });

  it("filters out noise (single chars, pure digits, empty)", () => {
    const text = 'Set "4" and `x` and **  ** and "".';
    expect(extractCitedCards(text)).toEqual([]);
  });

  it("returns an empty list for empty / non-string input", () => {
    expect(extractCitedCards("")).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(extractCitedCards(undefined as any)).toEqual([]);
  });
});

describe("annotateAdviceWithVerification", () => {
  it("tags a hallucinated card inline and appends a confidence footer", () => {
    const text = "I recommend adding Totally Fake Card to your deck.";
    const verifications = [
      { cited: { name: "Totally Fake Card" }, status: "not-found" as const, corrections: [], note: "" },
    ];
    const out = annotateAdviceWithVerification(text, verifications);
    expect(out.totalCount).toBe(1);
    expect(out.verifiedCount).toBe(0);
    expect(out.text).toContain("Totally Fake Card ⚠ [unverified]");
    expect(out.text).toContain("0/1 cited cards verified");
    expect(out.text).toContain(
      "Totally Fake Card: not found in local database",
    );
  });

  it("reports a correction footer for mismatched attributes", () => {
    const text = "Play Lightning Bolt.";
    const verifications = [
      {
        cited: { name: "Lightning Bolt" },
        status: "mismatch" as const,
        corrections: [
          { field: "manaCost" as const, claimed: "{1}{R}", actual: "{R}" },
        ],
        note: "",
      },
    ];
    const out = annotateAdviceWithVerification(text, verifications);
    expect(out.verifiedCount).toBe(0);
    expect(out.text).toContain("0/1 cited cards verified");
    expect(out.text).toContain("Lightning Bolt: corrected");
    expect(out.text).toContain('manaCost: "{1}{R}" → "{R}"');
  });

  it("leaves text unchanged when there are no citations", () => {
    const text = "No cards mentioned here.";
    const out = annotateAdviceWithVerification(text, []);
    expect(out.text).toBe(text);
    expect(out.totalCount).toBe(0);
  });

  it("only tags the first occurrence of a hallucinated name", () => {
    const text = "Fake Card is great. Fake Card again.";
    const verifications = [
      { cited: { name: "Fake Card" }, status: "not-found" as const, corrections: [], note: "" },
    ];
    const out = annotateAdviceWithVerification(text, verifications);
    const occurrences = out.text.split("⚠ [unverified]").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("createLocalCardLookup — default local resolver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves a card through getCardByName and reports dbHasCards", async () => {
    mockedGetDatabaseStatus.mockResolvedValue({ loaded: true, cardCount: 500 });
    mockedGetCardByName.mockResolvedValue(makeCard());
    const lookup = createLocalCardLookup();
    const result = await lookup("Lightning Bolt");
    expect(result.found).toBe(true);
    expect(result.card?.name).toBe("Lightning Bolt");
    expect(result.dbHasCards).toBe(true);
  });

  it("reports dbHasCards=false when the database is empty", async () => {
    mockedGetDatabaseStatus.mockResolvedValue({ loaded: true, cardCount: 0 });
    mockedGetCardByName.mockResolvedValue(undefined);
    const lookup = createLocalCardLookup();
    const result = await lookup("Lightning Bolt");
    expect(result.found).toBe(false);
    expect(result.dbHasCards).toBe(false);
  });

  it("caches the population probe across calls within one resolver", async () => {
    mockedGetDatabaseStatus.mockResolvedValue({ loaded: true, cardCount: 10 });
    mockedGetCardByName.mockResolvedValue(undefined);
    const lookup = createLocalCardLookup();
    await lookup("A");
    await lookup("B");
    await lookup("C");
    expect(mockedGetDatabaseStatus).toHaveBeenCalledTimes(1);
  });

  it("degrades gracefully (no throw) when the card DB access fails", async () => {
    mockedGetDatabaseStatus.mockRejectedValue(new Error("IndexedDB gone"));
    mockedGetCardByName.mockRejectedValue(new Error("IndexedDB gone"));
    const lookup = createLocalCardLookup();
    const result = await lookup("Lightning Bolt");
    expect(result).toEqual({ found: false, dbHasCards: false });
  });
});
