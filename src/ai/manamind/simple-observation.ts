/**
 * Observation and prior computation for manamind schema `simple-v1` (#2378).
 *
 * Mirrors `scripts/onnx_host.py` in manamind: 25 floats from the point of view
 * of the player with priority, and a softmax over the action types present in
 * the legal moves, with moves that share a type splitting its probability.
 * See manamind `docs/embedding.md` for the contract.
 */

import {
  SIMPLE_PHASES,
  type SimpleGameState,
  type SimpleMove,
  type SimplePlayer,
} from "./simple-rules";

export const SIMPLE_SCHEMA_VERSION = "simple-v1";
export const SIMPLE_OBSERVATION_DIM = 25;

/** Action names in model output order, as listed in `model.schema.json`. */
export const SIMPLE_V1_ACTIONS: readonly string[] = [
  "play_land",
  "cast_spell",
  "activate_ability",
  "activate_mana_ability",
  "pass_priority",
  "hold_priority",
  "declare_attackers",
  "declare_blockers",
  "assign_combat_damage",
  "order_blockers",
  "mulligan",
  "keep_hand",
  "concede",
  "discard",
  "sacrifice",
  "destroy",
  "exile",
  "choose_target",
  "choose_mode",
  "choose_x_value",
  "order_cards",
  "tap_for_mana",
  "pay_mana",
];

export interface SimpleModelSchema {
  schema_version: string;
  observation_dim: number;
  actions: string[];
}

/** Hosts must refuse a schema they don't know (docs/embedding.md). */
export function assertSupportedSchema(schema: SimpleModelSchema): void {
  if (schema.schema_version !== SIMPLE_SCHEMA_VERSION) {
    throw new Error(
      `unsupported manamind schema_version ${JSON.stringify(schema.schema_version)}; this host reads ${SIMPLE_SCHEMA_VERSION}`,
    );
  }
  if (schema.observation_dim !== SIMPLE_OBSERVATION_DIM) {
    throw new Error(
      `expected observation_dim ${SIMPLE_OBSERVATION_DIM}, got ${schema.observation_dim}`,
    );
  }
}

function playerFeatures(p: SimplePlayer): number[] {
  const creatures = p.battlefield.filter((c) => !c.isLand);
  const lands = p.battlefield.filter((c) => c.isLand);
  return [
    p.life / 20,
    p.hand.length / 7,
    p.library.length / 40,
    p.graveyard.length / 10,
    lands.length / 10,
    lands.filter((c) => !c.tapped).length / 10,
    creatures.length / 10,
    creatures.reduce((s, c) => s + (c.power ?? 0), 0) / 20,
    creatures.reduce((s, c) => s + (c.toughness ?? 0), 0) / 20,
    creatures.filter((c) => !c.tapped).length / 10,
  ];
}

export function simpleObservation(state: SimpleGameState): Float32Array {
  const mover = state.priorityPlayer;
  const values = [
    ...playerFeatures(state.players[mover]),
    ...playerFeatures(state.players[1 - mover]),
    ...SIMPLE_PHASES.map((ph) => (state.phase === ph ? 1 : 0)),
    state.activePlayer === mover ? 1 : 0,
    Math.min(state.turn, 60) / 60,
  ];
  return Float32Array.from(values);
}

/** Priors over `legal`, matching manamind's `legal_priors` and `MCTSAgent`. */
export function legalPriors(
  logits: ArrayLike<number>,
  legal: readonly SimpleMove[],
  actions: readonly string[] = SIMPLE_V1_ACTIONS,
): number[] {
  const n = legal.length;
  if (n === 0) return [];
  const ids = legal.map((m) => {
    const i = actions.indexOf(m.type);
    return i < 0 ? null : i;
  });
  const known = ids.filter((i): i is number => i !== null);
  if (known.length === 0) return legal.map(() => 1 / n);

  const unique = [...new Set(known)];
  const max = Math.max(...known.map((i) => logits[i]));
  // Python softmaxes over `known` including duplicates, then keys mass by id,
  // so each id's mass is exp(z)/sum over every legal move's exp(z).
  const denom = known.reduce((s, i) => s + Math.exp(logits[i] - max), 0);
  const mass = new Map<number, number>(
    unique.map((i) => [i, Math.exp(logits[i] - max) / denom]),
  );
  const shares = new Map<number, number>();
  for (const i of known) shares.set(i, (shares.get(i) ?? 0) + 1);

  const priors = ids.map((i) =>
    i === null ? 0 : (mass.get(i) as number) / (shares.get(i) as number),
  );
  const total = priors.reduce((s, p) => s + p, 0);
  return total > 0 ? priors.map((p) => p / total) : legal.map(() => 1 / n);
}
