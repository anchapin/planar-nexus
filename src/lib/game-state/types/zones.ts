/**
 * Zone types and zone-key helpers (CR 403-411): the ZoneType enum plus key parse/format utilities.
 *
 * Mechanically extracted from types.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import { CardInstanceId } from './cards';
import { GameState } from './game';
import { PlayerId } from './players';

/**
 * A zone where cards can exist
 *
 * Note: Zone type names use MTG terminology internally for backward compatibility.
 * Use translateZone() from terminology-translation.ts for user-facing display.
 */
export enum ZoneType {
  LIBRARY = "library",
  HAND = "hand",
  BATTLEFIELD = "battlefield",
  GRAVEYARD = "graveyard",
  STACK = "stack",
  EXILE = "exile",
  COMMAND = "command",
  SIDEBOARD = "sideboard",
  ANTICIPATE = "anticipate",
}

/**
 * Get the zone key for a player's zone
 */
export function getZoneKey(playerId: PlayerId, zone: ZoneType): string {
  if (zone === ZoneType.STACK) {
    return ZoneType.STACK;
  }
  return `${playerId}-${zone}`;
}

/**
 * Parse a zone key and return the playerId and zone
 */
export function parseZoneKey(zoneKey: string): {
  playerId: PlayerId | null;
  zone: ZoneType;
} {
  if (zoneKey === ZoneType.STACK) {
    return { playerId: null, zone: ZoneType.STACK };
  }
  const parts = zoneKey.split("-");
  const zone = parts.pop() as ZoneType;
  const playerId = parts.join("-") as PlayerId;
  return { playerId, zone };
}

/**
 * Check if a card is on the battlefield
 * Uses O(1) cached zone key lookup for performance (CR 704 - SBA optimization)
 */
export function isOnBattlefield(
  state: GameState,
  cardId: CardInstanceId,
): boolean {
  const card = state.cards.get(cardId);
  if (card?.currentZoneKey) {
    const zone = state.zones.get(card.currentZoneKey);
    return (zone?.type ?? null) === ZoneType.BATTLEFIELD;
  }
  // Fallback: search all zones (for cards created before cache existed)
  for (const zone of state.zones.values()) {
    if (zone.type === ZoneType.BATTLEFIELD && zone.cardIds.includes(cardId)) {
      return true;
    }
  }
  return false;
}

/**
 * A specific location containing cards
 */
export interface Zone {
  /** Type of zone */
  type: ZoneType;
  /** ID of the player who owns this zone (null for shared zones like stack) */
  playerId: PlayerId | null;
  /** Ordered list of card IDs in this zone */
  cardIds: CardInstanceId[];
  /** Whether this zone is revealed to all players */
  isRevealed: boolean;
  /** Which players can see this zone (empty = all can see, populated = restricted) */
  visibleTo: PlayerId[];
}

