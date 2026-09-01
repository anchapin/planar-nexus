/**
 * Issue #1557 — non-draftable set types must be rejected at session creation
 *
 * Acceptance criteria (end-to-end, real set-service + real generators):
 * - createDraftSession() / createSealedSession() invoked with a hardcoded
 *   commander set code (e.g. `c21`) reject with a descriptive Error
 *   mentioning the set is not draftable — rather than producing a
 *   malformed pool.
 * - Draftable set types (expansion, core, masters, draft_innovation,
 *   conspiracy) still create sessions.
 * - Commander Legends (cmr) is set_type `draft_innovation` and therefore
 *   remains draftable — removing `commander` must not lose it.
 *
 * Set metadata comes from a mocked Scryfall /sets payload so these tests
 * are hermetic (no network).
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

// Mock crypto.randomUUID for Node < 19
if (typeof globalThis.crypto?.randomUUID !== "function") {
  let uuidCounter = 0;
  globalThis.crypto = globalThis.crypto || {};
  globalThis.crypto.randomUUID = () =>
    `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`;
}

// Mock the card database module (used by generatePack in sealed-generator)
jest.mock("@/lib/card-database", () => ({
  initializeCardDatabase: jest
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined),
  getAllCards: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  MinimalCard: {},
}));

// Mock draft persistence so createDraftSession does not touch IndexedDB state
jest.mock("../pool-storage", () => ({
  saveDraftSession: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

const makeSet = (
  code: string,
  setType: string,
  name: string,
): Record<string, unknown> => ({
  id: `set-uuid-${code}`,
  code,
  name,
  set_type: setType,
  card_count: 300,
  released_at: "2021-06-18",
});

// Scryfall /sets payload covering every playable type plus the three
// non-draftable types removed by issue #1557.
const SCRYFALL_SETS_PAYLOAD = {
  data: [
    makeSet("m21", "core", "Core Set 2021"),
    makeSet("znr", "expansion", "Zendikar Rising"),
    makeSet("mh2", "masters", "Modern Horizons 2"),
    makeSet("cmr", "draft_innovation", "Commander Legends"),
    makeSet("cn2", "conspiracy", "Conspiracy: Take the Crown"),
    makeSet("c21", "commander", "Commander 2021"),
    makeSet("plc", "planechase", "Planechase"),
    makeSet("drb", "reprint", "Duel Decks: Elspeth vs. Tezzeret"),
  ],
};

import { createDraftSession } from "../draft-generator";
import { createSealedSession } from "../sealed-generator";
import type { DraftSession } from "../draft-generator";
import type { LimitedSession } from "../types";

describe("issue #1557: createDraftSession rejects non-draftable set codes", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn<() => Promise<Response>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(SCRYFALL_SETS_PAYLOAD),
    } as unknown as Response);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it.each([
    ["commander", "c21"],
    ["planechase", "plc"],
    ["reprint", "drb"],
  ])(
    "rejects hardcoded %s set code '%s' with a descriptive error",
    async (_setType, code) => {
      await expect(createDraftSession(code, "Fixed Product")).rejects.toThrow(
        /not draftable/,
      );
    },
  );

  it("error message names the offending set type", async () => {
    await expect(createDraftSession("c21", "Commander 2021")).rejects.toThrow(
      /commander/,
    );
  });

  it("does not produce a pool for a non-draftable set", async () => {
    // The rejection must happen before any pack generation work.
    const { saveDraftSession } = await import("../pool-storage");

    await expect(createDraftSession("c21", "Commander 2021")).rejects.toThrow();
    expect(saveDraftSession).not.toHaveBeenCalled();
  });

  it.each([
    ["m21", "Core Set 2021"],
    ["cmr", "Commander Legends"],
  ])("still creates a draft session for draftable '%s'", async (code) => {
    const session: DraftSession = await createDraftSession(code, code);

    expect(session.mode).toBe("draft");
    expect(session.packs).toHaveLength(3);
    expect(session.packs.every((p) => p.cards.length === 14)).toBe(true);
  });
});

describe("issue #1557: createSealedSession rejects non-draftable set codes", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn<() => Promise<Response>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(SCRYFALL_SETS_PAYLOAD),
    } as unknown as Response);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it.each([
    ["commander", "c21"],
    ["planechase", "plc"],
    ["reprint", "drb"],
  ])(
    "rejects hardcoded %s set code '%s' with a descriptive error",
    async (_setType, code) => {
      await expect(createSealedSession(code, "Fixed Product")).rejects.toThrow(
        /not draftable/,
      );
    },
  );

  it("still creates a sealed session for draftable 'm21'", async () => {
    const session: LimitedSession = await createSealedSession(
      "m21",
      "Core Set 2021",
    );

    expect(session.mode).toBe("sealed");
    expect(session.pool.length).toBeGreaterThan(0);
  });
});
