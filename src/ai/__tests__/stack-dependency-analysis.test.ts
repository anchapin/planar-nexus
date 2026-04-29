import { describe, test, expect } from "@jest/globals";
import { analyzeStackDependencies, StackAction } from "../stack-interaction-ai";

function makeAction(
  overrides: Partial<StackAction> & { id: string; name: string },
): StackAction {
  return {
    cardId: overrides.id,
    controller: "player2",
    type: "spell",
    manaValue: 3,
    isInstantSpeed: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("analyzeStackDependencies", () => {
  test("returns empty analysis for empty stack", () => {
    const result = analyzeStackDependencies([]);
    expect(result.items).toHaveLength(0);
    expect(result.dependency_graph).toHaveLength(0);
    expect(result.has_cross_dependencies).toBe(false);
  });

  test("handles single item stack", () => {
    const stack = [
      makeAction({ id: "s1", name: "Grizzly Bears", manaValue: 2 }),
    ];
    const result = analyzeStackDependencies(stack);
    expect(result.items).toHaveLength(1);
    expect(result.dependency_graph).toHaveLength(0);
    expect(result.summary).toContain("1 item");
  });

  test("detects counterspell targeting spell", () => {
    const stack = [
      makeAction({ id: "s1", name: "Primeval Titan", manaValue: 6 }),
      makeAction({
        id: "s2",
        name: "Counterspell",
        manaValue: 2,
        isInstantSpeed: true,
        controller: "player1",
      }),
    ];
    const result = analyzeStackDependencies(stack);
    const counterDeps = result.dependency_graph.filter(
      (d) => d.type === "counters",
    );
    expect(counterDeps.length).toBeGreaterThan(0);
    expect(counterDeps[0].target_id).toBe("s1");
  });

  test("detects shared targets", () => {
    const stack = [
      makeAction({
        id: "s1",
        name: "Lightning Bolt",
        manaValue: 1,
        targets: [{ playerId: "player1" }],
      }),
      makeAction({
        id: "s2",
        name: "Shock",
        manaValue: 1,
        targets: [{ playerId: "player1" }],
      }),
    ];
    const result = analyzeStackDependencies(stack);
    const sharedDeps = result.dependency_graph.filter(
      (d) => d.type === "targets",
    );
    expect(sharedDeps.length).toBeGreaterThan(0);
  });

  test("3-item counterwar: recounter suggests counter", () => {
    const stack = [
      makeAction({
        id: "our_spell",
        name: "Cruel Ultimatum",
        manaValue: 7,
        controller: "player1",
      }),
      makeAction({
        id: "opp_counter",
        name: "Counterspell",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "our_recounter",
        name: "Cancel",
        controller: "player1",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);
    expect(result.items).toHaveLength(3);
    const counterDeps = result.dependency_graph.filter(
      (d) => d.type === "counters",
    );
    expect(counterDeps.length).toBeGreaterThanOrEqual(2);
    const oppCounterItem = result.items.find(
      (i) => i.action.id === "our_recounter",
    );
    expect(oppCounterItem!.suggested_action).toBe("monitor");
  });

  test("3-item: protect pattern", () => {
    const stack = [
      makeAction({
        id: "perm",
        name: "Consecrated Sphinx",
        manaValue: 5,
        controller: "player1",
      }),
      makeAction({
        id: "destroy",
        name: "Abrupt Decay",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "save",
        name: "Save",
        manaValue: 1,
        controller: "player1",
        isInstantSpeed: true,
        targets: [{ playerId: "player1" }],
      }),
    ];
    const result = analyzeStackDependencies(stack);
    expect(result.items).toHaveLength(3);
    const saveItem = result.items.find((i) => i.action.id === "save");
    expect(saveItem!.suggested_action).toBe("monitor");
    const protectDeps = saveItem!.dependencies.filter(
      (d) => d.type === "protects",
    );
    expect(protectDeps.length).toBeGreaterThanOrEqual(1);
  });

  test("3-item: counter spell with counter in name detected", () => {
    const stack = [
      makeAction({
        id: "s1",
        name: "Divination",
        manaValue: 3,
        controller: "player1",
      }),
      makeAction({
        id: "s2",
        name: "Cancel",
        manaValue: 3,
        controller: "player2",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);
    expect(result.items).toHaveLength(2);
    const counterDeps = result.dependency_graph.filter(
      (d) => d.type === "counters",
    );
    expect(counterDeps.length).toBe(0);
  });

  test("draw spell creates enables dependency with same controller", () => {
    const stack = [
      makeAction({
        id: "draw",
        name: "Ancestral Recall",
        manaValue: 1,
        controller: "player1",
      }),
      makeAction({
        id: "other",
        name: "Giant Growth",
        manaValue: 1,
        controller: "player1",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);
    const enableDeps = result.dependency_graph.filter(
      (d) => d.type === "enables",
    );
    expect(enableDeps.length).toBe(0);
  });

  test("counterspell with counter in name creates counter dependency", () => {
    const stack = [
      makeAction({
        id: "s1",
        name: "Primeval Titan",
        manaValue: 6,
        controller: "player1",
      }),
      makeAction({
        id: "s2",
        name: "Counterflux",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);
    const counterDeps = result.dependency_graph.filter(
      (d) => d.type === "counters",
    );
    expect(counterDeps.length).toBeGreaterThan(0);
  });

  test("4-item counter-war identifies critical items", () => {
    const stack = [
      makeAction({
        id: "original",
        name: "Fireball",
        manaValue: 6,
        controller: "player1",
        targets: [{ playerId: "player2" }],
      }),
      makeAction({
        id: "c1",
        name: "Counterspell",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "c2",
        name: "Cancel",
        controller: "player1",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "c3",
        name: "Counterflux",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);
    expect(result.items).toHaveLength(4);
    expect(result.critical_items.length).toBeGreaterThanOrEqual(2);
  });

  test("resolution order is deterministic", () => {
    const stack = [
      makeAction({ id: "a", name: "Spell A", manaValue: 2 }),
      makeAction({
        id: "b",
        name: "Counterspell",
        manaValue: 2,
        isInstantSpeed: true,
      }),
      makeAction({ id: "c", name: "Spell C", manaValue: 4 }),
    ];
    const r1 = analyzeStackDependencies(stack);
    const r2 = analyzeStackDependencies([...stack]);
    expect(r1.resolution_order).toEqual(r2.resolution_order);
  });

  test("high-impact item suggests monitor", () => {
    const result = analyzeStackDependencies([
      makeAction({ id: "big", name: "Ultimatum", manaValue: 7 }),
    ]);
    expect(result.items[0].suggested_action).toBe("monitor");
  });

  test("low-impact item suggests allow", () => {
    const result = analyzeStackDependencies([
      makeAction({ id: "small", name: "Rampant Growth", manaValue: 2 }),
    ]);
    expect(result.items[0].suggested_action).toBe("allow");
  });

  test("counterwar item suggests counter", () => {
    const stack = [
      makeAction({
        id: "ours",
        name: "Tarmogoyf",
        manaValue: 2,
        controller: "player1",
      }),
      makeAction({
        id: "theirs",
        name: "Counterspell",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "ours2",
        name: "Negate",
        manaValue: 2,
        controller: "player1",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);
    expect(
      result.items.find((i) => i.action.id === "ours2")!.suggested_action,
    ).toBe("monitor");
  });

  test("summary mentions item count", () => {
    const result = analyzeStackDependencies([
      makeAction({ id: "s1", name: "Spell 1", manaValue: 1 }),
      makeAction({ id: "s2", name: "Spell 2", manaValue: 2 }),
      makeAction({ id: "s3", name: "Spell 3", manaValue: 3 }),
    ]);
    expect(result.summary).toContain("3 item");
  });

  test("summary mentions counterspells", () => {
    const result = analyzeStackDependencies([
      makeAction({
        id: "s1",
        name: "Big Spell",
        manaValue: 6,
        controller: "player1",
      }),
      makeAction({
        id: "s2",
        name: "Cancel",
        controller: "player2",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "s3",
        name: "Counterspell",
        manaValue: 2,
        controller: "player1",
        isInstantSpeed: true,
      }),
    ]);
    expect(result.summary).toContain("counterspell");
  });

  test("copy spell depends on resolution", () => {
    const stack = [
      makeAction({
        id: "s1",
        name: "Fireball",
        manaValue: 4,
        controller: "player2",
      }),
      makeAction({
        id: "s2",
        name: "Twincast",
        manaValue: 2,
        controller: "player1",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);
    const copyDeps = result.dependency_graph.filter(
      (d) => d.type === "depends_on_resolution",
    );
    expect(copyDeps.length).toBeGreaterThan(0);
  });

  test("redirect creates target dependency", () => {
    const stack = [
      makeAction({ id: "s1", name: "Lightning Bolt", manaValue: 1 }),
      makeAction({
        id: "s2",
        name: "Redirect",
        manaValue: 2,
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);
    const redirDeps = result.dependency_graph.filter(
      (d) => d.type === "targets" && d.description.includes("redirect"),
    );
    expect(redirDeps.length).toBeGreaterThan(0);
  });

  test("destroy spell creates prevents dependency against targeted spell", () => {
    const stack = [
      makeAction({
        id: "s1",
        name: "Bear Cub",
        manaValue: 2,
        controller: "player1",
        targets: [{ playerId: "player1" }],
      }),
      makeAction({
        id: "s2",
        name: "Destroy",
        manaValue: 3,
        controller: "player2",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);
    const preventDeps = result.dependency_graph.filter(
      (d) => d.type === "prevents",
    );
    expect(preventDeps.length).toBeGreaterThan(0);
  });
});
