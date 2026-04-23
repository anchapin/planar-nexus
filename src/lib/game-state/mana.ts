/**
 * Mana System
 *
 * This module implements the mana system for Magic: The Gathering,
 * including mana pool management, land playing, and mana abilities.
 *
 * Reference: CR 106 - Mana, CR 305 - Lands
 */

import type { GameState, PlayerId, CardInstanceId, ManaPool } from "./types";
import { Phase } from "./types";
import { moveCardBetweenZones } from "./zones";
import { ValidationService } from "./validation-service";

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
  mana: Partial<ManaPool>,
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
 *
 * Generic mana costs can be paid with any type of mana (colored, colorless, or generic).
 * Colored mana costs must be paid with the specific color.
 * Colorless mana costs must be paid with colorless mana (not colored).
 */
export function spendMana(
  state: GameState,
  playerId: PlayerId,
  mana: Partial<ManaPool>,
): { success: boolean; state: GameState } {
  const player = state.players.get(playerId);
  if (!player) {
    return { success: false, state };
  }

  const pool = player.manaPool;

  // Check if player has enough colored mana (specific color requirements)
  if (
    pool.white < (mana.white ?? 0) ||
    pool.blue < (mana.blue ?? 0) ||
    pool.black < (mana.black ?? 0) ||
    pool.red < (mana.red ?? 0) ||
    pool.green < (mana.green ?? 0)
  ) {
    return { success: false, state };
  }

  // Check if player has enough colorless mana (colorless is specific, like colored)
  if (pool.colorless < (mana.colorless ?? 0)) {
    return { success: false, state };
  }

  // Calculate total mana available for generic costs
  // Generic can be paid with: generic pool, colored mana, or colorless mana
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

  if (availableForGeneric < (mana.generic ?? 0)) {
    return { success: false, state };
  }

  // Calculate deductions
  let whiteRemaining = pool.white - (mana.white ?? 0);
  let blueRemaining = pool.blue - (mana.blue ?? 0);
  let blackRemaining = pool.black - (mana.black ?? 0);
  let redRemaining = pool.red - (mana.red ?? 0);
  let greenRemaining = pool.green - (mana.green ?? 0);
  let colorlessRemaining = pool.colorless - (mana.colorless ?? 0);
  let genericRemaining = pool.generic;

  // Pay generic costs - first from generic pool, then from colored/colorless
  let genericToPay = mana.generic ?? 0;

  // First use generic pool mana
  const fromGeneric = Math.min(genericRemaining, genericToPay);
  genericRemaining -= fromGeneric;
  genericToPay -= fromGeneric;

  // Then use colorless mana for remaining generic
  const fromColorless = Math.min(colorlessRemaining, genericToPay);
  colorlessRemaining -= fromColorless;
  genericToPay -= fromColorless;

  // Finally use colored mana for remaining generic (any color can pay generic)
  // Use colored mana in order: white, blue, black, red, green
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

  // Spend the mana
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
  if (
    currentPhase !== Phase.PRECOMBAT_MAIN &&
    currentPhase !== Phase.POSTCOMBAT_MAIN
  ) {
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
 * Enforces the "One land per turn" rule and other timing restrictions
 */
export function playLand(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  modeId?: string,
): { success: boolean; state: GameState; error?: string } {
  // Create a game action for validation
  const action = {
    type: "play_land" as const,
    playerId,
    timestamp: Date.now(),
    data: { cardId },
  };

  // Validate the action before executing
  const validationResult = ValidationService.validateAction(
    state,
    action,
    modeId,
  );
  if (!validationResult.isValid) {
    return {
      success: false,
      state,
      error: validationResult.message || validationResult.reason,
    };
  }

  // Get the battlefield zone
  const battlefieldZone = state.zones.get(`${playerId}-battlefield`);
  if (!battlefieldZone) {
    return { success: false, state, error: "Battlefield zone not found." };
  }

  // Verify the card is in player's hand
  const handZone = state.zones.get(`${playerId}-hand`);
  if (!handZone || !handZone.cardIds.includes(cardId)) {
    return { success: false, state, error: "Card not in hand." };
  }

  // Get the card to verify it's a land
  const card = state.cards.get(cardId);
  if (!card) {
    return { success: false, state, error: "Card not found." };
  }

  // Move the land from hand to battlefield
  const moved = moveCardBetweenZones(handZone, battlefieldZone, cardId);

  // Update zones
  const updatedZones = new Map(state.zones);
  updatedZones.set(`${playerId}-hand`, moved.from);
  updatedZones.set(`${playerId}-battlefield`, moved.to);

  // Increment lands played this turn
  const player = state.players.get(playerId);
  if (!player) {
    return { success: false, state, error: "Player not found." };
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
 * Parsed mana ability option
 */
export interface ManaAbilityOption {
  /** Description of what this option produces */
  description: string;
  /** Mana to add */
  mana: Partial<ManaPool>;
  /** Optional condition text for conditional abilities (e.g., "you control a Mountain or a Plains") */
  activationCondition?: string;
}

/**
 * Parse a land's oracle text to determine what mana abilities it has.
 * Returns an array of options. Single-option lands return 1 item.
 * Multi-color lands return multiple items (one per color option).
 * "Any color" lands return one option per color.
 * Conditional abilities (e.g., "Activate only if you control a Mountain") are parsed.
 */
export function parseManaAbility(oracleText: string): ManaAbilityOption[] {
  const text = oracleText.toLowerCase();
  const options: ManaAbilityOption[] = [];

  // Helper: parse a string like "{w}{u}" or "{c}" into a ManaPool partial
  const parseSymbols = (symbols: string): Partial<ManaPool> => {
    const mana: Partial<ManaPool> = {};
    const matches = symbols.match(/\{([^}]+)\}/g) || [];
    for (const m of matches) {
      const sym = m.slice(1, -1).toUpperCase();
      if (sym === "W") mana.white = (mana.white || 0) + 1;
      else if (sym === "U") mana.blue = (mana.blue || 0) + 1;
      else if (sym === "B") mana.black = (mana.black || 0) + 1;
      else if (sym === "R") mana.red = (mana.red || 0) + 1;
      else if (sym === "G") mana.green = (mana.green || 0) + 1;
      else if (sym === "C") mana.colorless = (mana.colorless || 0) + 1;
      else if (/^\d+$/.test(sym))
        mana.generic = (mana.generic || 0) + parseInt(sym, 10);
    }
    return mana;
  };

  // Find ALL tap-ability patterns: "{T}: Add ..." with possible conditions after
  // We need to handle cases like:
  // - "{T}: Add {W}." (single ability)
  // - "{T}: Add {W} or {U}." (dual-color)
  // - "{T}: Add {R}. Activate only if you control a Mountain or a Plains." (conditional)
  // - "{T}: Add {W}.\n{T}: Add {R}. Activate only if you control a Mountain or a Plains." (multiple abilities)

  // First, find all positions of "{T}: Add" to identify ability starts
  const abilityStartRegex = /\{t\}:\s*add\s+/gi;
  const abilities: { manaClause: string; condition?: string }[] = [];

  let match;
  while ((match = abilityStartRegex.exec(text)) !== null) {
    const startIdx = match.index;
    // Find the end of this ability - either a period followed by another {T}: or end of text
    let endIdx = text.length;
    const nextAbilityMatch = text.indexOf("{t}:", startIdx + 4);
    if (nextAbilityMatch !== -1) {
      endIdx = nextAbilityMatch;
    }

    // Extract the ability text between start and end
    const abilityText = text.substring(startIdx, endIdx).trim();
    // Remove the leading "{T}: Add " part
    const abilityContent = abilityText.replace(/^\{t\}:\s*add\s+/i, "").trim();

    // Split by period to separate mana clause from condition
    const periodIdx = abilityContent.lastIndexOf(".");
    let manaClause = abilityContent;
    let condition: string | undefined;

    if (periodIdx !== -1) {
      const afterPeriod = abilityContent.substring(periodIdx + 1).trim();
      if (afterPeriod.toLowerCase().startsWith("activate only if")) {
        manaClause = abilityContent.substring(0, periodIdx);
        condition = afterPeriod;
      }
    }

    abilities.push({ manaClause: manaClause.trim(), condition });
  }

  // Process each ability
  for (const ability of abilities) {
    // Handle "or" clause (e.g., "{w} or {u}") - split into multiple options
    if (ability.manaClause.includes(" or ")) {
      const parts = ability.manaClause.split(/,\s+or\s+|\s+or\s+/);
      for (const part of parts) {
        const mana = parseSymbols(part);
        if (Object.keys(mana).length > 0) {
          const desc = formatManaPool({
            colorless: 0,
            white: 0,
            blue: 0,
            black: 0,
            red: 0,
            green: 0,
            generic: 0,
            ...mana,
          });
          const option: ManaAbilityOption = {
            description: desc,
            mana,
          };
          if (ability.condition) {
            option.activationCondition = ability.condition;
          }
          options.push(option);
        }
      }
      continue;
    }

    // Parse the mana symbols
    const mana = parseSymbols(ability.manaClause);
    if (Object.keys(mana).length === 0) continue;

    const desc = formatManaPool({
      colorless: 0,
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      generic: 0,
      ...mana,
    });

    const option: ManaAbilityOption = {
      description: desc || "Colorless",
      mana,
    };

    // If there's a condition, store it for later validation
    if (ability.condition) {
      option.activationCondition = ability.condition;
    }

    options.push(option);
  }

  // If no abilities found with the new logic, fall back to the old logic for simple cases
  if (options.length === 0) {
    const addMatch = text.match(/\{t\}:\s*add\s+([^.)]+)/i);
    if (!addMatch) return options;

    const manaClause = addMatch[1].trim();

    // "one mana of any color" or "one mana of any one color"
    if (
      manaClause.includes("any color") ||
      manaClause.includes("any one color") ||
      manaClause.includes("mana of any color")
    ) {
      options.push({ description: "White", mana: { white: 1 } });
      options.push({ description: "Blue", mana: { blue: 1 } });
      options.push({ description: "Black", mana: { black: 1 } });
      options.push({ description: "Red", mana: { red: 1 } });
      options.push({ description: "Green", mana: { green: 1 } });
      return options;
    }

    // "{w} or {u}" or "{w}, {u}, {b}, {r}, or {g}" — split on " or " and ","
    if (manaClause.includes(" or ")) {
      const parts = manaClause.split(/,\s+or\s+|\s+or\s+/);
      for (const part of parts) {
        const mana = parseSymbols(part);
        if (Object.keys(mana).length > 0) {
          const desc = formatManaPool({
            colorless: 0,
            white: 0,
            blue: 0,
            black: 0,
            red: 0,
            green: 0,
            generic: 0,
            ...mana,
          });
          options.push({ description: desc, mana });
        }
      }
      return options;
    }

    // Single mana production (no "or")
    const mana = parseSymbols(manaClause);
    if (Object.keys(mana).length > 0) {
      const desc = formatManaPool({
        colorless: 0,
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        generic: 0,
        ...mana,
      });
      options.push({ description: desc || "Colorless", mana });
    }
  }

  return options;
}

/**
 * Check if an activation condition is met based on the player's battlefield
 * Examples: "you control a mountain or a plains", "you control an island"
 */
function checkActivationCondition(
  condition: string,
  state: GameState,
  playerId: PlayerId,
): boolean {
  const battlefieldZone = state.zones.get(`${playerId}-battlefield`);
  if (!battlefieldZone) return false;

  const playerLands = battlefieldZone.cardIds
    .map((id) => state.cards.get(id))
    .filter((card): card is NonNullable<typeof card> => {
      if (!card) return false;
      const typeLine = card.cardData.type_line?.toLowerCase() || "";
      return typeLine.includes("land") && !card.isTapped;
    });

  const lowerCondition = condition.toLowerCase();

  const basicLandTypes = ["plains", "island", "swamp", "mountain", "forest"];
  for (const landType of basicLandTypes) {
    if (lowerCondition.includes(landType)) {
      const hasLandType = playerLands.some((card) => {
        const typeLine = card.cardData.type_line?.toLowerCase() || "";
        return (
          typeLine.includes(landType) ||
          card.chosenBasicLandType?.toLowerCase() === landType
        );
      });
      if (hasLandType) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Filter options based on activation conditions
 */
function filterAvailableOptions(
  options: ManaAbilityOption[],
  state: GameState,
  playerId: PlayerId,
): ManaAbilityOption[] {
  return options.filter((option) => {
    if (!option.activationCondition) return true;
    return checkActivationCondition(
      option.activationCondition,
      state,
      playerId,
    );
  });
}

/**
 * Activate a mana ability (e.g., Birds of Paradise, Sol Ring)
 * Mana abilities don't use the stack and resolve immediately.
 * For multi-option lands, returns the available options so the UI can ask the player.
 */
export function activateManaAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  _abilityIndex: number,
  chosenOption?: ManaAbilityOption,
): { success: boolean; state: GameState; options?: ManaAbilityOption[] } {
  const card = state.cards.get(cardId);
  if (!card) {
    return { success: false, state };
  }

  // Check if player has priority
  if (state.priorityPlayerId !== playerId) {
    return { success: false, state };
  }

  // Already tapped — can't activate again
  if (card.isTapped) {
    return { success: false, state };
  }

  // Parse what mana this land can produce
  const oracleText = card.cardData.oracle_text || "";
  const options = parseManaAbility(oracleText);

  if (options.length === 0) {
    return { success: false, state };
  }

  // Filter options based on activation conditions
  const availableOptions = filterAvailableOptions(options, state, playerId);

  // If no options available after filtering, can't activate
  if (availableOptions.length === 0) {
    return { success: false, state };
  }

  // If multiple options and no choice provided, return filtered options for UI selection
  if (availableOptions.length > 1 && !chosenOption) {
    return { success: true, state, options: availableOptions };
  }

  // Apply the chosen option (or the only available option)
  const option = chosenOption || availableOptions[0];

  // Validate the chosen option's condition if it has one
  if (option.activationCondition) {
    const conditionMet = checkActivationCondition(
      option.activationCondition,
      state,
      playerId,
    );
    if (!conditionMet) {
      return { success: false, state };
    }
  }

  let newState = addMana(state, playerId, option.mana);

  // Tap the land
  const updatedCards = new Map(newState.cards);
  updatedCards.set(cardId, { ...card, isTapped: true });
  newState = { ...newState, cards: updatedCards, lastModifiedAt: Date.now() };

  // Mark that this player has activated a mana ability
  const updatedPlayers = new Map(newState.players);
  const player = updatedPlayers.get(playerId);
  if (player) {
    updatedPlayers.set(playerId, {
      ...player,
      hasActivatedManaAbility: true,
    });
  }

  return {
    success: true,
    state: {
      ...newState,
      players: updatedPlayers,
    },
  };
}

/**
 * Check if a card is a mana ability
 * Mana abilities produce mana and don't use the stack
 */
export function isManaAbility(
  _cardId: CardInstanceId,
  abilityText: string,
): boolean {
  // Check if the ability produces mana
  const lowerText = abilityText.toLowerCase();

  const producesMana =
    lowerText.includes("{w}") ||
    lowerText.includes("{u}") ||
    lowerText.includes("{b}") ||
    lowerText.includes("{r}") ||
    lowerText.includes("{g}") ||
    lowerText.includes("{c}") ||
    lowerText.includes("add ") ||
    lowerText.includes("produces");

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
export function resetLandPlays(
  state: GameState,
  playerId: PlayerId,
): GameState {
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
  maxLands: number,
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
  amount: number = 1,
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
export function getSpellManaCost(card: { mana_cost?: string }): {
  generic: number;
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  hasX: boolean;
} {
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
  green: number;
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
