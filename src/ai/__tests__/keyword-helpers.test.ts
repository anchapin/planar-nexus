/**
 * @fileoverview Regression tests for the AI-layer keyword helpers (issue #2355).
 *
 * `AIPermanent.keywords` flows straight through from Scryfall's
 * `cardData.keywords`, which is title-case ("Indestructible"). The AI
 * decision layer used to check those arrays with case-sensitive
 * `keywords?.includes("indestructible")`, which is false for every real
 * indestructible card — the AI was blind to indestructible. These tests pin
 * the case-insensitive helpers against Scryfall casing.
 */

import { describe, it, expect } from "@jest/globals";
import {
  hasIndestructible,
  hasDeathtouch,
  hasTrample,
  hasFlying,
  hasFirstStrike,
  hasDoubleStrike,
  hasMenace,
  hasHaste,
} from "../utils/keyword-helpers";
import { CombatDecisionTree } from "../decision-making/combat-decision-tree";
import type { AIGameState, AIPermanent } from "@/lib/game-state";

function mockPermanent(keywords?: string[]): AIPermanent {
  return {
    id: "p1",
    cardInstanceId: "p1",
    name: "Test Creature",
    type: "creature",
    controller: "player1",
    tapped: false,
    power: 3,
    toughness: 3,
    keywords,
  };
}

function mockGameState(battlefield: AIPermanent[]): AIGameState {
  const player = (id: string, bf: AIPermanent[]) => ({
    id,
    name: `Player ${id}`,
    life: 20,
    poisonCounters: 0,
    hand: [],
    battlefield: bf,
    graveyard: [],
    exile: [],
    library: 30,
    manaPool: {},
    landsPlayedThisTurn: 0,
  });
  return {
    players: {
      player1: player("player1", battlefield),
      player2: player("player2", []),
    },
    turnInfo: {
      currentTurn: 1,
      currentPlayer: "player1",
      priority: "player1",
      phase: "precombat_main",
      step: "main",
    },
    stack: [],
    combat: { inCombatPhase: false, attackers: [], blockers: {} },
  } as unknown as AIGameState;
}

describe("AI keyword helpers (issue #2355)", () => {
  describe("Scryfall title-case fixtures are detected", () => {
    it.each([
      [hasIndestructible, "Indestructible"],
      [hasDeathtouch, "Deathtouch"],
      [hasTrample, "Trample"],
      [hasFlying, "Flying"],
      [hasFirstStrike, "First strike"],
      [hasDoubleStrike, "Double strike"],
      [hasMenace, "Menace"],
      [hasHaste, "Haste"],
    ])("%s detects %s", (fn, keyword) => {
      expect(fn(mockPermanent([keyword as string]))).toBe(true);
    });
  });

  describe("legacy lowercase fixtures still work", () => {
    it.each([
      [hasIndestructible, "indestructible"],
      [hasDeathtouch, "deathtouch"],
      [hasTrample, "trample"],
      [hasFlying, "flying"],
      [hasFirstStrike, "first strike"],
      [hasDoubleStrike, "double strike"],
      [hasMenace, "menace"],
      [hasHaste, "haste"],
    ])("%s detects %s", (fn, keyword) => {
      expect(fn(mockPermanent([keyword as string]))).toBe(true);
    });
  });

  describe("negative cases", () => {
    it("returns false when keywords is undefined", () => {
      expect(hasIndestructible(mockPermanent(undefined))).toBe(false);
    });

    it("returns false for an empty keyword list", () => {
      expect(hasIndestructible(mockPermanent([]))).toBe(false);
    });

    it("returns false for unrelated keywords", () => {
      expect(hasIndestructible(mockPermanent(["Flying", "Vigilance"]))).toBe(
        false,
      );
    });

    it("trims whitespace around keywords", () => {
      expect(hasIndestructible(mockPermanent([" Indestructible "]))).toBe(true);
    });

    it("does not match a longer token with no word boundary", () => {
      // "Indestructibleness" has no word boundary after "indestructible",
      // so the anchored helper must not match it.
      expect(hasIndestructible(mockPermanent(["Indestructibleness"]))).toBe(
        false,
      );
    });
  });

  describe("regression: the pre-#2355 expression was a live false negative", () => {
    it("the old case-sensitive check missed Scryfall casing", () => {
      const scryfallKeywords = ["Indestructible"];
      // This is exactly what the production code used to do:
      expect(scryfallKeywords?.includes("indestructible")).toBe(false);
      // ...and this is what it does now:
      expect(hasIndestructible(mockPermanent(scryfallKeywords))).toBe(true);
    });

    it("shouldMultiBlock refuses a Scryfall-cased indestructible attacker", () => {
      // Fails on the pre-fix code (attacker treated as killable, may
      // multi-block); passes with the case-insensitive helper. Two
      // blockers are provided so the indestructible-specific branch —
      // not the insufficient-blockers early return — decides the verdict.
      const blockers = [mockPermanent([]), mockPermanent([])];
      const state = mockGameState(blockers);
      const ai = new CombatDecisionTree(state, "player1", "expert");
      const attacker = mockPermanent(["Indestructible"]);

      const verdict = ai.shouldMultiBlock(attacker, blockers, {
        attackers: [attacker],
        blockers,
      });

      expect(verdict.shouldMultiBlock).toBe(false);
      expect(verdict.reasoning).toMatch(/indestructible/i);
    });
  });
});
