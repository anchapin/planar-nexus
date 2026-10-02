/**
 * Equip keyword ability (issue #2300, Standard remainder slice).
 */
import {
  activateEquip,
  attachEquipment,
  canEquip,
  getEquipCost,
  resolveEquip,
} from "../keyword-actions";
import { resolveEffect } from "../effect-resolution";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

const card = (
  name: string,
  typeLine: string,
  oracleText = "",
  extra: Partial<ScryfallCard> = {},
): ScryfallCard =>
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
    ...extra,
  }) as ScryfallCard;

const SWORD = card(
  "Sword",
  "Artifact — Equipment",
  "Equipped creature gets +2/+0.\nEquip {2}",
);

function put(
  state: GameState,
  playerId: PlayerId,
  id: string,
  data: ScryfallCard,
): GameState {
  const key = `${playerId}-battlefield`;
  const cards = new Map(state.cards);
  cards.set(
    id as CardInstanceId,
    createCardInstance(data, playerId, playerId, {
      id: id as CardInstanceId,
      currentZoneKey: key,
    }),
  );
  const zones = new Map(state.zones);
  const zone = zones.get(key)!;
  zones.set(key, { ...zone, cardIds: [...zone.cardIds, id as CardInstanceId] });
  return { ...state, cards, zones };
}

function withMana(state: GameState, playerId: PlayerId, colorless: number) {
  const players = new Map(state.players);
  const p = players.get(playerId)!;
  players.set(playerId, {
    ...p,
    manaPool: { ...p.manaPool, colorless },
  });
  return { ...state, players };
}

const id = (s: string) => s as CardInstanceId;

describe("equip", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = createInitialGameState(["Player1", "Player2"], 20, false);
    startGame(s);
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
    st = put(st, p1, "sword", SWORD);
    st = put(st, p1, "bear", card("Bear", "Creature — Bear"));
    st = put(st, p1, "elk", card("Elk", "Creature — Elk"));
    st = put(st, p2, "rival", card("Rival", "Creature — Human"));
    state = withMana(st, p1, 5);
  });

  it("reads the plain equip cost", () => {
    expect(getEquipCost(state.cards.get(id("sword"))!)?.generic).toBe(2);
    expect(getEquipCost(state.cards.get(id("bear"))!)).toBeNull();
  });

  it("allows equipping a creature you control at sorcery speed", () => {
    expect(canEquip(state, p1, id("sword"), id("bear")).canEquip).toBe(true);
  });

  it("refuses an opponent's creature, a non-creature, and itself", () => {
    expect(canEquip(state, p1, id("sword"), id("rival")).canEquip).toBe(false);
    expect(canEquip(state, p1, id("sword"), id("sword")).canEquip).toBe(false);
  });

  it("refuses outside sorcery timing", () => {
    const combat = {
      ...state,
      turn: { ...state.turn, currentPhase: Phase.COMBAT_DAMAGE },
    } as GameState;
    expect(canEquip(combat, p1, id("sword"), id("bear")).canEquip).toBe(false);
    const notMyTurn = {
      ...state,
      turn: { ...state.turn, activePlayerId: p2 },
    } as GameState;
    expect(canEquip(notMyTurn, p1, id("sword"), id("bear")).canEquip).toBe(
      false,
    );
  });

  it("pays the cost and puts the attach on the stack", () => {
    const result = activateEquip(state, p1, id("sword"), id("bear"));
    expect(result.success).toBe(true);
    expect(result.state.stack).toHaveLength(1);
    expect(result.state.stack[0].effects).toEqual([
      { effectType: "attach", attachmentId: "sword", targetId: "bear" },
    ]);
    expect(result.state.players.get(p1)!.manaPool.colorless).toBe(3);
    // Not attached until it resolves.
    expect(result.state.cards.get(id("sword"))!.attachedToId).toBeNull();
  });

  it("fails without enough mana", () => {
    const broke = withMana(state, p1, 1);
    expect(activateEquip(broke, p1, id("sword"), id("bear")).success).toBe(
      false,
    );
  });

  it("resolves by attaching, and moving it detaches from the old creature", () => {
    let st = resolveEffect(state, {
      effectType: "attach",
      attachmentId: id("sword"),
      targetId: id("bear"),
    }).state;
    expect(st.cards.get(id("sword"))!.attachedToId).toBe("bear");
    expect(st.cards.get(id("bear"))!.attachedCardIds).toContain("sword");

    st = attachEquipment(st, id("sword"), id("elk")).state;
    expect(st.cards.get(id("sword"))!.attachedToId).toBe("elk");
    expect(st.cards.get(id("bear"))!.attachedCardIds).not.toContain("sword");
    expect(st.cards.get(id("elk"))!.attachedCardIds).toEqual(["sword"]);
  });

  it("does nothing on resolution if the target left the battlefield", () => {
    const key = `${p1}-battlefield`;
    const zones = new Map(state.zones);
    const zone = zones.get(key)!;
    zones.set(key, {
      ...zone,
      cardIds: zone.cardIds.filter((c) => c !== "bear"),
    });
    const gone = { ...state, zones };
    const result = resolveEquip(gone, id("sword"), id("bear"));
    expect(result.success).toBe(false);
    expect(result.state.cards.get(id("sword"))!.attachedToId).toBeNull();
  });
});
