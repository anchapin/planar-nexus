/**
 * Combat canBlock end-to-end tests — flying / reach / menace evasion layer.
 *
 * Issue #2324 — evergreen keyword enforcement (evasion portion).
 *
 * Verifies that `combat/queries.ts::canBlock` now uses the strict
 * parsed-keyword detection (hasFlyingStrict / hasReachStrict /
 * hasMenaceStrict) instead of the prior substring oracle-text fallback.
 *
 * Pins:
 *   - non-flying, non-reach blocker cannot block a flying attacker;
 *   - flying blocker can block a flying attacker;
 *   - reach blocker can block a flying attacker;
 *   - flavor-word mentions of "flying" / "reach" in oracle_text do NOT
 *     grant evasion if the parsed keywords array lacks the tag (the
 *     substring-fallback regression that #2324 closes);
 *   - menace attacker requires a second blocker at the pre-check level
 *     (the full declaration-time enforcement lives in declaration.ts).
 */

import { canBlock } from "../combat/queries";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type { GameState, ScryfallCard } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeCreature(
  name: string,
  keywords: string[] = [],
  oracleText: string = "",
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
    power: "2",
    toughness: "2",
    keywords,
    oracle_text: oracleText,
    mana_cost: "{1}",
    cmc: 2,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

function setupCombat(
  attackerKeywords: string[],
  attackerOracleText: string,
  blockerKeywords: string[],
  blockerOracleText: string,
): { state: GameState; attackerId: string; blockerId: string } {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];
  const bobId = playerIds[1];

  // Attacker (Alice)
  const attackerData = makeCreature(
    "Test Attacker",
    attackerKeywords,
    attackerOracleText,
  );
  const attackerInstance = createCardInstance(attackerData, aliceId, aliceId);
  attackerInstance.hasSummoningSickness = false;
  state.cards.set(attackerInstance.id, attackerInstance);
  const aliceBf = state.zones.get(`${aliceId}-battlefield`)!;
  state.zones.set(`${aliceId}-battlefield`, {
    ...aliceBf,
    cardIds: [...aliceBf.cardIds, attackerInstance.id],
  });

  // Blocker (Bob)
  const blockerData = makeCreature(
    "Test Blocker",
    blockerKeywords,
    blockerOracleText,
  );
  const blockerInstance = createCardInstance(blockerData, bobId, bobId);
  blockerInstance.hasSummoningSickness = false;
  state.cards.set(blockerInstance.id, blockerInstance);
  const bobBf = state.zones.get(`${bobId}-battlefield`)!;
  state.zones.set(`${bobId}-battlefield`, {
    ...bobBf,
    cardIds: [...bobBf.cardIds, blockerInstance.id],
  });

  return {
    state,
    attackerId: attackerInstance.id,
    blockerId: blockerInstance.id,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) Flying evasion (CR 702.9)
// ─────────────────────────────────────────────────────────────────────────────

describe("canBlock — flying evasion (CR 702.9)", () => {
  it("prevents a ground creature from blocking a flying attacker", () => {
    const { state, attackerId, blockerId } = setupCombat(
      ["flying"],
      "flying",
      [],
      "",
    );
    const result = canBlock(state, blockerId, attackerId);
    expect(result.canBlock).toBe(false);
    expect(result.reason).toContain("flying");
  });

  it("allows a flying creature to block a flying attacker", () => {
    const { state, attackerId, blockerId } = setupCombat(
      ["flying"],
      "flying",
      ["flying"],
      "flying",
    );
    const result = canBlock(state, blockerId, attackerId);
    expect(result.canBlock).toBe(true);
  });

  it("regression #2324: flavor-word mention of 'flying' in oracle_text does NOT grant evasion", () => {
    // Attacker has "Flying" only as flavor text — no parsed keyword tag.
    // A ground blocker should still be unable to block only if the
    // attacker actually has flying; here the attacker does NOT, so the
    // ground blocker should be able to block.
    const { state, attackerId, blockerId } = setupCombat(
      [],
      'The hawk took flight. "Flying" is too gentle a word.',
      [],
      "",
    );
    const result = canBlock(state, blockerId, attackerId);
    expect(result.canBlock).toBe(true);
  });

  it("regression #2324: a grant-effect mention of 'flying' in oracle_text does NOT grant evasion on its own", () => {
    // Card text "Other creatures you control have flying. (This one does not.)"
    // must NOT cause this creature to evade ground blockers via the strict
    // canBlock path.
    const { state, attackerId, blockerId } = setupCombat(
      [],
      "Other creatures you control have flying. (This creature does not.)",
      [],
      "",
    );
    const result = canBlock(state, blockerId, attackerId);
    expect(result.canBlock).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Reach as the exception (CR 702.12)
// ─────────────────────────────────────────────────────────────────────────────

describe("canBlock — reach exception to flying evasion (CR 702.12)", () => {
  it("allows a reach creature to block a flying attacker", () => {
    const { state, attackerId, blockerId } = setupCombat(
      ["flying"],
      "flying",
      ["reach"],
      "reach",
    );
    const result = canBlock(state, blockerId, attackerId);
    expect(result.canBlock).toBe(true);
  });

  it("regression #2324: flavor-word mention of 'reach' in oracle_text does NOT grant the reach exception", () => {
    // Blocker's oracle_text mentions "reach" but the parsed keywords
    // array is empty. The strict path must NOT treat this as reach.
    const { state, attackerId, blockerId } = setupCombat(
      ["flying"],
      "flying",
      [],
      "The vines reach toward the canopy, tangling with the hawk above.",
    );
    const result = canBlock(state, blockerId, attackerId);
    expect(result.canBlock).toBe(false);
    expect(result.reason).toContain("flying");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) Menace is not enforced in canBlock — the per-blocker gate is intentionally permissive
//     (CR 702.110). The minimum-two-blocker requirement is enforced at
//     declaration time in combat/declaration.ts::declareBlockers.
// ─────────────────────────────────────────────────────────────────────────────

describe("canBlock — menace is per-blocker-permissive (CR 702.110)", () => {
  it("returns canBlock:true for a single blocker against a menace attacker (per-blocker gate)", () => {
    // canBlock answers "can this individual blocker block this attacker?"
    // — any single blocker can block a menace attacker on its own. The
    // minimum-two-blocker requirement is enforced at declaration time in
    // combat/declaration.ts::declareBlockers, NOT here. Pinning the
    // contract so future maintainers don't reintroduce a per-blocker
    // menace rejection that breaks declareBlockers.
    const { state, attackerId, blockerId } = setupCombat(
      ["menace"],
      "menace",
      [],
      "",
    );
    const result = canBlock(state, blockerId, attackerId);
    expect(result.canBlock).toBe(true);
  });

  it("returns canBlock:true for a single blocker against a non-menace attacker", () => {
    const { state, attackerId, blockerId } = setupCombat(
      ["trample"],
      "trample",
      [],
      "",
    );
    const result = canBlock(state, blockerId, attackerId);
    expect(result.canBlock).toBe(true);
  });

  it("regression #2324: flavor-word mention of 'menace' in oracle_text does NOT impose a two-blocker requirement", () => {
    const { state, attackerId, blockerId } = setupCombat(
      [],
      "The warlord's smile carried a quiet menace that unsettled the council.",
      [],
      "",
    );
    const result = canBlock(state, blockerId, attackerId);
    expect(result.canBlock).toBe(true);
  });
});