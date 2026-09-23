import type { GameState, ManaPool, PlayerId } from "../types";

export function createEmptyManaPool(): ManaPool {
  return {
    colorless: 0,
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    generic: 0,
  };
}

export function addMana(
  state: GameState,
  playerId: PlayerId,
  mana: Partial<ManaPool>,
): GameState {
  const player = state.players.get(playerId);
  if (!player) {
    return state;
  }

  const safeMana: ManaPool = {
    colorless: Math.max(0, mana.colorless ?? 0),
    white: Math.max(0, mana.white ?? 0),
    blue: Math.max(0, mana.blue ?? 0),
    black: Math.max(0, mana.black ?? 0),
    red: Math.max(0, mana.red ?? 0),
    green: Math.max(0, mana.green ?? 0),
    generic: Math.max(0, mana.generic ?? 0),
  };

  const updatedPlayers = new Map(state.players);
  const updatedPlayer = {
    ...player,
    manaPool: {
      ...player.manaPool,
      colorless: player.manaPool.colorless + safeMana.colorless,
      white: player.manaPool.white + safeMana.white,
      blue: player.manaPool.blue + safeMana.blue,
      black: player.manaPool.black + safeMana.black,
      red: player.manaPool.red + safeMana.red,
      green: player.manaPool.green + safeMana.green,
      generic: player.manaPool.generic + safeMana.generic,
    },
  };
  updatedPlayers.set(playerId, updatedPlayer);

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

export function emptyManaPool(state: GameState, playerId: PlayerId): GameState {
  const player = state.players.get(playerId);
  if (!player) return state;

  const newPlayers = new Map(state.players);
  newPlayers.set(playerId, { ...player, manaPool: createEmptyManaPool() });
  return { ...state, players: newPlayers };
}

export function emptyAllManaPools(state: GameState): GameState {
  const newPlayers = new Map(state.players);
  for (const [pid, player] of newPlayers) {
    newPlayers.set(pid, { ...player, manaPool: createEmptyManaPool() });
  }
  return { ...state, players: newPlayers };
}

export function getTotalMana(pool: ManaPool): number {
  return (
    pool.colorless +
    pool.white +
    pool.blue +
    pool.black +
    pool.red +
    pool.green +
    pool.generic
  );
}

export function hasMana(pool: ManaPool): boolean {
  return getTotalMana(pool) > 0;
}

export function formatManaPool(pool: ManaPool): string {
  const parts: string[] = [];
  if (pool.white) parts.push(`${pool.white}W`);
  if (pool.blue) parts.push(`${pool.blue}U`);
  if (pool.black) parts.push(`${pool.black}B`);
  if (pool.red) parts.push(`${pool.red}R`);
  if (pool.green) parts.push(`${pool.green}G`);
  if (pool.colorless) parts.push(`${pool.colorless}C`);
  if (pool.generic) parts.push(`${pool.generic}`);
  return parts.length > 0 ? parts.join(" ") : "0";
}
