import { describeSimpleMove } from "../describe-move";
import {
  createSimpleGameFromDeal,
  makeSimpleCard,
  type SimpleGameState,
} from "../simple-rules";

function game(): SimpleGameState {
  const library = Array.from({ length: 30 }, () => "Forest");
  const state = createSimpleGameFromDeal([
    { hand: ["Forest", "Hill Giant"], library },
    { hand: ["Forest"], library },
  ]);
  state.players[0].battlefield.push(
    makeSimpleCard("Grizzly Bears"),
    makeSimpleCard("Craw Wurm"),
  );
  state.players[1].battlefield.push(makeSimpleCard("Canopy Spider"));
  return state;
}

describe("describeSimpleMove", () => {
  it("names lands and spells with their cost and stats", () => {
    const s = game();
    expect(
      describeSimpleMove(s, { type: "play_land", player: 0, card: "Forest" }),
    ).toBe("Play Forest");
    expect(
      describeSimpleMove(s, {
        type: "cast_spell",
        player: 0,
        card: "Hill Giant",
      }),
    ).toBe("Cast Hill Giant (4 mana, 3/3)");
  });

  it("names attackers by card", () => {
    const s = game();
    s.phase = "combat";
    expect(
      describeSimpleMove(s, {
        type: "declare_attackers",
        player: 0,
        attackers: [0, 1],
      }),
    ).toBe("Attack with Grizzly Bears, Craw Wurm");
  });

  it("names blocks by attacker and blocker", () => {
    const s = game();
    s.phase = "combat";
    s.priorityPlayer = 1;
    expect(
      describeSimpleMove(s, {
        type: "declare_blockers",
        player: 1,
        blockers: { 1: [0] },
      }),
    ).toBe("Block Craw Wurm with Canopy Spider");
    expect(
      describeSimpleMove(s, {
        type: "declare_blockers",
        player: 1,
        blockers: {},
      }),
    ).toBe("No blocks");
  });

  it("describes passing by phase and seat", () => {
    const s = game();
    expect(describeSimpleMove(s, { type: "pass_priority", player: 0 })).toBe(
      "Pass",
    );
    s.phase = "combat";
    expect(describeSimpleMove(s, { type: "pass_priority", player: 0 })).toBe(
      "Don't attack",
    );
    expect(describeSimpleMove(s, { type: "pass_priority", player: 1 })).toBe(
      "No blocks",
    );
  });
});
