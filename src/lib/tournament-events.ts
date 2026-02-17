/**
 * Tournament Event System
 * 
 * Comprehensive tournament event management for organized play.
 * Builds on existing Swiss pairing and bracket components.
 * 
 * Issue #256: Implement tournament event system
 */

import { PlayerId } from './game-state/types';

// ============================================================
// Types
// ============================================================

export type EventFormat = 'standard' | 'draft' | 'sealed' | 'commander' | 'modern' | 'legacy' | 'pauper';

export type EventStatus = 'setup' | 'registration' | 'in_progress' | 'completed' | 'cancelled';

export type EventType = 'swiss' | 'bracket' | 'round_robin' | 'league';

export type PodStatus = 'waiting' | 'in_progress' | 'completed';

export interface TournamentEvent {
  id: string;
  name: string;
  description?: string;
  format: EventFormat;
  eventType: EventType;
  status: EventStatus;
  
  // Registration
  registrationOpen: boolean;
  maxPlayers: number;
  minPlayers: number;
  registeredPlayers: Registration[];
  
  // Structure
  rounds: number;
  topCut?: number;
  
  // Timing
  startTime?: number;
  endTime?: number;
  registrationDeadline?: number;
  roundDuration?: number; // minutes
  
  // Pods/Tables
  pods: Pod[];
  
  // Prize Structure
  prizeStructure: PrizeStructure;
  
  // Results
  standings: EventStandings[];
  champion?: Registration;
  
  // Metadata
  createdAt: number;
  createdBy: PlayerId;
}

export interface Registration {
  playerId: PlayerId;
  displayName: string;
  deckName?: string;
  seed?: number;
  registeredAt: number;
  checkedIn: boolean;
  dropRound?: number;
}

export interface Pod {
  id: string;
  podNumber: number;
  tableIds: string[];
  status: PodStatus;
  round: number;
}

export interface PrizeStructure {
  name: string;
  description?: string;
  prizes: Prize[];
}

export interface Prize {
  place: number; // 1 = 1st, 2 = 2nd, etc.
  minPlacement: number;
  maxPlacement: number;
  reward: string; // e.g., "3 Playtester Crates", "1000 Gold"
  points?: number;
}

export interface EventStandings {
  playerId: PlayerId;
  displayName: string;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  placement: number;
  prizeClaimed?: boolean;
}

export interface EventHistory {
  id: string;
  eventName: string;
  format: EventFormat;
  eventType: EventType;
  playerCount: number;
  date: number;
  result: '1st' | '2nd' | '3rd-8th' | '9th+' | 'dnf';
  prize?: string;
}

// ============================================================
// Storage Keys
// ============================================================

export const TOURNAMENT_STORAGE_KEYS = {
  ACTIVE_EVENTS: 'planar-nexus-active-events',
  EVENT_HISTORY: 'planar-nexus-event-history',
  MY_REGISTRATIONS: 'planar-nexus-my-registrations',
} as const;

// ============================================================
// Event Creation
// ============================================================

/**
 * Create a new tournament event
 */
export function createTournamentEvent(
  name: string,
  format: EventFormat,
  eventType: EventType,
  createdBy: PlayerId,
  options?: Partial<TournamentEvent>
): TournamentEvent {
  return {
    id: `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    format,
    eventType,
    status: 'setup',
    registrationOpen: false,
    maxPlayers: 32,
    minPlayers: 4,
    registeredPlayers: [],
    rounds: calculateRounds(32),
    pods: [],
    prizeStructure: getDefaultPrizeStructure(eventType, format),
    standings: [],
    createdAt: Date.now(),
    createdBy,
    ...options,
  };
}

/**
 * Calculate recommended rounds based on player count
 */
export function calculateRounds(playerCount: number): number {
  if (playerCount <= 4) return 2;
  if (playerCount <= 8) return 3;
  if (playerCount <= 16) return 4;
  if (playerCount <= 32) return 5;
  if (playerCount <= 64) return 6;
  return 7;
}

/**
 * Get default prize structure based on event type and format
 */
export function getDefaultPrizeStructure(
  eventType: EventType,
  format: EventFormat
): PrizeStructure {
  const basePrizes: Prize[] = [
    { place: 1, minPlacement: 1, maxPlacement: 1, reward: 'Champion', points: 100 },
    { place: 2, minPlacement: 2, maxPlacement: 2, reward: 'Finalist', points: 80 },
    { place: 3, minPlacement: 3, maxPlacement: 4, reward: 'Top 4', points: 60 },
    { place: 5, minPlacement: 5, maxPlacement: 8, reward: 'Top 8', points: 40 },
    { place: 9, minPlacement: 9, maxPlacement: 16, reward: 'Participation', points: 20 },
  ];

  // Adjust based on player count
  if (format === 'commander') {
    return {
      name: 'Commander Pod Play',
      description: 'Friendly Commander pods with optional prize support',
      prizes: basePrizes.map(p => ({ ...p, points: Math.floor(p.points! * 0.5) })),
    };
  }

  if (eventType === 'league') {
    return {
      name: 'League Season',
      description: 'Long-running league with weekly matches',
      prizes: [
        { place: 1, minPlacement: 1, maxPlacement: 1, reward: 'League Champion', points: 200 },
        { place: 2, minPlacement: 2, maxPlacement: 3, reward: 'Top 3', points: 150 },
        { place: 4, minPlacement: 4, maxPlacement: 8, reward: 'Top 8', points: 100 },
      ],
    };
  }

  return {
    name: 'Standard Prize Table',
    prizes: basePrizes,
  };
}

// ============================================================
// Registration
// ============================================================

/**
 * Register a player for an event
 */
export function registerPlayer(
  event: TournamentEvent,
  playerId: PlayerId,
  displayName: string,
  deckName?: string
): TournamentEvent {
  if (event.registeredPlayers.length >= event.maxPlayers) {
    throw new Error('Event is full');
  }

  if (event.registeredPlayers.some(r => r.playerId === playerId)) {
    throw new Error('Already registered');
  }

  const registration: Registration = {
    playerId,
    displayName,
    deckName,
    seed: event.registeredPlayers.length + 1,
    registeredAt: Date.now(),
    checkedIn: false,
  };

  return {
    ...event,
    registeredPlayers: [...event.registeredPlayers, registration],
  };
}

/**
 * Unregister a player from an event
 */
export function unregisterPlayer(
  event: TournamentEvent,
  playerId: PlayerId
): TournamentEvent {
  return {
    ...event,
    registeredPlayers: event.registeredPlayers.filter(r => r.playerId !== playerId),
  };
}

/**
 * Check in a player
 */
export function checkInPlayer(
  event: TournamentEvent,
  playerId: PlayerId
): TournamentEvent {
  return {
    ...event,
    registeredPlayers: event.registeredPlayers.map(r =>
      r.playerId === playerId ? { ...r, checkedIn: true } : r
    ),
  };
}

/**
 * Drop a player from the event
 */
export function dropPlayer(
  event: TournamentEvent,
  playerId: PlayerId,
  currentRound: number
): TournamentEvent {
  return {
    ...event,
    registeredPlayers: event.registeredPlayers.map(r =>
      r.playerId === playerId ? { ...r, dropRound: currentRound } : r
    ),
  };
}

// ============================================================
// Event Management
// ============================================================

/**
 * Open registration for an event
 */
export function openRegistration(event: TournamentEvent): TournamentEvent {
  return {
    ...event,
    status: 'registration',
    registrationOpen: true,
    registrationDeadline: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
  };
}

/**
 * Close registration and start the event
 */
export function startEvent(event: TournamentEvent): TournamentEvent {
  if (event.registeredPlayers.length < event.minPlayers) {
    throw new Error('Not enough players registered');
  }

  // Create pods if needed
  const pods = createPods(event);

  return {
    ...event,
    status: 'in_progress',
    registrationOpen: false,
    startTime: Date.now(),
    pods,
  };
}

/**
 * Create pods for the event
 */
function createPods(event: TournamentEvent): Pod[] {
  const playersPerPod = 4;
  const numPods = Math.ceil(event.registeredPlayers.length / playersPerPod);
  
  return Array.from({ length: numPods }, (_, i) => ({
    id: `pod-${i + 1}`,
    podNumber: i + 1,
    tableIds: [],
    status: 'waiting' as PodStatus,
    round: 0,
  }));
}

/**
 * Complete the event
 */
export function completeEvent(
  event: TournamentEvent,
  standings: EventStandings[]
): TournamentEvent {
  const champion = event.registeredPlayers.find(
    r => r.playerId === standings[0]?.playerId
  );

  return {
    ...event,
    status: 'completed',
    standings,
    champion,
    endTime: Date.now(),
  };
}

/**
 * Cancel an event
 */
export function cancelEvent(event: TournamentEvent): TournamentEvent {
  return {
    ...event,
    status: 'cancelled',
    registrationOpen: false,
  };
}

// ============================================================
// Event History
// ============================================================

/**
 * Add completed event to history
 */
export function addToEventHistory(
  history: EventHistory[],
  event: TournamentEvent,
  result: EventHistory['result'],
  prize?: string
): EventHistory[] {
  const entry: EventHistory = {
    id: `history-${Date.now()}`,
    eventName: event.name,
    format: event.format,
    eventType: event.eventType,
    playerCount: event.registeredPlayers.length,
    date: event.endTime || Date.now(),
    result,
    prize,
  };

  return [entry, ...history].slice(0, 100); // Keep last 100
}

/**
 * Get total prizes won from history
 */
export function getTotalPrizes(history: EventHistory[]): { points: number; events: number } {
  return history.reduce(
    (acc, entry) => ({
      points: acc.points + (entry.result === '1st' ? 50 : entry.result === '2nd' ? 30 : entry.result === '3rd-8th' ? 10 : 0),
      events: acc.events + 1,
    }),
    { points: 0, events: 0 }
  );
}

// ============================================================
// Format Helpers
// ============================================================

/**
 * Get display name for format
 */
export function getFormatDisplayName(format: EventFormat): string {
  const names: Record<EventFormat, string> = {
    standard: 'Standard',
    draft: 'Draft',
    sealed: 'Sealed',
    commander: 'Commander',
    modern: 'Modern',
    legacy: 'Legacy',
    pauper: 'Pauper',
  };
  return names[format];
}

/**
 * Get color for format
 */
export function getFormatColor(format: EventFormat): string {
  const colors: Record<EventFormat, string> = {
    standard: '#f59e0b',
    draft: '#8b5cf6',
    sealed: '#a855f7',
    commander: '#ef4444',
    modern: '#3b82f6',
    legacy: '#6366f1',
    pauper: '#22c55e',
  };
  return colors[format];
}

/**
 * Get description for event type
 */
export function getEventTypeDescription(eventType: EventType): string {
  const descriptions: Record<EventType, string> = {
    swiss: 'Swiss rounds - everyone plays all rounds, ranked by points',
    bracket: 'Single or double elimination bracket',
    round_robin: 'Everyone plays everyone once',
    league: 'Long-running event with flexible scheduling',
  };
  return descriptions[eventType];
}
