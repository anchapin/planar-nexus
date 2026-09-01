/**
 * Tests for set-service.ts
 *
 * Covers requirements:
 * - SET-01: Browse MTG sets by name, release date, popularity
 * - SET-02: Select a set for Draft or Sealed
 * - SET-03: Show card count and set details before confirming
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import {
  clearSetCache,
  fetchAllSets,
  filterPlayableSets,
  getLimitedPlayableSetTypes,
  getSetTypeDisplayName,
  isDraftableSetType,
  sortSets,
  validateSetIsDraftable,
} from "../set-service";
import type { ScryfallSet } from "../types";

/** Build a minimal ScryfallSet for filtering tests */
const makeSet = (
  code: string,
  setType: string,
  overrides: Partial<ScryfallSet> = {},
): ScryfallSet => ({
  id: `id-${code}`,
  code,
  name: `Set ${code.toUpperCase()}`,
  set_type: setType,
  card_count: 269,
  released_at: "2021-06-18",
  ...overrides,
});

// Mock Scryfall API response structure
const mockScryfallSets = {
  data: [
    {
      id: "set-uuid-1",
      code: "znr",
      name: "Zendikar Rising",
      set_type: "expansion",
      card_count: 274,
      released_at: "2020-09-03",
      icon_svg_uri: "https://cards.scryfall.io/symbol.svg?set=znr&symbol=1",
    },
    {
      id: "set-uuid-2",
      code: "mid",
      name: "Innistrad: Midnight Hunt",
      set_type: "expansion",
      card_count: 291,
      released_at: "2021-09-16",
      icon_svg_uri: "https://cards.scryfall.io/symbol.svg?set=mid&symbol=1",
    },
    {
      id: "set-uuid-3",
      code: "vow",
      name: "Innistrad: Crimson Vow",
      set_type: "expansion",
      card_count: 277,
      released_at: "2021-11-11",
      icon_svg_uri: "https://cards.scryfall.io/symbol.svg?set=vow&symbol=1",
    },
    {
      id: "set-uuid-4",
      code: "bro",
      name: "The Brothers' War",
      set_type: "expansion",
      card_count: 351,
      released_at: "2022-11-18",
      icon_svg_uri: "https://cards.scryfall.io/symbol.svg?set=bro&symbol=1",
    },
  ],
};

// TODO: Import actual module when implemented
// import { fetchAllSets, sortSets, getSetDetails } from '../set-service';

describe("SET-01: Sets sorted by date/name", () => {
  describe("sortSets", () => {
    it("should sort sets by release date (newest first)", async () => {
      // TODO: Implement - sort by release_date descending
      expect(true).toBe(true);
    });

    it("should sort sets by name (A-Z)", async () => {
      // TODO: Implement - sort by name ascending
      expect(true).toBe(true);
    });

    it("should handle empty set array", async () => {
      // TODO: Implement - return empty array without error
      expect(true).toBe(true);
    });
  });

  describe("fetchAllSets", () => {
    it("should fetch all sets from Scryfall API", async () => {
      // TODO: Implement - fetch from https://api.scryfall.com/sets
      expect(true).toBe(true);
    });

    it("should cache sets for 24 hours", async () => {
      // TODO: Implement - cache mechanism
      expect(true).toBe(true);
    });

    it("should return cached data on network error", async () => {
      // TODO: Implement - fallback to cache
      expect(true).toBe(true);
    });
  });
});

describe("SET-02: Set selection flow", () => {
  describe("getSetDetails", () => {
    it("should return set details by code", async () => {
      // TODO: Implement - get single set
      expect(true).toBe(true);
    });

    it("should return null for non-existent set code", async () => {
      // TODO: Implement - handle invalid code
      expect(true).toBe(true);
    });

    it("should include all required set metadata", async () => {
      // TODO: Implement - verify all fields present
      expect(true).toBe(true);
    });
  });

  describe("set selection validation", () => {
    it("should retain sets whose type is playable for limited play", () => {
      // Every set_type listed in the playable constant must survive
      // filterPlayableSets (issue #1557 regression guard).
      const playableTypes = getLimitedPlayableSetTypes();
      const sets = playableTypes.map((type) => makeSet(`set-${type}`, type));

      const filtered = filterPlayableSets(sets);

      expect(filtered.map((s) => s.set_type).sort()).toEqual(
        [...playableTypes].sort(),
      );
    });

    it("should drop sets whose type is not playable for limited play", () => {
      const sets = [
        makeSet("c21", "commander"),
        makeSet("plc", "planechase"),
        makeSet("drb", "reprint"),
        makeSet("tset", "token"),
        makeSet("pbooks", "memorabilia"),
        makeSet("unk", "some_future_type"),
      ];

      expect(filterPlayableSets(sets)).toEqual([]);
    });
  });
});

describe("SET-03: Card count display", () => {
  it("should display card_count for each set", async () => {
    // TODO: Implement - verify card_count field exists
    expect(true).toBe(true);
  });

  it("should show accurate card counts from Scryfall", async () => {
    // TODO: Implement - match Scryfall data
    expect(true).toBe(true);
  });

  it("should handle sets with zero cards", async () => {
    // TODO: Implement - edge case
    expect(true).toBe(true);
  });
});

// Integration tests (TODO: Enable when service is implemented)
describe("Integration", () => {
  it("should load and sort sets successfully", async () => {
    // TODO: Full integration test
    expect(true).toBe(true);
  });

  it("should handle API rate limiting gracefully", async () => {
    // TODO: Test 429 handling
    expect(true).toBe(true);
  });
});

// ============================================================================
// Issue #1557 — non-draftable set types must not reach Limited drafts
// ============================================================================

describe("issue #1557: getLimitedPlayableSetTypes excludes non-draftable set types", () => {
  it("exposes exactly the draftable set types", () => {
    expect([...getLimitedPlayableSetTypes()].sort()).toEqual(
      ["conspiracy", "core", "draft_innovation", "expansion", "masters"].sort(),
    );
  });

  it.each(["commander", "planechase", "reprint"])(
    "no longer advertises %s as playable",
    (removedType) => {
      expect(getLimitedPlayableSetTypes()).not.toContain(removedType);
    },
  );

  it.each(getLimitedPlayableSetTypes())(
    'retains "%s" as a playable set type',
    (playableType) => {
      const set = makeSet(`set-${playableType}`, playableType);

      expect(isDraftableSetType(playableType)).toBe(true);
      expect(filterPlayableSets([set])).toEqual([set]);
    },
  );

  it.each(["commander", "planechase", "reprint", "token", "memorabilia"])(
    'filterPlayableSets excludes sets of type "%s"',
    (removedType) => {
      const set = makeSet("excluded", removedType);

      expect(isDraftableSetType(removedType)).toBe(false);
      expect(filterPlayableSets([set])).toEqual([]);
    },
  );

  it("keeps display names for excluded types (labels, not playability)", () => {
    // getSetTypeDisplayName is a label map — excluded types should still
    // render a human-readable name in UI contexts that display metadata.
    expect(getSetTypeDisplayName("commander")).toBe("Commander Set");
  });
});

describe("issue #1557: validateSetIsDraftable rejects non-draftable set codes", () => {
  const originalFetch = global.fetch;

  const mockSetPayload = {
    data: [
      makeSet("m21", "core", { name: "Core Set 2021" }),
      makeSet("znr", "expansion", { name: "Zendikar Rising" }),
      makeSet("mh2", "masters", { name: "Modern Horizons 2" }),
      makeSet("cmr", "draft_innovation", { name: "Commander Legends" }),
      makeSet("cn2", "conspiracy", { name: "Conspiracy: Take the Crown" }),
      makeSet("c21", "commander", { name: "Commander 2021" }),
      makeSet("plc", "planechase", { name: "Planechase" }),
      makeSet("drb", "reprint", { name: "Duel Decks: Elspeth vs. Tezzeret" }),
    ],
  };

  const mockFetchWith = (payload: unknown) => {
    global.fetch = jest.fn<() => Promise<Response>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    } as unknown as Response);
  };

  beforeEach(() => {
    clearSetCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    clearSetCache();
  });

  it.each([
    ["c21", "commander"],
    ["plc", "planechase"],
    ["drb", "reprint"],
  ])(
    'rejects hardcoded set code "%s" (set_type %s) as not draftable',
    async (code, setType) => {
      mockFetchWith(mockSetPayload);

      await expect(validateSetIsDraftable(code)).rejects.toThrow(
        /not draftable/,
      );
      // Descriptive: message names the offending set type.
      await expect(validateSetIsDraftable(code)).rejects.toThrow(setType);
    },
  );

  it.each([
    ["m21", "core"],
    ["znr", "expansion"],
    ["mh2", "masters"],
    ["cmr", "draft_innovation"],
    ["cn2", "conspiracy"],
  ])('accepts draftable set code "%s" (set_type %s)', async (code) => {
    mockFetchWith(mockSetPayload);

    await expect(validateSetIsDraftable(code)).resolves.toBeUndefined();
  });

  it("is case-insensitive for set codes", async () => {
    mockFetchWith(mockSetPayload);

    await expect(validateSetIsDraftable("C21")).rejects.toThrow(
      /not draftable/,
    );
  });

  it("fails open for unknown set codes (metadata may load later)", async () => {
    mockFetchWith(mockSetPayload);

    await expect(
      validateSetIsDraftable("not-a-real-set"),
    ).resolves.toBeUndefined();
  });

  it("fails open when set metadata cannot be fetched (offline)", async () => {
    global.fetch = jest
      .fn<() => Promise<Response>>()
      .mockRejectedValue(new Error("Network unreachable"));

    await expect(validateSetIsDraftable("c21")).resolves.toBeUndefined();
  });
});
