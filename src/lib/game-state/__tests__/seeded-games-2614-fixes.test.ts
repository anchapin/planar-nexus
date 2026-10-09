/**
 * Rules gaps the #2614 seeded random-agent games hit: the legend-rule choice
 * had no answer path, an Aura spell was offered with no enchant target, and
 * the random agent sent a lone blocker at a menace creature (that last one is
 * covered in src/ai/__tests__/simulation/training-session.test.ts).
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { registerCardScripts } from "../card-scripts/registry";
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import { resolveWaitingChoice } from "../spell-casting/choices";
import { createLegendaryWaitingChoice } from "../legendary-rule";
import { listPriorityChoices } from "../legal-choices";
import { Phase } from "../types";
import type { CardInstance, GameState, PlayerId, ScryfallCard } from "../types";

const scry = (
  name: string,
  type_line: string,
  mana_cost: string,
  extra: Partial<ScryfallCard> = {},
): ScryfallCard =>
  ({
    id: name.toLowerCase().replace(/\W+/g, "-"),
    name,
    type_line,
    oracle_text: "",
    mana_cost,
    cmc: 1,
    colors: ["G"],
    color_identity: ["G"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "2",
    toughness: "2",
    ...extra,
  }) as ScryfallCard;

const place = (s: GameState, inst: CardInstance, zone: string) => {
  const cards = new Map(s.cards);
  cards.set(inst.id, { ...inst, currentZoneKey: zone });
  const zones = new Map(s.zones);
  const z = zones.get(zone)!;
  zones.set(zone, { ...z, cardIds: [...z.cardIds, inst.id] });
  return { ...s, cards, zones };
};

describe("#2614 seeded-game fixes", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    registerCardScripts(RAW_CARD_SCRIPTS);
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state.turn.activePlayerId = p1;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = p1;
    state.stack = [];
  });

  it("answers the legend-rule choice through resolveWaitingChoice", () => {
    const legend = scry(
      "Sarkhan, Dragon Ascendant",
      "Legendary Creature — Human Monk",
      "{1}{R}",
    );
    const a = createCardInstance(legend, p1, p1);
    const b = createCardInstance(legend, p1, p1);
    state = place(place(state, a, `${p1}-battlefield`), b, `${p1}-battlefield`);
    state = {
      ...state,
      waitingChoice: createLegendaryWaitingChoice(
        {
          controllerId: p1,
          name: "sarkhan, dragon ascendant",
          candidateIds: [a.id, b.id],
        },
        state,
      ),
    };
    const r = resolveWaitingChoice(state, p1, b.id);
    expect(r.success).toBe(true);
    expect(r.state.waitingChoice).toBeNull();
    const battlefield = r.state.zones.get(`${p1}-battlefield`)!.cardIds;
    expect(battlefield).toContain(b.id);
    expect(battlefield).not.toContain(a.id);
  });

  it("offers an Aura spell only with a legal enchant target", () => {
    const aura = createCardInstance(
      scry("Meltstrider's Resolve", "Enchantment — Aura", "{G}", {
        oracle_text:
          "Enchant creature you control\nWhen this Aura enters, enchanted creature fights up to one target creature an opponent controls. (Each deals damage equal to its power to the other.)\nEnchanted creature gets +0/+2 and can't be blocked by more than one creature.",
      }),
      p1,
      p1,
    );
    state = place(state, aura, `${p1}-hand`);
    state = addMana(state, p1, { green: 1 });
    const casts = () =>
      listPriorityChoices(state, p1).filter(
        (c) => c.kind === "cast_spell" && c.cardId === aura.id,
      );
    // No creature to enchant: not castable, rather than cast and refused.
    expect(casts()).toHaveLength(0);

    const mine = createCardInstance(
      scry("Bear", "Creature — Bear", "{1}{G}"),
      p1,
      p1,
    );
    const theirs = createCardInstance(
      scry("Wolf", "Creature — Wolf", "{1}{G}"),
      p2,
      p2,
    );
    state = place(state, mine, `${p1}-battlefield`);
    state = place(state, theirs, `${p2}-battlefield`);
    expect(casts()).toEqual([
      { kind: "cast_spell", cardId: aura.id, targets: [mine.id] },
    ]);
  });
});
