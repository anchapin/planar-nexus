import { GameAction } from './game-state/types';
import { GameResult } from './game-history';

/**
 * Produces a concise natural language summary of the game based on actions.
 * 
 * @param actions The list of actions performed in the game
 * @param result The outcome of the game
 * @param playerDeck The name of the player's deck
 * @returns A string summary
 */
export function summarizeGame(actions: GameAction[], result: GameResult, playerDeck: string): string {
  if (!actions || actions.length === 0) {
    return `A game played with ${playerDeck} ending in a ${result}.`;
  }

  const spellsCast = actions.filter(a => a.type === 'cast_spell').length;
  const landsPlayed = actions.filter(a => a.type === 'play_land').length;
  const abilitiesActivated = actions.filter(a => a.type === 'activate_ability').length;
  
  // Extract damage and healing
  let totalDamage = 0;
  let totalHealing = 0;
  
  actions.forEach(action => {
    if (action.type === 'deal_damage' || action.type === 'lose_life') {
      const data = action.data as { amount?: number };
      if (typeof data.amount === 'number') {
        totalDamage += data.amount;
      }
    } else if (action.type === 'gain_life') {
      const data = action.data as { amount?: number };
      if (typeof data.amount === 'number') {
        totalHealing += data.amount;
      }
    }
  });

  const parts: string[] = [];
  
  if (result === 'win') {
    parts.push(`Victory with ${playerDeck}!`);
  } else if (result === 'loss') {
    parts.push(`Defeat with ${playerDeck}.`);
  } else {
    parts.push(`Draw with ${playerDeck}.`);
  }

  const gameplayStats = [];
  if (spellsCast > 0) gameplayStats.push(`cast ${spellsCast} spell${spellsCast === 1 ? '' : 's'}`);
  if (landsPlayed > 0) gameplayStats.push(`played ${landsPlayed} land${landsPlayed === 1 ? '' : 's'}`);
  if (abilitiesActivated > 0) gameplayStats.push(`activated ${abilitiesActivated} abilit${abilitiesActivated === 1 ? 'y' : 'ies'}`);

  if (gameplayStats.length > 0) {
    parts.push(`You ${gameplayStats.join(', ')}.`);
  }

  if (totalDamage > 0 || totalHealing > 0) {
    const impact = [];
    if (totalDamage > 0) impact.push(`dealt ${totalDamage} damage`);
    if (totalHealing > 0) impact.push(`gained ${totalHealing} life`);
    parts.push(`In total, you ${impact.join(' and ')}.`);
  }

  return parts.join(' ');
}
