/**
 * Wave 4.8 follow-up 8 lane 75c — Copy with exception
 * (`StaticSchema.become_copy` `exceptions: { add_subtype }`
 * arm, #2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of cards
 * that become a copy of another permanent with an
 * exception rider: Phyrexian Metamorph ("it's a copy of
 * [chosen permanent] except it's a Phyrexian in addition
 * to its other types"), the "in addition to its other
 * types" subfamily of the until-EOT-copy family. The v1
 * minimum adds an `exceptions: { add_subtype?: string[] }`
 * arm to both the lane 75 (`target`) and lane 75b
 * (`named_card`) variants of `StaticSchema.become_copy`.
 * After the lane 75 / 75b overlay writes the target's
 * printed `cardData`, the engine merges the listed
 * subtypes onto the source's overlaid
 * `cardData.type_line` (rebuilding it as
 * `<types> \u2014 <printed + added subtypes>`). v1 supports
 * a single `add_subtype` arm.
 *
 * Schema (card-scripts/schema.ts, StaticSchema):
 *   `become_copy: { target | named_card, until:
 *    "end_of_turn", exceptions: { add_subtype: string[] }
 *    }` — an optional `exceptions` arm on the same
 *    discriminated union lane 75 / 75b use; v1 only
 *    supports `add_subtype` (Phyrexian Metamorph pattern).
 *
 * Engine (card-scripts/keyword-actions/scripted-statics.ts):
 *   `refreshScriptedStatics` collects
 *   `become_copy.exceptions.add_subtype` from each
 *   static that affects the source itself (the arm is
 *   self-only — `staticAffects` returns true iff
 *   `source === target`). After the lane 75 / 75b
 *   overlay writes the target's printed `cardData`, the
 *   write phase rebuilds the overlaid `type_line` via
 *   the `rebuildTypeLineWithAddedSubtypes` helper to
 *   include the listed subtypes. The exception is applied
 *   AFTER the overlay (the overlay is the lane 75 / 75b
 *   `targetPrinted` lookup, unchanged from lane 75b). The
 *   EOT cleanup step (`clearUntilEndOfTurnPT`) restores
 *   the printed `cardData` (and the printed type_line)
 *   so the "until end of turn" semantics are honoured for
 *   free.
 *
 * Test harness pattern: synthetic card script registered
 * via `CardScriptSchema.parse + registerCardScripts` (the
 * lane 49/52/55/59/60/62/63/64/65/66/67/68/69/70/71/72/73/74/75/75a/75b/76
 * pattern). The synthetic `cardData` registry is
 * installed via `registerCardDataForTests` (the lane 75b
 * test hook for the named-card variant). The test
 * exercises the refresh path via the engine's
 * `refreshScriptedStatics` (the same call sites the
 * engine uses for a real cast) and inspects the source's
 * `cardData` (overlaid + exception-merged) +
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
import { clearUntilEndOfTurnPT } from "../pt-until-end-of-turn";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test Copy With Exception (lane 75c)";

/**
 * Synthetic `cardData` registry entries — covers all
 * branches the lane 75c test exercises (creature copy
 * + subtype append; non-creature copy + subtype
 * append; missing named card). The lane 75 / 75b
 * test hook installs this registry.
 */
const GRIZZLY_BEARS: ScryfallCard = {
  id: "mock-grizzly-bears-75c",
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

const CRUSHER_OF_PHYREXIA: ScryfallCard = {
  id: "mock-crusher-75c",
  name: "Crusher of Phyrexia",
  type_line: "Creature — Phyrexian Wurm",
  oracle_text: "Trample",
  mana_cost: "{3}{G}{G}{G}",
  cmc: 5,
  colors: ["G"],
  color_identity: ["G"],
  keywords: ["trample"],
  power: "5",
  toughness: "5",
  legalities: { standard: "legal" },
  layout: "normal",
} as ScryfallCard;

function makeSourceCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? HOST_NAME,
    type_line: overrides.type_line ?? "Creature — Shapeshifter",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{3}{U}",
    cmc: overrides.cmc ?? 4,
    colors: overrides.colors ?? ["U"],
    color_identity: overrides.color_identity ?? ["U"],
    keywords: overrides.keywords ?? [],
    power: overrides.power ?? "0",
    toughness: overrides.toughness ?? "0",
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

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
 * Adds a card directly to the named player's battlefield.
 */
function putOnBattlefield(
  state: GameState,
  controllerId: PlayerId,
  cardDef: ScryfallCard,
): { state: GameState; cardId: CardInstanceId } {
  const cardId = `card-${cardDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
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
 * Re-registers a host script whose `become_copy` static
 * carries the new `exceptions.add_subtype` arm. The
 * `become` argument is the inner `target` or `named_card`
 * shape; the function wraps it with `until:
 * "end_of_turn"` + the `exceptions` arm.
 */
function registerCopyWithExceptionScript(
  become:
    | { target: string }
    | { named_card: { name: string } },
  cardData: readonly ScryfallCard[],
  addSubtype: readonly string[],
): void {
  const exceptions =
    addSubtype.length > 0 ? { add_subtype: [...addSubtype] } : undefined;
  const becomeCopy: Record<string, unknown> = {
    ...become,
    until: "end_of_turn",
    ...(exceptions ? { exceptions } : {}),
  };
  const script: CardScript = CardScriptSchema.parse({
    name: HOST_NAME,
    oracle:
      "As long as this is in play, it's a copy of [chosen permanent] until end of turn. It's also a [subtype] in addition to its other types.",
    statics: [
      {
        text:
          "As long as this is in play, it's a copy of [chosen permanent] until end of turn. It's also a [subtype] in addition to its other types.",
        affects: { controller: "you" },
        become_copy: becomeCopy as never,
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
  registerCardDataForTests(cardData);
}

describe("Wave 4.8 follow-up 8 lane 75c — copy with exception", () => {
  afterAll(() => {
    resetCardScriptsForTests();
    resetCardDataForTests();
  });

  it("rejects a script with an empty add_subtype list", () => {
    // Schema guard: `add_subtype` must be at least 1
    // element when set. An empty list is a no-op (the
    // schema rejects it).
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad add_subtype empty list (lane 75c)",
        oracle: "test",
        statics: [
          {
            text: "test",
            affects: { controller: "you" },
            become_copy: {
              named_card: { name: "Grizzly Bears" },
              until: "end_of_turn",
              exceptions: { add_subtype: [] },
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects a script with a 1-char add_subtype entry (min-length 1)", () => {
    // Schema guard: each entry must be at least 1
    // character.
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad add_subtype empty entry (lane 75c)",
        oracle: "test",
        statics: [
          {
            text: "test",
            affects: { controller: "you" },
            become_copy: {
              named_card: { name: "Grizzly Bears" },
              until: "end_of_turn",
              exceptions: { add_subtype: [""] },
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects an exceptions object with unknown arms (strict mode)", () => {
    // Schema guard: the `exceptions` object is `.strict()`
    // — unknown arms (e.g. `add_color`, `add_power`) are
    // out-of-scope follow-up lanes and rejected in v1.
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad exceptions unknown arm (lane 75c)",
        oracle: "test",
        statics: [
          {
            text: "test",
            affects: { controller: "you" },
            become_copy: {
              named_card: { name: "Grizzly Bears" },
              until: "end_of_turn",
              exceptions: { add_color: ["R"] },
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts the v1 copy-with-exception schema (named_card + add_subtype + end_of_turn)", () => {
    // Sanity check: the script parses with the new
    // `exceptions: { add_subtype: [...] }` arm.
    const parsed = CardScriptSchema.parse({
      name: HOST_NAME,
      oracle:
        "As long as this is in play, it's a copy of [named card] until end of turn. It's also a Phyrexian in addition to its other types.",
      statics: [
        {
          text:
            "As long as this is in play, it's a copy of [named card] until end of turn. It's also a Phyrexian in addition to its other types.",
          affects: { controller: "you" },
          become_copy: {
            named_card: { name: "Grizzly Bears" },
            until: "end_of_turn",
            exceptions: { add_subtype: ["Phyrexian"] },
          },
        },
      ],
    });
    const stat = parsed.statics?.[0];
    expect(stat?.become_copy).toEqual({
      named_card: { name: "Grizzly Bears" },
      until: "end_of_turn",
      exceptions: { add_subtype: ["Phyrexian"] },
    });
  });

  it("merges add_subtype onto the named-card copy overlay (Phyrexian Metamorph pattern)", () => {
    // Source: a Shapeshifter with a
    // `become_copy: { named_card: "Grizzly Bears",
    // until: "end_of_turn", exceptions: { add_subtype:
    // ["Phyrexian"] } }` static. The overlay stamps
    // Grizzly Bears's characteristics; the exception
    // appends "Phyrexian" to the source's overlaid
    // type_line. After refresh: the source's
    // `cardData.type_line` is
    // "Creature — Bear Phyrexian" (the printed
    // subtypes plus the appended subtype). The printed
    // backup is preserved under
    // `animatedUntilEndOfTurn.cardData.type_line`,
    // which still reads "Creature — Shapeshifter"
    // (the source's own printed type line).
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      state,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source-75c" }),
    );
    registerCopyWithExceptionScript(
      { named_card: { name: "Grizzly Bears" } },
      [GRIZZLY_BEARS],
      ["Phyrexian"],
    );
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    expect(source).toBeDefined();
    // The overlay stamped the named card's
    // characteristics.
    expect(source?.cardData.name).toBe("Grizzly Bears");
    expect(source?.cardData.power).toBe("2");
    expect(source?.cardData.toughness).toBe("2");
    // The exception appended "Phyrexian" to the
    // overlaid subtype list.
    expect(source?.cardData.type_line).toBe(
      "Creature — Bear Phyrexian",
    );
    // The lane 75 / 75b ledger + the printed backup
    // are set so the EOT cleanup restores the
    // source's printed characteristics.
    expect(source?.copyOfTargetId).toMatch(/^name:/);
    expect(source?.animatedUntilEndOfTurn?.cardData.name).toBe(HOST_NAME);
    expect(source?.animatedUntilEndOfTurn?.cardData.type_line).toBe(
      "Creature — Shapeshifter",
    );
  });

  it("merges add_subtype onto the chosen-target copy overlay (chosen permanent + subtype append)", () => {
    // Same shape, but the source uses the lane 75
    // `target: CardInstanceId` arm (chosen permanent on
    // the battlefield). The chosen target is a Grizzly
    // Bears; the exception appends "Phyrexian".
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withTarget, cardId: targetId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      withTarget,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source-target-75c" }),
    );
    registerCopyWithExceptionScript(
      { target: targetId as string },
      [GRIZZLY_BEARS],
      ["Phyrexian"],
    );
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    expect(source).toBeDefined();
    expect(source?.cardData.name).toBe("Grizzly Bears");
    expect(source?.cardData.type_line).toBe(
      "Creature — Bear Phyrexian",
    );
    // The lane 75 ledger is the target's
    // CardInstanceId (not the lane 75b `name:...`
    // form).
    expect(source?.copyOfTargetId).toBe(targetId as string);
  });

  it("merges add_subtype without overwriting printed target subtypes (multi-subtype append)", () => {
    // The named card is "Crusher of Phyrexia"
    // ("Creature — Phyrexian Wurm"); the exception
    // appends "Phyrexian" again — the
    // dedupe-by-exact-match logic in
    // `rebuildTypeLineWithAddedSubtypes` keeps the
    // type line "Creature — Phyrexian Wurm"
    // (no double "Phyrexian Phyrexian").
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      state,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source-dedupe-75c" }),
    );
    registerCopyWithExceptionScript(
      { named_card: { name: "Crusher of Phyrexia" } },
      [CRUSHER_OF_PHYREXIA],
      ["Phyrexian"],
    );
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    // The dedupe keeps the printed "Phyrexian"
    // (no duplicate). The overlay completes
    // successfully.
    expect(source?.cardData.type_line).toBe(
      "Creature — Phyrexian Wurm",
    );
  });

  it("appends multiple add_subtype entries in order", () => {
    // Multiple `add_subtype` entries are appended in
    // the order listed in the static. This is the
    // `add_subtype: ["Phyrexian", "Wurm"]` shape
    // (an exception that adds two subtypes — the
    // v1 single-`add_subtype` shape supports an
    // arbitrary number of subtypes in the list;
    // multi-exception copies are a follow-up lane).
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      state,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source-multi-75c" }),
    );
    registerCopyWithExceptionScript(
      { named_card: { name: "Grizzly Bears" } },
      [GRIZZLY_BEARS],
      ["Phyrexian", "Wurm"],
    );
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    // Both subtypes are appended in order; the
    // dedupe keeps the printed "Bear" first.
    expect(source?.cardData.type_line).toBe(
      "Creature — Bear Phyrexian Wurm",
    );
  });

  it("EOT cleanup rolls back the source's cardData including the type_line merge", () => {
    // After the overlay + exception merge, calling
    // `clearUntilEndOfTurnPT` rolls the source's
    // `cardData` back to the printed `cardData` (the
    // Shapeshifter's `Creature — Shapeshifter` type
    // line, with no "Phyrexian" suffix). The exception
    // merge is undone because the entire overlay is
    // undone (the lane 75 / 75b + lane 75c rollback
    // is "drop the overlay + restore the printed
    // cardData", and the printed cardData didn't
    // have the appended subtypes).
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      state,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source-eot-75c" }),
    );
    registerCopyWithExceptionScript(
      { named_card: { name: "Grizzly Bears" } },
      [GRIZZLY_BEARS],
      ["Phyrexian"],
    );
    const refreshed = refreshScriptedStatics(withSource);
    const before = refreshed.cards.get(sourceId);
    expect(before?.cardData.type_line).toBe(
      "Creature — Bear Phyrexian",
    );
    // EOT cleanup.
    const cleaned = clearUntilEndOfTurnPT(refreshed);
    const after = cleaned.cards.get(sourceId);
    expect(after?.cardData.name).toBe(HOST_NAME);
    expect(after?.cardData.type_line).toBe(
      "Creature — Shapeshifter",
    );
    expect(after?.animatedUntilEndOfTurn).toBeUndefined();
  });
});
