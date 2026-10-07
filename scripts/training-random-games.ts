/**
 * #2612 acceptance run: a random agent plays N seeded games through the
 * training session and reports rules errors, stalls, and replay drift.
 *
 *     npx tsx scripts/training-random-games.ts [games=1000] [replayEvery=50]
 *
 * Exits non-zero on any rules error, stall (turn or step limit), or a
 * replayed game whose fingerprint differs from the original.
 */
import { loadCardScripts } from "@/lib/game-state";
import {
  mulberry32,
  type SimDeckArchetype,
} from "@/ai/simulation/game-simulator";
import {
  randomAction,
  TrainingSession,
  trainingDeck,
  type TrainingAction,
} from "@/ai/simulation/training-session";

const games = Number(process.argv[2] ?? 1000);
const replayEvery = Number(process.argv[3] ?? 50);
const ARCHETYPES: SimDeckArchetype[] = ["aggro", "midrange", "control"];

function play(seed: number, actions?: TrainingAction[]) {
  const a = ARCHETYPES[seed % 3];
  const b = ARCHETYPES[Math.floor(seed / 3) % 3];
  const session = new TrainingSession();
  session.reset(seed, trainingDeck(a), trainingDeck(b));
  const random = mulberry32(seed * 7919 + 1);
  const taken: TrainingAction[] = [];
  let prompt = session.legalChoices();
  let i = 0;
  while (prompt.kind !== "game_over") {
    const action = actions ? actions[i++] : randomAction(prompt, random);
    taken.push(action);
    prompt = session.step(action);
  }
  return { session, taken, matchup: `${a}-${b}` };
}

async function main(): Promise<void> {
  // Card scripts load in their own chunk; without this every card reads as
  // unscripted.
  await loadCardScripts();
  const reasons: Record<string, number> = {};
  const errors: string[] = [];
  let replays = 0;
  let drift = 0;
  let steps = 0;
  let turns = 0;
  const start = Date.now();

  for (let seed = 1; seed <= games; seed++) {
    try {
      const { session, taken, matchup } = play(seed);
      const r = session.result();
      reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
      steps += r.steps;
      turns += r.turns;
      if (r.reason !== "game_over") {
        errors.push(`seed ${seed} (${matchup}): ${r.reason}`);
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
        `seed ${seed}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (seed % 100 === 0) {
      process.stderr.write(`${seed}/${games} ${JSON.stringify(reasons)}\n`);
    }
  }

  const seconds = (Date.now() - start) / 1000;
  console.info(
    JSON.stringify(
      {
        games,
        reasons,
        replays,
        drift,
        avgTurns: +(turns / games).toFixed(1),
        avgSteps: +(steps / games).toFixed(1),
        seconds: +seconds.toFixed(1),
        errors: errors.slice(0, 20),
      },
      null,
      2,
    ),
  );
  process.exit(errors.length > 0 ? 1 : 0);
}

void main();
