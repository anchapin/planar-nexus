/**
 * Compare two ForgePointerNet checkpoints' root priors on the same
 * positions (manamind#96). The c-scale 0.1 round-1 net plays even with
 * bc.pt raw but loses ~0.33 through a 16-sim search, even with bc.pt's
 * value head spliced in, so the question is how the shape of its prior
 * differs: how spread out it is, and whether the top choices match.
 */

import type { ForgeCandidate } from "./forge-search";

export interface PriorPair {
  /** Prompt kind: priority, choice, attack or block. */
  kind: string;
  /** True when the gate candidate was the seat to act. */
  candidateToAct: boolean;
  /** Priors from model A (the gate baseline). */
  a: readonly ForgeCandidate[];
  /** Priors from model B (the gate candidate). */
  b: readonly ForgeCandidate[];
}

export interface PriorRow {
  kind: string;
  candidateToAct: boolean;
  /** Distinct actions across both candidate lists. */
  actions: number;
  entropyA: number;
  entropyB: number;
  top1A: number;
  top1B: number;
  /** Both models put the same action first. */
  agree: boolean;
  /** |top-3 of A ∩ top-3 of B| / min(3, actions). */
  top3Overlap: number;
  /** B's prior on A's top action. */
  bOnTopA: number;
  /** Total variation distance between the two priors. */
  tv: number;
}

const keyOf = (c: ForgeCandidate) => JSON.stringify(c.action);

function toMap(cs: readonly ForgeCandidate[]): Map<string, number> {
  const m = new Map<string, number>();
  const total = cs.reduce((s, c) => s + c.prior, 0) || 1;
  for (const c of cs) m.set(keyOf(c), (m.get(keyOf(c)) ?? 0) + c.prior / total);
  return m;
}

function entropy(m: Map<string, number>): number {
  let h = 0;
  for (const p of m.values()) if (p > 0) h -= p * Math.log(p);
  return h;
}

function ranked(m: Map<string, number>): string[] {
  return [...m.entries()]
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .map(([k]) => k);
}

/** Compare one position's priors. */
export function comparePriors(pair: PriorPair): PriorRow {
  const a = toMap(pair.a);
  const b = toMap(pair.b);
  const keys = new Set([...a.keys(), ...b.keys()]);
  const ra = ranked(a);
  const rb = ranked(b);
  const k = Math.min(3, keys.size);
  const topA = new Set(ra.slice(0, 3));
  const overlap = rb.slice(0, 3).filter((x) => topA.has(x)).length;
  let tv = 0;
  for (const x of keys) tv += Math.abs((a.get(x) ?? 0) - (b.get(x) ?? 0));
  return {
    kind: pair.kind,
    candidateToAct: pair.candidateToAct,
    actions: keys.size,
    entropyA: entropy(a),
    entropyB: entropy(b),
    top1A: a.get(ra[0]) ?? 0,
    top1B: b.get(rb[0]) ?? 0,
    agree: ra[0] === rb[0],
    top3Overlap: k ? overlap / k : 1,
    bOnTopA: b.get(ra[0]) ?? 0,
    tv: tv / 2,
  };
}

export interface PriorSummary {
  kind: string;
  positions: number;
  meanActions: number;
  entropyA: number;
  entropyB: number;
  top1A: number;
  top1B: number;
  agree: number;
  top3Overlap: number;
  bOnTopA: number;
  tv: number;
}

const mean = (xs: number[]) =>
  xs.length ? +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(4) : 0;

/**
 * Average the rows per prompt kind (plus "all"), skipping positions with a
 * single legal action in both lists: they carry no prior information.
 */
export function summarizePriors(rows: readonly PriorRow[]): PriorSummary[] {
  const live = rows.filter((r) => r.actions > 1);
  const kinds = ["all", ...new Set(live.map((r) => r.kind))];
  return kinds.map((kind) => {
    const rs = kind === "all" ? live : live.filter((r) => r.kind === kind);
    return {
      kind,
      positions: rs.length,
      meanActions: mean(rs.map((r) => r.actions)),
      entropyA: mean(rs.map((r) => r.entropyA)),
      entropyB: mean(rs.map((r) => r.entropyB)),
      top1A: mean(rs.map((r) => r.top1A)),
      top1B: mean(rs.map((r) => r.top1B)),
      agree: mean(rs.map((r) => (r.agree ? 1 : 0))),
      top3Overlap: mean(rs.map((r) => r.top3Overlap)),
      bOnTopA: mean(rs.map((r) => r.bOnTopA)),
      tv: mean(rs.map((r) => r.tv)),
    };
  });
}
