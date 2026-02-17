/**
 * Mana System
 * 
 * This module implements the mana system for Magic: The Gathering,
 * including mana pool management, land playing, and mana abilities.
 * 
 * Reference: CR 106 - Mana, CR 305 - Lands
 */

import type { GameState, PlayerId, CardInstanceId, ManaPool, ZoneType } from "./types";
import { Phase } from "./types";
import { moveCardBetweenZones } from "./zones";
import { passPriority } from "./game-state";

/**
 * Create an empty mana pool
 */
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

/**
 * Add mana to a player's mana pool
 */
export function addMana(
  state: GameState,
  playerId: PlayerId,
  mana: Partial<ManaPool>
): GameState {
  const player = state.players.get(playerId);
  if (!player) {
    return state;
  }

  const updatedPlayers = new Map(state.players);
  const updatedPlayer = {
    ...player,
    manaPool: {
      ...player.manaPool,
      colorless: player.manaPool.colorless + (mana.colorless ?? 0),
      white: player.manaPool.white + (mana.white ?? 0),
      blue: player.manaPool.blue + (mana.blue ?? 0),
      black: player.manaPool.black + (mana.black ?? 0),
      red: player.manaPool.red + (mana.red ?? 0),
      green: player.manaPool.green + (mana.green ?? 0),
      generic: player.manaPool.generic + (mana.generic ?? 0),
    },
  };
  updatedPlayers.set(playerId, updatedPlayer);

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Spend mana from a player's mana pool
 * Returns whether the payment was successful
 */
export function spendMana(
  state: GameState,
  playerId: PlayerId,
  mana: Partial<ManaPool>
): { success: boolean; state: GameState } {
  const player = state.players.get(playerId);
  if (!player) {
    return { success: false, state };
  }

  const pool = player.manaPool;

  // Check if player has enough mana
  if (
    pool.colorless < (mana.colorless ?? 0) ||
    pool.white < (mana.white ?? 0) ||
    pool.blue < (mana.blue ?? 0) ||
    pool.black < (mana.black ?? 0) ||
    pool.red < (mana.red ?? 0) ||
    pool.green < (mana.green ?? 0) ||
    pool.generic < (mana.generic ?? 0)
  ) {
    return { success: false, state };
  }

  // Calculate total colored mana available
  const totalColored =
    pool.white + pool.blue + pool.black + pool.red + pool.green;
  const neededColored =
    (mana.white ?? 0) +
    (mana.blue ?? 0) +
    (mana.black ?? 0) +
    (mana.red ?? 0) +
    (mana.green ?? 0);

  // Check if we can use colored/colorless mana to pay generic costs
  // Generic mana can be paid with any color or colorless
  const remainingGeneric = pool.generic;
  const remainingColored = totalColored - neededColored;
  const remainingColorless = pool.colorless - (mana.colorless ?? 0);
  
  if (remainingGeneric + remainingColored + remainingColorless < (mana.generic ?? 0)) {
    return { success: false, state };
  }

  // Calculate how much generic we need to pay
  let genericToPay = mana.generic ?? 0;
  
  // First use generic pool
  const genericFromGeneric = Math.min(pool.generic, genericToPay);
  genericToPay -= genericFromGeneric;
  
  // Then use colored mana (can pay for generic)
  const extraColoredAvailable = totalColored - neededColored;
  const genericFromColored = Math.min(extraColoredAvailable, genericToPay);
  genericToPay -= genericFromColored;
  
  // Finally use colorless (can pay for generic)
  const genericFromColorless = Math.min(pool.colorless - (mana.colorless ?? 0), genericToPay);
  genericToPay -= genericFromColorless;
  
  // Now calculate actual deductions with proper prioritization
  // Deduct colored first for colored requirements
  let whiteToDeduct = mana.white ?? 0;
  let blueToDeduct = mana.blue ?? 0;
  let blackToDeduct = mana.black ?? 0;
  let redToDeduct = mana.red ?? 0;
  let greenToDeduct = mana.green ?? 0;
  let colorlessToDeduct = mana.colorless ?? 0;
  let genericToDeduct = mana.generic ?? 0;
  
  // If we used colored for generic, deduct from colored pools proportionally
  if (genericFromColored > 0) {
    // Deduct proportionally from available colored
    const coloredAvailable = extraColoredAvailable;
    if (coloredAvailable > 0) {
      const ratio = genericFromColored / coloredAvailable;
      // Deduct from whichever colors have excess
      const excessWhite = Math.max(0, pool.white - (mana.white ?? 0));
      const excessBlue = Math.max(0, pool.blue - (mana.blue ?? 0));
      const excessBlack = Math.max(0, pool.black - (mana.black ?? 0));
      const excessRed = Math.max(0, pool.red - (mana.red ?? 0));
      const excessGreen = Math.max(0, pool.green - (mana.green ?? 0));
      const totalExcess = excessWhite + excessBlue + excessBlack + excessRed + excessGreen;
      
      if (totalExcess > 0) {
        const whiteDeduct = Math.floor((excessWhite / totalExcess) * genericFromColored);
        const blueDeduct = Math.floor((excessBlue / totalExcess) * genericFromColored);
        const blackDeduct = Math.floor((excessBlack / totalExcess) * genericFromColored);
        const redDeduct = Math.floor((excessRed / totalExcess) * genericFromColored);
        const greenDeduct = Math.floor((excessGreen / totalExcess) * genericFromColored);
        
        whiteToDeduct += whiteDeduct;
        blueToDeduct += blueDeduct;
        blackToDeduct += blackDeduct;
        redToDeduct += redDeduct;
        greenToDeduct += greenDeduct;
      }
    }
  }
  
  // If we used colorless for generic, add to colorless deduction
  if (genericFromColorless > 0) {
    colorlessToDeduct += genericFromColorless;
  }

  // Spend the mana
  const updatedPlayers = new Map(state.players);
  const updatedPlayer = {
    ...player,
    manaPool: {
      colorless: pool.colorless - colorlessToDeduct,
      white: pool.white - whiteToDeduct,
      blue: pool.blue - blueToDeduct,
      black: pool.black - blackToDeduct,
      red: pool.red - redToDeduct,
      green: pool.green - greenToDeduct,
      generic: pool.generic - genericFromGeneric,
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

/**
 * Empty a player's mana pool (typically at end of step)
 * In modern Magic, mana pools empty at the end of each step/phase
 */
export function emptyManaPool(state: GameState, playerId: PlayerId): GameState {
  const player = state.players.get(playerId);
  if (!player) {
    return state;
  }

  const updatedPlayers = new Map(state.players);
  const updatedPlayer = {
    ...player,
    manaPool: createEmptyManaPool(),
  };
  updatedPlayers.set(playerId, updatedPlayer);

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Empty all players' mana pools
 */
export function emptyAllManaPools(state: GameState): GameState {
  let newState = state;
  
  for (const playerId of state.players.keys()) {
    newState = emptyManaPool(newState, playerId);
  }
  
  return newState;
}

/**
 * Check if a player can play a land this turn
 */
export function canPlayLand(state: GameState, playerId: PlayerId): boolean {
  const player = state.players.get(playerId);
  if (!player) {
    return false;
  }

  // Must be in a main phase
  const currentPhase = state.turn.currentPhase;
  if (currentPhase !== Phase.PRECOMBAT_MAIN && currentPhase !== Phase.POSTCOMBAT_MAIN) {
    return false;
  }

  // Stack must be empty to play a land
  if (state.stack.length > 0) {
    return false;
  }

  // Check if player has land plays remaining this turn
  if (player.landsPlayedThisTurn >= player.maxLandsPerTurn) {
    return false;
  }

  // Player must have priority
  if (state.priorityPlayerId !== playerId) {
    return false;
  }

  return true;
}

/**
 * Play a land card from hand
 */
export function playLand(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId
): { success: boolean; state: GameState } {
  // Check if player can play a land
  if (!canPlayLand(state, playerId)) {
    return { success: false, state };
  }

  // Verify the card is in player's hand
  const handZone = state.zones.get(`hand-${playerId}`);
  if (!handZone || !handZone.cardIds.includes(cardId)) {
    return { success: false, state };
  }

  // Get the card to verify it's a land
  const card = state.cards.get(cardId);
  if (!card) {
    return { success: false, state };
  }

  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  if (!typeLine.includes("land")) {
    return { success: false, state };
  }

  // Get the battlefield zone
  const battlefieldZone = state.zones.get(`battlefield-${playerId}`);
  if (!battlefieldZone) {
    return { success: false, state };
  }

  // Move the land from hand to battlefield
  const moved = moveCardBetweenZones(handZone, battlefieldZone, cardId);
  
  // Update zones
  const updatedZones = new Map(state.zones);
  updatedZones.set(`hand-${playerId}`, moved.from);
  updatedZones.set(`battlefield-${playerId}`, moved.to);

  // Increment lands played this turn
  const player = state.players.get(playerId);
  if (!player) {
    return { success: false, state };
  }

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, {
    ...player,
    landsPlayedThisTurn: player.landsPlayedThisTurn + 1,
  });

  return {
    success: true,
    state: {
      ...state,
      zones: updatedZones,
      players: updatedPlayers,
      lastModifiedAt: Date.now(),
    },
  };
}

/**
 * Activate a mana ability (e.g., Birds of Paradise, Sol Ring)
 * Mana abilities don't use the stack and resolve immediately
 */
export function activateManaAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number
): GameState {
  const card = state.cards.get(cardId);
  if (!card) {
    return state;
  }

  // Check if player has priority
  if (state.priorityPlayerId !== playerId) {
    return state;
  }

  // Mark that this player has activated a mana ability
  // This is important for priority - players get priority after mana abilities
  const updatedPlayers = new Map(state.players);
  const player = updatedPlayers.get(playerId);
  
  if (player) {
    updatedPlayers.set(playerId, {
      ...player,
      hasActivatedManaAbility: true,
    });
  }

  // For now, return state with the flag set
  // The actual mana addition would be handled by parsing the card's ability
  // and determining what mana it produces
  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Check if a card is a mana ability
 * Mana abilities produce mana and don't use the stack
 */
export function isManaAbility(
  cardId: CardInstanceId,
  abilityText: string
): boolean {
  // Check if the ability produces mana
  // Mana abilities are abilities that produce mana as part of their cost/effect
  const manaKeywords = [
    "add",
    "produce",
    "tap: add",
    "{tap}: add",
    "mana",
  ];
  
  const lowerText = abilityText.toLowerCase();
  
  // Check if it produces colored mana
  const producesMana = 
    lowerText.includes("{w}") || lowerText.includes("{u}") ||
    lowerText.includes("{b}") || lowerText.includes("{r}") ||
    lowerText.includes("{g}") || lowerText.includes("{c}") ||
    lowerText.includes("add ") || lowerText.includes("produces");
  
  return producesMana;
}

/**
 * Get the total amount of mana in a player's pool
 */
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

/**
 * Check if a player has any mana in their pool
 */
export function hasMana(pool: ManaPool): boolean {
  return getTotalMana(pool) > 0;
}

/**
 * Get a breakdown of mana in the pool as a string
 */
export function formatManaPool(pool: ManaPool): string {
  const parts: string[] = [];

  if (pool.white > 0) parts.push(`${pool.white}W`);
  if (pool.blue > 0) parts.push(`${pool.blue}U`);
  if (pool.black > 0) parts.push(`${pool.black}B`);
  if (pool.red > 0) parts.push(`${pool.red}R`);
  if (pool.green > 0) parts.push(`${pool.green}G`);
  if (pool.colorless > 0) parts.push(`${pool.colorless}C`);
  if (pool.generic > 0) parts.push(`${pool.generic}`);

  return parts.length > 0 ? parts.join(" ") : "0";
}

/**
 * Reset a player's land plays for a new turn
 */
export function resetLandPlays(state: GameState, playerId: PlayerId): GameState {
  const player = state.players.get(playerId);
  if (!player) {
    return state;
  }

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, {
    ...player,
    landsPlayedThisTurn: 0,
    hasActivatedManaAbility: false,
  });

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Set maximum lands per turn for a player (for effects like Zendikar's Roil)
 */
export function setMaxLandsPerTurn(
  state: GameState,
  playerId: PlayerId,
  maxLands: number
): GameState {
  const player = state.players.get(playerId);
  if (!player) {
    return state;
  }

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, {
    ...player,
    maxLandsPerTurn: maxLands,
  });

  return {
    ...state,
    players: updatedPlayers,
  };
}

/**
 * Add additional land play for a player (for effects like Oracle's Vineyard)
 */
export function addLandPlay(
  state: GameState,
  playerId: PlayerId,
  amount: number = 1
): GameState {
  const player = state.players.get(playerId);
  if (!player) {
    return state;
  }

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, {
    ...player,
    maxLandsPerTurn: player.maxLandsPerTurn + amount,
  });

  return {
    ...state,
    players: updatedPlayers,
  };
}

/**
 * Determine the mana cost for a spell
 * Note: For X spells, the X cost is not included in the returned values
 *       and must be handled separately via the variableValues parameter
 */
export function getSpellManaCost(
  card: { mana_cost?: string }
): { generic: number; white: number; blue: number; black: number; red: number; green: number; hasX: boolean } {
  const manaCost = card.mana_cost || "";
  const parsed = parseManaCostString(manaCost);
  // Check if the cost contains X
  const hasX = (manaCost.toUpperCase().match(/X/g) || []).length > 0;
  return {
    generic: parsed.generic,
    white: parsed.white,
    blue: parsed.blue,
    black: parsed.black,
    red: parsed.red,
    green: parsed.green,
    hasX,
  };
}

/**
 * Parse a mana cost string into components
 */
function parseManaCostString(manaCost: string): { 
  generic: number; 
  white: number; 
  blue: number; 
  black: number; 
  red: number; 
  green: number 
} {
  const result = { generic: 0, white: 0, blue: 0, black: 0, red: 0, green: 0 };
  
  const matches = manaCost.match(/{[^}]+}/g) || [];
  
  for (const match of matches) {
    const symbol = match.slice(1, -1).toUpperCase();
    
    if (/^\d+$/.test(symbol)) {
      result.generic += parseInt(symbol, 10);
    } else if (symbol === "W") {
      result.white += 1;
    } else if (symbol === "U") {
      result.blue += 1;
    } else if (symbol === "B") {
      result.black += 1;
    } else if (symbol === "R") {
      result.red += 1;
    } else if (symbol === "G") {
      result.green += 1;
    }
    // X is handled separately via variableValues - no action needed here
  }
  
  return result;
}
