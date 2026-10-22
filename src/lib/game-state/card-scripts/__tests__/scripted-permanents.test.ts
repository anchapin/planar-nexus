/**
 * Card scripts — scripted permanents.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted permanents (#2490)
 */
import {
  GameState,
  PlayerId,
  ScryfallCard,
  StackObject,
  Target,
} from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import {
  getActivatedAbilities,
  getTriggeredAbilities,
} from "../../abilities/parse";
import {
  getCardScript,
  listScriptedCardNames,
  resolveScriptedAbility,
} from "../index";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../../evergreen-keywords";
import { id, card, put, cardTarget, battlefield } from "./helpers";

describe("scripted permanents (#2490)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  const ability = (
    sourceCardId: string,
    text: string,
    kind: "triggered" | "activated",
    targets: Target[] = [],
  ) =>
    ({
      id: "ab-1",
      type: "ability",
      sourceCardId: id(sourceCardId),
      controllerId: p1,
      text,
      targets,
      triggered: kind === "triggered",
      activated: kind === "activated",
    }) as unknown as StackObject;

  const permanentScripts = () =>
    listScriptedCardNames()
      .map((n) => getCardScript(n)!)
      .filter((s) => s.triggers || s.activated);

  it("scripts at least 20 Standard permanents", () => {
    expect(permanentScripts().length).toBeGreaterThanOrEqual(20);
  });

  it("takes a scripted permanent's abilities from its script, not oracle text", () => {
    const helpful = {
      ...card("Helpful Hunter", "Creature — Cat", [1, 1]),
      oracle_text: "When this creature enters, draw a card.",
    } as ScryfallCard;
    const triggers = getTriggeredAbilities(helpful);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].effect).toBe("When this creature enters, draw a card.");
    expect(getActivatedAbilities(helpful)).toEqual([]);

    const shivan = {
      ...card("Shivan Dragon", "Creature — Dragon", [5, 5]),
      oracle_text: "Flying\n{R}: This creature gets +1/+0 until end of turn.",
    } as ScryfallCard;
    const activated = getActivatedAbilities(shivan);
    expect(activated).toHaveLength(1);
    expect(activated[0].costs.tap).toBe(false);
    expect(getTriggeredAbilities(shivan)).toEqual([]);
  });

  it("Vampire Spawn's ETB drains each opponent for 2", () => {
    const s0 = put(
      state,
      p1,
      "spawn",
      card("Vampire Spawn", "Creature — Vampire", [2, 3]),
    );
    const s = resolveScriptedAbility(
      s0,
      ability(
        "spawn",
        "When this creature enters, each opponent loses 2 life and you gain 2 life.",
        "triggered",
      ),
    )!;
    expect(s.players.get(p2)!.life).toBe(18);
    expect(s.players.get(p1)!.life).toBe(22);
  });

  it("Guarded Heir's ETB creates two 3/3 white Knights", () => {
    const s0 = put(
      state,
      p1,
      "heir",
      card("Guarded Heir", "Creature — Human Noble", [1, 1]),
    );
    const before = battlefield(s0, p1).length;
    const s = resolveScriptedAbility(
      s0,
      ability(
        "heir",
        "When this creature enters, create two 3/3 white Knight creature tokens.",
        "triggered",
      ),
    )!;
    const created = battlefield(s, p1).slice(before);
    expect(created).toHaveLength(2);
    expect(s.cards.get(created[0])!.cardData.power).toBe("3");
  });

  it("Ironpaw Aspirant's ETB puts a +1/+1 counter on the target", () => {
    let s0 = put(
      state,
      p1,
      "aspirant",
      card("Ironpaw Aspirant", "Creature — Cat Warrior", [1, 2]),
    );
    s0 = put(s0, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedAbility(
      s0,
      ability(
        "aspirant",
        "When this creature enters, put a +1/+1 counter on target creature.",
        "triggered",
        [cardTarget("bear")],
      ),
    )!;
    expect(getEffectivePower(s.cards.get(id("bear"))!)).toBe(3);
    expect(getEffectiveToughness(s.cards.get(id("bear"))!)).toBe(3);
  });

  it("Shivan Dragon's firebreathing pumps itself", () => {
    const s0 = put(
      state,
      p1,
      "shivan",
      card("Shivan Dragon", "Creature — Dragon", [5, 5]),
    );
    const s = resolveScriptedAbility(
      s0,
      ability(
        "shivan",
        "This creature gets +1/+0 until end of turn.",
        "activated",
      ),
    )!;
    expect(getEffectivePower(s.cards.get(id("shivan"))!)).toBe(6);
    expect(getEffectiveToughness(s.cards.get(id("shivan"))!)).toBe(5);
  });

  it("Engine Rat's ability makes each opponent lose 2", () => {
    const s0 = put(
      state,
      p1,
      "rat",
      card("Engine Rat", "Creature — Zombie Rat", [1, 1]),
    );
    const s = resolveScriptedAbility(
      s0,
      ability("rat", "Each opponent loses 2 life.", "activated"),
    )!;
    expect(s.players.get(p2)!.life).toBe(18);
    expect(s.players.get(p1)!.life).toBe(20);
  });

  it("leaves unscripted sources to the oracle-text path", () => {
    const s0 = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    expect(
      resolveScriptedAbility(s0, ability("bear", "Draw a card.", "activated")),
    ).toBeUndefined();
  });
});
