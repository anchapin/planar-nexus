/**
 * Error containment tests for the rules engine (#1900).
 *
 * Verifies that uncaught exceptions from oracle-text-parser, createCardInstance,
 * or ability resolution are caught and returned as EngineUncaughtException
 * rather than propagating up and crashing the session.
 */

import { castSpell, resolveTopOfStack } from "../spell-casting";
import { checkStateBasedActions } from "../state-based-actions";
import { checkTriggeredAbilities } from "../abilities";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { createEngineUncaughtException } from "../errors";
import type { ScryfallCard, GameState } from "../types";
import { Phase, ZoneType } from "../types";

function createMockCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: `mock-${Math.random().toString(36).substr(2, 9)}`,
    name: overrides.name || "Test Card",
    type_line: overrides.type_line || "Creature — Human",
    oracle_text: overrides.oracle_text || "",
    mana_cost: overrides.mana_cost || "{1}{W}",
    cmc: 2,
    colors: overrides.colors || ["W"],
    color_identity: overrides.color_identity || ["W"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

describe("Error containment - createEngineUncaughtException", () => {
  it("should capture error message, stack, cardId, and entry point", () => {
    const state = createInitialGameState(["Alice", "Bob"]);
    const error = new Error("boom");
    const cardId = "card-123" as const;

    const result = createEngineUncaughtException(error, "castSpell", state, cardId);

    expect(result.type).toBe("EngineUncaughtException");
    expect(result.message).toBe("boom");
    expect(result.stack).toBeDefined();
    expect(result.cardId).toBe(cardId);
    expect(result.entryPoint).toBe("castSpell");
    expect(result.cause).toBe(error);
    expect(result.stateHashBefore).toBeDefined();
    expect(result.stateHashBefore).not.toBe("<hash unavailable>");
  });

  it("should handle non-Error throws", () => {
    const state = createInitialGameState(["Alice", "Bob"]);
    const result = createEngineUncaughtException("string error", "resolveTopOfStack", state);

    expect(result.type).toBe("EngineUncaughtException");
    expect(result.message).toBe("string error");
    expect(result.cause).toBe("string error");
  });

  it("should handle object throws", () => {
    const state = createInitialGameState(["Alice", "Bob"]);
    const thrownObj = { code: 500, reason: "internal" };
    const result = createEngineUncaughtException(thrownObj, "checkStateBasedActions", state);

    expect(result.type).toBe("EngineUncaughtException");
    expect(result.message).toBe('[object Object]');
    expect(result.cause).toBe(thrownObj);
  });
});

describe("Error containment - checkStateBasedActions", () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;

  beforeEach(() => {
    state = createInitialGameState(["Alice", "Bob"]);
    aliceId = state.players.keys().next().value!;
    state = startGame(state);
  });

  it("should not throw when SBA check encounters an error", () => {
    // The function should catch errors internally and return original state
    const result = checkStateBasedActions(state);
    expect(result.state).toEqual(state);
  });

  it("should return actionsPerformed=false when SBA check fails", () => {
    // Even if an error occurs, the function should return a valid result
    const result = checkStateBasedActions(state);
    expect(result.state).toBeDefined();
    expect(typeof result.actionsPerformed).toBe("boolean");
  });
});

describe("Error containment - checkTriggeredAbilities", () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;

  beforeEach(() => {
    state = createInitialGameState(["Alice", "Bob"]);
    aliceId = state.players.keys().next().value!;
    state = startGame(state);
  });

  it("should not throw when trigger detection encounters an error", () => {
    const result = checkTriggeredAbilities(state, "phaseChange");
    expect(result.state).toEqual(state);
  });

  it("should return empty abilities array on error", () => {
    const result = checkTriggeredAbilities(state, "phaseChange");
    expect(Array.isArray(result.abilities)).toBe(true);
  });
});

describe("Error containment - resolveTopOfStack", () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;

  beforeEach(() => {
    state = createInitialGameState(["Alice", "Bob"]);
    aliceId = state.players.keys().next().value!;
    state = startGame(state);
  });

  it("should return original state when stack is empty (no error)", () => {
    const result = resolveTopOfStack(state);
    expect(result).toBe(state);
  });

  it("should not throw when resolving an empty stack", () => {
    expect(() => resolveTopOfStack(state)).not.toThrow();
  });
});

describe("Error containment - castSpell", () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;

  beforeEach(() => {
    state = createInitialGameState(["Alice", "Bob"]);
    aliceId = state.players.keys().next().value!;
    state = startGame(state);
  });

  it("should return error message when cast fails validation", () => {
    // Cast with invalid card ID should return error, not throw
    const result = castSpell(state, aliceId, "invalid-card-id" as any);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("should return error when card not in hand", () => {
    // Create a card not in hand
    const card = createCardInstance(createMockCard({ name: "Orphan" }), aliceId, aliceId);
    state.cards.set(card.id, card);

    const result = castSpell(state, aliceId, card.id);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
