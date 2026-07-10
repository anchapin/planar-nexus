/**
 * Rochester Draft Generator (issue #1444)
 *
 * Implements the Rochester draft side-event:
 *   - N seats (3–5) sit around a single communal pool of N × 15 cards.
 *   - All cards start face-up in the centre of the table.
 *   - Players pick one card per turn, in clockwise order, until the pool
 *     is empty.
 *   - Each player ends with exactly N×15 cards (== community pool size).
 *
 * The picks are openly visible to every seat, so the AI neighbor logic
 * needs a `tableRead` (the prior picks) when weighting parity. This module
 * is intentionally agnostic about the AI heuristic — it just supplies the
 * state-machine primitives.
 *
 * Reuses `generatePack` from the sealed generator so card distribution
 * (rarity, colour balance) matches what we'd see at a real table.
 */

import type { ScryfallCard } from "@/app/actions";
import type {
  AiDifficulty,
  AiNeighbor,
  CreateRochesterSessionOptions,
  PoolCard,
  RochesterPlayerCount,
  RochesterSession,
} from "./types";
import {
  PICKS_PER_ROCHESTER_SEAT,
  ROCHESTER_PLAYER_COUNTS,
} from "./types";
import { generatePack } from "./sealed-generator";
import { saveRochesterSession } from "./pool-storage";

// ============================================================================
// Constants
// ============================================================================

/** Cards per booster pack (mirrors sealed-generator). */
const CARDS_PER_PACK = 14;
export {
  PICKS_PER_ROCHESTER_SEAT,
  ROCHESTER_PLAYER_COUNTS,
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Fisher-Yates shuffle. We export it for the test harness so it can verify
 * deterministic reshuffling if needed; the runtime itself never depends on
 * the export.
 */
export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Convert free-form `ScryfallCard[]` (from `generatePack`) into PoolCards
 * with `packId`/`packSlot` metadata.
 *
 * In Rochester we treat the entire communal pool as a single logical pack
 * (packId === -1, slot is the index within the communal pool).
 */
function packToPoolCards(
  cards: readonly ScryfallCard[],
  startSlot: number,
): PoolCard[] {
  const now = new Date().toISOString();
  return cards.map((card, offset): PoolCard => {
    const slot = startSlot + offset;
    return {
      ...card,
      packId: -1,
      packSlot: slot,
      addedAt: now,
    };
  });
}

/**
 * Validate a Rochester player count is one of the accepted values.
 *
 * Issue #1444 acceptance criteria specifies (3, 4, 5) players. Anything
 * outside that range throws — we refuse to silently build an oddly-sized
 * pool where `picksBySeat[N]` won't satisfy the invariant.
 */
export function assertRochesterPlayerCount(
  count: number,
): asserts count is RochesterPlayerCount {
  if (!(ROCHESTER_PLAYER_COUNTS as readonly number[]).includes(count)) {
    throw new Error(
      `Invalid Rochester player count: ${count}. Expected one of ${ROCHESTER_PLAYER_COUNTS.join(", ")}.`,
    );
  }
}

// ============================================================================
// Pool Generation
// ============================================================================

/**
 * Total pool size for a given player count. 3 → 45, 4 → 60, 5 → 75.
 * Matches the issue's acceptance criteria verbatim.
 */
export function rochesterPoolSize(playerCount: RochesterPlayerCount): number {
  return playerCount * PICKS_PER_ROCHESTER_SEAT;
}

/**
 * Generate a Rochester communal pool of exactly `playerCount × 15` cards.
 *
 * Implementation note: we round up to the next full booster (`ceil(target / 14)`)
 * and shuffle. Excess cards are discarded. In practice this means:
 *   - 3 players → 3 packs (42 cards) → trim to 45 (need extra 3 from a 4th pack).
 *
 * To avoid throwing when a set is sparse, we always use the same fallback
 * path the sealed generator uses (commons/uncommons/rare pools with
 * synthetic fill), so the count is deterministic regardless of set data.
 */
export async function generateRochesterPool(
  setCode: string,
  playerCount: RochesterPlayerCount,
): Promise<PoolCard[]> {
  assertRochesterPlayerCount(playerCount);

  const target = rochesterPoolSize(playerCount);
  const packsNeeded = Math.ceil(target / CARDS_PER_PACK);

  // Collect cards pack by pack.
  const flat: ScryfallCard[] = [];
  for (let i = 0; i < packsNeeded; i++) {
    const pack = await generatePack(setCode);
    flat.push(...pack.commons, ...pack.uncommons, pack.rareOrMythic);
  }

  // Shuffle before trimming so we don't keep only the early pack's cards.
  const shuffled = shuffle(flat).slice(0, target);

  if (shuffled.length < target) {
    // This path is unreachable in practice (generatePack always returns 14
    // cards thanks to the sealed generator's fallback), but we keep the
    // guard so the test harness can detect data regressions loudly.
    throw new Error(
      `Rochester pool generator under-filled: got ${shuffled.length}/${target}.`,
    );
  }

  return packToPoolCards(shuffled, 0);
}

// ============================================================================
// Session Creation
// ============================================================================

/**
 * Create a fresh Rochester session and persist it to IndexedDB.
 *
 * Default seat count is 3 (the issue's smallest acceptance target). The
 * communal pool is `playerCount × 15` cards, all face-up in the centre.
 */
export async function createRochesterSession(
  setCode: string,
  setName: string,
  options: CreateRochesterSessionOptions = {},
): Promise<RochesterSession> {
  const playerCount: RochesterPlayerCount = options.playerCount ?? 3;
  assertRochesterPlayerCount(playerCount);

  const communalPool = await generateRochesterPool(setCode, playerCount);

  // Per-seat AI neighbors for all non-user seats. For a 3-player table that's
  // seats 1 and 2; for a 5-player table it's seats 1..4. The user is seat 0.
  const aiNeighbors: Record<number, AiNeighbor> = {};
  const difficulty: AiDifficulty = options.aiDifficulty ?? "medium";
  for (let seat = 1; seat < playerCount; seat++) {
    aiNeighbors[seat] = {
      enabled: true,
      difficulty,
      pickDelay: 1500,
      state: {
        pool: [],
        isPicking: false,
        pickStartTime: null,
        lastPickReason: null,
        archetypeSignals: [],
      },
    };
  }

  const session: RochesterSession = {
    id: crypto.randomUUID(),
    setCode,
    setName,
    mode: "rochester",
    status: "in_progress",
    pool: communalPool, // initial pool also exposed on LimitedSession.pool
    deck: [],
    picksBySeat: Object.fromEntries(
      Array.from({ length: playerCount }, (_, i) => [i, [] as PoolCard[]]),
    ),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rochesterState: "intro",
    playerCount,
    communalPool,
    currentSeatIndex: 0,
    picksTaken: 0,
    aiNeighbors,
  };

  await saveRochesterSession(session);
  return session;
}

// ============================================================================
// State Helpers
// ============================================================================

/**
 * Whose seat is currently being asked to pick. Always defined unless the
 * session is complete.
 */
export function currentSeat(session: RochesterSession): number {
  return session.currentSeatIndex;
}

/**
 * Next seat in clockwise (ascending index) order, wrapping at the end.
 * Rochester draft always rotates in a single direction — there is no
 * alternating left/right pass like booster draft.
 */
export function getNextSeat(
  session: RochesterSession,
): number {
  return (session.currentSeatIndex + 1) % session.playerCount;
}

/**
 * True when the communal pool is empty (everyone has picked their share).
 * `pool.length === 0` is sufficient because every successful pick removes
 * exactly one card from the communal pool.
 */
export function isRochesterComplete(session: RochesterSession): boolean {
  return (
    session.rochesterState === "rochester_complete" ||
    session.communalPool.length === 0
  );
}

// ============================================================================
// Pick Operation
// ============================================================================

export class RochesterPickError extends Error {
  constructor(
    public readonly code:
      | "not-found"
      | "wrong-seat"
      | "already-picked"
      | "complete",
    message: string,
  ) {
    super(message);
    this.name = "RochesterPickError";
  }
}

/**
 * Apply a pick to the session. Returns the updated session; the caller is
 * responsible for persisting via `saveRochesterSession`.
 *
 * Invariants:
 *   - `cardId` must exist in the communal pool
 *   - `seatIndex` must equal `currentSeatIndex` (out-of-turn picks throw)
 *   - When the pool empties the session advances to `rochester_complete`
 *
 * Pure: no I/O. Easy to test deterministically.
 */
export function pickFromRochesterPool(
  session: RochesterSession,
  seatIndex: number,
  cardId: string,
): RochesterSession {
  if (isRochesterComplete(session)) {
    throw new RochesterPickError(
      "complete",
      "Rochester draft is already complete — no further picks allowed.",
    );
  }

  if (seatIndex !== session.currentSeatIndex) {
    throw new RochesterPickError(
      "wrong-seat",
      `Seat ${seatIndex} is out of turn. Expected seat ${session.currentSeatIndex}.`,
    );
  }

  const idxInPool = session.communalPool.findIndex((c) => c.id === cardId);
  if (idxInPool < 0) {
    throw new RochesterPickError(
      "not-found",
      `Card ${cardId} is not in the communal pool.`,
    );
  }

  const pickedCard = session.communalPool[idxInPool];
  const newCommunal = [
    ...session.communalPool.slice(0, idxInPool),
    ...session.communalPool.slice(idxInPool + 1),
  ];

  const newPicksBySeat: Record<number, PoolCard[]> = {
    ...session.picksBySeat,
    [seatIndex]: [...(session.picksBySeat[seatIndex] ?? []), pickedCard],
  };

  const picksTaken = session.picksTaken + 1;
  const isLastPick = newCommunal.length === 0;
  const nextSeat = isLastPick
    ? session.currentSeatIndex
    : getNextSeat(session);

  return {
    ...session,
    communalPool: newCommunal,
    picksBySeat: newPicksBySeat,
    picksTaken,
    currentSeatIndex: nextSeat,
    rochesterState: isLastPick ? "rochester_complete" : "picking",
    updatedAt: new Date().toISOString(),
    // Mirror the user's picks onto LimitedSession.pool so the deck-builder
    // surface (which only reads `pool`) sees them.
    pool: newPicksBySeat[0] ?? [],
  };
}

/**
 * Get the most-recent picks across all seats — what an "expert" AI uses to
 * read parity before its next pick. Pure helper; used by parity-aware AI
 * strategies (issue #1444).
 */
export function getTableRead(session: RochesterSession): PoolCard[] {
  return Object.values(session.picksBySeat).flat();
}
