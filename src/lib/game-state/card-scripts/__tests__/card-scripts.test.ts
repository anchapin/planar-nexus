/**
 * Card scripts: schema, registry, and resolution (card-scripts epic).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CardScriptSchema,
  getCardScript,
  listScriptedCardNames,
  resolveScriptedSpell,
  resolveScriptedAbility,
  scriptedModeChoiceError,
  scriptedSpellEffects,
} from "../index";
import { parseModes } from "../../oracle-text-parser/modes";
import type { CardScript } from "../schema";
import {
  abilityNeedsModes,
  autoChooseTriggerTargets,
  getLegalSpellTargets,
  chooseAbilityModes,
  chooseTriggerTargets,
  getAbilityModes,
  getLegalTriggerTargets,
  scriptedSpellTargetSpec,
  triggerNeedsTargets,
} from "../../trigger-system/trigger-targets";
import { registerCardScripts } from "../registry";
import { matchesRemovalFilter } from "../target-filters";
import { RAW_CARD_SCRIPTS } from "../cards/index.generated";
import {
  getActivatedAbilities,
  getTriggeredAbilities,
} from "../../abilities/parse";
import { detectLandfallTriggers } from "../../keyword-actions/landfall";
import { refreshScriptedStatics } from "../../keyword-actions/scripted-statics";
import { refreshTribalAnthems } from "../../keyword-actions/tribal-anthem";
import { checkStateBasedActions } from "../../state-based-actions";
import { destroyCard } from "../../keyword-actions/removal";
import { declareAttackers } from "../../combat/declaration";
import { passPriority } from "../../game-state";
import { Phase } from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import { createCardInstance } from "../../card-instance";
import {
  getEffectivePower,
  getEffectiveToughness,
  hasKeyword,
} from "../../evergreen-keywords";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  StackObject,
  Target,
} from "../../types";

const CARDS_DIR = join(__dirname, "..", "cards");
const id = (s: string) => s as CardInstanceId;

function card(name: string, typeLine: string, pt?: [number, number]) {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: pt ? String(pt[0]) : undefined,
    toughness: pt ? String(pt[1]) : undefined,
  } as unknown as ScryfallCard;
}

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  zone: "battlefield" | "library" = "battlefield",
): GameState {
  const key = `${playerId}-${zone}`;
  const cards = new Map(state.cards);
  cards.set(
    id(cardId),
    createCardInstance(data, playerId, playerId, {
      id: id(cardId),
      currentZoneKey: key,
    }),
  );
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

function spell(
  controllerId: PlayerId,
  targets: Target[] = [],
): Pick<StackObject, "controllerId" | "sourceCardId" | "targets"> {
  return { controllerId, sourceCardId: null as never, targets };
}

const cardTarget = (cardId: string): Target => ({
  type: "card",
  targetId: cardId,
  isValid: true,
});
const playerTarget = (playerId: string): Target => ({
  type: "player",
  targetId: playerId,
  isValid: true,
});

const battlefield = (s: GameState, p: PlayerId) =>
  s.zones.get(`${p}-battlefield`)?.cardIds ?? [];

describe("card script files", () => {
  const files = readdirSync(CARDS_DIR).filter((f) => f.endsWith(".json"));

  it.each(files)("%s matches the schema", (file) => {
    const raw = JSON.parse(readFileSync(join(CARDS_DIR, file), "utf8"));
    const parsed = CardScriptSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  it("registers every script file under its card name", () => {
    expect(listScriptedCardNames()).toHaveLength(files.length);
    expect(getCardScript("lightning strike")?.name).toBe("Lightning Strike");
    expect(getCardScript("Not A Real Card")).toBeUndefined();
  });

  it("rejects unknown ops and extra fields", () => {
    const base = { name: "X", oracle: "x" };
    expect(
      CardScriptSchema.safeParse({ ...base, spell: [{ op: "Explode" }] })
        .success,
    ).toBe(false);
    expect(
      CardScriptSchema.safeParse({
        ...base,
        spell: [{ op: "Destroy", target: "creature", extra: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe("resolveScriptedSpell", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("Lightning Strike deals 3 to a player", () => {
    const s = resolveScriptedSpell(
      state,
      getCardScript("Lightning Strike")!,
      spell(p1, [playerTarget(p2)]),
    );
    expect(s.players.get(p2)!.life).toBe(17);
  });

  it("Lightning Strike deals 3 to a creature", () => {
    const s0 = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedSpell(
      s0,
      getCardScript("Lightning Strike")!,
      spell(p1, [cardTarget("bear")]),
    );
    expect(s.cards.get(id("bear"))!.damage).toBe(3);
  });

  it("Fell destroys the target creature", () => {
    const s0 = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedSpell(
      s0,
      getCardScript("Fell")!,
      spell(p1, [cardTarget("bear")]),
    );
    expect(battlefield(s, p2)).not.toContain(id("bear"));
    expect(s.zones.get(`${p2}-graveyard`)!.cardIds).toContain(id("bear"));
  });

  it("Wander Off exiles the target creature", () => {
    const s0 = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedSpell(
      s0,
      getCardScript("Wander Off")!,
      spell(p1, [cardTarget("bear")]),
    );
    expect(battlefield(s, p2)).not.toContain(id("bear"));
    expect(s.zones.get(`${p2}-exile`)!.cardIds).toContain(id("bear"));
  });

  it("does nothing to a target that left the battlefield (CR 608.2b)", () => {
    const s = resolveScriptedSpell(
      state,
      getCardScript("Fell")!,
      spell(p1, [cardTarget("gone")]),
    );
    expect(s).toBe(state);
  });

  it("Dragon Fodder creates two 1/1 red Goblins for the caster", () => {
    const before = battlefield(state, p1).length;
    const s = resolveScriptedSpell(
      state,
      getCardScript("Dragon Fodder")!,
      spell(p1),
    );
    const created = battlefield(s, p1).slice(before);
    expect(created).toHaveLength(2);
    const token = s.cards.get(created[0])!;
    expect(token.cardData.name).toBe("Goblin");
    expect(token.cardData.power).toBe("1");
    expect(token.cardData.colors).toEqual(["red"]);
  });

  it("Giant Growth gives +3/+3 until end of turn", () => {
    const s0 = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedSpell(
      s0,
      getCardScript("Giant Growth")!,
      spell(p1, [cardTarget("bear")]),
    );
    const bear = s.cards.get(id("bear"))!;
    expect(getEffectivePower(bear)).toBe(5);
    expect(getEffectiveToughness(bear)).toBe(5);
  });

  it("Cancel counters the target spell", () => {
    const victim = {
      id: "stack-victim",
      type: "spell",
      sourceCardId: null,
      controllerId: p2,
      name: "Victim",
      text: "",
      manaCost: "",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCopy: false,
      timestamp: 0,
    } as unknown as StackObject;
    const s0 = { ...state, stack: [victim] };
    const s = resolveScriptedSpell(
      s0,
      getCardScript("Cancel")!,
      spell(p1, [{ type: "stack", targetId: "stack-victim", isValid: true }]),
    );
    expect(s.stack.some((o) => o.id === "stack-victim")).toBe(false);
  });
});

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

describe("scripted landfall triggers (#2496)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const TEXT =
    "Landfall — Whenever a land you control enters, you gain 1 life.";

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "terra",
      card("Eumidian Terrabotanist", "Creature — Insect Druid", [2, 3]),
    );
  });

  it("fires for a land you control and resolves from the script", () => {
    const s0 = put(
      state,
      p1,
      "forest",
      card("Forest", "Basic Land — Forest", [0, 0]),
    );
    const triggers = detectLandfallTriggers(s0, id("forest"));
    expect(triggers).toHaveLength(1);
    expect(triggers[0].sourceCardId).toBe(id("terra"));
    expect(triggers[0].effect).toBe(TEXT);
    const s = resolveScriptedAbility(s0, {
      id: "ab-land",
      type: "ability",
      sourceCardId: id("terra"),
      controllerId: p1,
      text: TEXT,
      targets: [],
      triggered: true,
    } as unknown as StackObject)!;
    expect(s.players.get(p1)!.life).toBe(21);
  });

  it("ignores an opponent's land", () => {
    const s0 = put(
      state,
      p2,
      "swamp",
      card("Swamp", "Basic Land — Swamp", [0, 0]),
    );
    expect(detectLandfallTriggers(s0, id("swamp"))).toHaveLength(0);
  });
});

describe("scripted dies, attacks and upkeep triggers (#2496)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const sources = (s: GameState) => s.stack.map((o) => o.sourceCardId);
  const bothPass = (s: GameState) => passPriority(passPriority(s, p1), p2);
  const ready = (s: GameState, cardId: string): GameState => {
    const cards = new Map(s.cards);
    cards.set(id(cardId), {
      ...cards.get(id(cardId))!,
      hasSummoningSickness: false,
    });
    return { ...s, cards };
  };
  const at = (s: GameState, phase: Phase): GameState => ({
    ...s,
    stack: [],
    priorityPlayerId: p1,
    turn: { ...s.turn, activePlayerId: p1, currentPhase: phase },
  });

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("Summit Sentinel's dies trigger resolves from its script after it died", () => {
    state = at(
      put(
        state,
        p1,
        "sentinel",
        card("Summit Sentinel", "Creature — Construct", [2, 1]),
      ),
      Phase.PRECOMBAT_MAIN,
    );
    const [ability] = getTriggeredAbilities(
      state.cards.get(id("sentinel"))!.cardData,
    );
    expect(ability.trigger).toEqual({ event: "dies", subject: "self" });
    const hand = (s: GameState) => s.zones.get(`${p1}-hand`)!.cardIds.length;
    const died = destroyCard(state, id("sentinel")).state;
    expect(sources(died)).toEqual([id("sentinel")]);
    expect(hand(bothPass(died))).toBe(hand(died) + 1);
  });

  it("Sanguine Syphoner drains only when it attacks, from its script", () => {
    state = put(
      state,
      p1,
      "syphoner",
      card("Sanguine Syphoner", "Creature — Vampire Warlock", [1, 3]),
    );
    state = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    state = at(
      ready(ready(state, "syphoner"), "bear"),
      Phase.DECLARE_ATTACKERS,
    );
    const bearOnly = declareAttackers(state, [
      { cardId: id("bear"), defenderId: p2 },
    ]).state;
    expect(sources(bearOnly)).toEqual([]);
    const both = declareAttackers(state, [
      { cardId: id("syphoner"), defenderId: p2 },
      { cardId: id("bear"), defenderId: p2 },
    ]).state;
    expect(sources(both)).toEqual([id("syphoner")]);
    const resolved = bothPass(both);
    expect(resolved.players.get(p2)!.life).toBe(19);
    expect(resolved.players.get(p1)!.life).toBe(21);
  });

  it("validates subject, controller, once and whose", () => {
    const trig = (extra: object) =>
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "X",
        triggers: [
          { text: "X", effects: [{ op: "Draw", amount: 1 }], ...extra },
        ],
      }).success;
    expect(trig({ event: "dies", subject: "another", controller: "you" })).toBe(
      true,
    );
    expect(
      trig({ event: "attacks", subject: "any", controller: "you", once: true }),
    ).toBe(true);
    expect(trig({ event: "upkeep", whose: "each" })).toBe(true);
    expect(trig({ event: "dies", whose: "each" })).toBe(false);
    expect(trig({ event: "upkeep", once: true })).toBe(false);
    expect(trig({ event: "dies", subject: "self", controller: "you" })).toBe(
      false,
    );
  });
});

describe("scripted keyword, artifact and multicolor tokens (#2496)", () => {
  let state: GameState;
  let p1: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(state.players.keys());
  });

  const etb = (cardId: string, text: string) =>
    ({
      id: "ab-1",
      type: "ability",
      sourceCardId: id(cardId),
      controllerId: p1,
      text,
      targets: [],
      triggered: true,
      activated: false,
    }) as unknown as StackObject;

  const createdBy = (
    name: string,
    typeLine: string,
    text: string,
  ): CardInstance => {
    const s0 = put(state, p1, "src", card(name, typeLine, [1, 1]));
    const before = battlefield(s0, p1).length;
    const s = resolveScriptedAbility(s0, etb("src", text))!;
    const created = battlefield(s, p1).slice(before);
    expect(created).toHaveLength(1);
    return s.cards.get(created[0])!;
  };

  it("Nimble Thopterist makes a colorless Thopter artifact with flying", () => {
    const thopter = createdBy(
      "Nimble Thopterist",
      "Creature — Vedalken Artificer",
      "When this creature enters, create a 1/1 colorless Thopter artifact creature token with flying.",
    );
    expect(thopter.cardData.type_line).toBe(
      "Token Artifact Creature — Thopter",
    );
    expect(thopter.cardData.colors).toEqual([]);
    expect(hasKeyword(thopter, "flying")).toBe(true);
  });

  it("Eager Glyphmage makes a white and black Inkling with flying", () => {
    const inkling = createdBy(
      "Eager Glyphmage",
      "Creature — Cat Cleric",
      "When this creature enters, create a 1/1 white and black Inkling creature token with flying.",
    );
    expect(inkling.cardData.colors).toEqual(["white", "black"]);
    expect(inkling.cardData.type_line).toBe("Token Creature — Inkling");
    expect(hasKeyword(inkling, "flying")).toBe(true);
  });

  it("plain tokens still get no keywords", () => {
    const goblin = createdBy(
      "Elder Auntie",
      "Creature — Goblin Warlock",
      "When this creature enters, create a 1/1 black and red Goblin creature token.",
    );
    expect(goblin.cardData.colors).toEqual(["black", "red"]);
    expect(hasKeyword(goblin, "flying")).toBe(false);
    expect(goblin.cardData.oracle_text).toBe("");
  });

  it("requires exactly one of color or colors", () => {
    const base = {
      op: "CreateToken",
      count: 1,
      power: 1,
      toughness: 1,
      subtypes: ["Inkling"],
    };
    const parse = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "X", spell: [effect] })
        .success;
    expect(parse({ ...base, color: "white" })).toBe(true);
    expect(parse({ ...base, colors: ["white", "black"] })).toBe(true);
    expect(parse(base)).toBe(false);
    expect(parse({ ...base, color: "white", colors: ["white", "black"] })).toBe(
      false,
    );
    expect(parse({ ...base, colors: ["white"] })).toBe(false);
    expect(parse({ ...base, color: "white", keywords: ["shroud"] })).toBe(
      false,
    );
  });
});

describe("scripted static abilities (#2496)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  const pt = (s: GameState, cardId: string) => {
    const c = s.cards.get(id(cardId))!;
    return [getEffectivePower(c), getEffectiveToughness(c)];
  };

  it("Anthem of Champions pumps your creatures, not the opponent's", () => {
    let s = put(
      state,
      p1,
      "anthem",
      card("Anthem of Champions", "Enchantment"),
    );
    s = put(s, p1, "bear", card("Grizzly Bears", "Creature — Bear", [2, 2]));
    s = put(s, p2, "foe", card("Grizzly Bears", "Creature — Bear", [2, 2]));
    s = refreshScriptedStatics(s);
    expect(pt(s, "bear")).toEqual([3, 3]);
    expect(pt(s, "foe")).toEqual([2, 2]);
  });

  it("Regal Imperiosaur pumps other Dinosaurs once, not itself", () => {
    let s = put(
      state,
      p1,
      "rex",
      card("Regal Imperiosaur", "Creature — Dinosaur", [2, 2]),
    );
    s = put(s, p1, "dino", card("Raptor", "Creature — Dinosaur", [2, 1]));
    s = put(s, p1, "bear", card("Grizzly Bears", "Creature — Bear", [2, 2]));
    // The oracle-text lord path must not also apply it.
    s = refreshScriptedStatics(refreshTribalAnthems(s));
    expect(pt(s, "dino")).toEqual([3, 2]);
    expect(pt(s, "rex")).toEqual([2, 2]);
    expect(pt(s, "bear")).toEqual([2, 2]);
  });

  it("Samut gives creatures you control haste, itself included", () => {
    let s = put(
      state,
      p1,
      "samut",
      card(
        "Samut, Hazoret's Champion",
        "Legendary Creature — Human Warrior Cleric",
        [2, 2],
      ),
    );
    s = put(s, p1, "bear", card("Grizzly Bears", "Creature — Bear", [2, 2]));
    s = put(s, p2, "foe", card("Grizzly Bears", "Creature — Bear", [2, 2]));
    // The grant line alone is not Samut's own haste.
    expect(hasKeyword(s.cards.get(id("samut"))!, "haste")).toBe(false);
    s = refreshScriptedStatics(s);
    expect(hasKeyword(s.cards.get(id("samut"))!, "haste")).toBe(true);
    expect(hasKeyword(s.cards.get(id("bear"))!, "haste")).toBe(true);
    expect(hasKeyword(s.cards.get(id("foe"))!, "haste")).toBe(false);
  });

  it("the bonus ends when the source leaves the battlefield", () => {
    let s = put(
      state,
      p1,
      "anthem",
      card("Anthem of Champions", "Enchantment"),
    );
    s = put(s, p1, "bear", card("Grizzly Bears", "Creature — Bear", [2, 2]));
    s = checkStateBasedActions(s).state;
    expect(pt(s, "bear")).toEqual([3, 3]);
    s = checkStateBasedActions(destroyCard(s, id("anthem")).state).state;
    expect(pt(s, "bear")).toEqual([2, 2]);
  });

  it("validates statics", () => {
    const parse = (stat: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "X", statics: [stat] })
        .success;
    const affects = { controller: "you" };
    expect(parse({ text: "t", affects, power: 1, toughness: 1 })).toBe(true);
    expect(parse({ text: "t", affects, keywords: ["haste"] })).toBe(true);
    expect(parse({ text: "t", affects })).toBe(false);
    expect(parse({ text: "t", affects, power: 1 })).toBe(false);
    expect(
      parse({ text: "t", affects: { controller: "all" }, keywords: ["haste"] }),
    ).toBe(false);
  });
});

describe("scripted modal spells (#2523)", () => {
  const COUNTER = "Counter target spell.";
  const DRAW = "Surveil 2, then draw two cards.";
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  const victim = (controllerId: PlayerId) =>
    ({
      id: "stack-victim",
      type: "spell",
      sourceCardId: null,
      controllerId,
      name: "Victim",
      text: "",
      manaCost: "",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCopy: false,
      timestamp: 0,
    }) as unknown as StackObject;
  const stackTarget: Target = {
    type: "stack",
    targetId: "stack-victim",
    isValid: true,
  };

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("every modal script matches its card's printed modes", () => {
    // The bundled index drops oracle text, so read the source JSON.
    const dir = join(__dirname, "..", "cards");
    const modal = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as CardScript)
      .filter((s) => s.modes);
    expect(modal.length).toBeGreaterThanOrEqual(2);
    for (const s of modal) {
      const printed = parseModes(s.oracle);
      expect(printed).not.toBeNull();
      expect(s.modes!.choose).toBe(printed!.modeCount);
      const key = (t: string) =>
        t
          .replace(/\([^)]*\)/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      expect(s.modes!.options.map((o) => key(o.text))).toEqual(
        printed!.modes.map(key),
      );
    }
  });

  it("Spellgyre's counter mode counters the target spell", () => {
    const s = resolveScriptedSpell(
      { ...state, stack: [victim(p2)] },
      getCardScript("Spellgyre")!,
      { ...spell(p1, [stackTarget]), chosenModes: [COUNTER] },
    );
    expect(s.stack.some((o) => o.id === "stack-victim")).toBe(false);
  });

  it("resolves only the chosen mode, matched without reminder text", () => {
    const script = getCardScript("Spellgyre")!;
    const withReminder = `${DRAW} (To surveil 2, look at the top two cards.)`;
    expect(
      scriptedSpellEffects(script, [withReminder]).map((e) => e.op),
    ).toEqual(["Surveil", "Draw"]);
    expect(scriptedSpellEffects(script, [COUNTER]).map((e) => e.op)).toEqual([
      "Counter",
    ]);
    // School Daze's draw mode leaves a spell on the stack alone.
    const s = resolveScriptedSpell(
      { ...state, stack: [victim(p2)] },
      getCardScript("School Daze")!,
      {
        ...spell(p1, [stackTarget]),
        chosenModes: ["Do Homework — Draw three cards."],
      },
    );
    expect(s.stack.some((o) => o.id === "stack-victim")).toBe(true);
  });

  it("does nothing with no mode chosen", () => {
    const s0 = { ...state, stack: [victim(p2)] };
    const s = resolveScriptedSpell(s0, getCardScript("Spellgyre")!, {
      ...spell(p1, [stackTarget]),
      chosenModes: [],
    });
    expect(s).toBe(s0);
  });

  it("targets follow the chosen mode", () => {
    expect(scriptedSpellTargetSpec("Spellgyre", [DRAW])).toBeNull();
    expect(scriptedSpellTargetSpec("Spellgyre", [COUNTER])).toBeNull();
  });

  it("accepts only exactly `choose` distinct modes of its own", () => {
    const script = getCardScript("Spellgyre")!;
    expect(scriptedModeChoiceError(script, [COUNTER])).toBeNull();
    expect(scriptedModeChoiceError(script, [])).toMatch(/choose exactly 1/);
    expect(scriptedModeChoiceError(script, [COUNTER, DRAW])).not.toBeNull();
    expect(
      scriptedModeChoiceError(script, ["Destroy target creature."]),
    ).not.toBeNull();
    expect(scriptedModeChoiceError(getCardScript("Cancel")!, [])).toBeNull();
  });

  it("validates modes", () => {
    const base = { name: "X", oracle: "x" };
    const opt = (text: string) => ({
      text,
      effects: [{ op: "Draw", amount: 1 }],
    });
    const ok = { choose: 1, options: [opt("a"), opt("b")] };
    expect(CardScriptSchema.safeParse({ ...base, modes: ok }).success).toBe(
      true,
    );
    for (const bad of [
      { ...base, modes: { ...ok, choose: 2 } },
      { ...base, modes: { choose: 1, options: [opt("a"), opt("A")] } },
      { ...base, modes: ok, spell: [{ op: "Draw", amount: 1 }] },
      {
        ...base,
        modes: ok,
        statics: [
          { text: "s", affects: { controller: "you" }, power: 1, toughness: 1 },
        ],
      },
    ]) {
      expect(CardScriptSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("scripted modal triggered and activated abilities (#2525)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  const ETB = "When this creature enters, choose one —";
  const DAMAGE = "This creature deals 3 damage to target creature.";
  const LIFE = "You gain 4 life.";
  const DRAW = "Draw a card.";
  const DESTROY = "Destroy target creature.";
  // A made-up card, so the test doesn't depend on which real cards are scripted.
  const fixture = {
    name: "Test Modal Beast",
    oracle: `${ETB}\n• ${DAMAGE}\n• ${LIFE}\n{2}, Sacrifice this creature: Choose one —\n• ${DRAW}\n• ${DESTROY}`,
    triggers: [
      {
        text: ETB,
        event: "etb",
        modes: {
          choose: 1,
          options: [
            {
              text: DAMAGE,
              effects: [{ op: "DealDamage", amount: 3, target: "creature" }],
            },
            {
              text: LIFE,
              effects: [{ op: "GainLife", amount: 4, who: "you" }],
            },
          ],
        },
      },
    ],
    activated: [
      {
        text: "Choose one —",
        cost: { mana: "{2}", sacrifice: true },
        modes: {
          choose: 1,
          options: [
            { text: DRAW, effects: [{ op: "Draw", amount: 1, who: "you" }] },
            { text: DESTROY, effects: [{ op: "Destroy", target: "creature" }] },
          ],
        },
      },
    ],
  };

  beforeAll(() => registerCardScripts([...RAW_CARD_SCRIPTS, fixture]));
  afterAll(() => registerCardScripts(RAW_CARD_SCRIPTS));

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "beast",
      card("Test Modal Beast", "Creature — Beast", [4, 4]),
    );
  });

  const onStack = (s: GameState, kind: "triggered" | "activated") => {
    const obj = {
      id: "modal-1",
      type: "ability",
      sourceCardId: id("beast"),
      controllerId: p1,
      name: "Test Modal Beast ability",
      text: kind === "triggered" ? ETB : "Choose one —",
      manaCost: null,
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: 0,
      triggered: kind === "triggered",
      activated: kind === "activated",
    } as unknown as StackObject;
    return { ...s, stack: [...s.stack, obj] };
  };
  const top = (s: GameState) => s.stack[s.stack.length - 1];

  it("validates modes on abilities: effects or modes, exactly one", () => {
    expect(CardScriptSchema.safeParse(fixture).success).toBe(true);
    const trigger = fixture.triggers[0];
    const bad = (t: object) =>
      CardScriptSchema.safeParse({ ...fixture, triggers: [t] }).success;
    expect(bad({ ...trigger, effects: [{ op: "Draw", amount: 1 }] })).toBe(
      false,
    );
    const { modes: _modes, ...noModes } = trigger;
    expect(bad(noModes)).toBe(false);
  });

  it("asks for modes before targets, then targets what the chosen mode targets", () => {
    state = put(
      state,
      p2,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
    );
    let s = onStack(state, "triggered");
    expect(abilityNeedsModes(s, top(s))).toBe(true);
    expect(getAbilityModes(s, top(s))).toEqual({
      choose: 1,
      options: [DAMAGE, LIFE],
    });
    expect(triggerNeedsTargets(top(s), s)).toBe(false);

    expect(chooseAbilityModes(s, "modal-1", ["Not a mode."]).success).toBe(
      false,
    );
    expect(chooseAbilityModes(s, "modal-1", [DAMAGE, LIFE]).success).toBe(
      false,
    );
    const chosen = chooseAbilityModes(s, "modal-1", [DAMAGE]);
    expect(chosen.success).toBe(true);
    s = chosen.state;
    expect(abilityNeedsModes(s, top(s))).toBe(false);
    expect(triggerNeedsTargets(top(s), s)).toBe(true);
    const legal = getLegalTriggerTargets(s, top(s));
    expect(legal).toEqual(expect.arrayContaining(["beast", "bear"]));
    expect(legal).not.toContain(p2);

    s = chooseTriggerTargets(s, "modal-1", ["bear"]).state;
    s = resolveScriptedAbility(s, top(s))!;
    expect(s.cards.get(id("bear"))!.damage).toBe(3);
    expect(s.players.get(p1)!.life).toBe(20);
  });

  it("resolves only the chosen mode, and nothing when none was chosen", () => {
    let s = onStack(state, "triggered");
    expect(resolveScriptedAbility(s, top(s))!.players.get(p1)!.life).toBe(20);
    s = chooseAbilityModes(s, "modal-1", [LIFE]).state;
    expect(triggerNeedsTargets(top(s), s)).toBe(false);
    expect(resolveScriptedAbility(s, top(s))!.players.get(p1)!.life).toBe(24);
  });

  it("lets the AI pick the mode and target that kill an opposing creature", () => {
    state = put(
      state,
      p2,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
    );
    const s = autoChooseTriggerTargets(onStack(state, "triggered"), p1);
    expect(top(s).chosenModes).toEqual([DAMAGE]);
    expect(top(s).targets.map((t) => t.targetId)).toEqual(["bear"]);
  });

  it("lets the AI gain life when only its own creatures could be hit", () => {
    const s = autoChooseTriggerTargets(onStack(state, "triggered"), p1);
    expect(top(s).chosenModes).toEqual([LIFE]);
    expect(top(s).targets).toEqual([]);
  });

  it("gives a modal activated ability the same mode choice", () => {
    let s = onStack(state, "activated");
    expect(abilityNeedsModes(s, top(s))).toBe(true);
    s = chooseAbilityModes(s, "modal-1", [DRAW]).state;
    const handBefore = s.zones.get(`${p1}-hand`)!.cardIds.length;
    s = resolveScriptedAbility(s, top(s))!;
    expect(s.zones.get(`${p1}-hand`)!.cardIds.length).toBe(handBefore + 1);
  });
});

describe("destroy and exile target filters (#2528)", () => {
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
  });

  const matching = (filter: Parameters<typeof matchesRemovalFilter>[1]) =>
    ["bear", "giant", "rock", "aura", "golem", "forest"].filter((c) =>
      matchesRemovalFilter(state.cards.get(id(c))!, filter),
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
    ]);
    expect(matching({ target: "creature", min_power: 4 })).toEqual(["giant"]);
    expect(matching({ target: "creature", max_power: 3 })).toEqual([
      "bear",
      "golem",
    ]);
    expect(matching({ target: "artifact", min_power: 3 })).toEqual(["golem"]);
  });

  it("accepts the new targets and rejects unknown ones", () => {
    const base = { name: "X", oracle: "x" };
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ ...base, spell: [effect] }).success;
    expect(ok({ op: "Destroy", target: "artifact_or_enchantment" })).toBe(true);
    expect(ok({ op: "Exile", target: "nonland_permanent" })).toBe(true);
    expect(ok({ op: "Destroy", target: "creature", min_power: 4 })).toBe(true);
    expect(ok({ op: "Destroy", target: "land" })).toBe(false);
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
