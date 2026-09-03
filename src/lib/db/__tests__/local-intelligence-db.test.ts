/**
 * Tests for the `match_records` Dexie table (issue #1570).
 *
 * Covers the acceptance criteria from issue #1570:
 *   - Round-trip: `db.match_records.put(record)` then `.get(id)` returns
 *     the same payload.
 *   - Key derivation: `getMatchRecordKey(gameId, playerId)` is stable and
 *     distinct for different (gameId, playerId) pairs.
 *   - Idempotency: `put()` is upsert-on-key, so a duplicate `put` with
 *     the same `id` does NOT create a second row.
 *   - Schema migration: opening the singleton `db` at the current version
 *     (v3) exposes `match_records` and lets us round-trip a record.
 *
 * Test isolation: `fake-indexeddb/auto` is wired in `jest.setup.js`. Each
 * test uses a unique `gameId` / `playerId` so neither the unique IDB
 * (singleton) nor the shared `db` instance causes cross-test bleed.
 */

import "fake-indexeddb/auto";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import {
  db,
  getMatchRecordKey,
  type MatchRecord,
} from "../local-intelligence-db";

describe("getMatchRecordKey (issue #1570)", () => {
  it("combines gameId and playerId with a stable separator", () => {
    expect(getMatchRecordKey("GAME42", "peer-x")).toBe("GAME42@peer-x");
  });

  it("treats identical inputs as identical keys (idempotent re-put)", () => {
    const a = getMatchRecordKey("GAME", "peer");
    const b = getMatchRecordKey("GAME", "peer");
    expect(a).toBe(b);
  });

  it("treats different playerIds as distinct keys for the same gameId", () => {
    expect(getMatchRecordKey("GAME", "peer-a")).not.toBe(
      getMatchRecordKey("GAME", "peer-b"),
    );
  });

  it("treats different gameIds as distinct keys for the same playerId", () => {
    expect(getMatchRecordKey("GAME-1", "peer")).not.toBe(
      getMatchRecordKey("GAME-2", "peer"),
    );
  });
});

describe("LocalIntelligenceDB.match_records (issue #1570)", () => {
  beforeEach(async () => {
    // Start every test from an empty match_records table so the round-trip
    // and count assertions are not affected by sibling tests.
    await db.match_records.clear();
  });

  afterEach(async () => {
    await db.match_records.clear();
  });

  const baseRecord = (overrides: Partial<MatchRecord> = {}): MatchRecord => ({
    id: getMatchRecordKey("game-A", "peer-1"),
    gameId: "game-A",
    playerId: "peer-1",
    playerName: "Alice",
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_600_000,
    durationMs: 600_000,
    format: "commander",
    endReason: "concede",
    position: 1,
    isWinner: true,
    finalLife: 20,
    standings: [
      { playerId: "peer-1", playerName: "Alice", position: 1, life: 20 },
      { playerId: "peer-2", playerName: "Bob", position: 2, life: 0 },
    ],
    ...overrides,
  });

  it("round-trips a MatchRecord: put → get returns the same payload", async () => {
    const record = baseRecord();
    await db.match_records.put(record);
    const got = await db.match_records.get(record.id);
    expect(got).toEqual(record);
  });

  it("persists all fields verbatim (deep equality)", async () => {
    const record = baseRecord();
    await db.match_records.put(record);
    const got = await db.match_records.get(record.id);
    expect(got).toBeDefined();
    expect(got?.gameId).toBe(record.gameId);
    expect(got?.playerId).toBe(record.playerId);
    expect(got?.playerName).toBe(record.playerName);
    expect(got?.startedAt).toBe(record.startedAt);
    expect(got?.endedAt).toBe(record.endedAt);
    expect(got?.durationMs).toBe(record.durationMs);
    expect(got?.format).toBe(record.format);
    expect(got?.endReason).toBe(record.endReason);
    expect(got?.position).toBe(record.position);
    expect(got?.isWinner).toBe(record.isWinner);
    expect(got?.finalLife).toBe(record.finalLife);
    expect(got?.standings).toEqual(record.standings);
  });

  it("put() is upsert-on-key: a duplicate put does not create a second row", async () => {
    // Acceptance criterion: a duplicate `game-ended` delivery — even one
    // that slipped past the transport-level anti-replay (#1091) gate —
    // results in EXACTLY ONE MatchRecord row per (gameId, playerId).
    // The Dexie keyPath on `id` is the second line of defence.
    const record = baseRecord();
    await db.match_records.put(record);
    await db.match_records.put({ ...record, position: 1 });
    await db.match_records.put({ ...record, position: 1 });
    const count = await db.match_records.count();
    expect(count).toBe(1);
    // The latest payload wins (upsert semantics).
    const got = await db.match_records.get(record.id);
    expect(got?.position).toBe(1);
  });

  it("two different players in the same game get separate rows", async () => {
    // Multi-player match: every peer persists their own perspective keyed
    // by `${gameId}@${playerId}` — a single game yields N rows (one per
    // peer) rather than one shared row.
    await db.match_records.put(
      baseRecord({ playerId: "peer-1", position: 1, isWinner: true }),
    );
    await db.match_records.put(
      baseRecord({
        id: getMatchRecordKey("game-A", "peer-2"),
        playerId: "peer-2",
        playerName: "Bob",
        position: 2,
        isWinner: false,
        finalLife: 0,
      }),
    );
    const all = await db.match_records.toArray();
    expect(all).toHaveLength(2);
    const ids = all.map((r) => r.id).sort();
    expect(ids).toEqual([
      getMatchRecordKey("game-A", "peer-1"),
      getMatchRecordKey("game-A", "peer-2"),
    ]);
  });

  it("different games for the same player are independent rows", async () => {
    await db.match_records.put(
      baseRecord({
        id: getMatchRecordKey("game-A", "peer-1"),
        gameId: "game-A",
        endReason: "concede",
      }),
    );
    await db.match_records.put(
      baseRecord({
        id: getMatchRecordKey("game-B", "peer-1"),
        gameId: "game-B",
        endReason: "life-zero",
      }),
    );
    const all = await db.match_records.toArray();
    expect(all).toHaveLength(2);
    const reasons = all.map((r) => r.endReason).sort();
    expect(reasons).toEqual(["concede", "life-zero"]);
  });

  it("query by playerId returns only that player's rows", async () => {
    await db.match_records.put(
      baseRecord({
        id: getMatchRecordKey("game-A", "peer-1"),
        playerId: "peer-1",
      }),
    );
    await db.match_records.put(
      baseRecord({
        id: getMatchRecordKey("game-B", "peer-1"),
        playerId: "peer-1",
        gameId: "game-B",
      }),
    );
    await db.match_records.put(
      baseRecord({
        id: getMatchRecordKey("game-A", "peer-2"),
        playerId: "peer-2",
        playerName: "Bob",
      }),
    );
    const peer1Rows = await db.match_records
      .where("playerId")
      .equals("peer-1")
      .toArray();
    expect(peer1Rows).toHaveLength(2);
    expect(peer1Rows.every((r) => r.playerId === "peer-1")).toBe(true);
  });

  it("supports a draw (isWinner false, multiple players at position 1)", async () => {
    // The local `MatchRecord` is the LOCAL player's perspective only — it
    // does NOT carry `winnerId` (only the wire payload does). A draw is
    // signalled at the row level by `isWinner: false` together with
    // multiple players at `position: 1` in `standings`.
    const drawRecord: MatchRecord = baseRecord({
      isWinner: false,
      finalLife: null,
      endReason: "draw",
      standings: [
        { playerId: "peer-1", playerName: "Alice", position: 1, life: null },
        { playerId: "peer-2", playerName: "Bob", position: 1, life: null },
      ],
    });
    await db.match_records.put(drawRecord);
    const got = await db.match_records.get(drawRecord.id);
    expect(got?.isWinner).toBe(false);
    expect(got?.standings).toHaveLength(2);
    expect(got?.standings.every((s) => s.position === 1)).toBe(true);
  });
});

describe("LocalIntelligenceDB.match_records — schema migration (issue #1570)", () => {
  it("exposes the match_records store at version 3", () => {
    // The current schema is v3 (added by issue #1570); the prior v1 and
    // v2 migrations must stay intact (see local-intelligence-db.ts).
    expect(db.verno).toBeGreaterThanOrEqual(3);
    expect(db.match_records).toBeDefined();
  });

  it("v1 and v2 stores are still present (no accidental migration loss)", async () => {
    // Drift guard: removing the `version(1)` / `version(2)` declarations
    // would silently drop these tables on a fresh install. Verify they
    // still resolve on the singleton.
    expect(db.embeddings).toBeDefined();
    expect(db.orama_snapshots).toBeDefined();
    expect(db.game_history).toBeDefined();
    expect(db.player_decisions).toBeDefined();
    expect(db.game_embeddings).toBeDefined();
    expect(db.match_records).toBeDefined();
  });
});
