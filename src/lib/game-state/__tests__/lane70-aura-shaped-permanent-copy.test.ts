/**
 * Wave 4.8 follow-up 24 lane 70 piece 2/N — Aura-shaped
 * permanent-arm copy variant (a.k.a. "enchanted creature
 * is a copy of [chosen permanent] forever") (#2614
 * follow-up).
 *
 * Parallel to lane 75d's EOT Aura-shape test file. The
 * substrate follows the lane 70 piece 2b
 * permanent-copy overlay — `permanentCopyPrintedCardData`
 * snapshot + `copyOfTargetIdPermanent` ledger on the
 * ENCHANTED card, plus the AURA's own
 * `copyOfTargetIdPermanent` stamp via `setPermanentCopyOf`.
 * Cleanup runs on Aura-detach
 * (`clearPermanentCopyOf` on the Aura + restore-from-
 * snapshot on the enchanted card) and on
 * `restorePermanentCopyOffBattlefield` consult for
 * either card leaving the battlefield.
 *
 * Schema (`card-scripts/schema.ts`,
 * `AuraStaticSchema.become_copy`):
 *   `until: z.union([z.literal("end_of_turn"),
 *   z.literal("permanent")])` — parallel to the lane 70
 *   `StaticSchema.become_copy.until` extension shipped in
 *   follow-up 22 lane 70 piece 1/N.
 *
 * Engine (`keyword-actions/aura-bonus.ts,
 * `refreshAuraBonuses`):
 *   The permanent-arm Aura path writes the overlay onto
 *   the ENCHANTED card via the lane 70 substrate
 *   (snapshot + overlay + Aura-side stamp). Cycle guard
 *   (lane 75e) and lane 78 cross-zones check are
 *   inherited unchanged. The Aura's
 *   `copyOfTargetIdPermanent` ledger is stamped via the
 *   reusable `setPermanentCopyOf` helper from
 *   `keyword-actions/copy-chain.ts`.
 *
 * Test harness pattern: synthetic card script registered
 * via `CardScriptSchema.parse + registerCardScripts` (the
 * lane 70 piece 2b pattern). The chosen permanent's
 * `CardInstanceId` is substituted into the Aura static
 * at registration time (the engine validates the target
 * at refresh time via `state.cards.has` + the lane 78
 * tracked-zone check).
 */
import { describe, it, expect, afterAll, beforeAll } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { refreshAuraBonuses } from "../keyword-actions/aura-bonus";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import {
  clearPermanentCopyOf,
  printedCardDataOf,
} from "../keyword-actions/copy-chain";
import { restorePermanentCopyOffBattlefield } from "../pt-until-end-of-turn";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test Aura-Shaped Permanent Copy (lane 70 piece 2/N)";

/**
 * Synthetic Aura with `become_copy: { target, until:
 * "permanent" }`. The Aura is the static source; the
 * overlay is applied to the ENCHANTED card and persisted
 * for as long as the Aura is attached (no EOT cleanup).
 */
const SCRIPT_AURA_COPY_PERMANENT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle:
    "Enchanted creature is a copy of [chosen permanent].",
  aura: {
    text: "Enchanted creature is a copy of [chosen permanent].",
    static: {
      text: "Enchanted creature is a copy of [chosen permanent].",
      become_copy: {
        target: "PLACEHOLDER_REPLACED_AT_REGISTER_TIME",
        until: "permanent",
      },
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
    mana_cost: overrides.mana_cost ?? "{3}{U}",
    cmc: overrides.cmc ?? 4,
    colors: overrides.colors ?? ["U"],
    color_identity: overrides.color_identity ?? ["U"],
    keywords: overrides.keywords ?? [],
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

function makeEnchantedCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? "Test Enchanted Shapeshifter",
    type_line: overrides.type_line ?? "Creature — Shapeshifter",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{1}{U}",
    cmc: overrides.cmc ?? 2,
    colors: overrides.colors ?? ["U"],
    color_identity: overrides.color_identity ?? ["U"],
    keywords: overrides.keywords ?? [],
    power: overrides.power ?? "1",
    toughness: overrides.toughness ?? "1",
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

const GRIZZLY_BEARS: ScryfallCard = {
  id: "mock-grizzly-bears-70-perm",
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
  return {
    state,
    aliceId: playerIds[0],
  };
}

/**
 * Add the chosen permanent + enchanted card + Aura to
 * the battlefield, then attach the Aura to the enchanted
 * card. Returns the new state with all three cards in
 * place.
 */
function putAuraOnEnchanted(
  state: GameState,
  controllerId: PlayerId,
  auraDef: ScryfallCard,
  enchantedDef: ScryfallCard,
  chosenDef: ScryfallCard,
): {
  state: GameState;
  auraId: CardInstanceId;
  enchantedId: CardInstanceId;
  chosenId: CardInstanceId;
} {
  const chosenId = `card-${chosenDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const chosen = createCardInstance(chosenDef, controllerId, controllerId, {
    id: chosenId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  chosen.hasSummoningSickness = false;
  const enchantedId = `card-${enchantedDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const enchanted = createCardInstance(
    enchantedDef,
    controllerId,
    controllerId,
    {
      id: enchantedId,
      currentZoneKey: `${controllerId}-battlefield`,
    },
  );
  enchanted.hasSummoningSickness = false;
  const auraId = `card-${auraDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const aura = createCardInstance(auraDef, controllerId, controllerId, {
    id: auraId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  aura.hasSummoningSickness = false;
  (aura as CardInstance & { attachedToId?: CardInstanceId }).attachedToId =
    enchantedId;
  const newCards = new Map(state.cards);
  newCards.set(chosenId, chosen);
  newCards.set(enchantedId, enchanted);
  newCards.set(auraId, aura);
  const newZones = new Map(state.zones);
  const bfKey = `${controllerId}-battlefield`;
  const bf = newZones.get(bfKey);
  if (!bf) throw new Error("battlefield zone not found");
  newZones.set(bfKey, {
    ...bf,
    cardIds: [...bf.cardIds, chosenId, enchantedId, auraId],
  });
  return {
    state: {
      ...state,
      cards: newCards,
      zones: newZones,
      lastModifiedAt: Date.now(),
    },
    auraId,
    enchantedId,
    chosenId,
  };
}

/**
 * Re-registers the host script with the chosen
 * permanent's `CardInstanceId` substituted into the
 * static's `become_copy.target` field. The engine
 * validates the target at refresh time.
 */
function registerAuraCopyPermanentScript(chosenId: CardInstanceId): void {
  const script: CardScript = CardScriptSchema.parse({
    name: HOST_NAME,
    oracle: "Enchanted creature is a copy of [chosen permanent].",
    aura: {
      text: "Enchanted creature is a copy of [chosen permanent].",
      static: {
        text: "Enchanted creature is a copy of [chosen permanent].",
        become_copy: {
          target: chosenId as string,
          until: "permanent",
        },
      },
    },
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

describe("Wave 4.8 follow-up 24 lane 70 piece 2/N — Aura-shaped permanent copy variant", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  it("accepts the v1 aura become_copy schema with until: 'permanent' as a stand-alone arm", () => {
    // Sanity check: the `until` union on
    // `AuraStaticSchema.become_copy` accepts
    // `"permanent"` (parallel to the lane 70
    // `StaticSchema.become_copy` extension shipped in
    // follow-up 22 lane 70 piece 1/N). The script
    // parses as a stand-alone arm (no P/T, no
    // keywords, no protectionFrom — just the copy
    // static).
    const parsed = CardScriptSchema.parse({
      name: HOST_NAME,
      oracle: "Enchanted creature is a copy of [chosen permanent].",
      aura: {
        text: "Enchanted creature is a copy of [chosen permanent].",
        static: {
          text: "Enchanted creature is a copy of [chosen permanent].",
          become_copy: {
            target: "placeholder-id",
            until: "permanent",
          },
        },
      },
    });
    expect(parsed.aura?.static?.become_copy).toEqual({
      target: "placeholder-id",
      until: "permanent",
    });
  });

  it("overlays the chosen target's characteristics onto the enchanted card after refresh", () => {
    // Setup: Alice has a 2/2 Grizzly Bears on the
    // battlefield (the chosen target). Alice's 1/1
    // Shapeshifter (the enchanted card) is enchanted
    // by the Aura. The Aura's static is
    // `become_copy: { target: <chosen id>, until:
    // "permanent" }`. After `refreshAuraBonuses`,
    // the enchanted card's printed `cardData` is
    // preserved under `permanentCopyPrintedCardData`
    // (the lane 70 substrate's snapshot), and the
    // live `cardData` carries the chosen target's
    // name, type_line, P/T, colors, and keywords.
    const { state, aliceId } = setupTwoPlayerGame();
    const {
      state: withChosen,
      auraId,
      enchantedId,
      chosenId,
    } = putAuraOnEnchanted(
      state,
      aliceId,
      makeAuraCard({ id: "aura-host-70-perm" }),
      makeEnchantedCard({ id: "enchanted-shapeshifter-70-perm" }),
      GRIZZLY_BEARS,
    );
    registerAuraCopyPermanentScript(chosenId);
    const refreshed = refreshAuraBonuses(withChosen);
    const enchanted = refreshed.cards.get(enchantedId);
    expect(enchanted).toBeDefined();
    // The enchanted card's live cardData mirrors the
    // chosen target's printed characteristics.
    expect(enchanted?.cardData.name).toBe("Grizzly Bears");
    expect(enchanted?.cardData.type_line).toBe("Creature — Bear");
    expect(enchanted?.cardData.power).toBe("2");
    expect(enchanted?.cardData.toughness).toBe("2");
    expect(enchanted?.cardData.colors).toEqual(["G"]);
    expect(enchanted?.cardData.color_identity).toEqual(["G"]);
    // The permanent-arm substrate ledgers are stamped
    // (the rollback reference for the cleanup paths
    // + the source-stable ledger for the diff).
    expect(enchanted?.copyOfTargetIdPermanent).toBe(
      chosenId as string,
    );
    expect(enchanted?.permanentCopyPrintedCardData?.name).toBe(
      "Test Enchanted Shapeshifter",
    );
    // The EOT arm's substrate is unset (the substrate
    // pair is mutually exclusive — a `permanent`
    // overlay does not write the `animatedUntilEndOfTurn`
    // ledger).
    expect(enchanted?.animatedUntilEndOfTurn).toBeUndefined();
    expect(enchanted?.copyOfTargetId).toBeUndefined();
    // The chosen target itself is unchanged.
    const chosen = refreshed.cards.get(chosenId);
    expect(chosen?.cardData.name).toBe("Grizzly Bears");
    // The Aura itself carries `copyOfTargetIdPermanent`
    // (the source-side ledger stamped by
    // `setPermanentCopyOf`).
    const aura = refreshed.cards.get(auraId);
    expect(aura?.cardData.name).toBe(HOST_NAME);
    expect(aura?.copyOfTargetIdPermanent).toBe(chosenId as string);
    expect(aura?.animatedUntilEndOfTurn).toBeUndefined();
  });

  it("restores the enchanted card's cardData when the Aura leaves the battlefield", () => {
    // Aura-detach rollback: when the Aura leaves the
    // battlefield (move it out of the BF zone) and
    // `refreshAuraBonuses` runs again, the overlay is
    // dropped — the enchanted card's printed
    // `cardData` is restored from
    // `permanentCopyPrintedCardData`, and the Aura's
    // own `copyOfTargetIdPermanent` is cleared via
    // `clearPermanentCopyOf`.
    const { state, aliceId } = setupTwoPlayerGame();
    const {
      state: withChosen,
      auraId,
      enchantedId,
      chosenId,
    } = putAuraOnEnchanted(
      state,
      aliceId,
      makeAuraCard({ id: "aura-detach-70-perm" }),
      makeEnchantedCard({ id: "enchanted-detach-70-perm" }),
      GRIZZLY_BEARS,
    );
    registerAuraCopyPermanentScript(chosenId);
    const refreshed = refreshAuraBonuses(withChosen);
    // First refresh applied the overlay.
    expect(refreshed.cards.get(enchantedId)?.cardData.name).toBe(
      "Grizzly Bears",
    );
    expect(
      refreshed.cards.get(enchantedId)?.copyOfTargetIdPermanent,
    ).toBe(chosenId as string);
    expect(refreshed.cards.get(auraId)?.copyOfTargetIdPermanent).toBe(
      chosenId as string,
    );
    // Remove the Aura from the battlefield (zones-only
    // patch — parallel to the "drops the bonus when the
    // aura leaves" pattern in `aura-bonus.test.ts`).
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
    const enchantedAfter = refreshed2.cards.get(enchantedId)!;
    // The overlay is dropped — the enchanted card's
    // printed `cardData` is restored.
    expect(enchantedAfter.cardData.name).toBe(
      "Test Enchanted Shapeshifter",
    );
    expect(enchantedAfter.cardData.power).toBe("1");
    expect(enchantedAfter.cardData.toughness).toBe("1");
    // The substrate snapshot is cleared.
    expect(enchantedAfter.permanentCopyPrintedCardData).toBeUndefined();
    // The permanent-arm ledger is cleared.
    expect(enchantedAfter.copyOfTargetIdPermanent).toBeUndefined();
    // The Aura's `copyOfTargetIdPermanent` ledger is
    // cleared by the same refresh (the Aura's source-
    // side stamp is removed when no Aura with the
    // `become_copy: { until: "permanent" }` arm is
    // attached to the enchanted card anymore).
    const auraAfter = refreshed2.cards.get(auraId);
    expect(auraAfter?.copyOfTargetIdPermanent).toBeUndefined();
  });

  it("restorePermanentCopyOffBattlefield clears the substrate when the enchanted card leaves a tracked zone", () => {
    // Direct consult check on the lane 70 piece 2b
    // substrate's restore path: the
    // `restorePermanentCopyOffBattlefield` helper
    // consult detects when the ENCHANTED card leaves
    // the battlefield (zone key no longer ends with
    // `"-battlefield"`) and clears the substrate via
    // snapshot restore + ledger clear. The Aura's own
    // `copyOfTargetIdPermanent` stamp is cleared by
    // `refreshAuraBonuses`' Aura-detach branch (a
    // separate engine path — the helper does not
    // touch the Aura's ledger, only the enchanted
    // card's substrate).
    const { state, aliceId } = setupTwoPlayerGame();
    const {
      state: withChosen,
      enchantedId,
      chosenId,
    } = putAuraOnEnchanted(
      state,
      aliceId,
      makeAuraCard({ id: "aura-restore-70-perm" }),
      makeEnchantedCard({ id: "enchanted-restore-70-perm" }),
      GRIZZLY_BEARS,
    );
    registerAuraCopyPermanentScript(chosenId);
    const refreshed = refreshAuraBonuses(withChosen);
    expect(refreshed.cards.get(enchantedId)?.cardData.name).toBe(
      "Grizzly Bears",
    );
    // Move the enchanted card to a non-battlefield
    // zone (drop its `currentZoneKey` from the BF
    // zone key so the helper sees it as "left a
    // tracked zone").
    const cards2 = new Map(refreshed.cards);
    const enchantedCard = cards2.get(enchantedId)!;
    cards2.set(enchantedId, {
      ...enchantedCard,
      currentZoneKey: "limbo",
    });
    const movedState: GameState = {
      ...refreshed,
      cards: cards2,
      lastModifiedAt: Date.now(),
    };
    const restored = restorePermanentCopyOffBattlefield(movedState);
    const enchantedAfter = restored.cards.get(enchantedId)!;
    expect(enchantedAfter.cardData.name).toBe(
      "Test Enchanted Shapeshifter",
    );
    expect(enchantedAfter.permanentCopyPrintedCardData).toBeUndefined();
    expect(enchantedAfter.copyOfTargetIdPermanent).toBeUndefined();
  });


  it("clearPermanentCopyOf preserves the substrate snapshot but clears the ledger", () => {
    // Direct substrate helper consult: the
    // `clearPermanentCopyOf` helper from
    // `keyword-actions/copy-chain.ts` clears ONLY the
    // `copyOfTargetIdPermanent` ledger (it does NOT
    // touch `permanentCopyPrintedCardData`). The
    // refresh pass performs the full restore-from-
    // snapshot cleanup; the helper is for surface
    // sites that only need the ledger reset (e.g.
    // the Aura's own cycle-case clear).
    const { state, aliceId } = setupTwoPlayerGame();
    const {
      state: withChosen,
      auraId,
    } = putAuraOnEnchanted(
      state,
      aliceId,
      makeAuraCard({ id: "aura-clear-perm-substrate" }),
      makeEnchantedCard({ id: "enchanted-clear-perm-substrate" }),
      GRIZZLY_BEARS,
    );
    const aura = withChosen.cards.get(auraId)!;
    const stamped = {
      ...aura,
      copyOfTargetIdPermanent: "some-target-id",
    } as CardInstance;
    const cleared = clearPermanentCopyOf(stamped);
    expect(cleared.copyOfTargetIdPermanent).toBeUndefined();
    // `printedCardDataOf` reflects the substrate
    // ordering (snapshot first, then `cardData`).
    const ref = printedCardDataOf(stamped);
    expect(ref).toEqual(stamped.cardData);
  });
});
