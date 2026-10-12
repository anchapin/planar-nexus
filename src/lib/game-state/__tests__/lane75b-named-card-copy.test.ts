/**
 * Wave 4.8 follow-up 8 lane 75b — Named-card copy
 * (`StaticSchema.become_copy` `named_card: { name: string }`
 * arm, #2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of cards that
 * become a copy of a named card for the duration of a turn:
 * Memnarch ("as long as this is in play, it's a copy of
 * [named card] until end of turn"), Clone Shell, the
 * manifested-as-named-copy family. The v1 minimum adds a
 * `named_card: { name: string }` arm on `StaticSchema.become_copy`
 * (parallel to lane 75's `target: CardInstanceId` arm). The
 * engine looks up the named card's printed `cardData` via
 * the new synchronous `getCardDataByName` registry helper
 * and stamps the source's `cardData` with the named card's
 * characteristics via the existing lane 75
 * `animatedUntilEndOfTurn` + `copyOfTargetId` infrastructure.
 *
 * Schema (card-scripts/schema.ts, StaticSchema):
 *   `become_copy: { named_card: { name: string }, until:
 *    "end_of_turn" }` — a new arm in the
 *    `become_copy` discriminated union. v1 single
 *    named card, "all characteristics copied" semantics
 *    with a turn-key duration.
 *
 * Engine (card-scripts/keyword-actions/scripted-statics.ts):
 *   `refreshScriptedStatics` collects `become_copy.named_card`
 *   from each static that affects the source itself
 *   (the arm is self-only — `staticAffects` returns
 *   true iff `source === target`, parallel to lane
 *   52's `add_creature_type` self-only semantics and
 *   lane 75's `become_copy.target`). The write phase
 *   resolves the named card via the synchronous
 *   `getCardDataByName` registry (mirroring the
 *   card-scripts `getCardScript` synchronous lookup
 *   path the refresh uses elsewhere). Missing-name
 *   is a no-op (the source keeps its printed
 *   `cardData`; the `become_copy` static's
 *   `named_card` arm can always be added in v1 — a
 *   missing card simply doesn't take effect until the
 *   registry is hydrated). The named card is NOT
 *   required to be on the battlefield (Memnarch names
 *   a card that's not in play; the source takes on
 *   the named card's printed characteristics for the
 *   duration of the turn).
 *
 * Test harness pattern: synthetic card script registered
 * via `CardScriptSchema.parse + registerCardScripts` (the
 * lane 49/52/55/59/60/62/63/64/65/66/67/68/69/70/71/72/73/74/75/75a/76
 * pattern). The synthetic `cardData` registry is
 * installed via `registerCardDataForTests` (the new
 * lane 75b test hook). The test exercises the refresh
 * path via the engine's `refreshScriptedStatics` (the
 * same call sites the engine uses for a real cast)
 * and inspects the source's `cardData` (overlaid) +
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

const HOST_NAME = "Test Named-Card Copy (lane 75b)";

/**
 * Synthetic `cardData` registry entries — Grizzly Bears
 * (lane 75's canonical example) and Serra Angel
 * (keywords). The lane 75b test installs this registry
 * via `registerCardDataForTests`; the engine's
 * `refreshScriptedStatics` looks up named cards via
 * `getCardDataByName(name)` which reads from this map.
 * Production: a follow-up lane hydrates this from the
 * Scryfall search index.
 */
const GRIZZLY_BEARS: ScryfallCard = {
  id: "mock-grizzly-bears-75b",
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
  id: "mock-serra-angel-75b",
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
 * carries the new `named_card: { name: string }` arm.
 * The synthetic `cardData` registry is installed via
 * `registerCardDataForTests` so the engine's
 * `refreshScriptedStatics` can look up the named card's
 * printed `cardData`.
 */
function registerNamedCardCopyScript(
  cardData: readonly ScryfallCard[],
  namedCardName: string,
): void {
  const script: CardScript = CardScriptSchema.parse({
    name: HOST_NAME,
    oracle:
      "As long as this is in play, it's a copy of [named card] until end of turn.",
    statics: [
      {
        text:
          "As long as this is in play, it's a copy of [named card] until end of turn.",
        affects: { controller: "you" },
        become_copy: {
          named_card: { name: namedCardName },
          until: "end_of_turn",
        },
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
  registerCardDataForTests(cardData);
}

describe("Wave 4.8 follow-up 8 lane 75b — named-card copy static", () => {
  afterAll(() => {
    resetCardScriptsForTests();
    resetCardDataForTests();
  });

  it("rejects a script with an empty named_card name", () => {
    // Schema guard: named_card.name must be at least 1 character.
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad named_card name (lane 75b)",
        oracle: "test",
        statics: [
          {
            text: "test",
            affects: { controller: "you" },
            become_copy: {
              named_card: { name: "" },
              until: "end_of_turn",
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects a script with both target and named_card arms", () => {
    // Schema guard: lane 75b's `named_card` and lane 75's
    // `target` are mutually exclusive — exactly one must
    // be set per the discriminated union shape.
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad both arms (lane 75b)",
        oracle: "test",
        statics: [
          {
            text: "test",
            affects: { controller: "you" },
            become_copy: {
              target: "x",
              named_card: { name: "Grizzly Bears" },
              until: "end_of_turn",
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects a script with neither target nor named_card", () => {
    // Schema guard: a `become_copy` arm must have either
    // `target: CardInstanceId` or `named_card: { name }`
    // but not neither. Zod's discriminated union does not
    // catch a `become_copy: { until }` (an object missing
    // both required fields), which is the closest we get
    // to the "neither" failure mode in v1.
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad neither arm (lane 75b)",
        oracle: "test",
        statics: [
          {
            text: "test",
            affects: { controller: "you" },
            become_copy: { until: "end_of_turn" },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects a script with a non-end_of_turn duration", () => {
    // Schema guard: `until` must be the v1 literal
    // `"end_of_turn"`. Permanent copies (no duration)
    // are a follow-up lane.
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad named_card until (lane 75b)",
        oracle: "test",
        statics: [
          {
            text: "test",
            affects: { controller: "you" },
            become_copy: {
              named_card: { name: "x" },
              until: "indefinite",
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts the v1 named_card schema (named_card.name + end_of_turn)", () => {
    // Sanity check: the script parses and the static
    // carries the new `named_card` arm.
    const parsed = CardScriptSchema.parse({
      name: HOST_NAME,
      oracle:
        "As long as this is in play, it's a copy of [named card] until end of turn.",
      statics: [
        {
          text:
            "As long as this is in play, it's a copy of [named card] until end of turn.",
          affects: { controller: "you" },
          become_copy: {
            named_card: { name: "Grizzly Bears" },
            until: "end_of_turn",
          },
        },
      ],
    });
    expect(parsed.statics?.[0]?.become_copy).toEqual({
      named_card: { name: "Grizzly Bears" },
      until: "end_of_turn",
    });
  });

  it("overlays the source's cardData with the named card's characteristics after refresh", () => {
    // Source: a 0/0 Shapeshifter with a `become_copy`
    // arm carrying `named_card: "Grizzly Bears"`. The
    // named card's `cardData` lives in the synchronous
    // `cardDataByName` registry (installed via
    // `registerCardDataForTests`). After
    // `refreshScriptedStatics`, the source's printed
    // `cardData` is preserved under
    // `animatedUntilEndOfTurn`, and the live `cardData`
    // carries the named card's name, type_line, P/T,
    // colors, and keywords.
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      state,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source-75b" }),
    );
    registerNamedCardCopyScript([GRIZZLY_BEARS], "Grizzly Bears");
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    expect(source).toBeDefined();
    // The source's live cardData now mirrors the
    // named card's printed characteristics.
    expect(source?.cardData.name).toBe("Grizzly Bears");
    expect(source?.cardData.type_line).toBe("Creature — Bear");
    expect(source?.cardData.power).toBe("2");
    expect(source?.cardData.toughness).toBe("2");
    expect(source?.cardData.colors).toEqual(["G"]);
    expect(source?.cardData.color_identity).toEqual(["G"]);
    // The lane 75 ledger is set so the EOT rollback
    // restores the source's printed cardData.
    expect(source?.copyOfTargetId).toMatch(/^name:/);
    expect(source?.animatedUntilEndOfTurn?.cardData.name).toBe(HOST_NAME);
  });

  it("copies keywords from the named card (Serra Angel flying + vigilance)", () => {
    // The named card may carry keywords. The v1 overlay
    // covers keywords (parallel to lane 75).
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      state,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source-serra-75b" }),
    );
    registerNamedCardCopyScript([SERRA_ANGEL], "Serra Angel");
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    expect(source?.cardData.name).toBe("Serra Angel");
    expect(source?.cardData.power).toBe("4");
    expect(source?.cardData.toughness).toBe("4");
    expect(source?.cardData.keywords).toEqual(["flying", "vigilance"]);
  });

  it("no-ops when the named card is missing from the registry", () => {
    // The named card is not in the `cardDataByName`
    // registry (the registry is empty for this test).
    // The engine sees `getCardDataByName(name) === undefined`
    // and skips the overlay — the source keeps its
    // printed `cardData` (the Shapeshifter's 0/0).
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      state,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source-missing-75b" }),
    );
    registerNamedCardCopyScript([], "Nonexistent Card");
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    // The source's printed characteristics are
    // untouched — no overlay applied.
    expect(source?.cardData.name).toBe(HOST_NAME);
    expect(source?.cardData.power).toBe("0");
    expect(source?.cardData.toughness).toBe("0");
    expect(source?.animatedUntilEndOfTurn).toBeUndefined();
    expect(source?.copyOfTargetId).toBeUndefined();
  });

  it("does NOT require the named card to be on the battlefield", () => {
    // Memnarch / Clone Shell shape: the named card is NOT
    // on the battlefield — the named card's `cardData`
    // comes from the synchronous registry, not from
    // `state.cards.get(targetId)`. The overlay applies.
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      state,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source-off-bf-75b" }),
    );
    registerNamedCardCopyScript([GRIZZLY_BEARS], "Grizzly Bears");
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    // The named card is not on the battlefield, but the
    // overlay still applies (the registry supplies the
    // `cardData`).
    expect(source?.cardData.name).toBe("Grizzly Bears");
    expect(source?.cardData.power).toBe("2");
    expect(source?.cardData.toughness).toBe("2");
    expect(source?.copyOfTargetId).toMatch(/^name:/);
  });

  it("EOT cleanup rolls back the source's cardData via clearUntilEndOfTurnPT", () => {
    // After the refresh overlay applies, calling
    // `clearUntilEndOfTurnPT` rolls the source's
    // `cardData` back to the printed `cardData`
    // (mirrors lane 75's EOT cleanup).
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      state,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source-eot-75b" }),
    );
    registerNamedCardCopyScript([GRIZZLY_BEARS], "Grizzly Bears");
    const refreshed = refreshScriptedStatics(withSource);
    const before = refreshed.cards.get(sourceId);
    expect(before?.cardData.name).toBe("Grizzly Bears");
    // EOT cleanup: restore printed `cardData`.
    const cleaned = clearUntilEndOfTurnPT(refreshed);
    const after = cleaned.cards.get(sourceId);
    expect(after?.cardData.name).toBe(HOST_NAME);
    expect(after?.cardData.power).toBe("0");
    expect(after?.cardData.toughness).toBe("0");
    expect(after?.animatedUntilEndOfTurn).toBeUndefined();
  });
});
