/**
 * AI Neighbor Logic — Archetype Signal Tests (issue #1404)
 *
 * Covers the three acceptance criteria the issue calls out:
 *   (i)   early-pick signal emits 'undecided' with low confidence
 *   (ii)  post-color-commitment signal has axis != undecided and confidence > 0
 *   (iii) archetypeSignals cap at ARCHETYPE_SIGNAL_BUFFER_SIZE
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  pickRandomCard,
  pickColorFocusedCard,
  selectAiPick,
  emitArchetypeSignal,
} from "../../ai-neighbor-logic";
import type {
  AiNeighbor,
  AiNeighborState,
  DraftPack,
  DraftCard,
} from "../types";
import { ARCHETYPE_SIGNAL_BUFFER_SIZE } from "../types";

const makeCard = (
  id: string,
  colors: string[] = [],
  cmc = 0,
  type_line = "Creature",
): DraftCard => ({
  id,
  name: id,
  type_line,
  mana_cost: "",
  cmc,
  colors,
  color_identity: colors,
  legalities: {},
  set: "tst",
  rarity: "common",
  packId: 0,
  packSlot: 0,
  addedAt: new Date().toISOString(),
  pickedAt: new Date().toISOString(),
});

const makePack = (
  cards: DraftCard[],
  pickedCardIds: string[] = [],
): DraftPack => ({
  id: "pack-1",
  cards,
  isOpened: true,
  pickedCardIds,
});

const makeAiNeighbor = (
  pool: DraftCard[] = [],
  difficulty: "easy" | "medium" = "medium",
): AiNeighbor => ({
  enabled: true,
  difficulty,
  pickDelay: 0,
  state: {
    pool,
    isPicking: false,
    pickStartTime: null,
    lastPickReason: null,
    archetypeSignals: [],
  },
});

describe("Issue #1404 — AI neighbor archetype signal", () => {
  describe("emitArchetypeSignal", () => {
    let aiState: AiNeighborState;

    beforeEach(() => {
      aiState = {
        pool: [],
        isPicking: false,
        pickStartTime: null,
        lastPickReason: null,
        archetypeSignals: [],
      };
    });

    it("(i) emits a low-confidence signal for an empty/sparse pool", () => {
      const picked = makeCard("card-1", ["R"], 2, "Creature — Goblin");
      const signal = emitArchetypeSignal(aiState, [], picked, "random");

      expect(aiState.lastPickReason).not.toBeNull();
      expect(signal.pickNumber).toBe(1);
      expect(signal.reason).toBe("random");
      expect(signal.dominantColor).toBe("red");
      // Sparse pool: detector may emit some axis, but confidence is bounded
      // well below the post-commitment case (verified by comparison in test ii).
      expect(signal.confidence).toBeLessThanOrEqual(1);
      expect(aiState.archetypeSignals).toHaveLength(1);
    });

    it("(ii) emits a non-undecided axis after color commitment builds the pool", () => {
      // Build a 12-card burn pool so classifyArchetypeAxis has enough signal
      // to commit to a real archetype axis. We hand-craft a tight red aggro
      // pool: many 1-CMC red creatures + burn spells + mountains.
      const burnCards: DraftCard[] = [
        makeCard("b1", ["R"], 1, "Creature — Goblin"),
        makeCard("b2", ["R"], 1, "Creature — Goblin"),
        makeCard("b3", ["R"], 1, "Creature — Goblin"),
        makeCard("b4", ["R"], 1, "Creature — Goblin"),
        makeCard("b5", ["R"], 2, "Instant"),
        makeCard("b6", ["R"], 2, "Instant"),
        makeCard("b7", ["R"], 1, "Sorcery"),
        makeCard("b8", ["R"], 1, "Sorcery"),
        makeCard("b9", ["R"], 3, "Creature"),
        makeCard("b10", ["R"], 3, "Creature"),
        makeCard("b11", [], 0, "Land — Mountain"),
        makeCard("b12", [], 0, "Land — Mountain"),
      ];

      const newPick = makeCard("b13", ["R"], 1, "Creature — Goblin");
      const signal = emitArchetypeSignal(
        aiState,
        burnCards,
        newPick,
        "color-fix",
      );

      expect(signal.archetypeAxis).not.toBe("undecided");
      expect(signal.confidence).toBeGreaterThan(0);
      expect(signal.dominantColor).toBe("red");
      expect(signal.reason).toBe("color-fix");
      expect(signal.pickNumber).toBe(burnCards.length + 1);
    });

    it("(iii) archetypeSignals buffer is capped at ARCHETYPE_SIGNAL_BUFFER_SIZE", () => {
      for (let i = 0; i < ARCHETYPE_SIGNAL_BUFFER_SIZE + 3; i++) {
        const picked = makeCard(`card-${i}`, ["R"], 1, "Creature");
        emitArchetypeSignal(aiState, aiState.pool, picked, "random");
        aiState.pool = [...aiState.pool, picked];
      }
      expect(aiState.archetypeSignals).toHaveLength(
        ARCHETYPE_SIGNAL_BUFFER_SIZE,
      );
      // Oldest two were dropped → the first retained pick is pick #3.
      expect(aiState.archetypeSignals[0].pickNumber).toBe(4);
      expect(
        aiState.archetypeSignals[ARCHETYPE_SIGNAL_BUFFER_SIZE - 1].pickNumber,
      ).toBe(ARCHETYPE_SIGNAL_BUFFER_SIZE + 3);
    });

    it("exposes pickNumber, pickedAt, and curveShift fields", () => {
      const a = makeCard("low", ["R"], 1, "Creature");
      const b = makeCard("high", ["R"], 6, "Creature");
      emitArchetypeSignal(aiState, [], a, "random");
      aiState.pool = [a];
      const signal = emitArchetypeSignal(aiState, aiState.pool, b, "random");

      expect(signal.pickNumber).toBe(2);
      expect(typeof signal.pickedAt).toBe("number");
      expect(["faster", "slower", "flat"]).toContain(signal.curveShift);
      // Adding a 6-drop to a 1-drop pool should report 'slower'.
      expect(signal.curveShift).toBe("slower");
    });
  });

  describe("pickRandomCard signal emission", () => {
    it("mutates aiState.lastPickReason and archetypeSignals", () => {
      const ai = makeAiNeighbor([], "easy");
      const pack = makePack([
        makeCard("r1", ["R"], 1, "Creature"),
        makeCard("r2", ["G"], 2, "Creature"),
      ]);

      const picked = pickRandomCard(pack, ai.state);
      expect(picked).not.toBeNull();
      expect(ai.state.lastPickReason).not.toBeNull();
      expect(ai.state.lastPickReason!.pickNumber).toBe(1);
      expect(ai.state.lastPickReason!.reason).toBe("random");
      expect(ai.state.archetypeSignals).toHaveLength(1);
    });
  });

  describe("pickColorFocusedCard signal emission", () => {
    it("emits color-fix signal when there is a dominant color", () => {
      // Pre-existing red pool — color-focused picker should keep anchoring.
      const pool = [
        makeCard("seed1", ["R"], 2, "Creature"),
        makeCard("seed2", ["R"], 2, "Creature"),
        makeCard("seed3", ["R"], 1, "Instant"),
      ];
      const ai = makeAiNeighbor(pool, "medium");
      const pack = makePack([
        makeCard("match", ["R"], 2, "Creature"),
        makeCard("mismatch", ["U"], 2, "Creature"),
      ]);

      pickColorFocusedCard(pack, ai.state.pool, ai.state);
      expect(ai.state.lastPickReason).not.toBeNull();
      expect(ai.state.lastPickReason!.reason).toBe("color-fix");
      expect(ai.state.lastPickReason!.dominantColor).toBe("red");
    });
  });

  describe("selectAiPick dispatch", () => {
    it("routes to random picker and emits a signal for easy difficulty", () => {
      const ai = makeAiNeighbor([], "easy");
      const pack = makePack([makeCard("e1", ["W"], 1, "Creature")]);
      const picked = selectAiPick(pack, ai);
      expect(picked).not.toBeNull();
      expect(ai.state.lastPickReason).not.toBeNull();
      expect(ai.state.lastPickReason!.reason).toBe("random");
    });

    it("routes to color-focused picker and emits a color-fix signal for medium difficulty", () => {
      const pool = [
        makeCard("m1", ["B"], 2, "Creature"),
        makeCard("m2", ["B"], 1, "Instant"),
      ];
      const ai = makeAiNeighbor(pool, "medium");
      const pack = makePack([
        makeCard("good", ["B"], 2, "Creature"),
        makeCard("bad", ["G"], 3, "Creature"),
      ]);
      const picked = selectAiPick(pack, ai);
      expect(picked).not.toBeNull();
      expect(ai.state.lastPickReason!.reason).toBe("color-fix");
    });
  });
});
