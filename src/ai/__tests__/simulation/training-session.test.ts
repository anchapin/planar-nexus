/**
 * #2612: headless training session (reset / legalChoices / step / save /
 * restore / result) over the real engine.
 */
import { listPriorityChoices } from "@/lib/game-state";
import { mulberry32 } from "@/ai/simulation/game-simulator";
import {
  randomAction,
  TrainingSession,
  trainingDeck,
  type TrainingAction,
} from "@/ai/simulation/training-session";

function newSession(seed: number): TrainingSession {
  const session = new TrainingSession();
  session.reset(seed, trainingDeck("aggro"), trainingDeck("midrange"));
  return session;
}

/** Play `limit` random steps (or to the end); returns the actions taken. */
function playRandom(
  session: TrainingSession,
  agentSeed: number,
  limit = Infinity,
): TrainingAction[] {
  const random = mulberry32(agentSeed);
  const actions: TrainingAction[] = [];
  let prompt = session.legalChoices();
  while (prompt.kind !== "game_over" && actions.length < limit) {
    const action = randomAction(prompt, random);
    actions.push(action);
    prompt = session.step(action);
  }
  return actions;
}

function replay(session: TrainingSession, actions: TrainingAction[]): void {
  for (const action of actions) session.step(action);
}

describe("TrainingSession (#2612)", () => {
  it("random agents finish seeded games with no rules errors", () => {
    const kinds = new Set<string>();
    for (const seed of [1, 2, 3]) {
      const session = newSession(seed);
      const random = mulberry32(seed * 7919);
      let prompt = session.legalChoices();
      while (prompt.kind !== "game_over") {
        kinds.add(prompt.kind);
        prompt = session.step(randomAction(prompt, random));
      }
      const result = session.result();
      expect(result.done).toBe(true);
      expect(result.reason).toBe("game_over");
      expect(result.winners).toHaveLength(1);
    }
    expect(kinds).toEqual(new Set(["priority", "attack", "block"]));
  }, 60_000);

  it("replays the same seed and choices bit-identically", () => {
    const first = newSession(4);
    const actions = playRandom(first, 99, 300);
    const second = newSession(4);
    replay(second, actions);
    expect(second.fingerprint()).toBe(first.fingerprint());
  }, 60_000);

  it("asking for the legal choices never changes the game", () => {
    const session = newSession(5);
    playRandom(session, 5, 40);
    const before = session.fingerprint();
    session.legalChoices();
    session.legalChoices();
    expect(session.fingerprint()).toBe(before);
  });

  it("restores a saved game, including its random stream", () => {
    const session = newSession(6);
    playRandom(session, 6, 60);
    const handle = session.save();
    const atSave = session.fingerprint();

    const branch = playRandom(session, 7, 80);
    const branchEnd = session.fingerprint();

    session.restore(handle);
    expect(session.fingerprint()).toBe(atSave);
    replay(session, branch);
    expect(session.fingerprint()).toBe(branchEnd);
  }, 60_000);

  it("rejects an option that is not listed", () => {
    const session = newSession(8);
    const prompt = session.legalChoices();
    expect(prompt.kind).toBe("priority");
    expect(() => session.step({ index: 999 })).toThrow("No option 999");
  });

  it("never offers a land drop to the non-active player", () => {
    const session = newSession(9);
    const random = mulberry32(9);
    let prompt = session.legalChoices();
    for (let i = 0; i < 200 && prompt.kind !== "game_over"; i++) {
      const s = session.state;
      for (const id of s.players.keys()) {
        if (id === s.turn.activePlayerId) continue;
        expect(
          listPriorityChoices(s, id).some((c) => c.kind === "play_land"),
        ).toBe(false);
      }
      prompt = session.step(randomAction(prompt, random));
    }
  }, 60_000);
});
