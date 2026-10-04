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
} from "../index";
import { createInitialGameState, startGame } from "../../game-state/game-state";
import { createCardInstance } from "../../game-state/card-instance";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../../game-state/evergreen-keywords";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  StackObject,
  Target,
} from "../../game-state/types";

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
