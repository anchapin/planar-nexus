/**
 * @fileoverview Direct unit tests for the engine-owned dungeon definitions
 * (src/lib/game-state/dungeon-data.ts, CR 309).
 *
 * Issue #1718 — dungeon-data.ts was one of the rules-engine modules with
 * zero direct test references. These tests pin the venture-into-the-dungeon
 * input data (the three dungeon card room graphs) and its accessors:
 * structural invariants (unique rooms, resolvable starts, valid edges, full
 * reachability from the starting room) and lookup behavior (getDungeon,
 * room-by-id / by-index, next-room selection and final-room detection).
 */

import { describe, it, expect } from "@jest/globals";
import {
  DEFAULT_DUNGEON_ID,
  DUNGEONS,
  getDungeon,
  getDungeonRoom,
  getDungeonRoomByIndex,
  getNextDungeonRoom,
  getStartingDungeonRoom,
  isFinalDungeonRoom,
} from "../dungeon-data";
import type { DungeonDefinition } from "../dungeon-data";

// ---------------------------------------------------------------------------
// Structural invariants of the room-graph data
// ---------------------------------------------------------------------------

describe("DUNGEONS structural invariants", () => {
  const dungeonIds = Object.keys(DUNGEONS);

  it("contains the three canonical dungeon cards", () => {
    expect(dungeonIds).toEqual(
      expect.arrayContaining([
        "lost-mine-of-phandelver",
        "tomb-of-annihilation",
        "dungeon-of-the-mad-mage",
      ]),
    );
    expect(dungeonIds.length).toBeGreaterThanOrEqual(3);
  });

  it("keys match each dungeon's own id", () => {
    for (const id of dungeonIds) {
      expect(DUNGEONS[id].id).toBe(id);
    }
  });

  it("DEFAULT_DUNGEON_ID resolves to a real dungeon", () => {
    expect(DUNGEONS[DEFAULT_DUNGEON_ID]).toBeDefined();
  });
});

describe("each dungeon's room graph", () => {
  const dungeons = Object.values(DUNGEONS);

  it.each(dungeons.map((d) => [d.id, d] as const))(
    "%s has rooms with unique ids, non-empty names and effects",
    (_id, dungeon) => {
      expect(dungeon.rooms.length).toBeGreaterThan(0);
      const roomIds = dungeon.rooms.map((r) => r.id);
      expect(new Set(roomIds).size).toBe(roomIds.length);
      for (const room of dungeon.rooms) {
        expect(room.name.length).toBeGreaterThan(0);
        expect(room.effect.length).toBeGreaterThan(0);
      }
    },
  );

  it.each(dungeons.map((d) => [d.id, d] as const))(
    "%s startingRoomId resolves to a room",
    (_id, dungeon) => {
      const start = getStartingDungeonRoom(dungeon);
      expect(start).toBeDefined();
      expect(start!.id).toBe(dungeon.startingRoomId);
    },
  );

  it.each(dungeons.map((d) => [d.id, d] as const))(
    "%s room edges only reference existing rooms",
    (_id, dungeon) => {
      const roomIds = new Set(dungeon.rooms.map((r) => r.id));
      for (const room of dungeon.rooms) {
        for (const next of room.nextRoomIds) {
          expect(roomIds.has(next)).toBe(true);
        }
      }
    },
  );

  it.each(dungeons.map((d) => [d.id, d] as const))(
    "%s has at least one final room and every room is reachable from the start",
    (_id, dungeon) => {
      const roomsById = new Map(dungeon.rooms.map((r) => [r.id, r]));

      // BFS from the starting room.
      const visited = new Set<string>();
      const queue = [dungeon.startingRoomId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        const room = roomsById.get(current)!;
        queue.push(...room.nextRoomIds);
      }

      expect(visited.size).toBe(dungeon.rooms.length);

      const finalRooms = dungeon.rooms.filter(
        (r) => r.nextRoomIds.length === 0,
      );
      expect(finalRooms.length).toBeGreaterThan(0);
    },
  );
});

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

describe("getDungeon", () => {
  it("returns the definition for a known id", () => {
    const dungeon = getDungeon("lost-mine-of-phandelver");
    expect(dungeon).toBeDefined();
    expect(dungeon!.name).toBe("Lost Mine of Phandelver");
  });

  it("returns undefined for an unknown id", () => {
    expect(getDungeon("no-such-dungeon")).toBeUndefined();
  });
});

describe("getDungeonRoom", () => {
  const dungeon: DungeonDefinition = DUNGEONS["lost-mine-of-phandelver"];

  it("finds a room by id", () => {
    const room = getDungeonRoom(dungeon, "goblin-lair");
    expect(room).toBeDefined();
    expect(room!.name).toBe("Goblin Lair");
  });

  it("returns undefined for an unknown room id", () => {
    expect(getDungeonRoom(dungeon, "dragon-lair")).toBeUndefined();
  });
});

describe("getDungeonRoomByIndex", () => {
  const dungeon: DungeonDefinition = DUNGEONS["lost-mine-of-phandelver"];

  it("returns the room at a valid index", () => {
    expect(getDungeonRoomByIndex(dungeon, 0)!.id).toBe("cave-entrance");
  });

  it("returns undefined outside the index range", () => {
    expect(getDungeonRoomByIndex(dungeon, -1)).toBeUndefined();
    expect(
      getDungeonRoomByIndex(dungeon, dungeon.rooms.length),
    ).toBeUndefined();
  });
});

describe("getNextDungeonRoom", () => {
  const dungeon: DungeonDefinition = DUNGEONS["lost-mine-of-phandelver"];

  it("defaults to the first listed next room", () => {
    const next = getNextDungeonRoom(dungeon, "cave-entrance");
    expect(next).toBeDefined();
    expect(next!.id).toBe("goblin-lair");
  });

  it("honors an explicit choice among the legal next rooms", () => {
    const next = getNextDungeonRoom(dungeon, "cave-entrance", "mine-tunnels");
    expect(next).toBeDefined();
    expect(next!.id).toBe("mine-tunnels");
  });

  it("rejects an explicit choice that is not a legal edge", () => {
    expect(
      getNextDungeonRoom(dungeon, "cave-entrance", "temple-of-dumathoin"),
    ).toBeUndefined();
  });

  it("returns undefined from a final room", () => {
    expect(getNextDungeonRoom(dungeon, "temple-of-dumathoin")).toBeUndefined();
  });

  it("returns undefined from an unknown current room", () => {
    expect(getNextDungeonRoom(dungeon, "dragon-lair")).toBeUndefined();
  });
});

describe("isFinalDungeonRoom", () => {
  const dungeon: DungeonDefinition = DUNGEONS["lost-mine-of-phandelver"];

  it("is true exactly for rooms with no outgoing edges", () => {
    expect(
      isFinalDungeonRoom(getDungeonRoom(dungeon, "temple-of-dumathoin")!),
    ).toBe(true);
    expect(isFinalDungeonRoom(getDungeonRoom(dungeon, "cave-entrance")!)).toBe(
      false,
    );
  });
});
