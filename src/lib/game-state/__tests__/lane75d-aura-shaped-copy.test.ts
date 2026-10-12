/**
 * Wave 4.8 follow-up 8 lane 75d — Aura-shaped until-EOT
 * copy (`AuraStaticSchema.become_copy`, #2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of cards
 * with the "Enchanted creature is a copy of [chosen
 * permanent] until end of turn" pattern: the
 * manifested-as-Aura family, "becomes a copy"
 * enchantments, etc. The v1 minimum adds a
 * `become_copy: { target: CardInstanceId, until:
 * "end_of_turn" }` arm on `AuraStaticSchema` (parallel
 * to lane 76's `protectionFrom` / lane 71's static
 * `protectionFrom`) that the engine applies to the
 * ENCHANTED CARD via `refreshAuraBonuses` using the
 * existing lane 75 `animatedUntilEndOfTurn`
 * infrastructure.
 *
 * Schema (card-scripts/schema.ts, AuraStaticSchema):
 *   `become_copy: { target: CardInstanceId, until:
 *    "end_of_turn" }` — optional arm on the aura
 *    static slot. v1 single chosen target on the
 *    battlefield; the chosen target itself is
 *    unchanged. The Aura carries the static (not
 *    the enchanted card); the overlay is applied
 *    to the ENCHANTED CARD's `cardData` via the
 *    lane 75 / 75b / 75c `animatedUntilEndOfTurn`
 *    + `copyOfTargetId` infrastructure. The
 *    refine list at the bottom of
 *    `AuraStaticSchema` accepts `become_copy` as a
 *    stand-alone arm (parallel to lane 76's
 *    `protectionFrom` refine extension).
 *
 * Engine (card-scripts/keyword-actions/aura-bonus.ts):
 *   `refreshAuraBonuses` collects
 *   `become_copy.target` from each attached Aura's
 *   static into a per-enchanted-card map
 *   (`auraCopyOfTargetByEnchantedCard`); the
 *   write phase at the bottom of the pass overlays
 *   the chosen target's printed characteristics
 *   onto the enchanted card's `cardData` and
 *   snapshots the enchanted card's printed
 *   `cardData` under `animatedUntilEndOfTurn` so
 *   the existing `clearUntilEndOfTurnPT` /
 *   `restoreAnimatedOffBattlefield` rollback path
 *   restores the printed characteristics at end of
 *   turn / when the Aura / chosen target leaves the
 *   battlefield. The overlay self-corrects when the
 *   chosen target leaves the battlefield (the
 *   enchanted card restores its printed
 *   `cardData` from `animatedUntilEndOfTurn`).
 *
 * Test harness pattern: synthetic card script
 * registered via `CardScriptSchema.parse +
 * registerCardScripts` (the lane 49/52/55/59/60/62/63/64/65/66/67/68/69/70/71/72/73/74/75/75a/75b/75c/76
 * pattern). The test exercises the refresh path
 * via the engine's `refreshAuraBonuses` (the same
 * call sites the engine uses for a real cast) and
 * inspects the enchanted card's overlaid
 * `cardData` + `animatedUntilEndOfTurn` (printed
 * backup) + `copyOfTargetId` ledger.
 */
import { describe, it, expect, afterAll } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { refreshAuraBonuses } from "../keyword-actions/aura-bonus";
import { clearUntilEndOfTurnPT } from "../pt-until-end-of-turn";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test Aura-Shaped Until-EOT Copy (lane 75d)";

/**
 * The synthetic Aura's static carries `become_copy:
 * { target, until: "end_of_turn" }`. The Aura is the
 * static source; the overlay is applied to the
 * ENCHANTED CARD.
 */
const SCRIPT_AURA_COPY_EOT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle:
    "Enchanted creature is a copy of [chosen permanent] until end of turn.",
  aura: {
    text:
      "Enchanted creature is a copy of [chosen permanent] until end of turn.",
    static: {
      text:
        "Enchanted creature is a copy of [chosen permanent] until end of turn.",
      become_copy: {
        target: "PLACEHOLDER_REPLACED_AT_REGISTER_TIME",
        until: "end_of_turn",
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
    mana_cost: overrides.mana_cost ?? "{2}{U}",
    cmc: overrides.cmc ?? 3,
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
    name: overrides.name ?? "Test Enchanted Creature",
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
  id: "mock-grizzly-bears-75d",
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
 * Add the chosen permanent + enchanted card + aura to
 * the battlefield, then attach the aura to the
 * enchanted card. Returns the new state with all
 * three cards in place.
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
  // Add the chosen permanent first.
  const chosenId = `card-${chosenDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const chosen = createCardInstance(chosenDef, controllerId, controllerId, {
    id: chosenId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  chosen.hasSummoningSickness = false;
  // Add the enchanted card second.
  const enchantedId = `card-${enchantedDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const enchanted = createCardInstance(enchantedDef, controllerId, controllerId, {
    id: enchantedId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  enchanted.hasSummoningSickness = false;
  // Add the aura last, attached to the enchanted card.
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
 * Re-registers the host script's aura static with the
 * chosen permanent's `CardInstanceId` substituted
 * into the static's `become_copy.target` field. The
 * engine validates the target at refresh time.
 */
function registerAuraCopyEotScript(chosenId: CardInstanceId): void {
  const script: CardScript = CardScriptSchema.parse({
    name: HOST_NAME,
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

describe("Wave 4.8 follow-up 8 lane 75d — Aura-shaped until-EOT copy", () => {
  afterAll(() => {
    resetCardScriptsForTests();
  });

  it("rejects a script with an empty become_copy.target id", () => {
    // Schema guard: `target` must be at least 1 character.
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad aura become_copy target (lane 75d)",
        oracle: "test",
        aura: {
          text: "test",
          static: {
            text: "test",
            become_copy: { target: "", until: "end_of_turn" },
          },
        },
      }),
    ).toThrow();
  });

  it("rejects a script with a non-end_of_turn duration", () => {
    // Schema guard: `until` must be the v1 literal
    // `"end_of_turn"`.
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad aura become_copy until (lane 75d)",
        oracle: "test",
        aura: {
          text: "test",
          static: {
            text: "test",
            become_copy: { target: "x", until: "indefinite" },
          },
        },
      }),
    ).toThrow();
  });

  it("accepts the v1 aura become_copy schema (target + end_of_turn) as a stand-alone arm", () => {
    // Sanity check: the script parses and the aura
    // static carries the `become_copy` arm. The
    // refine list accepts it without P/T or
    // keywords — the Wave 4.8 follow-up 6 lane 76
    // pattern (`protectionFrom` stand-alone arm).
    const parsed = CardScriptSchema.parse({
      name: HOST_NAME,
      oracle: "test",
      aura: {
        text: "test",
        static: {
          text: "test",
          become_copy: {
            target: "placeholder-id",
            until: "end_of_turn",
          },
        },
      },
    });
    expect(parsed.aura?.static?.become_copy).toEqual({
      target: "placeholder-id",
      until: "end_of_turn",
    });
  });

  it("overlays the chosen target's characteristics onto the enchanted card after refresh", () => {
    // Setup: Alice has a 2/2 Grizzly Bears on the
    // battlefield (the chosen target). Alice's
    // 1/1 Shapeshifter (the enchanted card) is
    // enchanted by the Aura. The Aura's static is
    // `become_copy: { target: <chosen id>, until:
    // "end_of_turn" }`. After `refreshAuraBonuses`,
    // the enchanted card's printed `cardData` is
    // preserved under `animatedUntilEndOfTurn`,
    // and the live `cardData` carries the chosen
    // target's name, type_line, P/T, colors, and
    // keywords.
    const { state, aliceId } = setupTwoPlayerGame();
    const {
      state: withChosen,
      auraId,
      enchantedId,
      chosenId,
    } = putAuraOnEnchanted(
      state,
      aliceId,
      makeAuraCard({ id: "aura-host-75d" }),
      makeEnchantedCard({ id: "enchanted-shapeshifter-75d" }),
      GRIZZLY_BEARS,
    );
    registerAuraCopyEotScript(chosenId);
    const refreshed = refreshAuraBonuses(withChosen);
    const enchanted = refreshed.cards.get(enchantedId);
    expect(enchanted).toBeDefined();
    // The enchanted card's live cardData now
    // mirrors the chosen target's printed
    // characteristics.
    expect(enchanted?.cardData.name).toBe("Grizzly Bears");
    expect(enchanted?.cardData.type_line).toBe("Creature — Bear");
    expect(enchanted?.cardData.power).toBe("2");
    expect(enchanted?.cardData.toughness).toBe("2");
    expect(enchanted?.cardData.colors).toEqual(["G"]);
    expect(enchanted?.cardData.color_identity).toEqual(["G"]);
    // The lane 75 ledger is set so the EOT
    // rollback restores the enchanted card's
    // printed `cardData`.
    expect(enchanted?.copyOfTargetId).toBe(chosenId as string);
    expect(enchanted?.animatedUntilEndOfTurn?.cardData.name).toBe(
      "Test Enchanted Creature",
    );
    // The chosen target itself is unchanged.
    const chosen = refreshed.cards.get(chosenId);
    expect(chosen?.cardData.name).toBe("Grizzly Bears");
    // The Aura itself is unchanged (the overlay
    // is on the ENCHANTED card, not the Aura).
    const aura = refreshed.cards.get(auraId);
    expect(aura?.cardData.name).toBe(HOST_NAME);
    expect(aura?.animatedUntilEndOfTurn).toBeUndefined();
    expect(aura?.copyOfTargetId).toBeUndefined();
  });

  it("does NOT overlay when the chosen target is missing", () => {
    // Setup: chosenId points to a card that isn't
    // on any zone (the engine sees
    // `state.cards.has(chosenId)` is false when
    // looking up by `state.cards.get(chosenId)`
    // — but `state.cards.has` returns true in
    // this case because we wrote the card to the
    // map. The fix: don't put the chosen target on
    // the battlefield at all, and don't have a
    // matching card in `state.cards` — use a
    // fresh id).
    const { state, aliceId } = setupTwoPlayerGame();
    const ghostId =
      `card-ghost-${Math.random().toString(36).slice(2)}` as CardInstanceId;
    // Add ONLY the enchanted card + aura (no
    // chosen target — the ghostId isn't on the
    // battlefield, but we'll add a "ghost" card
    // somewhere else to avoid the
    // `state.cards.has` confusion. Actually use a
    // simpler test: put the chosen target in a
    // hand zone, NOT on the battlefield).
    const placeholderChosenId =
      `card-placeholder-chosen-${Math.random().toString(36).slice(2)}` as CardInstanceId;
    const placeholderChosen = createCardInstance(
      GRIZZLY_BEARS,
      aliceId,
      aliceId,
      {
        id: placeholderChosenId,
        // Place the placeholder chosen target in an
        // untracked zone (a zone key that's NOT in
        // `state.zones`). Lane 78's "in a tracked zone"
        // check uses `state.zones.has(target.currentZoneKey)`,
        // so a non-existent zone key drops the overlay.
        // (v1 used `currentZoneKey.endsWith("-battlefield")`,
        // which dropped the overlay for ANY non-battlefield
        // zone — including tracked zones like hand,
        // graveyard, exile. Lane 78 only drops the overlay
        // for UNTRACKED zones.)
        currentZoneKey: `${aliceId}-limbo`,
      },
    );
    const enchantedId = `card-enchanted-${Math.random().toString(36).slice(2)}` as CardInstanceId;
    const enchanted = createCardInstance(
      makeEnchantedCard({ id: "enchanted-shapeshifter-missing-75d" }),
      aliceId,
      aliceId,
      {
        id: enchantedId,
        currentZoneKey: `${aliceId}-battlefield`,
      },
    );
    enchanted.hasSummoningSickness = false;
    const auraId = `card-aura-${Math.random().toString(36).slice(2)}` as CardInstanceId;
    const aura = createCardInstance(
      makeAuraCard({ id: "aura-missing-75d" }),
      aliceId,
      aliceId,
      {
        id: auraId,
        currentZoneKey: `${aliceId}-battlefield`,
      },
    );
    aura.hasSummoningSickness = false;
    (aura as CardInstance & { attachedToId?: CardInstanceId }).attachedToId =
      enchantedId;
    const newCards = new Map(state.cards);
    newCards.set(placeholderChosenId, placeholderChosen);
    newCards.set(enchantedId, enchanted);
    newCards.set(auraId, aura);
    const newZones = new Map(state.zones);
    const bfKey = `${aliceId}-battlefield`;
    const bf = newZones.get(bfKey);
    if (!bf) throw new Error("battlefield zone not found");
    newZones.set(bfKey, {
      ...bf,
      cardIds: [...bf.cardIds, enchantedId, auraId],
    });
    const withChosenInHand = {
      ...state,
      cards: newCards,
      zones: newZones,
      lastModifiedAt: Date.now(),
    };
    registerAuraCopyEotScript(placeholderChosenId);
    const refreshed = refreshAuraBonuses(withChosenInHand);
    const enchantedAfter = refreshed.cards.get(enchantedId);
    // The chosen target was not on the
    // battlefield at refresh time — the overlay
    // does NOT apply. The enchanted card's
    // `cardData` is unchanged (still the
    // Shapeshifter's printed characteristics).
    expect(enchantedAfter?.cardData.name).toBe(
      "Test Enchanted Creature",
    );
    expect(enchantedAfter?.cardData.power).toBe("1");
    expect(enchantedAfter?.animatedUntilEndOfTurn).toBeUndefined();
    expect(enchantedAfter?.copyOfTargetId).toBeUndefined();
  });

  it("EOT cleanup rolls back the enchanted card's cardData via clearUntilEndOfTurnPT", () => {
    // After the overlay applies, calling
    // `clearUntilEndOfTurnPT` rolls the enchanted
    // card's `cardData` back to its printed
    // `cardData` (mirrors lane 75's EOT cleanup).
    const { state, aliceId } = setupTwoPlayerGame();
    const {
      state: withChosen,
      enchantedId,
      chosenId,
    } = putAuraOnEnchanted(
      state,
      aliceId,
      makeAuraCard({ id: "aura-eot-75d" }),
      makeEnchantedCard({ id: "enchanted-eot-75d" }),
      GRIZZLY_BEARS,
    );
    registerAuraCopyEotScript(chosenId);
    const refreshed = refreshAuraBonuses(withChosen);
    const before = refreshed.cards.get(enchantedId);
    expect(before?.cardData.name).toBe("Grizzly Bears");
    // EOT cleanup.
    const cleaned = clearUntilEndOfTurnPT(refreshed);
    const after = cleaned.cards.get(enchantedId);
    expect(after?.cardData.name).toBe("Test Enchanted Creature");
    expect(after?.cardData.power).toBe("1");
    expect(after?.cardData.toughness).toBe("1");
    expect(after?.animatedUntilEndOfTurn).toBeUndefined();
  });
});
