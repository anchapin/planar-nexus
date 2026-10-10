/**
 * manamind#87: write ForgePointerNet self-play games for training.
 *
 *   npx tsx scripts/selfplay-forge.ts --model forge_pointer.onnx
 *     [--games 20] [--seed 1] [--sims 16] [--explore all|N]
 *     [--pick sample|gumbel] [--c-scale 1]
 *     [--deck-a aggro] [--deck-b midrange] [--max-turns 80]
 *     [--opponent self|expert] --out selfplay.jsonl.gz
 *
 * One JSON game per line (gzip when --out ends in .gz), the same
 * `decisions` / `returns` shape as manamind's imitation data; each decision
 * also carries `seat` and the search target `pi`. Seats swap decks on odd
 * seeds. Deck names are #2614 decks (`red`, `green`) or simulator
 * archetypes; see scripts/sim-decks.ts. `--pick gumbel` (manamind#96)
 * plays each exploring decision as the search's own pick under Gumbel root
 * noise instead of a draw from the search policy (the default).
 * `--c-scale` sets the search's cScale (default 1); lower values soften the
 * policy target (manamind#96).
 *
 * `--opponent expert` (manamind#96): the net plays the Expert AI and only
 * its own decisions are written. Its seat alternates every two games, so
 * each seed block of four covers both seats with both decks. Prints a
 * one-line throughput summary.
 */
import { createWriteStream, readFileSync } from "node:fs";
import { createGzip } from "node:zlib";
import * as ortNode from "onnxruntime-node";
import { loadCardScripts } from "@/lib/game-state";
import {
  createForgePointerModel,
  type ForgeOrtLike,
} from "@/ai/manamind/forge-pointer-model";
import { playSelfPlayGame } from "@/ai/manamind/forge-selfplay";
import { simDeck } from "./sim-decks";

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
  const pick = arg("pick", "sample");
  if (pick !== "sample" && pick !== "gumbel")
    throw new Error(`--pick must be sample or gumbel, not ${pick}`);
  const cScaleArg = arg("c-scale", "");
  const cScale = cScaleArg === "" ? undefined : Number(cScaleArg);
  if (cScale !== undefined && !(Number.isFinite(cScale) && cScale > 0))
    throw new Error(`--c-scale must be a positive number, not ${cScaleArg}`);
  const decks = [
    simDeck(arg("deck-a", "aggro")),
    simDeck(arg("deck-b", "midrange")),
  ];
  const opponent = arg("opponent", "self");
  if (opponent !== "self" && opponent !== "expert")
    throw new Error(`--opponent must be self or expert, not ${opponent}`);
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
  let turns = 0;
  const attack = { prompts: 0, offered: 0, declared: 0 };
  const wins = [0, 0, 0];
  for (let g = 0; g < games; g++) {
    const seed = firstSeed + g;
    const swap = seed % 2 === 1;
    const netSeat = (Math.floor(g / 2) % 2) as 0 | 1;
    const game = await playSelfPlayGame(model, {
      seed,
      deckA: decks[swap ? 1 : 0],
      deckB: decks[swap ? 0 : 1],
      simulations,
      exploreMoves,
      maxTurns,
      opponent,
      netSeat,
      pick,
      cScale,
    });
    decisions += game.decisions.length;
    turns += game.turns;
    attack.prompts += game.attack.prompts;
    attack.offered += game.attack.offered;
    attack.declared += game.attack.declared;
    wins[game.winner === null ? 2 : game.winner]++;
    write(
      JSON.stringify(
        opponent === "expert"
          ? { ...game, swap, opponent, netSeat }
          : { ...game, swap },
      ) + "\n",
    );
  }
  await new Promise<void>((resolve) => {
    file.on("finish", resolve);
    (sink ?? file).end();
  });
  const secs = (performance.now() - t0) / 1000;
  console.info(
    JSON.stringify({
      games,
      opponent,
      decisions,
      seat0_wins: wins[0],
      seat1_wins: wins[1],
      draws: wins[2],
      turns_per_game: +(turns / Math.max(games, 1)).toFixed(1),
      attack_prompts: attack.prompts,
      attack_rate: +(attack.declared / Math.max(attack.offered, 1)).toFixed(3),
      ...(cScale === undefined ? {} : { c_scale: cScale }),
      seconds: +secs.toFixed(1),
      games_per_hour: +((games / secs) * 3600).toFixed(1),
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
