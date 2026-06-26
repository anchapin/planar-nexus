/**
 * @fileoverview Unit tests for the AI Action Executor.
 *
 * Issue #1092: `src/ai/ai-action-executor.ts` reported 0% branch coverage. It
 * translates AI decisions into engine mutations, so we exercise the REAL
 * dispatch + result-assembly logic while stubbing the heavyweight rules-engine
 * mutators (`mana`, `spell-casting`, `combat`, `keyword-actions`, `game-state`)
 * and the serialization/evaluator helpers. The pure accessor helpers
 * (`getAvailableLands`, `getAvailableAttackers`, ...) read zones/cards
 * directly, so they are driven by real, deterministic fixtures.
 *
 * Also contains a regression test for a real bug fixed in `executeCastSpell`:
 * the "cannot cast" guard tested the truthiness of the `{ canCast }` object
 * (always truthy) instead of its `.canCast` field, so the short-circuit was
 * dead code.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// --- Mocks for heavyweight rules-engine collaborators -----------------------
// These are stubbed so tests stay fast/deterministic while the executor's own
// dispatch + assembly logic (the unit under test) runs for real.
jest.mock("@/lib/game-state/mana");
jest.mock("@/lib/game-state/spell-casting");
jest.mock("@/lib/game-state/combat");
jest.mock("@/lib/game-state/keyword-actions");
jest.mock("@/lib/game-state/game-state");
jest.mock("@/lib/game-state/serialization");
jest.mock("../game-state-evaluator", () => ({
  ...(jest.requireActual("../game-state-evaluator") as Record<string, unknown>),
  quickScore: jest.fn(() => 0),
}));

import { executeAIAction, type AIAction } from "../ai-action-executor";
import {
  getAvailableLands,
  getAvailableAttackers,
  getAvailableBlockers,
  getAvailableResponses,
  getAIGameState,
  getAvailableLandsAI,
  getAvailableAttackersAI,
  getAvailableBlockersAI,
  evaluateLookahead,
} from "../ai-action-executor";

import { canPlayLand, playLand } from "@/lib/game-state/mana";
import { canCastSpell, castSpell } from "@/lib/game-state/spell-casting";
import { declareAttackers } from "@/lib/game-state/combat";
import {
  tapCardAction,
  untapCardAction,
} from "@/lib/game-state/keyword-actions";
import { passPriority } from "@/lib/game-state/game-state";
import { engineToAIState } from "@/lib/game-state/serialization";
import { quickScore } from "../game-state-evaluator";

import type {
  GameState as EngineGameState,
  CardInstance,
  CardInstanceId,
  PlayerId,
  Combat,
} from "@/lib/game-state/types";

const canPlayLandMock = canPlayLand as unknown as jest.Mock;
const playLandMock = playLand as unknown as jest.Mock;
const canCastSpellMock = canCastSpell as unknown as jest.Mock;
const castSpellMock = castSpell as unknown as jest.Mock;
const declareAttackersMock = declareAttackers as unknown as jest.Mock;
const tapCardActionMock = tapCardAction as unknown as jest.Mock;
const untapCardActionMock = untapCardAction as unknown as jest.Mock;
const passPriorityMock = passPriority as unknown as jest.Mock;
const engineToAIStateMock = engineToAIState as unknown as jest.Mock;
const quickScoreMock = quickScore as unknown as jest.Mock;

const AI = "player1" as PlayerId;
const OPP = "player2" as PlayerId;

/** A distinct sentinel state returned by stubbed mutators. */
function sentinel(tag = "post"): EngineGameState {
  return { gameId: tag } as unknown as EngineGameState;
}

/** Build a minimal card instance carrying only the fields the executor reads. */
function mkCard(
  id: CardInstanceId,
  overrides: Partial<CardInstance> & {
    type_line: string;
    name?: string;
    power?: string;
    toughness?: string;
    keywords?: string[];
    mana_cost?: string;
    cmc?: number;
    oracle_text?: string;
  } = { type_line: "Creature" },
): CardInstance {
  const {
    type_line,
    name,
    power,
    toughness,
    keywords,
    mana_cost,
    cmc,
    oracle_text,
    ...rest
  } = overrides;
  return {
    id,
    oracleId: id,
    cardData: {
      name: name ?? id,
      type_line,
      power,
      toughness,
      keywords,
      mana_cost,
      cmc,
      oracle_text,
    } as any,
    currentFaceIndex: 0,
    isFaceDown: false,
    controllerId: AI,
    ownerId: AI,
    isTapped: false,
    isFlipped: false,
    isTurnedFaceUp: false,
    isPhasedOut: false,
    hasSummoningSickness: false,
    ...rest,
  } as unknown as CardInstance;
}

/** Build a partial engine game state with only the pieces the executor reads. */
function buildState(opts: {
  cards?: Array<CardInstance>;
  combat?: Partial<Combat>;
  zoneCards?: Record<string, CardInstanceId[]>;
  players?: PlayerId[];
}): EngineGameState {
  const cards = new Map<string, CardInstance>();
  for (const c of opts.cards ?? []) cards.set(c.id, c);

  const zones = new Map<string, { cardIds: CardInstanceId[] }>();
  for (const [key, ids] of Object.entries(opts.zoneCards ?? {})) {
    zones.set(key, { cardIds: ids });
  }

  const players = new Map<PlayerId, unknown>();
  for (const p of opts.players ?? [AI, OPP]) players.set(p, { id: p });

  const combat: Combat = {
    inCombatPhase: false,
    attackers: opts.combat?.attackers ?? [],
    blockers: opts.combat?.blockers ?? new Map(),
    remainingCombatPhases: 0,
    ...opts.combat,
  } as Combat;

  return {
    cards,
    zones,
    players,
    combat,
  } as unknown as EngineGameState;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Sensible defaults; individual tests override.
  canPlayLandMock.mockReturnValue(true);
  playLandMock.mockReturnValue({ success: true, state: sentinel("land") });
  canCastSpellMock.mockReturnValue({ canCast: true });
  castSpellMock.mockReturnValue({ success: true, state: sentinel("spell") });
  declareAttackersMock.mockReturnValue({
    success: true,
    state: sentinel("attack"),
    description: "",
  });
  tapCardActionMock.mockReturnValue({
    success: true,
    state: sentinel("tap"),
    description: "",
  });
  untapCardActionMock.mockReturnValue({
    success: true,
    state: sentinel("untap"),
    description: "",
  });
  passPriorityMock.mockReturnValue(sentinel("pass"));
  engineToAIStateMock.mockReturnValue({ players: {} });
  quickScoreMock.mockReturnValue(42);
});

// ===========================================================================
// executeAIAction — dispatch table
// ===========================================================================
describe("executeAIAction dispatch", () => {
  it("no_action returns the unchanged state with success", async () => {
    const state = buildState({});
    const res = await executeAIAction(state, { type: "no_action" }, AI);
    expect(res.success).toBe(true);
    expect(res.newState).toBe(state);
    expect(res.action).toEqual({ type: "no_action" });
  });

  it("unknown action type yields a failure result", async () => {
    const state = buildState({});
    const res = await executeAIAction(state, { type: "bogus_type" as any }, AI);
    expect(res.success).toBe(false);
    expect(res.error).toContain("Unknown action type");
    expect(res.action).toEqual({ type: "bogus_type" });
  });

  it("wraps a thrown error into a failure result (try/catch)", async () => {
    passPriorityMock.mockImplementation(() => {
      throw new Error("boom");
    });
    const state = buildState({});
    const res = await executeAIAction(state, { type: "pass_priority" }, AI);
    expect(res.success).toBe(false);
    expect(res.error).toBe("boom");
  });

  it("wraps a non-Error throw into a generic failure result", async () => {
    passPriorityMock.mockImplementation(() => {
      throw "string error";
    });
    const state = buildState({});
    const res = await executeAIAction(state, { type: "pass_priority" }, AI);
    expect(res.success).toBe(false);
    expect(res.error).toBe("Unknown error");
  });
});

// ===========================================================================
// play_land
// ===========================================================================
describe("executeAIAction: play_land", () => {
  it("plays a land when allowed, returning the engine's new state", async () => {
    const state = buildState({});
    const res = await executeAIAction(
      state,
      { type: "play_land", cardId: "land-1" },
      AI,
    );
    expect(canPlayLandMock).toHaveBeenCalledWith(state, AI);
    expect(playLandMock).toHaveBeenCalledWith(state, AI, "land-1");
    expect(res.success).toBe(true);
    expect(res.newState).toEqual(sentinel("land"));
    expect(res.action).toEqual({ type: "play_land", cardId: "land-1" });
  });

  it("rejects when the engine says a land cannot be played this turn", async () => {
    canPlayLandMock.mockReturnValue(false);
    const state = buildState({});
    const res = await executeAIAction(
      state,
      { type: "play_land", cardId: "land-1" },
      AI,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("Cannot play land");
    expect(playLandMock).not.toHaveBeenCalled();
  });

  it("surfaces the engine error when playLand itself fails", async () => {
    playLandMock.mockReturnValue({
      success: false,
      state: sentinel("land"),
      error: "Land drop already used",
    });
    const state = buildState({});
    const res = await executeAIAction(
      state,
      { type: "play_land", cardId: "land-1" },
      AI,
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Land drop already used");
  });
});

// ===========================================================================
// cast_spell — includes the regression test for the canCastSpell guard bug
// ===========================================================================
describe("executeAIAction: cast_spell", () => {
  it("casts a spell with no target when allowed", async () => {
    const state = buildState({});
    const res = await executeAIAction(
      state,
      { type: "cast_spell", cardId: "spell-1" },
      AI,
    );
    expect(canCastSpellMock).toHaveBeenCalledWith(state, AI, "spell-1");
    expect(castSpellMock).toHaveBeenCalledWith(
      state,
      AI,
      "spell-1",
      undefined,
      [],
      0,
    );
    expect(res.success).toBe(true);
    expect(res.newState).toEqual(sentinel("spell"));
    expect(res.action).toMatchObject({ type: "cast_spell", cardId: "spell-1" });
  });

  it("forwards a single target", async () => {
    const state = buildState({});
    const res = await executeAIAction(
      state,
      { type: "cast_spell", cardId: "bolt", targetId: "goblin" },
      AI,
    );
    expect(castSpellMock).toHaveBeenCalledWith(
      state,
      AI,
      "bolt",
      [{ type: "card", targetId: "goblin", isValid: true }],
      [],
      0,
    );
    expect(res.success).toBe(true);
  });

  it("forwards multiple targets (targetIds array)", async () => {
    const state = buildState({});
    await executeAIAction(
      state,
      { type: "cast_spell", cardId: "multi", targetIds: ["a", "b"] },
      AI,
    );
    expect(castSpellMock).toHaveBeenCalledWith(
      state,
      AI,
      "multi",
      [
        { type: "card", targetId: "a", isValid: true },
        { type: "card", targetId: "b", isValid: true },
      ],
      [],
      0,
    );
  });

  it("forwards chosen mode + X value for modal/variable spells", async () => {
    const state = buildState({});
    await executeAIAction(
      state,
      {
        type: "cast_spell",
        cardId: "modal",
        mode: "draw",
        xValue: 3,
      },
      AI,
    );
    expect(castSpellMock).toHaveBeenCalledWith(
      state,
      AI,
      "modal",
      undefined,
      ["draw"],
      3,
    );
  });

  // REGRESSION TEST for the bug fixed in this issue:
  // canCastSpell returns { canCast: boolean }; the guard previously checked the
  // object's truthiness (always true), so this failure path never executed.
  it("rejects when canCastSpell reports the spell is not castable (#1092 regression)", async () => {
    canCastSpellMock.mockReturnValue({
      canCast: false,
      reason: "not enough mana",
    });
    const state = buildState({});
    const res = await executeAIAction(
      state,
      { type: "cast_spell", cardId: "spell-1" },
      AI,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("Cannot cast spell");
    expect(castSpellMock).not.toHaveBeenCalled();
  });

  it("surfaces the engine error when castSpell fails", async () => {
    castSpellMock.mockReturnValue({
      success: false,
      state: sentinel("spell"),
      error: "Invalid target",
    });
    const state = buildState({});
    const res = await executeAIAction(
      state,
      { type: "cast_spell", cardId: "spell-1", targetId: "x" },
      AI,
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Invalid target");
  });
});

// ===========================================================================
// attack
// ===========================================================================
describe("executeAIAction: attack", () => {
  const attacker = mkCard("bear", {
    type_line: "Creature — Bear",
    name: "Bear",
    power: "2",
    toughness: "2",
    keywords: [],
  });

  it("declares an attacker and forwards to the combat engine", async () => {
    const state = buildState({ cards: [attacker] });
    const res = await executeAIAction(
      state,
      { type: "attack", cardId: "bear", targetId: OPP },
      AI,
    );
    expect(declareAttackersMock).toHaveBeenCalledTimes(1);
    const attackers = (
      declareAttackersMock.mock.calls[0] as unknown[]
    )[1] as any[];
    expect(attackers).toHaveLength(1);
    expect(attackers[0]).toMatchObject({
      cardId: "bear",
      defenderId: OPP,
      isAttackingPlaneswalker: false,
      damageToDeal: 2,
      hasFirstStrike: false,
      hasDoubleStrike: false,
    });
    expect(res.success).toBe(true);
    expect(res.newState).toEqual(sentinel("attack"));
  });

  it("defaults the defender to the opponent when no target given", async () => {
    const state = buildState({ cards: [attacker], players: [AI, OPP] });
    await executeAIAction(state, { type: "attack", cardId: "bear" }, AI);
    const attackers = (
      declareAttackersMock.mock.calls[0] as unknown[]
    )[1] as any[];
    expect(attackers[0].defenderId).toBe(OPP);
  });

  it("preserves existing attackers when adding a new one", async () => {
    const existing = {
      cardId: "old",
      defenderId: OPP,
      isAttackingPlaneswalker: false,
      damageToDeal: 1,
      hasFirstStrike: false,
      hasDoubleStrike: false,
    };
    const state = buildState({
      cards: [attacker],
      combat: { attackers: [existing] },
    });
    await executeAIAction(state, { type: "attack", cardId: "bear" }, AI);
    const attackers = (
      declareAttackersMock.mock.calls[0] as unknown[]
    )[1] as any[];
    expect(attackers).toHaveLength(2);
    expect(attackers[0]).toBe(existing);
  });

  it("reads first_strike / double_strike from keywords", async () => {
    const fs = mkCard("fs", {
      type_line: "Creature",
      power: "1",
      keywords: ["first_strike", "double_strike"],
    });
    const state = buildState({ cards: [fs] });
    await executeAIAction(state, { type: "attack", cardId: "fs" }, AI);
    const attackers = (
      declareAttackersMock.mock.calls[0] as unknown[]
    )[1] as any[];
    expect(attackers[0].hasFirstStrike).toBe(true);
    expect(attackers[0].hasDoubleStrike).toBe(true);
  });

  it("rejects when the creature is not on the battlefield", async () => {
    const state = buildState({ cards: [] });
    const res = await executeAIAction(
      state,
      { type: "attack", cardId: "ghost" },
      AI,
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Creature not found");
    expect(declareAttackersMock).not.toHaveBeenCalled();
  });

  it("rejects a tapped creature", async () => {
    const tapped = mkCard("tapped-bear", {
      type_line: "Creature",
      isTapped: true,
    });
    const state = buildState({ cards: [tapped] });
    const res = await executeAIAction(
      state,
      { type: "attack", cardId: "tapped-bear" },
      AI,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("tapped");
  });

  it("rejects a creature with summoning sickness", async () => {
    const sick = mkCard("sick", {
      type_line: "Creature",
      hasSummoningSickness: true,
    });
    const state = buildState({ cards: [sick] });
    const res = await executeAIAction(
      state,
      { type: "attack", cardId: "sick" },
      AI,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("summoning sickness");
  });

  it("surfaces joined errors when declareAttackers fails", async () => {
    declareAttackersMock.mockReturnValue({
      success: false,
      state: sentinel("attack"),
      errors: ["bad attacker", "no defender"],
    });
    const state = buildState({ cards: [attacker] });
    const res = await executeAIAction(
      state,
      { type: "attack", cardId: "bear" },
      AI,
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("bad attacker, no defender");
  });
});

// ===========================================================================
// block
// ===========================================================================
describe("executeAIAction: block", () => {
  const blocker = mkCard("wall", {
    type_line: "Creature — Wall",
    toughness: "4",
    keywords: [],
  });

  it("records a blocker against an attacker and returns success", async () => {
    const state = buildState({ cards: [blocker] });
    const res = await executeAIAction(
      state,
      { type: "block", cardId: "wall", targetId: "attkr-1" },
      AI,
    );
    expect(res.success).toBe(true);
    // Block does not call a dedicated engine mutator yet; it returns state.
    expect(res.newState).toBe(state);
    expect(res.action).toEqual({
      type: "block",
      cardId: "wall",
      targetId: "attkr-1",
    });
  });

  it("rejects when the blocker is not found", async () => {
    const state = buildState({ cards: [] });
    const res = await executeAIAction(
      state,
      { type: "block", cardId: "ghost", targetId: "attkr-1" },
      AI,
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Creature not found");
  });

  it("rejects a tapped blocker", async () => {
    const tapped = mkCard("tapped-wall", {
      type_line: "Creature",
      isTapped: true,
    });
    const state = buildState({ cards: [tapped] });
    const res = await executeAIAction(
      state,
      { type: "block", cardId: "tapped-wall", targetId: "attkr-1" },
      AI,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("tapped");
  });
});

// ===========================================================================
// tap_card / untap_card
// ===========================================================================
describe("executeAIAction: tap_card / untap_card", () => {
  it("taps a card via the engine action", async () => {
    const state = buildState({});
    const res = await executeAIAction(
      state,
      { type: "tap_card", cardId: "llanowar" },
      AI,
    );
    expect(tapCardActionMock).toHaveBeenCalledWith(state, "llanowar");
    expect(res.success).toBe(true);
    expect(res.newState).toEqual(sentinel("tap"));
  });

  it("surfaces a tap failure", async () => {
    const state = buildState({});
    tapCardActionMock.mockReturnValue({
      success: false,
      state,
      description: "",
      error: "already tapped",
    });
    const res = await executeAIAction(
      state,
      { type: "tap_card", cardId: "c" },
      AI,
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("already tapped");
  });

  it("untaps a card via the engine action", async () => {
    const state = buildState({});
    const res = await executeAIAction(
      state,
      { type: "untap_card", cardId: "llanowar" },
      AI,
    );
    expect(untapCardActionMock).toHaveBeenCalledWith(state, "llanowar");
    expect(res.success).toBe(true);
    expect(res.newState).toEqual(sentinel("untap"));
  });

  it("surfaces an untap failure with a default message", async () => {
    const state = buildState({});
    untapCardActionMock.mockReturnValue({
      success: false,
      state,
      description: "",
      // no error field
    });
    const res = await executeAIAction(
      state,
      { type: "untap_card", cardId: "c" },
      AI,
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("Failed to untap card");
  });
});

// ===========================================================================
// pass_priority
// ===========================================================================
describe("executeAIAction: pass_priority", () => {
  it("passes priority and returns the engine's new state", async () => {
    const state = buildState({});
    const res = await executeAIAction(state, { type: "pass_priority" }, AI);
    expect(passPriorityMock).toHaveBeenCalledWith(state, AI);
    expect(res.success).toBe(true);
    expect(res.newState).toEqual(sentinel("pass"));
    expect(res.action).toEqual({ type: "pass_priority" });
  });
});

// ===========================================================================
// Pure accessor helpers (real fixtures, no engine mocks exercised)
// ===========================================================================
describe("getAvailableLands", () => {
  it("returns land card ids from the player's hand", () => {
    const forest = mkCard("forest", { type_line: "Land — Forest" });
    const bear = mkCard("bear", { type_line: "Creature" });
    const state = buildState({
      cards: [forest, bear],
      zoneCards: { [`${AI}-hand`]: ["forest", "bear"] },
    });
    expect(getAvailableLands(state, AI)).toEqual(["forest"]);
  });

  it("returns an empty array when the hand zone is absent", () => {
    const state = buildState({});
    expect(getAvailableLands(state, AI)).toEqual([]);
  });

  it("ignores non-land cards", () => {
    const bear = mkCard("bear", { type_line: "Creature" });
    const state = buildState({
      cards: [bear],
      zoneCards: { [`${AI}-hand`]: ["bear"] },
    });
    expect(getAvailableLands(state, AI)).toEqual([]);
  });
});

describe("getAvailableAttackers", () => {
  it("returns untapped creatures without summoning sickness", () => {
    const ready = mkCard("r", { type_line: "Creature" });
    const tapped = mkCard("t", { type_line: "Creature", isTapped: true });
    const sick = mkCard("s", {
      type_line: "Creature",
      hasSummoningSickness: true,
    });
    const land = mkCard("l", { type_line: "Land" });
    const state = buildState({
      cards: [ready, tapped, sick, land],
      zoneCards: {
        [`${AI}-battlefield`]: ["r", "t", "s", "l"],
      },
    });
    expect(getAvailableAttackers(state, AI)).toEqual(["r"]);
  });

  it("returns empty when the battlefield zone is absent", () => {
    expect(getAvailableAttackers(buildState({}), AI)).toEqual([]);
  });
});

describe("getAvailableBlockers", () => {
  it("returns untapped creatures (summoning sickness does NOT prevent blocking)", () => {
    const ready = mkCard("r", { type_line: "Creature" });
    const sick = mkCard("s", {
      type_line: "Creature",
      hasSummoningSickness: true,
    });
    const tapped = mkCard("t", { type_line: "Creature", isTapped: true });
    const state = buildState({
      cards: [ready, sick, tapped],
      zoneCards: { [`${AI}-battlefield`]: ["r", "s", "t"] },
    });
    // Blocking ignores summoning sickness; only tapped creatures are excluded.
    expect(getAvailableBlockers(state, AI).sort()).toEqual(["r", "s"]);
  });

  it("returns empty when the battlefield zone is absent", () => {
    expect(getAvailableBlockers(buildState({}), AI)).toEqual([]);
  });
});

describe("getAvailableResponses", () => {
  it("returns instants and flash cards from hand with parsed mana costs", () => {
    const bolt = mkCard("bolt", {
      type_line: "Instant",
      name: "Lightning Bolt",
      mana_cost: "{R}",
      cmc: 1,
      oracle_text: "Lightning Bolt deals 3 damage to any target.",
    });
    const flash = mkCard("flash", {
      type_line: "Creature",
      name: "FlashBear",
      keywords: ["flash"],
      mana_cost: "{1}{G}",
      cmc: 2,
    });
    const sorcery = mkCard("sorc", {
      type_line: "Sorcery",
      name: "Divination",
      mana_cost: "{2}{U}",
    });
    const state = buildState({
      cards: [bolt, flash, sorcery],
      zoneCards: { [`${AI}-hand`]: ["bolt", "flash", "sorc"] },
    });
    const responses = getAvailableResponses(state, AI);
    expect(responses).toHaveLength(2);
    const boltR = responses.find((r) => r.cardId === "bolt")!;
    expect(boltR.type).toBe("instant");
    expect(boltR.canCounter).toBe(false);
    expect(boltR.manaValue).toBe(1);
    // {R} parses to { R: 1 }
    expect(boltR.manaCost).toEqual({ R: 1 });
    const flashR = responses.find((r) => r.cardId === "flash")!;
    expect(flashR.type).toBe("flash");
    // {1}{G} parses to { G: 1, generic: 1 }
    expect(flashR.manaCost).toEqual({ G: 1, generic: 1 });
  });

  it("flags cards whose oracle text can counter a spell", () => {
    const counter = mkCard("cs", {
      type_line: "Instant",
      name: "Counterspell",
      mana_cost: "{U}{U}",
      oracle_text: "Counter target spell.",
    });
    const state = buildState({
      cards: [counter],
      zoneCards: { [`${AI}-hand`]: ["cs"] },
    });
    const responses = getAvailableResponses(state, AI);
    expect(responses[0].canCounter).toBe(true);
  });

  it("returns empty when the hand zone is absent", () => {
    expect(getAvailableResponses(buildState({}), AI)).toEqual([]);
  });
});

// ===========================================================================
// getAIGameState — delegates to the serialization converter
// ===========================================================================
describe("getAIGameState", () => {
  it("delegates to engineToAIState", () => {
    const state = buildState({});
    const converted = { players: { player1: { id: AI } } };
    engineToAIStateMock.mockReturnValue(converted);
    expect(getAIGameState(state)).toBe(converted);
    expect(engineToAIStateMock).toHaveBeenCalledWith(state);
  });
});

// ===========================================================================
// AI-format accessors (operate on AIGameState directly)
// ===========================================================================
describe("AI-format accessors", () => {
  const aiState = {
    players: {
      [AI]: {
        id: AI,
        hand: [
          { cardInstanceId: "h-land", type: "Land" },
          { cardInstanceId: "h-creep", type: "Creature" },
        ],
        battlefield: [
          {
            cardInstanceId: "b-ready",
            type: "creature",
            tapped: false,
            summoningSickness: false,
            power: 2,
          },
          {
            cardInstanceId: "b-tapped",
            type: "creature",
            tapped: true,
            summoningSickness: false,
            power: 3,
          },
          {
            cardInstanceId: "b-sick",
            type: "creature",
            tapped: false,
            summoningSickness: true,
            power: 5,
          },
          {
            cardInstanceId: "b-zero",
            type: "creature",
            tapped: false,
            summoningSickness: false,
            power: 0,
          },
          { cardInstanceId: "b-land", type: "land", tapped: false },
        ],
      },
    },
  } as any;

  it("getAvailableLandsAI returns land ids from the AI player's hand", () => {
    expect(getAvailableLandsAI(aiState, AI)).toEqual(["h-land"]);
  });

  it("getAvailableLandsAI returns [] for an unknown player", () => {
    expect(getAvailableLandsAI(aiState, "nobody")).toEqual([]);
  });

  it("getAvailableAttackersAI returns untapped, non-sick creatures with positive power", () => {
    expect(getAvailableAttackersAI(aiState, AI)).toEqual(["b-ready"]);
  });

  it("getAvailableAttackersAI returns [] for an unknown player", () => {
    expect(getAvailableAttackersAI(aiState, "nobody")).toEqual([]);
  });

  it("getAvailableBlockersAI returns untapped creatures (sickness/power ignored)", () => {
    // getAvailableBlockersAI only excludes tapped creatures; it does NOT check
    // power (unlike the attacker accessor) nor summoning sickness.
    expect(getAvailableBlockersAI(aiState, AI).sort()).toEqual([
      "b-ready",
      "b-sick",
      "b-zero",
    ]);
  });

  it("getAvailableBlockersAI returns [] for an unknown player", () => {
    expect(getAvailableBlockersAI(aiState, "nobody")).toEqual([]);
  });
});

// ===========================================================================
// evaluateLookahead — depth / action branches
// ===========================================================================
describe("evaluateLookahead", () => {
  it("terminal depth (<=0) scores the current state without acting", async () => {
    const state = buildState({});
    const score = await evaluateLookahead(state, AI, 0);
    expect(score).toBe(42);
    expect(quickScoreMock).toHaveBeenCalled();
    expect(castSpellMock).not.toHaveBeenCalled();
    expect(playLandMock).not.toHaveBeenCalled();
  });

  it("positive depth but no action scores the current state", async () => {
    const state = buildState({});
    const score = await evaluateLookahead(state, AI, 2);
    expect(score).toBe(42);
    expect(quickScoreMock).toHaveBeenCalled();
  });

  it("returns -100 when the simulated action fails", async () => {
    canPlayLandMock.mockReturnValue(false);
    const state = buildState({});
    const score = await evaluateLookahead(state, AI, 1, {
      type: "play_land",
      cardId: "l",
    });
    expect(score).toBe(-100);
  });

  it("at depth 1 evaluates the resulting state from the actor's view", async () => {
    const state = buildState({});
    const score = await evaluateLookahead(state, AI, 1, {
      type: "pass_priority",
    });
    expect(score).toBe(42);
    // quickScore called for the resulting state
    expect(quickScoreMock).toHaveBeenCalled();
  });

  it("at depth > 1 blends our score with the opponent's potential response", async () => {
    let calls = 0;
    // Source computes opponentScore FIRST, then ourScore.
    const opponentScore = 20;
    const ourScore = 100;
    const scores = [opponentScore, ourScore];
    quickScoreMock.mockImplementation(() => scores[calls++]);
    const state = buildState({ players: [AI, OPP] });
    const score = await evaluateLookahead(state, AI, 2, {
      type: "pass_priority",
    });
    // ourScore - (opponentScore * 0.5) / depth = 100 - (20 * 0.5) / 2 = 95
    expect(score).toBe(95);
  });
});
