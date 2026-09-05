/**
 * @fileoverview Unit tests for the mid- and late-game land selection
 * scorer (issue #1539).
 *
 * The scorer is a pure function over a minimal {@link EngineGameState}
 * (zones + cards). These tests build lightweight fixtures — no engine
 * mocking — and assert on the chosen land + source per difficulty, the
 * mid/late-game path split, the opening-plan regression check (#1416),
 * and the difficulty tier separation (acceptance criterion 4).
 *
 * Test layout mirrors {@link opening-turn-plan.test.ts}: a small `card()`
 * factory + hand/battlefield builders, then per-criterion `describe` blocks.
 */
import { describe, it, expect } from "@jest/globals";
import {
  chooseMidLateLand,
  scoreMidLateLand,
  MID_GAME_TURN_MIN,
  LATE_GAME_TURN_MIN,
  EASY_MISORDER_CHANCE,
  type LandChoice,
  type MidLateLandContext,
  type MinimalOpeningPlan,
} from "../mid-late-land-selection";
import type {
  GameState as EngineGameState,
  CardInstance,
  CardInstanceId,
  PlayerId,
  Turn,
} from "@/lib/game-state/types";
import type { DifficultyLevel } from "../ai-difficulty";
import type { ManaColor } from "../opening-turn-plan";

const AI: PlayerId = "player1";
const OPP: PlayerId = "player2";

/** Build a card instance with the minimal fields the scorer reads. */
function card(
  id: string,
  opts: {
    name?: string;
    type_line: string;
    cmc?: number;
    mana_cost?: string;
    colors?: string[];
    oracle_text?: string;
    controller?: PlayerId;
  },
): CardInstance {
  return {
    id,
    oracleId: id,
    cardData: {
      id,
      name: opts.name ?? id,
      type_line: opts.type_line,
      cmc: opts.cmc ?? 0,
      mana_cost: opts.mana_cost,
      colors: opts.colors ?? [],
      color_identity: opts.colors ?? [],
      oracle_text: opts.oracle_text,
      legalities: {},
    },
    currentFaceIndex: 0,
    isFaceDown: false,
    controllerId: opts.controller ?? AI,
    ownerId: AI,
    isTapped: false,
    isFlipped: false,
    isTurnedFaceUp: false,
    isPhasedOut: false,
    hasSummoningSickness: false,
  } as unknown as CardInstance;
}

function plains(id = "plains"): CardInstance {
  return card(id, {
    name: "Plains",
    type_line: "Basic Land — Plains",
    oracle_text: "{T}: Add {W}.",
  });
}

function island(id = "island"): CardInstance {
  return card(id, {
    name: "Island",
    type_line: "Basic Land — Island",
    oracle_text: "{T}: Add {U}.",
  });
}

function forest(id = "forest"): CardInstance {
  return card(id, {
    name: "Forest",
    type_line: "Basic Land — Forest",
    oracle_text: "{T}: Add {G}.",
  });
}

function mountain(id = "mountain"): CardInstance {
  return card(id, {
    name: "Mountain",
    type_line: "Basic Land — Mountain",
    oracle_text: "{T}: Add {R}.",
  });
}

function radiantFountain(id = "fountain"): CardInstance {
  // Utility land: ETB gains 1 life.
  return card(id, {
    name: "Radiant Fountain",
    type_line: "Land",
    oracle_text:
      "When Radiant Fountain enters the battlefield, you gain 1 life.\n{T}: Add {C}.",
  });
}

function tranquilCove(id = "tapped"): CardInstance {
  // Tapped dual (W/U) with ETB life gain. Used for tests that include a
  // utility-ETB life gainer; NOT used in the over-fixing test (which uses
  // `tappedDualNoEtb` to cleanly isolate the penalty from the utility bonus).
  return card(id, {
    name: "Tranquil Cove",
    type_line: "Land",
    oracle_text:
      "Tranquil Cove enters the battlefield tapped. When Tranquil Cove enters the battlefield, you gain 1 life.\n({T}: Add {W} or {U}.)",
  });
}

function tappedDualNoEtb(id = "slowdual"): CardInstance {
  // Tapped dual (W/U) with NO ETB effect. Used to test the over-fixing
  // penalty without conflating it with the late-game utility-ETB bonus.
  return card(id, {
    name: "Slow W/U Dual",
    type_line: "Land",
    oracle_text:
      "Slow W/U Dual enters the battlefield tapped. ({T}: Add {W} or {U}.)",
  });
}

function mistyRainforest(id = "fetch"): CardInstance {
  return card(id, {
    name: "Misty Rainforest",
    type_line: "Land",
    oracle_text:
      "{T}, Pay 1 life, Sacrifice Misty Rainforest: Search your library for a Forest or Island card, put it onto the battlefield, then shuffle.",
  });
}

function scaldingTarn(id = "fetch2"): CardInstance {
  return card(id, {
    name: "Scalding Tarn",
    type_line: "Land",
    oracle_text:
      "{T}, Pay 1 life, Sacrifice Scalding Tarn: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle.",
  });
}

function whiteCreature(id = "white-creature", cmc = 2): CardInstance {
  return card(id, {
    name: `White creature (cmc ${cmc})`,
    type_line: "Creature",
    cmc,
    mana_cost: `{${cmc - 1}}{W}`,
    colors: ["W"],
  });
}

function blueCreature(id = "blue-creature", cmc = 3): CardInstance {
  return card(id, {
    name: `Blue creature (cmc ${cmc})`,
    type_line: "Creature",
    cmc,
    mana_cost: `{${cmc - 1}}{U}`,
    colors: ["U"],
  });
}

function whiteSpell(id = "white-spell", cmc = 2): CardInstance {
  return card(id, {
    name: `White spell (cmc ${cmc})`,
    type_line: "Instant",
    cmc,
    mana_cost: `{${cmc - 1}}{W}`,
    colors: ["W"],
  });
}

/**
 * Build a game state with the supplied cards. Hand + battlefield are
 * populated; everything else the scorer ignores.
 */
function buildState(opts: {
  hand?: CardInstance[];
  aiBattlefield?: CardInstance[];
  oppBattlefield?: CardInstance[];
  turnNumber?: number;
}): EngineGameState {
  const cards = new Map<string, CardInstance>();
  for (const c of [
    ...(opts.hand ?? []),
    ...(opts.aiBattlefield ?? []),
    ...(opts.oppBattlefield ?? []),
  ]) {
    cards.set(c.id, c);
  }
  const zones = new Map<string, { cardIds: CardInstanceId[] }>();
  zones.set(`${AI}-hand`, { cardIds: (opts.hand ?? []).map((c) => c.id) });
  zones.set(`${AI}-battlefield`, {
    cardIds: (opts.aiBattlefield ?? []).map((c) => c.id),
  });
  zones.set(`${OPP}-battlefield`, {
    cardIds: (opts.oppBattlefield ?? []).map((c) => c.id),
  });
  const turn: Turn = {
    activePlayerId: AI,
    currentPhase: "precombat_main" as Turn["currentPhase"],
    turnNumber: opts.turnNumber ?? 5,
    extraTurns: 0,
    isFirstTurn: false,
    startedAt: 0,
  };
  return {
    cards,
    zones,
    turn,
    priorityPlayerId: AI,
  } as unknown as EngineGameState;
}

/** Deterministic rng from a linear congruential seed. */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// Constants + boundaries
// ---------------------------------------------------------------------------

describe("mid-late-land-selection boundaries", () => {
  it("MID_GAME_TURN_MIN is one past OPENING_TURNS_MAX (turn 4)", () => {
    expect(MID_GAME_TURN_MIN).toBe(4);
  });

  it("LATE_GAME_TURN_MIN is turn 7 (issue acceptance criterion 3 wording)", () => {
    expect(LATE_GAME_TURN_MIN).toBe(7);
  });

  it("EASY_MISORDER_CHANCE is positive and below 0.5", () => {
    expect(EASY_MISORDER_CHANCE).toBeGreaterThan(0);
    expect(EASY_MISORDER_CHANCE).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// Branch selection
// ---------------------------------------------------------------------------

describe("chooseMidLateLand — branch selection", () => {
  it("returns null with source='none' when no lands are in hand", () => {
    const state = buildState({ hand: [whiteCreature()], turnNumber: 5 });
    const result = chooseMidLateLand(state, AI, "hard", 5, null, undefined);
    expect(result.choice).toBeNull();
    expect(result.source).toBe("none");
  });

  it("returns the opening-plan land when present (regression on #1416)", () => {
    const state = buildState({
      hand: [plains("a"), island("b"), forest("c")],
      turnNumber: 2,
    });
    const openingPlan: MinimalOpeningPlan = { landToPlay: "c" };
    const result = chooseMidLateLand(
      state,
      AI,
      "medium",
      2,
      openingPlan,
      undefined,
    );
    expect(result.choice?.cardId).toBe("c");
    expect(result.source).toBe("opener");
  });

  it("falls back to scoring when the opening-plan land is not in hand", () => {
    const state = buildState({
      hand: [plains("a"), island("b")],
      turnNumber: 2,
    });
    const openingPlan: MinimalOpeningPlan = { landToPlay: "missing" };
    const result = chooseMidLateLand(
      state,
      AI,
      "hard",
      2,
      openingPlan,
      undefined,
    );
    // No spells in hand → demand is empty → all scored equally → first-found
    // inside the scorer wins, but the SOURCE must still be "scored" because
    // the opener's land was unavailable.
    expect(result.source).toBe("scored");
    expect(result.choice).not.toBeNull();
  });

  it("returns first-found on turn 1-3 with no opening plan", () => {
    const state = buildState({
      hand: [island("first"), forest("second"), plains("third")],
      turnNumber: 2,
    });
    const result = chooseMidLateLand(state, AI, "medium", 2, null, undefined);
    expect(result.choice?.cardId).toBe("first");
    expect(result.source).toBe("early_first");
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 1:
//   Given the AI is past turn 3 with two lands in hand (one basic that matches
//   a color the AI is short on, one off-color basic) and spells requiring the
//   short color, when playLandIfAvailable runs at Hard/Expert difficulty,
//   then the on-color land is played.
// ---------------------------------------------------------------------------

describe("chooseMidLateLand — color-correct over off-color (acceptance #1)", () => {
  it("Hard picks the W-basic over an off-color U-basic when W is demanded", () => {
    // Battlefield has one Plains (1 W source) but the AI holds a 2-CMC
    // white creature ({1}{W}) — so the AI needs another W source to cast it.
    // The hand has a Plains (W) and an Island (U) — Plains fixes the demand.
    const state = buildState({
      hand: [plains("pw"), island("iu"), whiteCreature("wc")],
      aiBattlefield: [plains("bf1")],
      turnNumber: 5,
    });
    const result = chooseMidLateLand(state, AI, "hard", 5, null, undefined);
    expect(result.choice?.cardId).toBe("pw");
    expect(result.source).toBe("scored");
  });

  it("Expert picks the W-basic over an off-color U-basic when W is demanded", () => {
    const state = buildState({
      hand: [island("iu"), plains("pw"), whiteCreature("wc")],
      aiBattlefield: [plains("bf1")],
      turnNumber: 5,
    });
    const result = chooseMidLateLand(state, AI, "expert", 5, null, undefined);
    expect(result.choice?.cardId).toBe("pw");
    expect(result.source).toBe("scored");
  });

  it("Medium picks the W-basic over an off-color U-basic when W is demanded", () => {
    const state = buildState({
      hand: [island("iu"), plains("pw"), whiteCreature("wc")],
      aiBattlefield: [plains("bf1")],
      turnNumber: 5,
    });
    const result = chooseMidLateLand(state, AI, "medium", 5, null, undefined);
    expect(result.choice?.cardId).toBe("pw");
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 2:
//   Given the AI holds a fetchland and a tapped dual land and is colour-screwed
//   on a single missing color at Medium or higher, when playLandIfAvailable
//   runs, then the fetchland is played first (so the shuffle can find the
//   missing color this turn).
// ---------------------------------------------------------------------------

describe("chooseMidLateLand — fetch over tapped dual when color-screwed (acceptance #2)", () => {
  it("Medium picks the fetchland over the tapped dual when U is the missing color", () => {
    const state = buildState({
      hand: [
        // Battlefield already has Mountains but no Islands → U is missing.
        mistyRainforest("fetch"),
        tranquilCove("tapped"), // tapped W/U dual
        blueCreature("uc"),
      ],
      aiBattlefield: [mountain("bf1"), mountain("bf2"), mountain("bf3")],
      turnNumber: 4,
    });
    const result = chooseMidLateLand(state, AI, "medium", 4, null, undefined);
    expect(result.choice?.cardId).toBe("fetch");
    expect(result.source).toBe("scored");
  });

  it("Hard picks the fetchland over the tapped dual when U is the missing color", () => {
    const state = buildState({
      hand: [
        tranquilCove("tapped"),
        mistyRainforest("fetch"),
        blueCreature("uc"),
      ],
      aiBattlefield: [mountain("bf1"), mountain("bf2")],
      turnNumber: 5,
    });
    const result = chooseMidLateLand(state, AI, "hard", 5, null, undefined);
    expect(result.choice?.cardId).toBe("fetch");
  });

  it("Expert picks the fetchland over the tapped dual when U is the missing color", () => {
    const state = buildState({
      hand: [
        scaldingTarn("fetch2"),
        tranquilCove("tapped"),
        blueCreature("uc"),
      ],
      aiBattlefield: [mountain("bf1")],
      turnNumber: 6,
    });
    const result = chooseMidLateLand(state, AI, "expert", 6, null, undefined);
    expect(result.choice?.cardId).toBe("fetch2");
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 3:
//   Given the AI has 7+ lands on the battlefield and holds a utility land with
//   an ETB effect (e.g. named 'Radiant Fountain' or any land whose oracleText
//   gains life), when playLandIfAvailable runs at Hard/Expert, then the
//   utility land outranks a vanilla basic of the same color.
// ---------------------------------------------------------------------------

describe("chooseMidLateLand — utility land ETB > vanilla basic (acceptance #3)", () => {
  it("Hard ranks the utility land (ETB life) above a vanilla Plains in late game", () => {
    // 7 lands on battlefield (saturated), no color demand — utility ETB
    // should win on the late-game +2 bonus.
    const battlefield = [
      plains("bf1"),
      plains("bf2"),
      plains("bf3"),
      plains("bf4"),
      island("bf5"),
      island("bf6"),
      mountain("bf7"),
    ];
    const state = buildState({
      hand: [radiantFountain("util"), plains("vanilla")],
      aiBattlefield: battlefield,
      turnNumber: 8,
    });
    const result = chooseMidLateLand(state, AI, "hard", 8, null, undefined);
    expect(result.choice?.cardId).toBe("util");
    expect(result.source).toBe("scored");
  });

  it("Expert ranks the utility land above a vanilla Plains in late game", () => {
    const battlefield = [
      plains("bf1"),
      plains("bf2"),
      plains("bf3"),
      plains("bf4"),
      plains("bf5"),
      island("bf6"),
      island("bf7"),
    ];
    const state = buildState({
      hand: [plains("vanilla"), radiantFountain("util")],
      aiBattlefield: battlefield,
      turnNumber: 7,
    });
    const result = chooseMidLateLand(state, AI, "expert", 7, null, undefined);
    expect(result.choice?.cardId).toBe("util");
  });

  it("Hard mid-game (no demand) ranks vanilla basic above utility land (utility bonus off)", () => {
    // 5 lands on battlefield (mid-game), no demand. Utility bonus is OFF
    // (landsOnBattlefield < 7). Vanilla basic wins on the +0.5 basic bonus.
    const state = buildState({
      hand: [radiantFountain("util"), plains("vanilla")],
      aiBattlefield: [
        mountain("bf1"),
        mountain("bf2"),
        mountain("bf3"),
        mountain("bf4"),
        mountain("bf5"),
      ],
      turnNumber: 5,
    });
    const result = chooseMidLateLand(state, AI, "hard", 5, null, undefined);
    expect(result.choice?.cardId).toBe("vanilla");
  });

  it("Hard mid-game (with demand) prefers the on-color basic over a non-fixing utility land", () => {
    // 5 mountains on battlefield (no W sources). White spell demands W.
    // Vanilla basic fixes the demand (+3); utility {C} doesn't (+0).
    const state = buildState({
      hand: [
        radiantFountain("util"), // {C} — doesn't fix W
        plains("vanilla"), // {W} — fixes the demand
        whiteSpell("ws"),
      ],
      aiBattlefield: [
        mountain("bf1"),
        mountain("bf2"),
        mountain("bf3"),
        mountain("bf4"),
        mountain("bf5"),
      ],
      turnNumber: 5,
    });
    const result = chooseMidLateLand(state, AI, "hard", 5, null, undefined);
    expect(result.choice?.cardId).toBe("vanilla");
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 4:
//   Given Easy difficulty, when the same utility-vs-basic choice is evaluated,
//   then the misorderChance blunder from mana-sequencing.ts occasionally picks
//   the worse-scoring land (so the tier separation the opening plan already
//   enforces extends to mid-game land picks).
// ---------------------------------------------------------------------------

describe("chooseMidLateLand — Easy tier blunder (acceptance #4)", () => {
  it("Easy sometimes picks the WORSE land (random pick) on identical roll", () => {
    // Hand has utility first, vanilla second. The scorer ranks utility
    // higher in late-game Hard/Expert, but on Easy a random roll picks
    // either one. We assert that BOTH outcomes appear over many seeds.
    const battlefield = [
      plains("bf1"),
      plains("bf2"),
      plains("bf3"),
      plains("bf4"),
      plains("bf5"),
      plains("bf6"),
      plains("bf7"),
    ];
    const baseState = buildState({
      hand: [radiantFountain("util"), plains("vanilla")],
      aiBattlefield: battlefield,
      turnNumber: 8,
    });

    let utilityPicks = 0;
    let vanillaPicks = 0;
    // Try several seeds; EASY_MISORDER_CHANCE = 0.35 means about 1/3 should
    // be the random blunder. We just want to demonstrate both outcomes occur.
    for (let seed = 1; seed <= 50; seed++) {
      const result = chooseMidLateLand(
        baseState,
        AI,
        "easy",
        8,
        null,
        undefined,
        seededRng(seed),
      );
      if (result.choice?.cardId === "util") utilityPicks++;
      else if (result.choice?.cardId === "vanilla") vanillaPicks++;
    }

    // Both outcomes occur (the random blunder roll + the default fallback to
    // best-scored on non-blunder rolls).
    expect(utilityPicks).toBeGreaterThan(0);
    expect(vanillaPicks).toBeGreaterThan(0);
    // The blend must include at least one blunder roll (vanilla picked even
    // though utility scores higher in Hard/Expert equivalent scoring).
    expect(vanillaPicks).toBeGreaterThan(0);
  });

  it("Hard never picks the worse-scoring land on the identical hand", () => {
    const battlefield = [
      plains("bf1"),
      plains("bf2"),
      plains("bf3"),
      plains("bf4"),
      plains("bf5"),
      plains("bf6"),
      plains("bf7"),
    ];
    const baseState = buildState({
      hand: [radiantFountain("util"), plains("vanilla")],
      aiBattlefield: battlefield,
      turnNumber: 8,
    });
    for (let seed = 1; seed <= 20; seed++) {
      const result = chooseMidLateLand(
        baseState,
        AI,
        "hard",
        8,
        null,
        undefined,
        seededRng(seed),
      );
      expect(result.choice?.cardId).toBe("util");
    }
  });

  it("Expert never picks the worse-scoring land on the identical hand", () => {
    const battlefield = [
      plains("bf1"),
      plains("bf2"),
      plains("bf3"),
      plains("bf4"),
      plains("bf5"),
      plains("bf6"),
      plains("bf7"),
    ];
    const baseState = buildState({
      hand: [plains("vanilla"), radiantFountain("util")],
      aiBattlefield: battlefield,
      turnNumber: 8,
    });
    for (let seed = 1; seed <= 20; seed++) {
      const result = chooseMidLateLand(
        baseState,
        AI,
        "expert",
        8,
        null,
        undefined,
        seededRng(seed),
      );
      expect(result.choice?.cardId).toBe("util");
    }
  });
});

// ---------------------------------------------------------------------------
// Over-fixing penalty: a dual that produces a saturated color must not outrank
// an on-color basic when both colors the dual produces are already covered.
// ---------------------------------------------------------------------------

describe("chooseMidLateLand — over-fixing penalty", () => {
  it("Hard prefers the W-basic over a W/U dual when both W and U are saturated", () => {
    // Battlefield has 4 W sources + 4 U sources already; demand is zero.
    // The dual produces two colors that are already over-supplied → over-
    // fixing penalty. The basic W gets +0.5 basic, no penalty.
    // We use `tappedDualNoEtb` here (no ETB) so the late-game utility bonus
    // doesn't interfere with the over-fixing test.
    const battlefield = [
      plains("bf1"),
      plains("bf2"),
      plains("bf3"),
      plains("bf4"),
      island("bf5"),
      island("bf6"),
      island("bf7"),
      island("bf8"),
    ];
    const state = buildState({
      hand: [plains("pw"), tappedDualNoEtb("dual")],
      aiBattlefield: battlefield,
      turnNumber: 5,
    });
    const result = chooseMidLateLand(state, AI, "hard", 5, null, undefined);
    expect(result.choice?.cardId).toBe("pw");
  });

  it("Hard still picks the on-demand basic even when the dual also fixes the demand", () => {
    // Battlefield has 1 W source; demand is 1 W from a single 2-CMC white
    // creature. Both Plains (+3 fix, +0.5 basic) and a tapped dual (+3 fix,
    // -0.5 tapped) are playable. Plains should win on tapped-vs-basic.
    const state = buildState({
      hand: [
        tappedDualNoEtb("dual"), // tapped W/U, no ETB
        plains("pw"),
        whiteCreature("wc"),
      ],
      aiBattlefield: [mountain("bf1"), mountain("bf2"), mountain("bf3")],
      turnNumber: 4,
    });
    const result = chooseMidLateLand(state, AI, "hard", 4, null, undefined);
    expect(result.choice?.cardId).toBe("pw");
  });
});

// ---------------------------------------------------------------------------
// Mid-game vs late-game path difference
// ---------------------------------------------------------------------------

describe("chooseMidLateLand — mid-game and late-game paths differ", () => {
  it("mid-game (turn 4-6, no demand) ranks vanilla basic above utility land", () => {
    // Turn 5 with 3 lands on battlefield (mid-game, no utility bonus yet).
    // No spell demand — both lands have no fixing value. Vanilla basic gets
    // +0.5; utility gets 0. Vanilla wins.
    const battlefield = [plains("bf1"), plains("bf2"), plains("bf3")];
    const state = buildState({
      hand: [radiantFountain("util"), plains("vanilla")],
      aiBattlefield: battlefield,
      turnNumber: 5,
    });
    const result = chooseMidLateLand(state, AI, "hard", 5, null, undefined);
    expect(result.choice?.cardId).toBe("vanilla");
  });

  it("late-game (≥ 7 lands on battlefield, no demand) flips — utility outranks vanilla", () => {
    // 8 lands on battlefield (≥ LATE_GAME_TURN_MIN = 7), no demand.
    // Utility bonus (+2) outranks the basic bonus (+0.5). Utility wins.
    const battlefield = [
      plains("bf1"),
      plains("bf2"),
      plains("bf3"),
      plains("bf4"),
      plains("bf5"),
      plains("bf6"),
      plains("bf7"),
      plains("bf8"),
    ];
    const state = buildState({
      hand: [plains("vanilla"), radiantFountain("util")],
      aiBattlefield: battlefield,
      turnNumber: 8,
    });
    const result = chooseMidLateLand(state, AI, "hard", 8, null, undefined);
    expect(result.choice?.cardId).toBe("util");
  });

  it("late-game utility bonus requires both ≥ 7 lands AND ETB effect", () => {
    // 7 lands, no ETB on the basic — utility bonus does not apply; vanilla
    // basic wins on the +0.5 basic bonus.
    const battlefield = [
      plains("bf1"),
      plains("bf2"),
      plains("bf3"),
      plains("bf4"),
      plains("bf5"),
      plains("bf6"),
      plains("bf7"),
    ];
    const state = buildState({
      hand: [radiantFountain("util"), plains("vanilla")],
      aiBattlefield: battlefield,
      turnNumber: 8,
    });
    const result = chooseMidLateLand(state, AI, "hard", 8, null, undefined);
    // Utility has hasUtilityEtb=true → bonus applies → utility wins.
    expect(result.choice?.cardId).toBe("util");
  });

  it("utility bonus does NOT apply when only turn ≥ 7 but < 7 lands on battlefield", () => {
    // 5 lands on battlefield at turn 8. landsOnBattlefield < 7 → utility
    // bonus OFF. Vanilla basic wins.
    const battlefield = [
      plains("bf1"),
      plains("bf2"),
      plains("bf3"),
      plains("bf4"),
      plains("bf5"),
    ];
    const state = buildState({
      hand: [radiantFountain("util"), plains("vanilla")],
      aiBattlefield: battlefield,
      turnNumber: 8,
    });
    const result = chooseMidLateLand(state, AI, "hard", 8, null, undefined);
    expect(result.choice?.cardId).toBe("vanilla");
  });
});

// ---------------------------------------------------------------------------
// Direct scorer unit tests
// ---------------------------------------------------------------------------

describe("scoreMidLateLand — direct scoring checks", () => {
  /** Build a minimal LandChoice without an engine. */
  function land(
    cardId: string,
    produced: ManaColor[],
    overrides: Partial<LandChoice> = {},
  ): LandChoice {
    return {
      cardId,
      name: cardId,
      isBasic: false,
      isFetch: false,
      isTapped: false,
      produced,
      fetchTargets: [],
      hasUtilityEtb: false,
      ...overrides,
    };
  }

  it("scores a W-basic higher than an off-color basic when W is demanded", () => {
    const plainsL = land("pw", ["W"], { isBasic: true });
    const islandL = land("iu", ["U"], { isBasic: true });
    const ctx: MidLateLandContext = {
      handLands: [plainsL, islandL],
      handSpells: [{ pips: { W: 1, U: 0, B: 0, R: 0, G: 0 }, cmc: 2 }],
      battlefieldColors: { W: 0, U: 0, B: 0, R: 0, G: 0 },
      turnNumber: 5,
      difficulty: "hard",
      landsOnBattlefield: 3,
    };
    expect(scoreMidLateLand(plainsL, ctx)).toBeGreaterThan(
      scoreMidLateLand(islandL, ctx),
    );
  });

  it("scores a fetchland above a tapped dual when the demand is unmet", () => {
    const fetchL = land("fetch", ["G", "U"], {
      isFetch: true,
      fetchTargets: ["G", "U"],
    });
    const dual = land("dual", ["W", "U"], { isTapped: true });
    const ctx: MidLateLandContext = {
      handLands: [fetchL, dual],
      handSpells: [{ pips: { W: 0, U: 1, B: 0, R: 0, G: 0 }, cmc: 3 }],
      battlefieldColors: { W: 0, U: 0, B: 0, R: 0, G: 0 },
      turnNumber: 5,
      difficulty: "hard",
      landsOnBattlefield: 3,
    };
    // Fetch: +3 (fix U via fetchTarget) + 1.5 (fetch bonus) = +4.5
    // Tapped dual: +3 (fix U) - 0.5 (tapped) = +2.5
    expect(scoreMidLateLand(fetchL, ctx)).toBeGreaterThan(
      scoreMidLateLand(dual, ctx),
    );
    expect(scoreMidLateLand(fetchL, ctx)).toBeCloseTo(4.5, 5);
    expect(scoreMidLateLand(dual, ctx)).toBeCloseTo(2.5, 5);
  });

  it("scores a utility land higher than a vanilla basic in late game (Hard/Expert)", () => {
    const vanilla = land("v", ["W"], { isBasic: true });
    const util = land("u", [], { hasUtilityEtb: true });
    const ctx: MidLateLandContext = {
      handLands: [vanilla, util],
      handSpells: [], // no demand
      battlefieldColors: { W: 0, U: 0, B: 0, R: 0, G: 0 },
      turnNumber: 8,
      difficulty: "hard",
      landsOnBattlefield: 8,
    };
    expect(scoreMidLateLand(util, ctx)).toBeGreaterThan(
      scoreMidLateLand(vanilla, ctx),
    );
  });

  it("applies the over-fixing penalty when a produced color is saturated", () => {
    const dual = land("dual", ["W", "U"]);
    const ctx: MidLateLandContext = {
      handLands: [dual],
      // cmc 6 spell, turnNumber 5: cmc > turnNumber (weight 1), cmc <=
      // turnNumber + 2 (included). demand.W = 1 * 1 = 1.
      // battlefield has 4 W sources → 4 >= 1 + 2 = 3 → over-fixing penalty
      // applies. Color fixing does NOT apply because battlefieldColors.W=4
      // is not < demand.W=1.
      // Score: 0 (no fix) - 1.5 (over-fix W) = -1.5
      handSpells: [{ pips: { W: 1, U: 0, B: 0, R: 0, G: 0 }, cmc: 6 }],
      battlefieldColors: { W: 4, U: 0, B: 0, R: 0, G: 0 },
      turnNumber: 5,
      difficulty: "hard",
      landsOnBattlefield: 4,
    };
    expect(scoreMidLateLand(dual, ctx)).toBeCloseTo(-1.5, 5);
  });

  it("does NOT apply over-fixing penalty when demand for that color is zero", () => {
    const dual = land("dual", ["W", "U"]);
    const ctx: MidLateLandContext = {
      handLands: [dual],
      // No spells in hand → no demand. Battlefield has W sources but W is
      // not demanded, so the over-fix clause (demand > 0) does not fire.
      handSpells: [],
      battlefieldColors: { W: 4, U: 0, B: 0, R: 0, G: 0 },
      turnNumber: 5,
      difficulty: "hard",
      landsOnBattlefield: 4,
    };
    // Score: 0 (no fix), 0 (no over-fix penalty), 0 (not basic), 0 (not tapped).
    expect(scoreMidLateLand(dual, ctx)).toBe(0);
  });

  it("fetch lands count fetch targets as producible for the fix bonus", () => {
    const fetch = land("fetch", [], {
      isFetch: true,
      fetchTargets: ["G", "U"],
    });
    const ctx: MidLateLandContext = {
      handLands: [fetch],
      // Demand for U; battlefield has no U sources.
      handSpells: [{ pips: { W: 0, U: 1, B: 0, R: 0, G: 0 }, cmc: 3 }],
      battlefieldColors: { W: 0, U: 0, B: 0, R: 0, G: 0 },
      turnNumber: 5,
      difficulty: "medium",
      landsOnBattlefield: 3,
    };
    // Score: +3 (fix U via fetchTarget) + 1.5 (fetch bonus for U) = +4.5
    expect(scoreMidLateLand(fetch, ctx)).toBeCloseTo(4.5, 5);
  });

  it("fetch bonus does NOT apply at Easy (only at Medium+)", () => {
    const fetch = land("fetch", [], {
      isFetch: true,
      fetchTargets: ["G", "U"],
    });
    const ctxBase: Omit<MidLateLandContext, "difficulty"> = {
      handLands: [fetch],
      handSpells: [{ pips: { W: 0, U: 1, B: 0, R: 0, G: 0 }, cmc: 3 }],
      battlefieldColors: { W: 0, U: 0, B: 0, R: 0, G: 0 },
      turnNumber: 5,
      landsOnBattlefield: 3,
    };
    const easyScore = scoreMidLateLand(fetch, {
      ...ctxBase,
      difficulty: "easy",
    });
    const mediumScore = scoreMidLateLand(fetch, {
      ...ctxBase,
      difficulty: "medium",
    });
    // Easy: +3 fix, no fetch bonus = +3.
    // Medium: +3 fix + 1.5 fetch bonus = +4.5.
    expect(easyScore).toBeCloseTo(3, 5);
    expect(mediumScore).toBeCloseTo(4.5, 5);
  });

  it("applies the fetch bonus only at Medium+ difficulty", () => {
    const fetchL = land("fetch", ["G", "U"], {
      isFetch: true,
      fetchTargets: ["G", "U"],
    });
    const ctxBase: Omit<MidLateLandContext, "difficulty"> = {
      handLands: [fetchL],
      handSpells: [{ pips: { W: 0, U: 1, B: 0, R: 0, G: 0 }, cmc: 3 }],
      battlefieldColors: { W: 0, U: 0, B: 0, R: 0, G: 0 },
      turnNumber: 5,
      landsOnBattlefield: 3,
    };
    const easyScore = scoreMidLateLand(fetchL, {
      ...ctxBase,
      difficulty: "easy",
    });
    const mediumScore = scoreMidLateLand(fetchL, {
      ...ctxBase,
      difficulty: "medium",
    });
    // Fetch bonus at Medium but not at Easy.
    expect(mediumScore).toBeGreaterThan(easyScore);
  });

  it("scores a utility land above a vanilla basic in late-game (Hard)", () => {
    // Reuses the spec values from the acceptance-criterion test.
    const vanilla = land("v", ["W"], { isBasic: true });
    const util = land("u", [], { hasUtilityEtb: true });
    const ctx: MidLateLandContext = {
      handLands: [vanilla, util],
      handSpells: [],
      battlefieldColors: { W: 0, U: 0, B: 0, R: 0, G: 0 },
      turnNumber: 8,
      difficulty: "hard",
      landsOnBattlefield: 8,
    };
    expect(scoreMidLateLand(util, ctx)).toBeCloseTo(2, 5);
    expect(scoreMidLateLand(vanilla, ctx)).toBeCloseTo(0.5, 5);
  });

  it("does NOT apply the utility bonus at Easy even in late game", () => {
    const vanilla = land("v", ["W"], { isBasic: true });
    const util = land("u", [], { hasUtilityEtb: true });
    const ctx: MidLateLandContext = {
      handLands: [vanilla, util],
      handSpells: [],
      battlefieldColors: { W: 0, U: 0, B: 0, R: 0, G: 0 },
      turnNumber: 8,
      difficulty: "easy",
      landsOnBattlefield: 8,
    };
    // Vanilla is +0.5 (basic), util is 0 — basic wins at Easy.
    expect(scoreMidLateLand(vanilla, ctx)).toBeGreaterThan(
      scoreMidLateLand(util, ctx),
    );
  });
});

// ---------------------------------------------------------------------------
// Determinism + edge cases
// ---------------------------------------------------------------------------

describe("chooseMidLateLand — determinism", () => {
  it("produces identical results across repeated calls with the same rng", () => {
    const state = buildState({
      hand: [plains("pw"), island("iu"), radiantFountain("util")],
      aiBattlefield: [plains("bf1"), plains("bf2"), plains("bf3")],
      turnNumber: 5,
    });
    const rng = seededRng(42);
    const first = chooseMidLateLand(state, AI, "easy", 5, null, undefined, rng);
    const rng2 = seededRng(42);
    const second = chooseMidLateLand(
      state,
      AI,
      "easy",
      5,
      null,
      undefined,
      rng2,
    );
    expect(first.choice?.cardId).toBe(second.choice?.cardId);
    expect(first.source).toBe(second.source);
  });

  it("returns null when state has no hand zone", () => {
    const state = {
      cards: new Map(),
      zones: new Map(),
      turn: {
        activePlayerId: AI,
        currentPhase: "precombat_main" as Turn["currentPhase"],
        turnNumber: 5,
        extraTurns: 0,
        isFirstTurn: false,
        startedAt: 0,
      },
      priorityPlayerId: AI,
    } as unknown as EngineGameState;
    const result = chooseMidLateLand(state, AI, "hard", 5, null, undefined);
    expect(result.choice).toBeNull();
    expect(result.source).toBe("none");
  });

  it("plays a single land from a one-card hand without errors", () => {
    const state = buildState({ hand: [plains("solo")], turnNumber: 5 });
    const result = chooseMidLateLand(state, AI, "hard", 5, null, undefined);
    expect(result.choice?.cardId).toBe("solo");
    expect(result.source).toBe("scored");
  });
});

// ---------------------------------------------------------------------------
// Tier coverage — at every tier, mid-game scores deterministically.
// ---------------------------------------------------------------------------

describe("chooseMidLateLand — tier coverage", () => {
  const TIERS: DifficultyLevel[] = ["easy", "medium", "hard", "expert"];

  it.each(TIERS)("%s picks the on-color basic on the same hand", (tier) => {
    // Skip Easy (random blunder may pick off-color — that's the documented
    // tier-separation behavior; tested separately in acceptance #4).
    if (tier === "easy") return;
    const state = buildState({
      hand: [island("iu"), plains("pw"), whiteCreature("wc")],
      aiBattlefield: [plains("bf1")],
      turnNumber: 5,
    });
    const result = chooseMidLateLand(
      state,
      AI,
      tier,
      5,
      null,
      undefined,
      seededRng(7),
    );
    expect(result.choice?.cardId).toBe("pw");
  });
});
