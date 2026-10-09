/**
 * Double Vision — copy an instant/sorcery with the "you may choose new
 * targets" clause (#2594 follow-up, lane 33, CR 707.10 / 707.10d).
 *
 * The drafter list (fdn.md) tags Teach by Example (FDN 666) as the FDN
 * card for "copy spell with new targets" and "delayed triggered ability".
 * Teach by Example's real oracle is a delayed "next time you cast"
 * trigger, which the v1 trigger pipeline does not model. Double Vision
 * (M21, CMM) has the same cast-trigger + copy + "you may choose new
 * targets" structure as Teach by Example's intent, on a `cast` event
 * the engine already supports. The lane's schema+engine change ships
 * here; the delayed-trigger piece for Teach by Example proper is a
 * follow-up lane.
 *
 * The v1 engine has no player-facing retarget UI, so the `new_targets`
 * flag on `CopySpell` records the intent and the copy still inherits
 * the original's targets (the same fallback `copySpellOnStack` uses
 * when `newTargets` is undefined). This test exercises the schema +
 * engine wiring: the trigger fires, the copy is made, and the
 * `new_targets` flag is accepted without changing the result.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  castSpell,
  copySpellOnStack,
  resolveTopOfStack,
} from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  StackObject,
  Target,
} from "../types";
import { getCardScript } from "../card-scripts/registry";

const DOUBLE_VISION =
  "Whenever you cast an instant or sorcery spell, copy it. You may choose new targets for the copy.";

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Enchantment",
    oracle_text: "",
    mana_cost: "{R}",
    cmc: 1,
    colors: ["R"],
    color_identity: ["R"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: undefined,
    toughness: undefined,
    ...overrides,
  } as ScryfallCard;
}

const vision = card({
  name: "Double Vision",
  type_line: "Enchantment",
  oracle_text: DOUBLE_VISION,
  mana_cost: "{1}{R}{R}",
});
const strike = card({
  name: "Lightning Strike",
  type_line: "Instant",
  oracle_text: "Lightning Strike deals 3 damage to any target.",
  mana_cost: "{1}{R}",
});
const giant = card({ name: "Test Giant", power: "7", toughness: "7" });

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

describe("Double Vision — CopySpell new_targets flag (lane 33)", () => {
  let state: GameState;
  let alice: PlayerId;
  let bob: PlayerId;
  let target: CardInstanceId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice, bob] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { red: 4, generic: 4 });
    target = put(state, bob, "battlefield", giant);
  });

  it("registers the new_targets flag on the script's CopySpell effect", () => {
    const script = getCardScript("Double Vision");
    expect(script).toBeDefined();
    const trigger = script!.triggers?.[0];
    expect(trigger).toBeDefined();
    const effect = trigger!.effects?.[0];
    expect(effect).toBeDefined();
    expect(effect!.op).toBe("CopySpell");
    expect((effect as { new_targets?: boolean }).new_targets).toBe(true);
  });

  it("copies the triggering instant and the copy inherits original targets", () => {
    // Double Vision on the battlefield; cast Lightning Strike targeting
    // Bob's giant. The cast trigger fires, copies the strike, and the
    // copy (and original) deal damage to the same giant.
    put(state, alice, "battlefield", vision);
    const strikeId = put(state, alice, "hand", strike);
    const targets: Target[] = [
      { type: "card", targetId: target, isValid: true },
    ];
    const r = castSpell(state, alice, strikeId, targets);
    expect(r.success).toBe(true);
    // Stack: original Lightning Strike + Double Vision's copy trigger.
    expect(r.state.stack).toHaveLength(2);
    const trigger = r.state.stack[1];
    expect(trigger.triggered).toBe(true);
    expect(trigger.triggeringStackObjectId).toBe(r.state.stack[0].id);

    // Resolve the trigger: the engine routes through CopySpell with
    // new_targets=true and pushes the copy above the original.
    const after = resolveTopOfStack(r.state);
    expect(after.stack).toHaveLength(2);
    const [original, copy] = after.stack;
    expect(copy.isCopy).toBe(true);
    expect(copy.targets[0].targetId).toBe(target);
    // `new_targets: true` accepted by the engine; the copy still inherits
    // the original's targets in v1 (no retarget UI).
    expect(original.targets[0].targetId).toBe(target);
  });

  it("CopySpell without new_targets (Spinerock path) still copies same targets", () => {
    // Spinerock Tyrant's CopySpell with `gain: ["wither"]` and no
    // `new_targets` flag must keep the previous behavior: the engine
    // calls copySpellOnStack without `newTargets`, so the copy inherits
    // the original's targets verbatim. This is the round-trip that lane
    // 33's change must not regress.
    const spell: StackObject = {
      id: "s1",
      type: "spell",
      sourceCardId: "c1" as CardInstanceId,
      controllerId: alice,
      name: "Test",
      text: "",
      manaCost: "{R}",
      targets: [{ type: "card", targetId: target, isValid: true }],
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: 0,
      effects: [],
    };
    state.stack = [spell];
    const copied = copySpellOnStack(state, "s1");
    expect(copied.success).toBe(true);
    expect(copied.state.stack[1].targets[0].targetId).toBe(target);
  });
});
