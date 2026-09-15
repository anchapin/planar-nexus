/**
 * Tests for the server-side card search tool (ported from a vitest-only
 * suite that Jest never executed — issue #1784). The original file targeted
 * an API that does not exist (`searchCardsTool.execute`, a three-argument
 * `searchCards`); these tests exercise the real surface: the tool metadata
 * and `executeCardSearch`.
 */
import { executeCardSearch, searchCardsTool } from "../card-search";
import { searchCards } from "@/lib/server-card-operations";

jest.mock("ai", () => ({
  tool: (config: unknown) => config,
  zodSchema: (schema: unknown) => schema,
}));

jest.mock("@/lib/server-card-operations", () => ({
  searchCards: jest.fn(),
}));

const mockSearchCards = searchCards as jest.MockedFunction<typeof searchCards>;

describe("searchCardsTool", () => {
  it("should be defined with an LLM-facing description", () => {
    expect(searchCardsTool).toBeDefined();
    expect(String(searchCardsTool.description)).toContain(
      "Search for Magic: The Gathering cards",
    );
  });
});

describe("executeCardSearch", () => {
  it("should call searchCards with query, format, and limit", async () => {
    const card = {
      id: "1",
      name: "Black Lotus",
      type_line: "Artifact",
      mana_cost: "{0}",
      oracle_text:
        "{T}, Sacrifice Black Lotus: Add three mana of any one color.",
      colors: [],
      rarity: "rare",
      legalities: { commander: "banned", vintage: "restricted" },
    };
    mockSearchCards.mockResolvedValue([card] as any);

    const result = (await executeCardSearch(
      "Black Lotus",
      "vintage",
      1,
    )) as any;

    expect(searchCards).toHaveBeenCalledWith("Black Lotus", {
      format: "vintage",
      maxCards: 1,
    });
    expect(result.message).toContain('Found 1 cards matching "Black Lotus"');
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].name).toBe("Black Lotus");
    expect(result.cards[0].legalities).toEqual({
      commander: "banned",
      vintage: "restricted",
    });
  });

  it("should return an empty card list when nothing matches", async () => {
    mockSearchCards.mockResolvedValue([]);

    const result = (await executeCardSearch("missing")) as any;

    expect(searchCards).toHaveBeenCalledWith("missing", {
      format: undefined,
      maxCards: undefined,
    });
    expect(result.message).toContain('No cards found for query: "missing"');
    expect(result.cards).toEqual([]);
  });

  it("should handle errors gracefully", async () => {
    mockSearchCards.mockRejectedValue(new Error("DB Error"));

    const result = (await executeCardSearch("error")) as any;

    expect(result.error).toBe("Failed to search cards: DB Error");
    expect(result.cards).toEqual([]);
  });
});
