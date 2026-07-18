/**
 * @fileoverview Unit tests for the Convoke keyword (CR 702.93).
 *
 * Issue #1406 — [Rules Engine] Implement Convoke (CR 702.93)
 * tap-creatures-to-pay-colored-pips alternative cost.
 *
 * Convoke is a static ability that functions while the spell with convoke is
 * on the stack. "Your creatures can help cast this spell. Each creature you tap
 * while casting this spell pays for {1} or one mana of that creature's color."
 *
 * CR 702.93a — the player announces each creature they tap while casting the
 * spell; those creatures become tapped as the spell is paid for.
 * CR 702.93b — a colored creature can pay for one pip of its color.
 * CR 702.93c — any creature (colored or colorless) can pay for one generic
 * mana ({1}).
 *
 * Important: tapping a creature for convoke is NOT activating a {T} activated
 * ability — it is the convoke rule itself paying part of the spell's cost.
 * Summoning-sickness (CR 302.6) only restricts activating {T}/{Q} abilities,
 * so a summoning-sick creature CAN be convoked. (The issue's acceptance
 * criterion that summoning-sick creatures be rejected would have violated CR;
 * these tests assert the correct, CR-faithful behaviour.)
 *
 * Coverage: parsing, the alternative-cost switch branch in `castSpell`, the
 * cost-reduction semantics per CR 702.93b/c, validation rules (untapped,
 * creature type, controller, battlefield, no duplicates), the post-cast tap
 * state, combinations with mana in the pool, the "not enough energy"
 * fall-through, over-declaration, summoning-sick legality, and the
 * validation-service bypass for the printed-cost precheck.
 */

import { describe, it, expect } from "@jest/globals";
import { castSpell } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { parseConvoke } from "../oracle-text-parser";
import { Phase } from "../types";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  CardInstance,
} from "../types";
import type { ScryfallCard } from "@/app/actions";

// ---------------------------------------------------------------------------
// Mock card helpers
// ---------------------------------------------------------------------------

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    name: "Test Card",
    type_line: "Instant",
    oracle_text: "",
    mana_cost: "{1}{R}",
    cmc: 2,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

/** A sorcery with Convoke and a {2}{R}{R} cost (4 mana value, 1 red pip pair). */
function convokeSorcery(): ScryfallCard {
  return makeCard({
    id: "mock-stoke-the-flames",
    name: "Stoke the Flames",
    type_line: "Sorcery",
    oracle_text: "Convoke\nStoke the Flames deals 4 damage to any target.",
    mana_cost: "{2}{R}{R}",
    cmc: 4,
    colors: ["R"],
    color_identity: ["R"],
    keywords: ["convoke"],
  });
}

/** Same cost and effect as convokeSorcery but WITHOUT the Convoke keyword. */
function nonConvokeSorcery(): ScryfallCard {
  return makeCard({
    id: "mock-flame-slash",
    name: "Flame Slash",
    type_line: "Sorcery",
    oracle_text: "Flame Slash deals 4 damage to target creature.",
    mana_cost: "{2}{R}{R}",
    cmc: 4,
    colors: ["R"],
    color_identity: ["R"],
  });
}

/** A green convoke sorcery with one of each W/U/B/R/G pip — Sala-sink. */
function rainbowConvokeSorcery(): ScryfallCard {
  return makeCard({
    id: "mock-confluence",
    name: "Confluence",
    type_line: "Sorcery",
    oracle_text: "Convoke\nDraw a card.",
    mana_cost: "{W}{U}{B}{R}{G}",
    cmc: 5,
    colors: ["W", "U", "B", "R", "G"],
    color_identity: ["W", "U", "B", "R", "G"],
    keywords: ["convoke"],
  });
}

/** A mono-color creature in the given color. */
function monoCreature(
  id: string,
  color: "W" | "U" | "B" | "R" | "G",
  name: string,
): ScryfallCard {
  return makeCard({
    id,
    name,
    type_line: "Creature — Test",
    oracle_text: "",
    mana_cost: `{1}${`{${color}}`}`,
    cmc: 2,
    colors: [color],
    color_identity: [color],
    power: "1",
    toughness: "1",
  });
}

/** A colorless artifact creature (colors = []). */
function colorlessCreature(id: string, name = "Construct"): ScryfallCard {
  return makeCard({
    id,
    name,
    type_line: "Artifact Creature — Construct",
    oracle_text: "",
    mana_cost: "{3}",
    cmc: 3,
    colors: [],
    color_identity: [],
    power: "2",
    toughness: "2",
  });
}

/** A non-creature permanent (a Land) — used to assert convoke rejection. */
function nonCreatureLand(id: string): ScryfallCard {
  return makeCard({
    id,
    name: "Mountain",
    type_line: "Basic Land — Mountain",
    oracle_text: "({T}: Add {R}.)",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: ["R"],
  });
}

// ---------------------------------------------------------------------------
// Shared state scaffolding
// ---------------------------------------------------------------------------

interface Fixture {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
}

function makeFixture(): Fixture {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const ids = Array.from(state.players.keys());
  const aliceId = ids[0];
  const bobId = ids[1];

  state.status = "in_progress";
  state.priorityPlayerId = aliceId;
  state.turn.activePlayerId = aliceId;
  state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  state.stack = [];
  state.consecutivePasses = 0;
  state.players.forEach((p) =>
    state.players.set(p.id, { ...p, hasPassedPriority: false }),
  );

  return { state, aliceId, bobId };
}

/**
 * Place a permanent on a player's battlefield. Default: untapped, NO summoning
 * sickness (mirrors the prowess fixture — convoke does not interact with
 * summoning sickness per CR 302.6, but tests that care about the flag can
 * pass `summoningSick: true`).
 */
function putOnBattlefield(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
  opts: { tapped?: boolean; summoningSick?: boolean } = {},
): CardInstance {
  const card = createCardInstance(cardData, playerId, playerId);
  card.hasSummoningSickness = opts.summoningSick ?? false;
  card.isTapped = opts.tapped ?? false;
  card.currentZoneKey = `${playerId}-battlefield`;
  state.cards.set(card.id, card);
  const bf = state.zones.get(`${playerId}-battlefield`)!;
  state.zones.set(`${playerId}-battlefield`, {
    ...bf,
    cardIds: [...bf.cardIds, card.id],
  });
  return card;
}

/** Place a card into a player's hand. */
function putInHand(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  card.currentZoneKey = `${playerId}-hand`;
  state.cards.set(card.id, card);
  const hand = state.zones.get(`${playerId}-hand`)!;
  state.zones.set(`${playerId}-hand`, {
    ...hand,
    cardIds: [...hand.cardIds, card.id],
  });
  return card.id;
}

/** Read a player's mana pool total (for spent-mana assertions). */
function manaTotal(state: GameState, playerId: PlayerId): number {
  const p = state.players.get(playerId)!;
  return (
    p.manaPool.generic +
    p.manaPool.colorless +
    p.manaPool.white +
    p.manaPool.blue +
    p.manaPool.black +
    p.manaPool.red +
    p.manaPool.green
  );
}

// ===========================================================================
// Parsing (CR 702.93)
// ===========================================================================

describe("Convoke — parsing (CR 702.93)", () => {
  it("parseConvoke detects the 'Convoke' keyword", () => {
    const r = parseConvoke("Convoke");
    expect(r.hasConvoke).toBe(true);
    expect(r.description).toBe("Convoke");
  });

  it("parseConvoke detects 'Convoke' alongside other rules text", () => {
    expect(
      parseConvoke("Convoke\nStoke the Flames deals 4 damage to any target.")
        .hasConvoke,
    ).toBe(true);
  });

  it("parseConvoke is case-insensitive", () => {
    expect(parseConvoke("convoke").hasConvoke).toBe(true);
    expect(parseConvoke("CONVOKE").hasConvoke).toBe(true);
    expect(parseConvoke("CoNvOkE").hasConvoke).toBe(true);
  });

  it("parseConvoke tolerates the reminder-text form", () => {
    expect(
      parseConvoke(
        "Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)",
      ).hasConvoke,
    ).toBe(true);
  });

  it("parseConvoke returns false when the keyword is absent", () => {
    expect(parseConvoke("Flying").hasConvoke).toBe(false);
    expect(parseConvoke("Flashback {2}{R}").hasConvoke).toBe(false);
    expect(parseConvoke("Kicker {1}{G}").hasConvoke).toBe(false);
  });

  it("parseConvoke returns false for empty / nullish text", () => {
    expect(parseConvoke("").hasConvoke).toBe(false);
    expect(parseConvoke("").description).toBe("");
    expect(parseConvoke(null as unknown as string).hasConvoke).toBe(false);
  });

  it("parseConvoke does not match 'convoke' inside other words", () => {
    // Word-boundary anchored: "convoked" is its own word and should NOT match
    // "convoke" (it would be a different rules concept). The word-boundary
    // regex catches this.
    expect(parseConvoke("convoked").hasConvoke).toBe(false);
    expect(parseConvoke("nonconvokeing").hasConvoke).toBe(false);
  });
});

// ===========================================================================
// castSpell — the alternative-cost switch branch (CR 702.93)
// ===========================================================================

describe("Convoke — castSpell cost reduction (CR 702.93b/c)", () => {
  it("taps a colored creature to pay one pip of that color", () => {
    // {2}{R}{R} convoke sorcery; Alice has 2 red creatures, taps both to pay
    // both {R} pips; remaining {2} paid from pool.
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, convokeSorcery());
    const r1 = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-red-1", "R", "Goblin"),
    );
    const r2 = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-red-2", "R", "Goblin"),
    );
    state = addMana(state, aliceId, { generic: 2 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [r1.id, r2.id],
    });

    expect(result.success).toBe(true);
    const after = result.state;
    // Spell is on the stack
    expect(after.zones.get("stack")!.cardIds).toContain(spellId);
    // Both red creatures are tapped
    expect(after.cards.get(r1.id)!.isTapped).toBe(true);
    expect(after.cards.get(r2.id)!.isTapped).toBe(true);
    // alternativeCostsUsed recorded convoke
    expect(after.stack[0].alternativeCostsUsed).toContain("convoke");
    // Mana pool: 2 generic spent on the {2} pip → pool now 0 generic
    expect(after.players.get(aliceId)!.manaPool.generic).toBe(0);
  });

  it("a colorless creature can only pay for a generic pip (CR 702.93c)", () => {
    // {2}{R}{R} convoke sorcery; one red creature + one colorless creature.
    // Reduces one {R} and one {1}. Remaining: {1}{R} must come from pool.
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, convokeSorcery());
    const red = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-red", "R", "Goblin"),
    );
    const cc = putOnBattlefield(state, aliceId, colorlessCreature("c-cc"));
    state = addMana(state, aliceId, { red: 1, generic: 1 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [red.id, cc.id],
    });

    expect(result.success).toBe(true);
    const after = result.state;
    expect(after.cards.get(red.id)!.isTapped).toBe(true);
    expect(after.cards.get(cc.id)!.isTapped).toBe(true);
    // Pool: 1 red + 1 generic spent on the remaining {R}{1} → 0 each.
    expect(after.players.get(aliceId)!.manaPool.red).toBe(0);
    expect(after.players.get(aliceId)!.manaPool.generic).toBe(0);
  });

  it("a colored creature pays for a generic pip when no colored pip is left", () => {
    // {2}{R}{R} convoke sorcery; Alice has three red creatures but no mana.
    // Two red creatures reduce both {R} pips. The third red creature, with no
    // colored pip remaining, must reduce a generic pip (CR 702.93c "any
    // creature"). Remaining {1} can't be paid → fails. To prove the
    // generic-reduction, we instead provide one generic mana in the pool.
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, convokeSorcery());
    const r1 = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-r1", "R", "Goblin"),
    );
    const r2 = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-r2", "R", "Goblin"),
    );
    const r3 = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-r3", "R", "Goblin"),
    );
    state = addMana(state, aliceId, { generic: 1 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [r1.id, r2.id, r3.id],
    });

    expect(result.success).toBe(true);
    const after = result.state;
    expect(after.cards.get(r1.id)!.isTapped).toBe(true);
    expect(after.cards.get(r2.id)!.isTapped).toBe(true);
    expect(after.cards.get(r3.id)!.isTapped).toBe(true);
    // The 1 generic in the pool paid the second generic pip (the third
    // creature paid the first generic pip).
    expect(after.players.get(aliceId)!.manaPool.generic).toBe(0);
  });

  it("convoke can pay the entire cost with no mana in the pool", () => {
    // {2}{R}{R} = 4 pips. Alice taps 4 red creatures. Pool empty.
    const { state, aliceId } = makeFixture();
    const spellId = putInHand(state, aliceId, convokeSorcery());
    const rs = [
      putOnBattlefield(state, aliceId, monoCreature("c-r1", "R", "Goblin")),
      putOnBattlefield(state, aliceId, monoCreature("c-r2", "R", "Goblin")),
      putOnBattlefield(state, aliceId, monoCreature("c-r3", "R", "Goblin")),
      putOnBattlefield(state, aliceId, monoCreature("c-r4", "R", "Goblin")),
    ];

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: rs.map((c) => c.id),
    });

    expect(result.success).toBe(true);
    // Two paid the {R}{R} pips; the other two paid the {1}{1} generic pips.
    for (const c of rs) {
      expect(result.state.cards.get(c.id)!.isTapped).toBe(true);
    }
    // Pool untouched (was empty).
    expect(manaTotal(result.state, aliceId)).toBe(0);
  });

  it("multi-color creature pays the first matching unpaid colored pip", () => {
    // {W}{U}{B}{R}{G} convoke sorcery. Tap one of each color creature in
    // W/U/B/R/G order — each creature reduces its own color pip. Pool empty.
    const { state, aliceId } = makeFixture();
    const spellId = putInHand(state, aliceId, rainbowConvokeSorcery());
    const w = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-w", "W", "Soldier"),
    );
    const u = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-u", "U", "Bird"),
    );
    const b = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-b", "B", "Zombie"),
    );
    const r = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-r", "R", "Goblin"),
    );
    const g = putOnBattlefield(state, aliceId, monoCreature("c-g", "G", "Elf"));

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [w.id, u.id, b.id, r.id, g.id],
    });

    expect(result.success).toBe(true);
    for (const c of [w, u, b, r, g]) {
      expect(result.state.cards.get(c.id)!.isTapped).toBe(true);
    }
    // Pool empty, fully convoke-paid.
    expect(manaTotal(result.state, aliceId)).toBe(0);
  });

  it("convoke combines with mana already in the pool", () => {
    // {2}{R}{R} = 4 pips. Alice taps 1 red creature (-1 {R}), pays {2}{R} from
    // the pool. Pre-check passes because castSpell does the authoritative
    // math after convoke reduction.
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, convokeSorcery());
    const red = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-red", "R", "Goblin"),
    );
    state = addMana(state, aliceId, { red: 1, generic: 2 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [red.id],
    });

    expect(result.success).toBe(true);
    expect(result.state.cards.get(red.id)!.isTapped).toBe(true);
    // Pool: 1 red + 2 generic spent on the remaining {R}{2}.
    expect(result.state.players.get(aliceId)!.manaPool.red).toBe(0);
    expect(result.state.players.get(aliceId)!.manaPool.generic).toBe(0);
  });

  it("over-declared convoke still taps the extra creature (CR 702.93a)", () => {
    // {1}{R} convoke-flavored sorcery. Alice declares 3 red creatures — the
    // first reduces {R}, the second reduces {1}, the third reduces nothing
    // but is still tapped. CR 702.93a allows declaring creatures that
    // contribute nothing; the tap is binding.
    const cheapConvoke = makeCard({
      id: "mock-gather-the-masses",
      name: "Gather",
      type_line: "Sorcery",
      oracle_text: "Convoke\nDraw a card.",
      mana_cost: "{1}{R}",
      cmc: 2,
      colors: ["R"],
      color_identity: ["R"],
      keywords: ["convoke"],
    });
    const { state, aliceId } = makeFixture();
    const spellId = putInHand(state, aliceId, cheapConvoke);
    const r1 = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-r1", "R", "Goblin"),
    );
    const r2 = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-r2", "R", "Goblin"),
    );
    const r3 = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-r3", "R", "Goblin"),
    );

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [r1.id, r2.id, r3.id],
    });

    expect(result.success).toBe(true);
    // ALL three creatures tapped, including the over-declared one.
    expect(result.state.cards.get(r1.id)!.isTapped).toBe(true);
    expect(result.state.cards.get(r2.id)!.isTapped).toBe(true);
    expect(result.state.cards.get(r3.id)!.isTapped).toBe(true);
  });

  it("spells WITHOUT the Convoke keyword are not reduced even when convokeCreatures is passed", () => {
    // The convoke switch branch only fires when parseConvoke returns true.
    // Otherwise the keyword is silently dropped (matches the engine's
    // established convention for caller-declared alt cost types whose
    // oracle text does not support them).
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, nonConvokeSorcery());
    const red = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-red", "R", "Goblin"),
    );
    // Pool covers the FULL printed {2}{R}{R} cost — castSpell must NOT use
    // the creature since the spell lacks the Convoke keyword.
    state = addMana(state, aliceId, { red: 2, generic: 2 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [red.id],
    });

    // Cast succeeds because the pool covers the full printed cost —
    // the creature is NOT used and is NOT tapped.
    expect(result.success).toBe(true);
    expect(result.state.cards.get(red.id)!.isTapped).toBe(false);
    expect(result.state.stack[0].alternativeCostsUsed).not.toContain("convoke");
    // Pool spent for the full {2}{R}{R} = 2 red + 2 generic.
    expect(result.state.players.get(aliceId)!.manaPool.red).toBe(0);
    expect(result.state.players.get(aliceId)!.manaPool.generic).toBe(0);
  });
});

// ===========================================================================
// castSpell — convoke + mana-pool fall-through
// ===========================================================================

describe("Convoke — affordability fall-through", () => {
  it("insufficient convoke + insufficient mana → 'Not enough energy'", () => {
    // {2}{R}{R} = 4 pips. Alice taps only 1 red creature. Remaining {2}{R}
    // cannot be paid from an empty pool.
    const { state, aliceId } = makeFixture();
    const spellId = putInHand(state, aliceId, convokeSorcery());
    const red = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-red", "R", "Goblin"),
    );

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [red.id],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/energy/i);
    // State returned unchanged on failure — the creature is NOT tapped.
    expect(result.state.cards.get(red.id)!.isTapped).toBe(false);
  });

  it("a colorless creature alone cannot pay a colored pip", () => {
    // {1}{R} convoke sorcery. Alice taps only a colorless creature (no {1}
    // available reduction because there's no generic pip... wait, there IS
    // a generic pip). Use a {R}{R} sorcery instead so the colorless creature
    // can't help and the cast fails on the {R}{R} pips.
    const twoRedConvoke = makeCard({
      id: "mock-two-red",
      name: "Double Red",
      type_line: "Sorcery",
      oracle_text: "Convoke\nDeal 2 damage.",
      mana_cost: "{R}{R}",
      cmc: 2,
      colors: ["R"],
      color_identity: ["R"],
      keywords: ["convoke"],
    });
    const { state, aliceId } = makeFixture();
    const spellId = putInHand(state, aliceId, twoRedConvoke);
    const cc = putOnBattlefield(state, aliceId, colorlessCreature("c-cc"));

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [cc.id],
    });

    // Colorless creature cannot reduce a colored pip. Both {R}{R} unpayable.
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/energy/i);
  });

  it("convoke with empty convokeCreatures uses only the mana pool", () => {
    // Same as casting without convoke — full cost paid from pool.
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, convokeSorcery());
    putOnBattlefield(state, aliceId, monoCreature("c-red", "R", "Goblin")); // available but not declared
    state = addMana(state, aliceId, { red: 2, generic: 2 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [],
    });

    expect(result.success).toBe(true);
    // The available (but undeclared) creature is NOT tapped.
    const goblin = Array.from(result.state.cards.values()).find(
      (c) => c.cardData.name === "Goblin",
    );
    expect(goblin!.isTapped).toBe(false);
    // Pool spent for the full {2}{R}{R}.
    expect(result.state.players.get(aliceId)!.manaPool.red).toBe(0);
    expect(result.state.players.get(aliceId)!.manaPool.generic).toBe(0);
  });
});

// ===========================================================================
// castSpell — validation rules (CR 702.93a)
// ===========================================================================

describe("Convoke — validation rules (CR 702.93a)", () => {
  it("rejects an already-tapped creature", () => {
    const { state, aliceId } = makeFixture();
    const spellId = putInHand(state, aliceId, convokeSorcery());
    const tapped = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-r", "R", "Goblin"),
      {
        tapped: true,
      },
    );

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [tapped.id],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already tapped/i);
  });

  it("rejects a creature controlled by an opponent", () => {
    const { state, aliceId, bobId } = makeFixture();
    const spellId = putInHand(state, aliceId, convokeSorcery());
    // Bob controls the red creature.
    const bobs = putOnBattlefield(
      state,
      bobId,
      monoCreature("c-bob-r", "R", "Goblin"),
    );

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [bobs.id],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/controller/i);
  });

  it("rejects a non-creature permanent (e.g. a land)", () => {
    const { state, aliceId } = makeFixture();
    const spellId = putInHand(state, aliceId, convokeSorcery());
    const land = putOnBattlefield(
      state,
      aliceId,
      nonCreatureLand("mountain-1"),
    );

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [land.id],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a creature/i);
  });

  it("rejects a duplicate creature in the tap list", () => {
    const { state, aliceId } = makeFixture();
    const spellId = putInHand(state, aliceId, convokeSorcery());
    const red = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-r", "R", "Goblin"),
    );

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [red.id, red.id],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/more than once/i);
  });

  it("rejects a card id that is not on the battlefield", () => {
    const { state, aliceId } = makeFixture();
    const spellId = putInHand(state, aliceId, convokeSorcery());
    // A creature in hand (not on the battlefield).
    const inHand = putInHand(
      state,
      aliceId,
      monoCreature("c-hand", "R", "Goblin"),
    );

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [inHand],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/battlefield/i);
  });

  it("summoning-sick creatures CAN be convoked (CR 302.6 — convoke is not a {T} ability)", () => {
    // NOTE: this overrides the issue's mistaken acceptance criterion that
    // summoning-sick creatures be rejected. Per actual CR, convoke taps the
    // creature as part of paying the spell's cost — it is NOT the activation
    // of a {T}/{Q} ability, so summoning sickness (CR 302.6) does not apply.
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, convokeSorcery());
    const sick = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-sick", "R", "Goblin"),
      { summoningSick: true },
    );
    state = addMana(state, aliceId, { red: 1, generic: 2 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [sick.id],
    });

    expect(result.success).toBe(true);
    expect(result.state.cards.get(sick.id)!.isTapped).toBe(true);
  });
});

// ===========================================================================
// castSpell — post-cast state invariants
// ===========================================================================

describe("Convoke — post-cast state invariants", () => {
  it("tapped-for-convoke creatures remain tapped after the cast resolves the cost step", () => {
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, convokeSorcery());
    const r1 = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-r1", "R", "Goblin"),
    );
    const r2 = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-r2", "R", "Goblin"),
    );
    state = addMana(state, aliceId, { generic: 2 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [r1.id, r2.id],
    });

    expect(result.success).toBe(true);
    expect(result.state.cards.get(r1.id)!.isTapped).toBe(true);
    expect(result.state.cards.get(r2.id)!.isTapped).toBe(true);
  });

  it("untapped creatures NOT in the convoke list remain untapped", () => {
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, convokeSorcery());
    const tapped = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-tap", "R", "Goblin"),
    );
    const idle = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-idle", "R", "Goblin"),
    );
    state = addMana(state, aliceId, { red: 1, generic: 2 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [tapped.id],
    });

    expect(result.success).toBe(true);
    expect(result.state.cards.get(tapped.id)!.isTapped).toBe(true);
    expect(result.state.cards.get(idle.id)!.isTapped).toBe(false);
  });

  it("the spell stack object records 'convoke' in alternativeCostsUsed", () => {
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, convokeSorcery());
    const r1 = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-r1", "R", "Goblin"),
    );
    const r2 = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-r2", "R", "Goblin"),
    );
    state = addMana(state, aliceId, { generic: 2 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [r1.id, r2.id],
    });

    expect(result.success).toBe(true);
    expect(result.state.stack[0].alternativeCostsUsed).toContain("convoke");
  });
});

// ===========================================================================
// Validation service — printed-cost precheck bypass
// ===========================================================================

describe("Convoke — validation-service bypass", () => {
  it("the printed-cost precheck does NOT reject a legal convoke cast", () => {
    // The validation service's pre-check would normally reject a {2}{R}{R}
    // cast when the player's pool only covers {2} generic. For convoke, the
    // pre-check is bypassed so castSpell can do the authoritative math after
    // applying convoke reductions. If the bypass is missing, this test fails
    // with a "Not enough colored mana" reason from the validation service.
    const f = makeFixture();
    const aliceId = f.aliceId;
    let state = f.state;
    const spellId = putInHand(state, aliceId, convokeSorcery());
    const r1 = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-r1", "R", "Goblin"),
    );
    const r2 = putOnBattlefield(
      state,
      aliceId,
      monoCreature("c-r2", "R", "Goblin"),
    );
    state = addMana(state, aliceId, { generic: 2 });

    const result = castSpell(state, aliceId, spellId, [], [], 0, false, {
      type: "convoke",
      convokeCreatures: [r1.id, r2.id],
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
