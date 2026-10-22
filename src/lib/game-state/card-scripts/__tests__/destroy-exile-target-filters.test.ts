/**
 * Card scripts — destroy exile target filters.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - destroy and exile target filters (#2528, #2594 #14)
 */
import { CardScript } from "../schema";
import {
  CardScriptSchema,
  getCardScript,
  resolveScriptedSpell,
  resolveScriptedAbility,
} from "../index";
import { GameState, PlayerId, StackObject, Target } from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import {
  getLegalSpellTargets,
  chooseAbilityModes,
  chooseTriggerTargets,
  getLegalTriggerTargets,
} from "../../trigger-system/trigger-targets";
import { id, card, put, spell, cardTarget } from "./helpers";
import { matchesRemovalFilter } from "../target-filters";

describe("destroy and exile target filters (#2528, #2594 #14)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    state = put(state, p2, "giant", card("Giant", "Creature — Giant", [5, 5]));
    state = put(state, p2, "rock", card("Mind Stone", "Artifact"));
    state = put(state, p2, "aura", card("Pacifism", "Enchantment — Aura"));
    state = put(
      state,
      p2,
      "golem",
      card("Golem", "Artifact Creature — Golem", [3, 3]),
    );
    state = put(state, p2, "forest", card("Forest", "Basic Land — Forest"));
    // #2594 #14: Hero's Downfall / Deadly Plot "destroy target
    // planeswalker".
    state = put(
      state,
      p2,
      "planeswalker",
      card("Test Walker", "Legendary Planeswalker — Test"),
    );
  });

  const matching = (filter: Parameters<typeof matchesRemovalFilter>[1]) =>
    ["bear", "giant", "rock", "aura", "golem", "forest", "planeswalker"].filter(
      (c) => matchesRemovalFilter(state.cards.get(id(c))!, filter),
    );

  it("matches permanents by type and creatures by power", () => {
    expect(matching({ target: "artifact" })).toEqual(["rock", "golem"]);
    expect(matching({ target: "enchantment" })).toEqual(["aura"]);
    expect(matching({ target: "artifact_or_enchantment" })).toEqual([
      "rock",
      "aura",
      "golem",
    ]);
    expect(matching({ target: "nonland_permanent" })).toEqual([
      "bear",
      "giant",
      "rock",
      "aura",
      "golem",
      "planeswalker",
    ]);
    expect(matching({ target: "creature", min_power: 4 })).toEqual(["giant"]);
    expect(matching({ target: "creature", max_power: 3 })).toEqual([
      "bear",
      "golem",
    ]);
    expect(matching({ target: "artifact", min_power: 3 })).toEqual(["golem"]);
    // #2594 #14: "destroy target planeswalker" only matches the
    // planeswalker (Hero's Downfall, Deadly Plot).
    expect(matching({ target: "planeswalker" })).toEqual(["planeswalker"]);
  });

  it("accepts the new targets and rejects unknown ones", () => {
    const base = { name: "X", oracle: "x" };
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ ...base, spell: [effect] }).success;
    expect(ok({ op: "Destroy", target: "artifact_or_enchantment" })).toBe(true);
    expect(ok({ op: "Exile", target: "nonland_permanent" })).toBe(true);
    expect(ok({ op: "Destroy", target: "creature", min_power: 4 })).toBe(true);
    // #2594 #14: planeswalker target is now in the schema.
    expect(ok({ op: "Destroy", target: "planeswalker" })).toBe(true);
    expect(ok({ op: "Exile", target: "planeswalker" })).toBe(true);
    expect(ok({ op: "Destroy", target: "land" })).toBe(false);
  });

  it("destroying a planeswalker sends it to the graveyard (#2594 #14)", () => {
    // Hero's Downfall path: cast { op: "Destroy", target:
    // "planeswalker" } with the walker as the target; the walker
    // ends up in p2's graveyard.
    const pw = state.cards.get(id("planeswalker"))!;
    expect(pw.controllerId).toBe(p2);
    const cast = spell(p1, [cardTarget("planeswalker")]);
    const result = resolveScriptedSpell(
      state,
      {
        name: "Test Destroy Planeswalker",
        oracle: "Destroy target planeswalker.",
        spell: [{ op: "Destroy", target: "planeswalker" }],
      } as CardScript,
      cast,
    );
    expect(result.zones.get(`${p2}-graveyard`)!.cardIds).toContain(
      id("planeswalker"),
    );
  });

  it("Battle Menu's Magic mode only targets power 4 or greater", () => {
    const magic = "Magic — Destroy target creature with power 4 or greater.";
    state = put(state, p1, "menu", card("Battle Menu", "Instant"), "library");
    const legal = getLegalSpellTargets(state, p1, id("menu"), [magic]);
    expect(legal).toEqual(["giant"]);
  });

  it("does nothing when the target no longer matches on resolution", () => {
    const menu = getCardScript("Battle Menu")!;
    const magic = "Magic — Destroy target creature with power 4 or greater.";
    const target = (c: string): Target => ({
      type: "card",
      targetId: c,
      isValid: true,
    });
    const cast = (c: string) =>
      ({ ...spell(p1, [target(c)]), chosenModes: [magic] }) as never;
    const yard = (st: GameState) => st.zones.get(`${p2}-graveyard`)!.cardIds;
    expect(yard(resolveScriptedSpell(state, menu, cast("giant")))).toContain(
      id("giant"),
    );
    // The bear doesn't have power 4 or greater: the destroy is skipped (CR 608.2b).
    expect(yard(resolveScriptedSpell(state, menu, cast("bear")))).not.toContain(
      id("bear"),
    );
  });

  it("Coliseum Behemoth's ETB targets only artifacts and enchantments", () => {
    state = put(
      state,
      p1,
      "behemoth",
      card("Coliseum Behemoth", "Creature — Beast", [7, 7]),
    );
    const etb = "When this creature enters, choose one —";
    const obj = {
      id: "cb-1",
      type: "ability",
      sourceCardId: id("behemoth"),
      controllerId: p1,
      text: etb,
      targets: [],
      chosenModes: [],
      triggered: true,
      activated: false,
    } as unknown as StackObject;
    let s = { ...state, stack: [obj] };
    s = chooseAbilityModes(s, "cb-1", [
      "Destroy target artifact or enchantment.",
    ]).state;
    expect(getLegalTriggerTargets(s, s.stack[0]).sort()).toEqual(
      ["aura", "golem", "rock"].map((c) => id(c)).sort(),
    );
    s = chooseTriggerTargets(s, "cb-1", [id("rock")]).state;
    s = resolveScriptedAbility(s, s.stack[0])!;
    expect(s.zones.get(`${p2}-graveyard`)!.cardIds).toContain(id("rock"));
  });
});
