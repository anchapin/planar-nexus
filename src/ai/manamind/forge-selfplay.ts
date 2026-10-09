/**
 * Self-play records for ForgePointerNet (manamind#87, step 1).
 *
 * Plays a TrainingSession game with `forgeSearch` on both seats and records,
 * for every decision the net has a head for, the bridge decision plus the
 * search's improved policy folded onto that head:
 *
 * - priority: `pi` over the options then pass (the `priority` logits).
 * - attack: `pi[i]` = search probability that creature i attacks
 *   (a Bernoulli target for the `attack` logits).
 * - block: `pi[b]` = per blocker, search probability over the attackers then
 *   no block (the `block` rows).
 *
 * Engine `choice` prompts are searched and played but not recorded: the net
 * has no head for them. `returns[i]` is the game result from that
 * decision's seat (+1 win, -1 loss, 0 draw or turn limit), so a game line
 * has the same `decisions` / `returns` shape as manamind's imitation data.
 */

import type { DeckList } from "@/lib/game-state";
import {
  TrainingSession,
  type TrainingAction,
  type TrainingPrompt,
} from "@/ai/simulation/training-session";
import type { ForgeDecision } from "./forge-pointer-features";
import type { ForgePointerModel } from "./forge-pointer-model";
import {
  blockAttackers,
  forgeDecision,
  forgeSearch,
  type ForgeSearchResult,
} from "./forge-search";

type Live = Exclude<TrainingPrompt, { kind: "game_over" }>;

export type SearchTarget = number[] | number[][];

export interface SelfPlayDecision extends ForgeDecision {
  /** Seat that decided: 0 or 1, in `reset` order. */
  seat: number;
  pi: SearchTarget;
}

export interface SelfPlayGame {
  seed: number;
  decisions: SelfPlayDecision[];
  returns: number[];
  /** Winning seat, or null for a draw / limit. */
  winner: number | null;
  reason: string;
  turns: number;
  steps: number;
}

export interface SelfPlayOptions {
  seed: number;
  deckA: DeckList;
  deckB: DeckList;
  simulations?: number;
  /** Sample the move from the search policy for this many decisions. */
  exploreMoves?: number;
  maxTurns?: number;
}

/** Fold the search policy over candidates onto the net's head for `prompt`. */
export function searchTarget(
  prompt: Live,
  result: ForgeSearchResult,
): SearchTarget | null {
  const { candidates, policy } = result;
  switch (prompt.kind) {
    case "priority": {
      const column: number[] = [];
      let next = 0;
      for (const o of prompt.options)
        column.push(o.kind === "pass" ? -1 : next++);
      const pi = new Array<number>(next + 1).fill(0);
      candidates.forEach((c, i) => {
        const idx = "index" in c.action ? c.action.index : -1;
        const col = column[idx];
        pi[col === undefined || col < 0 ? next : col] += policy[i];
      });
      return pi;
    }
    case "attack": {
      const ids = prompt.options.map((o) => o.cardId);
      const pi = new Array<number>(ids.length).fill(0);
      candidates.forEach((c, i) => {
        if (!("attacks" in c.action)) return;
        for (const a of c.action.attacks) {
          const k = ids.indexOf(a.cardId);
          if (k >= 0) pi[k] += policy[i];
        }
      });
      return pi;
    }
    case "block": {
      const attackers = blockAttackers(prompt);
      const none = attackers.length;
      const pi = prompt.options.map(() => new Array<number>(none + 1).fill(0));
      candidates.forEach((c, i) => {
        if (!("blocks" in c.action)) return;
        prompt.options.forEach((o, b) => {
          const blk = (
            c.action as { blocks: { blockerId: string; attackerId: string }[] }
          ).blocks.find((x) => x.blockerId === o.cardId);
          const col = blk ? attackers.indexOf(blk.attackerId) : none;
          pi[b][col < 0 ? none : col] += policy[i];
        });
      });
      return pi;
    }
    case "choice":
      return null;
  }
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

/** Play one self-play game and return its training records. */
export async function playSelfPlayGame(
  model: ForgePointerModel,
  options: SelfPlayOptions,
): Promise<SelfPlayGame> {
  const {
    seed,
    deckA,
    deckB,
    simulations = 16,
    exploreMoves = 30,
    maxTurns,
  } = options;
  const session = new TrainingSession({ maxTurns });
  const seats = session.reset(seed, deckA, deckB);
  const random = mulberry32(seed ^ 0x5eed);
  const decisions: SelfPlayDecision[] = [];
  let prompt = session.legalChoices();
  let move = 0;
  while (prompt.kind !== "game_over") {
    const result = await forgeSearch(session, model, {
      simulations,
      seed: (seed * 7919 + move) >>> 0,
    });
    const pi = searchTarget(prompt, result);
    if (pi && result.candidates.length > 1) {
      decisions.push({
        ...forgeDecision(session, prompt),
        seat: seats.indexOf(prompt.playerId),
        pi,
      });
    }
    let action: TrainingAction = result.action;
    if (move < exploreMoves && result.candidates.length > 1) {
      let r = random();
      for (let i = 0; i < result.policy.length; i++) {
        r -= result.policy[i];
        if (r <= 0) {
          action = result.candidates[i].action;
          break;
        }
      }
    }
    move++;
    prompt = session.step(action);
  }
  const res = prompt.result;
  const winner =
    res.winners.length === 1 ? seats.indexOf(res.winners[0]) : null;
  return {
    seed,
    decisions,
    returns: decisions.map((d) =>
      winner === null ? 0 : d.seat === winner ? 1 : -1,
    ),
    winner,
    reason: res.reason,
    turns: res.turns,
    steps: res.steps,
  };
}
