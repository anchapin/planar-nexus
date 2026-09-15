/**
 * Mutation-targeted edge cases for `layer-system.ts`.
 *
 * Issue #1711: Stryker mutation suite for the CR 613 layer system — the
 * weakest measured baseline (56.65%, floor 55). These tests pin down the
 * ordering- and boundary-sensitive mutants Stryker reports as surviving:
 *
 *  - Layer ordering boundaries (CR 613.1): the 1→7 sort key, including
 *    adjacent-layer pairs, must order effects exactly.
 *  - Timestamp dependence (CR 613.6-613.7): within a layer/sublayer the
 *    later timestamp applies last and wins for non-commutative effects
 *    (e.g. Layer 7b P/T setters); equal timestamps fall to the priority
 *    tiebreak.
 *  - Sublayer dependency boundaries (CR 613.8): the exact 7a→7b→7c→7d→7e
 *    slice edges in getSublayerDependencies/getSublayersDependingOn and the
 *    pipeline order CDA → set → counters → switch → modify, where any
 *    reordering (notably switch vs modify, counters vs modify) produces a
 *    different P/T.
 *  - Dependency-aware ordering (CR 613.7): an explicit dependency chain
 *    (C→B→A) must override timestamp order transitively, and cycles
 *    (self-edge, transitive, same-sublayer mutual) must be rejected.
 *  - Copy-chain resolution (CR 613.2/707.2): multi-hop copy chains resolve
 *    to the ultimate source; cycles terminate.
 *
 * The suites do not replace layer-system.test.ts — they add the exact-value
 * boundary assertions that kill off-by-one mutants (slice indices, `<` vs
 * `<=`, switch-before-modify, counter netting sign).
 */

import {
  LAYER_7_SUBLAYER_DEPENDENCIES,
  Layer,
  LayerSystem,
  PowerToughnessSublayer,
  createAbilityGrantEffect,
  createCharacteristicDefiningAbility,
  createColorChangeEffect,
  createControlChangeEffect,
  createCopyEffect,
  createPowerToughnessSetEffect,
  createPowerToughnessSwitchEffect,
  createPowerToughnessModifyEffect,
  createTextChangeEffect,
  createTypeChangeEffect,
  getSublayerDependencies,
  getSublayersDependingOn,
  resolveCopyChain,
  type ContinuousEffect,
  type EffectDependency,
} from "../layer-system";
import { createCardInstance } from "../card-instance";
import type { CardInstance, ScryfallCard } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createMockCreature(
  name: string,
  power: number | string,
  toughness: number | string,
  colors: string[] = ["R"],
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords: [],
    oracle_text: "",
    mana_cost: "{1}",
    cmc: 2,
    colors,
    color_identity: colors,
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

function makeCreature(
  name: string,
  power: number | string = 2,
  toughness: number | string = 2,
  colors: string[] = ["R"],
): CardInstance {
  return createCardInstance(
    createMockCreature(name, power, toughness, colors),
    "player1",
    "player1",
  );
}

/** Set explicit deterministic timestamps/priority on a factory-built effect. */
function at(
  effect: ContinuousEffect,
  timestamp: number,
  priority = 0,
): ContinuousEffect {
  effect.timestamp = timestamp;
  effect.priority = priority;
  return effect;
}

function dep(effectId: string, dependsOnId: string): EffectDependency {
  return { effectId, dependsOnId, dependencyType: "after" };
}

// ─────────────────────────────────────────────────────────────────────────────
// CR 613.8 sublayer dependency slices — exact boundary arrays
// ─────────────────────────────────────────────────────────────────────────────

describe("layer-system mutation suite — sublayer dependency boundaries (#1711)", () => {
  it("getSublayerDependencies returns exactly the later sublayers (slice edge)", () => {
    const { CHARACTERISTIC_DEFINING, SET, COUNTERS, SWITCH, MODIFY } =
      PowerToughnessSublayer;
    // Every sublayer "depends on" all sublayers applied after it; 7e (last)
    // is the sublayerIndex >= length - 1 boundary.
    expect(getSublayerDependencies(CHARACTERISTIC_DEFINING)).toEqual([
      SET,
      COUNTERS,
      SWITCH,
      MODIFY,
    ]);
    expect(getSublayerDependencies(SET)).toEqual([COUNTERS, SWITCH, MODIFY]);
    expect(getSublayerDependencies(COUNTERS)).toEqual([SWITCH, MODIFY]);
    expect(getSublayerDependencies(SWITCH)).toEqual([MODIFY]);
    expect(getSublayerDependencies(MODIFY)).toEqual([]);
  });

  it("getSublayersDependingOn returns exactly the earlier sublayers (slice edge)", () => {
    const { CHARACTERISTIC_DEFINING, SET, COUNTERS, SWITCH, MODIFY } =
      PowerToughnessSublayer;
    // 7a (first) is the sublayerIndex <= 0 boundary.
    expect(getSublayersDependingOn(CHARACTERISTIC_DEFINING)).toEqual([]);
    expect(getSublayersDependingOn(SET)).toEqual([CHARACTERISTIC_DEFINING]);
    expect(getSublayersDependingOn(COUNTERS)).toEqual([
      CHARACTERISTIC_DEFINING,
      SET,
    ]);
    expect(getSublayersDependingOn(SWITCH)).toEqual([
      CHARACTERISTIC_DEFINING,
      SET,
      COUNTERS,
    ]);
    expect(getSublayersDependingOn(MODIFY)).toEqual([
      CHARACTERISTIC_DEFINING,
      SET,
      COUNTERS,
      SWITCH,
    ]);
  });

  it("the LAYER_7_SUBLAYER_DEPENDENCIES map entries are pinned exactly", () => {
    const { CHARACTERISTIC_DEFINING, SET, COUNTERS, SWITCH, MODIFY } =
      PowerToughnessSublayer;
    expect(LAYER_7_SUBLAYER_DEPENDENCIES.get(CHARACTERISTIC_DEFINING)).toEqual(
      [],
    );
    expect(LAYER_7_SUBLAYER_DEPENDENCIES.get(SET)).toEqual([
      COUNTERS,
      SWITCH,
      MODIFY,
    ]);
    expect(LAYER_7_SUBLAYER_DEPENDENCIES.get(COUNTERS)).toEqual([
      SWITCH,
      MODIFY,
    ]);
    expect(LAYER_7_SUBLAYER_DEPENDENCIES.get(SWITCH)).toEqual([MODIFY]);
    expect(LAYER_7_SUBLAYER_DEPENDENCIES.get(MODIFY)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CR 613.1 layer sort — exact order incl. adjacent-layer boundaries
// ─────────────────────────────────────────────────────────────────────────────

describe("layer-system mutation suite — layer ordering boundaries (#1711)", () => {
  let ls: LayerSystem;

  beforeEach(() => {
    ls = new LayerSystem();
  });

  afterEach(() => {
    ls.clear();
  });

  it("sorts one effect per layer into exact 1→7 order when registered in reverse", () => {
    const copyTarget = makeCreature("Copy Target");
    ls.registerCardInstance(copyTarget);

    const effects: ContinuousEffect[] = [
      at(createPowerToughnessSetEffect("s7", "player1", 1, 1, "7b", ls), 700),
      at(createAbilityGrantEffect("s6", "player1", "flying", "l6"), 600),
      at(createColorChangeEffect("s5", "player1", ["W"], "l5", false, ls), 500),
      at(
        createTypeChangeEffect("s4", "player1", ["Artifact"], [], [], "l4"),
        400,
      ),
      at(createTextChangeEffect("s3", "player1", "text", "l3", false, ls), 300),
      at(createControlChangeEffect("s2", "player1", "player2", "l2", ls), 200),
      at(createCopyEffect("s1", "player1", copyTarget.id, "l1", ls), 100),
    ];
    // Register in reverse so the sort must do the work.
    for (const e of [...effects].reverse()) {
      ls.registerEffect(e);
    }

    const layers = ls.getEffects().map((e) => e.layer);
    expect(layers).toEqual([
      Layer.COPY_EFFECTS,
      Layer.CONTROL_CHANGING,
      Layer.TEXT_CHANGING,
      Layer.TYPE_CHANGING,
      Layer.COLOR_CHANGING,
      Layer.ABILITY,
      Layer.POWER_TOUGHNESS,
    ]);
  });

  it("orders the adjacent 6→7 and 3→4 layer pairs exactly", () => {
    const ability = at(
      createAbilityGrantEffect("s6", "player1", "flying", "l6"),
      10,
    );
    const pt = at(
      createPowerToughnessSetEffect("s7", "player1", 4, 4, "7b", ls),
      20,
    );
    const text = at(
      createTextChangeEffect("s3", "player1", "t", "l3", false, ls),
      30,
    );
    const type = at(
      createTypeChangeEffect("s4", "player1", ["Land"], [], [], "l4"),
      40,
    );

    // Register deliberately interleaved out of order.
    ls.registerEffect(pt);
    ls.registerEffect(text);
    ls.registerEffect(ability);
    ls.registerEffect(type);

    const layers = ls.getEffects().map((e) => e.layer);
    expect(layers).toEqual([
      Layer.TEXT_CHANGING, // 3
      Layer.TYPE_CHANGING, // 4
      Layer.ABILITY, // 6
      Layer.POWER_TOUGHNESS, // 7
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Timestamp dependence (CR 613.6/613.7) — same layer/sublayer ordering
// ─────────────────────────────────────────────────────────────────────────────

describe("layer-system mutation suite — timestamp dependence (#1711)", () => {
  let ls: LayerSystem;

  beforeEach(() => {
    ls = new LayerSystem();
  });

  afterEach(() => {
    ls.clear();
  });

  it("the LATER timestamp wins among Layer 7b setters regardless of registration order", () => {
    const card = makeCreature("Set Order Target", 0, 0);
    const early = at(
      createPowerToughnessSetEffect("sA", "player1", 3, 3, "3/3", ls),
      100,
    );
    const late = at(
      createPowerToughnessSetEffect("sB", "player1", 7, 1, "7/1", ls),
      200,
    );

    // Register the LATER effect first — sorting must still apply it last.
    ls.registerEffect(late);
    ls.registerEffect(early);

    const ids = ls.getEffects().map((e) => e.id);
    expect(ids.indexOf(early.id)).toBeLessThan(ids.indexOf(late.id));

    const chars = ls.getEffectiveCharacteristics(card);
    expect(chars.power).toBe(7);
    expect(chars.toughness).toBe(1);
  });

  it("equal timestamps fall to the priority tiebreak (lower priority applies first)", () => {
    const lowP = at(
      createPowerToughnessSetEffect("sLow", "player1", 9, 9, "9/9", ls),
      100,
      5,
    );
    const highP = at(
      createPowerToughnessSetEffect("sHigh", "player1", 2, 2, "2/2", ls),
      100,
      10,
    );

    // Register the winner-by-priority FIRST so insertion order alone would
    // produce the opposite result.
    ls.registerEffect(highP);
    ls.registerEffect(lowP);

    const ordered = ls.getEffects();
    expect(ordered.map((e) => e.priority)).toEqual([5, 10]);
  });

  it("a dependency overrides timestamp order for non-Layer-7 effects", () => {
    const card = makeCreature("Type Order Target");
    const late = at(
      createTypeChangeEffect(
        "sLate",
        "player1",
        ["Enchantment"],
        [],
        [],
        "late",
        false,
        ls,
      ),
      100,
    );
    const early = at(
      createTypeChangeEffect(
        "sEarly",
        "player1",
        ["Artifact"],
        [],
        [],
        "early",
        false,
        ls,
      ),
      200,
    );
    ls.registerEffect(late);
    ls.registerEffect(early);
    // late DEPENDS ON early → early applies first, late applies last even
    // though its timestamp is smaller.
    expect(ls.addDependency(dep(late.id, early.id))).toBe(true);

    const ordered = ls.getEffects().map((e) => e.id);
    expect(ordered.indexOf(early.id)).toBeLessThan(ordered.indexOf(late.id));

    const chars = ls.getEffectiveCharacteristics(card);
    expect(chars.types).toEqual(["Enchantment"]);
  });

  it("a transitive dependency chain (C→B→A) orders non-adjacent pairs correctly", () => {
    const card = makeCreature("Chain Target", 0, 0);
    const eC = at(
      createPowerToughnessSetEffect("sC", "player1", 5, 5, "5/5", ls),
      100,
    );
    const eB = at(
      createPowerToughnessSetEffect("sB", "player1", 3, 3, "3/3", ls),
      200,
    );
    const eA = at(
      createPowerToughnessSetEffect("sA", "player1", 1, 1, "1/1", ls),
      300,
    );
    ls.registerEffect(eC);
    ls.registerEffect(eB);
    ls.registerEffect(eA);
    // C depends on B, B depends on A → application order A, B, C → C wins.
    // Plain timestamp order would be C, B, A → A would win instead.
    expect(ls.addDependency(dep(eC.id, eB.id))).toBe(true);
    expect(ls.addDependency(dep(eB.id, eA.id))).toBe(true);

    const ordered = ls.getEffects().map((e) => e.id);
    expect(ordered).toEqual([eA.id, eB.id, eC.id]);

    const chars = ls.getEffectiveCharacteristics(card);
    expect(chars.power).toBe(5);
    expect(chars.toughness).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cycle detection (CR 613.7c) — self, transitive, same-sublayer mutual
// ─────────────────────────────────────────────────────────────────────────────

describe("layer-system mutation suite — dependency cycle boundaries (#1711)", () => {
  let ls: LayerSystem;

  beforeEach(() => {
    ls = new LayerSystem();
  });

  afterEach(() => {
    ls.clear();
  });

  it("rejects a self-referential dependency", () => {
    const e = at(
      createPowerToughnessSetEffect("sX", "player1", 1, 1, "x", ls),
      1,
    );
    ls.registerEffect(e);
    expect(ls.addDependency(dep(e.id, e.id))).toBe(false);
    expect(ls.getDependencies()).toHaveLength(0);
  });

  it("rejects a dependency that closes a transitive cycle", () => {
    const a = at(
      createTypeChangeEffect("sA", "player1", ["A"], [], [], "a"),
      1,
    );
    const b = at(
      createTypeChangeEffect("sB", "player1", ["B"], [], [], "b"),
      2,
    );
    const c = at(
      createTypeChangeEffect("sC", "player1", ["C"], [], [], "c"),
      3,
    );
    ls.registerEffect(a);
    ls.registerEffect(b);
    ls.registerEffect(c);

    expect(ls.addDependency(dep(b.id, a.id))).toBe(true); // b depends on a
    expect(ls.addDependency(dep(c.id, b.id))).toBe(true); // c depends on b
    // a depends on c would close a→c→b→a.
    expect(ls.addDependency(dep(a.id, c.id))).toBe(false);
    expect(ls.getDependencies()).toHaveLength(2);
  });

  it("rejects mutual dependencies between same-sublayer Layer 7 effects", () => {
    const e1 = at(
      createPowerToughnessSetEffect("s1", "player1", 1, 1, "one", ls),
      1,
    );
    const e2 = at(
      createPowerToughnessSetEffect("s2", "player1", 2, 2, "two", ls),
      2,
    );
    ls.registerEffect(e1);
    ls.registerEffect(e2);

    expect(ls.addDependency(dep(e1.id, e2.id))).toBe(true);
    expect(ls.addDependency(dep(e2.id, e1.id))).toBe(false);
    expect(ls.getDependencies()).toHaveLength(1);
  });

  it("allows a dependency across different Layer 7 sublayers", () => {
    const setter = at(
      createPowerToughnessSetEffect("s1", "player1", 4, 4, "set", ls),
      1,
    );
    const modifier = at(
      createPowerToughnessModifyEffect("s2", "player1", 2, 0, "+2/+0"),
      2,
    );
    ls.registerEffect(setter);
    ls.registerEffect(modifier);

    expect(ls.addDependency(dep(setter.id, modifier.id))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CR 613.8 pipeline — CDA → set → counters → switch → modify exact math
// ─────────────────────────────────────────────────────────────────────────────

describe("layer-system mutation suite — Layer 7 pipeline boundaries (#1711)", () => {
  let ls: LayerSystem;

  beforeEach(() => {
    ls = new LayerSystem();
  });

  afterEach(() => {
    ls.clear();
  });

  it("applies 7b set → 7c counters → 7d switch → 7e modify in exact order", () => {
    const card = makeCreature("Pipeline", 1, 2);
    // 7b: set to 1/5.
    ls.registerEffect(
      at(
        createPowerToughnessSetEffect("sSet", "player1", 1, 5, "1/5", ls),
        100,
      ),
    );
    // 7c: 2 × +1/+1 and 1 × -1/-1 → net +1/+1.
    card.counters = [
      { type: "+1/+1", count: 2 },
      { type: "-1/-1", count: 1 },
    ];
    // 7d: switch P/T.
    ls.registerEffect(
      at(
        createPowerToughnessSwitchEffect("sSwitch", "player1", "switch", ls),
        200,
      ),
    );
    // 7e: +2/+0.
    ls.registerEffect(
      at(
        createPowerToughnessModifyEffect("sMod", "player1", 2, 0, "+2/+0"),
        300,
      ),
    );

    // set → 1/5; counters → 2/6; switch → 6/2; modify → 8/2.
    // (modify-before-switch would give 6/4; counters-after-modify 6/1.)
    const chars = ls.getEffectiveCharacteristics(card);
    expect(chars.power).toBe(8);
    expect(chars.toughness).toBe(2);
  });

  it("Layer 7b setters override Layer 7a CDAs (CR 613.8b)", () => {
    const card = makeCreature("CDA vs Set", 2, 2);
    ls.registerEffect(
      at(
        createCharacteristicDefiningAbility(
          "sCDA",
          "player1",
          { oracleId: "cda-1", power: 7, toughness: 7 },
          "7/7 CDA",
          ls,
        ),
        100,
      ),
    );
    ls.registerEffect(
      at(
        createPowerToughnessSetEffect("sSet", "player1", 1, 1, "1/1", ls),
        200,
      ),
    );

    const chars = ls.getEffectiveCharacteristics(card);
    expect(chars.power).toBe(1);
    expect(chars.toughness).toBe(1);
  });

  it("a CDA alone defines P/T over the printed values (CR 613.8a)", () => {
    const card = makeCreature("CDA only", 2, 2);
    ls.registerEffect(
      at(
        createCharacteristicDefiningAbility(
          "sCDA",
          "player1",
          { oracleId: "cda-2", power: 7, toughness: 7 },
          "7/7 CDA",
          ls,
        ),
        100,
      ),
    );

    const chars = ls.getEffectiveCharacteristics(card);
    expect(chars.power).toBe(7);
    expect(chars.toughness).toBe(7);
  });

  it("+1/+1 and -1/-1 counters net exactly (CR 704.5q applied in 7c)", () => {
    const balanced = makeCreature("Balanced", 2, 2);
    balanced.counters = [
      { type: "+1/+1", count: 3 },
      { type: "-1/-1", count: 3 },
    ];
    const netPositive = makeCreature("Net Positive", 2, 2);
    netPositive.counters = [
      { type: "+1/+1", count: 2 },
      { type: "-1/-1", count: 1 },
    ];
    const netNegative = makeCreature("Net Negative", 3, 3);
    netNegative.counters = [{ type: "-1/-1", count: 2 }];

    expect(ls.getEffectiveCharacteristics(balanced).power).toBe(2); // net 0
    expect(ls.getEffectiveCharacteristics(balanced).toughness).toBe(2);
    expect(ls.getEffectiveCharacteristics(netPositive).power).toBe(3); // net +1
    expect(ls.getEffectiveCharacteristics(netPositive).toughness).toBe(3);
    expect(ls.getEffectiveCharacteristics(netNegative).power).toBe(1); // net −2
    expect(ls.getEffectiveCharacteristics(netNegative).toughness).toBe(1);
  });

  it("variable (*) power/toughness parse to 0 (CR 208.2a placeholder)", () => {
    const starCard = makeCreature("Star", "*", 3);
    const weirdStar = makeCreature("Weird Star", "2*", 4);

    const star = ls.getEffectiveCharacteristics(starCard);
    expect(star.power).toBe(0);
    expect(star.toughness).toBe(3);
    const weird = ls.getEffectiveCharacteristics(weirdStar);
    expect(weird.power).toBe(0);
    expect(weird.toughness).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Copy chains (CR 613.2 / 707.2) — multi-hop resolution and cycle termination
// ─────────────────────────────────────────────────────────────────────────────

describe("layer-system mutation suite — copy-chain resolution (#1711)", () => {
  let ls: LayerSystem;

  beforeEach(() => {
    ls = new LayerSystem();
  });

  afterEach(() => {
    ls.clear();
  });

  it("resolves a two-hop copy chain to the ultimate source", () => {
    const a = makeCreature("Alpha", 1, 1, ["R"]);
    const b = makeCreature("Beta", 2, 2, ["U"]);
    const c = makeCreature("Gamma", 3, 3, ["G"]);
    ls.registerCardInstance(a);
    ls.registerCardInstance(b);
    ls.registerCardInstance(c);
    // A copies B; B copies C → A's ultimate source is C.
    ls.getOverrides(a.id).copiedFromId = b.id;
    ls.getOverrides(b.id).copiedFromId = c.id;

    const resolved = resolveCopyChain(a.id, ls);
    expect(resolved?.cardId).toBe(c.id);
    expect(resolved?.cardData.name).toBe("Gamma");
  });

  it("terminates on a copy cycle by returning the revisited card as-is", () => {
    const a = makeCreature("Cycle A", 1, 1);
    const b = makeCreature("Cycle B", 2, 2);
    ls.registerCardInstance(a);
    ls.registerCardInstance(b);
    ls.getOverrides(a.id).copiedFromId = b.id;
    ls.getOverrides(b.id).copiedFromId = a.id;

    const resolved = resolveCopyChain(a.id, ls);
    expect(resolved?.cardId).toBe(a.id);
    expect(resolved?.cardData.name).toBe("Cycle A");
  });

  it("getEffectiveColor resolves color through the copy chain", () => {
    const a = makeCreature("Red Copy", 1, 1, ["R"]);
    const b = makeCreature("Blue Original", 2, 2, ["U"]);
    ls.registerCardInstance(a);
    ls.registerCardInstance(b);
    ls.getOverrides(a.id).copiedFromId = b.id;

    expect(ls.getEffectiveColor(a)).toEqual(["U"]);
  });

  it("a Layer 3 text+color change pins the effective color (CR 613.4 exception)", () => {
    const card = makeCreature("Colored Text", 1, 1, ["R"]);
    ls.registerEffect(
      at(
        createTextChangeEffect(
          "s3",
          "player1",
          "new text",
          "text+color",
          false,
          ls,
          ["Construct"],
          ["W"],
        ),
        100,
      ),
    );

    const chars = ls.getEffectiveCharacteristics(card);
    expect(chars.color).toEqual(["W"]);
    expect(ls.getEffectiveColor(card)).toEqual(["W"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cache + state-hash sensitivity — timestamp-adjacent invalidation
// ─────────────────────────────────────────────────────────────────────────────

describe("layer-system mutation suite — cache and state hash (#1711)", () => {
  let ls: LayerSystem;

  beforeEach(() => {
    ls = new LayerSystem();
  });

  afterEach(() => {
    ls.clear();
  });

  it("returns the cached characteristics object while the state hash is unchanged", () => {
    const card = makeCreature("Cached", 3, 3);
    // First call creates the (empty) overrides entry for the card, which
    // changes the state hash — warm the cache with a second computation.
    ls.getEffectiveCharacteristics(card);
    const first = ls.getEffectiveCharacteristics(card);
    const second = ls.getEffectiveCharacteristics(card);
    expect(second).toBe(first); // same reference — cache hit
    expect(first.power).toBe(3);
  });

  it("invalidates the cache when a new effect is registered", () => {
    const card = makeCreature("Invalidated", 3, 3);
    expect(ls.getEffectiveCharacteristics(card).power).toBe(3);

    ls.registerEffect(
      at(
        createPowerToughnessSetEffect("sNew", "player1", 5, 5, "5/5", ls),
        100,
      ),
    );

    const chars = ls.getEffectiveCharacteristics(card);
    expect(chars.power).toBe(5);
    expect(chars.toughness).toBe(5);
  });

  it("computeStateHash changes for effects, dependencies, overrides, and CDAs", () => {
    const card = makeCreature("Hashed", 1, 1);
    ls.registerCardInstance(card);

    const h0 = ls.computeStateHash();
    const e1 = at(
      createTypeChangeEffect("s1", "player1", ["A"], [], [], "a"),
      1,
    );
    const e2 = at(
      createTypeChangeEffect("s2", "player1", ["B"], [], [], "b"),
      2,
    );
    ls.registerEffect(e1);
    ls.registerEffect(e2);
    const h1 = ls.computeStateHash();
    expect(h1).not.toBe(h0); // effect signature parts

    expect(ls.addDependency(dep(e2.id, e1.id))).toBe(true);
    const h2 = ls.computeStateHash();
    expect(h2).not.toBe(h1); // dependency parts

    ls.getOverrides(card.id).types = ["Overridden"];
    const h3 = ls.computeStateHash();
    expect(h3).not.toBe(h2); // override parts

    ls.registerCDA({ oracleId: "cda-hash", power: 4 });
    const h4 = ls.computeStateHash();
    expect(h4).not.toBe(h3); // CDA parts
  });
});
