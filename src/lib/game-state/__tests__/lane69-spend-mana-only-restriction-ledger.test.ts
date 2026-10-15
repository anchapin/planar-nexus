/**
 * Wave 4.8 follow-up 21 lane 69 piece 1/N (#2614 follow-up):
 * per-mana restriction-tag ledger substrate ("spend this
 * mana only on [X]" family, e.g. Llawan / War Tax / the
 * "spend this mana only on creature spells" pattern).
 *
 * v1 ships the schema arm + the ledger helper + the routing
 * delta in `applyEffect` AddMana. The spend-side consult
 * (lane 69 piece 2/N) rides a follow-up lane —
 * `resolveXspentOn` is a STUB that returns true
 * unconditionally so nothing in v1 blocks. The test pattern
 * is the lane 49/52/55/.../117 `CardScriptSchema.parse +
 * registerCardScripts` shape.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { resolveScriptedAbility } from "../card-scripts/interpret";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  StackObject,
} from "../types";
import {
  addRestrictedMana,
  clearRestrictionLedger,
  getRestrictedMana,
  resolveXspentOn,
} from "../mana/restriction-ledger";

const HOST_RESTRICTION = "Test Restriction Land (lane 69 piece 1/N)";
const HOST_RESTRICTION_ANY = "Test Restriction Land Any (lane 69 piece 1/N)";

const SCRIPT_RESTRICTION: CardScript = CardScriptSchema.parse({
  name: HOST_RESTRICTION,
  oracle: "{T}: Add {G}. This mana can only be spent on creature spells.",
  activated: [
    {
      text: "Add {G}. This mana can only be spent on creature spells.",
      cost: { tap: true },
      effects: [
        {
          op: "AddMana",
          amount: 1,
          colors: ["G"],
          restriction: "creature_spells",
        },
      ],
    },
  ],
});

const SCRIPT_RESTRICTION_ANY: CardScript = CardScriptSchema.parse({
  name: HOST_RESTRICTION_ANY,
  oracle:
    "{T}: Add one mana of any color. Spend this mana only on instant or sorcery spells.",
  activated: [
    {
      text: "Add one mana of any color. Spend this mana only on instant or sorcery spells.",
      cost: { tap: true },
      effects: [
        {
          op: "AddMana",
          amount: 1,
          colors: "any",
          restriction: "instant_or_sorcery",
        },
      ],
    },
  ],
});

function landCard(name: string): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Land",
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

function putOnBattlefield(
  state: GameState,
  playerId: PlayerId,
  data: ScryfallCard,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId);
  state.cards.set(c.id, c);
  const key = `${playerId}-battlefield`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

describe("Lane 69 piece 1/N (follow-up 21): per-mana restriction tag ledger", () => {
  let state: GameState;
  let alice: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    resetCardScriptsForTests();
    registerCardScripts([SCRIPT_RESTRICTION, SCRIPT_RESTRICTION_ANY]);
  });

  describe("helper — addRestrictedMana / getRestrictedMana", () => {
    it("addRestrictedMana increases the ledger and leaves the main pool intact", () => {
      const before = state.players.get(alice)!.manaPool.green;
      const next = addRestrictedMana(state, alice, "creature_spells", {
        green: 2,
      });
      // Main pool untouched.
      expect(next.players.get(alice)!.manaPool.green).toBe(before);
      // Ledger incremented.
      expect(
        next.players.get(alice)!.restrictionLedger?.["creature_spells"]?.green,
      ).toBe(2);
    });

    it("getRestrictedMana returns the partial pool under a tag", () => {
      const next = addRestrictedMana(state, alice, "creature_spells", {
        green: 2,
      });
      const got = getRestrictedMana(next, alice, "creature_spells");
      // The ledger carries the same 7-key partial-pool shape as
      // `manaPool` (zero-filled for the unprovided colors —
      // parallel to the immutability pattern in addMana /
      // mana-pool.ts).
      expect(got).toEqual({
        colorless: 0,
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 2,
        generic: 0,
      });
    });

    it("getRestrictedMana returns {} for an unknown tag (no leakage)", () => {
      expect(getRestrictedMana(state, alice, "creature_spells")).toEqual({});
    });
  });

  describe("helper — resolveXspentOn stub", () => {
    it("returns true for restriction === 'any' (universal passthrough)", () => {
      expect(resolveXspentOn({ green: 1 }, "any")).toBe(true);
    });

    it("returns true unconditionally in v1 (stub consult; non-blocking)", () => {
      expect(resolveXspentOn({ green: 1 }, "creature_spells")).toBe(true);
      expect(resolveXspentOn({ green: 1 }, "instant_or_sorcery")).toBe(true);
    });
  });

  describe("synthetic card registration", () => {
    it("parses and looks up Restriction Land by name", () => {
      const script = CardScriptSchema.parse({
        name: "Test Schema Restriction (lane 69 piece 1/N)",
        oracle: "{T}: Add {G}. This mana can only be spent on creature spells.",
        activated: [
          {
            text: "Add {G}. This mana can only be spent on creature spells.",
            cost: { tap: true },
            effects: [
              {
                op: "AddMana",
                amount: 1,
                colors: ["G"],
                restriction: "creature_spells",
              },
            ],
          },
        ],
      });
      expect(
        (script.activated![0].effects![0] as { restriction?: string })
          .restriction,
      ).toBe("creature_spells");
    });

    it("rejects an empty-string restriction (v1 min length 1)", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Schema Restriction Empty (lane 69 piece 1/N)",
          oracle: "{T}: Add {G}.",
          activated: [
            {
              text: "Add {G}.",
              cost: { tap: true },
              effects: [
                {
                  op: "AddMana",
                  amount: 1,
                  colors: ["G"],
                  restriction: "",
                },
              ],
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("routing — applyEffect routes AddMana through the ledger", () => {
    it("resolveScriptedAbility on a restriction-tagged AddMana lands mana in restrictionLedger, NOT main pool", () => {
      const sourceId = putOnBattlefield(
        state,
        alice,
        landCard(HOST_RESTRICTION),
      );
      // Build a stack object whose text matches the activated
      // ability's `text` field (the sameText matcher in
      // interpret.ts compares case-insensitive trim equality).
      const abilityText =
        "Add {G}. This mana can only be spent on creature spells.";
      const stackObject: StackObject = {
        id: "stack-restriction-land-1" as StackObject["id"],
        type: "ability",
        sourceCardId: sourceId as CardInstance["id"],
        controllerId: alice,
        name: HOST_RESTRICTION,
        text: abilityText,
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map<string, number>(),
        isCountered: false,
        timestamp: Date.now(),
        activated: true,
      };
      const resolved = resolveScriptedAbility(state, stackObject);
      expect(resolved).toBeDefined();
      const player = resolved!.players.get(alice)!;
      // Main pool: green unchanged at 0.
      expect(player.manaPool.green).toBe(0);
      // Ledger: green incremented to 1.
      expect(player.restrictionLedger?.["creature_spells"]?.green).toBe(1);
    });

    it("without restriction, the existing AddMana path is unchanged (main pool incremented)", () => {
      state = addMana(state, alice, { green: 0 });
      const noRestrictionScript: CardScript = CardScriptSchema.parse({
        name: "Test No Restriction (lane 69 piece 1/N)",
        oracle: "{T}: Add {G}.",
        activated: [
          {
            text: "Add {G}.",
            cost: { tap: true },
            effects: [{ op: "AddMana", amount: 1, colors: ["G"] }],
          },
        ],
      });
      registerCardScripts([noRestrictionScript]);
      const sourceId = putOnBattlefield(
        state,
        alice,
        landCard("Test No Restriction (lane 69 piece 1/N)"),
      );
      const stackObject: StackObject = {
        id: "stack-no-restriction-1" as StackObject["id"],
        type: "ability",
        sourceCardId: sourceId as CardInstance["id"],
        controllerId: alice,
        name: "Test No Restriction (lane 69 piece 1/N)",
        text: "Add {G}.",
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map<string, number>(),
        isCountered: false,
        timestamp: Date.now(),
        activated: true,
      };
      const resolved = resolveScriptedAbility(state, stackObject)!;
      expect(resolved.players.get(alice)!.manaPool.green).toBe(1);
      expect(resolved.players.get(alice)!.restrictionLedger).toBeUndefined();
    });
  });

  describe("end-of-turn cleanup — clearRestrictionLedger", () => {
    it("clears all restriction tags but leaves the main pool intact", () => {
      const next = addRestrictedMana(state, alice, "creature_spells", {
        green: 2,
      });
      // Sanity-check: ledger has the green.
      expect(
        next.players.get(alice)!.restrictionLedger?.["creature_spells"]?.green,
      ).toBe(2);
      // Pre-add some main-pool mana so we can confirm the main pool survives.
      const withMain = addMana(next, alice, { green: 1 });
      expect(withMain.players.get(alice)!.manaPool.green).toBe(1);
      const cleared = clearRestrictionLedger(withMain, alice);
      expect(cleared.players.get(alice)!.restrictionLedger).toEqual({});
      // Main pool still intact after the cleanup.
      expect(cleared.players.get(alice)!.manaPool.green).toBe(1);
    });
  });
});
