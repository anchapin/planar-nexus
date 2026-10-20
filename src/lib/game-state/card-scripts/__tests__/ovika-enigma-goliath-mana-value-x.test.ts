/**
 * Ovika Enigma Goliath — X = manaValue of triggering spell (#2831,
 * follow-up to #2559 lane 2).
 *
 * Ovika reads "Whenever you cast a noncreature spell, put X +1/+1 counters
 * on target creature you control, where X is the number of mana spent
 * to cast that spell. Create a Treasure token." (Gate of the Citadel,
 * #273.)
 *
 * X here is NOT the ability''s own {X} cost — it is a runtime lookup
 * into the triggering spell''s converted mana cost at the time the
 * trigger fires (CR 202.3). The engine reads the triggering spell''s
 * `sourceCardId` off the stack, then the cast card''s
 * `cardData.cmc`. Lane parity with `ashroot-animist-literal-x-acti
 * vated.test.ts` (literal X from cost) and `slice-from-the-shadows-
 * discard-x.test.ts` (Discard.amount X-capable — #2552 lane 2).
 *
 * The interpreter arms this via `X: "manaValueOfTriggeringSpell"`
 * (issue #2831) on both `PutCounters.amount` (counters half) and
 * `CreateToken.count` (Treasure half) — which `withX` does NOT
 * substitute (it''s a runtime-X enum value resolved at apply-time).
 */
import { getCardScript } from "../index";
import { resolveScriptedEffects } from "../interpret";
import { createCardInstance } from "../../card-instance";
import { createInitialGameState } from "../../game-state";
import { ZoneType, getZoneKey } from "../../types/zones";
import type { CardInstanceId, GameState, PlayerId, Target } from "../../types";

let P1: PlayerId;

function card(name: string, typeLine: string, cmc: number): {
  name: string;
  type_line: string;
  mana_cost: string;
  cmc: number;
  oracle_text: string;
  colors: string[];
  color_identity: string[];
  id: string;
  legalities: Record<string, string>;
} {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    mana_cost: `{${cmc}}`, // synthetic mana cost for cmc-based testing
    cmc,
    oracle_text: "",
    colors: [],
    color_identity: [],
    legalities: { standard: "legal" },
  };
}

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ReturnType<typeof card>,
  zone: ZoneType = ZoneType.BATTLEFIELD,
): GameState {
  const zoneKey = getZoneKey(playerId, zone);
  const cards = new Map(state.cards);
  cards.set(
    cardId as CardInstanceId,
    createCardInstance(data as unknown as Parameters<typeof createCardInstance>[0], playerId, playerId, {
      id: cardId as CardInstanceId,
      currentZoneKey: zoneKey,
    }),
  );
  const zones = new Map(state.zones);
  const z = zones.get(zoneKey);
  if (!z) return state;
  zones.set(zoneKey, { ...z, cardIds: [...z.cardIds, cardId as CardInstanceId] });
  return { ...state, cards, zones };
}

function startTwoPlayerState(): GameState {
  const base = createInitialGameState(["Player1", "Player2"], 20, false);
  const started = { ...base, players: base.players };
  [P1] = Array.from(started.players.keys());
  return started;
}

describe("Ovika Enigma Goliath (#2831): X = manaValue of triggering spell", () => {
  it("registry exposes Ovika with PutCounters + CreateToken using X: 'manaValueOfTriggeringSpell'", () => {
    const ovika = getCardScript("Ovika Enigma Goliath");
    expect(ovika).toBeDefined();
    const triggers = ovika!.triggers ?? [];
    expect(triggers.length).toBeGreaterThan(0);
    const castTrigger = triggers.find((t) => t.event === "cast");
    expect(castTrigger).toBeDefined();
    const effects = (castTrigger?.effects ?? []) as unknown as Array<{
      op: string;
      amount?: unknown;
      count?: unknown;
      X?: unknown;
    }>;
    expect(effects).toHaveLength(2);
    expect(effects[0].op).toBe("PutCounters");
    expect(effects[1].op).toBe("CreateToken");
    if (effects[0].op !== "PutCounters") throw new Error("narrow");
    if (effects[1].op !== "CreateToken") throw new Error("narrow");
    expect(effects[0].amount).toBe("X");
    expect(effects[0].X).toBe("manaValueOfTriggeringSpell");
    expect(effects[1].count).toBe("X");
    expect(effects[1].X).toBe("manaValueOfTriggeringSpell");
  });

  it("X=3 (cmc=3 trigger) puts 3 +1/+1 counters and creates 3 Treasures", () => {
    let state = startTwoPlayerState();
    // Place the triggering noncreature spell (a 3-cmc instant) on the
    // stack with id "triggering-spell-stack-id" so the resolver can
    // look up its cmc via the spell''s `sourceCardId`.
    const TRIGGERING_STACK_ID = "triggering-spell-stack-id";
    const TRIGGERING_CARD_ID = "triggering-spell-card";
    state = put(
      state,
      P1,
      "ovika",
      card("Ovika Enigma Goliath", "Legendary Creature — Giant Warrior", 7),
    );
    state = put(
      state,
      P1,
      "target-creature",
      card("Target Creature", "Creature — Human Soldier", 2),
    );
    state = put(
      state,
      P1,
      TRIGGERING_CARD_ID,
      card("Lightning Bolt", "Instant", 3),
    );

    // Place the spell on the stack so `resolveManaValueOfTriggeringSpell`
    // can find it via `state.stack.find(s => s.id === triggeringStackObjectId)`.
    state = {
      ...state,
      stack: [
        ...state.stack,
        {
          id: TRIGGERING_STACK_ID,
          type: "spell" as const,
          sourceCardId: TRIGGERING_CARD_ID as CardInstanceId,
          controllerId: P1,
          name: "Lightning Bolt",
          text: "Lightning Bolt deals 3 damage to any target.",
          targets: [],
          chosenModes: [],
          wasKicked: false,
          timesKicked: 0,
        } as unknown as (typeof state.stack)[number],
      ],
    };

    const ovika = getCardScript("Ovika Enigma Goliath")!;
    const triggers = ovika.triggers ?? [];
    const castTrigger = triggers.find((t) => t.event === "cast")!;
    const effects = (castTrigger.effects ?? []) as unknown as Parameters<
      typeof resolveScriptedEffects
    >[1];

    const targetCard: Target = {
      type: "card",
      targetId: "target-creature",
      isValid: true,
    };

    const resolved = resolveScriptedEffects(state, effects, {
      controllerId: P1,
      sourceCardId: "ovika" as CardInstanceId,
      targets: [targetCard],
      triggeringStackObjectId: TRIGGERING_STACK_ID,
      variableValues: new Map(),
      chosenModes: [],
      wasKicked: false,
      timesKicked: 0,
    });

    // Counter-helper checks pass via raw field access since each effect runs
    // both halves within `resolveScriptedEffects`.
    const targetCi = resolved.cards.get("target-creature" as CardInstanceId);
    if (process.env["DEBUG_OVIKA"]) {
      const ci = targetCi as unknown as { counters?: unknown };
      // eslint-disable-next-line no-console
      console.log(
        "[debug test] BEFORE FILTER targetCi.counters=",
        JSON.stringify(ci?.counters),
      );
    }
    const counters = (targetCi as unknown as { counters: { type: string; count: number }[] })?.counters ?? [];
    const plusOneCounters = counters
      .filter((c) => c.type === "+1/+1")
      .reduce((sum, c) => sum + c.count, 0);
    if (process.env["DEBUG_OVIKA"]) {
      // eslint-disable-next-line no-console
      console.log(
        "[debug test] plusOneCounters=",
        plusOneCounters,
        "len(filters)=",
        counters.filter((c) => c.type === "+1/+1").length,
      );
    }

    // Ovika resolves manaValue from the triggering spell''s cmc (3).
    const sanity = JSON.stringify((targetCi as unknown as { counters?: unknown })?.counters);
    expect(sanity).toBe('[{"type":"+1/+1","count":3}]');
    expect(plusOneCounters).toBe(3);

    // Treasure tokens: count cards in P1''s battlefield whose name is
    // "Treasure" (CR 111.4: a token''s name is its subtype(s); the
    // ovika effect produces tokens with name="Treasure").
    const bfZone = resolved.zones.get(getZoneKey(P1, ZoneType.BATTLEFIELD));
    const treasureCount = (bfZone?.cardIds ?? []).filter((id) => {
      const ci = resolved.cards.get(id);
      if (!ci) return false;
      return ci.cardData.name === "Treasure";
    }).length;

    // Ovika creates 1 Treasure token (the resolver runs the CreateToken effect
    // with count=3 creating 3 tokens — total 3 Treasures).
    if (process.env["DEBUG_OVIKA"]) {
      // eslint-disable-next-line no-console
      console.log(
        "[debug test] bf cards=",
        JSON.stringify(
          (bfZone?.cardIds ?? []).map((id) => {
            const ci = resolved.cards.get(id);
            return {
              id,
              name: ci?.cardData?.name,
              subtypes: (ci?.cardData as { subtypes?: string[] })?.subtypes,
            };
          }),
        ),
      );
    }
    expect(treasureCount).toBe(3);
  });

  it("X=0 (no triggering spell set) puts 0 counters and 0 Treasures (defensive default)", () => {
    let state = startTwoPlayerState();
    state = put(
      state,
      P1,
      "ovika",
      card("Ovika Enigma Goliath", "Legendary Creature — Giant Warrior", 7),
    );
    state = put(
      state,
      P1,
      "target-creature",
      card("Target Creature", "Creature — Human Soldier", 2),
    );

    const ovika = getCardScript("Ovika Enigma Goliath")!;
    const triggers = ovika.triggers ?? [];
    const castTrigger = triggers.find((t) => t.event === "cast")!;
    const effects = (castTrigger.effects ?? []) as unknown as Parameters<
      typeof resolveScriptedEffects
    >[1];

    const targetCard: Target = {
      type: "card",
      targetId: "target-creature",
      isValid: true,
    };

    const resolved = resolveScriptedEffects(state, effects, {
      controllerId: P1,
      sourceCardId: "ovika" as CardInstanceId,
      targets: [targetCard],
      // No triggeringStackObjectId — defensive default resolves X to 0.
      variableValues: new Map(),
      chosenModes: [],
      wasKicked: false,
      timesKicked: 0,
    });

    const targetCi = resolved.cards.get("target-creature" as CardInstanceId);
    const counters = (targetCi as unknown as { counters: { type: string; count: number }[] })?.counters ?? [];
    const plusOneCounters = counters
      .filter((c) => c.type === "+1/+1")
      .reduce((sum, c) => sum + c.count, 0);
    expect(plusOneCounters).toBe(0);

    const bfZone = resolved.zones.get(getZoneKey(P1, ZoneType.BATTLEFIELD));
    const treasureCount = (bfZone?.cardIds ?? []).filter((id) => {
      const ci = resolved.cards.get(id);
      if (!ci) return false;
      return ci.cardData.name === "Treasure";
    }).length;
    expect(treasureCount).toBe(0);
  });

  it("X=5 (cmc=5 trigger) substitutes to 5 in both halves (counters + tokens)", () => {
    let state = startTwoPlayerState();
    const TRIGGERING_STACK_ID_5 = "triggering-spell-stack-id-5";
    state = put(
      state,
      P1,
      "ovika",
      card("Ovika Enigma Goliath", "Legendary Creature — Giant Warrior", 7),
    );
    state = put(
      state,
      P1,
      "target-creature",
      card("Target Creature", "Creature", 2),
    );
    state = put(
      state,
      P1,
      "triggering-spell-card-5",
      card("Big Instant", "Instant", 5),
    );
    // Place the 5-cmc spell on the stack so the runtime-X resolver
    // can read its cmc via state.stack.find(s => s.id === ...).
    state = {
      ...state,
      stack: [
        ...state.stack,
        {
          id: TRIGGERING_STACK_ID_5,
          type: "spell" as const,
          sourceCardId: "triggering-spell-card-5" as CardInstanceId,
          controllerId: P1,
          name: "Big Instant",
          text: "",
          targets: [],
          chosenModes: [],
          wasKicked: false,
          timesKicked: 0,
        } as unknown as (typeof state.stack)[number],
      ],
    };

    const ovika = getCardScript("Ovika Enigma Goliath")!;
    const triggers = ovika.triggers ?? [];
    const castTrigger = triggers.find((t) => t.event === "cast")!;
    const effects = (castTrigger.effects ?? []) as unknown as Parameters<
      typeof resolveScriptedEffects
    >[1];

    const targetCard: Target = {
      type: "card",
      targetId: "target-creature",
      isValid: true,
    };

    const resolved = resolveScriptedEffects(state, effects, {
      controllerId: P1,
      sourceCardId: "ovika" as CardInstanceId,
      targets: [targetCard],
      triggeringStackObjectId: TRIGGERING_STACK_ID_5,
      variableValues: new Map(),
      chosenModes: [],
      wasKicked: false,
      timesKicked: 0,
    });

    const targetCi = resolved.cards.get("target-creature" as CardInstanceId);
    const counters = (targetCi as unknown as { counters: { type: string; count: number }[] })?.counters ?? [];
    const plusOneCounters = counters
      .filter((c) => c.type === "+1/+1")
      .reduce((sum, c) => sum + c.count, 0);
    expect(plusOneCounters).toBe(5);

    const bfZone = resolved.zones.get(getZoneKey(P1, ZoneType.BATTLEFIELD));
    const treasureCount = (bfZone?.cardIds ?? []).filter((id) => {
      const ci = resolved.cards.get(id);
      if (!ci) return false;
      return ci.cardData.name === "Treasure";
    }).length;
    expect(treasureCount).toBe(5);
  });
});
