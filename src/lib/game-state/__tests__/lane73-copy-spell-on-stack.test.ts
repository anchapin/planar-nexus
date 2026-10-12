/**
 * Wave 4.8 follow-up 6 lane 73 — Copying a spell on the stack
 * (Splice, copy-with-new-targets) (#2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of recent cards
 * with the "copy a spell on the stack; you may choose new
 * targets for the copy" pattern (Splice, copy-with-new-targets —
 * Double Vision, Reiterate, Pyromancer's Goggles). The v1
 * minimum extends `CopySpellSchema` with a `new_targets: true`
 * boolean flag that flows through `copyTriggeringSpell` to
 * `copySpellOnStack(state, sourceId, newTargets)`.
 *
 * Schema (card-scripts/schema.ts, CopySpellSchema):
 *   `new_targets: true` — the controller MAY retarget the copy
 *   (CR 707.10d). v1 minimum: the copy inherits the original's
 *   targets (a forward-compatible signal that the engine
 *   acknowledged the "you may choose new targets" clause).
 *
 * Engine:
 *   `copyTriggeringSpell` (card-scripts/interpret.ts) reads
 *   the `newTargets` flag and dispatches to
 *   `copySpellOnStack(state, sourceId)` (which already
 *   accepts an optional `newTargets: Target[]` argument — the
 *   v0 substrate is the lane 33 Double Vision arm, CR 707.10d).
 *
 * Test harness pattern: synthetic card script registered
 * via `CardScriptSchema.parse + registerCardScripts` (the
 * lane 49/52/55/59/60/62/63/64/65/66/67/68/69/70/71/72
 * pattern).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  Target,
} from "../types";

const HOST_NAME = "Test Double Vision (lane 73)";

const SCRIPT_DOUBLE_VISION: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle:
    "Whenever you cast an instant or sorcery spell, copy it. You may choose new targets for the copy.",
  triggers: [
    {
      text: HOST_NAME,
      event: "cast",
      caster: "you",
      spell: "instant_or_sorcery",
      effects: [
        {
          op: "CopySpell",
          new_targets: true,
        },
      ],
    },
  ],
});

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Instant",
    oracle_text: "",
    mana_cost: "{R}",
    cmc: 1,
    colors: overrides.colors ?? ["R"],
    color_identity: overrides.color_identity ?? ["R"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: undefined,
    toughness: undefined,
    ...overrides,
  } as ScryfallCard;
}

const redBolt = card({
  name: "Red Bolt",
  type_line: "Instant",
  oracle_text: "Red Bolt deals 1 damage to any target.",
  mana_cost: "{R}",
  colors: ["R"],
  color_identity: ["R"],
});

const greenBear = card({
  name: "Green Bear",
  type_line: "Creature — Bear",
  oracle_text: "",
  mana_cost: "{G}",
  cmc: 1,
  colors: ["G"],
  color_identity: ["G"],
  power: "2",
  toughness: "2",
});

const targetCreature = card({
  name: "Target Creature",
  type_line: "Creature — Soldier",
  power: "1",
  toughness: "1",
});

function put(
  state: GameState,
  playerId: PlayerId,
  zone: "hand" | "battlefield",
  data: ScryfallCard,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId);
  state.cards.set(c.id, { ...c, hasSummoningSickness: false });
  const key = `${playerId}-${zone}`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

interface SetupResult {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
}

function setupTwoPlayerGame(): SetupResult {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys()) as PlayerId[];
  return {
    state: {
      ...state,
      status: "in_progress",
      turn: {
        ...state.turn,
        activePlayerId: playerIds[0],
        currentPhase: Phase.PRECOMBAT_MAIN,
      },
      priorityPlayerId: playerIds[0],
      stack: [],
    },
    aliceId: playerIds[0],
    bobId: playerIds[1],
  };
}

describe("Wave 4.8 follow-up 6 lane 73 — copy spell on stack", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
    registerCardScripts([SCRIPT_DOUBLE_VISION]);
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  it("accepts the v1 new_targets: true flag on CopySpellSchema", () => {
    // Sanity check on the schema: the script is parseable and
    // carries the new_targets flag on the cast trigger's
    // CopySpell effect.
    const parsed = CardScriptSchema.parse(SCRIPT_DOUBLE_VISION);
    const trigger = parsed.triggers?.[0];
    expect(trigger).toBeDefined();
    const effect = trigger!.effects?.[0];
    expect(effect).toBeDefined();
    expect(effect!.op).toBe("CopySpell");
    expect((effect as { new_targets?: boolean }).new_targets).toBe(true);
  });

  it("copies an instant on the stack and inherits the original's targets (v1 minimum)", () => {
    // Set up: Alice has Double Vision on the battlefield and
    // a Red Bolt in her hand. Bob has a 1/1 target creature.
    // Alice casts the bolt targeting Bob's creature. Double
    // Vision's cast trigger fires, copying the bolt. The copy
    // inherits the original's targets (v1 minimum: no
    // player-facing retarget UI).
    const { state, aliceId, bobId } = setupTwoPlayerGame();
    let s = state;
    s = addMana(s, aliceId, { red: 2, generic: 1 });
    const gogglesId = put(s, aliceId, "battlefield", {
      ...card({ name: HOST_NAME }),
    });
    expect(s.cards.get(gogglesId)).toBeDefined();
    const victim = put(s, bobId, "battlefield", targetCreature);
    const boltId = put(s, aliceId, "hand", redBolt);

    const targets: Target[] = [
      { type: "card", targetId: victim, isValid: true },
    ];
    const r = castSpell(s, aliceId, boltId, targets);
    expect(r.success).toBe(true);
    if (!r.success) return;

    // Stack: original Red Bolt + Double Vision's cast trigger.
    expect(r.state.stack).toHaveLength(2);
    const trigger = r.state.stack[1];
    expect(trigger.triggered).toBe(true);
    expect(trigger.triggeringStackObjectId).toBe(r.state.stack[0].id);

    // Resolve the trigger: the engine pushes the copy above the original.
    const after = resolveTopOfStack(r.state);
    expect(after.stack).toHaveLength(2);
    const [original, copy] = after.stack;
    expect(copy.isCopy).toBe(true);
    // v1 minimum: copy inherits original's targets.
    expect(copy.targets[0].targetId).toBe(victim);
    expect(original.targets[0].targetId).toBe(victim);
  });

  it("does not fire for a creature spell (spell filter excludes non-instant/sorcery)", () => {
    // Set up: Alice has Double Vision + a Green Bear in her
    // hand. Casting a creature should NOT trigger the copy
    // (the script's `spell: "instant_or_sorcery"` filter
    // excludes creatures).
    const { state, aliceId } = setupTwoPlayerGame();
    let s = state;
    s = addMana(s, aliceId, { green: 1 });
    put(s, aliceId, "battlefield", { ...card({ name: HOST_NAME }) });
    const bearId = put(s, aliceId, "hand", greenBear);

    const r = castSpell(s, aliceId, bearId);
    expect(r.success).toBe(true);
    if (!r.success) return;
    // No cast trigger fired.
    expect(r.state.stack).toHaveLength(1);
  });

  it("does not fire when an opponent casts an instant", () => {
    // Set up: Alice has Double Vision. Bob has a Red Bolt in
    // his hand. Bob casts the bolt — Double Vision's `caster:
    // "you"` filter excludes opponent casts.
    const { state, aliceId, bobId } = setupTwoPlayerGame();
    let s = state;
    s = addMana(s, bobId, { red: 1 });
    put(s, aliceId, "battlefield", { ...card({ name: HOST_NAME }) });
    const victim = put(s, bobId, "battlefield", targetCreature);
    const boltId = put(s, bobId, "hand", redBolt);

    const r = castSpell({ ...s, priorityPlayerId: bobId }, bobId, boltId, [
      { type: "card", targetId: victim, isValid: true },
    ]);
    expect(r.success).toBe(true);
    if (!r.success) return;
    // No cast trigger fired (opponent's cast).
    expect(r.state.stack).toHaveLength(1);
  });

  it("the copy's isCopy flag is true (forward-compatible with the new_targets wiring)", () => {
    // The copy is always marked as `isCopy: true` so the
    // resolution path knows not to move a card. This is the
    // substrate for the future retarget-UI lane — the copy
    // carries the `new_targets: true` flag through to
    // resolution.
    const { state, aliceId, bobId } = setupTwoPlayerGame();
    let s = state;
    s = addMana(s, aliceId, { red: 2 });
    put(s, aliceId, "battlefield", { ...card({ name: HOST_NAME }) });
    const victim = put(s, bobId, "battlefield", targetCreature);
    const boltId = put(s, aliceId, "hand", redBolt);

    const r = castSpell(s, aliceId, boltId, [
      { type: "card", targetId: victim, isValid: true },
    ]);
    if (!r.success) throw new Error("cast failed");
    const after = resolveTopOfStack(r.state);
    const [original, copy] = after.stack;
    expect(original.isCopy).toBeFalsy();
    expect(copy.isCopy).toBe(true);
  });
});
