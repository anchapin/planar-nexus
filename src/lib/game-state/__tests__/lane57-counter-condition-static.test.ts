/**
 * Counter-condition static — engine arm
 * (Wave 4.8 follow-up 14 lane 57, #2614 follow-up).
 *
 * The drafter list (#2614) flagged Redcap Gutter-Dweller's
 * "Goblins you control have menace as long as this has three
 * or more counters on it" half as deferred since Wave 4.8
 * lane 57 (#2731) shipped only the chosen-color + add_color
 * + Treasure-token halves. This lane wires the engine arm
 * for the menace-when-3+-counters static.
 *
 * Schema (card-scripts/schema.ts, StaticSchema):
 *   `while_condition: { kind: "counter_minimum", counter:
 *   string, op: "gte" | "eq", n: int >= 0 }` — extends the
 *   lane 91 `life_minimum` discriminator with a counter ledger
 *   arm. The schema's `.discriminatedUnion` rejects mixing
 *   kinds (a `life_minimum` + `counter_minimum` arm on the
 *   same static is invalid).
 *
 * Engine (keyword-actions/scripted-statics.ts):
 *   `evaluateStaticWhileCondition` consults
 *   `source.instanceCounters[cond.counter]` (the per-instance
 *   ledger stamped by `enters_with_counters_per_match` /
 *   `enters_with_counters` from lane 59 / 67) and a
 *   comparator (gte|eq). When the gate evaluates false the
 *   static's keywords / power / toughness / X arms are NOT
 *   stamped on the affected permanent — the static is inert
 *   for that pass. When true the static applies normally.
 *
 * Sample card: Redcap Gutter-Dweller (FDN #532). The JSON
 * already exposes the chosen-color + add_color static + the
 * Treasure-token trigger (lane 57); this lane adds the
 * menace-when-3+-counters static with `keywords: ["menace"]`,
 * `affects: { controller: "you", subtype: "Goblin" }`, and
 * `while_condition: { kind: "counter_minimum", counter:
 * "+1/+1", op: "gte", n: 3 }`.
 *
 * Test harness pattern: synthetic script registered via
 * `CardScriptSchema.parse + registerCardScripts`, mirroring
 * the lane 49/52/55/62/93/94/96 pattern. The real
 * `redcap_gutter_dweller.json` carries the same arm — the
 * dedicated test on the real card is in
 * `redcap-gutter-dweller-full.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { refreshScriptedStatics } from "../keyword-actions/scripted-statics";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test Host Counter-Condition Static (lane 57)";

const HOST_SCRIPT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle:
    "Goblins you control have menace as long as this has three or more +1/+1 counters on it.",
  statics: [
    {
      text: "Goblins you control have menace as long as this has three or more +1/+1 counters on it.",
      affects: { controller: "you", subtype: "Goblin" },
      keywords: ["menace"],
      while_condition: {
        kind: "counter_minimum",
        counter: "+1/+1",
        op: "gte",
        n: 3,
      },
    },
  ],
});

function card(name: string, type_line: string): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line,
    oracle_text: "",
    mana_cost: "{1}",
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "1",
    toughness: "1",
  } as ScryfallCard;
}

function putOnBattlefield(
  state: GameState,
  playerId: PlayerId,
  data: ScryfallCard,
  instanceCounters?: Record<string, number>,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId, {
    id: `mock-${data.id}` as CardInstanceId,
    currentZoneKey: `${playerId}-battlefield`,
  });
  if (instanceCounters) {
    c.instanceCounters = { ...instanceCounters };
  }
  state.cards.set(c.id, c);
  const key = `${playerId}-battlefield`;
  const z = state.zones.get(key);
  if (!z) return c.id;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

describe("Counter-condition static — engine arm (Wave 4.8 follow-up 14 lane 57)", () => {
  beforeEach(() => {
    resetCardScriptsForTests();
    registerCardScripts([HOST_SCRIPT]);
  });
  afterEach(() => {
    resetCardScriptsForTests();
  });

  it("accepts counter_minimum on a static with a single keyword arm", () => {
    const parsed = CardScriptSchema.parse({
      name: "Synth Static Counter-Condition",
      oracle:
        "Goblins you control have menace as long as this has 3 or more +1/+1 counters on it.",
      statics: [
        {
          text: "Goblins you control have menace as long as this has 3 or more +1/+1 counters on it.",
          affects: { controller: "you", subtype: "Goblin" },
          keywords: ["menace"],
          while_condition: {
            kind: "counter_minimum",
            counter: "+1/+1",
            op: "gte",
            n: 3,
          },
        },
      ],
    });
    expect(parsed.statics?.[0].while_condition).toEqual({
      kind: "counter_minimum",
      counter: "+1/+1",
      op: "gte",
      n: 3,
    });
  });

  it("rejects counter_minimum with a negative n value", () => {
    expect(() =>
      CardScriptSchema.parse({
        name: "Synth Static Counter-Condition Negative",
        oracle: "Goblins have menace when this has -3 counters.",
        statics: [
          {
            text: "Goblins have menace when this has -3 counters.",
            affects: { controller: "you", subtype: "Goblin" },
            keywords: ["menace"],
            while_condition: {
              kind: "counter_minimum",
              counter: "+1/+1",
              op: "gte",
              n: -1,
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects counter_minimum with an unknown op", () => {
    expect(() =>
      CardScriptSchema.parse({
        name: "Synth Static Counter-Condition BadOp",
        oracle: "Goblins have menace when this has <3 counters.",
        statics: [
          {
            text: "Goblins have menace when this has <3 counters.",
            affects: { controller: "you", subtype: "Goblin" },
            keywords: ["menace"],
            while_condition: {
              kind: "counter_minimum",
              counter: "+1/+1",
              op: "lte",
              n: 3,
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts counter_minimum with op:eq for exact-count variants", () => {
    const parsed = CardScriptSchema.parse({
      name: "Synth Static Counter-Condition Eq",
      oracle: "Goblins have menace when this has exactly 5 +1/+1 counters.",
      statics: [
        {
          text: "Goblins have menace when this has exactly 5 +1/+1 counters.",
          affects: { controller: "you", subtype: "Goblin" },
          keywords: ["menace"],
          while_condition: {
            kind: "counter_minimum",
            counter: "+1/+1",
            op: "eq",
            n: 5,
          },
        },
      ],
    });
    const wc = parsed.statics?.[0].while_condition;
    expect(wc?.kind).toBe("counter_minimum");
    if (wc?.kind === "counter_minimum") {
      expect(wc.op).toBe("eq");
      expect(wc.n).toBe(5);
    }
  });

  it("static is INERT when the source has 0 +1/+1 counters (no keywords stamped)", () => {
    const state = startGame(
      createInitialGameState(["Alice", "Bob"], 20, false),
    );
    const [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;

    const hostData = card(HOST_NAME, "Creature — Goblin Rogue");
    const goblinData = card("Test Goblin", "Creature — Goblin");
    const hostId = putOnBattlefield(state, alice, hostData, {
      "+1/+1": 0,
    });
    putOnBattlefield(state, alice, goblinData);

    const refreshed = refreshScriptedStatics(state);
    const goblin = refreshed.cards.get(
      Array.from(refreshed.cards.keys()).find((id) => {
        const c = refreshed.cards.get(id);
        return c?.cardData.name === "Test Goblin";
      })!,
    );
    expect(goblin?.scriptStaticKeywords ?? []).not.toContain("menace");
    expect(refreshed.cards.get(hostId)?.scriptStaticKeywords ?? []).toEqual(
      [],
    );
  });

  it("static is INERT when the source has 2 +1/+1 counters (below threshold)", () => {
    const state = startGame(
      createInitialGameState(["Alice", "Bob"], 20, false),
    );
    const [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;

    const hostData = card(HOST_NAME, "Creature — Goblin Rogue");
    const goblinData = card("Test Goblin", "Creature — Goblin");
    const hostId = putOnBattlefield(state, alice, hostData, {
      "+1/+1": 2,
    });
    putOnBattlefield(state, alice, goblinData);

    const refreshed = refreshScriptedStatics(state);
    const goblin = refreshed.cards.get(
      Array.from(refreshed.cards.keys()).find((id) => {
        const c = refreshed.cards.get(id);
        return c?.cardData.name === "Test Goblin";
      })!,
    );
    expect(goblin?.scriptStaticKeywords ?? []).not.toContain("menace");
    expect(refreshed.cards.get(hostId)?.scriptStaticKeywords ?? []).toEqual(
      [],
    );
  });

  it("static APPLIES when the source has exactly 3 +1/+1 counters (gte threshold met)", () => {
    const state = startGame(
      createInitialGameState(["Alice", "Bob"], 20, false),
    );
    const [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;

    const hostData = card(HOST_NAME, "Creature — Goblin Rogue");
    const goblinData = card("Test Goblin", "Creature — Goblin");
    putOnBattlefield(state, alice, hostData, { "+1/+1": 3 });
    putOnBattlefield(state, alice, goblinData);

    const refreshed = refreshScriptedStatics(state);
    const goblin = refreshed.cards.get(
      Array.from(refreshed.cards.keys()).find((id) => {
        const c = refreshed.cards.get(id);
        return c?.cardData.name === "Test Goblin";
      })!,
    );
    expect(goblin?.scriptStaticKeywords ?? []).toContain("menace");
  });

  it("static APPLIES when the source has 5 +1/+1 counters (well above threshold)", () => {
    const state = startGame(
      createInitialGameState(["Alice", "Bob"], 20, false),
    );
    const [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;

    const hostData = card(HOST_NAME, "Creature — Goblin Rogue");
    const goblinData = card("Test Goblin", "Creature — Goblin");
    putOnBattlefield(state, alice, hostData, { "+1/+1": 5 });
    putOnBattlefield(state, alice, goblinData);

    const refreshed = refreshScriptedStatics(state);
    const goblin = refreshed.cards.get(
      Array.from(refreshed.cards.keys()).find((id) => {
        const c = refreshed.cards.get(id);
        return c?.cardData.name === "Test Goblin";
      })!,
    );
    expect(goblin?.scriptStaticKeywords ?? []).toContain("menace");
  });

  it("static does NOT apply to opponent's Goblins (controller filter)", () => {
    const state = startGame(
      createInitialGameState(["Alice", "Bob"], 20, false),
    );
    const [alice, bob] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;

    const hostData = card(HOST_NAME, "Creature — Goblin Rogue");
    const aliceGoblin = card("Alice Goblin", "Creature — Goblin");
    const bobGoblin = card("Bob Goblin", "Creature — Goblin");
    putOnBattlefield(state, alice, hostData, { "+1/+1": 3 });
    putOnBattlefield(state, alice, aliceGoblin);
    putOnBattlefield(state, bob, bobGoblin);

    const refreshed = refreshScriptedStatics(state);
    const aliceGoblinCard = Array.from(refreshed.cards.values()).find(
      (c) => c.cardData.name === "Alice Goblin",
    );
    const bobGoblinCard = Array.from(refreshed.cards.values()).find(
      (c) => c.cardData.name === "Bob Goblin",
    );
    expect(aliceGoblinCard?.scriptStaticKeywords ?? []).toContain("menace");
    expect(bobGoblinCard?.scriptStaticKeywords ?? []).not.toContain("menace");
  });

  it("static does NOT apply to non-Goblin creatures even when gate passes", () => {
    const state = startGame(
      createInitialGameState(["Alice", "Bob"], 20, false),
    );
    const [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;

    const hostData = card(HOST_NAME, "Creature — Goblin Rogue");
    const elfData = card("Test Elf", "Creature — Elf");
    putOnBattlefield(state, alice, hostData, { "+1/+1": 5 });
    putOnBattlefield(state, alice, elfData);

    const refreshed = refreshScriptedStatics(state);
    const elf = Array.from(refreshed.cards.values()).find(
      (c) => c.cardData.name === "Test Elf",
    );
    expect(elf?.scriptStaticKeywords ?? []).not.toContain("menace");
  });

  it("static with op:eq fires only at the exact threshold", () => {
    const state = startGame(
      createInitialGameState(["Alice", "Bob"], 20, false),
    );
    const [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;

    const eqScript: CardScript = CardScriptSchema.parse({
      name: "Test Host Counter-Condition Static Eq (lane 57)",
      oracle:
        "Goblins have menace when this has EXACTLY 5 +1/+1 counters.",
      statics: [
        {
          text: "Goblins have menace when this has EXACTLY 5 +1/+1 counters.",
          affects: { controller: "you", subtype: "Goblin" },
          keywords: ["menace"],
          while_condition: {
            kind: "counter_minimum",
            counter: "+1/+1",
            op: "eq",
            n: 5,
          },
        },
      ],
    });
    registerCardScripts([HOST_SCRIPT, eqScript]);

    const hostData = card(
      "Test Host Counter-Condition Static Eq (lane 57)",
      "Creature — Goblin Rogue",
    );
    const goblinData = card("Test Goblin", "Creature — Goblin");
    putOnBattlefield(state, alice, hostData, { "+1/+1": 5 });
    putOnBattlefield(state, alice, goblinData);

    const refreshed = refreshScriptedStatics(state);
    const goblin = Array.from(refreshed.cards.values()).find(
      (c) => c.cardData.name === "Test Goblin",
    );
    expect(goblin?.scriptStaticKeywords ?? []).toContain("menace");
  });

  it("static with op:eq does NOT fire when count is above the exact threshold", () => {
    const state = startGame(
      createInitialGameState(["Alice", "Bob"], 20, false),
    );
    const [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;

    const eqScript: CardScript = CardScriptSchema.parse({
      name: "Test Host Counter-Condition Static Eq (lane 57)",
      oracle:
        "Goblins have menace when this has EXACTLY 5 +1/+1 counters.",
      statics: [
        {
          text: "Goblins have menace when this has EXACTLY 5 +1/+1 counters.",
          affects: { controller: "you", subtype: "Goblin" },
          keywords: ["menace"],
          while_condition: {
            kind: "counter_minimum",
            counter: "+1/+1",
            op: "eq",
            n: 5,
          },
        },
      ],
    });
    registerCardScripts([HOST_SCRIPT, eqScript]);

    const hostData = card(
      "Test Host Counter-Condition Static Eq (lane 57)",
      "Creature — Goblin Rogue",
    );
    const goblinData = card("Test Goblin", "Creature — Goblin");
    putOnBattlefield(state, alice, hostData, { "+1/+1": 6 });
    putOnBattlefield(state, alice, goblinData);

    const refreshed = refreshScriptedStatics(state);
    const goblin = Array.from(refreshed.cards.values()).find(
      (c) => c.cardData.name === "Test Goblin",
    );
    expect(goblin?.scriptStaticKeywords ?? []).not.toContain("menace");
  });
});