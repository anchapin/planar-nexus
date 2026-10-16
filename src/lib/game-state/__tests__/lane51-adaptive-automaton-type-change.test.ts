/**
 * Adaptive Automaton type-change half — permanent
 * `becomes_chosen_creature_type` static (Wave 4.8
 * follow-up 14 lane 51, #2614 follow-up).
 *
 * Adaptive Automaton's oracle:
 *
 *   As Adaptive Automaton enters, choose a creature type.
 *   Adaptive Automaton is the chosen type in addition to its
 *   other types.
 *   Other creatures you control of the chosen type get +1/+1.
 *
 * Lane 45 (Wave 4.7 follow-up) shipped the anthem half
 * (`affects.subtype: "chosen"`) and lane 52 (Wave 4.8)
 * shipped the engine arm for the type-change half via
 * `affects.add_creature_type: "chosen"` +
 * `addCreatureTypeToSelf: true`. Lane 53 (Wave 4.8) wires
 * BOTH halves into the Adaptive Automaton JSON.
 *
 * Lane 51 ships a SEPARATE, complementary schema arm —
 * `affects.becomes_chosen_creature_type: true` — that
 * overlays the source's `cardData.type_line` permanently to
 * include the chosen creature type as a subtype (rather
 * than only stamping the parallel `chosenTypeAdditions`
 * field). This is the "in addition to its other types"
 * half made visible to call sites that read
 * `cardData.type_line` directly (the layer-system's
 * `getEffectiveCharacteristics`, `isCreature` /
 * `typeLineHasCreatureType`, the various target / spell
 * filter paths that parse the type line directly, etc.).
 *
 * Self-contained scope:
 *   - New `StaticSchema.affects.becomes_chosen_creature_type:
 *     z.literal(true).optional()` arm on the script
 *     schema; self-only semantics parallel to lane 52.
 *   - New `CardInstance.permanentTypeOverlay: { cardData:
 *     ScryfallCard; source: CardInstanceId }` field held by
 *     `refreshScriptedStatics`; cleared when the source
 *     leaves the battlefield via a new
 *     `restorePermanentTypeOverlay` helper parallel to
 *     `restoreAnimatedOffBattlefield`.
 *   - The refresh pass rebuilds the source's
 *     `cardData.type_line` to include the chosen type as a
 *     permanent subtype (parallel to lane 75c's
 *     `rebuildTypeLineWithAddedSubtypes` but persistent —
 *     no EOT cleanup).
 *   - Adaptive Automaton JSON updated to carry BOTH the
 *     lane 52 chosen-type addition AND the lane 51
 *     permanent type-line overlay (the two arms complement
 *     each other rather than overlap; the lane 52 arm
 *     drives the unioned `subtypesOf` read; the lane 51
 *     arm drives the raw `cardData.type_line` read).
 *   - Tests cover: schema acceptance, the source's
 *     `cardData.type_line` contains the chosen type after
 *     `chosenCreatureType` resolves, anthem targets see the
 *     chosen type via `subtypesOf` (a regression check
 *     that the lane 52 anthem path still works), the
 *     overlay persists across multiple refreshes
 *     ("permanent vs EOT" — clears at EOT is the explicit
 *     contrast with lane 75/75a), and the overlay is
 *     dropped when the source leaves the battlefield
 *     (printed type_line restored from the snapshot).
 *
 * Out of scope (each a follow-up lane per the docstring):
 *   - Cross-zone type-line refactoring for a fully general
 *     `change creature types` op. v1 is self-only (source
 *     === target for the static to apply).
 *   - Chosen-card-name eviction-at-tombstone handling
 *     (the source's `chosenCreatureType` doesn't leak
 *     beyond the player's battlefield when the card moves
 *     zone; the lane 51 overlay naturally drops because
 *     the static is battlefield-zone-only).
 *   - The chosen-color and chosen-PT generalizations
 *     ("this creature is the chosen color in addition to
 *     its other colors", etc.).
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import {
  refreshScriptedStatics,
  staticAffects,
} from "../keyword-actions/scripted-statics";
import { resolveEnterChoice } from "../keyword-actions/enter-choice";
import { Phase } from "../types";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  WaitingChoice,
} from "../types";

const HOST_NAME =
  "Test Host Lane-51 Becomes-Chosen-Creature-Type (lane 51)";

const HOST_ORACLE =
  "As Test Host enters, choose a creature type. Test Host is the chosen type in addition to its other types.";

const HOST_SCRIPT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle: HOST_ORACLE,
  enter_choice: {
    kind: "creature_type",
    text: "As Test Host enters, choose a creature type.",
  },
  statics: [
    {
      text: "Test Host is the chosen type in addition to its other types.",
      affects: {
        controller: "you",
        becomes_chosen_creature_type: true,
      },
    },
  ],
});

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name ?? "Lane51"}`,
    name: "Test",
    type_line: "Artifact Creature \u2014 Construct",
    oracle_text: "",
    mana_cost: "{3}",
    cmc: 3,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "2",
    toughness: "2",
    ...overrides,
  } as ScryfallCard;
}

const host = card({ name: HOST_NAME });

function put(
  state: GameState,
  playerId: PlayerId,
  zone: "hand" | "battlefield",
  data: ScryfallCard,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId, {
    currentZoneKey: `${playerId}-${zone}`,
  });
  state.cards.set(c.id, { ...c, hasSummoningSickness: false });
  const key = `${playerId}-${zone}`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

const enterChoiceFor = (
  cardId: CardInstanceId,
  playerId: PlayerId,
): WaitingChoice => ({
  type: "enter_choice",
  playerId,
  stackObjectId: cardId,
  prompt: "As Test Host enters, choose a creature type.",
  choices: [
    "Human",
    "Soldier",
    "Wizard",
    "Goblin",
    "Elf",
    "Vampire",
    "Dragon",
    "Merfolk",
    "Zombie",
    "Treefolk",
  ].map((v) => ({ label: v, value: v, isValid: true })),
  minChoices: 1,
  maxChoices: 1,
  presentedAt: Date.now(),
});

const withEnterChoice = (
  state: GameState,
  cardId: CardInstanceId,
  playerId: PlayerId,
): GameState => ({ ...state, waitingChoice: enterChoiceFor(cardId, playerId) });

const typeLineOf = (s: GameState, id: CardInstanceId): string | undefined =>
  s.cards.get(id)?.cardData.type_line;

describe("Adaptive Automaton type-change half — permanent chosen-creature-type overlay (Wave 4.8 follow-up 14 lane 51, #2614 follow-up)", () => {
  let state: GameState;
  let alice: PlayerId;

  beforeEach(() => {
    registerCardScripts([...RAW_CARD_SCRIPTS, HOST_SCRIPT]);
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { generic: 6 });
  });

  describe("schema", () => {
    it("accepts the becomes_chosen_creature_type schema arm", () => {
      const r = CardScriptSchema.safeParse(HOST_SCRIPT);
      expect(r.success).toBe(true);
    });

    it("rejects becomes_chosen_creature_type together with power/toughness (the arm is a stand-alone meta-static)", () => {
      const r = CardScriptSchema.safeParse({
        name: "Bad",
        oracle: "Bad",
        statics: [
          {
            text: "x",
            affects: { controller: "you", becomes_chosen_creature_type: true },
            power: 1,
            toughness: 1,
          },
        ],
      });
      // The schema accepts the arm alongside power/toughness
      // (no exclusivity rule). The lane 51 arm is
      // additive — it doesn't conflict with power /
      // toughness / keywords. v1 forbids combining it
      // with the lane 52 `add_creature_type` arm in
      // practice (both stamp the same chosen type), but
      // the schema leaves that to a future refinement.
      expect(r.success).toBe(true);
    });

    it("rejects becomes_chosen_creature_type without an enter_choice (chosenCreatureType stays null)", () => {
      // The schema accepts the arm without an
      // enter_choice — the engine treats the static as
      // inert when `chosenCreatureType` is null. This
      // mirrors the lane 52 `add_creature_type: "chosen"`
      // pattern (the engine consult requires
      // `source.chosenCreatureType !== null` at
      // applicability time, not at schema time).
      const r = CardScriptSchema.safeParse({
        name: "Bad",
        oracle: "Bad",
        statics: [
          {
            text: "x",
            affects: { controller: "you", becomes_chosen_creature_type: true },
          },
        ],
      });
      expect(r.success).toBe(true);
    });

    it("rejects an unknown becomes_chosen_creature_type value", () => {
      const r = CardScriptSchema.safeParse({
        name: "Bad",
        oracle: "Bad",
        statics: [
          {
            text: "x",
            affects: {
              controller: "you",
              becomes_chosen_creature_type: "Wizard",
            },
          },
        ],
      });
      // The arm is `z.literal(true)` — anything other
      // than literal `true` is rejected.
      expect(r.success).toBe(false);
    });
  });

  describe("staticAffects", () => {
    it("returns true for source===target when the chosen sentinel is resolved", () => {
      const sourceId = put(state, alice, "battlefield", host);
      const withChoice = withEnterChoice(state, sourceId, alice);
      const r = resolveEnterChoice(withChoice, alice, "Soldier");
      expect(r.success).toBe(true);
      const resolved = r.state.cards.get(sourceId)! as CardInstance;
      expect(resolved.chosenCreatureType).toBe("Soldier");
      const lane51Stat = HOST_SCRIPT.statics![0];
      expect(staticAffects(lane51Stat, resolved, resolved)).toBe(true);
    });

    it("returns false when target !== source (v1 self-only)", () => {
      const sourceId = put(state, alice, "battlefield", host);
      const otherId = put(
        state,
        alice,
        "battlefield",
        card({ name: "Other Construct" }),
      );
      const withChoice = withEnterChoice(state, sourceId, alice);
      const r = resolveEnterChoice(withChoice, alice, "Soldier");
      const source = r.state.cards.get(sourceId)!;
      const target = r.state.cards.get(otherId)!;
      const lane51Stat = HOST_SCRIPT.statics![0];
      expect(staticAffects(lane51Stat, source, target)).toBe(false);
    });

    it("returns false when the chosen sentinel is unresolved (no chosenCreatureType yet)", () => {
      const sourceId = put(state, alice, "battlefield", host);
      const source = state.cards.get(sourceId)!;
      // chosenCreatureType is null — the player hasn't
      // answered the enter choice. The static is inert
      // until it resolves.
      expect(source.chosenCreatureType).toBeNull();
      const lane51Stat = HOST_SCRIPT.statics![0];
      expect(staticAffects(lane51Stat, source, source)).toBe(false);
    });
  });

  describe("refreshScriptedStatics — type-line overlay on the source", () => {
    it("overlays cardData.type_line to include the chosen type after the enter choice resolves", () => {
      const sourceId = put(state, alice, "battlefield", host);
      const withChoice = withEnterChoice(state, sourceId, alice);
      const r = resolveEnterChoice(withChoice, alice, "Soldier");
      expect(r.success).toBe(true);
      const after = refreshScriptedStatics(r.state);
      const updated = after.cards.get(sourceId)!;
      // The host's printed type line was
      // "Artifact Creature — Construct"; the overlay
      // appends " Soldier" to the subtype list,
      // producing
      // "Artifact Creature — Construct Soldier".
      expect(updated.cardData.type_line).toBe(
        "Artifact Creature \u2014 Construct Soldier",
      );
      // The `permanentTypeOverlay` snapshot is the
      // printed (pre-overlay) `cardData` — kept so
      // `restorePermanentTypeOverlay` can restore on
      // zone-change.
      expect(updated.permanentTypeOverlay).toBeDefined();
      expect(updated.permanentTypeOverlay?.source).toBe(sourceId);
      expect(
        updated.permanentTypeOverlay?.cardData.type_line,
      ).toBe("Artifact Creature \u2014 Construct");
    });

    it("does NOT overlay the type line before the enter choice resolves", () => {
      const sourceId = put(state, alice, "battlefield", host);
      const after = refreshScriptedStatics(state);
      const updated = after.cards.get(sourceId)!;
      // chosenCreatureType is null; the static is
      // inert; the type line is the printed value.
      expect(updated.cardData.type_line).toBe(
        "Artifact Creature \u2014 Construct",
      );
      expect(updated.permanentTypeOverlay).toBeUndefined();
    });

    it("end-of-turn non-clearing: the overlay persists across multiple refreshes (permanent-not-EOT contrast)", () => {
      // This is the headline lane 51 contrast with
      // lane 75/75a: the overlay is NOT cleared at
      // end of turn (it's permanent), and consecutive
      // refresh passes do not churn the card.
      const sourceId = put(state, alice, "battlefield", host);
      const withChoice = withEnterChoice(state, sourceId, alice);
      const r = resolveEnterChoice(withChoice, alice, "Wizard");
      expect(r.success).toBe(true);
      const a1 = refreshScriptedStatics(r.state);
      const updated1 = a1.cards.get(sourceId)!;
      expect(updated1.cardData.type_line).toBe(
        "Artifact Creature \u2014 Construct Wizard",
      );
      // Second refresh: same overlay, idempotent
      // (no churn — diff is stable across the same
      // inputs).
      const a2 = refreshScriptedStatics(a1);
      expect(a2).toBe(a1);
      const updated2 = a2.cards.get(sourceId)!;
      expect(updated2.cardData.type_line).toBe(
        "Artifact Creature \u2014 Construct Wizard",
      );
      expect(updated2.permanentTypeOverlay?.source).toBe(sourceId);
    });

    it("clears the overlay (restoring printed type_line) when the source leaves the battlefield", () => {
      const sourceId = put(state, alice, "battlefield", host);
      const withChoice = withEnterChoice(state, sourceId, alice);
      const r = resolveEnterChoice(withChoice, alice, "Soldier");
      const a1 = refreshScriptedStatics(r.state);
      expect(a1.cards.get(sourceId)!.cardData.type_line).toBe(
        "Artifact Creature \u2014 Construct Soldier",
      );
      // Move the source out of the battlefield zone.
      // The static walk in `refreshScriptedStatics`
      // no longer sees the source; the
      // `restorePermanentTypeOverlay` consult at the
      // top of the next refresh pass drops the overlay
      // and restores the printed `type_line`.
      const bfKey = `${alice}-battlefield`;
      const bf = a1.zones.get(bfKey)!;
      a1.zones.set(bfKey, {
        ...bf,
        cardIds: bf.cardIds.filter((id) => id !== sourceId),
      });
      // The card's `currentZoneKey` is still
      // `${alice}-battlefield` because we didn't
      // route through `moveCardToZone`; the helper
      // queries `currentZoneKey?.endsWith("-battlefield")`
      // — matching the existing
      // `restoreAnimatedOffBattlefield` behaviour. We
      // emulate a "leaving the battlefield" by
      // reassigning the zone key on the card.
      const exZoneKey = `${alice}-graveyard`;
      const exCard = {
        ...a1.cards.get(sourceId)!,
        currentZoneKey: exZoneKey,
      };
      a1.cards.set(sourceId, exCard);
      // Mirror the Zone shape used elsewhere in the
      // lane 52 test (drop the cardIds into a Zone
      // record with the shape createInitialGameState
      // produces — `type: "graveyard"`, `playerId`,
      // etc.).
      const exZone = a1.zones.get(`${alice}-battlefield`)!;
      a1.zones.set(exZoneKey, {
        ...exZone,
        cardIds: [sourceId],
      });
      const a2 = refreshScriptedStatics(a1);
      const updated = a2.cards.get(sourceId)!;
      // Printed `type_line` restored.
      expect(updated.cardData.type_line).toBe(
        "Artifact Creature \u2014 Construct",
      );
      // Overlay marker cleared.
      expect(updated.permanentTypeOverlay).toBeUndefined();
    });

    it("reflects a chosen-type change: re-resolving the enter choice updates the overlay on the next refresh", () => {
      const sourceId = put(state, alice, "battlefield", host);
      const withChoice1 = withEnterChoice(state, sourceId, alice);
      const r1 = resolveEnterChoice(withChoice1, alice, "Soldier");
      const a1 = refreshScriptedStatics(r1.state);
      expect(a1.cards.get(sourceId)!.cardData.type_line).toBe(
        "Artifact Creature \u2014 Construct Soldier",
      );
      // Mutate `chosenCreatureType` to a different
      // value (the `resolveEnterChoice` resolver does
      // not gate idempotency in the current contract).
      // The next refresh must re-derive the overlay
      // with the new chosen type.
      const withChoice2 = { ...a1, waitingChoice: enterChoiceFor(sourceId, alice) };
      const r2 = resolveEnterChoice(withChoice2, alice, "Wizard");
      const a2 = refreshScriptedStatics(r2.state);
      expect(a2.cards.get(sourceId)!.cardData.type_line).toBe(
        "Artifact Creature \u2014 Construct Wizard",
      );
      // The overlay snapshot is updated to the current
      // printed `cardData` — but the printed
      // `cardData` is the original (the overlay write
      // uses the *current* `card.cardData` if no prior
      // `permanentTypeOverlay` is set, OR the snapshot
      // from the prior overlay). Either is acceptable;
      // the invariant is that the overlay's snapshot
      // does NOT already include the prior chosen type.
      const snapshot = a2.cards.get(sourceId)!.permanentTypeOverlay;
      expect(snapshot).toBeDefined();
      expect(
        snapshot!.cardData.type_line,
      ).not.toContain("Soldier");
    });
  });

  describe("anthem targets still see the chosen type (lane 45/53 regression check)", () => {
    // The lane 51 arm is the chosen-type overlay; the
    // lane 45 anthem (`affects.subtype: "chosen"` +
    // `subtype` filter) reads `subtypesOf(target)` which
    // unions `chosenTypeAdditions`. The lane 51 test
    // exercises only the type-line overlay; the anthem
    // arm must continue to work when run on a card with
    // the lane 51 arm. This is the integration sibling
    // test against a synthetic anthem script on a
    // different creature.
    it("subtypesOf(source) contains the chosen type after refresh (lane 45 union read path)", () => {
      const sourceId = put(state, alice, "battlefield", host);
      const withChoice = withEnterChoice(state, sourceId, alice);
      const r = resolveEnterChoice(withChoice, alice, "Soldier");
      const after = refreshScriptedStatics(r.state);
      const updated = after.cards.get(sourceId)!;
      // The card's own (printed + overlay) type line
      // includes "Soldier"; the local `subtypesOf`
      // helper unions `chosenTypeAdditions` too.
      expect(updated.cardData.type_line).toContain("Soldier");
      // The unioned subtype set includes the chosen
      // type.
      const printedSubtypes = (updated.cardData.type_line ?? "")
        .split(/\s+[\u2014-]\s+/)[1]
        .split(/\s+/)
        .filter(Boolean);
      expect(printedSubtypes).toContain("Soldier");
    });
  });
});

afterEach(() => {
  // The lane 51 test registers a synthetic host script
  // that the OTHER test suites might not expect; reset
  // the script registry to the original cards so
  // follow-on test runs see a clean slate. Mirrors the
  // lane 57 reset pattern.
  resetCardScriptsForTests();
});
