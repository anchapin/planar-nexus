/**
 * Commander Damage Tracking System
 *
 * Implements commander damage tracking as defined in MTG Commander rules.
 * Reference: CR 903 - Commander
 *
 * Features:
 * - Track commander damage from each commander to each opponent
 * - 21+ damage from a single commander = loss condition
 * - Commander identity tracking (color identity)
 * - Command zone state management
 */

import type {
  GameState,
  PlayerId,
  CardInstanceId,
  CardInstance,
  Player,
} from "./types";

/**
 * Commander damage tracking state
 */
export interface CommanderDamageState {
  /** Map of commander ID to damage dealt to each opponent */
  damageByCommander: Map<CardInstanceId, Map<PlayerId, number>>;
  /** Map of player ID to their commanders */
  playerCommanders: Map<PlayerId, CardInstanceId[]>;
  /** Damage threshold for losing (default 21 for Commander) */
  damageThreshold: number;
}

/**
 * Result of dealing commander damage
 */
export interface CommanderDamageResult {
  success: boolean;
  state: GameState;
  descriptions: string[];
  playerLost?: PlayerId;
  lossReason?: string;
}

/**
 * Default commander damage threshold
 */
export const DEFAULT_COMMANDER_DAMAGE_THRESHOLD = 21;

/**
 * Create initial commander damage state
 */
export function createCommanderDamageState(): CommanderDamageState {
  return {
    damageByCommander: new Map(),
    playerCommanders: new Map(),
    damageThreshold: DEFAULT_COMMANDER_DAMAGE_THRESHOLD,
  };
}

/**
 * Check if a card is a commander (legendary planeswalker or creature with Commander)
 */
export function isCommander(card: CardInstance): boolean {
  const typeLine = card.cardData.type_line?.toLowerCase() || "";

  // Check if it's a legendary planeswalker or creature
  const isLegendary = typeLine.includes("legendary");
  const isPlaneswalker = typeLine.includes("planeswalker");
  const isCreature = typeLine.includes("creature");

  // In Commander format, legendary creatures and planeswalkers can be commanders
  return isLegendary && (isPlaneswalker || isCreature);
}

/**
 * Get commander identity (colors) from a commander card
 */
export function getCommanderIdentity(card: CardInstance): string[] {
  // Get color identity from card
  const colors = card.cardData.colors || [];

  // Also check mana cost for color identity
  const manaCost = card.cardData.mana_cost || "";
  const identityFromCost: string[] = [];

  if (manaCost.includes("W") || manaCost.includes("{W}"))
    identityFromCost.push("white");
  if (manaCost.includes("U") || manaCost.includes("{U}"))
    identityFromCost.push("blue");
  if (manaCost.includes("B") || manaCost.includes("{B}"))
    identityFromCost.push("black");
  if (manaCost.includes("R") || manaCost.includes("{R}"))
    identityFromCost.push("red");
  if (manaCost.includes("G") || manaCost.includes("{G}"))
    identityFromCost.push("green");

  // Combine and deduplicate
  const combined = [...new Set([...colors, ...identityFromCost])];
  return combined;
}

/**
 * Register a commander for a player.
 *
 * Commander damage is tracked on each opponent (the receiver of combat damage),
 * keyed by commanderId. Initialize this commander's tally to 0 for every opponent
 * so subsequent combat damage accumulates correctly (CR 903.9a).
 */
export function registerCommander(
  state: GameState,
  playerId: PlayerId,
  commanderId: CardInstanceId,
): GameState {
  const player = state.players.get(playerId);

  if (!player) {
    return state;
  }

  const updatedPlayers = new Map(state.players);
  for (const [opponentId, opponent] of state.players) {
    if (opponentId === playerId) {
      continue;
    }
    const updatedDamage = new Map(opponent.commanderDamage);
    if (!updatedDamage.has(commanderId)) {
      updatedDamage.set(commanderId, 0);
    }
    updatedPlayers.set(opponentId, {
      ...opponent,
      commanderDamage: updatedDamage,
    });
  }

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Deal commander damage
 *
 * When a commander deals combat damage to a player, the damage accumulates on the
 * RECEIVER (keyed by commanderId). 21+ cumulative combat damage from the same
 * commander causes that player to lose the game (CR 903.9a).
 *
 * Life loss is handled separately by the combat system; this function only tracks
 * the commander-damage tally and the resulting loss condition.
 */
export function dealCommanderDamage(
  state: GameState,
  commanderId: CardInstanceId,
  targetPlayerId: PlayerId,
  damage: number,
): CommanderDamageResult {
  const descriptions: string[] = [];
  let playerLost: PlayerId | undefined;
  let lossReason: string | undefined;

  const commander = state.cards.get(commanderId);
  if (!commander) {
    return {
      success: false,
      state,
      descriptions: ["Commander not found"],
    };
  }

  if (!isCommander(commander)) {
    return {
      success: false,
      state,
      descriptions: ["Card is not a commander"],
    };
  }

  const commanderOwnerId: PlayerId =
    commander.controllerId || commander.ownerId;

  const targetPlayer = state.players.get(targetPlayerId);
  if (!targetPlayer) {
    return {
      success: false,
      state,
      descriptions: ["Target player not found"],
    };
  }

  const currentDamage = targetPlayer.commanderDamage.get(commanderId) || 0;
  const newDamage = currentDamage + damage;

  const updatedTargetDamage = new Map(targetPlayer.commanderDamage);
  updatedTargetDamage.set(commanderId, newDamage);

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(targetPlayerId, {
    ...targetPlayer,
    commanderDamage: updatedTargetDamage,
  });

  descriptions.push(
    `${commander.cardData.name} deals ${damage} commander damage to ${targetPlayer.name} (total: ${newDamage})`,
  );

  if (newDamage >= DEFAULT_COMMANDER_DAMAGE_THRESHOLD) {
    playerLost = targetPlayerId;
    lossReason = `${commander.cardData.name} has dealt ${newDamage} commander damage (21+)`;
    descriptions.push(
      `${targetPlayer.name} loses the game due to commander damage!`,
    );
    const losingPlayer = updatedPlayers.get(playerLost)!;
    updatedPlayers.set(playerLost, {
      ...losingPlayer,
      hasLost: true,
      lossReason,
    });
  }

  const finalState = checkCommanderWinCondition(
    { ...state, players: updatedPlayers },
    commanderOwnerId,
  );

  return {
    success: true,
    state: finalState,
    descriptions,
    playerLost,
    lossReason,
  };
}

/**
 * Get commander damage for a player from a specific commander
 */
export function getCommanderDamage(
  state: GameState,
  playerId: PlayerId,
  commanderId: CardInstanceId,
): number {
  const player = state.players.get(playerId);
  if (!player) return 0;

  return player.commanderDamage.get(commanderId) || 0;
}

/**
 * Get total commander damage to a player from all commanders
 *
 * Sums up all commander damage dealt to a target player across all commanders.
 * Commander damage is tracked per-commander on the target player's state.
 */
export function getTotalCommanderDamage(
  state: GameState,
  targetPlayerId: PlayerId,
): number {
  const targetPlayer = state.players.get(targetPlayerId);
  if (!targetPlayer) return 0;

  // Sum all commander damage tracked against this player
  let total = 0;
  for (const [, damage] of targetPlayer.commanderDamage) {
    total += damage;
  }
  return total;
}

/**
 * Check if a player has lost from commander damage
 */
export function hasLostFromCommanderDamage(
  state: GameState,
  playerId: PlayerId,
): boolean {
  const player = state.players.get(playerId);
  if (!player) return false;

  // Check all commanders' damage against this player
  for (const [, damage] of player.commanderDamage) {
    if (damage >= DEFAULT_COMMANDER_DAMAGE_THRESHOLD) {
      return true;
    }
  }

  return false;
}

/**
 * Check win condition for commander format
 */
function checkCommanderWinCondition(
  state: GameState,
  winningPlayerId: PlayerId,
): GameState {
  // Count players who haven't lost
  const activePlayers = Array.from(state.players.values()).filter(
    (p) => !p.hasLost,
  );

  // If only one player remains, they win
  if (activePlayers.length === 1) {
    return {
      ...state,
      status: "completed",
      winners: [winningPlayerId],
      endReason: "All opponents defeated via commander damage",
      lastModifiedAt: Date.now(),
    };
  }

  return state;
}

/**
 * Reset commander damage (for new game)
 */
export function resetCommanderDamage(state: GameState): GameState {
  const updatedPlayers = new Map<PlayerId, Player>();

  for (const [playerId, player] of state.players) {
    // Reset all commander damage to 0
    const resetDamage = new Map<PlayerId, number>();
    for (const [commanderId] of player.commanderDamage) {
      resetDamage.set(commanderId, 0);
    }

    updatedPlayers.set(playerId, {
      ...player,
      commanderDamage: resetDamage,
    });
  }

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Reset commander damage dealt by a single commander (e.g. when that commander
 * changes zones or is replaced). Clears the tally tracked against every receiver.
 */
export function resetCommanderDamageFromCommander(
  state: GameState,
  commanderId: CardInstanceId,
): GameState {
  const updatedPlayers = new Map<PlayerId, Player>();

  for (const [playerId, player] of state.players) {
    if (player.commanderDamage.has(commanderId)) {
      const updatedDamage = new Map(player.commanderDamage);
      updatedDamage.set(commanderId, 0);
      updatedPlayers.set(playerId, {
        ...player,
        commanderDamage: updatedDamage,
      });
    } else {
      updatedPlayers.set(playerId, player);
    }
  }

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Get commander damage summary for display
 */
export interface CommanderDamageSummary {
  playerId: PlayerId;
  playerName: string;
  commanders: {
    commanderId: CardInstanceId;
    commanderName: string;
    damageToOpponents: Map<PlayerId, number>;
    totalDamage: number;
  }[];
  totalDamageDealt: number;
}

/**
 * Get full commander damage summary for a game
 */
export function getCommanderDamageSummary(
  state: GameState,
): CommanderDamageSummary[] {
  const summaries: CommanderDamageSummary[] = [];

  for (const [playerId, player] of state.players) {
    const commanders: CommanderDamageSummary["commanders"] = [];
    let totalDamageDealt = 0;

    for (const [commanderId, damage] of player.commanderDamage) {
      const commander = state.cards.get(commanderId);

      const damageToOpponents = new Map<PlayerId, number>();
      damageToOpponents.set(playerId, damage);

      commanders.push({
        commanderId,
        commanderName: commander?.cardData.name || "Unknown Commander",
        damageToOpponents,
        totalDamage: damage,
      });

      totalDamageDealt += damage;
    }

    summaries.push({
      playerId,
      playerName: player.name,
      commanders,
      totalDamageDealt,
    });
  }

  return summaries;
}

/**
 * Check if a player can cast their commander (color identity check)
 */
export function canCastCommander(
  commanderColors: string[],
  availableColors: string[],
): boolean {
  // All commander colors must be available
  return commanderColors.every((color) => availableColors.includes(color));
}

/**
 * Get opponents who have lost from commander damage
 */
export function getPlayersLostFromCommanderDamage(
  state: GameState,
): PlayerId[] {
  const lostPlayers: PlayerId[] = [];

  for (const [playerId, player] of state.players) {
    if (player.hasLost && player.lossReason?.includes("commander")) {
      lostPlayers.push(playerId);
    }
  }

  return lostPlayers;
}
