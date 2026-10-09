/**
 * Cinder Pyromancer — cast-trigger color filter (#2594 follow-up,
 * lane 34, CR 601.2i / 603.2).
 *
 * The drafter list (fdn.md) flags Pyromancer's Goggles as the FDN
 * card for "copying a spell with the ability to choose new targets"
 * — its real oracle combines the color filter (this lane) with a
 * copy+retarget effect (lane 35). Cinder Pyromancer (CMD / EMA)
 * exercises only the new `cast_color` schema+engine wiring: the
 * trigger fires on a red spell and deals 1 damage to any target.
 * The Pyromancer's Goggles follow-up combines both pieces in a
 * future lane.
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
import { chooseTriggerTargets } from "../trigger-system/trigger-targets";

const CINDER_PYROMANCER =
  "Whenever you cast a red spell, Cinder Pyromancer deals 1 damage to any target.";

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Creature \u2014 Elemental",
    oracle_text: "",
    mana_cost: "{R}",
    cmc: 1,
    colors: ["R"],
    color_identity: ["R"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "0",
    toughness: "1",
    ...overrides,
  } as ScryfallCard;
}

const pyromancer = card({
  name: "Cinder Pyromancer",
  oracle_text: CINDER_PYROMANCER,
  mana_cost: "{2}{R}",
  power: "0",
  toughness: "1",
});
// A red instant ("a red spell").
const redInstant = card({
  name: "Red Bolt",
  type_line: "Instant",
  oracle_text: "Red Bolt deals 1 damage to any target.",
  mana_cost: "{R}",
});
// A green creature ("a non-red spell") — must NOT trigger Cinder Pyromancer.
const greenBear = card({
  name: "Green Bear",
  type_line: "Creature \u2014 Bear",
  oracle_text: "",
  mana_cost: "{G}",
  cmc: 1,
  colors: ["G"],
  color_identity: ["G"],
});
// Bob's a red creature target so we can verify the ping on a real
// battlefield permanent.
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

describe("Cinder Pyromancer — cast_color filter (lane 34)", () => {
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

  it("registers the cast_color flag on the script's cast trigger", () => {
    const script = getCardScript("Cinder Pyromancer");
    expect(script).toBeDefined();
    const trigger = script!.triggers?.[0];
    expect(trigger).toBeDefined();
    expect(trigger!.event).toBe("cast");
    expect((trigger as { cast_color?: string }).cast_color).toBe("R");
  });

  it("fires when you cast a red spell and pings the chosen target", () => {
    put(state, alice, "battlefield", pyromancer);
    const boltId = put(state, alice, "hand", redInstant);
    const targets: Target[] = [
      { type: "card", targetId: victim, isValid: true },
    ];
    const r = castSpell(state, alice, boltId, targets);
    expect(r.success).toBe(true);
    // Stack: original red spell + Cinder Pyromancer's cast trigger.
    expect(r.state.stack).toHaveLength(2);
    const trigger = r.state.stack[1];
    expect(trigger.triggered).toBe(true);

    // The trigger needs a target chosen for its `target: "any"` effect
    // (CR 603.3d). Player picks the victim.
    const targeted = chooseTriggerTargets(r.state, trigger.id, [victim]);
    expect(targeted.success).toBe(true);

    const after = resolveTopOfStack(targeted.state);
    expect(damageOn(after, victim)).toBe(1);
  });

  it("does not fire when you cast a non-red spell", () => {
    put(state, alice, "battlefield", pyromancer);
    const bearId = put(state, alice, "hand", greenBear);
    const r = castSpell(state, alice, bearId);
    expect(r.success).toBe(true);
    // No cast_color match — only the green bear is on the stack.
    expect(r.state.stack).toHaveLength(1);
  });

  it("does not fire when an opponent casts a red spell", () => {
    put(state, alice, "battlefield", pyromancer);
    const boltId = put(state, bob, "hand", redInstant);
    const r = castSpell({ ...state, priorityPlayerId: bob }, bob, boltId, [
      { type: "card", targetId: victim, isValid: true },
    ]);
    expect(r.success).toBe(true);
    // Bob is the opponent; the trigger's `caster: "you"` gate excludes.
    expect(r.state.stack).toHaveLength(1);
  });
});
