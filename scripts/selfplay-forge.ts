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
 * also carries `seat`, the search target `pi`, and (net decisions) the
 * search's root evaluation `rootValue` (manamind#96: the search-derived
 * value target; expert decisions have none). Seats swap decks on odd
 * seeds. Deck names are #2614 decks (`red`, `green`) or simulator
 * archetypes; see scripts/sim-decks.ts. `--pick gumbel` (manamind#96)
 * plays each exploring decision as the search's own pick under Gumbel root
 * noise instead of a draw from the search policy (the default).
 * `--c-scale` sets the search's cScale (default 1); lower values soften the
 * policy target (manamind#96).
 *
 * `--opponent expert` (manamind#96): the net plays the Expert AI. Its seat
 * alternates every two games, so each seed block of four covers both seats
 * with both decks. `--expert-record both` (manamind#96) also records the
 * Expert AI's decisions as one-hot targets with `source: "expert"`;
 * default `net` keeps the old format. Prints a one-line throughput summary.
 *
 * `--opponent-model <path>` (manamind#27): the net plays a frozen snapshot
 * loaded from an ONNX path, same search recipe as the net. Its seat
 * alternates like the Expert games; only the net's decisions are recorded
 * and rows carry `opponent: "model"` plus `netSeat`. Mutually exclusive
 * with `--opponent expert`.
 *
 * `--probe collect` (manamind#106): each net decision also carries
 * the search's per-candidate value-head reads (`probe.visits`, the
 * mean leaf `q` over dealt worlds, null when unvisited) and the
 * search's own pick index, for the prediction-rerank analysis.
 * Recording only; play is unchanged.
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
  const deckNames = [arg("deck-a", "aggro"), arg("deck-b", "midrange")];
  const decks = [simDeck(deckNames[0]), simDeck(deckNames[1])];
  const opponentArg = arg("opponent", "self");
  if (opponentArg !== "self" && opponentArg !== "expert")
    throw new Error(`--opponent must be self or expert, not ${opponentArg}`);
  const opponentModelPath = arg("opponent-model", "");
  if (opponentModelPath && opponentArg === "expert")
    throw new Error(
      "--opponent-model replaces --opponent; drop --opponent expert (manamind#27)",
    );
  const opponent = opponentModelPath ? "model" : opponentArg;
  const probe = arg("probe", "") === "collect";
  if (!probe && process.argv.includes("--probe"))
    throw new Error("--probe must be collect (manamind#106)");
  const expertRecord = arg("expert-record", "net");
  if (expertRecord !== "net" && expertRecord !== "both")
    throw new Error(`--expert-record must be net or both, not ${expertRecord}`);
  await loadCardScripts();
  const model = await createForgePointerModel(
    ortNode as unknown as ForgeOrtLike,
    readFileSync(modelPath),
  );
  const opponentModel = opponentModelPath
    ? await createForgePointerModel(
        ortNode as unknown as ForgeOrtLike,
        readFileSync(opponentModelPath),
      )
    : undefined;
  const file = createWriteStream(out);
  const sink = out.endsWith(".gz") ? createGzip() : null;
  if (sink) sink.pipe(file);
  const write = (s: string) => (sink ?? file).write(s);

  const t0 = performance.now();
  let decisions = 0;
  let expertDecisions = 0;
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
      deckAName: deckNames[swap ? 1 : 0],
      deckBName: deckNames[swap ? 0 : 1],
      simulations,
      exploreMoves,
      maxTurns,
      opponent,
      ...(opponentModel ? { opponentModel } : {}),
      netSeat,
      expertRecord,
      pick,
      cScale,
      probe,
    });
    decisions += game.decisions.length;
    expertDecisions += game.decisions.filter(
      (d) => d.source === "expert",
    ).length;
    turns += game.turns;
    attack.prompts += game.attack.prompts;
    attack.offered += game.attack.offered;
    attack.declared += game.attack.declared;
    wins[game.winner === null ? 2 : game.winner]++;
    write(
      JSON.stringify(
        opponent === "self"
          ? { ...game, swap }
          : { ...game, swap, opponent, netSeat },
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
      ...(opponent === "expert" ? { expert_decisions: expertDecisions } : {}),
      ...(opponent === "model" ? { opponent_model: opponentModelPath } : {}),
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
