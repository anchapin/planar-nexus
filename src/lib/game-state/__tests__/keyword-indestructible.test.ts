/**
 * Indestructible keyword enforcement (CR 702.12) — issue #2350.
 *
 * Pins every defect fixed in this epic iteration. The engine had **two**
 * divergent copies of the indestructible gate, and indestructible was the only
 * keyword in this arm whose gate sat on a state-based action where a false
 * negative *destroys a real permanent* (CR 702.12a) — and where a false
 * positive left a permanent unkillable (CR 702.12b).
 *
 *   1. CASE-SENSITIVE KEYWORD MATCH KILLED A REAL PERMANENT.
 *      `keyword-actions/removal.ts::hasIndestructible` used
 *      `keywords.includes("Indestructible")`. Scryfall is title-case, but
 *      imported decks / tokens / hand-built card data are not, so
 *      `keywords: ["indestructible"]` missed the keyword arm AND the oracle arm,
 *      and SBA 704.5g destroyed a genuinely indestructible creature. The two
 *      copies also disagreed with each other on exactly that input.
 *   2. GRANT PHRASES READ AS INDESTRUCTIBLE. Both copies' oracle arm was an
 *      **unanchored** `oracleText.includes("indestructible")`, so
 *      "Other creatures you control have indestructible." pinned a card that
 *      only *grants* the keyword to others as itself being unkillable.
 *   3. THE 0-TOUGHNESS SBA WAS SILENTLY NO-OPING (CR 702.12b). 0 toughness is a
 *      "put into a graveyard" action, not destruction, so indestructible does
 *      not stop it — but the SBA applied its whole list through
 *      `destroyCard(...)` with the indestructible gate ON. The result was worse
 *      than a wrong outcome: the SBA pushed "X is destroyed (toughness 0 or
 *      less)" and then destroyCard refused, so the permanent sat on the
 *      battlefield forever and re-reported the same "destruction" on every
 *      subsequent state check. Same for the Aura/Equipment SBAs.
 *   4. TWO DIVERGENT COPIES. `removal.ts::hasIndestructible` and
 *      `evergreen-keywords.isIndestructible` both answered "does this permanent
 *      have indestructible", independently, and disagreed. They now share
 *      `hasIndestructibleKeyword`.
 *   5. The repo's own JC-006 judge-call cases (`judge-call-edge-cases.test.ts`)
 *      gave false assurance: the first never calls `checkStateBasedActions` (it
 *      asserts on a locally computed `baseToughness - counterReduction`), and
 *      the second runs the SBA against an **empty** state and checks only the
 *      result object's shape. Neither ever put an indestructible 0-toughness
 *      creature on a battlefield, so defect 3 was invisible. The
 *      "indestructible + 0 toughness" pins below are the real versions.
 *
 * Per the epic convention, this file's helpers do **NOT** backfill `oracle_text`
 * from the keyword list — every case below states the exact card data under
 * test, which is the whole point for the false-positive pins.
 */
import { describe, it, expect } from "@jest/globals";
import type { CardInstance, GameState, PlayerId, ScryfallCard } from "../types";
import { checkStateBasedActions } from "../state-based-actions";
import {
  hasIndestructibleStrict,
  isIndestructibleGrantOrNegationPhrase,
  hasIndestructibleKeyword,
} from "../keyword-actions/indestructible";
import { hasIndestructible as removalHasIndestructible } from "../keyword-actions/removal";
import { destroyCard, regenerateCard } from "../keyword-actions/removal";
import { isIndestructible, canBeDestroyed } from "../evergreen-keywords";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";

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
  typeLine?: string;
  oracleText?: string;
  keywords?: string[];
  power?: string;
  toughness?: string;
}): ScryfallCard {
  return {
    id: uniqueId("indestructible"),
    name: over.name,
    type_line: over.typeLine ?? "Creature — Test",
    power: over.power ?? "1",
    toughness: over.toughness ?? "1",
    keywords: over.keywords ?? [],
    // Explicit, and empty unless the case under test says otherwise.
    oracle_text: over.oracleText ?? "",
    mana_cost: "{1}",
    cmc: 1,
    colors: [],
    color_identity: [],
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
  toughness?: string;
}): CardInstance {
  const data = cardDataFor({
    name: over.name,
    typeLine: over.typeLine,
    oracleText: over.oracleText,
    keywords: over.keywords,
    toughness: over.toughness,
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

interface BoardSpec {
  name: string;
  power?: number;
  toughness?: number;
  keywords?: string[];
  oracleText?: string;
  typeLine?: string;
  counters?: CardInstance["counters"];
  damage?: number;
}

function putOnBattlefield(
  state: GameState,
  controllerId: PlayerId,
  spec: BoardSpec,
): string {
  const data = cardDataFor({
    name: spec.name,
    typeLine: spec.typeLine ?? "Creature — Test",
    oracleText: spec.oracleText,
    keywords: spec.keywords,
    power: String(spec.power ?? 1),
    toughness: String(spec.toughness ?? 1),
  });
  let card = createCardInstance(data, controllerId, controllerId);
  card = { ...card, hasSummoningSickness: false };
  if (spec.counters?.length) card = { ...card, counters: spec.counters };
  if (spec.damage !== undefined) card = { ...card, damage: spec.damage };
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

/** Which zone holds the card, or "NOWHERE". */
function zoneOf(state: GameState, cardId: string): string {
  for (const [key, zone] of state.zones) {
    if (zone.cardIds.includes(cardId)) return key;
  }
  return "NOWHERE";
}

function isOnBattlefield(state: GameState, cardId: string): boolean {
  return zoneOf(state, cardId).endsWith("-battlefield");
}

function isInGraveyard(state: GameState, cardId: string): boolean {
  return zoneOf(state, cardId).endsWith("-graveyard");
}

// ---------------------------------------------------------------------------
// 1. hasIndestructibleStrict — parsed keywords only (CR 702.12a)
// ---------------------------------------------------------------------------

describe("hasIndestructibleStrict (CR 702.12a)", () => {
  it("is true for the title-case Scryfall form", () => {
    expect(
      hasIndestructibleStrict(
        instance({ name: "Wall", keywords: ["Indestructible"] }),
      ),
    ).toBe(true);
  });

  it("is true for the lower-case form — the case the old gate missed", () => {
    expect(
      hasIndestructibleStrict(
        instance({ name: "Wall", keywords: ["indestructible"] }),
      ),
    ).toBe(true);
  });

  it("is true for mixed case", () => {
    expect(
      hasIndestructibleStrict(
        instance({ name: "Wall", keywords: ["INDESTRUCTIBLE"] }),
      ),
    ).toBe(true);
  });

  it("ignores a mention, not the keyword ('indestructibility')", () => {
    expect(
      hasIndestructibleStrict(
        instance({ name: "Relic", keywords: ["Indestructibility"] }),
      ),
    ).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    expect(
      hasIndestructibleStrict(
        instance({ name: "Wall", keywords: ["  Indestructible  "] }),
      ),
    ).toBe(true);
  });

  it("never reads the oracle text", () => {
    expect(
      hasIndestructibleStrict(
        instance({ name: "Wall", oracleText: "Indestructible" }),
      ),
    ).toBe(false);
  });

  it("is false when the keywords array is absent", () => {
    const card = instance({ name: "Wall" });
    (card.cardData as { keywords?: string[] }).keywords = undefined;
    expect(hasIndestructibleStrict(card)).toBe(false);
  });

  it("is false for an unrelated keyword list", () => {
    expect(
      hasIndestructibleStrict(
        instance({ name: "Gargoyle", keywords: ["Flying", "Hexproof"] }),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. isIndestructibleGrantOrNegationPhrase — the anchoring is not enough
// ---------------------------------------------------------------------------

describe("isIndestructibleGrantOrNegationPhrase", () => {
  const grantOrNegation = [
    "This creature gains indestructible until end of turn.",
    "This creature gain indestructible.",
    "Other creatures you control have indestructible.",
    "Creatures your opponents control lose indestructible.",
    "Creatures you control with indestructible get +1/+1.",
    "Other creatures lose indestructible.",
    "This creature has indestructible as long as an opponent is poisoned.",
  ];

  it.each(grantOrNegation)("rejects the grant/negation phrase %s", (text) => {
    expect(isIndestructibleGrantOrNegationPhrase(text)).toBe(true);
  });

  const ownKeyword = [
    "Indestructible",
    "Flying. Indestructible",
    "This creature has indestructible.",
    "Indestructible and hexproof.",
  ];

  it.each(ownKeyword)("does not reject the self-declaration %s", (text) => {
    expect(isIndestructibleGrantOrNegationPhrase(text)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. hasIndestructibleKeyword — the single canonical gate
// ---------------------------------------------------------------------------

describe("hasIndestructibleKeyword (CR 702.12a)", () => {
  it("answers from the parsed keyword list in any case", () => {
    for (const tag of ["Indestructible", "indestructible", "INDESTRUCTIBLE"]) {
      expect(
        hasIndestructibleKeyword(instance({ name: "W", keywords: [tag] })),
      ).toBe(true);
    }
  });

  it("falls back to an ANCHORED oracle match for an untagged card", () => {
    expect(
      hasIndestructibleKeyword(
        instance({ name: "W", oracleText: "Indestructible" }),
      ),
    ).toBe(true);
  });

  it("rejects a grant phrase in the oracle fallback", () => {
    expect(
      hasIndestructibleKeyword(
        instance({
          name: "Bearer",
          oracleText: "Other creatures you control have indestructible.",
        }),
      ),
    ).toBe(false);
  });

  it("rejects a loss phrase in the oracle fallback", () => {
    expect(
      hasIndestructibleKeyword(
        instance({
          name: "Nullifier",
          oracleText: "Creatures your opponents control lose indestructible.",
        }),
      ),
    ).toBe(false);
  });

  it("strict keywords win even when the text also grants the keyword", () => {
    // The accepted trade-off (see #2348): a card that genuinely HAS the keyword
    // and also grants it to others must not false-negative.
    expect(
      hasIndestructibleKeyword(
        instance({
          name: "W",
          keywords: ["Indestructible"],
          oracleText: "Other creatures you control have indestructible.",
        }),
      ),
    ).toBe(true);
  });

  it("is false for a plain non-indestructible creature", () => {
    expect(
      hasIndestructibleKeyword(
        instance({ name: "Golem", keywords: ["Flying"], oracleText: "Flying" }),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. The two historical copies now agree (defect 4)
// ---------------------------------------------------------------------------

describe("the two indestructible gates no longer diverge", () => {
  const cases: Array<{ label: string; over: Parameters<typeof instance>[0] }> =
    [
      {
        label: "title-case tag",
        over: { name: "W", keywords: ["Indestructible"] },
      },
      {
        label: "lower-case tag",
        over: { name: "W", keywords: ["indestructible"] },
      },
      {
        label: "no tag, keyword text",
        over: { name: "W", oracleText: "Indestructible" },
      },
      {
        label: "no tag, grant phrase",
        over: { name: "W", oracleText: "Other creatures have indestructible." },
      },
      { label: "neither", over: { name: "W", keywords: ["Flying"] } },
    ];

  it.each(cases)("$label", ({ over }) => {
    const card = instance(over);
    expect(removalHasIndestructible(card)).toBe(isIndestructible(card));
    expect(removalHasIndestructible(card)).toBe(hasIndestructibleKeyword(card));
  });

  it("canBeDestroyed is the negation of the shared gate", () => {
    const wall = instance({ name: "W", keywords: ["indestructible"] });
    expect(canBeDestroyed(wall)).toBe(false);
    expect(canBeDestroyed(instance({ name: "G", keywords: ["Flying"] }))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Destroy effects respect indestructible (CR 702.12a)
// ---------------------------------------------------------------------------

describe("destroyCard respects indestructible (CR 702.12a)", () => {
  it("refuses to destroy an indestructible permanent", () => {
    const { state, aliceId } = makeGame();
    const id = putOnBattlefield(state, aliceId, {
      name: "Wall",
      keywords: ["indestructible"],
    });
    const result = destroyCard(state, id);
    expect(result.success).toBe(false);
    expect(isOnBattlefield(result.state, id)).toBe(true);
  });

  it("destroys a non-indestructible permanent", () => {
    const { state, aliceId } = makeGame();
    const id = putOnBattlefield(state, aliceId, { name: "Golem" });
    const result = destroyCard(state, id);
    expect(result.success).toBe(true);
    expect(isInGraveyard(result.state, id)).toBe(true);
  });

  it("ignoreIndestructible bypasses the gate (CR 702.12b callers)", () => {
    const { state, aliceId } = makeGame();
    const id = putOnBattlefield(state, aliceId, {
      name: "Wall",
      keywords: ["indestructible"],
    });
    const result = destroyCard(state, id, true);
    expect(result.success).toBe(true);
    expect(isInGraveyard(result.state, id)).toBe(true);
  });

  it("regeneration is consumed, not permanent — unlike indestructible", () => {
    // A regeneration shield only defers ONE destruction (CR 701.13): the
    // permanent is tapped and its damage removed, and it stays on the
    // battlefield. Indestructible is unbounded, so the second destroy gets
    // through. This is the distinction the two keywords exist to express.
    const { state, aliceId } = makeGame();
    const id = putOnBattlefield(state, aliceId, { name: "Golem", damage: 3 });
    const regen = regenerateCard(state, id);
    expect(regen.success).toBe(true);

    // First destroy is deferred: still on the battlefield, damage cleared.
    const first = destroyCard(regen.state, id);
    expect(first.success).toBe(true);
    expect(isOnBattlefield(first.state, id)).toBe(true);
    const afterRegen = first.state.cards.get(id)!;
    expect(afterRegen.damage).toBe(0);
    expect(afterRegen.isTapped).toBe(true);

    // Second destroy has no shield left to consume.
    const second = destroyCard(first.state, id);
    expect(second.success).toBe(true);
    expect(isInGraveyard(second.state, id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. SBA 704.5g — lethal damage (defect 1: the case that killed a real permanent)
// ---------------------------------------------------------------------------

describe("SBA 704.5g: indestructible survives lethal damage", () => {
  it("keeps a title-case indestructible creature on the battlefield", () => {
    const { state, aliceId } = makeGame();
    const id = putOnBattlefield(state, aliceId, {
      name: "Wall",
      keywords: ["Indestructible"],
      toughness: 1,
      damage: 5,
    });
    const res = checkStateBasedActions(state);
    expect(isOnBattlefield(res.state, id)).toBe(true);
  });

  it("keeps a LOWER-CASE indestructible creature on the battlefield", () => {
    // The regression pin for defect 1: this card was DESTROYED before the fix.
    const { state, aliceId } = makeGame();
    const id = putOnBattlefield(state, aliceId, {
      name: "Wall",
      keywords: ["indestructible"],
      toughness: 1,
      damage: 5,
    });
    const res = checkStateBasedActions(state);
    expect(isOnBattlefield(res.state, id)).toBe(true);
    expect(res.descriptions.join(" ")).not.toMatch(/destroyed/i);
  });

  it("still destroys a plain creature with lethal damage", () => {
    const { state, aliceId } = makeGame();
    const id = putOnBattlefield(state, aliceId, {
      name: "Golem",
      toughness: 1,
      damage: 5,
    });
    const res = checkStateBasedActions(state);
    expect(isInGraveyard(res.state, id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. SBA 704.5f — 0 toughness is NOT destruction (defect 3, CR 702.12b)
// ---------------------------------------------------------------------------

describe("SBA 704.5f: 0 toughness ignores indestructible (CR 702.12b)", () => {
  it("puts an indestructible 0-toughness creature in the graveyard", () => {
    // The regression pin for defect 3. Before the fix the SBA reported the
    // destruction and then destroyCard refused, so this card never moved.
    const { state, aliceId } = makeGame();
    const id = putOnBattlefield(state, aliceId, {
      name: "Wurm",
      keywords: ["Indestructible"],
      power: 5,
      toughness: 5,
      counters: [{ type: "-1/-1", count: 5 } as never],
    });
    const res = checkStateBasedActions(state);
    expect(isInGraveyard(res.state, id)).toBe(true);
    expect(isOnBattlefield(res.state, id)).toBe(false);
  });

  it("does not re-report the same death on a second state check", () => {
    // The zombie-permanent symptom: an SBA that never acts is re-detected
    // forever. After the first check the card must be out of the way.
    const { state, aliceId } = makeGame();
    putOnBattlefield(state, aliceId, {
      name: "Wurm",
      keywords: ["Indestructible"],
      power: 5,
      toughness: 5,
      counters: [{ type: "-1/-1", count: 5 } as never],
    });
    const first = checkStateBasedActions(state);
    const second = checkStateBasedActions(first.state);
    expect(second.descriptions.join(" ")).not.toMatch(/toughness 0 or less/i);
  });

  it("still removes a plain 0-toughness creature", () => {
    const { state, aliceId } = makeGame();
    const id = putOnBattlefield(state, aliceId, {
      name: "Flicker",
      power: 1,
      toughness: 1,
      counters: [{ type: "-1/-1", count: 1 } as never],
    });
    const res = checkStateBasedActions(state);
    expect(isInGraveyard(res.state, id)).toBe(true);
  });

  it("does not report the 0-toughness put as a destruction", () => {
    const { state, aliceId } = makeGame();
    putOnBattlefield(state, aliceId, {
      name: "Wurm",
      keywords: ["Indestructible"],
      power: 5,
      toughness: 5,
      counters: [{ type: "-1/-1", count: 5 } as never],
    });
    const res = checkStateBasedActions(state);
    expect(res.descriptions.join(" ")).toMatch(/graveyard/i);
    expect(res.descriptions.join(" ")).not.toMatch(/is destroyed/i);
  });
});

// ---------------------------------------------------------------------------
// 8. A card that only GRANTS indestructible is not itself protected
// ---------------------------------------------------------------------------

describe("a grant-only card is killable", () => {
  it("is destroyed by lethal damage", () => {
    const { state, aliceId } = makeGame();
    const id = putOnBattlefield(state, aliceId, {
      name: "Bearer",
      oracleText: "Other creatures you control have indestructible.",
      toughness: 1,
      damage: 5,
    });
    const res = checkStateBasedActions(state);
    expect(isInGraveyard(res.state, id)).toBe(true);
  });

  it("and destroyCard destroys it", () => {
    const { state, aliceId } = makeGame();
    const id = putOnBattlefield(state, aliceId, {
      name: "Bearer",
      oracleText: "Other creatures you control have indestructible.",
    });
    const result = destroyCard(state, id);
    expect(result.success).toBe(true);
    expect(isInGraveyard(result.state, id)).toBe(true);
  });
});
