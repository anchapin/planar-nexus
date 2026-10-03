/**
 * The two P/T reads must agree (issue #2449): combat uses the layer system,
 * while SBAs and the UI use evergreen-keywords. Each bonus tracked on the card
 * instance must show up in both.
 */
import { createCardInstance } from "../card-instance";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../evergreen-keywords";
import {
  LayerSystem,
  getEffectivePower as layerPower,
  getEffectiveToughness as layerToughness,
} from "../layer-system";
import type { CardInstance, PlayerId, ScryfallCard } from "../types";

const p1 = "player-1" as PlayerId;

function creature(power: string, toughness: string): CardInstance {
  const data = {
    id: "mock-creature",
    name: "Test Creature",
    type_line: "Creature \u2014 Spirit",
    oracle_text: "",
    mana_cost: "{1}{B}",
    cmc: 2,
    colors: ["B"],
    color_identity: ["B"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power,
    toughness,
  } as unknown as ScryfallCard;
  return createCardInstance(data, p1, p1);
}

function bothReads(card: CardInstance) {
  const ls = new LayerSystem();
  return {
    evergreen: [getEffectivePower(card), getEffectiveToughness(card)],
    layer: [layerPower(card, ls), layerToughness(card, ls)],
  };
}

describe("P/T read parity (#2449)", () => {
  it("counts threshold bonuses in the combat read", () => {
    const card = {
      ...creature("2", "1"),
      thresholdBonus: {
        power: 2,
        toughness: 2,
        keywords: [],
        unblockable: false,
      },
    } as CardInstance;
    const { evergreen, layer } = bothReads(card);
    expect(evergreen).toEqual([4, 3]);
    expect(layer).toEqual(evergreen);
  });

  it("counts +1/+1 counters on power in the evergreen read", () => {
    const card = {
      ...creature("2", "2"),
      counters: [{ type: "+1/+1", count: 4 }],
    } as CardInstance;
    const { evergreen, layer } = bothReads(card);
    expect(evergreen).toEqual([6, 6]);
    expect(layer).toEqual(evergreen);
  });

  it("counts -1/-1 counters on power in the evergreen read", () => {
    const card = {
      ...creature("3", "3"),
      counters: [{ type: "-1/-1", count: 1 }],
    } as CardInstance;
    const { evergreen, layer } = bothReads(card);
    expect(evergreen).toEqual([2, 2]);
    expect(layer).toEqual(evergreen);
  });

  it("agrees on prowess, until-end-of-turn pumps, anthems and lords", () => {
    const card = {
      ...creature("1", "1"),
      prowessBoost: 1,
      untilEndOfTurnPT: { power: 3, toughness: 3 },
      thresholdAnthemPT: { power: 1, toughness: 0 },
      tribalAnthemPT: { power: 1, toughness: 1 },
    } as CardInstance;
    const { evergreen, layer } = bothReads(card);
    expect(evergreen).toEqual([7, 6]);
    expect(layer).toEqual(evergreen);
  });

  it("agrees on a domain power CDA", () => {
    const card = { ...creature("*", "4"), domainPower: 3 } as CardInstance;
    const { evergreen, layer } = bothReads(card);
    expect(evergreen).toEqual([3, 4]);
    expect(layer).toEqual(evergreen);
  });

  it("agrees on a turn-only creature form", () => {
    const card = {
      ...creature("0", "0"),
      turnCreatureForm: { power: 5, toughness: 5 },
    } as CardInstance;
    const { evergreen, layer } = bothReads(card);
    expect(evergreen).toEqual([5, 5]);
    expect(layer).toEqual(evergreen);
  });
});
