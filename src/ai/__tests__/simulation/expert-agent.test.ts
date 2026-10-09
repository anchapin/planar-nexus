/**
 * anchapin/manamind#85: the Expert AI as a TrainingSession agent.
 */
import { expertAction } from "@/ai/simulation/expert-agent";
import {
  TrainingSession,
  trainingDeck,
  type TrainingAction,
} from "@/ai/simulation/training-session";

/** Expert plays both seats for `limit` decisions; returns actions + fingerprint. */
function playExpert(seed: number, limit: number) {
  const session = new TrainingSession();
  session.reset(seed, trainingDeck("aggro"), trainingDeck("midrange"));
  const actions: TrainingAction[] = [];
  let prompt = session.legalChoices();
  while (prompt.kind !== "game_over" && actions.length < limit) {
    const action = expertAction(session, prompt);
    actions.push(action);
    prompt = session.step(action);
  }
  return { actions, fingerprint: session.fingerprint(), session };
}

describe("expertAction", () => {
  it("answers every prompt with a move the engine accepts", () => {
    const { actions, session } = playExpert(3, 150);
    expect(actions.length).toBeGreaterThan(0);
    expect(session.result().reason).not.toBe("step_limit");
  });

  it("is deterministic for a seed and leaves the game where it was", () => {
    const a = playExpert(5, 80);
    const b = playExpert(5, 80);
    expect(b.actions).toEqual(a.actions);
    expect(b.fingerprint).toBe(a.fingerprint);
  });

  it("plays a land or a spell when it has one, instead of always passing", () => {
    const { actions } = playExpert(7, 150);
    const nonPass = actions.filter((x) => "index" in x && x.index !== 0);
    expect(nonPass.length).toBeGreaterThan(0);
  });
});
