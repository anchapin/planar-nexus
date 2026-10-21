/**
 * "Counter target spell with mana value X or less" tests
 * (#2594 follow-up, lane 22b)
 *
 * The drafter has 1 FDN card wanting this — Spell Snare ("Counter
 * target spell with mana value X or less."). The `Counter` op
 * accepts any spell on the stack; this lane extends `CounterSchema`
 * with optional `min_mana_value` / `max_mana_value` bounds and
 * threads the engine's `effectTargetLegal` to filter the targeted
 * spell by its source card's mana value (CR 202.3a).
 *
 * The bound may be a literal number or the `"X"` sentinel, which
 * resolves to the mana value chosen for the countering spell itself
 * (CR 603.10d) via `ctx.x` (#2552). A spell with no numeric mana
 * value (X cast as its own cost, or an ability made by a permanent)
 * is never a legal target here.
 *
 * Mirrors lane 13 (`counter-color.test.ts`) in structure and in the
 * `min_mana_value`/`max_mana_value` convention already used by the
 * destroy/sweeper filters (`filter.mv_le`).
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveScriptedSpell } from "../card-scripts/interpret";
import { CounterSchema } from "../card-scripts/schema";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

function makeCard(overrides: {
  name: string;
  id: string;
  type_line?: string;
  oracle_text?: string;
  mana_cost?: string;
  /** `null` means "leave `cmc` off the card" (a spell whose own cost
   * contains X, so it has no numeric mana value until it resolves). */
  cmc?: number | null;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  layout?: string;
}): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name,
    type_line: overrides.type_line ?? "Instant",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "",
    // `cmc` stays genuinely absent when the caller passes `null`, so a
    // spell with no numeric mana value can be modelled.
    ...(overrides.cmc === null ? {} : { cmc: overrides.cmc ?? 0 }),
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? overrides.colors ?? [],
    keywords: overrides.keywords ?? [],
    legalities: { standard: "legal" },
    layout: overrides.layout ?? "normal",
  } as ScryfallCard;
}

/**
 * Place a card on the battlefield so it has an instance; build a
 * stack object around it so the engine can resolve Counter against
 * it. The instance id is set to `cardId` so the engine's
 * `counterSpell` (which looks up by `sourceCardId`) finds the same
 * card.
 */
function putOnBattlefield(
  state: GameState,
  card: ScryfallCard,
  controller: PlayerId,
  cardId: CardInstanceId,
): GameState {
  const zoneKey = `${controller}-battlefield`;
  const inst: CardInstance = createCardInstance(card, controller, controller, {
    id: cardId,
    currentZoneKey: zoneKey,
  });
  inst.controllerId = controller;
  const cards = new Map(state.cards).set(cardId, inst);
  const existing = state.zones.get(zoneKey)!;
  const zones = new Map(state.zones);
  zones.set(zoneKey, {
    ...existing,
    cardIds: [...existing.cardIds, cardId],
  });
  return { ...state, cards, zones };
}

describe("Counter target spell with mana value X or less (#2594 follow-up, lane 22b)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state.turn.activePlayerId = p1;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  });

  it("Spell Snare card-script declares Counter with max_mana_value: X", () => {
    // Smoke check on the live JSON fixture.
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const spellSnare = JSON.parse(
      readFileSync(join(cardsDir, "spell-snare.json"), "utf8"),
    ) as {
      name: string;
      spell: {
        op: string;
        target: string;
        max_mana_value?: number | "X";
      }[];
    };
    expect(spellSnare.name).toBe("Spell Snare");
    expect(spellSnare.spell[0].op).toBe("Counter");
    expect(spellSnare.spell[0].target).toBe("spell");
    expect(spellSnare.spell[0].max_mana_value).toBe("X");
  });

  it("schema accepts max_mana_value as a number and as the X sentinel", () => {
    expect(
      CounterSchema.safeParse({
        op: "Counter",
        target: "spell",
        max_mana_value: 3,
      }).success,
    ).toBe(true);
    expect(
      CounterSchema.safeParse({
        op: "Counter",
        target: "spell",
        max_mana_value: "X",
      }).success,
    ).toBe(true);
  });

  it("schema rejects a mana-value bound on an ability target", () => {
    // The bound is only meaningful for a spell on the stack; a
    // permanent/ability target has no mana value of its own.
    const parsed = CounterSchema.safeParse({
      op: "Counter",
      target: "ability",
      max_mana_value: "X",
    });
    expect(parsed.success).toBe(false);
  });

  it("counters a spell whose mana value is within the bound", () => {
    // Synthetic Spell Snare with a literal bound of 2, aimed at a
    // 2-mana spell — legal, so the spell is countered.
    const cheap = makeCard({
      id: "cheap",
      name: "Test Cheap Spell",
      type_line: "Instant",
      cmc: 2,
      colors: ["G"],
    });
    const s = putOnBattlefield(state, cheap, p2, "cheap" as CardInstanceId);

    s.stack.push({
      id: "spell-1",
      type: "spell",
      sourceCardId: "cheap",
      controllerId: p2,
      name: "Test Cheap Spell",
      text: "Effect.",
      manaCost: "{1}{G}",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      colorsSpent: 1,
      isCountered: false,
      timestamp: 0,
    });

    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Spell Snare",
        oracle: "Counter target spell with mana value 2 or less.",
        spell: [{ op: "Counter", target: "spell", max_mana_value: 2 }],
      } as never,
      {
        controllerId: p1,
        sourceCardId: null,
        targets: [{ type: "stack", targetId: "spell-1", isValid: true }],
        chosenModes: [],
      },
    );
    // Countered: removed from the stack, source card to the owner's
    // graveyard (CR 701.5b).
    expect(result.stack.find((o) => o.id === "spell-1")).toBeUndefined();
    expect(result.cards.get("cheap" as CardInstanceId)!.currentZoneKey).toBe(
      `${p2}-graveyard`,
    );
  });

  it("rejects a spell whose mana value exceeds the bound", () => {
    // Same Spell Snare, bound 2, aimed at a 5-mana spell — the target
    // is illegal so the spell is NOT countered.
    const big = makeCard({
      id: "big",
      name: "Test Big Spell",
      type_line: "Sorcery",
      cmc: 5,
      colors: ["W"],
    });
    const s = putOnBattlefield(state, big, p2, "big" as CardInstanceId);

    s.stack.push({
      id: "spell-2",
      type: "spell",
      sourceCardId: "big",
      controllerId: p2,
      name: "Test Big Spell",
      text: "Effect.",
      manaCost: "{3}{W}{W}",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      colorsSpent: 1,
      isCountered: false,
      timestamp: 0,
    });

    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Spell Snare",
        oracle: "Counter target spell with mana value 2 or less.",
        spell: [{ op: "Counter", target: "spell", max_mana_value: 2 }],
      } as never,
      {
        controllerId: p1,
        sourceCardId: null,
        targets: [{ type: "stack", targetId: "spell-2", isValid: true }],
        chosenModes: [],
      },
    );
    // Not countered: the stack entry survives and stays uncountered.
    const so = result.stack.find((o) => o.id === "spell-2");
    expect(so).toBeDefined();
    expect(so?.isCountered).toBe(false);
    expect(result.cards.get("big" as CardInstanceId)!.currentZoneKey).toBe(
      `${p2}-battlefield`,
    );
  });

  it("resolves the X sentinel from the countering spell's own mana value", () => {
    // The live Spell Snare shape. The `"X"` bound resolves to the mana
    // value chosen for Spell Snare itself (CR 603.10d), carried on the
    // countering spell's stack object as `variableValues.X` (the engine
    // reads it at interpret.ts:3682). A 3-mana Snare may counter a
    // 3-mana spell but not a 4-mana one.

    // Helper: the countering spell's own stack object, as the engine
    // builds it, with its chosen X.
    const snareStack = (xAmount: number) => ({
      id: "snare",
      type: "spell" as const,
      sourceCardId: null,
      controllerId: p1,
      name: "Spell Snare",
      text: "Counter target spell with mana value X or less.",
      manaCost: "{1}{G}{X}",
      targets: [],
      chosenModes: [],
      variableValues: new Map([["X", xAmount]]),
      colorsSpent: 1,
      isCountered: false,
      timestamp: 1,
    });

    const three = makeCard({
      id: "three",
      name: "Test Three",
      type_line: "Instant",
      cmc: 3,
      colors: ["U"],
    });
    const s3 = putOnBattlefield(state, three, p2, "three" as CardInstanceId);
    s3.stack.push({
      id: "spell-3",
      type: "spell",
      sourceCardId: "three",
      controllerId: p2,
      name: "Test Three",
      text: "Effect.",
      manaCost: "{2}{U}",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      colorsSpent: 1,
      isCountered: false,
      timestamp: 0,
    });

    const legal = resolveScriptedSpell(
      s3,
      {
        name: "Spell Snare",
        oracle: "Counter target spell with mana value X or less.",
        spell: [{ op: "Counter", target: "spell", max_mana_value: "X" }],
      } as never,
      {
        ...snareStack(3),
        targets: [{ type: "stack", targetId: "spell-3", isValid: true }],
      } as never,
    );
    expect(legal.stack.find((o) => o.id === "spell-3")).toBeUndefined();

    const four = makeCard({
      id: "four",
      name: "Test Four",
      type_line: "Instant",
      cmc: 4,
      colors: ["B"],
    });
    const s4 = putOnBattlefield(state, four, p2, "four" as CardInstanceId);
    s4.stack.push({
      id: "spell-4",
      type: "spell",
      sourceCardId: "four",
      controllerId: p2,
      name: "Test Four",
      text: "Effect.",
      manaCost: "{3}{B}",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      colorsSpent: 1,
      isCountered: false,
      timestamp: 0,
    });

    const illegal = resolveScriptedSpell(
      s4,
      {
        name: "Spell Snare",
        oracle: "Counter target spell with mana value X or less.",
        spell: [{ op: "Counter", target: "spell", max_mana_value: "X" }],
      } as never,
      {
        ...snareStack(3),
        targets: [{ type: "stack", targetId: "spell-4", isValid: true }],
      } as never,
    );
    // 4 > 3, so the target is illegal and the spell survives.
    expect(illegal.stack.find((o) => o.id === "spell-4")).toBeDefined();
    expect(illegal.stack.find((o) => o.id === "spell-4")?.isCountered).toBe(
      false,
    );
  });

  it("never targets a spell with no numeric mana value", () => {
    // A spell whose own cost contains X has no numeric mana value
    // until it resolves, so an explicit bound cannot be satisfied.
    const xSpell = makeCard({
      id: "x-spell",
      name: "Test X Spell",
      type_line: "Instant",
      cmc: null,
      colors: ["R"],
    });
    const s = putOnBattlefield(state, xSpell, p2, "x-spell" as CardInstanceId);
    s.stack.push({
      id: "spell-5",
      type: "spell",
      sourceCardId: "x-spell",
      controllerId: p2,
      name: "Test X Spell",
      text: "Effect.",
      manaCost: "{X}{R}",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      colorsSpent: 1,
      isCountered: false,
      timestamp: 0,
    });

    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Spell Snare",
        oracle: "Counter target spell with mana value 10 or less.",
        spell: [{ op: "Counter", target: "spell", max_mana_value: 10 }],
      } as never,
      {
        controllerId: p1,
        sourceCardId: null,
        targets: [{ type: "stack", targetId: "spell-5", isValid: true }],
        chosenModes: [],
      },
    );
    expect(result.stack.find((o) => o.id === "spell-5")).toBeDefined();
    expect(result.cards.get("x-spell" as CardInstanceId)!.currentZoneKey).toBe(
      `${p2}-battlefield`,
    );
  });

  it("Counter with no mana-value bound still counters any spell", () => {
    // Regression check: when both bounds are unset, existing
    // counter-anything behavior is preserved.
    const any = makeCard({
      id: "any",
      name: "Test Any Spell",
      type_line: "Instant",
      cmc: 7,
      colors: ["W"],
    });
    const s = putOnBattlefield(state, any, p2, "any" as CardInstanceId);
    s.stack.push({
      id: "spell-6",
      type: "spell",
      sourceCardId: "any",
      controllerId: p2,
      name: "Test Any Spell",
      text: "Effect.",
      manaCost: "{6}{W}",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      colorsSpent: 1,
      isCountered: false,
      timestamp: 0,
    });

    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Vanilla Counterspell",
        oracle: "Counter target spell.",
        spell: [{ op: "Counter", target: "spell" }],
      } as never,
      {
        controllerId: p1,
        sourceCardId: null,
        targets: [{ type: "stack", targetId: "spell-6", isValid: true }],
        chosenModes: [],
      },
    );
    expect(result.stack.find((o) => o.id === "spell-6")).toBeUndefined();
    expect(result.cards.get("any" as CardInstanceId)!.currentZoneKey).toBe(
      `${p2}-graveyard`,
    );
  });
});
