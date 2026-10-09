/**
 * The Planar Nexus Expert AI as a TrainingSession agent (anchapin/manamind#85).
 *
 * The app's Expert AI plays whole turns (`runAITurn`), so it can't answer
 * training prompts one at a time. This agent uses the same Expert-tier
 * pieces per prompt:
 * - attack / block: the Expert combat decision tree (`AIOpponent`).
 * - priority / choice: a one-move lookahead. Each listed option is tried on
 *   a saved copy of the game, the stack is passed out until it is empty, and
 *   the result is scored with the Expert board evaluator. Ties go to the
 *   lowest index (pass is listed first), so the agent is deterministic.
 *
 * It is a fixed, deterministic yardstick opponent, stronger than random.
 * It is not move-for-move the app's turn loop.
 */
import type { PlayerId } from "@/lib/game-state";
import { AIOpponent } from "@/ai/ai-opponent";
import { evaluateGameState } from "@/ai/game-state-evaluator";
import { convertToAIGameState } from "@/lib/ai-game-state-adapter";
import {
  dropLimitBreakingBlocks,
  type TrainingAction,
  type TrainingPrompt,
  type TrainingSession,
} from "./training-session";

/** Passes allowed while the stack resolves after a tried option. */
const SETTLE_STEPS = 8;
const WIN = 1e9;

const opponent = new AIOpponent("expert");

function score(session: TrainingSession, playerId: PlayerId): number {
  const result = session.result();
  if (result.done) {
    if (result.winners.length !== 1) return 0;
    return result.winners[0] === playerId ? WIN : -WIN;
  }
  const state = session.state;
  return evaluateGameState(
    convertToAIGameState(state, playerId),
    playerId,
    "expert",
  ).totalScore;
}

/** Pass priority (and take the first answer to any choice) until the stack is empty. */
function settle(session: TrainingSession, prompt: TrainingPrompt): void {
  for (let i = 0; i < SETTLE_STEPS; i++) {
    if (prompt.kind === "choice") {
      prompt = session.step({ index: 0 });
      continue;
    }
    if (prompt.kind !== "priority" || session.state.stack.length === 0) return;
    const pass = prompt.options.findIndex((o) => o.kind === "pass");
    if (pass < 0) return;
    prompt = session.step({ index: pass });
  }
}

function bestIndex(
  session: TrainingSession,
  playerId: PlayerId,
  count: number,
): number {
  if (count <= 1) return 0;
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < count; i++) {
    const handle = session.save();
    let value = -Infinity;
    try {
      settle(session, session.step({ index: i }));
      value = score(session, playerId);
    } catch {
      // An option the engine rejects is never the pick.
    } finally {
      session.restore(handle);
      session.release(handle);
    }
    if (value > bestScore) {
      bestScore = value;
      best = i;
    }
  }
  return best;
}

/** The Expert agent's action for `prompt` in `session`. */
export function expertAction(
  session: TrainingSession,
  prompt: TrainingPrompt,
): TrainingAction {
  switch (prompt.kind) {
    case "attack": {
      const chosen = new Set(
        opponent.getAttackers(session.state, prompt.playerId),
      );
      return {
        attacks: prompt.options
          .filter((o) => chosen.has(o.cardId))
          .map((o) => ({
            cardId: o.cardId,
            defenderId:
              o.defenders.find((d) => session.state.players.has(d)) ??
              o.defenders[0],
          })),
      };
    }
    case "block": {
      const plan = opponent.getBlockers(session.state, prompt.playerId, []);
      const allowed = new Map(prompt.options.map((o) => [o.cardId, o]));
      const blocks = Object.entries(plan).flatMap(([attackerId, blockers]) =>
        blockers
          .filter((b) => allowed.get(b)?.attackers.includes(attackerId))
          .map((blockerId) => ({ blockerId, attackerId })),
      );
      // One block per creature.
      const seen = new Set<string>();
      const unique = blocks.filter(
        (b) => !seen.has(b.blockerId) && seen.add(b.blockerId),
      );
      return { blocks: dropLimitBreakingBlocks(unique, prompt.limits) };
    }
    case "game_over":
      throw new Error("The game is over");
    default:
      return {
        index: bestIndex(session, prompt.playerId, prompt.options.length),
      };
  }
}
