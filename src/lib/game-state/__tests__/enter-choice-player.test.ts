/**
 * chosen `player` enter_choice engine arm (issue #2939).
 *
 * The `kind: "player"` arm is the "as this enters, choose a
 * player" pattern (the True-Name Nemesis pattern). It surfaces
 * an `enter_choice` `waitingChoice` whose options are the LIVE
 * player ids of the players who have not lost (the controller
 * included — the pick is NOT opponents-only), and
 * `resolveEnterChoice` stamps `card.chosenPlayer`.
 *
 * The arm is a BARE engine arm: no downstream static reads
 * `chosenPlayer` yet (a "protection from the chosen player"
 * consumer is a separate lane), so the tests here pin the
 * engine surface (choice creation, valid stamp, invalid pick)
 * and nothing else.
 *
 * Sample-card rationale: no real card ships the bare arm (every
 * "choose a player" card pairs the choice with a downstream
 * effect), so the engine arm is exercised in isolation with a
 * synthetic script installed through the registry helper — the
 * same pattern as `enter-choice-creature-type.test.ts` (lane 44)
 * and `enter-choice-dual.test.ts` (lane 56).
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  WaitingChoice,
} from "../types";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import {
  createEnterChoiceWaitingChoice,
  enterChoiceOptionsForKind,
  hasEnterChoice,
  resolveEnterChoice,
} from "../keyword-actions/enter-choice";
import { fireEntersTriggers } from "../keyword-actions/enters";

const STUB_NAME = "Test Player Goggles";

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Artifact",
    oracle_text: "",
    mana_cost: "{3}",
    cmc: 3,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

const stubCard = card({
  name: STUB_NAME,
  oracle_text: "As Test Player Goggles enters, choose a player.",
  type_line: "Artifact",
});

function installSyntheticScript(): void {
  resetCardScriptsForTests();
  registerCardScripts([
    {
      name: STUB_NAME,
      oracle: stubCard.oracle_text,
      enter_choice: {
        kind: "player",
        text: `As ${STUB_NAME} enters, choose a player.`,
      },
    },
  ]);
}

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

/** Flag `playerId` as having lost the game (live-state edit). */
function markLost(state: GameState, playerId: PlayerId): GameState {
  const players = new Map(state.players);
  const player = players.get(playerId);
  if (!player) throw new Error(`unknown player ${playerId}`);
  players.set(playerId, { ...player, hasLost: true });
  return { ...state, players };
}

describe("chosen `player` enter_choice engine arm (issue #2939)", () => {
  let state: GameState;
  let alice: PlayerId;
  let bob: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice, bob] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { generic: 4 });
  });

  afterEach(() => {
    // Tear down the synthetic script so other tests aren't
    // affected.
    resetCardScriptsForTests();
  });

  it("hasEnterChoice returns true for the player kind", () => {
    installSyntheticScript();
    const cardId = put(state, alice, "battlefield", stubCard);
    expect(hasEnterChoice(state.cards.get(cardId)!)).toBe(true);
  });

  it("enterChoiceOptionsForKind lists every player who has not lost", () => {
    expect(enterChoiceOptionsForKind("player", state)).toEqual([alice, bob]);
  });

  it("enterChoiceOptionsForKind drops the players who have lost", () => {
    const afterLoss = markLost(state, bob);
    expect(enterChoiceOptionsForKind("player", afterLoss)).toEqual([alice]);
  });

  it("enterChoiceOptionsForKind returns no options without a state (the live player set is unknowable)", () => {
    expect(enterChoiceOptionsForKind("player")).toEqual([]);
  });

  it("createEnterChoiceWaitingChoice surfaces the live player ids as the options", () => {
    installSyntheticScript();
    const cardId = put(state, alice, "battlefield", stubCard);
    const choice = createEnterChoiceWaitingChoice(state, cardId);
    expect(choice).not.toBeNull();
    expect(choice!.type).toBe("enter_choice");
    expect(choice!.playerId).toBe(alice);
    expect(choice!.choices.map((c) => String(c.value))).toEqual([alice, bob]);
    expect(choice!.minChoices).toBe(1);
    expect(choice!.maxChoices).toBe(1);
    expect(choice!.prompt).toBe(`As ${STUB_NAME} enters, choose a player.`);
  });

  it("createEnterChoiceWaitingChoice omits a player who has lost", () => {
    installSyntheticScript();
    const cardId = put(state, alice, "battlefield", stubCard);
    const afterLoss = markLost(state, bob);
    const choice = createEnterChoiceWaitingChoice(afterLoss, cardId);
    expect(choice).not.toBeNull();
    expect(choice!.choices.map((c) => String(c.value))).toEqual([alice]);
  });

  it("resolveEnterChoice stamps chosenPlayer for a valid pick", () => {
    installSyntheticScript();
    const cardId = put(state, alice, "battlefield", stubCard);
    const choice = createEnterChoiceWaitingChoice(state, cardId)!;
    state = { ...state, waitingChoice: choice };
    const r = resolveEnterChoice(state, alice, bob);
    expect(r.success).toBe(true);
    expect(r.state.cards.get(cardId)?.chosenPlayer).toBe(bob);
    // The parallel chosen* fields are untouched (separate kinds).
    expect(r.state.cards.get(cardId)?.chosenColor).toBeNull();
    expect(r.state.cards.get(cardId)?.chosenCreatureType).toBeNull();
    expect(r.state.waitingChoice).toBeNull();
  });

  it("resolveEnterChoice accepts the controller as the pick (choose a player, not choose an opponent)", () => {
    installSyntheticScript();
    const cardId = put(state, alice, "battlefield", stubCard);
    const choice = createEnterChoiceWaitingChoice(state, cardId)!;
    state = { ...state, waitingChoice: choice };
    const r = resolveEnterChoice(state, alice, alice);
    expect(r.success).toBe(true);
    expect(r.state.cards.get(cardId)?.chosenPlayer).toBe(alice);
  });

  it("resolveEnterChoice rejects an unknown player id", () => {
    installSyntheticScript();
    const cardId = put(state, alice, "battlefield", stubCard);
    const choice = createEnterChoiceWaitingChoice(state, cardId)!;
    state = { ...state, waitingChoice: choice };
    const r = resolveEnterChoice(state, alice, "player-does-not-exist");
    expect(r.success).toBe(false);
    expect(r.description).toMatch(/invalid/i);
    expect(r.state.cards.get(cardId)?.chosenPlayer).toBeNull();
  });

  it("resolveEnterChoice rejects a player who lost after the choice was surfaced (live re-validation)", () => {
    installSyntheticScript();
    const cardId = put(state, alice, "battlefield", stubCard);
    const choice = createEnterChoiceWaitingChoice(state, cardId)!;
    // The option list still lists Bob — he lost AFTER the choice
    // was surfaced, so the resolver must re-check `hasLost`
    // against the live state instead of trusting the list.
    expect(choice.choices.map((c) => String(c.value))).toContain(bob);
    const afterLoss = { ...state, waitingChoice: choice };
    const lost = markLost(afterLoss, bob);
    const r = resolveEnterChoice(lost, alice, bob);
    expect(r.success).toBe(false);
    expect(r.description).toMatch(/invalid/i);
    expect(r.state.cards.get(cardId)?.chosenPlayer).toBeNull();
  });

  it("the new chosenPlayer field defaults to null on freshly-created instances", () => {
    installSyntheticScript();
    const cardId = put(state, alice, "battlefield", stubCard);
    expect(state.cards.get(cardId)?.chosenPlayer).toBeNull();
  });

  it("resolveCardIdForChoice fallback matches a player card by chosenPlayer === null", () => {
    installSyntheticScript();
    const aId = put(state, alice, "battlefield", stubCard);
    const bId = put(state, alice, "battlefield", stubCard);
    const choice: WaitingChoice = {
      type: "enter_choice",
      playerId: alice,
      stackObjectId: null,
      prompt: `As ${STUB_NAME} enters, choose a player.`,
      choices: [alice, bob].map((pid) => ({
        label: pid,
        value: pid,
        isValid: true,
      })),
      minChoices: 1,
      maxChoices: 1,
      presentedAt: Date.now(),
    };
    // Pre-resolve the second card to show the fallback only finds
    // the unresolved one.
    const first: GameState = {
      ...state,
      waitingChoice: choice,
      cards: new Map(state.cards).set(bId, {
        ...state.cards.get(bId)!,
        chosenPlayer: bob,
      }),
    };
    const r = resolveEnterChoice(first, alice, bob);
    expect(r.success).toBe(true);
    // The unresolved card wins the fallback.
    expect(r.state.cards.get(aId)?.chosenPlayer).toBe(bob);
    expect(r.state.cards.get(bId)?.chosenPlayer).toBe(bob);
  });

  it("the bare arm works end-to-end: ETB surfaces the choice, the pick stamps chosenPlayer", () => {
    installSyntheticScript();
    const cardId = put(state, alice, "battlefield", stubCard);
    const after = fireEntersTriggers(state, cardId);
    expect(after.waitingChoice).not.toBeNull();
    expect(after.waitingChoice!.type).toBe("enter_choice");
    expect(after.waitingChoice!.playerId).toBe(alice);
    expect(after.waitingChoice!.choices.map((c) => String(c.value))).toEqual([
      alice,
      bob,
    ]);
    const r = resolveEnterChoice(after, alice, bob);
    expect(r.success).toBe(true);
    expect(r.state.cards.get(cardId)?.chosenPlayer).toBe(bob);
    expect(r.state.waitingChoice).toBeNull();
  });
});
