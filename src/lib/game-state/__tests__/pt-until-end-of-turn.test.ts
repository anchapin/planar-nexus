/**
 * "Target creature gets +X/+Y until end of turn" from abilities, and Tragic
 * Banshee's morbid "-13/-13 instead" (issue #2300).
 */
import {
  parseTargetedPTUntilEndOfTurn,
  clearUntilEndOfTurnPT,
} from "../pt-until-end-of-turn";
import {
  parseSpellEffects,
  parseTriggeredAbilityEffects,
  resolveStackObjectEffects,
} from "../effect-resolution";
import { markCreatureDiedThisTurn } from "../keyword-actions/morbid";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../evergreen-keywords";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

const PRIMAL_MIGHT =
  "Target creature you control gets +X/+X until end of turn. Then it fights up to one target creature you don't control. (Each deals damage equal to its power to the other.)";

const BANSHEE_EFFECT =
  "target creature an opponent controls gets -1/-1 until end of turn. If a creature died this turn, that creature gets -13/-13 until end of turn instead.";

function creature(name: string, power: number, toughness: number) {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Creature — Spirit",
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
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

describe("until-end-of-turn P/T effects", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(s.players.keys());
    state = put(s, p1, "banshee", creature("Tragic Banshee", 5, 4));
    state = put(state, p2, "ogre", creature("Ogre", 3, 3));
  });

  function resolveBanshee(s: GameState): GameState {
    return resolveStackObjectEffects(
      s,
      parseTriggeredAbilityEffects(BANSHEE_EFFECT, p1),
      id("banshee"),
      [{ type: "card", targetId: "ogre" }],
    );
  }

  it("parses a targeted change and its instead clause", () => {
    expect(parseTargetedPTUntilEndOfTurn(BANSHEE_EFFECT)).toEqual({
      power: -1,
      toughness: -1,
      instead: {
        condition: "a creature died this turn",
        power: -13,
        toughness: -13,
      },
    });
    expect(
      parseTargetedPTUntilEndOfTurn(
        "Target creature gets +2/+0 until end of turn.",
      ),
    ).toEqual({ power: 2, toughness: 0 });
    expect(
      parseTargetedPTUntilEndOfTurn("Put a -1/-1 counter on target creature."),
    ).toBeNull();
  });

  it("gives the target -1/-1 when no creature died this turn", () => {
    const ogre = resolveBanshee(state).cards.get(id("ogre"))!;
    expect(getEffectivePower(ogre)).toBe(2);
    expect(getEffectiveToughness(ogre)).toBe(2);
  });

  it("gives the target -13/-13 instead when a creature died this turn", () => {
    const ogre = resolveBanshee(markCreatureDiedThisTurn(state)).cards.get(
      id("ogre"),
    )!;
    expect(getEffectiveToughness(ogre)).toBe(0);
    expect(ogre.untilEndOfTurnPT).toEqual({ power: -13, toughness: -13 });
  });

  it("does nothing without a chosen target", () => {
    const after = resolveStackObjectEffects(
      state,
      parseTriggeredAbilityEffects(BANSHEE_EFFECT, p1),
      id("banshee"),
      [],
    );
    expect(after.cards.get(id("ogre"))!.untilEndOfTurnPT).toBeUndefined();
  });

  it("clears at end of turn", () => {
    const cleared = clearUntilEndOfTurnPT(resolveBanshee(state));
    const ogre = cleared.cards.get(id("ogre"))!;
    expect(ogre.untilEndOfTurnPT).toBeUndefined();
    expect(getEffectiveToughness(ogre)).toBe(3);
  });

  describe("Primal Might's +X/+X before the fight (#2451)", () => {
    it("parses +X/+X with the spell's X", () => {
      expect(parseTargetedPTUntilEndOfTurn(PRIMAL_MIGHT, 3)).toEqual({
        power: 3,
        toughness: 3,
      });
      expect(parseTargetedPTUntilEndOfTurn(PRIMAL_MIGHT)).toEqual({
        power: 0,
        toughness: 0,
      });
    });

    it("puts the pump ahead of the fight in the spell's effects", () => {
      const effects = parseSpellEffects(PRIMAL_MIGHT, new Map([["X", 2]]));
      const types = effects.map((e) => e.effectType);
      expect(types.indexOf("pt_until_eot")).toBeGreaterThanOrEqual(0);
      expect(types.indexOf("pt_until_eot")).toBeLessThan(
        types.indexOf("fight"),
      );
      expect(effects.find((e) => e.effectType === "pt_until_eot")).toEqual(
        expect.objectContaining({ power: 2, toughness: 2 }),
      );
    });

    it("the pumped creature deals its new power in the fight", () => {
      const after = resolveStackObjectEffects(
        state,
        parseSpellEffects(PRIMAL_MIGHT, new Map([["X", 2]])),
        undefined,
        [
          { type: "card", targetId: "banshee" },
          { type: "card", targetId: "ogre" },
        ],
      );
      const banshee = after.cards.get(id("banshee"))!;
      expect(banshee.untilEndOfTurnPT).toEqual({ power: 2, toughness: 2 });
      expect(getEffectivePower(banshee)).toBe(7);
      expect(after.cards.get(id("ogre"))!.damage).toBe(7);
      expect(banshee.damage).toBe(3);
    });

    it("does not pump twice when parsed as a triggered ability", () => {
      const effects = parseTriggeredAbilityEffects(
        "Target creature gets +2/+0 until end of turn.",
        p1,
      );
      expect(
        effects.filter((e) => e.effectType === "pt_until_eot"),
      ).toHaveLength(1);
    });
  });
});
