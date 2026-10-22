/**
 * Card scripts — auras.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted auras (#2568)
 *   - scripted Aura restrictUntap (#2594 #9)
 */
import { CardInstanceId, GameState, PlayerId, ScryfallCard } from "../../types";
import { CardScriptSchema, getCardScript } from "../index";
import { attachAura } from "../../keyword-actions/enchant";
import { canAttack, canBlock } from "../../combat/queries";
import {
  createInitialGameState,
  startGame,
  processUntapStep,
} from "../../game-state";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../../evergreen-keywords";
import { hasKeyword } from "../../evergreen-keywords";
import { id, card, put, battlefield } from "./helpers";
import { refreshAuraBonuses } from "../../keyword-actions/aura-bonus";

describe("scripted auras (#2568)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("validates the aura schema and rejects a bad target", () => {
    const base = { name: "X", oracle: "x" };
    const okAura = (aura: object) =>
      CardScriptSchema.safeParse({ ...base, aura }).success;
    expect(
      okAura({
        text: "Enchanted creature gets +1/+1.",
        target: "creature",
        static: {
          text: "Enchanted creature gets +1/+1.",
          power: 1,
          toughness: 1,
        },
      }),
    ).toBe(true);
    expect(
      okAura({
        text: "Enchanted creature can't attack.",
        target: "creature",
        static: {
          text: "Enchanted creature can't attack.",
          restrictAttack: true,
        },
      }),
    ).toBe(true);
    // bad target enum
    expect(
      okAura({
        text: "t",
        target: "invalid",
        static: { text: "t", power: 1, toughness: 1 },
      }),
    ).toBe(false);
    // aura + equipment on the same card is rejected
    expect(
      CardScriptSchema.safeParse({
        ...base,
        aura: {
          text: "t",
          static: { text: "t", power: 1, toughness: 1 },
        },
        equipment: {
          text: "t",
          attachedStatic: { text: "t", power: 1, toughness: 1 },
          equip: {
            text: "Equip {1}",
            cost: { mana: "{1}" },
            effects: [
              { op: "AttachEquipment", target: "creature", controller: "you" },
            ],
          },
        },
      }).success,
    ).toBe(false);
  });

  it("aura static needs power/toughness, keywords, or a restriction", () => {
    const base = {
      name: "X",
      oracle: "x",
      aura: { text: "t", static: { text: "t" } },
    };
    expect(CardScriptSchema.safeParse(base).success).toBe(false);
  });

  it("Pacifism forbids attack and block while attached", () => {
    const pacifismName = "Pacifism";
    expect(getCardScript(pacifismName)?.aura?.static).toBeDefined();
    let s = put(
      state,
      p1,
      "bear",
      card("Bear", "Creature \u2014 Bear", [3, 3]),
    );
    // Strip summoning sickness so the bear could otherwise attack/block.
    {
      const cards = new Map(s.cards);
      const bear = cards.get(id("bear"))!;
      cards.set(id("bear"), { ...bear, hasSummoningSickness: false });
      s = { ...s, cards };
    }
    s = put(s, p1, "pacifism", card(pacifismName, "Enchantment \u2014 Aura"));
    // Simulate the aura ETB attach: the engine's `attachAura` keeps both
    // `attachedToId` and `attachedCardIds` in sync; the SBA pass then
    // refreshes the host's bonuses.
    s = attachAura(s, id("pacifism"), id("bear"));
    s = refreshAuraBonuses(s);
    const host = s.cards.get(id("bear"))!;
    expect(host.auraRestrictAttack).toEqual(["Pacifism"]);
    expect(host.auraRestrictBlock).toEqual(["Pacifism"]);
    expect(canAttack(s, id("bear"), p2).canAttack).toBe(false);
    expect(canBlock(s, id("bear"), id("attacker")).canBlock).toBe(false);
    // The restriction is removed when the aura leaves the battlefield.
    const zones = new Map(s.zones);
    const bf = zones.get(`${p1}-battlefield`)!;
    zones.set(`${p1}-battlefield`, {
      ...bf,
      cardIds: bf.cardIds.filter((c) => c !== id("pacifism")),
    });
    const after = refreshAuraBonuses({ ...s, zones });
    expect(after.cards.get(id("bear"))!.auraRestrictAttack).toBeUndefined();
    expect(canAttack(after, id("bear"), p2).canAttack).toBe(true);
  });

  it("Twinblade Blessing gives +1/+1 and double strike", () => {
    let s = put(
      state,
      p1,
      "bear",
      card("Grizzly Bears", "Creature \u2014 Bear", [2, 2]),
    );
    s = put(
      s,
      p1,
      "blessing",
      card("Twinblade Blessing", "Enchantment \u2014 Aura"),
    );
    s = attachAura(s, id("blessing"), id("bear"));
    s = refreshAuraBonuses(s);
    const host = s.cards.get(id("bear"))!;
    expect(host.auraPT).toEqual({ power: 1, toughness: 1 });
    expect(host.auraKeywords).toEqual(["double strike"]);
    expect(getEffectivePower(host)).toBe(3);
    expect(getEffectiveToughness(host)).toBe(3);
    expect(hasKeyword(host, "double strike")).toBe(true);
  });

  it("Witness Protection gives -1/-1 and forbids attack", () => {
    let s = put(
      state,
      p1,
      "bear",
      card("Grizzly Bears", "Creature \u2014 Bear", [2, 2]),
    );
    s = put(
      s,
      p1,
      "witness",
      card("Witness Protection", "Enchantment \u2014 Aura"),
    );
    s = attachAura(s, id("witness"), id("bear"));
    s = refreshAuraBonuses(s);
    const host = s.cards.get(id("bear"))!;
    expect(host.auraPT).toEqual({ power: -1, toughness: -1 });
    expect(host.auraRestrictAttack).toEqual(["Witness Protection"]);
    expect(getEffectivePower(host)).toBe(1);
    expect(getEffectiveToughness(host)).toBe(1);
    expect(canAttack(s, id("bear"), p2).canAttack).toBe(false);
    // Witness Protection does not restrict blocking (Pacifism does).
    expect(host.auraRestrictBlock).toBeUndefined();
    expect(canBlock(s, id("bear"), id("attacker")).canBlock).toBe(true);
  });

  it("scripted and oracle-text aura bonuses stack on the same target", () => {
    // Ethereal Armor's "Enchanted creature gets +1/+1 and has first strike"
    // is the engine's oracle-text Aura path. Twinblade Blessing is the
    // scripted path. The bear is enchanted by both; the bonuses should
    // add to (2, 2) and double-strike + first-strike both land.
    let s = put(
      state,
      p1,
      "bear",
      card("Grizzly Bears", "Creature \u2014 Bear", [2, 2]),
    );
    s = put(s, p1, "armor", {
      ...card("Ethereal Armor", "Enchantment \u2014 Aura"),
      oracle_text:
        "Enchant creature\nEnchanted creature gets +1/+1 and has first strike.",
    } as ScryfallCard);
    s = attachAura(s, id("armor"), id("bear"));
    s = put(
      s,
      p1,
      "blessing",
      card("Twinblade Blessing", "Enchantment \u2014 Aura"),
    );
    s = attachAura(s, id("blessing"), id("bear"));
    s = refreshAuraBonuses(s);
    const host = s.cards.get(id("bear"))!;
    expect(host.auraPT).toEqual({ power: 2, toughness: 2 });
    expect(host.auraKeywords?.sort()).toEqual([
      "double strike",
      "first strike",
    ]);
  });
});

describe("scripted Aura restrictUntap (#2594 #9)", () => {
  // The schema's `AuraStaticSchema.restrictUntap` (#2568) was a
  // forward-compat field; this lane wires the engine path that
  // surfaces it to the enchanted card and consumes it in
  // `processUntapStep`. The model card is Starlight Snare
  // ("Enchanted permanent doesn't untap during your untap step.").
  //
  // The test mirrors the Pacifism / Witness Protection pattern
  // already in `scripted auras (#2568)` (#2568) — attach the aura,
  // refresh, then assert the host picked up `auraRestrictUntap` and
  // the discrete untap step honors it.

  let state: GameState;
  let p1: PlayerId;
  let p2: CardInstanceId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("Starlight Snare surfaces `auraRestrictUntap` and skips the untap step", () => {
    // Set up a bear + the Starlight Snare aura. Tap the bear so the
    // untap step would normally flip it back.
    let s0 = put(
      state,
      p1,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
    );
    s0 = put(s0, p1, "snare", card("Starlight Snare", "Enchantment — Aura"));
    s0 = attachAura(s0, id("snare"), id("bear"));
    s0 = refreshAuraBonuses(s0);
    // Tap the bear so the untap step would ordinarily untap it.
    {
      const cards = new Map(s0.cards);
      cards.set(id("bear"), { ...cards.get(id("bear"))!, isTapped: true });
      s0 = { ...s0, cards };
    }
    const host = s0.cards.get(id("bear"))!;
    expect(host.auraRestrictUntap).toEqual(["Starlight Snare"]);
    expect(host.isTapped).toBe(true);

    // Run the untap step. The bear stays tapped because the
    // `auraRestrictUntap` field is non-empty.
    const result = processUntapStep(s0);
    const after = result.state.cards.get(id("bear"))!;
    expect(after.isTapped).toBe(true);
  });

  it("leaving the battlefield restores the next untap", () => {
    let s0 = put(
      state,
      p1,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
    );
    s0 = put(s0, p1, "snare", card("Starlight Snare", "Enchantment — Aura"));
    s0 = attachAura(s0, id("snare"), id("bear"));
    s0 = refreshAuraBonuses(s0);
    // Tap + run the untap step — bear stays tapped.
    {
      const cards = new Map(s0.cards);
      cards.set(id("bear"), { ...cards.get(id("bear"))!, isTapped: true });
      s0 = { ...s0, cards };
    }
    const blocked = processUntapStep(s0).state.cards.get(id("bear"))!;
    expect(blocked.isTapped).toBe(true);

    // Move the aura to the graveyard (the engine's removeCardFromZone
    // path) and re-refresh.
    {
      const cards = new Map(blocked ? s0.cards : s0.cards);
      // The simplest path: just delete the bear's `auraRestrictUntap`
      // and re-run the refresh, simulating aura-left-play.
      cards.set(id("bear"), { ...cards.get(id("bear"))! });
      const zones = new Map(s0.zones);
      const bf = zones.get(`${p1}-battlefield`)!;
      zones.set(`${p1}-battlefield`, {
        ...bf,
        cardIds: bf.cardIds.filter((c) => c !== id("snare")),
      });
      s0 = { ...s0, cards, zones };
    }
    s0 = refreshAuraBonuses(s0);
    expect(s0.cards.get(id("bear"))!.auraRestrictUntap).toBeUndefined();

    // Re-tap and run the untap step again — the bear untaps now.
    {
      const cards = new Map(s0.cards);
      cards.set(id("bear"), { ...cards.get(id("bear"))!, isTapped: true });
      s0 = { ...s0, cards };
    }
    const unblocked = processUntapStep(s0).state.cards.get(id("bear"))!;
    expect(unblocked.isTapped).toBe(false);
  });

  it("a card with no `auraRestrictUntap` untaps normally", () => {
    // Sanity: the untap step doesn't accidentally skip cards that
    // have nothing to do with the new field.
    let s0 = put(
      state,
      p1,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
    );
    {
      const cards = new Map(s0.cards);
      cards.set(id("bear"), { ...cards.get(id("bear"))!, isTapped: true });
      s0 = { ...s0, cards };
    }
    const result = processUntapStep(s0);
    expect(result.state.cards.get(id("bear"))!.isTapped).toBe(false);
  });

  it("only blocks the enchanted permanent, not other p1 permanents", () => {
    // The aura is attached to p1's bear. A second p1 creature (no
    // aura) on the same battlefield untaps normally — the
    // `auraRestrictUntap` field is per-card, not battlefield-wide.
    let s0 = put(
      state,
      p1,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
    );
    s0 = put(s0, p1, "friend", card("Ally", "Creature — Human", [1, 1]));
    s0 = put(s0, p1, "snare", card("Starlight Snare", "Enchantment — Aura"));
    s0 = attachAura(s0, id("snare"), id("bear"));
    s0 = refreshAuraBonuses(s0);
    // Tap both bear and friend.
    {
      const cards = new Map(s0.cards);
      cards.set(id("bear"), { ...cards.get(id("bear"))!, isTapped: true });
      cards.set(id("friend"), { ...cards.get(id("friend"))!, isTapped: true });
      s0 = { ...s0, cards };
    }
    const result = processUntapStep(s0);
    // The bear (with the aura) stays tapped.
    expect(result.state.cards.get(id("bear"))!.isTapped).toBe(true);
    // The friend (no aura) untaps normally.
    expect(result.state.cards.get(id("friend"))!.isTapped).toBe(false);
  });
});
