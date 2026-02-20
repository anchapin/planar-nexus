/**
 * Evergreen Keywords System
 * 
 * Implements all Magic: The Gathering evergreen keywords.
 * Reference: CR 702 - Keyword Abilities
 * 
 * Issue #13: Phase 1.3: Handle evergreen keywords
 */

import type { CardInstance, PlayerId } from './types';

/**
 * Check if a card has a specific keyword
 */
export function hasKeyword(card: CardInstance, keyword: string): boolean {
  const keywords = card.cardData.keywords || [];
  const oracleText = card.cardData.oracle_text?.toLowerCase() || '';
  
  return (
    keywords.some(k => k.toLowerCase() === keyword.toLowerCase()) ||
    oracleText.includes(keyword.toLowerCase())
  );
}

// ============== FLYING ==============
/**
 * Check if a card has flying
 */
export function hasFlying(card: CardInstance): boolean {
  return hasKeyword(card, 'flying');
}

/**
 * Check if a creature can block a flying attacker
 */
export function canBlockFlying(card: CardInstance): boolean {
  return hasFlying(card) || hasReach(card);
}

// ============== FIRST STRIKE ==============
/**
 * Check if a card has first strike
 */
export function hasFirstStrike(card: CardInstance): boolean {
  return hasKeyword(card, 'first strike');
}

/**
 * Get the damage dealt in first strike combat phase
 */
export function dealsFirstStrikeDamage(card: CardInstance): boolean {
  return hasFirstStrike(card) || hasDoubleStrike(card);
}

// ============== DOUBLE STRIKE ==============
/**
 * Check if a card has double strike
 */
export function hasDoubleStrike(card: CardInstance): boolean {
  return hasKeyword(card, 'double strike');
}

// ============== DEATHTOUCH ==============
/**
 * Check if a card has deathtouch
 */
export function hasDeathtouch(card: CardInstance): boolean {
  return hasKeyword(card, 'deathtouch');
}

/**
 * Check if damage from this source is lethal (deathtouch)
 */
export function isLethalDamage(damage: number, source: CardInstance): boolean {
  if (hasDeathtouch(source)) {
    return damage >= 1;
  }
  return false;
}

// ============== HEXPROOF ==============
/**
 * Check if a card has hexproof
 */
export function hasHexproof(card: CardInstance): boolean {
  return hasKeyword(card, 'hexproof');
}

/**
 * Check if a target is protected by hexproof from a source
 */
export function isProtectedByHexproof(target: CardInstance, sourceControllerId: PlayerId): boolean {
  if (!hasHexproof(target)) return false;
  return target.controllerId !== sourceControllerId;
}

// ============== INDESTRUCTIBLE ==============
/**
 * Check if a card is indestructible
 */
export function isIndestructible(card: CardInstance): boolean {
  return hasKeyword(card, 'indestructible');
}

/**
 * Check if a card can be destroyed
 */
export function canBeDestroyed(card: CardInstance): boolean {
  return !isIndestructible(card);
}

// ============== LIFELINK ==============
/**
 * Check if a card has lifelink
 */
export function hasLifelink(card: CardInstance): boolean {
  return hasKeyword(card, 'lifelink');
}

// ============== MENACE ==============
/**
 * Check if a card has menace
 */
export function hasMenace(card: CardInstance): boolean {
  return hasKeyword(card, 'menace');
}

/**
 * Get minimum number of blockers required for a menace creature
 */
export function getMenaceMinimumBlockers(card: CardInstance): number {
  return hasMenace(card) ? 2 : 1;
}

// ============== REACH ==============
/**
 * Check if a card has reach
 */
export function hasReach(card: CardInstance): boolean {
  return hasKeyword(card, 'reach');
}

// ============== TRAMPLE ==============
/**
 * Check if a card has trample
 */
export function hasTrample(card: CardInstance): boolean {
  return hasKeyword(card, 'trample');
}

/**
 * Calculate excess damage from a trampling creature
 */
export function getExcessTrampleDamage(
  damage: number,
  blockerDamage: number,
  blocker: CardInstance,
  attacker: CardInstance
): number {
  if (!hasTrample(attacker)) return 0;
  
  const blockerToughness = getToughnessValue(blocker);
  const damageRemaining = damage - blockerDamage;
  
  if (damageRemaining <= 0) return 0;
  
  return Math.min(damageRemaining, damage - blockerToughness);
}

// ============== VIGILANCE ==============
/**
 * Check if a card has vigilance
 */
export function hasVigilance(card: CardInstance): boolean {
  return hasKeyword(card, 'vigilance');
}

/**
 * Check if a creature taps when attacking (vigilance)
 */
export function tapsWhenAttacking(card: CardInstance): boolean {
  return !hasVigilance(card);
}

// ============== HASTE ==============
/**
 * Check if a card has haste
 */
export function hasHaste(card: CardInstance): boolean {
  return hasKeyword(card, 'haste');
}

/**
 * Check if a creature can attack the turn it enters (haste)
 */
export function canAttackThisTurn(card: CardInstance): boolean {
  return !card.hasSummoningSickness || hasHaste(card);
}

/**
 * Check if a creature can block the turn it enters
 */
export function canBlockThisTurn(_card: CardInstance): boolean {
  // Creatures can block even with summoning sickness
  return true;
}

// ============== PROTECTION ==============
/**
 * Check if a card has protection from a color
 */
export function hasProtectionFrom(card: CardInstance, color: string): boolean {
  const oracleText = card.cardData.oracle_text?.toLowerCase() || '';
  return oracleText.includes(`protection from ${color.toLowerCase()}`);
}

/**
 * Check if a card can be targeted by cards of a certain color
 */
export function canBeTargetedByColor(card: CardInstance, color: string): boolean {
  if (hasProtectionFrom(card, color)) return false;
  return true;
}

// ============== FLASH ==============
/**
 * Check if a card has flash
 */
export function hasFlash(card: CardInstance): boolean {
  return hasKeyword(card, 'flash');
}

/**
 * Check if a card can be played at instant speed
 */
export function canBePlayedAtInstantSpeed(card: CardInstance): boolean {
  const typeLine = card.cardData.type_line?.toLowerCase() || '';
  
  // Instants always can be played at instant speed
  if (typeLine.includes('instant')) return true;
  
  // Cards with flash can be played at instant speed
  if (hasFlash(card)) return true;
  
  return false;
}

// ============== DEFENDER ==============
/**
 * Check if a card has defender
 */
export function hasDefender(card: CardInstance): boolean {
  return hasKeyword(card, 'defender');
}

/**
 * Check if a creature can attack (based on defender keyword only)
 * Note: This is a simple check. For full attack eligibility, use combat.canAttack
 */
export function canAttackIfNotDefender(card: CardInstance): boolean {
  return !hasDefender(card);
}

// ============== COMBAT DAMAGE CALCULATIONS ==============

/**
 * Get the base power of a creature
 */
function getPowerValue(card: CardInstance): number {
  // Try to get power/toughness from card_data (ScryfallCard)
  const cardData = card.cardData;
  if (cardData && 'power' in cardData && cardData.power) {
    return typeof cardData.power === 'number' ? cardData.power : parseInt(String(cardData.power), 10) || 0;
  }
  // Try to parse from type_line
  const ptMatch = card.cardData.type_line?.match(/(\d+)\/(\d+)/);
  if (ptMatch) {
    return parseInt(ptMatch[1], 10);
  }
  return 0;
}

/**
 * Get the base toughness of a creature
 */
function getToughnessValue(card: CardInstance): number {
  // Try to get power/toughness from card_data (ScryfallCard)
  const cardData = card.cardData;
  if (cardData && 'toughness' in cardData && cardData.toughness) {
    return typeof cardData.toughness === 'number' ? cardData.toughness : parseInt(String(cardData.toughness), 10) || 0;
  }
  // Try to parse from type_line
  const ptMatch = card.cardData.type_line?.match(/(\d+)\/(\d+)/);
  if (ptMatch) {
    return parseInt(ptMatch[2], 10);
  }
  return 0;
}

/**
 * Get effective power with modifiers
 */
export function getEffectivePower(card: CardInstance): number {
  let power = getPowerValue(card);
  power += card.powerModifier || 0;
  return Math.max(0, power);
}

/**
 * Get effective toughness with modifiers
 */
export function getEffectiveToughness(card: CardInstance): number {
  let toughness = getToughnessValue(card);
  toughness += card.toughnessModifier || 0;
  
  // Apply -1/-1 counters
  const minusCounters = card.counters?.find(c => c.type === '-1/-1');
  if (minusCounters) {
    toughness -= minusCounters.count;
  }
  
  // Apply +1/+1 counters
  const plusCounters = card.counters?.find(c => c.type === '+1/+1');
  if (plusCounters) {
    toughness += plusCounters.count;
  }
  
  return Math.max(0, toughness);
}

/**
 * Check if a creature has lethal damage marked on it
 */
export function hasLethalDamageMarked(card: CardInstance): boolean {
  if (!card.damage) return false;
  
  const toughness = getEffectiveToughness(card);
  
  // If indestructible, damage is not lethal
  if (isIndestructible(card)) return false;
  
  return card.damage >= toughness;
}

/**
 * Calculate combat damage between two creatures
 */
export function calculateCombatDamage(
  attacker: CardInstance,
  blocker: CardInstance
): { attackerDamage: number; blockerDamage: number } {
  const attackerPower = getEffectivePower(attacker);
  const blockerPower = getEffectivePower(blocker);
  
  // Apply deathtouch
  if (hasDeathtouch(attacker)) {
    return { attackerDamage: getEffectiveToughness(blocker), blockerDamage: attackerPower };
  }
  
  if (hasDeathtouch(blocker)) {
    return { attackerDamage: blockerPower, blockerDamage: getEffectiveToughness(attacker) };
  }
  
  return { attackerDamage: blockerPower, blockerDamage: attackerPower };
}

// ============== KEYWORD ABILITY CHECKS ==============

/**
 * Get all keywords on a card
 */
export function getAllKeywords(card: CardInstance): string[] {
  const keywords = card.cardData.keywords || [];
  const oracleText = card.cardData.oracle_text?.toLowerCase() || '';
  
  const foundKeywords: string[] = [...keywords];
  
  // Check for keywords mentioned in Oracle text
  const keywordTexts = [
    'flying', 'first strike', 'double strike', 'deathtouch',
    'defender', 'hexproof', 'indestructible', 'lifelink',
    'menace', 'reach', 'trample', 'vigilance', 'haste',
    'flash', 'protection'
  ];
  
  for (const kw of keywordTexts) {
    if (oracleText.includes(kw) && !foundKeywords.some(k => k.toLowerCase() === kw)) {
      foundKeywords.push(kw);
    }
  }
  
  return foundKeywords;
}

/**
 * Check if a card is a creature that can participate in combat
 */
export function isCombatCreature(card: CardInstance): boolean {
  const typeLine = card.cardData.type_line?.toLowerCase() || '';
  if (!typeLine.includes('creature')) return false;
  
  // Creatures with defender can't attack but can block
  return true;
}

/**
 * Get a description of all keyword abilities on a card
 */
export function getKeywordDescriptions(card: CardInstance): string[] {
  const descriptions: string[] = [];
  
  if (hasFlying(card)) descriptions.push('Flying');
  if (hasFirstStrike(card)) descriptions.push('First Strike');
  if (hasDoubleStrike(card)) descriptions.push('Double Strike');
  if (hasDeathtouch(card)) descriptions.push('Deathtouch');
  if (hasDefender(card)) descriptions.push('Defender');
  if (hasFlash(card)) descriptions.push('Flash');
  if (hasHaste(card)) descriptions.push('Haste');
  if (hasHexproof(card)) descriptions.push('Hexproof');
  if (isIndestructible(card)) descriptions.push('Indestructible');
  if (hasLifelink(card)) descriptions.push('Lifeline');
  if (hasMenace(card)) descriptions.push('Menace');
  if (hasProtectionFrom(card, 'black')) descriptions.push('Protection from Black');
  if (hasProtectionFrom(card, 'blue')) descriptions.push('Protection from Blue');
  if (hasProtectionFrom(card, 'green')) descriptions.push('Protection from Green');
  if (hasProtectionFrom(card, 'red')) descriptions.push('Protection from Red');
  if (hasProtectionFrom(card, 'white')) descriptions.push('Protection from White');
  if (hasReach(card)) descriptions.push('Reach');
  if (hasTrample(card)) descriptions.push('Trample');
  if (hasVigilance(card)) descriptions.push('Vigilance');
  
  return descriptions;
}
