import { GameState, CardState, PlayerState } from '@/types/game';
import { GameModeConfig, getGameMode } from '@/lib/game-rules';

export interface ValidationResult {
  isValid: boolean;
  message?: string;
}

export class ValidationService {
  /**
   * Validates if a player can play a land.
   * Rule: One land per turn (unless modified by game mode), 
   * and only during main phases when the player has priority and the stack is empty.
   */
  static canPlayLand(gameState: GameState, playerId: string, cardId: string, modeId?: string): ValidationResult {
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) return { isValid: false, message: "Player not found." };

    // Get game mode config for rule modifications
    const modeConfig = modeId ? getGameMode(modeId) : undefined;
    const maxLandsPerTurn = (modeConfig as any)?.maxLandsPerTurn || 1;

    // Check if it's the player's turn
    if (!player.isCurrentTurn) {
      return { isValid: false, message: "It is not your turn." };
    }

    // Check if player has priority
    if (!player.hasPriority) {
      return { isValid: false, message: "You do not have priority." };
    }

    // Check phase (must be precombat_main or postcombat_main)
    if (gameState.currentPhase !== 'precombat_main' && gameState.currentPhase !== 'postcombat_main') {
      return { isValid: false, message: "Lands can only be played during main phases." };
    }

    // Check if stack is empty
    if (gameState.stack.length > 0) {
      return { isValid: false, message: "You can only play a land when the stack is empty." };
    }

    // Check if the card is in hand and is a land
    const card = player.hand.find(c => c.id === cardId);
    if (!card) return { isValid: false, message: "Card not in hand." };
    
    const isLand = card.card.type_line.toLowerCase().includes('land');
    if (!isLand) return { isValid: false, message: "Card is not a land." };

    // Check lands per turn rule
    if (player.landsPlayedThisTurn >= maxLandsPerTurn) {
      return { 
        isValid: false, 
        message: maxLandsPerTurn > 1 
          ? `You have already played your limit of ${maxLandsPerTurn} lands this turn.`
          : "You have already played a land this turn." 
      };
    }

    return { isValid: true };
  }

  /**
   * Validates if a player can cast a spell or activate an ability.
   * Checks for priority, mana costs, and timing rules.
   */
  static canCastSpell(gameState: GameState, playerId: string, cardId: string): ValidationResult {
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) return { isValid: false, message: "Player not found." };

    // Check if player has priority
    if (!player.hasPriority) {
      return { isValid: false, message: "You do not have priority." };
    }

    const card = player.hand.find(c => c.id === cardId);
    if (!card) return { isValid: false, message: "Card not in hand." };

    // Check mana costs
    const hasEnoughMana = this.checkManaCost(gameState, player, card);
    if (!hasEnoughMana) {
      return { isValid: false, message: "Not enough mana to cast this spell." };
    }

    // Check timing rules (Sorcery vs Instant)
    const isInstant = card.card.type_line.toLowerCase().includes('instant') || 
                      (card.card.oracle_text?.toLowerCase().includes('flash'));
    
    if (!isInstant) {
      if (!player.isCurrentTurn) {
        return { isValid: false, message: "You can only cast this during your turn." };
      }
      if (gameState.currentPhase !== 'precombat_main' && gameState.currentPhase !== 'postcombat_main') {
        return { isValid: false, message: "You can only cast this during a main phase." };
      }
      if (gameState.stack.length > 0) {
        return { isValid: false, message: "You can only cast this when the stack is empty." };
      }
    }

    return { isValid: true };
  }

  /**
   * Checks if player has enough mana to cast the card.
   * Considers untapped lands and other mana sources.
   */
  private static checkManaCost(_gameState: GameState, player: PlayerState, card: CardState): boolean {
    const cmc = card.card.cmc || 0;
    
    // Simple mana validation: count untapped lands and permanents
    const untappedSources = player.battlefield.filter(c => 
      !c.tapped && (
        c.card.type_line.toLowerCase().includes('land') ||
        c.card.oracle_text?.toLowerCase().includes('add {')
      )
    ).length;

    return untappedSources >= cmc;
  }
}
