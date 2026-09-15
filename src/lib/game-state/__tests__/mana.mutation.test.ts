/**
 * Mutation-targeted edge cases for `mana.ts`.
 *
 * Issue #1717: Stryker mutation suite for the mana module (CR 106 mana
 * pools / CR 305 lands), added as the 7th allowlisted module. The module's
 * baseline is not yet recorded; these tests pin down the mana-batch
 * arithmetic and boundary-condition mutants the untargeted suite leaves
 * alive:
 *
 *  - `canAffordMana` had NO tests at all: per-color `<` boundaries
 *    (exact-equal pool passes, one-short fails), colorless-is-specific
 *    (colored mana cannot pay a {C} pip), and the
 *    `availableForGeneric = generic + (totalColored − neededColored) +
 *    (colorless − needed colorless)` arithmetic — leftover colored mana
 *    counts toward generic, but colored mana reserved for colored pips
 *    does NOT.
 *  - `spendMana` generic-payment cascade (generic pool → colorless →
 *    colored in W/U/B/R/G order): exact final pools pin each step's
 *    `Math.min` / `−=` arithmetic and the fixed color order
 *    (`{W}{U}` pool pays {1} from the white first).
 *  - `canPlayLand` phase arms: POSTCOMBAT_MAIN is a main phase too, and
 *    `landsPlayed === maxLands` is the exact boundary.
 *  - `playLand` enters-tapped logic: the second `||` arm ("enters the
 *    battlefield tapped"), and the `entersTappedOverride !== undefined`
 *    check in BOTH directions (override forces tapped / untapped).
 *  - `parseManaAbility`: generic `{2}` symbols, multi-ability oracle
 *    text, conditional abilities ("Activate only if…" — extracted only
 *    when the condition is the trailing clause), and the "any one color"
 *    fallback arm.
 *  - `activateManaAbility`: the option-return path (multi-option land
 *    with no choice must NOT tap or add mana), activation-condition
 *    filtering (untapped lands only, `chosenBasicLandType` counts), the
 *    chosen-option condition re-validation, and the
 *    `hasActivatedManaAbility` flag.
 *  - `formatManaPool` zero-suppression: a 0-count color must not render
 *    (the `>` per-color guards), and `hasMana(empty) === false`.
 */

import {
  activateManaAbility,
  addLandPlay,
  addMana,
  canAffordMana,
  canPlayLand,
  createEmptyManaPool,
  formatManaPool,
  getSpellManaCost,
  getTotalMana,
  hasMana,
  parseManaAbility,
  playLand,
  resetLandPlays,
  setMaxLandsPerTurn,
  spendMana,
} from "../mana";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  ManaPool,
  PlayerId,
  ScryfallCard,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let cardCounter = 0;
function uniqueId(prefix: string): string {
  cardCounter += 1;
  return `${prefix}-${cardCounter}`;
}

function landCard(
  name: string,
  typeLine: string,
  oracleText: string,
): ScryfallCard {
  return {
    id: uniqueId(`card-${name.toLowerCase().replace(/\s+/g, "-")}`),
    name,
    type_line: typeLine,
    keywords: [],
    oracle_text: oracleText,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

function makeGame(): { state: GameState; aliceId: PlayerId; bobId: PlayerId } {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const ids = Array.from(state.players.keys());
  return { state, aliceId: ids[0]!, bobId: ids[1]! };
}

/** Replace a player's whole mana pool (tests set exact pools, not deltas). */
function setPool(
  state: GameState,
  playerId: PlayerId,
  pool: Partial<ManaPool>,
): GameState {
  const players = new Map(state.players);
  const player = players.get(playerId)!;
  players.set(playerId, {
    ...player,
    manaPool: { ...createEmptyManaPool(), ...pool },
  });
  return { ...state, players };
}

function poolOf(state: GameState, playerId: PlayerId): ManaPool {
  return state.players.get(playerId)!.manaPool;
}

/** Enable land plays / mana abilities: main phase, active, priority, no stack. */
function openMainPhase(state: GameState, aliceId: PlayerId): void {
  state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  state.turn.activePlayerId = aliceId;
  state.priorityPlayerId = aliceId;
  state.stack = [];
}

function putInHand(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  state.cards.set(card.id, card);
  const hand = state.zones.get(`${playerId}-hand`)!;
  state.zones.set(`${playerId}-hand`, {
    ...hand,
    cardIds: [...hand.cardIds, card.id],
  });
  return card.id;
}

function putOnBattlefield(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  card.isTapped = false;
  card.currentZoneKey = `${playerId}-battlefield`;
  state.cards.set(card.id, card);
  const battlefield = state.zones.get(`${playerId}-battlefield`)!;
  state.zones.set(`${playerId}-battlefield`, {
    ...battlefield,
    cardIds: [...battlefield.cardIds, card.id],
  });
  return card.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// canAffordMana — per-color boundaries + availableForGeneric arithmetic
// ─────────────────────────────────────────────────────────────────────────────

describe("mana mutation suite — canAffordMana color boundaries (#1717)", () => {
  const COLORS = ["white", "blue", "black", "red", "green"] as const;

  it.each(COLORS)(
    "a pool exactly equal to the %s requirement affords it (the < boundary)",
    (color) => {
      const f = makeGame();
      const state = setPool(f.state, f.aliceId, { [color]: 2 });
      expect(canAffordMana(state, f.aliceId, { [color]: 2 })).toBe(true);
    },
  );

  it.each(COLORS)(
    "one short of the %s requirement does not afford it",
    (color) => {
      const f = makeGame();
      const state = setPool(f.state, f.aliceId, { [color]: 1 });
      expect(canAffordMana(state, f.aliceId, { [color]: 2 })).toBe(false);
    },
  );

  it("colored mana reserved for colored pips does NOT count toward generic", () => {
    // Pool {blue: 1} vs cost {U}{2}: only 0 blue is left over after the {U},
    // so the {2} is unaffordable. (If the `totalColored − neededColored`
    // subtraction mutated to `+`, this would wrongly afford.)
    const f = makeGame();
    const state = setPool(f.state, f.aliceId, { blue: 1 });
    expect(canAffordMana(state, f.aliceId, { blue: 1, generic: 2 })).toBe(
      false,
    );
  });

  it("leftover colored mana counts toward generic exactly", () => {
    // {blue: 3} vs {U}{2}: 2 blue left over → exactly affords (the >= boundary).
    const f = makeGame();
    const exact = setPool(f.state, f.aliceId, { blue: 3 });
    expect(canAffordMana(exact, f.aliceId, { blue: 1, generic: 2 })).toBe(true);

    // One less blue and the generic portion is short again.
    const short = setPool(f.state, f.aliceId, { blue: 2 });
    expect(canAffordMana(short, f.aliceId, { blue: 1, generic: 2 })).toBe(
      false,
    );
  });

  it("colorless pips are specific: colored mana cannot pay them", () => {
    const f = makeGame();
    const state = setPool(f.state, f.aliceId, { red: 5 });
    expect(canAffordMana(state, f.aliceId, { colorless: 1 })).toBe(false);
  });

  it("a pool exactly equal to the colorless requirement affords it", () => {
    const f = makeGame();
    const state = setPool(f.state, f.aliceId, { colorless: 2 });
    expect(canAffordMana(state, f.aliceId, { colorless: 2 })).toBe(true);
  });

  it("colorless leftover counts toward generic", () => {
    // {colorless: 3} vs {C}{2}: 2 colorless left over → affords exactly.
    const f = makeGame();
    const state = setPool(f.state, f.aliceId, { colorless: 3 });
    expect(canAffordMana(state, f.aliceId, { colorless: 1, generic: 2 })).toBe(
      true,
    );
  });

  it("an unknown player can afford nothing", () => {
    const f = makeGame();
    expect(canAffordMana(f.state, "nobody", {})).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// spendMana — the generic-payment cascade (generic → colorless → W/U/B/R/G)
// ─────────────────────────────────────────────────────────────────────────────

describe("mana mutation suite — spendMana cascade order (#1717)", () => {
  it.each(["white", "blue", "black", "red", "green"] as const)(
    "spending exactly the whole %s pool succeeds and empties it",
    (color) => {
      const f = makeGame();
      const state = setPool(f.state, f.aliceId, { [color]: 2 });
      const result = spendMana(state, f.aliceId, { [color]: 2 });
      expect(result.success).toBe(true);
      expect(poolOf(result.state, f.aliceId)).toEqual(createEmptyManaPool());
    },
  );

  it("generic is paid from the generic pool first, then colored leftover", () => {
    const f = makeGame();
    const state = setPool(f.state, f.aliceId, { generic: 2, red: 1 });
    const result = spendMana(state, f.aliceId, { generic: 3 });
    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId)).toEqual(createEmptyManaPool());
  });

  it("generic spills to colorless BEFORE colored mana", () => {
    const f = makeGame();
    const state = setPool(f.state, f.aliceId, { colorless: 2, white: 1 });
    const result = spendMana(state, f.aliceId, { generic: 2 });
    expect(result.success).toBe(true);
    const pool = poolOf(result.state, f.aliceId);
    expect(pool.colorless).toBe(0);
    expect(pool.white).toBe(1);
  });

  it("leftover colored mana pays generic in W→U→B→R→G order", () => {
    // One generic to pay from a two-color pool: the EARLIER color in the
    // fixed order is consumed, the later one remains.
    const cases = [
      [{ white: 1, blue: 1 }, "white", "blue"],
      [{ blue: 1, black: 1 }, "blue", "black"],
      [{ black: 1, red: 1 }, "black", "red"],
      [{ red: 1, green: 1 }, "red", "green"],
    ] as const;

    for (const [pools, first, second] of cases) {
      const f = makeGame();
      const state = setPool(f.state, f.aliceId, pools);
      const result = spendMana(state, f.aliceId, { generic: 1 });
      expect(result.success).toBe(true);
      const pool = poolOf(result.state, f.aliceId);
      expect(pool[first]).toBe(0);
      expect(pool[second]).toBe(1);
    }
  });

  it("colored pip + exact leftover colored for generic drains the pool exactly", () => {
    const f = makeGame();
    const exact = setPool(f.state, f.aliceId, { blue: 3 });
    const result = spendMana(exact, f.aliceId, { blue: 1, generic: 2 });
    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId)).toEqual(createEmptyManaPool());
  });

  it("one less blue and the same cost fails with the pool untouched", () => {
    const f = makeGame();
    const state = setPool(f.state, f.aliceId, { blue: 2 });
    const result = spendMana(state, f.aliceId, { blue: 1, generic: 2 });
    expect(result.success).toBe(false);
    expect(poolOf(result.state, f.aliceId).blue).toBe(2);
  });

  it("generic-only cost from a generic-only pool succeeds at the boundary", () => {
    const f = makeGame();
    const state = setPool(f.state, f.aliceId, { generic: 4 });
    const result = spendMana(state, f.aliceId, { generic: 4 });
    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId).generic).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canPlayLand / playLand — phase arms and the enters-tapped logic
// ─────────────────────────────────────────────────────────────────────────────

describe("mana mutation suite — land-play timing boundaries (#1717)", () => {
  it("both main phases allow a land play (PRECOMBAT and POSTCOMBAT arms)", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    expect(canPlayLand(f.state, f.aliceId)).toBe(true);

    f.state.turn.currentPhase = Phase.POSTCOMBAT_MAIN;
    expect(canPlayLand(f.state, f.aliceId)).toBe(true);
  });

  it("landsPlayed === maxLands is exactly the boundary (>= not >)", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const players = new Map(f.state.players);
    players.set(f.aliceId, {
      ...players.get(f.aliceId)!,
      landsPlayedThisTurn: 1,
    });
    f.state.players = players;
    expect(f.state.players.get(f.aliceId)!.maxLandsPerTurn).toBe(1);
    expect(canPlayLand(f.state, f.aliceId)).toBe(false);
  });

  it("the second enters-tapped arm ('enters the battlefield tapped') taps", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const cardId = putInHand(
      f.state,
      f.aliceId,
      landCard(
        "Slow Land",
        "Land",
        "{T}: Add {G}. This land enters the battlefield tapped.",
      ),
    );

    const result = playLand(f.state, f.aliceId, cardId);

    expect(result.success).toBe(true);
    expect(result.state.cards.get(cardId)!.isTapped).toBe(true);
  });

  it("entersTappedOverride=true forces a clean land in tapped", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const cardId = putInHand(
      f.state,
      f.aliceId,
      landCard("Fast Land", "Land", "{T}: Add {G}."),
    );

    const result = playLand(f.state, f.aliceId, cardId, undefined, true);

    expect(result.success).toBe(true);
    expect(result.state.cards.get(cardId)!.isTapped).toBe(true);
  });

  it("entersTappedOverride=false overrides an 'enters tapped' land in untapped", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const cardId = putInHand(
      f.state,
      f.aliceId,
      landCard("Amulet Land", "Land", "{T}: Add {G}. This land enters tapped."),
    );

    const result = playLand(f.state, f.aliceId, cardId, undefined, false);

    expect(result.success).toBe(true);
    expect(result.state.cards.get(cardId)!.isTapped).toBe(false);
  });

  it("playing a land increments landsPlayedThisTurn by exactly 1", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const cardId = putInHand(
      f.state,
      f.aliceId,
      landCard("Plain Land", "Land", "{T}: Add {G}."),
    );

    const result = playLand(f.state, f.aliceId, cardId);

    expect(result.success).toBe(true);
    expect(result.state.players.get(f.aliceId)!.landsPlayedThisTurn).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseManaAbility — symbol coverage, multi-ability text, conditions
// ─────────────────────────────────────────────────────────────────────────────

describe("mana mutation suite — parseManaAbility symbols (#1717)", () => {
  it("parses a numeric symbol as GENERIC mana with its numeric value", () => {
    const options = parseManaAbility("{T}: Add {2}.");
    expect(options).toHaveLength(1);
    expect(options[0]!.mana).toEqual({ generic: 2 });
    expect(options[0]!.description).toBe("2");
  });

  it("parses repeated colorless symbols into one option", () => {
    const options = parseManaAbility("{T}: Add {C}{C}.");
    expect(options).toHaveLength(1);
    expect(options[0]!.mana).toEqual({ colorless: 2 });
    expect(options[0]!.description).toBe("2C");
  });

  it("extracts the condition when it is the trailing clause", () => {
    const options = parseManaAbility(
      "{T}: Add {R}. Activate only if you control a Mountain or a Plains",
    );
    expect(options).toHaveLength(1);
    expect(options[0]!.mana).toEqual({ red: 1 });
    expect(options[0]!.activationCondition).toBe(
      "activate only if you control a mountain or a plains",
    );
  });

  it("scans MULTIPLE tap abilities in one oracle text", () => {
    const options = parseManaAbility(
      "{T}: Add {W}.\n{T}: Add {R}. Activate only if you control a Mountain or a Plains.",
    );
    expect(options).toHaveLength(2);
    expect(options[0]!.mana).toEqual({ white: 1 });
    expect(options[1]!.mana).toEqual({ red: 1 });
  });

  it("falls back to five options for 'any one color'", () => {
    const options = parseManaAbility("{T}: Add one mana of any one color.");
    expect(options).toHaveLength(5);
    expect(options.map((o) => o.mana)).toEqual([
      { white: 1 },
      { blue: 1 },
      { black: 1 },
      { red: 1 },
      { green: 1 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// activateManaAbility — guards, option-return path, condition filtering
// ─────────────────────────────────────────────────────────────────────────────

describe("mana mutation suite — activateManaAbility guards (#1717)", () => {
  it("a single-option land adds its mana, taps, and sets the flag", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const forest = putOnBattlefield(
      f.state,
      f.aliceId,
      landCard("Forest", "Land — Forest", "{T}: Add {G}."),
    );

    const result = activateManaAbility(f.state, f.aliceId, forest, 0);

    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId).green).toBe(1);
    expect(result.state.cards.get(forest)!.isTapped).toBe(true);
    expect(result.state.players.get(f.aliceId)!.hasActivatedManaAbility).toBe(
      true,
    );
  });

  it("a multi-option land with no choice returns options WITHOUT tapping or adding mana", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const dual = putOnBattlefield(
      f.state,
      f.aliceId,
      landCard("Dual", "Land — Plains Island", "{T}: Add {W} or {U}."),
    );

    const result = activateManaAbility(f.state, f.aliceId, dual, 0);

    expect(result.success).toBe(true);
    expect(result.options).toHaveLength(2);
    expect(result.options!.map((o) => o.mana)).toEqual([
      { white: 1 },
      { blue: 1 },
    ]);
    expect(result.state.cards.get(dual)!.isTapped).toBe(false);
    expect(getTotalMana(poolOf(result.state, f.aliceId))).toBe(0);
  });

  it("the chosen option is applied and taps the land", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const dual = putOnBattlefield(
      f.state,
      f.aliceId,
      landCard("Dual", "Land — Plains Island", "{T}: Add {W} or {U}."),
    );

    const result = activateManaAbility(f.state, f.aliceId, dual, 0, {
      description: "1U",
      mana: { blue: 1 },
    });

    expect(result.success).toBe(true);
    expect(result.options).toBeUndefined();
    expect(poolOf(result.state, f.aliceId).blue).toBe(1);
    expect(poolOf(result.state, f.aliceId).white).toBe(0);
    expect(result.state.cards.get(dual)!.isTapped).toBe(true);
  });

  it("a tapped land cannot activate again", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const forest = putOnBattlefield(
      f.state,
      f.aliceId,
      landCard("Forest", "Land — Forest", "{T}: Add {G}."),
    );
    f.state.cards.get(forest)!.isTapped = true;

    const result = activateManaAbility(f.state, f.aliceId, forest, 0);

    expect(result.success).toBe(false);
    expect(poolOf(result.state, f.aliceId).green).toBe(0);
  });

  it("a player without priority cannot activate a mana ability", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const forest = putOnBattlefield(
      f.state,
      f.bobId,
      landCard("Bob Forest", "Land — Forest", "{T}: Add {G}."),
    );

    const result = activateManaAbility(f.state, f.bobId, forest, 0);

    expect(result.success).toBe(false);
  });

  it("an unknown card id fails", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const result = activateManaAbility(f.state, f.aliceId, "no-such-card", 0);
    expect(result.success).toBe(false);
  });
});

describe("mana mutation suite — activation conditions (#1717)", () => {
  const CONDITIONAL =
    "{T}: Add {R}. Activate only if you control a Mountain or a Plains";

  function conditionalLand(): ScryfallCard {
    return landCard("Flame Land", "Land", CONDITIONAL);
  }

  it("fails when no controlled land matches the condition", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const land = putOnBattlefield(f.state, f.aliceId, conditionalLand());
    putOnBattlefield(
      f.state,
      f.aliceId,
      landCard("Island", "Land — Island", "{T}: Add {U}."),
    );

    const result = activateManaAbility(f.state, f.aliceId, land, 0);

    expect(result.success).toBe(false);
    expect(poolOf(result.state, f.aliceId).red).toBe(0);
  });

  it("an untapped matching land satisfies the condition and adds the mana", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const land = putOnBattlefield(f.state, f.aliceId, conditionalLand());
    putOnBattlefield(
      f.state,
      f.aliceId,
      landCard("Mountain", "Land — Mountain", "{T}: Add {R}."),
    );

    const result = activateManaAbility(f.state, f.aliceId, land, 0);

    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId).red).toBe(1);
    expect(result.state.cards.get(land)!.isTapped).toBe(true);
  });

  it("a TAPPED matching land does not satisfy the condition", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const land = putOnBattlefield(f.state, f.aliceId, conditionalLand());
    const mountain = putOnBattlefield(
      f.state,
      f.aliceId,
      landCard("Mountain", "Land — Mountain", "{T}: Add {R}."),
    );
    f.state.cards.get(mountain)!.isTapped = true;

    const result = activateManaAbility(f.state, f.aliceId, land, 0);

    expect(result.success).toBe(false);
  });

  it("chosenBasicLandType satisfies a basic-land-type condition", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const land = putOnBattlefield(f.state, f.aliceId, conditionalLand());
    const chosen = putOnBattlefield(
      f.state,
      f.aliceId,
      landCard("Chosen Land", "Land", "{T}: Add {C}."),
    );
    f.state.cards.get(chosen)!.chosenBasicLandType = "Mountain";

    const result = activateManaAbility(f.state, f.aliceId, land, 0);

    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId).red).toBe(1);
  });

  it("a chosen conditional option is re-validated against the battlefield", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const land = putOnBattlefield(f.state, f.aliceId, conditionalLand());
    const option = parseManaAbility(CONDITIONAL)[0]!;

    const result = activateManaAbility(f.state, f.aliceId, land, 0, option);

    expect(result.success).toBe(false);
    expect(poolOf(result.state, f.aliceId).red).toBe(0);
    expect(result.state.cards.get(land)!.isTapped).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pool utilities — zero suppression, exact totals, empty-pool boundary
// ─────────────────────────────────────────────────────────────────────────────

describe("mana mutation suite — pool utilities (#1717)", () => {
  it("formatManaPool suppresses zero-count colors and keeps the fixed order", () => {
    expect(formatManaPool({ ...createEmptyManaPool(), blue: 2 })).toBe("2U");
    expect(
      formatManaPool({
        ...createEmptyManaPool(),
        white: 1,
        blue: 2,
        black: 3,
        red: 4,
        green: 5,
        colorless: 2,
        generic: 3,
      }),
    ).toBe("1W 2U 3B 4R 5G 2C 3");
    expect(formatManaPool({ ...createEmptyManaPool(), generic: 3 })).toBe("3");
    expect(formatManaPool(createEmptyManaPool())).toBe("0");
  });

  it("getTotalMana sums every component exactly", () => {
    expect(
      getTotalMana({
        ...createEmptyManaPool(),
        white: 1,
        blue: 2,
        black: 3,
        red: 4,
        green: 5,
        colorless: 6,
        generic: 7,
      }),
    ).toBe(28);
    expect(getTotalMana(createEmptyManaPool())).toBe(0);
  });

  it("hasMana is false only for a fully empty pool", () => {
    expect(hasMana(createEmptyManaPool())).toBe(false);
    expect(hasMana({ ...createEmptyManaPool(), generic: 1 })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mana cost parsing — X isolation and unknown symbols
// ─────────────────────────────────────────────────────────────────────────────

describe("mana mutation suite — getSpellManaCost boundaries (#1717)", () => {
  it("X is flagged but never counted as a colored or generic pip", () => {
    const cost = getSpellManaCost({ mana_cost: "{X}{2}{R}" });
    expect(cost).toEqual({
      generic: 2,
      white: 0,
      blue: 0,
      black: 0,
      red: 1,
      green: 0,
      hasX: true,
    });
  });

  it("an unhandled symbol contributes nothing and does not set hasX", () => {
    expect(getSpellManaCost({ mana_cost: "{S}" })).toEqual({
      generic: 0,
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      hasX: false,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Land-play budget arithmetic — reset / set / add exactness
// ─────────────────────────────────────────────────────────────────────────────

describe("mana mutation suite — land-play budget arithmetic (#1717)", () => {
  it("addLandPlay adds exactly 1 by default and `amount` when given", () => {
    const f = makeGame();
    const one = addLandPlay(f.state, f.aliceId);
    expect(one.players.get(f.aliceId)!.maxLandsPerTurn).toBe(2);

    const three = addLandPlay(f.state, f.aliceId, 3);
    expect(three.players.get(f.aliceId)!.maxLandsPerTurn).toBe(4);
  });

  it("setMaxLandsPerTurn replaces the budget exactly", () => {
    const f = makeGame();
    const state = setMaxLandsPerTurn(f.state, f.aliceId, 3);
    expect(state.players.get(f.aliceId)!.maxLandsPerTurn).toBe(3);
  });

  it("resetLandPlays zeroes the count AND the mana-ability flag", () => {
    const f = makeGame();
    openMainPhase(f.state, f.aliceId);
    const players = new Map(f.state.players);
    players.set(f.aliceId, {
      ...players.get(f.aliceId)!,
      landsPlayedThisTurn: 1,
      hasActivatedManaAbility: true,
    });
    f.state.players = players;

    const state = resetLandPlays(f.state, f.aliceId);
    const player = state.players.get(f.aliceId)!;
    expect(player.landsPlayedThisTurn).toBe(0);
    expect(player.hasActivatedManaAbility).toBe(false);
  });

  it("addMana accumulates on top of the existing pool without clobbering", () => {
    const f = makeGame();
    let state = setPool(f.state, f.aliceId, { red: 1 });
    state = addMana(state, f.aliceId, { red: 2, blue: 1 });
    expect(poolOf(state, f.aliceId)).toEqual({
      ...createEmptyManaPool(),
      red: 3,
      blue: 1,
    });
  });
});
