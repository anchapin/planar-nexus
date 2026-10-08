/**
 * "Destroy by mana value" tests (#2594 follow-up, lane 18)
 *
 * The drafter has 1 FDN card wanting this — Steel Hellkite (FDN
 * #138, "{X}: Destroy each nonland permanent with mana value X
 * whose controller was dealt combat damage by this creature this
 * turn."). The current `removalFields` had `min_power/max_power`
 * but no mana-value bound. This lane extends `removalFields`
 * with `min_mana_value/max_mana_value` so the drafter can script
 * mana-value-based destruction and exile.
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

function makeCard(
  name: string,
  typeLine: string,
  cmc: number,
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: typeLine,
    oracle_text: "",
    mana_cost: "",
    cmc,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

/** Place a real CardInstance on the controller's battlefield. */
function placeOnBattlefield(
  state: GameState,
  card: ScryfallCard,
  controller: PlayerId,
  cardId: CardInstanceId,
): GameState {
  const zoneKey = `${controller}-battlefield`;
  const inst = createCardInstance(card, controller, controller, {
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

describe('Destroy by mana value (#2594 follow-up, lane 18)', () => {
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

  it("Steel Hellkite script declares Destroy with max_mana_value: X", () => {
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const fixture = JSON.parse(
      readFileSync(join(cardsDir, "steel_hellkite.json"), "utf8"),
    ) as {
      name: string;
      activated: {
        effects: {
          op: string;
          target: string;
          max_mana_value?: string;
        }[];
      }[];
    };
    expect(fixture.name).toBe("Steel Hellkite");
    // The second activated ability is the {X}-cost destroy sweep.
    const sweep = fixture.activated[1].effects[0];
    expect(sweep.op).toBe("Destroy");
    expect(sweep.target).toBe("all_nonland_permanents");
    expect(sweep.max_mana_value).toBe("X");
  });

  it("max_mana_value: 2 destroys mana value ≤ 2 only", () => {
    // Place three permanents: Bear (cmc 2), Bird (cmc 3), Tree
    // (cmc 5). Destroy.all_nonland_permanents with max_mana_value: 2
    // should destroy Bear only. (The script-side filter is at the
    // dispatch layer; this test exercises it through
    // resolveScriptedSpell on a synthetic script.)
    let s = placeOnBattlefield(state, makeCard("Bear", "Creature — Bear", 2), p1, "p1-bear" as CardInstanceId);
    s = placeOnBattlefield(s, makeCard("Bird", "Creature — Bird", 3), p1, "p1-bird" as CardInstanceId);
    s = placeOnBattlefield(s, makeCard("Tree", "Creature — Tree", 5), p2, "p2-tree" as CardInstanceId);

    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Sweep by MV",
        oracle: "Destroy each nonland permanent with mana value 2 or less.",
        spell: [
          {
            op: "Destroy",
            target: "all_nonland_permanents",
            max_mana_value: 2,
          },
        ],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    // The Bear should be in p1's graveyard; Bird and Tree remain on
    // their battlefields.
    expect(result.zones.get(`${p1}-graveyard`)!.cardIds).toContain("p1-bear");
    expect(result.zones.get(`${p1}-battlefield`)!.cardIds).not.toContain(
      "p1-bear",
    );
    expect(result.zones.get(`${p1}-battlefield`)!.cardIds).toContain(
      "p1-bird",
    );
    expect(result.zones.get(`${p2}-battlefield`)!.cardIds).toContain(
      "p2-tree",
    );
  });

  it("min_mana_value: 5 destroys mana value ≥ 5 only", () => {
    // Same three permanents; min_mana_value: 5 should destroy Tree
    // only.
    let s = placeOnBattlefield(state, makeCard("Bear", "Creature — Bear", 2), p1, "p1-bear" as CardInstanceId);
    s = placeOnBattlefield(s, makeCard("Bird", "Creature — Bird", 3), p1, "p1-bird" as CardInstanceId);
    s = placeOnBattlefield(s, makeCard("Tree", "Creature — Tree", 5), p2, "p2-tree" as CardInstanceId);

    const result = resolveScriptedSpell(
      s,
      {
        name: "Test Sweep min MV",
        oracle: "Destroy each nonland permanent with mana value 5 or greater.",
        spell: [
          {
            op: "Destroy",
            target: "all_nonland_permanents",
            min_mana_value: 5,
          },
        ],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    // Tree should be destroyed.
    expect(result.zones.get(`${p2}-graveyard`)!.cardIds).toContain("p2-tree");
    expect(result.zones.get(`${p2}-battlefield`)!.cardIds).not.toContain(
      "p2-tree",
    );
    // Bear and Bird remain.
    expect(result.zones.get(`${p1}-battlefield`)!.cardIds).toContain(
      "p1-bear",
    );
    expect(result.zones.get(`${p1}-battlefield`)!.cardIds).toContain(
      "p1-bird",
    );
  });
});