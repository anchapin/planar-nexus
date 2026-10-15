/**
 * Hornet Queen (DSC 184) — ETB create 4 tokens + self static (lane 114 piece 2).
 *
 * Wave 4.8 follow-up 18 piece 1 (#2614 follow-up). Hornet
 * Queen's full oracle:
 *
 *   "Flying, deathtouch
 *    When this creature enters, create four 1/1 green
 *    Insect creature tokens with flying and deathtouch."
 *
 * The card lands entirely on shipped substrate:
 *   - Self-static `affects: { controller: "you", self: true }`
 *     + `keywords: ["flying", "deathtouch"]` (lane 91 pattern
 *     from Twinblade Paladin — without the while_condition
 *     gate since Hornet Queen is unconditional).
 *   - ETB `CreateToken { count: 4, power: 1, toughness: 1,
 *     color: "green", subtypes: ["Insect"], keywords: ["flying",
 *     "deathtouch"] }` — the integer `count: 4` (no `X` arm),
 *     `keywords` arm writes both to `cardData.keywords` AND
 *     `embeddedStaticKeywords` per the lane 66 substrate, so
 *     the Insect tokens have both keywords stamped at create
 *     time.
 *
 * Out of scope for lane 114 piece 1 (each a follow-up lane):
 *   - Avenger of Zendikar's `count: X` ETB ("create a 0/1
 *     Plant for each land you control") — needs a new
 *     `CreateToken.X: "landsYouControl"` arm parallel to lane
 *     97's `yourCreatures`. See `wave4-blockers.md`.
 *   - Avenger of Zendikar's Landfall "you may put a +1/+1
 *     counter on each Plant you control" — needs a new
 *     `PutCounters` "each" target mode (`target:
 *     "each_creature"` with subtype filter) OR a parallel
 *     `PutCountersEach` op. See `wave4-blockers.md`.
 */
import { hasKeyword } from "../../evergreen-keywords";
import { refreshScriptedStatics } from "../../keyword-actions/scripted-statics";
import { createCardInstance } from "../../card-instance";
import {
  createInitialGameState,
  startGame,
} from "../../game-state";
import { detectTriggeredAbilities } from "../../abilities/triggered";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { resolveScriptedAbility } from "../interpret";
import { getCardScript } from "../index";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../../types";

const id = (s: string) => s as CardInstanceId;

function card(
  name: string,
  typeLine: string,
  pt?: [number, number],
): ScryfallCard {
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

function countTokenCards(state: GameState, playerId: PlayerId): number {
  const bf = state.zones.get(`${playerId}-battlefield`);
  if (!bf) return 0;
  let n = 0;
  for (const cid of bf.cardIds) {
    const ci = state.cards.get(cid);
    if (!ci) continue;
    const tl = (ci.cardData.type_line ?? "").toLowerCase();
    // The token is created with `name: "Insect"` and the
    // type line stamps as `Token Creature — Insect`. The
    // queen itself is a regular Creature — Insect; only the
    // stamped-token instances on the battlefield should
    // count here.
    if (!tl.startsWith("token ")) continue;
    if (!tl.includes("creature")) continue;
    if (!tl.includes("insect")) continue;
    n += 1;
  }
  return n;
}

describe("Hornet Queen (DSC 184): self flying+deathtouch static + ETB four 1/1 Insect tokens (lane 114 piece 1)", () => {
  it("registry exposes Hornet Queen with a self static + an ETB CreateToken with count 4 + Insect subtype + flying+deathtouch keywords (lane 114 piece 1)", () => {
    const queen = getCardScript("Hornet Queen");
    expect(queen).toBeDefined();
    expect(queen!.statics).toBeDefined();
    expect(queen!.statics).toHaveLength(1);
    const staticAbility = queen!.statics![0];
    expect(staticAbility.keywords).toEqual(["flying", "deathtouch"]);
    expect(staticAbility.affects.controller).toBe("you");
    expect(staticAbility.affects.self).toBe(true);
    // No while_condition — Hornet Queen is unconditional.
    expect(staticAbility.while_condition).toBeUndefined();

    expect(queen!.triggers).toBeDefined();
    expect(queen!.triggers).toHaveLength(1);
    const trig = queen!.triggers![0];
    expect(trig.event).toBe("etb");
    expect(trig.subject).toBe("self");
    expect(trig.effects).toHaveLength(1);
    const eff = trig.effects![0];
    expect(eff.op).toBe("CreateToken");
    if (eff.op !== "CreateToken") throw new Error("narrow");
    expect(eff.count).toBe(4);
    expect(eff.power).toBe(1);
    expect(eff.toughness).toBe(1);
    expect(eff.color).toBe("green");
    expect(eff.subtypes).toEqual(["Insect"]);
    expect(eff.keywords).toEqual(["flying", "deathtouch"]);
    // No X arm — integer count: 4 only.
    expect(eff.X).toBeUndefined();
  });

  it("self static stamps flying+deathtouch on the queen via refreshScriptedStatics (no while_condition)", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "queen",
      card("Hornet Queen", "Creature — Insect", [2, 2]),
    );

    // Refresh pass.
    const refreshed = refreshScriptedStatics(state);
    const queenCard = refreshed.cards.get(id("queen"))!;
    expect(queenCard.scriptStaticKeywords ?? []).toEqual([
      "deathtouch",
      "flying",
    ]);
    // hasKeyword reads both cardData.keywords and embeddedStaticKeywords
    // — the source card has no oracle keywords; we verify the
    // scripted static path takes effect.
    expect(hasKeyword(queenCard, "flying")).toBe(true);
    expect(hasKeyword(queenCard, "deathtouch")).toBe(true);
  });

  it("ETB fires a single trigger that creates four 1/1 green Insect tokens with flying + deathtouch", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "queen",
      card("Hornet Queen", "Creature — Insect", [2, 2]),
    );

    const before = state.zones.get(`${p1}-battlefield`)!.cardIds.length;

    const detected = detectTriggeredAbilities(state, "entersBattlefield");
    const sourceTriggers = detected.filter(
      (t) => t.sourceCardId === id("queen"),
    );
    expect(sourceTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, sourceTriggers);
    const stackObject = stacked.stack[0];
    const resolved = resolveScriptedAbility(stacked, stackObject)!;

    // Four Insect tokens landed on p1's battlefield (the queen itself
    // was already there at the time the trigger fired).
    expect(countTokenCards(resolved, p1)).toBe(4);
    expect(
      resolved.zones.get(`${p1}-battlefield`)!.cardIds.length,
    ).toBe(before + 4);

    // Each Insect token must carry both keywords stamped at create time.
    const bf = resolved.zones.get(`${p1}-battlefield`)!;
    let tokensSampled = 0;
    for (const cid of bf.cardIds) {
      const ci = resolved.cards.get(cid);
      if (!ci) continue;
      const tl = (ci.cardData.type_line ?? "").toLowerCase();
      if (!tl.startsWith("token ")) continue;
      if (!tl.includes("insect")) continue;
      tokensSampled += 1;
      expect(hasKeyword(ci, "flying")).toBe(true);
      expect(hasKeyword(ci, "deathtouch")).toBe(true);
    }
    expect(tokensSampled).toBe(4);
  });
});
