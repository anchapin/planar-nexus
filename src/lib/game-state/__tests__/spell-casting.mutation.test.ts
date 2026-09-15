/**
 * Mutation-targeted edge cases for the `spell-casting/` family files.
 *
 * Issue #1711: Stryker mutation suite for the spell-casting module family
 * (`cast` / `resolve` / `targeting` / `choices` / `board-sweepers` — the
 * Stryker allowlist glob `src/lib/game-state/spell-casting/*.ts`). The
 * module's baseline is not yet recorded; these tests pin down the
 * cost-arithmetic edge mutants Stryker reports as surviving:
 *
 *  - X-cost arithmetic: `totalGeneric = manaCost.generic + xValue` exactly,
 *    and the available-for-generic check boundary (`<` vs `<=`).
 *  - Kicker/multikicker scaling: the kicker cost is added `× n` per pip,
 *    `timesKicked` canonicalisation (floor, clamp to 0, precedence over the
 *    legacy boolean), and kicker stacking on top of REPLACEMENT costs
 *    (Blitz replaces the printed cost, kicker still applies).
 *  - Replacement-cost deltas (Blitz): `total += alt − printed` per pip, so
 *    the printed cost is replaced, not added to.
 *  - Convoke pip assignment order (CR 702.93b colored pip BEFORE 702.93c
 *    generic): a red creature must reduce a {R} pip, not the generic portion.
 *  - Delve floor (CR 702.61a): each exiled card reduces the GENERIC portion
 *    by exactly {1}; over-exile reduces nothing but still exiles.
 *  - Colored mana paying generic: `availableForGeneric` includes colored +
 *    colorless pool mana.
 *  - Family-file boundaries: `canTarget` switch arms, `validateSpellTargets`
 *    short-circuit, `isBoardSweeper` token conjunction, `createXValueChoice`
 *    inclusive `0..maxX` range, `copySpellOnStack` characteristic retention.
 */

import {
  canTarget,
  castSpell,
  copySpellOnStack,
  createModeChoice,
  createXValueChoice,
  getSpellManaValueFromCard,
  isBoardSweeper,
  destroysIndestructibleCreatures,
  validateSpellTargets,
} from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  ScryfallCard,
  StackObject,
  Target,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let cardCounter = 0;
function uniqueId(prefix: string): string {
  cardCounter += 1;
  return `${prefix}-${cardCounter}`;
}

function mockCard(spec: {
  name: string;
  typeLine?: string;
  manaCost?: string;
  oracleText?: string;
  keywords?: string[];
  colors?: string[];
  cmc?: number;
}): ScryfallCard {
  const colors = spec.colors ?? ["R"];
  return {
    id: uniqueId(`card-${spec.name.toLowerCase().replace(/\s+/g, "-")}`),
    name: spec.name,
    type_line: spec.typeLine ?? "Sorcery",
    keywords: spec.keywords ?? [],
    oracle_text: spec.oracleText ?? "",
    mana_cost: spec.manaCost ?? "{1}",
    cmc: spec.cmc ?? 1,
    colors,
    color_identity: colors,
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

function makeGame(): { state: GameState; aliceId: string; bobId: string } {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const ids = Array.from(state.players.keys());
  return { state, aliceId: ids[0], bobId: ids[1] };
}

function putInHand(
  state: GameState,
  playerId: string,
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

function putInGraveyard(
  state: GameState,
  playerId: string,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  state.cards.set(card.id, card);
  const grave = state.zones.get(`${playerId}-graveyard`)!;
  state.zones.set(`${playerId}-graveyard`, {
    ...grave,
    cardIds: [...grave.cardIds, card.id],
  });
  return card.id;
}

function putOnBattlefield(
  state: GameState,
  playerId: string,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  card.isTapped = false;
  card.hasSummoningSickness = false;
  card.currentZoneKey = `${playerId}-battlefield`;
  state.cards.set(card.id, card);
  const battlefield = state.zones.get(`${playerId}-battlefield`)!;
  state.zones.set(`${playerId}-battlefield`, {
    ...battlefield,
    cardIds: [...battlefield.cardIds, card.id],
  });
  return card.id;
}

/** Enable casting a sorcery: main phase, active, priority, empty stack. */
function openMainPhase(state: GameState, aliceId: string): void {
  state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  state.turn.activePlayerId = aliceId;
  state.priorityPlayerId = aliceId;
  state.stack = [];
}

function poolOf(state: GameState, playerId: string) {
  return state.players.get(playerId)!.manaPool;
}

function fillerCard(name: string): ScryfallCard {
  return mockCard({ name, typeLine: "Sorcery", manaCost: "{0}", cmc: 0 });
}

// ─────────────────────────────────────────────────────────────────────────────
// X-cost arithmetic (cast.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("spell-casting mutation suite — X-cost arithmetic (#1711)", () => {
  it("adds xValue to the generic portion exactly and drains the pool to zero", () => {
    const f = makeGame();
    const spellId = putInHand(
      f.state,
      f.aliceId,
      mockCard({
        name: "Fireball",
        manaCost: "{X}{R}",
        oracleText: "Fireball deals X damage to any target.",
      }),
    );
    openMainPhase(f.state, f.aliceId);
    f.state = addMana(f.state, f.aliceId, { generic: 3, red: 1 });

    const result = castSpell(f.state, f.aliceId, spellId, [], [], 3);

    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId).generic).toBe(0);
    expect(poolOf(result.state, f.aliceId).red).toBe(0);
    expect(result.state.stack[0].variableValues?.get("X")).toBe(3);
  });

  it("rejects X+1 when the pool covers exactly X", () => {
    const f = makeGame();
    const spellId = putInHand(
      f.state,
      f.aliceId,
      mockCard({ name: "Fireball", manaCost: "{X}{R}" }),
    );
    openMainPhase(f.state, f.aliceId);
    f.state = addMana(f.state, f.aliceId, { generic: 3, red: 1 });

    const result = castSpell(f.state, f.aliceId, spellId, [], [], 4);

    expect(result.success).toBe(false);
  });

  it("xValue=0 charges only the printed pips", () => {
    const f = makeGame();
    const spellId = putInHand(
      f.state,
      f.aliceId,
      mockCard({ name: "Fireball", manaCost: "{X}{R}" }),
    );
    openMainPhase(f.state, f.aliceId);
    f.state = addMana(f.state, f.aliceId, { red: 1 });

    const result = castSpell(f.state, f.aliceId, spellId, [], [], 0);

    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId).red).toBe(0);
    expect(poolOf(result.state, f.aliceId).generic).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Available-for-generic boundary + colored-pays-generic (cast.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("spell-casting mutation suite — generic-payment boundaries (#1711)", () => {
  it("a pool exactly equal to the generic cost passes (the < boundary)", () => {
    const f = makeGame();
    const spellId = putInHand(
      f.state,
      f.aliceId,
      mockCard({ name: "Generic Three", manaCost: "{3}", cmc: 3 }),
    );
    openMainPhase(f.state, f.aliceId);
    f.state = addMana(f.state, f.aliceId, { generic: 3 });

    const result = castSpell(f.state, f.aliceId, spellId);

    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId).generic).toBe(0);
  });

  it("a pool one short of the generic cost fails the mana gates", () => {
    const f = makeGame();
    const spellId = putInHand(
      f.state,
      f.aliceId,
      mockCard({ name: "Generic Three", manaCost: "{3}", cmc: 3 }),
    );
    openMainPhase(f.state, f.aliceId);
    f.state = addMana(f.state, f.aliceId, { generic: 2 });

    const result = castSpell(f.state, f.aliceId, spellId);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("leftover colored mana can pay the generic portion", () => {
    const f = makeGame();
    const spellId = putInHand(
      f.state,
      f.aliceId,
      mockCard({
        name: "Three Blue",
        manaCost: "{3}{U}",
        cmc: 4,
        colors: ["U"],
      }),
    );
    openMainPhase(f.state, f.aliceId);
    // 1 blue for the pip + 3 blue leftover for the {3}.
    f.state = addMana(f.state, f.aliceId, { blue: 4 });

    const result = castSpell(f.state, f.aliceId, spellId);

    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId).blue).toBe(0);
  });

  it("colored pips are checked per color before generic", () => {
    const f = makeGame();
    const spellId = putInHand(
      f.state,
      f.aliceId,
      mockCard({
        name: "Double Blue",
        manaCost: "{U}{U}",
        cmc: 2,
        colors: ["U"],
      }),
    );
    openMainPhase(f.state, f.aliceId);
    f.state = addMana(f.state, f.aliceId, { blue: 1, generic: 5 });

    const short = castSpell(f.state, f.aliceId, spellId);
    expect(short.success).toBe(false);

    const f2 = makeGame();
    const spellId2 = putInHand(
      f2.state,
      f2.aliceId,
      mockCard({
        name: "Double Blue",
        manaCost: "{U}{U}",
        cmc: 2,
        colors: ["U"],
      }),
    );
    openMainPhase(f2.state, f2.aliceId);
    f2.state = addMana(f2.state, f2.aliceId, { blue: 2, generic: 0 });
    const exact = castSpell(f2.state, f2.aliceId, spellId2);
    expect(exact.success).toBe(true);
    expect(poolOf(exact.state, f2.aliceId).blue).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Kicker / multikicker cost scaling (cast.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("spell-casting mutation suite — kicker cost arithmetic (#1711)", () => {
  function multikickerSpell(): ScryfallCard {
    return mockCard({
      name: "Everflowing",
      manaCost: "{1}{U}",
      oracleText: "Multikicker {2}{U}\nDraw a card.",
      colors: ["U"],
      cmc: 2,
    });
  }

  it("multikicker paid 3 times adds the kicker cost ×3 to every pip", () => {
    const f = makeGame();
    const spellId = putInHand(f.state, f.aliceId, multikickerSpell());
    openMainPhase(f.state, f.aliceId);
    // printed {1}{U} + 3 × {2}{U} = generic 1+6=7, blue 1+3=4.
    f.state = addMana(f.state, f.aliceId, { generic: 7, blue: 4 });

    const result = castSpell(
      f.state,
      f.aliceId,
      spellId,
      [],
      [],
      0,
      false,
      undefined,
      3,
    );

    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId).generic).toBe(0);
    expect(poolOf(result.state, f.aliceId).blue).toBe(0);
    const so = result.state.stack[0];
    expect(so.wasKicked).toBe(true);
    expect(so.timesKicked).toBe(3);
    expect(so.alternativeCostsUsed).toContain("kicker");
  });

  it("a pool short of the ×3 multikicker total fails", () => {
    const f = makeGame();
    const spellId = putInHand(f.state, f.aliceId, multikickerSpell());
    openMainPhase(f.state, f.aliceId);
    // One generic short of 7.
    f.state = addMana(f.state, f.aliceId, { generic: 6, blue: 4 });

    const result = castSpell(
      f.state,
      f.aliceId,
      spellId,
      [],
      [],
      0,
      false,
      undefined,
      3,
    );

    expect(result.success).toBe(false);
  });

  it("timesKicked=0 overrides isKicked=true (explicit count wins)", () => {
    const f = makeGame();
    const spellId = putInHand(f.state, f.aliceId, multikickerSpell());
    openMainPhase(f.state, f.aliceId);
    // Only the printed {1}{U} available.
    f.state = addMana(f.state, f.aliceId, { generic: 1, blue: 1 });

    const result = castSpell(
      f.state,
      f.aliceId,
      spellId,
      [],
      [],
      0,
      true,
      undefined,
      0,
    );

    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId).generic).toBe(0);
    expect(poolOf(result.state, f.aliceId).blue).toBe(0);
    expect(result.state.stack[0].wasKicked).toBe(false);
    expect(result.state.stack[0].timesKicked).toBe(0);
  });

  it("a fractional timesKicked is floored, and a negative one clamps to 0", () => {
    const f = makeGame();
    const spellId = putInHand(f.state, f.aliceId, multikickerSpell());
    openMainPhase(f.state, f.aliceId);
    // floor(2.9) = 2 → printed {1}{U} + 2 × {2}{U} = generic 5, blue 3.
    f.state = addMana(f.state, f.aliceId, { generic: 5, blue: 3 });

    const floored = castSpell(
      f.state,
      f.aliceId,
      spellId,
      [],
      [],
      0,
      false,
      undefined,
      2.9,
    );
    expect(floored.success).toBe(true);
    expect(poolOf(floored.state, f.aliceId).generic).toBe(0);
    expect(poolOf(floored.state, f.aliceId).blue).toBe(0);
    expect(floored.state.stack[0].timesKicked).toBe(2);

    const f2 = makeGame();
    const spellId2 = putInHand(f2.state, f2.aliceId, multikickerSpell());
    openMainPhase(f2.state, f2.aliceId);
    f2.state = addMana(f2.state, f2.aliceId, { generic: 1, blue: 1 });
    const clamped = castSpell(
      f2.state,
      f2.aliceId,
      spellId2,
      [],
      [],
      0,
      false,
      undefined,
      -1,
    );
    expect(clamped.success).toBe(true);
    expect(clamped.state.stack[0].timesKicked).toBe(0);
    expect(clamped.state.stack[0].wasKicked).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Replacement-cost deltas (Blitz) + kicker stacking (cast.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("spell-casting mutation suite — blitz replacement-cost arithmetic (#1711)", () => {
  function blitzCreature(kicker?: string): ScryfallCard {
    return mockCard({
      name: "Blitz Guy",
      typeLine: "Creature — Test",
      manaCost: "{3}{R}",
      oracleText: `Blitz {1}{R}${kicker ? `\nKicker ${kicker}` : ""}`,
      cmc: 4,
    });
  }

  it("blitz REPLACES the printed cost: exactly the blitz pips are spent", () => {
    const f = makeGame();
    const spellId = putInHand(f.state, f.aliceId, blitzCreature());
    openMainPhase(f.state, f.aliceId);
    // Pool covers the printed cost too (the pre-cast validation gate checks
    // the printed cost), but the SPEND must be the blitz {1}{R} exactly.
    f.state = addMana(f.state, f.aliceId, { generic: 8, red: 2 });

    const result = castSpell(f.state, f.aliceId, spellId, [], [], 0, false, {
      type: "blitz",
    });

    expect(result.success).toBe(true);
    // 8 − 1 generic and 2 − 1 red: only the blitz cost was charged, not the
    // printed {3}{R} (which would leave 5 generic / 1 red) and not the sum.
    expect(poolOf(result.state, f.aliceId).generic).toBe(7);
    expect(poolOf(result.state, f.aliceId).red).toBe(1);
    expect(result.state.stack[0].alternativeCostsUsed).toContain("blitz");
  });

  it("kicker stacks ON TOP of the blitz replacement cost", () => {
    const f = makeGame();
    const spellId = putInHand(f.state, f.aliceId, blitzCreature("{1}"));
    openMainPhase(f.state, f.aliceId);
    f.state = addMana(f.state, f.aliceId, { generic: 8, red: 2 });

    const result = castSpell(
      f.state,
      f.aliceId,
      spellId,
      [],
      [],
      0,
      false,
      { type: "blitz" },
      1,
    );

    expect(result.success).toBe(true);
    // blitz {1}{R} + kicker {1} → 2 generic + 1 red spent.
    expect(poolOf(result.state, f.aliceId).generic).toBe(6);
    expect(poolOf(result.state, f.aliceId).red).toBe(1);
    const alts = result.state.stack[0].alternativeCostsUsed;
    expect(alts).toContain("blitz");
    expect(alts).toContain("kicker");
    expect(result.state.stack[0].timesKicked).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Convoke pip-assignment order (CR 702.93b before 702.93c) (cast.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("spell-casting mutation suite — convoke pip order (#1711)", () => {
  function convokeSpell(): ScryfallCard {
    return mockCard({
      name: "Convoke Bolt",
      manaCost: "{2}{R}{R}",
      oracleText: "Convoke\nDeal 3 damage to any target.",
      keywords: ["convoke"],
      cmc: 4,
    });
  }

  function monoColorCreature(name: string, color: string | null): ScryfallCard {
    return mockCard({
      name,
      typeLine: "Creature — Test",
      manaCost: "{1}",
      colors: color ? [color] : [],
    });
  }

  it("a red creature pays the {R} pip (702.93b) before the generic portion", () => {
    const f = makeGame();
    const spellId = putInHand(f.state, f.aliceId, convokeSpell());
    const red = putOnBattlefield(
      f.state,
      f.aliceId,
      monoColorCreature("Red Guy", "R"),
    );
    const green = putOnBattlefield(
      f.state,
      f.aliceId,
      monoColorCreature("Green Guy", "G"),
    );
    openMainPhase(f.state, f.aliceId);
    // Correct assignment: red creature → {R}, green creature → {1};
    // remaining {1}{R} from the pool exactly.
    f.state = addMana(f.state, f.aliceId, { generic: 1, red: 1 });

    const result = castSpell(f.state, f.aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [red, green],
    });

    // If the red creature wrongly reduced the generic portion first, the
    // remaining {R}{R} would exceed the 1 red in the pool and fail.
    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId).red).toBe(0);
    expect(poolOf(result.state, f.aliceId).generic).toBe(0);
    expect(result.state.cards.get(red)!.isTapped).toBe(true);
    expect(result.state.cards.get(green)!.isTapped).toBe(true);
  });

  it("a colorless creature cannot pay a colored pip (CR 702.93c)", () => {
    const f = makeGame();
    const spellId = putInHand(f.state, f.aliceId, convokeSpell());
    const colorless = putOnBattlefield(
      f.state,
      f.aliceId,
      monoColorCreature("Artifact Guy", null),
    );
    openMainPhase(f.state, f.aliceId);
    // Colorless creature → 1 generic only; remaining {1}{R}{R} from pool.
    f.state = addMana(f.state, f.aliceId, { generic: 1, red: 2 });

    const result = castSpell(f.state, f.aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [colorless],
    });

    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId).red).toBe(0);
    expect(poolOf(result.state, f.aliceId).generic).toBe(0);
    expect(result.state.cards.get(colorless)!.isTapped).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Delve generic floor (CR 702.61a) (cast.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("spell-casting mutation suite — delve generic floor (#1711)", () => {
  function delveSpell(): ScryfallCard {
    return mockCard({
      name: "Deep Cut",
      manaCost: "{5}{B}{B}",
      oracleText: "Delve\nDestroy target creature.",
      keywords: ["delve"],
      colors: ["B"],
      cmc: 7,
    });
  }

  it("over-exile reduces nothing beyond the generic portion but still exiles", () => {
    const f = makeGame();
    const spellId = putInHand(f.state, f.aliceId, delveSpell());
    const graveIds: CardInstanceId[] = [];
    for (let i = 0; i < 8; i++) {
      graveIds.push(putInGraveyard(f.state, f.aliceId, fillerCard(`g-${i}`)));
    }
    openMainPhase(f.state, f.aliceId);
    // 8 cards exiled but only 5 generic pips exist → cost becomes {B}{B}.
    f.state = addMana(f.state, f.aliceId, { black: 2 });

    const result = castSpell(f.state, f.aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: graveIds,
    });

    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId).black).toBe(0);
    // Binding choice: ALL 8 cards are exiled even though only 5 reduced cost.
    const grave = result.state.zones.get(`${f.aliceId}-graveyard`)!;
    const exile = result.state.zones.get(`${f.aliceId}-exile`)!;
    for (const gid of graveIds) {
      expect(grave.cardIds).not.toContain(gid);
      expect(exile.cardIds).toContain(gid);
    }
    expect(result.state.stack[0].alternativeCostsUsed).toContain("delve");
  });

  it("exactly enough cards zero the generic portion", () => {
    const f = makeGame();
    const spellId = putInHand(f.state, f.aliceId, delveSpell());
    const graveIds: CardInstanceId[] = [];
    for (let i = 0; i < 5; i++) {
      graveIds.push(putInGraveyard(f.state, f.aliceId, fillerCard(`g-${i}`)));
    }
    openMainPhase(f.state, f.aliceId);
    f.state = addMana(f.state, f.aliceId, { black: 2, generic: 0 });

    const result = castSpell(f.state, f.aliceId, spellId, [], [], 0, false, {
      type: "delve",
      delveCards: graveIds,
    });

    expect(result.success).toBe(true);
    expect(poolOf(result.state, f.aliceId).black).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mana-value helper (cast.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("spell-casting mutation suite — mana value fallback (#1711)", () => {
  it("getSpellManaValueFromCard returns the printed cmc, or 0 when absent", () => {
    expect(getSpellManaValueFromCard({ mana_cost: "{3}{R}", cmc: 4 })).toBe(4);
    expect(getSpellManaValueFromCard({ mana_cost: "{3}{R}", cmc: 0 })).toBe(0);
    expect(getSpellManaValueFromCard({ mana_cost: "{X}{X}{R}" })).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Targeting boundaries (targeting.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("spell-casting mutation suite — canTarget switch arms (#1711)", () => {
  it("covers every switch arm plus the default rejection", () => {
    const f = makeGame();
    const creature = putOnBattlefield(
      f.state,
      f.aliceId,
      mockCard({
        name: "Target Dummy",
        typeLine: "Creature — Test",
      }),
    );

    // card arm — present and absent.
    expect(canTarget("card", creature, f.state, f.bobId).canTarget).toBe(true);
    expect(canTarget("card", "missing-card", f.state, f.bobId)).toEqual({
      canTarget: false,
      reason: "Card not found",
    });

    // player arm — present and absent.
    expect(canTarget("player", f.bobId, f.state, f.aliceId).canTarget).toBe(
      true,
    );
    expect(canTarget("player", "nobody", f.state, f.aliceId)).toEqual({
      canTarget: false,
      reason: "Player not found",
    });

    // stack arm — present and absent.
    const stackObj = {
      id: "stack-1",
      type: "spell",
      controllerId: f.aliceId,
      targets: [],
    } as unknown as StackObject;
    f.state.stack = [stackObj];
    expect(canTarget("stack", "stack-1", f.state, f.aliceId).canTarget).toBe(
      true,
    );
    const missingStack = canTarget("stack", "stack-2", f.state, f.aliceId);
    expect(missingStack.canTarget).toBe(false);
    expect(missingStack.reason).toBe("Stack object not found");

    // zone arm — present and absent.
    expect(canTarget("zone", "stack", f.state, f.aliceId).canTarget).toBe(true);
    const missingZone = canTarget("zone", "nope-zone", f.state, f.aliceId);
    expect(missingZone.canTarget).toBe(false);
    expect(missingZone.reason).toBe("Zone not found");

    // default arm.
    const invalid = canTarget(
      "weird" as Target["type"],
      "x",
      f.state,
      f.aliceId,
    );
    expect(invalid).toEqual({
      canTarget: false,
      reason: "Invalid target type",
    });
  });

  it("validateSpellTargets short-circuits on the first invalid target", () => {
    const empty = { targets: [] } as unknown as StackObject;
    expect(validateSpellTargets(empty, {} as GameState)).toBe(true);

    const allValid = {
      targets: [
        { type: "card", id: "a", isValid: true },
        { type: "card", id: "b", isValid: true },
      ],
    } as unknown as StackObject;
    expect(validateSpellTargets(allValid, {} as GameState)).toBe(true);

    const oneInvalid = {
      targets: [
        { type: "card", id: "a", isValid: true },
        { type: "card", id: "b", isValid: false },
      ],
    } as unknown as StackObject;
    expect(validateSpellTargets(oneInvalid, {} as GameState)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Board-sweeper token conjunction (board-sweepers.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("spell-casting mutation suite — board-sweeper detection (#1711)", () => {
  it("requires the exact token conjunction", () => {
    expect(isBoardSweeper("Destroy all creatures.")).toBe(true);
    expect(isBoardSweeper("Destroy all creatures and all planeswalkers.")).toBe(
      true,
    );
    // destroy + creatures + all, assembled across the sentence.
    expect(
      isBoardSweeper("Destroy each of your creatures if all are marked."),
    ).toBe(true);
    // Missing tokens.
    expect(isBoardSweeper("Destroy target creature.")).toBe(false);
    expect(isBoardSweeper("Deal 3 damage to each creature.")).toBe(false);
    expect(isBoardSweeper("All players draw a card.")).toBe(false);
    expect(isBoardSweeper("")).toBe(false);
  });

  it("destroysIndestructibleCreatures keys on the regeneration clause", () => {
    expect(
      destroysIndestructibleCreatures(
        "Destroy all creatures. They can't be regenerated.",
      ),
    ).toBe(true);
    expect(destroysIndestructibleCreatures("Destroy all creatures.")).toBe(
      false,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// X-value and mode choice boundaries (choices.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("spell-casting mutation suite — cast-time choice boundaries (#1711)", () => {
  it("createXValueChoice enumerates the INCLUSIVE range 0..maxX", () => {
    const f = makeGame();
    const choice = createXValueChoice(
      f.state,
      f.aliceId,
      "so-1",
      "Fireball",
      3,
    );
    expect(choice.choices.map((c) => c.label)).toEqual(["0", "1", "2", "3"]);
    expect(choice.choices.map((c) => c.value)).toEqual([0, 1, 2, 3]);
    expect(choice.minChoices).toBe(1);
    expect(choice.maxChoices).toBe(1);

    // maxX = 0 still offers exactly one option (the `i <= maxX` edge).
    const zero = createXValueChoice(f.state, f.aliceId, "so-2", "Fireball", 0);
    expect(zero.choices).toHaveLength(1);
    expect(zero.choices[0]?.value).toBe(0);
  });

  it("createModeChoice switches the prompt at the minChoices>1 boundary", () => {
    const f = makeGame();
    const one = createModeChoice(
      f.state,
      f.aliceId,
      "so-3",
      "Bolt",
      ["A", "B"],
      1,
      1,
    );
    expect(one.prompt).toBe("Choose mode for Bolt:");
    const two = createModeChoice(
      f.state,
      f.aliceId,
      "so-4",
      "Bolt",
      ["A", "B"],
      2,
      2,
    );
    expect(two.prompt).toBe("Choose 2 modes for Bolt:");
    expect(two.choices.map((c) => c.value)).toEqual(["A", "B"]);
    expect(two.choices.every((c) => c.isValid)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spell copies (resolve.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("spell-casting mutation suite — copySpellOnStack boundaries (#1711)", () => {
  it("copies retain the original's characteristics and go on top of the stack", () => {
    const f = makeGame();
    const spellId = putInHand(
      f.state,
      f.aliceId,
      mockCard({
        name: "Original",
        manaCost: "{1}{U}",
        oracleText: "Kicker {1}\nDraw a card.",
        colors: ["U"],
        cmc: 2,
      }),
    );
    openMainPhase(f.state, f.aliceId);
    f.state = addMana(f.state, f.aliceId, { generic: 2, blue: 1 });

    const casted = castSpell(
      f.state,
      f.aliceId,
      spellId,
      [],
      [],
      0,
      false,
      undefined,
      1,
    );
    expect(casted.success).toBe(true);
    const original = casted.state.stack[0];

    const copied = copySpellOnStack(casted.state, original.id);
    expect(copied.success).toBe(true);
    expect(copied.state.stack).toHaveLength(2);

    const copy = copied.state.stack[1]!;
    expect(copy.id).not.toBe(original.id);
    expect(copy.isCopy).toBe(true);
    expect(copy.sourceCardId).toBe(original.sourceCardId);
    expect(copy.controllerId).toBe(original.controllerId);
    expect(copy.name).toBe("Original");
    expect(copy.manaCost).toBe(original.manaCost);
    expect(copy.wasKicked).toBe(true);
    expect(copy.timesKicked).toBe(1);
    expect(copy.alternativeCostsUsed).toContain("kicker");
    // The original is untouched — still below the copy.
    expect(copied.state.stack[0].isCopy).toBeFalsy();
  });

  it("copy targets can be reselected (CR 707.10d) and default to the original's", () => {
    const f = makeGame();
    const spellId = putInHand(
      f.state,
      f.aliceId,
      mockCard({ name: "Targeted", manaCost: "{1}{U}", colors: ["U"] }),
    );
    openMainPhase(f.state, f.aliceId);
    f.state = addMana(f.state, f.aliceId, { generic: 1, blue: 1 });

    const originalTarget: Target = {
      type: "player",
      targetId: f.bobId,
      isValid: true,
    };
    const casted = castSpell(f.state, f.aliceId, spellId, [originalTarget]);
    expect(casted.success).toBe(true);

    // Default: copy RETAINS the original's targets (CR 707.10c).
    const retained = copySpellOnStack(casted.state, casted.state.stack[0].id);
    const retainedCopy = retained.state.stack[1]!;
    expect(retainedCopy.targets).toHaveLength(1);
    expect(retainedCopy.targets[0]?.targetId).toBe(f.bobId);

    // Reselect: newTargets replace the original's (CR 707.10d).
    const newTarget: Target = {
      type: "player",
      targetId: f.aliceId,
      isValid: true,
    };
    const retargeted = copySpellOnStack(
      casted.state,
      casted.state.stack[0].id,
      [newTarget],
    );
    const retargetedCopy = retargeted.state.stack[1]!;
    expect(retargetedCopy.targets).toHaveLength(1);
    expect(retargetedCopy.targets[0]?.targetId).toBe(f.aliceId);
  });

  it("rejects unknown sources and non-spell objects with distinct errors", () => {
    const f = makeGame();
    const missing = copySpellOnStack(f.state, "no-such-object");
    expect(missing.success).toBe(false);
    expect(missing.error).toContain("Source spell not found");

    const ability = {
      id: "ability-1",
      type: "ability",
      controllerId: f.aliceId,
      targets: [],
    } as unknown as StackObject;
    f.state.stack = [ability];
    const nonSpell = copySpellOnStack(f.state, "ability-1");
    expect(nonSpell.success).toBe(false);
    expect(nonSpell.error).toContain("Only spells");
  });
});
