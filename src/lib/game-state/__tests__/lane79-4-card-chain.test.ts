/**
 * Wave 4.8 follow-up 10 lane 79 — 4-card copy chain
 * (#2614 follow-up). The cycle guard's snapshot
 * helper (added in lane 75e) walks a card's
 * `become_copy` chain to its leaf in a single
 * refresh pass. v1 was tested with 2- and 3-card
 * chains; the recursion handles 4+ card chains
 * because the helper recurses without a depth
 * bound (the recursion is bounded by the chain
 * length, which is bounded by the battlefield size
 * in practice).
 *
 * Background: a 4-card chain A → B → C → D has D as
 * the leaf. After `refreshScriptedStatics`, A, B,
 * and C all overlay D's printed `cardData`. The
 * `copyOfTargetId` ledger for A, B, and C is the
 * IMMEDIATE target (not the leaf — the ledger is
 * the source's `become_copy` reference, not the
 * snapshot's leaf).
 *
 * Lane 79 is test-only work — the engine helper
 * is already correct; the work is test coverage
 * to confirm 4- and 5-card chains resolve in a
 * single pass without overflow.
 *
 * Coverage:
 * - 4-card chain: A → B → C → D → A overlays D in
 *   one refresh pass.
 * - 5-card chain: A → B → C → D → E → A overlays E
 *   in one refresh pass.
 *
 * Test harness pattern: synthetic card scripts
 * registered via `CardScriptSchema.parse +
 * registerCardScripts` (the lane 49/52/55/59/60/62
 * /63/64/65/66/67/68/69/70/71/72/73/74/75/75a/75b/75c
 * /75d/75e/77/78 pattern). The test exercises the
 * refresh path via `refreshScriptedStatics` and
 * inspects each card's overlaid `cardData`.
 */
import { describe, it, expect, afterAll } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
  registerCardDataForTests,
  resetCardDataForTests,
} from "../card-scripts/registry";
import { refreshScriptedStatics } from "../keyword-actions/scripted-statics";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test 4-Card Copy Chain (lane 79)";

/**
 * Grizzly Bears — a vanilla 2/2 green bear (no
 * keywords, no static). The leaf of the test
 * scenarios.
 */
const GRIZZLY_BEARS: ScryfallCard = {
  id: "mock-grizzly-bears-79",
  name: "Grizzly Bears",
  type_line: "Creature — Bear",
  oracle_text: "",
  mana_cost: "{1}{G}",
  cmc: 2,
  colors: ["G"],
  color_identity: ["G"],
  keywords: [],
  power: "2",
  toughness: "2",
  legalities: { standard: "legal" },
  layout: "normal",
} as ScryfallCard;

interface SetupResult {
  state: GameState;
  aliceId: PlayerId;
}

function setupTwoPlayerGame(): SetupResult {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys()) as PlayerId[];
  return { state, aliceId: playerIds[0] };
}

function makeShapeChanger(
  overrides: Partial<ScryfallCard> & { id: string; name: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name,
    type_line: overrides.type_line ?? "Creature — Shapeshifter",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{2}{U}",
    cmc: overrides.cmc ?? 3,
    colors: overrides.colors ?? ["U"],
    color_identity: overrides.color_identity ?? ["U"],
    keywords: overrides.keywords ?? [],
    power: overrides.power ?? "0",
    toughness: overrides.toughness ?? "0",
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

function putOnBattlefield(
  state: GameState,
  controllerId: PlayerId,
  cardDef: ScryfallCard,
): { state: GameState; cardId: CardInstanceId } {
  const cardId = `card-${cardDef.id}-${Math.random()
    .toString(36)
    .slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, controllerId, controllerId, {
    id: cardId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  card.hasSummoningSickness = false;
  const newCards = new Map(state.cards);
  newCards.set(cardId, card);
  const newZones = new Map(state.zones);
  const bfKey = `${controllerId}-battlefield`;
  const bf = newZones.get(bfKey);
  if (!bf) throw new Error("battlefield zone not found");
  newZones.set(bfKey, { ...bf, cardIds: [...bf.cardIds, cardId] });
  return {
    state: {
      ...state,
      cards: newCards,
      zones: newZones,
      lastModifiedAt: Date.now(),
    },
    cardId,
  };
}

/**
 * Register multiple `become_copy` scripts in a
 * single call so the registry has more than one
 * entry. Useful for 4- and 5-card chain tests
 * where each card needs its own script (A copies
 * B, B copies C, C copies D, etc.).
 */
function registerMultipleBecomeCopyScripts(
  entries: ReadonlyArray<{ hostName: string; targetId: string }>,
): void {
  const scripts: CardScript[] = entries.map(
    ({ hostName, targetId }) =>
      CardScriptSchema.parse({
        name: hostName,
        oracle:
          "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
        statics: [
          {
            text:
              "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
            affects: { controller: "you" },
            become_copy: {
              target: targetId,
              until: "end_of_turn",
            },
          },
        ],
      }),
  );
  resetCardScriptsForTests();
  registerCardScripts(scripts);
}

describe("Wave 4.8 follow-up 10 lane 79 — 4-card copy chain", () => {
  afterAll(() => {
    resetCardScriptsForTests();
    resetCardDataForTests();
  });

  it("resolves a 4-card copy chain to the leaf in one pass", () => {
    // A → B → C → D. After `refreshScriptedStatics`,
    // A, B, and C all overlay D's printed
    // characteristics in ONE refresh pass. The
    // leaf is D (the Grizzly Bears). A's
    // `copyOfTargetId` ledger is the IMMEDIATE
    // target (B), not the leaf.
    const A_NAME = `${HOST_NAME} 4-chain A`;
    const B_NAME = `${HOST_NAME} 4-chain B`;
    const C_NAME = `${HOST_NAME} 4-chain C`;
    const D_NAME = `${HOST_NAME} 4-chain D`;
    const { state, aliceId } = setupTwoPlayerGame();
    registerCardDataForTests([GRIZZLY_BEARS]);
    // Place D first (the leaf — Grizzly Bears).
    const { state: withD, cardId: dId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    // Place C, B, A in order so we have the ids
    // for the scripts to name.
    const { state: withC, cardId: cId } = putOnBattlefield(
      withD,
      aliceId,
      makeShapeChanger({ id: "c-4chain", name: C_NAME }),
    );
    const { state: withB, cardId: bId } = putOnBattlefield(
      withC,
      aliceId,
      makeShapeChanger({ id: "b-4chain", name: B_NAME }),
    );
    const { state: withA, cardId: aId } = putOnBattlefield(
      withB,
      aliceId,
      makeShapeChanger({ id: "a-4chain", name: A_NAME }),
    );
    // Register all four scripts: A copies B, B
    // copies C, C copies D, D has no `become_copy`
    // (D is the leaf).
    registerMultipleBecomeCopyScripts([
      { hostName: A_NAME, targetId: bId },
      { hostName: B_NAME, targetId: cId },
      { hostName: C_NAME, targetId: dId },
    ]);
    const refreshed = refreshScriptedStatics(withA);
    const a = refreshed.cards.get(aId);
    const b = refreshed.cards.get(bId);
    const c = refreshed.cards.get(cId);
    const d = refreshed.cards.get(dId);
    // A, B, and C all overlay D's printed
    // characteristics (the leaf).
    expect(a?.cardData.name).toBe("Grizzly Bears");
    expect(a?.cardData.type_line).toBe("Creature — Bear");
    expect(a?.cardData.power).toBe("2");
    expect(a?.cardData.toughness).toBe("2");
    expect(b?.cardData.name).toBe("Grizzly Bears");
    expect(c?.cardData.name).toBe("Grizzly Bears");
    // D is the Grizzly Bears, unchanged.
    expect(d?.cardData.name).toBe("Grizzly Bears");
    // A's printed `cardData` is preserved under
    // `animatedUntilEndOfTurn`.
    expect(a?.animatedUntilEndOfTurn?.cardData.name).toBe(A_NAME);
    // A's `copyOfTargetId` is the IMMEDIATE target
    // (B), not the leaf (D). The change-detection
    // diff compares the ledger against the
    // per-pass value; the leaf is a snapshot-only
    // construct.
    expect(a?.copyOfTargetId).toBe(bId);
    expect(b?.copyOfTargetId).toBe(cId);
    expect(c?.copyOfTargetId).toBe(dId);
  });

  it("resolves a 5-card copy chain to the leaf in one pass", () => {
    // A → B → C → D → E. After
    // `refreshScriptedStatics`, A, B, C, and D all
    // overlay E's printed characteristics in ONE
    // refresh pass. The recursion handles 5
    // cards without depth issues.
    const A_NAME = `${HOST_NAME} 5-chain A`;
    const B_NAME = `${HOST_NAME} 5-chain B`;
    const C_NAME = `${HOST_NAME} 5-chain C`;
    const D_NAME = `${HOST_NAME} 5-chain D`;
    const E_NAME = `${HOST_NAME} 5-chain E`;
    const { state, aliceId } = setupTwoPlayerGame();
    registerCardDataForTests([GRIZZLY_BEARS]);
    // Place E (the leaf), then D, C, B, A.
    const { state: withE, cardId: eId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    const { state: withD, cardId: dId } = putOnBattlefield(
      withE,
      aliceId,
      makeShapeChanger({ id: "d-5chain", name: D_NAME }),
    );
    const { state: withC, cardId: cId } = putOnBattlefield(
      withD,
      aliceId,
      makeShapeChanger({ id: "c-5chain", name: C_NAME }),
    );
    const { state: withB, cardId: bId } = putOnBattlefield(
      withC,
      aliceId,
      makeShapeChanger({ id: "b-5chain", name: B_NAME }),
    );
    const { state: withA, cardId: aId } = putOnBattlefield(
      withB,
      aliceId,
      makeShapeChanger({ id: "a-5chain", name: A_NAME }),
    );
    // Register all five scripts: A copies B, B
    // copies C, C copies D, D copies E, E has no
    // `become_copy` (E is the leaf).
    registerMultipleBecomeCopyScripts([
      { hostName: A_NAME, targetId: bId },
      { hostName: B_NAME, targetId: cId },
      { hostName: C_NAME, targetId: dId },
      { hostName: D_NAME, targetId: eId },
    ]);
    const refreshed = refreshScriptedStatics(withA);
    const a = refreshed.cards.get(aId);
    const b = refreshed.cards.get(bId);
    const c = refreshed.cards.get(cId);
    const d = refreshed.cards.get(dId);
    const e = refreshed.cards.get(eId);
    // A, B, C, and D all overlay E's printed
    // characteristics.
    expect(a?.cardData.name).toBe("Grizzly Bears");
    expect(b?.cardData.name).toBe("Grizzly Bears");
    expect(c?.cardData.name).toBe("Grizzly Bears");
    expect(d?.cardData.name).toBe("Grizzly Bears");
    // E is the Grizzly Bears, unchanged.
    expect(e?.cardData.name).toBe("Grizzly Bears");
    // A's `animatedUntilEndOfTurn` preserves the
    // printed `cardData`.
    expect(a?.animatedUntilEndOfTurn?.cardData.name).toBe(A_NAME);
    // `copyOfTargetId` is the IMMEDIATE target for
    // each link in the chain.
    expect(a?.copyOfTargetId).toBe(bId);
    expect(b?.copyOfTargetId).toBe(cId);
    expect(c?.copyOfTargetId).toBe(dId);
    expect(d?.copyOfTargetId).toBe(eId);
  });

  it("breaks a 4-card cycle: A → B → C → D → A", () => {
    // A → B → C → D → A. All four cards are in
    // `cycleIds`. The write phase drops all four
    // overlays.
    const A_NAME = `${HOST_NAME} 4-cycle A`;
    const B_NAME = `${HOST_NAME} 4-cycle B`;
    const C_NAME = `${HOST_NAME} 4-cycle C`;
    const D_NAME = `${HOST_NAME} 4-cycle D`;
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withA, cardId: aId } = putOnBattlefield(
      state,
      aliceId,
      makeShapeChanger({ id: "a-4cycle", name: A_NAME }),
    );
    const { state: withB, cardId: bId } = putOnBattlefield(
      withA,
      aliceId,
      makeShapeChanger({ id: "b-4cycle", name: B_NAME }),
    );
    const { state: withC, cardId: cId } = putOnBattlefield(
      withB,
      aliceId,
      makeShapeChanger({ id: "c-4cycle", name: C_NAME }),
    );
    const { state: withD, cardId: dId } = putOnBattlefield(
      withC,
      aliceId,
      makeShapeChanger({ id: "d-4cycle", name: D_NAME }),
    );
    registerMultipleBecomeCopyScripts([
      { hostName: A_NAME, targetId: bId },
      { hostName: B_NAME, targetId: cId },
      { hostName: C_NAME, targetId: dId },
      { hostName: D_NAME, targetId: aId },
    ]);
    const refreshed = refreshScriptedStatics(withD);
    const a = refreshed.cards.get(aId);
    const b = refreshed.cards.get(bId);
    const c = refreshed.cards.get(cId);
    const d = refreshed.cards.get(dId);
    // Cycle detected: all four keep their printed
    // `cardData` (no overlay).
    expect(a?.cardData.name).toBe(A_NAME);
    expect(b?.cardData.name).toBe(B_NAME);
    expect(c?.cardData.name).toBe(C_NAME);
    expect(d?.cardData.name).toBe(D_NAME);
    expect(a?.copyOfTargetId).toBeUndefined();
    expect(b?.copyOfTargetId).toBeUndefined();
    expect(c?.copyOfTargetId).toBeUndefined();
    expect(d?.copyOfTargetId).toBeUndefined();
  });
});