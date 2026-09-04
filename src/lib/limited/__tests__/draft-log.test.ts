/**
 * Per-pick draft log tests (issue #1558).
 *
 * Covers:
 *  - Round-trip capture via `appendPickRecord` (pickNumber / packNumber
 *    cursoring through the pack-2 → pack-3 transition).
 *  - Idempotency on duplicate `cardId` (the "double-pick" guard).
 *  - Available / skipped partitioning (what the user saw vs what they
 *    passed on).
 *  - CSV serialization shape (header, RFC-4180 escaping, pack column is
 *    1-based in the player-facing export).
 *  - JSON serialization shape (`$schema` version tag, session summary
 *    including optional `seed` for #1559 composition).
 *  - Legacy session loader defensive defaults (`pickLog` defaults to `[]`).
 *  - End-to-end: `pickCard()` from `draft-picker.tsx` produces a
 *    populated `pickLog` after a full 42-pick draft, and the resulting
 *    log round-trips through CSV with the right header + 42 data rows.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";

import {
  appendPickRecord,
  buildDraftLogCsvFilename,
  buildDraftLogJsonExport,
  DRAFT_LOG_CSV_COLUMNS,
  DRAFT_TOTAL_PICKS,
  isCanonicalRarity,
  normalizeDraftPickLog,
  PACKS_PER_DRAFT,
  PICKS_PER_PACK,
  serializeDraftLogCsv,
  withNormalizedPickLog,
} from "../draft-log";
import { pickCard } from "@/components/draft-picker";
import type { DraftCard, DraftPack, DraftSession } from "../types";

// ============================================================================
// Helpers
// ============================================================================

/** Build a 14-card pack from a fixed array of card ids; rarity cycles. */
function makePack(id: string, cardIds: string[]): DraftPack {
  return {
    id,
    cards: cardIds.map(
      (cid, slot): DraftCard => ({
        id: cid,
        name: `Card ${cid}`,
        cmc: slot % 8,
        colors: [],
        color_identity: [],
        set: "M21",
        rarity:
          slot === 0
            ? "mythic"
            : slot === 1
              ? "rare"
              : slot < 5
                ? "uncommon"
                : "common",
        type_line: "Creature — Human",
        legalities: { standard: "legal", modern: "legal" },
        packId: 0,
        packSlot: slot,
        addedAt: "2026-01-01T00:00:00.000Z",
      }),
    ),
    isOpened: true,
    pickedCardIds: [],
  };
}

/** Build a 3-pack (42 cards) DraftSession fixture for #1558 tests. */
function makeFixtureSession(): DraftSession {
  const packIds: string[][] = [
    Array.from({ length: 14 }, (_, i) => `p1-c${i + 1}`),
    Array.from({ length: 14 }, (_, i) => `p2-c${i + 1}`),
    Array.from({ length: 14 }, (_, i) => `p3-c${i + 1}`),
  ];
  return {
    id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    setCode: "M21",
    setName: "Core Set 2021",
    mode: "draft",
    status: "in_progress",
    pool: [],
    deck: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    draftState: "picking",
    currentPackIndex: 0,
    currentPickIndex: 0,
    packs: packIds.map((ids, i) => makePack(`pack-${i + 1}`, ids)),
    timerSeconds: 75,
    lastHoveredCardId: null,
    currentPackHolder: "user",
  };
}

/** Pick every card in the current pack, one after another, returning the
 * post-pick session. Mirrors the production `pickCard` flow. */
function pickEntireDraft(session: DraftSession): DraftSession {
  let s = session;
  // We must NOT mutate the source packs — copy first so the test can be
  // re-run with a fresh fixture without re-creating the session.
  s = JSON.parse(JSON.stringify(s));
  // Drive `pickCard` for the natural left-to-right order the user would
  // experience. (This is the "human simulator" loop.)
  for (let packIdx = 0; packIdx < PACKS_PER_DRAFT; packIdx++) {
    for (let pick = 0; pick < PICKS_PER_PACK; pick++) {
      const packCards = s.packs[s.currentPackIndex].cards;
      // Always pick the first card still in the pack — pickCard refuses
      // double-picks, so a deterministic "first remaining" loop walks the
      // whole pack.
      const target = packCards.find(
        (c) => !s.packs[s.currentPackIndex].pickedCardIds.includes(c.id),
      );
      if (!target) break;
      s = pickCard(s, target.id);
      // After a pack completes, advanceToNextPack resets draftState so the
      // next `pickCard` call can proceed. The picker doesn't require it,
      // because `pickCard` only inspects `currentPackIndex` /
      // `currentPickIndex`, but we mirror the real flow for completeness.
      if (s.draftState === "pack_complete") {
        s = {
          ...s,
          draftState: "picking",
        };
      }
    }
  }
  return s;
}

// ============================================================================
// normalizeDraftPickLog
// ============================================================================

describe("normalizeDraftPickLog (issue #1558)", () => {
  it("returns the same reference for a populated array (idempotent)", () => {
    const arr = [{ pickNumber: 1, cardId: "a", cardName: "A", rarity: "common", pickedAt: "x", packNumber: 0, packPickIndex: 0, availableCardIds: [], alternativesSkipped: [] }];
    expect(normalizeDraftPickLog(arr)).toBe(arr);
  });

  it("returns a fresh empty array for undefined / null", () => {
    expect(normalizeDraftPickLog(undefined)).toEqual([]);
    expect(normalizeDraftPickLog(null)).toEqual([]);
    expect(Array.isArray(normalizeDraftPickLog(undefined))).toBe(true);
  });

  it("withNormalizedPickLog leaves a session with a pickLog untouched", () => {
    const session = makeFixtureSession();
    const withLog = { ...session, pickLog: [] };
    expect(withNormalizedPickLog(withLog)).toBe(withLog);
  });

  it("withNormalizedPickLog backfills pickLog: [] on a legacy session", () => {
    const session = makeFixtureSession(); // no pickLog
    const out = withNormalizedPickLog(session);
    expect(out.pickLog).toEqual([]);
    // Other fields preserved
    expect(out.id).toBe(session.id);
    expect(out.packs).toBe(session.packs);
  });
});

// ============================================================================
// appendPickRecord — round-trip
// ============================================================================

describe("appendPickRecord (issue #1558)", () => {
  let session: DraftSession;

  beforeEach(() => {
    session = makeFixtureSession();
  });

  it("appends a single record on the first pick of pack 1", () => {
    const after = appendPickRecord(session, "p1-c1", {
      id: "p1-c1",
      name: "Card p1-c1",
      rarity: "common",
    });

    expect(after.pickLog).toHaveLength(1);
    const record = after.pickLog![0];
    expect(record.pickNumber).toBe(1);
    expect(record.packNumber).toBe(0);
    expect(record.packPickIndex).toBe(0);
    expect(record.cardId).toBe("p1-c1");
    expect(record.pickedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("is idempotent: re-picking the same cardId is a true no-op", () => {
    const once = appendPickRecord(session, "p1-c1", {
      id: "p1-c1",
      name: "Card p1-c1",
      rarity: "common",
    });
    const twice = appendPickRecord(once, "p1-c1", {
      id: "p1-c1",
      name: "Card p1-c1",
      rarity: "common",
    });
    // Same reference returned — no log mutation
    expect(twice).toBe(once);
    expect(twice.pickLog).toHaveLength(1);
  });

  it("captures availableCardIds minus the picked card and prior picks", () => {
    const after = appendPickRecord(session, "p1-c1", {
      id: "p1-c1",
      name: "Card p1-c1",
      rarity: "common",
    });
    const record = after.pickLog![0];
    // Available at the moment of pick: every card in the pack (none
    // picked yet). alternativesSkipped = available − picked.
    expect(record.availableCardIds).toEqual(
      session.packs[0].cards.map((c) => c.id),
    );
    expect(record.alternativesSkipped).toEqual(
      session.packs[0].cards.map((c) => c.id).filter((id) => id !== "p1-c1"),
    );
  });

  it("numbers picks 1..14 across pack 1 with consecutive appends", () => {
    let s = session;
    for (let i = 1; i <= 14; i++) {
      s = appendPickRecord(s, `p1-c${i}`, {
        id: `p1-c${i}`,
        name: `Card p1-c${i}`,
        rarity: "common",
      });
    }
    expect(s.pickLog).toHaveLength(14);
    expect(s.pickLog!.map((r) => r.pickNumber)).toEqual(
      Array.from({ length: 14 }, (_, i) => i + 1),
    );
    // All still in pack 0
    expect(s.pickLog!.every((r) => r.packNumber === 0)).toBe(true);
  });

  it("crosses the pack-2 / pack-3 transition correctly when cursors roll forward", () => {
    // Simulate the player finishing pack 1 (cursors at pack 1, pick 0)
    let s = session;
    for (let i = 1; i <= 14; i++) {
      s = appendPickRecord(s, `p1-c${i}`, {
        id: `p1-c${i}`,
        name: `Card p1-c${i}`,
        rarity: "common",
      });
    }
    // Operator advances to pack 2 — production code does this; the log
    // helper itself just reads the cursors.
    s = { ...s, currentPackIndex: 1, currentPickIndex: 0 };
    for (let i = 1; i <= 14; i++) {
      s = appendPickRecord(s, `p2-c${i}`, {
        id: `p2-c${i}`,
        name: `Card p2-c${i}`,
        rarity: "common",
      });
    }
    s = { ...s, currentPackIndex: 2, currentPickIndex: 0 };
    for (let i = 1; i <= 14; i++) {
      s = appendPickRecord(s, `p3-c${i}`, {
        id: `p3-c${i}`,
        name: `Card p3-c${i}`,
        rarity: "common",
      });
    }

    expect(s.pickLog).toHaveLength(42);
    expect(s.pickLog![0].pickNumber).toBe(1);
    expect(s.pickLog![13].pickNumber).toBe(14);
    expect(s.pickLog![14].pickNumber).toBe(15);
    expect(s.pickLog![14].packNumber).toBe(1);
    expect(s.pickLog![41].pickNumber).toBe(42);
    expect(s.pickLog![41].packNumber).toBe(2);
  });

  it("falls back to empty availableCardIds if the current pack is undefined (post-complete edge case)", () => {
    const outOfRangeSession = {
      ...session,
      currentPackIndex: 5, // no pack at index 5
    };
    const after = appendPickRecord(outOfRangeSession, "orphan", {
      id: "orphan",
      name: "Orphan",
      rarity: "common",
    });
    expect(after.pickLog).toHaveLength(1);
    expect(after.pickLog![0].availableCardIds).toEqual([]);
    expect(after.pickLog![0].alternativesSkipped).toEqual([]);
  });

  it("defaults rarity to 'unknown' when the card carries no rarity (nullish)", () => {
    const after = appendPickRecord(session, "p1-c1", {
      id: "p1-c1",
      name: "Card p1-c1",
      rarity: undefined as unknown as DraftCard["rarity"],
    });
    expect(after.pickLog![0].rarity).toBe("unknown");
  });

  it("preserves a non-nullish rarity verbatim (including empty string from legacy fixtures)", () => {
    const after = appendPickRecord(session, "p1-c1", {
      id: "p1-c1",
      name: "Card p1-c1",
      rarity: "" as DraftCard["rarity"],
    });
    // The CSV serializer passes through whatever the record holds — only
    // nullish values get a fallback. This matches the comment on the
    // PickRecord.rarity field (free-form string for legacy rows).
    expect(after.pickLog![0].rarity).toBe("");
  });

  it("accepts an injected timestamp (deterministic replay)", () => {
    const t = "2026-07-18T12:34:56.789Z";
    const after = appendPickRecord(
      session,
      "p1-c1",
      { id: "p1-c1", name: "Card p1-c1", rarity: "common" },
      t,
    );
    expect(after.pickLog![0].pickedAt).toBe(t);
  });
});

// ============================================================================
// End-to-end via pickCard()
// ============================================================================

describe("pickCard() integration with the draft log (issue #1558)", () => {
  it("a full 42-pick draft leaves a 42-row log with correct pack distribution", () => {
    const session = makeFixtureSession();
    const final = pickEntireDraft(session);
    expect(final.pickLog).toHaveLength(DRAFT_TOTAL_PICKS);
    const pack0 = final.pickLog!.filter((r) => r.packNumber === 0);
    const pack1 = final.pickLog!.filter((r) => r.packNumber === 1);
    const pack2 = final.pickLog!.filter((r) => r.packNumber === 2);
    expect(pack0).toHaveLength(14);
    expect(pack1).toHaveLength(14);
    expect(pack2).toHaveLength(14);
    // 1-based pick numbers are monotonic
    expect(final.pickLog!.map((r) => r.pickNumber)).toEqual(
      Array.from({ length: 42 }, (_, i) => i + 1),
    );
  });
});

// ============================================================================
// CSV serialization
// ============================================================================

describe("serializeDraftLogCsv (issue #1558)", () => {
  it("produces the fixed header row in the spec'd order", () => {
    const csv = serializeDraftLogCsv({ pickLog: [] });
    const header = csv.split("\n")[0];
    expect(header).toBe(DRAFT_LOG_CSV_COLUMNS.join(","));
    expect(DRAFT_LOG_CSV_COLUMNS).toEqual([
      "pack",
      "pick",
      "cardId",
      "cardName",
      "rarity",
      "pickedAt",
    ]);
  });

  it("emits one data row per record with 1-based pack numbers", () => {
    const session = {
      id: "x",
      pickLog: [
        {
          pickNumber: 1,
          packNumber: 0,
          packPickIndex: 0,
          cardId: "c-1",
          cardName: "Card One",
          rarity: "common",
          pickedAt: "2026-07-18T12:00:00.000Z",
          availableCardIds: ["c-1", "c-2"],
          alternativesSkipped: ["c-2"],
        },
        {
          pickNumber: 15,
          packNumber: 1,
          packPickIndex: 0,
          cardId: "c-3",
          cardName: "Card Three",
          rarity: "rare",
          pickedAt: "2026-07-18T12:05:00.000Z",
          availableCardIds: ["c-3"],
          alternativesSkipped: [],
        },
      ],
    };
    const csv = serializeDraftLogCsv(session);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[1]).toBe("1,1,c-1,Card One,common,2026-07-18T12:00:00.000Z");
    expect(lines[2]).toBe("2,15,c-3,Card Three,rare,2026-07-18T12:05:00.000Z");
  });

  it("escapes RFC-4180 special characters (comma, quote, newline)", () => {
    const csv = serializeDraftLogCsv({
      pickLog: [
        {
          pickNumber: 1,
          packNumber: 0,
          packPickIndex: 0,
          cardId: 'id-"x"',
          cardName: "Comma, Name",
          rarity: "common",
          pickedAt: "2026-07-18T12:00:00.000Z",
          availableCardIds: [],
          alternativesSkipped: [],
        },
      ],
    });
    const dataRow = csv.trim().split("\n")[1];
    // cardName: quoted because of the comma
    expect(dataRow).toContain('"Comma, Name"');
    // cardId: quoted because of the inner double-quotes; the inner quotes doubled
    expect(dataRow).toContain('"id-""x"""');
  });

  it("produces header-only output for a legacy session with no pickLog", () => {
    const csv = serializeDraftLogCsv({ pickLog: undefined });
    expect(csv.trim().split("\n")).toHaveLength(1);
    expect(csv.trim()).toBe(DRAFT_LOG_CSV_COLUMNS.join(","));
  });

  it("round-trips a full 42-pick draft into 42 data rows + header", () => {
    const session = pickEntireDraft(makeFixtureSession());
    const csv = serializeDraftLogCsv(session);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(DRAFT_TOTAL_PICKS + 1);
  });
});

// ============================================================================
// JSON serialization
// ============================================================================

describe("buildDraftLogJsonExport (issue #1558)", () => {
  it("emits the versioned envelope shape with session/pickLog/finalPool", () => {
    const session: DraftSession = {
      ...makeFixtureSession(),
      status: "completed",
      pickLog: [
        {
          pickNumber: 1,
          packNumber: 0,
          packPickIndex: 0,
          cardId: "c-1",
          cardName: "C-1",
          rarity: "common",
          pickedAt: "2026-07-18T12:00:00.000Z",
          availableCardIds: ["c-1"],
          alternativesSkipped: [],
        },
      ],
      pool: [
        {
          // minimal ScryfallCard + packId/packSlot/addedAt fields
          id: "c-1",
          name: "C-1",
          cmc: 2,
          colors: ["W"],
          color_identity: ["W"],
          set: "M21",
          rarity: "common",
          type_line: "Creature — Human",
          legalities: { standard: "legal", modern: "legal" },
          packId: 0,
          packSlot: 0,
          addedAt: "2026-07-18T12:00:00.000Z",
        },
      ],
    };
    const t = "2026-07-18T13:00:00.000Z";
    const out = buildDraftLogJsonExport(session, t);
    expect(out.$schema).toBe("planar-nexus/draft-log/v1");
    expect(out.exportedAt).toBe(t);
    expect(out.session.id).toBe(session.id);
    expect(out.session.setCode).toBe("M21");
    expect(out.session.status).toBe("completed");
    expect(out.pickLog).toHaveLength(1);
    expect(out.finalPool).toHaveLength(1);
    expect(out.finalPool[0].id).toBe("c-1");
    // `seed` is optional — unseeded session omits it
    expect(out.session).not.toHaveProperty("seed");
  });

  it("includes the seed when the session was generated with one (composes with #1559)", () => {
    const session = { ...makeFixtureSession(), seed: 1337 };
    const out = buildDraftLogJsonExport(session);
    expect(out.session.seed).toBe(1337);
  });

  it("normalizes an undefined pickLog to [] in the JSON payload", () => {
    const out = buildDraftLogJsonExport(makeFixtureSession());
    expect(out.pickLog).toEqual([]);
  });
});

// ============================================================================
// Filename helper
// ============================================================================

describe("buildDraftLogCsvFilename (issue #1558)", () => {
  it("produces a deterministic lowercase filename with the first 8 hex of the session id", () => {
    const session = {
      id: "F47AC10B-58CC-4372-A567-0E02B2C3D479",
      setCode: "M21",
    };
    expect(buildDraftLogCsvFilename(session)).toBe(
      "draft-log-m21-f47ac10b.csv",
    );
  });

  it("uses 'set' and 'session' fallbacks for empty fields", () => {
    expect(
      buildDraftLogCsvFilename({ id: "", setCode: "" }),
    ).toBe("draft-log-set-session.csv");
  });
});

// ============================================================================
// Type guards
// ============================================================================

describe("isCanonicalRarity (issue #1558)", () => {
  it("accepts the canonical MTG rarity set", () => {
    expect(isCanonicalRarity("common")).toBe(true);
    expect(isCanonicalRarity("uncommon")).toBe(true);
    expect(isCanonicalRarity("rare")).toBe(true);
    expect(isCanonicalRarity("mythic")).toBe(true);
  });

  it("rejects legacy / fixture rarities", () => {
    expect(isCanonicalRarity("L")).toBe(false);
    expect(isCanonicalRarity("basic")).toBe(false);
    expect(isCanonicalRarity("")).toBe(false);
  });
});