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
} from "../index";
import {
  getActivatedAbilities,
  getTriggeredAbilities,
} from "../../abilities/parse";
import { detectLandfallTriggers } from "../../keyword-actions/landfall";
import { createInitialGameState, startGame } from "../../game-state";
import { createCardInstance } from "../../card-instance";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../../evergreen-keywords";
import type {
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
    state = startGame(createInitialGameState(["Player1", "Player2"], 20, false));
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
    state = startGame(createInitialGameState(["Player1", "Player2"], 20, false));
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
    const s0 = put(state, p1, "spawn", card("Vampire Spawn", "Creature — Vampire", [2, 3]));
    const s = resolveScriptedAbility(
      s0,
      ability("spawn", "When this creature enters, each opponent loses 2 life and you gain 2 life.", "triggered"),
    )!;
    expect(s.players.get(p2)!.life).toBe(18);
    expect(s.players.get(p1)!.life).toBe(22);
  });

  it("Guarded Heir's ETB creates two 3/3 white Knights", () => {
    const s0 = put(state, p1, "heir", card("Guarded Heir", "Creature — Human Noble", [1, 1]));
    const before = battlefield(s0, p1).length;
    const s = resolveScriptedAbility(
      s0,
      ability("heir", "When this creature enters, create two 3/3 white Knight creature tokens.", "triggered"),
    )!;
    const created = battlefield(s, p1).slice(before);
    expect(created).toHaveLength(2);
    expect(s.cards.get(created[0])!.cardData.power).toBe("3");
  });

  it("Ironpaw Aspirant's ETB puts a +1/+1 counter on the target", () => {
    let s0 = put(state, p1, "aspirant", card("Ironpaw Aspirant", "Creature — Cat Warrior", [1, 2]));
    s0 = put(s0, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const s = resolveScriptedAbility(
      s0,
      ability("aspirant", "When this creature enters, put a +1/+1 counter on target creature.", "triggered", [cardTarget("bear")]),
    )!;
    expect(getEffectivePower(s.cards.get(id("bear"))!)).toBe(3);
    expect(getEffectiveToughness(s.cards.get(id("bear"))!)).toBe(3);
  });

  it("Shivan Dragon's firebreathing pumps itself", () => {
    const s0 = put(state, p1, "shivan", card("Shivan Dragon", "Creature — Dragon", [5, 5]));
    const s = resolveScriptedAbility(
      s0,
      ability("shivan", "This creature gets +1/+0 until end of turn.", "activated"),
    )!;
    expect(getEffectivePower(s.cards.get(id("shivan"))!)).toBe(6);
    expect(getEffectiveToughness(s.cards.get(id("shivan"))!)).toBe(5);
  });

  it("Engine Rat's ability makes each opponent lose 2", () => {
    const s0 = put(state, p1, "rat", card("Engine Rat", "Creature — Zombie Rat", [1, 1]));
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
  const TEXT = "Landfall — Whenever a land you control enters, you gain 1 life.";

  beforeEach(() => {
    state = startGame(createInitialGameState(["Player1", "Player2"], 20, false));
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "terra", card("Eumidian Terrabotanist", "Creature — Insect Druid", [2, 3]));
  });

  it("fires for a land you control and resolves from the script", () => {
    const s0 = put(state, p1, "forest", card("Forest", "Basic Land — Forest", [0, 0]));
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
    const s0 = put(state, p2, "swamp", card("Swamp", "Basic Land — Swamp", [0, 0]));
    expect(detectLandfallTriggers(s0, id("swamp"))).toHaveLength(0);
  });
});
