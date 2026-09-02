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
  getSetDetails,
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

// The four-set Scryfall payload doubles as a sort fixture. Payload order is
// oldest-first (znr → bro), i.e. the reverse of the default date sort.
const fourSets: ScryfallSet[] = mockScryfallSets.data;

describe("SET-01: Sets sorted by date/name", () => {
  describe("sortSets", () => {
    it("should sort sets by release date (newest first)", () => {
      const shuffled = [fourSets[2], fourSets[0], fourSets[3], fourSets[1]];

      expect(sortSets(shuffled, "release_date").map((s) => s.code)).toEqual([
        "bro",
        "vow",
        "mid",
        "znr",
      ]);
    });

    it("should sort sets by release date oldest-first when ascending", () => {
      expect(
        sortSets(fourSets, "release_date", true).map((s) => s.code),
      ).toEqual(["znr", "mid", "vow", "bro"]);
    });

    it("should sort sets by name A-Z when ascending", () => {
      // Alphabetical: "Innistrad: Crimson Vow" < "Innistrad: Midnight Hunt"
      //   < "The Brothers' War" < "Zendikar Rising"
      expect(sortSets(fourSets, "name", true).map((s) => s.code)).toEqual([
        "vow",
        "mid",
        "bro",
        "znr",
      ]);
    });

    it("should sort sets by name Z-A by default (ascending=false)", () => {
      // NB: the single `ascending = false` default applies to every option,
      // including name — despite the JSDoc claiming "default: true for name".
      expect(sortSets(fourSets, "name").map((s) => s.code)).toEqual([
        "znr",
        "bro",
        "mid",
        "vow",
      ]);
    });

    it("should sort sets by card count (most cards first by default)", () => {
      const withZero = [
        ...fourSets,
        makeSet("tset", "token", { card_count: 0 }),
      ];

      expect(sortSets(withZero, "card_count").map((s) => s.code)).toEqual([
        "bro",
        "mid",
        "vow",
        "znr",
        "tset",
      ]);
    });

    it("should not mutate the input array", () => {
      const input = [...fourSets];

      sortSets(input, "release_date");

      expect(input.map((s) => s.code)).toEqual(["znr", "mid", "vow", "bro"]);
    });

    it("should handle empty set array", () => {
      expect(sortSets([], "release_date")).toEqual([]);
    });
  });

  describe("fetchAllSets", () => {
    const originalFetch = global.fetch;

    const mockFetchOk = (payload: unknown) => {
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

    it("should fetch all sets from the Scryfall sets endpoint", async () => {
      mockFetchOk(mockScryfallSets);

      const sets = await fetchAllSets();

      expect(sets).toHaveLength(4);
      expect(sets[0].code).toBe("znr");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.scryfall.com/sets",
      );
    });

    it("should cache sets for 24 hours (second call does not re-fetch)", async () => {
      mockFetchOk(mockScryfallSets);

      await fetchAllSets();
      const second = await fetchAllSets();

      expect(global.fetch).toHaveBeenCalledTimes(1);
      // Cache hit returns the same array reference, not a copy.
      expect(second).toHaveLength(4);
    });

    it("should re-fetch once the 24h cache window expires", async () => {
      const nowSpy = jest.spyOn(Date, "now");
      const t0 = Date.now();
      nowSpy.mockReturnValue(t0);
      mockFetchOk(mockScryfallSets);
      await fetchAllSets();

      // Jump 25 hours ahead: the cache is now stale and must be refreshed.
      nowSpy.mockReturnValue(t0 + 25 * 60 * 60 * 1000);
      await fetchAllSets();

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("should return cached data on network error without throwing", async () => {
      mockFetchOk(mockScryfallSets);
      const first = await fetchAllSets();

      global.fetch = jest
        .fn<() => Promise<Response>>()
        .mockRejectedValue(new Error("Network unreachable"));

      const second = await fetchAllSets();

      expect(second).toBe(first);
    });

    it("should throw a descriptive error when fetch fails and cache is empty", async () => {
      global.fetch = jest
        .fn<() => Promise<Response>>()
        .mockRejectedValue(new Error("Offline"));

      await expect(fetchAllSets()).rejects.toThrow(
        "Failed to fetch sets: Offline",
      );
    });
  });
});

describe("SET-02: Set selection flow", () => {
  describe("getSetDetails", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      clearSetCache();
      global.fetch = jest.fn<() => Promise<Response>>().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockScryfallSets),
      } as unknown as Response);
    });

    afterEach(() => {
      global.fetch = originalFetch;
      jest.restoreAllMocks();
      clearSetCache();
    });

    it("should return set details by code", async () => {
      const set = await getSetDetails("znr");

      expect(set).not.toBeNull();
      expect(set!.code).toBe("znr");
      expect(set!.name).toBe("Zendikar Rising");
    });

    it("should normalize case and surrounding whitespace in the code", async () => {
      const set = await getSetDetails("  ZNR ");

      expect(set!.code).toBe("znr");
    });

    it("should hit the cache on the second call (fetch invoked once)", async () => {
      await getSetDetails("znr");
      await getSetDetails("znr");

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("should return null for non-existent set code", async () => {
      expect(await getSetDetails("not-a-real-set")).toBeNull();
    });

    it("should return null for an empty code without fetching", async () => {
      expect(await getSetDetails("")).toBeNull();

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("should include all required set metadata", async () => {
      const set = await getSetDetails("mid");

      expect(set).toEqual({
        id: "set-uuid-2",
        code: "mid",
        name: "Innistrad: Midnight Hunt",
        set_type: "expansion",
        card_count: 291,
        released_at: "2021-09-16",
        icon_svg_uri: "https://cards.scryfall.io/symbol.svg?set=mid&symbol=1",
      });
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
  it("should expose a numeric card_count for every set", () => {
    for (const set of fourSets) {
      expect(typeof set.card_count).toBe("number");
      expect(set.card_count).toBeGreaterThanOrEqual(0);
    }
  });

  it("should carry Scryfall card counts through fetchAllSets unchanged", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn<() => Promise<Response>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockScryfallSets),
    } as unknown as Response);
    try {
      const sets = await fetchAllSets();

      expect(sets.map((s) => s.card_count)).toEqual([274, 291, 277, 351]);
    } finally {
      global.fetch = originalFetch;
      clearSetCache();
    }
  });

  it("should handle sets with zero cards (kept in results, sort last by count)", () => {
    const withZero = [...fourSets, makeSet("tset", "token", { card_count: 0 })];

    const sorted = sortSets(withZero, "card_count");

    expect(sorted).toHaveLength(5);
    expect(sorted[sorted.length - 1].card_count).toBe(0);
  });
});

// Integration tests against a mocked Scryfall endpoint
describe("Integration", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    clearSetCache();
  });

  it("should load and sort sets successfully (newest first)", async () => {
    // Scryfall returns sets oldest-first; prove the UI sort re-orders them.
    const oldestFirst = { data: [...fourSets].reverse() };
    global.fetch = jest.fn<() => Promise<Response>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(oldestFirst),
    } as unknown as Response);

    const sets = await fetchAllSets();

    expect(sortSets(sets, "release_date").map((s) => s.code)).toEqual([
      "bro",
      "vow",
      "mid",
      "znr",
    ]);
  });

  it("should surface a descriptive error on 429 rate limiting (no cache)", async () => {
    clearSetCache();
    global.fetch = jest.fn<() => Promise<Response>>().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    } as unknown as Response);

    await expect(fetchAllSets()).rejects.toThrow(/429/);
    await expect(fetchAllSets()).rejects.toThrow(/Failed to fetch sets/);
  });

  it("should degrade to cached data on 429 once a cache exists", async () => {
    global.fetch = jest.fn<() => Promise<Response>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockScryfallSets),
    } as unknown as Response);
    const cached = await fetchAllSets();

    global.fetch = jest.fn<() => Promise<Response>>().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    } as unknown as Response);
    const degraded = await fetchAllSets();

    expect(degraded).toBe(cached);
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
