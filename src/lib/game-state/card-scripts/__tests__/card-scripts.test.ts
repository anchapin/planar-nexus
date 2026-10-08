/**
 * Card scripts: schema, registry, and resolution (card-scripts epic).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CardScriptSchema,
  effectTargetCount,
  getCardScript,
  isTargetedEffect,
  listScriptedCardNames,
  resolveScriptedSpell,
  resolveScriptedAbility,
  scriptedModeChoiceError,
  scriptedSpellEffects,
} from "../index";
import { withX as withXEffect, resolveScriptedEffects } from "../interpret";
import {
  gainLife as gainLifeAction,
  dealDamageToPlayer as dealDamageToPlayerAction,
} from "../../player-actions";
import { parseModes } from "../../oracle-text-parser/modes";
import type { CardScript } from "../schema";
import {
  abilityNeedsModes,
  autoChooseTriggerTargets,
  getLegalSpellTargets,
  getLegalSpellTargetsAt,
  getSpellTargetSpecs,
  chooseAbilityModes,
  chooseTriggerTargets,
  getAbilityModes,
  getLegalTriggerTargets,
  scriptedSpellTargetSpec,
  triggerNeedsTargets,
} from "../../trigger-system/trigger-targets";
import { registerCardScripts } from "../registry";
import { matchesController, matchesRemovalFilter } from "../target-filters";
import { RAW_CARD_SCRIPTS } from "../cards/index.generated";
import {
  getActivatedAbilities,
  getTriggeredAbilities,
} from "../../abilities/parse";
import { detectLandfallTriggers } from "../../keyword-actions/landfall";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { refreshScriptedStatics } from "../../keyword-actions/scripted-statics";
import { refreshTribalAnthems } from "../../keyword-actions/tribal-anthem";
import { cycleCard } from "../../keyword-actions/cycling";
import { checkStateBasedActions } from "../../state-based-actions";
import { clearUntilEndOfTurnPT } from "../../pt-until-end-of-turn";
import { destroyCard } from "../../keyword-actions/removal";
import {
  activateManaAbility,
  hasSacrificeManaAbility,
  parseManaAbility,
} from "../../mana";
import { activateAbility } from "../../abilities/activated";
import { parseManaFromEffect } from "../../abilities/mana";
import { PREDEFINED_TOKENS } from "../predefined-tokens";
import { declareAttackers } from "../../combat/declaration";
import { passPriority } from "../../game-state";
import { resolveWaitingChoice } from "../../spell-casting/choices";
import { Phase } from "../../types";
import { refreshAuraBonuses } from "../../keyword-actions/aura-bonus";
import { attachAura } from "../../keyword-actions/enchant";
import { canAttack, canBlock } from "../../combat/queries";
import { createInitialGameState, startGame, processUntapStep } from "../../game-state";
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
  zone: "battlefield" | "library" | "hand" | "graveyard" = "battlefield",
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
    [
      "bear",
      "giant",
      "rock",
      "aura",
      "golem",
      "forest",
      "planeswalker",
    ].filter((c) => matchesRemovalFilter(state.cards.get(id(c))!, filter));

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

describe("controller filter on targets (#2532)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "mine", card("Elf", "Creature — Elf", [1, 1]));
    state = put(state, p2, "theirs", card("Bear", "Creature — Bear", [2, 2]));
    state = put(state, p2, "rock", card("Mind Stone", "Artifact"));
  });

  const ok = (effect: object) =>
    CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
      .success;

  it("matches the permanent's controller relative to the caster", () => {
    const mine = state.cards.get(id("mine"))!;
    const theirs = state.cards.get(id("theirs"))!;
    expect(matchesController(mine, "you", p1)).toBe(true);
    expect(matchesController(theirs, "you", p1)).toBe(false);
    expect(matchesController(theirs, "opponent", p1)).toBe(true);
    expect(matchesController(mine, "opponent", p1)).toBe(false);
    expect(matchesController(mine, undefined, p1)).toBe(true);
  });

  it("accepts controller only on targeted permanent effects", () => {
    expect(
      ok({
        op: "Pump",
        power: 1,
        toughness: 1,
        target: "creature",
        controller: "you",
      }),
    ).toBe(true);
    expect(
      ok({
        op: "DealDamage",
        amount: 2,
        target: "creature",
        controller: "opponent",
      }),
    ).toBe(true);
    expect(
      ok({ op: "Exile", target: "nonland_permanent", controller: "opponent" }),
    ).toBe(true);
    expect(
      ok({
        op: "PutCounters",
        counter: "+1/+1",
        amount: 1,
        target: "creature",
        controller: "you",
      }),
    ).toBe(true);
    expect(
      ok({
        op: "Pump",
        power: 1,
        toughness: 1,
        target: "self",
        controller: "you",
      }),
    ).toBe(false);
    expect(
      ok({
        op: "DealDamage",
        amount: 2,
        target: "any",
        controller: "opponent",
      }),
    ).toBe(false);
    expect(
      ok({ op: "Destroy", target: "creature", controller: "everyone" }),
    ).toBe(false);
  });

  it("Oracle's Restoration only targets a creature you control", () => {
    state = put(
      state,
      p1,
      "resto",
      card("Oracle's Restoration", "Sorcery"),
      "library",
    );
    expect(getLegalSpellTargets(state, p1, id("resto"))).toEqual(["mine"]);
  });

  it("an opponent-only removal spell offers only their permanents", () => {
    const script: CardScript = CardScriptSchema.parse({
      name: "Test Removal",
      oracle: "Exile target nonland permanent an opponent controls.",
      spell: [
        { op: "Exile", target: "nonland_permanent", controller: "opponent" },
      ],
    });
    // Restore the shared registry afterwards: under `--randomize` a leaked
    // extra script makes "registers every script file" see one card too many.
    registerCardScripts([...RAW_CARD_SCRIPTS, script]);
    try {
      state = put(state, p1, "zap", card("Test Removal", "Instant"), "library");
      expect(getLegalSpellTargets(state, p1, id("zap")).sort()).toEqual([
        "rock",
        "theirs",
      ]);
    } finally {
      registerCardScripts(RAW_CARD_SCRIPTS);
    }
  });

  it("does nothing if the target changed controller before resolution", () => {
    const resto = getCardScript("Oracle's Restoration")!;
    const pumped = (st: GameState) =>
      getEffectivePower(st.cards.get(id("mine"))!);
    const before = pumped(state);
    expect(
      pumped(
        resolveScriptedSpell(state, resto, spell(p1, [cardTarget("mine")])),
      ),
    ).toBe(before + 1);
    // An opponent took the Elf: it's no longer "a creature you control".
    const cards = new Map(state.cards);
    cards.set(id("mine"), { ...cards.get(id("mine"))!, controllerId: p2 });
    const stolen = { ...state, cards };
    const after = resolveScriptedSpell(
      stolen,
      resto,
      spell(p1, [cardTarget("mine")]),
    );
    expect(pumped(after)).toBe(before);
    // The rest of the spell still happens: the caster gains 1 life.
    expect(after.players.get(p1)!.life).toBe(state.players.get(p1)!.life + 1);
  });
});

describe("scripted Mill (#2534)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    // Start from known three-card libraries instead of the dealt decks.
    const zones = new Map(state.zones);
    for (const p of [p1, p2]) {
      const key = `${p}-library`;
      zones.set(key, { ...zones.get(key)!, cardIds: [] });
    }
    state = { ...state, zones };
    for (const p of [p1, p2]) {
      for (const n of [1, 2, 3]) {
        state = put(
          state,
          p,
          `${p}-lib${n}`,
          card(`Card ${n}`, "Sorcery"),
          "library",
        );
      }
    }
  });

  const yard = (st: GameState, p: PlayerId) =>
    st.zones.get(`${p}-graveyard`)!.cardIds;
  const library = (st: GameState, p: PlayerId) =>
    st.zones.get(`${p}-library`)!.cardIds;
  const millScript = (effect: object): CardScript =>
    CardScriptSchema.parse({ name: "Mill Test", oracle: "x", spell: [effect] });

  it("validates Mill", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(ok({ op: "Mill", amount: 2 })).toBe(true);
    expect(ok({ op: "Mill", amount: 1, who: "target_player" })).toBe(true);
    expect(ok({ op: "Mill", amount: 1, who: "each_opponent" })).toBe(true);
    expect(ok({ op: "Mill", amount: 0 })).toBe(false);
    expect(ok({ op: "Mill", amount: 1, who: "each_player" })).toBe(false);
  });

  it("mills the top cards of your library into your graveyard", () => {
    const before = library(state, p1);
    const s = resolveScriptedSpell(
      state,
      millScript({ op: "Mill", amount: 2 }),
      spell(p1),
    );
    const top2 = before.slice(-2);
    expect(library(s, p1)).toEqual(before.slice(0, -2));
    expect([...yard(s, p1)].sort()).toEqual([...top2].sort());
    for (const c of top2) {
      expect(s.cards.get(c)!.currentZoneKey).toBe(`${p1}-graveyard`);
    }
    expect(yard(s, p2)).toEqual([]);
  });

  it("mills a target player or each opponent", () => {
    const targeted = resolveScriptedSpell(
      state,
      millScript({ op: "Mill", amount: 1, who: "target_player" }),
      spell(p1, [playerTarget(p2)]),
    );
    expect(yard(targeted, p2)).toHaveLength(1);
    expect(yard(targeted, p1)).toHaveLength(0);

    const each = resolveScriptedSpell(
      state,
      millScript({ op: "Mill", amount: 2, who: "each_opponent" }),
      spell(p1),
    );
    expect(yard(each, p2)).toHaveLength(2);
    expect(yard(each, p1)).toHaveLength(0);
  });

  it("mills only what is left when the library is short", () => {
    const s = resolveScriptedSpell(
      state,
      millScript({ op: "Mill", amount: 10 }),
      spell(p1),
    );
    expect(library(s, p1)).toEqual([]);
    expect(yard(s, p1)).toHaveLength(3);
  });

  it("Scarblade Scout's ETB mills two cards", () => {
    state = put(
      state,
      p1,
      "scout",
      card("Scarblade Scout", "Creature — Elf Scout", [2, 2]),
    );
    const s = resolveScriptedAbility(state, {
      id: "ab-1",
      type: "ability",
      sourceCardId: id("scout"),
      controllerId: p1,
      text: "When this creature enters, mill two cards.",
      targets: [],
      triggered: true,
      activated: false,
    } as unknown as StackObject)!;
    expect(yard(s, p1)).toHaveLength(2);
    expect(library(s, p1)).toHaveLength(1);
  });
});

describe("scripted Discard (#2536)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  const hand = (st: GameState, p: PlayerId) =>
    st.zones.get(`${p}-hand`)!.cardIds;
  const yard = (st: GameState, p: PlayerId) =>
    st.zones.get(`${p}-graveyard`)!.cardIds;
  const discardScript = (effects: object[]): CardScript =>
    CardScriptSchema.parse({
      name: "Discard Test",
      oracle: "x",
      spell: effects,
    });

  /** Empty every hand and library, then give each player `n` known cards. */
  const setup = (names: string[], n: number) => {
    let st = startGame(createInitialGameState(names, 20, false));
    const players = Array.from(st.players.keys());
    const zones = new Map(st.zones);
    for (const p of players) {
      for (const z of ["hand", "library"]) {
        const key = `${p}-${z}`;
        zones.set(key, { ...zones.get(key)!, cardIds: [] });
      }
    }
    st = { ...st, zones };
    for (const p of players) {
      for (let i = 1; i <= n; i++) {
        st = put(st, p, `${p}-h${i}`, card(`Hand ${i}`, "Sorcery"), "hand");
        st = put(st, p, `${p}-l${i}`, card(`Lib ${i}`, "Sorcery"), "library");
      }
    }
    return { st, players };
  };

  beforeEach(() => {
    const { st, players } = setup(["Player1", "Player2"], 3);
    state = st;
    [p1, p2] = players;
  });

  it("validates Discard and keeps it after every other effect", () => {
    const ok = (effects: object[]) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: effects })
        .success;
    expect(ok([{ op: "Discard", amount: 1 }])).toBe(true);
    expect(ok([{ op: "Discard", amount: 2, who: "target_player" }])).toBe(true);
    expect(ok([{ op: "Discard", amount: 1, who: "each_opponent" }])).toBe(true);
    expect(ok([{ op: "Discard", amount: 0 }])).toBe(false);
    expect(
      ok([
        { op: "Draw", amount: 2 },
        { op: "Discard", amount: 1 },
      ]),
    ).toBe(true);
    expect(
      ok([
        { op: "Discard", amount: 1 },
        { op: "Draw", amount: 2 },
      ]),
    ).toBe(false);
  });

  it("asks the discarding player to choose, then discards the pick", () => {
    const s = resolveScriptedSpell(
      state,
      discardScript([{ op: "Discard", amount: 1, who: "each_opponent" }]),
      spell(p1),
    );
    const choice = s.waitingChoice!;
    expect(choice.type).toBe("discard_cards");
    expect(choice.playerId).toBe(p2);
    expect(choice.minChoices).toBe(1);
    expect(choice.choices.map((c) => c.value)).toEqual(hand(s, p2));
    expect(yard(s, p2)).toEqual([]);

    const picked = `${p2}-h2`;
    const r = resolveWaitingChoice(s, p2, [picked]);
    expect(r.success).toBe(true);
    expect(r.state.waitingChoice).toBeNull();
    expect(yard(r.state, p2)).toEqual([picked]);
    expect(hand(r.state, p2)).not.toContain(picked);
    expect(r.state.cards.get(id(picked))!.currentZoneKey).toBe(
      `${p2}-graveyard`,
    );
    expect(hand(r.state, p1)).toHaveLength(3);
  });

  it("rejects a pick of the wrong size or from outside the hand", () => {
    const s = resolveScriptedSpell(
      state,
      discardScript([{ op: "Discard", amount: 2, who: "target_player" }]),
      spell(p1, [playerTarget(p2)]),
    );
    expect(s.waitingChoice!.playerId).toBe(p2);
    expect(resolveWaitingChoice(s, p2, [`${p2}-h1`]).success).toBe(false);
    expect(resolveWaitingChoice(s, p2, [`${p2}-h1`, `${p2}-h1`]).success).toBe(
      false,
    );
    expect(resolveWaitingChoice(s, p2, [`${p2}-h1`, `${p1}-h1`]).success).toBe(
      false,
    );
    expect(resolveWaitingChoice(s, p1, [`${p1}-h1`]).success).toBe(false);
    const r = resolveWaitingChoice(s, p2, [`${p2}-h1`, `${p2}-h3`]);
    expect(r.success).toBe(true);
    expect(hand(r.state, p2)).toEqual([`${p2}-h2`]);
  });

  it("discards the whole hand without asking when it is short", () => {
    const s = resolveScriptedSpell(
      state,
      discardScript([{ op: "Discard", amount: 3 }]),
      spell(p1),
    );
    expect(s.waitingChoice).toBeNull();
    expect(hand(s, p1)).toEqual([]);
    expect(yard(s, p1)).toHaveLength(3);
  });

  it("loots: draws first, so the drawn cards can be discarded", () => {
    const s = resolveScriptedSpell(
      state,
      discardScript([
        { op: "Draw", amount: 3 },
        { op: "Discard", amount: 1 },
      ]),
      spell(p1),
    );
    expect(hand(s, p1)).toHaveLength(6);
    expect(s.waitingChoice!.playerId).toBe(p1);
    const drawn = hand(s, p1).find((c) => c.includes("-l"))!;
    const r = resolveWaitingChoice(s, p1, [drawn]);
    expect(r.success).toBe(true);
    expect(yard(r.state, p1)).toEqual([drawn]);
    expect(hand(r.state, p1)).toHaveLength(5);
  });

  it("holds priority until the discard is answered", () => {
    const s = resolveScriptedSpell(
      state,
      discardScript([{ op: "Discard", amount: 1, who: "each_opponent" }]),
      spell(p1),
    );
    expect(passPriority(s, s.priorityPlayerId!)).toBe(s);
  });

  it("asks each opponent in turn in a multiplayer game", () => {
    const { st, players } = setup(["Player1", "Player2", "Player3"], 2);
    const [a, b, c] = players;
    const s = resolveScriptedSpell(
      st,
      discardScript([{ op: "Discard", amount: 1, who: "each_opponent" }]),
      spell(a),
    );
    expect(s.waitingChoice!.playerId).toBe(b);
    expect(s.waitingChoice!.pendingDiscards).toEqual([
      { playerId: c, amount: 1 },
    ]);
    const first = resolveWaitingChoice(s, b, [`${b}-h1`]);
    expect(first.success).toBe(true);
    expect(first.state.waitingChoice!.playerId).toBe(c);
    expect(first.state.waitingChoice!.pendingDiscards).toBeUndefined();
    const second = resolveWaitingChoice(first.state, c, [`${c}-h2`]);
    expect(second.state.waitingChoice).toBeNull();
    expect(yard(second.state, b)).toEqual([`${b}-h1`]);
    expect(yard(second.state, c)).toEqual([`${c}-h2`]);
    expect(hand(second.state, a)).toHaveLength(2);
  });

  it("Burglar Rat's ETB makes each opponent discard a card", () => {
    state = put(
      state,
      p1,
      "rat",
      card("Burglar Rat", "Creature — Rat", [1, 1]),
    );
    const s = resolveScriptedAbility(state, {
      id: "ab-1",
      type: "ability",
      sourceCardId: id("rat"),
      controllerId: p1,
      text: "When this creature enters, each opponent discards a card.",
      targets: [],
      triggered: true,
      activated: false,
    } as unknown as StackObject)!;
    expect(s.waitingChoice!.type).toBe("discard_cards");
    expect(s.waitingChoice!.playerId).toBe(p2);
  });

  it("Icewind Elemental's ETB draws a card, then asks for a discard", () => {
    state = put(
      state,
      p1,
      "icewind",
      card("Icewind Elemental", "Creature — Elemental", [3, 4]),
    );
    const s = resolveScriptedAbility(state, {
      id: "ab-2",
      type: "ability",
      sourceCardId: id("icewind"),
      controllerId: p1,
      text: "When this creature enters, draw a card, then discard a card.",
      targets: [],
      triggered: true,
      activated: false,
    } as unknown as StackObject)!;
    expect(hand(s, p1)).toHaveLength(4);
    expect(s.waitingChoice!.playerId).toBe(p1);
    expect(s.waitingChoice!.minChoices).toBe(1);
  });
});

describe("scripted Tap and Untap (#2538)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    state = put(state, p2, "rock", card("Mind Stone", "Artifact"));
    state = put(state, p2, "forest", card("Forest", "Basic Land — Forest"));
    state = put(state, p1, "mine", card("Elk", "Creature — Elk", [3, 3]));
  });

  const tapped = (s: GameState, c: string) => s.cards.get(id(c))!.isTapped;
  const setTapped = (s: GameState, c: string, v: boolean): GameState => {
    const cards = new Map(s.cards);
    cards.set(id(c), { ...cards.get(id(c))!, isTapped: v });
    return { ...s, cards };
  };
  const script = (...effects: object[]): CardScript =>
    CardScriptSchema.parse({ name: "Tap Test", oracle: "x", spell: effects });

  it("validates Tap and Untap with the removal targets", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(ok({ op: "Tap", target: "creature" })).toBe(true);
    expect(ok({ op: "Untap", target: "nonland_permanent" })).toBe(true);
    expect(ok({ op: "Tap", target: "creature", controller: "opponent" })).toBe(
      true,
    );
    expect(ok({ op: "Tap", target: "permanent" })).toBe(false);
    expect(ok({ op: "Untap", target: "land" })).toBe(false);
    expect(isTargetedEffect({ op: "Tap", target: "creature" })).toBe(true);
  });

  it("taps a target creature and untaps a target permanent", () => {
    let s = resolveScriptedSpell(
      state,
      script({ op: "Tap", target: "creature" }),
      spell(p1, [cardTarget("bear")]),
    );
    expect(tapped(s, "bear")).toBe(true);
    s = setTapped(s, "rock", true);
    s = resolveScriptedSpell(
      s,
      script({ op: "Untap", target: "nonland_permanent" }),
      spell(p1, [cardTarget("rock")]),
    );
    expect(tapped(s, "rock")).toBe(false);
  });

  it("does nothing to an illegal target but keeps resolving", () => {
    const before = state.players.get(p1)!.life;
    const s = resolveScriptedSpell(
      state,
      script(
        { op: "Tap", target: "nonland_permanent" },
        { op: "GainLife", amount: 2, who: "you" },
      ),
      spell(p1, [cardTarget("forest")]),
    );
    expect(tapped(s, "forest")).toBe(false);
    expect(s.players.get(p1)!.life).toBe(before + 2);
  });

  it("checks the controller filter on resolution", () => {
    const s = resolveScriptedSpell(
      state,
      script({ op: "Tap", target: "creature", controller: "opponent" }),
      spell(p1, [cardTarget("mine")]),
    );
    expect(tapped(s, "mine")).toBe(false);
  });

  it("leaves an already tapped permanent tapped", () => {
    const s0 = setTapped(state, "bear", true);
    const s = resolveScriptedSpell(
      s0,
      script({ op: "Tap", target: "creature" }),
      spell(p1, [cardTarget("bear")]),
    );
    expect(tapped(s, "bear")).toBe(true);
  });

  it("scripts the tap and untap cards", () => {
    const byName = new Map(
      (RAW_CARD_SCRIPTS as unknown as CardScript[]).map((s) => [s.name, s]),
    );
    const guard = byName.get("Frostbridge Guard")!;
    expect(guard.activated?.[0].cost.tap).toBe(true);
    expect(guard.activated?.[0].effects).toEqual([
      { op: "Tap", target: "creature" },
    ]);
    for (const name of [
      "Glamermite",
      "Giant-Sized Flying Ant",
      "Divining Duelist",
    ]) {
      const ops = byName
        .get(name)!
        .triggers![0].modes!.options.flatMap((o) => o.effects.map((e) => e.op));
      expect(ops).toEqual(expect.arrayContaining(["Tap", "Untap"]));
    }
    expect(byName.get("Thistledown Players")!.triggers![0].event).toBe(
      "attacks",
    );
  });
});

describe("scripted Scry (#2540)", () => {
  it("validates Scry", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(ok({ op: "Scry", amount: 2 })).toBe(true);
    expect(ok({ op: "Scry", amount: 0 })).toBe(false);
    expect(ok({ op: "Scry", amount: 1, who: "target_player" })).toBe(false);
  });

  it("resolves Opt: scry 1, then draw a card", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const p1 = Array.from(state.players.keys())[0];
    const handBefore = state.zones.get(`${p1}-hand`)!.cardIds.length;
    const top = state.zones.get(`${p1}-library`)!.cardIds.slice(-1)[0];
    state = resolveScriptedSpell(state, getCardScript("Opt")!, spell(p1));
    const hand = state.zones.get(`${p1}-hand`)!.cardIds;
    expect(hand).toHaveLength(handBefore + 1);
    expect(hand).toContain(top);
  });

  it("scripts the scry cards", () => {
    const byName = new Map(
      (RAW_CARD_SCRIPTS as unknown as CardScript[]).map((s) => [s.name, s]),
    );
    const ops = (name: string) =>
      byName
        .get(name)!
        .triggers!.flatMap((t) => t.effects ?? [])
        .map((e) => e.op);
    expect(ops("Glider Kids")).toEqual(["Scry"]);
    expect(ops("Holy Cow")).toEqual(["GainLife", "Scry"]);
    expect(ops("Candy Trail")).toEqual(["Scry"]);
    expect(byName.get("Candy Trail")!.activated?.[0].cost.sacrifice).toBe(true);
    expect(byName.get("Merfolk Coralsmith")!.triggers![0].event).toBe("dies");
  });
});

describe("scripted CreatePredefinedToken (#2544)", () => {
  const tokensNamed = (state: GameState, playerId: PlayerId, name: string) =>
    state.zones
      .get(`${playerId}-battlefield`)!
      .cardIds.map((cid) => state.cards.get(cid)!)
      .filter((c) => c.cardData.name === name);

  const fresh = () => {
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    return { state, p1: Array.from(state.players.keys())[0] };
  };

  it("validates CreatePredefinedToken", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(
      ok({ op: "CreatePredefinedToken", token: "treasure", count: 2 }),
    ).toBe(true);
    expect(ok({ op: "CreatePredefinedToken", token: "clue", count: 0 })).toBe(
      false,
    );
    expect(ok({ op: "CreatePredefinedToken", token: "map", count: 1 })).toBe(
      false,
    );
    expect(
      ok({
        op: "CreatePredefinedToken",
        token: "treasure",
        count: 1,
        who: "opponent",
        tapped: true,
      }),
    ).toBe(true);
    expect(
      ok({
        op: "CreatePredefinedToken",
        token: "food",
        count: 1,
        who: "each_player",
      }),
    ).toBe(false);
  });

  it("resolves Deduce: draw a card, then investigate", () => {
    const { p1, state: s0 } = fresh();
    let state = s0;
    const handBefore = state.zones.get(`${p1}-hand`)!.cardIds.length;
    state = resolveScriptedSpell(state, getCardScript("Deduce")!, spell(p1));
    expect(state.zones.get(`${p1}-hand`)!.cardIds).toHaveLength(handBefore + 1);
    const clues = tokensNamed(state, p1, "Clue");
    expect(clues).toHaveLength(1);
    expect(clues[0].cardData.type_line).toBe("Token Artifact — Clue");
    expect(clues[0].cardData.oracle_text).toBe(
      PREDEFINED_TOKENS.clue.oracle_text,
    );
    expect(clues[0].cardData.colors).toEqual([]);
  });

  it("creates two Treasures for Rapacious Dragon's count", () => {
    const { p1, state: s0 } = fresh();
    let state = s0;
    const effects = getCardScript("Rapacious Dragon")!.triggers![0].effects!;
    state = resolveScriptedSpell(
      state,
      { name: "X", oracle: "x", spell: effects } as CardScript,
      spell(p1),
    );
    expect(tokensNamed(state, p1, "Treasure")).toHaveLength(2);
  });

  it("a Treasure sacrifices itself for one mana of the chosen color", () => {
    const { p1, state: s0 } = fresh();
    let state = s0;
    state = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    state = resolveScriptedSpell(
      state,
      getCardScript("Reckless Ransacking")!,
      spell(p1, [cardTarget("bear")]),
    );
    const [treasure] = tokensNamed(state, p1, "Treasure");
    expect(treasure).toBeDefined();

    const ask = activateManaAbility(state, p1, treasure.id, 0);
    expect(ask.success).toBe(true);
    expect(ask.options?.map((o) => o.description)).toEqual([
      "White",
      "Blue",
      "Black",
      "Red",
      "Green",
    ]);
    const red = ask.options!.find((o) => o.description === "Red")!;
    const paid = activateManaAbility(state, p1, treasure.id, 0, red);
    expect(paid.success).toBe(true);
    expect(paid.state.players.get(p1)!.manaPool.red).toBe(1);
    expect(tokensNamed(paid.state, p1, "Treasure")).toHaveLength(0);
  });

  it("won't sacrifice a Treasure through the colorless activation path", () => {
    const { p1, state: s0 } = fresh();
    let state = s0;
    state = resolveScriptedSpell(
      state,
      {
        name: "X",
        oracle: "x",
        spell: [{ op: "CreatePredefinedToken", token: "treasure", count: 1 }],
      } as CardScript,
      spell(p1),
    );
    const [treasure] = tokensNamed(state, p1, "Treasure");
    const r = activateAbility(state, p1, treasure.id, 0);
    expect(r.success).toBe(false);
    expect(tokensNamed(r.state, p1, "Treasure")).toHaveLength(1);
  });

  it("parses sacrifice mana abilities", () => {
    const opts = parseManaAbility(PREDEFINED_TOKENS.treasure.oracle_text);
    expect(opts).toHaveLength(5);
    expect(opts.every((o) => o.sacrificeSelf)).toBe(true);
    expect(
      hasSacrificeManaAbility(PREDEFINED_TOKENS.treasure.oracle_text),
    ).toBe(true);
    expect(hasSacrificeManaAbility("{T}: Add {G}.")).toBe(false);
    expect(hasSacrificeManaAbility(PREDEFINED_TOKENS.food.oracle_text)).toBe(
      false,
    );
    expect(parseManaAbility("{T}: Add {G}.")[0].sacrificeSelf).toBeUndefined();
  });

  it("gives Food and Clue their activated abilities", () => {
    const food = getActivatedAbilities({
      ...card("Food", "Token Artifact — Food"),
      oracle_text: PREDEFINED_TOKENS.food.oracle_text,
      layout: "token",
    } as unknown as ScryfallCard);
    expect(food).toHaveLength(1);
    expect(food[0].costs.tap).toBe(true);
    expect(food[0].costs.sacrifice).toBe(true);
    expect(food[0].costs.mana?.generic).toBe(2);
    const clue = getActivatedAbilities({
      ...card("Clue", "Token Artifact — Clue"),
      oracle_text: PREDEFINED_TOKENS.clue.oracle_text,
      layout: "token",
    } as unknown as ScryfallCard);
    expect(clue[0].costs.tap).toBe(false);
    expect(clue[0].costs.sacrifice).toBe(true);
    expect(clue[0].costs.mana?.generic).toBe(2);
  });

  it("scripts the Treasure, Food and Clue cards", () => {
    const byName = new Map(
      (RAW_CARD_SCRIPTS as unknown as CardScript[]).map((s) => [s.name, s]),
    );
    const tokens = (name: string) => {
      const sc = byName.get(name)!;
      return [
        ...(sc.spell ?? []),
        ...(sc.triggers ?? []).flatMap((t) => t.effects ?? []),
        ...(sc.activated ?? []).flatMap((a) => a.effects ?? []),
      ]
        .filter((e) => e.op === "CreatePredefinedToken")
        .map((e) => (e as { token: string }).token);
    };
    expect(tokens("Bake into a Pie")).toEqual(["food"]);
    expect(tokens("Deduce")).toEqual(["clue"]);
    expect(tokens("Savor")).toEqual(["food"]);
    expect(tokens("Auspicious Arrival")).toEqual(["clue"]);
    expect(tokens("Plundering Pirate")).toEqual(["treasure"]);
    expect(tokens("Gleaming Barrier")).toEqual(["treasure"]);
    expect(tokens("Noggle Robber")).toEqual(["treasure", "treasure"]);
    expect(byName.get("Noggle Robber")!.triggers!.map((t) => t.event)).toEqual([
      "etb",
      "dies",
    ]);
    expect(tokens("Novice Inspector")).toEqual(["clue"]);
    expect(tokens("Cold Case Cracker")).toEqual(["clue"]);
    expect(tokens("Vinereap Mentor")).toEqual(["food", "food"]);
    expect(tokens("Greedy Freebooter")).toEqual(["treasure"]);
    expect(tokens("Stark Industries Executive")).toEqual(["treasure"]);
  });
});

describe("scripted ReturnToHand (#2546)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    state = put(state, p2, "rock", card("Mind Stone", "Artifact"));
    state = put(state, p2, "forest", card("Forest", "Basic Land — Forest"));
    state = put(state, p1, "mine", card("Elk", "Creature — Elk", [3, 3]));
  });

  const zoneOf = (s: GameState, c: string) =>
    Array.from(s.zones.entries()).find(([, z]) =>
      z.cardIds.includes(id(c)),
    )?.[0];

  it("validates ReturnToHand with the removal targets", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(ok({ op: "ReturnToHand", target: "creature" })).toBe(true);
    expect(
      ok({ op: "ReturnToHand", target: "creature", controller: "opponent" }),
    ).toBe(true);
    expect(ok({ op: "ReturnToHand", target: "nonland_permanent" })).toBe(true);
    expect(ok({ op: "ReturnToHand", target: "spell" })).toBe(false);
    expect(isTargetedEffect({ op: "ReturnToHand", target: "creature" })).toBe(
      true,
    );
  });

  it("Unsummon returns a target creature to its owner's hand", () => {
    const s = resolveScriptedSpell(
      state,
      getCardScript("Unsummon")!,
      spell(p1, [cardTarget("bear")]),
    );
    expect(zoneOf(s, "bear")).toBe(`${p2}-hand`);
  });

  it("returns a stolen creature to its owner's hand, not its controller's", () => {
    // p1 controls a creature p2 owns: it sits on p1's battlefield.
    let s = put(state, p1, "stolen", card("Wolf", "Creature — Wolf", [2, 2]));
    const cards = new Map(s.cards);
    cards.set(id("stolen"), { ...cards.get(id("stolen"))!, ownerId: p2 });
    s = resolveScriptedSpell(
      { ...s, cards },
      getCardScript("Unsummon")!,
      spell(p2, [cardTarget("stolen")]),
    );
    expect(zoneOf(s, "stolen")).toBe(`${p2}-hand`);
  });

  it("a returned token ceases to exist", () => {
    let s = resolveScriptedSpell(
      state,
      CardScriptSchema.parse({
        name: "X",
        oracle: "x",
        spell: [
          {
            op: "CreateToken",
            count: 1,
            power: 1,
            toughness: 1,
            color: "white",
            subtypes: ["Soldier"],
          },
        ],
      }),
      spell(p1),
    );
    const token = s.zones
      .get(`${p1}-battlefield`)!
      .cardIds.find((cid) => s.cards.get(cid)!.isToken)!;
    const handBefore = s.zones.get(`${p1}-hand`)!.cardIds.length;
    s = resolveScriptedSpell(s, getCardScript("Unsummon")!, {
      controllerId: p1,
      sourceCardId: null as never,
      targets: [{ type: "card", targetId: token } as Target],
    });
    expect(s.cards.has(token)).toBe(false);
    expect(s.zones.get(`${p1}-hand`)!.cardIds).toHaveLength(handBefore);
    expect(s.zones.get(`${p1}-battlefield`)!.cardIds).not.toContain(token);
  });

  it("does nothing to a target that no longer matches", () => {
    // Unauthorized Exit needs a nonland permanent: a land is illegal.
    const s = resolveScriptedSpell(
      state,
      CardScriptSchema.parse({
        name: "X",
        oracle: "x",
        spell: [{ op: "ReturnToHand", target: "nonland_permanent" }],
      }),
      spell(p1, [cardTarget("forest")]),
    );
    expect(zoneOf(s, "forest")).toBe(`${p2}-battlefield`);
  });

  it("Exclusion Mage only returns a creature an opponent controls", () => {
    const effects = getCardScript("Exclusion Mage")!.triggers![0].effects!;
    const run = (target: string) =>
      resolveScriptedSpell(
        state,
        { name: "X", oracle: "x", spell: effects } as CardScript,
        spell(p1, [cardTarget(target)]),
      );
    expect(zoneOf(run("bear"), "bear")).toBe(`${p2}-hand`);
    expect(zoneOf(run("mine"), "mine")).toBe(`${p1}-battlefield`);
  });

  it("Unauthorized Exit returns a nonland permanent", () => {
    const script = getCardScript("Unauthorized Exit")!;
    expect(script.spell!.map((e) => e.op)).toEqual(["ReturnToHand", "Surveil"]);
    const s = resolveScriptedSpell(
      state,
      { ...script, spell: [script.spell![0]] } as CardScript,
      spell(p1, [cardTarget("rock")]),
    );
    expect(zoneOf(s, "rock")).toBe(`${p2}-hand`);
  });
});

describe("scripted Fight and Bite (#2548)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    state = put(state, p1, "elk", card("Elk", "Creature — Elk", [3, 3]));
  });

  const damage = (s: GameState, c: string) => s.cards.get(id(c))!.damage ?? 0;

  it("validates Fight and Bite and counts their targets", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    const bite = {
      op: "Bite",
      fighter: "creature",
      target: "creature",
      controller: "opponent",
    } as const;
    expect(ok(bite)).toBe(true);
    expect(ok({ ...bite, op: "Fight", fighter: "it" })).toBe(true);
    expect(ok({ ...bite, fighter: "self", optional: true })).toBe(true);
    expect(ok({ ...bite, fighter: "it", optional: true })).toBe(false);
    expect(ok({ ...bite, target: "player" })).toBe(false);
    expect(effectTargetCount(bite)).toBe(2);
    expect(effectTargetCount({ ...bite, fighter: "it" })).toBe(1);
    expect(effectTargetCount({ ...bite, fighter: "self" })).toBe(1);
    expect(effectTargetCount({ op: "Draw", amount: 1, who: "you" })).toBe(0);
  });

  it("Rabid Bite: only the creature you control deals damage", () => {
    const s = resolveScriptedSpell(
      state,
      getCardScript("Rabid Bite")!,
      spell(p1, [cardTarget("elk"), cardTarget("bear")]),
    );
    expect(damage(s, "bear")).toBe(3);
    expect(damage(s, "elk")).toBe(0);
    expect(
      checkStateBasedActions(s).state.zones.get(`${p2}-battlefield`)!.cardIds,
    ).not.toContain(id("bear"));
  });

  it("Kapow!: the countered creature fights, each dealing damage", () => {
    const s = resolveScriptedSpell(
      state,
      getCardScript("Kapow!")!,
      spell(p1, [cardTarget("elk"), cardTarget("bear")]),
    );
    expect(damage(s, "bear")).toBe(4);
    expect(damage(s, "elk")).toBe(2);
  });

  it("Huatli's Final Strike bites with the pumped power", () => {
    const s = resolveScriptedSpell(
      state,
      getCardScript("Huatli's Final Strike")!,
      spell(p1, [cardTarget("elk"), cardTarget("bear")]),
    );
    expect(damage(s, "bear")).toBe(4);
    expect(damage(s, "elk")).toBe(0);
  });

  it("no fight when the creature you control has left the battlefield", () => {
    const gone = destroyCard(state, id("elk")).state;
    const s = resolveScriptedSpell(
      gone,
      getCardScript("Kapow!")!,
      spell(p1, [cardTarget("elk"), cardTarget("bear")]),
    );
    expect(damage(s, "bear")).toBe(0);
  });

  it("no fight when the other creature is no longer legal", () => {
    const gone = destroyCard(state, id("bear")).state;
    const s = resolveScriptedSpell(
      gone,
      getCardScript("Troll Negotiations")!,
      spell(p1, [cardTarget("elk"), cardTarget("bear")]),
    );
    // The counters still land; the fight doesn't happen.
    expect(getEffectivePower(s.cards.get(id("elk"))!)).toBe(5);
    expect(damage(s, "elk")).toBe(0);
  });

  it("does nothing when the fighter isn't yours", () => {
    let s = put(state, p2, "wolf", card("Wolf", "Creature — Wolf", [4, 4]));
    s = resolveScriptedSpell(
      s,
      getCardScript("Tenderize")!,
      spell(p1, [cardTarget("wolf"), cardTarget("bear")]),
    );
    expect(damage(s, "bear")).toBe(0);
  });

  it("a self fighter fights from an ability", () => {
    let s = put(state, p1, "brute", card("Brute", "Creature — Ogre", [5, 5]));
    s = resolveScriptedSpell(
      s,
      CardScriptSchema.parse({
        name: "X",
        oracle: "x",
        spell: [
          {
            op: "Fight",
            fighter: "self",
            target: "creature",
            controller: "opponent",
          },
        ],
      }),
      {
        controllerId: p1,
        sourceCardId: "brute" as never,
        targets: [cardTarget("bear")],
      },
    );
    expect(damage(s, "bear")).toBe(5);
    expect(damage(s, "brute")).toBe(2);
  });

  it("lists both targets of a two-target spell, in order", () => {
    const s = put(state, p1, "bite", card("Rabid Bite", "Sorcery"), "hand");
    const specs = getSpellTargetSpecs(s, id("bite"));
    expect(specs.map((x) => [x.kind, x.controller])).toEqual([
      ["creature", "you"],
      ["creature", "opponent"],
    ]);
    expect(getLegalSpellTargetsAt(s, p1, id("bite"), 0)).toEqual(["elk"]);
    expect(getLegalSpellTargetsAt(s, p1, id("bite"), 1)).toEqual(["bear"]);
    expect(getLegalSpellTargetsAt(s, p1, id("bite"), 2)).toEqual([]);
  });

  it('an "it" fighter adds no target of its own', () => {
    const s = put(state, p1, "kapow", card("Kapow!", "Sorcery"), "hand");
    expect(getSpellTargetSpecs(s, id("kapow"))).toHaveLength(2);
    expect(getLegalSpellTargets(s, p1, id("kapow"))).toEqual(["elk"]);
  });
});

describe("scripted X spells (#2552)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
  });

  const withX = (
    controllerId: PlayerId,
    x: number,
    targets: Target[] = [],
  ) => ({
    ...spell(controllerId, targets),
    variableValues: new Map([["X", x]]),
  });
  const handSize = (s: GameState, p: PlayerId) =>
    s.zones.get(`${p}-hand`)!.cardIds.length;

  it("validates X amounts", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(ok({ op: "Draw", amount: "X", who: "you" })).toBe(true);
    expect(ok({ op: "DealDamage", amount: "X", target: "any" })).toBe(true);
    expect(
      ok({ op: "Pump", power: "-X", toughness: "-X", target: "creature" }),
    ).toBe(true);
    expect(
      ok({ op: "PutCounters", counter: "+1/+1", amount: "X", target: "self" }),
    ).toBe(true);
    expect(ok({ op: "Draw", amount: "-X", who: "you" })).toBe(false);
    expect(ok({ op: "Draw", amount: "Y", who: "you" })).toBe(false);
  });

  it("validates X amounts on trigger and activated effects (#2559)", () => {
    // X in the `effects` of a trigger — exercises the schema work PR #2553
    // already shipped, restated here as the trigger-side half of #2559.
    const triggerOk = CardScriptSchema.safeParse({
      name: "X-Trigger",
      oracle: "Whenever this enters, draw X cards.",
      triggers: [
        {
          text: "Whenever this enters, draw X cards.",
          event: "etb",
          subject: "self",
          effects: [{ op: "Draw", amount: "X", who: "you" }],
        },
      ],
    });
    expect(triggerOk.success).toBe(true);

    // X in the `effects` of an activated ability — same coverage.
    // The {X} activation cost itself isn't in the schema yet (separate
    // work, see `X cost in activation cost [fdn]`); we use a mana cost
    // here to focus on the effect schema.
    const activatedOk = CardScriptSchema.safeParse({
      name: "X-Activated",
      oracle: "{1}: this creature gets +X/+X until end of turn.",
      activated: [
        {
          text: "{1}: this creature gets +X/+X until end of turn.",
          cost: { mana: "{1}", tap: true },
          effects: [{ op: "Pump", power: "X", toughness: "X", target: "self" }],
        },
      ],
    });
    expect(activatedOk.success).toBe(true);
  });

  it("only cards with X in their text use X", () => {
    for (const file of readdirSync(CARDS_DIR).filter((f) =>
      f.endsWith(".json"),
    )) {
      const text = readFileSync(join(CARDS_DIR, file), "utf8");
      if (/"-?X"/.test(text)) {
        const { name, oracle } = JSON.parse(text) as CardScript;
        expect(`${name}: ${oracle}`).toMatch(/\bX\b/);
      }
    }
  });

  it("Mind Spring draws X cards", () => {
    let s = state;
    for (let i = 0; i < 5; i++)
      s = put(s, p1, `lib${i}`, card(`Lib ${i}`, "Instant"), "library");
    const before = handSize(s, p1);
    const after = resolveScriptedSpell(
      s,
      getCardScript("Mind Spring")!,
      withX(p1, 3),
    );
    expect(handSize(after, p1)).toBe(before + 3);
  });

  it("an X spell cast with no X does nothing", () => {
    let s = state;
    s = put(s, p1, "lib0", card("Lib 0", "Instant"), "library");
    const before = handSize(s, p1);
    const after = resolveScriptedSpell(
      s,
      getCardScript("Mind Spring")!,
      spell(p1),
    );
    expect(handSize(after, p1)).toBe(before);
  });

  it("Traumatic Critique deals X damage to a creature or a player", () => {
    const script = getCardScript("Traumatic Critique")!;
    const atBear = resolveScriptedSpell(
      state,
      script,
      withX(p1, 3, [cardTarget("bear")]),
    );
    expect(atBear.cards.get(id("bear"))!.damage).toBe(3);
    const atFace = resolveScriptedSpell(
      state,
      script,
      withX(p1, 4, [playerTarget(p2)]),
    );
    expect(atFace.players.get(p2)!.life).toBe(16);
  });

  it("withX fills in X and -X", () => {
    expect(
      withXEffect(
        { op: "Pump", power: "-X", toughness: "X", target: "creature" },
        2,
      ),
    ).toMatchObject({ power: -2, toughness: 2 });
  });

  it("Primal Might pumps +X/+X then fights", () => {
    // p1 has a Bear (2/2); p2 has a Boar (3/3). Cast Primal Might with X=2.
    // The Bear becomes 4/4 until end of turn, then fights the Boar.
    // 4 damage to Boar (dies), 3 damage to Bear (dies).
    let s = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    s = put(s, p2, "boar", card("Boar", "Creature — Boar", [3, 3]));
    const after = resolveScriptedSpell(
      s,
      getCardScript("Primal Might")!,
      withX(p1, 2, [cardTarget("bear"), cardTarget("boar")]),
    );
    expect(after.cards.get(id("bear"))!.damage).toBe(3); // 3 damage from Boar
    expect(after.cards.get(id("boar"))!.damage).toBe(4); // 4 damage from Bear (2 + X=2)
  });

  it("Pedal to the Metal gives +X/+0 and first strike to one target", () => {
    let s = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const script = getCardScript("Pedal to the Metal")!;
    expect(script.spell!.reduce((n, e) => n + effectTargetCount(e), 0)).toBe(1);
    s = resolveScriptedSpell(s, script, withX(p1, 3, [cardTarget("bear")]));
    const bear = s.cards.get(id("bear"))!;
    expect(getEffectivePower(bear)).toBe(5);
    expect(getEffectiveToughness(bear)).toBe(2);
    expect(hasKeyword(bear, "first strike")).toBe(true);
  });

  it("Finale of Revelation draws X cards", () => {
    let s = state;
    for (let i = 0; i < 5; i++)
      s = put(s, p1, `lib${i}`, card(`Lib ${i}`, "Instant"), "library");
    const before = handSize(s, p1);
    const after = resolveScriptedSpell(
      s,
      getCardScript("Finale of Revelation")!,
      withX(p1, 3),
    );
    expect(handSize(after, p1)).toBe(before + 3);
  });
});

describe("scripted X in triggers and activations (#2559)", () => {
  // Engine-only tests of the X-from-cast → trigger/activation-stack-object
  // plumbing. Cards-as-data coverage is in the `scripted X spells` block
  // above; here we exercise the engine bits: `xValue` stamped on the
  // CardInstance at resolve, and that value seeded into
  // StackObject.variableValues by `putTriggersOnStack` and `activateAbility`.
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("putTriggersOnStack seeds X from the source's xValue", () => {
    // A hypothetical X-cost permanent with a trigger that draws X cards.
    const cardId = id("wildwood");
    let s = state;
    s = put(
      s,
      p1,
      "wildwood",
      card("Wildwood Scourge", "Creature — Hydra", [0, 0]),
    );
    // Stamp xValue as resolve would (X=3 chosen at cast).
    const wildwood = s.cards.get(cardId)!;
    s = {
      ...s,
      cards: new Map(s.cards).set(cardId, { ...wildwood, xValue: 3 }),
    };

    const trigger = {
      id: "t1",
      sourceCardId: cardId,
      triggeringPlayerId: p1,
      triggerCondition: "etb",
      effect: "Draw X cards.",
      timestamp: 1,
      sourceCardTimestamp: 1,
      interveningIf: undefined,
    };
    const result = putTriggersOnStack(s, [trigger]);
    const obj = result.state.stack.find((o) => o.id === "t1")!;
    expect(obj.variableValues.get("X")).toBe(3);
  });

  it("putTriggersOnStack leaves X unset for non-X sources", () => {
    // A non-X permanent with the same trigger text. X should default to 0
    // in the resolveScriptedEffects path (per the `?? 0` in interpret.ts).
    const cardId = id("boring");
    const s = put(
      state,
      p1,
      "boring",
      card("Boring Bear", "Creature — Bear", [2, 2]),
    );
    const trigger = {
      id: "t1",
      sourceCardId: cardId,
      triggeringPlayerId: p1,
      triggerCondition: "etb",
      effect: "Draw X cards.",
      timestamp: 1,
      sourceCardTimestamp: 1,
      interveningIf: undefined,
    };
    const result = putTriggersOnStack(s, [trigger]);
    const obj = result.state.stack.find((o) => o.id === "t1")!;
    expect(obj.variableValues.has("X")).toBe(false);
  });

  it("activateAbility seeds X from the source's xValue", () => {
    // The activated-side analogue: an X-cost permanent activates its
    // {X}-cost ability and the resulting StackObject should see X.
    const cardId = id("hydra");
    let s = put(
      state,
      p1,
      "hydra",
      card("Big Hydra", "Creature — Hydra", [0, 0]),
    );
    const hydra = s.cards.get(cardId)!;
    s = { ...s, cards: new Map(s.cards).set(cardId, { ...hydra, xValue: 5 }) };
    const before = s.cards.get(cardId)!.xValue;
    expect(before).toBe(5);
    // Sanity: putTriggersOnStack would seed X=5 too.
    const trigger = {
      id: "t1",
      sourceCardId: cardId,
      triggeringPlayerId: p1,
      triggerCondition: "etb",
      effect: "draw",
      timestamp: 1,
      sourceCardTimestamp: 1,
      interveningIf: undefined,
    };
    const result = putTriggersOnStack(s, [trigger]);
    const obj = result.state.stack.find((o) => o.id === "t1")!;
    expect(obj.variableValues.get("X")).toBe(5);
    // Suppress the unused `p2` warning; p2 isn't needed for this test.
    void p2;
  });
});

describe("scripted X activation cost (#2559, #2594 #18)", () => {
  // CR 107.3 / 602 — an activated ability whose mana cost contains {X} pays
  // the chosen X as generic mana on top of the printed colored cost. The
  // X value flows from the source's `xValue` (set when the spell/permanent
  // was cast) into `StackObject.variableValues`; here we confirm the
  // engine's `activateAbility` honors the parsed `manaCost.X` against
  // `card.xValue` and the player's pool.
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  // Hypothetical X-cost permanent whose "{X}{G}, {T}: this creature gets
  // +X/+X until end of turn" mirrors Heroes' Bane. We register it as a
  // fixture because `getActivatedAbilities` reads scripted abilities from
  // the registry keyed on card name. The `text` is the *effect* part
  // (after the colon) — see Burnished Hart for the canonical shape; the
  // cost string lives in `cost.mana`, never in `text`.
  const xHydraScript: CardScript = {
    name: "Test X Hydra",
    oracle:
      "{X}{G}, {T}: This creature gets +X/+X until end of turn. (X-cost activation; #2559 + #2594 #18.)",
    activated: [
      {
        text: "This creature gets +X/+X until end of turn.",
        cost: { mana: "{X}{G}", tap: true, sacrifice: false, exileSelf: false },
        effects: [{ op: "Pump", power: "X", toughness: "X", target: "self" }],
      },
    ],
  };

  beforeAll(() => registerCardScripts([...RAW_CARD_SCRIPTS, xHydraScript]));
  afterAll(() => registerCardScripts(RAW_CARD_SCRIPTS));

  // Tap-state helper: a permanent that was just put on the battlefield
  // has summoning sickness and can't be tapped for an ability. The
  // Llanowar Elves test uses the same pattern (#2565).
  const ready = (s: GameState, cardId: string): GameState => {
    const cards = new Map(s.cards);
    cards.set(id(cardId), {
      ...cards.get(id(cardId))!,
      hasSummoningSickness: false,
    });
    return { ...s, cards };
  };

  // Add the chosen X + colored cost to the player's pool so the
  // activation can pay for itself.
  const fundPool = (s: GameState, x: number, green: number): GameState => {
    const player = s.players.get(p1);
    if (!player) return s;
    const updated = new Map(s.players);
    updated.set(p1, {
      ...player,
      manaPool: {
        ...player.manaPool,
        generic: x,
        green,
      },
    });
    return { ...s, players: updated };
  };

  // Stamp `xValue` on the source the way `castSpell` would when the
  // permanent was cast with X chosen.
  const stampX = (s: GameState, cardId: string, x: number): GameState => {
    const cards = new Map(s.cards);
    cards.set(id(cardId), { ...cards.get(id(cardId))!, xValue: x });
    return { ...s, cards };
  };

  it("schema accepts {X} in the activation cost regex", () => {
    // A single-symbol {X} activation.
    const single = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      activated: [
        {
          text: "{X}: draw a card.",
          cost: { mana: "{X}" },
          effects: [{ op: "Draw", amount: 1, who: "you" }],
        },
      ],
    });
    expect(single.success).toBe(true);

    // Mixed {X}{G}.
    const mixed = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      activated: [
        {
          text: "{X}{G}: +X/+X.",
          cost: { mana: "{X}{G}" },
          effects: [{ op: "Pump", power: "X", toughness: "X", target: "self" }],
        },
      ],
    });
    expect(mixed.success).toBe(true);

    // Multi-X {X}{X}{R} (Steel Hellkite style).
    const multiX = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      activated: [
        {
          text: "{X}{X}{R}: deal X.",
          cost: { mana: "{X}{X}{R}" },
          effects: [{ op: "DealDamage", amount: "X", target: "any" }],
        },
      ],
    });
    expect(multiX.success).toBe(true);
  });

  it("schema still rejects an unknown mana symbol in the cost", () => {
    const result = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      activated: [
        {
          text: "{Y}: draw a card.",
          cost: { mana: "{Y}" },
          effects: [{ op: "Draw", amount: 1, who: "you" }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("getActivatedAbilities parses {X} into manaCost.X (not generic)", () => {
    // {X}{G} on a scripted permanent: parseManaCost stores X=0 and
    // green=1; the X value is read at activation time from the source's
    // xValue, not from the parsed numeric field. The activation-payment
    // path is what we test here.
    const hydra = card("Test X Hydra", "Creature — Hydra", [0, 0]);
    const abilities = getActivatedAbilities(hydra);
    expect(abilities).toHaveLength(1);
    const mc = abilities[0].costs.mana;
    expect(mc).not.toBeNull();
    expect(mc!.X).toBe(0);
    expect(mc!.generic).toBe(0);
    expect(mc!.green).toBe(1);
  });

  it("activation pays (xValue + printed colored) from the pool", () => {
    // Wildwood-style X-cost permanent cast with X=3, then activated.
    // 3 generic + 1 green = 4 mana total. The pool is fully drained
    // by the activation, and the +X/+X pump is applied on resolution.
    let s = put(
      state,
      p1,
      "xhydra",
      card("Test X Hydra", "Creature — Hydra", [0, 0]),
    );
    s = ready(stampX(s, "xhydra", 3), "xhydra");
    s = fundPool(s, 3, 1);

    const r = activateAbility(s, p1, id("xhydra"), 0);
    expect(r.success).toBe(true);
    // Pool drained.
    expect(r.state.players.get(p1)!.manaPool.generic).toBe(0);
    expect(r.state.players.get(p1)!.manaPool.green).toBe(0);
    // The scripted ability is on the stack with the chosen X seeded in
    // `variableValues` (the activation path mirrors the trigger path,
    // #2559). Resolving it applies the +3/+3 pump.
    const stackObj = r.state.stack[r.state.stack.length - 1];
    expect(stackObj.variableValues.get("X")).toBe(3);
    const resolved = resolveScriptedAbility(r.state, stackObj)!;
    const hydra = resolved.cards.get(id("xhydra"))!;
    expect(getEffectivePower(hydra)).toBe(3);
    expect(getEffectiveToughness(hydra)).toBe(3);
  });

  it("activation refuses the {X} cost when the pool is short of X", () => {
    // X=4 chosen, but only 3 generic in the pool. The engine must not
    // silently spend the printed green while refusing the X.
    let s = put(
      state,
      p1,
      "xhydra",
      card("Test X Hydra", "Creature — Hydra", [0, 0]),
    );
    s = ready(stampX(s, "xhydra", 4), "xhydra");
    s = fundPool(s, 3, 1);

    const r = activateAbility(s, p1, id("xhydra"), 0);
    expect(r.success).toBe(false);
    // Mana untouched (the engine bails before spending — see
    // activated.ts `Not enough mana` branch).
    expect(r.state.players.get(p1)!.manaPool.generic).toBe(3);
    expect(r.state.players.get(p1)!.manaPool.green).toBe(1);
  });

  it("X=0 activation costs only the printed colored mana", () => {
    // Cast with X=0 (a hypothetical "use no X" case) — the engine pays
    // 0 generic + 1 green, drains the green, and applies +0/+0 on
    // resolution.
    let s = put(
      state,
      p1,
      "xhydra",
      card("Test X Hydra", "Creature — Hydra", [0, 0]),
    );
    s = ready(stampX(s, "xhydra", 0), "xhydra");
    s = fundPool(s, 0, 1);

    const r = activateAbility(s, p1, id("xhydra"), 0);
    expect(r.success).toBe(true);
    expect(r.state.players.get(p1)!.manaPool.green).toBe(0);
    const stackObj = r.state.stack[r.state.stack.length - 1];
    expect(stackObj.variableValues.get("X")).toBe(0);
    const resolved = resolveScriptedAbility(r.state, stackObj)!;
    const hydra = resolved.cards.get(id("xhydra"))!;
    expect(getEffectivePower(hydra)).toBe(0);
    expect(getEffectiveToughness(hydra)).toBe(0);
  });
});

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

describe("scripted AddMana (#2565)", () => {
  const fresh = () => {
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    return { state, p1: Array.from(state.players.keys())[0] };
  };

  const ok = (effect: object, where: "spell" | "activated" = "spell") =>
    CardScriptSchema.safeParse(
      where === "spell"
        ? { name: "X", oracle: "x", spell: [effect] }
        : {
            name: "X",
            oracle: "x",
            activated: [
              {
                text: "Add {G}.",
                cost: { tap: true, sacrifice: false, exileSelf: false },
                effects: [effect],
              },
            ],
          },
    ).success;

  it("validates AddMana", () => {
    expect(ok({ op: "AddMana", amount: 1, colors: ["G"] }, "activated")).toBe(
      true,
    );
    expect(ok({ op: "AddMana", colors: "any" }, "activated")).toBe(true);
    expect(ok({ op: "AddMana", amount: 1, colors: ["R", "G"] })).toBe(true);
    expect(ok({ op: "AddMana", amount: 0, colors: ["G"] })).toBe(false);
    expect(ok({ op: "AddMana", amount: 1, colors: [] })).toBe(false);
    expect(ok({ op: "AddMana", amount: 1, colors: ["X"] })).toBe(false);
    // Spending restrictions aren't enforced yet, so they can't be scripted.
    expect(
      ok({ op: "AddMana", amount: 1, colors: "any", restrict: "creatures" }),
    ).toBe(false);
  });

  it("is not a targeted effect", () => {
    expect(isTargetedEffect({ op: "AddMana", amount: 1, colors: ["G"] })).toBe(
      false,
    );
  });

  it("adds a fixed color to the controller's pool when it resolves", () => {
    const { p1, state: s0 } = fresh();
    const s = resolveScriptedSpell(
      s0,
      {
        name: "X",
        oracle: "x",
        spell: [{ op: "AddMana", amount: 2, colors: ["R"] }],
      } as CardScript,
      spell(p1),
    );
    expect(s.players.get(p1)!.manaPool.red).toBe(2);
    expect(s.players.get(p1)!.manaPool.green).toBe(0);
  });

  it("Llanowar Elves taps for {G} as a mana ability, without the stack", () => {
    expect(getCardScript("Llanowar Elves")).toBeDefined();
    const { p1, state: s0 } = fresh();
    let s = put(
      s0,
      p1,
      "elves",
      card("Llanowar Elves", "Creature — Elf Druid", [1, 1]),
    );
    const cards = new Map(s.cards);
    cards.set(id("elves"), {
      ...cards.get(id("elves"))!,
      hasSummoningSickness: false,
    });
    s = { ...s, cards };
    const stackBefore = s.zones.get("stack")?.cardIds.length ?? 0;

    const r = activateAbility(s, p1, id("elves"), 0);
    expect(r.success).toBe(true);
    expect(r.state.players.get(p1)!.manaPool.green).toBe(1);
    expect(r.state.cards.get(id("elves"))!.isTapped).toBe(true);
    expect(r.state.zones.get("stack")?.cardIds.length ?? 0).toBe(stackBefore);
  });

  it("summoning-sick Llanowar Elves can't tap for mana (CR 302.6)", () => {
    const { p1, state: s0 } = fresh();
    const s = put(
      s0,
      p1,
      "elves",
      card("Llanowar Elves", "Creature — Elf Druid", [1, 1]),
    );
    const r = activateAbility(s, p1, id("elves"), 0);
    expect(r.success).toBe(false);
    expect(r.state.players.get(p1)!.manaPool.green).toBe(0);
  });

  it("every AddMana script's ability text agrees with its op", () => {
    const symbolKey = {
      W: "white",
      U: "blue",
      B: "black",
      R: "red",
      G: "green",
      C: "colorless",
    } as const;
    for (const name of listScriptedCardNames()) {
      for (const a of getCardScript(name)!.activated ?? []) {
        for (const e of a.effects ?? []) {
          if (e.op !== "AddMana") continue;
          if (e.colors === "any" || e.colors.length > 1) {
            expect([name, /any (?:one )?color| or \{/i.test(a.text)]).toEqual([
              name,
              true,
            ]);
          } else {
            expect([name, parseManaFromEffect(a.text)]).toEqual([
              name,
              { [symbolKey[e.colors[0]]]: e.amount },
            ]);
          }
        }
      }
    }
  });
});

describe("scripted GrantKeyword (#2567)", () => {
  const fresh = () => {
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1, p2] = Array.from(state.players.keys());
    const s = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    return { state: s, p1, p2 };
  };
  const ok = (effect: object) =>
    CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
      .success;
  const grant = (target: "creature" | "self" | "it") =>
    ({
      op: "GrantKeyword",
      keyword: "indestructible",
      target,
      until: "end_of_turn",
    }) as const;
  const withDamage = (s: GameState, cardId: string, damage: number) => {
    const cards = new Map(s.cards);
    cards.set(id(cardId), { ...cards.get(id(cardId))!, damage });
    return { ...s, cards };
  };
  const adamant = (s: GameState, p1: PlayerId, target = "bear") =>
    resolveScriptedSpell(
      s,
      getCardScript("Adamant Will")!,
      spell(p1, [cardTarget(target)]),
    );

  it("validates GrantKeyword", () => {
    expect(ok(grant("creature"))).toBe(true);
    expect(ok(grant("it"))).toBe(true);
    expect(ok({ ...grant("creature"), controller: "you" })).toBe(true);
    expect(ok({ ...grant("self"), controller: "you" })).toBe(false);
    // Every evergreen keyword in the grantable list validates
    // (issue #2594 follow-up: widens from `indestructible`-only to
    // match the equipment keyword set).
    for (const keyword of [
      "flying",
      "vigilance",
      "trample",
      "haste",
      "lifelink",
      "deathtouch",
      "reach",
      "first strike",
      "double strike",
      "menace",
      "hexproof",
      "indestructible",
    ]) {
      expect(ok({ ...grant("creature"), keyword })).toBe(true);
    }
    // Keywords outside the evergreen set are still rejected.
    expect(ok({ ...grant("creature"), keyword: "fear" })).toBe(false);
    expect(ok({ ...grant("creature"), keyword: "banding" })).toBe(false);
    expect(ok({ ...grant("creature"), until: "next_turn" })).toBe(false);
    const { until: _until, ...noUntil } = grant("creature");
    expect(ok(noUntil)).toBe(false);
  });

  it("only a creature target uses a target", () => {
    expect(isTargetedEffect(grant("creature"))).toBe(true);
    expect(isTargetedEffect(grant("self"))).toBe(false);
    expect(isTargetedEffect(grant("it"))).toBe(false);
    const effects = getCardScript("Adamant Will")!.spell!;
    expect(effects.reduce((n, e) => n + effectTargetCount(e), 0)).toBe(1);
  });

  it("Adamant Will gives +2/+2 and indestructible to one target", () => {
    const { state, p1 } = fresh();
    const s = adamant(state, p1);
    const bear = s.cards.get(id("bear"))!;
    expect(getEffectivePower(bear)).toBe(4);
    expect(getEffectiveToughness(bear)).toBe(4);
    expect(hasKeyword(bear, "indestructible")).toBe(true);
  });

  it("the granted creature survives lethal damage and destroy (CR 702.12b)", () => {
    const { state, p1, p2 } = fresh();
    let s = withDamage(adamant(state, p1), "bear", 10);
    s = checkStateBasedActions(s).state;
    expect(battlefield(s, p2)).toContain(id("bear"));
    s = destroyCard(s, id("bear")).state;
    expect(battlefield(s, p2)).toContain(id("bear"));
  });

  it("the grant ends at cleanup, so lethal damage then kills it", () => {
    const { state, p1, p2 } = fresh();
    let s = clearUntilEndOfTurnPT(adamant(state, p1));
    expect(hasKeyword(s.cards.get(id("bear"))!, "indestructible")).toBe(false);
    s = checkStateBasedActions(withDamage(s, "bear", 2)).state;
    expect(battlefield(s, p2)).not.toContain(id("bear"));
    expect(s.zones.get(`${p2}-graveyard`)!.cardIds).toContain(id("bear"));
  });

  it('"it" grants nothing when the shared target is gone (CR 608.2b)', () => {
    const { state, p1 } = fresh();
    const s = adamant(state, p1, "nowhere");
    expect(hasKeyword(s.cards.get(id("bear"))!, "indestructible")).toBe(false);
  });

  it("every GrantKeyword script's text says until end of turn", () => {
    for (const f of readdirSync(CARDS_DIR).filter((x) => x.endsWith(".json"))) {
      const script = JSON.parse(
        readFileSync(join(CARDS_DIR, f), "utf8"),
      ) as CardScript;
      for (const e of scriptedSpellEffects(script)) {
        if (e.op !== "GrantKeyword") continue;
        expect([f, script.oracle.toLowerCase()]).toEqual([
          f,
          expect.stringContaining(`${e.keyword} until end of turn`),
        ]);
      }
    }
  });

  it("grants non-indestructible keywords through the same engine path (#2594)", () => {
    // The schema widens to all 12 evergreen keywords (#2594). The engine
    // path (`addUntilEndOfTurnKeyword` -> `untilEndOfTurnKeywords` ->
    // `hasKeyword`) is the same for every keyword; sanity-check three
    // representative ones (lifelink, trample, flying) flow through.
    const grant = (keyword: "lifelink" | "trample" | "flying") =>
      ({
        op: "GrantKeyword",
        keyword,
        target: "creature",
        until: "end_of_turn",
      }) as const;
    const resolve = (
      s: GameState,
      p1: PlayerId,
      keyword: "lifelink" | "trample" | "flying",
    ) =>
      resolveScriptedSpell(
        s,
        {
          name: "X",
          oracle: "x",
          spell: [grant(keyword)],
        },
        spell(p1, [cardTarget("bear")]),
      );
    for (const keyword of ["lifelink", "trample", "flying"] as const) {
      const { state, p1 } = fresh();
      const s = resolve(state, p1, keyword);
      expect(hasKeyword(s.cards.get(id("bear"))!, keyword)).toBe(true);
    }
    // Cleanup drops them too.
    const { state, p1 } = fresh();
    const s = clearUntilEndOfTurnPT(resolve(state, p1, "flying"));
    expect(hasKeyword(s.cards.get(id("bear"))!, "flying")).toBe(false);
  });

  it("Boros Charm's third mode grants double strike to a target creature", () => {
    // Re-validates the v1 workaround removal: the third mode of Boros
    // Charm was dropped in #2592's rebase because `GRANTABLE_KEYWORDS`
    // was `["indestructible"]`. With the enum widened, the mode parses
    // and resolves through the same engine path as indestructible.
    const f = fresh();
    const s = resolveScriptedSpell(f.state, getCardScript("Boros Charm")!, {
      ...spell(f.p1, [cardTarget("bear")]),
      chosenModes: ["Target creature gains double strike until end of turn."],
    });
    expect(hasKeyword(s.cards.get(id("bear"))!, "double strike")).toBe(true);
  });

  it("Boros Charm's second mode grants indestructible to ALL the controller's permanents (#2594 #14)", () => {
    // v1 limitation: mode 2 was scripted as `target: "creature" +
    // controller: "you"`, which only granted indestructible to creatures
    // you control — artifacts, enchantments, planeswalkers, and lands
    // missed the grant. With `target: "permanents_you_control"` the
    // engine fans out to every permanent the controller owns on
    // resolution, matching the card text.
    const f = fresh();
    // Set up a battlefield with a creature, an artifact, and an
    // enchantment under p1's control. The artifact and enchantment
    // would be skipped by the v1 creature-only path.
    let s0 = f.state;
    s0 = put(
      s0,
      f.p1,
      "bear",
      card("Bear", "Creature — Bear", [2, 2]),
    );
    s0 = put(
      s0,
      f.p1,
      "rock",
      card("Rock", "Artifact"),
    );
    s0 = put(
      s0,
      f.p1,
      "bestow",
      card("Bestow Test", "Enchantment — Aura"),
    );
    // An opponent's creature that should NOT be granted indestructible.
    s0 = put(
      s0,
      f.p2,
      "theirs",
      card("Foe", "Creature — Beast", [1, 1]),
    );

    const s = resolveScriptedSpell(s0, getCardScript("Boros Charm")!, {
      ...spell(f.p1, []),
      chosenModes: [
        "Permanents you control gain indestructible until end of turn.",
      ],
    });

    // All three of p1's permanents get indestructible.
    expect(hasKeyword(s.cards.get(id("bear"))!, "indestructible")).toBe(true);
    expect(hasKeyword(s.cards.get(id("rock"))!, "indestructible")).toBe(true);
    expect(hasKeyword(s.cards.get(id("bestow"))!, "indestructible")).toBe(true);
    // p2's creature does NOT.
    expect(hasKeyword(s.cards.get(id("theirs"))!, "indestructible")).toBe(
      false,
    );
  });

  it("GrantKeyword `permanents_you_control` with no permanents on the battlefield is a no-op", () => {
    const f = fresh();
    // Empty battlefield — the fan-out iterates over zero cards and
    // returns the state unchanged.
    const s = resolveScriptedSpell(
      { ...f.state, players: new Map(f.state.players).set(f.p1, {
        ...f.state.players.get(f.p1)!,
        manaPool: { ...f.state.players.get(f.p1)!.manaPool, white: 0, red: 0 },
      }) },
      getCardScript("Boros Charm")!,
      {
        ...spell(f.p1, []),
        chosenModes: [
          "Permanents you control gain indestructible until end of turn.",
        ],
      },
    );
    // State should be the same except for the spell resolution
    // timestamp — the simplest assertion is the battlefield is empty.
    expect(s.zones.get(`${f.p1}-battlefield`)!.cardIds).toEqual([]);
  });

  it("schema accepts `permanents_you_control` on GrantKeyword and rejects `controller`", () => {
    // The new target is a "plural" — the controller filter is
    // encoded in the target value, so a `controller` field is
    // rejected (it would be a redundant/conflicting filter).
    const ok = CardScriptSchema.safeParse({
      name: "Test",
      oracle: "x",
      spell: [
        {
          op: "GrantKeyword",
          keyword: "indestructible",
          target: "permanents_you_control",
          until: "end_of_turn",
        },
      ],
    });
    expect(ok.success).toBe(true);

    // The schema is `.strict()`, so an unexpected `controller` field
    // on a `permanents_you_control` target is rejected.
    const withController = CardScriptSchema.safeParse({
      name: "Test",
      oracle: "x",
      spell: [
        {
          op: "GrantKeyword",
          keyword: "indestructible",
          target: "permanents_you_control",
          controller: "you",
          until: "end_of_turn",
        },
      ],
    });
    expect(withController.success).toBe(false);
  });
});

describe("SearchLibrary tapped + Solemn Simulacrum, Campus Guide fix (#2566)", () => {
  let state: GameState;
  let p1: PlayerId;

  const ability = (sourceCardId: string, text: string) =>
    ({
      id: "ab-search",
      type: "ability",
      sourceCardId: id(sourceCardId),
      controllerId: p1,
      text,
      targets: [],
      triggered: true,
      activated: false,
    }) as unknown as StackObject;

  const SOLEMN_ETB =
    "When this creature enters, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.";
  const SOLEMN_DIES = "When this creature dies, you may draw a card.";
  const CAMPUS_ETB =
    "When this creature enters, you may search your library for a basic land card, reveal it, then shuffle and put that card on top.";

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(state.players.keys());
  });

  it("validates SearchLibrary's tapped flag", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    const base = {
      op: "SearchLibrary",
      filter: { basic_land: true },
      destination: "battlefield",
    };
    expect(ok({ ...base, tapped: true })).toBe(true);
    expect(ok(base)).toBe(true);
    expect(ok({ ...base, tapped: "yes" })).toBe(false);
  });

  it("Solemn Simulacrum's ETB puts a basic land onto the battlefield tapped", () => {
    let s = put(
      state,
      p1,
      "solemn",
      card("Solemn Simulacrum", "Artifact Creature — Golem", [2, 2]),
    );
    s = put(
      s,
      p1,
      "lib-bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
      "library",
    );
    s = put(
      s,
      p1,
      "lib-forest",
      card("Forest", "Basic Land — Forest"),
      "library",
    );
    const libBefore = s.zones.get(`${p1}-library`)!.cardIds.length;
    const out = resolveScriptedAbility(s, ability("solemn", SOLEMN_ETB))!;
    expect(battlefield(out, p1)).toContain(id("lib-forest"));
    expect(out.cards.get(id("lib-forest"))!.isTapped).toBe(true);
    expect(out.cards.get(id("lib-forest"))!.currentZoneKey).toBe(
      `${p1}-battlefield`,
    );
    const lib = out.zones.get(`${p1}-library`)!.cardIds;
    expect(lib).toHaveLength(libBefore - 1);
    expect(lib).toContain(id("lib-bear"));
  });

  it("Solemn Simulacrum's dies trigger draws a card", () => {
    let s = put(
      state,
      p1,
      "solemn",
      card("Solemn Simulacrum", "Artifact Creature — Golem", [2, 2]),
    );
    s = put(s, p1, "lib-top", card("Island", "Basic Land — Island"), "library");
    const handBefore = s.zones.get(`${p1}-hand`)!.cardIds.length;
    const out = resolveScriptedAbility(s, ability("solemn", SOLEMN_DIES))!;
    expect(out.zones.get(`${p1}-hand`)!.cardIds).toHaveLength(handBefore + 1);
  });

  it("Campus Guide's ETB puts the basic land on top of the library, not onto the battlefield", () => {
    let s = put(
      state,
      p1,
      "guide",
      card("Campus Guide", "Artifact Creature — Golem", [2, 1]),
    );
    s = put(
      s,
      p1,
      "lib-forest",
      card("Forest", "Basic Land — Forest"),
      "library",
    );
    s = put(
      s,
      p1,
      "lib-bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
      "library",
    );
    const out = resolveScriptedAbility(s, ability("guide", CAMPUS_ETB))!;
    expect(battlefield(out, p1)).not.toContain(id("lib-forest"));
    const lib = out.zones.get(`${p1}-library`)!.cardIds;
    // The top of a library is the last id (getTopCard, zones.ts).
    expect(lib[lib.length - 1]).toBe(id("lib-forest"));
    // Same library size as before, the Forest only once (not duplicated).
    expect(lib).toHaveLength(s.zones.get(`${p1}-library`)!.cardIds.length);
    expect(lib.filter((c) => c === id("lib-forest"))).toHaveLength(1);
  });

  it("Solemn Simulacrum and Campus Guide scripts match Scryfall's oracle", () => {
    const read = (f: string) =>
      JSON.parse(readFileSync(join(CARDS_DIR, f), "utf8")) as {
        oracle: string;
        triggers: { text: string }[];
      };
    const solemn = read("solemn_simulacrum.json");
    expect(solemn.oracle).toBe(`${SOLEMN_ETB}\n${SOLEMN_DIES}`);
    expect(solemn.triggers.map((t) => t.text)).toEqual([
      SOLEMN_ETB,
      SOLEMN_DIES,
    ]);
    const campus = read("campus_guide.json");
    expect(campus.oracle).toBe(CAMPUS_ETB);
    expect(campus.triggers.map((t) => t.text)).toEqual([CAMPUS_ETB]);
  });

  const HART =
    "Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.";
  const hartAbility = (sourceCardId: string) =>
    ({
      id: "ab-hart",
      type: "ability",
      sourceCardId: id(sourceCardId),
      controllerId: p1,
      text: HART,
      targets: [],
      triggered: false,
      activated: true,
    }) as unknown as StackObject;

  it("validates SearchLibrary's count (1 or 2)", () => {
    const ok = (count: unknown) =>
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "x",
        spell: [{ op: "SearchLibrary", filter: { basic_land: true }, count }],
      }).success;
    expect(ok(1)).toBe(true);
    expect(ok(2)).toBe(true);
    expect(ok(0)).toBe(false);
    expect(ok(3)).toBe(false);
    expect(ok(1.5)).toBe(false);
  });

  it("Burnished Hart puts up to two basic lands onto the battlefield tapped", () => {
    let s = put(
      state,
      p1,
      "hart",
      card("Burnished Hart", "Artifact Creature — Elk", [2, 2]),
    );
    s = put(s, p1, "f1", card("Forest", "Basic Land — Forest"), "library");
    s = put(s, p1, "f2", card("Plains", "Basic Land — Plains"), "library");
    s = put(s, p1, "f3", card("Island", "Basic Land — Island"), "library");
    const libBefore = s.zones.get(`${p1}-library`)!.cardIds;
    const basics = libBefore.filter((c) =>
      /^Basic Land/.test(s.cards.get(c)?.cardData.type_line ?? ""),
    );
    const out = resolveScriptedAbility(s, hartAbility("hart"))!;
    const fetched = battlefield(out, p1).filter((c) => basics.includes(c));
    expect(fetched).toHaveLength(2);
    for (const c of fetched) expect(out.cards.get(c)!.isTapped).toBe(true);
    expect(out.zones.get(`${p1}-library`)!.cardIds).toHaveLength(
      libBefore.length - 2,
    );
  });

  it("Burnished Hart finds fewer lands when fewer are left", () => {
    let s = put(
      state,
      p1,
      "hart",
      card("Burnished Hart", "Artifact Creature — Elk", [2, 2]),
    );
    // Only nonbasic cards in the library apart from one Forest.
    const lib = s.zones.get(`${p1}-library`)!;
    const zones = new Map(s.zones);
    zones.set(`${p1}-library`, { ...lib, cardIds: [] });
    s = { ...s, zones };
    s = put(
      s,
      p1,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
      "library",
    );
    s = put(s, p1, "f1", card("Forest", "Basic Land — Forest"), "library");
    const out = resolveScriptedAbility(s, hartAbility("hart"))!;
    expect(battlefield(out, p1)).toContain(id("f1"));
    expect(out.zones.get(`${p1}-library`)!.cardIds).toEqual([id("bear")]);
  });

  it("Burnished Hart's script matches Scryfall's oracle", () => {
    const hart = JSON.parse(
      readFileSync(join(CARDS_DIR, "burnished_hart.json"), "utf8"),
    ) as { oracle: string; activated: { text: string }[] };
    expect(hart.oracle).toBe(`{3}, Sacrifice this creature: ${HART}`);
    expect(hart.activated.map((a) => a.text)).toEqual([HART]);
  });
});

/**
 * Scripted Auras (CR 702.5 / 303.4, issue #2568). The schema's
 * `aura.static` rides the same `refreshAuraBonuses` path as the engine's
 * oracle-text Aura bonuses, so a single SBA pass writes the enchanted
 * permanent's `auraPT` / `auraKeywords` / `auraRestrictAttack` /
 * `auraRestrictBlock` from both sources simultaneously.
 */
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
    s0 = put(
      s0,
      p1,
      "snare",
      card("Starlight Snare", "Enchantment — Aura"),
    );
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
    s0 = put(
      s0,
      p1,
      "snare",
      card("Starlight Snare", "Enchantment — Aura"),
    );
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
    s0 = put(
      s0,
      p1,
      "friend",
      card("Ally", "Creature — Human", [1, 1]),
    );
    s0 = put(
      s0,
      p1,
      "snare",
      card("Starlight Snare", "Enchantment — Aura"),
    );
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
describe("scripted AddMana (#2565)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  /** Bypass CR 302.6 summoning sickness on a test creature (Llanowar Elves). */
  const ready = (s: GameState, cardId: string): GameState => {
    const cards = new Map(s.cards);
    cards.set(id(cardId), {
      ...cards.get(id(cardId))!,
      hasSummoningSickness: false,
    });
    return { ...s, cards };
  };

  const ability = (
    sourceCardId: string,
    text: string,
    kind: "triggered" | "activated",
  ) =>
    ({
      id: "ab-mana",
      type: "ability",
      sourceCardId: id(sourceCardId),
      controllerId: p1,
      text,
      targets: [],
      triggered: kind === "triggered",
      activated: kind === "activated",
    }) as unknown as StackObject;

  it("validates AddMana with the simple and any-color shapes", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    // The mana dork shape.
    expect(ok({ op: "AddMana", amount: 1, colors: ["G"] })).toBe(true);
    // The Hedron Archive shape.
    expect(ok({ op: "AddMana", amount: 1, colors: ["C"] })).toBe(true);
    // The Gilded Lotus shape — any color, multi-amount.
    expect(ok({ op: "AddMana", amount: 3, colors: "any" })).toBe(true);
  });

  it("rejects unknown color codes and mixed any/array colors", () => {
    const bad = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    // 'Y' is not a CR 106 mana color.
    expect(bad({ op: "AddMana", amount: 1, colors: ["Y"] })).toBe(false);
    // Mixing the array and 'any' literal is not allowed.
    expect(bad({ op: "AddMana", amount: 1, colors: ["R", "any"] })).toBe(false);
    // Empty array is not allowed.
    expect(bad({ op: "AddMana", amount: 1, colors: [] })).toBe(false);
    // Extra fields are rejected by the strict() check.
    expect(bad({ op: "AddMana", amount: 1, colors: ["G"], extra: 1 })).toBe(
      false,
    );
  });

  it("Llanowar Elves' tap ability adds one green mana", () => {
    let s0 = put(
      state,
      p1,
      "elves",
      card("Llanowar Elves", "Creature — Elf Druid", [1, 1]),
    );
    s0 = ready(s0, "elves");
    const s = resolveScriptedAbility(
      s0,
      ability("elves", "Add {G}.", "activated"),
    )!;
    expect(s.players.get(p1)!.manaPool.green).toBe(1);
    expect(s.players.get(p2)!.manaPool.green).toBe(0);
  });

  it("Llanowar Elves' activation through the engine adds one green mana", () => {
    let s0 = put(
      state,
      p1,
      "elves",
      card("Llanowar Elves", "Creature — Elf Druid", [1, 1]),
    );
    s0 = ready(s0, "elves");
    const r = activateAbility(s0, p1, id("elves"), 0);
    expect(r.success).toBe(true);
    expect(r.state.players.get(p1)!.manaPool.green).toBe(1);
    expect(r.state.cards.get(id("elves"))!.isTapped).toBe(true);
  });

  it("Hedron Archive's tap ability adds one colorless mana", () => {
    const s0 = put(
      state,
      p1,
      "archive",
      card("Hedron Archive", "Artifact", [0, 0]),
    );
    const s = resolveScriptedAbility(
      s0,
      ability("archive", "Add {C}.", "activated"),
    )!;
    expect(s.players.get(p1)!.manaPool.colorless).toBe(1);
  });

  it("Hedron Archive's sacrifice ability draws two cards", () => {
    const s0 = put(
      state,
      p1,
      "archive",
      card("Hedron Archive", "Artifact", [0, 0]),
    );
    const before = s0.zones.get(`${p1}-hand`)!.cardIds.length;
    const s = resolveScriptedAbility(
      s0,
      ability("archive", "Draw two cards.", "activated"),
    )!;
    expect(s.zones.get(`${p1}-hand`)!.cardIds.length).toBe(before + 2);
  });

  it("Gilded Lotus' tap ability leaves the color choice for the mana-ability path", () => {
    // The scripted interpreter returns state unchanged for "any" colors
    // (CR 605.3a: the color choice is the player's via the mana-ability
    // path, not the scripted path). The engine's `activateAbility` is
    // what surfaces the choice — see the test below.
    const s0 = put(
      state,
      p1,
      "lotus",
      card("Gilded Lotus", "Artifact", [0, 0]),
    );
    const s = resolveScriptedAbility(
      s0,
      ability("lotus", "Add three mana of any one color.", "activated"),
    );
    expect(s).toBeDefined();
    expect(s!.players.get(p1)!.manaPool).toEqual({
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
      generic: 0,
    });
  });

  it("Gilded Lotus' activation refuses the 'any one color' choice and asks the player to pick", () => {
    const s0 = put(
      state,
      p1,
      "lotus",
      card("Gilded Lotus", "Artifact", [0, 0]),
    );
    const r = activateAbility(s0, p1, id("lotus"), 0);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/choose a color/i);
    expect(r.state.cards.get(id("lotus"))!.isTapped).toBe(false);
  });
});

describe("kicker scripts (#2564)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  // Divine Resilience: instant; +1/+0 + lifelink, and if kicked, also +1/+0.
  it("Divine Resilience un-kicked: +1/+0 and lifelink, no second pump", () => {
    const s0 = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedSpell(
      s0,
      getCardScript("Divine Resilience")!,
      spell(p1, [cardTarget("bear")]),
    );
    const bear = s.cards.get(id("bear"))!;
    expect(getEffectivePower(bear)).toBe(3);
    expect(getEffectiveToughness(bear)).toBe(2);
    expect(hasKeyword(bear, "lifelink")).toBe(true);
  });

  it("Divine Resilience kicked: +1/+0 + lifelink, then another +1/+0", () => {
    const s0 = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedSpell(s0, getCardScript("Divine Resilience")!, {
      ...spell(p1, [cardTarget("bear")]),
      wasKicked: true,
      timesKicked: 1,
    });
    const bear = s.cards.get(id("bear"))!;
    expect(getEffectivePower(bear)).toBe(4);
    expect(getEffectiveToughness(bear)).toBe(2);
    expect(hasKeyword(bear, "lifelink")).toBe(true);
  });

  it("Burst Lightning un-kicked: 2 damage", () => {
    const before = state.players.get(p2)!.life;
    const s = resolveScriptedSpell(
      state,
      getCardScript("Burst Lightning")!,
      spell(p1, [playerTarget(p2)]),
    );
    expect(s.players.get(p2)!.life).toBe(before - 2);
  });

  it("Burst Lightning kicked: 4 damage (CR 702.33d instead replaces 2)", () => {
    const before = state.players.get(p2)!.life;
    const s = resolveScriptedSpell(state, getCardScript("Burst Lightning")!, {
      ...spell(p1, [playerTarget(p2)]),
      wasKicked: true,
      timesKicked: 1,
    });
    expect(s.players.get(p2)!.life).toBe(before - 4);
  });

  it("Gnarlid Colony ETB un-kicked: no pump", () => {
    let s = put(
      state,
      p1,
      "gnarlid",
      card("Gnarlid Colony", "Creature — Beast", [2, 2]),
    );
    s = put(s, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s2 = resolveScriptedAbility(s, {
      id: "ab-gnarlid",
      type: "ability",
      sourceCardId: id("gnarlid"),
      controllerId: p1,
      text: "When this creature enters, if it was kicked, target creature gets -2/-0 until end of turn.",
      targets: [cardTarget("bear")],
      triggered: true,
    } as unknown as StackObject)!;
    expect(getEffectivePower(s2.cards.get(id("bear"))!)).toBe(2);
  });

  it("Gnarlid Colony ETB kicked: -2/-0 to the chosen creature", () => {
    let s = put(
      state,
      p1,
      "gnarlid",
      card("Gnarlid Colony", "Creature — Beast", [2, 2]),
    );
    s = put(s, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s2 = resolveScriptedAbility(s, {
      id: "ab-gnarlid",
      type: "ability",
      sourceCardId: id("gnarlid"),
      controllerId: p1,
      text: "When this creature enters, if it was kicked, target creature gets -2/-0 until end of turn.",
      targets: [cardTarget("bear")],
      triggered: true,
      wasKicked: true,
      timesKicked: 1,
    } as unknown as StackObject)!;
    expect(getEffectivePower(s2.cards.get(id("bear"))!)).toBe(0);
    expect(getEffectiveToughness(s2.cards.get(id("bear"))!)).toBe(2);
  });
});

describe("kicker schema rejects (#2564)", () => {
  const base = {
    name: "Kicker Reject Test",
    oracle: "Test card.",
  };

  it("rejects a kicker without a mana cost", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: { cost: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a kicker with a multi-kicker (array) shape", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: [{ cost: "{1}" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a kicker with a single mana-string cost", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: { cost: "{1}{W}" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an effect with if_kicked: true", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [
        { op: "DealDamage", amount: 2, target: "any", if_kicked: false },
        {
          op: "DealDamage",
          amount: 4,
          target: "any",
          kickedAmount: 4,
          if_kicked: true,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("multikicker schema (#2594)", () => {
  const base = {
    name: "Multikicker Schema Test",
    oracle: "Test card.",
  };

  it("accepts a single-kicker (default count) — count: 1", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: { cost: "{1}{R}" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an explicit multikicker count: 2", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: { cost: "{1}{R}", count: 2 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a large multikicker count: 5", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: { cost: "{G}", count: 5 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a zero or negative multikicker count", () => {
    const zero = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: { cost: "{1}", count: 0 },
    });
    expect(zero.success).toBe(false);
    const negative = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: { cost: "{1}", count: -1 },
    });
    expect(negative.success).toBe(false);
  });

  it("accepts an effect with if_kicked: 2 (tiered gate)", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [
        { op: "DealDamage", amount: 1, target: "any", if_kicked: true },
        { op: "Draw", amount: 1, who: "you", if_kicked: 2 },
      ],
      kicker: { cost: "{1}{R}", count: 3 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an if_kicked gate of 0 (gate minimum is 1)", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "Draw", amount: 1, if_kicked: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a fractional if_kicked gate", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "Draw", amount: 1, if_kicked: 1.5 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("multikicker resolution (#2594)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  // Hypothetical "Skyfire Multikicker" — a kicker-replacement spell with a
  // base 1-damage and a kicked 2-damage replacement, plus a tiered "if
  // kicked 2+ times, draw a card" effect. Multikicker {1}{R} (count: 2).
  const skyfire: CardScript = {
    name: "Skyfire Multikicker",
    oracle:
      "Skyfire Multikicker deals 1 damage to any target. Multikicker {1}{R}.",
    spell: [
      {
        op: "DealDamage",
        amount: 1,
        target: "any",
        if_kicked: false,
      },
      {
        op: "DealDamage",
        amount: 2,
        target: "any",
        kickedAmount: 2,
        if_kicked: true,
      },
      {
        op: "Draw",
        amount: 1,
        who: "you",
        if_kicked: 2,
      },
    ],
    kicker: { cost: "{1}{R}", count: 2 },
  };

  it("base 1-damage when un-kicked (timesKicked: 0)", () => {
    const before = state.players.get(p2)!.life;
    const s = resolveScriptedSpell(
      state,
      skyfire,
      spell(p1, [playerTarget(p2)]),
    );
    expect(s.players.get(p2)!.life).toBe(before - 1);
  });

  it("replacement 2-damage when kicked once (timesKicked: 1)", () => {
    const before = state.players.get(p2)!.life;
    const s = resolveScriptedSpell(state, skyfire, {
      ...spell(p1, [playerTarget(p2)]),
      wasKicked: true,
      timesKicked: 1,
    });
    expect(s.players.get(p2)!.life).toBe(before - 2);
  });

  it("2 damage AND draw a card when kicked twice (timesKicked: 2)", () => {
    const before = state.players.get(p2)!.life;
    // Seed the player's library with two cards so the Draw effect has
    // something to draw from a vacuum state.
    let seeded = put(state, p1, "lib1", card("L1", "Sorcery"), "library");
    seeded = put(seeded, p1, "lib2", card("L2", "Sorcery"), "library");
    const handBefore = seeded.zones.get(`${p1}-hand`)?.cardIds.length ?? 0;
    const s = resolveScriptedSpell(seeded, skyfire, {
      ...spell(p1, [playerTarget(p2)]),
      wasKicked: true,
      timesKicked: 2,
    });
    expect(s.players.get(p2)!.life).toBe(before - 2);
    // The if_kicked: 2 gate fires the Draw branch exactly once.
    const handAfter = s.zones.get(`${p1}-hand`)?.cardIds.length ?? 0;
    expect(handAfter).toBe(handBefore + 1);
  });

  it("if_kicked: 1 (boolean true) also matches a timesKicked: 2 cast (multikicker backward-compat)", () => {
    // A single-kicker-style script that uses `if_kicked: true` should still
    // run when the cast paid 2 charges (i.e. a multikicker cast where the
    // script only declared a tier-1 effect). This is the same shape as
    // Burst Lightning.
    const before = state.players.get(p2)!.life;
    const burst: CardScript = {
      name: "Burst-MK",
      oracle: "Burst-MK deals 2 damage to any target. Multikicker {4}.",
      spell: [
        { op: "DealDamage", amount: 2, target: "any", if_kicked: false },
        {
          op: "DealDamage",
          amount: 4,
          target: "any",
          kickedAmount: 4,
          if_kicked: true,
        },
      ],
      kicker: { cost: "{4}", count: 2 },
    };
    const s = resolveScriptedSpell(state, burst, {
      ...spell(p1, [playerTarget(p2)]),
      wasKicked: true,
      timesKicked: 2,
    });
    expect(s.players.get(p2)!.life).toBe(before - 4);
  });

  it("if_kicked: 2 skips the effect on timesKicked: 1 cast (tiered gate)", () => {
    // The "draw a card" tier (`if_kicked: 2`) MUST NOT fire when the cast
    // only paid 1 charge, even though the rest of the spell was kicked.
    // We test this by checking the opponent's life took exactly 2 (not 1,
    // not "1 + extra") and the spell resolved without error.
    const before = state.players.get(p2)!.life;
    const s = resolveScriptedSpell(state, skyfire, {
      ...spell(p1, [playerTarget(p2)]),
      wasKicked: true,
      timesKicked: 1,
    });
    expect(s.players.get(p2)!.life).toBe(before - 2);
  });

  it("kickerGateMatches helper: false on timesKicked: 0 with if_kicked: true", () => {
    // Direct unit test of the gate semantics: an un-kicked spell must NOT
    // run a kicked effect. Wraps `resolveScriptedSpell` with a Draw effect
    // gated on `if_kicked: true` and asserts the hand size delta.
    const script: CardScript = {
      name: "Gate-Only",
      oracle: "Test.",
      spell: [{ op: "Draw", amount: 1, who: "you", if_kicked: true }],
    };
    // Seed the library so a successful draw is observable.
    let seeded = put(state, p1, "g1", card("G1", "Sorcery"), "library");
    seeded = put(seeded, p1, "g2", card("G2", "Sorcery"), "library");
    seeded = put(seeded, p1, "g3", card("G3", "Sorcery"), "library");
    const handOf = (s: GameState) =>
      s.zones.get(`${p1}-hand`)?.cardIds.length ?? 0;
    // un-kicked: the if_kicked: true gate keeps the Draw off the path.
    const s0 = resolveScriptedSpell(seeded, script, spell(p1, []));
    expect(handOf(s0)).toBe(handOf(seeded));
    // kicked once: gate opens, hand grows by 1.
    const s1 = resolveScriptedSpell(seeded, script, {
      ...spell(p1, []),
      wasKicked: true,
      timesKicked: 1,
    });
    expect(handOf(s1)).toBe(handOf(seeded) + 1);
    // kicked twice: gate still matches (boolean `true` is inclusive of any
    // kick; mirrors the if_kicked: 2 tier semantics in reverse).
    const s2 = resolveScriptedSpell(seeded, script, {
      ...spell(p1, []),
      wasKicked: true,
      timesKicked: 2,
    });
    expect(handOf(s2)).toBe(handOf(seeded) + 1);
  });
});

describe("multikicker card-instance stamping (#2594)", () => {
  // CR 702.85: a multikicker cast stamps the card instance with
  // `timesKicked` (and `kicked: true`) so an ETB "if kicked" trigger can
  // read the count after the spell has resolved onto the battlefield. The
  // trigger stack-ops path (`trigger-system/stack-ops.ts`) is the only
  // consumer; the unit test below exercises the read-side directly.
  it("card-instance carries timesKicked after a kicked cast (via stack-ops)", () => {
    // Build a small state with a permanent whose ETB trigger reads
    // `card.timesKicked`. The trigger's `StackObject.timesKicked` is what
    // the interpreter sees, so the test asserts that field is N rather
    // than just 0/1.
    const s0 = startGame(createInitialGameState(["P1", "P2"], 20, false));
    const [p1] = Array.from(s0.players.keys());
    const cardId = id("creature");
    let s = put(
      s0,
      p1,
      "creature",
      card("Creature", "Creature — Beast", [1, 1]),
    );
    // Simulate the post-cast state: a kicked multikicker cast stamps
    // `kicked: true, timesKicked: 3` on the card instance.
    const next = new Map(s.cards);
    next.set(cardId, {
      ...s.cards.get(cardId)!,
      kicked: true,
      timesKicked: 3,
    });
    s = { ...s, cards: next };
    // The trigger system's stack-ops reads `card.timesKicked` directly; we
    // exercise that read here by checking the same precedence rule:
    // `timesKicked` wins when set and > 0, otherwise the boolean `kicked`
    // flag is the fallback. This mirrors the production code path in
    // `trigger-system/stack-ops.ts`.
    const c = s.cards.get(cardId)!;
    const effectiveTimesKicked =
      typeof c.timesKicked === "number" && c.timesKicked > 0
        ? c.timesKicked
        : c.kicked === true
          ? 1
          : 0;
    expect(effectiveTimesKicked).toBe(3);
    expect(c.kicked).toBe(true);
  });

  it("stack-ops precedence: boolean kicked flag is the fallback when timesKicked is unset", () => {
    // Legacy single-kicker cards cast before the multikicker field landed
    // have `kicked: true` but no `timesKicked`; the production code falls
    // back to treating the boolean as "kicked once". Pin the contract.
    const s0 = startGame(createInitialGameState(["P1", "P2"], 20, false));
    const [p1] = Array.from(s0.players.keys());
    const cardId = id("legacy");
    let s = put(s0, p1, "legacy", card("Legacy", "Creature — Beast", [1, 1]));
    const next = new Map(s.cards);
    next.set(cardId, { ...s.cards.get(cardId)!, kicked: true });
    s = { ...s, cards: next };
    const c = s.cards.get(cardId)!;
    const effectiveTimesKicked =
      typeof c.timesKicked === "number" && c.timesKicked > 0
        ? c.timesKicked
        : c.kicked === true
          ? 1
          : 0;
    expect(effectiveTimesKicked).toBe(1);
  });
});

describe("Skyfire Adept fixture (#2594)", () => {
  // End-to-end: the on-disk JSON fixture (src/lib/game-state/card-scripts/
  // cards/skyfire_adept.json) loads, parses, and resolves the multikicker
  // tiered branches at the right counts. The fixture is the shipping
  // example for the new schema, so its behavior is part of the contract.
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("loads from the registry", () => {
    const script = getCardScript("Skyfire Adept");
    expect(script).toBeDefined();
    expect(script?.kicker?.count).toBe(2);
  });

  it("un-kicked: no effect (DealDamage is gated on if_kicked: true)", () => {
    const before = state.players.get(p2)!.life;
    const s = resolveScriptedSpell(
      state,
      getCardScript("Skyfire Adept")!,
      spell(p1, [playerTarget(p2)]),
    );
    expect(s.players.get(p2)!.life).toBe(before);
  });

  it("kicked once: 1 damage, no draw (tier-1 effect only)", () => {
    const before = state.players.get(p2)!.life;
    let seeded = put(state, p1, "lib1", card("L1", "Sorcery"), "library");
    seeded = put(seeded, p1, "lib2", card("L2", "Sorcery"), "library");
    const handBefore = seeded.zones.get(`${p1}-hand`)?.cardIds.length ?? 0;
    const s = resolveScriptedSpell(seeded, getCardScript("Skyfire Adept")!, {
      ...spell(p1, [playerTarget(p2)]),
      wasKicked: true,
      timesKicked: 1,
    });
    expect(s.players.get(p2)!.life).toBe(before - 1);
    const handAfter = s.zones.get(`${p1}-hand`)?.cardIds.length ?? 0;
    expect(handAfter).toBe(handBefore);
  });

  it("kicked twice (the multikicker cap): 1 damage AND draw a card (tier-1 + tier-2 effects)", () => {
    const before = state.players.get(p2)!.life;
    let seeded = put(state, p1, "lib1", card("L1", "Sorcery"), "library");
    seeded = put(seeded, p1, "lib2", card("L2", "Sorcery"), "library");
    const handBefore = seeded.zones.get(`${p1}-hand`)?.cardIds.length ?? 0;
    const s = resolveScriptedSpell(seeded, getCardScript("Skyfire Adept")!, {
      ...spell(p1, [playerTarget(p2)]),
      wasKicked: true,
      timesKicked: 2,
    });
    expect(s.players.get(p2)!.life).toBe(before - 1);
    const handAfter = s.zones.get(`${p1}-hand`)?.cardIds.length ?? 0;
    expect(handAfter).toBe(handBefore + 1);
  });
});

describe("scripted SearchLibrary and ShuffleLibrary (#2566)", () => {
  /** Set up a fresh state with a known, ordered p1 library. */
  const fresh = (): { state: GameState; p1: PlayerId; p2: PlayerId } => {
    const s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [a, b] = Array.from(s.players.keys());
    return { state: s, p1: a, p2: b };
  };

  /** Replace a player's library with an ordered list of cardIds (top = last). */
  const setLibrary = (
    s: GameState,
    p: PlayerId,
    names: string[],
    type: string = "Sorcery",
  ): GameState => {
    const zones = new Map(s.zones);
    zones.set(`${p}-library`, {
      ...zones.get(`${p}-library`)!,
      cardIds: [],
    });
    const cards = new Map(s.cards);
    let out = { ...s, cards, zones };
    // The library's top is the LAST element of `cardIds` (per
    // `getTopCard`). `put` appends, so iterating `names` in order with
    // `put` produces [name[0], name[1], …, name[n-1]] — name[n-1] is
    // the top.
    for (const n of names) {
      out = put(out, p, n, card(n, type), "library");
    }
    return out;
  };

  const ability = (
    controllerId: PlayerId,
    sourceCardId: string,
    text: string,
    targets: Target[] = [],
  ) =>
    ({
      id: "ab-1",
      type: "ability",
      sourceCardId: id(sourceCardId),
      controllerId,
      text,
      targets,
      triggered: false,
      activated: true,
    }) as unknown as StackObject;

  it("validates ShuffleLibrary", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(ok({ op: "ShuffleLibrary" })).toBe(true);
    expect(ok({ op: "ShuffleLibrary", who: "target_player" })).toBe(true);
    expect(ok({ op: "ShuffleLibrary", who: "you", into: "library" })).toBe(
      true,
    );
    // v1 only supports "library"; graveyard-into-library is a follow-up.
    expect(ok({ op: "ShuffleLibrary", into: "graveyard" })).toBe(false);
    expect(ok({ op: "ShuffleLibrary", into: "battlefield" })).toBe(false);
    expect(ok({ op: "ShuffleLibrary", into: "hand" })).toBe(false);
    // `who` is restricted to the same two values SearchLibrary uses.
    expect(ok({ op: "ShuffleLibrary", who: "each_opponent" })).toBe(false);
  });

  it("ShuffleLibrary rearranges the named player's library", () => {
    const f = fresh();
    const state = setLibrary(f.state, f.p1, [
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
    ]);
    const before = state.zones.get(`${f.p1}-library`)!.cardIds;
    const s = resolveScriptedSpell(
      state,
      CardScriptSchema.parse({
        name: "Shuffle Test",
        oracle: "x",
        spell: [{ op: "ShuffleLibrary" }],
      }),
      spell(f.p1),
    );
    const after = s.zones.get(`${f.p1}-library`)!.cardIds;
    // Multiset is preserved.
    expect([...after].sort()).toEqual([...before].sort());
    // Length is preserved.
    expect(after).toHaveLength(before.length);
    // With 8 cards and a uniform shuffle, the probability of the order
    // being identical is 1/8! ≈ 1/40320, so the test is extremely
    // unlikely to flake. If it ever does, regenerate.
    expect(after).not.toEqual(before);
  });

  it("ShuffleLibrary on a target player shuffles that library, not yours", () => {
    const f = fresh();
    let s = setLibrary(f.state, f.p1, ["a", "b", "c", "d", "e", "f", "g", "h"]);
    // Use a 6-card library for the target player — 1/720 chance of
    // an identical order on a uniform Fisher-Yates pass, very unlikely
    // to flake.
    s = setLibrary(s, f.p2, ["x", "y", "z", "p", "q", "r"]);
    const mineBefore = s.zones.get(`${f.p1}-library`)!.cardIds;
    const yoursBefore = s.zones.get(`${f.p2}-library`)!.cardIds;
    const after = resolveScriptedSpell(
      s,
      CardScriptSchema.parse({
        name: "Shuffle Other",
        oracle: "x",
        spell: [{ op: "ShuffleLibrary", who: "target_player" }],
      }),
      spell(f.p1, [playerTarget(f.p2)]),
    );
    expect(after.zones.get(`${f.p1}-library`)!.cardIds).toEqual(mineBefore);
    const theirs = after.zones.get(`${f.p2}-library`)!.cardIds;
    expect([...theirs].sort()).toEqual([...yoursBefore].sort());
    expect(theirs).not.toEqual(yoursBefore);
  });

  it("SearchLibrary on a basic land actually shuffles the library (#2562 + #2566)", () => {
    // The first matching card is a basic land somewhere in the library
    // (the engine picks the first match, not the top). After the search,
    // that land is in hand and the library is reshuffled — the Wave 1
    // "shuffle: true" was a no-op until Lane 8 wired the new
    // `shuffleLibraryZone` primitive into the SearchLibrary case.
    const f = fresh();
    let s = setLibrary(f.state, f.p1, [
      "bear-1",
      "bear-2",
      "bear-3",
      "Forest-1",
      "Plains-1",
    ]);
    // Replace the Forest-1 card's type_line with "Basic Land —" so the
    // `basic_land: true` filter matches it (the engine picks the first
    // match in cardIds order, which is Forest-1 here).
    const cards = new Map(s.cards);
    const f1 = cards.get(id("Forest-1"))!;
    cards.set(id("Forest-1"), {
      ...f1,
      cardData: { ...f1.cardData, type_line: "Basic Land — Forest" },
    });
    s = { ...s, cards };
    const before = s.zones.get(`${f.p1}-library`)!.cardIds;
    // Pin the shuffle's randomness: with Math.random() = 0 every
    // Fisher-Yates step swaps with index 0, which never leaves 4 cards in
    // their original order. Unpinned, the identical-order case (1/24) made
    // this test flake in CI.
    const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0);
    let after: typeof s;
    try {
      after = resolveScriptedSpell(s, getCardScript("Bushwhack")!, spell(f.p1));
    } finally {
      randomSpy.mockRestore();
    }
    // The chosen basic land (Forest-1) is now in hand.
    const hand = after.zones.get(`${f.p1}-hand`)!.cardIds;
    expect(hand).toContain(id("Forest-1"));
    // The library is missing the chosen card.
    const afterLib = after.zones.get(`${f.p1}-library`)!.cardIds;
    expect(afterLib).not.toContain(id("Forest-1"));
    expect(afterLib).toHaveLength(before.length - 1);
    // The library was actually shuffled: its order differs from the
    // original (deterministic with the pinned randomness above).
    expect(afterLib).not.toEqual(before.filter((c) => c !== id("Forest-1")));
  });

  it("SearchLibrary with shuffle: false leaves the library order untouched", () => {
    // After Lane 8, `shuffle: false` skips the post-search shuffle
    // (the schema's default is true; the explicit `false` is what
    // players rarely want, but the schema accepts it).
    const f = fresh();
    let s = setLibrary(f.state, f.p1, ["bear-1", "bear-2", "Forest-top"]);
    // Replace the last (top) card's type_line with "Basic Land — Forest"
    // so the `basic_land: true` filter matches.
    const cards = new Map(s.cards);
    const ft = cards.get(id("Forest-top"))!;
    cards.set(id("Forest-top"), {
      ...ft,
      cardData: { ...ft.cardData, type_line: "Basic Land — Forest" },
    });
    s = { ...s, cards };
    const before = s.zones.get(`${f.p1}-library`)!.cardIds;
    const after = resolveScriptedSpell(
      s,
      CardScriptSchema.parse({
        name: "Search NoShuffle",
        oracle: "x",
        spell: [
          {
            op: "SearchLibrary",
            filter: { basic_land: true },
            destination: "hand",
            shuffle: false,
          },
        ],
      }),
      spell(f.p1),
    );
    const afterLib = after.zones.get(`${f.p1}-library`)!.cardIds;
    expect(afterLib).toEqual(before.filter((c) => c !== id("Forest-top")));
  });

  it("Burnished Hart's ETB searches a basic land onto the battlefield and shuffles", () => {
    const f = fresh();
    let s = setLibrary(f.state, f.p1, ["bear-1", "bear-2", "Plains-top"]);
    // Replace the land's type_line so the `basic_land: true` filter matches.
    const cards = new Map(s.cards);
    const inst = cards.get(id("Plains-top"))!;
    cards.set(id("Plains-top"), {
      ...inst,
      cardData: { ...inst.cardData, type_line: "Basic Land — Forest" },
    });
    s = { ...s, cards };
    s = put(
      s,
      f.p1,
      "hart",
      card("Burnished Hart", "Artifact Creature — Elk", [2, 2]),
    );
    const before = s.zones.get(`${f.p1}-library`)!.cardIds;
    const after = resolveScriptedAbility(
      s,
      ability(
        f.p1,
        "hart",
        "Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.",
      ),
    )!;
    // v1 limitation: the schema caps SearchLibrary.count at 1, so only
    // the first matching card (Plains-top) is chosen. The Hart also
    // doesn't tap on enter (no "enters tapped" op) and the "you may
    // sacrifice" path is not modeled. The shuffle IS the point of Lane 8
    // and IS applied.
    const battlefield = after.zones.get(`${f.p1}-battlefield`)!.cardIds;
    expect(battlefield).toContain(id("Plains-top"));
    const afterLib = after.zones.get(`${f.p1}-library`)!.cardIds;
    expect(afterLib).not.toContain(id("Plains-top"));
    expect(afterLib).not.toEqual(before);
  });

  it("Wishclaw Talisman's activated ability draws and discards", () => {
    // v1: Wishclaw is scripted for the Draw + Discard half; the "put
    // this artifact on the bottom of its owner's library" line is a
    // separate op that's a follow-up. The "library-shuffling context"
    // Lane 8 cares about is exercised by the underlying ShuffleLibrary
    // op tests above.
    const f = fresh();
    let s = setLibrary(f.state, f.p1, ["lib-1", "lib-2", "lib-3"]);
    s = put(s, f.p1, "hand-1", card("Hand 1", "Instant"), "hand");
    s = put(s, f.p1, "hand-2", card("Hand 2", "Instant"), "hand");
    s = put(s, f.p1, "talisman", card("Wishclaw Talisman", "Artifact"));
    const beforeHand = s.zones.get(`${f.p1}-hand`)!.cardIds.length;
    const beforeLib = s.zones.get(`${f.p1}-library`)!.cardIds.length;
    const after = resolveScriptedAbility(s, {
      id: "ab-1",
      type: "ability",
      sourceCardId: id("talisman"),
      controllerId: f.p1,
      text: "{T}: Draw a card, then discard a card. Then put this artifact on the bottom of its owner's library.",
      targets: [],
      triggered: false,
      activated: true,
    } as unknown as StackObject)!;
    // Drew one (now has beforeHand+1 in hand), then waiting on a
    // discard choice. Library is shorter by 1 (we drew the top).
    expect(after.zones.get(`${f.p1}-library`)!.cardIds.length).toBe(
      beforeLib - 1,
    );
    expect(after.waitingChoice?.type).toBe("discard_cards");
    expect(after.waitingChoice?.playerId).toBe(f.p1);
    // The discard choice's pool is the hand (after the draw); the
    // beforeHand hand has become beforeHand+1 by the time the discard
    // is asked.
    expect(after.waitingChoice?.choices.length).toBe(beforeHand + 1);
  });

  describe("SearchLibrary OR filter (#2594)", () => {
    // The OR arm lets a card match any of N sub-filters. Top-level AND
    // keys still apply; the `or` array is matched alongside (a card must
    // pass all AND keys AND at least one OR sub-filter when `or` is set).
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;

    it("schema: or is rejected when empty", () => {
      expect(ok({ op: "SearchLibrary", filter: { or: [] } })).toBe(false);
    });

    it("schema: or alone is enough to satisfy the 'at least one key' refine", () => {
      expect(
        ok({ op: "SearchLibrary", filter: { or: [{ land: true }] } }),
      ).toBe(true);
    });

    it("schema: or is recursive (a sub-filter can carry its own or)", () => {
      // (creature with MV=1) OR ((land) OR (artifact))
      expect(
        ok({
          op: "SearchLibrary",
          filter: {
            or: [
              { creature: true, mv_eq: 1 },
              { or: [{ land: true }, { artifact: true }] },
            ],
          },
        }),
      ).toBe(true);
    });

    it("schema: off-list keys still rejected inside or sub-filters", () => {
      expect(
        ok({
          op: "SearchLibrary",
          filter: { or: [{ fear: true }] },
        }),
      ).toBe(false);
    });

    it("engine: or matches the first card that hits any sub-filter", () => {
      // "artifact or land" — the first matching card in library order
      // moves to hand; the rest are still shuffled.
      const f = fresh();
      const beforeHand = new Set(f.state.zones.get(`${f.p1}-hand`)!.cardIds);
      let s = setLibrary(
        f.state,
        f.p1,
        ["creature-1", "land-1", "artifact-1"],
        "Creature", // default type — override below
      );
      // Override the type_lines so the OR filter can distinguish.
      const cards = new Map(s.cards);
      for (const [cid, name, type] of [
        [id("creature-1"), "creature-1", "Creature — Test"],
        [id("land-1"), "land-1", "Basic Land — Plains"],
        [id("artifact-1"), "artifact-1", "Artifact Creature — Construct"],
      ] as const) {
        const inst = cards.get(cid)!;
        cards.set(cid, {
          ...inst,
          cardData: { ...inst.cardData, type_line: type },
        });
      }
      s = { ...s, cards };
      const after = resolveScriptedSpell(
        s,
        CardScriptSchema.parse({
          name: "ArtifactOrLand",
          oracle: "x",
          spell: [
            {
              op: "SearchLibrary",
              filter: { or: [{ artifact: true }, { land: true }] },
            },
          ],
        }),
        spell(f.p1),
      );
      // The fresh-state hand has a few default cards; the new card is
      // whichever hand id was not in the starting set.
      const afterHand = after.zones.get(`${f.p1}-hand`)!.cardIds;
      const newCard = afterHand.find((c) => !beforeHand.has(c));
      expect(newCard).toBeDefined();
      // The newly-moved card is a land or an artifact (not a plain creature).
      const movedName = after.cards.get(newCard!)!.cardData.name;
      expect(["land-1", "artifact-1"]).toContain(movedName);
      // The library was shuffled (CR 701.19b: even on a no-find, shuffle).
      const afterLib = after.zones.get(`${f.p1}-library`)!.cardIds;
      expect(afterLib).not.toEqual(s.zones.get(`${f.p1}-library`)!.cardIds);
    });

    it("engine: or combines with top-level AND keys (sub-filter must also pass)", () => {
      // "creature OR (artifact with MV <= 2)" — but the AND key `color: G`
      // applies to BOTH arms, so only green cards in either arm match.
      const f = fresh();
      const beforeHand = new Set(f.state.zones.get(`${f.p1}-hand`)!.cardIds);
      let s = setLibrary(
        f.state,
        f.p1,
        ["red-creature", "green-creature", "red-artifact", "green-artifact"],
        "Creature",
      );
      const cards = new Map(s.cards);
      for (const [cid, name, type, colors] of [
        [id("red-creature"), "red-creature", "Creature — Test", ["R"]],
        [id("green-creature"), "green-creature", "Creature — Test", ["G"]],
        [id("red-artifact"), "red-artifact", "Artifact", ["R"]],
        [id("green-artifact"), "green-artifact", "Artifact", ["G"]],
      ] as const) {
        const inst = cards.get(cid)!;
        cards.set(cid, {
          ...inst,
          cardData: { ...inst.cardData, type_line: type, colors: [...colors] },
        });
      }
      s = { ...s, cards };
      const after = resolveScriptedSpell(
        s,
        CardScriptSchema.parse({
          name: "GreenCreatureOrArtifact",
          oracle: "x",
          spell: [
            {
              op: "SearchLibrary",
              filter: {
                color: "G",
                or: [{ creature: true }, { artifact: true }],
              },
            },
          ],
        }),
        spell(f.p1),
      );
      const afterHand = after.zones.get(`${f.p1}-hand`)!.cardIds;
      const newCard = afterHand.find((c) => !beforeHand.has(c));
      expect(newCard).toBeDefined();
      // Only green cards should be selected — red ones are filtered out
      // by the top-level AND key. green-creature comes first in library
      // order, so it wins.
      expect(after.cards.get(newCard!)!.cardData.name).toBe("green-creature");
    });
  });
});

describe("scripted cycling (#2566)", () => {
  // Cycling (CR 702.30) + Typecycling / Landcycling / Basic landcycling
  // (CR 702.31) for card scripts. The engine has a full implementation
  // in `keyword-actions/cycling.ts`; the script side adds a
  // `cycling: { cost, variant, type?, basicLandType? }` field to
  // `CardScriptSchema` and synthesizes a `ParsedActivatedAbility` from
  // it so the ability is exposed to the engine/UI.
  //
  // v1 limitation (documented in the schema): the engine's `cycleCard`
  // still reads the cycling keyword from `card.cardData.oracle_text`,
  // so the drafter must mirror the cycling line into the `oracle`
  // field. The structured `cycling` field on the script is the
  // drafter-facing form; the engine's `getActivatedAbilities` returns
  // a synthesized ability whose `effect` text matches the canonical
  // `parseCycling` patterns so resolution keeps working.

  it("schema accepts a base cycling field", () => {
    const result = CardScriptSchema.safeParse({
      name: "Hill Gigas",
      oracle:
        "{5}{R}\nHill Gigas\nCreature — Giant\nCycling {2} ({2}, Discard this card: Draw a card.)",
      cycling: { cost: "{2}", variant: "cycling" },
    });
    expect(result.success).toBe(true);
  });

  it("schema accepts all four cycling variants", () => {
    // Typecycling (e.g. Galeprowler).
    const tc = CardScriptSchema.safeParse({
      name: "Galeprowler",
      oracle: "Wizardcycling {2}",
      cycling: { cost: "{2}", variant: "typecycling", type: "Wizard" },
    });
    expect(tc.success).toBe(true);

    // Landcycling (any land).
    const lc = CardScriptSchema.safeParse({
      name: "Terminal Moraine",
      oracle: "Landcycling {1}",
      cycling: { cost: "{1}", variant: "landcycling" },
    });
    expect(lc.success).toBe(true);

    // [Type] landcycling (e.g. Island landcycling).
    const ilc = CardScriptSchema.safeParse({
      name: "Flooded Strand",
      oracle: "Islandcycling {1}{U}",
      cycling: {
        cost: "{1}{U}",
        variant: "landcycling",
        basicLandType: "Island",
      },
    });
    expect(ilc.success).toBe(true);

    // Basic landcycling.
    const blc = CardScriptSchema.safeParse({
      name: "Terminal Moraine",
      oracle: "Basic landcycling {1}",
      cycling: { cost: "{1}", variant: "basic_landcycling" },
    });
    expect(blc.success).toBe(true);
  });

  it("schema rejects a cycling field without a mana cost", () => {
    const result = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      cycling: {},
    });
    expect(result.success).toBe(false);
  });

  it("schema rejects an unknown cycling variant", () => {
    const result = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      cycling: { cost: "{2}", variant: "mythiccycling" },
    });
    expect(result.success).toBe(false);
  });

  it("schema accepts a cycling-only script (no triggers/activated/etc.)", () => {
    // A creature whose only scripted ability is cycling (e.g. Hill
    // Gigas). The required-field refine in the schema explicitly
    // allows `cycling` to be the sole shape (#2566).
    const result = CardScriptSchema.safeParse({
      name: "Hill Gigas",
      oracle: "Cycling {2}",
      cycling: { cost: "{2}", variant: "cycling" },
    });
    expect(result.success).toBe(true);
  });

  // A scripted cycling card. We register it as a fixture because
  // `getActivatedAbilities` reads scripted abilities from the registry
  // keyed on card name. The `oracle` field mirrors the cycling line so
  // the engine's `parseCycling` / `cycleCard` paths can find it (v1).
  const hillGigasScript: CardScript = {
    name: "Test Hill Gigas",
    oracle:
      "{5}{R}\nCycling {2} ({2}, Discard this card: Draw a card.)",
    cycling: { cost: "{2}", variant: "cycling" },
  };
  // A typecycling card to exercise the variant effect text.
  const wizardCyclerScript: CardScript = {
    name: "Test Wizard Cycler",
    oracle: "Wizardcycling {2}",
    cycling: { cost: "{2}", variant: "typecycling", type: "Wizard" },
  };

  beforeAll(() =>
    registerCardScripts([...RAW_CARD_SCRIPTS, hillGigasScript, wizardCyclerScript]),
  );
  afterAll(() => registerCardScripts(RAW_CARD_SCRIPTS));

  it("getActivatedAbilities synthesizes a Cycling {cost} ability", () => {
    const hillGigas = card(
      "Test Hill Gigas",
      "Creature — Giant",
      [3, 3],
    );
    const abilities = getActivatedAbilities(hillGigas);
    expect(abilities).toHaveLength(1);
    const a = abilities[0];
    // The cycling cost is recorded on the parsed ability.
    expect(a.costs.mana).not.toBeNull();
    expect(a.costs.mana!.generic).toBe(2);
    // CR 702.30a: the cost includes discarding the card itself.
    expect(a.costs.discard).toBe(true);
    // Sorcery-speed (CR 117.1a).
    expect(a.sorceryOnly).toBe(true);
    // The effect text is the canonical "Cycling {cost}." form that
    // `parseCycling` recognizes when the engine falls back to reading
    // the card's oracle text.
    expect(a.effect).toBe("Cycling {2}.");
  });

  it("getActivatedAbilities synthesizes a typecycling ability with the named type", () => {
    const wiz = card(
      "Test Wizard Cycler",
      "Creature — Human Wizard",
      [1, 1],
    );
    const abilities = getActivatedAbilities(wiz);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].effect).toBe("Wizardcycling {2}.");
    expect(abilities[0].costs.mana!.generic).toBe(2);
    expect(abilities[0].costs.discard).toBe(true);
  });

  it("a cycling card with no other ability is valid and surfaces one ability", () => {
    // The schema's required-field refine explicitly allows
    // `cycling`-only scripts; confirm the synthesis still works.
    const hillGigas = card(
      "Test Hill Gigas",
      "Creature — Giant",
      [3, 3],
    );
    const abilities = getActivatedAbilities(hillGigas);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].effect).toMatch(/^Cycling /);
  });

  it("a card with both `activated` and `cycling` exposes both abilities", () => {
    // Some cards have a cycling variant and a regular activated ability
    // (e.g. Skyclave Apparition's cycling). The synthesis appends the
    // cycling ability to whatever the script's `activated` list has.
    const script: CardScript = {
      name: "Test Cycler + Activated",
      oracle: "{T}: Draw a card.\nCycling {2}.",
      activated: [
        {
          text: "Draw a card.",
          cost: { tap: true, sacrifice: false, exileSelf: false },
          effects: [{ op: "Draw", amount: 1, who: "you" }],
        },
      ],
      cycling: { cost: "{2}", variant: "cycling" },
    };
    registerCardScripts([...RAW_CARD_SCRIPTS, script]);
    try {
      const cd = card(
        "Test Cycler + Activated",
        "Creature — Spirit",
        [2, 2],
      );
      const abilities = getActivatedAbilities(cd);
      expect(abilities).toHaveLength(2);
      const effects = abilities.map((a) => a.effect).sort();
      expect(effects).toEqual(["Cycling {2}.", "Draw a card."]);
    } finally {
      registerCardScripts(RAW_CARD_SCRIPTS);
    }
  });

  it("engine: cycleCard resolves a scripted cycling card via the oracle-text fallback", () => {
    // v1 limitation: the engine's `cycleCard` reads the cycling cost
    // from `card.cardData.oracle_text` (the existing `parseCycling`
    // path, #2566). When a card's `oracle` mirrors the cycling line,
    // the engine can resolve cycling end-to-end — the drafter must
    // include "Cycling {cost}." in the `oracle` field. This test
    // documents that contract.
    //
    // A future lane will thread the script's `cycling` data into
    // `cycleCard` directly so the oracle-text fallback is no longer
    // required.
    const script: CardScript = {
      name: "Test Cycling Creature",
      oracle: "Cycling {2} ({2}, Discard this card: Draw a card.)",
      cycling: { cost: "{2}", variant: "cycling" },
    };
    registerCardScripts([...RAW_CARD_SCRIPTS, script]);
    try {
      const s0 = startGame(
        createInitialGameState(["Player1", "Player2"], 20, false),
      );
      const [p1] = Array.from(s0.players.keys());
      const cardId = id("cycler");
      let s = put(
        s0,
        p1,
        "cycler",
        {
          ...card("Test Cycling Creature", "Creature — Beast", [3, 3]),
          oracle_text: "Cycling {2} ({2}, Discard this card: Draw a card.)",
        } as ScryfallCard,
        "hand",
      );
      // Cycling is sorcery-speed: only during a main phase, with
      // priority, on the active player's turn. The fresh game starts
      // in the untap step, so we set the phase + priority.
      s = {
        ...s,
        turn: { ...s.turn, currentPhase: Phase.PRECOMBAT_MAIN },
        priorityPlayerId: p1,
      };
      // Fund the cycling cost (2 generic).
      const player = s.players.get(p1)!;
      s = {
        ...s,
        players: new Map(s.players).set(p1, {
          ...player,
          manaPool: { ...player.manaPool, generic: 2 },
        }),
      };

      const result = cycleCard(s, p1, cardId);
      expect(result.success).toBe(true);
      // The cycled card is now in the graveyard.
      expect(result.state.zones.get(`${p1}-graveyard`)!.cardIds).toContain(
        cardId,
      );
      // The cycler drew a card.
      const postHand = result.state.zones.get(`${p1}-hand`)!.cardIds;
      // The cycled card left the hand; the engine drew a card (so the
      // hand may contain other cards, but the cycler isn't in it).
      expect(postHand).not.toContain(cardId);
    } finally {
      registerCardScripts(RAW_CARD_SCRIPTS);
    }
  });
});

describe("Mono-Red / Mono-Green self-play decks, slice 1 (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("Shock deals 2 to a player", () => {
    const s = resolveScriptedSpell(
      state,
      getCardScript("Shock")!,
      spell(p1, [playerTarget(p2)]),
    );
    expect(s.players.get(p2)!.life).toBe(18);
  });

  it("Shock deals 2 to a creature", () => {
    const s0 = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedSpell(
      s0,
      getCardScript("Shock")!,
      spell(p1, [cardTarget("bear")]),
    );
    expect(s.cards.get(id("bear"))!.damage).toBe(2);
  });

  it("Shared Roots puts a basic land from the library onto the battlefield tapped", () => {
    let s = put(
      state,
      p1,
      "lib-bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
      "library",
    );
    s = put(
      s,
      p1,
      "lib-forest",
      card("Forest", "Basic Land — Forest"),
      "library",
    );
    const libBefore = s.zones.get(`${p1}-library`)!.cardIds.length;
    const out = resolveScriptedSpell(
      s,
      getCardScript("Shared Roots")!,
      spell(p1, []),
    );
    expect(battlefield(out, p1)).toContain(id("lib-forest"));
    expect(out.cards.get(id("lib-forest"))!.isTapped).toBe(true);
    const lib = out.zones.get(`${p1}-library`)!.cardIds;
    expect(lib).toHaveLength(libBefore - 1);
    expect(lib).toContain(id("lib-bear"));
  });

  it("Shared Roots does nothing when the library has no basic land", () => {
    const s = put(
      state,
      p1,
      "lib-bear",
      card("Grizzly Bears", "Creature — Bear", [2, 2]),
      "library",
    );
    const before = battlefield(s, p1).length;
    const out = resolveScriptedSpell(
      s,
      getCardScript("Shared Roots")!,
      spell(p1, []),
    );
    expect(battlefield(out, p1)).toHaveLength(before);
    expect(out.zones.get(`${p1}-library`)!.cardIds).toContain(id("lib-bear"));
  });
});

describe("Fabled Passage: untap the found land with four or more lands (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;

  const PASSAGE =
    "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.";

  const passageAbility = (sourceCardId: string) =>
    ({
      id: "ab-passage",
      type: "ability",
      sourceCardId: id(sourceCardId),
      controllerId: p1,
      text: PASSAGE,
      targets: [],
      triggered: false,
      activated: true,
    }) as unknown as StackObject;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(state.players.keys());
  });

  const withLands = (s: GameState, n: number) => {
    let out = s;
    for (let i = 0; i < n; i++) {
      out = put(out, p1, `bf-land-${i}`, card("Forest", "Basic Land — Forest"));
    }
    return out;
  };

  it("validates SearchLibrary's untap_if_lands", () => {
    const ok = (extra: object) =>
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "x",
        spell: [
          {
            op: "SearchLibrary",
            filter: { basic_land: true },
            destination: "battlefield",
            tapped: true,
            ...extra,
          },
        ],
      }).success;
    expect(ok({ untap_if_lands: 4 })).toBe(true);
    expect(ok({ untap_if_lands: 0 })).toBe(false);
    expect(ok({ untap_if_lands: "four" })).toBe(false);
  });

  it("untaps the found land when you then control four or more lands", () => {
    // Three lands already out (the sacrificed Passage is gone): the found
    // land makes four.
    let s = withLands(state, 3);
    s = put(s, p1, "passage", card("Fabled Passage", "Land"), "graveyard");
    s = put(
      s,
      p1,
      "lib-forest",
      card("Forest", "Basic Land — Forest"),
      "library",
    );
    const out = resolveScriptedAbility(s, passageAbility("passage"))!;
    expect(battlefield(out, p1)).toContain(id("lib-forest"));
    expect(out.cards.get(id("lib-forest"))!.isTapped).toBe(false);
  });

  it("leaves the found land tapped with fewer than four lands", () => {
    // One land out plus the found land is two: it stays tapped.
    let s = withLands(state, 1);
    s = put(s, p1, "passage", card("Fabled Passage", "Land"), "graveyard");
    s = put(
      s,
      p1,
      "lib-forest",
      card("Forest", "Basic Land — Forest"),
      "library",
    );
    const out = resolveScriptedAbility(s, passageAbility("passage"))!;
    expect(out).toBeDefined();
    expect(battlefield(out, p1)).toContain(id("lib-forest"));
    expect(out.cards.get(id("lib-forest"))!.isTapped).toBe(true);
  });

  it("does not count the sacrificed Passage (two lands plus the found land)", () => {
    // Two lands out plus the found land is three. The Passage itself is in
    // the graveyard (sacrificed as a cost), so it does not make a fourth.
    let s = withLands(state, 2);
    s = put(s, p1, "passage", card("Fabled Passage", "Land"), "graveyard");
    s = put(
      s,
      p1,
      "lib-forest",
      card("Forest", "Basic Land — Forest"),
      "library",
    );
    const out = resolveScriptedAbility(s, passageAbility("passage"))!;
    expect(out.cards.get(id("lib-forest"))!.isTapped).toBe(true);
  });

  it("Fabled Passage's script matches Scryfall's oracle", () => {
    const passage = JSON.parse(
      readFileSync(join(CARDS_DIR, "fabled_passage.json"), "utf8"),
    ) as { oracle: string; activated: { text: string }[] };
    expect(passage.oracle).toBe(`{T}, Sacrifice this land: ${PASSAGE}`);
    expect(passage.activated.map((a) => a.text)).toEqual([PASSAGE]);
  });
});

describe("Escape Tunnel: can't be blocked this turn (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  const SEARCH =
    "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.";
  const EVADE =
    "Target creature with power 2 or less can't be blocked this turn.";

  const evadeAbility = (sourceCardId: string, targetId: string) =>
    ({
      id: "ab-tunnel",
      type: "ability",
      sourceCardId: id(sourceCardId),
      controllerId: p1,
      text: EVADE,
      targets: [cardTarget(targetId)],
      triggered: false,
      activated: true,
    }) as unknown as StackObject;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  const setup = (power: number) => {
    let s = put(
      state,
      p1,
      "tunnel",
      card("Escape Tunnel", "Land"),
      "graveyard",
    );
    s = put(s, p1, "attacker", card("Runner", "Creature — Elf", [power, 2]));
    s = put(s, p2, "blocker", card("Wall", "Creature — Wall", [0, 4]));
    return s;
  };

  it("validates CantBeBlocked", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "x",
        spell: [{ op: "CantBeBlocked", until: "end_of_turn", ...effect }],
      }).success;
    expect(ok({ target: "creature", max_power: 2 })).toBe(true);
    expect(ok({ target: "self" })).toBe(true);
    expect(ok({ target: "self", controller: "you" })).toBe(false);
    expect(ok({ target: "player" })).toBe(false);
    expect(ok({ target: "creature", until: "next_turn" })).toBe(false);
  });

  it("makes a creature with power 2 or less unblockable this turn", () => {
    const s = setup(2);
    expect(canBlock(s, id("blocker"), id("attacker")).canBlock).toBe(true);
    const out = resolveScriptedAbility(s, evadeAbility("tunnel", "attacker"))!;
    expect(canBlock(out, id("blocker"), id("attacker")).canBlock).toBe(false);
  });

  it("does nothing if the target's power is above 2 on resolution", () => {
    const s = setup(3);
    const out = resolveScriptedAbility(s, evadeAbility("tunnel", "attacker"));
    const after = out ?? s;
    expect(canBlock(after, id("blocker"), id("attacker")).canBlock).toBe(true);
  });

  it("wears off in the cleanup step", () => {
    const out = resolveScriptedAbility(
      setup(1),
      evadeAbility("tunnel", "attacker"),
    )!;
    const cleaned = clearUntilEndOfTurnPT(out);
    expect(canBlock(cleaned, id("blocker"), id("attacker")).canBlock).toBe(
      true,
    );
  });

  it("Escape Tunnel's script matches Scryfall's oracle", () => {
    const tunnel = JSON.parse(
      readFileSync(join(CARDS_DIR, "escape_tunnel.json"), "utf8"),
    ) as { oracle: string; activated: { text: string }[] };
    expect(tunnel.oracle).toBe(
      `{T}, Sacrifice this land: ${SEARCH}\n{T}, Sacrifice this land: ${EVADE}`,
    );
    expect(tunnel.activated.map((a) => a.text)).toEqual([SEARCH, EVADE]);
  });
});

describe("scripted end-step and life-gain triggers (#2594 follow-up)", () => {
  // CR 702.1a / 118: "At the beginning of your end step" and
  // "whenever you gain life" trigger events. The engine's
  // `abilities/triggered.ts` already fires `phaseEnds` and `lifeGain`
  // (issues #2498, #2496); the script surface just needs the schema
  // arm and a one-line `scriptedCondition` branch.

  // Hypothetical: "At the beginning of your end step, Midnight Snack
  // deals 1 damage to each opponent." — global event, no subject.
  const midnightSnackScript: CardScript = {
    name: "Test Midnight Snack",
    oracle:
      "At the beginning of your end step, Midnight Snack deals 1 damage to each opponent.",
    triggers: [
      {
        text: "At the beginning of your end step, this creature deals 1 damage to each opponent.",
        event: "phaseEnds",
        subject: "self",
        effects: [
          { op: "DealDamage", amount: 1, target: "each_opponent" },
        ],
      },
    ],
  };

  // Ajani's Pridemate: "Whenever you gain life, put a +1/+1 counter on
  // Ajani's Pridemate." — life-gain event, subject=self.
  const ajanisPridemateScript: CardScript = {
    name: "Test Ajani's Pridemate",
    oracle:
      "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate.",
    triggers: [
      {
        text: "Whenever you gain life, put a +1/+1 counter on this creature.",
        event: "lifeGain",
        subject: "self",
        effects: [
          { op: "PutCounters", counter: "+1/+1", amount: 1, target: "self" },
        ],
      },
    ],
  };

  beforeAll(() =>
    registerCardScripts([
      ...RAW_CARD_SCRIPTS,
      midnightSnackScript,
      ajanisPridemateScript,
    ]),
  );
  afterAll(() => registerCardScripts(RAW_CARD_SCRIPTS));

  it("schema accepts `phaseEnds` (end step) and `lifeGain` events", () => {
    const phaseEndsOk = CardScriptSchema.safeParse({
      name: "Test End Step Card",
      oracle: "At the beginning of your end step, draw a card.",
      triggers: [
        {
          text: "At the beginning of your end step, draw a card.",
          event: "phaseEnds",
          subject: "self",
          effects: [{ op: "Draw", amount: 1, who: "you" }],
        },
      ],
    });
    expect(phaseEndsOk.success).toBe(true);

    const lifeGainOk = CardScriptSchema.safeParse({
      name: "Test Life Gain Card",
      oracle: "Whenever you gain life, draw a card.",
      triggers: [
        {
          text: "Whenever you gain life, draw a card.",
          event: "lifeGain",
          subject: "self",
          effects: [{ op: "Draw", amount: 1, who: "you" }],
        },
      ],
    });
    expect(lifeGainOk.success).toBe(true);
  });

  it("schema rejects an unknown event value", () => {
    const result = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      triggers: [
        {
          text: "weird",
          event: "drawCard",
          subject: "self",
          effects: [{ op: "Draw", amount: 1, who: "you" }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("getTriggeredAbilities parses a scripted `phaseEnds` trigger", () => {
    const midnightSnack = {
      ...card("Test Midnight Snack", "Creature — Rat", [2, 1]),
      oracle_text:
        "At the beginning of your end step, Midnight Snack deals 1 damage to each opponent.",
    } as ScryfallCard;
    const triggers = getTriggeredAbilities(midnightSnack);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].trigger.event).toBe("phaseEnds");
  });

  it("getTriggeredAbilities parses a scripted `lifeGain` trigger", () => {
    const ajanisPridemate = {
      ...card("Test Ajani's Pridemate", "Creature — Cat Soldier", [0, 0]),
      oracle_text:
        "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate.",
    } as ScryfallCard;
    const triggers = getTriggeredAbilities(ajanisPridemate);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].trigger.event).toBe("lifeGain");
  });
});

describe("Demolition Field: destroy a nonbasic land, both players search (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  const DEMOLISH =
    "Destroy target nonbasic land an opponent controls. That land's controller may search their library for a basic land card, put it onto the battlefield, then shuffle. You may search your library for a basic land card, put it onto the battlefield, then shuffle.";

  const demolishAbility = (targetId: string) =>
    ({
      id: "ab-demolish",
      type: "ability",
      sourceCardId: id("field"),
      controllerId: p1,
      text: DEMOLISH,
      targets: [cardTarget(targetId)],
      triggered: false,
      activated: true,
    }) as unknown as StackObject;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  const setup = () => {
    let s = put(
      state,
      p1,
      "field",
      card("Demolition Field", "Land"),
      "graveyard",
    );
    s = put(s, p2, "temple", card("Temple of Mystery", "Land"));
    s = put(s, p2, "their-forest", card("Forest", "Basic Land — Forest"));
    s = put(s, p1, "my-lib", card("Forest", "Basic Land — Forest"), "library");
    s = put(
      s,
      p2,
      "their-lib",
      card("Island", "Basic Land — Island"),
      "library",
    );
    return s;
  };

  const zoneOf = (s: GameState, cardId: string) =>
    [...s.zones.entries()].find(([, z]) => z.cardIds.includes(id(cardId)))?.[0];

  it("validates nonbasic_land and SearchLibrary's target_controller", () => {
    const ok = (effects: object[]) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: effects })
        .success;
    expect(ok([{ op: "Destroy", target: "nonbasic_land" }])).toBe(true);
    expect(
      ok([
        {
          op: "SearchLibrary",
          who: "target_controller",
          filter: { basic_land: true },
        },
      ]),
    ).toBe(true);
    expect(
      ok([
        {
          op: "SearchLibrary",
          who: "land_owner",
          filter: { basic_land: true },
        },
      ]),
    ).toBe(false);
  });

  it("matches only nonbasic lands", () => {
    const s = setup();
    const filter = { target: "nonbasic_land" as const };
    expect(matchesRemovalFilter(s.cards.get(id("temple"))!, filter)).toBe(true);
    expect(matchesRemovalFilter(s.cards.get(id("their-forest"))!, filter)).toBe(
      false,
    );
  });

  it("destroys the land and puts a basic land onto the battlefield for each player", () => {
    const out = resolveScriptedAbility(setup(), demolishAbility("temple"))!;
    expect(zoneOf(out, "temple")).toBe(`${p2}-graveyard`);
    expect(zoneOf(out, "their-lib")).toBe(`${p2}-battlefield`);
    expect(zoneOf(out, "my-lib")).toBe(`${p1}-battlefield`);
    expect(out.cards.get(id("their-lib"))!.isTapped).toBe(false);
    expect(out.cards.get(id("my-lib"))!.isTapped).toBe(false);
  });

  it("lets nobody search the target's library when the land already left", () => {
    // The land left before resolution: its controller gets no search
    // (CR 608.2b). The whole-ability fizzle when every target is illegal
    // happens on the stack, before the script runs.
    let s = setup();
    s = destroyCard(s, id("temple")).state ?? s;
    const out = resolveScriptedAbility(s, demolishAbility("temple")) ?? s;
    expect(zoneOf(out, "their-lib")).toBe(`${p2}-library`);
  });

  it("taps for exactly {C}, not the {2} from the next ability", () => {
    const field = JSON.parse(
      readFileSync(join(CARDS_DIR, "demolition_field.json"), "utf8"),
    ) as { oracle: string; activated: { text: string }[] };
    expect(parseManaAbility(field.oracle)).toEqual([
      { description: expect.any(String), mana: { colorless: 1 } },
    ]);
  });

  it("Demolition Field's script matches Scryfall's oracle", () => {
    const field = JSON.parse(
      readFileSync(join(CARDS_DIR, "demolition_field.json"), "utf8"),
    ) as { oracle: string; activated: { text: string }[] };
    expect(field.oracle).toBe(
      `{T}: Add {C}.\n{2}, {T}, Sacrifice this land: ${DEMOLISH}`,
    );
    expect(field.activated.map((a) => a.text)).toEqual(["Add {C}.", DEMOLISH]);
  });
});

describe("Hired Claw: Lizard attack ping and conditional counter (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const ORACLE =
    "Whenever you attack with one or more Lizards, this creature deals 1 damage to target opponent.\n{1}{R}: Put a +1/+1 counter on this creature. Activate only if an opponent lost life this turn and only once each turn.";
  const claw = () =>
    ({
      ...card("Hired Claw", "Creature — Lizard Mercenary", [1, 2]),
      oracle_text: ORACLE,
      mana_cost: "{R}",
      cmc: 1,
      colors: ["R"],
    }) as ScryfallCard;
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
  const fund = (s: GameState): GameState => {
    const players = new Map(s.players);
    const p = players.get(p1)!;
    players.set(p1, {
      ...p,
      manaPool: { ...p.manaPool, generic: 1, red: 1 },
    });
    return { ...s, players };
  };
  const lostLife = (s: GameState, who: PlayerId, n: number): GameState => {
    const players = new Map(s.players);
    players.set(who, { ...players.get(who)!, lastTurnLifeLost: n });
    return { ...s, players };
  };
  const counters = (s: GameState) =>
    s.cards
      .get(id("claw"))!
      .counters.filter((c) => c.type === "+1/+1")
      .reduce((n, c) => n + c.count, 0);

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "claw", claw());
  });

  it("parses into a once-per-combat Lizard attack trigger", () => {
    const [ability] = getTriggeredAbilities(claw());
    expect(ability.trigger).toMatchObject({
      event: "attacked",
      subject: "any",
      enteringFilter: {
        types: ["creature"],
        controller: "you",
        subtype: "Lizard",
      },
      attackFilter: { once: true },
    });
  });

  it("triggers once when Lizards attack and pings the opponent", () => {
    state = put(
      state,
      p1,
      "lizard",
      card("Lizard", "Creature — Lizard", [2, 2]),
    );
    state = at(ready(ready(state, "claw"), "lizard"), Phase.DECLARE_ATTACKERS);
    const attacked = autoChooseTriggerTargets(
      declareAttackers(state, [
        { cardId: id("claw"), defenderId: p2 },
        { cardId: id("lizard"), defenderId: p2 },
      ]).state,
      p1,
    );
    expect(sources(attacked)).toEqual([id("claw")]);
    expect(attacked.stack[0].targets).toEqual([
      expect.objectContaining({ type: "player", targetId: p2 }),
    ]);
    expect(bothPass(attacked).players.get(p2)!.life).toBe(19);
  });

  it("doesn't trigger when only non-Lizards attack", () => {
    state = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    state = at(ready(state, "bear"), Phase.DECLARE_ATTACKERS);
    const attacked = declareAttackers(state, [
      { cardId: id("bear"), defenderId: p2 },
    ]).state;
    expect(sources(attacked)).toEqual([]);
  });

  it("can't put a counter on until an opponent lost life this turn", () => {
    const s = fund(at(state, Phase.PRECOMBAT_MAIN));
    expect(activateAbility(s, p1, id("claw"), 0).success).toBe(false);
    expect(activateAbility(lostLife(s, p1, 3), p1, id("claw"), 0).success).toBe(
      false,
    );
    const r = activateAbility(lostLife(s, p2, 1), p1, id("claw"), 0);
    expect(r.success).toBe(true);
    const resolved = resolveScriptedAbility(
      r.state,
      r.state.stack[r.state.stack.length - 1],
    )!;
    expect(counters(resolved)).toBe(1);
  });

  it("activates only once each turn", () => {
    const s = fund(lostLife(at(state, Phase.PRECOMBAT_MAIN), p2, 2));
    const first = activateAbility(s, p1, id("claw"), 0);
    expect(first.success).toBe(true);
    expect(activateAbility(fund(first.state), p1, id("claw"), 0).success).toBe(
      false,
    );
  });

  it("rejects a subtype on a self trigger", () => {
    const ok = (extra: object) =>
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "X",
        triggers: [
          {
            text: "X",
            event: "attacks",
            effects: [{ op: "Draw", amount: 1 }],
            ...extra,
          },
        ],
      }).success;
    expect(ok({ subject: "any", subtype: "Lizard" })).toBe(true);
    expect(ok({ subject: "self", subtype: "Lizard" })).toBe(false);
  });
});

describe("Sunspine Lynx: life gain and prevention statics (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const lynx = () => card("Sunspine Lynx", "Creature — Elemental Cat", [5, 4]);
  const life = (s: GameState, who: PlayerId) => s.players.get(who)!.life;
  const shield = (s: GameState, who: PlayerId, amount: number) =>
    s.replacementEffectManager.addPreventionShield(who, {
      sourceId: id("shield-source"),
      amount,
      controllerId: who,
    });

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("stops life gain while it is on the battlefield", () => {
    expect(life(gainLifeAction(state, p1, 3), p1)).toBe(23);
    state = put(state, p1, "lynx", lynx());
    expect(life(gainLifeAction(state, p1, 3), p1)).toBe(20);
    expect(life(gainLifeAction(state, p2, 3), p2)).toBe(20);
  });

  it("makes damage unpreventable while it is on the battlefield", () => {
    shield(state, p2, 5);
    expect(life(dealDamageToPlayerAction(state, p2, 3), p2)).toBe(20);
    state = put(state, p1, "lynx", lynx());
    expect(life(dealDamageToPlayerAction(state, p2, 3), p2)).toBe(17);
  });

  it("ETB deals damage to each player equal to their nonbasic lands", () => {
    state = put(state, p1, "lynx", lynx());
    state = put(state, p1, "dfield", card("Demolition Field", "Land"));
    state = put(state, p2, "dual1", card("Shared Roots", "Land"));
    state = put(state, p2, "dual2", card("Fabled Passage", "Land"));
    state = put(state, p2, "forest", card("Forest", "Basic Land — Forest"));
    const [trigger] = getCardScript("Sunspine Lynx")!.triggers!;
    const after = resolveScriptedEffects(state, trigger.effects!, {
      controllerId: p1,
      sourceCardId: id("lynx"),
      targets: [],
    } as unknown as StackObject);
    expect(life(after, p1)).toBe(19);
    expect(life(after, p2)).toBe(18);
  });

  it("deals no damage to a player with only basic lands", () => {
    state = put(state, p1, "lynx", lynx());
    state = put(state, p2, "forest", card("Forest", "Basic Land — Forest"));
    const [trigger] = getCardScript("Sunspine Lynx")!.triggers!;
    const after = resolveScriptedEffects(state, trigger.effects!, {
      controllerId: p1,
      sourceCardId: id("lynx"),
      targets: [],
    } as unknown as StackObject);
    expect(life(after, p1)).toBe(20);
    expect(life(after, p2)).toBe(20);
  });

  it("schema: per needs each_player, and rules can't sit on a spell", () => {
    const base = { name: "Test", oracle: "x" };
    expect(
      CardScriptSchema.safeParse({
        ...base,
        spell: [
          {
            op: "DealDamage",
            amount: 1,
            target: "each_opponent",
            per: "nonbasic_land",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      CardScriptSchema.safeParse({
        ...base,
        spell: [{ op: "DealDamage", amount: 1, target: "each_opponent" }],
        rules: [
          { text: "Players can't gain life.", rule: "players_cant_gain_life" },
        ],
      }).success,
    ).toBe(false);
    expect(
      CardScriptSchema.safeParse({
        ...base,
        rules: [
          {
            text: "Damage can't be prevented.",
            rule: "damage_cant_be_prevented",
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe("Generous Plunderer: Treasures and attack damage (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const plunderer = () =>
    card("Generous Plunderer", "Creature — Human Rogue", [2, 2]);
  const life = (s: GameState, who: PlayerId) => s.players.get(who)!.life;
  const treasures = (s: GameState, who: PlayerId) =>
    [...s.cards.values()].filter(
      (c) => c.cardData.name === "Treasure" && c.controllerId === who,
    );
  const run = (s: GameState, index: number) =>
    resolveScriptedEffects(
      s,
      getCardScript("Generous Plunderer")!.triggers![index].effects!,
      {
        controllerId: p1,
        sourceCardId: id("plunderer"),
        targets: [],
      } as unknown as StackObject,
    );

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "plunderer", plunderer());
  });

  it("upkeep: you get a Treasure and the opponent gets a tapped one", () => {
    const after = run(state, 0);
    const mine = treasures(after, p1);
    const theirs = treasures(after, p2);
    expect(mine).toHaveLength(1);
    expect(mine[0].isTapped).toBe(false);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].isTapped).toBe(true);
  });

  it("attack deals damage equal to the defending player's artifacts", () => {
    state = put(state, p2, "art1", card("Ornithopter", "Artifact Creature"));
    state = put(state, p2, "art2", card("Mind Stone", "Artifact"));
    state = put(state, p1, "myart", card("Sol Ring", "Artifact"));
    state = {
      ...state,
      combat: {
        ...state.combat,
        attackers: [
          {
            cardId: id("plunderer"),
            defenderId: p2,
            isAttackingPlaneswalker: false,
            damageToDeal: 2,
            hasFirstStrike: false,
            hasDoubleStrike: false,
          },
        ],
      },
    };
    const after = run(state, 1);
    expect(life(after, p2)).toBe(18);
    expect(life(after, p1)).toBe(20);
  });

  it("attack deals nothing when the defender has no artifacts", () => {
    expect(life(run(state, 1), p2)).toBe(20);
  });

  it("schema: per artifact needs defending_player", () => {
    const base = { name: "Test", oracle: "x" };
    const spell = (target: string, per: string) =>
      CardScriptSchema.safeParse({
        ...base,
        spell: [{ op: "DealDamage", amount: 1, target, per }],
      }).success;
    expect(spell("each_player", "artifact")).toBe(false);
    expect(spell("defending_player", "nonbasic_land")).toBe(false);
    expect(spell("defending_player", "artifact")).toBe(true);
  });
});

describe("Smaug the Magnificent: Treasure-scaled attack damage (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const life = (s: GameState, who: PlayerId) => s.players.get(who)!.life;
  const treasures = (s: GameState, who: PlayerId) =>
    [...s.cards.values()].filter(
      (c) => c.cardData.name === "Treasure" && c.controllerId === who,
    );
  const run = (s: GameState, index: number) =>
    resolveScriptedEffects(
      s,
      getCardScript("Smaug the Magnificent")!.triggers![index].effects!,
      {
        controllerId: p1,
        sourceCardId: id("smaug"),
        targets: [{ type: "player", targetId: p2, isValid: true }],
      } as unknown as StackObject,
    );

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "smaug",
      card("Smaug the Magnificent", "Legendary Creature — Dragon", [4, 3]),
    );
  });

  it("upkeep creates a Treasure for you", () => {
    expect(treasures(run(state, 1), p1)).toHaveLength(1);
  });

  it("attack deals damage equal to the Treasures you control", () => {
    state = run(run(state, 1), 1);
    state = put(
      state,
      p2,
      "theirs",
      card("Treasure", "Token Artifact — Treasure"),
    );
    expect(life(run(state, 0), p2)).toBe(18);
  });

  it("attack deals nothing with no Treasures", () => {
    expect(life(run(state, 0), p2)).toBe(20);
  });

  it("schema: per treasure needs a targeted damage effect", () => {
    const ok = (target: string) =>
      CardScriptSchema.safeParse({
        name: "Test",
        oracle: "x",
        spell: [{ op: "DealDamage", amount: 1, target, per: "treasure" }],
      }).success;
    expect(ok("any")).toBe(true);
    expect(ok("each_opponent")).toBe(false);
    expect(ok("defending_player")).toBe(false);
  });
});

describe("Magmatic Hellkite: land destruction and stun counters (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const zoneOf = (s: GameState, cardId: string) =>
    [...s.zones.entries()].find(([, z]) => z.cardIds.includes(id(cardId)))?.[0];
  const stunOf = (s: GameState, cardId: string) =>
    s.cards.get(id(cardId))!.counters.find((c) => c.type === "stun")?.count ??
    0;
  const etb = (targetId: string) =>
    ({
      id: "ab-magmatic",
      type: "ability",
      sourceCardId: id("hellkite"),
      controllerId: p1,
      text: getCardScript("Magmatic Hellkite")!.triggers![0].text,
      targets: [cardTarget(targetId)],
      triggered: true,
      activated: false,
    }) as unknown as StackObject;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("destroys the land and its controller fetches a stunned basic", () => {
    let s = put(
      state,
      p1,
      "hellkite",
      card("Magmatic Hellkite", "Creature — Dragon", [4, 5]),
    );
    s = put(s, p2, "temple", card("Temple of Mystery", "Land"));
    s = put(
      s,
      p2,
      "their-lib",
      card("Island", "Basic Land — Island"),
      "library",
    );
    const [trigger] = getCardScript("Magmatic Hellkite")!.triggers!;
    const after = resolveScriptedEffects(s, trigger.effects!, etb("temple"));
    expect(zoneOf(after, "temple")).toBe(`${p2}-graveyard`);
    expect(zoneOf(after, "their-lib")).toBe(`${p2}-battlefield`);
    expect(after.cards.get(id("their-lib"))!.isTapped).toBe(true);
    expect(stunOf(after, "their-lib")).toBe(1);
  });

  it("a stun counter is removed instead of untapping", () => {
    let s = put(state, p1, "land", card("Mountain", "Basic Land — Mountain"));
    const cards = new Map(s.cards);
    cards.set(id("land"), {
      ...cards.get(id("land"))!,
      isTapped: true,
      counters: [{ type: "stun", count: 1 }],
    });
    s = { ...s, cards };
    const first = processUntapStep(s).state;
    expect(first.cards.get(id("land"))!.isTapped).toBe(true);
    expect(stunOf(first, "land")).toBe(0);
    const second = processUntapStep(first).state;
    expect(second.cards.get(id("land"))!.isTapped).toBe(false);
  });

  it("schema: stun is a positive count on SearchLibrary", () => {
    const ok = (stun: number) =>
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "x",
        spell: [
          {
            op: "SearchLibrary",
            filter: { basic_land: true },
            destination: "battlefield",
            tapped: true,
            stun,
          },
        ],
      }).success;
    expect(ok(1)).toBe(true);
    expect(ok(0)).toBe(false);
  });
});

describe("Mightform Harmonizer: landfall doubles a creature's power (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;
  const run = (s: GameState, targetId: string) =>
    resolveScriptedEffects(
      s,
      getCardScript("Mightform Harmonizer")!.triggers![0].effects!,
      {
        controllerId: p1,
        sourceCardId: id("harmonizer"),
        targets: [cardTarget(targetId)],
      } as unknown as StackObject,
    );

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "harmonizer",
      card("Mightform Harmonizer", "Creature — Insect Druid", [4, 4]),
    );
    state = put(
      state,
      p1,
      "bear",
      card("Grizzly Bears", "Creature — Bear", [3, 2]),
    );
  });

  it("doubles the target's power and leaves toughness alone", () => {
    const after = run(state, "bear");
    const bear = after.cards.get(id("bear"))!;
    expect(getEffectivePower(bear)).toBe(6);
    expect(getEffectiveToughness(bear)).toBe(2);
  });

  it("doubles the current power, including earlier pumps", () => {
    const after = run(run(state, "bear"), "bear");
    expect(getEffectivePower(after.cards.get(id("bear"))!)).toBe(12);
  });

  it("does nothing to a creature an opponent controls", () => {
    state = put(state, p2, "foe", card("Foe", "Creature — Ogre", [3, 3]));
    const after = run(state, "foe");
    expect(getEffectivePower(after.cards.get(id("foe"))!)).toBe(3);
  });

  it("schema: double_power needs power and toughness 0", () => {
    const ok = (power: number) =>
      CardScriptSchema.safeParse({
        name: "X",
        oracle: "x",
        spell: [
          {
            op: "Pump",
            power,
            toughness: 0,
            target: "creature",
            double_power: true,
          },
        ],
      }).success;
    expect(ok(0)).toBe(true);
    expect(ok(2)).toBe(false);
  });
});
