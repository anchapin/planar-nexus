/**
 * Flashback source-of-truth tests (#2594 #17)
 *
 * The schema's `flashback.cost` field was the script-side shape for the
 * keyword, but the engine's `castSpell` read the cost from
 * `parseFlashback(card.cardData.oracle_text)`. The script's value was
 * stored-but-unused. This lane makes the engine use the script's
 * `flashback.cost` first (mirroring the kicker pattern in
 * `cast.ts`).
 *
 * These tests don't go through the real cast-from-graveyard path
 * (that lives in `cast-triggers.test.ts`); they verify that the
 * engine's mana payment uses the scripted cost, not the parsed
 * oracle-text cost.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { castSpell } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { registerCardScripts } from "../card-scripts/registry";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

describe("Flashback source-of-truth (#2594 #17)", () => {
  let state: GameState;
  let p1: PlayerId;
  let cardId: CardInstanceId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Player1", "Player2"], 20, false));
    [p1] = Array.from(state.players.keys());
    state.turn.activePlayerId = p1;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = p1;
    state.stack = [];
  });

  /**
   * Think Twice: "Draw a card. Flashback {2}{U}." Printed mana cost
   * is {U}; flashback replaces it with {2}{U}. The script declares
   * the flashback cost.
   */
  it("pays the scripted flashback cost, not the printed mana cost", () => {
    const script = {
      name: "Test Think Twice",
      oracle: "Draw a card. Flashback {2}{U} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
      spell: [{ op: "Draw", amount: 1, who: "you" }],
      flashback: { cost: "{2}{U}", destinations: { on_resolution: "exile" } },
    };
    registerCardScripts([...RAW_CARD_SCRIPTS, script]);
    try {
      const card = {
        ...({
          id: "think-twice",
          name: "Test Think Twice",
          type_line: "Instant",
          oracle_text:
            "Draw a card. Flashback {2}{U} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
          mana_cost: "{U}",
          cmc: 1,
          colors: ["U"],
          color_identity: ["U"],
          keywords: [],
          legalities: { standard: "legal" },
          layout: "normal",
        } as ScryfallCard),
      };
      const inst = createCardInstance(card, p1, p1);
      cardId = inst.id;
      // Put it in the graveyard (flashback is cast from graveyard).
      {
        const cards = new Map(state.cards);
        cards.set(cardId, inst);
        state = { ...state, cards };
        const zones = new Map(state.zones);
        const gyKey = `${p1}-graveyard`;
        const gy = zones.get(gyKey)!;
        zones.set(gyKey, { ...gy, cardIds: [cardId, ...gy.cardIds] });
        state = { ...state, zones };
      }
      // Fund the flashback cost: 2 generic + 1 blue.
      state = addMana(state, p1, { generic: 2, blue: 1 });
      const before = state.players.get(p1)!.manaPool;
      const result = castSpell(state, p1, cardId, [], [], 0, false, {
        type: "flashback",
      });
      expect(result.success).toBe(true);
      // The spell is on the stack and used flashback.
      expect(result.state.stack).toHaveLength(1);
      expect(result.state.stack[0].alternativeCostsUsed).toContain(
        "flashback",
      );
      // Spent the flashback cost (2 generic + 1 blue), not the printed
      // mana cost (1 blue).
      const after = result.state.players.get(p1)!.manaPool;
      expect(before.generic - after.generic).toBe(2);
      expect(before.blue - after.blue).toBe(1);
    } finally {
      registerCardScripts(RAW_CARD_SCRIPTS);
    }
  });

  /**
   * Regression guard: a card WITHOUT a `flashback` field on its
   * script still parses from `oracle_text` and applies the cost
   * correctly. The legacy path stays open for un-scripted cards.
   */
  it("falls back to parseFlashback for cards without a script", () => {
    const card = {
      id: "legacy-flashback",
      name: "Legacy Flashback",
      type_line: "Instant",
      oracle_text:
        "Draw a card. Flashback {3}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
      mana_cost: "{R}",
      cmc: 1,
      colors: ["R"],
      color_identity: ["R"],
      keywords: [],
      legalities: { standard: "legal" },
      layout: "normal",
    } as ScryfallCard;
    const inst = createCardInstance(card, p1, p1);
    cardId = inst.id;
    {
      const cards = new Map(state.cards);
      cards.set(cardId, inst);
      state = { ...state, cards };
      const zones = new Map(state.zones);
      const gyKey = `${p1}-graveyard`;
      const gy = zones.get(gyKey)!;
      zones.set(gyKey, { ...gy, cardIds: [cardId, ...gy.cardIds] });
      state = { ...state, zones };
    }
    // No script registered for "Legacy Flashback" — the parser path
    // is the only one that can read the cost.
    state = addMana(state, p1, { generic: 3, red: 1 });
    const before = state.players.get(p1)!.manaPool;
    const result = castSpell(state, p1, cardId, [], [], 0, false, {
      type: "flashback",
    });
    expect(result.success).toBe(true);
    const after = result.state.players.get(p1)!.manaPool;
    expect(before.generic - after.generic).toBe(3);
    expect(before.red - after.red).toBe(1);
  });

  /**
   * Script override: when a card has a script, the script's
   * `flashback.cost` wins over the oracle-text parse. This is the
   * v1 limitation documented in the Wave 2 handoff — the engine
   * reads from the script, not from the card's printed text.
   */
  it("script's flashback.cost wins over the oracle-text parse", () => {
    const script = {
      name: "Override Card",
      oracle:
        "Draw a card. Flashback {99}{R} (oracle text claims {99}{R}).",
      // Script intentionally differs from the oracle text: 2U not
      // 99R. The engine should honour the script (per #2594 #17).
      spell: [{ op: "Draw", amount: 1, who: "you" }],
      flashback: { cost: "{2}{U}", destinations: { on_resolution: "exile" } },
    };
    registerCardScripts([...RAW_CARD_SCRIPTS, script]);
    try {
      const card = {
        id: "override",
        name: "Override Card",
        type_line: "Instant",
        oracle_text: "Draw a card. Flashback {99}{R} (oracle text).",
        mana_cost: "{R}",
        cmc: 1,
        colors: ["R"],
        color_identity: ["R"],
        keywords: [],
        legalities: { standard: "legal" },
        layout: "normal",
      } as ScryfallCard;
      const inst = createCardInstance(card, p1, p1);
      cardId = inst.id;
      {
        const cards = new Map(state.cards);
        cards.set(cardId, inst);
        state = { ...state, cards };
        const zones = new Map(state.zones);
        const gyKey = `${p1}-graveyard`;
        const gy = zones.get(gyKey)!;
        zones.set(gyKey, { ...gy, cardIds: [cardId, ...gy.cardIds] });
        state = { ...state, zones };
      }
      state = addMana(state, p1, { generic: 2, blue: 1, red: 99 });
      const before = state.players.get(p1)!.manaPool;
      const result = castSpell(state, p1, cardId, [], [], 0, false, {
        type: "flashback",
      });
      expect(result.success).toBe(true);
      const after = result.state.players.get(p1)!.manaPool;
      // Paid 2 generic + 1 blue (the script's cost), not 99 red.
      expect(before.generic - after.generic).toBe(2);
      expect(before.blue - after.blue).toBe(1);
      // The 99 red mana was untouched (the script cost didn't use it).
      expect(after.red).toBe(before.red);
    } finally {
      registerCardScripts(RAW_CARD_SCRIPTS);
    }
  });
});
