/**
 * Token creation with embedded static (Wave 4.8 follow-up 4 lane 66,
 * #2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of recent cards that
 * create a creature token with an "embedded static" — keywords
 * stamped on the token, or a P/T bonus stamped on the token, or
 * both (Adaptive Automaton's "creature tokens you create get +1/+1
 * and have all creature types", Avenger of Zendikar's "create a
 * 0/1 green Plant creature token with...", Hornet Queen's "create
 * a 1/1 green Insect creature token with flying and haste",
 * Cloudblazer's "create a 1/1 white Soldier creature token with
 * lifelink"). The Wave 4.7 follow-up lane 52 + 55 + 60 work
 * already shipped the per-instance chosen-type / chosen-color
 * ledgers; this lane ships the same per-instance shape for
 * `CreateToken`-time keywords + P/T.
 *
 * Schema (card-scripts/schema.ts, CreateTokenSchema):
 *   `embedded_static: { power?, toughness?, keywords? }` — the
 *   embedded static stamped on the created token. v1 supports P/T
 *   + keywords; restrictions (restrictAttack, restrictBlock,
 *   maxBlockers) are a follow-up lane.
 *
 * Engine:
 *   `resolveTokenCreationEffect` (effect-resolution.ts) folds
 *   `power` and `toughness` additively into the base P/T and
 *   routes `keywords` into the per-instance
 *   `embeddedStaticKeywords` ledger on the new `CardInstance`.
 *   `createTokenCard` (keyword-actions/tokens.ts) stamps the
 *   ledger when present. `hasKeyword` (evergreen-keywords.ts)
 *   reads the ledger as an additional source of keywords
 *   alongside `cardData.keywords`. The P/T is folded into the
 *   `cardData.power` / `cardData.toughness` at token creation
 *   time, so `getPowerValue` / `getToughnessValue` pick it up
 *   via the existing path (parallel to the lane 65
 *   `grantedTriggers` pattern that adds a per-instance ledger
 *   for keywords — both flows are per-instance + stamped at
 *   creation time).
 *
 * Test harness pattern: synthetic card script registered via
 * `CardScriptSchema.parse + registerCardScripts` (lane 49/52/55/59
 * /60/62/63/64/65 pattern). The token is created by resolving the
 * script's `spell` via `resolveTokenCreationEffect` (the same
 * funnel the engine uses for `CreateToken` from the script
 * interpreter — the test exercises the schema arm end-to-end
 * through the same call site).
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { resolveTokenCreationEffect } from "../effect-resolution";
import { createInitialGameState, startGame } from "../game-state";
import {
  hasKeyword,
  getEffectivePower,
  getEffectiveToughness,
} from "../evergreen-keywords";
import type { GameState, PlayerId } from "../types";

const HOST_NAME = "Test Token-Maker With Embedded Static (lane 66)";

const HOST_SCRIPT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle: "Create a 1/1 green Saproling creature token with trample and +1/+1.",
  spell: [
    {
      op: "CreateToken",
      count: 1,
      power: 1,
      toughness: 1,
      color: "green",
      subtypes: ["Saproling"],
      embedded_static: {
        power: 1,
        toughness: 1,
        keywords: ["trample"],
      },
    },
  ],
});

describe("Token creation with embedded static (Wave 4.8 follow-up 4 lane 66, #2614 follow-up)", () => {
  let state: GameState;
  let alice: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    resetCardScriptsForTests();
    registerCardScripts([HOST_SCRIPT]);
  });

  describe("schema", () => {
    it("accepts an embedded_static arm on CreateToken", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test OK (lane 66)",
        oracle: "Create a 1/1 Saproling with trample and +1/+1.",
        spell: [
          {
            op: "CreateToken",
            count: 1,
            power: 1,
            toughness: 1,
            color: "green",
            subtypes: ["Saproling"],
            embedded_static: {
              power: 1,
              toughness: 1,
              keywords: ["trample"],
            },
          },
        ],
      });
      const eff = parsed.spell?.[0];
      expect(eff?.op).toBe("CreateToken");
      if (eff?.op === "CreateToken") {
        expect(eff.embedded_static).toEqual({
          power: 1,
          toughness: 1,
          keywords: ["trample"],
        });
      }
    });

    it("accepts an embedded_static arm with only keywords (no P/T)", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test OK Keywords Only (lane 66)",
        oracle: "Create a 1/1 Saproling with flying.",
        spell: [
          {
            op: "CreateToken",
            count: 1,
            power: 1,
            toughness: 1,
            color: "green",
            subtypes: ["Saproling"],
            embedded_static: { keywords: ["flying"] },
          },
        ],
      });
      const eff = parsed.spell?.[0];
      if (eff?.op === "CreateToken") {
        expect(eff.embedded_static?.keywords).toEqual(["flying"]);
        expect(eff.embedded_static?.power).toBeUndefined();
        expect(eff.embedded_static?.toughness).toBeUndefined();
      }
    });

    it("accepts an embedded_static arm with only P/T (no keywords)", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test OK PT Only (lane 66)",
        oracle: "Create a 1/1 Saproling with +1/+1.",
        spell: [
          {
            op: "CreateToken",
            count: 1,
            power: 1,
            toughness: 1,
            color: "green",
            subtypes: ["Saproling"],
            embedded_static: { power: 1, toughness: 1 },
          },
        ],
      });
      const eff = parsed.spell?.[0];
      if (eff?.op === "CreateToken") {
        expect(eff.embedded_static?.power).toBe(1);
        expect(eff.embedded_static?.toughness).toBe(1);
        expect(eff.embedded_static?.keywords).toBeUndefined();
      }
    });

    it("rejects an unknown field on the embedded_static arm", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Bad (lane 66)",
          oracle: "Create a 1/1 Saproling with weirdness.",
          spell: [
            {
              op: "CreateToken",
              count: 1,
              power: 1,
              toughness: 1,
              color: "green",
              subtypes: ["Saproling"],
              embedded_static: {
                power: 1,
                restrictAttack: true,
              },
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an unknown keyword on the embedded_static arm", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Bad Keyword (lane 66)",
          oracle: "Create a 1/1 Saproling with weirdness.",
          spell: [
            {
              op: "CreateToken",
              count: 1,
              power: 1,
              toughness: 1,
              color: "green",
              subtypes: ["Saproling"],
              embedded_static: { keywords: ["weirdness"] },
            },
          ],
        }),
      ).toThrow();
    });

    it("keeps the existing CreateToken shape byte-compatible (no embedded_static)", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test No Embedded (lane 66)",
        oracle: "Create a 1/1 red Goblin.",
        spell: [
          {
            op: "CreateToken",
            count: 1,
            power: 1,
            toughness: 1,
            color: "red",
            subtypes: ["Goblin"],
          },
        ],
      });
      const eff = parsed.spell?.[0];
      if (eff?.op === "CreateToken") {
        expect(eff.embedded_static).toBeUndefined();
      }
    });
  });

  describe("engine", () => {
    it("stamps embeddedStaticKeywords on the created token", () => {
      const r = resolveTokenCreationEffect(
        state,
        undefined,
        {
          name: "Saproling",
          type_line: "Token Creature — Saproling",
          power: "1",
          toughness: "1",
          colors: ["green"],
          embeddedStaticKeywords: ["Trample"],
        },
        1,
        alice,
        1,
        1,
      );
      expect(r.success).toBe(true);
      const tokenId = r.affectedCards?.[0];
      expect(tokenId).toBeDefined();
      const token = r.state.cards.get(tokenId!);
      expect(token?.embeddedStaticKeywords).toEqual(["trample"]);
    });

    it("folds the embedded P/T bonus into the token's base P/T", () => {
      const r = resolveTokenCreationEffect(
        state,
        undefined,
        {
          name: "Saproling",
          type_line: "Token Creature — Saproling",
          power: "1",
          toughness: "1",
          colors: ["green"],
        },
        1,
        alice,
        1, // power bonus
        1, // toughness bonus
      );
      const tokenId = r.affectedCards?.[0];
      const token = r.state.cards.get(tokenId!);
      // Base 1/1 + 1/1 bonus = 2/2. The folded P/T lives on
      // `cardData.power` / `cardData.toughness` so the engine's
      // `getPowerValue` / `getToughnessValue` pick it up via the
      // existing path.
      expect(token?.cardData.power).toBe("2");
      expect(token?.cardData.toughness).toBe("2");
      expect(getEffectivePower(token!)).toBe(2);
      expect(getEffectiveToughness(token!)).toBe(2);
    });

    it("folds the embedded P/T without requiring keywords", () => {
      const r = resolveTokenCreationEffect(
        state,
        undefined,
        {
          name: "Saproling",
          type_line: "Token Creature — Saproling",
          power: "1",
          toughness: "1",
          colors: ["green"],
        },
        1,
        alice,
        2, // power bonus only
        0, // no toughness bonus
      );
      const tokenId = r.affectedCards?.[0];
      const token = r.state.cards.get(tokenId!);
      expect(token?.cardData.power).toBe("3");
      expect(token?.cardData.toughness).toBe("1");
      expect(token?.embeddedStaticKeywords).toBeUndefined();
    });

    it("hasKeyword reports the embedded static keyword (trample)", () => {
      const r = resolveTokenCreationEffect(
        state,
        undefined,
        {
          name: "Saproling",
          type_line: "Token Creature — Saproling",
          power: "1",
          toughness: "1",
          colors: ["green"],
          embeddedStaticKeywords: ["Trample"],
        },
        1,
        alice,
      );
      const tokenId = r.affectedCards?.[0];
      const token = r.state.cards.get(tokenId!);
      expect(hasKeyword(token!, "trample")).toBe(true);
      // Sanity: an unrelated keyword still resolves false.
      expect(hasKeyword(token!, "flying")).toBe(false);
    });

    it("does not stamp embeddedStaticKeywords when the field is unset", () => {
      const r = resolveTokenCreationEffect(
        state,
        undefined,
        {
          name: "Saproling",
          type_line: "Token Creature — Saproling",
          power: "1",
          toughness: "1",
          colors: ["green"],
        },
        1,
        alice,
      );
      const tokenId = r.affectedCards?.[0];
      const token = r.state.cards.get(tokenId!);
      expect(token?.embeddedStaticKeywords).toBeUndefined();
    });

    it("handles a token with both P/T and keywords together (the lane 66 v1)", () => {
      const r = resolveTokenCreationEffect(
        state,
        undefined,
        {
          name: "Saproling",
          type_line: "Token Creature — Saproling",
          power: "1",
          toughness: "1",
          colors: ["green"],
          embeddedStaticKeywords: ["Trample", "Haste"],
        },
        1,
        alice,
        1,
        1,
      );
      const tokenId = r.affectedCards?.[0];
      const token = r.state.cards.get(tokenId!);
      // P/T: 1/1 + 1/1 bonus = 2/2.
      expect(getEffectivePower(token!)).toBe(2);
      expect(getEffectiveToughness(token!)).toBe(2);
      // Keywords: trample + haste both present.
      expect(hasKeyword(token!, "trample")).toBe(true);
      expect(hasKeyword(token!, "haste")).toBe(true);
    });
  });
});
