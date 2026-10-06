/**
 * Parity with the Python simple ruleset that manamind trained on (#2378).
 *
 * The fixture is recorded by manamind's `scripts/export_host_fixtures.py`:
 * six seeded games of random moves (1,054 decisions). Each game starts from
 * the recorded deal; at every decision the port must produce the same legal
 * moves in the same order and the same observation, and the game must end
 * with the same winner and life totals. The first 40 decisions of each game
 * also carry the exported model's logits and priors (seed0_settle iter 45),
 * which checks `legalPriors` without loading a model.
 */

import fixture from "./fixtures/simple_v1_replays.json";
import {
  applySimpleMove,
  createSimpleGame,
  createSimpleGameFromDeal,
  isSimpleGameOver,
  simpleLegalMoves,
  simpleWinner,
  type SimpleMove,
} from "../simple-rules";
import {
  assertSupportedSchema,
  legalPriors,
  simpleObservation,
  SIMPLE_OBSERVATION_DIM,
} from "../simple-observation";

interface FixtureMove {
  type: string;
  card?: string | null;
  attackers?: number[];
  blockers?: Record<string, number[]>;
}

interface FixtureStep {
  priority: number;
  phase: string;
  turn: number;
  legal: FixtureMove[];
  obs: number[];
  chosen: number;
  logits?: number[];
  priors?: number[];
}

interface FixtureGame {
  seed: number;
  deal: { hand: string[]; library: string[] }[];
  steps: FixtureStep[];
  winner: number | null;
  final_life: number[];
}

/** The fixture's move shape, for comparing against the port's moves. */
function toFixtureMove(move: SimpleMove): FixtureMove {
  switch (move.type) {
    case "play_land":
    case "cast_spell":
      return { type: move.type, card: move.card };
    case "declare_attackers":
      return { type: move.type, attackers: move.attackers };
    case "declare_blockers": {
      const blockers: Record<string, number[]> = {};
      for (const k of Object.keys(move.blockers)
        .map(Number)
        .sort((a, b) => a - b)) {
        blockers[String(k)] = move.blockers[k];
      }
      return { type: move.type, blockers };
    }
    case "pass_priority":
      return { type: move.type };
  }
}

const games = (fixture as { games: FixtureGame[] }).games;

describe("manamind simple ruleset: parity with the Python engine", () => {
  it("covers every move type, including multi-blocker assignments", () => {
    const types = new Set<string>();
    let multiBlock = 0;
    for (const g of games) {
      for (const s of g.steps) {
        for (const m of s.legal) {
          types.add(m.type);
          if (
            m.type === "declare_blockers" &&
            Object.keys(m.blockers ?? {}).length > 1
          )
            multiBlock++;
        }
      }
    }
    expect([...types].sort()).toEqual([
      "cast_spell",
      "declare_attackers",
      "declare_blockers",
      "pass_priority",
      "play_land",
    ]);
    expect(multiBlock).toBeGreaterThan(0);
  });

  it.each(games.map((g) => [g.seed, g] as const))(
    "replays seed %i move for move",
    (_seed, game) => {
      let state = createSimpleGameFromDeal(game.deal);
      game.steps.forEach((step, i) => {
        const where = `seed ${game.seed} step ${i}`;
        expect({
          where,
          priority: state.priorityPlayer,
          phase: state.phase,
          turn: state.turn,
        }).toEqual({
          where,
          priority: step.priority,
          phase: step.phase,
          turn: step.turn,
        });
        const legal = simpleLegalMoves(state);
        expect({ where, legal: legal.map(toFixtureMove) }).toEqual({
          where,
          legal: step.legal,
        });

        const obs = simpleObservation(state);
        expect(obs).toHaveLength(SIMPLE_OBSERVATION_DIM);
        obs.forEach((v, j) => {
          if (Math.abs(v - step.obs[j]) > 1e-5) {
            throw new Error(`${where}: obs[${j}] ${v} != ${step.obs[j]}`);
          }
        });

        if (step.logits && step.priors) {
          const priors = legalPriors(step.logits, legal);
          priors.forEach((p, j) => {
            if (Math.abs(p - (step.priors as number[])[j]) > 1e-5) {
              throw new Error(
                `${where}: prior[${j}] ${p} != ${(step.priors as number[])[j]}`,
              );
            }
          });
        }
        state = applySimpleMove(state, legal[step.chosen]);
      });
      expect(isSimpleGameOver(state)).toBe(true);
      expect(simpleWinner(state)).toBe(game.winner);
      expect(state.players.map((p) => p.life)).toEqual(game.final_life);
    },
  );
});

describe("manamind simple ruleset: host behaviour", () => {
  it("does not mutate the state it is given", () => {
    const state = createSimpleGameFromDeal(games[0].deal);
    const before = JSON.stringify(state);
    applySimpleMove(state, simpleLegalMoves(state)[0]);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("deals a legal 40-card game from a seeded shuffle and plays it to the end", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let state = createSimpleGame(random);
    for (const p of state.players) {
      expect(p.hand).toHaveLength(7);
      expect(p.library).toHaveLength(33);
      expect(p.hand.concat(p.library).filter((c) => c.isLand)).toHaveLength(17);
    }
    let steps = 0;
    while (!isSimpleGameOver(state) && steps < 2000) {
      const legal = simpleLegalMoves(state);
      expect(legal[legal.length - 1].type).toBe("pass_priority");
      state = applySimpleMove(
        state,
        legal[Math.floor(random() * legal.length)],
      );
      steps++;
    }
    expect(isSimpleGameOver(state)).toBe(true);
  });

  it("splits a shared action type's prior evenly and ignores types not present", () => {
    const logits = new Array(23).fill(0);
    logits[1] = Math.log(2); // cast_spell
    const legal: SimpleMove[] = [
      { type: "cast_spell", player: 0, card: "Grizzly Bears" },
      { type: "cast_spell", player: 0, card: "Hill Giant" },
      { type: "pass_priority", player: 0 },
    ];
    const priors = legalPriors(logits, legal);
    expect(priors.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(priors[0]).toBeCloseTo(priors[1], 10);
    expect(priors[0] + priors[1]).toBeGreaterThan(priors[2]);
  });

  it("refuses an unknown schema version", () => {
    expect(() =>
      assertSupportedSchema({
        schema_version: "simple-v2",
        observation_dim: 25,
        actions: [],
      }),
    ).toThrow(/unsupported manamind schema_version/);
    expect(() =>
      assertSupportedSchema({
        schema_version: "simple-v1",
        observation_dim: 25,
        actions: [],
      }),
    ).not.toThrow();
  });
});
