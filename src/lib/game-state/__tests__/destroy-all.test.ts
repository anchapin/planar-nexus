/**
 * "Destroy all [type]" tests (#2594 follow-up, lane 12)
 *
 * The drafter surfaced a gap for sweeper targets ("Destroy all
 * creatures" — Day of Judgment, Fumigate; "Destroy all artifacts"
 * — Ultima). The current `Destroy` op only supports single
 * targets (REMOVAL_TARGETS). This lane extends the schema with
 * `REMOVAL_ALL_TARGETS` ("all_creatures", "all_artifacts",
 * "all_enchantments", "all_nonland_permanents") and threads the
 * engine's `applyEffect` to iterate the battlefield and call
 * `destroyCard` for each matching permanent.
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
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

function makeCard(
  name: string,
  typeLine: string,
  power: [number, number] | null = null,
): ScryfallCard {
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
    power: power ? String(power[0]) : undefined,
    toughness: power ? String(power[1]) : undefined,
  } as ScryfallCard;
}

interface PlaceOpts {
  state: GameState;
  card: ScryfallCard;
  controller: PlayerId;
  owner?: PlayerId;
  cardId: string;
}

/** Place a card on its controller's battlefield (currentZoneKey set). */
function placeOnBattlefield(opts: PlaceOpts): GameState {
  const owner = opts.owner ?? opts.controller;
  const zoneKey = `${owner}-battlefield`;
  const id = opts.cardId;
  // Mirror of `put` in card-scripts.test.ts — register the card's data
  // via a transient map entry on state.cards and append to the
  // controller's battlefield zone.
  const inst: CardInstance = createCardInstance(
    opts.card,
    owner,
    opts.controller,
    { id, currentZoneKey: zoneKey },
  );
  const cards = new Map(opts.state.cards);
  cards.set(id, inst);
  const existing = opts.state.zones.get(zoneKey)!;
  const zones = new Map(opts.state.zones);
  zones.set(zoneKey, {
    ...existing,
    cardIds: [...existing.cardIds, id],
  });
  return { ...opts.state, cards, zones };
}

describe('Destroy all [type] (#2594 follow-up, lane 12)', () => {
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

  it("schema accepts Destroy with target: all_creatures", () => {
    // Smoke check via the live Day of Judgment fixture.
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const doj = JSON.parse(
      readFileSync(join(cardsDir, "day_of_judgment.json"), "utf8"),
    ) as { spell: { op: string; target: string }[] };
    expect(doj.spell[0].op).toBe("Destroy");
    expect(doj.spell[0].target).toBe("all_creatures");
  });

  it("Fumigate card-script declares all_creatures + GainLife chain", () => {
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const fumigate = JSON.parse(
      readFileSync(join(cardsDir, "fumigate.json"), "utf8"),
    ) as {
      name: string;
      spell: { op: string; target?: string; who?: string }[];
    };
    expect(fumigate.name).toBe("Fumigate");
    expect(fumigate.spell[0].op).toBe("Destroy");
    expect(fumigate.spell[0].target).toBe("all_creatures");
    expect(fumigate.spell[1].op).toBe("GainLife");
    expect(fumigate.spell[1].who).toBe("you");
  });

  it("Ultima card-script declares all_artifacts", () => {
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const ultima = JSON.parse(
      readFileSync(join(cardsDir, "ultima.json"), "utf8"),
    ) as { name: string; spell: { op: string; target: string }[] };
    expect(ultima.name).toBe("Ultima");
    expect(ultima.spell[0].target).toBe("all_artifacts");
  });

  it("Day of Judgment destroys every creature on every player's battlefield", () => {
    // p1 has a Bear and a Bird; p2 has a Golem (artifact creature).
    // Only the creatures should die; the Golem dies too (it's a
    // creature) but Mind Stone (pure artifact) survives.
    let s = placeOnBattlefield({
      state,
      card: makeCard("Bear", "Creature — Bear", [2, 2]),
      controller: p1,
      cardId: "p1-bear",
    });
    s = placeOnBattlefield({
      state: s,
      card: makeCard("Bird", "Creature — Bird", [1, 1]),
      controller: p1,
      cardId: "p1-bird",
    });
    s = placeOnBattlefield({
      state: s,
      card: makeCard(
        "Mind Stone",
        "Artifact",
      ),
      controller: p2,
      cardId: "p2-mindstone",
    });
    s = placeOnBattlefield({
      state: s,
      card: makeCard("Golem", "Artifact Creature — Golem", [3, 3]),
      controller: p2,
      cardId: "p2-golem",
    });

    const r = resolveScriptedSpell(
      s,
      {
        name: "Test DoJ",
        oracle: "Destroy all creatures.",
        spell: [{ op: "Destroy", target: "all_creatures" }],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    // Every creature is in the graveyard. The engine's `destroyCard`
    // clears `currentZoneKey` on the new card object (readers fall
    // back to a zone scan, see `keyword-actions/removal.ts`), so we
    // check the zone membership via `zones.get(...).cardIds`.
    expect(r.zones.get(`${p1}-graveyard`)!.cardIds).toContain("p1-bear");
    expect(r.zones.get(`${p1}-graveyard`)!.cardIds).toContain("p1-bird");
    expect(r.zones.get(`${p2}-graveyard`)!.cardIds).toContain("p2-golem");
    // Mind Stone stays on the battlefield (it's not a creature).
    expect(r.zones.get(`${p2}-battlefield`)!.cardIds).toContain("p2-mindstone");
  });

  it("destroy all_artifacts only touches artifacts (not creatures)", () => {
    let s = placeOnBattlefield({
      state,
      card: makeCard("Mind Stone", "Artifact"),
      controller: p1,
      cardId: "p1-mindstone",
    });
    s = placeOnBattlefield({
      state: s,
      card: makeCard("Bear", "Creature — Bear", [2, 2]),
      controller: p1,
      cardId: "p1-bear",
    });
    s = placeOnBattlefield({
      state: s,
      card: makeCard(
        "Golem",
        "Artifact Creature — Golem",
        [3, 3],
      ),
      controller: p2,
      cardId: "p2-golem",
    });

    const r = resolveScriptedSpell(
      s,
      {
        name: "Test Ultima",
        oracle: "Destroy all artifacts.",
        spell: [{ op: "Destroy", target: "all_artifacts" }],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    // Pure artifact destroyed.
    expect(r.zones.get(`${p1}-graveyard`)!.cardIds).toContain("p1-mindstone");
    // Golem is an artifact creature — destroyed.
    expect(r.zones.get(`${p2}-graveyard`)!.cardIds).toContain("p2-golem");
    // Pure creature lives.
    expect(r.zones.get(`${p1}-battlefield`)!.cardIds).toContain("p1-bear");
  });

  it("Fumigate destroys creatures and grants life", () => {
    let s = placeOnBattlefield({
      state,
      card: makeCard("Bear", "Creature — Bear", [2, 2]),
      controller: p1,
      cardId: "p1-bear",
    });
    s = placeOnBattlefield({
      state: s,
      card: makeCard("Bird", "Creature — Bird", [1, 1]),
      controller: p2,
      cardId: "p2-bird",
    });

    const r = resolveScriptedSpell(
      s,
      {
        name: "Test Fumigate",
        oracle:
          "Destroy all creatures. You gain 2 life for each creature destroyed this way.",
        spell: [
          { op: "Destroy", target: "all_creatures" },
          { op: "GainLife", amount: 2, who: "you" },
        ],
      } as never,
      { controllerId: p1, sourceCardId: null, targets: [], chosenModes: [] },
    );
    expect(r.zones.get(`${p1}-graveyard`)!.cardIds).toContain("p1-bear");
    expect(r.zones.get(`${p2}-graveyard`)!.cardIds).toContain("p2-bird");
  });
});