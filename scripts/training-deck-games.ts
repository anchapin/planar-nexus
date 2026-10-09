/**
 * #2614 acceptance run: a random agent plays N seeded games between the
 * Mono-Red Aggro and Mono-Green Landfall main decks through the training
 * session, and reports rules errors, stalls, and replay drift.
 *
 *     npx tsx scripts/training-deck-games.ts [games=1000] [replayEvery=50]
 *
 * Decks and card data live in scripts/data/decks/2614-decks.json. Seats
 * alternate by seed so each deck is on the play for half the games. Exits
 * non-zero on any rules error, stall (turn or step limit), or a replayed
 * game whose fingerprint differs from the original.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCardScripts } from "@/lib/game-state";
import type { ScryfallCard } from "@/app/actions";
import { mulberry32 } from "@/ai/simulation/game-simulator";
import {
  randomAction,
  TrainingSession,
  type TrainingAction,
} from "@/ai/simulation/training-session";

const games = Number(process.argv[2] ?? 1000);
const replayEvery = Number(process.argv[3] ?? 50);

interface DeckFile {
  decks: Record<string, { source: string; main: Record<string, number> }>;
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
  const list = data.decks[key];
  if (!list) throw new Error(`Unknown deck ${key}`);
  const cards: ScryfallCard[] = [];
  for (const [name, count] of Object.entries(list.main)) {
    const card = data.cards[name];
    if (!card) throw new Error(`No card data for ${name}`);
    const basic = BASIC_MANA[name];
    // Scryfall gives basics empty rules text; the engine reads the mana
    // ability from oracle text, as trainingDeck() does for the sim decks.
    const withMana =
      basic && !card.oracle_text
        ? { ...card, oracle_text: `({T}: Add {${basic}}.)` }
        : card;
    for (let i = 0; i < count; i++) cards.push(withMana);
  }
  if (cards.length !== 60) throw new Error(`${key} has ${cards.length} cards`);
  return cards;
}

const RED = deck("mono-red-aggro");
const GREEN = deck("mono-green-landfall");

function play(seed: number, actions?: TrainingAction[]) {
  const redFirst = seed % 2 === 0;
  const session = new TrainingSession();
  const [first, second] = redFirst ? [RED, GREEN] : [GREEN, RED];
  const players = session.reset(seed, first, second);
  const random = mulberry32(seed * 7919 + 1);
  const taken: TrainingAction[] = [];
  let prompt = session.legalChoices();
  let i = 0;
  while (prompt.kind !== "game_over") {
    const action = actions ? actions[i++] : randomAction(prompt, random);
    taken.push(action);
    prompt = session.step(action);
  }
  const redId = redFirst ? players[0] : players[1];
  return { session, taken, redFirst, redId };
}

async function main(): Promise<void> {
  // Card scripts load in their own chunk; without this every card reads as
  // unscripted.
  await loadCardScripts();
  const reasons: Record<string, number> = {};
  const wins = { red: 0, green: 0, draw: 0 };
  const errors: string[] = [];
  let replays = 0;
  let drift = 0;
  let steps = 0;
  let turns = 0;
  const start = Date.now();

  for (let seed = 1; seed <= games; seed++) {
    const seat = seed % 2 === 0 ? "red on the play" : "green on the play";
    if (process.env.TRACE_SEEDS) process.stderr.write(`seed ${seed} start\n`);
    try {
      const { session, taken, redId } = play(seed);
      const r = session.result();
      reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
      steps += r.steps;
      turns += r.turns;
      if (r.reason !== "game_over") {
        errors.push(`seed ${seed} (${seat}): ${r.reason}`);
      } else if (r.winners.length !== 1) {
        wins.draw++;
      } else if (r.winners[0] === redId) {
        wins.red++;
      } else {
        wins.green++;
      }
      if (replayEvery > 0 && seed % replayEvery === 0) {
        replays++;
        const again = play(seed, taken).session;
        if (again.fingerprint() !== session.fingerprint()) {
          drift++;
          errors.push(`seed ${seed}: replay drifted`);
        }
      }
    } catch (err) {
      reasons.error = (reasons.error ?? 0) + 1;
      errors.push(
        `seed ${seed} (${seat}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (seed % 100 === 0) {
      process.stderr.write(`${seed}/${games} ${JSON.stringify(reasons)}\n`);
    }
  }

  const seconds = (Date.now() - start) / 1000;
  console.log(
    JSON.stringify(
      {
        games,
        reasons,
        wins,
        replays,
        drift,
        avgTurns: +(turns / games).toFixed(1),
        avgSteps: +(steps / games).toFixed(1),
        seconds: +seconds.toFixed(1),
        errors: errors.slice(0, 20),
        errorCount: errors.length,
      },
      null,
      2,
    ),
  );
  process.exit(errors.length > 0 ? 1 : 0);
}

void main();
