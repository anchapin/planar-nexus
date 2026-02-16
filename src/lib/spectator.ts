// Spectator mode types and utilities

export type PlayerSlotType = 'player' | 'spectator';

export interface Spectator {
  id: string;
  name: string;
  joinedAt: number;
  isHidden?: boolean; // Whether they're hidden from other spectators
}

export interface PlayerSlot {
  id: string;
  type: PlayerSlotType;
  playerId?: string;
  playerName?: string;
  spectator?: Spectator;
  isReady?: boolean;
  isConnected?: boolean;
}

export interface SpectatorSettings {
  canChat: boolean; // Spectator chat
  canSeeHands: boolean; // See all players' hands
  canSeeTimers: boolean; // See turn timers
  isHidden: boolean; // Hidden from other spectators
}

export interface SpectatorPermissions {
  canChat: boolean;
  canSeeHands: boolean;
  canSeeTimers: boolean;
  isHidden: boolean;
}

// Default spectator permissions
export const DEFAULT_SPECTATOR_PERMISSIONS: SpectatorPermissions = {
  canChat: true,
  canSeeHands: false,
  canSeeTimers: true,
  isHidden: false,
};

// Spectator slot management
export function createSpectatorSlot(spectator: Spectator): PlayerSlot {
  return {
    id: `spectator-${spectator.id}`,
    type: 'spectator',
    spectator,
    isConnected: true,
  };
}

// Check if a game has spectator slots available
export function hasSpectatorSlots(
  slots: PlayerSlot[],
  maxSpectators: number = 10
): boolean {
  const spectatorCount = slots.filter((s) => s.type === 'spectator').length;
  return spectatorCount < maxSpectators;
}

// Get all spectators from slots
export function getSpectators(slots: PlayerSlot[]): Spectator[] {
  return slots
    .filter((slot) => slot.type === 'spectator' && slot.spectator)
    .map((slot) => slot.spectator!);
}

// Check if a player ID is a spectator
export function isSpectator(
  playerId: string,
  slots: PlayerSlot[]
): boolean {
  const slot = slots.find((s) => s.id === playerId);
  return slot?.type === 'spectator';
}

// Format spectator display name
export function formatSpectatorName(spectator: Spectator, isHidden: boolean): string {
  if (isHidden && spectator.isHidden) {
    return 'Anonymous';
  }
  return spectator.name;
}
