/**
 * Card scripts — treasures and sagas.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - Magda, the Hoardmaster: crimes make Treasures, three make a Dragon (#2614)
 *   - Esper Origins // Summon: Esper Maduin: flashback into a Saga (#2614)
 *   - Raise the Past: count:
 */
import { CardScript } from "../schema";
import {
  CardScriptSchema,
  getCardScript,
  isTargetedEffect,
  resolveScriptedSpell,
} from "../index";
import {
  GameState,
  PlayerId,
  ScryfallCard,
  StackObject,
  Target,
} from "../../types";
import { Phase } from "../../types";
import { activateAbility, canActivateAbility } from "../../abilities/activated";
import {
  addLoreCounters,
  addPrecombatMainLoreCounters,
} from "../../keyword-actions/saga";
import { checkStateBasedActions } from "../../state-based-actions";
import { createInitialGameState, startGame } from "../../game-state";
import { destroyCard } from "../../keyword-actions/removal";
import { fireTargetedTriggers } from "../../keyword-actions/targeted";
import { getEffectivePower } from "../../evergreen-keywords";
import { hasKeyword } from "../../evergreen-keywords";
import {
  id,
  card,
  put,
  spell,
  cardTarget,
  playerTarget,
  battlefield,
} from "./helpers";
import { resolveScriptedEffects } from "../interpret";
import { resolveTopOfStack } from "../../spell-casting/resolve";

describe("Magda, the Hoardmaster: crimes make Treasures, three make a Dragon (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const targeting = (controllerId: PlayerId, targets: Target[]) => ({
    controllerId,
    targets,
  });
  const magdaTriggers = (s: GameState) =>
    s.stack.filter((o) => o.sourceCardId === id("magda"));
  const treasures = (s: GameState) =>
    s.zones
      .get(`${p1}-battlefield`)!
      .cardIds.map((cid) => s.cards.get(cid)!)
      .filter((c) => c.cardData.name === "Treasure");
  const makeTreasures = (s: GameState, count: number) =>
    resolveScriptedSpell(
      s,
      {
        name: "X",
        oracle: "x",
        spell: [{ op: "CreatePredefinedToken", token: "treasure", count }],
      } as CardScript,
      spell(p1),
    );

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "magda",
      card(
        "Magda, the Hoardmaster",
        "Legendary Creature — Dwarf Berserker",
        [2, 2],
      ),
    );
    state = put(
      state,
      p1,
      "mine",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
    );
    state = put(
      state,
      p2,
      "theirs",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
    );
  });

  it("targeting an opponent's creature is a crime, once each turn", () => {
    const s = fireTargetedTriggers(
      state,
      targeting(p1, [cardTarget(id("theirs"))]),
    );
    expect(magdaTriggers(s)).toHaveLength(1);
    const again = fireTargetedTriggers(s, targeting(p1, [playerTarget(p2)]));
    expect(magdaTriggers(again)).toHaveLength(1);
  });

  it("targeting an opponent is a crime; targeting your own things isn't", () => {
    expect(
      magdaTriggers(
        fireTargetedTriggers(state, targeting(p1, [playerTarget(p2)])),
      ),
    ).toHaveLength(1);
    expect(
      magdaTriggers(
        fireTargetedTriggers(
          state,
          targeting(p1, [cardTarget(id("mine")), playerTarget(p1)]),
        ),
      ),
    ).toHaveLength(0);
  });

  it("an opponent's crime doesn't trigger Magda", () => {
    expect(
      magdaTriggers(
        fireTargetedTriggers(state, targeting(p2, [playerTarget(p1)])),
      ),
    ).toHaveLength(0);
  });

  it("can't activate with fewer than three Treasures", () => {
    const s = makeTreasures(state, 2);
    const r = canActivateAbility(s, p1, id("magda"), 0);
    expect(r.canActivate).toBe(false);
  });

  it("sacrifices three Treasures, tapped ones first", () => {
    let s = makeTreasures(state, 4);
    const [first] = treasures(s);
    const cards = new Map(s.cards);
    cards.set(first.id, { ...first, isTapped: true });
    s = {
      ...s,
      cards,
      turn: {
        ...s.turn,
        activePlayerId: p1,
        currentPhase: Phase.PRECOMBAT_MAIN,
      },
      priorityPlayerId: p1,
    };
    const r = activateAbility(s, p1, id("magda"), 0);
    expect(r.error).toBeUndefined();
    expect(r.success).toBe(true);
    const left = treasures(r.state);
    expect(left).toHaveLength(1);
    expect(left[0].id).not.toBe(first.id);
  });
});

describe("Esper Origins // Summon: Esper Maduin: flashback into a Saga (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  const NAME = "Esper Origins // Summon: Esper Maduin";
  const esper = () =>
    ({
      ...card(NAME, "Sorcery // Enchantment Creature — Saga Elemental"),
      layout: "transform",
      card_faces: [
        {
          name: "Esper Origins",
          type_line: "Sorcery",
          mana_cost: "{1}{G}",
          oracle_text: "",
        },
        {
          name: "Summon: Esper Maduin",
          type_line: "Enchantment Creature — Saga Elemental",
          mana_cost: "",
          oracle_text: "",
          power: "4",
          toughness: "4",
        },
      ],
    }) as unknown as ScryfallCard;
  const onStack = (s: GameState, alt: string[]): GameState => {
    s = put(s, p1, "esper", esper(), "hand");
    const zones = new Map(s.zones);
    const hand = zones.get(`${p1}-hand`)!;
    zones.set(`${p1}-hand`, {
      ...hand,
      cardIds: hand.cardIds.filter((c) => c !== id("esper")),
    });
    const stack = zones.get("stack")!;
    zones.set("stack", { ...stack, cardIds: [...stack.cardIds, id("esper")] });
    const so = {
      id: "so-esper",
      type: "spell",
      sourceCardId: id("esper"),
      controllerId: p1,
      name: NAME,
      text: "",
      manaCost: "{3}{G}",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: 1,
      alternativeCostsUsed: alt,
    } as unknown as StackObject;
    return { ...s, zones, stack: [...s.stack, so] };
  };
  const zoneOf = (s: GameState, cid: string) =>
    [...s.zones.entries()].find(([, z]) => z.cardIds.includes(id(cid)))?.[0];
  const lore = (s: GameState) =>
    s.cards.get(id("esper"))!.counters.find((c) => c.type === "lore")?.count ??
    0;
  const chapterEffects = (n: number) =>
    getCardScript("Summon: Esper Maduin")!.triggers!.find(
      (t) => t.chapter === n,
    )!.effects!;
  const runChapter = (s: GameState, n: number) =>
    resolveScriptedEffects(s, chapterEffects(n), {
      controllerId: p1,
      sourceCardId: id("esper"),
      targets: [],
    } as unknown as StackObject);
  const flashbackOntoBattlefield = (): GameState => {
    const s = onStack(state, ["flashback"]);
    const script = getCardScript(NAME)!;
    return resolveScriptedEffects(
      s,
      script.spell!.filter((e) => e.op === "ReturnTransformed"),
      s.stack[s.stack.length - 1],
    );
  };

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(state.players.keys());
  });

  it("validates chapter triggers and the new ops", () => {
    const trig = (t: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", triggers: [t] })
        .success;
    const effects = [{ op: "AddMana", amount: 1, colors: ["G"] }];
    expect(trig({ text: "I", event: "chapter", chapter: 1, effects })).toBe(
      true,
    );
    expect(trig({ text: "I", event: "chapter", effects })).toBe(false);
    expect(trig({ text: "I", event: "etb", chapter: 1, effects })).toBe(false);
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(ok({ op: "RevealTopToHand", filter: "permanent" })).toBe(true);
    expect(ok({ op: "ReturnTransformed", if_cast_from: "hand" })).toBe(false);
  });

  it("cast from hand: gains 2 life and stays a spell", () => {
    const s = onStack(state, []);
    const life = s.players.get(p1)!.life;
    const after = resolveScriptedEffects(
      s,
      getCardScript(NAME)!.spell!.filter((e) => e.op !== "Surveil"),
      s.stack[s.stack.length - 1],
    );
    expect(after.players.get(p1)!.life).toBe(life + 2);
    expect(zoneOf(after, "esper")).toBe("stack");
  });

  it("cast with flashback: enters transformed with finality and lore counters", () => {
    const s = flashbackOntoBattlefield();
    const c = s.cards.get(id("esper"))!;
    expect(zoneOf(s, "esper")).toBe(`${p1}-battlefield`);
    expect(c.cardData.name).toBe("Summon: Esper Maduin");
    expect(c.counters.find((x) => x.type === "finality")?.count).toBe(1);
    expect(lore(s)).toBe(1);
    expect(
      s.stack.some(
        (o) => o.sourceCardId === id("esper") && o.id !== "so-esper",
      ),
    ).toBe(true);
  });

  it("finishing resolution leaves the Saga on the battlefield", () => {
    let s = flashbackOntoBattlefield();
    s = { ...s, stack: s.stack.filter((o) => o.id === "so-esper") };
    s = resolveTopOfStack(s);
    expect(zoneOf(s, "esper")).toBe(`${p1}-battlefield`);
    expect(s.stack.some((o) => o.id === "so-esper")).toBe(false);
  });

  it("chapter I puts a revealed permanent card into hand, not a spell", () => {
    let s = put(
      state,
      p1,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
      "library",
    );
    s = runChapter(s, 1);
    expect(zoneOf(s, "bear")).toBe(`${p1}-hand`);
    s = put(s, p1, "bolt", card("Lightning Bolt", "Instant"), "library");
    s = runChapter(s, 1);
    expect(zoneOf(s, "bolt")).toBe(`${p1}-library`);
  });

  it("the second lore counter triggers chapter II, which adds {G}{G}", () => {
    let s = flashbackOntoBattlefield();
    const before = s.stack.length;
    s = addLoreCounters(s, id("esper"));
    expect(lore(s)).toBe(2);
    expect(s.stack.length).toBe(before + 1);
    s = runChapter(s, 2);
    expect(s.players.get(p1)!.manaPool.green).toBe(2);
  });

  it("chapter III pumps other creatures you control with trample", () => {
    let s = flashbackOntoBattlefield();
    s = put(s, p1, "bear", card("Grizzly Bears", "Creature — Bear", [2, 2]));
    s = runChapter(s, 3);
    const bear = s.cards.get(id("bear"))!;
    expect(getEffectivePower(bear)).toBe(4);
    expect(hasKeyword(bear, "trample")).toBe(true);
    expect(getEffectivePower(s.cards.get(id("esper"))!)).toBe(4);
  });

  it("adds lore after the draw step, then exiles the finished Saga (finality)", () => {
    let s = flashbackOntoBattlefield();
    s = { ...s, stack: [] };
    s = addPrecombatMainLoreCounters(s, p1);
    s = addPrecombatMainLoreCounters({ ...s, stack: [] }, p1);
    expect(lore(s)).toBe(3);
    s = checkStateBasedActions(s).state;
    expect(zoneOf(s, "esper")).toBe(`${p1}-battlefield`);
    s = checkStateBasedActions({ ...s, stack: [] }).state;
    expect(zoneOf(s, "esper")).toMatch(/exile$/);
  });

  it("a creature with a finality counter is exiled instead of dying", () => {
    let s = put(
      state,
      p1,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
    );
    const cards = new Map(s.cards);
    cards.set(id("bear"), {
      ...cards.get(id("bear"))!,
      counters: [{ type: "finality", count: 1 }],
    });
    s = destroyCard({ ...s, cards }, id("bear")).state;
    expect(zoneOf(s, "bear")).toMatch(/exile$/);
  });
});

describe('Raise the Past: count:"all" graveyard sweep (#2594 lane 27)', () => {
  it('validates count:"all" in ReturnFromZone schema', () => {
    const parsed = CardScriptSchema.safeParse({
      name: "Raise the Past",
      oracle:
        "Return all creature cards with mana value 2 or less from your graveyard to the battlefield.",
      spell: [
        {
          op: "ReturnFromZone",
          from: "graveyard",
          to: "battlefield",
          filter: { creature: true, mv_le: 2 },
          count: "all",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('count:"all" is not a targeted effect (script-guards gate)', () => {
    const parsed = CardScriptSchema.parse({
      name: "Raise the Past",
      oracle: "x",
      spell: [
        {
          op: "ReturnFromZone",
          from: "graveyard",
          to: "battlefield",
          filter: { creature: true },
          count: "all",
        },
      ],
    });
    const effect = parsed.spell![0];
    expect(isTargetedEffect(effect)).toBe(false);
  });

  it("count (numeric) is still a targeted effect (regression — preserves lane 20 semantics)", () => {
    const parsed = CardScriptSchema.parse({
      name: "Test",
      oracle: "x",
      spell: [
        {
          op: "ReturnFromZone",
          from: "graveyard",
          to: "battlefield",
          filter: { creature: true },
          count: 2,
          target: "card",
        },
      ],
    });
    const effect = parsed.spell![0];
    expect(isTargetedEffect(effect)).toBe(true);
  });

  it('count:"all" returns every matching creature on resolution', () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    // Put 3 creatures in p1's graveyard (all MV ≤ 2): a Grizzly Bears,
    // a Skyhunter Skirmisher, and an Elvish Warrior (all MV 2).
    state = put(
      state,
      p1,
      "g1",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
      "graveyard",
    );
    state = put(
      state,
      p1,
      "g2",
      card("Skyhunter Skirmisher", "Creature — Cat", [2, 2]),
      "graveyard",
    );
    state = put(
      state,
      p1,
      "g3",
      card("Elvish Warrior", "Creature — Elf", [2, 2]),
      "graveyard",
    );
    const beforeBattlefield =
      state.zones.get(`${p1}-battlefield`)?.cardIds.length ?? 0;
    const beforeYard = state.zones.get(`${p1}-graveyard`)?.cardIds.length ?? 0;

    const after = resolveScriptedEffects(
      state,
      [
        {
          op: "ReturnFromZone",
          from: "graveyard",
          to: "battlefield",
          filter: { creature: true, mv_le: 2 },
          count: "all",
        },
      ] as never,
      {
        controllerId: p1,
        sourceCardId: null as never,
        targets: [],
      } as unknown as StackObject,
    );

    expect(after.zones.get(`${p1}-battlefield`)?.cardIds.length).toBe(
      beforeBattlefield + 3,
    );
    expect(after.zones.get(`${p1}-graveyard`)?.cardIds.length).toBe(
      beforeYard - 3,
    );
  });
});
