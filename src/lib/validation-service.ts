import {
  type GameState,
  type Player,
  type CardInstance,
  isLand,
} from '@/lib/game-state';
import { GameModeConfig, getGameMode } from '@/lib/game-rules';

export interface ValidationResult {
  isValid: boolean;
  message?: string;
  reason?: string; // Added for compatibility with page.tsx
}

export class ValidationService {
  /**
   * Validates if a player can play a land.
   * Rule: One land per turn (unless modified by game mode), 
   * and only during main phases when the player has priority and the stack is empty.
   */
  static canPlayLand(gameState: GameState, playerId: string, cardId: string, modeId?: string): ValidationResult {
    const player = gameState.players.get(playerId);
    if (!player) return { isValid: false, message: "Player not found.", reason: "Player not found." };

    // Get game mode config for rule modifications
    const modeConfig = modeId ? getGameMode(modeId) : undefined;
    const maxLandsPerTurn = (modeConfig as any)?.maxLandsPerTurn || player.maxLandsPerTurn || 1;

    // Check if it's the player's turn
    if (gameState.turn.activePlayerId !== playerId) {
      return { isValid: false, message: "It is not your turn.", reason: "It is not your turn." };
    }

    // Check if player has priority
    if (gameState.priorityPlayerId !== playerId) {
      return { isValid: false, message: "You do not have priority.", reason: "You do not have priority." };
    }

    // Check phase (must be precombat_main or postcombat_main)
    if (gameState.turn.phase !== 'precombat_main' && gameState.turn.phase !== 'postcombat_main') {
      return { isValid: false, message: "Lands can only be played during main phases.", reason: "Lands can only be played during main phases." };
    }

    // Check if stack is empty
    if (gameState.stack.length > 0) {
      return { isValid: false, message: "You can only play a land when the stack is empty.", reason: "You can only play a land when the stack is empty." };
    }

    // Check if the card is in hand and is a land
    const handZone = gameState.zones.get(`${playerId}-hand`);
    if (!handZone || !handZone.cardIds.includes(cardId)) {
      return { isValid: false, message: "Card not in hand.", reason: "Card not in hand." };
    }
    
    const card = gameState.cards.get(cardId);
    if (!card || !isLand(card)) {
      return { isValid: false, message: "Card is not a land.", reason: "Card is not a land." };
    }

    // Check lands per turn rule
    if (player.landsPlayedThisTurn >= maxLandsPerTurn) {
      return { 
        isValid: false, 
        message: maxLandsPerTurn > 1 
          ? `You have already played your limit of ${maxLandsPerTurn} lands this turn.`
          : "You have already played a land this turn.",
        reason: "Already played a land this turn."
      };
    }

    return { isValid: true };
  }

  /**
   * Validates if a player can cast a spell or activate an ability.
   * Checks for priority, mana costs, and timing rules.
   */
  static canCastSpell(gameState: GameState, playerId: string, cardId: string): ValidationResult {
    const player = gameState.players.get(playerId);
    if (!player) return { isValid: false, message: "Player not found.", reason: "Player not found." };

    // Check if player has priority
    if (gameState.priorityPlayerId !== playerId) {
      return { isValid: false, message: "You do not have priority.", reason: "You do not have priority." };
    }

    const handZone = gameState.zones.get(`${playerId}-hand`);
    if (!handZone || !handZone.cardIds.includes(cardId)) {
      return { isValid: false, message: "Card not in hand.", reason: "Card not in hand." };
    }

    const card = gameState.cards.get(cardId);
    if (!card) return { isValid: false, message: "Card not found.", reason: "Card not found." };

    // Check mana costs
    const hasEnoughMana = this.checkManaCost(gameState, player, card);
    if (!hasEnoughMana) {
      return { isValid: false, message: "Not enough mana to cast this spell.", reason: "Not enough mana." };
    }

    // Check timing rules (Sorcery vs Instant)
    const typeLine = card.cardData.type_line?.toLowerCase() || "";
    const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
    const isInstant = typeLine.includes('instant') || oracleText.includes('flash');
    
    if (!isInstant) {
      if (gameState.turn.activePlayerId !== playerId) {
        return { isValid: false, message: "You can only cast this during your turn.", reason: "Not your turn." };
      }
      if (gameState.turn.phase !== 'precombat_main' && gameState.turn.phase !== 'postcombat_main') {
        return { isValid: false, message: "You can only cast this during a main phase.", reason: "Not a main phase." };
      }
      if (gameState.stack.length > 0) {
        return { isValid: false, message: "You can only cast this when the stack is empty.", reason: "Stack is not empty." };
      }
    }

    return { isValid: true };
  }

  /**
   * Checks if player has enough mana to cast the card.
   * Considers untapped lands and other mana sources.
   */
  private static checkManaCost(gameState: GameState, player: Player, card: CardInstance): boolean {
    const cmc = card.cardData.cmc || 0;
    
    // In a real implementation, we would check the player's mana pool
    // But for this simple validation, let's check total mana available
    const manaPoolTotal = Object.values(player.manaPool).reduce((a, b) => a + b, 0);
    
    if (manaPoolTotal >= cmc) return true;

    // Also consider untapped lands that could produce mana
    const battlefieldZone = gameState.zones.get(`${player.id}-battlefield`);
    if (!battlefieldZone) return manaPoolTotal >= cmc;

    const untappedLands = battlefieldZone.cardIds.filter(id => {
      const c = gameState.cards.get(id);
      return c && !c.isTapped && isLand(c);
    }).length;

    return (manaPoolTotal + untappedLands) >= cmc;
  }
}
