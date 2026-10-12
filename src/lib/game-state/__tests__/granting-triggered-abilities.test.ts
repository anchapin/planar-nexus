/**
 * Wave 4.8 follow-up 3 lane 65 — granting triggered abilities to other cards
 * (#2614 follow-up)
 *
 * A new `static.grants.triggers` arm on `AuraStaticSchema` lets an Aura
 * COPY a scripted trigger onto the enchanted card. The engine stamps
 * the granted list on the enchanted card via `refreshAuraBonuses`
 * (parallels the lane 52 add_creature_type pattern: per-instance +
 * battlefield-zone-only, dropped when the source leaves the
 * battlefield). The trigger fire path (`detectTriggeredAbilities`)
 * iterates the granted list and fires each granted trigger alongside
 * the card's own scripted triggers.
 *
 * v1 supports a single `event: "dies"` arm per granted trigger (with
 * a list of effect ops). The trigger fires when the ENCHANTED CARD
 * dies, with the enchanted card's controller as the trigger's
 * controller (CR 603.2 / 603.10a). Multi-event grants and grants
 * that reference the Aura's controller are follow-up lanes.
 *
 * Sample card: a synthetic Aura registered via the test harness that
 * grants "When enchanted creature dies, draw 1 card." to its
 * enchanted target (the lane 49/52/55/59/60/62 pattern for v1
 * minimum).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { castSpell } from "../spell-casting";
import { detectTriggeredAbilities } from "../abilities/triggered";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { refreshAuraBonuses } from "../keyword-actions/aura-bonus";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import {
  getCardScript,
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { CardScriptSchema } from "../card-scripts/schema";

function makeCard(overrides: Partial<ScryfallCard> & { id: string }): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? "Test Card",
    type_line: overrides.type_line ?? "Creature",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "",
    cmc: overrides.cmc ?? 0,
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

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

function addCardToHand(
  state: GameState,
  cardData: ScryfallCard,
  owner: PlayerId,
): { state: GameState; cardId: CardInstanceId } {
  const card = createCardInstance(cardData, owner, owner);
  state.cards.set(card.id, card);
  const hand = state.zones.get(`${owner}-hand`)!;
  state.zones.set(`${owner}-hand`, {
    ...hand,
    cardIds: [...hand.cardIds, card.id],
  });
  return { state, cardId: card.id };
}

function placeOnBattlefield(
  state: GameState,
  cardData: ScryfallCard,
  controller: PlayerId,
  cardId: CardInstanceId,
): GameState {
  const card = createCardInstance(cardData, controller, controller);
  card.id = cardId;
  const zoneKey = `${controller}-battlefield`;
  const battlefield = state.zones.get(zoneKey)!;
  state.cards.set(cardId, card);
  state.zones.set(zoneKey, {
    ...battlefield,
    cardIds: [...battlefield.cardIds, cardId],
  });
  return state;
}

function mainPhaseState(state: GameState, activePlayer: PlayerId): GameState {
  return {
    ...state,
    turn: {
      ...state.turn,
      currentPhase: Phase.PRECOMBAT_MAIN,
      activePlayerId: activePlayer,
    },
    stack: [],
    priorityPlayerId: activePlayer,
  };
}

/**
 * Build a synthetic Aura script that grants a "dies" trigger to the
 * enchanted card. The Aura's oracle text mirrors "When enchanted
 * creature dies, draw a card." (a representative sample; the v1 minimum
 * is the schema arm + the engine wiring).
 */
function buildGrantingAuraScript() {
  return {
    name: "Test Granting Aura",
    oracle: "Enchant creature\nWhen enchanted creature dies, draw a card.",
    aura: {
      text: "Enchant creature",
      static: {
        text: "When enchanted creature dies, draw a card.",
        grants: {
          triggers: [
            {
              event: "dies",
              effects: [{ op: "Draw", amount: 1, who: "you" }],
            },
          ],
        },
      },
    },
  };
}

describe("Wave 4.8 follow-up 3 lane 65 — granting triggered abilities to other cards", () => {
  let grantingAura: ReturnType<typeof buildGrantingAuraScript>;

  beforeAll(() => {
    grantingAura = buildGrantingAuraScript();
    registerCardScripts([
      ...RAW_CARD_SCRIPTS,
      grantingAura as never,
    ]);
  });
  afterAll(() => {
    resetCardScriptsForTests();
  });

  // ---------------------------------------------------------------------
  // Schema: parse the new grants.triggers arm
  // ---------------------------------------------------------------------
  it("CardScriptSchema parses the new grants.triggers arm on AuraStaticSchema", () => {
    const result = CardScriptSchema.safeParse({
      name: "Synthetic Granting Aura",
      oracle: "Enchant creature\nWhen enchanted creature dies, draw a card.",
      aura: {
        text: "Enchant creature",
        static: {
          text: "When enchanted creature dies, draw a card.",
          grants: {
            triggers: [
              {
                event: "dies",
                effects: [{ op: "Draw", amount: 1, who: "you" }],
              },
            ],
          },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const aura = result.data.aura;
      expect(aura).toBeDefined();
      const grants = aura?.static?.grants;
      expect(grants?.triggers).toHaveLength(1);
      const trigger = grants?.triggers?.[0];
      expect(trigger?.event).toBe("dies");
      expect(trigger?.effects).toHaveLength(1);
      expect(trigger?.effects[0].op).toBe("Draw");
    }
  });

  it("CardScriptSchema rejects a grants.triggers with an unknown event", () => {
    const result = CardScriptSchema.safeParse({
      name: "Synthetic Invalid Grant",
      oracle: "Enchant creature",
      aura: {
        text: "Enchant creature",
        static: {
          text: "Bad grant.",
          grants: {
            triggers: [
              {
                event: "etb", // not in v1
                effects: [{ op: "Draw", amount: 1, who: "you" }],
              },
            ],
          },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("CardScriptSchema rejects an aura static that has no real arm", () => {
    const result = CardScriptSchema.safeParse({
      name: "Synthetic Empty Aura Static",
      oracle: "Enchant creature",
      aura: {
        text: "Enchant creature",
        static: {
          text: "Empty.",
          // no power, keywords, restrictions, or grants
        },
      },
    });
    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Engine: refreshAuraBonuses stamps the grantedTriggers list
  // ---------------------------------------------------------------------
  it("refreshAuraBonuses stamps the grantedTriggers list on the enchanted card", () => {
    const { state, aliceId } = setupTwoPlayerGame();
    // Place a Test Granting Aura (Alice controls).
    const auraId = "test-granting-aura-1" as CardInstanceId;
    let s = placeOnBattlefield(
      state,
      makeCard({ id: "tga-1", name: "Test Granting Aura" }),
      aliceId,
      auraId,
    );
    // Place a vanilla creature (Alice controls).
    const targetId = "test-target-1" as CardInstanceId;
    s = placeOnBattlefield(
      s,
      makeCard({
        id: "tt-1",
        name: "Test Target",
        type_line: "Creature — Human",
        colors: ["W"],
      }),
      aliceId,
      targetId,
    );
    // Mark the Aura as attached to the target.
    const aura = s.cards.get(auraId)!;
    s.cards.set(auraId, { ...aura, attachedToId: targetId });
    // Move the aura to the battlefield.
    // (Already placed above.)

    // Run the refresh pass.
    const sAfter = refreshAuraBonuses(s);
    const updatedTarget = sAfter.cards.get(targetId);
    expect(updatedTarget?.grantedTriggers).toBeDefined();
    expect(updatedTarget?.grantedTriggers).toHaveLength(1);
    const granted = updatedTarget?.grantedTriggers?.[0];
    expect(granted?.event).toBe("dies");
    expect(granted?.from).toBe(auraId);
    expect(granted?.sourceControllerId).toBe(aliceId);
    expect(granted?.effects[0].op).toBe("Draw");
  });

  it("refreshAuraBonuses clears the grantedTriggers list when the Aura leaves the battlefield", () => {
    const { state, aliceId } = setupTwoPlayerGame();
    const auraId = "test-granting-aura-2" as CardInstanceId;
    let s = placeOnBattlefield(
      state,
      makeCard({ id: "tga-2", name: "Test Granting Aura" }),
      aliceId,
      auraId,
    );
    const targetId = "test-target-2" as CardInstanceId;
    s = placeOnBattlefield(
      s,
      makeCard({
        id: "tt-2",
        name: "Test Target",
        type_line: "Creature — Human",
        colors: ["W"],
      }),
      aliceId,
      targetId,
    );
    const aura = s.cards.get(auraId)!;
    s.cards.set(auraId, { ...aura, attachedToId: targetId });
    // First pass: stamp the list.
    s = refreshAuraBonuses(s);
    expect(s.cards.get(targetId)?.grantedTriggers).toHaveLength(1);

    // Second pass: move the Aura off the battlefield.
    const battlefield = s.zones.get(`${aliceId}-battlefield`)!;
    s.zones.set(`${aliceId}-battlefield`, {
      ...battlefield,
      cardIds: battlefield.cardIds.filter((id) => id !== auraId),
    });
    const sAfter = refreshAuraBonuses(s);
    expect(sAfter.cards.get(targetId)?.grantedTriggers).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // Engine: detectTriggeredAbilities fires the granted trigger on a dies event
  // ---------------------------------------------------------------------
  it("detectTriggeredAbilities fires the granted trigger when the enchanted card dies", () => {
    const { state, aliceId } = setupTwoPlayerGame();
    const auraId = "test-granting-aura-3" as CardInstanceId;
    let s = placeOnBattlefield(
      state,
      makeCard({ id: "tga-3", name: "Test Granting Aura" }),
      aliceId,
      auraId,
    );
    const targetId = "test-target-3" as CardInstanceId;
    s = placeOnBattlefield(
      s,
      makeCard({
        id: "tt-3",
        name: "Test Target",
        type_line: "Creature — Human",
        colors: ["W"],
      }),
      aliceId,
      targetId,
    );
    const aura = s.cards.get(auraId)!;
    s.cards.set(auraId, { ...aura, attachedToId: targetId });
    s = refreshAuraBonuses(s);

    // Fire a "dies" event for the target.
    const triggered = detectTriggeredAbilities(s, "dies", {
      dyingCardId: targetId,
    });
    const grantedTrigger = triggered.find(
      (t) => t.sourceCardId === targetId && t.grantedEffects !== undefined,
    );
    expect(grantedTrigger).toBeDefined();
    expect(grantedTrigger?.grantedEffects?.[0].op).toBe("Draw");
    expect(grantedTrigger?.grantedSourceControllerId).toBe(aliceId);
  });

  it("detectTriggeredAbilities does NOT fire the granted trigger for unrelated events", () => {
    const { state, aliceId } = setupTwoPlayerGame();
    const auraId = "test-granting-aura-4" as CardInstanceId;
    let s = placeOnBattlefield(
      state,
      makeCard({ id: "tga-4", name: "Test Granting Aura" }),
      aliceId,
      auraId,
    );
    const targetId = "test-target-4" as CardInstanceId;
    s = placeOnBattlefield(
      s,
      makeCard({
        id: "tt-4",
        name: "Test Target",
        type_line: "Creature — Human",
        colors: ["W"],
      }),
      aliceId,
      targetId,
    );
    const aura = s.cards.get(auraId)!;
    s.cards.set(auraId, { ...aura, attachedToId: targetId });
    s = refreshAuraBonuses(s);

    // Fire an unrelated "landfall" event. The granted
    // trigger should NOT fire.
    const triggered = detectTriggeredAbilities(s, "landfall", {
      landControllerId: aliceId,
    });
    const grantedTrigger = triggered.find(
      (t) => t.sourceCardId === targetId && t.grantedEffects !== undefined,
    );
    expect(grantedTrigger).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // getCardScript sanity
  // ---------------------------------------------------------------------
  it("getCardScript returns the registered Test Granting Aura script", () => {
    const script = getCardScript("Test Granting Aura");
    expect(script).toBeDefined();
    expect(script?.aura?.static?.grants?.triggers).toHaveLength(1);
  });
});
