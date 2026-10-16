/**
 * Gorehorn Raider (FDN 89) — 1/1 red Goblin token half (lane 89) +
 * keywords-on-token menace (lane 96).
 *
 * Wave 4.8 follow-up 12 lane 89 (#2614 follow-up). Gorehorn Raider's
 * full oracle (per the handoff's "third warmup"): raid + ETB +
 * DealDamage + 1/1 red Goblin token. The lane 84 v1 minimum shipped
 * the raid + ETB + DealDamage half only. Lane 89 chains the
 * `CreateToken` effect (1/1 red Goblin) onto the existing trigger.
 *
 * Wave 4.8 follow-up 13 lane 96 (#2614 follow-up). The
 * Redcap Gutter-Dweller-style deferred half — "create a 1/1 red
 * Goblin creature token with menace" — is JSON-only: chain a
 * `CreateToken` effect with `keywords: ["menace"]` onto the
 * existing trigger. The lane 66 `CreateToken` substrate already
 * supports `keywords: ["menace"]`; this lane adds the field to
 * Gorehorn Raider's `CreateToken` effect.
 *
 * The v1 minimum uses the existing `CreateToken` op (lane 66's
 * substrate) with `count: 1, power: 1, toughness: 1, color: "R",
 * subtypes: ["Goblin"], keywords: ["menace"]`. No new schema arm;
 * the engine substrate already covers the keywords field (the
 * engine capitalizes the keyword and stamps it on the token's
 * `cardData.keywords` array).
 *
 * Out of scope for lane 96 (each a follow-up lane):
 * - the "create X 1/1 red Goblin creature tokens" X-count
 *   variant (lane 97)
 * - the "create a 1/1 red Goblin creature token AND exile it"
 *   multi-effect (a future lane)
 */
import { getCardScript } from "../index";
import {
  resolveScriptedAbility,
} from "../interpret";
import { detectTriggeredAbilities } from "../../abilities/triggered";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { markAttackedThisTurn } from "../../keyword-actions/raid";
import { createCardInstance } from "../../card-instance";
import {
  createInitialGameState,
  startGame,
} from "../../game-state";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  Target,
} from "../../types";

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
  const canonicalKey = `${playerId}-${zone}`;
  const cards = new Map(state.cards);
  cards.set(
    id(cardId),
    createCardInstance(data, playerId, playerId, {
      id: id(cardId),
      currentZoneKey: canonicalKey,
    }),
  );
  const zones = new Map(state.zones);
  const z = zones.get(canonicalKey);
  if (!z) return state;
  zones.set(canonicalKey, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

describe("Gorehorn Raider (FDN 89): raid + ETB 1/1 red Goblin token with menace (lanes 89 & 96)", () => {
  it("registry exposes Gorehorn Raider with DealDamage + CreateToken-with-menace effects chained", () => {
    const raider = getCardScript("Gorehorn Raider");
    expect(raider).toBeDefined();
    const trig = raider!.triggers![0];
    expect(trig.effects).toEqual([
      { op: "DealDamage", amount: 2, target: "any" },
      {
        op: "CreateToken",
        count: 1,
        power: 1,
        toughness: 1,
        color: "red",
        subtypes: ["Goblin"],
        keywords: ["menace"],
      },
    ]);
  });

  it("ETB trigger is suppressed when the controller has not attacked (raid gate)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "raider", card("Gorehorn Raider", "Creature — Minotaur Pirate", [3, 3]));
    expect(state.players.get(p1)?.attackedThisTurn).toBeFalsy();

    const triggers = detectTriggeredAbilities(state, "entersBattlefield");
    const raiderTriggers = triggers.filter(
      (t) => t.sourceCardId === id("raider"),
    );
    expect(raiderTriggers).toHaveLength(0);
  });

  it("end-to-end: trigger fires, deals 2 damage, creates a 1/1 red Goblin token (lane 89)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "raider", card("Gorehorn Raider", "Creature — Minotaur Pirate", [3, 3]));
    state = markAttackedThisTurn(state, [p1]);

    const triggers = detectTriggeredAbilities(state, "entersBattlefield");
    const raiderTriggers = triggers.filter(
      (t) => t.sourceCardId === id("raider"),
    );
    expect(raiderTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, raiderTriggers);
    const stackObject = stacked.stack[0];
    const targeted = {
      ...stacked,
      stack: [
        {
          ...stackObject,
          targets: [
            { type: "player", targetId: p2, isValid: true } as Target,
          ],
        },
      ],
    };

    const beforeLife = targeted.players.get(p2)!.life;
    const beforeBattlefield =
      targeted.zones.get(`${p1}-battlefield`)!.cardIds.length;
    const resolved = resolveScriptedAbility(targeted, targeted.stack[0])!;

    // DealDamage 2 to opponent.
    expect(resolved.players.get(p2)!.life).toBe(beforeLife - 2);

    // Lane 89: CreateToken creates a new card on the controller's
    // battlefield. The token's printed cardData carries the lane 89
    // shape: name = "Goblin", power = 1, toughness = 1, color = R,
    // type_line includes "Goblin".
    const afterBattlefield =
      resolved.zones.get(`${p1}-battlefield`)!.cardIds.length;
    expect(afterBattlefield).toBe(beforeBattlefield + 1);

    const goblinId = resolved.zones
      .get(`${p1}-battlefield`)!
      .cardIds.find((cid) => !targeted.cards.has(cid));
    expect(goblinId).toBeDefined();
    const goblin = resolved.cards.get(goblinId!);
    expect(goblin).toBeDefined();
    expect(goblin!.controllerId).toBe(p1);
    expect(goblin!.cardData.name).toBe("Goblin");
    expect(goblin!.cardData.power).toBe("1");
    expect(goblin!.cardData.toughness).toBe("1");
    expect(goblin!.cardData.colors).toEqual(["red"]);
    expect(goblin!.cardData.type_line.toLowerCase()).toContain("goblin");
    expect(goblin!.cardData.type_line.toLowerCase()).toContain("creature");
    // Lane 96: the keywords-on-token arm — "create a 1/1 red
    // Goblin creature token with menace". The engine's
    // `CreateToken` op capitalizes the keyword ("Menace") and
    // stamps it on the token's `cardData.keywords` array; the
    // keyword surfaces in `hasKeyword` alongside the printed
    // keyword list. The oracle_text is set to the capitalized
    // keywords joined by ", ".
    expect(goblin!.cardData.keywords).toEqual(["Menace"]);
  });

  it("lane 96: the Goblin token has menace via cardData.keywords (regression)", () => {
    // Standalone test for the lane 96 half — the end-to-end
    // test above also asserts the keyword list; this test
    // isolates the menace-specific behavior so a future lane
    // change to the existing CreateToken substrate doesn't
    // accidentally drop the keyword-stamping logic.
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "raider", card("Gorehorn Raider", "Creature — Minotaur Pirate", [3, 3]));
    state = markAttackedThisTurn(state, [p1]);

    const triggers = detectTriggeredAbilities(state, "entersBattlefield");
    const raiderTriggers = triggers.filter(
      (t) => t.sourceCardId === id("raider"),
    );
    const { state: stacked } = putTriggersOnStack(state, raiderTriggers);
    const stackObject = stacked.stack[0];
    const targeted = {
      ...stacked,
      stack: [
        {
          ...stackObject,
          targets: [
            { type: "player", targetId: p1, isValid: true } as Target,
          ],
        },
      ],
    };

    const resolved = resolveScriptedAbility(targeted, targeted.stack[0])!;
    const goblinId = resolved.zones
      .get(`${p1}-battlefield`)!
      .cardIds.find((cid) => !targeted.cards.has(cid));
    const goblin = resolved.cards.get(goblinId!);
    expect(goblin!.cardData.keywords).toContain("Menace");
  });
});