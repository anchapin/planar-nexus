/**
 * Card instance factory and utility functions
 */

import type {
  CardInstanceId,
  CardInstance,
  PlayerId,
} from "./types";
import type { ScryfallCard } from "@/app/actions";

/**
 * Generate a unique card instance ID
 */
export function generateCardInstanceId(): CardInstanceId {
  return `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a new card instance from Scryfall data
 */
export function createCardInstance(
  cardData: ScryfallCard,
  ownerId: PlayerId,
  controllerId: PlayerId,
  options: Partial<CardInstance> = {}
): CardInstance {
  const id = options.id || generateCardInstanceId();

  return {
    id,
    oracleId: cardData.id,
    cardData,
    currentFaceIndex: 0,
    isFaceDown: false,
    controllerId,
    ownerId,
    isTapped: false,
    isFlipped: false,
    isTurnedFaceUp: false,
    isPhasedOut: false,
    hasSummoningSickness: true, // Default for permanents entering battlefield
    counters: [],
    damage: 0,
    toughnessModifier: 0,
    powerModifier: 0,
    attachedToId: null,
    attachedCardIds: [],
    enteredBattlefieldTimestamp: Date.now(),
    attachedTimestamp: null,
    isToken: options.isToken || false,
    tokenData: options.tokenData || null,
  };
}

/**
 * Create a token from a card definition
 */
export function createToken(
  tokenData: ScryfallCard,
  controllerId: PlayerId,
  ownerId: PlayerId
): CardInstance {
  return createCardInstance(tokenData, ownerId, controllerId, {
    isToken: true,
    tokenData,
  });
}

/**
 * Initialize loyalty counters on a planeswalker when it enters the battlefield
 * Planeswalkers enter with loyalty counters equal to their loyalty field
 * CR 306.5b
 */
export function initializePlaneswalkerLoyalty(card: CardInstance): CardInstance {
  if (!isPlaneswalker(card)) {
    return card;
  }

  // Get loyalty from card data
  const loyaltyStr = card.cardData.loyalty;
  if (!loyaltyStr) {
    return card;
  }

  const loyaltyValue = parseInt(loyaltyStr, 10);
  if (isNaN(loyaltyValue) || loyaltyValue <= 0) {
    return card;
  }

  // Add loyalty counters
  return addCounters(card, 'loyalty', loyaltyValue);
}

/**
 * Tap a permanent
 */
export function tapCard(card: CardInstance): CardInstance {
  return { ...card, isTapped: true };
}

/**
 * Untap a permanent
 */
export function untapCard(card: CardInstance): CardInstance {
  return { ...card, isTapped: false };
}

/**
 * Flip a card (for flip cards)
 */
export function flipCard(card: CardInstance): CardInstance {
  return { ...card, isFlipped: !card.isFlipped };
}

/**
 * Turn a card face down
 */
export function turnFaceDown(card: CardInstance): CardInstance {
  return { ...card, isFaceDown: true };
}

/**
 * Turn a card face up
 */
export function turnFaceUp(card: CardInstance): CardInstance {
  return { ...card, isFaceDown: false, isTurnedFaceUp: true };
}

/**
 * Add counters to a card
 */
export function addCounters(
  card: CardInstance,
  counterType: string,
  count: number
): CardInstance {
  const existingCounter = card.counters.find((c) => c.type === counterType);
  const updatedCounters = existingCounter
    ? card.counters.map((c) =>
        c.type === counterType ? { ...c, count: c.count + count } : c
      )
    : [...card.counters, { type: counterType, count }];

  return { ...card, counters: updatedCounters };
}

/**
 * Remove counters from a card
 */
export function removeCounters(
  card: CardInstance,
  counterType: string,
  count: number
): CardInstance {
  const existingCounter = card.counters.find((c) => c.type === counterType);

  if (!existingCounter) {
    return card;
  }

  const newCount = Math.max(0, existingCounter.count - count);

  const updatedCounters =
    newCount === 0
      ? card.counters.filter((c) => c.type !== counterType)
      : card.counters.map((c) =>
          c.type === counterType ? { ...c, count: newCount } : c
        );

  return { ...card, counters: updatedCounters };
}

/**
 * Mark damage on a creature
 */
export function markDamage(card: CardInstance, damage: number): CardInstance {
  return { ...card, damage: card.damage + damage };
}

/**
 * Reset damage marked on a creature (happens during cleanup)
 */
export function resetDamage(card: CardInstance): CardInstance {
  return { ...card, damage: 0 };
}

/**
 * Attach a card to another (Equipment, Aura, Fortification)
 */
export function attachCard(
  card: CardInstance,
  attachToId: CardInstanceId
): CardInstance {
  return {
    ...card,
    attachedToId: attachToId,
    attachedTimestamp: Date.now(),
  };
}

/**
 * Detach a card from its permanent
 */
export function detachCard(card: CardInstance): CardInstance {
  return {
    ...card,
    attachedToId: null,
    attachedTimestamp: null,
  };
}

/**
 * Change controller of a card
 */
export function changeController(
  card: CardInstance,
  newControllerId: PlayerId
): CardInstance {
  return {
    ...card,
    controllerId: newControllerId,
    // Reset summoning sickness when control changes
    hasSummoningSickness: true,
  };
}

/**
 * Check if a card is a creature
 */
export function isCreature(card: CardInstance): boolean {
  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  return typeLine.includes("creature");
}

/**
 * Check if a card is a land
 */
export function isLand(card: CardInstance): boolean {
  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  return typeLine.includes("land");
}

/**
 * Check if a card is a planeswalker
 */
export function isPlaneswalker(card: CardInstance): boolean {
  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  return typeLine.includes("planeswalker");
}

/**
 * Check if a card is an artifact
 */
export function isArtifact(card: CardInstance): boolean {
  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  return typeLine.includes("artifact");
}

/**
 * Check if a card is an enchantment
 */
export function isEnchantment(card: CardInstance): boolean {
  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  return typeLine.includes("enchantment");
}

/**
 * Check if a card is an instant or sorcery
 */
export function isInstantOrSorcery(card: CardInstance): boolean {
  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  return typeLine.includes("instant") || typeLine.includes("sorcery");
}

/**
 * Check if a card is a permanent
 */
export function isPermanent(card: CardInstance): boolean {
  return (
    isCreature(card) ||
    isLand(card) ||
    isPlaneswalker(card) ||
    isArtifact(card) ||
    isEnchantment(card)
  );
}

/**
 * Get the power of a creature
 */
export function getPower(card: CardInstance): number {
  if (!isCreature(card)) {
    return 0;
  }

  // For double-faced cards, get the power from the current face
  const currentFace = getCurrentFaceData(card);
  let basePower = 0;

  if (currentFace.power) {
    // Parse power from Scryfall data (handles *, numbers, etc.)
    const powerStr = currentFace.power;
    if (powerStr === "*") {
      // For variable power, return just the modifier
      // A full implementation would calculate based on game state
      basePower = 0;
    } else if (powerStr.includes("+")) {
      // Handle power like "2+*"
      const match = powerStr.match(/(\d+)\+/);
      basePower = match ? parseInt(match[1], 10) : 0;
    } else if (powerStr.includes("-")) {
      // Handle power like "2-*"
      const match = powerStr.match(/(\d+)-/);
      basePower = match ? parseInt(match[1], 10) : 0;
    } else {
      // Simple numeric power
      basePower = parseInt(powerStr, 10) || 0;
    }
  }

  return basePower + card.powerModifier;
}

/**
 * Get the current face data for a card (handles double-faced cards)
 */
function getCurrentFaceData(card: CardInstance): ScryfallCard {
  if (card.cardData.card_faces && card.cardData.card_faces.length > 0) {
    const faceIndex = Math.min(card.currentFaceIndex, card.cardData.card_faces.length - 1);
    return {
      ...card.cardData,
      power: card.cardData.card_faces[faceIndex].power,
      toughness: card.cardData.card_faces[faceIndex].toughness,
      name: card.cardData.card_faces[faceIndex].name,
      oracle_text: card.cardData.card_faces[faceIndex].oracle_text,
    } as ScryfallCard;
  }
  return card.cardData;
}

/**
 * Get the toughness of a creature
 */
export function getToughness(card: CardInstance): number {
  if (!isCreature(card)) {
    return 0;
  }

  // For double-faced cards, get the toughness from the current face
  const currentFace = getCurrentFaceData(card);
  let baseToughness = 0;

  if (currentFace.toughness) {
    // Parse toughness from Scryfall data (handles *, numbers, etc.)
    const toughnessStr = currentFace.toughness;
    if (toughnessStr === "*") {
      // For variable toughness, return just the modifier
      baseToughness = 0;
    } else if (toughnessStr.includes("+")) {
      // Handle toughness like "2+*"
      const match = toughnessStr.match(/(\d+)\+/);
      baseToughness = match ? parseInt(match[1], 10) : 0;
    } else if (toughnessStr.includes("-")) {
      // Handle toughness like "2-*"
      const match = toughnessStr.match(/(\d+)-/);
      baseToughness = match ? parseInt(match[1], 10) : 0;
    } else {
      // Simple numeric toughness
      baseToughness = parseInt(toughnessStr, 10) || 0;
    }
  }

  return baseToughness + card.toughnessModifier;
}

/**
 * Check if a creature has lethal damage marked
 */
export function hasLethalDamage(card: CardInstance): boolean {
  const toughness = getToughness(card);
  return card.damage >= toughness;
}

/**
 * Check if a card can attack (creatures only)
 */
export function canAttack(card: CardInstance): boolean {
  if (!isCreature(card)) {
    return false;
  }
  if (card.isTapped) {
    return false;
  }
  if (card.hasSummoningSickness) {
    // Check for haste
    const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
    if (!oracleText.includes("haste")) {
      return false;
    }
  }
  return true;
}

/**
 * Check if a card can block (creatures only)
 */
export function canBlock(card: CardInstance): boolean {
  if (!isCreature(card)) {
    return false;
  }
  if (card.isTapped) {
    return false;
  }
  return true;
}

/**
 * Get the mana cost of a card as an integer
 */
export function getManaValue(card: CardInstance): number {
  const cmc = (card.cardData as ScryfallCard & { cmc?: number }).cmc;
  return cmc ?? 0;
}

/**
 * Check if a card is a double-faced card (transform, modal_dfc, etc.)
 */
export function isDoubleFaced(card: CardInstance): boolean {
  return (
    card.cardData.layout === "transform" ||
    card.cardData.layout === "modal_dfc" ||
    card.cardData.layout === "reversible_card" ||
    Boolean(card.cardData.card_faces && card.cardData.card_faces.length > 1)
  );
}

/**
 * Transform a double-faced card to its other face
 */
export function transformCard(card: CardInstance): CardInstance {
  if (!isDoubleFaced(card)) {
    return card;
  }

  const faceCount = card.cardData.card_faces?.length || 2;
  const nextFaceIndex = (card.currentFaceIndex + 1) % faceCount;

  return {
    ...card,
    currentFaceIndex: nextFaceIndex,
  };
}

/**
 * Set a specific face on a double-faced card
 */
export function setCardFace(
  card: CardInstance,
  faceIndex: number
): CardInstance {
  if (!isDoubleFaced(card)) {
    return card;
  }

  const faceCount = card.cardData.card_faces?.length || 2;
  const validIndex = Math.max(0, Math.min(faceIndex, faceCount - 1));

  return {
    ...card,
    currentFaceIndex: validIndex,
  };
}

/**
 * Get the current face name of a card
 */
export function getCurrentFaceName(card: CardInstance): string {
  if (isDoubleFaced(card) && card.cardData.card_faces) {
    const faceIndex = Math.min(
      card.currentFaceIndex,
      card.cardData.card_faces.length - 1
    );
    return card.cardData.card_faces[faceIndex].name || card.cardData.name;
  }
  return card.cardData.name;
}

/**
 * Phase out a permanent
 */
export function phaseOut(card: CardInstance): CardInstance {
  return { ...card, isPhasedOut: true };
}

/**
 * Phase in a permanent
 */
export function phaseIn(card: CardInstance): CardInstance {
  return { ...card, isPhasedOut: false };
}

/**
 * Add power modifier to a card
 */
export function addPowerModifier(
  card: CardInstance,
  amount: number
): CardInstance {
  return { ...card, powerModifier: card.powerModifier + amount };
}

/**
 * Add toughness modifier to a card
 */
export function addToughnessModifier(
  card: CardInstance,
  amount: number
): CardInstance {
  return { ...card, toughnessModifier: card.toughnessModifier + amount };
}

/**
 * Set power modifier to a specific value
 */
export function setPowerModifier(
  card: CardInstance,
  value: number
): CardInstance {
  return { ...card, powerModifier: value };
}

/**
 * Set toughness modifier to a specific value
 */
export function setToughnessModifier(
  card: CardInstance,
  value: number
): CardInstance {
  return { ...card, toughnessModifier: value };
}

/**
 * Clear summoning sickness from a card
 */
export function clearSummoningSickness(card: CardInstance): CardInstance {
  return { ...card, hasSummoningSickness: false };
}

/**
 * Check if a card has a specific counter type
 */
export function hasCounter(
  card: CardInstance,
  counterType: string
): boolean {
  return card.counters.some((c) => c.type === counterType && c.count > 0);
}

/**
 * Get the count of a specific counter type
 */
export function getCounterCount(
  card: CardInstance,
  counterType: string
): number {
  const counter = card.counters.find((c) => c.type === counterType);
  return counter ? counter.count : 0;
}

/**
 * Check if a card is attached to another card
 */
export function isAttached(card: CardInstance): boolean {
  return card.attachedToId !== null;
}

/**
 * Check if a card has any attachments
 */
export function hasAttachments(card: CardInstance): boolean {
  return card.attachedCardIds.length > 0;
}

// ============================================================================
// Type Guards for Runtime Type Checking (Issue #565)
// ============================================================================

/**
 * Type guard to check if a value is a valid CardInstance
 */
export function isCardInstance(value: unknown): value is CardInstance {
  if (typeof value !== 'object' || value === null) return false;
  const card = value as Record<string, unknown>;
  return (
    typeof card.id === 'string' &&
    typeof card.oracleId === 'string' &&
    typeof card.cardData === 'object' &&
    card.cardData !== null &&
    typeof card.currentFaceIndex === 'number' &&
    typeof card.isFaceDown === 'boolean' &&
    typeof card.controllerId === 'string' &&
    typeof card.ownerId === 'string' &&
    typeof card.isTapped === 'boolean' &&
    Array.isArray(card.counters) &&
    typeof card.damage === 'number' &&
    typeof card.toughnessModifier === 'number' &&
    typeof card.powerModifier === 'number' &&
    (card.attachedToId === null || typeof card.attachedToId === 'string') &&
    Array.isArray(card.attachedCardIds) &&
    typeof card.enteredBattlefieldTimestamp === 'number' &&
    (card.attachedTimestamp === null || typeof card.attachedTimestamp === 'number') &&
    typeof card.isToken === 'boolean'
  );
}

/**
 * Type guard to check if a value is a valid Counter
 */
export function isCounter(value: unknown): value is { type: string; count: number } {
  if (typeof value !== 'object' || value === null) return false;
  const counter = value as Record<string, unknown>;
  return (
    typeof counter.type === 'string' &&
    typeof counter.count === 'number'
  );
}

/**
 * Type guard to check if a value is a valid PlayerId
 */
export function isPlayerId(value: unknown): value is PlayerId {
  return typeof value === 'string';
}

/**
 * Type guard to check if a value is a valid CardInstanceId
 */
export function isCardInstanceId(value: unknown): value is CardInstanceId {
  return typeof value === 'string';
}

/**
 * Type guard to check if a card is a creature type-safe wrapper
 */
export function assertIsCreature(card: CardInstance): asserts card is CardInstance & { cardData: { type_line: string } } {
  if (!isCreature(card)) {
    throw new Error(`Expected creature card, got: ${card.cardData.type_line || 'unknown'}`);
  }
}

/**
 * Type guard to check if a card is a land type-safe wrapper
 */
export function assertIsLand(card: CardInstance): asserts card is CardInstance & { cardData: { type_line: string } } {
  if (!isLand(card)) {
    throw new Error(`Expected land card, got: ${card.cardData.type_line || 'unknown'}`);
  }
}

/**
 * Type guard to check if a card is a planeswalker type-safe wrapper
 */
export function assertIsPlaneswalker(card: CardInstance): asserts card is CardInstance & { cardData: { type_line: string } } {
  if (!isPlaneswalker(card)) {
    throw new Error(`Expected planeswalker card, got: ${card.cardData.type_line || 'unknown'}`);
  }
}

/**
 * Type guard to check if a card is an instant or sorcery type-safe wrapper
 */
export function assertIsInstantOrSorcery(card: CardInstance): asserts card is CardInstance & { cardData: { type_line: string } } {
  if (!isInstantOrSorcery(card)) {
    throw new Error(`Expected instant or sorcery card, got: ${card.cardData.type_line || 'unknown'}`);
  }
}

/**
 * Type guard to check if a card is a permanent type-safe wrapper
 */
export function assertIsPermanent(card: CardInstance): asserts card is CardInstance & { cardData: { type_line: string } } {
  if (!isPermanent(card)) {
    throw new Error(`Expected permanent card, got: ${card.cardData.type_line || 'unknown'}`);
  }
}

/**
 * Safely get creature power with type checking
 */
export function tryGetPower(card: CardInstance): number | null {
  if (!isCreature(card)) {
    return null;
  }
  return getPower(card);
}

/**
 * Safely get creature toughness with type checking
 */
export function tryGetToughness(card: CardInstance): number | null {
  if (!isCreature(card)) {
    return null;
  }
  return getToughness(card);
}

/**
 * Safely get planeswalker loyalty with type checking
 */
export function tryGetLoyalty(card: CardInstance): number | null {
  if (!isPlaneswalker(card)) {
    return null;
  }
  const loyaltyStr = card.cardData.loyalty;
  if (!loyaltyStr) {
    return null;
  }
  const loyalty = parseInt(loyaltyStr, 10);
  return isNaN(loyalty) ? null : loyalty;
}
