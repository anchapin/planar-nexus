/**
 * Head-to-head gate between two ForgePointerNet checkpoints (manamind#87,
 * step 3).
 *
 * Both seats play with `forgeSearch`, each with its own model. By default
 * each seat samples its move from the search policy: greedy play from an
 * early network passes every turn and draws at the turn limit, which would
 * make every gate a 50% tie. A candidate is promoted when its score (a
 * draw counts half) reaches the threshold.
 */

import { mulberry32 } from "@/ai/simulation/game-simulator";
import {
  TrainingSession,
  type trainingDeck,
} from "@/ai/simulation/training-session";
import type { ForgePointerModel } from "./forge-pointer-model";
import { forgeSearch } from "./forge-search";

type DeckList = ReturnType<typeof trainingDeck>;
export type GateResult = "win" | "loss" | "draw";

export interface GateGameOptions {
  seed: number;
  deckA: DeckList;
  deckB: DeckList;
  /** Seat (0 or 1, in `reset` order) the candidate plays. */
  candidateSeat: 0 | 1;
  simulations?: number;
  /** Sample from the search policy (default) or play its greedy pick. */
  sample?: boolean;
  maxTurns?: number;
}

export interface GateGame {
  seed: number;
  candidateSeat: 0 | 1;
  result: GateResult;
  reason: string;
  turns: number;
}

/** Play one game, candidate vs baseline; result is from the candidate. */
export async function playGateGame(
  candidate: ForgePointerModel,
  baseline: ForgePointerModel,
  options: GateGameOptions,
): Promise<GateGame> {
  const {
    seed,
    deckA,
    deckB,
    candidateSeat,
    simulations = 16,
    sample = true,
    maxTurns,
  } = options;
  const session = new TrainingSession({ maxTurns });
  const seats = session.reset(seed, deckA, deckB);
  const random = mulberry32(seed ^ 0x9a7e);
  let prompt = session.legalChoices();
  let move = 0;
  while (prompt.kind !== "game_over") {
    const seat = seats.indexOf(prompt.playerId);
    const model = seat === candidateSeat ? candidate : baseline;
    const r = await forgeSearch(session, model, {
      simulations,
      seed: (seed * 7919 + move) >>> 0,
    });
    let action = r.action;
    if (sample && r.candidates.length > 1) {
      let u = random();
      for (let i = 0; i < r.policy.length; i++) {
        u -= r.policy[i];
        if (u <= 0) {
          action = r.candidates[i].action;
          break;
        }
      }
    }
    move++;
    prompt = session.step(action);
  }
  const res = prompt.result;
  const winner = res.winners.length === 1 ? seats.indexOf(res.winners[0]) : -1;
  return {
    seed,
    candidateSeat,
    result: winner < 0 ? "draw" : winner === candidateSeat ? "win" : "loss",
    reason: res.reason,
    turns: res.turns,
  };
}

/** Wilson 95% interval for a score `p` out of `n` games. */
export function wilson(p: number, n: number): [number, number] {
  if (n <= 0) return [0, 0];
  const z = 1.96;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [+(c - h).toFixed(3), +(c + h).toFixed(3)];
}

export interface GateSummary {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** (wins + draws / 2) / games, from the candidate's side. */
  score: number;
  ci95: [number, number];
  threshold: number;
  promote: boolean;
}

export function gateSummary(
  games: readonly GateGame[],
  threshold: number,
): GateSummary {
  const n = games.length;
  const wins = games.filter((g) => g.result === "win").length;
  const losses = games.filter((g) => g.result === "loss").length;
  const draws = n - wins - losses;
  const score = n ? (wins + draws / 2) / n : 0;
  return {
    games: n,
    wins,
    losses,
    draws,
    score: +score.toFixed(4),
    ci95: wilson(score, n),
    threshold,
    promote: n > 0 && score >= threshold,
  };
}
