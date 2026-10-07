/**
 * Gumbel root search for the manamind simple ruleset (#2573).
 *
 * A port of manamind's `MCTSAgent(search="gumbel")` with root noise off, the
 * search behind the Medium (10 simulations + 25% blunders), Hard (10) and
 * Expert (40) tiers. It must make the same decisions as the Python agent, so
 * it keeps that agent's quirks on purpose:
 *
 * - Search runs on the observation as given. Hidden cards stay hidden
 *   placeholders that can't be played; the Gumbel path never samples a world
 *   (only manamind's PUCT path calls `determinize`). The tiers were measured
 *   this way, so changing it needs a re-measure.
 * - Root children are expanded by popping the last legal move first, so
 *   they sit in reverse legal order, and ties break in that order.
 * - Only the root gets policy priors. Deeper nodes select with a uniform
 *   prior and a first-play value of 0.
 * - Every leaf is evaluated after forced moves are played out (`settle`).
 *
 * Checked move for move against `simple_v1_search.json`, recorded by
 * manamind's `scripts/export_host_fixtures.py --search-sims 10,40`.
 */

import {
  applySimpleMove,
  isSimpleGameOver,
  simpleLegalMoves,
  simpleWinner,
  type SimpleGameState,
  type SimpleMove,
} from "./simple-rules";
import { SIMPLE_V1_ACTIONS, simpleObservation } from "./simple-observation";
import type { SimplePolicyModel } from "./simple-model";

/** manamind `PRIOR_UNIFORM_FLOOR`: share of the root prior spread evenly. */
export const PRIOR_UNIFORM_FLOOR = 0.25;
/** manamind `MCTSAgent.MAX_FORCED_STEPS`. */
export const MAX_FORCED_STEPS = 50;
const PUCT_C = 1.414;

export interface GumbelSearchOptions {
  simulations: number;
  /** Actions considered at the root (manamind `gumbel_k`). */
  k?: number;
  cVisit?: number;
  cScale?: number;
}

export interface GumbelSearchResult {
  /** Index into `simpleLegalMoves(state)`. */
  index: number;
  move: SimpleMove;
  /** Completed-Q search policy over the legal moves, in legal order. */
  policy: number[];
  /** Root evaluation for the searcher, in [-1, 1]. */
  rootValue: number;
  simulations: number;
  evaluations: number;
}

class SearchNode {
  readonly children: SearchNode[] = [];
  readonly untried: SimpleMove[];
  visits = 0;
  total = 0;
  prior = 1;

  constructor(
    readonly state: SimpleGameState,
    readonly parent: SearchNode | null,
    readonly move: SimpleMove | null,
  ) {
    this.untried = simpleLegalMoves(state);
  }

  get terminal(): boolean {
    return isSimpleGameOver(this.state);
  }

  expand(): SearchNode {
    const move = this.untried.pop();
    if (!move) throw new Error("no untried moves to expand");
    const child = new SearchNode(applySimpleMove(this.state, move), this, move);
    this.children.push(child);
    return child;
  }

  /** PUCT with a uniform prior, as manamind's `select_child` below the root. */
  select(): SearchNode {
    let best = this.children[0];
    let bestScore = -Infinity;
    const sqrtN = Math.sqrt(Math.max(this.visits, 1));
    for (const c of this.children) {
      const q = c.visits > 0 ? c.total / c.visits : 0;
      const score = q + (PUCT_C * c.prior * sqrtN) / (1 + c.visits);
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return best;
  }
}

/** Root priors as manamind's `_policy_priors`: legal mass plus a uniform floor. */
export function searchPriors(
  logits: ArrayLike<number>,
  legal: readonly SimpleMove[],
  actions: readonly string[] = SIMPLE_V1_ACTIONS,
): number[] {
  const n = legal.length;
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) max = Math.max(max, logits[i]);
  let denom = 0;
  for (let i = 0; i < logits.length; i++) denom += Math.exp(logits[i] - max);
  const ids = legal.map((m) => {
    const i = actions.indexOf(m.type);
    return i < 0 || i >= logits.length ? null : i;
  });
  const shared = new Map<number, number>();
  for (const i of ids) if (i !== null) shared.set(i, (shared.get(i) ?? 0) + 1);
  const raw = ids.map((i) =>
    i === null
      ? 0
      : Math.exp(logits[i] - max) / denom / (shared.get(i) as number),
  );
  const total = raw.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return legal.map(() => 1 / n);
  return raw.map(
    (v) => (1 - PRIOR_UNIFORM_FLOOR) * (v / total) + PRIOR_UNIFORM_FLOOR / n,
  );
}

/**
 * Choose a move for the player with priority in `state` (normally their
 * observation from `observeSimpleState`).
 */
export async function gumbelSearch(
  state: SimpleGameState,
  model: SimplePolicyModel,
  options: GumbelSearchOptions,
): Promise<GumbelSearchResult> {
  const { simulations, k = 16, cVisit = 50, cScale = 1 } = options;
  const player = state.priorityPlayer;
  const legal = simpleLegalMoves(state);
  if (legal.length === 0) throw new Error("no legal moves");
  let evaluations = 0;

  const settle = (s: SimpleGameState): SimpleGameState => {
    for (let i = 0; i < MAX_FORCED_STEPS; i++) {
      if (isSimpleGameOver(s)) break;
      const moves = simpleLegalMoves(s);
      if (moves.length !== 1) break;
      s = applySimpleMove(s, moves[0]);
    }
    return s;
  };

  /** Value for the searcher, as manamind's `_evaluate_position`. */
  const evaluate = async (s: SimpleGameState): Promise<number> => {
    s = settle(s);
    if (isSimpleGameOver(s)) {
      const winner = simpleWinner(s);
      return winner === null ? 0 : winner === player ? 1 : -1;
    }
    evaluations++;
    const { value } = await model.evaluate(simpleObservation(s));
    if (!Number.isFinite(value)) return 0;
    const v = s.priorityPlayer === player ? value : -value;
    return Math.max(-1, Math.min(1, v));
  };

  const backup = (path: SearchNode[], value: number) => {
    for (const node of path) {
      node.visits++;
      if (node.parent === null) node.total += value;
      else
        node.total +=
          node.parent.state.priorityPlayer === player ? value : -value;
    }
  };

  if (legal.length === 1) {
    return {
      index: 0,
      move: legal[0],
      policy: [1],
      rootValue: 0,
      simulations: 0,
      evaluations: 0,
    };
  }

  const root = new SearchNode(state, null, null);
  evaluations++;
  const out = await model.evaluate(simpleObservation(state));
  const legalPrior = searchPriors(out.logits, legal, model.schema.actions);
  while (root.untried.length > 0) {
    const child = root.expand();
    // Children are popped from the end: child i is legal move n-1-i.
    child.prior = legalPrior[legal.length - root.children.length];
  }
  const children = root.children;
  const count = children.length;

  const priorSum = children.reduce((s, c) => s + Math.max(c.prior, 1e-12), 0);
  const priors = children.map((c) => Math.max(c.prior, 1e-12) / priorSum);
  const logits = priors.map(Math.log);

  const sign = state.priorityPlayer === player ? 1 : -1;
  const rootValue = sign * (await evaluate(state));

  const completedQ = (): number[] => {
    const visits = children.map((c) => c.visits);
    const q = children.map((c) => (c.visits ? c.total / c.visits : 0));
    const totalVisits = visits.reduce((s, v) => s + v, 0);
    let mixed = rootValue;
    if (visits.some((v) => v > 0)) {
      let weight = 0;
      let weighted = 0;
      visits.forEach((v, i) => {
        if (v > 0) {
          weight += priors[i];
          weighted += priors[i] * q[i];
        }
      });
      mixed =
        (rootValue + (totalVisits / weight) * weighted) / (1 + totalVisits);
    }
    return visits.map((v, i) =>
      Math.min(1, Math.max(0, ((v > 0 ? q[i] : mixed) + 1) / 2)),
    );
  };
  const sigma = (q: number[]): number[] => {
    const maxVisits = Math.max(0, ...children.map((c) => c.visits));
    return q.map((v) => (cVisit + maxVisits) * cScale * v);
  };
  const score = (): number[] => {
    const s = sigma(completedQ());
    return logits.map((l, i) => l + s[i]);
  };

  const simulate = async (child: SearchNode) => {
    const path = [root, child];
    if (child.visits === 0) {
      backup(path, await evaluate(child.state));
      return;
    }
    let node = child;
    while (
      !node.terminal &&
      node.untried.length === 0 &&
      node.children.length
    ) {
      node = node.select();
      path.push(node);
    }
    if (!node.terminal && node.untried.length > 0) {
      node = node.expand();
      path.push(node);
    }
    backup(path, await evaluate(node.state));
  };

  const considered = Math.min(Math.max(k, 1), count);
  // Stable sort: equal scores keep child order, as numpy does for k <= 16.
  let remaining = children
    .map((_, i) => i)
    .sort((a, b) => logits[b] - logits[a])
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
        await simulate(children[i]);
        used++;
      }
    }
    if (remaining.length === 1) break;
    const s = score();
    remaining = [...remaining]
      .sort((a, b) => s[b] - s[a])
      .slice(0, Math.max(1, Math.floor(remaining.length / 2)));
  }

  const final = score();
  let best = remaining[0];
  for (const i of remaining) if (final[i] > final[best]) best = i;

  const max = Math.max(...final);
  const exp = final.map((v) => Math.exp(v - max));
  const z = exp.reduce((s, v) => s + v, 0);
  const policy = new Array<number>(count);
  exp.forEach((v, i) => {
    policy[count - 1 - i] = v / z;
  });
  return {
    index: count - 1 - best,
    move: children[best].move as SimpleMove,
    policy,
    rootValue,
    simulations: used,
    evaluations,
  };
}
