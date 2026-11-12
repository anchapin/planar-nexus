/**
 * anchapin/manamind#44: a fixed-size summary of what the opponent has
 * revealed in this game, built only from information a real player could
 * see, maintained incrementally as a session observes states.
 *
 * The summary feeds the opponent-modeling features for the ForgePointerNet
 * line (the schema-v3 packing lives in manamind; this module only builds
 * and maintains the counts). Everything tracked is public information:
 * the opponent's battlefield and graveyard (graveyards are face-up), their
 * hand size, mana in either player's pool, and declared attackers and
 * blockers during combat. Hidden cards stay hidden: a face-down battlefield
 * entry counts as a creature but reveals no name, and the hidden zones
 * `TrainingSession.determinize` redeals (hands, libraries) are never read,
 * so observations stay valid across search redeals.
 *
 * Not tracked yet (later PRs): revealed-from-hand events, exile-zone
 * entries, and a sequence encoder over the full game log.
 */

import { type GameState, type PlayerId } from "@/lib/game-state";
import { viewCardFor } from "./player-view";

/** Turn buckets: t1-2, t3-4, t5-6, t7+. */
export const HISTORY_TURN_BUCKETS = 4;

/** Inclusive upper turn edges for buckets 0..2; everything later is bucket 3. */
const BUCKET_EDGES = [2, 4, 6] as const;

/** Bucket index for a turn number: 0..3 (t1-2, t3-4, t5-6, t7+). */
export function historyBucket(turnNumber: number): number {
  for (let i = 0; i < BUCKET_EDGES.length; i++) {
    if (turnNumber <= BUCKET_EDGES[i]) return i;
  }
  return HISTORY_TURN_BUCKETS - 1;
}

/** One turn bucket of opponent-revealed events and observations. */
export interface HistoryBucket {
  landsPlayed: number;
  creaturesPlayed: number;
  otherPermanentsPlayed: number;
  creaturesToGraveyard: number;
  otherToGraveyard: number;
  handSizeSum: number;
  handSizeSamples: number;
}

/** Opponent's mana pool at a decision, by color (CR: pools are public). */
export interface OpponentManaPool {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
  /** Any pool key outside the WUBRGC names lands here. */
  other: number;
}

/** Fixed-shape opponent-history summary at one decision. */
export interface OpponentHistorySummary {
  /** Turn number of the observed state. */
  turn: number;
  /** One bucket per HISTORY_TURN_BUCKETS, oldest first. */
  buckets: HistoryBucket[];
  totals: {
    landsPlayed: number;
    creaturesPlayed: number;
    otherPermanentsPlayed: number;
    creaturesToGraveyard: number;
    otherToGraveyard: number;
    /** How many times observe() has run. */
    observations: number;
  };
  /** Opponent's mana pool at the observed state. */
  oppManaPool: OpponentManaPool;
  /** Opponent attackers declared in the current combat (live count). */
  oppAttackersThisCombat: number;
  /** Opponent blockers against viewer's attackers in the current combat. */
  oppBlockersThisCombat: number;
  /** Opponent graveyard size at the observed state. */
  oppGraveyardSize: number;
}

function emptyBucket(): HistoryBucket {
  return {
    landsPlayed: 0,
    creaturesPlayed: 0,
    otherPermanentsPlayed: 0,
    creaturesToGraveyard: 0,
    otherToGraveyard: 0,
    handSizeSum: 0,
    handSizeSamples: 0,
  };
}

function zoneCardIds(
  state: GameState,
  playerId: PlayerId,
  zone: string,
): string[] {
  return state.zones.get(`${playerId}-${zone}`)?.cardIds ?? [];
}

const COLOR_KEYS: Record<string, keyof OpponentManaPool> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
  colorless: "C",
};

function mapManaPool(
  pool: Record<string, number> | undefined,
): OpponentManaPool {
  const out: OpponentManaPool = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
    C: 0,
    other: 0,
  };
  if (!pool) return out;
  for (const [key, count] of Object.entries(pool)) {
    if (!count) continue;
    const target = COLOR_KEYS[key];
    if (target) out[target] += count;
    else out.other += count;
  }
  return out;
}

/**
 * Maintains the opponent-history summary for one seat. Create one per seat
 * at game start and call `observe` at every decision the seat makes;
 * each call diffs the opponent's public zones against the previous
 * observation, so a card is counted exactly once no matter how many
 * decisions happen in a turn.
 */
export class OpponentHistoryTracker {
  private readonly buckets: HistoryBucket[] = Array.from(
    { length: HISTORY_TURN_BUCKETS },
    emptyBucket,
  );
  private readonly battlefieldSeen = new Set<string>();
  private readonly graveyardSeen = new Set<string>();
  private observations = 0;

  constructor(private readonly viewer: PlayerId) {}

  private opponentId(state: GameState): PlayerId {
    if (!state.players.has(this.viewer)) {
      throw new Error(
        `OpponentHistoryTracker: viewer ${this.viewer} is not in the game`,
      );
    }
    for (const id of state.players.keys()) {
      if (id !== this.viewer) return id;
    }
    throw new Error(
      `OpponentHistoryTracker: viewer ${this.viewer} is not in the game`,
    );
  }

  /**
   * Diff the opponent's public zones against the last observation,
   * accumulate the bucket counts, and return the current summary.
   */
  observe(state: GameState): OpponentHistorySummary {
    const opp = this.opponentId(state);
    const bucket = this.buckets[historyBucket(state.turn.turnNumber)];

    for (const id of zoneCardIds(state, opp, "battlefield")) {
      if (this.battlefieldSeen.has(id)) continue;
      this.battlefieldSeen.add(id);
      if (!state.cards.get(id)) continue;
      const view = viewCardFor(state, id, this.viewer);
      if (view?.land) bucket.landsPlayed++;
      else if (view?.creature) bucket.creaturesPlayed++;
      else bucket.otherPermanentsPlayed++;
    }
    for (const id of zoneCardIds(state, opp, "graveyard")) {
      if (this.graveyardSeen.has(id)) continue;
      this.graveyardSeen.add(id);
      const type = state.cards.get(id)?.cardData.type_line ?? "";
      if (/\bcreature\b/i.test(type)) bucket.creaturesToGraveyard++;
      else bucket.otherToGraveyard++;
    }
    bucket.handSizeSum += zoneCardIds(state, opp, "hand").length;
    bucket.handSizeSamples++;
    this.observations++;
    return this.summary(state);
  }

  /**
   * Live fields from the current state on top of the accumulated counts,
   * without diffing. Call this when a caller wants a fresh read (e.g. the
   * same turn bucket) without re-observing.
   */
  summary(state: GameState): OpponentHistorySummary {
    const opp = this.opponentId(state);
    const pool = mapManaPool(
      state.players.get(opp)?.manaPool as Record<string, number> | undefined,
    );

    let oppAttackers = 0;
    let oppBlockers = 0;
    if (state.combat?.inCombatPhase) {
      for (const attacker of state.combat.attackers) {
        const controller = state.cards.get(attacker.cardId)?.controllerId;
        if (controller === opp) oppAttackers++;
        else {
          oppBlockers +=
            state.combat.blockers.get(attacker.cardId)?.length ?? 0;
        }
      }
    }

    return {
      turn: state.turn.turnNumber,
      buckets: this.buckets.map((b) => ({ ...b })),
      totals: {
        landsPlayed: this.buckets.reduce((s, b) => s + b.landsPlayed, 0),
        creaturesPlayed: this.buckets.reduce(
          (s, b) => s + b.creaturesPlayed,
          0,
        ),
        otherPermanentsPlayed: this.buckets.reduce(
          (s, b) => s + b.otherPermanentsPlayed,
          0,
        ),
        creaturesToGraveyard: this.buckets.reduce(
          (s, b) => s + b.creaturesToGraveyard,
          0,
        ),
        otherToGraveyard: this.buckets.reduce(
          (s, b) => s + b.otherToGraveyard,
          0,
        ),
        observations: this.observations,
      },
      oppManaPool: pool,
      oppAttackersThisCombat: oppAttackers,
      oppBlockersThisCombat: oppBlockers,
      oppGraveyardSize: zoneCardIds(state, opp, "graveyard").length,
    };
  }
}
