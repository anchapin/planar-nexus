/**
 * #2613 benchmark: cost of saving and restoring a mid-game training state.
 *
 *     npx tsx scripts/training-snapshot-bench.ts [iterations=20000]
 *
 * Plays a seeded random game to its midpoint, then times
 * `TrainingSession.save()` + `restore()` and compares it with a full
 * serialize/deserialize copy (what `cloneGameState` does). Exits non-zero
 * if save + restore averages 0.5 ms or more.
 */
import {
  deserializeGameStateString,
  loadCardScripts,
  serializeGameStateString,
  type GameState,
} from "@/lib/game-state";
import { mulberry32 } from "@/ai/simulation/game-simulator";
import {
  randomAction,
  TrainingSession,
  trainingDeck,
} from "@/ai/simulation/training-session";

const iterations = Number(process.argv[2] ?? 20000);

function midGame(seed: number): TrainingSession {
  // Find the game length, then replay to its midpoint.
  const length = (() => {
    const s = new TrainingSession();
    s.reset(seed, trainingDeck("midrange"), trainingDeck("control"));
    const random = mulberry32(seed);
    let prompt = s.legalChoices();
    let n = 0;
    while (prompt.kind !== "game_over") {
      prompt = s.step(randomAction(prompt, random));
      n++;
    }
    return n;
  })();
  const session = new TrainingSession();
  session.reset(seed, trainingDeck("midrange"), trainingDeck("control"));
  const random = mulberry32(seed);
  let prompt = session.legalChoices();
  for (let i = 0; i < Math.floor(length / 2); i++) {
    prompt = session.step(randomAction(prompt, random));
  }
  return session;
}

async function main(): Promise<void> {
  await loadCardScripts();
  const session = midGame(5);
  const state = (session as unknown as { cur: { state: GameState } }).cur.state;
  const bytes = serializeGameStateString(state).length;

  let t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    const handle = session.save();
    session.restore(handle);
    session.release(handle);
  }
  const snapshotMs = (performance.now() - t0) / iterations;

  const cloneRuns = Math.min(200, iterations);
  t0 = performance.now();
  for (let i = 0; i < cloneRuns; i++)
    deserializeGameStateString(serializeGameStateString(state));
  const cloneMs = (performance.now() - t0) / cloneRuns;

  const summary = {
    turn: session.result().turns,
    stateBytes: bytes,
    iterations,
    saveRestoreMs: Number(snapshotMs.toFixed(5)),
    fullCopyMs: Number(cloneMs.toFixed(3)),
    targetMs: 0.5,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!(snapshotMs < 0.5)) process.exit(1);
}

void main();
