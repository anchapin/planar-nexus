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
 * Query a single cell of the (commander, opponent) damage matrix (CR 903.9a).
 *
 * Returns the cumulative combat damage that `commanderId` has dealt to
 * `opponentId`. This is the canonical per-commander-per-opponent lookup — the
 * matrix is distributed across the receivers' `commanderDamage` maps (each
 * opponent independently tallies damage from every commander that has hit
 * them), and this accessor reads the relevant cell directly.
 *
 * Use {@link getCommanderDamageMatrix} to obtain the full matrix.
 */
export function getCommanderDamageToOpponent(
  state: GameState,
  commanderId: CardInstanceId,
  opponentId: PlayerId,
): number {
  const opponent = state.players.get(opponentId);
  if (!opponent) return 0;

  const cell = opponent.commanderDamage.get(commanderId);
  return typeof cell === "number" && Number.isFinite(cell) ? cell : 0;
}

/**
 * Build the full (commander, opponent) damage matrix (CR 903.9a, issue #977).
 *
 * Returns `Map<CardInstanceId, Map<PlayerId, number>>` where the outer key is
 * the source commander, the inner key is the opponent (receiver) the commander
 * dealt combat damage to, and the value is the cumulative damage. This is the
 * same shape declared by {@link CommanderDamageState.damageByCommander}, and is
 * the source of truth for "damage from commander X to opponent Y".
 *
 * The matrix is derived from the distributed per-player `commanderDamage`
 * maps (receiver-side), which {@link dealCommanderDamage} writes to. Only
 * commanders that have dealt damage to at least one opponent appear as outer
 * keys.
 */
export function getCommanderDamageMatrix(
  state: GameState,
): Map<CardInstanceId, Map<PlayerId, number>> {
  const matrix = new Map<CardInstanceId, Map<PlayerId, number>>();

  for (const [opponentId, opponent] of state.players) {
    for (const [commanderId, damage] of opponent.commanderDamage) {
      if (typeof damage !== "number" || !Number.isFinite(damage)) {
        continue;
      }
      let row = matrix.get(commanderId);
      if (!row) {
        row = new Map<PlayerId, number>();
        matrix.set(commanderId, row);
      }
      row.set(opponentId, damage);
    }
  }

  return matrix;
}

/**
 * Get total commander damage dealt to a player across ALL commanders
 *
 * `Player.commanderDamage` is a `Map<CardInstanceId, number>` keyed by the
 * source commander (see `dealCommanderDamage`/`registerCommander`), where each
 * value is the cumulative combat damage that single commander has dealt to the
 * target player. This function sums every entry, giving the total commander
 * damage the target has taken from all opponents' commanders combined.
 *
 * Note: This sum is informational/display-oriented. The 21-damage loss
 * threshold is per individual commander (CR 903.9a), NOT the sum returned here.
 * Use {@link hasLostFromCommanderDamage} to check the loss condition.
 */
export function getTotalCommanderDamage(
  state: GameState,
  targetPlayerId: PlayerId,
): number {
  const targetPlayer = state.players.get(targetPlayerId);
  if (!targetPlayer) return 0;

  // Map<CardInstanceId, number> — sum damage from every commander that has
  // dealt combat damage to this player. Guard against malformed entries.
  let total = 0;
  for (const damage of targetPlayer.commanderDamage.values()) {
    if (typeof damage === "number" && Number.isFinite(damage)) {
      total += damage;
    }
  }
  return total;
}

/**
 * Check if a player has lost from commander damage (CR 903.9a)
 *
 * Returns true when ANY single commander has dealt `damageThreshold` (default
 * 21) or more cumulative combat damage to `playerId`. The threshold is checked
 * per-commander — damage from different commanders is NOT summed for the loss
 * check (e.g., 10 from commander A + 11 from commander B does NOT cause a
 * loss; both must independently reach 21).
 */
export function hasLostFromCommanderDamage(
  state: GameState,
  playerId: PlayerId,
): boolean {
  const player = state.players.get(playerId);
  if (!player) return false;

  // Map<CardInstanceId, number> — check each commander's cumulative damage
  // against the threshold independently.
  for (const damage of player.commanderDamage.values()) {
    if (
      typeof damage === "number" &&
      damage >= DEFAULT_COMMANDER_DAMAGE_THRESHOLD
    ) {
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
 * Get full commander damage summary for a game (issue #977).
 *
 * Builds the per-owner summary from the (commander, opponent) damage matrix
 * (see {@link getCommanderDamageMatrix}). Each entry represents a player who
 * owns one or more commanders, listing — for each of their commanders — the
 * damage it dealt to every opponent, plus that commander's total. Commanders
 * are attributed to their controller (falling back to owner), matching the
 * attribution used by {@link dealCommanderDamage}. Only commanders that have
 * actually dealt damage appear.
 */
export function getCommanderDamageSummary(
  state: GameState,
): CommanderDamageSummary[] {
  const matrix = getCommanderDamageMatrix(state);

  const owners = new Map<PlayerId, CommanderDamageSummary>();

  for (const [commanderId, opponents] of matrix) {
    const commander = state.cards.get(commanderId);
    const ownerId: PlayerId | undefined =
      commander?.controllerId || commander?.ownerId;

    if (ownerId === undefined) {
      continue;
    }

    const owner = state.players.get(ownerId);
    if (!owner) {
      continue;
    }

    let summary = owners.get(ownerId);
    if (!summary) {
      summary = {
        playerId: ownerId,
        playerName: owner.name,
        commanders: [],
        totalDamageDealt: 0,
      };
      owners.set(ownerId, summary);
    }

    const damageToOpponents = new Map<PlayerId, number>();
    let totalDamage = 0;
    for (const [opponentId, damage] of opponents) {
      damageToOpponents.set(opponentId, damage);
      totalDamage += damage;
    }

    summary.commanders.push({
      commanderId,
      commanderName: commander?.cardData.name || "Unknown Commander",
      damageToOpponents,
      totalDamage,
    });
    summary.totalDamageDealt += totalDamage;
  }

  return Array.from(owners.values());
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
