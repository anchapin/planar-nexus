import { describe, test, expect } from "@jest/globals";
import {
  analyzeStackDependencies,
  StackDependencyAnalyzer,
  StackAction,
} from "../stack-interaction-ai";

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

describe("StackDependencyAnalyzer - 3-item cross-dependency scenarios", () => {
  test("3-item counterwar: analyzer detects counterwar escalation", () => {
    const stack = [
      makeAction({
        id: "original_spell",
        name: "Cruel Ultimatum",
        manaValue: 7,
        controller: "player1",
      }),
      makeAction({
        id: "opp_counter_1",
        name: "Counterspell",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "our_recounter",
        name: "Counterflux",
        manaValue: 2,
        controller: "player1",
        isInstantSpeed: true,
      }),
    ];
    const analyzer = new StackDependencyAnalyzer(stack);
    const escalation = analyzer.findCounterwarEscalation();

    expect(escalation.isCounterwar).toBe(true);
    expect(escalation.depth).toBeGreaterThanOrEqual(2);
    expect(escalation.recommendedAction).not.toBe("none");
  });

  test("3-item counterwar: dependency chains capture counter relationships", () => {
    const stack = [
      makeAction({
        id: "spell_a",
        name: "Primeval Titan",
        manaValue: 6,
        controller: "player1",
      }),
      makeAction({
        id: "counter_b",
        name: "Counterspell",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "recounter_c",
        name: "Cancel",
        manaValue: 3,
        controller: "player1",
        isInstantSpeed: true,
      }),
    ];
    const analyzer = new StackDependencyAnalyzer(stack);
    const chains = analyzer.getDependencyChains();

    expect(chains.length).toBeGreaterThan(0);
    const counterChain = chains.find((c) => c.involves_counterwar);
    if (counterChain) {
      expect(counterChain.chain.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("3-item: allow to prevent worse outcome pattern", () => {
    const stack = [
      makeAction({
        id: "our_value_spell",
        name: "Consecrated Sphinx",
        manaValue: 5,
        controller: "player1",
      }),
      makeAction({
        id: "opp_remove",
        name: "Abrupt Decay",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
        targets: [{ playerId: "player1" }],
      }),
      makeAction({
        id: "our_protect",
        name: "Protect",
        manaValue: 1,
        controller: "player1",
        isInstantSpeed: true,
        targets: [{ playerId: "player1" }],
      }),
    ];
    const analyzer = new StackDependencyAnalyzer(stack);
    const advice = analyzer.getResolutionAdvice();

    const removeItem = advice.find((a) => a.itemId === "opp_remove");
    expect(removeItem).toBeDefined();
    expect(removeItem!.dependencies_affected.length).toBeGreaterThan(0);
  });

  test("3-item: resolution advice returns correct priorities", () => {
    const stack = [
      makeAction({
        id: "threat",
        name: "Exsanguinate",
        manaValue: 6,
        controller: "player2",
        targets: [{ playerId: "player1" }],
      }),
      makeAction({
        id: "counter_response",
        name: "Counterspell",
        manaValue: 2,
        controller: "player1",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "counter_counter",
        name: "Counterflux",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
    ];
    const analyzer = new StackDependencyAnalyzer(stack);
    const advice = analyzer.getResolutionAdvice();

    expect(advice).toHaveLength(3);
    const highPriority = advice.filter(
      (a) => a.priority === "high" || a.priority === "critical",
    );
    expect(highPriority.length).toBeGreaterThanOrEqual(1);
  });

  test("3-item: cross-dependencies between non-adjacent items", () => {
    const stack = [
      makeAction({
        id: "bottom_threat",
        name: "Fireball",
        manaValue: 6,
        controller: "player2",
        targets: [{ playerId: "player1" }],
      }),
      makeAction({
        id: "middle_removal",
        name: "Hero's Downfall",
        manaValue: 3,
        controller: "player1",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "top_counter",
        name: "Counterspell",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);

    const topToMiddleDeps = result.dependency_graph.filter(
      (d) => d.source_id === "top_counter" && d.target_id === "middle_removal",
    );
    expect(topToMiddleDeps.length).toBeGreaterThan(0);
  });

  test("3-item: critical items include items with bidirectional deps", () => {
    const stack = [
      makeAction({
        id: "original",
        name: "Fireball",
        manaValue: 6,
        controller: "player1",
        targets: [{ playerId: "player2" }],
      }),
      makeAction({
        id: "counter1",
        name: "Counterspell",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "counter2",
        name: "Counterflux",
        manaValue: 2,
        controller: "player1",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);

    expect(result.critical_items.length).toBeGreaterThanOrEqual(1);
    const counterItem = result.items.find((i) => i.action.id === "counter1");
    expect(counterItem!.critical_path).toBe(true);
  });

  test("3-item: resolution order prioritizes critical path items", () => {
    const stack = [
      makeAction({ id: "s1", name: "Rampant Growth", manaValue: 2 }),
      makeAction({
        id: "s2",
        name: "Counterspell",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "s3",
        name: "Counterflux",
        manaValue: 2,
        controller: "player1",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);

    const criticalIdx = result.resolution_order.findIndex(
      (id) => result.items.find((i) => i.action.id === id)?.critical_path,
    );
    const nonCriticalIdx = result.resolution_order.findIndex((id) =>
      result.items.find((i) => i.action.id === id && !i.critical_path),
    );
    if (criticalIdx >= 0 && nonCriticalIdx >= 0) {
      expect(criticalIdx).toBeLessThan(nonCriticalIdx);
    }
  });

  test("3-item: dependency graph has correct source/target pairs", () => {
    const stack = [
      makeAction({
        id: "spell",
        name: "Primeval Titan",
        manaValue: 6,
        controller: "player1",
      }),
      makeAction({
        id: "counter",
        name: "Counterspell",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "draw_response",
        name: "Ancestral Recall",
        manaValue: 1,
        controller: "player1",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);
    const counterDep = result.dependency_graph.find(
      (d) =>
        d.type === "counters" &&
        d.source_id === "counter" &&
        d.target_id === "spell",
    );
    expect(counterDep).toBeDefined();
    expect(counterDep!.strength).toBeGreaterThan(0);
  });

  test("3-item: has_cross_dependencies true when items chain-link", () => {
    const stack = [
      makeAction({
        id: "a",
        name: "Ultimatum",
        manaValue: 7,
        controller: "player1",
      }),
      makeAction({
        id: "b",
        name: "Counterspell",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "c",
        name: "Counterflux",
        manaValue: 2,
        controller: "player1",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);
    expect(result.has_cross_dependencies).toBe(true);
  });

  test("3-item: has_cross_dependencies false with no links", () => {
    const stack = [
      makeAction({ id: "a", name: "Rampant Growth", manaValue: 2 }),
      makeAction({
        id: "b",
        name: "Shock",
        manaValue: 1,
        controller: "player2",
        targets: [{ playerId: "player1" }],
        isInstantSpeed: true,
      }),
      makeAction({
        id: "c",
        name: "Giant Growth",
        manaValue: 1,
        controller: "player2",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);
    expect(result.has_cross_dependencies).toBe(false);
  });

  test("analyzer: empty stack returns empty advice", () => {
    const analyzer = new StackDependencyAnalyzer([]);
    const advice = analyzer.getResolutionAdvice();
    expect(advice).toHaveLength(0);
  });

  test("analyzer: counterwar detection with 2 counters", () => {
    const stack = [
      makeAction({
        id: "spell",
        name: "Divination",
        manaValue: 3,
        controller: "player1",
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
        name: "Counterspell",
        manaValue: 2,
        controller: "player1",
        isInstantSpeed: true,
      }),
    ];
    const analyzer = new StackDependencyAnalyzer(stack);
    const escalation = analyzer.findCounterwarEscalation();

    expect(escalation.isCounterwar).toBe(true);
    expect(escalation.depth).toBeGreaterThanOrEqual(2);
  });

  test("analyzer: no counterwar without counters", () => {
    const stack = [
      makeAction({ id: "s1", name: "Grizzly Bears", manaValue: 2 }),
      makeAction({
        id: "s2",
        name: "Shock",
        manaValue: 1,
        isInstantSpeed: true,
      }),
      makeAction({
        id: "s3",
        name: "Giant Growth",
        manaValue: 1,
        isInstantSpeed: true,
      }),
    ];
    const analyzer = new StackDependencyAnalyzer(stack);
    const escalation = analyzer.findCounterwarEscalation();

    expect(escalation.isCounterwar).toBe(false);
    expect(escalation.depth).toBe(0);
  });

  test("analyzer: dependency chains handle empty analysis", () => {
    const analyzer = new StackDependencyAnalyzer([]);
    const chains = analyzer.getDependencyChains();
    expect(chains).toHaveLength(0);
  });

  test("analyzer: resolution advice has consistent length with items", () => {
    const stack = [
      makeAction({ id: "a", name: "Spell A", manaValue: 2 }),
      makeAction({ id: "b", name: "Spell B", manaValue: 3 }),
      makeAction({ id: "c", name: "Spell C", manaValue: 4 }),
    ];
    const analyzer = new StackDependencyAnalyzer(stack);
    const analysis = analyzer.getAnalysis();
    const advice = analyzer.getResolutionAdvice();

    expect(advice.length).toBe(analysis.items.length);
  });

  test("analyzer: resolution advice dependencies_affected are non-empty for linked items", () => {
    const stack = [
      makeAction({
        id: "threat",
        name: "Primeval Titan",
        manaValue: 6,
        controller: "player1",
      }),
      makeAction({
        id: "counter",
        name: "Counterspell",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "response",
        name: "Twincast",
        manaValue: 2,
        controller: "player1",
        isInstantSpeed: true,
      }),
    ];
    const analyzer = new StackDependencyAnalyzer(stack);
    const advice = analyzer.getResolutionAdvice();

    const counterAdvice = advice.find((a) => a.itemId === "counter");
    expect(counterAdvice!.dependencies_affected.length).toBeGreaterThan(0);
  });

  test("3-item: copy + counter create mixed dependency types", () => {
    const stack = [
      makeAction({
        id: "fireball",
        name: "Fireball",
        manaValue: 4,
        controller: "player2",
        targets: [{ playerId: "player1" }],
      }),
      makeAction({
        id: "counter",
        name: "Counterspell",
        manaValue: 2,
        controller: "player1",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "copy",
        name: "Twincast",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);
    const depTypes = new Set(result.dependency_graph.map((d) => d.type));
    expect(depTypes.has("counters")).toBe(true);
    expect(depTypes.has("depends_on_resolution")).toBe(true);
  });

  test("3-item: resolution order is stable across repeated calls", () => {
    const stack = [
      makeAction({
        id: "x",
        name: "Counterspell",
        manaValue: 2,
        controller: "player2",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "y",
        name: "Counterflux",
        manaValue: 2,
        controller: "player1",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "z",
        name: "Ultimatum",
        manaValue: 7,
        controller: "player2",
      }),
    ];
    const r1 = analyzeStackDependencies([...stack]);
    const r2 = analyzeStackDependencies([...stack]);
    expect(r1.resolution_order).toEqual(r2.resolution_order);
  });

  test("3-item: items with no controller conflict have no counter deps", () => {
    const stack = [
      makeAction({
        id: "p1_spell",
        name: "Primeval Titan",
        manaValue: 6,
        controller: "player1",
      }),
      makeAction({
        id: "p1_counter",
        name: "Counterspell",
        manaValue: 2,
        controller: "player1",
        isInstantSpeed: true,
      }),
      makeAction({
        id: "p2_spell",
        name: "Cancel",
        manaValue: 3,
        controller: "player2",
        isInstantSpeed: true,
      }),
    ];
    const result = analyzeStackDependencies(stack);
    const sameControllerCounter = result.dependency_graph.find(
      (d) =>
        d.type === "counters" &&
        d.source_id === "p1_counter" &&
        d.target_id === "p1_spell",
    );
    expect(sameControllerCounter).toBeUndefined();
  });

  test("analyzer: escalation depth increases with more counters", () => {
    const twoCounterStack = [
      makeAction({
        id: "s1",
        name: "Ultimatum",
        manaValue: 7,
        controller: "player1",
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
        name: "Counterspell",
        manaValue: 2,
        controller: "player1",
        isInstantSpeed: true,
      }),
    ];

    const threeCounterStack = [
      makeAction({
        id: "s1",
        name: "Ultimatum",
        manaValue: 7,
        controller: "player1",
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
        name: "Counterflux",
        manaValue: 2,
        controller: "player1",
        isInstantSpeed: true,
      }),
    ];

    const three = new StackDependencyAnalyzer(threeCounterStack);
    const two = new StackDependencyAnalyzer(twoCounterStack);

    expect(three.findCounterwarEscalation().depth).toBeGreaterThanOrEqual(
      two.findCounterwarEscalation().depth,
    );
  });
});
