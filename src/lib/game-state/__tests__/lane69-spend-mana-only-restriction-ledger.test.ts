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
import { addMana, spendMana } from "../mana";
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
  clearRestrictionTag,
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

  describe("helper — resolveXspentOn consult (piece 2/N)", () => {
    it("universal passthrough: restriction === 'any' short-circuits to true (no ledger lookup)", () => {
      // 'any' bypasses the ledger check entirely so callers
      // that don't yet know about the consult can still
      // resolve. No state mutation; no ledger required.
      expect(
        resolveXspentOn(state, alice, "any", { green: 1 }),
      ).toBe(true);
    });

    it("returns false for an unknown / mismatched restriction tag", () => {
      const seeded = addRestrictedMana(state, alice, "creature_spells", {
        green: 2,
      });
      // Asking for a different tag returns false even
      // though the ledger has mana under another key.
      expect(
        resolveXspentOn(seeded, alice, "instant_or_sorcery", { green: 1 }),
      ).toBe(false);
      // Asking for a tag that doesn't exist at all is also
      // false — never throws.
      expect(
        resolveXspentOn(state, alice, "nonexistent_tag", { green: 1 }),
      ).toBe(false);
    });

    it("returns true when the ledger entry has >= the queried mana total", () => {
      const seeded = addRestrictedMana(state, alice, "creature_spells", {
        green: 2,
      });
      // Exact match: {G:2} >= {G:2}.
      expect(
        resolveXspentOn(seeded, alice, "creature_spells", { green: 2 }),
      ).toBe(true);
      // Subset: 1 G fits in 2 G of tagged mana.
      expect(
        resolveXspentOn(seeded, alice, "creature_spells", { green: 1 }),
      ).toBe(true);
    });

    it("returns false when the ledger entry is insufficient to cover the queried mana", () => {
      const seeded = addRestrictedMana(state, alice, "creature_spells", {
        green: 1,
      });
      // Asking for 2 G against a 1 G ledger is false (the
      // spend-side caller will fall through to the main pool
      // or fail the cost, depending on future piece 3/N+).
      expect(
        resolveXspentOn(seeded, alice, "creature_spells", { green: 2 }),
      ).toBe(false);
      // Mixed colors: ledger {G:1}, spend {G:1, W:1} = 2 vs
      // 1 → false.
      expect(
        resolveXspentOn(seeded, alice, "creature_spells", {
          green: 1,
          white: 1,
        }),
      ).toBe(false);
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

    it("rejects restriction values outside the v1 enum (typos like 'creature_spell')", () => {
      // piece 2/N tightened the field from a free-form
      // z.string() to a constrained enum of well-known tags;
      // a typo in a card script must NOT silently widen the
      // ledger at runtime (#2614 follow-up).
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Schema Restriction Typo (lane 69 piece 2/N)",
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
                  restriction: "creature_spell",
                },
              ],
            },
          ],
        }),
      ).toThrow();
      // The empty-string path is also rejected (the enum has
      // no empty-string member).
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Schema Restriction Empty (lane 69 piece 2/N)",
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

  describe("piece 2/N — single-tag cleanup (clearRestrictionTag)", () => {
    it("clears one restriction tag without touching sibling tags or the main pool", () => {
      const seeded = addRestrictedMana(state, alice, "creature_spells", {
        green: 2,
      });
      const seeded2 = addRestrictedMana(seeded, alice, "instant_or_sorcery", {
        blue: 1,
      });
      // Sanity-check: both tags have mana.
      expect(
        seeded2.players.get(alice)!.restrictionLedger?.["creature_spells"]
          ?.green,
      ).toBe(2);
      expect(
        seeded2.players.get(alice)!.restrictionLedger?.["instant_or_sorcery"]
          ?.blue,
      ).toBe(1);
      // Add some main-pool mana so we can confirm it survives.
      const withMain = addMana(seeded2, alice, { black: 3 });
      const clearedOne = clearRestrictionTag(
        withMain,
        alice,
        "creature_spells",
      );
      // The "creature_spells" tag is gone; "instant_or_sorcery" survives.
      expect(
        clearedOne.players.get(alice)!.restrictionLedger?.["creature_spells"],
      ).toBeUndefined();
      expect(
        clearedOne.players.get(alice)!.restrictionLedger?.["instant_or_sorcery"]
          ?.blue,
      ).toBe(1);
      // Main pool intact.
      expect(clearedOne.players.get(alice)!.manaPool.black).toBe(3);
    });

    it("is a no-op for an unknown tag (does not allocate a new ledger)", () => {
      // Player has no ledger at all yet — clearing a tag
      // should NOT introduce an empty {} onto the player;
      // the immutability convention is "no field if no data".
      const out = clearRestrictionTag(state, alice, "creature_spells");
      expect(out.players.get(alice)!.restrictionLedger).toBeUndefined();
    });
  });

  describe("piece 2/N — round-trip: AddMana → ledger → resolveXspentOn (positive match)", () => {
    it("resolveScriptedAbility stamps the ledger, then resolveXspentOn matches positively against the SAME tag", () => {
      const sourceId = putOnBattlefield(
        state,
        alice,
        landCard(HOST_RESTRICTION),
      );
      const stackObject: StackObject = {
        id: "stack-restriction-land-rt1" as StackObject["id"],
        type: "ability",
        sourceCardId: sourceId as CardInstance["id"],
        controllerId: alice,
        name: HOST_RESTRICTION,
        text: "Add {G}. This mana can only be spent on creature spells.",
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map<string, number>(),
        isCountered: false,
        timestamp: Date.now(),
        activated: true,
      };
      const afterTap = resolveScriptedAbility(state, stackObject)!;
      // Step 1: the ledger now carries 1 G under "creature_spells".
      expect(
        afterTap.players.get(alice)!.restrictionLedger?.["creature_spells"]
          ?.green,
      ).toBe(1);
      // Step 2: resolveXspentOn against the matching tag and
      // a 1 G spend returns true (the consult closes the
      // round-trip: production → ledger → consult → match).
      expect(
        resolveXspentOn(afterTap, alice, "creature_spells", { green: 1 }),
      ).toBe(true);
      // Step 3: the consult against a MISMATCHED tag returns
      // false (different keys do not cross-match).
      expect(
        resolveXspentOn(afterTap, alice, "instant_or_sorcery", { green: 1 }),
      ).toBe(false);
    });
  });

  describe("piece 3/N (follow-up 22) — spendMana enforcement consult", () => {
    it("spendMana WITHOUT a restriction arg is the un-restricted baseline (regression guard)", () => {
      // No restriction in the ledger, no restriction passed to
      // spendMana — the call must succeed and debit the main
      // pool. This guards against piece 3/N inadvertently
      // narrowing the un-restricted call shape that every
      // existing caller (cast.ts, ward-system.ts, etc.) uses.
      const withMain = addMana(state, alice, { green: 2 });
      const result = spendMana(withMain, alice, { green: 1 });
      expect(result.success).toBe(true);
      expect(result.state.players.get(alice)!.manaPool.green).toBe(1);
    });

    it("spendMana WITH a matching restriction tag succeeds AND clears the ledger entry", () => {
      // Seed both the ledger and the main pool. The main pool
      // holds enough mana to satisfy the spend; the ledger
      // also holds enough tagged mana. The consult passes, the
      // main-pool spend debits green, and the ledger tag is
      // cleared (the tag won't double-fund a second spend).
      const seeded = addRestrictedMana(state, alice, "creature_spells", {
        green: 1,
      });
      const withMain = addMana(seeded, alice, { green: 2 });
      const result = spendMana(withMain, alice, { green: 1 }, {
        restriction: "creature_spells",
      });
      expect(result.success).toBe(true);
      // Main pool debited by 1.
      expect(result.state.players.get(alice)!.manaPool.green).toBe(1);
      // Ledger tag cleared (the tagged mana was spent).
      expect(
        result.state.players.get(alice)!.restrictionLedger?.["creature_spells"],
      ).toBeUndefined();
    });

    it("spendMana WITH a restriction tag BLOCKS the spend when the ledger has insufficient tagged mana", () => {
      // Ledger has only {G: 1}; the spend asks for {G: 2}. The
      // consult returns false (insufficient total) and the
      // spend is blocked — main pool untouched, ledger
      // untouched. This is the "War Tax denies the cast"
      // surface.
      const seeded = addRestrictedMana(state, alice, "creature_spells", {
        green: 1,
      });
      const withMain = addMana(seeded, alice, { green: 3 });
      const result = spendMana(withMain, alice, { green: 2 }, {
        restriction: "creature_spells",
      });
      expect(result.success).toBe(false);
      // Main pool untouched (defensive: the spend didn't even
      // start its main-pool arithmetic).
      expect(result.state.players.get(alice)!.manaPool.green).toBe(3);
      // Ledger untouched.
      expect(
        result.state.players.get(alice)!.restrictionLedger?.["creature_spells"]
          ?.green,
      ).toBe(1);
    });

    it("spendMana WITH a MISMATCHED restriction tag BLOCKS the spend even when main pool has enough mana", () => {
      // The player's ledger carries mana under
      // "instant_or_sorcery" but the caller asks for
      // "creature_spells". The consult returns false (different
      // tag) and the spend is blocked — main pool untouched,
      // ledger untouched. This is the cross-tag isolation
      // guarantee: a "creature_spells" spend cannot steal
      // "instant_or_sorcery" tagged mana.
      const seeded = addRestrictedMana(state, alice, "instant_or_sorcery", {
        blue: 5,
      });
      const withMain = addMana(seeded, alice, { green: 5 });
      const result = spendMana(withMain, alice, { green: 1 }, {
        restriction: "creature_spells",
      });
      expect(result.success).toBe(false);
      expect(result.state.players.get(alice)!.manaPool.green).toBe(5);
      expect(
        result.state.players.get(alice)!.restrictionLedger?.["instant_or_sorcery"]
          ?.blue,
      ).toBe(5);
    });
  });
});
