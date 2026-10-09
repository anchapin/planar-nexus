/**
 * "Counter target activated or triggered ability" tests (#2594 follow-up,
 * lane 22)
 *
 * The drafter has 1 card wanting this — Louisoix's Sacrifice (FIN #59,
 * "Counter target activated ability, triggered ability, or noncreature
 * spell.") — which also has an additional cost and a 3-way counter
 * pattern; the additional cost is a separate lane (#2614 plan).
 * For the lane's minimal sample, this lane scripts **Stifle** (Time
 * Spiral #88): "Counter target activated or triggered ability."
 *
 * The lane extends `CounterSchema.target` with `"ability"`. The engine's
 * `counterSpell()` already differentiates spells vs abilities per CR
 * 701.5a/701.5b (abilities "cease to exist"; spells move to owner's
 * graveyard) — only the script schema was blocking scripted
 * ability-counters. The `colors` filter remains valid only for
 * `target: "spell"` (abilities don't carry a single "spell color";
 * future work may extend the filter to ability source colors).
 *
 * The lane covers the canonical "counter an ability on the stack"
 * use case without touching the additional-cost lane (#2614).
 */
import { describe, it, expect, afterAll, beforeAll } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInitialGameState, startGame } from "../game-state";
import { resolveScriptedSpell } from "../card-scripts/interpret";
import { getCardScript } from "../card-scripts/registry";
import type { GameState, PlayerId, StackObject } from "../types";
import type { Target } from "../types/stack";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { CardScriptSchema } from "../card-scripts/schema";

function abilityOnStack(
  id: string,
  controllerId: PlayerId,
  triggered = true,
): StackObject {
  return {
    id,
    type: "ability",
    triggered,
    sourceCardId: null,
    controllerId,
    name: "Victim Ability",
    text: "",
    manaCost: null,
    targets: [],
    chosenModes: [],
    variableValues: new Map(),
    isCopy: false,
    timestamp: 0,
  } as unknown as StackObject;
}

function spellOnStack(id: string, controllerId: PlayerId): StackObject {
  return {
    id,
    type: "spell",
    sourceCardId: null,
    controllerId,
    name: "Victim Spell",
    text: "",
    manaCost: "",
    targets: [],
    chosenModes: [],
    variableValues: new Map(),
    isCopy: false,
    timestamp: 0,
  } as unknown as StackObject;
}

const stackTarget = (id: string): Target => ({
  type: "stack",
  targetId: id,
  isValid: true,
});

describe('Counter target activated or triggered ability (#2594 follow-up, lane 22)', () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeAll(() => {
    // Stifle is now part of RAW_CARD_SCRIPTS (added by the lane).
    registerCardScripts(RAW_CARD_SCRIPTS);
  });
  afterAll(() => {
    resetCardScriptsForTests();
    registerCardScripts(RAW_CARD_SCRIPTS);
  });

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("Stifle fixture declares Counter.target: ability", () => {
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const fixture = JSON.parse(
      readFileSync(join(cardsDir, "stifle.json"), "utf8"),
    ) as {
      name: string;
      spell: { op: string; target: string }[];
    };
    expect(fixture.name).toBe("Stifle");
    expect(fixture.spell).toHaveLength(1);
    expect(fixture.spell[0].op).toBe("Counter");
    expect(fixture.spell[0].target).toBe("ability");
  });

  it("schema accepts Counter.target: ability", () => {
    const ok = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      spell: [{ op: "Counter", target: "ability" }],
    });
    expect(ok.success).toBe(true);
  });

  it("schema rejects Counter with both target: ability and colors (v1 limitation)", () => {
    // The `colors` filter is only valid for target: "spell" (lane 22);
    // abilities don't carry a single "spell color".
    const bad = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      spell: [{ op: "Counter", target: "ability", colors: ["U"] }],
    });
    expect(bad.success).toBe(false);
  });

  it("resolveScriptedSpell removes the ability from the stack", () => {
    const victim = abilityOnStack("ability-victim", p2, true);
    const s = resolveScriptedSpell(
      { ...state, stack: [victim] },
      getCardScript("Stifle")!,
      { ...spellOnStackWrapper(p1), targets: [stackTarget("ability-victim")] },
    );
    expect(s.stack.some((o) => o.id === "ability-victim")).toBe(false);
  });

  it("resolveScriptedSpell removes an activated ability from the stack", () => {
    // Same path; CR 701.5a applies to both activated and triggered
    // abilities — abilities cease to exist without moving a card.
    const victim = abilityOnStack("activated-victim", p2, false);
    const s = resolveScriptedSpell(
      { ...state, stack: [victim] },
      getCardScript("Stifle")!,
      {
        ...spellOnStackWrapper(p1),
        targets: [stackTarget("activated-victim")],
      },
    );
    expect(s.stack.some((o) => o.id === "activated-victim")).toBe(false);
  });

  it("leaves spell on stack alone when Stifle's target is still a spell (regression)", () => {
    // The lane shouldn't regress the existing "Counter target spell"
    // path (Cancel, Negate, Refute). Stifle with target: ability
    // targets an ability on the stack — if the spell interpreter
    // accidentally routes through `target: "spell"`, the spell stays
    // on the stack because the target type doesn't change.
    const victim = spellOnStack("spell-victim", p2);
    const s = resolveScriptedSpell(
      { ...state, stack: [victim] },
      getCardScript("Stifle")!,
      { ...spellOnStackWrapper(p1), targets: [stackTarget("spell-victim")] },
    );
    // Stifle only counters abilities; a spell targeted by Stifle
    // remains on the stack because `target: "ability"` semantics
    // (the lane) doesn't strip spells.
    expect(s.stack.some((o) => o.id === "spell-victim")).toBe(true);
  });
});

/** Build a Spellgyre/Cancel-shaped stack object the scripted
 *  resolver can drive — kept local so the test surface stays
 *  readable. */
function spellOnStackWrapper(controllerId: PlayerId): StackObject {
  return {
    id: "stifle-spell",
    type: "spell",
    sourceCardId: null,
    controllerId,
    name: "Stifle",
    text: "",
    manaCost: "",
    targets: [],
    chosenModes: [],
    variableValues: new Map(),
    isCopy: false,
    timestamp: 0,
  } as unknown as StackObject;
}