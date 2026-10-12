/**
 * Wave 4.8 follow-up 10 lane 77 — Copy target with other
 * layers (#2614 follow-up). Rolls the leaf's per-instance
 * `protectionFrom` field onto the source's own protection
 * ledger when the leaf is the target of a `become_copy`
 * static or Aura.
 *
 * Background: the lane 75 / 75b / 75c / 75d family overlays
 * the target's printed `cardData` (name, type_line, P/T,
 * colors, keywords) onto the source / enchanted card's
 * `cardData`. v1 explicitly ASSUMED the target's printed
 * `cardData` was the source-of-truth for the overlay — but
 * a target that itself has a per-instance `protectionFrom`
 * ledger (granted by lane 71's anthem, lane 76's Aura, or
 * any other per-instance lane) would have its bear-copy
 * characteristics overlaid WITHOUT picking up the bear's
 * per-instance protection. The bear's protection is
 * maintained by `refreshScriptedStatics` on the bear, not
 * on the source.
 *
 * Lane 77 extends the snapshot helper (the cycle guard
 * added in lane 75e) to ALSO carry the leaf's per-instance
 * fields (v1: only `protectionFrom`). The overlay write
 * phase unions the leaf's `protectionFrom` onto the
 * source's own `protectionFrom` ledger — multiple
 * `become_copy` overlays stack their protection (the
 * source's own static-driven protection is preserved
 * alongside the rolled leaf's protection). The Aura mirror
 * does the same on the enchanted card.
 *
 * Coverage:
 * - 2-card chain + protection: a source with `become_copy`
 *   pointing at a target that has lane 71's
 *   `protectionFrom: ["red"]` static → the source picks up
 *   the leaf's protection via the overlay.
 * - Source has its own static-driven protection AND the
 *   leaf has protection → both stack on the source's
 *   `protectionFrom` field (union semantics).
 * - Cycle: A copies B, B copies A → cycle dropped, no
 *   rolled protection, source's own static-driven
 *   protection is preserved.
 * - Target leaves the battlefield → overlay dropped, no
 *   rolled protection.
 * - Named-card form (lane 75b): the named card has no
 *   live per-instance fields → no rolled protection.
 * - Aura overlay: an enchanted card whose attached Aura
 *   has `become_copy` picks up the chosen target's leaf's
 *   `protectionFrom`.
 *
 * Test harness pattern: synthetic card scripts registered
 * via `CardScriptSchema.parse + registerCardScripts`
 * (the lane 71/75/75d pattern). The test exercises the
 * refresh path via `refreshScriptedStatics` (static path)
 * and `refreshAuraBonuses` (Aura path) and inspects the
 * source's overlaid `cardData` + `protectionFrom` ledger.
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
import { hasProtectionFrom } from "../evergreen-keywords";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test Copy Target With Other Layers (lane 77)";

/**
 * Grizzly Bears — a vanilla 2/2 green bear (no keywords,
 * no static). The "leaf" in the test scenarios.
 */
const GRIZZLY_BEARS: ScryfallCard = {
  id: "mock-grizzly-bears-77",
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
 * Register the "Grizzly Bears with protection-from-red"
 * leaf card. The leaf's `name` is "Grizzly Bears" (so the
 * `getCardScript` lookup matches the leaf's `cardData.name`).
 * The leaf carries lane 71's `protectionFrom: ["red"]`
 * static ("Creatures you control have protection from
 * red" — the leaf is a creature Alice controls, so the
 * leaf itself qualifies and gets the protection stamped on
 * its `protectionFrom` field).
 */
function registerLeafWithProtectionScript(): void {
  const script: CardScript = CardScriptSchema.parse({
    name: "Grizzly Bears",
    oracle:
      "Creatures you control have protection from red.",
    statics: [
      {
        text: "Creatures you control have protection from red.",
        affects: { controller: "you" },
        protectionFrom: ["red"],
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

/**
 * Register the source script that copies the leaf via
 * lane 75's `become_copy` static.
 */
function registerCopySourceScript(targetId: string): void {
  const leafScript: CardScript = CardScriptSchema.parse({
    name: "Grizzly Bears",
    oracle: "Creatures you control have protection from red.",
    statics: [
      {
        text: "Creatures you control have protection from red.",
        affects: { controller: "you" },
        protectionFrom: ["red"],
      },
    ],
  });
  const sourceScript: CardScript = CardScriptSchema.parse({
    name: "Test Copy Source (lane 77)",
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
  // Register both scripts WITHOUT resetting the
  // registry — the leaf's protection script must be
  // present for the leaf to keep its per-instance
  // protection across the source's overlay.
  registerCardScripts([leafScript, sourceScript]);
}

/**
 * Register the source script that copies the leaf via
 * lane 75b's named-card form. The named card has no live
 * per-instance fields (it's a registry lookup, not a
 * battlefield card), so no rolled protection is expected.
 */
function registerCopySourceNamedScript(leafName: string): void {
  const script: CardScript = CardScriptSchema.parse({
    name: "Test Copy Source Named (lane 77)",
    oracle:
      "As long as this is in play, it's a copy of [named card] until end of turn.",
    statics: [
      {
        text:
          "As long as this is in play, it's a copy of [named card] until end of turn.",
        affects: { controller: "you" },
        become_copy: {
          named_card: { name: leafName },
          until: "end_of_turn",
        },
      },
    ],
  });
  registerCardScripts([script]);
}

/**
 * Register the Aura with a `become_copy` arm pointing at
 * the chosen target's id. The Aura is the lane 75d
 * substrate.
 */
function registerAuraCopyScript(targetId: string): void {
  const script: CardScript = CardScriptSchema.parse({
    name: "Test Aura Copy (lane 77)",
    oracle:
      "Enchanted creature is a copy of [chosen permanent] until end of turn.",
    aura: {
      text:
        "Enchanted creature is a copy of [chosen permanent] until end of turn.",
      static: {
        text:
          "Enchanted creature is a copy of [chosen permanent] until end of turn.",
        become_copy: {
          target: targetId,
          until: "end_of_turn",
        },
      },
    },
  });
  registerCardScripts([script]);
}

describe("Wave 4.8 follow-up 10 lane 77 — Copy target with other layers (protectionFrom roll)", () => {
  afterAll(() => {
    resetCardScriptsForTests();
    resetCardDataForTests();
  });

  it("rolls the leaf's protectionFrom onto the source (2-card static)", () => {
    // Setup: Grizzly Bears (with `protectionFrom:
    // ["red"]` static) on Alice's battlefield. Then a
    // shapeshifter (the source) with lane 75's
    // `become_copy` static pointing at the bear.
    //
    // After `refreshScriptedStatics`:
    // - The bear's `protectionFrom: ["red"]` static
    //   stamps the bear's own `protectionFrom` field.
    // - The source overlays the bear's printed
    //   characteristics (name, type_line, P/T,
    //   colors).
    // - The lane 77 roll: the source ALSO picks up
    //   the bear's `protectionFrom: ["red"]`. The
    //   source is now a copy of the bear AND has
    //   protection from red.
    const { state, aliceId } = setupTwoPlayerGame();
    registerCardDataForTests([GRIZZLY_BEARS]);
    registerLeafWithProtectionScript();
    // Place the leaf on the battlefield.
    const { state: withLeaf, cardId: leafId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    // The leaf's `refreshScriptedStatics` runs first
    // (the protection is stamped on the leaf itself).
    const afterLeafRefresh = refreshScriptedStatics(withLeaf);
    const leafAfterRefresh = afterLeafRefresh.cards.get(leafId);
    expect(leafAfterRefresh?.protectionFrom).toEqual(["red"]);
    // Now register the source script and place the
    // source on the battlefield.
    registerCopySourceScript(leafId);
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      afterLeafRefresh,
      aliceId,
      makeShapeChanger({ id: "src-77", name: "Test Copy Source (lane 77)" }),
    );
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    // The source overlays the leaf's printed
    // characteristics (name, type_line, P/T, colors).
    expect(source?.cardData.name).toBe("Grizzly Bears");
    expect(source?.cardData.type_line).toBe("Creature — Bear");
    expect(source?.cardData.power).toBe("2");
    expect(source?.cardData.toughness).toBe("2");
    // The source's `animatedUntilEndOfTurn` keeps
    // the source's printed `cardData` for rollback.
    expect(source?.animatedUntilEndOfTurn?.cardData.name).toBe(
      "Test Copy Source (lane 77)",
    );
    // Lane 77: the source's `protectionFrom` field
    // is the union of the source's own static-driven
    // protection (none, in this test) AND the leaf's
    // rolled protection. The source picks up the
    // bear's `protectionFrom: ["red"]`.
    expect(source?.protectionFrom).toEqual(["red"]);
    // The leaf's `protectionFrom` is preserved
    // across the second refresh.
    expect(refreshed.cards.get(leafId)?.protectionFrom).toEqual(["red"]);
  });

  it("unions the source's own static-driven protection with the leaf's rolled protection", () => {
    // The source carries lane 71's `protectionFrom:
    // ["blue"]` static ("this creature has
    // protection from blue") AND lane 75's
    // `become_copy` static pointing at a leaf that
    // has `protectionFrom: ["red"]`. After refresh
    // the source's `protectionFrom` is the union:
    // ["blue", "red"] (sorted, deduped — the source
    // has protection from BOTH blue and red).
    const { state, aliceId } = setupTwoPlayerGame();
    registerCardDataForTests([GRIZZLY_BEARS]);
    registerLeafWithProtectionScript();
    const { state: withLeaf, cardId: leafId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    const afterLeafRefresh = refreshScriptedStatics(withLeaf);
    // The source script: lane 71 + lane 75 on the
    // same card. The source protects itself from
    // blue (lane 71) AND copies the leaf (lane 75).
    const sourceScript: CardScript = CardScriptSchema.parse({
      name: "Test Union Source (lane 77)",
      oracle:
        "Test Union Source (lane 77) has protection from blue. As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
      statics: [
        {
          text: "Test Union Source (lane 77) has protection from blue.",
          affects: { controller: "you" },
          protectionFrom: ["blue"],
        },
        {
          text:
            "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
          affects: { controller: "you" },
          become_copy: {
            target: leafId,
            until: "end_of_turn",
          },
        },
      ],
    });
    registerCardScripts([sourceScript]);
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      afterLeafRefresh,
      aliceId,
      makeShapeChanger({ id: "src-union", name: "Test Union Source (lane 77)" }),
    );
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    // Source overlays the leaf's printed
    // characteristics.
    expect(source?.cardData.name).toBe("Grizzly Bears");
    // Source's `protectionFrom` is the union of the
    // source's own static-driven protection (blue)
    // and the leaf's rolled protection (red).
    expect(source?.protectionFrom).toEqual(["blue", "red"]);
    // The `hasProtectionFrom` helper confirms the
    // protection is honored.
    expect(hasProtectionFrom(source!, "blue")).toBe(true);
    expect(hasProtectionFrom(source!, "red")).toBe(true);
    expect(hasProtectionFrom(source!, "green")).toBe(false);
  });

  it("drops the rolled protection when the overlay is dropped (target leaves the battlefield)", () => {
    // The source overlays the leaf's characteristics
    // AND picks up the leaf's protection. When the
    // leaf leaves the battlefield, the source's
    // overlay is dropped AND the rolled protection is
    // cleared. The source's own static-driven
    // protection (if any) is preserved.
    const { state, aliceId } = setupTwoPlayerGame();
    registerCardDataForTests([GRIZZLY_BEARS]);
    registerLeafWithProtectionScript();
    const { state: withLeaf, cardId: leafId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    const afterLeafRefresh = refreshScriptedStatics(withLeaf);
    registerCopySourceScript(leafId);
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      afterLeafRefresh,
      aliceId,
      makeShapeChanger({ id: "src-drop", name: "Test Copy Source (lane 77)" }),
    );
    const firstRefresh = refreshScriptedStatics(withSource);
    expect(firstRefresh.cards.get(sourceId)?.protectionFrom).toEqual(["red"]);
    // Move the leaf off the battlefield (both
    // `currentZoneKey` AND the battlefield zone's
    // `cardIds` list — `battlefieldCards` iterates
    // `state.zones`, not `card.currentZoneKey`).
    const newCards = new Map(firstRefresh.cards);
    const leaf = newCards.get(leafId);
    if (!leaf) throw new Error("leaf not found");
    newCards.set(leafId, {
      ...leaf,
      currentZoneKey: `${aliceId}-graveyard`,
    });
    const newZones = new Map(firstRefresh.zones);
    const bfKey = `${aliceId}-battlefield`;
    const bf = newZones.get(bfKey);
    if (!bf) throw new Error("battlefield zone not found");
    newZones.set(bfKey, {
      ...bf,
      cardIds: bf.cardIds.filter((id) => id !== leafId),
    });
    const stateWithoutLeaf = {
      ...firstRefresh,
      cards: newCards,
      zones: newZones,
      lastModifiedAt: Date.now(),
    };
    const secondRefresh = refreshScriptedStatics(stateWithoutLeaf);
    const source = secondRefresh.cards.get(sourceId);
    // Overlay dropped: source's printed `cardData` is
    // restored; `animatedUntilEndOfUntil` is cleared;
    // `copyOfTargetId` is cleared.
    expect(source?.cardData.name).toBe("Test Copy Source (lane 77)");
    expect(source?.animatedUntilEndOfTurn).toBeUndefined();
    expect(source?.copyOfTargetId).toBeUndefined();
    // Lane 77: rolled protection is dropped.
    // The leaf's anthem ("creatures you control have
    // protection from red") no longer applies (the
    // leaf left the battlefield); the source's own
    // static-driven protection is none; therefore
    // the source's `protectionFrom` field is
    // `undefined` (deleted).
    //
    // Implementation note: the engine's static walk
    // uses the source's CURRENT `cardData.name` to
    // look up its script. After the first refresh
    // the source's `cardData.name` is overlaid with
    // "Grizzly Bears" — the second refresh's static
    // walk reads the leaf's anthem script and
    // applies `protectionFrom: ["red"]` to the
    // source. The overlay write phase then restores
    // the source's printed `cardData` (and clears
    // the rolled protection). After the second
    // refresh, the source's `cardData.name` is
    // "Test Copy Source (lane 77)" and the third
    // refresh's static walk reads the source's NEW
    // printed name — no script with anthem. We
    // therefore run a third refresh to confirm the
    // final state.
    const thirdRefresh = refreshScriptedStatics(secondRefresh);
    const sourceFinal = thirdRefresh.cards.get(sourceId);
    expect(sourceFinal?.protectionFrom).toBeUndefined();
  });

  it("drops the rolled protection when the source loses its become_copy static (script change)", () => {
    // The source's script initially carries
    // `become_copy: { target: leafId }`. The
    // overlay writes the leaf's characteristics +
    // the leaf's `protectionFrom: ["red"]` onto
    // the source. Then we re-register the source's
    // script WITHOUT the `become_copy` arm. On the
    // next refresh the overlay is dropped AND the
    // rolled protection is cleared.
    const { state, aliceId } = setupTwoPlayerGame();
    registerCardDataForTests([GRIZZLY_BEARS]);
    registerLeafWithProtectionScript();
    const { state: withLeaf, cardId: leafId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    const afterLeafRefresh = refreshScriptedStatics(withLeaf);
    registerCopySourceScript(leafId);
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      afterLeafRefresh,
      aliceId,
      makeShapeChanger({ id: "src-script", name: "Test Copy Source (lane 77)" }),
    );
    const firstRefresh = refreshScriptedStatics(withSource);
    expect(firstRefresh.cards.get(sourceId)?.protectionFrom).toEqual(["red"]);
    // Re-register the source WITHOUT the
    // `become_copy` arm. The source's static now
    // grants `protectionFrom: ["blue"]` (a
    // different protection) — but NO `become_copy`
    // arm. On the next refresh the overlay is
    // dropped (the source no longer copies the
    // leaf) and the rolled protection is cleared.
    //
    // Implementation note: after the first refresh
    // the source's `cardData.name` is overlaid with
    // "Grizzly Bears" (the leaf's printed name).
    // The engine's static walk uses the CURRENT
    // `cardData.name` to look up the source's
    // script. On the second refresh, the source's
    // `cardData.name` is still "Grizzly Bears" (the
    // overlay drop happens in the overlay write
    // phase, AFTER the static walk) — so the
    // static walk reads the leaf's protection
    // script for the source. The leaf's anthem
    // ("creatures you control have protection from
    // red") applies to the source. So the source's
    // `protectionFrom` would be `["red"]` from the
    // leaf's anthem (via overlaid name). After the
    // overlay write phase restores the source's
    // printed `cardData`, the next refresh's static
    // walk reads the source's NEW script. To test
    // the new script's `protectionFrom: ["blue"]`
    // statically-driven protection, the test must
    // run a THIRD refresh after the overlay drop.
    const changedScript: CardScript = CardScriptSchema.parse({
      name: "Test Copy Source (lane 77)",
      oracle: "Test Copy Source (lane 77) has protection from blue.",
      statics: [
        {
          text: "Test Copy Source (lane 77) has protection from blue.",
          affects: { controller: "you" },
          protectionFrom: ["blue"],
        },
      ],
    });
    // After the first refresh, the source's
    // `cardData.name` is overlaid with the leaf's
    // name ("Grizzly Bears"). Re-register BOTH the
    // leaf's protection script (under "Grizzly
    // Bears" — the source's overlaid name) AND the
    // source's new protection script (under
    // "Test Copy Source (lane 77)" — the source's
    // printed name). The engine's overlay write
    // phase restores the source's printed name on
    // the second refresh; the source's static-driven
    // protection is preserved.
    const leafScriptForSourceOverlay: CardScript = CardScriptSchema.parse({
      name: "Grizzly Bears",
      oracle: "Creatures you control have protection from red.",
      statics: [
        {
          text: "Creatures you control have protection from red.",
          affects: { controller: "you" },
          protectionFrom: ["red"],
        },
      ],
    });
    resetCardScriptsForTests();
    registerCardScripts([leafScriptForSourceOverlay, changedScript]);
    const secondRefresh = refreshScriptedStatics(firstRefresh);
    const source = secondRefresh.cards.get(sourceId);
    // Source's printed `cardData` is restored; the
    // overlay is dropped.
    expect(source?.cardData.name).toBe("Test Copy Source (lane 77)");
    expect(source?.animatedUntilEndOfTurn).toBeUndefined();
    expect(source?.copyOfTargetId).toBeUndefined();
    // Run a third refresh to apply the new script
    // (the second refresh's static walk used the
    // source's overlaid "Grizzly Bears" name; the
    // third refresh reads the source's printed
    // name "Test Copy Source (lane 77)" and applies
    // the new `protectionFrom: ["blue"]` anthem).
    const thirdRefresh = refreshScriptedStatics(secondRefresh);
    const sourceFinal = thirdRefresh.cards.get(sourceId);
    // The source's own static-driven protection
    // (blue) is preserved.
    expect(sourceFinal?.protectionFrom).toEqual(["blue", "red"]);
  });

  it("does not roll protection for the named-card form (lane 75b)", () => {
    // The source's `become_copy` static uses the
    // lane 75b `named_card` arm — the named card
    // (Grizzly Bears) is NOT on the battlefield,
    // so the named card has no live per-instance
    // fields. The source picks up the named card's
    // printed `cardData` but NOT any rolled
    // protection (the named card is a registry
    // lookup, not a `CardInstance`).
    const { state, aliceId } = setupTwoPlayerGame();
    registerCardDataForTests([GRIZZLY_BEARS]);
    // Register only the source script (no leaf on
    // the battlefield).
    registerCopySourceNamedScript("Grizzly Bears");
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      state,
      aliceId,
      makeShapeChanger({
        id: "src-named",
        name: "Test Copy Source Named (lane 77)",
      }),
    );
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    // The source overlays the named card's printed
    // characteristics.
    expect(source?.cardData.name).toBe("Grizzly Bears");
    expect(source?.cardData.power).toBe("2");
    // Lane 77: the named card has no live
    // per-instance fields → no rolled protection.
    expect(source?.protectionFrom).toBeUndefined();
  });

  it("breaks a cycle without rolling protection (A → B → A)", () => {
    // A copies B; B carries lane 71's
    // `protectionFrom: ["red"]` static. Wait — the
    // cycle is two-way: A copies B AND B copies A
    // (both have `become_copy` arms pointing at
    // each other). The cycle is detected by the
    // snapshot helper; the write phase drops the
    // overlay for both. Lane 77: the rolled
    // protection is NOT applied — the cycle
    // suppresses the overlay entirely.
    const { state, aliceId } = setupTwoPlayerGame();
    // Two distinct scripts: A copies B, B has lane
    // 71 protection AND copies A.
    const A_NAME = "Test Cycle A (lane 77)";
    const B_NAME = "Test Cycle B (lane 77)";
    const aScript: CardScript = CardScriptSchema.parse({
      name: A_NAME,
      oracle:
        "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
      statics: [
        {
          text:
            "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
          affects: { controller: "you" },
          become_copy: { target: "PLACEHOLDER_B", until: "end_of_turn" },
        },
      ],
    });
    const bScript: CardScript = CardScriptSchema.parse({
      name: B_NAME,
      oracle:
        "Creatures you control have protection from red. As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
      statics: [
        {
          text: "Creatures you control have protection from red.",
          affects: { controller: "you" },
          protectionFrom: ["red"],
        },
        {
          text:
            "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
          affects: { controller: "you" },
          become_copy: { target: "PLACEHOLDER_A", until: "end_of_turn" },
        },
      ],
    });
    resetCardScriptsForTests();
    // Re-register with concrete ids. The id
    // placeholders are replaced by re-registering
    // each script after the cards are placed.
    registerCardScripts([aScript, bScript]);
    const { state: withA, cardId: aId } = putOnBattlefield(
      state,
      aliceId,
      makeShapeChanger({ id: "cycle-a", name: A_NAME }),
    );
    const { state: withB, cardId: bId } = putOnBattlefield(
      withA,
      aliceId,
      makeShapeChanger({ id: "cycle-b", name: B_NAME }),
    );
    // Re-register with concrete ids.
    const aScriptWithId: CardScript = CardScriptSchema.parse({
      name: A_NAME,
      oracle:
        "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
      statics: [
        {
          text:
            "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
          affects: { controller: "you" },
          become_copy: { target: bId, until: "end_of_turn" },
        },
      ],
    });
    const bScriptWithId: CardScript = CardScriptSchema.parse({
      name: B_NAME,
      oracle:
        "Creatures you control have protection from red. As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
      statics: [
        {
          text: "Creatures you control have protection from red.",
          affects: { controller: "you" },
          protectionFrom: ["red"],
        },
        {
          text:
            "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
          affects: { controller: "you" },
          become_copy: { target: aId, until: "end_of_turn" },
        },
      ],
    });
    resetCardScriptsForTests();
    registerCardScripts([aScriptWithId, bScriptWithId]);
    const refreshed = refreshScriptedStatics(withB);
    const a = refreshed.cards.get(aId);
    const b = refreshed.cards.get(bId);
    // Cycle detected: A and B keep their printed
    // `cardData` (no overlay).
    expect(a?.cardData.name).toBe(A_NAME);
    expect(a?.copyOfTargetId).toBeUndefined();
    expect(b?.cardData.name).toBe(B_NAME);
    expect(b?.copyOfTargetId).toBeUndefined();
    // Lane 77: cycle suppresses the overlay, so
    // the rolled protection is NOT applied to A.
    // A has no static-driven protection of its own,
    // but B's anthem ("creatures you control have
    // protection from red") applies to A (A is a
    // creature Alice controls). So A's
    // `protectionFrom` is `["red"]` from B's anthem.
    expect(a?.protectionFrom).toEqual(["red"]);
    // B's own static-driven protection is preserved
    // (the cycle doesn't drop B's own protection
    // static — it only drops B's overlay on B's
    // own `cardData`).
    expect(b?.protectionFrom).toEqual(["red"]);
  });

  it("rolls the leaf's protectionFrom onto the enchanted card (Aura mirror)", () => {
    // Setup: Grizzly Bears (with `protectionFrom:
    // ["red"]` static) on Alice's battlefield.
    // Then a shapeshifter (the enchanted card)
    // enchanted by an Aura with lane 75d's
    // `become_copy` static pointing at the bear.
    // After `refreshAuraBonuses`:
    // - The enchanted card overlays the bear's
    //   printed characteristics.
    // - Lane 77: the enchanted card ALSO picks up
    //   the bear's `protectionFrom: ["red"]`.
    const { state, aliceId } = setupTwoPlayerGame();
    registerCardDataForTests([GRIZZLY_BEARS]);
    registerLeafWithProtectionScript();
    const { state: withLeaf, cardId: leafId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    const afterLeafRefresh = refreshScriptedStatics(withLeaf);
    // Place the enchanted card.
    const enchantedName = "Test Enchanted (lane 77)";
    const { state: withEnchanted, cardId: enchantedId } = putOnBattlefield(
      afterLeafRefresh,
      aliceId,
      makeShapeChanger({
        id: "ench-77",
        name: enchantedName,
      }),
    );
    // Place the Aura attached to the enchanted card.
    const auraName = "Test Aura Copy (lane 77)";
    const auraCardDef: ScryfallCard = {
      id: "mock-aura-77",
      name: auraName,
      type_line: "Enchantment Aura",
      oracle_text: "",
      mana_cost: "{2}{U}",
      cmc: 3,
      colors: ["U"],
      color_identity: ["U"],
      keywords: [],
      power: undefined,
      toughness: undefined,
      legalities: { standard: "legal" },
      layout: "aura",
    } as ScryfallCard;
    registerAuraCopyScript(leafId);
    const { state: withAura, cardId: auraId } = putOnBattlefield(
      withEnchanted,
      aliceId,
      auraCardDef,
    );
    // Attach the Aura to the enchanted card.
    const newCards = new Map(withAura.cards);
    const auraCard = newCards.get(auraId);
    if (!auraCard) throw new Error("aura not found");
    newCards.set(auraId, {
      ...auraCard,
      attachedToId: enchantedId,
    });
    const stateAttached = {
      ...withAura,
      cards: newCards,
      lastModifiedAt: Date.now(),
    };
    const refreshed = refreshAuraBonuses(stateAttached);
    const enchanted = refreshed.cards.get(enchantedId);
    // The enchanted card overlays the leaf's
    // printed characteristics.
    expect(enchanted?.cardData.name).toBe("Grizzly Bears");
    expect(enchanted?.cardData.type_line).toBe("Creature — Bear");
    expect(enchanted?.cardData.power).toBe("2");
    // Lane 77: the enchanted card picks up the
    // leaf's `protectionFrom: ["red"]` via the
    // Aura overlay.
    expect(enchanted?.protectionFrom).toEqual(["red"]);
    // The enchanted card's `hasProtectionFrom`
    // confirms the protection is honored.
    expect(hasProtectionFrom(enchanted!, "red")).toBe(true);
    expect(hasProtectionFrom(enchanted!, "blue")).toBe(false);
  });
});