/**
 * manamind#87: gate a new ForgePointerNet checkpoint against the previous one.
 *
 *   npx tsx scripts/gate-forge.ts --candidate new.onnx --baseline old.onnx
 *     [--games 40] [--seed 1] [--sims 16] [--threshold 0.55]
 *     [--greedy] [--deck-a aggro] [--deck-b midrange] [--max-turns 80]
 *     [--out gate.json]
 *
 * The candidate's seat alternates every game and the decks swap every two,
 * so each seed block of four covers both seats with both decks. Prints the
 * summary (score with a draw as half, Wilson 95% interval, promote) and
 * writes it with the per-game results to --out.
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as ortNode from "onnxruntime-node";
import { loadCardScripts } from "@/lib/game-state";
import type { SimDeckArchetype } from "@/ai/simulation/game-simulator";
import { trainingDeck } from "@/ai/simulation/training-session";
import {
  createForgePointerModel,
  type ForgeOrtLike,
} from "@/ai/manamind/forge-pointer-model";
import {
  gateSummary,
  playGateGame,
  type GateGame,
} from "@/ai/manamind/forge-gate";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const candidatePath = arg("candidate", "");
  const baselinePath = arg("baseline", "");
  if (!candidatePath || !baselinePath)
    throw new Error("--candidate and --baseline are required");
  const games = Number(arg("games", "40"));
  const firstSeed = Number(arg("seed", "1"));
  const simulations = Number(arg("sims", "16"));
  const threshold = Number(arg("threshold", "0.55"));
  const maxTurns = Number(arg("max-turns", "80"));
  const sample = !process.argv.includes("--greedy");
  const out = arg("out", "");
  const decks = [
    trainingDeck(arg("deck-a", "aggro") as SimDeckArchetype),
    trainingDeck(arg("deck-b", "midrange") as SimDeckArchetype),
  ];
  await loadCardScripts();
  const ort = ortNode as unknown as ForgeOrtLike;
  const candidate = await createForgePointerModel(
    ort,
    readFileSync(candidatePath),
  );
  const baseline = await createForgePointerModel(
    ort,
    readFileSync(baselinePath),
  );
  const t0 = performance.now();
  const results: GateGame[] = [];
  for (let g = 0; g < games; g++) {
    const seed = firstSeed + g;
    const swap = Math.floor(g / 2) % 2 === 1;
    results.push(
      await playGateGame(candidate, baseline, {
        seed,
        deckA: decks[swap ? 1 : 0],
        deckB: decks[swap ? 0 : 1],
        candidateSeat: (g % 2) as 0 | 1,
        simulations,
        sample,
        maxTurns,
      }),
    );
  }
  const summary = {
    candidate: candidatePath,
    baseline: baselinePath,
    simulations,
    sample,
    ...gateSummary(results, threshold),
    seconds: +((performance.now() - t0) / 1000).toFixed(1),
  };
  console.info(JSON.stringify(summary));
  if (out)
    writeFileSync(out, JSON.stringify({ ...summary, results }, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
