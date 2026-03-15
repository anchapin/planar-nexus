import type { GameState, GameAction, CardInstance, Player } from "./types";
import { getGameMode } from "@/lib/game-rules";

/**
 * Validation result structure
 */
export interface ValidationResult {
  isValid: boolean;
  reason?: string;
  message?: string; // For UI display
}

/**
 * Service for validating game actions against the current state and rules.
 * Issue #563: Action Validation and Rule Enforcement
 *
 * This service provides comprehensive validation for all game actions,
 * enforcing rules from GameModeConfig and the game state.
 */
export class ValidationService {
  /**
   * Main validation entry point
   * Validates any game action against the current state and rules
   */
  public static validateAction(state: GameState, action: GameAction, modeId?: string): ValidationResult {
    // 1. Basic player checks
    const player = state.players.get(action.playerId);
    if (!player) {
      return { isValid: false, reason: "Player not found", message: "Player not found." };
    }

    if (player.hasLost) {
      return { isValid: false, reason: "Player has already lost", message: "You have lost the game and cannot take actions." };
    }

    if (state.status !== "in_progress") {
      return { isValid: false, reason: "Game is not in progress", message: "Game is not in progress." };
    }

    // 2. Priority check (some actions don't require priority)
    if (!this.hasPriority(state, action)) {
      return { isValid: false, reason: "Player does not have priority", message: "You do not have priority." };
    }

    // 3. Action-specific validation
    switch (action.type) {
      case "play_land":
        return this.validatePlayLand(state, action, modeId);
      case "cast_spell":
        return this.validateCastSpell(state, action);
      case "activate_ability":
        return this.validateActivateAbility(state, action);
      case "pass_priority":
        return { isValid: true }; // Already checked priority above
      case "declare_attackers":
        return this.validateDeclareAttackers(state, action);
      case "declare_blockers":
        return this.validateDeclareBlockers(state, action);
      case "tap_card":
      case "untap_card":
        return this.validateTapUntap(state, action);
      default:
        // By default, actions are considered valid if priority is correct
        // but a real engine should have strict rules for every type
        return { isValid: true };
    }
  }

  /**
   * Get the maximum lands per turn from game mode config or player state
   */
  private static getMaxLandsPerTurn(state: GameState, playerId: string, modeId?: string): number {
    const player = state.players.get(playerId);
    if (!player) return 1;

    // Check game mode config first
    if (modeId) {
      const gameMode = getGameMode(modeId);
      if (gameMode && (gameMode as any).maxLandsPerTurn !== undefined) {
        return (gameMode as any).maxLandsPerTurn;
      }
    }

    // Fall back to player's maxLandsPerTurn (can be modified by effects)
    return player.maxLandsPerTurn || 1;
  }

  /**
   * Check if the player has priority
   */
  private static hasPriority(state: GameState, action: GameAction): boolean {
    // Some actions don't require priority (concede, etc.)
    if (action.type === "concede" || action.type === "undo") {
      return true;
    }

    // During special phases like Declare Attackers/Blockers, 
    // certain actions are part of the turn structure, not priority-based.
    if (action.type === "declare_attackers" && state.turn.currentPhase === "declare_attackers") {
      return state.turn.activePlayerId === action.playerId;
    }

    if (action.type === "declare_blockers" && state.turn.currentPhase === "declare_blockers") {
      // In MTG, the defending player declares blockers
      // For simplicity, we check if they are being attacked (this would need more logic in multiplayer)
      return state.turn.activePlayerId !== action.playerId; 
    }

    return state.priorityPlayerId === action.playerId;
  }

  /**
   * Validate "play_land" action
   * Enforces the "One land per turn" rule (configurable via GameModeConfig)
   */
  private static validatePlayLand(state: GameState, action: GameAction, modeId?: string): ValidationResult {
    const player = state.players.get(action.playerId);
    if (!player) {
      return { isValid: false, reason: "Player not found", message: "Player not found." };
    }

    // Must be active player's turn
    if (state.turn.activePlayerId !== action.playerId) {
      return { isValid: false, reason: "Not your turn", message: "You can only play lands during your turn." };
    }

    // Must have priority
    if (state.priorityPlayerId !== action.playerId) {
      return { isValid: false, reason: "No priority", message: "You do not have priority." };
    }

    // Must be a main phase
    if (state.turn.currentPhase !== "precombat_main" && state.turn.currentPhase !== "postcombat_main") {
      return { isValid: false, reason: "Wrong phase", message: "Lands can only be played during a main phase." };
    }

    // Stack must be empty
    if (state.stack.length > 0) {
      return { isValid: false, reason: "Stack not empty", message: "You can only play a land when the stack is empty." };
    }

    // Get max lands per turn from game mode config
    const maxLandsPerTurn = this.getMaxLandsPerTurn(state, action.playerId, modeId);

    // Must have land plays remaining (enforces "One land per turn" rule)
    if (player.landsPlayedThisTurn >= maxLandsPerTurn) {
      return {
        isValid: false,
        reason: "Land limit reached",
        message: maxLandsPerTurn > 1
          ? `You have already played your limit of ${maxLandsPerTurn} lands this turn.`
          : "You have already played a land this turn."
      };
    }

    // Verify the card is in player's hand and is a land
    const data = action.data as { cardId?: string };
    const cardId = data.cardId;
    if (!cardId) {
      return { isValid: false, reason: "No card specified", message: "No card specified." };
    }

    const handZone = state.zones.get(`${action.playerId}-hand`);
    if (!handZone || !handZone.cardIds.includes(cardId)) {
      return { isValid: false, reason: "Card not in hand", message: "Card is not in your hand." };
    }

    const card = state.cards.get(cardId);
    if (!card) {
      return { isValid: false, reason: "Card not found", message: "Card not found." };
    }

    const typeLine = card.cardData.type_line?.toLowerCase() || "";
    if (!typeLine.includes("land")) {
      return { isValid: false, reason: "Not a land", message: "Card is not a land." };
    }

    return { isValid: true };
  }

  /**
   * Validate "cast_spell" action
   * Validates mana costs, timing rules, and priority
   */
  private static validateCastSpell(state: GameState, action: GameAction): ValidationResult {
    const player = state.players.get(action.playerId);
    if (!player) {
      return { isValid: false, reason: "Player not found", message: "Player not found." };
    }

    // Get the card
    const data = action.data as { cardId?: string };
    const cardId = data.cardId;
    if (!cardId) {
      return { isValid: false, reason: "No card specified", message: "No card specified." };
    }

    const card = state.cards.get(cardId);
    if (!card) {
      return { isValid: false, reason: "Card not found", message: "Card not found." };
    }

    // Verify the card is in player's hand
    const handZone = state.zones.get(`${action.playerId}-hand`);
    if (!handZone || !handZone.cardIds.includes(cardId)) {
      return { isValid: false, reason: "Card not in hand", message: "Card is not in your hand." };
    }

    // Validate mana costs are paid (check player has enough mana)
    const manaValidation = this.validateManaCost(state, player, card);
    if (!manaValidation.isValid) {
      return manaValidation;
    }

    // Check timing rules (Sorcery vs Instant)
    const typeLine = card.cardData.type_line?.toLowerCase() || "";
    const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
    const isInstant = typeLine.includes("instant");
    const hasFlash = oracleText.includes("flash");

    // Sorcery-speed spells have additional restrictions
    if (!isInstant && !hasFlash) {
      // Must be your turn
      if (state.turn.activePlayerId !== action.playerId) {
        return { isValid: false, reason: "Not your turn", message: "You can only cast this during your turn." };
      }

      // Must be a main phase
      if (state.turn.currentPhase !== "precombat_main" && state.turn.currentPhase !== "postcombat_main") {
        return { isValid: false, reason: "Wrong phase", message: "You can only cast this during a main phase." };
      }

      // Stack must be empty
      if (state.stack.length > 0) {
        return { isValid: false, reason: "Stack not empty", message: "You can only cast this when the stack is empty." };
      }
    }

    return { isValid: true };
  }

  /**
   * Validate that a player has enough mana to cast a spell
   */
  private static validateManaCost(
    state: GameState,
    player: Player,
    card: CardInstance
  ): ValidationResult {
    const cmc = card.cardData.cmc || 0;
    const manaCost = card.cardData.mana_cost || "";

    // Parse the mana cost to get colored requirements
    const coloredCost = this.parseColoredManaCost(manaCost);

    const pool = player.manaPool;

    // Check colored mana requirements
    if (pool.white < coloredCost.white ||
        pool.blue < coloredCost.blue ||
        pool.black < coloredCost.black ||
        pool.red < coloredCost.red ||
        pool.green < coloredCost.green) {
      return { isValid: false, reason: "Not enough colored mana", message: "Not enough colored mana to cast this spell." };
    }

    // Calculate total mana available for generic cost
    const totalColored = pool.white + pool.blue + pool.black + pool.red + pool.green;
    const neededColored = coloredCost.white + coloredCost.blue + coloredCost.black + coloredCost.red + coloredCost.green;
    const availableForGeneric = pool.generic + (totalColored - neededColored) + pool.colorless;

    if (availableForGeneric < coloredCost.generic) {
      return { isValid: false, reason: "Not enough mana", message: "Not enough mana to cast this spell." };
    }

    return { isValid: true };
  }

  /**
   * Parse a mana cost string to extract colored mana requirements
   */
  private static parseColoredManaCost(manaCost: string): {
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
      // X is handled separately
    }

    return result;
  }

  /**
   * Validate "activate_ability" action
   */
  private static validateActivateAbility(state: GameState, _action: GameAction): ValidationResult {
    // Placeholder for ability activation rules
    return { isValid: true };
  }

  /**
   * Validate "declare_attackers" action
   */
  private static validateDeclareAttackers(state: GameState, action: GameAction): ValidationResult {
    if (state.turn.currentPhase !== "declare_attackers") {
      return { isValid: false, reason: "Not currently in the Declare Attackers step" };
    }

    if (state.turn.activePlayerId !== action.playerId) {
      return { isValid: false, reason: "Only the active player can declare attackers" };
    }

    return { isValid: true };
  }

  /**
   * Validate "declare_blockers" action
   */
  private static validateDeclareBlockers(state: GameState, action: GameAction): ValidationResult {
    if (state.turn.currentPhase !== "declare_blockers") {
      return { isValid: false, reason: "Not currently in the Declare Blockers step", message: "Not currently in the Declare Blockers step." };
    }

    if (state.turn.activePlayerId === action.playerId) {
      return { isValid: false, reason: "The active player cannot declare blockers", message: "The active player cannot declare blockers." };
    }

    return { isValid: true };
  }

  /**
   * Validate "tap_card" or "untap_card" action
   */
  private static validateTapUntap(state: GameState, action: GameAction): ValidationResult {
    const player = state.players.get(action.playerId);
    if (!player) {
      return { isValid: false, reason: "Player not found", message: "Player not found." };
    }

    // Must have priority
    if (state.priorityPlayerId !== action.playerId) {
      return { isValid: false, reason: "No priority", message: "You do not have priority." };
    }

    // Get the card
    const data = action.data as { cardId?: string };
    const cardId = data.cardId;
    if (!cardId) {
      return { isValid: false, reason: "No card specified", message: "No card specified." };
    }

    const card = state.cards.get(cardId);
    if (!card) {
      return { isValid: false, reason: "Card not found", message: "Card not found." };
    }

    // Verify the card is controlled by the player
    if (card.controllerId !== action.playerId) {
      return { isValid: false, reason: "Not your card", message: "You can only tap/untap cards you control." };
    }

    // For tap actions, check if the card is already tapped
    if (action.type === "tap_card" && card.isTapped) {
      return { isValid: false, reason: "Already tapped", message: "This card is already tapped." };
    }

    // For untap actions, check if the card is already untapped
    if (action.type === "untap_card" && !card.isTapped) {
      return { isValid: false, reason: "Already untapped", message: "This card is already untapped." };
    }

    // Check for summoning sickness when tapping a creature
    if (action.type === "tap_card" && card.isTapped === false) {
      const typeLine = card.cardData.type_line?.toLowerCase() || "";
      if (typeLine.includes("creature") && card.hasSummoningSickness) {
        // Creatures with summoning sickness can't be tapped for abilities
        // (Note: This doesn't prevent tapping for costs, which is more complex)
        return { isValid: false, reason: "Summoning sickness", message: "This creature has summoning sickness." };
      }
    }

    return { isValid: true };
  }
}
