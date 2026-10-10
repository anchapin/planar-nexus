/**
 * Pyromancer's Goggles — combine `cast_color` (lane 34) with
 * `CopySpell` + `new_targets` (lane 33) on a single cast trigger
 * (#2594 follow-up, lane 35, CR 707.10 / 707.10d).
 *
 * Pyromancer's Goggles' real oracle is "{T}: Add {R}. When that mana
 * is spent to cast a red instant or sorcery spell, copy that spell
 * and you may choose new targets for the copy." The v1 trigger
 * pipeline does not model mana-spending delayed triggers, so the
 * sample ships a structurally simpler cast-trigger shape: the same
 * color filter + copy-with-new-targets behavior fires on any red
 * instant or sorcery Alice casts. The mana-spending piece is a
 * follow-up lane (it shares the "delayed trigger" plumbing gap with
 * Teach by Example from lane 33).
 *
 * The v1 engine has no player-facing retarget UI, so the copy still
 * inherits the original's targets even with `new_targets: true`;
 * the flag is a forward-compatible signal that the engine
 * acknowledged the "you may choose new targets" clause.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
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
import { getCardScript } from "../card-scripts/registry";

const PYROMANCERS_GOGGLES =
  "Whenever you cast a red instant or sorcery spell, copy it. You may choose new targets for the copy.";

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Legendary Artifact",
    oracle_text: "",
    mana_cost: "{5}",
    cmc: 5,
    colors: [],
    color_identity: ["R"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: undefined,
    toughness: undefined,
    ...overrides,
  } as ScryfallCard;
}

const goggles = card({
  name: "Pyromancer's Goggles",
  oracle_text: PYROMANCERS_GOGGLES,
  mana_cost: "{5}",
});
// A red instant — must trigger the copy.
const redBolt = card({
  name: "Red Bolt",
  type_line: "Instant",
  oracle_text: "Red Bolt deals 1 damage to any target.",
  mana_cost: "{R}",
  colors: ["R"],
  color_identity: ["R"],
});
// A green creature spell — must NOT trigger the copy (not red).
const greenBear = card({
  name: "Green Bear",
  type_line: "Creature \u2014 Bear",
  oracle_text: "",
  mana_cost: "{G}",
  cmc: 1,
  colors: ["G"],
  color_identity: ["G"],
});
// A red creature spell — must NOT trigger the copy (not instant/sorcery).
const redOgre = card({
  name: "Red Ogre",
  type_line: "Creature \u2014 Ogre",
  oracle_text: "",
  mana_cost: "{2}{R}",
  cmc: 3,
  colors: ["R"],
  color_identity: ["R"],
  power: "4",
  toughness: "1",
});
// Bob's a red creature target for the bolt.
const targetCreature = card({
  name: "Target Creature",
  type_line: "Creature \u2014 Soldier",
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

const damageOn = (s: GameState, id: CardInstanceId) =>
  s.cards.get(id)?.damage ?? 0;

describe("Pyromancer's Goggles — cast_color + CopySpell new_targets (lane 35)", () => {
  let state: GameState;
  let alice: PlayerId;
  let bob: PlayerId;
  let victim: CardInstanceId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice, bob] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { red: 4, generic: 4, green: 2 });
    state = addMana(state, bob, { red: 4, generic: 4 });
    victim = put(state, bob, "battlefield", targetCreature);
  });

  it("registers cast_color + new_targets on the script's cast trigger", () => {
    const script = getCardScript("Pyromancer's Goggles");
    expect(script).toBeDefined();
    const trigger = script!.triggers?.[0];
    expect(trigger).toBeDefined();
    expect(trigger!.event).toBe("cast");
    expect((trigger as { cast_color?: string }).cast_color).toBe("R");
    expect((trigger as { spell?: string }).spell).toBe("instant_or_sorcery");
    const effect = trigger!.effects?.[0];
    expect(effect!.op).toBe("CopySpell");
    expect((effect as { new_targets?: boolean }).new_targets).toBe(true);
  });

  it("copies a red instant and both the original and the copy deal damage", () => {
    const gogglesId = put(state, alice, "battlefield", goggles);
    expect(state.cards.get(gogglesId)).toBeDefined();
    const boltId = put(state, alice, "hand", redBolt);
    const targets: Target[] = [
      { type: "card", targetId: victim, isValid: true },
    ];
    const r = castSpell(state, alice, boltId, targets);
    expect(r.success).toBe(true);
    // Stack: original Red Bolt + Goggles' copy trigger.
    expect(r.state.stack).toHaveLength(2);
    const trigger = r.state.stack[1];
    expect(trigger.triggered).toBe(true);
    expect(trigger.triggeringStackObjectId).toBe(r.state.stack[0].id);

    // Resolve the trigger: the engine pushes the copy above the original.
    const after = resolveTopOfStack(r.state);
    expect(after.stack).toHaveLength(2);
    const [original, copy] = after.stack;
    expect(copy.isCopy).toBe(true);
    // `new_targets: true` accepted by the engine; the copy still
    // inherits the original's targets in v1 (no retarget UI).
    expect(copy.targets[0].targetId).toBe(victim);
    expect(original.targets[0].targetId).toBe(victim);

    // Resolve the copy first (it's on top of the original).
    let s = resolveTopOfStack(after);
    expect(damageOn(s, victim)).toBe(1);
    // Then the original.
    s = resolveTopOfStack(s);
    expect(damageOn(s, victim)).toBe(2);
  });

  it("does not fire for a non-red instant (color filter)", () => {
    put(state, alice, "battlefield", goggles);
    // Use a colorless "instant" — name it Bolt but with no colors. The
    // script's `cast_color: "R"` gate excludes it.
    const colorlessBolt = card({
      name: "Colorless Bolt",
      type_line: "Instant",
      oracle_text: "Colorless Bolt deals 1 damage to any target.",
      mana_cost: "{1}",
      colors: [],
      color_identity: [],
    });
    const boltId = put(state, alice, "hand", colorlessBolt);
    const r = castSpell(state, alice, boltId, [
      { type: "card", targetId: victim, isValid: true },
    ]);
    expect(r.success).toBe(true);
    // No cast_color match — only the colorless bolt is on the stack.
    expect(r.state.stack).toHaveLength(1);
  });

  it("does not fire for a non-instant/sorcery red spell", () => {
    put(state, alice, "battlefield", goggles);
    const ogreId = put(state, alice, "hand", redOgre);
    const r = castSpell(state, alice, ogreId);
    expect(r.success).toBe(true);
    // spell: "instant_or_sorcery" excludes red creatures.
    expect(r.state.stack).toHaveLength(1);
  });

  it("does not fire when an opponent casts a red instant", () => {
    put(state, alice, "battlefield", goggles);
    const boltId = put(state, bob, "hand", redBolt);
    const r = castSpell({ ...state, priorityPlayerId: bob }, bob, boltId, [
      { type: "card", targetId: victim, isValid: true },
    ]);
    expect(r.success).toBe(true);
    // caster: "you" excludes Bob.
    expect(r.state.stack).toHaveLength(1);
  });
});
