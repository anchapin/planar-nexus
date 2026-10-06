/**
 * The Easy manamind opponent for the simple ruleset (#2557).
 *
 * Mirrors manamind's `OnnxPolicyAgent` at temperature 1.0: no search, one
 * policy evaluation per decision, sample a move with probability
 * proportional to `prior ** (1 / temperature)`. A forced move skips the
 * model. In manamind's tier table this setting scored .775 against the
 * 40-simulation reference over 160 games.
 */

import {
  simpleLegalMoves,
  type SimpleGameState,
  type SimpleMove,
} from "./simple-rules";
import { legalPriors, simpleObservation } from "./simple-observation";
import type { SimplePolicyModel } from "./simple-model";

export const EASY_TEMPERATURE = 1.0;

/**
 * Index drawn from `priors` sharpened by `temperature`. Temperature 0 (or
 * below) is greedy and returns the first maximum, as numpy's argmax does.
 */
export function samplePriorIndex(
  priors: readonly number[],
  temperature: number,
  random: () => number,
): number {
  if (priors.length === 0) throw new Error("no priors to sample from");
  if (temperature <= 0) {
    let best = 0;
    for (let i = 1; i < priors.length; i++) {
      if (priors[i] > priors[best]) best = i;
    }
    return best;
  }
  const weights = priors.map((p) => Math.pow(p, 1 / temperature));
  const total = weights.reduce((s, w) => s + w, 0);
  if (!(total > 0)) return Math.floor(random() * priors.length);
  let r = random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

export interface EasyDecision {
  move: SimpleMove;
  /** Priors over the legal moves, or null when the move was forced. */
  priors: number[] | null;
  /** Value head for the mover, or null when the move was forced. */
  value: number | null;
}

export async function chooseEasyMove(
  state: SimpleGameState,
  model: SimplePolicyModel,
  random: () => number = Math.random,
  temperature: number = EASY_TEMPERATURE,
): Promise<EasyDecision> {
  const legal = simpleLegalMoves(state);
  if (legal.length === 0) throw new Error("no legal moves");
  if (legal.length === 1) return { move: legal[0], priors: null, value: null };
  const { logits, value } = await model.evaluate(simpleObservation(state));
  const priors = legalPriors(logits, legal, model.schema.actions);
  return {
    move: legal[samplePriorIndex(priors, temperature, random)],
    priors,
    value,
  };
}
