/**
 * "Exile target player's graveyard" tests (#2594 follow-up, lane 14)
 *
 * The drafter has 1 FDN card wanting this — Angel of Finality
 * ("When this creature enters, exile target player's graveyard.").
 * The lane extends `ExileSchema.fromZone` with `"opponent_graveyard"`
 * and threads the engine's `effectTargetLegal` / `applyEffect` to
 * sweep every card in the chosen player's graveyard. The chosen
 * player is narrowed by `effect.controller` (default: opponent).
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveScriptedSpell } from "../card-scripts/interpret";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

function makeCard(
  overrides: Partial<ScryfallCard> & { name: string; id: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name,
    type_line: overrides.type_line ?? "Creature — Beast",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "",
    cmc: overrides.cmc ?? 0,
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? [],
    keywords: overrides.keywords ?? [],
    legalities: { standard: "legal" },
    layout: overrides.layout ?? "normal",
  } as ScryfallCard;
}

/**
 * Place a card in the given player's graveyard. Sets `currentZoneKey`
 * to the graveyard so the engine's `exileCard` can find it.
 */
function placeInGraveyard(
  state: GameState,
  card: ScryfallCard,
  owner: PlayerId,
  cardId: CardInstanceId,
): GameState {
  const zoneKey = `${owner}-graveyard`;
  const inst: CardInstance = createCardInstance(card, owner, owner, {
    id: cardId,
    currentZoneKey: zoneKey,
  });
  const cards = new Map(state.cards).set(cardId, inst);
  const existing = state.zones.get(zoneKey)!;
  const zones = new Map(state.zones);
  zones.set(zoneKey, {
    ...existing,
    cardIds: [...existing.cardIds, cardId],
  });
  return { ...state, cards, zones };
}

describe('Exile target player\'s graveyard (#2594 follow-up, lane 14)', () => {
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

  it("Angel of Finality script declares Exile with fromZone: opponent_graveyard", () => {
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const fixture = JSON.parse(
      readFileSync(join(cardsDir, "angel_of_finality.json"), "utf8"),
    ) as {
      name: string;
      triggers: {
        effects: {
          op: string;
          target: string;
          fromZone?: string;
          controller?: string;
        }[];
      }[];
    };
    expect(fixture.name).toBe("Angel of Finality");
    const exile = fixture.triggers[0].effects[0];
    expect(exile.op).toBe("Exile");
    expect(exile.fromZone).toBe("opponent_graveyard");
    expect(exile.controller).toBe("opponent");
  });

  it("exile each card in the opponent's graveyard", () => {
    // Set up two cards in p2's graveyard and one in p1's. The
    // Angel of Finality sweep with `controller: "opponent"`
    // targets p2's graveyard; p1's graveyard stays untouched.
    let s = placeInGraveyard(
      state,
      makeCard({ id: "p2-bear", name: "Bear" }),
      p2,
      "p2-bear" as CardInstanceId,
    );
    s = placeInGraveyard(
      s,
      makeCard({ id: "p2-bird", name: "Bird" }),
      p2,
      "p2-bird" as CardInstanceId,
    );
    s = placeInGraveyard(
      s,
      makeCard({ id: "p1-self-bear", name: "Self Bear" }),
      p1,
      "p1-self-bear" as CardInstanceId,
    );

    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Angel of Finality",
        oracle: "When this creature enters, exile target player's graveyard.",
        spell: [
          {
            op: "Exile",
            target: "creature",
            fromZone: "opponent_graveyard",
            controller: "opponent",
          },
        ],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    // p2's graveyard is empty; the two cards are in exile.
    expect(result.zones.get(`${p2}-graveyard`)!.cardIds).toEqual([]);
    expect(result.zones.get(`${p2}-exile`)!.cardIds).toContain("p2-bear");
    expect(result.zones.get(`${p2}-exile`)!.cardIds).toContain("p2-bird");
    // p1's graveyard is untouched (the sweep targets opponents).
    expect(result.zones.get(`${p1}-graveyard`)!.cardIds).toContain(
      "p1-self-bear",
    );
  });

  it("controller: you sweeps your own graveyard instead", () => {
    // Edge case: an effect that exiles your own graveyard.
    const s = placeInGraveyard(
      state,
      makeCard({ id: "self-bear", name: "Self Bear" }),
      p1,
      "self-bear" as CardInstanceId,
    );

    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Self Sweep",
        oracle: "Exile your own graveyard.",
        spell: [
          {
            op: "Exile",
            target: "creature",
            fromZone: "opponent_graveyard",
            controller: "you",
          },
        ],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    expect(result.zones.get(`${p1}-graveyard`)!.cardIds).toEqual([]);
    expect(result.zones.get(`${p1}-exile`)!.cardIds).toContain("self-bear");
  });

  it("empty opponent graveyard is a no-op (no failure)", () => {
    // The sweep iterates an empty graveyard; no cards move, no error.
    const result = resolveScriptedSpell(
      state,
      {
        name: "Test Angel of Finality (empty)",
        oracle: "Exile target player's graveyard.",
        spell: [
          {
            op: "Exile",
            target: "creature",
            fromZone: "opponent_graveyard",
            controller: "opponent",
          },
        ],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    expect(result).toBeDefined();
    expect(result.zones.get(`${p2}-graveyard`)!.cardIds).toEqual([]);
  });
});