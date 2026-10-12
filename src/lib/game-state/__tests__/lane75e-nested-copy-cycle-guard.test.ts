/**
 * Wave 4.8 follow-up 9 lane 75e — Nested-copy cycle
 * guard (#2614 follow-up). Tests for the cycle guard
 * that resolves a source's copy chain to its leaf
 * (the deepest card in the chain) in a single refresh
 * pass, and breaks cycles by dropping the overlay on
 * every cycle member.
 *
 * Background: the lane 75 / 75a / 75b / 75c static
 * (`StaticSchema.become_copy`) and lane 75d's Aura
 * (`AuraStaticSchema.become_copy`) copy the target's
 * printed characteristics onto the source's
 * `cardData` for the duration of the turn. v1 assumed
 * the named target's printed `cardData` was the
 * source-of-truth for the overlay — a nested copy
 * (a target that itself has a `become_copy` static)
 * would loop or produce inconsistent results.
 *
 * Lane 75e resolves the chain at the TOP of the
 * refresh pass: a snapshot helper walks each card's
 * `copyOfTargetId` ledger to its leaf and exposes the
 * leaf's printed `cardData` as the overlay source.
 * The write phase consults the snapshot rather than
 * the in-flight overlay on the immediate target.
 *
 * Cycle detection: a card whose copy chain includes
 * itself is treated as if it had no `become_copy` arm.
 * The snapshot's `cycleIds` set covers every id in any
 * cycle; the write phase checks
 * `cycleIds.has(cardId)` and drops the overlay.
 *
 * Coverage:
 * - 2-card chain: A copies B → A overlays B's
 *   characteristics (lane 75 baseline, already covered
 *   by `lane75-until-eot-copy.test.ts`; we re-test for
 *   regression coverage).
 * - 3-card chain: A copies B (which has a `become_copy`
 *   arm pointing at C) → A overlays C's printed
 *   characteristics in ONE refresh pass. The
 *   intermediate target B is itself a copy of C, so A's
 *   overlay must skip B's in-flight overlay and read C's
 *   printed `cardData`.
 * - Cycle: A copies B, B copies A → both A and B are
 *   in `cycleIds`; both overlays are dropped; the
 *   source's printed `cardData` is restored.
 * - Aura cycle: an Aura with `become_copy: A` where
 *   A has a `become_copy` static pointing back at the
 *   enchanted card → cycle detected, overlay dropped.
 * - The cross-site cycle: a static-driven overlay on
 *   card A whose target B is an enchanted card with
 *   lane 75d's `become_copy` arm → A's snapshot must
 *   walk through B's `copyOfTargetId` ledger (set by
 *   `refreshAuraBonuses`) to find the leaf.
 *
 * Test harness pattern: synthetic card scripts
 * registered via `CardScriptSchema.parse +
 * registerCardScripts` (the lane 49/52/55/59/60/62/63
 * /64/65/66/67/68/69/70/71/72/73/74/75/75a/75b/75c/75d
 * pattern). The test exercises the refresh path via
 * `refreshScriptedStatics` and `refreshAuraBonuses` and
 * inspects the source's overlaid `cardData` +
 * `animatedUntilEndOfTurn` (printed backup) +
 * `copyOfTargetId` ledger.
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
import { refreshAuraBonuses } from "../keyword-actions/aura-bonus";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

/**
 * The host script for the "shapeshifter with become_copy
 * arm" test pattern. Each test instance re-registers
 * with the chosen target's `CardInstanceId` substituted
 * into the static's `become_copy.target` field.
 */
const HOST_NAME = "Test Nested-Copy Cycle Guard (lane 75e)";

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

const GRIZZLY_BEARS: ScryfallCard = {
  id: "mock-grizzly-bears-75e",
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

const SERRA_ANGEL: ScryfallCard = {
  id: "mock-serra-angel-75e",
  name: "Serra Angel",
  type_line: "Creature — Angel",
  oracle_text: "Flying, vigilance",
  mana_cost: "{3}{W}",
  cmc: 4,
  colors: ["W"],
  color_identity: ["W"],
  keywords: ["flying", "vigilance"],
  power: "4",
  toughness: "4",
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

/**
 * Add a card directly to the named player's
 * battlefield.
 */
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
 * Register a `become_copy` static with the named
 * `target` id. Re-registers the script so the static's
 * `target` field names the live card id.
 */
function registerBecomeCopyScript(
  hostName: string,
  targetId: string,
): void {
  const script: CardScript = CardScriptSchema.parse({
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
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

/**
 * Register multiple `become_copy` scripts in a single
 * call so the registry has more than one entry. Useful
 * for 3-card chain tests where A and B each need
 * distinct scripts (A copies B; B copies C).
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

describe("Wave 4.8 follow-up 9 lane 75e — Nested-copy cycle guard", () => {
  afterAll(() => {
    resetCardScriptsForTests();
    resetCardDataForTests();
  });

  it("resolves a 2-card copy chain to the leaf in one pass", () => {
    // Source A has a `become_copy` static pointing at
    // B. After `refreshScriptedStatics`, A overlays
    // B's printed characteristics. The snapshot
    // returns B as the leaf; the overlay is B's
    // printed `cardData` (which is unchanged because
    // B has no `become_copy` static). This is the
    // lane 75 baseline — re-tested here for
    // regression coverage after the snapshot wiring.
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withB, cardId: bId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    registerBecomeCopyScript(`${HOST_NAME} 2-chain A`, bId);
    const { state: withA, cardId: aId } = putOnBattlefield(
      withB,
      aliceId,
      makeShapeChanger({ id: "a-2chain", name: `${HOST_NAME} 2-chain A` }),
    );
    const refreshed = refreshScriptedStatics(withA);
    const a = refreshed.cards.get(aId);
    expect(a?.cardData.name).toBe("Grizzly Bears");
    expect(a?.cardData.power).toBe("2");
    expect(a?.cardData.toughness).toBe("2");
    expect(a?.animatedUntilEndOfTurn?.cardData.name).toBe(
      `${HOST_NAME} 2-chain A`,
    );
    expect(a?.copyOfTargetId).toBe(bId);
  });

  it("resolves a 3-card copy chain to the leaf in one pass", () => {
    // A has a `become_copy` static pointing at B.
    // B has a `become_copy` static pointing at C (a
    // 2/2 Grizzly Bears). The chain is A → B → C.
    // Without the cycle guard, A would overlay
    // B's in-flight `cardData` (which is C's
    // overlaid `cardData` — the Grizzly Bears's
    // name, type_line, P/T) BUT the snapshot must
    // walk the chain to the leaf (C) and overlay
    // C's PRINTED `cardData`. In this case the
    // overlay value is the same (C's printed and
    // in-flight `cardData` agree because C has no
    // `become_copy` arm), so the assertion is the
    // same as a 2-card chain. The key test is
    // that the chain doesn't loop or fail — A
    // settles to C in ONE refresh pass.
    //
    // Implementation note: A and B have distinct
    // names so the script registry holds two
    // entries (A's script points at B; B's script
    // points at C). The two scripts are
    // registered in a single call to keep the
    // registry consistent across the test.
    const A_NAME = `${HOST_NAME} 3-chain A`;
    const B_NAME = `${HOST_NAME} 3-chain B`;
    const { state, aliceId } = setupTwoPlayerGame();
    // Add C first (the leaf — Grizzly Bears).
    const { state: withC, cardId: cId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    // Add B (the intermediate) so the script's
    // target can name B's id.
    const { state: withB, cardId: bId } = putOnBattlefield(
      withC,
      aliceId,
      makeShapeChanger({ id: "b-3chain", name: B_NAME }),
    );
    // Register both scripts in a single call:
    // A's script (A copies B) and B's script (B
    // copies C). After registration the registry
    // has two entries.
    registerMultipleBecomeCopyScripts([
      { hostName: A_NAME, targetId: bId },
      { hostName: B_NAME, targetId: cId },
    ]);
    const { state: withA, cardId: aId } = putOnBattlefield(
      withB,
      aliceId,
      makeShapeChanger({ id: "a-3chain", name: A_NAME }),
    );
    const refreshed = refreshScriptedStatics(withA);
    // After refresh:
    // - C is the Grizzly Bears (printed, unchanged).
    // - B's overlay: B overlays C's printed
    //   characteristics. B's printed name was
    //   B_NAME.
    // - A's overlay: A overlays C's printed
    //   characteristics (the leaf). A's printed
    //   name was A_NAME.
    const a = refreshed.cards.get(aId);
    const b = refreshed.cards.get(bId);
    const c = refreshed.cards.get(cId);
    // A's overlay is C's printed characteristics:
    // the Grizzly Bears's name, type_line, P/T.
    expect(a?.cardData.name).toBe("Grizzly Bears");
    expect(a?.cardData.type_line).toBe("Creature — Bear");
    expect(a?.cardData.power).toBe("2");
    expect(a?.cardData.toughness).toBe("2");
    // A's printed `cardData` is preserved under
    // `animatedUntilEndOfTurn` so the EOT cleanup
    // rolls it back.
    expect(a?.animatedUntilEndOfTurn?.cardData.name).toBe(A_NAME);
    // A's `copyOfTargetId` ledger is the immediate
    // target (B), not the leaf. The change-detection
    // diff compares the ledger against the
    // per-pass `copyOfTargetBySourceId` value to
    // detect script changes; the leaf is a
    // snapshot-only construct.
    expect(a?.copyOfTargetId).toBe(bId);
    // B's overlay is C's printed characteristics.
    expect(b?.cardData.name).toBe("Grizzly Bears");
    expect(b?.animatedUntilEndOfTurn?.cardData.name).toBe(B_NAME);
    expect(b?.copyOfTargetId).toBe(cId);
    // C is the Grizzly Bears, unchanged.
    expect(c?.cardData.name).toBe("Grizzly Bears");
  });

  it("breaks a 2-card cycle: A → B → A", () => {
    // A has a `become_copy` static pointing at B.
    // B has a `become_copy` static pointing at A.
    // The chain forms a cycle. The snapshot helper
    // detects the cycle and adds both A and B to
    // `cycleIds`. The write phase drops the overlay
    // for both: A's printed `cardData` is preserved
    // and `copyOfTargetId` is cleared; B's printed
    // `cardData` is preserved and `copyOfTargetId`
    // is cleared.
    //
    // Implementation note: A and B have distinct
    // names so the script registry holds two
    // entries (A's script points at B; B's script
    // points at A). The two scripts are
    // registered in a single call so the registry
    // is consistent across the test.
    const A_NAME = `${HOST_NAME} 2-cycle A`;
    const B_NAME = `${HOST_NAME} 2-cycle B`;
    const { state, aliceId } = setupTwoPlayerGame();
    // Add A and B (we need the ids before the
    // scripts can name them).
    const { state: withA, cardId: aId } = putOnBattlefield(
      state,
      aliceId,
      makeShapeChanger({ id: "a-cycle", name: A_NAME }),
    );
    const { state: withB, cardId: bId } = putOnBattlefield(
      withA,
      aliceId,
      makeShapeChanger({ id: "b-cycle", name: B_NAME }),
    );
    // Register both scripts: A copies B, B copies
    // A. The chain forms a cycle.
    registerMultipleBecomeCopyScripts([
      { hostName: A_NAME, targetId: bId },
      { hostName: B_NAME, targetId: aId },
    ]);
    const refreshed = refreshScriptedStatics(withB);
    const a = refreshed.cards.get(aId);
    const b = refreshed.cards.get(bId);
    // Cycle detected: A and B keep their printed
    // `cardData` (no overlay).
    expect(a?.cardData.name).toBe(A_NAME);
    expect(a?.cardData.power).toBe("0");
    expect(a?.animatedUntilEndOfTurn).toBeUndefined();
    expect(a?.copyOfTargetId).toBeUndefined();
    expect(b?.cardData.name).toBe(B_NAME);
    expect(b?.cardData.power).toBe("0");
    expect(b?.animatedUntilEndOfTurn).toBeUndefined();
    expect(b?.copyOfTargetId).toBeUndefined();
  });

  it("breaks a 3-card cycle: A → B → C → A", () => {
    // A → B → C → A. All three cards are in
    // `cycleIds`. The write phase drops all three
    // overlays.
    const A_NAME = `${HOST_NAME} 3-cycle A`;
    const B_NAME = `${HOST_NAME} 3-cycle B`;
    const C_NAME = `${HOST_NAME} 3-cycle C`;
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withA, cardId: aId } = putOnBattlefield(
      state,
      aliceId,
      makeShapeChanger({ id: "a-3cycle", name: A_NAME }),
    );
    const { state: withB, cardId: bId } = putOnBattlefield(
      withA,
      aliceId,
      makeShapeChanger({ id: "b-3cycle", name: B_NAME }),
    );
    const { state: withC, cardId: cId } = putOnBattlefield(
      withB,
      aliceId,
      makeShapeChanger({ id: "c-3cycle", name: C_NAME }),
    );
    // Register all three scripts: A copies B, B
    // copies C, C copies A. The chain forms a
    // cycle.
    registerMultipleBecomeCopyScripts([
      { hostName: A_NAME, targetId: bId },
      { hostName: B_NAME, targetId: cId },
      { hostName: C_NAME, targetId: aId },
    ]);
    const refreshed = refreshScriptedStatics(withC);
    const a = refreshed.cards.get(aId);
    const b = refreshed.cards.get(bId);
    const c = refreshed.cards.get(cId);
    expect(a?.cardData.name).toBe(A_NAME);
    expect(a?.copyOfTargetId).toBeUndefined();
    expect(b?.cardData.name).toBe(B_NAME);
    expect(b?.copyOfTargetId).toBeUndefined();
    expect(c?.cardData.name).toBe(C_NAME);
    expect(c?.copyOfTargetId).toBeUndefined();
  });

  it("chains through a name target (lane 75b) — A copies B (named: Serra Angel)", () => {
    // A has a `become_copy` static with a `named_card`
    // arm (lane 75b). The named card is NOT on the
    // battlefield; the chain terminates at the named
    // card. A overlays the named card's printed
    // characteristics (Serra Angel).
    const { state, aliceId } = setupTwoPlayerGame();
    // A is the only battlefield card. The named
    // target (Serra Angel) is NOT on the
    // battlefield.
    const { state: withA, cardId: aId } = putOnBattlefield(
      state,
      aliceId,
      makeShapeChanger({ id: "a-name", name: `${HOST_NAME} name A` }),
    );
    // Register A's script with the named-card arm.
    const script: CardScript = CardScriptSchema.parse({
      name: `${HOST_NAME} name A`,
      oracle:
        "As long as this is in play, it's a copy of [named card] until end of turn.",
      statics: [
        {
          text:
            "As long as this is in play, it's a copy of [named card] until end of turn.",
          affects: { controller: "you" },
          become_copy: {
            named_card: { name: "Serra Angel" },
            until: "end_of_turn",
          },
        },
      ],
    });
    resetCardScriptsForTests();
    registerCardScripts([script]);
    // Install the synthetic Serra Angel `cardData` in
    // the registry so `getCardDataByName("Serra Angel")`
    // returns the test's `SERRA_ANGEL` (mirrors the
    // lane 75b test harness pattern).
    registerCardDataForTests([SERRA_ANGEL]);
    const refreshed = refreshScriptedStatics(withA);
    const a = refreshed.cards.get(aId);
    // A overlays Serra Angel's printed
    // characteristics.
    expect(a?.cardData.name).toBe("Serra Angel");
    expect(a?.cardData.type_line).toBe("Creature — Angel");
    expect(a?.cardData.power).toBe("4");
    expect(a?.cardData.toughness).toBe("4");
    expect(a?.cardData.keywords).toEqual(["flying", "vigilance"]);
    expect(a?.animatedUntilEndOfTurn?.cardData.name).toBe(
      `${HOST_NAME} name A`,
    );
  });

  it("chains static → aura-driven overlay (A copies B, B is aura-enchanted as C)", () => {
    // The cross-site chain: A's `become_copy` static
    // points at B. B is an enchanted card whose
    // attached Aura has a `become_copy` arm pointing
    // at C. The Aura overlay is owned by
    // `refreshAuraBonuses`, which writes the overlay
    // onto B's `cardData` via the lane 75
    // `animatedUntilEndOfTurn` infrastructure.
    //
    // A's refresh must walk the chain through B's
    // `copyOfTargetId` (set by the Aura overlay) to
    // C. The static snapshot helper reads
    // `card.copyOfTargetId` (the B → C ledger set by
    // the Aura refresh) and resolves the leaf.
    //
    // Order of refresh: the engine calls
    // `refreshScriptedStatics` BEFORE
    // `refreshAuraBonuses` (see the SBAs in
    // `state-based-actions.ts`). On the first pass:
    // - `refreshScriptedStatics` sees A with no
    //   B → C ledger yet (B's `copyOfTargetId` is
    //   unset). A's chain is A → B; A overlays B's
    //   printed characteristics. B has no `become_copy`
    //   static of its own (B is the enchanted card,
    //   not the Aura), so the chain terminates at B.
    // - `refreshAuraBonuses` then overlays B's
    //   `cardData` with C's printed characteristics
    //   and stamps B's `copyOfTargetId` to C.
    //
    // On the SECOND pass:
    // - `refreshScriptedStatics` sees A with
    //   `become_copy` pointing at B; the chain
    //   walks A → B → C (B has a `copyOfTargetId`
    //   ledger from the previous pass). A overlays
    //   C's printed characteristics in ONE pass.
    //
    // We assert the second-pass behavior — the
    // snapshot's cross-site chain resolution.
    const A_NAME = `${HOST_NAME} aura-chain A`;
    const SCRIPT_NAME_AURA = `${HOST_NAME} aura-chain Aura`;
    const { state, aliceId } = setupTwoPlayerGame();
    // Add C (the leaf — Grizzly Bears).
    const { state: withC, cardId: cId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    // Add B (the enchanted card — a Shapeshifter
    // with no script of its own).
    const B_NAME = `${HOST_NAME} aura-chain B`;
    const { state: withB, cardId: bId } = putOnBattlefield(
      withC,
      aliceId,
      makeShapeChanger({ id: "b-aura-chain", name: B_NAME }),
    );
    // Add the Aura attached to B with `become_copy`
    // pointing at C.
    const auraDef: ScryfallCard = {
      id: `mock-aura-75e-${Math.random().toString(36).slice(2)}`,
      name: SCRIPT_NAME_AURA,
      type_line: "Enchantment — Aura",
      oracle_text:
        "Enchanted creature is a copy of [chosen permanent] until end of turn.",
      mana_cost: "{2}{U}",
      cmc: 3,
      colors: ["U"],
      color_identity: ["U"],
      keywords: [],
      legalities: { standard: "legal" },
      layout: "normal",
    } as ScryfallCard;
    const { state: withAura, auraId } = putAuraAttachedTo(
      withB,
      aliceId,
      auraDef,
      bId,
    );
    // Register the Aura's script.
    registerAuraCopyEotScript(SCRIPT_NAME_AURA, cId);
    // Refresh the AURA overlay first (so B's
    // `copyOfTargetId` is set to C).
    const afterAura = refreshAuraBonuses(withAura);
    // Now add A with a `become_copy` static
    // pointing at B. Register A's script (A's
    // name is A_NAME, the script is keyed by
    // A_NAME).
    registerBecomeCopyScript(A_NAME, bId);
    const { state: withA, cardId: aId } = putOnBattlefield(
      afterAura,
      aliceId,
      makeShapeChanger({ id: "a-aura-chain", name: A_NAME }),
    );
    // Now refresh scripted statics. The static
    // snapshot must walk A → B → C (B's
    // `copyOfTargetId` was set by the Aura overlay)
    // and overlay A with C's printed
    // characteristics.
    const refreshed = refreshScriptedStatics(withA);
    const a = refreshed.cards.get(aId);
    // A overlays C's printed characteristics
    // (Grizzly Bears).
    expect(a?.cardData.name).toBe("Grizzly Bears");
    expect(a?.cardData.power).toBe("2");
    expect(a?.cardData.toughness).toBe("2");
    expect(a?.animatedUntilEndOfTurn?.cardData.name).toBe(A_NAME);
    // B is still overlaid with C (the Aura overlay
    // persists — `refreshScriptedStatics` doesn't
    // touch the Aura overlay).
    const b = refreshed.cards.get(bId);
    expect(b?.cardData.name).toBe("Grizzly Bears");
    // C is unchanged.
    const c = refreshed.cards.get(cId);
    expect(c?.cardData.name).toBe("Grizzly Bears");
    // The Aura is unchanged.
    const aura = refreshed.cards.get(auraId);
    expect(aura?.cardData.name).toBe(SCRIPT_NAME_AURA);
  });

  it("breaks an Aura cycle: Aura copies enchanted card, enchanted card copies Aura", () => {
    // The Aura cycle: an Aura's `become_copy` arm
    // points at the ENCHANTED card (the Aura
    // "copies" the enchanted creature); the
    // enchanted card has a `become_copy` static
    // pointing at the Aura. The chain is
    // enchanted → Aura → enchanted, which is a
    // cycle. The Aura snapshot helper detects the
    // cycle: the leaf walk visits enchanted,
    // then Aura, then enchanted (already visited)
    // — cycle. The enchanted card's overlay is
    // dropped.
    const ENCHANTED_NAME = `${HOST_NAME} aura-cycle enchanted`;
    const AURA_NAME = `${HOST_NAME} aura-cycle Aura`;
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withEnchanted, cardId: enchantedId } = putOnBattlefield(
      state,
      aliceId,
      makeShapeChanger({
        id: "enchanted-aura-cycle",
        name: ENCHANTED_NAME,
      }),
    );
    const auraDef: ScryfallCard = {
      id: `mock-aura-75e-cycle-${Math.random().toString(36).slice(2)}`,
      name: AURA_NAME,
      type_line: "Enchantment — Aura",
      oracle_text:
        "Enchanted creature is a copy of [chosen permanent] until end of turn.",
      mana_cost: "{2}{U}",
      cmc: 3,
      colors: ["U"],
      color_identity: ["U"],
      keywords: [],
      legalities: { standard: "legal" },
      layout: "normal",
    } as ScryfallCard;
    const { state: withAura, auraId } = putAuraAttachedTo(
      withEnchanted,
      aliceId,
      auraDef,
      enchantedId,
    );
    // Register BOTH the Aura's script (cycle
    // target = enchanted) AND the enchanted
    // card's script (target = Aura) in a single
    // call so the registry has both entries.
    const scripts: CardScript[] = [
      CardScriptSchema.parse({
        name: AURA_NAME,
        oracle:
          "Enchanted creature is a copy of [chosen permanent] until end of turn.",
        aura: {
          text:
            "Enchanted creature is a copy of [chosen permanent] until end of turn.",
          static: {
            text:
              "Enchanted creature is a copy of [chosen permanent] until end of turn.",
            become_copy: {
              target: enchantedId as string,
              until: "end_of_turn",
            },
          },
        },
      }),
      CardScriptSchema.parse({
        name: ENCHANTED_NAME,
        oracle:
          "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
        statics: [
          {
            text:
              "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
            affects: { controller: "you" },
            become_copy: {
              target: auraId as string,
              until: "end_of_turn",
            },
          },
        ],
      }),
    ];
    resetCardScriptsForTests();
    registerCardScripts(scripts);
    const refreshed = refreshAuraBonuses(
      refreshScriptedStatics(withAura),
    );
    // The enchanted card's overlay is dropped
    // (cycle detected). The enchanted card keeps
    // its printed `cardData`.
    const enchanted = refreshed.cards.get(enchantedId);
    expect(enchanted?.cardData.name).toBe(ENCHANTED_NAME);
    expect(enchanted?.copyOfTargetId).toBeUndefined();
    expect(enchanted?.animatedUntilEndOfTurn).toBeUndefined();
  });
});

/**
 * Add an Aura to the battlefield, attached to the
 * named `attachedToId` card. The Aura's script is
 * registered separately via
 * `registerAuraCopyEotScript`.
 */
function putAuraAttachedTo(
  state: GameState,
  controllerId: PlayerId,
  auraDef: ScryfallCard,
  attachedToId: CardInstanceId,
): { state: GameState; auraId: CardInstanceId } {
  const auraId = `card-${auraDef.id}-${Math.random()
    .toString(36)
    .slice(2)}` as CardInstanceId;
  const aura = createCardInstance(auraDef, controllerId, controllerId, {
    id: auraId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  aura.hasSummoningSickness = false;
  (aura as CardInstance & { attachedToId?: CardInstanceId }).attachedToId =
    attachedToId;
  const newCards = new Map(state.cards);
  newCards.set(auraId, aura);
  const newZones = new Map(state.zones);
  const bfKey = `${controllerId}-battlefield`;
  const bf = newZones.get(bfKey);
  if (!bf) throw new Error("battlefield zone not found");
  newZones.set(bfKey, { ...bf, cardIds: [...bf.cardIds, auraId] });
  return {
    state: {
      ...state,
      cards: newCards,
      zones: newZones,
      lastModifiedAt: Date.now(),
    },
    auraId,
  };
}

/**
 * Register an Aura's `become_copy` script with the
 * chosen target's `CardInstanceId` substituted into
 * the `become_copy.target` field.
 */
function registerAuraCopyEotScript(
  hostName: string,
  chosenId: CardInstanceId,
): void {
  const script: CardScript = CardScriptSchema.parse({
    name: hostName,
    oracle:
      "Enchanted creature is a copy of [chosen permanent] until end of turn.",
    aura: {
      text:
        "Enchanted creature is a copy of [chosen permanent] until end of turn.",
      static: {
        text:
          "Enchanted creature is a copy of [chosen permanent] until end of turn.",
        become_copy: {
          target: chosenId as string,
          until: "end_of_turn",
        },
      },
    },
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}
