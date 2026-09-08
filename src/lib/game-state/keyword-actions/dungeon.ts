/**
 * Dungeon keyword actions: "venture into the dungeon" room progression (CR 309).
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, PlayerId } from '../types';
import { DEFAULT_DUNGEON_ID, getDungeon, getDungeonRoom, getDungeonRoomByIndex, getNextDungeonRoom, getStartingDungeonRoom, isFinalDungeonRoom, DungeonDefinition, DungeonRoom, DungeonRoomCompletion } from '../dungeon-data';
import { KeywordActionResult } from './shared';

function getProgressRoom(
  dungeon: DungeonDefinition,
  roomId: string | undefined,
  roomIndex: number,
): DungeonRoom | undefined {
  if (roomId) {
    const room = getDungeonRoom(dungeon, roomId);
    if (room) return room;
  }
  return getDungeonRoomByIndex(dungeon, roomIndex);
}

function buildRoomCompletion(
  dungeon: DungeonDefinition,
  room: DungeonRoom,
  roomIndex: number,
): DungeonRoomCompletion {
  return {
    dungeonId: dungeon.id,
    dungeonName: dungeon.name,
    roomId: room.id,
    roomName: room.name,
    roomIndex,
    effect: room.effect,
    isFinalRoom: isFinalDungeonRoom(room),
  };
}

export function ventureIntoDungeon(
  state: GameState,
  playerId: PlayerId,
  dungeonId: string = DEFAULT_DUNGEON_ID,
  nextRoomId?: string,
): KeywordActionResult {
  const player = state.players.get(playerId);
  if (!player) {
    return {
      success: false,
      state,
      description: "",
      error: `Player ${playerId} not found`,
    };
  }

  const activeProgress = player.dungeonProgress ?? null;
  let dungeon = getDungeon(dungeonId);
  let room: DungeonRoom | undefined;
  let roomIndex = 0;

  if (activeProgress) {
    const activeDungeon = getDungeon(activeProgress.dungeonId);
    if (!activeDungeon) {
      return {
        success: false,
        state,
        description: "",
        error: `Dungeon ${activeProgress.dungeonId} not found`,
      };
    }

    const currentRoom = getProgressRoom(
      activeDungeon,
      activeProgress.roomId,
      activeProgress.roomIndex,
    );

    if (!currentRoom) {
      return {
        success: false,
        state,
        description: "",
        error: `Room ${activeProgress.roomId ?? activeProgress.roomIndex} not found`,
      };
    }

    if (!isFinalDungeonRoom(currentRoom)) {
      dungeon = activeDungeon;
      room = getNextDungeonRoom(activeDungeon, currentRoom.id, nextRoomId);
      roomIndex = activeProgress.roomIndex + 1;
      if (!room) {
        return {
          success: false,
          state,
          description: "",
          error: `Room ${nextRoomId ?? "default"} is not reachable from ${currentRoom.id}`,
        };
      }
    }
  }

  if (!dungeon) {
    return {
      success: false,
      state,
      description: "",
      error: `Dungeon ${dungeonId} not found`,
    };
  }

  if (!room) {
    room = getStartingDungeonRoom(dungeon);
    roomIndex = 0;
  }

  if (!room) {
    return {
      success: false,
      state,
      description: "",
      error: `Dungeon ${dungeon.id} has no starting room`,
    };
  }

  const roomCompletion = buildRoomCompletion(dungeon, room, roomIndex);
  const completedDungeonIds = roomCompletion.isFinalRoom
    ? Array.from(new Set([...(player.completedDungeonIds ?? []), dungeon.id]))
    : (player.completedDungeonIds ?? []);
  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, {
    ...player,
    dungeonProgress: {
      dungeonId: dungeon.id,
      roomId: room.id,
      roomIndex,
    },
    completedDungeonIds,
  });

  return {
    success: true,
    state: {
      ...state,
      players: updatedPlayers,
      lastModifiedAt: Date.now(),
    },
    description: `${player.name} ventured into ${dungeon.name}: ${room.name} — ${room.effect}`,
    roomCompletion,
    completedDungeonId: roomCompletion.isFinalRoom ? dungeon.id : undefined,
  };
}

