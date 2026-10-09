/**
 * anchapin/manamind#85: score an agent against the Planar Nexus Expert AI.
 *
 *     npx tsx scripts/yardstick-pn.ts [--agent random|expert|model]
 *         [--model forge_pointer.onnx] [--sims 16] [--sample]
 *         [--games 200] [--seed 1] [--out result.json]
 *
 * Plays the #2614 deck pair (Mono-Red Aggro vs Mono-Green Landfall) through
 * the training session. Games come in pairs on the same seed with decks
 * swapped, and the deck on the play alternates by pair, so the candidate
 * plays each deck and each seat equally often. Prints JSON: wins, losses,
 * draws, score (a draw counts half) with a 95% Wilson interval, and a split
 * by the candidate's deck. `--agent model` plays a ForgePointerNet ONNX
 * checkpoint through `forgeSearch` (manamind#86): the search's greedy pick by
 * default, or a draw from its policy with `--sample`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as ortNode from "onnxruntime-node";
import { join } from "node:path";
import { loadCardScripts, type PlayerId } from "@/lib/game-state";
import type { ScryfallCard } from "@/app/actions";
import { mulberry32 } from "@/ai/simulation/game-simulator";
import { expertAction } from "@/ai/simulation/expert-agent";
import {
  randomAction,
  TrainingSession,
  type TrainingAction,
  type TrainingPrompt,
} from "@/ai/simulation/training-session";
import {
  createForgePointerModel,
  type ForgeOrtLike,
  type ForgePointerModel,
} from "@/ai/manamind/forge-pointer-model";
import { forgeSearch } from "@/ai/manamind/forge-search";

type Agent = (
  session: TrainingSession,
  prompt: TrainingPrompt,
  random: () => number,
  move: number,
) => TrainingAction | Promise<TrainingAction>;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const agentName = arg("agent", "random");
const games = Number(arg("games", "200"));
const firstSeed = Number(arg("seed", "1"));
const out = arg("out", "");
const modelPath = arg("model", "");
const simulations = Number(arg("sims", "16"));
const sample = process.argv.includes("--sample");
let model: ForgePointerModel | null = null;

/** ForgePointerNet through `forgeSearch`: greedy pick, or sampled. */
async function modelAction(
  session: TrainingSession,
  random: () => number,
  move: number,
): Promise<TrainingAction> {
  if (!model) throw new Error("--agent model needs --model");
  const r = await forgeSearch(session, model, {
    simulations,
    seed: move >>> 0,
  });
  if (!sample || r.candidates.length < 2) return r.action;
  let u = random();
  for (let i = 0; i < r.policy.length; i++) {
    u -= r.policy[i];
    if (u <= 0) return r.candidates[i].action;
  }
  return r.action;
}

const AGENTS: Record<string, Agent> = {
  random: (_s, prompt, random) => randomAction(prompt, random),
  expert: (session, prompt) => expertAction(session, prompt),
  model: (session, _prompt, random, move) => modelAction(session, random, move),
};
const candidate = AGENTS[agentName];
if (!candidate) throw new Error(`Unknown agent ${agentName}`);
if (games % 2 !== 0)
  throw new Error("--games must be even (games come in pairs)");

interface DeckFile {
  decks: Record<string, { main: Record<string, number> }>;
  cards: Record<string, ScryfallCard>;
}
const BASIC_MANA: Record<string, string> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};
const data = JSON.parse(
  readFileSync(join(__dirname, "data/decks/2614-decks.json"), "utf-8"),
) as DeckFile;
function deck(key: string): ScryfallCard[] {
  const cards: ScryfallCard[] = [];
  for (const [name, count] of Object.entries(data.decks[key].main)) {
    const card = data.cards[name];
    const basic = BASIC_MANA[name];
    const c =
      basic && !card.oracle_text
        ? { ...card, oracle_text: `({T}: Add {${basic}}.)` }
        : card;
    for (let i = 0; i < count; i++) cards.push(c);
  }
  return cards;
}
const DECKS = {
  red: deck("mono-red-aggro"),
  green: deck("mono-green-landfall"),
};

/** Wilson 95% interval for a score out of n. */
function wilson(p: number, n: number): [number, number] {
  const z = 1.96;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [+(c - h).toFixed(3), +(c + h).toFixed(3)];
}

async function playGame(
  seed: number,
  candidateDeck: "red" | "green",
  candidateFirst: boolean,
): Promise<"win" | "loss" | "draw"> {
  const session = new TrainingSession();
  const other = candidateDeck === "red" ? "green" : "red";
  const [a, b] = candidateFirst
    ? [DECKS[candidateDeck], DECKS[other]]
    : [DECKS[other], DECKS[candidateDeck]];
  const players = session.reset(seed, a, b);
  const me: PlayerId = candidateFirst ? players[0] : players[1];
  const random = mulberry32(seed * 7919 + 1);
  let prompt = session.legalChoices();
  let move = 0;
  while (prompt.kind !== "game_over") {
    const action =
      prompt.playerId === me
        ? await candidate(session, prompt, random, seed * 7919 + move++)
        : expertAction(session, prompt);
    prompt = session.step(action);
  }
  const r = prompt.result;
  if (r.winners.length !== 1) return "draw";
  return r.winners[0] === me ? "win" : "loss";
}

async function main(): Promise<void> {
  await loadCardScripts();
  if (agentName === "model") {
    if (!modelPath) throw new Error("--agent model needs --model");
    model = await createForgePointerModel(
      ortNode as unknown as ForgeOrtLike,
      readFileSync(modelPath),
    );
  }
  const start = Date.now();
  const tally = { win: 0, loss: 0, draw: 0 };
  const byDeck = {
    red: { win: 0, loss: 0, draw: 0 },
    green: { win: 0, loss: 0, draw: 0 },
  };
  const errors: string[] = [];
  for (let pair = 0; pair < games / 2; pair++) {
    const seed = firstSeed + pair;
    const candidateFirst = pair % 2 === 0;
    for (const d of ["red", "green"] as const) {
      try {
        const r = await playGame(seed, d, candidateFirst);
        tally[r]++;
        byDeck[d][r]++;
      } catch (err) {
        errors.push(
          `seed ${seed} ${d}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if ((pair + 1) % 25 === 0)
      process.stderr.write(
        `${(pair + 1) * 2}/${games} ${JSON.stringify(tally)}\n`,
      );
  }
  const n = tally.win + tally.loss + tally.draw;
  const score = n ? (tally.win + tally.draw / 2) / n : 0;
  const result = {
    yardstick: "pn-expert",
    agent: agentName,
    ...(agentName === "model" ? { model: modelPath, simulations, sample } : {}),
    opponent: "expert",
    decks: "mono-red-aggro vs mono-green-landfall (#2614)",
    games: n,
    ...tally,
    score: +score.toFixed(3),
    ci95: n ? wilson(score, n) : [0, 0],
    byDeck,
    errors: errors.slice(0, 20),
    errorCount: errors.length,
    seconds: +((Date.now() - start) / 1000).toFixed(1),
  };
  const json = JSON.stringify(result, null, 2);
  if (out) writeFileSync(out, json + "\n");
  console.log(json);
  if (errors.length) process.exitCode = 1;
}

void main();
