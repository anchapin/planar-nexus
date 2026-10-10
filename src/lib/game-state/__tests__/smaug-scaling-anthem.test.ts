/**
 * Smaug — scaling P/T anthem via state-derived `X` (#2594 follow-up,
 * lane 36, CR 604 / 611.3c).
 *
 * "Flying. Smaug gets +X/+X where X is the number of Treasures you
 * control." v1 only models the scaling-anthem half: the schema
 * gains a `X: "treasures" | "creatures" | "lands"` field, and the
 * refresh pass in `scripted-statics.ts` reads the count and
 * writes the effective P/T to `scriptStaticPT`. The cost-reduction
 * part of real Smaug ("this spell costs {1} less to cast for each
 * Dragon you control") is a separate follow-up.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { refreshScriptedStatics } from "../keyword-actions/scripted-statics";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";
import { getCardScript } from "../card-scripts/registry";

const SMAUG =
  "Flying. Smaug gets +X/+X where X is the number of Treasures you control.";

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Creature \u2014 Dragon",
    oracle_text: "",
    mana_cost: "{4}{R}{R}",
    cmc: 6,
    colors: ["R"],
    color_identity: ["R"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "6",
    toughness: "6",
    ...overrides,
  } as ScryfallCard;
}

const smaug = card({
  name: "Smaug",
  oracle_text: SMAUG,
  power: "6",
  toughness: "6",
});
const treasure = card({
  name: "Treasure",
  type_line: "Token Artifact \u2014 Treasure",
  oracle_text: "{T}, Sacrifice this token: Add one mana of any color.",
  colors: [],
  color_identity: [],
  power: undefined,
  toughness: undefined,
});
// A second Dragon to verify `self: true` excludes other creatures.
const otherDragon = card({
  name: "Other Dragon",
  power: "4",
  toughness: "4",
});

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

const pt = (s: GameState, id: CardInstanceId) =>
  s.cards.get(id)?.scriptStaticPT;

describe("Smaug — scaling P/T anthem (lane 36)", () => {
  let state: GameState;
  let alice: PlayerId;
  let bob: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice, bob] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { red: 4, generic: 4 });
  });

  it("registers the X field on the script's static", () => {
    const script = getCardScript("Smaug");
    expect(script).toBeDefined();
    const stat = script!.statics?.[0];
    expect(stat).toBeDefined();
    expect((stat as { X?: string }).X).toBe("treasures");
    expect((stat as { affects?: { self?: boolean } }).affects?.self).toBe(
      true,
    );
  });

  it("with no Treasures, Smaug gets no anthem bonus", () => {
    const id = put(state, alice, "battlefield", smaug);
    const after = refreshScriptedStatics(state);
    // X: "treasures" overrides the integer power/toughness (both 0 in
    // the script) with 0 treasures. The refresh pass omits the
    // `scriptStaticPT` key when the net contribution is zero, so
    // `pt` is undefined.
    expect(pt(after, id)).toBeUndefined();
  });

  it("with two Treasures, Smaug gets +2/+2", () => {
    const smaugId = put(state, alice, "battlefield", smaug);
    put(state, alice, "battlefield", treasure);
    put(state, alice, "battlefield", treasure);
    const after = refreshScriptedStatics(state);
    expect(pt(after, smaugId)).toEqual({ power: 2, toughness: 2 });
  });

  it("only Smaug gets the bonus; other creatures are unaffected", () => {
    const smaugId = put(state, alice, "battlefield", smaug);
    const otherId = put(state, alice, "battlefield", otherDragon);
    put(state, alice, "battlefield", treasure);
    put(state, alice, "battlefield", treasure);
    put(state, alice, "battlefield", treasure);
    const after = refreshScriptedStatics(state);
    expect(pt(after, smaugId)).toEqual({ power: 3, toughness: 3 });
    // `self: true` excludes the other Dragon.
    expect(pt(after, otherId)).toBeUndefined();
  });

  it("opponent's Treasures do not contribute to X", () => {
    const smaugId = put(state, alice, "battlefield", smaug);
    put(state, alice, "battlefield", treasure);
    put(state, bob, "battlefield", treasure);
    put(state, bob, "battlefield", treasure);
    const after = refreshScriptedStatics(state);
    // controller: "you" + self: true -> only Alice's treasures.
    expect(pt(after, smaugId)).toEqual({ power: 1, toughness: 1 });
  });
});
