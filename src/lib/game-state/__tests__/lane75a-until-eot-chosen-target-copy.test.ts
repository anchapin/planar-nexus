/**
 * Wave 4.8 follow-up 8 lane 75a — "Until end of turn" chosen-
 * target copy spell (`CopyUntilEndOfTurn` op on
 * `EffectSchema`, #2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of cards that
 * create a new permanent whose characteristics are copied from
 * a chosen target for the duration of a turn: Cackling
 * Counterpart ("create a token that's a copy of [a chosen
 * creature] until end of turn"), Quasiduplicate, the
 * manifested-as-clone family. The v1 minimum adds a
 * `copyUntilEndOfTurn: { chosen_permanent: CardInstanceId,
 * until: "end_of_turn" }` op on `EffectSchema` (the
 * spell-effect-shaped counterpart of lane 75's
 * `StaticSchema.become_copy` static). The engine creates a new
 * `CardInstance` whose printed `cardData` is the chosen
 * permanent's printed characteristics (name, type_line, power,
 * toughness, colors, color_identity, keywords — "all
 * characteristics copied" / CR 707.2) and stamps the new
 * permanent's `animatedUntilEndOfTurn` (carrying the spell's
 * printed `cardData`) + `copyOfTargetId` ledger so the existing
 * lane 75 rollback paths (`clearUntilEndOfTurnPT` /
 * `restoreAnimatedOffBattlefield`) restore the printed
 * characteristics at end of turn / when the chosen target or
 * the new permanent leaves the battlefield.
 *
 * Schema (card-scripts/schema.ts, EffectSchema):
 *   `CopyUntilEndOfTurnSchema = { op: "CopyUntilEndOfTurn",
 *    chosen_permanent: string, until: "end_of_turn" }` —
 *    v1 minimum is a single chosen target on the battlefield,
 *    the chosen target must still be on the battlefield at
 *    resolution time, and the chosen target itself is
 *    unchanged.
 *
 * Engine (card-scripts/interpret.ts#applyEffect):
 *   `case "CopyUntilEndOfTurn"` validates the chosen target is
 *   on the battlefield (`state.cards.has(chosenId)` + the
 *   zone key's `-battlefield` suffix), creates a new
 *   `CardInstance` with the chosen target's printed
 *   characteristics (parallel to lane 70's `CopyPermanent`
 *   stamping, but the new permanent carries
 *   `animatedUntilEndOfTurn.cardData = printed` and
 *   `copyOfTargetId = chosenId` for EOT rollback), and adds
 *   the new permanent to the controller's battlefield. If the
 *   chosen target has left the battlefield at resolution time,
 *   the spell fizzles (no token is created).
 *
 * Test harness pattern: synthetic card script registered via
 * `CardScriptSchema.parse + registerCardScripts` (the lane
 * 49/52/55/59/60/62/63/64/65/66/67/68/69/70/71/72/73/74/75/76
 * pattern). The test casts the spell via the engine's
 * `castSpell` + `resolveTopOfStack` pipeline, targets the
 * chosen permanent by hand-stamping `chosen_permanent` with
 * the live `CardInstanceId`, and verifies the controller's
 * new permanent carries the chosen target's printed
 * characteristics while the spell's printed characteristics
 * are preserved under `animatedUntilEndOfTurn.cardData`.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import {
  CardScriptSchema,
  type CardEffect,
  type CardScript,
} from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { castSpell } from "../spell-casting/cast";
import { resolveTopOfStack } from "../spell-casting/resolve";
import { clearUntilEndOfTurnPT } from "../pt-until-end-of-turn";
import { refreshScriptedStatics } from "../keyword-actions/scripted-statics";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test Until-EOT Chosen-Target Copy (lane 75a)";

/**
 * The `CopyUntilEndOfTurn` effect — `chosen_permanent` is a
 * `CardInstanceId` resolved at cast time (the engine validates
 * the target is on the battlefield). v1 single chosen target,
 * "until end of turn" duration.
 */
const COPY_UNTIL_EOT_EFFECT: CardEffect = {
  op: "CopyUntilEndOfTurn",
  chosen_permanent: "PLACEHOLDER", // Re-stamped with the live id at cast time
  until: "end_of_turn",
};

function makeSpellCard(
  overrides: Partial<ScryfallCard> & { id: string; name?: string },
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
  id: "mock-grizzly-bears-75a",
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
  id: "mock-serra-angel-75a",
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
 * Re-registers a host script whose `copyUntilEndOfTurn`
 * effect stamps the live `chosen_permanent` CardInstanceId.
 * The schema's `chosen_permanent` field is a `string` (the
 * `CardInstanceId` of the chosen target); the engine
 * validates the target is on the battlefield at resolution
 * time.
 */
function registerCopyUntilEotScript(chosenId: CardInstanceId): void {
  const script: CardScript = CardScriptSchema.parse({
    name: HOST_NAME,
    oracle:
      "Create a token that's a copy of [chosen permanent] until end of turn.",
    spell: [
      {
        op: "CopyUntilEndOfTurn",
        chosen_permanent: chosenId as string,
        until: "end_of_turn",
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

/**
 * Adds a copy-until-EOT spell to Alice's hand and casts it.
 * The engine creates a new permanent on Alice's battlefield
 * whose cardData is the chosen target's printed
 * characteristics.
 */
function castCopyUntilEotSpell(
  state: GameState,
  aliceId: PlayerId,
  chosenId: CardInstanceId,
): { state: GameState; spellCardId: CardInstanceId; newCopyId?: CardInstanceId } {
  registerCopyUntilEotScript(chosenId);
  const spellCardDef = makeSpellCard({ id: "copy-until-eot-spell-75a" });
  const spellCardId = `card-host-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const spellCard = createCardInstance(
    spellCardDef,
    aliceId,
    aliceId,
    {
      id: spellCardId,
      currentZoneKey: `${aliceId}-hand`,
    },
  );
  let s: GameState = {
    ...state,
    cards: new Map(state.cards).set(spellCardId, spellCard),
    zones: new Map(state.zones).set(`${aliceId}-hand`, {
      ...state.zones.get(`${aliceId}-hand`)!,
      cardIds: [
        ...(state.zones.get(`${aliceId}-hand`)!.cardIds ?? []),
        spellCardId,
      ],
    }),
    turn: {
      ...state.turn,
      activePlayerId: aliceId,
      currentPhase: Phase.PRECOMBAT_MAIN,
    },
    priorityPlayerId: aliceId,
    stack: [],
    status: "in_progress",
    lastModifiedAt: Date.now(),
  };
  s = addMana(s, aliceId, { blue: 4 });
  const cast = castSpell(s, aliceId, spellCardId);
  if (!cast.success) throw new Error(`cast failed: ${cast.error}`);
  const post = resolveTopOfStack(cast.state);
  // Locate the new copy on Alice's battlefield (the spell
  // creates a new CardInstance; pick the one whose
  // copyOfTargetId === chosenId).
  const bfKey = `${aliceId}-battlefield`;
  const bf = post.zones.get(bfKey);
  let newCopyId: CardInstanceId | undefined;
  if (bf) {
    for (const id of bf.cardIds) {
      if (id === spellCardId) continue;
      const inst = post.cards.get(id);
      if (inst?.copyOfTargetId === (chosenId as string)) {
        newCopyId = id;
        break;
      }
    }
  }
  return { state: post, spellCardId, newCopyId };
}

describe("Wave 4.8 follow-up 8 lane 75a — until-EOT chosen-target copy op", () => {
  afterAll(() => {
    resetCardScriptsForTests();
  });

  it("rejects a script with an empty chosen_permanent id", () => {
    // Schema guard: chosen_permanent must be at least 1 character.
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad chosen_permanent id (lane 75a)",
        oracle: "test",
        spell: [
          {
            op: "CopyUntilEndOfTurn",
            chosen_permanent: "",
            until: "end_of_turn",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects a script with a non-end_of_turn duration", () => {
    // Schema guard: `until` must be the v1 literal `"end_of_turn"`.
    // Permanent copies (no duration) are a follow-up lane.
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad CopyUntilEndOfTurn until (lane 75a)",
        oracle: "test",
        spell: [
          {
            op: "CopyUntilEndOfTurn",
            chosen_permanent: "x",
            until: "indefinite",
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts the v1 CopyUntilEndOfTurn schema (chosen_permanent + end_of_turn)", () => {
    // Sanity check: the script parses and the effect carries
    // the chosen-permanent + until arm.
    const parsed = CardScriptSchema.parse({
      name: HOST_NAME,
      oracle:
        "Create a token that's a copy of [chosen permanent] until end of turn.",
      spell: [
        {
          op: "CopyUntilEndOfTurn",
          chosen_permanent: "x",
          until: "end_of_turn",
        },
      ],
    });
    expect(parsed.spell?.[0]?.op).toBe("CopyUntilEndOfTurn");
    expect(
      (parsed.spell?.[0] as { chosen_permanent: string }).chosen_permanent,
    ).toBe("x");
  });

  it("overlays the chosen target's characteristics onto the new permanent at cast time", () => {
    // Setup: Alice has a 2/2 Grizzly Bears on the
    // battlefield. Alice casts the `CopyUntilEndOfTurn`
    // spell targeting the Grizzly Bears. After resolution,
    // Alice's battlefield contains a new permanent whose
    // name, type_line, P/T, colors, and keywords mirror the
    // Grizzly Bears's printed characteristics.
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withTarget, cardId: targetId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    const { state: resolved, newCopyId } = castCopyUntilEotSpell(
      withTarget,
      aliceId,
      targetId,
    );
    expect(newCopyId).toBeDefined();
    const copy = resolved.cards.get(newCopyId!);
    expect(copy).toBeDefined();
    // The new permanent's cardData mirrors the chosen
    // target's printed characteristics.
    expect(copy?.cardData.name).toBe("Grizzly Bears");
    expect(copy?.cardData.type_line).toBe("Creature — Bear");
    expect(copy?.cardData.power).toBe("2");
    expect(copy?.cardData.toughness).toBe("2");
    expect(copy?.cardData.colors).toEqual(["G"]);
    expect(copy?.cardData.color_identity).toEqual(["G"]);
    // The lane 75 ledger is set so the EOT rollback restores
    // the spell's printed characteristics.
    expect(copy?.copyOfTargetId).toBe(targetId as string);
    expect(copy?.animatedUntilEndOfTurn?.cardData.name).toBe(HOST_NAME);
    // The chosen target itself is unchanged.
    const target = resolved.cards.get(targetId);
    expect(target?.cardData.name).toBe("Grizzly Bears");
  });

  it("copies keywords from the chosen target (Serra Angel flying + vigilance)", () => {
    // Setup: Alice has a 4/4 Serra Angel with the keywords
    // "flying" and "vigilance" on the battlefield. Alice
    // casts the spell targeting the Serra Angel. The new
    // permanent's keyword list mirrors the Serra Angel's
    // printed keywords.
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withTarget, cardId: targetId } = putOnBattlefield(
      state,
      aliceId,
      SERRA_ANGEL,
    );
    const { state: resolved, newCopyId } = castCopyUntilEotSpell(
      withTarget,
      aliceId,
      targetId,
    );
    expect(newCopyId).toBeDefined();
    const copy = resolved.cards.get(newCopyId!);
    expect(copy?.cardData.name).toBe("Serra Angel");
    expect(copy?.cardData.power).toBe("4");
    expect(copy?.cardData.toughness).toBe("4");
    expect(copy?.cardData.keywords).toEqual(["flying", "vigilance"]);
  });

  it("fizzles when the chosen target is not on the battlefield at resolution time", () => {
    // Setup: targetId points to a card that isn't on any
    // zone. The engine sees `state.cards.has(chosenId)` is
    // false and the spell fizzles — no token is created on
    // Alice's battlefield (other than the spell already-
    // present cards).
    const { state, aliceId } = setupTwoPlayerGame();
    const ghostId =
      `card-ghost-${Math.random().toString(36).slice(2)}` as CardInstanceId;
    const { state: resolved } = castCopyUntilEotSpell(
      state,
      aliceId,
      ghostId,
    );
    const bfKey = `${aliceId}-battlefield`;
    const bf = resolved.zones.get(bfKey);
    // The new copy is NOT placed on the battlefield. Only
    // whatever was already there (the empty initial state
    // has no battlefield cards) remains.
    const foundCopy = bf?.cardIds.some((id) => {
      const inst = resolved.cards.get(id);
      return inst?.copyOfTargetId === (ghostId as string);
    });
    expect(foundCopy).toBeFalsy();
  });

  it("restores the printed cardData via clearUntilEndOfTurnPT (EOT rollback)", () => {
    // The new permanent carries `animatedUntilEndOfTurn`
    // with the SPELL's printed `cardData`. The existing
    // `clearUntilEndOfTurnPT` EOT-rollback path restores
    // those printed characteristics (parallel to lane 75's
    // copy-static rollback). After the rollback, the new
    // permanent's live `cardData` carries the spell's
    // printed name ("Clone Until EOT"), its
    // `animatedUntilEndOfTurn` is cleared, and its
    // `copyOfTargetId` ledger is dropped.
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withTarget, cardId: targetId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    const { state: resolved, newCopyId } = castCopyUntilEotSpell(
      withTarget,
      aliceId,
      targetId,
    );
    expect(newCopyId).toBeDefined();
    // Before the rollback, the new permanent carries the
    // chosen target's characteristics.
    let copy = resolved.cards.get(newCopyId!);
    expect(copy?.cardData.name).toBe("Grizzly Bears");
    const rolledBack = clearUntilEndOfTurnPT(resolved);
    copy = rolledBack.cards.get(newCopyId!);
    // After `clearUntilEndOfTurnPT`, the new permanent
    // restores its spell-printed characteristics. The
    // `animatedUntilEndOfTurn` snapshot is cleared; the
    // `copyOfTargetId` ledger is left intact (lane 75's
    // EOT-cleanup test takes the same shape — the
    // ledger is informational, the live `cardData` is
    // what reads).
    expect(copy?.cardData.name).toBe(HOST_NAME);
    expect(copy?.animatedUntilEndOfTurn).toBeUndefined();
  });

  it("refresh pass keeps the overlay consistent (interactive refresh)", () => {
    // Setup: place the new permanent on the battlefield.
    // Call `refreshScriptedStatics` (the engine's
    // scripted-statics refresh pass). Since lane 75a's
    // effect stamps `animatedUntilEndOfTurn` +
    // `copyOfTargetId` directly (without going through the
    // static-collection path), the refresh pass should not
    // disturb the overlay. The new permanent still carries
    // the chosen target's characteristics after the refresh.
    const { state, aliceId } = setupTwoPlayerGame();
    const { state: withTarget, cardId: targetId } = putOnBattlefield(
      state,
      aliceId,
      GRIZZLY_BEARS,
    );
    const { state: resolved, newCopyId } = castCopyUntilEotSpell(
      withTarget,
      aliceId,
      targetId,
    );
    expect(newCopyId).toBeDefined();
    const refreshed = refreshScriptedStatics(resolved);
    const copy = refreshed.cards.get(newCopyId!);
    expect(copy?.cardData.name).toBe("Grizzly Bears");
    expect(copy?.cardData.power).toBe("2");
    expect(copy?.cardData.toughness).toBe("2");
    // The overlay ledger survives a refresh pass.
    expect(copy?.copyOfTargetId).toBe(targetId as string);
  });
});
