/**
 * Card scripts — sarkhan dragon ascendant.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - Sarkhan, Dragon Ascendant: behold a Dragon, becomes a Dragon (#2614)
 */
import { CardScriptSchema, getCardScript } from "../index";
import { GameState, PlayerId, StackObject } from "../../types";
import { clearUntilEndOfTurnPT } from "../../pt-until-end-of-turn";
import { createInitialGameState, startGame } from "../../game-state";
import { hasKeyword } from "../../evergreen-keywords";
import { hasSubtype } from "../../spell-casting/affinity";
import { id, card, put, spell, battlefield } from "./helpers";
import { resolveScriptedEffects } from "../interpret";

describe("Sarkhan, Dragon Ascendant: behold a Dragon, becomes a Dragon (#2614)", () => {
  let state: GameState;
  let p1: PlayerId;
  const script = () => getCardScript("Sarkhan, Dragon Ascendant")!;
  const resolveTrigger = (s: GameState, index: number) =>
    resolveScriptedEffects(s, script().triggers![index].effects!, {
      controllerId: p1,
      sourceCardId: id("sarkhan"),
      targets: [],
    } as unknown as StackObject);
  const treasures = (s: GameState) =>
    battlefield(s, p1).filter(
      (cid) => s.cards.get(cid)!.cardData.name === "Treasure",
    ).length;
  const dragon = () => card("Shivan Dragon", "Creature — Dragon", [5, 5]);

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "sarkhan",
      card(
        "Sarkhan, Dragon Ascendant",
        "Legendary Creature — Human Druid",
        [2, 2],
      ),
    );
  });

  it("validates behold and AddSubtype", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(
      ok({
        op: "AddSubtype",
        target: "self",
        subtype: "Dragon",
        until: "end_of_turn",
      }),
    ).toBe(true);
    expect(
      ok({
        op: "AddSubtype",
        target: "creature",
        subtype: "Dragon",
        until: "end_of_turn",
      }),
    ).toBe(false);
    expect(
      ok({
        op: "CreatePredefinedToken",
        token: "treasure",
        count: 1,
        if_behold: "",
      }),
    ).toBe(false);
  });

  it("makes no Treasure with no Dragon to behold", () => {
    expect(treasures(resolveTrigger(state, 0))).toBe(0);
  });

  it("beholds a Dragon card in hand for a Treasure", () => {
    const s = put(state, p1, "shivan", dragon(), "hand");
    expect(treasures(resolveTrigger(s, 0))).toBe(1);
  });

  it("beholds a Dragon on the battlefield for a Treasure", () => {
    const s = put(state, p1, "shivan", dragon());
    expect(treasures(resolveTrigger(s, 0))).toBe(1);
  });

  it("on a Dragon entering, grows and is a flying Dragon until end of turn", () => {
    let s = resolveTrigger(state, 1);
    const sarkhan = s.cards.get(id("sarkhan"))!;
    expect(sarkhan.counters.find((c) => c.type === "+1/+1")?.count ?? 0).toBe(
      1,
    );
    expect(hasSubtype(sarkhan, "Dragon")).toBe(true);
    expect(hasSubtype(sarkhan, "Human")).toBe(true);
    expect(hasKeyword(sarkhan, "flying")).toBe(true);
    s = clearUntilEndOfTurnPT(s);
    expect(hasSubtype(s.cards.get(id("sarkhan"))!, "Dragon")).toBe(false);
  });

  it("triggers only on another Dragon you control entering", () => {
    const trigger = script().triggers![1];
    expect(trigger.subject).toBe("another");
    expect(trigger.controller).toBe("you");
    expect(trigger.subtype).toBe("Dragon");
  });
});
