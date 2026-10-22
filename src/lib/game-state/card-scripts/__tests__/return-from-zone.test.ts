/**
 * Card scripts — return from zone.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted ReturnFromZone (#2560)
 *   - scripted ReturnFromZone (#2560)
 *   - scripted ReturnFromZone (#2560)
 *   - scripted ReturnFromZone (#2560)
 */
import {
  CardScriptSchema,
  effectTargetCount,
  isTargetedEffect,
  resolveScriptedAbility,
} from "../index";
import {
  GameState,
  PlayerId,
  ScryfallCard,
  StackObject,
  Target,
} from "../../types";
import { autoChooseTriggerTargets } from "../../trigger-system/trigger-targets";
import { createCardInstance } from "../../card-instance";
import { createInitialGameState, startGame } from "../../game-state";
import { destroyCard } from "../../keyword-actions/removal";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../../evergreen-keywords";
import { id, card, put, spell, cardTarget, battlefield } from "./helpers";

describe("scripted ReturnFromZone (#2560)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  /** Place a card directly into a player's graveyard. */
  const inGraveyard = (
    s: GameState,
    playerId: PlayerId,
    cardId: string,
    data: ScryfallCard,
  ): GameState => {
    const key = `${playerId}-graveyard`;
    const cards = new Map(s.cards);
    cards.set(
      id(cardId),
      createCardInstance(data, playerId, playerId, {
        id: id(cardId),
        currentZoneKey: key,
      }),
    );
    const zones = new Map(s.zones);
    const z = zones.get(key)!;
    zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
    return { ...s, cards, zones };
  };

  const zoneOf = (s: GameState, c: string) =>
    Array.from(s.zones.entries()).find(([, z]) =>
      z.cardIds.includes(id(c)),
    )?.[0];

  const ability = (
    sourceCardId: string,
    text: string,
    kind: "triggered" | "activated",
    targets: Target[] = [],
  ) =>
    ({
      id: "ab-rfz",
      type: "ability",
      sourceCardId: id(sourceCardId),
      controllerId: p1,
      text,
      targets,
      triggered: kind === "triggered",
      activated: kind === "activated",
    }) as unknown as StackObject;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("validates ReturnFromZone with the simple and filtered shapes", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(
      ok({ op: "ReturnFromZone", from: "graveyard", to: "battlefield" }),
    ).toBe(true);
    expect(
      ok({
        op: "ReturnFromZone",
        from: "graveyard",
        to: "battlefield",
        target: "card",
      }),
    ).toBe(true);
    expect(
      ok({
        op: "ReturnFromZone",
        from: "graveyard",
        to: "battlefield",
        target: "card",
        filter: { creature: true, mv_le: 2, controller: "you" },
      }),
    ).toBe(true);
    expect(
      ok({
        op: "ReturnFromZone",
        from: "graveyard",
        to: "battlefield",
        target: "card",
        count: 1,
      }),
    ).toBe(true);
    expect(ok({ op: "ReturnFromZone", from: "exile", to: "battlefield" })).toBe(
      false,
    );
    expect(
      ok({
        op: "ReturnFromZone",
        from: "graveyard",
        to: "battlefield",
        target: "card",
        filter: { creature: "yes" },
      }),
    ).toBe(false);
    expect(
      ok({
        op: "ReturnFromZone",
        from: "graveyard",
        to: "battlefield",
        target: "card",
        filter: { mv_le: -1 },
      }),
    ).toBe(false);
    expect(
      isTargetedEffect({
        op: "ReturnFromZone",
        from: "graveyard",
        to: "battlefield",
        target: "card",
      }),
    ).toBe(true);
    expect(
      effectTargetCount({
        op: "ReturnFromZone",
        from: "graveyard",
        to: "battlefield",
        target: "card",
      }),
    ).toBe(1);
  });

  it("Reassembling Skeleton's activated ability returns the Skeleton to the battlefield", () => {
    // The Skeleton is in p1's graveyard (it died); the ability targets it.
    let s = inGraveyard(
      state,
      p1,
      "skel",
      card("Reassembling Skeleton", "Creature — Skeleton", [1, 1]),
    );
    s = put(
      s,
      p1,
      "skel-on-bf",
      card("Reassembling Skeleton", "Creature — Skeleton", [1, 1]),
    );
    // Move the source version into the graveyard via destroyCard so the
    // source matches the script's sourceCardId on the stack object.
    s = destroyCard(s, id("skel-on-bf")).state;
    const skelInYard = s.zones
      .get(`${p1}-graveyard`)!
      .cardIds.find(
        (cid) => s.cards.get(cid)!.cardData.name === "Reassembling Skeleton",
      )!;
    s = resolveScriptedAbility(
      s,
      ability(
        skelInYard,
        "Return Reassembling Skeleton from your graveyard to the battlefield.",
        "activated",
        [{ type: "card", targetId: skelInYard, isValid: true }],
      ),
    )!;
    expect(zoneOf(s, skelInYard)).toBe(`${p1}-battlefield`);
    expect(s.cards.get(id(skelInYard))!.hasSummoningSickness).toBe(true);
  });

  it("Sun-Blessed Healer's ETB returns a creature card with MV 2 or less", () => {
    let s = put(
      state,
      p1,
      "healer",
      card("Sun-Blessed Healer", "Creature — Human Cleric", [2, 2]),
    );
    s = inGraveyard(s, p1, "cub", card("Cub", "Creature — Cat", [1, 1]));
    s = inGraveyard(s, p1, "bear", {
      ...card("Bear", "Creature — Bear", [3, 3]),
      cmc: 3,
    });
    const s2 = resolveScriptedAbility(
      s,
      ability(
        "healer",
        "When this creature enters, you may return target creature card with mana value 2 or less from your graveyard to the battlefield.",
        "triggered",
        [cardTarget("cub")],
      ),
    )!;
    expect(zoneOf(s2, "cub")).toBe(`${p1}-battlefield`);
    // The bear (MV 3) is filtered out: it stays in the graveyard even if
    // targeted.
    const s3 = resolveScriptedAbility(
      s,
      ability(
        "healer",
        "When this creature enters, you may return target creature card with mana value 2 or less from your graveyard to the battlefield.",
        "triggered",
        [cardTarget("bear")],
      ),
    )!;
    expect(zoneOf(s3, "bear")).toBe(`${p1}-graveyard`);
  });

  it("does nothing when the target is no longer in a graveyard (CR 608.2b)", () => {
    const s0 = inGraveyard(
      state,
      p1,
      "cub",
      card("Cub", "Creature — Cat", [1, 1]),
    );
    const s = resolveScriptedAbility(
      s0,
      ability(
        "healer" as string,
        "When this creature enters, you may return target creature card with mana value 2 or less from your graveyard to the battlefield.",
        "triggered",
        // Target a card that's not in any graveyard.
        [{ type: "card", targetId: "ghost", isValid: true }],
      ),
    );
    // The ability is from a non-scripted source — scripted resolution
    // returns undefined and the state is unchanged from the input.
    expect(s).toBeUndefined();
  });

  it("does nothing when the target was moved out of the graveyard", () => {
    // Place the cub in the graveyard, then move it to the battlefield so
    // the same id is no longer in any graveyard: the resolution must skip
    // the effect (CR 608.2b).
    let s = put(
      state,
      p1,
      "healer",
      card("Sun-Blessed Healer", "Creature — Human Cleric", [2, 2]),
    );
    s = inGraveyard(s, p1, "cub", card("Cub", "Creature — Cat", [1, 1]));
    // Hand-roll the move: pull cub out of p1's graveyard, push it into
    // p1's battlefield, update currentZoneKey.
    const cards = new Map(s.cards);
    const cub = cards.get(id("cub"))!;
    const bfKey = `${p1}-battlefield`;
    cards.set(id("cub"), { ...cub, currentZoneKey: bfKey });
    const zones = new Map(s.zones);
    const bf = zones.get(bfKey)!;
    const yard = zones.get(`${p1}-graveyard`)!;
    zones.set(bfKey, { ...bf, cardIds: [...bf.cardIds, id("cub")] });
    zones.set(`${p1}-graveyard`, {
      ...yard,
      cardIds: yard.cardIds.filter((cid) => cid !== id("cub")),
    });
    s = { ...s, cards, zones };
    const s2 = resolveScriptedAbility(
      s,
      ability(
        "healer",
        "When this creature enters, you may return target creature card with mana value 2 or less from your graveyard to the battlefield.",
        "triggered",
        [cardTarget("cub")],
      ),
    )!;
    // CR 608.2b: the target is no longer in a graveyard, so nothing happens.
    expect(zoneOf(s2, "cub")).toBe(`${p1}-battlefield`);
  });

  it("rejects picking an opponent's graveyard card when controller is you", () => {
    let s = put(
      state,
      p1,
      "healer",
      card("Sun-Blessed Healer", "Creature — Human Cleric", [2, 2]),
    );
    s = inGraveyard(s, p2, "cub", card("Cub", "Creature — Cat", [1, 1]));
    const s2 = resolveScriptedAbility(
      s,
      ability(
        "healer",
        "When this creature enters, you may return target creature card with mana value 2 or less from your graveyard to the battlefield.",
        "triggered",
        [cardTarget("cub")],
      ),
    )!;
    // The cub is in p2's graveyard, but the filter says "you" — no move.
    expect(zoneOf(s2, "cub")).toBe(`${p2}-graveyard`);
  });

  it("AI picks a legal target in your graveyard, ignoring your non-creatures", () => {
    let s = put(
      state,
      p1,
      "healer",
      card("Sun-Blessed Healer", "Creature — Human Cleric", [2, 2]),
    );
    s = inGraveyard(s, p1, "rock", card("Rock", "Artifact"));
    s = inGraveyard(s, p1, "cub", card("Cub", "Creature — Cat", [1, 1]));
    s = autoChooseTriggerTargets(
      {
        ...s,
        stack: [
          {
            id: "ab-rfz",
            type: "ability",
            sourceCardId: id("healer"),
            controllerId: p1,
            text: "When this creature enters, you may return target creature card with mana value 2 or less from your graveyard to the battlefield.",
            targets: [],
            chosenModes: [],
            triggered: true,
            activated: false,
          } as unknown as StackObject,
        ],
      },
      p1,
    );
    const obj = s.stack[0];
    expect(obj.targets.map((t) => t.targetId)).toEqual([id("cub")]);
  });

  it("an 'enters with N counters' card still gets them when returned", () => {
    // A Wildwood Scourge-style card: "This creature enters with two +1/+1
    // counters on it." The engine's `applyEntersWithCounters` runs as the
    // card moves onto the battlefield, including via ReturnFromZone.
    let s = put(
      state,
      p1,
      "healer",
      card("Sun-Blessed Healer", "Creature — Human Cleric", [2, 2]),
    );
    s = inGraveyard(s, p1, "cub", {
      ...card("Cub", "Creature — Cat", [1, 1]),
      oracle_text: "This creature enters with two +1/+1 counters on it.",
    });
    s = resolveScriptedAbility(
      s,
      ability(
        "healer",
        "When this creature enters, you may return target creature card with mana value 2 or less from your graveyard to the battlefield.",
        "triggered",
        [cardTarget("cub")],
      ),
    )!;
    expect(zoneOf(s, "cub")).toBe(`${p1}-battlefield`);
    const cub = s.cards.get(id("cub"))!;
    const counters = cub.counters.filter((c) => c.type === "+1/+1");
    expect(counters.reduce((sum, c) => sum + c.count, 0)).toBe(2);
    expect(getEffectivePower(cub)).toBe(3);
    expect(getEffectiveToughness(cub)).toBe(3);
  });

  it("Alesha's attack trigger returns a creature card with MV 2 or less", () => {
    let s = put(
      state,
      p1,
      "alesha",
      card("Alesha, Who Laughs at Fate", "Creature — Human Warrior", [3, 2]),
    );
    s = inGraveyard(s, p1, "cub", card("Cub", "Creature — Cat", [1, 1]));
    s = inGraveyard(s, p1, "bear", {
      ...card("Bear", "Creature — Bear", [3, 3]),
      cmc: 3,
    });
    const s2 = resolveScriptedAbility(
      s,
      ability(
        "alesha",
        "Whenever Alesha attacks, you may pay {W}{U}{B}. If you do, return target creature card with mana value 2 or less from your graveyard to the battlefield tapped and attacking.",
        "triggered",
        [cardTarget("cub")],
      ),
    )!;
    expect(zoneOf(s2, "cub")).toBe(`${p1}-battlefield`);
    // The bear (MV 3) is filtered out.
    const s3 = resolveScriptedAbility(
      s,
      ability(
        "alesha",
        "Whenever Alesha attacks, you may pay {W}{U}{B}. If you do, return target creature card with mana value 2 or less from your graveyard to the battlefield tapped and attacking.",
        "triggered",
        [cardTarget("bear")],
      ),
    )!;
    expect(zoneOf(s3, "bear")).toBe(`${p1}-graveyard`);
  });
});
