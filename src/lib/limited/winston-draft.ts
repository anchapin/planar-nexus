/**
 * Winston Draft Generator (issue #1444)
 *
 * Implements the Winston draft side-event:
 *   - Three face-down piles of cards (default sizes 6/4/3).
 *   - Active seat picks a pile, flips the top card, and either:
 *       (a) takes the pile — adds the revealed top card *and every card
 *           underneath it* to their pool, or
 *       (b) burns the pile — discards the entire stack.
 *   - The active seat passes to the next neighbour and the cycle repeats
 *     until all piles are exhausted.
 *
 * We intentionally use the "take the whole pile" variant because it
 * matches the rules spelled out in the issue ("takes one card… and the
 * pile"). Underneath-the-top is what produces interesting picks: even a
 * late-game top card can be worth it if it telegraphs strong picks below.
 */

import type { ScryfallCard } from "@/app/actions";
import type {
  AiDifficulty,
  AiNeighbor,
  CreateWinstonSessionOptions,
  PoolCard,
  WinstonPile,
  WinstonSession,
} from "./types";
import { WINSTON_PILE_SIZES } from "./types";
import { generatePack } from "./sealed-generator";
import { saveWinstonSession } from "./pool-storage";
import { shuffle } from "./rochester-draft";

// ============================================================================
// Constants
// ============================================================================

/** Cards per booster pack (mirrors sealed-generator). */
const CARDS_PER_PACK = 14;
export { WINSTON_PILE_SIZES };

// ============================================================================
// Conversion Helpers
// ============================================================================

/**
 * Convert free-form ScryfallCards to PoolCards with `packId`/`packSlot`.
 *
 * In Winston, `packId` is the pile index (0..N-1) and `packSlot` is the
 * offset within that pile, so a UI can render the pile faces predictably.
 */
function pileCardsToPoolCards(
  cards: readonly ScryfallCard[],
  pileIndex: number,
): PoolCard[] {
  const now = new Date().toISOString();
  return cards.map((card, offset) => ({
    ...card,
    packId: pileIndex,
    packSlot: offset,
    addedAt: now,
  }));
}

// ============================================================================
// Pile Generation
// ============================================================================

/**
 * Generate the standard three Winston piles (default sizes 6/4/3).
 *
 * Implementation note: we generate `ceil(sum / 14)` booster packs and split
 * the resulting cards into piles of the requested sizes. This keeps the
 * distribution authentic without needing a separate per-pile generator.
 */
export async function generateWinstonPiles(
  setCode: string,
  pileSizes: readonly number[] = WINSTON_PILE_SIZES,
): Promise<WinstonPile[]> {
  const total = pileSizes.reduce((a, b) => a + b, 0);
  const packsNeeded = Math.max(1, Math.ceil(total / CARDS_PER_PACK));

  const flat: ScryfallCard[] = [];
  for (let i = 0; i < packsNeeded; i++) {
    const pack = await generatePack(setCode);
    flat.push(...pack.commons, ...pack.uncommons, pack.rareOrMythic);
  }

  const shuffled = shuffle(flat).slice(0, total);
  if (shuffled.length < total) {
    throw new Error(
      `Winston pile generator under-filled: got ${shuffled.length}/${total}.`,
    );
  }

  // Slice the shuffled deck into piles.
  const piles: WinstonPile[] = [];
  let cursor = 0;
  pileSizes.forEach((size, i) => {
    const slice = shuffled.slice(cursor, cursor + size);
    cursor += size;
    piles.push({
      id: crypto.randomUUID(),
      cards: pileCardsToPoolCards(slice, i),
      isExhausted: false,
      isBurned: false,
      revealedCard: null,
      awaitingSeat: null,
      initialSize: size,
    });
  });

  return piles;
}

// ============================================================================
// Session Creation
// ============================================================================

/**
 * Create a fresh Winston session and persist it to IndexedDB.
 *
 * Default pile sizes are `(6, 4, 3)` per the issue's acceptance criteria.
 * Number of seats equals the number of piles (one seat per pile, rotating).
 */
export async function createWinstonSession(
  setCode: string,
  setName: string,
  options: CreateWinstonSessionOptions = {},
): Promise<WinstonSession> {
  const pileSizes = options.pileSizes ?? WINSTON_PILE_SIZES;
  if (pileSizes.length === 0) {
    throw new Error("Winston requires at least one pile.");
  }

  const playerCount = pileSizes.length;
  const piles = await generateWinstonPiles(setCode, pileSizes);

  // One AI neighbor per non-user seat (we still model them as `aiNeighbors`
  // even though Winston turns are simple pass-the-chair).
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

  const session: WinstonSession = {
    id: crypto.randomUUID(),
    setCode,
    setName,
    mode: "winston",
    status: "in_progress",
    pool: [], // user's picks live in picksBySeat[0]; LimitedSession.pool
                // remains a derived mirror populated by `applyPicksToPool`.
    deck: [],
    picksBySeat: Object.fromEntries(
      Array.from({ length: playerCount }, (_, i) => [i, [] as PoolCard[]]),
    ),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    winstonState: "intro",
    pileSizes: pileSizes.slice(),
    piles,
    currentSeatIndex: 0,
    aiNeighbors,
  };

  await saveWinstonSession(session);
  return session;
}

// ============================================================================
// State Helpers
// ============================================================================

/** Whose seat is being asked to make the next draw/decide decision. */
export function currentSeat(session: WinstonSession): number {
  return session.currentSeatIndex;
}

/**
 * Next seat in clockwise (ascending index) order, wrapping at the end.
 */
export function getNextSeat(session: WinstonSession): number {
  const seatCount = Object.keys(session.picksBySeat).length;
  return (session.currentSeatIndex + 1) % seatCount;
}

/**
 * Number of piles still in play (not taken, not burned). Once this hits 0
 * the session is complete and we rotate through `complete` state.
 */
export function livePileCount(session: WinstonSession): number {
  return session.piles.filter((p) => !p.isExhausted).length;
}

/**
 * True when every pile has been taken or burned.
 *
 * Equivalent to livePileCount === 0 but kept as a discrete predicate so
 * callers can `if (isWinstonComplete(s))` without recomputing the live
 * pile count over and over.
 */
export function isWinstonComplete(session: WinstonSession): boolean {
  return session.winstonState === "winston_complete" || livePileCount(session) === 0;
}

// ============================================================================
// Pile Operations
// ============================================================================

export class WinstonOperationError extends Error {
  constructor(
    public readonly code:
      | "no-piles-left"
      | "pile-exhausted"
      | "pile-idx-out-of-range"
      | "already-deciding",
    message: string,
  ) {
    super(message);
    this.name = "WinstonOperationError";
  }
}

/**
 * Reveal the top card of the chosen pile (transition `drawing → deciding`).
 * Pure: returns the next session state.
 *
 * Throws if the pile is exhausted, the index is out of range, or the
 * session has already ended.
 */
export function revealWinstonPile(
  session: WinstonSession,
  pileIndex: number,
  seatIndex: number = session.currentSeatIndex,
): WinstonSession {
  if (isWinstonComplete(session)) {
    throw new WinstonOperationError(
      "no-piles-left",
      "Winston draft is already complete.",
    );
  }
  if (pileIndex < 0 || pileIndex >= session.piles.length) {
    throw new WinstonOperationError(
      "pile-idx-out-of-range",
      `Pile index ${pileIndex} out of range (piles=${session.piles.length}).`,
    );
  }
  const pile = session.piles[pileIndex];
  if (pile.isExhausted) {
    throw new WinstonOperationError(
      "pile-exhausted",
      `Pile ${pileIndex} has already been taken or burned.`,
    );
  }
  if (pile.revealedCard !== null) {
    throw new WinstonOperationError(
      "already-deciding",
      `Pile ${pileIndex} is already awaiting a decision.`,
    );
  }

  const top = pile.cards[pile.cards.length - 1];
  if (!top) {
    throw new WinstonOperationError(
      "pile-exhausted",
      `Pile ${pileIndex} has no cards to reveal.`,
    );
  }

  const newPiles = session.piles.map((p, i) =>
    i === pileIndex
      ? { ...p, revealedCard: top, awaitingSeat: seatIndex }
      : p,
  );

  return {
    ...session,
    piles: newPiles,
    winstonState: "deciding",
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Decide to **take** the pile — the seat picks up the revealed card AND
 * every card underneath it.
 *
 * Side effect: pile is marked exhausted, picks move to `picksBySeat[seat]`,
 * and the seat passes clockwise.
 */
export function pickWinstonPile(
  session: WinstonSession,
  pileIndex: number,
  seatIndex: number = session.currentSeatIndex,
): WinstonSession {
  const pile = session.piles[pileIndex];
  if (!pile) {
    throw new WinstonOperationError(
      "pile-idx-out-of-range",
      `Pile index ${pileIndex} out of range.`,
    );
  }
  if (pile.isExhausted) {
    throw new WinstonOperationError(
      "pile-exhausted",
      `Pile ${pileIndex} has already been taken or burned.`,
    );
  }
  if (pile.revealedCard === null) {
    throw new WinstonOperationError(
      "already-deciding",
      `Pile ${pileIndex} has not been revealed yet.`,
    );
  }

  // Take the revealed card PLUS every card beneath it.
  const taken = [...pile.cards];
  const newPiles = session.piles.map((p, i) =>
    i === pileIndex
      ? {
          ...p,
          cards: [],
          revealedCard: null,
          awaitingSeat: null,
          isExhausted: true,
        }
      : p,
  );

  const seatPicks = [...(session.picksBySeat[seatIndex] ?? []), ...taken];
  const newPicksBySeat: Record<number, PoolCard[]> = {
    ...session.picksBySeat,
    [seatIndex]: seatPicks,
  };

  const remainingPiles = newPiles.filter((p) => !p.isExhausted);
  const allDone = remainingPiles.length === 0;

  return {
    ...session,
    piles: newPiles,
    picksBySeat: newPicksBySeat,
    winstonState: allDone ? "winston_complete" : "drawing",
    currentSeatIndex: allDone ? session.currentSeatIndex : getNextSeat(session),
    updatedAt: new Date().toISOString(),
    // Mirror seat-0's picks to LimitedSession.pool for the deck-builder surface.
    pool: allDone ? newPicksBySeat[0] ?? [] : session.pool,
  };
}

/**
 * Decide to **burn** the pile — discard the entire stack without gaining
 * any cards. Pile is marked exhausted (isBurned: true) and the seat passes.
 */
export function burnWinstonPile(
  session: WinstonSession,
  pileIndex: number,
  seatIndex: number = session.currentSeatIndex,
): WinstonSession {
  const pile = session.piles[pileIndex];
  if (!pile) {
    throw new WinstonOperationError(
      "pile-idx-out-of-range",
      `Pile index ${pileIndex} out of range.`,
    );
  }
  if (pile.isExhausted) {
    throw new WinstonOperationError(
      "pile-exhausted",
      `Pile ${pileIndex} has already been taken or burned.`,
    );
  }
  if (pile.revealedCard === null) {
    throw new WinstonOperationError(
      "already-deciding",
      `Pile ${pileIndex} has not been revealed yet.`,
    );
  }

  const newPiles = session.piles.map((p, i) =>
    i === pileIndex
      ? {
          ...p,
          cards: [],
          revealedCard: null,
          awaitingSeat: null,
          isExhausted: true,
          isBurned: true,
        }
      : p,
  );

  const remainingPiles = newPiles.filter((p) => !p.isExhausted);
  const allDone = remainingPiles.length === 0;

  return {
    ...session,
    piles: newPiles,
    winstonState: allDone ? "winston_complete" : "drawing",
    currentSeatIndex: allDone ? session.currentSeatIndex : getNextSeat(session),
    updatedAt: new Date().toISOString(),
    pool: allDone ? session.picksBySeat[0] ?? [] : session.pool,
  };
}

/**
 * Convenience: apply the user's seat-0 picks to `session.pool` so the
 * existing deck-builder surface (which only reads `LimitedSession.pool`)
 * sees the Winston picks too.
 */
export function applyPicksToPool(session: WinstonSession): WinstonSession {
  return {
    ...session,
    pool: session.picksBySeat[0] ?? [],
    updatedAt: new Date().toISOString(),
  };
}
