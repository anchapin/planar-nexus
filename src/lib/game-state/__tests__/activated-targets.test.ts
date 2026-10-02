/**
 * Activated abilities resolve their text and take targets (CR 602; issue #2300).
 */
import { activateAbility } from "../abilities/activated";
import {
  getActivatedAbilityTargetSpec,
  getLegalActivatedAbilityTargets,
  triggerNeedsTargets,
  autoChooseTriggerTargets,
} from "../trigger-system/trigger-targets";
import { resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

function creature(
  name: string,
  power: number,
  toughness: number,
  oracle = "",
  keywords: string[] = [],
) {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Creature — Wizard",
    oracle_text: oracle,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords,
    legalities: { standard: "legal" },
    layout: "normal",
    power: String(power),
    toughness: String(toughness),
  } as unknown as ScryfallCard;
}

const id = (s: string) => s as CardInstanceId;

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
): GameState {
  const key = `${playerId}-battlefield`;
  const cards = new Map(state.cards);
  cards.set(id(cardId), {
    ...createCardInstance(data, playerId, playerId, {
      id: id(cardId),
      currentZoneKey: key,
    }),
    hasSummoningSickness: false,
  });
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

const PINGER = "{T}: This creature deals 1 damage to any target.";
const SHOCKER = "{T}: This creature deals 2 damage to target creature.";
const HEALER = "{T}: You gain 2 life.";

describe("activated ability targets and resolution", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(s.players.keys());
    state = { ...s, priorityPlayerId: p1 };
    state = put(state, p1, "pinger", creature("Pinger", 1, 1, PINGER));
    state = put(state, p1, "shocker", creature("Shocker", 1, 1, SHOCKER));
    state = put(state, p1, "healer", creature("Healer", 1, 1, HEALER));
    state = put(state, p2, "bear", creature("Bear", 2, 2));
    state = put(
      state,
      p2,
      "warded",
      creature("Warded", 2, 2, "Hexproof", ["Hexproof"]),
    );
  });

  it("reads the target requirement of an activated ability", () => {
    expect(getActivatedAbilityTargetSpec(state, id("pinger"), 0)?.kind).toBe(
      "any",
    );
    expect(getActivatedAbilityTargetSpec(state, id("healer"), 0)).toBeNull();
    const legal = getLegalActivatedAbilityTargets(state, p1, id("shocker"), 0);
    expect(legal).toContain("bear");
    expect(legal).not.toContain("warded");
    expect(legal).not.toContain(p2);
  });

  it("puts the chosen target on the stack and resolves the damage", () => {
    const r = activateAbility(state, p1, id("shocker"), 0, [
      { type: "card", targetId: "bear" },
    ]);
    expect(r.success).toBe(true);
    const obj = r.state.stack[r.state.stack.length - 1];
    expect(obj.activated).toBe(true);
    expect(obj.targets.map((t) => t.targetId)).toEqual(["bear"]);
    const after = resolveTopOfStack(r.state);
    expect(after.cards.get(id("bear"))?.damage ?? 0).toBe(2);
  });

  it("rejects an illegal target before paying the tap cost", () => {
    const r = activateAbility(state, p1, id("shocker"), 0, [
      { type: "card", targetId: "warded" },
    ]);
    expect(r.success).toBe(false);
    expect(r.state.cards.get(id("shocker"))?.isTapped).toBe(false);
  });

  it("leaves targets to be chosen on the stack when none were passed", () => {
    const r = activateAbility(state, p1, id("pinger"), 0);
    expect(r.success).toBe(true);
    const obj = r.state.stack[r.state.stack.length - 1];
    expect(triggerNeedsTargets(obj)).toBe(true);
    const chosen = autoChooseTriggerTargets(r.state, p1);
    const top = chosen.stack[chosen.stack.length - 1];
    expect(top.targetsChosen).toBe(true);
    expect(top.targets).toHaveLength(1);
  });

  it("resolves an untargeted ability for its controller", () => {
    const before = state.players.get(p1)!.life;
    const r = activateAbility(state, p1, id("healer"), 0);
    expect(r.success).toBe(true);
    const after = resolveTopOfStack(r.state);
    expect(after.players.get(p1)!.life).toBe(before + 2);
  });
});
