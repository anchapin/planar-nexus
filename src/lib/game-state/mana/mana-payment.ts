import type { GameState, ManaPool, PlayerId } from "../types";

export function canAffordMana(
  state: GameState,
  playerId: PlayerId,
  mana: Partial<ManaPool>,
): boolean {
  const player = state.players.get(playerId);
  if (!player) {
    return false;
  }

  const pool = player.manaPool;

  if (
    pool.white < (mana.white ?? 0) ||
    pool.blue < (mana.blue ?? 0) ||
    pool.black < (mana.black ?? 0) ||
    pool.red < (mana.red ?? 0) ||
    pool.green < (mana.green ?? 0)
  ) {
    return false;
  }

  if (pool.colorless < (mana.colorless ?? 0)) {
    return false;
  }

  const totalColored =
    pool.white + pool.blue + pool.black + pool.red + pool.green;
  const neededColored =
    (mana.white ?? 0) +
    (mana.blue ?? 0) +
    (mana.black ?? 0) +
    (mana.red ?? 0) +
    (mana.green ?? 0);
  const availableForGeneric =
    pool.generic +
    (totalColored - neededColored) +
    (pool.colorless - (mana.colorless ?? 0));

  return availableForGeneric >= (mana.generic ?? 0);
}

export function spendMana(
  state: GameState,
  playerId: PlayerId,
  mana: Partial<ManaPool>,
): { success: boolean; state: GameState } {
  const player = state.players.get(playerId);
  if (!player) {
    return { success: false, state };
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

  const pool = player.manaPool;

  if (
    pool.white < (safeMana.white ?? 0) ||
    pool.blue < (safeMana.blue ?? 0) ||
    pool.black < (safeMana.black ?? 0) ||
    pool.red < (safeMana.red ?? 0) ||
    pool.green < (safeMana.green ?? 0)
  ) {
    return { success: false, state };
  }

  if (pool.colorless < (safeMana.colorless ?? 0)) {
    return { success: false, state };
  }

  const totalColored =
    pool.white + pool.blue + pool.black + pool.red + pool.green;
  const neededColored =
    (safeMana.white ?? 0) +
    (safeMana.blue ?? 0) +
    (safeMana.black ?? 0) +
    (safeMana.red ?? 0) +
    (safeMana.green ?? 0);
  const availableForGeneric =
    pool.generic +
    (totalColored - neededColored) +
    (pool.colorless - (safeMana.colorless ?? 0));

  if (availableForGeneric < (safeMana.generic ?? 0)) {
    return { success: false, state };
  }

  let whiteRemaining = pool.white - (safeMana.white ?? 0);
  let blueRemaining = pool.blue - (safeMana.blue ?? 0);
  let blackRemaining = pool.black - (safeMana.black ?? 0);
  let redRemaining = pool.red - (safeMana.red ?? 0);
  let greenRemaining = pool.green - (safeMana.green ?? 0);
  let colorlessRemaining = pool.colorless - (safeMana.colorless ?? 0);
  let genericRemaining = pool.generic;

  let genericToPay = safeMana.generic ?? 0;

  const fromGeneric = Math.min(genericRemaining, genericToPay);
  genericRemaining -= fromGeneric;
  genericToPay -= fromGeneric;

  const fromColorless = Math.min(colorlessRemaining, genericToPay);
  colorlessRemaining -= fromColorless;
  genericToPay -= fromColorless;

  const applyColoredToGeneric = (
    amount: number,
    available: number,
  ): { used: number; remaining: number } => {
    const used = Math.min(available, amount);
    return { used, remaining: available - used };
  };

  if (genericToPay > 0 && whiteRemaining > 0) {
    const result = applyColoredToGeneric(genericToPay, whiteRemaining);
    whiteRemaining = result.remaining;
    genericToPay -= result.used;
  }
  if (genericToPay > 0 && blueRemaining > 0) {
    const result = applyColoredToGeneric(genericToPay, blueRemaining);
    blueRemaining = result.remaining;
    genericToPay -= result.used;
  }
  if (genericToPay > 0 && blackRemaining > 0) {
    const result = applyColoredToGeneric(genericToPay, blackRemaining);
    blackRemaining = result.remaining;
    genericToPay -= result.used;
  }
  if (genericToPay > 0 && redRemaining > 0) {
    const result = applyColoredToGeneric(genericToPay, redRemaining);
    redRemaining = result.remaining;
    genericToPay -= result.used;
  }
  if (genericToPay > 0 && greenRemaining > 0) {
    const result = applyColoredToGeneric(genericToPay, greenRemaining);
    greenRemaining = result.remaining;
    genericToPay -= result.used;
  }

  const updatedPlayers = new Map(state.players);
  const updatedPlayer = {
    ...player,
    manaPool: {
      colorless: colorlessRemaining,
      white: whiteRemaining,
      blue: blueRemaining,
      black: blackRemaining,
      red: redRemaining,
      green: greenRemaining,
      generic: genericRemaining,
    },
  };
  updatedPlayers.set(playerId, updatedPlayer);

  return {
    success: true,
    state: {
      ...state,
      players: updatedPlayers,
      lastModifiedAt: Date.now(),
    },
  };
}
