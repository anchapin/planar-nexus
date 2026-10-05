/**
 * Spinerock Tyrant's copy trigger (#2483, CR 707.10, 702.80).
 *
 * "Whenever you cast an instant or sorcery spell with a single target, you
 * may copy it. If you do, those spells gain wither." Both the copy and the
 * original deal their damage to creatures as -1/-1 counters.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  Target,
} from "../types";

const SPINEROCK =
  "Flying\nWither (This deals damage to creatures in the form of -1/-1 counters.)\nWhenever you cast an instant or sorcery spell with a single target, you may copy it. If you do, those spells gain wither. You may choose new targets for the copy.";

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Creature \u2014 Bear",
    oracle_text: "",
    mana_cost: "{R}",
    cmc: 1,
    colors: ["R"],
    color_identity: ["R"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "2",
    toughness: "2",
    ...overrides,
  } as ScryfallCard;
}

const tyrant = card({
  name: "Spinerock Tyrant",
  type_line: "Creature \u2014 Dragon",
  oracle_text: SPINEROCK,
  keywords: ["Flying", "Wither"],
  mana_cost: "{3}{R}{R}",
  power: "6",
  toughness: "6",
});
const strike = card({
  name: "Lightning Strike",
  type_line: "Instant",
  oracle_text: "Lightning Strike deals 3 damage to any target.",
  mana_cost: "{1}{R}",
  power: undefined,
  toughness: undefined,
});
const untargeted = card({
  name: "Test Tonic",
  type_line: "Instant",
  oracle_text: "You gain 1 life.",
  power: undefined,
  toughness: undefined,
});
const giant = card({ name: "Test Giant", power: "7", toughness: "7" });

function put(
  state: GameState,
  playerId: PlayerId,
  zone: "hand" | "battlefield",
  data: ScryfallCard,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId);
  state.cards.set(c.id, { ...c, hasSummoningSickness: false });
  const key = `${playerId}-${zone}`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

const minus = (s: GameState, id: CardInstanceId) =>
  s.cards.get(id)!.counters?.find((c) => c.type === "-1/-1")?.count ?? 0;

describe("Spinerock Tyrant copies single-target spells with wither (#2483)", () => {
  let state: GameState;
  let alice: PlayerId;
  let bob: PlayerId;
  let target: CardInstanceId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice, bob] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { red: 4, generic: 4 });
    target = put(state, bob, "battlefield", giant);
  });

  function castAt(s: GameState, data: ScryfallCard, targets: Target[]) {
    const id = put(s, alice, "hand", data);
    const r = castSpell(s, alice, id, targets);
    expect(r.success).toBe(true);
    return r.state;
  }

  const atGiant = (): Target[] => [
    { type: "card", targetId: target, isValid: true },
  ];

  it("copies the spell, and both spells deal wither damage", () => {
    put(state, alice, "battlefield", tyrant);
    let s = castAt(state, strike, atGiant());
    expect(s.stack).toHaveLength(2);
    expect(s.stack[1].triggeringStackObjectId).toBe(s.stack[0].id);

    s = resolveTopOfStack(s); // the trigger: copy above the original
    expect(s.stack).toHaveLength(2);
    const [original, copy] = s.stack;
    expect(copy.isCopy).toBe(true);
    expect(copy.targets[0].targetId).toBe(target);
    expect(original.grantedKeywords).toEqual(["wither"]);
    expect(copy.grantedKeywords).toEqual(["wither"]);

    s = resolveTopOfStack(s); // the copy
    expect(minus(s, target)).toBe(3);
    expect(s.cards.get(target)!.damage).toBe(0);

    s = resolveTopOfStack(s); // the original
    expect(minus(s, target)).toBe(6);
    expect(s.cards.get(target)!.damage).toBe(0);
    expect(s.stack).toHaveLength(0);
    expect(
      s.cards.get(original.sourceCardId as CardInstanceId)!
        .resolvingSpellKeywords,
    ).toBeUndefined();
  });

  it("without the Tyrant, the same spell marks ordinary damage", () => {
    let s = castAt(state, strike, atGiant());
    expect(s.stack).toHaveLength(1);
    s = resolveTopOfStack(s);
    expect(minus(s, target)).toBe(0);
    expect(s.cards.get(target)!.damage).toBe(3);
  });

  it("doesn't trigger for a spell with no target", () => {
    put(state, alice, "battlefield", tyrant);
    const s = castAt(state, untargeted, []);
    expect(s.stack).toHaveLength(1);
  });

  it("makes no copy when the spell left the stack first", () => {
    put(state, alice, "battlefield", tyrant);
    let s = castAt(state, strike, atGiant());
    s = { ...s, stack: s.stack.slice(1) }; // the original is gone
    s = resolveTopOfStack(s);
    expect(s.stack).toHaveLength(0);
    expect(minus(s, target)).toBe(0);
  });
});
