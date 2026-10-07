/**
 * The four manamind opponents for simple mode (#2573).
 *
 * Settings and measured strength come from manamind `docs/embedding.md`
 * (decision #46, 160 games per cell, model seed0_settle iter 45): win rate
 * against a uniform random player, and against the 40-simulation reference.
 */

import { chooseEasyMove, EASY_TEMPERATURE } from "./easy-agent";
import type { SimplePolicyModel } from "./simple-model";
import {
  observeSimpleState,
  simpleLegalMoves,
  type SimpleGameState,
  type SimpleMove,
} from "./simple-rules";
import { gumbelSearch } from "./simple-search";

export type SimpleTier = "easy" | "medium" | "hard" | "expert";

export interface SimpleTierSpec {
  label: string;
  /** Gumbel simulations per decision; 0 plays straight from the policy. */
  simulations: number;
  /** Share of real decisions replaced by a uniform random legal move. */
  blunderRate: number;
  description: string;
}

export const SIMPLE_TIERS: Readonly<Record<SimpleTier, SimpleTierSpec>> = {
  easy: {
    label: "Easy",
    simulations: 0,
    blunderRate: 0,
    description: "Plays its first instinct, with some variety.",
  },
  medium: {
    label: "Medium",
    simulations: 10,
    blunderRate: 0.25,
    description: "Looks a few moves ahead, but slips up now and then.",
  },
  hard: {
    label: "Hard",
    simulations: 10,
    blunderRate: 0,
    description: "Looks a few moves ahead every time.",
  },
  expert: {
    label: "Expert",
    simulations: 40,
    blunderRate: 0,
    description: "Searches deepest. The strongest opponent.",
  },
};

export const SIMPLE_TIER_ORDER: readonly SimpleTier[] = [
  "easy",
  "medium",
  "hard",
  "expert",
];

export interface SimpleTierDecision {
  move: SimpleMove;
  /** How the move was chosen. */
  source: "forced" | "policy" | "search" | "blunder";
}

/**
 * Choose a move for the player with priority. Search sees only that
 * player's observation. A blunder is decided first, with its own draw,
 * as manamind's `Blundering` wrapper does.
 */
export async function chooseTierMove(
  state: SimpleGameState,
  model: SimplePolicyModel,
  tier: SimpleTier,
  random: () => number = Math.random,
): Promise<SimpleTierDecision> {
  const spec = SIMPLE_TIERS[tier];
  const legal = simpleLegalMoves(state);
  if (legal.length === 0) throw new Error("no legal moves");
  if (legal.length === 1) return { move: legal[0], source: "forced" };
  if (spec.blunderRate > 0 && random() < spec.blunderRate) {
    const i = Math.min(legal.length - 1, Math.floor(random() * legal.length));
    return { move: legal[i], source: "blunder" };
  }
  if (spec.simulations === 0) {
    const { move } = await chooseEasyMove(
      state,
      model,
      random,
      EASY_TEMPERATURE,
    );
    return { move, source: "policy" };
  }
  const seen = observeSimpleState(state, state.priorityPlayer);
  const { move } = await gumbelSearch(seen, model, {
    simulations: spec.simulations,
  });
  return { move, source: "search" };
}
