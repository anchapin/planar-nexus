/**
 * Prowess keyword enforcement tests — strict parsed-keywords contract (CR 702.108).
 *
 * Issue #2344 — evergreen keyword enforcement (prowess portion).
 *
 * Pins:
 *   - canonical detection via the parsed `keywords` array (not substring oracle text);
 *   - false-POSITIVE regression (the bug this change fixes): the gate used to
 *     resolve through `hasKeyword`, whose second arm is an **unanchored**
 *     `oracleText.includes("prowess")`. A creature whose oracle text merely
 *     *mentions* the substring — `prowesses`, `unprowess`, `prowessless` — was
 *     treated as a prowess creature;
 *   - the false positive was NOT cosmetic: `hasProwess` gates
 *     `detectProwessTriggers`, which `spell-casting/cast.ts:1235` calls on the
 *     cast path, and each returned trigger is stamped on via
 *     `applyProwessBoost` — a live +1/+1 on the layer-7 power/toughness read.
 *     The regression below drives the real trigger path and asserts no boost is
 *     applied to a creature that only *mentions* the word;
 *   - false-NEGATIVE regression: a creature carrying `keywords: ["Prowess"]`
 *     whose oracle text omits the word must still be detected (this is exactly
 *     the shape `parseProwess` in `oracle-text-parser/casting-keywords.ts` gets
 *     wrong, since it reads oracle text only — it has no production callers);
 *   - CR 702.108a — prowess is a triggered ability that only a creature can have
 *     (the type-line guard is preserved unchanged);
 *   - CR 702.108b — multiple instances trigger separately.
 *
 * NOTE on the test helper: unlike `createMockCreature` in
 * `keyword-enforcement.test.ts`, this file's helper defaults `oracle_text` to
 * the empty string and NEVER backfills it from the keyword list. These tests
 * require keyword/text disagreement in both directions, so a backfilling
 * helper would silently destroy the very distinction under test.
 *
 * KNOWN LIMITs (out of scope for #2344, pinned not aspirational — see the
 * matching notes in `keyword-actions/prowess.ts` and `evergreen-keywords.ts`):
 *   1. Anchoring does not fix the *grant* case: a creature whose oracle text
 *      grants prowess to others ("Other creatures you control have prowess.")
 *      still reads as having prowess. Fixing that needs a grant/negation-aware
 *      oracle parse, not keyword parsing — the same limitation already recorded
 *      for `"hexproof from"` and `lose shroud`.
 *   2. The written-out-ability *false negative* — a card with no keyword tag
 *      whose text spells out the full trigger — is also unresolved, for the
 *      same reason.
 * Both are asserted below so the behavior cannot drift silently. The
 * type-line substring guard is a third known limit, unchanged from #2338.
 */

import { hasProwessStrict } from "../keyword-actions/prowess";
import {
  hasProwess,
  getProwessInstanceCount,
  getProwessBonus,
  applyProwessBoost,
} from "../evergreen-keywords";
import { detectProwessTriggers } from "../trigger-system";
import { createCardInstance } from "../card-instance";
import { createInitialGameState, startGame } from "../game-state";
import type {
  CardInstance,
  ScryfallCard,
  GameState,
  PlayerId,
  CardInstanceId,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeCardData(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  const data: Partial<ScryfallCard> = {
    id: "test-prowess-card",
    name: "Prowess Test Card",
    type_line: "Creature — Test",
    // Deliberately NOT backfilled from `keywords` — see the file header.
    oracle_text: "",
    power: "1",
    toughness: "2",
    mana_cost: "{1}",
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    rarity: "common",
    set: "tst",
  };
  return { ...data, ...overrides } as ScryfallCard;
}

function makeInstance(
  cardData: ScryfallCard,
  controllerId = "alice",
): CardInstance {
  return createCardInstance(
    cardData,
    controllerId as CardInstance["controllerId"],
    controllerId as CardInstance["ownerId"],
  ) as CardInstance;
}

function makeGame(players = 1): { state: GameState; ids: PlayerId[] } {
  let state = createInitialGameState(
    players === 1 ? ["Alice"] : ["Alice", "Bob"],
    20,
    false,
  );
  state = startGame(state);
  return { state, ids: Array.from(state.players.keys()) };
}

/** Place a card on a player's battlefield and return its id. */
function placeOnBf(
  state: GameState,
  cardData: ScryfallCard,
  controllerId: PlayerId,
): CardInstanceId {
  const card = createCardInstance(cardData, controllerId, controllerId);
  card.hasSummoningSickness = false;
  const zoneKey = `${controllerId}-battlefield`;
  card.currentZoneKey = zoneKey;
  const bf = state.zones.get(zoneKey)!;
  state.zones.set(zoneKey, { ...bf, cardIds: [...bf.cardIds, card.id] });
  state.cards.set(card.id, card);
  return card.id;
}

const SPELL = makeCardData({
  id: "test-prowess-spell",
  name: "Test Sorcery",
  type_line: "Sorcery",
  oracle_text: "Draw a card.",
});

const SPELLED_PROWESS_TEXT =
  "Prowess (Whenever you cast a noncreature spell, " +
  "this creature gets +1/+1 until end of turn.)";

// ─────────────────────────────────────────────────────────────────────────────
// (a) hasProwessStrict — parsed keywords only
// ─────────────────────────────────────────────────────────────────────────────

describe("hasProwessStrict (CR 702.108)", () => {
  it("returns true when the parsed keywords array contains 'prowess'", () => {
    const card = makeInstance(makeCardData({ keywords: ["prowess"] }));
    expect(hasProwessStrict(card)).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const card = makeInstance(makeCardData({ keywords: ["  PROWESS  "] }));
    expect(hasProwessStrict(card)).toBe(true);
  });

  it("finds the keyword among several parsed keywords", () => {
    // Real shape of a Monastery Swiftspear-style card.
    const card = makeInstance(
      makeCardData({ keywords: ["Flying", "Prowess", "Vigilance"] }),
    );
    expect(hasProwessStrict(card)).toBe(true);
  });

  it("returns false when the keywords array is empty", () => {
    const card = makeInstance(makeCardData({ keywords: [] }));
    expect(hasProwessStrict(card)).toBe(false);
  });

  it("returns false when the card has no keywords field at all", () => {
    const card = makeInstance(
      makeCardData({ keywords: undefined as unknown as string[] }),
    );
    expect(hasProwessStrict(card)).toBe(false);
  });

  it("ignores oracle text entirely (strict means parsed-keywords only)", () => {
    const card = makeInstance(
      makeCardData({ keywords: [], oracle_text: SPELLED_PROWESS_TEXT }),
    );
    expect(hasProwessStrict(card)).toBe(false);
  });

  it("does not treat the keyword entry 'prowesses' as the keyword", () => {
    // A *mention*, not the keyword. The word-boundary anchor is what rejects it.
    const card = makeInstance(makeCardData({ keywords: ["prowesses"] }));
    expect(hasProwessStrict(card)).toBe(false);
  });

  it("does not treat the keyword entry 'unprowess' as the keyword", () => {
    const card = makeInstance(makeCardData({ keywords: ["unprowess"] }));
    expect(hasProwessStrict(card)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) hasProwess — the canonical gate
// ─────────────────────────────────────────────────────────────────────────────

describe("hasProwess — canonical gate (CR 702.108a)", () => {
  it("detects a keyword-tagged creature whose oracle text is empty", () => {
    // The false-negative regression: a text-only check (as in `parseProwess`)
    // would return false here and silently drop a real prowess creature.
    const card = makeInstance(makeCardData({ keywords: ["Prowess"] }));
    expect(hasProwess(card)).toBe(true);
  });

  it("false-POSITIVE regression: 'prowesses' in oracle text does NOT grant prowess", () => {
    // The core regression. The old unanchored `oracleText.includes("prowess")`
    // matched inside "prowesses".
    const card = makeInstance(
      makeCardData({
        keywords: [],
        oracle_text: "It prowesses the weak, and the weak are many.",
      }),
    );
    expect(hasProwess(card)).toBe(false);
  });

  it("false-POSITIVE regression: 'unprowess' in oracle text does NOT grant prowess", () => {
    const card = makeInstance(
      makeCardData({ keywords: [], oracle_text: "A wholly unprowess tale." }),
    );
    expect(hasProwess(card)).toBe(false);
  });

  it("false-POSITIVE regression: 'prowessless' in oracle text does NOT grant prowess", () => {
    const card = makeInstance(
      makeCardData({
        keywords: [],
        oracle_text: "The prowessless monk refuses the mountain's path.",
      }),
    );
    expect(hasProwess(card)).toBe(false);
  });

  it("still honours a standalone 'prowess' in oracle text for untagged cards", () => {
    // The fallback still exists for cards whose `keywords` array is missing the
    // tag — it is merely anchored now. This is the shroud precedent (#2336).
    const card = makeInstance(
      makeCardData({ keywords: [], oracle_text: SPELLED_PROWESS_TEXT }),
    );
    expect(hasProwess(card)).toBe(true);
  });

  it("CR 702.108a: prowess has no effect on a non-creature (Sorcery)", () => {
    const card = makeInstance(
      makeCardData({
        type_line: "Sorcery",
        keywords: ["Prowess"],
        oracle_text: "Prowess",
      }),
    );
    expect(hasProwess(card)).toBe(false);
  });

  it("CR 702.108a: accepts a full creature type line", () => {
    const card = makeInstance(
      makeCardData({
        type_line: "Legendary Creature — Rat Monk",
        keywords: ["Prowess"],
        oracle_text: "",
      }),
    );
    expect(hasProwess(card)).toBe(true);
  });

  it("CR 702.108a: an Artifact Creature IS a creature, so prowess applies", () => {
    // Pins the pre-existing, deliberately unchanged type-line guard. The guard is
    // a plain `typeLine.includes("creature")`, and an "Artifact — Creature" is a
    // creature under the CR, so `true` is rules-correct. See the KNOWN LIMIT note
    // in the file header about the type-line substring being out of scope here.
    const card = makeInstance(
      makeCardData({
        type_line: "Artifact — Creature",
        keywords: ["Prowess"],
        oracle_text: "",
      }),
    );
    expect(hasProwess(card)).toBe(true);
  });

  it("KNOWN LIMIT: a creature that GRANTS prowess to others still reads as having it", () => {
    // Pinned behavior, NOT the desired behavior. Anchoring the substring does not
    // make the oracle parse grant-aware; see KNOWN LIMIT (1) in the file header.
    // Fixing it requires a grant/negation-aware parse, the same follow-up shape
    // already tracked for `"hexproof from"` and `lose shroud`.
    const card = makeInstance(
      makeCardData({
        keywords: [],
        oracle_text: "Other creatures you control have prowess.",
      }),
    );
    expect(hasProwess(card)).toBe(true);
  });

  it("KNOWN LIMIT: a written-out prowess ability with no keyword tag is a false negative", () => {
    // Pinned behavior, NOT the desired behavior. The card spells the trigger out
    // in full and is a real prowess creature in the CR, but has no parsed keyword
    // and no standalone "prowess" token in its text, so the gate says false. See
    // KNOWN LIMIT (2) in the file header.
    const card = makeInstance(
      makeCardData({
        keywords: [],
        oracle_text:
          "Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.",
      }),
    );
    expect(hasProwess(card)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) getProwessInstanceCount — CR 702.108b
// ─────────────────────────────────────────────────────────────────────────────

describe("getProwessInstanceCount (CR 702.108b)", () => {
  it("counts a single parsed instance", () => {
    const card = makeInstance(makeCardData({ keywords: ["Prowess"] }));
    expect(getProwessInstanceCount(card)).toBe(1);
  });

  it("counts each parsed instance separately (CR 702.108b)", () => {
    const card = makeInstance(
      makeCardData({ keywords: ["Prowess", "Prowess"] }),
    );
    expect(getProwessInstanceCount(card)).toBe(2);
  });

  it("returns 0 for a creature without prowess", () => {
    const card = makeInstance(makeCardData({ keywords: ["Flying"] }));
    expect(getProwessInstanceCount(card)).toBe(0);
  });

  it("false-POSITIVE regression: a mere 'prowesses' mention counts 0, not 1", () => {
    // Before the fix `hasProwess` was true here, so the oracle-text fallback
    // returned 1 — a creature that only *mentions* the word would have gained
    // +2/+2 off a single noncreature spell via the CR 702.108b loop.
    const card = makeInstance(
      makeCardData({
        keywords: [],
        oracle_text: "It prowesses the weak, and the weak are many.",
      }),
    );
    expect(getProwessInstanceCount(card)).toBe(0);
  });

  it("falls back to 1 for an untagged card whose text spells out prowess", () => {
    const card = makeInstance(
      makeCardData({ keywords: [], oracle_text: SPELLED_PROWESS_TEXT }),
    );
    expect(getProwessInstanceCount(card)).toBe(1);
  });

  it("counts parsed instances even off a creature (the type-line guard lives in hasProwess)", () => {
    // Pinned pre-existing behavior, deliberately unchanged. `getProwessInstanceCount`
    // is a pure keyword-array tally and does not consult the type line; the only
    // production call site (`trigger-system/spell-triggers.ts:163`) is already
    // gated behind `hasProwess` on the line above it, so the non-creature case
    // cannot reach the +1/+1 stamping path.
    const card = makeInstance(
      makeCardData({
        type_line: "Sorcery",
        keywords: ["Prowess"],
        oracle_text: "",
      }),
    );
    expect(getProwessInstanceCount(card)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) detectProwessTriggers — the live production site this gate feeds
// ─────────────────────────────────────────────────────────────────────────────

describe("detectProwessTriggers — the production path (CR 702.108a)", () => {
  it("fires for a real keyword-tagged creature and applies the +1/+1", () => {
    // Positive control: proves the path below is genuinely live, so the
    // regression cases that follow are not vacuously green.
    const { state, ids } = makeGame();
    const monk = placeOnBf(
      state,
      makeCardData({
        id: "real-monk",
        name: "Real Monk",
        keywords: ["Prowess"],
      }),
      ids[0],
    );
    const spell = placeOnBf(state, SPELL, ids[0]);

    const triggers = detectProwessTriggers(state, spell, ids[0], ids[0]);
    expect(triggers).toHaveLength(1);

    let next = state;
    for (const trigger of triggers) {
      next = applyProwessBoost(next, trigger.sourceCardId, 1);
    }
    expect(getProwessBonus(next.cards.get(monk)!)).toBe(1);
  });

  it("does NOT fire for a creature that only MENTIONS prowess, and grants no boost", () => {
    // The end-to-end regression. Before the fix this creature passed the gate on
    // `oracleText.includes("prowess")` matching inside "prowesses", fired a
    // trigger on every noncreature spell Alice cast, and was stamped +1/+1 on
    // the layer-7 power/toughness read.
    const { state, ids } = makeGame();
    const imposter = placeOnBf(
      state,
      makeCardData({
        id: "imposter-monk",
        name: "Imposter Monk",
        keywords: [],
        oracle_text: "It prowesses the weak, and the weak are many.",
      }),
      ids[0],
    );
    const spell = placeOnBf(state, SPELL, ids[0]);

    const triggers = detectProwessTriggers(state, spell, ids[0], ids[0]);
    expect(triggers).toHaveLength(0);

    let next = state;
    for (const trigger of triggers) {
      next = applyProwessBoost(next, trigger.sourceCardId, 1);
    }
    expect(getProwessBonus(next.cards.get(imposter)!)).toBe(0);
  });

  it("does NOT fire for a creature whose text contains 'unprowess'", () => {
    const { state, ids } = makeGame();
    placeOnBf(
      state,
      makeCardData({
        id: "unprowess-monk",
        name: "Unprowess Monk",
        keywords: [],
        oracle_text: "A wholly unprowess tale.",
      }),
      ids[0],
    );
    const spell = placeOnBf(state, SPELL, ids[0]);

    expect(detectProwessTriggers(state, spell, ids[0], ids[0])).toHaveLength(0);
  });

  it("still fires for an untagged creature whose text spells out prowess", () => {
    // The anchored oracle-text fallback must keep working, otherwise untagged
    // cards silently lose the keyword.
    const { state, ids } = makeGame();
    placeOnBf(
      state,
      makeCardData({
        id: "untagged-monk",
        name: "Untagged Monk",
        keywords: [],
        oracle_text: SPELLED_PROWESS_TEXT,
      }),
      ids[0],
    );
    const spell = placeOnBf(state, SPELL, ids[0]);

    expect(detectProwessTriggers(state, spell, ids[0], ids[0])).toHaveLength(1);
  });

  it("CR 702.108a: a non-creature spell never triggers prowess", () => {
    const { state, ids } = makeGame();
    placeOnBf(
      state,
      makeCardData({
        id: "real-monk-2",
        name: "Real Monk II",
        keywords: ["Prowess"],
      }),
      ids[0],
    );
    const creatureSpell = placeOnBf(
      state,
      makeCardData({
        id: "test-creature-spell",
        name: "Test Bear",
        type_line: "Creature — Bear",
        oracle_text: "",
      }),
      ids[0],
    );

    expect(
      detectProwessTriggers(state, creatureSpell, ids[0], ids[0]),
    ).toHaveLength(0);
  });
});
