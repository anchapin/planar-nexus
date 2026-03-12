/**
 * Spectator Commentary System
 * 
 * Generates play-by-play commentary for AI vs AI spectator mode.
 * Provides entertaining and educational narration of game events.
 */

import type { GameState, PlayerId, CardInstance } from '@/lib/game-state/types';

/**
 * Commentary entry with timestamp and context
 */
export interface CommentaryEntry {
  id: string;
  text: string;
  timestamp: number;
  turnNumber: number;
  phase: string;
  playerId?: PlayerId;
  cardId?: string;
  type: CommentaryType;
}

export type CommentaryType =
  | 'turn_start'
  | 'land_play'
  | 'spell_cast'
  | 'creature_attack'
  | 'creature_block'
  | 'damage_dealt'
  | 'life_change'
  | 'creature_dies'
  | 'player_wins'
  | 'game_message'
  | 'mana_ability'
  | 'phase_change';

/**
 * SpectatorCommentary class for generating game commentary
 */
export class SpectatorCommentary {
  private gameState: GameState;
  private entryCounter: number = 0;

  constructor(gameState: GameState) {
    this.gameState = gameState;
  }

  /**
   * Generate unique ID for commentary entry
   */
  private generateId(): string {
    return `commentary-${Date.now()}-${this.entryCounter++}`;
  }

  /**
   * Get current phase name for display
   */
  private getPhaseName(): string {
    const phase = this.gameState.turn.currentPhase;
    return phase.replace(/_/g, ' ');
  }

  /**
   * Get player name by ID
   */
  private getPlayerName(playerId: PlayerId): string {
    const player = this.gameState.players.get(playerId);
    return player?.name || 'Unknown Player';
  }

  /**
   * Get card name by ID
   */
  private getCardName(cardId: string): string {
    const card = this.gameState.cards.get(cardId);
    return card?.cardData.name || 'Unknown Card';
  }

  /**
   * Create a commentary entry
   */
  private createEntry(
    text: string,
    type: CommentaryType,
    playerId?: PlayerId,
    cardId?: string
  ): CommentaryEntry {
    return {
      id: this.generateId(),
      text,
      timestamp: Date.now(),
      turnNumber: this.gameState.turn.turnNumber,
      phase: this.getPhaseName(),
      playerId,
      cardId,
      type,
    };
  }

  /**
   * Generate commentary for turn start
   */
  generateTurnStart(playerId: PlayerId): CommentaryEntry {
    const playerName = this.getPlayerName(playerId);
    const turnNumber = this.gameState.turn.turnNumber;
    
    const flavorTexts = [
      `${playerName}'s turn begins (Turn ${turnNumber})`,
      `${playerName} takes their turn`,
      `Turn ${turnNumber}: ${playerName} is up`,
      `${playerName} starts turn ${turnNumber}`,
    ];

    return this.createEntry(
      flavorTexts[Math.floor(Math.random() * flavorTexts.length)],
      'turn_start',
      playerId
    );
  }

  /**
   * Generate commentary for playing a land
   */
  generateLandPlay(playerId: PlayerId, land: CardInstance): CommentaryEntry {
    const playerName = this.getPlayerName(playerId);
    const landName = land.cardData.name;
    
    const flavorTexts = [
      `${playerName} plays ${landName}`,
      `${playerName} drops ${landName}`,
      `${landName} enters the battlefield`,
      `${playerName} puts ${landName} onto the battlefield`,
    ];

    return this.createEntry(
      flavorTexts[Math.floor(Math.random() * flavorTexts.length)],
      'land_play',
      playerId,
      land.id
    );
  }

  /**
   * Generate commentary for casting a spell
   */
  generateSpellCast(
    playerId: PlayerId,
    spell: CardInstance,
    targetId?: string
  ): CommentaryEntry {
    const playerName = this.getPlayerName(playerId);
    const spellName = spell.cardData.name;
    const targetName = targetId ? this.getCardName(targetId) : null;

    let text: string;
    
    if (targetName) {
      const flavorTexts = [
        `${playerName} casts ${spellName} targeting ${targetName}`,
        `${playerName} uses ${spellName} on ${targetName}`,
        `${spellName} is cast by ${playerName}, targeting ${targetName}`,
      ];
      text = flavorTexts[Math.floor(Math.random() * flavorTexts.length)];
    } else {
      const flavorTexts = [
        `${playerName} casts ${spellName}`,
        `${playerName} plays ${spellName}`,
        `${spellName} is cast by ${playerName}`,
      ];
      text = flavorTexts[Math.floor(Math.random() * flavorTexts.length)];
    }

    return this.createEntry(text, 'spell_cast', playerId, spell.id);
  }

  /**
   * Generate commentary for creature attack
   */
  generateAttack(
    playerId: PlayerId,
    attackerCount: number,
    attackerIds?: string[]
  ): CommentaryEntry {
    const playerName = this.getPlayerName(playerId);
    const creatures = attackerCount === 1 ? 'creature' : 'creatures';
    
    let text: string;
    
    if (attackerIds && attackerIds.length === 1) {
      const attackerName = this.getCardName(attackerIds[0]);
      const flavorTexts = [
        `${playerName} attacks with ${attackerName}`,
        `${attackerName} goes on the offensive`,
        `${playerName} sends ${attackerName} to attack`,
      ];
      text = flavorTexts[Math.floor(Math.random() * flavorTexts.length)];
    } else {
      const flavorTexts = [
        `${playerName} attacks with ${attackerCount} ${creatures}`,
        `${playerName} declares ${attackerCount} attackers`,
        `${attackerCount} ${creatures} attack for ${playerName}`,
      ];
      text = flavorTexts[Math.floor(Math.random() * flavorTexts.length)];
    }

    return this.createEntry(text, 'creature_attack', playerId);
  }

  /**
   * Generate commentary for creature block
   */
  generateBlock(
    playerId: PlayerId,
    blockerCount: number,
    blockerIds?: string[]
  ): CommentaryEntry {
    const playerName = this.getPlayerName(playerId);
    const creatures = blockerCount === 1 ? 'creature' : 'creatures';
    
    let text: string;
    
    if (blockerIds && blockerIds.length === 1) {
      const blockerName = this.getCardName(blockerIds[0]);
      const flavorTexts = [
        `${playerName} blocks with ${blockerName}`,
        `${blockerName} stands in defense`,
        `${playerName} uses ${blockerName} to block`,
      ];
      text = flavorTexts[Math.floor(Math.random() * flavorTexts.length)];
    } else {
      const flavorTexts = [
        `${playerName} blocks with ${blockerCount} ${creatures}`,
        `${playerName} declares ${blockerCount} blockers`,
        `${blockerCount} ${creatures} move to block`,
      ];
      text = flavorTexts[Math.floor(Math.random() * flavorTexts.length)];
    }

    return this.createEntry(text, 'creature_block', playerId);
  }

  /**
   * Generate commentary for damage dealt
   */
  generateDamage(
    source: string,
    target: string,
    amount: number
  ): CommentaryEntry {
    const flavorTexts = [
      `${source} deals ${amount} damage to ${target}`,
      `${amount} damage dealt to ${target} by ${source}`,
      `${target} takes ${amount} damage from ${source}`,
    ];

    return this.createEntry(
      flavorTexts[Math.floor(Math.random() * flavorTexts.length)],
      'damage_dealt'
    );
  }

  /**
   * Generate commentary for life total change
   */
  generateLifeChange(
    playerId: PlayerId,
    oldLife: number,
    newLife: number
  ): CommentaryEntry {
    const playerName = this.getPlayerName(playerId);
    const diff = newLife - oldLife;
    const sign = diff > 0 ? '+' : '';
    
    let text: string;
    
    if (diff > 0) {
      const flavorTexts = [
        `${playerName} goes from ${oldLife} to ${newLife} life (${sign}${diff})`,
        `${playerName} gains ${diff} life (${oldLife} → ${newLife})`,
        `${playerName}'s life total increases to ${newLife}`,
      ];
      text = flavorTexts[Math.floor(Math.random() * flavorTexts.length)];
    } else if (diff < 0) {
      const flavorTexts = [
        `${playerName} goes from ${oldLife} to ${newLife} life (${sign}${diff})`,
        `${playerName} loses ${Math.abs(diff)} life (${oldLife} → ${newLife})`,
        `${playerName}'s life total drops to ${newLife}`,
      ];
      text = flavorTexts[Math.floor(Math.random() * flavorTexts.length)];
    } else {
      text = `${playerName}'s life total remains at ${newLife}`;
    }

    return this.createEntry(text, 'life_change', playerId);
  }

  /**
   * Generate commentary for creature dying
   */
  generateCreatureDies(playerId: PlayerId, creature: CardInstance): CommentaryEntry {
    const playerName = this.getPlayerName(playerId);
    const creatureName = creature.cardData.name;
    
    const flavorTexts = [
      `${creatureName} is destroyed`,
      `${playerName}'s ${creatureName} dies`,
      `${creatureName} goes to the graveyard`,
      `Farewell, ${creatureName}`,
    ];

    return this.createEntry(
      flavorTexts[Math.floor(Math.random() * flavorTexts.length)],
      'creature_dies',
      playerId,
      creature.id
    );
  }

  /**
   * Generate commentary for player winning
   */
  generateWin(playerId: PlayerId, reason: string): CommentaryEntry {
    const playerName = this.getPlayerName(playerId);
    
    const flavorTexts = [
      `🏆 ${playerName} wins! (${reason})`,
      `Victory for ${playerName}! (${reason})`,
      `${playerName} is victorious! (${reason})`,
      `Game over - ${playerName} wins!`,
    ];

    return this.createEntry(
      flavorTexts[Math.floor(Math.random() * flavorTexts.length)],
      'player_wins',
      playerId
    );
  }

  /**
   * Generate general game message
   */
  generateMessage(text: string): CommentaryEntry {
    return this.createEntry(text, 'game_message');
  }

  /**
   * Generate commentary for phase change
   */
  generatePhaseChange(phase: string): CommentaryEntry {
    const phaseName = phase.replace(/_/g, ' ');
    return this.createEntry(
      `Moving to ${phaseName} phase`,
      'phase_change'
    );
  }

  /**
   * Generate commentary for mana ability activation
   */
  generateManaAbility(playerId: PlayerId, manaAmount: string): CommentaryEntry {
    const playerName = this.getPlayerName(playerId);
    return this.createEntry(
      `${playerName} adds ${manaAmount} mana`,
      'mana_ability',
      playerId
    );
  }
}

/**
 * Commentary history manager
 * Keeps track of recent commentary entries
 */
export class CommentaryHistory {
  private entries: CommentaryEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries: number = 50) {
    this.maxEntries = maxEntries;
  }

  /**
   * Add a commentary entry
   */
  add(entry: CommentaryEntry): void {
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.pop();
    }
  }

  /**
   * Get all entries
   */
  getAll(): CommentaryEntry[] {
    return [...this.entries];
  }

  /**
   * Get recent entries
   */
  getRecent(count: number = 10): CommentaryEntry[] {
    return this.entries.slice(0, count);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Export entries as plain text
   */
  exportAsText(): string {
    const header = `=== Game Commentary ===
Generated: ${new Date().toISOString()}
Total Entries: ${this.entries.length}

`;

    const lines = this.entries
      .slice()
      .reverse()
      .map((entry) => `[Turn ${entry.turnNumber}] ${entry.text}`);

    return header + lines.join('\n');
  }
}
