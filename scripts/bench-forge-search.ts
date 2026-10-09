/**
 * manamind#86: time a 16-simulation ForgePointerNet search move on a
 * mid-game TrainingSession state. Done when the median is under 100 ms on
 * the home PC.
 *
 *   npx tsx scripts/bench-forge-search.ts [--model forge_pointer.onnx]
 *     [--sims 16] [--reps 30] [--seed 5] [--steps 60]
 *
 * Without --model it uses the random-init test model, which has the same
 * shape (and cost) as a trained default-size checkpoint.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ortNode from "onnxruntime-node";
import { loadCardScripts } from "@/lib/game-state";
import { mulberry32 } from "@/ai/simulation/game-simulator";
import {
  randomAction,
  TrainingSession,
  trainingDeck,
} from "@/ai/simulation/training-session";
import {
  createForgePointerModel,
  type ForgeOrtLike,
} from "@/ai/manamind/forge-pointer-model";
import { forgeCandidates, forgeSearch } from "@/ai/manamind/forge-search";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const modelPath = arg(
    "model",
    join(
      __dirname,
      "../src/ai/manamind/__tests__/fixtures/forge_pointer_v1_seed86.onnx",
    ),
  );
  await loadCardScripts();
  const sims = Number(arg("sims", "16"));
  const reps = Number(arg("reps", "30"));
  const seed = Number(arg("seed", "5"));
  const steps = Number(arg("steps", "60"));
  const model = await createForgePointerModel(
    ortNode as unknown as ForgeOrtLike,
    readFileSync(modelPath),
  );

  // Random play to a mid-game decision with a real choice to make.
  const session = new TrainingSession();
  session.reset(seed, trainingDeck("aggro"), trainingDeck("midrange"));
  const random = mulberry32(seed);
  let prompt = session.legalChoices();
  for (let i = 0; prompt.kind !== "game_over"; i++) {
    if (i >= steps && prompt.kind !== "choice") {
      const { candidates } = await forgeCandidates(session, prompt, model);
      if (candidates.length >= 3) break;
    }
    prompt = session.step(randomAction(prompt, random));
  }
  if (prompt.kind === "game_over") throw new Error("game ended; try --steps");

  const times: number[] = [];
  let last = null;
  for (let r = 0; r < reps + 3; r++) {
    const t0 = performance.now();
    last = await forgeSearch(session, model, { simulations: sims, seed: r });
    if (r >= 3) times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const q = (p: number) =>
    times[Math.min(times.length - 1, Math.floor(p * times.length))];
  const s = session.state;
  console.info(
    JSON.stringify(
      {
        prompt: prompt.kind,
        turn: s.turn.turnNumber,
        candidates: last?.candidates.length,
        simulations: last?.simulations,
        evaluations: last?.evaluations,
        reps,
        median_ms: +q(0.5).toFixed(2),
        p90_ms: +q(0.9).toFixed(2),
        min_ms: +times[0].toFixed(2),
        target_ms: 100,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
