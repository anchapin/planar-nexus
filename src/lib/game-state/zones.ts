/**
 * Zone management for Magic: The Gathering game state
 */

import type {
  CardInstanceId,
  PlayerId,
  Zone,
  ZoneType,
} from "./types";

/**
 * Generate a unique zone ID
 */
function generateZoneId(playerId: PlayerId | null, zoneType: ZoneType): string {
  const prefix = playerId !== null ? `${playerId}-` : "";
  return `${prefix}${zoneType}`;
}

/**
 * Create a new zone
 */
export function createZone(
  zoneType: ZoneType,
  playerId: PlayerId | null,
  options: {
    isRevealed?: boolean;
    visibleTo?: PlayerId[];
    initialCards?: CardInstanceId[];
  } = {}
): Zone {
  return {
    type: zoneType,
    playerId,
    cardIds: options.initialCards || [],
    isRevealed: options.isRevealed || false,
    visibleTo: options.visibleTo || [],
  };
}

/**
 * Initialize all zones for a player
 */
export function createPlayerZones(
  playerId: PlayerId,
  libraryCards: CardInstanceId[]
): Map<string, Zone> {
  const zones = new Map<string, Zone>();

  // Library - normally ordered, face down
  zones.set(
    generateZoneId(playerId, "library"),
    createZone("library", playerId, {
      initialCards: libraryCards,
    })
  );

  // Hand - normally only visible to owner
  zones.set(
    generateZoneId(playerId, "hand"),
    createZone("hand", playerId)
  );

  // Battlefield - visible to all
  zones.set(
    generateZoneId(playerId, "battlefield"),
    createZone("battlefield", playerId, {
      isRevealed: true,
    })
  );

  // Graveyard - normally revealed to all
  zones.set(
    generateZoneId(playerId, "graveyard"),
    createZone("graveyard", playerId, {
      isRevealed: true,
    })
  );

  // Exile - normally revealed to all
  zones.set(
    generateZoneId(playerId, "exile"),
    createZone("exile", playerId, {
      isRevealed: true,
    })
  );

  // Command zone - revealed to all (commander, emblems, etc.)
  zones.set(
    generateZoneId(playerId, "command"),
    createZone("command", playerId, {
      isRevealed: true,
    })
  );

  // Sideboard - for constructed formats
  zones.set(
    generateZoneId(playerId, "sideboard"),
    createZone("sideboard", playerId)
  );

  return zones;
}

/**
 * Create shared zones (stack is shared among all players)
 */
export function createSharedZones(): Map<string, Zone> {
  const zones = new Map<string, Zone>();

  // Stack - shared, visible to all
  zones.set(
    "stack",
    createZone("stack", null, {
      isRevealed: true,
    })
  );

  return zones;
}

/**
 * Add a card to a zone
 */
export function addCardToZone(
  zone: Zone,
  cardId: CardInstanceId,
  position?: "top" | "bottom" | number
): Zone {
  let newCardIds: CardInstanceId[];

  if (position === "top" || position === undefined) {
    newCardIds = [...zone.cardIds, cardId];
  } else if (position === "bottom") {
    newCardIds = [cardId, ...zone.cardIds];
  } else if (typeof position === "number") {
    newCardIds = [
      ...zone.cardIds.slice(0, position),
      cardId,
      ...zone.cardIds.slice(position),
    ];
  } else {
    newCardIds = [...zone.cardIds, cardId];
  }

  return { ...zone, cardIds: newCardIds };
}

/**
 * Remove a card from a zone
 */
export function removeCardFromZone(
  zone: Zone,
  cardId: CardInstanceId
): Zone {
  return {
    ...zone,
    cardIds: zone.cardIds.filter((id) => id !== cardId),
  };
}

/**
 * Move a card from one zone to another
 */
export function moveCardBetweenZones(
  fromZone: Zone,
  toZone: Zone,
  cardId: CardInstanceId,
  position?: "top" | "bottom" | number
): { from: Zone; to: Zone } {
  const updatedFrom = removeCardFromZone(fromZone, cardId);
  const updatedTo = addCardToZone(toZone, cardId, position);

  return { from: updatedFrom, to: updatedTo };
}

/**
 * Get the top card of a zone (library, stack, etc.)
 */
export function getTopCard(zone: Zone): CardInstanceId | null {
  if (zone.cardIds.length === 0) {
    return null;
  }
  return zone.cardIds[zone.cardIds.length - 1];
}

/**
 * Get the bottom card of a zone
 */
export function getBottomCard(zone: Zone): CardInstanceId | null {
  if (zone.cardIds.length === 0) {
    return null;
  }
  return zone.cardIds[0];
}

/**
 * Get cards from the top N positions of a zone
 */
export function getTopCards(zone: Zone, count: number): CardInstanceId[] {
  if (count <= 0) {
    return [];
  }
  return zone.cardIds.slice(-count);
}

/**
 * Shuffle a zone (randomize order)
 */
export function shuffleZone(zone: Zone): Zone {
  const shuffled = [...zone.cardIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return { ...zone, cardIds: shuffled };
}

/**
 * Count cards in a zone
 */
export function countCards(zone: Zone): number {
  return zone.cardIds.length;
}

/**
 * Check if a zone contains a specific card
 */
export function zoneContainsCard(zone: Zone, cardId: CardInstanceId): boolean {
  return zone.cardIds.includes(cardId);
}

/**
 * Get position of a card in a zone
 */
export function getCardPosition(zone: Zone, cardId: CardInstanceId): number {
  return zone.cardIds.indexOf(cardId);
}

/**
 * Reorder cards within a zone
 */
export function reorderCards(
  zone: Zone,
  cardIds: CardInstanceId[]
): Zone {
  // Validate that all cards in the new order exist in the zone
  const zoneCardSet = new Set(zone.cardIds);
  const validOrder = cardIds.filter((id) => zoneCardSet.has(id));

  return { ...zone, cardIds: validOrder };
}

/**
 * Make a zone revealed to all players
 */
export function revealZone(zone: Zone): Zone {
  return { ...zone, isRevealed: true };
}

/**
 * Make a zone hidden
 */
export function hideZone(zone: Zone): Zone {
  return { ...zone, isRevealed: false, visibleTo: [] };
}

/**
 * Make a zone visible to specific players
 */
export function setZoneVisibility(
  zone: Zone,
  visibleTo: PlayerId[]
): Zone {
  return { ...zone, isRevealed: false, visibleTo };
}

/**
 * Check if a player can see a zone
 */
export function canPlayerSeeZone(zone: Zone, playerId: PlayerId): boolean {
  if (zone.isRevealed) {
    return true;
  }

  if (zone.playerId === playerId) {
    return true;
  }

  return zone.visibleTo.includes(playerId);
}

/**
 * Draw cards from library
 */
export function drawCards(
  library: Zone,
  hand: Zone,
  count: number
): { library: Zone; hand: Zone; drawnCards: CardInstanceId[] } {
  const cardsToDraw = getTopCards(library, count);

  let updatedLibrary = library;
  let updatedHand = hand;

  cardsToDraw.forEach((cardId) => {
    const moved = moveCardBetweenZones(updatedLibrary, updatedHand, cardId);
    updatedLibrary = moved.from;
    updatedHand = moved.to;
  });

  return {
    library: updatedLibrary,
    hand: updatedHand,
    drawnCards: cardsToDraw,
  };
}

/**
 * Mill cards (put from library to graveyard)
 */
export function millCards(
  library: Zone,
  graveyard: Zone,
  count: number
): { library: Zone; graveyard: Zone; milledCards: CardInstanceId[] } {
  const cardsToMill = getTopCards(library, count);

  let updatedLibrary = library;
  let updatedGraveyard = graveyard;

  cardsToMill.forEach((cardId) => {
    const moved = moveCardBetweenZones(updatedLibrary, updatedGraveyard, cardId);
    updatedLibrary = moved.from;
    updatedGraveyard = moved.to;
  });

  return {
    library: updatedLibrary,
    graveyard: updatedGraveyard,
    milledCards: cardsToMill,
  };
}

/**
 * Exile cards from a zone
 */
export function exileCards(
  fromZone: Zone,
  exile: Zone,
  cardIds: CardInstanceId[]
): { from: Zone; exile: Zone; exiledCards: CardInstanceId[] } {
  let updatedFrom = fromZone;
  let updatedExile = exile;

  cardIds.forEach((cardId) => {
    const moved = moveCardBetweenZones(updatedFrom, updatedExile, cardId);
    updatedFrom = moved.from;
    updatedExile = moved.to;
  });

  return {
    from: updatedFrom,
    exile: updatedExile,
    exiledCards: cardIds,
  };
}
