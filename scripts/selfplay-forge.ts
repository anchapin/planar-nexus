/**
 * manamind#87: write ForgePointerNet self-play games for training.
 *
 *   npx tsx scripts/selfplay-forge.ts --model forge_pointer.onnx
 *     [--games 20] [--seed 1] [--sims 16] [--explore all|N]
 *     [--deck-a aggro] [--deck-b midrange] [--max-turns 80]
 *     --out selfplay.jsonl.gz
 *
 * One JSON game per line (gzip when --out ends in .gz), the same
 * `decisions` / `returns` shape as manamind's imitation data; each decision
 * also carries `seat` and the search target `pi`. Seats swap decks on odd
 * seeds. Prints a one-line throughput summary.
 */
import { createWriteStream, readFileSync } from "node:fs";
import { createGzip } from "node:zlib";
import * as ortNode from "onnxruntime-node";
import { loadCardScripts } from "@/lib/game-state";
import type { SimDeckArchetype } from "@/ai/simulation/game-simulator";
import { trainingDeck } from "@/ai/simulation/training-session";
import {
  createForgePointerModel,
  type ForgeOrtLike,
} from "@/ai/manamind/forge-pointer-model";
import { playSelfPlayGame } from "@/ai/manamind/forge-selfplay";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const modelPath = arg("model", "");
  const out = arg("out", "");
  if (!modelPath || !out) throw new Error("--model and --out are required");
  const games = Number(arg("games", "20"));
  const firstSeed = Number(arg("seed", "1"));
  const simulations = Number(arg("sims", "16"));
  const exploreArg = arg("explore", "all");
  const exploreMoves =
    exploreArg === "all" ? Number.POSITIVE_INFINITY : Number(exploreArg);
  const maxTurns = Number(arg("max-turns", "80"));
  const decks = [
    trainingDeck(arg("deck-a", "aggro") as SimDeckArchetype),
    trainingDeck(arg("deck-b", "midrange") as SimDeckArchetype),
  ];
  await loadCardScripts();
  const model = await createForgePointerModel(
    ortNode as unknown as ForgeOrtLike,
    readFileSync(modelPath),
  );
  const file = createWriteStream(out);
  const sink = out.endsWith(".gz") ? createGzip() : null;
  if (sink) sink.pipe(file);
  const write = (s: string) => (sink ?? file).write(s);

  const t0 = performance.now();
  let decisions = 0;
  const wins = [0, 0, 0];
  for (let g = 0; g < games; g++) {
    const seed = firstSeed + g;
    const swap = seed % 2 === 1;
    const game = await playSelfPlayGame(model, {
      seed,
      deckA: decks[swap ? 1 : 0],
      deckB: decks[swap ? 0 : 1],
      simulations,
      exploreMoves,
      maxTurns,
    });
    decisions += game.decisions.length;
    wins[game.winner === null ? 2 : game.winner]++;
    write(JSON.stringify({ ...game, swap }) + "\n");
  }
  await new Promise<void>((resolve) => {
    file.on("finish", resolve);
    (sink ?? file).end();
  });
  const secs = (performance.now() - t0) / 1000;
  console.info(
    JSON.stringify({
      games,
      decisions,
      seat0_wins: wins[0],
      seat1_wins: wins[1],
      draws: wins[2],
      seconds: +secs.toFixed(1),
      games_per_hour: +((games / secs) * 3600).toFixed(1),
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
