/**
 * manamind#96: compare two ForgePointerNet checkpoints' root priors on the
 * positions of a gate match between them.
 *
 *   npx tsx scripts/compare-priors-forge.ts --candidate b.onnx --baseline a.onnx
 *     [--games 48] [--seed 4000001] [--sims 16] [--baseline-sims N]
 *     [--greedy] [--deck-a red] [--deck-b green] [--max-turns 80]
 *     [--out priors.json]
 *
 * Plays the games exactly like scripts/gate-forge.ts (same seeds, seats and
 * deck rotation). At every decision both nets score the same position and
 * the script records each prior's entropy, top-1 probability, top-1
 * agreement, top-3 overlap, the candidate's prior on the baseline's top
 * action and the total variation distance. Prints a per-kind summary (A =
 * baseline, B = candidate) and writes it, the gate result and every row to
 * --out.
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as ortNode from "onnxruntime-node";
import { loadCardScripts } from "@/lib/game-state";
import {
  createForgePointerModel,
  type ForgeOrtLike,
} from "@/ai/manamind/forge-pointer-model";
import { forgeCandidates } from "@/ai/manamind/forge-search";
import {
  gateSummary,
  playGateGame,
  type GateGame,
} from "@/ai/manamind/forge-gate";
import {
  comparePriors,
  summarizePriors,
  type PriorRow,
} from "@/ai/manamind/prior-compare";
import { simDeck } from "./sim-decks";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const candidatePath = arg("candidate", "");
  const baselinePath = arg("baseline", "");
  if (!candidatePath || !baselinePath)
    throw new Error("--candidate and --baseline are required");
  const games = Number(arg("games", "48"));
  const firstSeed = Number(arg("seed", "4000001"));
  const simulations = Number(arg("sims", "16"));
  const baselineSimulations = Number(arg("baseline-sims", String(simulations)));
  const maxTurns = Number(arg("max-turns", "80"));
  const pick = process.argv.includes("--greedy") ? "greedy" : "sample";
  const out = arg("out", "");
  const decks = [
    simDeck(arg("deck-a", "red")),
    simDeck(arg("deck-b", "green")),
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
  const rows: PriorRow[] = [];
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
        baselineSimulations,
        pick,
        maxTurns,
        onDecision: async (session, prompt, candidateToAct) => {
          const a = await forgeCandidates(session, prompt, baseline);
          const b = await forgeCandidates(session, prompt, candidate);
          rows.push(
            comparePriors({
              kind: prompt.kind,
              candidateToAct,
              a: a.candidates,
              b: b.candidates,
            }),
          );
        },
      }),
    );
  }
  const summary = {
    candidate: candidatePath,
    baseline: baselinePath,
    simulations,
    baseline_simulations: baselineSimulations,
    pick,
    gate: gateSummary(results, 0.55),
    priors: summarizePriors(rows),
    priors_candidate_to_act: summarizePriors(
      rows.filter((r) => r.candidateToAct),
    ),
    seconds: +((performance.now() - t0) / 1000).toFixed(1),
  };
  console.info(JSON.stringify(summary));
  if (out)
    writeFileSync(out, JSON.stringify({ ...summary, rows }, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
