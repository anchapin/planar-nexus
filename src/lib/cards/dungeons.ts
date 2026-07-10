export interface DungeonRoom {
  id: string;
  name: string;
  effect: string;
  nextRoomIds: string[];
}

export interface DungeonDefinition {
  id: string;
  name: string;
  startingRoomId: string;
  rooms: DungeonRoom[];
}

export interface DungeonRoomCompletion {
  dungeonId: string;
  dungeonName: string;
  roomId: string;
  roomName: string;
  roomIndex: number;
  effect: string;
  isFinalRoom: boolean;
}

export const DEFAULT_DUNGEON_ID = "lost-mine-of-phandelver";

export const DUNGEONS: Record<string, DungeonDefinition> = {
  "lost-mine-of-phandelver": {
    id: "lost-mine-of-phandelver",
    name: "Lost Mine of Phandelver",
    startingRoomId: "cave-entrance",
    rooms: [
      {
        id: "cave-entrance",
        name: "Cave Entrance",
        effect: "Scry 1.",
        nextRoomIds: ["goblin-lair", "mine-tunnels"],
      },
      {
        id: "goblin-lair",
        name: "Goblin Lair",
        effect: "Create a Treasure token.",
        nextRoomIds: ["storeroom"],
      },
      {
        id: "mine-tunnels",
        name: "Mine Tunnels",
        effect: "Create a Treasure token.",
        nextRoomIds: ["dark-pool", "fungi-cavern"],
      },
      {
        id: "storeroom",
        name: "Storeroom",
        effect: "Put a +1/+1 counter on target creature.",
        nextRoomIds: ["temple-of-dumathoin"],
      },
      {
        id: "dark-pool",
        name: "Dark Pool",
        effect: "Each opponent loses 1 life and you gain 1 life.",
        nextRoomIds: ["temple-of-dumathoin"],
      },
      {
        id: "fungi-cavern",
        name: "Fungi Cavern",
        effect: "Target creature gets -4/-0 until your next turn.",
        nextRoomIds: ["temple-of-dumathoin"],
      },
      {
        id: "temple-of-dumathoin",
        name: "Temple of Dumathoin",
        effect: "Draw a card.",
        nextRoomIds: [],
      },
    ],
  },
  "tomb-of-annihilation": {
    id: "tomb-of-annihilation",
    name: "Tomb of Annihilation",
    startingRoomId: "trapped-entry",
    rooms: [
      {
        id: "trapped-entry",
        name: "Trapped Entry",
        effect: "Each player loses 1 life.",
        nextRoomIds: ["veils-of-fear", "oubliette"],
      },
      {
        id: "veils-of-fear",
        name: "Veils of Fear",
        effect: "Each player loses 2 life unless they discard a card.",
        nextRoomIds: ["sandfall-cell"],
      },
      {
        id: "oubliette",
        name: "Oubliette",
        effect:
          "Discard a card and sacrifice an artifact, a creature, and a land.",
        nextRoomIds: ["cradle-of-the-death-god"],
      },
      {
        id: "sandfall-cell",
        name: "Sandfall Cell",
        effect:
          "Each player loses 2 life unless they sacrifice an artifact, a creature, or a land.",
        nextRoomIds: ["cradle-of-the-death-god"],
      },
      {
        id: "cradle-of-the-death-god",
        name: "Cradle of the Death God",
        effect:
          "Create The Atropal, a legendary 4/4 black God Horror creature token with deathtouch.",
        nextRoomIds: [],
      },
    ],
  },
  "dungeon-of-the-mad-mage": {
    id: "dungeon-of-the-mad-mage",
    name: "Dungeon of the Mad Mage",
    startingRoomId: "yawning-portal",
    rooms: [
      {
        id: "yawning-portal",
        name: "Yawning Portal",
        effect: "You gain 1 life.",
        nextRoomIds: ["dungeon-level"],
      },
      {
        id: "dungeon-level",
        name: "Dungeon Level",
        effect: "Scry 1.",
        nextRoomIds: ["goblin-bazaar", "twisted-caverns"],
      },
      {
        id: "goblin-bazaar",
        name: "Goblin Bazaar",
        effect: "Create a Treasure token.",
        nextRoomIds: ["lost-level"],
      },
      {
        id: "twisted-caverns",
        name: "Twisted Caverns",
        effect: "Target creature can't attack until your next turn.",
        nextRoomIds: ["lost-level"],
      },
      {
        id: "lost-level",
        name: "Lost Level",
        effect: "Scry 2.",
        nextRoomIds: ["runestone-caverns", "muirals-graveyard"],
      },
      {
        id: "runestone-caverns",
        name: "Runestone Caverns",
        effect: "Exile the top two cards of your library. You may play them.",
        nextRoomIds: ["deep-mines"],
      },
      {
        id: "muirals-graveyard",
        name: "Muiral's Graveyard",
        effect: "Create two 1/1 black Skeleton creature tokens.",
        nextRoomIds: ["deep-mines"],
      },
      {
        id: "deep-mines",
        name: "Deep Mines",
        effect: "Scry 3.",
        nextRoomIds: ["mad-wizards-lair"],
      },
      {
        id: "mad-wizards-lair",
        name: "Mad Wizard's Lair",
        effect:
          "Draw three cards and reveal them. You may cast one without paying its mana cost.",
        nextRoomIds: [],
      },
    ],
  },
};

export function getDungeon(dungeonId: string): DungeonDefinition | undefined {
  return DUNGEONS[dungeonId];
}

export function getDungeonRoom(
  dungeon: DungeonDefinition,
  roomId: string,
): DungeonRoom | undefined {
  return dungeon.rooms.find((room) => room.id === roomId);
}

export function getDungeonRoomByIndex(
  dungeon: DungeonDefinition,
  roomIndex: number,
): DungeonRoom | undefined {
  return dungeon.rooms[roomIndex];
}

export function getStartingDungeonRoom(
  dungeon: DungeonDefinition,
): DungeonRoom | undefined {
  return getDungeonRoom(dungeon, dungeon.startingRoomId);
}

export function getNextDungeonRoom(
  dungeon: DungeonDefinition,
  currentRoomId: string,
  nextRoomId?: string,
): DungeonRoom | undefined {
  const currentRoom = getDungeonRoom(dungeon, currentRoomId);
  if (!currentRoom || currentRoom.nextRoomIds.length === 0) return undefined;
  const selectedRoomId = nextRoomId ?? currentRoom.nextRoomIds[0];
  if (!currentRoom.nextRoomIds.includes(selectedRoomId)) return undefined;
  return getDungeonRoom(dungeon, selectedRoomId);
}

export function isFinalDungeonRoom(room: DungeonRoom): boolean {
  return room.nextRoomIds.length === 0;
}
