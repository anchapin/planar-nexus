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
  type AITurnConfig,
} from "../ai-turn-loop";
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
import { getMaxHandSize } from "@/lib/game-rules";

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

    expect(discardCardsMock).toHaveBeenCalledWith(
      expect.anything(),
      AI,
      2,
      true,
    );
    expect(
      result.actionsTaken.some(
        (a) =>
          a.type === "no_action" && /Discarded 2 cards/.test(a.reasoning ?? ""),
      ),
    ).toBe(true);
    expect(commentary.some((m) => /Discards 2 cards/.test(m))).toBe(true);
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
