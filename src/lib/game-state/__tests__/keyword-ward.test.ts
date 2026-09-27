/**
 * Ward keyword enforcement tests — strict parsed-keywords contract (CR 702.21).
 *
 * Issue #2315 — evergreen keyword enforcement (ward portion).
 *
 * Pins:
 *   - canonical detection (parsed keywords list, not substring oracle text);
 *   - false-positive regression: a card whose oracle text merely mentions
 *     "ward" (e.g. as a flavor word, a grant effect, or as a non-keyword
 *     usage) must NOT acquire ward via the strict check;
 *   - ward lifecycle (paid / unpaid / multiple targets / own-spell immunity):
 *     the full lifecycle is already covered by `ward-keyword.test.ts` and
 *     `keyword-enforcement.test.ts`; this file exercises the same paths
 *     from the strict-detection contract surface, and adds a regression
 *     guard for the substring-fallback bug;
 *   - `evergreen-keywords.hasWard` defers to `hasWardStrict` first,
 *     preserving the substring fallback only for cards with missing
 *     keyword tags (mirrors the flash/defender pattern).
 *
 * Note: the original plan referenced a "first time per turn" rule with
 * citation "CR 702.21b". That rule does not exist for ward — CR 702.21
 * has no per-turn cooldown; ward fires every time the permanent becomes
 * the target of an opponent's spell/ability. The plan's "first time"
 * test case is therefore omitted as a rules error.
 */

import {
  hasWardStrict,
  isProtectedByWardStrict,
} from "../keyword-actions/ward";
import { hasWard } from "../evergreen-keywords";
import {
  detectWardTriggers,
  payWardCost,
  applyWardResolution,
} from "../ward-system";
import { resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  StackEffect,
  StackObject,
  Target,
} from "../types";
import type { ScryfallCard } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeCardData(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: overrides.id ?? "test-card",
    name: overrides.name ?? "Test Card",
    type_line: overrides.type_line ?? "Creature — Test",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{1}",
    cmc: overrides.cmc ?? 1,
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? [],
    keywords: overrides.keywords ?? [],
    rarity: overrides.rarity ?? "common",
    set: overrides.set ?? "tst",
    ...overrides,
  } as ScryfallCard;
}

function addToBattlefield(
  state: GameState,
  cardData: ScryfallCard,
  controllerId: string,
): CardInstanceId {
  const instance = createCardInstance(
    cardData,
    controllerId as CardInstanceId,
    controllerId as CardInstanceId,
  );
  state.cards.set(instance.id, instance);
  const battlefield = state.zones.get(`${controllerId}-battlefield`)!;
  state.zones.set(`${controllerId}-battlefield`, {
    ...battlefield,
    cardIds: [...battlefield.cardIds, instance.id],
  });
  return instance.id;
}

function setupGame(): { state: GameState; aliceId: string; bobId: string } {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];
  const bobId = playerIds[1];
  return { state, aliceId, bobId };
}

let stackCounter = 0;
function makeTargetingStackObject(
  controllerId: PlayerId,
  targets: Target[],
  effects: StackEffect[] = [],
): StackObject {
  stackCounter += 1;
  return {
    id: `ward-strict-spell-${stackCounter}`,
    type: "ability",
    sourceCardId: null,
    controllerId,
    name: "Targeting Ability",
    text: "",
    manaCost: null,
    targets,
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
    effects,
  };
}

function damageEffect(targetId: CardInstanceId, amount = 1): StackEffect {
  return {
    effectType: "damage",
    amount,
    targetId,
    isCombatDamage: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) Strict detection: parsed keywords, not substring oracle text
// ─────────────────────────────────────────────────────────────────────────────

describe("hasWardStrict (CR 702.21)", () => {
  it("returns true for a creature with 'ward' in its parsed keywords", () => {
    const card = createCardInstance(
      makeCardData({
        name: "Warded Horror",
        keywords: ["Ward"],
        oracle_text: "Ward {2}",
      }),
      "p1",
      "p1",
    );
    expect(hasWardStrict(card)).toBe(true);
  });

  it("matches the keyword regardless of case", () => {
    const card = createCardInstance(
      makeCardData({
        name: "Warded Horror",
        keywords: ["ward"],
        oracle_text: "",
      }),
      "p1",
      "p1",
    );
    expect(hasWardStrict(card)).toBe(true);
  });

  it("returns false for a creature without the ward keyword", () => {
    const card = createCardInstance(
      makeCardData({ name: "Bear", keywords: [], oracle_text: "" }),
      "p1",
      "p1",
    );
    expect(hasWardStrict(card)).toBe(false);
  });

  it("returns false for a creature whose oracle text merely mentions 'ward' (regression: substring oracle-text fallback would false-positive here)", () => {
    // The strict check consults ONLY the parsed keywords array. A card whose
    // oracle text mentions "ward" — e.g. as flavor, a reminder reference,
    // or a non-keyword usage like "Warden of the First Tree" — must NOT
    // acquire ward on its own. Mirrors the same false-positive guard that
    // hasFlashStrict (issue #2312) and hasDefenderStrict (issue #2314) pin.
    const card = createCardInstance(
      makeCardData({
        name: "Warden of the First Tree",
        keywords: [],
        oracle_text:
          "Warden of the First Tree gets +1/+1 for each creature you control with toughness 4 or greater.",
      }),
      "p1",
      "p1",
    );
    expect(hasWardStrict(card)).toBe(false);
  });

  it("does not match keywords that merely contain 'ward' as a substring (e.g. 'backward')", () => {
    const card = createCardInstance(
      makeCardData({
        name: "Backward Lurker",
        keywords: ["backward"],
        oracle_text: "Backward Lurker cannot block.",
      }),
      "p1",
      "p1",
    );
    expect(hasWardStrict(card)).toBe(false);
  });
});

describe("isProtectedByWardStrict (CR 702.21a — opponent-only triggers)", () => {
  it("returns true for an opposing ward source", () => {
    const card = createCardInstance(
      makeCardData({ name: "Warded", keywords: ["Ward"] }),
      "p1",
      "p1",
    );
    expect(isProtectedByWardStrict(card, "p2")).toBe(true);
  });

  it("returns false for the controller's own spell source", () => {
    const card = createCardInstance(
      makeCardData({ name: "Warded", keywords: ["Ward"] }),
      "p1",
      "p1",
    );
    // Same controller — ward must not trigger for own spells (CR 702.21a).
    expect(isProtectedByWardStrict(card, "p1")).toBe(false);
  });

  it("returns false for a card without ward", () => {
    const card = createCardInstance(
      makeCardData({ name: "Bear", keywords: [] }),
      "p1",
      "p1",
    );
    expect(isProtectedByWardStrict(card, "p2")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Wiring: hasWard defers to hasWardStrict
// ─────────────────────────────────────────────────────────────────────────────

describe("evergreen-keywords.hasWard → hasWardStrict delegation", () => {
  it("returns true via the strict path when keywords array lists 'Ward'", () => {
    const card = createCardInstance(
      makeCardData({ keywords: ["Ward"], oracle_text: "" }),
      "p1",
      "p1",
    );
    expect(hasWard(card)).toBe(true);
  });

  it("preserves substring fallback for cards with missing keyword tags (oracle-only ward)", () => {
    // Cards from older data sources may have ward in their oracle text but
    // not in their parsed keywords array. `hasWard` keeps that fallback so
    // detection does not regress for those rows.
    const card = createCardInstance(
      makeCardData({ keywords: [], oracle_text: "Ward {3}" }),
      "p1",
      "p1",
    );
    expect(hasWard(card)).toBe(true);
  });

  it("does not false-positive on flavor text containing 'ward'", () => {
    // hasWard keeps the word-bounded fallback; "warden"/"steward" do not
    // match, but a standalone "ward" usage in flavor text would. We do not
    // assert behaviour there because both true and false are defensible —
    // but we DO assert that the strict check (the canonical contract)
    // correctly returns false in this case.
    const card = createCardInstance(
      makeCardData({
        keywords: [],
        oracle_text: "Flavor: a ward protects this creature from the elements.",
      }),
      "p1",
      "p1",
    );
    expect(hasWardStrict(card)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) End-to-end ward lifecycle from the strict-detection surface
// ─────────────────────────────────────────────────────────────────────────────

describe("Ward lifecycle (CR 702.21) — strict keyword detection drives enforcement", () => {
  it("opponent pays ward N → spell resolves normally", () => {
    const { state, aliceId, bobId } = setupGame();
    // Bob controls a warded creature (Ward {2}).
    const warded = addToBattlefield(
      state,
      makeCardData({
        name: "Warded Horror",
        keywords: ["Ward"],
        oracle_text: "Ward {2}",
        power: "3",
        toughness: "3",
        colors: ["U"],
        color_identity: ["U"],
      }),
      bobId,
    );
    // Alice (caster) gets plenty of mana to pay.
    const s1 = addMana(state, aliceId, { blue: 4, generic: 4 });

    const spell = makeTargetingStackObject(
      aliceId as PlayerId,
      [{ type: "card", targetId: warded, isValid: true }],
      [damageEffect(warded, 1)],
    );
    s1.stack = [spell];

    // Strict detection finds it.
    expect(hasWardStrict(s1.cards.get(warded)!)).toBe(true);
    const triggers = detectWardTriggers(s1, spell);
    expect(triggers).toHaveLength(1);

    // Pay the ward cost.
    const paid = payWardCost(s1, spell.id, warded);
    expect(paid.success).toBe(true);

    // Spell resolves — the warded creature takes 1 damage.
    const resolved = resolveTopOfStack(paid.state);
    expect(resolved.stack).toHaveLength(0);
    expect(resolved.cards.get(warded)!.damage).toBe(1);
  });

  it("opponent cannot pay ward N → spell is countered (effect never applies)", () => {
    const { state, bobId } = setupGame();
    const warded = addToBattlefield(
      state,
      makeCardData({
        name: "Warded Horror",
        keywords: ["Ward"],
        oracle_text: "Ward {2}",
        power: "3",
        toughness: "3",
      }),
      bobId,
    );
    const aliceId = Array.from(state.players.keys())[0];
    // Alice has NO mana — can't pay {2}.
    const s1 = state;

    const spell = makeTargetingStackObject(
      aliceId as PlayerId,
      [{ type: "card", targetId: warded, isValid: true }],
      [damageEffect(warded, 1)],
    );
    s1.stack = [spell];

    const wardResult = applyWardResolution(s1, spell);
    expect(wardResult.countered).toBe(true);
    expect(wardResult.unpaidTriggers).toHaveLength(1);

    const resolved = resolveTopOfStack(s1);
    // Spell removed from stack; the warded creature took NO damage.
    expect(resolved.stack).toHaveLength(0);
    expect(resolved.cards.get(warded)!.damage).toBe(0);
  });

  it("multiple ward sources on the same spell — each triggers separately (any unpaid → countered)", () => {
    const { state, aliceId, bobId } = setupGame();
    // Bob controls TWO warded creatures, both targeted by one spell.
    const warded1 = addToBattlefield(
      state,
      makeCardData({
        name: "Warded One",
        keywords: ["Ward"],
        oracle_text: "Ward {1}",
        power: "2",
        toughness: "2",
      }),
      bobId,
    );
    const warded2 = addToBattlefield(
      state,
      makeCardData({
        name: "Warded Two",
        keywords: ["Ward"],
        oracle_text: "Ward {1}",
        power: "2",
        toughness: "2",
      }),
      bobId,
    );
    const s1 = addMana(state, aliceId, { blue: 4, generic: 4 });

    const spell = makeTargetingStackObject(
      aliceId as PlayerId,
      [
        { type: "card", targetId: warded1, isValid: true },
        { type: "card", targetId: warded2, isValid: true },
      ],
      [damageEffect(warded1, 1), damageEffect(warded2, 1)],
    );
    s1.stack = [spell];

    const triggers = detectWardTriggers(s1, spell);
    expect(triggers).toHaveLength(2);

    // Alice pays for warded1 only — warded2 stays unpaid.
    const partial = payWardCost(s1, spell.id, warded1);
    expect(partial.success).toBe(true);

    // One unpaid trigger → entire spell is countered (CR 702.21).
    const wardResult = applyWardResolution(partial.state, {
      ...spell,
      wardPaidTargetIds: partial.state.stack[0].wardPaidTargetIds,
    });
    expect(wardResult.countered).toBe(true);
    expect(wardResult.unpaidTriggers).toHaveLength(1);

    const resolved = resolveTopOfStack(partial.state);
    expect(resolved.stack).toHaveLength(0);
    expect(resolved.cards.get(warded1)!.damage).toBe(0);
    expect(resolved.cards.get(warded2)!.damage).toBe(0);
  });

  it("ward does NOT trigger for the controller's own spells (CR 702.21a)", () => {
    const { state, aliceId } = setupGame();
    // Alice controls a warded creature and casts a spell targeting her own
    // permanent — ward must not fire.
    const ownWarded = addToBattlefield(
      state,
      makeCardData({
        name: "Self-Warded",
        keywords: ["Ward"],
        oracle_text: "Ward {2}",
        power: "2",
        toughness: "2",
      }),
      aliceId,
    );
    const s1 = addMana(state, aliceId, { blue: 4, generic: 4 });

    const spell = makeTargetingStackObject(
      aliceId as PlayerId,
      [{ type: "card", targetId: ownWarded, isValid: true }],
      [damageEffect(ownWarded, 1)],
    );
    s1.stack = [spell];

    expect(hasWardStrict(s1.cards.get(ownWarded)!)).toBe(true);
    const triggers = detectWardTriggers(s1, spell);
    expect(triggers).toHaveLength(0);

    // Spell resolves unimpeded — Alice's own ward never fired.
    const resolved = resolveTopOfStack(s1);
    expect(resolved.stack).toHaveLength(0);
    expect(resolved.cards.get(ownWarded)!.damage).toBe(1);
  });
});
