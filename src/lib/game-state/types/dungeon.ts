/**
 * Dungeon types (CR 309): identifiers and per-player dungeon progress.
 *
 * Mechanically extracted from types.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */

export type DungeonId = string;
export type DungeonRoomId = string;

export interface DungeonProgress {
  dungeonId: DungeonId;
  roomIndex: number;
  roomId?: DungeonRoomId;
}

