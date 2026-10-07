/**
 * #2612: headless training server for manamind self-play (epic
 * anchapin/manamind#84). Speaks JSON lines on stdin/stdout, one request per
 * line, one response per request.
 *
 *     npx tsx scripts/training-server.ts
 *
 * Requests (`cmd`):
 *   {"cmd":"reset","seed":1,"decks":["aggro","midrange"]}
 *   {"cmd":"legal"}                        current prompt
 *   {"cmd":"step","action":{"index":0}}    or {"attacks":[...]} / {"blocks":[...]}
 *   {"cmd":"save"}  -> {"handle":"h1"}
 *   {"cmd":"restore","handle":"h1"}
 *   {"cmd":"release","handle":"h1"}
 *   {"cmd":"result"}
 *   {"cmd":"state"}                        full serialized game state
 *
 * Every response is {"ok":true,...} or {"ok":false,"error":"..."}. A prompt
 * has `kind` priority | attack | block | choice | game_over, `playerId`, and
 * `options`; answer priority/choice prompts by option index.
 */
import { createInterface } from "node:readline";
import { serializeGameState } from "@/lib/game-state";
import type { SimDeckArchetype } from "@/ai/simulation/game-simulator";
import {
  TrainingSession,
  trainingDeck,
  type TrainingAction,
} from "@/ai/simulation/training-session";

const ARCHETYPES: SimDeckArchetype[] = ["aggro", "midrange", "control"];

const session = new TrainingSession();

function handle(req: Record<string, unknown>): Record<string, unknown> {
  switch (req.cmd) {
    case "reset": {
      const decks = (req.decks as string[] | undefined) ?? [
        "aggro",
        "midrange",
      ];
      for (const d of decks) {
        if (!ARCHETYPES.includes(d as SimDeckArchetype)) {
          throw new Error(`Unknown deck ${d}`);
        }
      }
      const players = session.reset(
        Number(req.seed ?? 0),
        trainingDeck(decks[0] as SimDeckArchetype),
        trainingDeck(decks[1] as SimDeckArchetype),
      );
      return { players, prompt: session.legalChoices() };
    }
    case "legal":
      return { prompt: session.legalChoices() };
    case "step":
      return { prompt: session.step(req.action as TrainingAction) };
    case "save":
      return { handle: session.save() };
    case "restore":
      session.restore(String(req.handle));
      return { prompt: session.legalChoices() };
    case "release":
      session.release(String(req.handle));
      return {};
    case "result":
      return { result: session.result() };
    case "state":
      return { state: JSON.parse(serializeGameState(session.state)) };
    default:
      throw new Error(`Unknown cmd ${String(req.cmd)}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let out: Record<string, unknown>;
  try {
    out = { ok: true, ...handle(JSON.parse(line)) };
  } catch (err) {
    out = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  process.stdout.write(JSON.stringify(out) + "\n");
});
