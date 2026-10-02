/**
 * Enchant keyword / Aura attachment (issue #2300, Standard remainder slice).
 */
import {
  canEnchantTarget,
  isAuraIllegallyAttached,
  parseEnchantRestriction,
} from "../keyword-actions";
import { castSpell } from "../spell-casting/cast";
import { resolveTopOfStack } from "../spell-casting/resolve";
import { checkStateBasedActions } from "../state-based-actions";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
  StackObject,
} from "../types";

const card = (name: string, typeLine: string, oracleText = ""): ScryfallCard =>
  ({
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    keywords: [],
    oracle_text: oracleText,
    mana_cost: "{1}",
    cmc: 1,
    colors: [],
    color_identity: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "2",
    toughness: "2",
  }) as ScryfallCard;

const PACIFISM = card(
  "Pacifism",
  "Enchantment — Aura",
  "Enchant creature\nEnchanted creature can't attack or block.",
);
const BLESSING = card(
  "Blessing",
  "Enchantment — Aura",
  "Enchant creature you control\nEnchanted creature gets +1/+1.",
);
const CURSE = card(
  "Curse",
  "Enchantment — Aura Curse",
  "Enchant player\nAt the beginning of enchanted player's upkeep, they lose 1 life.",
);

const id = (s: string) => s as CardInstanceId;

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  zone = "battlefield",
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

function onStack(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  targetId?: string,
): GameState {
  const cards = new Map(state.cards);
  cards.set(
    id(cardId),
    createCardInstance(data, playerId, playerId, {
      id: id(cardId),
      currentZoneKey: "stack",
    }),
  );
  const zones = new Map(state.zones);
  const stackZone = zones.get("stack")!;
  zones.set("stack", {
    ...stackZone,
    cardIds: [...stackZone.cardIds, id(cardId)],
  });
  const obj: StackObject = {
    id: `stack-${cardId}`,
    type: "spell",
    sourceCardId: id(cardId),
    controllerId: playerId,
    name: data.name,
    text: data.oracle_text || "",
    manaCost: data.mana_cost ?? null,
    targets: targetId ? [{ type: "card", targetId, isValid: true }] : [],
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
  } as StackObject;
  return { ...state, cards, zones, stack: [...state.stack, obj] };
}

function zoneOf(state: GameState, cardId: string): string | undefined {
  for (const [key, zone] of state.zones) {
    if (zone.cardIds.includes(id(cardId))) return key;
  }
  return undefined;
}

describe("enchant", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(s.players.keys());
    let st: GameState = {
      ...s,
      turn: {
        ...s.turn,
        activePlayerId: p1,
        currentPhase: Phase.PRECOMBAT_MAIN,
      },
      priorityPlayerId: p1,
      stack: [],
    };
    st = put(st, p1, "bear", card("Bear", "Creature — Bear"));
    st = put(st, p1, "forest", card("Forest", "Basic Land — Forest"));
    st = put(st, p2, "rival", card("Rival", "Creature — Human"));
    const players = new Map(st.players);
    const me = players.get(p1)!;
    players.set(p1, { ...me, manaPool: { ...me.manaPool, colorless: 5 } });
    state = { ...st, players };
  });

  it("parses the common Enchant qualities", () => {
    expect(parseEnchantRestriction("Enchant creature")?.alternatives).toEqual([
      ["creature"],
    ]);
    expect(
      parseEnchantRestriction("Enchant creature you control")?.controller,
    ).toBe("you");
    expect(
      parseEnchantRestriction("Enchant artifact or creature")?.alternatives,
    ).toEqual([["artifact"], ["creature"]]);
    expect(
      parseEnchantRestriction("Enchant nonland permanent")?.alternatives,
    ).toEqual([["nonland", "permanent"]]);
    expect(parseEnchantRestriction("Enchant player")?.unsupported).toBe(true);
    expect(
      parseEnchantRestriction("Enchanted creature gets +1/+1."),
    ).toBeNull();
  });

  it("checks the Enchant quality and controller against the target", () => {
    const pacifism = createCardInstance(PACIFISM, p1, p1);
    const blessing = createCardInstance(BLESSING, p1, p1);
    expect(canEnchantTarget(state, pacifism, id("rival")).canEnchant).toBe(
      true,
    );
    expect(canEnchantTarget(state, pacifism, id("forest")).canEnchant).toBe(
      false,
    );
    expect(canEnchantTarget(state, blessing, id("bear")).canEnchant).toBe(true);
    expect(canEnchantTarget(state, blessing, id("rival")).canEnchant).toBe(
      false,
    );
  });

  it("rejects a phased-out target", () => {
    const cards = new Map(state.cards);
    cards.set(id("rival"), { ...cards.get(id("rival"))!, isPhasedOut: true });
    const pacifism = createCardInstance(PACIFISM, p1, p1);
    expect(
      canEnchantTarget({ ...state, cards }, pacifism, id("rival")).canEnchant,
    ).toBe(false);
  });

  it("refuses to cast an Aura with no target", () => {
    const st = put(state, p1, "pacifism", PACIFISM, "hand");
    const result = castSpell(st, p1, id("pacifism"), []);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/needs a target/);
  });

  it("refuses to cast an Aura at a target its Enchant line forbids", () => {
    const st = put(state, p1, "pacifism", PACIFISM, "hand");
    const result = castSpell(st, p1, id("pacifism"), [
      { type: "card", targetId: "forest", isValid: true },
    ]);
    expect(result.success).toBe(false);
  });

  it("resolves an Aura spell attached to its target", () => {
    const st = onStack(state, p1, "pacifism", PACIFISM, "rival");
    const after = resolveTopOfStack(st);
    expect(zoneOf(after, "pacifism")).toBe(`${p1}-battlefield`);
    expect(after.cards.get(id("pacifism"))!.attachedToId).toBe("rival");
    expect(after.cards.get(id("rival"))!.attachedCardIds).toContain("pacifism");
  });

  it("puts an Aura spell in the graveyard when its target is gone", () => {
    let st = onStack(state, p1, "pacifism", PACIFISM, "rival");
    const zones = new Map(st.zones);
    const bf = zones.get(`${p2}-battlefield`)!;
    zones.set(`${p2}-battlefield`, {
      ...bf,
      cardIds: bf.cardIds.filter((c) => c !== "rival"),
    });
    st = { ...st, zones };
    const after = resolveTopOfStack(st);
    expect(zoneOf(after, "pacifism")).toBe(`${p1}-graveyard`);
  });

  it("SBA puts an Aura enchanting nothing into the graveyard", () => {
    const st = put(state, p1, "pacifism", PACIFISM);
    expect(
      isAuraIllegallyAttached(st, st.cards.get(id("pacifism"))!).illegal,
    ).toBe(true);
    const after = checkStateBasedActions(st).state;
    expect(zoneOf(after, "pacifism")).toBe(`${p1}-graveyard`);
  });

  it("SBA removes an Aura whose host stopped being a legal object", () => {
    let st = put(state, p1, "pacifism", PACIFISM);
    const cards = new Map(st.cards);
    cards.set(id("pacifism"), {
      ...cards.get(id("pacifism"))!,
      attachedToId: id("bear"),
    });
    const bear = cards.get(id("bear"))!;
    cards.set(id("bear"), {
      ...bear,
      cardData: { ...bear.cardData, type_line: "Artifact" },
      attachedCardIds: [id("pacifism")],
    });
    st = { ...st, cards };
    const after = checkStateBasedActions(st).state;
    expect(zoneOf(after, "pacifism")).toBe(`${p1}-graveyard`);
  });

  it("SBA keeps a correctly attached Aura and leaves player Auras alone", () => {
    let st = put(state, p1, "pacifism", PACIFISM);
    st = put(st, p1, "curse", CURSE);
    const cards = new Map(st.cards);
    cards.set(id("pacifism"), {
      ...cards.get(id("pacifism"))!,
      attachedToId: id("rival"),
    });
    st = { ...st, cards };
    const after = checkStateBasedActions(st).state;
    expect(zoneOf(after, "pacifism")).toBe(`${p1}-battlefield`);
    expect(zoneOf(after, "curse")).toBe(`${p1}-battlefield`);
  });
});
