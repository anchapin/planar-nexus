/**
 * Infect keyword enforcement (CR 702.90) — issue #2351.
 *
 * Pins every defect fixed in this epic iteration. The engine cited **CR 702.93**
 * for infect, which is *convoke*; infect is CR 702.90a–f (glossary CR 702.12),
 * and toxic is CR 702.95.
 *
 *   1. FALSE POSITIVES on the live gate. `evergreen-keywords.hasInfect` was
 *      `hasKeyword(card, "infect")`, whose oracle-text arm is an **unanchored**
 *      `oracleText.includes("infect")`. Unlike mutate (#2346) nothing filtered
 *      it upstream — it is read directly at four sites in live combat
 *      resolution, so real permanents were affected (see the live-combat pins
 *      below for Vector Asp and Melira, the two that actually change the
 *      outcome of a game).
 *   2. Anchoring alone is NOT enough. `/\binfect\b/i` still matches "This
 *      creature gains infect until end of turn" and "Creatures your opponents
 *      control lose infect", so the fallback also rejects grant/negation
 *      phrases (see `oracleTextDeclaresOwnKeyword` in
 *      `keyword-actions/grant-negation.ts`).
 *   3. CR 702.90e — infect works from any zone. The conversion used to be
 *      hardcoded in `combat/resolution.ts`, so non-combat damage never
 *      converted. It now lives in `dealDamageToCard`.
 *   4. Infect damage bypassed protection and the whole replacement pipeline,
 *      because the old branch called `addCounters` directly.
 *   5. infect + deathtouch destroyed a legal permanent — CR 702.90c says the
 *      damage "isn't marked on that creature", so deathtouch lethality must not
 *      be layered on top of the -1/-1 counters.
 *   6. infect + toxic asymmetry: the unblocked path stacked both, the trample
 *      path omitted toxic.
 *
 * Per the epic convention, this file's helpers do **NOT** backfill `oracle_text`
 * from the keyword list (`combat.test.ts:51` and
 * `deathtouch-spell-damage.test.ts:57` both do that; `createMockCreature` in
 * `keyword-enforcement.test.ts` does too) — every case below states the exact
 * card data under test, which is the whole point for the false-positive pins.
 */
import { describe, it, expect } from "@jest/globals";
import type { CardInstance, GameState, PlayerId, ScryfallCard } from "../types";
import { Phase } from "../types";
import { hasInfectStrict } from "../keyword-actions/infect";
import { hasInfect } from "../evergreen-keywords";
import { dealDamageToCard } from "../keyword-actions";
import { createInitialGameState, startGame } from "../game-state";
import {
  createCardInstance,
  initializePlaneswalkerLoyalty,
} from "../card-instance";
import {
  declareAttackers,
  declareBlockers,
  resolveCombatDamage,
} from "../combat";

// ---------------------------------------------------------------------------
// Card factories — explicit oracle text, never derived from the keyword list
// ---------------------------------------------------------------------------

let cardIdCounter = 0;
function uniqueId(prefix: string): string {
  cardIdCounter += 1;
  return `${prefix}-${cardIdCounter}`;
}

function cardDataFor(over: {
  name: string;
  typeLine: string;
  oracleText?: string;
  keywords?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors?: string[];
}): ScryfallCard {
  return {
    id: uniqueId("infect"),
    name: over.name,
    type_line: over.typeLine,
    power: over.power,
    toughness: over.toughness,
    loyalty: over.loyalty,
    keywords: over.keywords ?? [],
    // Explicit, and empty unless the case under test says otherwise.
    oracle_text: over.oracleText ?? "",
    mana_cost: "{1}",
    cmc: 1,
    colors: over.colors ?? [],
    color_identity: over.colors ?? [],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

/** A plain `CardInstance` for the pure detection gates. */
function instance(over: {
  name: string;
  typeLine?: string;
  oracleText?: string;
  keywords?: string[];
}): CardInstance {
  const data = cardDataFor({
    name: over.name,
    typeLine: over.typeLine ?? "Creature — Snake",
    oracleText: over.oracleText,
    keywords: over.keywords,
  });
  return {
    id: data.id,
    cardData: data,
    ownerId: "player1",
    controllerId: "player1",
    zone: "battlefield",
    counters: [],
    statusFlags: {},
  } as unknown as CardInstance;
}

interface CombatCreature {
  name: string;
  power: number;
  toughness: number;
  keywords?: string[];
  oracleText?: string;
  typeLine?: string;
  colors?: string[];
  loyalty?: string;
  /** Pre-existing counters, e.g. two +1/+1 for the infect+deathtouch pin. */
  counters?: CardInstance["counters"];
}

function putOnBattlefield(
  state: GameState,
  controllerId: PlayerId,
  spec: CombatCreature,
): string {
  const data = cardDataFor({
    name: spec.name,
    typeLine: spec.typeLine ?? "Creature — Test",
    oracleText: spec.oracleText,
    keywords: spec.keywords,
    power: String(spec.power),
    toughness: String(spec.toughness),
    loyalty: spec.loyalty,
    colors: spec.colors,
  });
  let card = createCardInstance(data, controllerId, controllerId);
  card = initializePlaneswalkerLoyalty(card);
  card = { ...card, hasSummoningSickness: false };
  if (spec.counters?.length) {
    card = { ...card, counters: spec.counters };
  }
  state.cards.set(card.id, card);
  const battlefield = state.zones.get(`${controllerId}-battlefield`)!;
  state.zones.set(`${controllerId}-battlefield`, {
    ...battlefield,
    cardIds: [...battlefield.cardIds, card.id],
  });
  return card.id;
}

function makeGame(): {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
} {
  const state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
  const playerIds = Array.from(state.players.keys());
  return { state, aliceId: playerIds[0], bobId: playerIds[1] };
}

/** Declare `attackerId` against `defenderId`, optionally blocked, then resolve. */
function runCombat(
  state: GameState,
  attackerId: string,
  defenderId: PlayerId,
  blockers?: Map<string, string[]>,
): GameState {
  let s: GameState = {
    ...state,
    turn: { ...state.turn, currentPhase: Phase.DECLARE_ATTACKERS },
  };
  const atk = declareAttackers(s, [{ cardId: attackerId, defenderId }]);
  if (blockers && blockers.size > 0) {
    s = {
      ...atk.state,
      turn: { ...atk.state.turn, currentPhase: Phase.DECLARE_BLOCKERS },
    };
    const blk = declareBlockers(s, blockers);
    return resolveCombatDamage(blk.state).state;
  }
  return resolveCombatDamage(atk.state).state;
}

function minusOneCounters(state: GameState, cardId: string): number {
  return (
    state.cards.get(cardId)?.counters.find((c) => c.type === "-1/-1")?.count ??
    0
  );
}

// ---------------------------------------------------------------------------
// 1. The gates
// ---------------------------------------------------------------------------

const GATES: Array<[string, (c: CardInstance) => boolean]> = [
  ["keyword-actions/infect#hasInfectStrict", hasInfectStrict],
  ["evergreen-keywords#hasInfect", hasInfect],
];

describe("CR 702.90 infect — keyword detection (#2351)", () => {
  describe.each(GATES)("%s", (_name, gate) => {
    describe("true positives — genuinely has infect", () => {
      it("accepts the real Scryfall shape: keyword tag, no oracle text", () => {
        expect(gate(instance({ name: "Infected", keywords: ["Infect"] }))).toBe(
          true,
        );
      });

      it("accepts a lowercase keyword tag (case-insensitive)", () => {
        expect(gate(instance({ name: "Infected", keywords: ["infect"] }))).toBe(
          true,
        );
      });

      it("accepts a real infect creature with both the tag and its rules text", () => {
        // As Scryfall shapes it: the tag AND the spelled-out reminder.
        expect(
          gate(
            instance({
              name: "Contagion Dispenser",
              keywords: ["Infect"],
              oracleText:
                "Infect (Damage this creature deals to players is dealt as poison counters, and to creatures as -1/-1 counters.)",
            }),
          ),
        ).toBe(true);
      });
    });

    describe("false positives — real cards that do NOT have infect", () => {
      // Every case below is a real permanent whose Scryfall `keywords` array is
      // `[]`. All of them read `true` through the old unanchored gate.
      const FALSE_POSITIVES: Array<[string, string, string]> = [
        [
          "Vector Asp",
          "Artifact Creature — Phyrexian Snake",
          "{B}: This creature gains infect until end of turn.",
        ],
        [
          "Pestilent Souleater",
          "Artifact Creature — Phyrexian Insect",
          "{B/P}: This creature gains infect until end of turn.",
        ],
        [
          "Melira, Sylvok Outcast",
          "Legendary Creature — Human Scout",
          "Creatures your opponents control lose infect.",
        ],
        [
          "Viridian Betrayers",
          "Creature — Phyrexian Elf Warrior",
          "Viridian Betrayers has infect as long as an opponent is poisoned.",
        ],
        [
          "Triumph of the Hordes",
          "Enchantment — Aura",
          "Creatures you control with infect get +1/+1 until end of turn.",
        ],
        [
          "Corpsejack Menace",
          "Creature — Zombie Warrior",
          "Whenever a creature with infect blocks or is blocked by a creature, you may pay 1 life. If you don't, that creature gains infect until end of turn.",
        ],
        [
          "Phyrexian Unlife",
          "Enchantment",
          "Until end of turn, creatures you control gain infect.",
        ],
        [
          "Inkmoth Nexus",
          "Land",
          "This land is a creature 1/1 with flying and reach. {3}: This land becomes a creature 2/2 with infect until end of turn.",
        ],
        [
          "Genestealer Patriarch",
          "Creature — Phyrexian Beast",
          "Whenever a token enters the battlefield under your control, put a +1/+1 counter on it and create a 1/1 green Phyrexian artifact creature token with infect.",
        ],
        ["Infective Serum", "Artifact", "Infective growth consumes the weak."],
      ];

      it.each(FALSE_POSITIVES)(
        "rejects %s (no keyword tag, word appears in oracle text)",
        (name, typeLine, oracleText) => {
          const card = instance({ name, typeLine, oracleText });
          expect(card.cardData.keywords).toEqual([]);
          expect(gate(card)).toBe(false);
        },
      );

      it("rejects a card with no keyword tag and no oracle text at all", () => {
        expect(gate(instance({ name: "Blank Permanent" }))).toBe(false);
      });
    });

    describe("false positives — the bare substring, anchored away", () => {
      it("rejects 'infection' (the substring inside the word)", () => {
        expect(
          gate(
            instance({
              name: "Some Aura",
              oracleText:
                "At the beginning of your upkeep, you get a counter for each infection.",
            }),
          ),
        ).toBe(false);
      });

      it("rejects 'Infective' (flavor adjective)", () => {
        expect(
          gate(
            instance({
              name: "Fungal Sporulation",
              oracleText: "Infective growth consumes the weak.",
            }),
          ),
        ).toBe(false);
      });

      it("rejects a keyword entry of 'infects' (a mention, not the keyword)", () => {
        expect(
          gate(instance({ name: "Plague Bearer", keywords: ["infects"] })),
        ).toBe(false);
      });
    });
  });

  describe("the strict and canonical gates agree", () => {
    // The whole point of the strict-first shape: two exports, one answer.
    // The single deliberate exception is the untagged written-out ability,
    // which only the canonical fallback can see (asserted below).
    const CARDS = [
      instance({ name: "Infected", keywords: ["Infect"] }),
      instance({ name: "Infected Lower", keywords: ["infect"] }),
      instance({
        name: "Infection Aura",
        oracleText: "one counter per infection.",
      }),
      instance({
        name: "Vector Asp",
        oracleText: "{B}: This creature gains infect until end of turn.",
      }),
      instance({
        name: "Melira, Sylvok Outcast",
        oracleText: "Creatures your opponents control lose infect.",
      }),
      instance({ name: "Blank Permanent" }),
    ];

    it.each(CARDS.map((c) => [c.cardData.name, c] as [string, CardInstance]))(
      "%s — both gates return the same value",
      (_name, card) => {
        expect(hasInfect(card)).toBe(hasInfectStrict(card));
      },
    );

    it("canonical accepts an untagged written-out 'This creature has infect.'", () => {
      // Written-out-ability true positive. Bare "has infect" is deliberately
      // NOT in the grant/negation list: a false negative on a real infect card
      // costs its damage conversion, while a false positive is what this
      // issue is fixing.
      const card = instance({
        name: "Phyrexian Distemper",
        oracleText: "This creature has infect.",
      });
      expect(hasInfect(card)).toBe(true);
      // The strict gate cannot see it — that is its contract, not a bug.
      expect(hasInfectStrict(card)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Live combat — the false positives that actually change a game
// ---------------------------------------------------------------------------

describe("CR 702.90 infect — live combat damage (#2351)", () => {
  it("Vector Asp that never paid its {B} deals life loss, not poison (702.90b does not apply)", () => {
    // Unblocked 2/2, keywords: [], real Scryfall shape. Old gate: poison.
    const { state, aliceId, bobId } = makeGame();
    const attackerId = putOnBattlefield(state, aliceId, {
      name: "Vector Asp",
      power: 2,
      toughness: 2,
      typeLine: "Artifact Creature — Phyrexian Snake",
      oracleText: "{B}: This creature gains infect until end of turn.",
    });

    const after = runCombat(state, attackerId, bobId);
    const bob = after.players.get(bobId)!;
    expect(bob.life).toBe(18);
    expect(bob.poisonCounters).toBe(0);
  });

  it("Melira does not deal poison — her text removes infect, it does not grant it", () => {
    const { state, aliceId, bobId } = makeGame();
    const attackerId = putOnBattlefield(state, aliceId, {
      name: "Melira, Sylvok Outcast",
      power: 2,
      toughness: 2,
      typeLine: "Legendary Creature — Human Scout",
      oracleText: "Creatures your opponents control lose infect.",
    });

    const after = runCombat(state, attackerId, bobId);
    const bob = after.players.get(bobId)!;
    expect(bob.life).toBe(18);
    expect(bob.poisonCounters).toBe(0);
  });

  it("a real infect attacker deals poison counters and no life loss (CR 702.90b)", () => {
    const { state, aliceId, bobId } = makeGame();
    const attackerId = putOnBattlefield(state, aliceId, {
      name: "Blightsteel Colossus",
      power: 3,
      toughness: 4,
      keywords: ["Infect"],
    });

    const after = runCombat(state, attackerId, bobId);
    const bob = after.players.get(bobId)!;
    expect(bob.poisonCounters).toBe(3);
    expect(bob.life).toBe(20);
  });

  it("a real infect attacker places -1/-1 counters on a blocker (CR 702.90c)", () => {
    const { state, aliceId, bobId } = makeGame();
    const attackerId = putOnBattlefield(state, aliceId, {
      name: "Blightsteel Colossus",
      power: 3,
      toughness: 4,
      keywords: ["Infect"],
    });
    const blockerId = putOnBattlefield(state, bobId, {
      name: "Elf",
      power: 2,
      toughness: 5,
    });

    const after = runCombat(
      state,
      attackerId,
      bobId,
      new Map([[attackerId, [blockerId]]]),
    );
    expect(minusOneCounters(after, blockerId)).toBe(3);
    expect(after.cards.get(blockerId)!.damage).toBe(0);
  });

  it("a real infect blocker places -1/-1 counters on the attacker (CR 702.90c)", () => {
    const { state, aliceId, bobId } = makeGame();
    // Attacker big enough to survive the counters, so the counters are
    // observable — a 2/2 would die to SBA 704.5g and lose them on the way to
    // the graveyard (counters are cleared on a zone change).
    const attackerId = putOnBattlefield(state, aliceId, {
      name: "Craw Wurm",
      power: 6,
      toughness: 4,
    });
    const blockerId = putOnBattlefield(state, bobId, {
      name: "Contagion Dispenser",
      power: 2,
      toughness: 2,
      keywords: ["Infect"],
    });

    const after = runCombat(
      state,
      attackerId,
      bobId,
      new Map([[attackerId, [blockerId]]]),
    );
    expect(minusOneCounters(after, attackerId)).toBe(2);
    expect(after.cards.get(attackerId)!.damage).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. infect + deathtouch — 702.90c forbids marking the damage
// ---------------------------------------------------------------------------

describe("CR 702.90c — infect + deathtouch does not destroy", () => {
  it("a 1/1 infect+deathtouch leaves a 4/4 blocker (two +1/+1 counters) alive at 3/3", () => {
    // The measured false kill: the old code marked lethal damage ON TOP of the
    // -1/-1 counters, so a legal permanent died. 702.90c says the damage "isn't
    // marked on that creature", and 702.2b has nothing to apply to.
    const { state, aliceId, bobId } = makeGame();
    const attackerId = putOnBattlefield(state, aliceId, {
      name: "Infect Deathtoucher",
      power: 1,
      toughness: 1,
      keywords: ["Infect", "Deathtouch"],
    });
    const blockerId = putOnBattlefield(state, bobId, {
      name: "Bonecrusher Giant",
      power: 2,
      toughness: 2,
      counters: [{ type: "+1/+1", count: 2 }],
    });

    const after = runCombat(
      state,
      attackerId,
      bobId,
      new Map([[attackerId, [blockerId]]]),
    );

    // The blocker survives, and crucially nothing was marked on it. Note the
    // counter layout: the -1/-1 placed by infect pairs off against a +1/+1
    // under SBA 704.5q, leaving one +1/+1 and no -1/-1 — i.e. a 3/3.
    expect(after.cards.get(blockerId)!.damage).toBe(0);
    expect(minusOneCounters(after, blockerId)).toBe(0);
    expect(
      after.cards.get(blockerId)!.counters.find((c) => c.type === "+1/+1")
        ?.count,
    ).toBe(1);
    const graveyard = after.zones.get(`${bobId}-graveyard`)!;
    expect(graveyard.cardIds).not.toContain(blockerId);
  });

  it("a deathtouch attacker with no infect still destroys a blocker (CR 702.2b unchanged)", () => {
    // Control case: gating the lethal marking on infect must not have
    // weakened deathtouch.
    const { state, aliceId, bobId } = makeGame();
    const attackerId = putOnBattlefield(state, aliceId, {
      name: "Plague Wight",
      power: 2,
      toughness: 1,
      keywords: ["Deathtouch"],
    });
    const blockerId = putOnBattlefield(state, bobId, {
      name: "Elf",
      power: 2,
      toughness: 2,
    });

    const after = runCombat(
      state,
      attackerId,
      bobId,
      new Map([[attackerId, [blockerId]]]),
    );
    const graveyard = after.zones.get(`${bobId}-graveyard`)!;
    expect(graveyard.cardIds).toContain(blockerId);
  });
});

// ---------------------------------------------------------------------------
// 4. infect + toxic on trample excess — the asymmetry
// ---------------------------------------------------------------------------

describe("CR 702.90b + 702.95 — infect and toxic stack on trample excess", () => {
  it("a blocked 3/1 infect+Toxic 2 trampler deals 4 poison to the player", () => {
    // Unblocked, this creature already stacked both (2 infect + 2 toxic for a
    // 3-power attack; here 1 point is assigned to the blocker, so 2 excess
    // poison + 2 toxic = 4). The trample branch used to drop the toxic half.
    const { state, aliceId, bobId } = makeGame();
    const attackerId = putOnBattlefield(state, aliceId, {
      name: "Deadly Visitor",
      power: 3,
      toughness: 1,
      keywords: ["Infect", "Toxic 2", "Trample"],
    });
    const blockerId = putOnBattlefield(state, bobId, {
      name: "Elf",
      power: 0,
      toughness: 1,
    });

    const after = runCombat(
      state,
      attackerId,
      bobId,
      new Map([[attackerId, [blockerId]]]),
    );
    const bob = after.players.get(bobId)!;
    expect(bob.poisonCounters).toBe(4);
    expect(bob.life).toBe(20);
  });

  it("unblocked, the same creature deals 5 poison (3 infect + 2 toxic)", () => {
    // Pins the unblocked path next to the trample path so the two cannot
    // drift apart again.
    const { state, aliceId, bobId } = makeGame();
    const attackerId = putOnBattlefield(state, aliceId, {
      name: "Deadly Visitor",
      power: 3,
      toughness: 1,
      keywords: ["Infect", "Toxic 2", "Trample"],
    });

    const after = runCombat(state, attackerId, bobId);
    const bob = after.players.get(bobId)!;
    expect(bob.poisonCounters).toBe(5);
    expect(bob.life).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 5. The shared damage pipeline — 702.90e, prevention, and planeswalkers
// ---------------------------------------------------------------------------

describe("CR 702.90e — infect applies to any damage, not just combat", () => {
  it("a non-combat source with infect places -1/-1 counters instead of damage", () => {
    const { state, aliceId, bobId } = makeGame();
    const sourceId = putOnBattlefield(state, aliceId, {
      name: "Tainted Strike",
      power: 0,
      toughness: 0,
      typeLine: "Instant",
      keywords: ["Infect"],
    });
    const targetId = putOnBattlefield(state, bobId, {
      name: "Hill Giant",
      power: 3,
      toughness: 5,
    });

    const result = dealDamageToCard(state, targetId, 2, false, sourceId);
    const target = result.state.cards.get(targetId)!;

    expect(target.damage).toBe(0);
    expect(minusOneCounters(result.state, targetId)).toBe(2);
  });

  it("a non-combat source with no infect still marks damage (control)", () => {
    const { state, aliceId, bobId } = makeGame();
    const sourceId = putOnBattlefield(state, aliceId, {
      name: "Lightning Strike",
      power: 0,
      toughness: 0,
      typeLine: "Instant",
    });
    const targetId = putOnBattlefield(state, bobId, {
      name: "Hill Giant",
      power: 3,
      toughness: 5,
    });

    const result = dealDamageToCard(state, targetId, 2, false, sourceId);
    const target = result.state.cards.get(targetId)!;

    expect(target.damage).toBe(2);
    expect(minusOneCounters(result.state, targetId)).toBe(0);
  });
});

describe("CR 702.90 + CR 702.16 — infect damage still goes through prevention", () => {
  it("a red infect source is prevented by a blocker with protection from red", () => {
    // The old combat-only branch called `addCounters` directly, bypassing
    // `shouldPreventDamageToTarget` and the whole replacement pipeline, so
    // 2 counters landed on a protected blocker.
    const { state, aliceId, bobId } = makeGame();
    const sourceId = putOnBattlefield(state, aliceId, {
      name: "Red Infect Dealer",
      power: 2,
      toughness: 2,
      keywords: ["Infect"],
      colors: ["R"],
    });
    const targetId = putOnBattlefield(state, bobId, {
      name: "Protected Wall",
      power: 0,
      toughness: 4,
      keywords: ["Protection from red"],
    });

    const result = dealDamageToCard(state, targetId, 2, true, sourceId);

    expect(minusOneCounters(result.state, targetId)).toBe(0);
    expect(result.state.cards.get(targetId)!.damage).toBe(0);
  });

  it("control: the same prevention applies to a vanilla red source", () => {
    const { state, aliceId, bobId } = makeGame();
    const sourceId = putOnBattlefield(state, aliceId, {
      name: "Red Vanilla",
      power: 2,
      toughness: 2,
      colors: ["R"],
    });
    const targetId = putOnBattlefield(state, bobId, {
      name: "Protected Wall",
      power: 0,
      toughness: 4,
      keywords: ["Protection from red"],
    });

    const result = dealDamageToCard(state, targetId, 2, true, sourceId);

    expect(result.state.cards.get(targetId)!.damage).toBe(0);
  });

  it("a non-protected blocker still takes the counters (no over-correction)", () => {
    const { state, aliceId, bobId } = makeGame();
    const sourceId = putOnBattlefield(state, aliceId, {
      name: "Red Infect Dealer",
      power: 2,
      toughness: 2,
      keywords: ["Infect"],
      colors: ["R"],
    });
    const targetId = putOnBattlefield(state, bobId, {
      name: "Plains Goat",
      power: 1,
      toughness: 1,
    });

    const result = dealDamageToCard(state, targetId, 2, true, sourceId);
    expect(minusOneCounters(result.state, targetId)).toBe(2);
  });
});

describe("CR 702.90c — scope of the conversion", () => {
  it("infect damage to a planeswalker is normal damage (loyalty), not counters", () => {
    // 702.90b/c cover players and creatures only. Probed correct before this
    // change; pinned so the pipeline move cannot widen it.
    const { state, aliceId, bobId } = makeGame();
    const sourceId = putOnBattlefield(state, aliceId, {
      name: "Blightsteel Colossus",
      power: 3,
      toughness: 4,
      keywords: ["Infect"],
    });
    const walkerId = putOnBattlefield(state, bobId, {
      name: "Test Walker",
      power: 0,
      toughness: 0,
      typeLine: "Legendary Planeswalker — Test",
      loyalty: "5",
    });

    const result = dealDamageToCard(state, walkerId, 3, true, sourceId);
    const walker = result.state.cards.get(walkerId)!;

    expect(minusOneCounters(result.state, walkerId)).toBe(0);
    expect(walker.damage).toBe(3);
    expect(walker.counters.find((c) => c.type === "loyalty")?.count).toBe(2);
  });

  it("infect damage to a non-creature permanent is normal damage", () => {
    const { state, aliceId, bobId } = makeGame();
    const sourceId = putOnBattlefield(state, aliceId, {
      name: "Blightsteel Colossus",
      power: 3,
      toughness: 4,
      keywords: ["Infect"],
    });
    const targetId = putOnBattlefield(state, bobId, {
      name: "Phyrexian Requisition",
      power: 0,
      toughness: 0,
      typeLine: "Artifact — Equipment",
    });

    const result = dealDamageToCard(state, targetId, 2, true, sourceId);
    expect(minusOneCounters(result.state, targetId)).toBe(0);
    expect(result.state.cards.get(targetId)!.damage).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 6. Regression guards — probed correct before this change, do not re-chase
// ---------------------------------------------------------------------------

describe("CR 702.90 — regression guards", () => {
  it("an infect attacker with lifelink still grants its controller life (CR 702.15)", () => {
    // Lifelink is keyed on the damage assigned, not on what it became.
    const { state, aliceId, bobId } = makeGame();
    const attackerId = putOnBattlefield(state, aliceId, {
      name: "Vraska the Unseen",
      power: 3,
      toughness: 3,
      keywords: ["Infect", "Lifelink"],
    });

    const after = runCombat(state, attackerId, bobId);
    const alice = after.players.get(aliceId)!;
    const bob = after.players.get(bobId)!;
    expect(alice.life).toBe(23);
    expect(bob.life).toBe(20);
    expect(bob.poisonCounters).toBe(3);
  });

  it("a blocker with infect + lifelink is not suppressed by the engine's blocker-lifelink grant", () => {
    // Engine convention (see combat-lifelink.test.ts:223): a blocker with
    // lifelink grants its controller life equal to the damage assigned to it.
    // Issue #2351 only ensures the attacker's infect no longer skips that
    // grant, because the infect branch used to bypass it.
    const { state, aliceId, bobId } = makeGame();
    const attackerId = putOnBattlefield(state, aliceId, {
      name: "Grizzly Bears",
      power: 4,
      toughness: 4,
    });
    const blockerId = putOnBattlefield(state, bobId, {
      name: "Contagion Dispenser",
      power: 2,
      toughness: 2,
      keywords: ["Infect", "Lifelink"],
    });

    const after = runCombat(
      state,
      attackerId,
      bobId,
      new Map([[attackerId, [blockerId]]]),
    );
    // 2 damage was assigned to the 2/2 blocker, so its controller gains 2.
    expect(after.players.get(bobId)!.life).toBe(22);
  });

  it("a non-infect attacker is unaffected by the whole change", () => {
    const { state, aliceId, bobId } = makeGame();
    const attackerId = putOnBattlefield(state, aliceId, {
      name: "Grizzly Bears",
      power: 3,
      toughness: 3,
    });
    const blockerId = putOnBattlefield(state, bobId, {
      name: "Hill Giant",
      power: 0,
      toughness: 5,
    });

    const after = runCombat(
      state,
      attackerId,
      bobId,
      new Map([[attackerId, [blockerId]]]),
    );
    expect(after.cards.get(blockerId)!.damage).toBe(3);
    expect(minusOneCounters(after, blockerId)).toBe(0);
  });
});
