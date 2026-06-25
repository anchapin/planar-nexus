import { CardSearchIndex } from "../card-search-index";
import { db } from "../../db/local-intelligence-db";
import type { MinimalCard } from "../../card-database";

// Mock Orama so the cache behaviour can be observed in isolation.
const searchMock = jest.fn();
jest.mock("@orama/orama", () => ({
  create: jest.fn().mockResolvedValue({}),
  insertMultiple: jest.fn().mockResolvedValue({}),
  remove: jest.fn().mockResolvedValue(undefined),
  search: (...args: unknown[]) => searchMock(...args),
}));

// Persistence is not exercised here; stub it out.
jest.mock("@orama/plugin-data-persistence", () => ({
  persist: jest.fn().mockResolvedValue({}),
  restore: jest.fn().mockResolvedValue({}),
}));

const makeCard = (id: string, name: string): MinimalCard => ({
  id,
  name,
  cmc: 1,
  type_line: "Creature",
  colors: [],
  color_identity: [],
  legalities: {},
});

const hitsFor = (docs: Array<{ id: string; name: string }>) => ({
  count: docs.length,
  hits: docs.map((document) => ({ document })),
});

describe("CardSearchIndex result cache", () => {
  let index: CardSearchIndex;

  beforeEach(async () => {
    await db.orama_snapshots.clear();
    searchMock.mockReset();
    index = new CardSearchIndex();
  });

  it("serves a repeated query from cache without re-running the Orama search", async () => {
    searchMock.mockResolvedValueOnce(hitsFor([{ id: "1", name: "Lightning Bolt" }]));

    const first = await index.search("lightning");
    const second = await index.search("lightning");

    expect(first).toEqual([{ id: "1", name: "Lightning Bolt" }]);
    expect(second).toEqual(first);
    // The underlying Orama search should run exactly once for two identical calls.
    expect(searchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes the query term so equivalent inputs share a cache entry", async () => {
    searchMock.mockResolvedValueOnce(hitsFor([{ id: "1", name: "Lightning Bolt" }]));

    await index.search("  Lightning  ");
    await index.search("lightning");

    expect(searchMock).toHaveBeenCalledTimes(1);
  });

  it("treats different options (limit/offset/where) as distinct queries", async () => {
    searchMock
      .mockResolvedValueOnce(hitsFor([{ id: "1", name: "Lightning Bolt" }]))
      .mockResolvedValueOnce(hitsFor([{ id: "2", name: "Lightning Strike" }]));

    await index.search("lightning", { limit: 5 });
    await index.search("lightning", { limit: 10 });

    expect(searchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates the cache after indexCards inserts documents", async () => {
    searchMock
      .mockResolvedValueOnce(hitsFor([{ id: "1", name: "Lightning Bolt" }]))
      .mockResolvedValueOnce(hitsFor([{ id: "1", name: "Lightning Bolt" }]));

    await index.search("lightning");
    await index.search("lightning"); // served from cache
    expect(searchMock).toHaveBeenCalledTimes(1);

    await index.indexCards([makeCard("1", "Lightning Bolt")]);

    await index.search("lightning"); // cache cleared -> re-run
    expect(searchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates the cache after clear()", async () => {
    searchMock
      .mockResolvedValueOnce(hitsFor([{ id: "1", name: "Lightning Bolt" }]))
      .mockResolvedValueOnce(hitsFor([{ id: "1", name: "Lightning Bolt" }]));

    await index.search("lightning");
    await index.clear();
    await index.search("lightning");

    expect(searchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates the cache after removeCard()", async () => {
    searchMock
      .mockResolvedValueOnce(hitsFor([{ id: "1", name: "Lightning Bolt" }]))
      .mockResolvedValueOnce(hitsFor([{ id: "1", name: "Lightning Bolt" }]));

    // Prime the Orama instance so removeCard does not early-return.
    await index.indexCards([makeCard("1", "Lightning Bolt")]);
    searchMock.mockClear();

    await index.search("lightning");
    await index.removeCard("1");
    await index.search("lightning");

    expect(searchMock).toHaveBeenCalledTimes(2);
  });
});
