/**
 * Persist keyword enforcement tests — strict parsed-keywords contract (CR 702.78).
 *
 * Issue #2338 — evergreen keyword enforcement (persist portion).
 *
 * Pins:
 *   - canonical detection via the parsed `keywords` array (not substring oracle text);
 *   - false-POSITIVE regression (the bug this change fixes): the gate used to
 *     resolve through `hasKeyword`, whose second arm is an **unanchored**
 *     `oracleText.includes("persist")`. A creature whose oracle text merely
 *     *mentions* persist — `persistent`, `persists`, `persisted` — was treated
 *     as a persist creature;
 *   - the false positive was NOT cosmetic: `hasPersist` gates
 *     `handlePersist`, which is called from the **state-based-action death
 *     path** and returns the card to the battlefield from the graveyard with a
 *     -1/-1 counter. The regression test below drives the real SBA chain and
 *     asserts a non-persist creature is not resurrected;
 *   - false-NEGATIVE regression: a creature carrying `keywords: ["Persist"]`
 *     whose oracle text omits the word must still be detected;
 *   - CR 702.78 — persist is a creature keyword and has no effect on
 *     non-creatures (the type-line guard is preserved unchanged).
 *
 * NOTE on the test helper: unlike `createMockCreature` in
 * `keyword-enforcement.test.ts`, this file's helper defaults `oracle_text` to
 * the empty string and NEVER backfills it from the keyword list. These tests
 * require keyword/text disagreement in both directions, so a backfilling
 * helper would silently destroy the very distinction under test.
 *
 * KNOWN LIMIT (out of scope for #2338, pinned not aspirational): the
 * creature-type-line guard in `hasPersist` is still a plain
 * `typeLine.includes("creature")` substring test, not a parsed type-line check.
 * It is pre-existing and untouched here, and it is rules-correct for the case
 * that matters (an "Artifact — Creature" IS a creature and persist does apply).
 * Tightening it to a parsed type-line read is a separate follow-up, the same
 * shape as the negation-aware oracle parse tracked for `"hexproof from"` in
 * `keyword-actions/hexproof.ts`.
 */

import { hasPersistStrict, handlePersist } from "../keyword-actions/persist";
import { hasPersist } from "../evergreen-keywords";
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
    id: "test-persist-card",
    name: "Persist Test Card",
    type_line: "Creature — Test",
    // Deliberately NOT backfilled from `keywords` — see the file header.
    oracle_text: "",
    power: "2",
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

// ─────────────────────────────────────────────────────────────────────────────
// (a) hasPersistStrict — parsed keywords only
// ─────────────────────────────────────────────────────────────────────────────

describe("hasPersistStrict (CR 702.78)", () => {
  it("returns true when the parsed keywords array contains 'persist'", () => {
    const card = makeInstance(makeCardData({ keywords: ["persist"] }));
    expect(hasPersistStrict(card)).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const card = makeInstance(makeCardData({ keywords: ["  Persist  "] }));
    expect(hasPersistStrict(card)).toBe(true);
  });

  it("returns false when the keywords array is empty", () => {
    const card = makeInstance(makeCardData({ keywords: [] }));
    expect(hasPersistStrict(card)).toBe(false);
  });

  it("returns false when the card has no keywords field at all", () => {
    const card = makeInstance(
      makeCardData({ keywords: undefined as unknown as string[] }),
    );
    expect(hasPersistStrict(card)).toBe(false);
  });

  it("ignores oracle text entirely (strict means parsed-keywords only)", () => {
    const card = makeInstance(
      makeCardData({
        keywords: [],
        oracle_text: "Persist — when this creature dies, return it.",
      }),
    );
    expect(hasPersistStrict(card)).toBe(false);
  });

  it("anchors on a word boundary: 'persistent' is a mention, not the keyword", () => {
    const card = makeInstance(makeCardData({ keywords: ["persistent"] }));
    expect(hasPersistStrict(card)).toBe(false);
  });

  it("anchors on a word boundary: 'persists' is a mention, not the keyword", () => {
    const card = makeInstance(makeCardData({ keywords: ["persists"] }));
    expect(hasPersistStrict(card)).toBe(false);
  });

  it("anchors on a word boundary: 'impersistency' does not grant persist", () => {
    const card = makeInstance(makeCardData({ keywords: ["impersistency"] }));
    expect(hasPersistStrict(card)).toBe(false);
  });

  it("matches 'persist' as a prefix of a longer hyphenated keyword line", () => {
    // Scryfall keyword lines are whitespace-separated tokens; a token that
    // merely *starts* with "persist" is not the keyword.
    const card = makeInstance(makeCardData({ keywords: ["persistence"] }));
    expect(hasPersistStrict(card)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) hasPersist — strict-first, word-boundary anchored fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("hasPersist (CR 702.78) — canonical gate", () => {
  it("detects persist from the parsed keywords array alone", () => {
    const card = makeInstance(makeCardData({ keywords: ["Persist"] }));
    expect(hasPersist(card)).toBe(true);
  });

  it("false-NEGATIVE regression: parsed keyword counts when oracle text omits the word", () => {
    // Before #2338 this already worked via the exact-match arm of `hasKeyword`,
    // so this pins that the strict-first rewiring did not regress it.
    const card = makeInstance(
      makeCardData({ keywords: ["Persist"], oracle_text: "" }),
    );
    expect(hasPersist(card)).toBe(true);
  });

  it("false-POSITIVE regression: 'persistent' in oracle text does NOT grant persist", () => {
    // This is the core regression. The old unanchored
    // `oracleText.includes("persist")` matched inside "persistent".
    const card = makeInstance(
      makeCardData({
        keywords: [],
        oracle_text: "This creature is persistent while it is untapped.",
      }),
    );
    expect(hasPersist(card)).toBe(false);
  });

  it("false-POSITIVE regression: 'persists' in oracle text does NOT grant persist", () => {
    const card = makeInstance(
      makeCardData({
        keywords: [],
        oracle_text: "If an effect persists, this creature gets +1/+1.",
      }),
    );
    expect(hasPersist(card)).toBe(false);
  });

  it("false-POSITIVE regression: 'impersistency' does NOT grant persist", () => {
    const card = makeInstance(
      makeCardData({
        keywords: [],
        oracle_text: "Impersistency prevents all triggered abilities.",
      }),
    );
    expect(hasPersist(card)).toBe(false);
  });

  it("false-POSITIVE regression: a 'persisted' mention deep in the text does NOT grant persist", () => {
    const card = makeInstance(
      makeCardData({
        keywords: [],
        oracle_text:
          "Whenever a creature you control dies, the effect persisted until end of turn.",
      }),
    );
    expect(hasPersist(card)).toBe(false);
  });

  it("still honours a standalone 'persist' in oracle text for untagged cards", () => {
    // The fallback still exists for cards whose `keywords` array is missing the
    // tag — it is merely anchored now. This is the shroud precedent (#2336).
    const card = makeInstance(
      makeCardData({
        keywords: [],
        oracle_text:
          "Persist — when this creature dies, return it to the battlefield.",
      }),
    );
    expect(hasPersist(card)).toBe(true);
  });

  it("CR 702.78: persist has no effect on a non-creature", () => {
    const card = makeInstance(
      makeCardData({
        type_line: "Instant",
        keywords: ["Persist"],
        oracle_text: "Persist",
      }),
    );
    expect(hasPersist(card)).toBe(false);
  });

  it("CR 702.78: persist has no effect on an enchantment (non-creature type line)", () => {
    const card = makeInstance(
      makeCardData({
        type_line: "Enchantment",
        keywords: [],
        oracle_text: "Persist",
      }),
    );
    expect(hasPersist(card)).toBe(false);
  });

  it("CR 702.78: an Artifact Creature IS a creature, so persist applies", () => {
    // Pins the pre-existing, deliberately unchanged type-line guard. The guard is
    // a plain `typeLine.includes("creature")`, and an "Artifact — Creature" is a
    // creature under the CR, so `true` is rules-correct. See the KNOWN LIMIT note
    // in the file header about the type-line substring being out of scope here.
    const card = makeInstance(
      makeCardData({
        type_line: "Artifact — Creature",
        keywords: ["Persist"],
        oracle_text: "",
      }),
    );
    expect(hasPersist(card)).toBe(true);
  });

  it("accepts a full creature type line containing 'creature'", () => {
    const card = makeInstance(
      makeCardData({
        type_line: "Legendary Creature — Beast",
        keywords: ["Persist"],
        oracle_text: "",
      }),
    );
    expect(hasPersist(card)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) handlePersist — the SBA death path this gate feeds
// ─────────────────────────────────────────────────────────────────────────────

describe("handlePersist — state-based-action death path (CR 702.78a)", () => {
  interface PersistSetup {
    state: GameState;
    aliceId: PlayerId;
    creatureId: CardInstanceId;
  }

  /**
   * Put a creature on the battlefield, then simulate its death by moving it to
   * the graveyard — the same hand-off `state-based-actions.ts` performs between
   * `destroyCard()` and `handlePersist()`.
   */
  function setupDyingCreature(cardData: ScryfallCard): PersistSetup {
    let state = createInitialGameState(["Alice", "Bob"], 20, false);
    state = startGame(state);
    const [aliceId] = Array.from(state.players.keys());

    const inst = createCardInstance(cardData, aliceId, aliceId);
    inst.hasSummoningSickness = false;
    state.cards.set(inst.id, inst);

    const bfKey = `${aliceId}-battlefield`;
    const bf = state.zones.get(bfKey)!;
    state.zones.set(bfKey, { ...bf, cardIds: [...bf.cardIds, inst.id] });

    // Simulate the death: creature leaves the battlefield for the graveyard.
    state.zones.set(bfKey, {
      ...state.zones.get(bfKey)!,
      cardIds: state.zones.get(bfKey)!.cardIds.filter((id) => id !== inst.id),
    });
    const gyKey = `${aliceId}-graveyard`;
    const gy = state.zones.get(gyKey)!;
    state.zones.set(gyKey, { ...gy, cardIds: [...gy.cardIds, inst.id] });

    return { state, aliceId, creatureId: inst.id };
  }

  it("returns a genuine persist creature to the battlefield with a -1/-1 counter", () => {
    const { state, aliceId, creatureId } = setupDyingCreature(
      makeCardData({
        name: "Real Persist Beast",
        keywords: ["Persist"],
        oracle_text: "",
      }),
    );

    const result = handlePersist(state, creatureId);

    expect(result.persistedCards).toEqual([creatureId]);
    const returned = result.state.cards.get(creatureId)!;
    expect(returned.counters).toEqual([{ type: "-1/-1", count: 1 }]);
    const bf = result.state.zones.get(`${aliceId}-battlefield`)!;
    expect(bf.cardIds).toContain(creatureId);
  });

  it("REGRESSION: a creature whose text merely says 'persistent' is NOT resurrected", () => {
    // The bug: `hasKeyword`'s unanchored `includes("persist")` matched inside
    // "persistent", so the SBA death path returned this card to the
    // battlefield with a -1/-1 counter. It has no persist keyword at all.
    const { state, aliceId, creatureId } = setupDyingCreature(
      makeCardData({
        name: "Enduring Warden",
        keywords: [],
        oracle_text: "This creature is persistent while it is untapped.",
      }),
    );

    const result = handlePersist(state, creatureId);

    expect(result.persistedCards).toEqual([]);
    // Must still be in the graveyard, NOT on the battlefield.
    const gy = result.state.zones.get(`${aliceId}-graveyard`)!;
    expect(gy.cardIds).toContain(creatureId);
    const bf = result.state.zones.get(`${aliceId}-battlefield`)!;
    expect(bf.cardIds).not.toContain(creatureId);
  });

  it("REGRESSION: a creature whose text says 'persists' is NOT resurrected", () => {
    const { state, aliceId, creatureId } = setupDyingCreature(
      makeCardData({
        name: "Stalled Study",
        keywords: [],
        oracle_text: "If an effect persists, this creature gets +1/+1.",
      }),
    );

    const result = handlePersist(state, creatureId);

    expect(result.persistedCards).toEqual([]);
    const gy = result.state.zones.get(`${aliceId}-graveyard`)!;
    expect(gy.cardIds).toContain(creatureId);
    const bf = result.state.zones.get(`${aliceId}-battlefield`)!;
    expect(bf.cardIds).not.toContain(creatureId);
  });

  it("a persist creature that died with a -1/-1 counter is not returned (CR 702.78a)", () => {
    const { state, creatureId } = setupDyingCreature(
      makeCardData({
        name: "Spent Persist Beast",
        keywords: ["Persist"],
        oracle_text: "",
      }),
    );

    // The intervening-"if" must be evaluated against the counters the creature
    // had ON THE BATTLEFIELD when it died.
    const result = handlePersist(state, creatureId, [
      { type: "-1/-1", count: 1 },
    ]);

    expect(result.persistedCards).toEqual([]);
  });

  it("a persist creature with no counters at death is returned (control case)", () => {
    const { state, creatureId } = setupDyingCreature(
      makeCardData({
        name: "Fresh Persist Beast",
        keywords: ["Persist"],
        oracle_text: "",
      }),
    );

    const result = handlePersist(state, creatureId, []);

    expect(result.persistedCards).toEqual([creatureId]);
  });
});
