/**
 * Wave 4.8 follow-up 7 lane 75 — "Until end of turn" copy
 * static (`StaticSchema.become_copy`, #2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of cards that
 * become a copy of another permanent for the duration of a
 * turn: Sakashima's Student / Sakashima the Impostor /
 * Clone Shell / the manifested family. The v1 minimum adds a
 * `become_copy: { target: CardInstanceId, until:
 * "end_of_turn" }` arm on `StaticSchema` (parallel to lane
 * 71's `protectionFrom`). The engine stamps the named
 * target's printed characteristics (name, type_line, power,
 * toughness, colors, keywords) onto the source's
 * `cardData` for the duration of the turn, and the existing
 * `clearUntilEndOfTurnPT` /
 * `restoreAnimatedOffBattlefield` rollback path restores
 * the source's printed characteristics at end of turn /
 * when the source leaves the battlefield.
 *
 * Schema (card-scripts/schema.ts, StaticSchema):
 *   `become_copy: { target: string, until:
 *    "end_of_turn" }` — optional arm on the static slot.
 *    v1 single-target, "all characteristics copied" semantics
 *    with a turn-key duration. Chosen-target copies
 *    (Cackling Counterpart), named-card copies ("Becomes a
 *    copy of [card name]"), copy-with-exception copies
 *    (Phyrexian Metamorph-style), nested copies (a target
 *    that itself has a `become_copy`), and Aura-shaped
 *    copies ("enchanted creature is a copy of [target]
 *    until end of turn") are follow-up lanes.
 *
 * Engine (card-scripts/keyword-actions/scripted-statics.ts):
 *   `refreshScriptedStatics` collects `become_copy.target`
 *   from each static that affects the source itself (the
 *   arm is self-only — `staticAffects` returns true iff
 *   `source === target`, parallel to lane 52's
 *   `add_creature_type` self-only semantics). The write
 *   phase at the bottom of the refresh pass overlays the
 *   target's printed characteristics onto the source's
 *   `cardData`, snapshots the source's printed `cardData`
 *   under `animatedUntilEndOfTurn`, and stamps
 *   `card.copyOfTargetId`. The overlay self-corrects when
 *   the named target leaves the battlefield (the source
 *   restores its printed `cardData` from
 *   `animatedUntilEndOfTurn`). EOT cleanup is handled by
 *   the existing `clearUntilEndOfTurnPT` /
 *   `restoreAnimatedOffBattlefield` rollback paths.
 *
 * Test harness pattern: synthetic card script registered
 * via `CardScriptSchema.parse + registerCardScripts` (the
 * lane 49/52/55/59/60/62/63/64/65/66/67/68/69/70/71/72/73/74/76
 * pattern). The test exercises the refresh path via the
 * engine's `refreshScriptedStatics` (the same call sites
 * the engine uses for a real cast) and inspects the
 * source's `cardData` (overlaid) + `animatedUntilEndOfTurn`
 * (printed backup) + `copyOfTargetId` ledger.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { refreshScriptedStatics } from "../keyword-actions/scripted-statics";
import { clearUntilEndOfTurnPT } from "../pt-until-end-of-turn";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test Until-EOT Copy (lane 75)";

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

const GRIZZLY_BEARS: ScryfallCard = {
  id: "mock-grizzly-bears-75",
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
  id: "mock-serra-angel-75",
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
 * Build a `become_copy` script whose `target` matches an
 * existing battlefield card's id. Re-registers the script so
 * the static's `target` field names the live card id.
 */
function registerBecomeCopyScript(targetId: string): void {
  const script: CardScript = CardScriptSchema.parse({
    name: HOST_NAME,
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

describe("Wave 4.8 follow-up 7 lane 75 — until-EOT copy static", () => {
  afterAll(() => {
    resetCardScriptsForTests();
  });

  it("rejects a script with an empty become_copy target", () => {
    // Schema guard: target must be at least 1 character.
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad become_copy target (lane 75)",
        oracle: "test",
        statics: [
          {
            text: "test",
            affects: { controller: "you" },
            become_copy: { target: "", until: "end_of_turn" },
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
        name: "Bad become_copy until (lane 75)",
        oracle: "test",
        statics: [
          {
            text: "test",
            affects: { controller: "you" },
            become_copy: { target: "x", until: "indefinite" },
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts the v1 become_copy schema (single target + end_of_turn)", () => {
    // Sanity check: the script parses and the static
    // carries the copy arm.
    const parsed = CardScriptSchema.parse({
      name: HOST_NAME,
      oracle:
        "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
      statics: [
        {
          text:
            "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
          affects: { controller: "you" },
          become_copy: {
            target: "x",
            until: "end_of_turn",
          },
        },
      ],
    });
    expect(parsed.statics?.[0]?.become_copy).toEqual({
      target: "x",
      until: "end_of_turn",
    });
  });

  it("overlays the source's cardData with the target's characteristics after refresh", () => {
    // Source: a 0/0 Shapeshifter with a `become_copy` arm
    // targeting a 2/2 Grizzly Bears on the same player's
    // battlefield. After `refreshScriptedStatics`, the
    // source's printed `cardData` is preserved under
    // `animatedUntilEndOfTurn`, and the live `cardData`
    // carries the Grizzly Bears's name, type_line, P/T,
    // colors, and keywords.
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withTarget, cardId: targetId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    registerBecomeCopyScript(targetId);
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      withTarget,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source" }),
    );
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    expect(source).toBeDefined();
    // The source's live cardData now mirrors the Grizzly
    // Bears's printed characteristics (name, type_line,
    // P/T, colors, keywords).
    expect(source?.cardData.name).toBe("Grizzly Bears");
    expect(source?.cardData.type_line).toBe("Creature — Bear");
    expect(source?.cardData.power).toBe("2");
    expect(source?.cardData.toughness).toBe("2");
    expect(source?.cardData.colors).toEqual(["G"]);
    expect(source?.cardData.keywords).toEqual([]);
    // The source's original cardData is preserved under
    // animatedUntilEndOfTurn so the EOT cleanup rolls it
    // back. The Shapeshifter source's printed name was
    // HOST_NAME.
    expect(source?.animatedUntilEndOfTurn?.cardData.name).toBe(HOST_NAME);
    expect(source?.animatedUntilEndOfTurn?.cardData.power).toBe("0");
    expect(source?.animatedUntilEndOfTurn?.cardData.toughness).toBe("0");
    // The copy-of-target ledger names the Grizzly Bears.
    expect(source?.copyOfTargetId).toBe(targetId);
    // The Grizzly Bears itself is unchanged.
    const target = refreshed.cards.get(targetId);
    expect(target?.cardData.name).toBe("Grizzly Bears");
  });

  it("copies keywords (e.g. flying, vigilance) from a Serra Angel target", () => {
    // v1 supports copying keywords from the target —
    // "all characteristics copied" semantics (CR 707.2).
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withTarget, cardId: targetId } = putOnBattlefield(
      state,
      aliceId,
      SERRA_ANGEL,
    );
    registerBecomeCopyScript(targetId);
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      withTarget,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source-angel" }),
    );
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    expect(source?.cardData.name).toBe("Serra Angel");
    expect(source?.cardData.keywords).toEqual(["flying", "vigilance"]);
    expect(source?.cardData.power).toBe("4");
    expect(source?.cardData.toughness).toBe("4");
  });

  it("does NOT overlay cardData when the target is off the battlefield", () => {
    // Place the source on Alice's battlefield and the
    // Grizzly Bears on Bob's. The `become_copy.target`
    // names a card that does NOT exist — `state.cards`
    // has no entry for that id. The refresh pass sees no
    // target and leaves the source's printed cardData
    // alone (no `animatedUntilEndOfTurn`, no
    // `copyOfTargetId`).
    const { state, aliceId } = setupTwoPlayerGame();
    registerBecomeCopyScript("nonexistent-card-id");
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      state,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source-no-target" }),
    );
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    expect(source?.cardData.name).toBe(HOST_NAME);
    expect(source?.cardData.power).toBe("0");
    expect(source?.animatedUntilEndOfTurn).toBeUndefined();
    expect(source?.copyOfTargetId).toBeUndefined();
  });

  it("restores the source's printed cardData when the target leaves the battlefield (untracked zone)", () => {
    // Wave 4.8 follow-up 10 lane 78 (#2614 follow-up):
    // the target's "in a tracked zone" check. v1 dropped
    // the overlay when the target moved to ANY
    // non-battlefield zone (graveyard / hand / exile /
    // library / command). Lane 78 changed that — the
    // overlay persists for tracked zones (graveyard is
    // a tracked zone after `startGame`) and only drops
    // for untracked zones (a zone key not in
    // `state.zones`, e.g. `limbo`). This test exercises
    // the untracked-zone path: the target's
    // `currentZoneKey` is reassigned to a key NOT in
    // `state.zones`, the next refresh pass drops the
    // overlay and restores the source's printed
    // `cardData` from `animatedUntilEndOfTurn`.
    //
    // Wave 4.8 follow-up 23 lane 70 piece 2b (#2614
    // follow-up): the script-lookup consult was widened
    // from `card.cardData.name` to
    // `printedCardDataOf(card).name` so the source's
    // overlay-aware cardData does not mask the
    // `staticAffects` walk on subsequent refreshes. The
    // pre-2b lane 75 lookup used `card.cardData.name`
    // which (after overlay) returned the target's
    // printed name — the script wasn't found, the diff
    // was a no-op, and the rollback never ran. The
    // pre-2b test passed via that bug.
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withTarget, cardId: targetId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    registerBecomeCopyScript(targetId);
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      withTarget,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source-leave" }),
    );
    const refreshed = refreshScriptedStatics(withSource);
    const activeSource = refreshed.cards.get(sourceId);
    expect(activeSource?.cardData.name).toBe("Grizzly Bears");
    // Move the target to an UNTRACKED zone (a zone key
    // that doesn't exist in `state.zones`). The lookup
    // `state.zones.has(target.currentZoneKey)` returns
    // false → the overlay drops on the next refresh.
    const targetCard = refreshed.cards.get(targetId)!;
    const movedCards = new Map(refreshed.cards);
    movedCards.set(targetId, {
      ...targetCard,
      currentZoneKey: `${aliceId}-limbo`,
    });
    const movedZones = new Map(refreshed.zones);
    const bfKey = `${aliceId}-battlefield`;
    const bf = movedZones.get(bfKey)!;
    movedZones.set(bfKey, {
      ...bf,
      cardIds: bf.cardIds.filter((id) => id !== targetId),
    });
    const afterMove = refreshScriptedStatics({
      ...refreshed,
      cards: movedCards,
      zones: movedZones,
    });
    const restored = afterMove.cards.get(sourceId);
    // The source has been restored to its printed
    // cardData (the Shapeshifter's HOST_NAME).
    expect(restored?.cardData.name).toBe(HOST_NAME);
    expect(restored?.cardData.power).toBe("0");
    expect(restored?.cardData.toughness).toBe("0");
    expect(restored?.animatedUntilEndOfTurn).toBeUndefined();
    expect(restored?.copyOfTargetId).toBeUndefined();
  });

  it("EOT cleanup rolls back the source's cardData via clearUntilEndOfTurnPT", () => {
    // The existing `clearUntilEndOfTurnPT` /
    // `restoreAnimatedOffBattlefield` rollback paths
    // restore the source's printed `cardData` when the
    // turn ends. The cleanup step in
    // `game-state/index.ts` calls `clearUntilEndOfTurnPT`
    // at the cleanup step (CR 514.2).
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withTarget, cardId: targetId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    registerBecomeCopyScript(targetId);
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      withTarget,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source-eot" }),
    );
    const refreshed = refreshScriptedStatics(withSource);
    const before = refreshed.cards.get(sourceId);
    expect(before?.cardData.name).toBe("Grizzly Bears");
    expect(before?.animatedUntilEndOfTurn?.cardData.name).toBe(HOST_NAME);
    // EOT cleanup. clearUntilEndOfTurnPT inspects
    // `animatedUntilEndOfTurn` and restores the printed
    // cardData, clearing the overlay.
    const cleaned = clearUntilEndOfTurnPT(refreshed);
    const after = cleaned.cards.get(sourceId);
    expect(after?.cardData.name).toBe(HOST_NAME);
    expect(after?.cardData.power).toBe("0");
    expect(after?.cardData.toughness).toBe("0");
    expect(after?.animatedUntilEndOfTurn).toBeUndefined();
  });

  it("does NOT copy from the target onto OTHER creatures on the battlefield", () => {
    // The `become_copy` arm is self-only — the static
    // affects the source itself, not other permanents.
    // Place the source + a third creature on Alice's
    // battlefield. The third creature's cardData is
    // untouched after refresh.
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withTarget, cardId: targetId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    registerBecomeCopyScript(targetId);
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      withTarget,
      aliceId,
      makeSourceCard({ id: "shapeshifter-source-self-only" }),
    );
    // Add a third creature (a 3/3 vanilla Human).
    const thirdCardDef: ScryfallCard = {
      id: "mock-vanilla-third",
      name: "Vanilla Third",
      type_line: "Creature — Human",
      oracle_text: "",
      mana_cost: "{3}",
      cmc: 3,
      colors: [],
      color_identity: [],
      keywords: [],
      power: "3",
      toughness: "3",
      legalities: { standard: "legal" },
      layout: "normal",
    } as ScryfallCard;
    const { state: withThird, cardId: thirdId } = putOnBattlefield(
      withSource,
      aliceId,
      thirdCardDef,
    );
    const refreshed = refreshScriptedStatics(withThird);
    const third = refreshed.cards.get(thirdId);
    // The third creature's cardData is untouched.
    expect(third?.cardData.name).toBe("Vanilla Third");
    expect(third?.cardData.power).toBe("3");
    expect(third?.cardData.toughness).toBe("3");
    expect(third?.copyOfTargetId).toBeUndefined();
    expect(third?.animatedUntilEndOfTurn).toBeUndefined();
    // The source's cardData IS overlaid.
    const source = refreshed.cards.get(sourceId);
    expect(source?.cardData.name).toBe("Grizzly Bears");
  });
});