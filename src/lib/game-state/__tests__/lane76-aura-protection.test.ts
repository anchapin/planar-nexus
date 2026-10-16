/**
 * Wave 4.8 follow-up 6 lane 76 — Aura-shaped protection-from
 * static (`AuraStaticSchema.protectionFrom`) (#2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of recent cards
 * with the "enchanted creature has protection from [quality]"
 * pattern (Akoumep Halberd / Niveous Wisps — Auras that grant
 * protection to the enchanted creature). The v1 minimum adds a
 * `protectionFrom: string[]` arm on `AuraStaticSchema` (parallel
 * to lane 71's `StaticSchema.protectionFrom`) that the engine
 * stamps on the enchanted card's per-instance `protectionFrom:
 * string[]` field via `refreshAuraBonuses`.
 *
 * Schema (card-scripts/schema.ts, AuraStaticSchema):
 *   `protectionFrom: string[]` — optional arm on the aura
 *   static slot. v1 supports a single quality
 *   (`["red"]`); multi-quality protection on Auras
 *   (`["red", "blue"]`) is data-driven via the same
 *   `hasProtectionFrom` `perInstance.some(...)` loop that
 *   lane 71 uses, so no engine change is needed for the
 *   multi-quality case (the schema accepts any length).
 *
 * Engine (keyword-actions/aura-bonus.ts):
 *   `refreshAuraBonuses` collects `protectionFrom` values
 *   from each attached Aura and stamps them on the
 *   enchanted card's `protectionFrom` ledger. The field
 *   is read by `hasProtectionFrom` in
 *   `evergreen-keywords.ts` alongside the parsed keyword
 *   list and the regex fallback. The protection is
 *   dropped when the source Aura leaves the battlefield
 *   (battlefield-zone-only semantics — same as lane 71).
 *
 * Test harness pattern: synthetic card script registered
 * via `CardScriptSchema.parse + registerCardScripts` (the
 * lane 49/52/55/59/60/62/63/64/65/66/67/68/69/70/71/72/73/74
 * pattern). The test exercises the refresh path via the
 * engine's `refreshAuraBonuses` (the same call sites the
 * engine uses for a real cast) and inspects the
 * enchanted card's `protectionFrom` field.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { refreshAuraBonuses } from "../keyword-actions/aura-bonus";
import {
  canBeEnchantedBy,
  canBeTargetedBySource,
  hasProtectionFrom,
  isProtectedFromSource,
  shouldPreventDamageToTarget,
} from "../evergreen-keywords";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test Aura Protection (lane 76)";

const SCRIPT_AURA_PROTECTION: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle: "Enchanted creature has protection from red.",
  aura: {
    text: "Enchanted creature has protection from red.",
    static: {
      text: "Enchanted creature has protection from red.",
      protectionFrom: ["red"],
    },
  },
});

function makeAuraCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? HOST_NAME,
    type_line: overrides.type_line ?? "Enchantment — Aura",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{W}",
    cmc: overrides.cmc ?? 1,
    colors: overrides.colors ?? ["W"],
    color_identity: overrides.color_identity ?? ["W"],
    keywords: overrides.keywords ?? [],
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

const TARGET_CREATURE: ScryfallCard = {
  id: "mock-target-creature-76",
  name: "Target Creature",
  type_line: "Creature — Human",
  oracle_text: "",
  mana_cost: "{2}",
  cmc: 2,
  colors: [],
  color_identity: [],
  keywords: [],
  power: "2",
  toughness: "2",
  legalities: { standard: "legal" },
  layout: "normal",
} as ScryfallCard;

interface SetupResult {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
}

function setupTwoPlayerGame(): SetupResult {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys()) as PlayerId[];
  return {
    state,
    aliceId: playerIds[0],
    bobId: playerIds[1],
  };
}

/**
 * Add the aura + target to the battlefield, then attach the
 * aura to the target. Returns the state with both cards in
 * place.
 */
function putAuraOnTarget(
  state: GameState,
  controllerId: PlayerId,
  auraDef: ScryfallCard,
  targetDef: ScryfallCard,
): { state: GameState; auraId: CardInstanceId; targetId: CardInstanceId } {
  // Add the target first.
  const targetId = `card-${targetDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const target = createCardInstance(targetDef, controllerId, controllerId, {
    id: targetId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  target.hasSummoningSickness = false;
  // Add the aura, attached to the target.
  const auraId = `card-${auraDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const aura = createCardInstance(auraDef, controllerId, controllerId, {
    id: auraId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  aura.hasSummoningSickness = false;
  (aura as CardInstance & { attachedToId?: CardInstanceId }).attachedToId =
    targetId;
  const newCards = new Map(state.cards);
  newCards.set(targetId, target);
  newCards.set(auraId, aura);
  const newZones = new Map(state.zones);
  const bfKey = `${controllerId}-battlefield`;
  const bf = newZones.get(bfKey);
  if (!bf) throw new Error("battlefield zone not found");
  newZones.set(bfKey, { ...bf, cardIds: [...bf.cardIds, targetId, auraId] });
  return {
    state: {
      ...state,
      cards: newCards,
      zones: newZones,
      lastModifiedAt: Date.now(),
    },
    auraId,
    targetId,
  };
}

describe("Wave 4.8 follow-up 6 lane 76 — Aura-shaped protection-from", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
    registerCardScripts([SCRIPT_AURA_PROTECTION]);
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  it("rejects a script with an empty protectionFrom entry (string min length 1)", () => {
    // Schema guard: every entry must be at least 1 character.
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad aura protection (lane 76)",
        oracle: "test",
        aura: {
          text: "test",
          static: {
            text: "test",
            protectionFrom: [""],
          },
        },
      }),
    ).toThrow();
  });

  it("accepts the v1 protectionFrom schema on AuraStaticSchema (single quality)", () => {
    // Sanity check: the script parses and the aura static
    // carries the protection arm.
    const parsed = CardScriptSchema.parse(SCRIPT_AURA_PROTECTION);
    expect(parsed.aura?.static?.protectionFrom).toEqual(["red"]);
  });

  it("accepts multi-quality protectionFrom on AuraStaticSchema (data-driven)", () => {
    // The schema accepts any length; the per-instance
    // `hasProtectionFrom` check already loops with
    // `perInstance.some(...)`, so no engine change is
    // needed for the multi-quality case.
    const parsed = CardScriptSchema.parse({
      name: "Multi-quality aura protection (lane 76)",
      oracle: "Enchanted creature has protection from red and from blue.",
      aura: {
        text: "Enchanted creature has protection from red and from blue.",
        static: {
          text: "Enchanted creature has protection from red and from blue.",
          protectionFrom: ["red", "blue"],
        },
      },
    });
    expect(parsed.aura?.static?.protectionFrom).toEqual(["red", "blue"]);
  });

  it("stamps protectionFrom on the enchanted creature after refresh", () => {
    // Source: the aura on Alice's battlefield, attached
    // to a vanilla creature Alice controls. After
    // `refreshAuraBonuses`, the target's
    // `protectionFrom` ledger carries `["red"]`.
    const { state, aliceId } = setupTwoPlayerGame();
    const auraDef = makeAuraCard({ id: "aura-source" });
    const { state: withAura, targetId } = putAuraOnTarget(
      state,
      aliceId,
      auraDef,
      TARGET_CREATURE,
    );
    const refreshed = refreshAuraBonuses(withAura);
    const target = refreshed.cards.get(targetId);
    expect(target).toBeDefined();
    expect(target?.protectionFrom).toEqual(["red"]);
    // hasProtectionFrom: red is protected; blue is not.
    expect(hasProtectionFrom(target!, "red")).toBe(true);
    expect(hasProtectionFrom(target!, "blue")).toBe(false);
  });

  it("does NOT stamp protectionFrom on a creature the aura is not attached to", () => {
    // Place the aura on Alice's battlefield BUT not
    // attached to anything. The target's
    // `protectionFrom` should remain undefined.
    const { state, aliceId } = setupTwoPlayerGame();
    const auraDef = makeAuraCard({ id: "aura-unattached" });
    const auraId = `card-${auraDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
    const aura = createCardInstance(auraDef, aliceId, aliceId, {
      id: auraId,
      currentZoneKey: `${aliceId}-battlefield`,
    });
    aura.hasSummoningSickness = false;
    const targetId = `card-target-untouched-${Math.random().toString(36).slice(2)}` as CardInstanceId;
    const target = createCardInstance(TARGET_CREATURE, aliceId, aliceId, {
      id: targetId,
      currentZoneKey: `${aliceId}-battlefield`,
    });
    target.hasSummoningSickness = false;
    const newCards = new Map(state.cards);
    newCards.set(auraId, aura);
    newCards.set(targetId, target);
    const newZones = new Map(state.zones);
    const bfKey = `${aliceId}-battlefield`;
    const bf = newZones.get(bfKey);
    if (!bf) throw new Error("battlefield zone not found");
    newZones.set(bfKey, {
      ...bf,
      cardIds: [...bf.cardIds, auraId, targetId],
    });
    const s: GameState = {
      ...state,
      cards: newCards,
      zones: newZones,
      lastModifiedAt: Date.now(),
    };
    const refreshed = refreshAuraBonuses(s);
    const targetCard = refreshed.cards.get(targetId);
    expect(targetCard).toBeDefined();
    expect(targetCard?.protectionFrom).toBeUndefined();
    expect(hasProtectionFrom(targetCard!, "red")).toBe(false);
  });
});

// ---- Wave 4.8 follow-up 24 lane 71 piece 2b ----
// Aura-shaped variant enforcement verification: confirm an
// enchanted card whose `protectionFrom: ["red"]` ledger was
// stamped by `refreshAuraBonuses` cascades through the
// full CR 702.16 enforcement surface on the
// `evergreen-keywords` side — the symmetric surface that
// piece 2/N widened in follow-up 23. Lane 76 above proves
// the substrate stamps the field + the strict
// `hasProtectionFrom` reads it; this block proves the same
// stamped field drives the combat-side, enchant-side, and
// damage-prevention consults. v1 minimum is exercising
// every `evergreen-keywords` enforcement delegate through
// the Aura-shaped substrate — the substrate is unchanged
// (no engine delta expected) and the test is the regression
// guard for the consult cascade.
describe("Lane 71 piece 2b (follow-up 24) — Aura-shaped variant enforcement surface", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
    registerCardScripts([SCRIPT_AURA_PROTECTION]);
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  // Helper: build a red source card on Bob's battlefield
  // so the enchanted target (on Alice's battlefield, with
  // the stamped ledger) consults a red enemy source for
  // each enforcement surface.
  function redSource(
    state: GameState,
    controllerId: PlayerId,
    idSuffix: string,
  ): { state: GameState; sourceId: CardInstanceId } {
    const sourceId = `card-red-source-${idSuffix}-${Math.random()
      .toString(36)
      .slice(2)}` as CardInstanceId;
    const sourceDef: ScryfallCard = {
      id: "mock-red-source-71-2b",
      name: "Red Bolt",
      type_line: "Instant",
      oracle_text: "",
      mana_cost: "{R}",
      cmc: 1,
      colors: ["R"],
      color_identity: ["R"],
      keywords: [],
      legalities: { standard: "legal" },
      layout: "normal",
    } as ScryfallCard;
    const source = createCardInstance(sourceDef, controllerId, controllerId, {
      id: sourceId,
      currentZoneKey: `${controllerId}-hand`,
    });
    source.hasSummoningSickness = false;
    const newCards = new Map(state.cards);
    newCards.set(sourceId, source);
    return {
      state: { ...state, cards: newCards, lastModifiedAt: Date.now() },
      sourceId,
    };
  }

  function redAuraSource(
    state: GameState,
    controllerId: PlayerId,
    idSuffix: string,
  ): { state: GameState; sourceId: CardInstanceId } {
    const sourceId = `card-red-aura-${idSuffix}-${Math.random()
      .toString(36)
      .slice(2)}` as CardInstanceId;
    const sourceDef: ScryfallCard = {
      id: "mock-red-aura-71-2b",
      name: "Red Grip",
      type_line: "Enchantment — Aura",
      oracle_text: "",
      mana_cost: "{R}",
      cmc: 1,
      colors: ["R"],
      color_identity: ["R"],
      keywords: [],
      legalities: { standard: "legal" },
      layout: "normal",
    } as ScryfallCard;
    const source = createCardInstance(sourceDef, controllerId, controllerId, {
      id: sourceId,
      currentZoneKey: `${controllerId}-hand`,
    });
    source.hasSummoningSickness = false;
    const newCards = new Map(state.cards);
    newCards.set(sourceId, source);
    return {
      state: { ...state, cards: newCards, lastModifiedAt: Date.now() },
      sourceId,
    };
  }

  it("isProtectedFromSource returns true when an Aura-stamped protectionFrom ledger matches the source's color", () => {
    // The substrate stamps `protectionFrom: ["red"]` on
    // the enchanted card. v1 must return true via the
    // `evergreen-keywords.getProtectionQualities` consult
    // (widened in follow-up 23 lane 71 piece 2/N) when
    // matched against a red source. Pre-piece-2/N the
    // consult missed the ledger and returned false.
    const { state, aliceId, bobId } = setupTwoPlayerGame();
    const auraDef = makeAuraCard({ id: "aura-71-2b-direct" });
    const { state: withAura, targetId } = putAuraOnTarget(
      state,
      aliceId,
      auraDef,
      TARGET_CREATURE,
    );
    const refreshed = refreshAuraBonuses(withAura);
    const { state: withSource, sourceId } = redSource(refreshed, bobId, "direct");
    const target = refreshed.cards.get(targetId)!;
    const source = withSource.cards.get(sourceId)!;
    expect(target.protectionFrom).toEqual(["red"]);
    expect(isProtectedFromSource(target, source)).toBe(true);
  });

  it("canBeTargetedBySource returns false for a source whose color matches the Aura-stamped ledger (CR 702.16a)", () => {
    // CR 702.16a — the Aura's stamped protection prevents
    // targeting by a red source.
    const { state, aliceId, bobId } = setupTwoPlayerGame();
    const auraDef = makeAuraCard({ id: "aura-71-2b-target" });
    const { state: withAura, targetId } = putAuraOnTarget(
      state,
      aliceId,
      auraDef,
      TARGET_CREATURE,
    );
    const refreshed = refreshAuraBonuses(withAura);
    const { state: withSource, sourceId } = redSource(refreshed, bobId, "tgt");
    const target = refreshed.cards.get(targetId)!;
    const source = withSource.cards.get(sourceId)!;
    expect(canBeTargetedBySource(target, source)).toBe(false);
  });

  it("canBeEnchantedBy returns false when a red Aura tries to enchant a target whose ledger says red (CR 702.16b)", () => {
    // CR 702.16b — protection prevents enchanting. v1
    // returns false when the source is an Aura and its
    // color matches the Aura-stamped ledger.
    const { state, aliceId, bobId } = setupTwoPlayerGame();
    const auraDef = makeAuraCard({ id: "aura-71-2b-enchant" });
    const { state: withAura, targetId } = putAuraOnTarget(
      state,
      aliceId,
      auraDef,
      TARGET_CREATURE,
    );
    const refreshed = refreshAuraBonuses(withAura);
    const { state: withAura2, sourceId } = redAuraSource(refreshed, bobId, "ench");
    const target = refreshed.cards.get(targetId)!;
    const auraSource = withAura2.cards.get(sourceId)!;
    expect(canBeEnchantedBy(target, auraSource)).toBe(false);
  });

  it("shouldPreventDamageToTarget returns true for a dealer whose color matches the Aura-stamped ledger (CR 702.16c)", () => {
    // CR 702.16c — protection prevents damage from a red
    // source.
    const { state, aliceId, bobId } = setupTwoPlayerGame();
    const auraDef = makeAuraCard({ id: "aura-71-2b-damage" });
    const { state: withAura, targetId } = putAuraOnTarget(
      state,
      aliceId,
      auraDef,
      TARGET_CREATURE,
    );
    const refreshed = refreshAuraBonuses(withAura);
    const { state: withSource, sourceId } = redSource(refreshed, bobId, "dmg");
    const target = refreshed.cards.get(targetId)!;
    const source = withSource.cards.get(sourceId)!;
    expect(shouldPreventDamageToTarget(target, source)).toBe(true);
  });

  it("the Aura-shaped enforcement clears when the Aura leaves the battlefield (regression guard)", () => {
    // The Aura-stamped protection is battlefield-zone-only
    // (parallel to lane 71 piece 1/N's per-instance ledger
    // clear-on-leaves semantics). v1 drops the stamped
    // ledger when the Aura leaves the battlefield and the
    // `isProtectedFromSource` consult returns false
    // again. The substrate did this already (lane 76
    // follow-up 6 confirm); piece 2b adds the consult
    // regression guard so the consult cascade stays in
    // sync with the substrate diff.
    const { state, aliceId, bobId } = setupTwoPlayerGame();
    const auraDef = makeAuraCard({ id: "aura-71-2b-clear" });
    const { state: withAura, auraId, targetId } = putAuraOnTarget(
      state,
      aliceId,
      auraDef,
      TARGET_CREATURE,
    );
    const refreshed = refreshAuraBonuses(withAura);
    const targetBefore = refreshed.cards.get(targetId)!;
    expect(targetBefore.protectionFrom).toEqual(["red"]);
    // Remove the aura from the battlefield (move it to
    // the graveyard via a zones-only patch — parallel to
    // the existing "drops the bonus when the aura leaves"
    // pattern in aura-bonus.test.ts).
    const zones2 = new Map(refreshed.zones);
    const bfKey = `${aliceId}-battlefield`;
    const bf = zones2.get(bfKey)!;
    zones2.set(bfKey, {
      ...bf,
      cardIds: bf.cardIds.filter((c) => c !== auraId),
    });
    const refreshed2 = refreshAuraBonuses({
      ...refreshed,
      zones: zones2,
      lastModifiedAt: Date.now(),
    });
    const targetAfter = refreshed2.cards.get(targetId)!;
    expect(targetAfter.protectionFrom).toBeUndefined();
    const { state: withSource, sourceId } = redSource(refreshed2, bobId, "clr");
    const source = withSource.cards.get(sourceId)!;
    expect(isProtectedFromSource(targetAfter, source)).toBe(false);
    expect(shouldPreventDamageToTarget(targetAfter, source)).toBe(false);
  });
});
