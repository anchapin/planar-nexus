/**
 * Heraldic Banner — chosen-color AddMana (Wave 4.7 lane 41, #2594
 * follow-up, CR 605.1a).
 *
 * "{T}: Add one mana of the chosen color." v1 ships the activated
 * mana half on top of the lane 40 anthem: the `AddManaSchema.colors`
 * enum grows a `"chosen"` sentinel, and the engine's activated-ability
 * mana path (`abilities/activated.ts` → `parseManaFromEffect` via
 * `substituteChosenColorInEffect` in `abilities/mana.ts`) substitutes
 * `source.chosenColor` into the effect text and parses the literal
 * mana symbol.
 *
 * If the source has no `chosenColor` (the enter choice hasn't
 * resolved) the substitution is a no-op and the ability produces
 * no mana — the activation succeeds but `parseManaFromEffect`
 * returns an empty pool. The engine surfaces a "Activated" success
 * description (no error); the UI is expected to surface a soft
 * error so the player can re-prompt or skip.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
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
import { getCardScript } from "../card-scripts/registry";
import { activateAbility } from "../abilities/activated";
import { resolveEnterChoice } from "../keyword-actions/enter-choice";
import {
  parseManaFromEffect,
  substituteChosenColorInEffect,
} from "../abilities/mana";

const HERALDIC_BANNER_ORACLE =
  "As Heraldic Banner enters, choose a color. Creatures you control of the chosen color get +1/+1. {T}: Add one mana of the chosen color.";

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

const heraldicBanner = card({
  name: "Heraldic Banner",
  oracle_text: HERALDIC_BANNER_ORACLE,
});

function put(
  state: GameState,
  playerId: PlayerId,
  zone: "hand" | "battlefield",
  data: ScryfallCard,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId);
  state.cards.set(c.id, { ...c, hasSummoningSickness: false });
  const key = `${playerId}-${zone}`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

function enterChoiceFor(
  cardId: CardInstanceId,
  playerId: PlayerId,
): import("../types").WaitingChoice {
  return {
    type: "enter_choice",
    playerId,
    stackObjectId: cardId,
    prompt: "As Heraldic Banner enters, choose a color.",
    choices: ["W", "U", "B", "R", "G"].map((v) => ({
      label: v,
      value: v,
      isValid: true,
    })),
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

const pool = (s: GameState, playerId: PlayerId) =>
  s.players.get(playerId)!.manaPool;

describe("Heraldic Banner — chosen-color AddMana (Wave 4.7 lane 41)", () => {
  let state: GameState;
  let alice: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
  });

  it("registers the AddMana + chosen sentinel on the script", () => {
    const script = getCardScript("Heraldic Banner");
    expect(script).toBeDefined();
    const act = script!.activated?.[0];
    expect(act).toBeDefined();
    const eff = (act as { effects?: Array<{ colors?: unknown }> })
      .effects?.[0];
    expect(eff?.colors).toEqual(["chosen"]);
  });

  it("substituteChosenColorInEffect no-ops without chosenColor", () => {
    const banner = put(state, alice, "battlefield", heraldicBanner);
    const cardInstance = state.cards.get(banner)!;
    const substituted = substituteChosenColorInEffect(
      "{T}: Add one mana of the chosen color.",
      cardInstance,
    );
    // chosenColor is null → no replacement.
    expect(substituted).toBe("{T}: Add one mana of the chosen color.");
  });

  it("substituteChosenColorInEffect swaps in the chosen letter", () => {
    const banner = put(state, alice, "battlefield", heraldicBanner);
    const cardInstance = state.cards.get(banner)!;
    const updated = {
      ...cardInstance,
      chosenColor: "W" as const,
    };
    const substituted = substituteChosenColorInEffect(
      "{T}: Add one mana of the chosen color.",
      updated,
    );
    expect(substituted).toBe("{T}: Add one mana of {W}.");
    const parsed = parseManaFromEffect(substituted);
    expect(parsed).toEqual({ white: 1 });
  });

  it("activating the Banner before any chosen color produces no mana", () => {
    const banner = put(state, alice, "battlefield", heraldicBanner);
    // Without a chosenColor, the effect text is unchanged → parser
    // sees no `{X}` symbol → empty pool. The activation still
    // succeeds (the engine returns the ability as "no mana
    // produced").
    const r = activateAbility(state, alice, banner, 0);
    expect(r.success).toBe(true);
    expect(pool(r.state, alice).white).toBe(0);
    expect(pool(r.state, alice).red).toBe(0);
  });

  it("activating the Banner after choosing W produces {W}", () => {
    const banner = put(state, alice, "battlefield", heraldicBanner);
    const withChoice = {
      ...state,
      waitingChoice: enterChoiceFor(banner, alice),
    };
    const enter = resolveEnterChoice(withChoice, alice, "W");
    expect(enter.success).toBe(true);
    const afterEnter = enter.state;
    const r = activateAbility(afterEnter, alice, banner, 0);
    expect(r.success).toBe(true);
    expect(pool(r.state, alice).white).toBe(1);
  });

  it("activating the Banner after choosing R produces {R}", () => {
    const banner = put(state, alice, "battlefield", heraldicBanner);
    const withChoice = {
      ...state,
      waitingChoice: enterChoiceFor(banner, alice),
    };
    const enter = resolveEnterChoice(withChoice, alice, "R");
    expect(enter.success).toBe(true);
    const afterEnter = enter.state;
    const r = activateAbility(afterEnter, alice, banner, 0);
    expect(r.success).toBe(true);
    expect(pool(r.state, alice).red).toBe(1);
    expect(pool(r.state, alice).white).toBe(0);
  });

  it("tapping the Banner to add {W} does not affect the anthem (Banner is still on the battlefield)", () => {
    const banner = put(state, alice, "battlefield", heraldicBanner);
    const withChoice = {
      ...state,
      waitingChoice: enterChoiceFor(banner, alice),
    };
    const enter = resolveEnterChoice(withChoice, alice, "W");
    let s = enter.state;
    s = addMana(s, alice, { generic: 4 });
    const r = activateAbility(s, alice, banner, 0);
    expect(r.success).toBe(true);
    expect(r.state.cards.get(banner)?.isTapped).toBe(true);
    // Banner is tapped but still on the battlefield — anthem still
    // active in principle (the anthem doesn't read isTapped).
    expect(
      r.state.zones.get(`${alice}-battlefield`)!.cardIds,
    ).toContain(banner);
  });
});
