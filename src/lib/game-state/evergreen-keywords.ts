/**
 * Evergreen Keywords System
 *
 * Implements all evergreen keywords for the game engine.
 * Reference: CR 702 - Keyword Abilities
 *
 * Issue #13: Phase 1.3: Handle evergreen keywords
 * Issue #442: Unit 8 - Terminology Translation Layer
 *
 * Note: Internal function names and comments may reference MTG terminology
 * for compatibility with card data. All user-facing text should use generic
 * terminology via the translation layer.
 */

import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
} from "./types";

/**
 * Check if a card has a specific keyword
 */
export function hasKeyword(card: CardInstance, keyword: string): boolean {
  const keywords = card.cardData.keywords || [];
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";

  return (
    keywords.some((k) => k.toLowerCase() === keyword.toLowerCase()) ||
    oracleText.includes(keyword.toLowerCase())
  );
}

// ============== FLYING ==============
/**
 * Check if a card has flying
 */
export function hasFlying(card: CardInstance): boolean {
  return hasKeyword(card, "flying");
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
  return hasKeyword(card, "first strike");
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
  return hasKeyword(card, "double strike");
}

// ============== DEATHTOUCH ==============
/**
 * Check if a card has deathtouch
 */
export function hasDeathtouch(card: CardInstance): boolean {
  return hasKeyword(card, "deathtouch");
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

// ============== SHROUD ==============
/**
 * Check if a card has shroud
 * CR 702.18: Can't be targeted at all
 */
export function hasShroud(card: CardInstance): boolean {
  return hasKeyword(card, "shroud");
}

// ============== HEXPROOF ==============
/**
 * Check if a card has hexproof
 */
export function hasHexproof(card: CardInstance): boolean {
  return hasKeyword(card, "hexproof");
}

/**
 * Check if a target is protected by hexproof from a source
 */
export function isProtectedByHexproof(
  target: CardInstance,
  sourceControllerId: PlayerId,
): boolean {
  if (!hasHexproof(target)) return false;
  return target.controllerId !== sourceControllerId;
}

// ============== HEXPROOF ==============
/**
 * Check if a card is indestructible
 */
export function isIndestructible(card: CardInstance): boolean {
  return hasKeyword(card, "indestructible");
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
  return hasKeyword(card, "lifelink");
}

// ============== MENACE ==============
/**
 * Check if a card has menace
 */
export function hasMenace(card: CardInstance): boolean {
  return hasKeyword(card, "menace");
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
  return hasKeyword(card, "reach");
}

// ============== LANDWALK (CR 702.14) ==============
/**
 * The five basic land types that the basic-landwalk family keys off.
 * CR 702.14b: A creature with landwalk can't be blocked if the defending
 * player controls a land with the matching basic land subtype.
 */
const LANDWALK_BASIC_LAND_TYPES = [
  "plains",
  "island",
  "swamp",
  "mountain",
  "forest",
] as const;

/**
 * Get the basic land types for which a card has landwalk.
 *
 * Detects the five basic landwalk variants — plainswalk, islandwalk,
 * swampwalk, mountainwalk, forestwalk — by parsing oracle text and the
 * keywords array for the "{land}walk" pattern.
 *
 * @returns Array of lowercase basic land type names (e.g., ["swamp"]).
 *          Empty if the card has no landwalk.
 */
export function getLandwalkTypes(card: CardInstance): string[] {
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
  const keywords = (card.cardData.keywords || []).map((k) => k.toLowerCase());
  const combined = `${oracleText} ${keywords.join(" ")}`;

  const types: string[] = [];
  for (const landType of LANDWALK_BASIC_LAND_TYPES) {
    // Word-boundaried match so "forestwalk" matches but "forestwal" /
    // "forestwalker" / "plainswalking" (rare, but distinct token) don't
    // produce false positives that mis-flag the card.
    const pattern = new RegExp(`\\b${landType}walk\\b`);
    if (pattern.test(combined)) {
      types.push(landType);
    }
  }
  return types;
}

/**
 * Check if a card has any basic landwalk variant.
 */
export function hasLandwalk(card: CardInstance): boolean {
  return getLandwalkTypes(card).length > 0;
}

// ============== TRAMPLE ==============
/**
 * Check if a card has trample
 */
export function hasTrample(card: CardInstance): boolean {
  return hasKeyword(card, "trample");
}

/**
 * Calculate excess damage from a trampling creature
 */
export function getExcessTrampleDamage(
  damage: number,
  blockerDamage: number,
  blocker: CardInstance,
  attacker: CardInstance,
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
  return hasKeyword(card, "vigilance");
}

/**
 * Check if a creature activates when attacking (vigilance)
 */
export function tapsWhenAttacking(card: CardInstance): boolean {
  return !hasVigilance(card);
}

// ============== HASTE ==============
/**
 * Check if a card has haste
 */
export function hasHaste(card: CardInstance): boolean {
  return hasKeyword(card, "haste");
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
  // Creatures can block even with deployment restriction
  return true;
}

// ============== PROTECTION ==============

/**
 * Standard MTG colors
 */
const MTG_COLORS = ["white", "blue", "black", "red", "green"];
const COLOR_ABbrev_TO_FULL: Record<string, string> = {
  w: "white",
  u: "blue",
  b: "black",
  r: "red",
  g: "green",
};

/**
 * Check if a string represents a valid MTG color
 */
function isMTGColor(value: string): boolean {
  return MTG_COLORS.includes(value.toLowerCase());
}

/**
 * Normalize MTG color abbreviations (W, U, B, R, G) to full color names
 * Implements CR 702.16 - Protection
 */
export function normalizeColor(color: string): string {
  const colorMap: Record<string, string> = {
    w: "white",
    white: "white",
    u: "blue",
    blue: "blue",
    b: "black",
    black: "black",
    r: "red",
    red: "red",
    g: "green",
    green: "green",
  };
  return colorMap[color.toLowerCase()] || color.toLowerCase();
}

/**
 * Get the colors of a card from its cardData
 * Returns array of color strings (e.g., ['W', 'U'] or ['Red', 'Blue'])
 */
export function getCardColors(card: CardInstance): string[] {
  return (card.cardData.colors || []).map(normalizeColor);
}

/**
 * Extract protection qualities from a card's oracle text
 * Parses phrases like "protection from black", "protection from red and blue"
 * Returns array of qualities (colors) the card is protected from
 */
export function getProtectionQualities(card: CardInstance): string[] {
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
  const qualities: string[] = [];

  // Match "protection from X" where X can be a color or multiple colors
  // Patterns: "protection from red", "protection from red and blue"
  const protectionRegex = /protection from\s+([\w]+(?:\s+and\s+[\w]+)?)/gi;
  let match;

  while ((match = protectionRegex.exec(oracleText)) !== null) {
    const qualityPart = match[1].toLowerCase();
    // Split by " and " to handle multiple qualities
    const parts = qualityPart.split(/\s+and\s+/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (isMTGColor(trimmed)) {
        qualities.push(trimmed);
      }
    }
  }

  return qualities;
}

/**
 * Check if a card has protection from a color
 */
export function hasProtectionFrom(card: CardInstance, color: string): boolean {
  const qualities = getProtectionQualities(card);
  const normalizedColor = normalizeColor(color);
  return qualities.some((q) => q.toLowerCase() === normalizedColor);
}

/**
 * Check if a card is protected from any quality of a source card
 * Used for targeting, enchanting, and equipping restrictions
 */
export function isProtectedFromSource(
  target: CardInstance,
  source: CardInstance,
): boolean {
  const targetQualities = getProtectionQualities(target);
  if (targetQualities.length === 0) return false;

  const sourceColors = getCardColors(source);

  // Check if source has any color that the target is protected from
  for (const color of sourceColors) {
    const normalizedColor = color.toLowerCase();
    // Handle both "red" and "R" formats
    const colorMap: Record<string, string> = {
      w: "white",
      white: "white",
      u: "blue",
      blue: "blue",
      b: "black",
      black: "black",
      r: "red",
      red: "red",
      g: "green",
      green: "green",
    };
    const normalized = colorMap[normalizedColor] || normalizedColor;
    if (targetQualities.some((q) => q.toLowerCase() === normalized)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a card can be targeted by cards of a certain color
 * Implements CR 702.16A: can't be targeted by spells/abilities with the given quality
 */
export function canBeTargetedByColor(
  card: CardInstance,
  color: string,
): boolean {
  if (hasProtectionFrom(card, color)) return false;
  return true;
}

/**
 * Check if a card can be targeted based on hexproof/shroud from a player
 * CR 702.11 (Hexproof), CR 702.18 (Shroud)
 */
export function canTargetKeyword(
  card: CardInstance,
  sourcePlayerId: PlayerId,
  effectColor?: string,
): { canTarget: boolean; reason?: string } {
  if (card.controllerId === sourcePlayerId) {
    return { canTarget: true };
  }

  if (hasHexproof(card) && effectColor) {
    return { canTarget: false, reason: "Target has hexproof" };
  }

  if (effectColor && hasProtectionFrom(card, effectColor)) {
    return { canTarget: false, reason: "Target has protection" };
  }

  return { canTarget: true };
}

/**
 * Check if a card can be targeted by a source card
 * Implements CR 702.16A: can't be targeted by spells/abilities with the given quality
 */
export function canBeTargetedBySource(
  target: CardInstance,
  source: CardInstance,
): boolean {
  if (isProtectedFromSource(target, source)) return false;
  return true;
}

/**
 * Check if an enchantment can legally enchant a protected card
 * Implements CR 702.16B: can't be enchanted by Objects with the given quality
 */
export function canBeEnchantedBy(
  target: CardInstance,
  enchantment: CardInstance,
): boolean {
  // If the enchantment is an aura, check protection
  const auraType = enchantment.cardData.type_line?.toLowerCase() || "";
  if (auraType.includes("aura")) {
    if (isProtectedFromSource(target, enchantment)) {
      return false;
    }
  }
  return true;
}

/**
 * Check if equipment can legally equip a protected creature
 * Implements CR 702.16D: can't be equipped by Objects with the given quality
 */
export function canBeEquippedBy(
  target: CardInstance,
  equipment: CardInstance,
): boolean {
  // If the equipment is actually equipment
  const equipmentType = equipment.cardData.type_line?.toLowerCase() || "";
  if (equipmentType.includes("equipment")) {
    if (isProtectedFromSource(target, equipment)) {
      return false;
    }
  }
  return true;
}

/**
 * Check if damage to a protected creature should be prevented
 * Implements CR 702.16C: damage that would be dealt to the protected object is prevented
 */
export function shouldPreventDamageToTarget(
  target: CardInstance,
  source: CardInstance,
): boolean {
  if (isProtectedFromSource(target, source)) {
    return true;
  }
  return false;
}

/**
 * Check if a card can be targeted by a spell/ability considering protection, hexproof, and shroud
 * Implements CR 702.16A (Protection), CR 702.11 (Hexproof), CR 702.18 (Shroud)
 *
 * @param card - The target card
 * @param sourcePlayerId - The controller of the source spell/ability
 * @param effectColor - Optional color of the effect (for protection checks)
 * @returns Object with canTarget boolean and optional reason string
 */
export function canTarget(
  card: CardInstance,
  sourcePlayerId: PlayerId,
  effectColor?: string,
): { canTarget: boolean; reason?: string } {
  // Check shroud first (blocks all targeting)
  if (hasShroud(card)) {
    return { canTarget: false, reason: "Target has shroud" };
  }

  // Check hexproof (blocks opponent targeting)
  if (hasHexproof(card) && card.controllerId !== sourcePlayerId) {
    return { canTarget: false, reason: "Target has hexproof" };
  }

  // Check protection from specific color
  if (effectColor) {
    const normalizedEffectColor = normalizeColor(effectColor);
    if (hasProtectionFrom(card, normalizedEffectColor)) {
      return {
        canTarget: false,
        reason: `Target has protection from ${effectColor}`,
      };
    }
  }

  return { canTarget: true };
}

/**
 * Check if a blocker can block an attacker considering protection
 * Implements CR 702.16D: A creature with protection can't be blocked by creatures of the protected quality
 *
 * @param attacker - The attacking creature
 * @param blocker - The potential blocker
 * @returns Object with canBlock boolean and optional reason string
 */
export function canBlockProtectedAttacker(
  attacker: CardInstance,
  blocker: CardInstance,
): { canBlock: boolean; reason?: string } {
  const blockerColors = getCardColors(blocker);

  for (const color of blockerColors) {
    const normalizedColor = normalizeColor(color);
    if (hasProtectionFrom(attacker, normalizedColor)) {
      return {
        canBlock: false,
        reason: `Attacker has protection from ${normalizedColor}`,
      };
    }
  }

  return { canBlock: true };
}

// ============== FLASH ==============
/**
 * Check if a card has flash
 */
export function hasFlash(card: CardInstance): boolean {
  return hasKeyword(card, "flash");
}

/**
 * Check if a card can be played at instant speed
 */
export function canBePlayedAtInstantSpeed(card: CardInstance): boolean {
  const typeLine = card.cardData.type_line?.toLowerCase() || "";

  // Instants always can be played at instant speed
  if (typeLine.includes("instant")) return true;

  // Cards with flash can be played at instant speed
  if (hasFlash(card)) return true;

  return false;
}

// ============== DEFENDER ==============
/**
 * Check if a card has defender
 */
export function hasDefender(card: CardInstance): boolean {
  return hasKeyword(card, "defender");
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
  if (cardData && "power" in cardData && cardData.power) {
    return typeof cardData.power === "number"
      ? cardData.power
      : parseInt(String(cardData.power), 10) || 0;
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
  if (cardData && "toughness" in cardData && cardData.toughness) {
    return typeof cardData.toughness === "number"
      ? cardData.toughness
      : parseInt(String(cardData.toughness), 10) || 0;
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

  // Apply -1/-1 markers
  const minusCounters = card.counters?.find((c) => c.type === "-1/-1");
  if (minusCounters) {
    toughness -= minusCounters.count;
  }

  // Apply +1/+1 markers
  const plusCounters = card.counters?.find((c) => c.type === "+1/+1");
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
  blocker: CardInstance,
): { attackerDamage: number; blockerDamage: number } {
  const attackerPower = getEffectivePower(attacker);
  const blockerPower = getEffectivePower(blocker);

  // Apply deathtouch
  if (hasDeathtouch(attacker)) {
    return {
      attackerDamage: getEffectiveToughness(blocker),
      blockerDamage: attackerPower,
    };
  }

  if (hasDeathtouch(blocker)) {
    return {
      attackerDamage: blockerPower,
      blockerDamage: getEffectiveToughness(attacker),
    };
  }

  return { attackerDamage: blockerPower, blockerDamage: attackerPower };
}

// ============== KEYWORD ABILITY CHECKS ==============

/**
 * Get all keywords on a card
 */
export function getAllKeywords(card: CardInstance): string[] {
  const keywords = card.cardData.keywords || [];
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";

  const foundKeywords: string[] = [...keywords];

  // Check for keywords mentioned in Oracle text
  const keywordTexts = [
    "flying",
    "first strike",
    "double strike",
    "deathtouch",
    "defender",
    "hexproof",
    "indestructible",
    "lifelink",
    "menace",
    "reach",
    "trample",
    "vigilance",
    "haste",
    "flash",
    "protection",
    "ward",
  ];

  for (const kw of keywordTexts) {
    if (
      oracleText.includes(kw) &&
      !foundKeywords.some((k) => k.toLowerCase() === kw)
    ) {
      foundKeywords.push(kw);
    }
  }

  return foundKeywords;
}

/**
 * Check if a card is a creature that can participate in combat
 */
export function isCombatCreature(card: CardInstance): boolean {
  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  if (!typeLine.includes("creature")) return false;

  // Creatures with defender can't attack but can block
  return true;
}

/**
 * Get a description of all keyword abilities on a card
 * Note: This returns MTG terminology for compatibility. For user-facing
 * display, apply translation layer to the descriptions.
 */
export function getKeywordDescriptions(card: CardInstance): string[] {
  const descriptions: string[] = [];

  if (hasFlying(card)) descriptions.push("Flying");
  if (hasFirstStrike(card)) descriptions.push("First Strike");
  if (hasDoubleStrike(card)) descriptions.push("Double Strike");
  if (hasDeathtouch(card)) descriptions.push("Deathtouch");
  if (hasDefender(card)) descriptions.push("Defender");
  if (hasFlash(card)) descriptions.push("Flash");
  if (hasHaste(card)) descriptions.push("Haste");
  if (hasHexproof(card)) descriptions.push("Hexproof");
  if (isIndestructible(card)) descriptions.push("Indestructible");
  if (hasLifelink(card)) descriptions.push("Lifeline");
  if (hasMenace(card)) descriptions.push("Menace");
  if (hasProtectionFrom(card, "black"))
    descriptions.push("Protection from Black");
  if (hasProtectionFrom(card, "blue"))
    descriptions.push("Protection from Blue");
  if (hasProtectionFrom(card, "green"))
    descriptions.push("Protection from Green");
  if (hasProtectionFrom(card, "red")) descriptions.push("Protection from Red");
  if (hasProtectionFrom(card, "white"))
    descriptions.push("Protection from White");
  if (hasReach(card)) descriptions.push("Reach");
  if (hasTrample(card)) descriptions.push("Trample");
  if (hasVigilance(card)) descriptions.push("Vigilance");

  // Ward description uses the parsed cost (e.g., "Ward {2}")
  const wardCost = getWardCost(card);
  if (wardCost !== null) {
    descriptions.push(`Ward ${wardCost}`);
  }

  return descriptions;
}

// ============== WARD ==============
/**
 * Default ward cost when a card has "Ward" with no explicit cost.
 * Most printed Ward cards use a mana cost, so default to {2}.
 */
const DEFAULT_WARD_COST = "{2}";

/**
 * Check if a card has the ward keyword.
 * CR 702.21: Ward is a triggered ability. "Whenever this permanent becomes the
 * target of a spell or ability an opponent controls, counter that spell or ability
 * unless its controller pays [cost]."
 *
 * Detection: the card's `keywords` array contains "Ward", OR the oracle text
 * contains "ward" as a standalone keyword (word-bounded, so "warden"/"forward"
 * do not match).
 */
export function hasWard(card: CardInstance): boolean {
  const keywords = card.cardData.keywords || [];
  if (keywords.some((k) => /^ward\b/i.test(k.trim()))) {
    return true;
  }
  const oracleText = card.cardData.oracle_text || "";
  return /\bward\b/i.test(oracleText);
}

/**
 * Parse the ward cost of a card into its string representation.
 *
 * Supported formats (matching how Ward appears on cards):
 *  - Mana cost:   "Ward {2}" / "Ward—{2}{U}"  -> "{2}" / "{2}{U}"
 *  - Life cost:   "Ward—Pay 3 life."           -> "3"
 *  - Plain ward:  "Ward"                        -> "{2}" (default)
 *
 * Returns null for cards without ward.
 */
export function getWardCost(card: CardInstance): string | null {
  if (!hasWard(card)) {
    return null;
  }

  const oracleText = card.cardData.oracle_text || "";

  // Mana ward: one or more {...} mana symbols following "Ward"
  const manaMatch = oracleText.match(/\bward\b(?:[—\-:]?\s*)((?:\{[^}]*\})+)/i);
  if (manaMatch) {
    return manaMatch[1];
  }

  // Life ward: "Ward—Pay N life"
  const lifeMatch = oracleText.match(/\bward\b[—\-:]?\s*pay\s+(\d+)\s+life/i);
  if (lifeMatch) {
    return lifeMatch[1];
  }

  // Ward keyword present but no explicit cost -> default
  return DEFAULT_WARD_COST;
}

/**
 * Check if a card is protected by ward from a spell/ability controlled by the
 * given player. Ward only protects against opposing sources (CR 702.21).
 *
 * @param card The potential target permanent
 * @param sourceControllerId The controller of the targeting spell/ability
 */
export function isProtectedByWard(
  card: CardInstance,
  sourceControllerId: PlayerId,
): boolean {
  if (!hasWard(card)) {
    return false;
  }
  // Ward triggers only for opposing sources; a player's own spells ignore it.
  return card.controllerId !== sourceControllerId;
}

// ============== PERSIST ==============
/**
 * Check if a card has persist keyword
 * CR 702.78: When a creature with persist dies, if it had no -1/-1 counters on it,
 * return it to the battlefield with a -1/-1 counter on it.
 */
export function hasPersist(card: CardInstance): boolean {
  return hasKeyword(card, "persist");
}

/**
 * Check if a creature with persist can trigger its ability
 * Returns true if the creature dies WITHOUT a -1/-1 counter on it
 */
export function canPersistTrigger(card: CardInstance): boolean {
  const minusCounters = card.counters?.find((c) => c.type === "-1/-1");
  return !minusCounters || minusCounters.count === 0;
}

// ============== MUTATE ==============
/**
 * Check if a card has mutate keyword
 * CR 702.140: Mutate is an ability that lets you cast a creature with mutate
 * over a creature you control, merging them into one creature.
 */
export function hasMutate(card: CardInstance): boolean {
  return hasKeyword(card, "mutate");
}

/**
 * Check if a card with mutate can be cast onto a target creature
 * The mutate card must be a creature and target must be a creature
 * you control.
 */
export function canMutateOnto(
  mutator: CardInstance,
  target: CardInstance,
  playerId: PlayerId,
): boolean {
  if (!hasMutate(mutator)) return false;

  const typeLine = mutator.cardData.type_line?.toLowerCase() || "";
  if (!typeLine.includes("creature")) return false;

  const targetTypeLine = target.cardData.type_line?.toLowerCase() || "";
  if (!targetTypeLine.includes("creature")) return false;

  return target.controllerId === playerId;
}

// ============== BOAST (CR 702.131) ==============

/**
 * Check if a card has Boast keyword
 */
export function hasBoast(card: CardInstance): boolean {
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
  return oracleText.includes("boast");
}

/**
 * Check if a creature's Boast ability should trigger at the beginning of upkeep
 * Per CR 702.131: Boast is a triggered ability that triggers at the beginning of your upkeep
 * if you attacked with the creature with the Boast ability during the previous turn.
 *
 * The attackedLastTurn flag is set when the creature attacks and is cleared at the
 * start of the owner's turn, so at upkeep we check if it was set in the previous turn.
 */
export function shouldBoastTrigger(card: CardInstance): boolean {
  return hasBoast(card) && card.attackedLastTurn;
}

/**
 * Reset Boast tracking at the start of a new turn
 * Called when a player's turn begins to reset the attackedLastTurn flag
 * so that at the next upkeep, we can check if the creature attacked "previous turn"
 */
export function resetBoastForNewTurn(
  state: GameState,
  playerId: PlayerId,
): GameState {
  const battlefieldZoneKey = `${playerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldZoneKey);
  if (!battlefield) return state;

  const updatedCards = new Map(state.cards);
  for (const cardId of battlefield.cardIds) {
    const card = updatedCards.get(cardId);
    if (card && card.attackedLastTurn) {
      updatedCards.set(cardId, { ...card, attackedLastTurn: false });
    }
  }

  return { ...state, cards: updatedCards };
}

/**
 * Mark a creature as having attacked this turn (for Boast tracking)
 * Called when a creature attacks so that at the next upkeep we can check
 * if the creature attacked "previous turn"
 */
export function markCreatureAttackedForBoast(
  state: GameState,
  cardId: CardInstanceId,
): GameState {
  const card = state.cards.get(cardId);
  if (!card) return state;

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, { ...card, attackedLastTurn: true });
  return { ...state, cards: updatedCards };
}

// ============== INFECT (CR 702.93) ==============
/**
 * Check if a card has infect keyword
 * CR 702.93: Damage dealt by the object to creatures is dealt as though it were
 * poison counters, not damage. Damage dealt to players is dealt as poison counters.
 */
export function hasInfect(card: CardInstance): boolean {
  return hasKeyword(card, "infect");
}

// ============== TOXIC (CR 702.94) ==============
/**
 * Get the toxic level of a creature
 * CR 702.94: When a creature with toxic deals damage to a player, that player
 * gets a poison counter. The number is the number of poison counters.
 *
 * Returns 0 if the creature doesn't have toxic.
 * Returns 1 for "toxic" (no number specified).
 * Returns the specified number for "toxic N".
 */
export function getToxicLevel(card: CardInstance): number {
  const keywords = card.cardData.keywords || [];
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";

  // Check keywords array for "toxic" or "toxic N"
  for (const keyword of keywords) {
    const lowerKeyword = keyword.toLowerCase();
    if (lowerKeyword === "toxic") {
      return 1;
    }
    const toxicMatch = lowerKeyword.match(/^toxic\s+(\d+)$/);
    if (toxicMatch) {
      return parseInt(toxicMatch[1], 10);
    }
  }

  // Also check oracle text for "toxic N"
  const toxicOracleMatch = oracleText.match(/toxic\s+(\d+)/);
  if (toxicOracleMatch) {
    return parseInt(toxicOracleMatch[1], 10);
  }

  // Check if "toxic" appears without a number in oracle text
  if (oracleText.includes("toxic")) {
    return 1;
  }

  return 0;
}
