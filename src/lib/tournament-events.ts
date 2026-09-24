export type TournamentFormat =
  "single-elimination" | "double-elimination" | "swiss";
export type TournamentStatus = "registration" | "active" | "completed";
export type EventFormat =
  | "standard"
  | "draft"
  | "sealed"
  | "commander"
  | "modern"
  | "legacy"
  | "pauper"
  | "single-elimination"
  | "double-elimination"
  | "swiss";
export type EventType = "regular" | "championship" | "qualifier";
export type EventStatus = TournamentStatus;

export interface Player {
  id: string;
  name: string;
  seed?: number;
}

export interface MatchResult {
  winnerId: string;
  loserId: string;
  score?: [number, number];
}

export interface Match {
  id: string;
  round: number;
  player1Id: string | null;
  player2Id: string | null;
  result?: MatchResult;
  bye: boolean;
  nextMatchId?: string;
}

export interface Standing {
  playerId: string;
  name: string;
  wins: number;
  losses: number;
  draws: number;
  matchPoints: number;
  opponentMatchWinPercentages: number;
  gameWinPercentages?: number;
  tiebreakers: number[];
}

export interface EventStandings extends Standing {
  placement: number;
  deckName?: string;
}

export interface PrizeBreakdown {
  position: number;
  percentage: number;
}

export interface TournamentEvent {
  id: string;
  name: string;
  format: EventFormat | TournamentFormat;
  status: TournamentStatus;
  players: Player[];
  matches: Match[];
  currentRound: number;
  totalRounds: number;
  standings: Standing[];
  prizes: PrizeBreakdown[];
  eventType?: EventType;
  createdAt: number;
  completedAt?: number;
}

export interface EventHistory {
  id: string;
  name: string;
  format: EventFormat | TournamentFormat;
  eventType: EventType;
  result: "1st" | "2nd" | "3rd-8th" | "9th+" | "dnf";
  date: number;
  placement?: number;
  prizesWon?: number;
}

export const TOURNAMENT_STORAGE_KEYS = {
  ACTIVE_EVENTS: "pn:tournament:active",
  EVENT_HISTORY: "pn:tournament:history",
  MY_REGISTRATIONS: "pn:tournament:my-registrations",
} as const;

export const DEFAULT_PRIZES: PrizeBreakdown[] = [
  { position: 1, percentage: 30 },
  { position: 2, percentage: 20 },
  { position: 3, percentage: 12 },
  { position: 4, percentage: 8 },
  { position: 5, percentage: 5 },
  { position: 6, percentage: 5 },
  { position: 7, percentage: 5 },
  { position: 8, percentage: 5 },
];

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

function swissPairing(
  standings: Standing[],
  players: Player[],
): [string, string][] {
  const paired: Set<string> = new Set();
  const pairings: [string, string][] = [];

  const available = [...standings.filter((s) => !paired.has(s.playerId))];

  for (let i = 0; i < available.length; i++) {
    const p1 = available[i];
    if (paired.has(p1.playerId)) continue;

    for (let j = i + 1; j < available.length; j++) {
      const p2 = available[j];
      if (paired.has(p2.playerId)) continue;

      pairings.push([p1.playerId, p2.playerId]);
      paired.add(p1.playerId);
      paired.add(p2.playerId);
      break;
    }
  }

  const unpairedPlayers = players.filter((p) => !paired.has(p.id));
  for (let i = 0; i < unpairedPlayers.length; i += 2) {
    if (i + 1 < unpairedPlayers.length) {
      pairings.push([unpairedPlayers[i].id, unpairedPlayers[i + 1].id]);
    } else {
      pairings.push([unpairedPlayers[i].id, unpairedPlayers[i].id]);
    }
  }

  return pairings;
}

function calculateTiebreakers(
  standing: Standing,
  allStandings: Standing[],
): number[] {
  const omwp = calculateOpponentMatchWinPercentage(standing, allStandings);
  const gwp =
    standing.gameWinPercentages ??
    (standing.wins + standing.losses > 0
      ? (standing.wins * 3 + standing.draws) /
        ((standing.wins + standing.losses) * 3)
      : 0);

  return [standing.matchPoints, omwp, gwp];
}

function calculateOpponentMatchWinPercentage(
  standing: Standing,
  allStandings: Standing[],
): number {
  const opponents = allStandings.filter(
    (s) => s.playerId !== standing.playerId && (s.wins > 0 || s.losses > 0),
  );
  if (opponents.length === 0) return 0;

  const totalOppWins = opponents.reduce((sum, o) => sum + o.wins, 0);
  const totalOppMatches = opponents.reduce(
    (sum, o) => sum + o.wins + o.losses,
    0,
  );

  return totalOppMatches > 0 ? totalOppWins / totalOppMatches : 0;
}

export function createTournament(
  name: string,
  format: TournamentFormat,
  playerNames: string[],
  prizes: PrizeBreakdown[] = DEFAULT_PRIZES,
  totalRounds?: number,
): TournamentEvent {
  const players: Player[] = playerNames.map((name, idx) => ({
    id: generateId(),
    name,
    seed: idx + 1,
  }));

  const sortedPlayers = [...players].sort(
    (a, b) => (a.seed ?? 0) - (b.seed ?? 0),
  );

  let initialMatches: Match[] = [];
  let rounds = totalRounds ?? Math.ceil(Math.log2(players.length)) + 1;

  if (format === "single-elimination") {
    const bracketSize = Math.pow(2, Math.ceil(Math.log2(players.length)));
    const seededPlayers = [...sortedPlayers];
    while (seededPlayers.length < bracketSize) {
      seededPlayers.push({ id: generateId(), name: "BYE" });
    }

    initialMatches = createBracketMatches(seededPlayers, 1, bracketSize);
  } else if (format === "swiss") {
    initialMatches = createSwissRoundMatches(sortedPlayers, 1);
    rounds = Math.ceil(Math.log2(players.length));
  }

  const standings: Standing[] = players.map((p) => ({
    playerId: p.id,
    name: p.name,
    wins: 0,
    losses: 0,
    draws: 0,
    matchPoints: 0,
    opponentMatchWinPercentages: 0,
    tiebreakers: [0, 0, 0],
  }));

  return {
    id: generateId(),
    name,
    format,
    status: "registration",
    players,
    matches: initialMatches,
    currentRound: 0,
    totalRounds: rounds,
    standings,
    prizes,
    createdAt: Date.now(),
  };
}

export function createTournamentEvent(
  name: string,
  format: EventFormat,
  eventType: EventType,
  _organizerId: string,
  options?: Partial<TournamentEvent>,
): TournamentEvent {
  const event: TournamentEvent = {
    id: generateId(),
    name,
    format,
    status: "registration",
    players: [],
    matches: [],
    currentRound: 0,
    totalRounds: Math.ceil(Math.log2(options?.players?.length ?? 2)) + 1,
    standings: [],
    prizes: options?.prizes ?? DEFAULT_PRIZES,
    eventType,
    createdAt: Date.now(),
    ...options,
  };
  return event;
}

function createBracketMatches(
  players: Player[],
  startRound: number,
  bracketSize: number,
): Match[] {
  const matches: Match[] = [];
  const roundCount = Math.log2(bracketSize);

  for (let r = 0; r < roundCount; r++) {
    const round = startRound + r;
    const matchesInRound = bracketSize / Math.pow(2, r + 1);

    for (let i = 0; i < matchesInRound; i++) {
      const match: Match = {
        id: generateId(),
        round,
        player1Id: null,
        player2Id: null,
        bye: false,
      };
      matches.push(match);
    }
  }

  const seeded = [...players].sort(() => Math.random() - 0.5);
  const firstRoundMatches = matches.filter((m) => m.round === startRound);

  for (let i = 0; i < seeded.length; i += 2) {
    const matchIdx = Math.floor(i / 2);
    if (matchIdx < firstRoundMatches.length) {
      firstRoundMatches[matchIdx].player1Id = seeded[i].id;
      firstRoundMatches[matchIdx].player2Id = seeded[i + 1]?.id ?? null;
    }
  }

  return matches;
}

function createSwissRoundMatches(players: Player[], round: number): Match[] {
  const pairings = swissPairing([], players);
  return pairings.map(([p1, p2]) => ({
    id: generateId(),
    round,
    player1Id: p1,
    player2Id: p2,
    bye: p1 === p2,
  }));
}

export function startTournament(event: TournamentEvent): TournamentEvent {
  if (event.status !== "registration") {
    throw new Error("Tournament can only be started from registration status");
  }

  const updatedEvent = { ...event, status: "active" as TournamentStatus };

  if (updatedEvent.format === "swiss") {
    const pairings = swissPairing(updatedEvent.standings, updatedEvent.players);
    const newMatches = pairings.map(([p1, p2]) => ({
      id: generateId(),
      round: 1,
      player1Id: p1,
      player2Id: p2,
      bye: p1 === p2,
    }));

    return { ...updatedEvent, matches: newMatches, currentRound: 1 };
  }

  return { ...updatedEvent, currentRound: 1 };
}

export function startEvent(event: TournamentEvent): TournamentEvent {
  return startTournament(event);
}

export function recordMatchResult(
  event: TournamentEvent,
  matchId: string,
  winnerId: string,
  score?: [number, number],
): TournamentEvent {
  const match = event.matches.find((m) => m.id === matchId);
  if (!match) throw new Error("Match not found");

  if (match.player1Id !== winnerId && match.player2Id !== winnerId) {
    throw new Error("Winner must be a participant in the match");
  }

  const loserId =
    match.player1Id === winnerId ? match.player2Id : match.player1Id;

  let updatedMatch: Match;
  if (match.bye) {
    updatedMatch = { ...match, result: { winnerId, loserId: winnerId, score } };
  } else {
    if (!loserId) throw new Error("Match must have a loser");
    updatedMatch = { ...match, result: { winnerId, loserId, score } };
  }

  const updatedMatches = event.matches.map((m) =>
    m.id === matchId ? updatedMatch : m,
  );

  let updatedStandings = event.standings.map((s) => ({ ...s }));

  if (match.bye) {
    const byePlayer = updatedStandings.find((s) => s.playerId === winnerId);
    if (byePlayer) {
      byePlayer.wins += 1;
      byePlayer.matchPoints += 3;
    }
  } else {
    const winner = updatedStandings.find((s) => s.playerId === winnerId);
    const loser = loserId
      ? updatedStandings.find((s) => s.playerId === loserId)
      : null;

    if (winner) {
      winner.wins += 1;
      winner.matchPoints += 3;
    }
    if (loser) {
      loser.losses += 1;
    }
  }

  updatedStandings = updatedStandings.map((s) => ({
    ...s,
    opponentMatchWinPercentages: calculateOpponentMatchWinPercentage(
      s,
      updatedStandings,
    ),
    tiebreakers: calculateTiebreakers(s, updatedStandings),
  }));

  updatedStandings.sort((a, b) => {
    if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
    for (let i = 0; i < a.tiebreakers.length; i++) {
      if (b.tiebreakers[i] !== a.tiebreakers[i]) {
        return (b.tiebreakers[i] ?? 0) - (a.tiebreakers[i] ?? 0);
      }
    }
    return 0;
  });

  return {
    ...event,
    matches: updatedMatches,
    standings: updatedStandings,
  };
}

export function advanceRound(event: TournamentEvent): TournamentEvent {
  if (event.status !== "active") {
    throw new Error("Tournament must be active to advance round");
  }

  const nextRound = event.currentRound + 1;

  if (event.format === "single-elimination") {
    const currentRoundMatches = event.matches.filter(
      (m) => m.round === event.currentRound,
    );
    const allDecided = currentRoundMatches.every((m) => m.result !== undefined);

    if (!allDecided) {
      throw new Error("All matches in current round must be completed");
    }

    const nextRoundMatches = event.matches.filter((m) => m.round === nextRound);
    const currentWinners = currentRoundMatches.map((m) => m.result!.winnerId);

    for (let i = 0; i < nextRoundMatches.length; i++) {
      const nextMatch = nextRoundMatches[i];
      const winner1Idx = i * 2;
      const winner2Idx = i * 2 + 1;

      if (nextMatch) {
        nextMatch.player1Id = currentWinners[winner1Idx] ?? null;
        nextMatch.player2Id = currentWinners[winner2Idx] ?? null;
      }
    }

    const finalMatch = event.matches.find(
      (m) => m.round === Math.max(...event.matches.map((mm) => mm.round)),
    );
    const hasChampion = finalMatch && finalMatch.result;

    if (hasChampion || nextRound > event.totalRounds) {
      return {
        ...event,
        currentRound: nextRound,
        status: "completed",
        completedAt: Date.now(),
      };
    }

    return { ...event, currentRound: nextRound };
  }

  if (event.format === "swiss") {
    if (nextRound > event.totalRounds) {
      return {
        ...event,
        currentRound: nextRound,
        status: "completed",
        completedAt: Date.now(),
      };
    }

    const pairings = swissPairing(event.standings, event.players);
    const newMatches = pairings.map(([p1, p2]) => ({
      id: generateId(),
      round: nextRound,
      player1Id: p1,
      player2Id: p2,
      bye: p1 === p2,
    }));

    return {
      ...event,
      matches: [...event.matches, ...newMatches],
      currentRound: nextRound,
    };
  }

  return { ...event, currentRound: nextRound };
}

export function calculateStandings(event: TournamentEvent): Standing[] {
  return [...event.standings].sort((a, b) => {
    if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
    for (let i = 0; i < a.tiebreakers.length; i++) {
      if (b.tiebreakers[i] !== a.tiebreakers[i]) {
        return (b.tiebreakers[i] ?? 0) - (a.tiebreakers[i] ?? 0);
      }
    }
    return 0;
  });
}

export function distributePrizes(
  event: TournamentEvent,
  prizePool: number,
): Map<string, number> {
  if (event.status !== "completed") {
    throw new Error(
      "Prizes can only be distributed after tournament is completed",
    );
  }

  const payouts = new Map<string, number>();
  const sortedStandings = calculateStandings(event);

  let distributedPercentage = 0;

  for (let i = 0; i < sortedStandings.length && i < event.prizes.length; i++) {
    const prize = event.prizes[i];
    const playerId = sortedStandings[i].playerId;
    const amount = (prize.percentage / 100) * prizePool;

    payouts.set(playerId, amount);
    distributedPercentage += prize.percentage;
  }

  const remainingPercentage = 100 - distributedPercentage;
  const remainingPlayers = sortedStandings.slice(event.prizes.length);

  const remainingAmount = (remainingPercentage / 100) * prizePool;
  const perPlayerAmount =
    remainingPlayers.length > 0 ? remainingAmount / remainingPlayers.length : 0;

  for (const standing of remainingPlayers) {
    payouts.set(standing.playerId, perPlayerAmount);
  }

  return payouts;
}

export function getMatchForPlayer(
  event: TournamentEvent,
  playerId: string,
): Match | null {
  return (
    event.matches.find(
      (m) =>
        m.round === event.currentRound &&
        (m.player1Id === playerId || m.player2Id === playerId),
    ) ?? null
  );
}

export function getTournamentChampion(event: TournamentEvent): Player | null {
  if (event.status !== "completed") return null;

  if (event.format === "single-elimination") {
    const finalRound = Math.max(...event.matches.map((m) => m.round));
    const finalMatch = event.matches.find((m) => m.round === finalRound);
    if (finalMatch?.result) {
      return (
        event.players.find((p) => p.id === finalMatch.result!.winnerId) ?? null
      );
    }
  }

  const finalStandings = calculateStandings(event);
  return (
    event.players.find((p) => p.id === finalStandings[0]?.playerId) ?? null
  );
}

export function registerPlayer(
  event: TournamentEvent,
  playerId: string,
  displayName: string,
  _deckName?: string,
): TournamentEvent {
  if (event.players.some((p) => p.id === playerId)) {
    throw new Error("Player already registered");
  }

  return {
    ...event,
    players: [...event.players, { id: playerId, name: displayName }],
    standings: [
      ...event.standings,
      {
        playerId,
        name: displayName,
        wins: 0,
        losses: 0,
        draws: 0,
        matchPoints: 0,
        opponentMatchWinPercentages: 0,
        tiebreakers: [0, 0, 0],
      },
    ],
  };
}

export function unregisterPlayer(
  event: TournamentEvent,
  playerId: string,
): TournamentEvent {
  return {
    ...event,
    players: event.players.filter((p) => p.id !== playerId),
    standings: event.standings.filter((s) => s.playerId !== playerId),
  };
}

export function openRegistration(event: TournamentEvent): TournamentEvent {
  if (event.status !== "registration") {
    throw new Error(
      "Can only open registration for events in registration status",
    );
  }
  return { ...event, status: "registration" };
}

export function completeEvent(
  event: TournamentEvent,
  standings: EventStandings[],
): TournamentEvent {
  return {
    ...event,
    status: "completed",
    completedAt: Date.now(),
    standings: standings.map((s) => ({
      playerId: s.playerId,
      name: s.name,
      wins: s.wins,
      losses: s.losses,
      draws: s.draws,
      matchPoints: s.matchPoints,
      opponentMatchWinPercentages: s.opponentMatchWinPercentages,
      gameWinPercentages: s.gameWinPercentages,
      tiebreakers: s.tiebreakers,
    })),
  };
}

export function cancelEvent(event: TournamentEvent): TournamentEvent {
  return {
    ...event,
    status: "completed",
    completedAt: Date.now(),
  };
}

export function addToEventHistory(
  history: EventHistory[],
  event: TournamentEvent,
  result: EventHistory["result"],
): EventHistory[] {
  const myStanding = event.standings[0];
  const newEntry: EventHistory = {
    id: event.id,
    name: event.name,
    format: event.format,
    eventType: event.eventType ?? "regular",
    result,
    date: Date.now(),
    placement: myStanding ? event.standings.indexOf(myStanding) + 1 : undefined,
  };
  return [newEntry, ...history].slice(0, 100);
}

export function getTotalPrizes(history: EventHistory[]): {
  points: number;
  events: number;
} {
  const points = history.reduce((sum, e) => {
    if (e.result === "1st") return sum + 30;
    if (e.result === "2nd") return sum + 20;
    if (e.result === "3rd-8th") return sum + 8;
    if (e.result === "9th+") return sum + 2;
    return sum;
  }, 0);
  return { points, events: history.length };
}
