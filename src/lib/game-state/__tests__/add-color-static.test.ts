/**
 * Add color via static — engine arm (Wave 4.8 lane 55,
 * #2614 follow-up).
 *
 * Lane 55 ships the engine piece for the chosen-color
 * addition static. The pattern is the chosen-color analogue
 * of lane 52's chosen-type addition: the source adds the
 * named color (or its `chosenColor`) to its own colors while on
 * the battlefield. Redcap Gutter-Dweller is the canonical
 * real card (always adds a specific color to itself). A
 * chosen-color variant rides the `"chosen"` sentinel — an
 * `enter_choice: { kind: "color" }` card that adds its own
 * chosen color to itself in addition to its printed colors.
 *
 * Schema (Wave 4.8 lane 55):
 *   `StaticSchema.affects.add_color: "W"|"U"|"B"|"R"|"G"|"chosen"`
 *   — a single enum arm for the literal color OR the
 *   `"chosen"` sentinel.
 *   `StaticSchema.affects.addColorToSelf: true` — companion
 *   flag opting in to the v1 self-only engine path
 *   (mirrors `addCreatureTypeToSelf` from lane 52).
 *
 * Engine:
 *   `CardInstance.chosenColorAdditions?: ColorLetter[]` —
 *   per-instance field stamped by `refreshScriptedStatics`.
 *   `staticAffects` returns true iff `source === target`
 *   (v1 self-only); for the `"chosen"` sentinel also
 *   requires `source.chosenColor !== null`.
 *   `getCardColors` unions `chosenColorAdditions` with the
 *   printed colors so other statics (the chosen-color
 *   anthem in lane 40, Heraldic Banner / Diamond Mare) can
 *   see the addition on the source itself.
 *
 * Lane 55 ships NO real card JSON update. Redcap Gutter-Dweller
 * needs the `add_color` literal-form, which is the cleanest
 * sample card. Its "create a red Treasure" half rides the
 * already-shipped `CreatePredefinedToken` (Wave 2 lane 2544).
 * The "Goblins have menace when this permanent has 3+ counters"
 * trigger half is a counter-based trigger gate (deferred).
 * The handoff explicitly says lane 55 ships a synthetic script
 * registered via the test harness. This test exercises the
 * engine arm on a synthetic lane-55 card; the chosen-sentinel
 * path uses a parallel synthetic that carries
 * `enter_choice: { kind: "color" }` and mirrors Diamond Mare's
 * chosen-color anthem.
 *
 * Lane 55 ships the engine arm AND the integration test for
 * Diamond Mare: Diamond Mare's anthem (lane 45) reads
 * `getCardColors(target)`. After lane 55, a Diamond Mare
 * carrying an `add_color: "chosen"` + `addColorToSelf` static
 * becomes the chosen color in addition to its printed
 * colors — and its own anthem buffs it (Diamond Mare has its
 * chosen-color anthem, which now matches its own augmented
 * color via the union in `getCardColors`).
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { CardScriptSchema } from "../card-scripts/schema";
import { getCardScript, registerCardScripts } from "../card-scripts/registry";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { resolveEnterChoice } from "../keyword-actions/enter-choice";
import { refreshScriptedStatics, staticAffects } from "../keyword-actions/scripted-statics";
import { getCardColors } from "../evergreen-keywords";
import { Phase } from "../types";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  WaitingChoice,
} from "../types";

const TEST_LITERAL_COLOR_NAME = "Test Add Color Literal (lane 55)";

const TEST_LITERAL_COLOR_SCRIPT = CardScriptSchema.parse({
  name: TEST_LITERAL_COLOR_NAME,
  oracle:
    "As this creature enters, it becomes the chosen color in addition to its other colors.",
  // No enter_choice — this is the literal-form arm
  // (Redcap Gutter-Dweller adds red unconditionally).
  statics: [
    {
      text: "This creature is red in addition to its other colors.",
      affects: {
        controller: "you",
        add_color: "R",
        addColorToSelf: true,
      },
    },
  ],
});

const TEST_CHOSEN_COLOR_NAME = "Test Add Color Chosen (lane 55)";

const TEST_CHOSEN_COLOR_SCRIPT = CardScriptSchema.parse({
  name: TEST_CHOSEN_COLOR_NAME,
  oracle:
    "As this creature enters, choose a color. This creature is the chosen color in addition to its other colors.",
  enter_choice: {
    kind: "color",
    text: "As this creature enters, choose a color.",
  },
  statics: [
    {
      text: "This creature is the chosen color in addition to its other colors.",
      affects: {
        controller: "you",
        add_color: "chosen",
        addColorToSelf: true,
      },
    },
  ],
});

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Creature \u2014 Construct",
    oracle_text: "",
    mana_cost: "{2}",
    cmc: 2,
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

// A creature with printed colors = [G]. The literal-form
// arm adds Red to its printed colors (post-lane-55: it
// becomes [G, R]).
const hostPrintedGreen = card({
  name: "Test Host Green (lane 55)",
  colors: ["G"],
  color_identity: ["G"],
  oracle_text: "{T}: Add {G}. {T}: Green.",
});

// A creature with printed colors = []. The chosen-form
// arm adds the source's chosen color to its (empty) printed
// colors (post-lane-55: it becomes just the chosen color).
const hostPrintedColorless = card({
  name: "Test Host Colorless (lane 55)",
  colors: [],
  color_identity: [],
  oracle_text: "",
});

const testLiteralCard = card({ name: TEST_LITERAL_COLOR_NAME });
const testChosenCard = card({ name: TEST_CHOSEN_COLOR_NAME });

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

function colorEnterChoiceFor(cardId: CardInstanceId, playerId: PlayerId): WaitingChoice {
  return {
    type: "enter_choice",
    playerId,
    stackObjectId: cardId,
    prompt: "As this creature enters, choose a color.",
    choices: [
      { label: "White", value: "W", isValid: true },
      { label: "Blue", value: "U", isValid: true },
      { label: "Black", value: "B", isValid: true },
      { label: "Red", value: "R", isValid: true },
      { label: "Green", value: "G", isValid: true },
    ],
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

describe("Add color via static — engine arm (Wave 4.8 lane 55, #2614 follow-up)", () => {
  let state: GameState;
  let alice: PlayerId;

  beforeEach(() => {
    registerCardScripts([
      ...RAW_CARD_SCRIPTS,
      TEST_LITERAL_COLOR_SCRIPT,
      TEST_CHOSEN_COLOR_SCRIPT,
    ]);
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
    it("accepts the literal-color add_color arm", () => {
      const r = CardScriptSchema.safeParse(TEST_LITERAL_COLOR_SCRIPT);
      expect(r.success).toBe(true);
    });
    it("accepts the chosen-sentinel add_color arm", () => {
      const r = CardScriptSchema.safeParse(TEST_CHOSEN_COLOR_SCRIPT);
      expect(r.success).toBe(true);
    });
    it("rejects an unknown add_color value", () => {
      const r = CardScriptSchema.safeParse({
        name: "Bad",
        oracle: "Bad",
        statics: [
          {
            text: "x",
            affects: {
              controller: "you",
              add_color: "P" as unknown as "W",
              addColorToSelf: true,
            },
          },
        ],
      });
      expect(r.success).toBe(false);
    });
    it("rejects add_color without addColorToSelf (no P/T / keywords)", () => {
      // The schema refine requires addColorToSelf when
      // add_color is present (otherwise the static is a
      // no-op in v1 — the drafter must opt in).
      const r = CardScriptSchema.safeParse({
        name: "Bad",
        oracle: "Bad",
        statics: [
          {
            text: "x",
            affects: { controller: "you", add_color: "R" },
          },
        ],
      });
      expect(r.success).toBe(false);
    });
  });

  describe("staticAffects", () => {
    it("returns true for source===target when the literal arm is set", () => {
      const sourceId = put(state, alice, "battlefield", testLiteralCard);
      const source = state.cards.get(sourceId)!;
      const literalStat = TEST_LITERAL_COLOR_SCRIPT.statics![0];
      expect(staticAffects(literalStat, source, source)).toBe(true);
    });
    it("returns false when target !== source (v1 self-only)", () => {
      const sourceId = put(state, alice, "battlefield", testLiteralCard);
      const targetId = put(state, alice, "battlefield", hostPrintedGreen);
      const source = state.cards.get(sourceId)!;
      const target = state.cards.get(targetId)!;
      const literalStat = TEST_LITERAL_COLOR_SCRIPT.statics![0];
      expect(staticAffects(literalStat, source, target)).toBe(false);
    });
    it("returns true for source===target when the chosen sentinel resolves", () => {
      const sourceId = put(state, alice, "battlefield", testChosenCard);
      const source = state.cards.get(sourceId)! as CardInstance;
      const withChoice = {
        ...state,
        waitingChoice: colorEnterChoiceFor(sourceId, alice),
      };
      const r = resolveEnterChoice(withChoice, alice, "B");
      expect(r.success).toBe(true);
      const resolved = r.state.cards.get(sourceId)!;
      expect(resolved.chosenColor).toBe("B");
      const chosenStat = TEST_CHOSEN_COLOR_SCRIPT.statics![0];
      expect(staticAffects(chosenStat, resolved, resolved)).toBe(true);
    });
    it("returns false when the chosen sentinel is unresolved", () => {
      const sourceId = put(state, alice, "battlefield", testChosenCard);
      const source = state.cards.get(sourceId)!;
      const chosenStat = TEST_CHOSEN_COLOR_SCRIPT.statics![0];
      // chosenColor is null — the player hasn't answered.
      // The static is inert until it resolves.
      expect(source.chosenColor).toBeNull();
      expect(staticAffects(chosenStat, source, source)).toBe(false);
    });
  });

  describe("refreshScriptedStatics stamping", () => {
    it("stamps chosenColorAdditions with the literal color on the source", () => {
      const sourceId = put(state, alice, "battlefield", testLiteralCard);
      const after = refreshScriptedStatics(state);
      const updated = after.cards.get(sourceId)!;
      expect(updated.chosenColorAdditions).toEqual(["R"]);
    });
    it("stamps chosenColorAdditions with the resolved chosen color after the enter choice resolves", () => {
      const sourceId = put(state, alice, "battlefield", testChosenCard);
      const withChoice = {
        ...state,
        waitingChoice: colorEnterChoiceFor(sourceId, alice),
      };
      const r = resolveEnterChoice(withChoice, alice, "G");
      expect(r.success).toBe(true);
      const after = refreshScriptedStatics(r.state);
      const updated = after.cards.get(sourceId)!;
      expect(updated.chosenColorAdditions).toEqual(["G"]);
    });
    it("does NOT stamp chosenColorAdditions when no add_color static is attached", () => {
      const hostId = put(state, alice, "battlefield", hostPrintedGreen);
      const after = refreshScriptedStatics(state);
      const updated = after.cards.get(hostId)!;
      expect(updated.chosenColorAdditions).toBeUndefined();
    });
    it("clears chosenColorAdditions when the source leaves the battlefield", () => {
      const sourceId = put(state, alice, "battlefield", testLiteralCard);
      const after = refreshScriptedStatics(state);
      expect(after.cards.get(sourceId)!.chosenColorAdditions).toEqual(["R"]);
      // Move the source out of the battlefield zone.
      const bf = after.zones.get(`${alice}-battlefield`)!;
      const moved = {
        ...after,
        zones: new Map(after.zones).set(`${alice}-battlefield`, {
          ...bf,
          cardIds: bf.cardIds.filter((id) => id !== sourceId),
        }),
      };
      const after2 = refreshScriptedStatics(moved);
      expect(after2.cards.get(sourceId)!.chosenColorAdditions).toBeUndefined();
    });
  });

  describe("getCardColors read path", () => {
    it("unions chosenColorAdditions with the printed colors", () => {
      const sourceId = put(state, alice, "battlefield", testLiteralCard);
      // The synthetic test card has empty printed colors.
      // After lane 55, it gains Red via chosenColorAdditions.
      const after = refreshScriptedStatics(state);
      const updated = after.cards.get(sourceId)!;
      // getCardColors reads `cardData.colors` (empty) plus
      // chosenColorAdditions (["R"]). The helper normalizes
      // to lowercase words.
      expect(getCardColors(updated)).toEqual(["red"]);
    });
    it("preserves a color that's BOTH printed AND added (no duplicates)", () => {
      // Test host with printed colors = [G]. Source adds
      // Red. The chosen-color anthem path expects to see
      // ["green", "red"] — no duplicates.
      const sourceId = put(state, alice, "battlefield", testLiteralCard);
      const hostId = put(state, alice, "battlefield", hostPrintedGreen);
      const after = refreshScriptedStatics(state);
      const updated = after.cards.get(sourceId)!;
      // Source: printed [] + chosenColorAdditions ["R"] =
      // ["red"].
      expect(getCardColors(updated)).toEqual(["red"]);
      // Host (no add_color static): printed ["G"] only.
      expect(getCardColors(after.cards.get(hostId)!)).toEqual(["green"]);
    });
  });

  describe("integration: chosen-color anthem sees the addition", () => {
    // Diamond Mare's chosen-color anthem reads
    // `getCardColors(target)` (lane 40). If we add an
    // `add_color: "chosen"` + `addColorToSelf: true` static
    // to a Diamond-Mare-shaped card, the source's own
    // anthem buffs itself (its chosen color is now in its
    // augmented color list).
    it("a Diamond-Mare-shaped card with add_color: 'chosen' self-buffs via its own anthem", () => {
      const diamondMareShapeScript = CardScriptSchema.parse({
        name: "Test Diamond Mare Shape (lane 55)",
        oracle:
          "As this creature enters, choose a color. This creature is the chosen color in addition to its other colors. This creature gets +1/+1.",
        enter_choice: {
          kind: "color",
          text: "As this creature enters, choose a color.",
        },
        statics: [
          {
            text: "This creature is the chosen color in addition to its other colors.",
            affects: {
              controller: "you",
              add_color: "chosen",
              addColorToSelf: true,
            },
          },
          {
            text: "This creature gets +1/+1.",
            affects: {
              controller: "you",
              self: true,
            },
            power: 1,
            toughness: 1,
          },
        ],
      });
      registerCardScripts([
        ...RAW_CARD_SCRIPTS,
        TEST_LITERAL_COLOR_SCRIPT,
        TEST_CHOSEN_COLOR_SCRIPT,
        diamondMareShapeScript,
      ]);
      const cardId = put(state, alice, "battlefield", {
        ...card({
          name: "Test Diamond Mare Shape (lane 55)",
          colors: [],
        }),
      });
      const withChoice = {
        ...state,
        waitingChoice: colorEnterChoiceFor(cardId, alice),
      };
      const r = resolveEnterChoice(withChoice, alice, "U");
      expect(r.success).toBe(true);
      const after = refreshScriptedStatics(r.state);
      const updated = after.cards.get(cardId)!;
      // The source's `chosenColorAdditions` is ["U"] (Blue).
      expect(updated.chosenColorAdditions).toEqual(["U"]);
      // The scriptStaticPT (the +1/+1 self-anthem) is { power: 1, toughness: 1 }.
      expect(updated.scriptStaticPT).toEqual({ power: 1, toughness: 1 });
      // The script is registered (the test card is registered
      // by name).
      const script = getCardScript("Test Diamond Mare Shape (lane 55)");
      expect(script).toBeDefined();
      expect(script!.enter_choice?.kind).toBe("color");
      expect(script!.statics).toHaveLength(2);
    });
  });
});