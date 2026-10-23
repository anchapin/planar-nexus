/**
 * Gumbel root search for ForgePointerNet inside Planar Nexus (manamind#86).
 *
 * Runs manamind's exported Forge policy/value net next to the engine, with
 * no Python round trip. The root works like `gumbelSearch` in
 * `simple-search.ts` (k = 16, c_visit 50, c_scale 1, root noise off,
 * sequential halving, completed-Q policy) with two differences forced by the
 * full rules engine:
 *
 * - Root actions are candidates built from the net's heads. Priority and
 *   choice prompts list every option. Attack and block declarations are
 *   combinatorial, so the candidates are the greedy declaration, no
 *   declaration, everything (attacks only) and every one-change variant of
 *   the greedy pick, each with its joint probability as the prior.
 * - Each simulation first deals a fresh world for the hidden cards
 *   (`TrainingSession.determinize`: the opponent's hand and library are
 *   redealt, both libraries shuffled), plays the root action, and scores the
 *   next decision with the value head. Repeat visits average over worlds.
 *   Deeper tree search is a follow-up.
 * - Only the net calls are batched (issue #2728): a halving phase deals its
 *   worlds one at a time, in the seeded order the search always used, and
 *   hands the leaf decisions to `evaluateBatch` a bounded batch at a time.
 *   Each world keeps its own deal and each value is folded back in the same
 *   order, so the same seeds pick the same actions.
 *
 * The session is restored to where it started before this returns.
 */

import {
  dropLimitBreakingBlocks,
  TrainingRulesError,
  type TrainingAction,
  type TrainingPrompt,
  type TrainingSession,
} from "@/ai/simulation/training-session";
import { viewCardFor } from "@/ai/simulation/player-view";
import type { BridgeCard, ForgeDecision } from "./forge-pointer-features";
import type {
  ForgePointerModel,
  ForgePointerOutput,
} from "./forge-pointer-model";
import { PRIOR_UNIFORM_FLOOR } from "./simple-search";

type Live = Exclude<TrainingPrompt, { kind: "game_over" }>;

/** A world the rules left open, waiting on the net's value head. */
interface Leaf {
  /** The root candidate this world played. */
  candidate: number;
  /** The bridge decision the value head scores. */
  decision: ForgeDecision;
  /** +1 when the net values the searcher's seat, -1 for the other one. */
  sign: number;
}

/**
 * Leaf decisions per net call (issue #2728). One packed decision is a few
 * kilobytes, so a phase's leaves could all be live at once; the cap keeps
 * the runtime's working set flat instead of growing with `simulations`.
 */
const DEFAULT_BATCH_SIZE = 16;

/** The model's batched call, or N single calls on a model without one. */
function evaluateLeaves(
  model: ForgePointerModel,
  decisions: readonly ForgeDecision[],
): Promise<ForgePointerOutput[]> {
  return typeof model.evaluateBatch === "function"
    ? model.evaluateBatch(decisions)
    : Promise.all(decisions.map((d) => model.evaluate(d)));
}

export interface ForgeSearchOptions {
  simulations: number;
  /** Actions considered at the root (manamind `gumbel_k`). */
  k?: number;
  cVisit?: number;
  cScale?: number;
  /** Seed for the hidden-card deals (and the Gumbel draws). */
  seed?: number;
  /**
   * Gumbel MuZero root sampling (manamind#96): add Gumbel(0, 1) noise to the
   * root logits for the top-k pick and sequential halving, so `action` is a
   * varied draw that still plays the search's own pick. With 0 simulations
   * it is a draw from the prior. `policy` leaves the noise out, though it
   * still reflects which candidates the noisy halving visited.
   */
  gumbel?: boolean;
  /**
   * Seat-order deck names (manamind #96 deck identity). When set, every
   * decision the search evaluates carries `deck` / `opp_deck` for the
   * deciding seat.
   */
  deckNames?: readonly [string, string];
  /**
   * Leaf decisions per net call (issue #2728), default 16. A halving phase
   * deals its worlds in the seeded order regardless; this only decides how
   * many of the resulting leaf decisions ride in one batched call, so the
   * picks do not depend on it.
   */
  batchSize?: number;
}

export interface ForgeCandidate {
  action: TrainingAction;
  /** Root prior after the uniform floor; sums to 1 over the candidates. */
  prior: number;
  /**
   * The net's own share for this action, before the uniform floor
   * (manamind#96): the training target builds on this, so exploration's
   * floor never distills back into the heads.
   */
  raw?: number;
}

export interface ForgeSearchResult {
  action: TrainingAction;
  /** Index into `candidates`. */
  index: number;
  candidates: ForgeCandidate[];
  /** Completed-Q search policy over the candidates (with the floor). */
  policy: number[];
  /**
   * Target policy over the candidates: the net's raw prior plus Q, with no
   * exploration floor (manamind#96). Self-play folds this onto the heads.
   */
  target: number[];
  /** Root evaluation for the searcher, in [-1, 1]. */
  rootValue: number;
  simulations: number;
  evaluations: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number) =>
  Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exp = logits.map((l) => Math.exp(l - max));
  const z = exp.reduce((s, v) => s + v, 0);
  return exp.map((v) => v / z);
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** The bridge decision for `prompt`, from its seat's point of view. */
export function forgeDecision(
  session: TrainingSession,
  prompt: Live,
  /** Seat-order deck names; sets deck identity on the decision (manamind #96). */
  deckNames?: readonly [string, string],
): ForgeDecision {
  const viewer = prompt.playerId;
  const view = session.playerView(viewer);
  const card = (id: string): BridgeCard =>
    viewCardFor(session.state, id, viewer) ?? {};
  let decision: ForgeDecision;
  switch (prompt.kind) {
    case "priority":
      decision = {
        ...view,
        t: "priority",
        options: prompt.options
          .filter((o) => o.kind !== "pass")
          .map((o) => ({
            card: "cardId" in o ? card(o.cardId) : {},
            land: o.kind === "play_land",
            spell: o.kind === "cast_spell",
          })),
      };
      break;
    case "attack":
      decision = {
        ...view,
        t: "attack",
        options: prompt.options.map((o) => card(o.cardId)),
      };
      break;
    case "block":
      decision = {
        ...view,
        t: "block",
        blockers: prompt.options.map((o) => card(o.cardId)),
        attackers: blockAttackers(prompt).map(card),
      };
      break;
    case "choice":
      // The net has no head for engine choices; it still gives a value.
      decision = { ...view, t: "priority", options: [] };
  }
  if (deckNames) {
    const seat = Array.from(session.state.players.keys()).indexOf(viewer);
    decision.deck = seat === 0 ? deckNames[0] : deckNames[1];
    decision.opp_deck = seat === 0 ? deckNames[1] : deckNames[0];
  }
  return decision;
}

/** Attacker ids in the order the block decision lists them. */
export function blockAttackers(
  prompt: Extract<Live, { kind: "block" }>,
): string[] {
  const ids: string[] = [];
  for (const o of prompt.options)
    for (const a of o.attackers) if (!ids.includes(a)) ids.push(a);
  return ids;
}

interface RawCandidate {
  action: TrainingAction;
  weight: number;
}

function attackCandidates(
  session: TrainingSession,
  prompt: Extract<Live, { kind: "attack" }>,
  logits: number[],
): RawCandidate[] {
  const opts = prompt.options;
  const p = opts.map((_, i) => sigmoid(logits[i] ?? 0));
  const defender = (o: (typeof opts)[number]) =>
    o.defenders.find((d) => session.state.players.has(d)) ?? o.defenders[0];
  const greedy = p.map((v) => v > 0.5);
  const masks: boolean[][] = [
    greedy,
    opts.map(() => false),
    opts.map(() => true),
    ...opts.map((_, i) => greedy.map((g, j) => (j === i ? !g : g))),
  ];
  return masks.map((m) => ({
    action: {
      attacks: opts
        .filter((_, i) => m[i])
        .map((o) => ({ cardId: o.cardId, defenderId: defender(o) })),
    },
    weight: m.reduce((w, on, i) => w * (on ? p[i] : 1 - p[i]), 1),
  }));
}

function blockCandidates(
  prompt: Extract<Live, { kind: "block" }>,
  logits: number[][],
): RawCandidate[] {
  const attackers = blockAttackers(prompt);
  const none = attackers.length;
  // Per blocker: probabilities over its legal attackers plus no block.
  const rows = prompt.options.map((o, b) => {
    const cols = [...o.attackers.map((a) => attackers.indexOf(a)), none];
    const probs = softmax(cols.map((c) => logits[b]?.[c] ?? 0));
    return cols.map((c, i) => ({ col: c, p: probs[i] }));
  });
  const greedy = rows.map(
    (r) => r.reduce((best, x) => (x.p > best.p ? x : best)).col,
  );
  const picks: number[][] = [greedy, rows.map(() => none)];
  rows.forEach((r, b) => {
    for (const x of r)
      if (x.col !== greedy[b])
        picks.push(greedy.map((g, j) => (j === b ? x.col : g)));
  });
  return picks.map((pick) => ({
    action: {
      blocks: dropLimitBreakingBlocks(
        pick.flatMap((c, b) =>
          c === none
            ? []
            : [
                {
                  blockerId: prompt.options[b].cardId,
                  attackerId: attackers[c],
                },
              ],
        ),
        prompt.limits,
      ),
    },
    weight: pick.reduce(
      (w, c, b) => w * (rows[b].find((x) => x.col === c)?.p ?? 0),
      1,
    ),
  }));
}

/** Root candidates for `prompt`, with priors as manamind's `_policy_priors`. */
export async function forgeCandidates(
  session: TrainingSession,
  prompt: Live,
  model: ForgePointerModel,
  deckNames?: readonly [string, string],
): Promise<{ candidates: ForgeCandidate[]; value: number }> {
  const out = await model.evaluate(
    forgeDecision(session, prompt, deckNames),
  );
  let raw: RawCandidate[];
  switch (prompt.kind) {
    case "priority": {
      const probs = softmax(out.priority);
      const pass = probs.length - 1;
      const passCount = prompt.options.filter((o) => o.kind === "pass").length;
      let next = 0;
      raw = prompt.options.map((o, index) => ({
        action: { index },
        weight:
          o.kind === "pass"
            ? probs[pass] / Math.max(passCount, 1)
            : (probs[next++] ?? 0),
      }));
      break;
    }
    case "choice":
      raw = prompt.options.map((_, index) => ({
        action: { index },
        weight: 1,
      }));
      break;
    case "attack":
      raw = attackCandidates(session, prompt, out.attack);
      break;
    case "block":
      raw = blockCandidates(prompt, out.block);
      break;
  }
  // Same declaration reached two ways: keep the first, add the weights.
  const seen = new Map<string, RawCandidate>();
  for (const c of raw) {
    const key = JSON.stringify(c.action);
    const prev = seen.get(key);
    if (prev) prev.weight += c.weight;
    else seen.set(key, { ...c });
  }
  const unique = [...seen.values()];
  const n = unique.length;
  const total = unique.reduce((s, c) => s + c.weight, 0);
  const candidates = unique.map((c) => ({
    action: c.action,
    raw: total > 0 ? c.weight / total : 1 / n,
    prior:
      total > 0
        ? (1 - PRIOR_UNIFORM_FLOOR) * (c.weight / total) +
          PRIOR_UNIFORM_FLOOR / n
        : 1 / n,
  }));
  return { candidates, value: clamp(out.value) };
}

/**
 * Choose an action for the seat `session` is waiting on. Throws when the
 * game is over.
 */
export async function forgeSearch(
  session: TrainingSession,
  model: ForgePointerModel,
  options: ForgeSearchOptions,
): Promise<ForgeSearchResult> {
  const {
    simulations,
    k = 16,
    cVisit = 50,
    cScale = 1,
    seed = 0,
    gumbel = false,
    deckNames,
    batchSize = DEFAULT_BATCH_SIZE,
  } = options;
  const prompt = session.legalChoices();
  if (prompt.kind === "game_over") throw new Error("the game is over");
  const player = prompt.playerId;
  const random = mulberry32(seed);
  const { candidates, value: rootValue } = await forgeCandidates(
    session,
    prompt,
    model,
    deckNames,
  );
  let evaluations = 1;
  const count = candidates.length;
  const policyOf = (scores: number[]) => softmax(scores);
  // A batch is at least one decision, and never a fraction of one.
  const leavesPerCall = Math.max(1, Math.floor(batchSize));

  /**
   * Target policy from the net's raw prior plus Q, no exploration floor
   * (manamind#96). Same completed-Q as `score` uses, folded differently.
   */
  const targetOf = (q: number[]): number[] => {
    const raws = candidates.map((c) => Math.max(c.raw ?? c.prior, 1e-12));
    const rawSum = raws.reduce((s, r) => s + r, 0);
    const bonus = (cVisit + Math.max(0, ...visits)) * cScale;
    return policyOf(
      raws.map((r, i) => {
        if (illegal[i]) return -1e9;
        const l = Math.log(r / rawSum);
        return l === -Infinity ? -1e9 : l + bonus * q[i];
      }),
    );
  };

  if (count === 1) {
    return {
      action: candidates[0].action,
      index: 0,
      candidates,
      policy: [1],
      target: [1],
      rootValue,
      simulations: 0,
      evaluations,
    };
  }

  const visits = new Array<number>(count).fill(0);
  const totals = new Array<number>(count).fill(0);
  const illegal = new Array<boolean>(count).fill(false);
  const root = session.save();

  /** Fold one world into its candidate's visit count and value total. */
  const record = (i: number, v: number) => {
    visits[i]++;
    totals[i] += v;
  };

  /**
   * One world: deal hidden cards, play candidate `i`, and return the leaf
   * decision the value head still has to score. A finished game and a
   * refused action are both scored here, with no net call. Deals stay
   * per-simulation and in simulation order, so the seeded stream is the one
   * the unbatched search used (issue #2728).
   */
  const plan = async (i: number): Promise<Leaf | null> => {
    session.restore(root);
    session.determinize(player, random);
    try {
      const next = session.step(candidates[i].action);
      if (next.kind === "game_over") {
        const w = next.result.winners;
        record(i, w.length === 0 ? 0 : w.includes(player) ? 1 : -1);
        return null;
      }
      evaluations++;
      return {
        candidate: i,
        decision: forgeDecision(session, next, deckNames),
        sign: next.playerId === player ? 1 : -1,
      };
    } catch (err) {
      if (!(err instanceof TrainingRulesError)) throw err;
      illegal[i] = true;
      record(i, -1);
      return null;
    }
  };

  /** Leaf decisions dealt but not yet scored, oldest first. */
  const pending: Leaf[] = [];

  /**
   * Score the batched leaves with one net call and fold the values back, in
   * the order they were dealt: same floats, same additions, as the
   * unbatched path, so the search's picks do not move.
   */
  const flush = async () => {
    if (pending.length === 0) return;
    const outs = await evaluateLeaves(
      model,
      pending.map((p) => p.decision),
    );
    pending.forEach((p, b) =>
      record(p.candidate, p.sign * clamp(outs[b].value)),
    );
    pending.length = 0;
  };

  const priors = candidates.map((c) => Math.max(c.prior, 1e-12));
  const priorSum = priors.reduce((s, p) => s + p, 0);
  const logits = priors.map((p) => Math.log(p / priorSum));
  // A separate stream, so the deals match the noise-free search.
  const noise = mulberry32((seed ^ 0x6b3d2a1f) >>> 0);
  const g = logits.map(() =>
    gumbel
      ? -Math.log(-Math.log(Math.min(Math.max(noise(), 1e-12), 1 - 1e-12)))
      : 0,
  );

  const completedQ = (): number[] => {
    const totalVisits = visits.reduce((s, v) => s + v, 0);
    let mixed = rootValue;
    if (totalVisits > 0) {
      let weight = 0;
      let weighted = 0;
      visits.forEach((v, i) => {
        if (v > 0) {
          weight += priors[i] / priorSum;
          weighted += (priors[i] / priorSum) * (totals[i] / v);
        }
      });
      mixed =
        (rootValue + (totalVisits / weight) * weighted) / (1 + totalVisits);
    }
    return visits.map((v, i) =>
      Math.min(1, Math.max(0, ((v > 0 ? totals[i] / v : mixed) + 1) / 2)),
    );
  };
  const score = (withNoise: boolean): number[] => {
    const q = completedQ();
    const maxVisits = Math.max(0, ...visits);
    return logits.map((l, i) =>
      illegal[i]
        ? -Infinity
        : l + (withNoise ? g[i] : 0) + (cVisit + maxVisits) * cScale * q[i],
    );
  };

  try {
    const considered = Math.min(Math.max(k, 1), count);
    let remaining = logits
      .map((_, i) => i)
      .sort((a, b) => logits[b] + g[b] - (logits[a] + g[a]))
      .slice(0, considered);
    const phases =
      considered > 1 ? Math.max(1, Math.ceil(Math.log2(considered))) : 1;
    const budget = Math.max(simulations, 0);
    let used = 0;
    while (used < budget) {
      const perAction = Math.max(
        1,
        Math.floor(budget / (phases * remaining.length)),
      );
      for (const i of remaining) {
        for (let j = 0; j < perAction && used < budget; j++) {
          const leaf = await plan(i);
          used++;
          if (leaf) pending.push(leaf);
          // A phase can deal more leaves than one batch holds — the last
          // phase walks a single candidate up to the whole budget — so the
          // batch is capped and the next one starts here.
          if (pending.length >= leavesPerCall) await flush();
        }
      }
      await flush();
      if (remaining.length === 1) break;
      const s = score(true);
      remaining = [...remaining]
        .sort((a, b) => s[b] - s[a])
        .slice(0, Math.max(1, Math.floor(remaining.length / 2)));
    }

    const noisy = score(true);
    let best = remaining[0];
    for (const i of remaining) if (noisy[i] > noisy[best]) best = i;
    const final = score(false);
    const target = targetOf(completedQ());
    if (illegal[best]) {
      // Every surviving candidate was refused: fall back to any legal one.
      const legal = final.findIndex((_, i) => !illegal[i]);
      if (legal >= 0) best = legal;
    }
    return {
      action: candidates[best].action,
      index: best,
      candidates,
      policy: policyOf(final.map((v) => (v === -Infinity ? -1e9 : v))),
      target,
      rootValue,
      simulations: used,
      evaluations,
    };
  } finally {
    session.restore(root);
    session.release(root);
  }
}
