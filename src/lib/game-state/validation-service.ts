import type { GameState, GameAction, PlayerId, ActionType, Phase } from "./types";

/**
 * Validation result structure
 */
export interface ValidationResult {
  isValid: boolean;
  reason?: string;
}

/**
 * Service for validating game actions against the current state and rules.
 * Issue #563: Action Validation and Rule Enforcement
 */
export class ValidationService {
  /**
   * Main validation entry point
   */
  public static validateAction(state: GameState, action: GameAction): ValidationResult {
    // 1. Basic player checks
    const player = state.players.get(action.playerId);
    if (!player) {
      return { isValid: false, reason: "Player not found" };
    }

    if (player.hasLost) {
      return { isValid: false, reason: "Player has already lost" };
    }

    if (state.status !== "in_progress") {
      return { isValid: false, reason: "Game is not in progress" };
    }

    // 2. Priority check
    if (!this.hasPriority(state, action)) {
      return { isValid: false, reason: "Player does not have priority" };
    }

    // 3. Action-specific validation
    switch (action.type) {
      case "play_land":
        return this.validatePlayLand(state, action);
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
      default:
        // By default, actions are considered valid if priority is correct
        // but a real engine should have strict rules for every type
        return { isValid: true };
    }
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
   */
  private static validatePlayLand(state: GameState, action: GameAction): ValidationResult {
    const player = state.players.get(action.playerId)!;

    // Must be active player's turn
    if (state.turn.activePlayerId !== action.playerId) {
      return { isValid: false, reason: "Cannot play lands on other players' turns" };
    }

    // Must be a main phase
    if (state.turn.currentPhase !== "precombat_main" && state.turn.currentPhase !== "postcombat_main") {
      return { isValid: false, reason: "Lands can only be played during a main phase" };
    }

    // Stack must be empty
    if (state.stack.length > 0) {
      return { isValid: false, reason: "Lands can only be played when the stack is empty" };
    }

    // Must have land plays remaining
    if (player.landsPlayedThisTurn >= player.maxLandsPerTurn) {
      return { isValid: false, reason: `Already played ${player.landsPlayedThisTurn}/${player.maxLandsPerTurn} lands this turn` };
    }

    return { isValid: true };
  }

  /**
   * Validate "cast_spell" action
   */
  private static validateCastSpell(state: GameState, action: GameAction): ValidationResult {
    // In a real implementation, we'd check:
    // 1. If the card is in the player's hand
    // 2. If they have enough mana
    // 3. Timing restrictions (instant vs sorcery)
    
    // For now, simple mana check placeholder
    const data = action.data as any;
    const cardId = data.cardId as string;
    if (!cardId) {
      return { isValid: false, reason: "No card specified" };
    }

    const card = state.cards.get(cardId);
    if (!card) {
      return { isValid: false, reason: "Card not found" };
    }

    // Timing check
    const isInstant = card.cardData.type_line.includes("Instant") || 
                     card.cardData.oracle_text?.toLowerCase().includes("flash");
    
    if (!isInstant) {
      if (state.turn.activePlayerId !== action.playerId) {
        return { isValid: false, reason: "Sorcery-speed spells can only be cast on your turn" };
      }
      if (state.turn.currentPhase !== "precombat_main" && state.turn.currentPhase !== "postcombat_main") {
        return { isValid: false, reason: "Sorcery-speed spells can only be cast during a main phase" };
      }
      if (state.stack.length > 0) {
        return { isValid: false, reason: "Sorcery-speed spells can only be cast when the stack is empty" };
      }
    }

    return { isValid: true };
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
      return { isValid: false, reason: "Not currently in the Declare Blockers step" };
    }

    if (state.turn.activePlayerId === action.playerId) {
      return { isValid: false, reason: "The active player cannot declare blockers" };
    }

    return { isValid: true };
  }
}
