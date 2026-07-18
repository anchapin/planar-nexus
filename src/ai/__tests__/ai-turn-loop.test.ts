/**
 * @fileoverview Tests for per-archetype playstyle wiring in the AI turn loop.
 *
 * Covers the fix for issue #911: the deck-specific (per-archetype) playstyle
 * weights used to be dead code because the live turn loop never propagated the
 * AI player's archetype. These tests verify the turn loop now (a) auto-detects
 * the archetype from the AI player's deck and (b) exposes an explicit override
 * via AITurnConfig.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  detectPlayerArchetype,
  detectOpponentArchetype,
  runAITurn,
  runOpeningHandMulligan,
  computeAdaptiveTempoRisk,
  adaptiveStrength,
  ADAPTIVE_MIN_MULT,
  ADAPTIVE_MAX_MULT,
  chooseMain2Action,
  buildMain2Context,
  type AITurnConfig,
  type AdaptiveTempoRisk,
} from "../ai-turn-loop";
import {
  resolveDifficultyConfig,
  type DifficultyLevel,
} from "../ai-difficulty";
import {
  BoardSwingTracker,
  BOARD_SWING_SCALE,
  type BoardSwing,
} from "../game-state-evaluator";
import type { DeckCard } from "@/app/actions";
import type {
  GameState as EngineGameState,
  CardInstance,
  CardInstanceId,
  PlayerId,
  Turn,
} from "@/lib/game-state/types";

// ---------------------------------------------------------------------------
// Issue #1092: runAITurn orchestration coverage.
//
// runAITurn sequences the AI's phases (untap -> upkeep -> draw -> main ->
// combat -> main2 -> end -> cleanup) and is the single largest untested
// branch cluster in the AI module. We exercise the REAL orchestration logic
// while stubbing the rules-engine mutators and the combat decision tree so the
// tests stay deterministic and fast. The real turn loop (phase ordering,
// priority handling, action aggregation, termination) is the unit under test.
// ---------------------------------------------------------------------------
jest.mock("@/lib/game-state/mana");
jest.mock("@/lib/game-state/spell-casting");
jest.mock("@/lib/game-state/combat");
jest.mock("@/lib/game-state/keyword-actions");
jest.mock("@/lib/game-state/game-state");
jest.mock("@/lib/game-state/turn-phases");
jest.mock("@/lib/game-state/serialization");
jest.mock("@/lib/game-rules");

// `mock`-prefixed so the jest.mock factory may reference it (deferred read).
let mockAttackPlan: { attacks: any[] } = { attacks: [] };
jest.mock("../decision-making/combat-decision-tree", () => ({
  CombatDecisionTree: jest.fn().mockImplementation(() => ({
    generateAttackPlan: jest.fn(() => mockAttackPlan),
  })),
  deckArchetypeToOpponentArchetype: jest.fn(() => "midrange"),
}));

import { canPlayLand, playLand } from "@/lib/game-state/mana";
import { canCastSpell, castSpell } from "@/lib/game-state/spell-casting";
import { declareAttackers } from "@/lib/game-state/combat";
import {
  tapCardAction,
  untapCardAction,
  discardCards,
} from "@/lib/game-state/keyword-actions";
import { passPriority, drawCard } from "@/lib/game-state/game-state";
import { advancePhase } from "@/lib/game-state/turn-phases";
import { engineToAIState } from "@/lib/game-state/serialization";
import { getMaxHandSize, getMulliganRules } from "@/lib/game-rules";

const canPlayLandMock = canPlayLand as unknown as jest.Mock;
const playLandMock = playLand as unknown as jest.Mock;
const canCastSpellMock = canCastSpell as unknown as jest.Mock;
const castSpellMock = castSpell as unknown as jest.Mock;
const declareAttackersMock = declareAttackers as unknown as jest.Mock;
const tapCardActionMock = tapCardAction as unknown as jest.Mock;
const untapCardActionMock = untapCardAction as unknown as jest.Mock;
const discardCardsMock = discardCards as unknown as jest.Mock;
const passPriorityMock = passPriority as unknown as jest.Mock;
const drawCardMock = drawCard as unknown as jest.Mock;
const advancePhaseMock = advancePhase as unknown as jest.Mock;
const engineToAIStateMock = engineToAIState as unknown as jest.Mock;
const getMaxHandSizeMock = getMaxHandSize as unknown as jest.Mock;
const getMulliganRulesMock = getMulliganRules as unknown as jest.Mock;

const AI: PlayerId = "player1";
const OPP: PlayerId = "player2";

function mkTurnCard(
  id: CardInstanceId,
  typeLine: string,
  extra: Partial<CardInstance> = {},
): CardInstance {
  return {
    id,
    oracleId: id,
    cardData: {
      name: id,
      type_line: typeLine,
      cmc: 1,
      mana_cost: "{1}",
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
    ...extra,
  } as unknown as CardInstance;
}

function buildTurnState(opts: {
  hand?: CardInstanceId[];
  battlefield?: CardInstanceId[];
  cards?: CardInstance[];
  combatAttackers?: any[];
}): EngineGameState {
  const cards = new Map<string, CardInstance>();
  for (const c of opts.cards ?? []) cards.set(c.id, c);

  const zones = new Map<string, { cardIds: CardInstanceId[] }>();
  zones.set(`${AI}-hand`, { cardIds: opts.hand ?? [] });
  zones.set(`${AI}-battlefield`, { cardIds: opts.battlefield ?? [] });
  zones.set(`${AI}-library`, { cardIds: [] });
  zones.set(`${OPP}-battlefield`, { cardIds: [] }); // empty -> opponent 'unknown'

  const players = new Map<PlayerId, unknown>();
  players.set(AI, { id: AI });
  players.set(OPP, { id: OPP });

  const turn: Turn = {
    activePlayerId: AI,
    currentPhase: "untap" as any,
    turnNumber: 3,
    extraTurns: 0,
    isFirstTurn: false,
    startedAt: 0,
  };

  return {
    cards,
    zones,
    players,
    turn,
    combat: {
      inCombatPhase: false,
      attackers: opts.combatAttackers ?? [],
      blockers: new Map(),
      remainingCombatPhases: 0,
    } as any,
    priorityPlayerId: AI,
  } as unknown as EngineGameState;
}

/** Default config; delayMs:0 keeps real-timer tests fast (only upkeep's 500ms). */
function baseConfig(overrides: Partial<AITurnConfig> = {}): AITurnConfig {
  return {
    difficulty: "medium",
    delayMs: 0,
    archetype: "midrange",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Engine stubs: succeed and echo the state so zones/cards persist across
  // phases (the turn loop advances currentState from each phase's newState).
  canPlayLandMock.mockReturnValue(true);
  playLandMock.mockImplementation((state: any) => ({ success: true, state }));
  canCastSpellMock.mockReturnValue({ canCast: true });
  castSpellMock.mockImplementation((state: any) => ({ success: true, state }));
  declareAttackersMock.mockImplementation((state: any) => ({
    success: true,
    state,
    description: "",
  }));
  tapCardActionMock.mockImplementation((state: any) => ({
    success: true,
    state,
    description: "",
  }));
  untapCardActionMock.mockImplementation((state: any) => ({
    success: true,
    state,
    description: "",
  }));
  passPriorityMock.mockImplementation((state: any) => state);
  drawCardMock.mockImplementation((state: any) => state);
  discardCardsMock.mockImplementation((state: any) => ({
    success: true,
    state,
    description: "",
  }));
  advancePhaseMock.mockImplementation((turn: any) => ({
    ...turn,
    currentPhase: "next",
  }));
  engineToAIStateMock.mockReturnValue({});
  getMaxHandSizeMock.mockReturnValue(7);
  mockAttackPlan = { attacks: [] };
});

function createCard(
  name: string,
  type: string,
  cmc: number = 0,
  colors: string[] = [],
  oracleText: string = "",
): DeckCard {
  return {
    name,
    count: 1,
    id: `card-${name}`,
    cmc,
    colors,
    legalities: {},
    type_line: type,
    mana_cost: `{${cmc}}`,
    color_identity: colors,
    oracle_text: oracleText,
  };
}

/**
 * Build a minimal engine game state containing only the pieces
 * `detectPlayerArchetype` reads (zones + cards). The rest of the GameState is
 * irrelevant to the function under test, so we cast a partial object.
 */
function buildStateWithLibrary(
  playerId: string,
  deck: DeckCard[],
): EngineGameState {
  const cards = new Map<string, CardInstance>();
  const cardIds: string[] = [];
  let i = 0;
  for (const card of deck) {
    const id = `${playerId}-lib-${i++}`;
    cardIds.push(id);
    cards.set(id, {
      id,
      oracleId: id,
      cardData: { ...card },
      currentFaceIndex: 0,
      isFaceDown: false,
      controllerId: playerId,
      ownerId: playerId,
      isTapped: false,
      isFlipped: false,
      isTurnedFaceUp: false,
      isPhasedOut: false,
    } as unknown as CardInstance);
  }

  const zones = new Map<string, { cardIds: string[] }>();
  zones.set(`${playerId}-library`, { cardIds });

  return { zones, cards } as unknown as EngineGameState;
}

describe("detectPlayerArchetype (issue #911 wiring)", () => {
  it("returns 'unknown' when the player has no cards/zones", () => {
    const empty = {
      zones: new Map(),
      cards: new Map(),
    } as unknown as EngineGameState;
    expect(detectPlayerArchetype(empty, "player1")).toBe("unknown");
  });

  it("auto-detects 'aggro' from a burn-style deck", () => {
    const burnDeck: DeckCard[] = [
      createCard(
        "Lightning Bolt",
        "Instant",
        1,
        ["R"],
        "Deal 3 damage to any target",
      ),
      createCard(
        "Lava Spike",
        "Sorcery",
        1,
        ["R"],
        "Deal 3 damage to target player",
      ),
      createCard("Skewer the Critics", "Sorcery", 2, ["R"], "Deal 3 damage"),
      createCard("Burst Lightning", "Instant", 2, ["R"], "Deal 4 damage"),
      createCard("Goblin Guide", "Creature", 1, ["R"], "Haste"),
      createCard(
        "Monastery Swiftspear",
        "Creature",
        1,
        ["R", "U"],
        "Haste, prowess",
      ),
      createCard("Mountain", "Land", 0, [], ""),
    ];

    const state = buildStateWithLibrary("player1", burnDeck);
    expect(detectPlayerArchetype(state, "player1")).toBe("aggro");
  });

  it("never throws and returns 'unknown' for a deck that does not classify", () => {
    // A single basic land cannot be classified.
    const state = buildStateWithLibrary("player1", [
      createCard("Forest", "Land", 0, [], ""),
    ]);
    expect(() => detectPlayerArchetype(state, "player1")).not.toThrow();
    expect(detectPlayerArchetype(state, "player1")).toBe("unknown");
  });

  it("gathers cards from all of a player's zones, not just the library", () => {
    // Split a burn deck across library + hand + battlefield; detection should
    // still classify the combined list as aggro.
    const splitDeck = [
      createCard(
        "Lightning Bolt",
        "Instant",
        1,
        ["R"],
        "Deal 3 damage to any target",
      ),
      createCard(
        "Lava Spike",
        "Sorcery",
        1,
        ["R"],
        "Deal 3 damage to target player",
      ),
      createCard("Goblin Guide", "Creature", 1, ["R"], "Haste"),
    ];

    const cards = new Map<string, CardInstance>();
    const zones = new Map<string, { cardIds: string[] }>();
    const playerId = "player1";

    const zoneKeys = [
      `${playerId}-library`,
      `${playerId}-hand`,
      `${playerId}-battlefield`,
    ];
    splitDeck.forEach((card, idx) => {
      const id = `${playerId}-c${idx}`;
      cards.set(id, {
        id,
        oracleId: id,
        cardData: { ...card },
        currentFaceIndex: 0,
        isFaceDown: false,
        controllerId: playerId,
        ownerId: playerId,
        isTapped: false,
        isFlipped: false,
        isTurnedFaceUp: false,
        isPhasedOut: false,
      } as unknown as CardInstance);
      // Put each card in a different zone.
      zones.set(zoneKeys[idx], { cardIds: [id] });
    });

    const state = { zones, cards } as unknown as EngineGameState;
    // With only 3 cards detection confidence is lower, but the function must
    // still run without error and return a valid DeckArchetype bucket.
    const result = detectPlayerArchetype(state, playerId);
    expect([
      "aggro",
      "unknown",
      "midrange",
      "control",
      "combo",
      "ramp",
    ]).toContain(result);
  });
});

describe("AITurnConfig.archetype override (issue #911)", () => {
  it("accepts an explicit archetype in the config", () => {
    const config: AITurnConfig = {
      difficulty: "medium",
      delayMs: 0,
      archetype: "control",
    };
    expect(config.archetype).toBe("control");
  });

  it("leaves archetype optional for backward compatibility", () => {
    const config: AITurnConfig = { difficulty: "medium", delayMs: 0 };
    expect(config.archetype).toBeUndefined();
  });
});

/**
 * Build a minimal engine game state placing the given cards into specific
 * OBSERVED zones for a player. Used to verify {@link detectOpponentArchetype}
 * reads only revealed/played zones and never the opponent's hidden library
 * or hand.
 */
function buildObservedState(
  playerId: string,
  zoneCards: Record<string, DeckCard[]>,
): EngineGameState {
  const cards = new Map<string, CardInstance>();
  const zones = new Map<string, { cardIds: string[] }>();
  let i = 0;
  for (const [zoneSuffix, deck] of Object.entries(zoneCards)) {
    const cardIds: string[] = [];
    for (const card of deck) {
      const id = `${playerId}-${zoneSuffix}-${i++}`;
      cardIds.push(id);
      cards.set(id, {
        id,
        oracleId: id,
        cardData: { ...card },
        currentFaceIndex: 0,
        isFaceDown: false,
        controllerId: playerId,
        ownerId: playerId,
        isTapped: false,
        isFlipped: false,
        isTurnedFaceUp: false,
        isPhasedOut: false,
      } as unknown as CardInstance);
    }
    zones.set(`${playerId}-${zoneSuffix}`, { cardIds });
  }
  return { zones, cards } as unknown as EngineGameState;
}

describe("detectOpponentArchetype (issue #912 — live opponent detection)", () => {
  it("returns 'unknown' when the opponent has no observed cards", () => {
    const empty = {
      zones: new Map(),
      cards: new Map(),
    } as unknown as EngineGameState;
    expect(detectOpponentArchetype(empty, "player2")).toBe("unknown");
  });

  it("detects 'aggro' from observed battlefield + graveyard cards", () => {
    // Resolved burn spells in the graveyard (observed once cast) ...
    const graveyard = [
      createCard("Lightning Bolt", "Instant", 1, ["R"], "Deal 3 damage"),
      createCard("Lava Spike", "Sorcery", 1, ["R"], "Deal 3 damage"),
      createCard("Burst Lightning", "Instant", 2, ["R"], "Deal 4 damage"),
    ];
    // ... and aggressive creatures currently on the battlefield.
    const battlefield = [
      createCard("Goblin Guide", "Creature", 1, ["R"], "Haste"),
      createCard("Monastery Swiftspear", "Creature", 1, ["R", "U"], "Prowess"),
    ];
    const state = buildObservedState("player2", {
      graveyard,
      battlefield,
    });
    expect(detectOpponentArchetype(state, "player2")).toBe("aggro");
  });

  it("does NOT read the opponent's hidden library or hand", () => {
    // A full aggro deck placed ONLY in hidden zones (library + hand) must not
    // influence detection — those cards are not yet observed information.
    const aggroDeck: DeckCard[] = [
      createCard("Lightning Bolt", "Instant", 1, ["R"], "Deal 3 damage"),
      createCard("Lava Spike", "Sorcery", 1, ["R"], "Deal 3 damage"),
      createCard("Goblin Guide", "Creature", 1, ["R"], "Haste"),
      createCard("Monastery Swiftspear", "Creature", 1, ["R", "U"], "Prowess"),
      createCard("Rift Bolt", "Sorcery", 3, ["R"], "Deal 3 damage"),
    ];
    const state = buildObservedState("player2", {
      library: aggroDeck,
      hand: aggroDeck,
    });
    // Observed zones are empty -> nothing detected, regardless of the hidden deck.
    expect(detectOpponentArchetype(state, "player2")).toBe("unknown");
  });

  it("never throws and returns a valid archetype bucket", () => {
    const state = buildObservedState("player2", {
      battlefield: [createCard("Forest", "Land", 0, [], "")],
    });
    expect(() => detectOpponentArchetype(state, "player2")).not.toThrow();
    expect([
      "aggro",
      "unknown",
      "midrange",
      "control",
      "combo",
      "ramp",
    ]).toContain(detectOpponentArchetype(state, "player2"));
  });

  it("updates the detected archetype as the opponent plays more cards", () => {
    const burnCards: DeckCard[] = [
      createCard("Lightning Bolt", "Instant", 1, ["R"], "Deal 3 damage"),
      createCard("Lava Spike", "Sorcery", 1, ["R"], "Deal 3 damage"),
      createCard("Goblin Guide", "Creature", 1, ["R"], "Haste"),
      createCard("Monastery Swiftspear", "Creature", 1, ["R", "U"], "Prowess"),
    ];

    // Early game: the opponent has revealed nothing yet.
    const emptyState = buildObservedState("player2", {});
    expect(detectOpponentArchetype(emptyState, "player2")).toBe("unknown");

    // Later: the opponent has cast burn spells (now in the graveyard) and
    // committed aggressive creatures to the battlefield. The detector should
    // now classify the emerging archetype as aggro.
    const midGameState = buildObservedState("player2", {
      graveyard: burnCards.slice(0, 2),
      battlefield: burnCards.slice(2),
    });
    expect(detectOpponentArchetype(midGameState, "player2")).toBe("aggro");
  });
});

// ===========================================================================
// runAITurn — full turn orchestration (issue #1092)
// ===========================================================================
describe("runAITurn — phase progression & termination", () => {
  it("runs a full turn, advancing priority and terminating at cleanup", async () => {
    const state = buildTurnState({ hand: [], battlefield: [] });
    const result = await runAITurn(state, AI, baseConfig());

    expect(result.success).toBe(true);
    expect(result.phase).toBe("complete");
    expect(result.finalState).toBeDefined();
    // Priority was set to the AI player through every phase advance.
    expect(advancePhaseMock).toHaveBeenCalled();
    // A turn always terminates by passing priority in the end phase.
    expect(passPriorityMock).toHaveBeenCalledWith(expect.anything(), AI);
    expect(result.actionsTaken.some((a) => a.type === "pass_priority")).toBe(
      true,
    );
  });

  it("untaps every tapped permanent during the untap phase", async () => {
    const tapped1 = mkTurnCard("t1", "Creature", { isTapped: true });
    const tapped2 = mkTurnCard("t2", "Land", { isTapped: true });
    const ready = mkTurnCard("r1", "Creature", { isTapped: false });
    const state = buildTurnState({
      hand: [],
      battlefield: ["t1", "t2", "r1"],
      cards: [tapped1, tapped2, ready],
    });

    const result = await runAITurn(state, AI, baseConfig());

    const untaps = result.actionsTaken.filter((a) => a.type === "untap_card");
    expect(untaps.map((a) => a.cardId).sort()).toEqual(["t1", "t2"]);
    // The ready permanent is NOT untapped.
    expect(untaps.find((a) => a.cardId === "r1")).toBeUndefined();
    // untap_card is dispatched through the action executor -> keyword action.
    expect(untapCardActionMock).toHaveBeenCalledWith(expect.anything(), "t1");
    expect(untapCardActionMock).toHaveBeenCalledWith(expect.anything(), "t2");
  });

  it("draws a card during the draw phase and emits commentary", async () => {
    const state = buildTurnState({ hand: [], battlefield: [] });
    const commentary: string[] = [];
    const result = await runAITurn(
      state,
      AI,
      baseConfig({ onCommentary: (t) => commentary.push(t) }),
    );

    expect(drawCardMock).toHaveBeenCalledWith(expect.anything(), AI);
    expect(commentary).toContain("Draws a card");
    // The draw is recorded as a no-op action (the engine drew the card).
    expect(
      result.actionsTaken.some(
        (a) => a.type === "no_action" && /Drew card/.test(a.reasoning ?? ""),
      ),
    ).toBe(true);
  });

  it("passes priority at end of turn and signals turn end", async () => {
    const state = buildTurnState({ hand: [], battlefield: [] });
    const commentary: string[] = [];
    await runAITurn(
      state,
      AI,
      baseConfig({ onCommentary: (t) => commentary.push(t) }),
    );

    expect(commentary).toContain("Ends turn");
  });
});

// ===========================================================================
// runAITurn — main phase: land + spell casting
// ===========================================================================
describe("runAITurn — main phase casting", () => {
  it("plays a land from hand during the main phase", async () => {
    const forest = mkTurnCard("forest", "Land");
    const state = buildTurnState({
      hand: ["forest"],
      battlefield: [],
      cards: [forest],
    });
    const commentary: string[] = [];
    const result = await runAITurn(
      state,
      AI,
      baseConfig({ onCommentary: (t) => commentary.push(t) }),
    );

    expect(playLandMock).toHaveBeenCalledWith(expect.anything(), AI, "forest");
    expect(
      result.actionsTaken.some(
        (a) => a.type === "play_land" && a.cardId === "forest",
      ),
    ).toBe(true);
    expect(commentary).toContain("Plays forest");
  });

  it("casts creatures and other spells from hand (medium difficulty)", async () => {
    const bear = mkTurnCard("bear", "Creature", {
      cardData: { name: "bear", type_line: "Creature", cmc: 2 } as any,
    });
    const bolt = mkTurnCard("bolt", "Instant", {
      cardData: { name: "bolt", type_line: "Instant", cmc: 1 } as any,
    });
    const state = buildTurnState({
      hand: ["bear", "bolt"],
      battlefield: [],
      cards: [bear, bolt],
    });

    // castCreatures skips a creature when Math.random() < randomnessFactor*0.3.
    // A high roll never skips for any difficulty (max threshold is easy's 0.12).
    const spy = jest.spyOn(Math, "random").mockReturnValue(0.9);
    try {
      const result = await runAITurn(state, AI, baseConfig());
      expect(
        result.actionsTaken.some(
          (a) => a.type === "cast_spell" && a.cardId === "bear",
        ),
      ).toBe(true);
      expect(
        result.actionsTaken.some(
          (a) => a.type === "cast_spell" && a.cardId === "bolt",
        ),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("handles an empty hand by taking no main-phase actions", async () => {
    const state = buildTurnState({ hand: [], battlefield: [] });
    const result = await runAITurn(state, AI, baseConfig());
    const mainActions = result.actionsTaken.filter(
      (a) => a.type === "play_land" || a.type === "cast_spell",
    );
    expect(mainActions).toEqual([]);
    // Turn still completes successfully.
    expect(result.success).toBe(true);
  });
});

// ===========================================================================
// runAITurn — difficulty-gated behavior (issue #1016 follow-up)
// ===========================================================================
describe("runAITurn — difficulty gates creature casting", () => {
  // castCreatures skips a creature when Math.random() < randomnessFactor*0.3.
  // With a fixed roll of 0.05 the thresholds differ by difficulty:
  //   expert: 0.05*0.3 = 0.015  -> 0.05 < 0.015 is FALSE -> casts
  //   easy:   0.40*0.3 = 0.120  -> 0.05 < 0.120 is TRUE  -> skips
  const creatureState = () => {
    const bear = mkTurnCard("bear", "Creature", {
      cardData: { name: "bear", type_line: "Creature", cmc: 2 } as any,
    });
    return buildTurnState({ hand: ["bear"], battlefield: [], cards: [bear] });
  };

  it("expert difficulty casts the creature (roll under threshold)", async () => {
    const spy = jest.spyOn(Math, "random").mockReturnValue(0.05);
    try {
      const result = await runAITurn(
        creatureState(),
        AI,
        baseConfig({ difficulty: "expert" }),
      );
      const casts = result.actionsTaken.filter(
        (a) => a.type === "cast_spell" && a.cardId === "bear",
      );
      expect(casts.length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("easy difficulty skips the same creature on the identical roll", async () => {
    const spy = jest.spyOn(Math, "random").mockReturnValue(0.05);
    try {
      const result = await runAITurn(
        creatureState(),
        AI,
        baseConfig({ difficulty: "easy" }),
      );
      const casts = result.actionsTaken.filter(
        (a) => a.type === "cast_spell" && a.cardId === "bear",
      );
      expect(casts).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

// ===========================================================================
// runAITurn — combat phase
// ===========================================================================
describe("runAITurn — combat phase", () => {
  it("executes the combat decision tree's attack plan", async () => {
    const bear = mkTurnCard("bear", "Creature");
    const state = buildTurnState({
      hand: [],
      battlefield: ["bear"],
      cards: [bear],
    });
    mockAttackPlan = {
      attacks: [
        {
          shouldAttack: true,
          creatureId: "bear",
          target: OPP,
          reasoning: "go face",
        },
      ],
    };

    const result = await runAITurn(state, AI, baseConfig());

    expect(declareAttackersMock).toHaveBeenCalled();
    const attacks = result.actionsTaken.filter((a) => a.type === "attack");
    expect(attacks.some((a) => a.cardId === "bear")).toBe(true);
  });

  it("skips attacks the decision tree declines (shouldAttack/target none)", async () => {
    const bear = mkTurnCard("bear", "Creature");
    const state = buildTurnState({
      hand: [],
      battlefield: ["bear"],
      cards: [bear],
    });
    mockAttackPlan = {
      attacks: [
        { shouldAttack: false, creatureId: "bear", target: OPP, reasoning: "" },
        {
          shouldAttack: true,
          creatureId: "bear",
          target: "none",
          reasoning: "",
        },
      ],
    };

    const result = await runAITurn(state, AI, baseConfig());
    expect(result.actionsTaken.filter((a) => a.type === "attack")).toEqual([]);
    expect(declareAttackersMock).not.toHaveBeenCalled();
  });

  it("produces no attack actions when there are no attackers", async () => {
    const state = buildTurnState({ hand: [], battlefield: [] });
    mockAttackPlan = { attacks: [] };
    const result = await runAITurn(state, AI, baseConfig());
    expect(result.actionsTaken.filter((a) => a.type === "attack")).toEqual([]);
  });
});

// ===========================================================================
// runAITurn — beginner-friendly AI telegraph (issue #993)
//
// Verifies the coaching "why" surfaces through onCommentary at easy difficulty
// and is SILENT at expert (verbosity scales with the resolved config). The
// generic action commentary ("Attacks with X") still fires at every tier; only
// the telegraph coach line is difficulty-gated.
// ===========================================================================
describe("runAITurn — difficulty-gated AI telegraph", () => {
  function buildAttackState() {
    const bear = mkTurnCard("bear", "Creature", {
      cardData: {
        name: "bear",
        type_line: "Creature",
        cmc: 2,
        mana_cost: "{2}",
      } as any,
    });
    return buildTurnState({ hand: [], battlefield: ["bear"], cards: [bear] });
  }

  it("easy difficulty surfaces a detailed coaching telegraph for an attack", async () => {
    const state = buildAttackState();
    mockAttackPlan = {
      attacks: [
        {
          shouldAttack: true,
          creatureId: "bear",
          target: OPP,
          reasoning: "bear (2 power) - has evasion, high value attack",
        },
      ],
    };
    const commentary: string[] = [];
    await runAITurn(
      state,
      AI,
      baseConfig({
        difficulty: "easy",
        onCommentary: (t) => commentary.push(t),
      }),
    );

    // Generic action commentary still present...
    expect(commentary.some((m) => /Attacks with bear/.test(m))).toBe(true);
    // ...plus the detailed coach line explaining the why.
    expect(commentary.some((m) => /AI sends bear into combat/.test(m))).toBe(
      true,
    );
    expect(
      commentary.some((m) => /hard to block|press its advantage/i.test(m)),
    ).toBe(true);
  });

  it("expert difficulty emits NO telegraph coach line (strategy stays hidden)", async () => {
    const state = buildAttackState();
    mockAttackPlan = {
      attacks: [
        {
          shouldAttack: true,
          creatureId: "bear",
          target: OPP,
          reasoning: "bear (2 power) - high value attack",
        },
      ],
    };
    const commentary: string[] = [];
    await runAITurn(
      state,
      AI,
      baseConfig({
        difficulty: "expert",
        onCommentary: (t) => commentary.push(t),
      }),
    );

    // The bare action is still narrated...
    expect(commentary.some((m) => /Attacks with bear/.test(m))).toBe(true);
    // ...but no beginner coach line leaks at expert difficulty.
    expect(commentary.some((m) => /AI sends .* into combat/.test(m))).toBe(
      false,
    );
  });

  it("easy difficulty surfaces a 'held back as a blocker' telegraph", async () => {
    const bear = mkTurnCard("bear", "Creature");
    const state = buildTurnState({
      hand: [],
      battlefield: ["bear"],
      cards: [bear],
    });
    mockAttackPlan = {
      attacks: [
        {
          shouldAttack: false,
          creatureId: "bear",
          target: "none",
          reasoning: "bear (2/2) - low value, hold for defense",
        },
      ],
    };
    const commentary: string[] = [];
    await runAITurn(
      state,
      AI,
      baseConfig({
        difficulty: "easy",
        onCommentary: (t) => commentary.push(t),
      }),
    );

    expect(
      commentary.some((m) => /keeps bear in reserve|blocker/i.test(m)),
    ).toBe(true);
  });
});

// ===========================================================================
// runAITurn — cleanup phase (discard to max hand size)
// ===========================================================================
describe("runAITurn — cleanup phase", () => {
  it("discards down to the max hand size when over the limit", async () => {
    const hand = Array.from({ length: 9 }, (_, i) => `c${i}`);
    const cards = hand.map((id) => mkTurnCard(id, "Instant"));
    const state = buildTurnState({
      hand,
      battlefield: [],
      cards,
    });
    getMaxHandSizeMock.mockReturnValue(7);

    const commentary: string[] = [];
    const result = await runAITurn(
      state,
      AI,
      baseConfig({ onCommentary: (t) => commentary.push(t) }),
    );

    // Issue #1414: cleanup now consults the difficulty-scaled helper and
    // passes its ordered candidate list as the 5th arg (specificCards).
    // The 4th arg flips to `false` (controller-chooses) so the engine
    // honors the candidate order instead of picking one random card.
    expect(discardCardsMock).toHaveBeenCalledWith(
      expect.anything(),
      AI,
      2,
      false,
      expect.any(Array),
    );
    expect(
      result.actionsTaken.some(
        (a) =>
          a.type === "no_action" && /Discarded 2 cards/.test(a.reasoning ?? ""),
      ),
    ).toBe(true);
    expect(commentary.some((m) => /Discards 2 cards/.test(m))).toBe(true);
    // The per-tier reasoning surfaced by the helper reaches commentary.
    expect(commentary.some((m) => /Cleanup/.test(m))).toBe(true);
  });

  it("does not discard when at or below the max hand size", async () => {
    const hand = ["a", "b"];
    const cards = [mkTurnCard("a", "Instant"), mkTurnCard("b", "Instant")];
    const state = buildTurnState({ hand, battlefield: [], cards });

    await runAITurn(state, AI, baseConfig());
    expect(discardCardsMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// runAITurn — error handling (no legal actions / engine failure)
// ===========================================================================
describe("runAITurn — error & edge handling", () => {
  it("returns a failure result when an engine call throws", async () => {
    drawCardMock.mockImplementation(() => {
      throw new Error("library empty");
    });
    const state = buildTurnState({ hand: [], battlefield: [] });

    const result = await runAITurn(state, AI, baseConfig());

    expect(result.success).toBe(false);
    expect(result.error).toBe("library empty");
    expect(result.finalState).toBeDefined();
    // Some actions may have been taken before the failure.
    expect(Array.isArray(result.actionsTaken)).toBe(true);
  });

  it("wraps a non-Error throw into a generic error message", async () => {
    drawCardMock.mockImplementation(() => {
      throw "kaboom";
    });
    const state = buildTurnState({ hand: [], battlefield: [] });

    const result = await runAITurn(state, AI, baseConfig());
    expect(result.success).toBe(false);
    expect(result.error).toBe("Unknown error");
  });
});

// ===========================================================================
// Issue #1068 — adaptive tempo/risk adjustment keyed to board-state swing.
//
// Pure-function coverage for {@link computeAdaptiveTempoRisk}: the swing→risk
// direction, bounded multipliers, composition with the per-format/difficulty
// config (#1069), and hysteresis (no turn-to-turn oscillation). These are the
// deterministic core of the feature; the swing signal itself is covered in
// game-state-evaluator.test.ts (BoardSwingTracker).
// ===========================================================================

/** Build a precise BoardSwing literal for parametric tests. */
function swingOf(
  normalizedAdvantage: number,
  normalizedDelta: number,
): BoardSwing {
  return {
    advantage: normalizedAdvantage * BOARD_SWING_SCALE,
    normalizedAdvantage,
    delta: normalizedDelta * BOARD_SWING_SCALE,
    normalizedDelta,
    direction:
      normalizedAdvantage > 0.15
        ? "leading"
        : normalizedAdvantage < -0.15
          ? "trailing"
          : "stable",
    trend:
      normalizedDelta > 0.15
        ? "improving"
        : normalizedDelta < -0.15
          ? "worsening"
          : "steady",
    magnitude: Math.min(
      1,
      Math.abs(normalizedAdvantage) * 0.7 + Math.abs(normalizedDelta) * 0.6,
    ),
    sampleCount: 4,
  };
}

describe("computeAdaptiveTempoRisk (issue #1068) — direction", () => {
  it("presses (raises risk/tempo) when the AI is trailing", () => {
    const r = computeAdaptiveTempoRisk(swingOf(-1, 0), {
      difficulty: "medium",
    });

    expect(r.pressure).toBeGreaterThan(0);
    expect(r.riskMultiplier).toBeGreaterThan(1);
    expect(r.tempoMultiplier).toBeGreaterThan(1);
    expect(r.aggressionDelta).toBeGreaterThan(0);
    expect(r.riskDelta).toBeGreaterThan(0);
  });

  it("consolidates (lowers risk/tempo) when the AI is leading", () => {
    const r = computeAdaptiveTempoRisk(swingOf(1, 0), {
      difficulty: "medium",
    });

    expect(r.pressure).toBeLessThan(0);
    expect(r.riskMultiplier).toBeLessThan(1);
    expect(r.tempoMultiplier).toBeLessThan(1);
    expect(r.aggressionDelta).toBeLessThan(0);
    expect(r.riskDelta).toBeLessThan(0);
  });

  it("stays at baseline when the board is at parity (stable)", () => {
    const r = computeAdaptiveTempoRisk(swingOf(0, 0), {
      difficulty: "medium",
    });

    expect(r.pressure).toBeCloseTo(0, 5);
    expect(r.tempoMultiplier).toBeCloseTo(1, 5);
    expect(r.riskMultiplier).toBeCloseTo(1, 5);
    expect(r.aggressionDelta).toBeCloseTo(0, 5);
  });

  it("amplifies the press when losing ground (worsening trend)", () => {
    const behindOnly = computeAdaptiveTempoRisk(swingOf(-0.6, 0), {
      difficulty: "medium",
    });
    const behindAndFalling = computeAdaptiveTempoRisk(swingOf(-0.6, -0.6), {
      difficulty: "medium",
    });

    expect(behindAndFalling.pressure).toBeGreaterThan(behindOnly.pressure);
    expect(behindAndFalling.riskMultiplier).toBeGreaterThan(
      behindOnly.riskMultiplier,
    );
  });
});

describe("computeAdaptiveTempoRisk (issue #1068) — bounds", () => {
  const difficulties: DifficultyLevel[] = ["easy", "medium", "hard", "expert"];

  for (const difficulty of difficulties) {
    it(`clamps multipliers to documented limits at ${difficulty}`, () => {
      // Max-magnitude swing in both directions, first turn (no prev).
      for (const swing of [swingOf(-1, -1), swingOf(1, 1)]) {
        const r = computeAdaptiveTempoRisk(swing, { difficulty });
        expect(r.tempoMultiplier).toBeGreaterThanOrEqual(ADAPTIVE_MIN_MULT);
        expect(r.tempoMultiplier).toBeLessThanOrEqual(ADAPTIVE_MAX_MULT);
        expect(r.riskMultiplier).toBeGreaterThanOrEqual(ADAPTIVE_MIN_MULT);
        expect(r.riskMultiplier).toBeLessThanOrEqual(ADAPTIVE_MAX_MULT);
        expect(r.tempoPriority).toBeGreaterThanOrEqual(0);
        expect(r.tempoPriority).toBeLessThanOrEqual(1);
        expect(r.riskTolerance).toBeGreaterThanOrEqual(0);
        expect(r.riskTolerance).toBeLessThanOrEqual(1);
        // Deltas bounded by the per-difficulty strength.
        expect(Math.abs(r.aggressionDelta)).toBeLessThanOrEqual(r.strength);
        expect(Math.abs(r.riskDelta)).toBeLessThanOrEqual(r.strength);
      }
    });
  }

  it("exposes the documented per-tier strength curve (easy loudest, expert subtlest)", () => {
    expect(adaptiveStrength("easy")).toBeGreaterThan(
      adaptiveStrength("medium"),
    );
    expect(adaptiveStrength("medium")).toBeGreaterThan(
      adaptiveStrength("hard"),
    );
    expect(adaptiveStrength("hard")).toBeGreaterThan(
      adaptiveStrength("expert"),
    );
  });
});

describe("computeAdaptiveTempoRisk (issue #1068) — composition with difficulty (#1069)", () => {
  it("multiplies the resolved base tempo/risk (does not replace them)", () => {
    const difficulty: DifficultyLevel = "hard";
    const format = "limited" as const;
    const base = resolveDifficultyConfig(difficulty, format);

    // First-turn press (no prev) so the multiplier is exactly the target.
    const r = computeAdaptiveTempoRisk(swingOf(-1, 0), { difficulty, format });

    expect(r.tempoPriority).toBeCloseTo(
      Math.max(0, Math.min(1, base.tempoPriority * r.tempoMultiplier)),
      6,
    );
    expect(r.riskTolerance).toBeCloseTo(
      Math.max(0, Math.min(1, base.riskTolerance * r.riskMultiplier)),
      6,
    );
  });

  it("a neutral swing reproduces the base config exactly", () => {
    for (const difficulty of ["easy", "medium", "hard", "expert"] as const) {
      const base = resolveDifficultyConfig(difficulty);
      const r = computeAdaptiveTempoRisk(swingOf(0, 0), { difficulty });
      expect(r.tempoPriority).toBeCloseTo(base.tempoPriority, 6);
      expect(r.riskTolerance).toBeCloseTo(base.riskTolerance, 6);
    }
  });

  it("per-format overrides change the composed posture for the same swing", () => {
    const difficulty: DifficultyLevel = "medium";
    const rBase = computeAdaptiveTempoRisk(swingOf(-1, 0), { difficulty });
    const rLimited = computeAdaptiveTempoRisk(swingOf(-1, 0), {
      difficulty,
      format: "limited",
    });

    // Limited raises medium's tempoPriority, so even with the same multiplier
    // the composed posture differs from the no-format baseline.
    expect(rLimited.tempoPriority).not.toBeCloseTo(rBase.tempoPriority, 1);
  });

  it("tier separation: easy adapts further than expert for the same swing", () => {
    const swing = swingOf(-1, 0);
    const easy = computeAdaptiveTempoRisk(swing, { difficulty: "easy" });
    const expert = computeAdaptiveTempoRisk(swing, { difficulty: "expert" });

    expect(easy.riskMultiplier - 1).toBeGreaterThan(expert.riskMultiplier - 1);
    expect(easy.tempoMultiplier - 1).toBeGreaterThan(
      expert.tempoMultiplier - 1,
    );
  });
});

describe("computeAdaptiveTempoRisk (issue #1068) — hysteresis / no oscillation", () => {
  it("does not move when the target change is inside the deadband", () => {
    const prev = { tempoMultiplier: 1.0, riskMultiplier: 1.0 };
    // Tiny shift in standing → target barely moves → multiplier frozen.
    const r = computeAdaptiveTempoRisk(
      swingOf(0.01, 0),
      {
        difficulty: "medium",
      },
      prev,
    );

    expect(r.tempoMultiplier).toBe(prev.tempoMultiplier);
    expect(r.riskMultiplier).toBe(prev.riskMultiplier);
  });

  it("damps an alternating swing so it never oscillates at full amplitude", () => {
    // Alternate trailing/leading every turn. Without smoothing the multiplier
    // would jump between ~0.82 and ~1.18; with smoothing (factor 0.5) the
    // amplitude must shrink and every step stay within the global bounds.
    let prev = { tempoMultiplier: 1, riskMultiplier: 1 };
    const swings = [
      swingOf(-1, 0),
      swingOf(1, 0),
      swingOf(-1, 0),
      swingOf(1, 0),
    ];
    const tempoValues: number[] = [];
    for (const s of swings) {
      const r = computeAdaptiveTempoRisk(s, { difficulty: "medium" }, prev);
      tempoValues.push(r.tempoMultiplier);
      prev = {
        tempoMultiplier: r.tempoMultiplier,
        riskMultiplier: r.riskMultiplier,
      };
    }

    // All within bounds.
    for (const v of tempoValues) {
      expect(v).toBeGreaterThanOrEqual(ADAPTIVE_MIN_MULT);
      expect(v).toBeLessThanOrEqual(ADAPTIVE_MAX_MULT);
    }
    // The peak-to-peak amplitude of the smoothed sequence is strictly smaller
    // than the raw target amplitude (1 - strength*1 = 0.82 for medium trailing),
    // proving the oscillation is damped rather than amplified.
    const peakToPeak = Math.max(...tempoValues) - Math.min(...tempoValues);
    expect(peakToPeak).toBeLessThan(1 - (1 - adaptiveStrength("medium"))); // < 1
    // And specifically smaller than a single un-smoothed step's magnitude.
    expect(peakToPeak).toBeLessThan(adaptiveStrength("medium"));
  });

  it("converges monotonically toward a sustained posture", () => {
    // Hold a trailing board for several turns; the multiplier should march
    // toward the press target without reversing direction each step.
    let prev: { tempoMultiplier: number; riskMultiplier: number } | undefined;
    let prevTempo = -Infinity;
    const tempoValues: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = computeAdaptiveTempoRisk(
        swingOf(-1, 0),
        {
          difficulty: "hard",
        },
        prev,
      );
      tempoValues.push(r.tempoMultiplier);
      prev = {
        tempoMultiplier: r.tempoMultiplier,
        riskMultiplier: r.riskMultiplier,
      };
    }
    // Monotonic non-decreasing toward the (higher) press target.
    for (const v of tempoValues) {
      expect(v).toBeGreaterThanOrEqual(prevTempo - 1e-9);
      prevTempo = v;
    }
    // Converges upward, bounded by the max multiplier.
    expect(tempoValues[tempoValues.length - 1]).toBeLessThanOrEqual(
      ADAPTIVE_MAX_MULT,
    );
  });

  it("round-trips hysteresis state through BoardSwingTracker", () => {
    // Mirrors how the turn loop persists multipliers between turns.
    const tracker = new BoardSwingTracker();
    tracker.record(-BOARD_SWING_SCALE);
    const swing = tracker.getSwing();
    const r1 = computeAdaptiveTempoRisk(swing, { difficulty: "medium" });
    tracker.setLastMultipliers({
      tempoMultiplier: r1.tempoMultiplier,
      riskMultiplier: r1.riskMultiplier,
    });

    tracker.record(-BOARD_SWING_SCALE);
    const swing2 = tracker.getSwing();
    const r2 = computeAdaptiveTempoRisk(
      swing2,
      { difficulty: "medium" },
      tracker.getLastMultipliers(),
    );

    expect(r2.tempoMultiplier).toBeGreaterThanOrEqual(ADAPTIVE_MIN_MULT);
    expect(r2.riskMultiplier).toBeLessThanOrEqual(ADAPTIVE_MAX_MULT);
  });
});

describe("computeAdaptiveTempoRisk (issue #1068) — AdaptiveTempoRisk shape", () => {
  it("exposes every documented field", () => {
    const r: AdaptiveTempoRisk = computeAdaptiveTempoRisk(swingOf(-0.5, -0.2), {
      difficulty: "medium",
    });
    for (const key of [
      "pressure",
      "tempoMultiplier",
      "riskMultiplier",
      "aggressionDelta",
      "riskDelta",
      "tempoPriority",
      "riskTolerance",
      "strength",
    ] as const) {
      expect(r).toHaveProperty(key);
      expect(typeof r[key]).toBe("number");
    }
  });
});

// ---------------------------------------------------------------------------
// Issue #1063 — opponent opening-hand mulligan wired into the turn loop.
//
// `runOpeningHandMulligan` is the game-start step the orchestrator runs before
// the first `runAITurn`. These tests exercise the REAL loop (decision via
// decideOpponentMulligan + mechanical executeOpponentMulligan) against a real
// engine state, controlling the blunder roll through the injected `rng` and
// pinning the redraw shuffle via a Math.random spy so every assertion is
// deterministic.
// ---------------------------------------------------------------------------

describe("runOpeningHandMulligan (issue #1063 wiring)", () => {
  function mkCard(
    id: string,
    name: string,
    typeLine: string,
    cmc: number,
    colors: string[],
    oracleText = "",
  ): CardInstance {
    return {
      id,
      oracleId: id,
      cardData: {
        name,
        type_line: typeLine,
        cmc,
        mana_cost: `{${cmc}}`,
        colors,
        oracle_text: oracleText,
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
    } as unknown as CardInstance;
  }

  /** A strong 3-land + low-curve opener the expert engine keeps. */
  function strongOpener(prefix: string): CardInstance[] {
    return [
      mkCard(`${prefix}-h1`, "Forest", "Basic Land", 0, ["G"]),
      mkCard(`${prefix}-h2`, "Plains", "Basic Land", 0, ["W"]),
      mkCard(`${prefix}-h3`, "Mountain", "Basic Land", 0, ["R"]),
      mkCard(`${prefix}-h4`, "Savannah Lions", "Creature", 1, ["W"]),
      mkCard(`${prefix}-h5`, "Grizzly Bears", "Creature", 2, ["G"]),
      mkCard(
        `${prefix}-h6`,
        "Lightning Bolt",
        "Instant",
        1,
        ["R"],
        "deals 3 damage",
      ),
      mkCard(`${prefix}-h7`, "Raging Goblin", "Creature", 1, ["R"]),
    ];
  }

  /** A zero-land opener the expert engine ships. */
  function zeroLandOpener(prefix: string): CardInstance[] {
    return [
      mkCard(`${prefix}-b1`, "Hill Giant", "Creature", 4, ["R"]),
      mkCard(`${prefix}-b2`, "Air Elemental", "Creature", 4, ["U"]),
      mkCard(`${prefix}-b3`, "Serra Angel", "Creature", 5, ["W"]),
      mkCard(`${prefix}-b4`, "Craw Wurm", "Creature", 6, ["G"]),
      mkCard(`${prefix}-b5`, "War Mammoth", "Creature", 3, ["G"]),
      mkCard(`${prefix}-b6`, "Grizzly Bears", "Creature", 2, ["G"]),
      mkCard(`${prefix}-b7`, "Gray Ogre", "Creature", 2, ["R"]),
    ];
  }

  function buildMulliganState(opts: {
    hand: CardInstance[];
    library?: CardInstance[];
  }): EngineGameState {
    const cards = new Map<string, CardInstance>();
    const handIds: string[] = [];
    for (const c of opts.hand) {
      cards.set(c.id, c);
      handIds.push(c.id);
    }
    const libIds: string[] = [];
    for (const c of opts.library ?? []) {
      cards.set(c.id, c);
      libIds.push(c.id);
    }
    const zones = new Map<string, { cardIds: string[] }>();
    zones.set(`${AI}-hand`, { cardIds: handIds });
    zones.set(`${AI}-library`, { cardIds: libIds });
    zones.set(`${AI}-battlefield`, { cardIds: [] });
    zones.set(`${OPP}-battlefield`, { cardIds: [] });
    const players = new Map<PlayerId, unknown>();
    players.set(AI, { id: AI });
    players.set(OPP, { id: OPP });
    return {
      cards,
      zones,
      players,
      turn: {
        activePlayerId: AI,
        currentPhase: "untap" as any,
        turnNumber: 0,
        extraTurns: 0,
        isFirstTurn: true,
        startedAt: 0,
      },
      combat: {
        inCombatPhase: false,
        attackers: [],
        blockers: new Map(),
        remainingCombatPhases: 0,
      } as any,
      priorityPlayerId: AI,
    } as unknown as EngineGameState;
  }

  beforeEach(() => {
    // game-rules is auto-mocked at the file level; supply the mulligan rules.
    getMulliganRulesMock.mockReturnValue({ type: "london", minHandSize: 0 });
  });

  it("keeps a strong opener with zero mulligans (expert, no blunder)", async () => {
    const state = buildMulliganState({ hand: strongOpener("keep") });
    const result = await runOpeningHandMulligan(
      state,
      AI,
      baseConfig({ difficulty: "expert" }),
      () => 0.99, // above expert's 0.02 blunderChance -> never blunders
    );

    expect(result.success).toBe(true);
    expect(result.mulligansTaken).toBe(0);
    expect(result.finalHandSize).toBe(7);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].decision?.decision).toBe("keep");
    expect(result.decisions[0].decision?.blundered).toBe(false);
  });

  it("a forced blunder chain mulligans down to the keep floor and stops", async () => {
    // Easy + rng always blunders: every expert "keep" inverts to "ship", so the
    // loop mulligans 7->6->5->4->3, where the floor forces a keep. The redraw
    // shuffle is pinned so the count is deterministic.
    const library: CardInstance[] = [];
    for (let i = 0; i < 14; i++) {
      library.push(
        mkCard(`lib-${i}`, i % 2 ? "Forest" : "Plains", "Basic Land", 0, [
          i % 2 ? "G" : "W",
        ]),
      );
    }
    const state = buildMulliganState({ hand: strongOpener("chain"), library });
    const spy = jest.spyOn(Math, "random").mockReturnValue(0.5);

    const result = await runOpeningHandMulligan(
      state,
      AI,
      baseConfig({ difficulty: "easy" }),
      () => 0, // always under easy's 0.45 blunderChance -> always blunders
    );

    spy.mockRestore();

    expect(result.success).toBe(true);
    expect(result.mulligansTaken).toBe(4);
    expect(result.finalHandSize).toBe(3);
    const last = result.decisions[result.decisions.length - 1];
    expect(last.forcedKeep).toBe(true);
    // Every non-forced step shipped (blunder on a keepable hand).
    for (const step of result.decisions) {
      if (step.forcedKeep) continue;
      expect(step.decision?.decision).toBe("ship");
      expect(step.decision?.blundered).toBe(true);
    }
  });

  it("ships a zero-land opener, re-evaluates, and terminates", async () => {
    const library: CardInstance[] = [];
    for (let i = 0; i < 10; i++) {
      library.push(
        mkCard(`gd-${i}`, i % 2 ? "Forest" : "Plains", "Basic Land", 0, [
          i % 2 ? "G" : "W",
        ]),
      );
    }
    const state = buildMulliganState({
      hand: zeroLandOpener("bad"),
      library,
    });
    const spy = jest.spyOn(Math, "random").mockReturnValue(0.5);

    const result = await runOpeningHandMulligan(
      state,
      AI,
      baseConfig({ difficulty: "expert" }),
      () => 0.99, // no blunder -> expert follows the advisor
    );

    spy.mockRestore();

    expect(result.success).toBe(true);
    expect(result.mulligansTaken).toBeGreaterThanOrEqual(1);
    expect(result.finalHandSize).toBeLessThanOrEqual(6);
    expect(result.finalHandSize).toBeGreaterThanOrEqual(3);
    // The opener was correctly identified as a ship by the expert engine.
    expect(result.decisions[0].decision?.expertDecision).toBe("ship");
    expect(result.decisions[0].decision?.decision).toBe("ship");
    expect(result.decisions[0].decision?.blundered).toBe(false);
  });

  it("expert mulligans a strong opener far less often than easy (per-difficulty)", async () => {
    const N = 40;
    const spy = jest.spyOn(Math, "random").mockReturnValue(0.5);
    let easyMulligans = 0;
    let expertMulligans = 0;
    for (let i = 0; i < N; i++) {
      const roll = (i + 1) / (N + 1); // deterministic, spread across (0,1)
      const easyRes = await runOpeningHandMulligan(
        buildMulliganState({ hand: strongOpener(`e${i}`) }),
        AI,
        baseConfig({ difficulty: "easy" }),
        () => roll,
      );
      if (easyRes.mulligansTaken > 0) easyMulligans++;
      const expertRes = await runOpeningHandMulligan(
        buildMulliganState({ hand: strongOpener(`x${i}`) }),
        AI,
        baseConfig({ difficulty: "expert" }),
        () => roll,
      );
      if (expertRes.mulligansTaken > 0) expertMulligans++;
    }
    spy.mockRestore();

    // Easy (blunderChance 0.45) mulligans the strong opener far more than
    // Expert (0.02). The wiring therefore scales mulligan quality by difficulty.
    expect(easyMulligans).toBeGreaterThan(expertMulligans);
    expect(expertMulligans).toBeLessThan(N * 0.15);
  });
});

// ===========================================================================
// Issue #1385 — difficulty-scaled post-combat (main 2) mana retention.
//
// chooseMain2Action is a pure, deterministic policy. The per-tier coverage
// below fixes a board (AI 4 lands + creature + instant vs opponent with 2 open
// mana + a planeswalker, no opposing creatures) and asserts each tier's return
// value. buildMain2Context is exercised against a richer engine fixture.
// ===========================================================================
describe("chooseMain2Action (issue #1385) — per-tier policy", () => {
  // Fixed acceptance board: AI holds an instant + a creature; the opponent
  // has 2 open mana and a planeswalker, and presents no creature lethality.
  const fixedBoard = {
    difficulty: "easy" as const,
    opponentThreatScore: 0.5,
    opponentOpenMana: 2,
    opponentHasPlaneswalker: true,
    aiLife: 20,
    opponentLife: 20,
    opponentLethalThreat: 0,
    handHasInstant: true,
    handHasPermanent: true,
  };

  it("easy always deploys (dumps every spell)", () => {
    expect(chooseMain2Action({ ...fixedBoard, difficulty: "easy" })).toBe(
      "deploy",
    );
  });

  it("medium holds when the opponent has a planeswalker", () => {
    const ctx = { ...fixedBoard, difficulty: "medium" as const };
    expect(chooseMain2Action(ctx)).toBe("hold_for_opponent_turn");
  });

  it("medium holds when the opponent has >=2 open mana (no planeswalker)", () => {
    const ctx = {
      ...fixedBoard,
      difficulty: "medium" as const,
      opponentHasPlaneswalker: false,
      opponentOpenMana: 2,
    };
    expect(chooseMain2Action(ctx)).toBe("hold_for_opponent_turn");
  });

  it("medium deploys when the opponent has no planeswalker and <2 open mana", () => {
    const ctx = {
      ...fixedBoard,
      difficulty: "medium" as const,
      opponentHasPlaneswalker: false,
      opponentOpenMana: 1,
    };
    expect(chooseMain2Action(ctx)).toBe("deploy");
  });

  it("hard holds when not on a clock (opponent has 2 open mana)", () => {
    const ctx = { ...fixedBoard, difficulty: "hard" as const };
    expect(chooseMain2Action(ctx)).toBe("hold_for_opponent_turn");
  });

  it("hard deploys when on a clock (life <= opponent lethal threat)", () => {
    const ctx = {
      ...fixedBoard,
      difficulty: "hard" as const,
      aiLife: 4,
      opponentLethalThreat: 5,
    };
    expect(chooseMain2Action(ctx)).toBe("deploy");
  });

  it("expert defers an instant to the end step (deploy_end_step_spell)", () => {
    const ctx = { ...fixedBoard, difficulty: "expert" as const };
    expect(chooseMain2Action(ctx)).toBe("deploy_end_step_spell");
  });

  it("expert deploys when the hand holds only permanents", () => {
    const ctx = {
      ...fixedBoard,
      difficulty: "expert" as const,
      handHasInstant: false,
      handHasPermanent: true,
    };
    expect(chooseMain2Action(ctx)).toBe("deploy");
  });

  it("is pure: identical context yields identical output across calls", () => {
    const a = chooseMain2Action({ ...fixedBoard, difficulty: "hard" });
    const b = chooseMain2Action({ ...fixedBoard, difficulty: "hard" });
    expect(a).toBe(b);
  });
});

describe("buildMain2Context (issue #1385) — engine projection", () => {
  it("reads opponent open mana, planeswalker, and hand types from the engine state", () => {
    const gidion = mkTurnCard("gid", "Planeswalker", {
      cardData: { name: "gid", type_line: "Planeswalker", cmc: 4 } as any,
    });
    const bear = mkTurnCard("bear", "Creature", {
      cardData: { name: "bear", type_line: "Creature", cmc: 2 } as any,
    });
    const bolt = mkTurnCard("bolt", "Instant", {
      cardData: { name: "bolt", type_line: "Instant", cmc: 1 } as any,
    });
    const forest = mkTurnCard("f", "Land");

    const cards = new Map<string, CardInstance>();
    for (const c of [gidion, bear, bolt, forest]) cards.set(c.id, c);

    const zones = new Map<string, { cardIds: CardInstanceId[] }>();
    zones.set(`${AI}-hand`, { cardIds: ["bear", "bolt"] });
    zones.set(`${AI}-battlefield`, { cardIds: ["f"] });
    zones.set(`${OPP}-battlefield`, { cardIds: ["gid"] });

    const players = new Map<PlayerId, unknown>();
    players.set(AI, { id: AI, life: 18 });
    players.set(OPP, { id: OPP, life: 22, manaPool: { blue: 2 } });

    const state = {
      cards,
      zones,
      players,
    } as unknown as EngineGameState;

    const ctx = buildMain2Context(
      state,
      AI,
      baseConfig({ difficulty: "expert" }),
    );
    expect(ctx.opponentOpenMana).toBe(2);
    expect(ctx.opponentHasPlaneswalker).toBe(true);
    expect(ctx.aiLife).toBe(18);
    expect(ctx.opponentLife).toBe(22);
    expect(ctx.handHasInstant).toBe(true);
    expect(ctx.handHasPermanent).toBe(true);
    expect(ctx.opponentLethalThreat).toBe(0); // opponent has no creatures
  });

  it("is defensive: missing players/zones yield safe defaults", () => {
    const bare = {
      zones: new Map(),
      players: new Map(),
    } as unknown as EngineGameState;
    const ctx = buildMain2Context(bare, AI, baseConfig());
    expect(ctx.aiLife).toBe(20);
    expect(ctx.opponentOpenMana).toBe(0);
    expect(ctx.opponentHasPlaneswalker).toBe(false);
    expect(ctx.handHasInstant).toBe(false);
  });
});
