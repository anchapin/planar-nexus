/**
 * "Exile the top card of each player's library" tests (#2594
 * follow-up, lane 16)
 *
 * The drafter has 1 FDN card wanting this — Etali, Primal Storm
 * (FDN #136, "Whenever this creature attacks, exile the top card
 * of each player's library."). The current `Exile` op supports
 * single-card and graveyard sweeps; this lane extends
 * `ExileSchema.fromZone` with `"library_top"` and threads the
 * engine's `effectTargetLegal` / `applyEffect` to iterate every
 * player's library and exile the top card of each.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveScriptedSpell } from "../card-scripts/interpret";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

function makeCard(name: string): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature",
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

/**
 * Push a real card id into the player's library zone. Real card
 * instances (in `state.cards`) are required for `exileCard` to
 * succeed (default library cards are virtual and silently fail to
 * move). Each id appears once at the END of the library array (the
 * "top" — drawn first).
 */
function placeInLibrary(
  state: GameState,
  card: ScryfallCard,
  owner: PlayerId,
  cardId: CardInstanceId,
  atTop: boolean,
): GameState {
  const zoneKey = `${owner}-library`;
  // exileCard uses `card.controllerId` to find the destination
  // exile zone, so we create a real CardInstance whose controller
  // matches the library's owner.
  const inst = createCardInstance(card, owner, owner, {
    id: cardId,
    currentZoneKey: zoneKey,
  });
  const cards = new Map(state.cards).set(cardId, inst);
  const existing = state.zones.get(zoneKey);
  if (!existing) return state;
  // The engine draws from the END of the cardIds array (top of
  // library = last index).
  const newIds = atTop
    ? [...existing.cardIds, cardId]
    : [cardId, ...existing.cardIds];
  const zones = new Map(state.zones);
  zones.set(zoneKey, { ...existing, cardIds: newIds });
  return { ...state, cards, zones };
}

describe('Exile the top card of each library (#2594 follow-up, lane 16)', () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state.turn.activePlayerId = p1;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  });

  it("Etali script declares Exile with fromZone: library_top", () => {
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const fixture = JSON.parse(
      readFileSync(
        join(cardsDir, "etali_primal_storm.json"),
        "utf8",
      ),
    ) as {
      name: string;
      triggers: {
        effects: {
          op: string;
          target: string;
          fromZone?: string;
        }[];
      }[];
    };
    expect(fixture.name).toBe("Etali, Primal Storm");
    const exile = fixture.triggers[0].effects[0];
    expect(exile.op).toBe("Exile");
    expect(exile.fromZone).toBe("library_top");
  });

  it("library_top sweep exiles the top card of each player's library", () => {
    // Put one real card on top of each library. Other virtual
    // cards stay in the library (untouched because they're not
    // CardInstances — exileCard requires the card to exist).
    let s = placeInLibrary(state, makeCard("Bear"), p1, "p1-bear", true);
    s = placeInLibrary(s, makeCard("Bird"), p2, "p2-bird", true);

    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Etali",
        oracle: "Exile the top card of each player's library.",
        spell: [
          {
            op: "Exile",
            target: "creature",
            fromZone: "library_top",
          },
        ],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    // p1's top card is exiled.
    expect(result.zones.get(`${p1}-exile`)!.cardIds).toContain("p1-bear");
    expect(result.zones.get(`${p1}-library`)!.cardIds).not.toContain(
      "p1-bear",
    );
    // p2's top card is exiled.
    expect(result.zones.get(`${p2}-exile`)!.cardIds).toContain("p2-bird");
    expect(result.zones.get(`${p2}-library`)!.cardIds).not.toContain(
      "p2-bird",
    );
  });

  it("library_top sweep on a single-player game still works", () => {
    // Edge case: only the controller has a real card on top.
    const s = placeInLibrary(state, makeCard("Bear"), p1, "p1-bear", true);

    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Etali (solo)",
        oracle: "Exile the top card of each player's library.",
        spell: [
          {
            op: "Exile",
            target: "creature",
            fromZone: "library_top",
          },
        ],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    expect(result.zones.get(`${p1}-exile`)!.cardIds).toContain("p1-bear");
  });

  it("library_top sweep with no real cards is a graceful no-op", () => {
    // No real CardInstance cards on top of any library (the
    // default virtual library cards are listed but not in
    // state.cards). exileCard fails silently for them — the engine
    // flow completes without error.
    const result = resolveScriptedSpell(
      state,
      {
        name: "Test Etali (virtuals only)",
        oracle: "Exile the top card of each player's library.",
        spell: [
          {
            op: "Exile",
            target: "creature",
            fromZone: "library_top",
          },
        ],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    expect(result).toBeDefined();
  });
});