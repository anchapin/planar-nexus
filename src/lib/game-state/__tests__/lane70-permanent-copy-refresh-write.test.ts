/**
 * Wave 4.8 follow-up 23 lane 70 piece 2a (#2614 follow-up):
 * refresh-pass write of the `copyOfTargetIdPermanent`
 * ledger for the "becomes a copy of [X] forever"
 * (`until: "permanent"`) variant.
 *
 * The follow-up 22 piece 1/N shipped the schema arm +
 * the `CardInstance.copyOfTargetIdPermanent` field +
 * the `setPermanentCopyOf` / `clearPermanentCopyOf`
 * helpers. Piece 2a wires the refresh pass to consult
 * the schema discriminator and route
 * `until: "permanent"` through the new helpers. v1 is
 * SUBSTRATE-ONLY: the refresh pass stamps the ledger
 * but does NOT overlay `cardData` (the
 * name / type_line / power / toughness / colors /
 * keywords overlay + battlefield-leave cleanup ride
 * piece 2b).
 *
 * Concurrency model:
 *
 *  - The collection phase (`copyOfTargetBySourceId`)
 *    reads `stat.become_copy.{target|named_card}.until`
 *    and stamps the value alongside the `kind: "id"`
 *    vs `kind: "name"` discriminator.
 *  - The write phase branches on
 *    `nextCopyTarget.until === "permanent"` early in
 *    the overlay block: a permanent arm `continue`s
 *    past the EOT overlay + rollback + cycle guard.
 *    The permanent arm inherits the same cycle-guard
 *    semantics as lane 75e by virtue of the shared
 *    `copyChain.cycleIds.has(cardId)` check at the
 *    top of the overlay block.
 *  - The "target missing" rollback
 *    (`targetPrintedCardData === undefined`)
 *    clears the permanent ledger via
 *    `clearPermanentCopyOf`. The source keeps its
 *    printed `cardData` (the permanent path in 2a
 *    never modifies it).
 *  - The "static disappeared" rollback
 *    (`copyOfTargetBySourceId.get(cardId) ===
 *    undefined` for a card whose
 *    `copyOfTargetIdPermanent` was previously set)
 *    also clears the ledger.
 *
 * The test pattern mirrors the lane 75 / lane 70
 * piece 1/N `CardScriptSchema.parse +
 * registerCardScripts` shape; the refresh path is
 * exercised via `refreshScriptedStatics` (the same
 * call sites the engine uses for a real cast).
 */
import { describe, it, expect, afterAll } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { refreshScriptedStatics } from "../keyword-actions/scripted-statics";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const SOURCE_NAME = "Test Permanent Copy Source (lane 70 piece 2a)";
const TARGET_NAME = "Test Permanent Copy Target (lane 70 piece 2a)";

function makeSourceCardDef(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? SOURCE_NAME,
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

const GRIZZLY_BEARS_PERM: ScryfallCard = {
  id: "mock-grizzly-bears-70-2a",
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

function setupGame(): SetupResult {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys()) as PlayerId[];
  return { state, aliceId: playerIds[0] };
}

function putOnBattlefield(
  state: GameState,
  controllerId: PlayerId,
  cardDef: ScryfallCard,
): { state: GameState; cardId: CardInstanceId } {
  const cardId =
    `card-${cardDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
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
 * Register a permanent `become_copy` script whose `target`
 * matches an existing battlefield card's id. Re-registers so
 * the static's `target` field names the live card id.
 */
function registerPermanentCopyScript(
  targetId: string,
  sourceName: string = SOURCE_NAME,
): void {
  const script: CardScript = CardScriptSchema.parse({
    name: sourceName,
    oracle:
      "As long as this is in play, it's a copy of [chosen permanent].",
    statics: [
      {
        text:
          "As long as this is in play, it's a copy of [chosen permanent].",
        affects: { controller: "you" },
        become_copy: {
          target: targetId,
          until: "permanent",
        },
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

describe("Wave 4.8 follow-up 23 lane 70 piece 2a — permanent-copy refresh write", () => {
  afterAll(() => {
    resetCardScriptsForTests();
  });

  it("refresh pass stamps copyOfTargetIdPermanent when until: 'permanent'", () => {
    const { state, aliceId } = setupGame();
    // Source carries a permanent-copy static.
    const sourceDef = makeSourceCardDef({
      id: "perm-source-1",
      name: SOURCE_NAME,
    });
    const { state: stateWithSource, cardId: sourceId } = putOnBattlefield(
      state,
      aliceId,
      sourceDef,
    );
    // Target is also on the battlefield — Grizzly Bears
    // (caller is forcing the printed cardData for the
    // overlay source).
    const { state: stateWithTarget, cardId: targetId } = putOnBattlefield(
      stateWithSource,
      aliceId,
      GRIZZLY_BEARS_PERM,
    );
    registerPermanentCopyScript(targetId);
    // Refresh — the schema discriminator must route the
    // permanent arm through `setPermanentCopyOf`.
    const refreshed = refreshScriptedStatics(stateWithTarget);
    const source = refreshed.cards.get(sourceId);
    expect(source).toBeDefined();
    expect(source!.copyOfTargetIdPermanent).toBe(targetId);
  });

  it("permanent arm overlays the source's cardData with the target's printed characteristics (piece 2b)", () => {
    // Wave 4.8 follow-up 23 lane 70 piece 2b (#2614
    // follow-up): the refresh pass overlays the
    // source's `cardData` with the target's printed
    // name / type_line / P/T / colors / color_identity
    // / keywords (CR 707.2 "all characteristics
    // copied"). The source's printed `cardData` (the
    // version BEFORE the overlay was applied) is
    // captured in `permanentCopyPrintedCardData` for
    // the rollback path. This test exercises the
    // overlay write directly — the snapshot field, the
    // overlaid `cardData`, the ledger, and the EOT
    // ledger absence.
    const { state, aliceId } = setupGame();
    const sourceDef = makeSourceCardDef({
      id: "perm-source-2",
      name: SOURCE_NAME,
    });
    const { state: stateWithSource, cardId: sourceId } = putOnBattlefield(
      state,
      aliceId,
      sourceDef,
    );
    const { state: stateWithTarget, cardId: targetId } = putOnBattlefield(
      stateWithSource,
      aliceId,
      GRIZZLY_BEARS_PERM,
    );
    const printedName = stateWithTarget.cards.get(sourceId)!.cardData.name;
    const printedTypeLine = stateWithTarget.cards.get(sourceId)!.cardData.type_line;
    registerPermanentCopyScript(targetId);
    const refreshed = refreshScriptedStatics(stateWithTarget);
    const source = refreshed.cards.get(sourceId)!;
    // The source's `cardData` is overlaid with the
    // target's printed characteristics (Grizzly Bears).
    expect(source.cardData.name).toBe(GRIZZLY_BEARS_PERM.name);
    expect(source.cardData.type_line).toBe(GRIZZLY_BEARS_PERM.type_line);
    expect(source.cardData.power).toBe(GRIZZLY_BEARS_PERM.power);
    expect(source.cardData.toughness).toBe(GRIZZLY_BEARS_PERM.toughness);
    expect(source.cardData.colors).toEqual(GRIZZLY_BEARS_PERM.colors);
    expect(source.cardData.keywords).toEqual(GRIZZLY_BEARS_PERM.keywords);
    // The source's printed `cardData` (the version
    // BEFORE the overlay) is captured in the snapshot
    // field — the rollback reference.
    expect(source.permanentCopyPrintedCardData).toBeDefined();
    expect(source.permanentCopyPrintedCardData!.name).toBe(printedName);
    expect(source.permanentCopyPrintedCardData!.type_line).toBe(printedTypeLine);
    // The ledger is stamped (the piece 2a deliverable,
    // preserved by 2b).
    expect(source.copyOfTargetIdPermanent).toBe(targetId);
    // The EOT ledger is NOT stamped on the permanent arm
    // (regression guard: the two arms are separate).
    expect(source.copyOfTargetId).toBeUndefined();
    // `animatedUntilEndOfTurn` is the EOT path's
    // snapshot — the permanent path uses a different
    // field and never touches this one.
    expect(source.animatedUntilEndOfTurn).toBeUndefined();
  });

  it("target leaving the battlefield restores the source's printed cardData + clears the permanent overlay", () => {
    // The permanent arm in piece 2b overlays
    // `cardData` + snapshots the printed `cardData`.
    // When the target leaves the battlefield, the next
    // refresh must:
    //  - restore `cardData` from the snapshot
    //  - clear `permanentCopyPrintedCardData`
    //  - clear `copyOfTargetIdPermanent`
    // The end state is the source's untouched printed
    // `cardData` with no overlay residue.
    const { state, aliceId } = setupGame();
    const sourceDef = makeSourceCardDef({
      id: "perm-source-3",
      name: SOURCE_NAME,
    });
    const { state: stateWithSource, cardId: sourceId } = putOnBattlefield(
      state,
      aliceId,
      sourceDef,
    );
    const { state: stateWithTarget, cardId: targetId } = putOnBattlefield(
      stateWithSource,
      aliceId,
      GRIZZLY_BEARS_PERM,
    );
    const printedName = stateWithTarget.cards.get(sourceId)!.cardData.name;
    registerPermanentCopyScript(targetId);
    const refreshed = refreshScriptedStatics(stateWithTarget);
    // Sanity: the overlay is in place.
    expect(refreshed.cards.get(sourceId)!.cardData.name).toBe(GRIZZLY_BEARS_PERM.name);
    expect(refreshed.cards.get(sourceId)!.copyOfTargetIdPermanent).toBe(targetId);
    // Remove the target from `state.cards` — the next
    // refresh must restore the source's printed
    // cardData and clear both overlay fields.
    const stripped = { ...refreshed, cards: new Map(refreshed.cards) };
    stripped.cards.delete(targetId);
    const after = refreshScriptedStatics(stripped);
    const source = after.cards.get(sourceId)!;
    // `cardData` restored to the source's printed
    // values (NOT the target's overlaid values).
    expect(source.cardData.name).toBe(printedName);
    // "No field if no data" immutability convention.
    expect(source.copyOfTargetIdPermanent).toBeUndefined();
    expect("copyOfTargetIdPermanent" in source).toBe(false);
    expect(source.permanentCopyPrintedCardData).toBeUndefined();
    expect("permanentCopyPrintedCardData" in source).toBe(false);
  });

  it("EOT and permanent arms route to separate ledgers (regression guard)", () => {
    // Defensive: the schema discriminator must route
    // each arm to its own ledger. If the discriminator
    // silently fell through to the EOT write path, the
    // permanent arm would stamp `copyOfTargetId` (the
    // EOT ledger) instead of `copyOfTargetIdPermanent`.
    // The companion piece-1/N test guards the schema
    // parse; this test guards the engine routing.
    const { state, aliceId } = setupGame();
    const sourceDef = makeSourceCardDef({
      id: "perm-source-4",
      name: SOURCE_NAME,
    });
    const { state: stateWithSource, cardId: sourceId } = putOnBattlefield(
      state,
      aliceId,
      sourceDef,
    );
    const { state: stateWithTarget, cardId: targetId } = putOnBattlefield(
      stateWithSource,
      aliceId,
      GRIZZLY_BEARS_PERM,
    );
    registerPermanentCopyScript(targetId);
    const refreshed = refreshScriptedStatics(stateWithTarget);
    const source = refreshed.cards.get(sourceId)!;
    // Permanent ledger set, EOT ledger unset.
    expect(source.copyOfTargetIdPermanent).toBe(targetId);
    expect(source.copyOfTargetId).toBeUndefined();
    // No `animatedUntilEndOfTurn` snapshot on the
    // permanent path (the snapshot is the EOT path's
    // printed-cardData backup; the permanent path
    // uses `permanentCopyPrintedCardData` instead).
    expect(source.animatedUntilEndOfTurn).toBeUndefined();
    // Permanent path uses its own snapshot field, NOT
    // `animatedUntilEndOfTurn`.
    expect(source.permanentCopyPrintedCardData).toBeDefined();
  });
});
