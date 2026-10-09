/**
 * "Exile up to N from a single graveyard" tests (#2594 follow-up,
 * lane 20)
 *
 * The drafter has 1 FDN card wanting this — Soul-Shackled Zombie
 * (FDN #70, "When this creature enters, exile up to two target
 * cards from a single graveyard. If at least one creature card was
 * exiled this way, each opponent loses 2 life and you gain 2
 * life."). The current `Exile.fromZone: "graveyard"` (lane 10)
 * only supports a single targeted card. This lane extends
 * `ExileSchema` with an optional `count` field so the engine can
 * select up to N card ids from the chosen graveyard and exile
 * them.
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

function makeCard(name: string, typeLine: string): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: typeLine,
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

/** Place a real CardInstance in a player's graveyard. */
function placeInGraveyard(
  state: GameState,
  card: ScryfallCard,
  owner: PlayerId,
  cardId: CardInstanceId,
): GameState {
  const zoneKey = `${owner}-graveyard`;
  const inst = createCardInstance(card, owner, owner, {
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

describe('Exile up to N from a single graveyard (#2594 follow-up, lane 20)', () => {
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

  it("Soul-Shackled Zombie script declares count: 2 with fromZone graveyard", () => {
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const fixture = JSON.parse(
      readFileSync(
        join(cardsDir, "soul_shackled_zombie.json"),
        "utf8",
      ),
    ) as {
      name: string;
      triggers: {
        effects: {
          op: string;
          fromZone?: string;
          count?: number;
        }[];
      }[];
    };
    expect(fixture.name).toBe("Soul-Shackled Zombie");
    const exile = fixture.triggers[0].effects[0];
    expect(exile.op).toBe("Exile");
    expect(exile.fromZone).toBe("graveyard");
    expect(exile.count).toBe(2);
  });

  it("count: 2 exiles exactly 2 cards from a 3-card graveyard", () => {
    let s = placeInGraveyard(
      state,
      makeCard("Bear A", "Creature — Bear"),
      p2,
      "p2-bear-a" as CardInstanceId,
    );
    s = placeInGraveyard(
      s,
      makeCard("Bear B", "Creature — Bear"),
      p2,
      "p2-bear-b" as CardInstanceId,
    );
    s = placeInGraveyard(
      s,
      makeCard("Bear C", "Creature — Bear"),
      p2,
      "p2-bear-c" as CardInstanceId,
    );
    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Multi-Grave Exile",
        oracle: "Exile up to two target cards from a single graveyard.",
        spell: [
          {
            op: "Exile",
            target: "creature",
            fromZone: "graveyard",
            count: 2,
            graveyard: "any",
          },
        ],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    // Exactly 2 cards were exiled (cards go to their controller's exile).
    const exileIds = result.zones.get(`${p2}-exile`)?.cardIds ?? [];
    const exiledFromP2 = exileIds.filter((id) => id.startsWith("p2-"));
    expect(exiledFromP2.length).toBe(2);
    // One card remains in p2's graveyard.
    const gyRemaining = result.zones.get(`${p2}-graveyard`)?.cardIds ?? [];
    const p2Remaining = gyRemaining.filter((id) => id.startsWith("p2-"));
    expect(p2Remaining.length).toBe(1);
  });

  it("count: 2 on an empty graveyard is a graceful no-op", () => {
    const result = resolveScriptedSpell(
      state,
      {
        name: "Test Multi-Grave Empty",
        oracle: "Exile up to two target cards from a single graveyard.",
        spell: [
          {
            op: "Exile",
            target: "creature",
            fromZone: "graveyard",
            count: 2,
            graveyard: "any",
          },
        ],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    expect(result).toBeDefined();
    expect(result.zones.get(`${p1}-exile`)?.cardIds ?? []).toEqual([]);
    expect(result.zones.get(`${p2}-exile`)?.cardIds ?? []).toEqual([]);
  });

  it("count: 2 on a graveyard with 1 card exiles just that 1 card", () => {
    const s = placeInGraveyard(
      state,
      makeCard("Solo Bear", "Creature — Bear"),
      p2,
      "p2-solo" as CardInstanceId,
    );
    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Multi-Grave Solo",
        oracle: "Exile up to two target cards from a single graveyard.",
        spell: [
          {
            op: "Exile",
            target: "creature",
            fromZone: "graveyard",
            count: 2,
            graveyard: "any",
          },
        ],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    expect(result.zones.get(`${p2}-exile`)?.cardIds).toContain(
      "p2-solo",
    );
    expect(
      result.zones.get(`${p2}-graveyard`)?.cardIds.includes("p2-solo"),
    ).toBe(false);
  });
});
