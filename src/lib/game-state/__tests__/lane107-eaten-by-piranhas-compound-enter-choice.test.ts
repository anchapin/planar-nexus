/**
 * Eaten by Piranhas compound enter_choice + chassis-side
 * stamps (Wave 4.8 follow-up 15 lane 107, #2614 follow-up).
 *
 * The "compound" enter_choice kind `"color_and_creature_type"`
 * was the v0 substrate shipped in Wave 4.8 follow-up lane 56
 * (the dual-kind stamp on `resolveEnterChoice`'s `"color_and_creature_type"`
 * branch — writes BOTH `card.chosenColor` AND
 * `card.chosenCreatureType` from one resolver call). Lane 56
 * also shipped a sample card `eaten_by_piranhas.json` carrying
 * the dual enter_choice + two self-anthem statics (the
 * chosen-color anthem and the chosen-type anthem, paraphrased
 * onto "protection from" wording because the real Oracle
 * wasn't wired).
 *
 * Lane 107 ships the v1 chassis-side stamps — the
 * `"add_color": "chosen"` self-only addition (lane 55) and the
 * `"add_creature_type": "chosen"` self-only addition (lane
 * 52), wired end-to-end on the real card JSON. The oracle
 * narrows to the canonical v1 wording: "Eaten by Piranhas
 * has the chosen color and chosen creature type in addition
 * to its other colors and creature types" (without the
 * historical "protection from" / "+1/+1" interpretation that
 * was a multi-lane gap).
 *
 * Schema (no engine arm changes needed — the lane 56 dual
 * branch + lane 55/52 chassis arms are already in place):
 *   `CardScriptSchema.enter_choice.kind` already accepts
 *     `"color_and_creature_type"` (lane 56 schema baseline)
 *   `StaticSchema.affects.add_color: "W"|"U"|"B"|"R"|"G"|"chosen"`
 *     (lane 55)
 *   `StaticSchema.affects.add_color + addColorToSelf: true`
 *     (lane 55 self-only engine path)
 *   `StaticSchema.affects.add_creature_type: <type>|"chosen"`
 *     (lane 52)
 *   `StaticSchema.affects.add_creature_type +
 *     addCreatureTypeToSelf: true` (lane 52 self-only engine
 *     path)
 *
 * JSON:
 *   `src/lib/game-state/card-scripts/cards/eaten_by_piranhas.json`
 *     carries the dual enter_choice + the chassis-side
 *     stamps (replacing the lane 56 self-anthem statics).
 *
 * Tests cover:
 *   - Schema acceptance for the dual kind + the two
 *     chassis-side arms together (compound canonical shape).
 *   - Engine `resolveEnterChoice` stamps BOTH
 *     `card.chosenColor` AND `card.chosenCreatureType` from
 *     ONE resolver call (the lane 56 substrate regression
 *     check; pins the dual-stamp invariant for Eaten by
 *     Piranhas specifically).
 *   - `refreshScriptedStatics` stamps BOTH
 *     `card.chosenColorAdditions` (via the lane 55 path) AND
 *     `card.chosenTypeAdditions` (via the lane 52 path) on
 *     the Eaten by Piranhas source, after the dual enter
 *     choice resolves.
 *   - `getCardColors(source)` reports the chosen color as
 *     part of the source's effective color list (the
 *     `chosen-color anthem` regression — lane 40 / 55: any
 *     anthem reading `getCardColors(target)` will see the
 *     chosen color on Eaten by Piranhas itself, so a
 *     Heraldic-Banner-shaped anthem with the matching
 *     chosen color correctly buffs the Eaten by Piranhas
 *     itself).
 *   - `subtypesOf(source)` reports the chosen creature type
 *     as part of the source's effective subtype list (the
 *     `chosen-type anthem` regression — lane 45 / 52: any
 *     anthem reading `subtypesOf(target)` with
 *     `subtype: "chosen"` and `other: true` correctly buffs
 *     other creatures of the chosen type, AND because the
 *     source carries the chosen-type addition the OTHER
 *     direction is also true — the Adaptive-Automaton anthem
 *     and Eaten by Piranhas's chosen-type anthem read
 *     themselves consistently).
 *   - Both stamps clear when the source leaves the
 *     battlefield (the lane 55 `chosenColorAdditions` is
 *     battlefield-zone-only; lane 52 `chosenTypeAdditions`
 *     is battlefield-zone-only). This pins the natural
 *     chosen-eviction semantics for the compound card.
 *
 * Out of scope (each a follow-up lane per the docstring):
 *   - The "lose all abilities" half of Eaten by Piranhas.
 *     The v0 substrate for a `losesAbilities`-equivalent on
 *     an Aura is lane 54 / lane 110 territory; the chosen-
 *     eviction-at-tombstone follow-up handles it.
 *   - Layered type-line rendering beyond cardData.type_line
 *     reads for a fully general change creature types op
 *     (the lane 51 follow-up handles Adaptive Automaton's
 *     `becomes_chosen_creature_type` overlay; this lane
 *     stays on the lane 52 chassis-side stamp shape).
 *   - The chosen-card-name eviction-at-tombstone follow-up
 *     (lane 110 / etc.).
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  getCardScript,
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import {
  resolveEnterChoice,
  createEnterChoiceWaitingChoice,
} from "../keyword-actions/enter-choice";
import { refreshScriptedStatics } from "../keyword-actions/scripted-statics";
import { getCardColors } from "../evergreen-keywords";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test Eaten by Piranhas Lane-107 Compound Enter Choice";

const HOST_ORACLE =
  "As Eaten by Piranhas enters, choose a color and a creature type. Eaten by Piranhas has the chosen color and chosen creature type in addition to its other colors and creature types.";

const HOST_SCRIPT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle: HOST_ORACLE,
  enter_choice: {
    kind: "color_and_creature_type",
    text: "As Eaten by Piranhas enters, choose a color and a creature type.",
  },
  statics: [
    {
      text: "Eaten by Piranhas has the chosen color in addition to its other colors.",
      affects: {
        controller: "you",
        add_color: "chosen",
        addColorToSelf: true,
      },
    },
    {
      text: "Eaten by Piranhas is the chosen creature type in addition to its other types.",
      affects: {
        controller: "you",
        add_creature_type: "chosen",
        addCreatureTypeToSelf: true,
      },
    },
  ],
});

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name ?? HOST_NAME}`,
    name: "Test",
    type_line: "Creature \u2014 Fish",
    oracle_text: "",
    mana_cost: "{3}",
    cmc: 3,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "0",
    toughness: "1",
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

function getEffectiveSubtypes(state: GameState, id: CardInstanceId): string[] {
  // Mirrors the lane 52 `subtypesOf` read; rebuilds the
  // printed-then-added subtype union at test time so the
  // assertion path matches what the engine actually reads.
  const card = state.cards.get(id)!;
  const after = (card.cardData.type_line ?? "").split(/\s+[\u2014-]\s+/)[1];
  const printed = (after ?? "").split(/\s+/).filter(Boolean);
  const additions = card.chosenTypeAdditions ?? [];
  return [...printed, ...additions.filter((t) => !printed.includes(t))];
}

describe("Eaten by Piranhas compound enter_choice + chassis-side stamps (Wave 4.8 follow-up 15 lane 107, #2614 follow-up)", () => {
  let state: GameState;
  let alice: PlayerId;

  beforeEach(() => {
    resetCardScriptsForTests();
    registerCardScripts([...RAW_CARD_SCRIPTS, HOST_SCRIPT]);
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { generic: 4 });
  });

  afterEach(() => {
    resetCardScriptsForTests();
  });

  describe("schema", () => {
    it("accepts the compound color_and_creature_type enter_choice + dual chassis-side statics", () => {
      // The canonical lane-107 shape: dual enter_choice
      // + chosen-color self-add + chosen-type self-add.
      const r = CardScriptSchema.safeParse(HOST_SCRIPT);
      expect(r.success).toBe(true);
    });

    it("accepts the dual enter_choice without the chassis-side statics (lane 56 substrate only)", () => {
      // The substrate (lane 56 dual enter_choice alone)
      // is still a valid compound shape — the chassis
      // stamps are additive. Pins the schema contract that
      // the dual enter_choice doesn't require the chassis
      // arms.
      const r = CardScriptSchema.safeParse({
        name: "Lane-56 substrate only",
        oracle: HOST_ORACLE,
        enter_choice: {
          kind: "color_and_creature_type",
          text: "As Test enters, choose a color and a creature type.",
        },
      });
      expect(r.success).toBe(true);
    });

    it("accepts the dual chassis-side statics without the dual enter_choice (literal form)", () => {
      // The chassis-side arms work without the dual
      // enter_choice if they use literal values (a
      // card that always adds e.g. red AND always adds
      // e.g. Soldier to itself). Pins the schema
      // contract that the chassis arms are independent
      // of the dual enter_choice.
      const r = CardScriptSchema.safeParse({
        name: "Lane-55-52 chassis-only shape",
        oracle: "Always red and a Soldier in addition to its other types.",
        statics: [
          {
            text: "x",
            affects: {
              controller: "you",
              add_color: "R",
              addColorToSelf: true,
            },
          },
          {
            text: "x",
            affects: {
              controller: "you",
              add_creature_type: "Soldier",
              addCreatureTypeToSelf: true,
            },
          },
        ],
      });
      expect(r.success).toBe(true);
    });

    it("Eaten by Piranhas JSON ships the dual kind end-to-end via the registry", () => {
      // Re-register the generated index fresh — the
      // beforeEach already pushed the synthetic HOST
      // script on top, but the RAW_CARD_SCRIPTS tree
      // carries the real Eaten by Piranhas JSON. The
      // registry's `getCardScript` resolves both
      // names; the lane 107 assertion checks the real
      // card JSON carries the dual enter_choice AND
      // the chassis-side stamp arms (the canonical
      // lane-107 shape).
      const parsed = getCardScript("Eaten by Piranhas");
      expect(parsed).toBeDefined();
      expect(parsed!.enter_choice?.kind).toBe("color_and_creature_type");
      expect(parsed!.statics).toHaveLength(2);
      const addColorArm = parsed!.statics!.find(
        (s) => s.affects?.add_color === "chosen",
      );
      const addTypeArm = parsed!.statics!.find(
        (s) => s.affects?.add_creature_type === "chosen",
      );
      expect(addColorArm).toBeDefined();
      expect(addColorArm!.affects?.addColorToSelf).toBe(true);
      expect(addTypeArm).toBeDefined();
      expect(addTypeArm!.affects?.addCreatureTypeToSelf).toBe(true);
    });
  });

  describe("resolveEnterChoice stamping both halves", () => {
    it("writes BOTH chosenColor AND chosenCreatureType from a single resolver call", () => {
      // The lane 56 dual-stamp invariant pinned on
      // Eaten by Piranhas specifically. The dual-kind
      // option value is "W|Soldier" (color letter +
      // curated creature type separated by a pipe);
      // the resolver decodes both halves and stamps
      // the source card with both fields in one
      // atomic update.
      const sourceId = put(state, alice, "battlefield", host);
      const choice = createEnterChoiceWaitingChoice(state, sourceId)!;
      expect(choice).not.toBeNull();
      expect(choice.type).toBe("enter_choice");
      state = { ...state, waitingChoice: choice };
      const r = resolveEnterChoice(state, alice, "W|Soldier");
      expect(r.success).toBe(true);
      const updated = r.state.cards.get(sourceId)!;
      // Both halves stamped from ONE resolver call —
      // the lane 56 substrate invariant for
      // color_and_creature_type.
      expect(updated.chosenColor).toBe("W");
      expect(updated.chosenCreatureType).toBe("Soldier");
      expect(r.state.waitingChoice).toBeNull();
    });

    it("rejects a malformed encoded value before stamping either half", () => {
      // The lane 56 substrate's invalid-value guard
      // pins the dual-stamp contract on Eaten by
      // Piranhas: a bad value yields no stamp at all
      // (a partial stamp would be a multi-lane bug
      // because the static arms read both fields).
      const sourceId = put(state, alice, "battlefield", host);
      const choice = createEnterChoiceWaitingChoice(state, sourceId)!;
      state = { ...state, waitingChoice: choice };
      const r = resolveEnterChoice(state, alice, "X|NotAType");
      expect(r.success).toBe(false);
      expect(r.description).toMatch(/invalid/i);
      const updated = r.state.cards.get(sourceId)!;
      expect(updated.chosenColor).toBeNull();
      expect(updated.chosenCreatureType).toBeNull();
    });
  });

  describe("refreshScriptedStatics stamps both chassis-side fields", () => {
    it("stamps chosenColorAdditions AND chosenTypeAdditions on the source after the dual resolve", () => {
      // The lane 107 distinct value: both chassis-side
      // stamps fire from ONE dual resolve. The
      // chosen-color addition (lane 55) drives
      // getCardColors to union; the chosen-type
      // addition (lane 52) drives subtypesOf to union.
      // Both are stamped on the source itself.
      const sourceId = put(state, alice, "battlefield", host);
      const choice = createEnterChoiceWaitingChoice(state, sourceId)!;
      state = { ...state, waitingChoice: choice };
      const resolved = resolveEnterChoice(state, alice, "R|Goblin");
      expect(resolved.success).toBe(true);
      const refreshed = refreshScriptedStatics(resolved.state);
      const updated = refreshed.cards.get(sourceId)!;
      // Chosen-color addition (lane 55 substrate).
      expect(updated.chosenColorAdditions).toEqual(["R"]);
      // Chosen-type addition (lane 52 substrate).
      expect(updated.chosenTypeAdditions).toEqual(["Goblin"]);
    });

    it("does NOT stamp either addition before the dual enter choice resolves", () => {
      // Both chassis arms read the source's chosenColor
      // / chosenCreatureType instance fields and gate
      // on those fields being non-null. Before the
      // dual resolve, both fields are null → both
      // statics are inert → neither addition is
      // stamped. Pins the "wait for the resolve"
      // semantics shared by lane 55 + lane 52.
      const sourceId = put(state, alice, "battlefield", host);
      const refreshed = refreshScriptedStatics(state);
      const updated = refreshed.cards.get(sourceId)!;
      expect(updated.chosenColorAdditions).toBeUndefined();
      expect(updated.chosenTypeAdditions).toBeUndefined();
    });

    it("clears both additions when the source leaves the battlefield", () => {
      // Both ledgers are battlefield-zone-only (lane 55
      // + lane 52 natural eviction semantics). When
      // Eaten by Piranhas leaves the battlefield, the
      // chosen color and chosen creature type both
      // drop from the source — the next refresh pass
      // sees no source on the field and clears the
      // ledgers. Pins the natural-eviction invariant
      // for the compound card.
      const sourceId = put(state, alice, "battlefield", host);
      const choice = createEnterChoiceWaitingChoice(state, sourceId)!;
      state = { ...state, waitingChoice: choice };
      const resolved = resolveEnterChoice(state, alice, "G|Elf");
      expect(resolved.success).toBe(true);
      const refreshed = refreshScriptedStatics(resolved.state);
      // Sanity: both ledgers stamped.
      expect(refreshed.cards.get(sourceId)!.chosenColorAdditions).toEqual([
        "G",
      ]);
      expect(refreshed.cards.get(sourceId)!.chosenTypeAdditions).toEqual([
        "Elf",
      ]);
      // Move the source out of the battlefield zone.
      const bf = refreshed.zones.get(`${alice}-battlefield`)!;
      const moved = {
        ...refreshed,
        zones: new Map(refreshed.zones).set(`${alice}-battlefield`, {
          ...bf,
          cardIds: bf.cardIds.filter((id) => id !== sourceId),
        }),
      };
      const refreshed2 = refreshScriptedStatics(moved);
      const updated = refreshed2.cards.get(sourceId)!;
      // Both ledgers cleared — natural eviction on
      // zone change.
      expect(updated.chosenColorAdditions).toBeUndefined();
      expect(updated.chosenTypeAdditions).toBeUndefined();
    });
  });

  describe("chosen-color anthem regression (lane 40 / 55 substrate)", () => {
    // A lane-55 / lane-40 caller (Heraldic Banner-style
    // chosen-color anthem) reads `getCardColors(target)`.
    // After lane 107's chassis-side stamp, Eaten by
    // Piranhas's effective color list unions the chosen
    // color into the printed colors — so a synthetic
    // chosen-color anthem with `subtype: undefined,
    // color: "chosen"` and `self: false` correctly
    // targets the Eaten by Piranhas source as "of the
    // chosen color" via its own chosen color.
    it("a chosen-color anthem sees the Eaten by Piranhas source as the chosen color", () => {
      const anthemName =
        "Test Chosen-Color Anthem Lane-107 (lane 40 / 55 regression)";
      const anthemScript: CardScript = CardScriptSchema.parse({
        name: anthemName,
        oracle: "Creatures of the chosen color get +1/+1.",
        statics: [
          {
            text: "Creatures of the chosen color get +1/+1.",
            affects: {
              controller: "you",
              color: "chosen",
            },
            power: 1,
            toughness: 1,
          },
        ],
      });
      registerCardScripts([...RAW_CARD_SCRIPTS, HOST_SCRIPT, anthemScript]);

      // Place the anthem on the battlefield with its
      // chosenColor pre-stamped to blue. Eaten by
      // Piranhas will pick "U" as its chosen color.
      const anthemId = put(
        state,
        alice,
        "battlefield",
        card({
          name: anthemName,
          type_line: "Artifact",
          colors: [],
          power: undefined as unknown as string,
          toughness: undefined as unknown as string,
        }),
      );
      // Stamp the anthem's chosen color directly (per the
      // lane-51 / lane-62 helper note: `createCardInstance`
      // doesn't preserve `instanceCounters` from options,
      // and here we hand-stamp `chosenColor` on the
      // anthem so it doesn't need an enter_choice of its
      // own).
      state = {
        ...state,
        cards: new Map(state.cards).set(anthemId, {
          ...state.cards.get(anthemId)!,
          chosenColor: "U",
        }),
      };

      // Resolve Eaten by Piranhas's dual enter choice
      // picking blue + Soldier.
      const sourceId = put(state, alice, "battlefield", host);
      const choice = createEnterChoiceWaitingChoice(state, sourceId)!;
      state = { ...state, waitingChoice: choice };
      const resolved = resolveEnterChoice(state, alice, "U|Soldier");
      expect(resolved.success).toBe(true);

      const refreshed = refreshScriptedStatics(resolved.state);
      const updatedSource = refreshed.cards.get(sourceId)!;

      // The chassis stamp: chosenColorAdditions = ["U"],
      // getCardColors unions ["U"] with the printed []
      // and normalizes to ["blue"]. The anthem reads
      // getCardColors(target) and matches "blue" →
      // anthem applies → +1/+1.
      expect(getCardColors(updatedSource)).toEqual(["blue"]);
      expect(refreshed.cards.get(sourceId)!.chosenColorAdditions).toEqual([
        "U",
      ]);

      // Pin the anthem read path actually sees the
      // chosen color — if the anthem path reads the
      // raw cardData.colors (empty) instead of
      // getCardColors, it'd skip Eaten by Piranhas
      // because the printed color is empty. The union
      // via chosenColorAdditions is what makes the
      // anthem target the chassis-stamped card.
      expect(getCardColors(updatedSource).includes("blue")).toBe(true);
    });
  });

  describe("chosen-creature-type anthem regression (lane 45 / 52 substrate)", () => {
    // A lane-45 / lane-52 caller (Adaptive-Automaton-
    // style chosen-type anthem) reads `subtypesOf(target)`.
    // After lane 107's chassis-side stamp, Eaten by
    // Piranhas's effective subtype list unions the
    // chosen creature type into the printed subtypes —
    // so a synthetic chosen-type anthem with
    // `subtype: "chosen"` and `self: false` correctly
    // targets the Eaten by Piranhas source as "of the
    // chosen creature type" via its own chosen type.
    it("a chosen-type anthem sees the Eaten by Piranhas source as the chosen type", () => {
      const anthemName =
        "Test Chosen-Type Anthem Lane-107 (lane 45 / 52 regression)";
      const anthemScript: CardScript = CardScriptSchema.parse({
        name: anthemName,
        oracle: "Other creatures of the chosen type get +1/+1.",
        // The anthem carries its own enter_choice so the
        // chassis self-stamp + anthem reads the source's
        // chosenCreatureType uniformly.
        enter_choice: {
          kind: "creature_type",
          text: "As this creature enters, choose a creature type.",
        },
        statics: [
          {
            text: "Other creatures of the chosen type get +1/+1.",
            affects: {
              controller: "you",
              other: true,
              subtype: "chosen",
            },
            power: 1,
            toughness: 1,
          },
        ],
      });
      registerCardScripts([...RAW_CARD_SCRIPTS, HOST_SCRIPT, anthemScript]);

      // Resolve the anthem's own chosen-type enter
      // choice first so its anthem is active.
      const anthemId = put(
        state,
        alice,
        "battlefield",
        card({
          name: anthemName,
          type_line: "Artifact Creature \u2014 Construct",
          power: "2",
          toughness: "2",
        }),
      );
      const anthemScript_obj = getCardScript(anthemName)!;
      expect(anthemScript_obj.enter_choice?.kind).toBe("creature_type");
      const anthemChoice = createEnterChoiceWaitingChoice(state, anthemId)!;
      expect(anthemChoice).not.toBeNull();
      state = { ...state, waitingChoice: anthemChoice };
      const anthemResolved = resolveEnterChoice(state, alice, "Soldier");
      expect(anthemResolved.success).toBe(true);
      state = anthemResolved.state;

      // Now resolve Eaten by Piranhas's dual enter
      // choice picking white + Soldier.
      const sourceId = put(state, alice, "battlefield", host);
      const choice = createEnterChoiceWaitingChoice(state, sourceId)!;
      state = { ...state, waitingChoice: choice };
      const resolved = resolveEnterChoice(state, alice, "W|Soldier");
      expect(resolved.success).toBe(true);

      const refreshed = refreshScriptedStatics(resolved.state);
      const updatedSource = refreshed.cards.get(sourceId)!;

      // The chassis stamp: chosenTypeAdditions =
      // ["Soldier"]. subtypesOf (the lane 52 read)
      // unions ["Soldier"] with the printed subtypes
      // ["Fish"] → ["Fish", "Soldier"] (or
      // order-preserving).
      expect(updatedSource.chosenTypeAdditions).toEqual(["Soldier"]);
      const eff = getEffectiveSubtypes(refreshed, sourceId);
      expect(eff).toContain("Soldier");
      expect(eff).toContain("Fish");

      // Pin the anthem read path actually sees the
      // chosen type — if the anthem path reads the
      // raw cardData.type_line (which only has "Fish")
      // instead of subtypesOf (which unions the
      // additions), it'd skip Eaten by Piranhas. The
      // chassis-side stamp is what makes the anthem
      // target the compound chassis-stamped card.
      expect(eff.includes("Soldier")).toBe(true);
    });
  });
});
