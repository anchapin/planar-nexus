/**
 * Branch-coverage tests for Oracle Text Parser
 * Issue #1098: Add unit tests for oracle-text-parser branch coverage
 *
 * The existing oracle-text-parser.test.ts is a broad path-coverage suite. This
 * file targets the individual construct branches that path coverage left
 * unexercised: every mana symbol, every trigger event in parseTriggerText,
 * every effect type in parseEffect, every alternative-cost keyword, and the
 * malformed/empty fallback branches.
 *
 * Bug fixed alongside these tests (regression test below): parseEffect only
 * matched the imperative "deal " form, so real "deals N damage" Oracle text
 * never hit the damage branch. The fix accepts both forms.
 */

import {
  parseManaCost,
  parseActivatedAbilities,
  parseTriggeredAbilities,
  parseStaticAbilities,
  extractKeywords,
  parseOracleText,
  canGoOnStack,
  formatManaCost,
  manaCostsEqual,
  getManaValue,
  getSplitCardHalves,
  getModesForModalSpell,
  parseModes,
  parseXCost,
  parseAlternativeCost,
  parseBuyback,
  parseFlashback,
  parseBestow,
  parsePrototype,
  isModalSpell,
  hasFuse,
  AlternativeCostType,
} from "../oracle-text-parser";
import type { ScryfallCard } from "@/app/actions";

function createMockCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: "mock-card",
    name: "Test Card",
    type_line: "Creature — Human",
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

const TYPE = "Creature — Human";

// ---------------------------------------------------------------------------
// parseManaCost — every symbol branch
// ---------------------------------------------------------------------------
describe("parseManaCost — symbol branches", () => {
  it("parses colorless mana symbol {C}", () => {
    expect(parseManaCost("{C}")).toEqual(
      expect.objectContaining({ colorless: 1, generic: 0 }),
    );
  });

  it("parses green mana symbol {G}", () => {
    expect(parseManaCost("{G}")).toEqual(
      expect.objectContaining({ green: 1 }),
    );
  });

  it("parses snow mana symbol {S}", () => {
    expect(parseManaCost("{S}")).toEqual(expect.objectContaining({ snow: 1 }));
  });

  it("parses phyrexian {P} as generic 1", () => {
    expect(parseManaCost("{P}")).toEqual(expect.objectContaining({ generic: 1 }));
  });

  it("parses hybrid symbols adding 0.5 to each color", () => {
    // Covers all five color half-branches (W/U/B/R/G) in the split loop.
    const cost = parseManaCost("{W/U}{B/R}{G/W}");
    expect(cost).not.toBeNull();
    expect(cost!.white).toBe(1); // W from W/U and G/W
    expect(cost!.blue).toBe(0.5);
    expect(cost!.black).toBe(0.5);
    expect(cost!.red).toBe(0.5);
    expect(cost!.green).toBe(0.5);
  });

  it("parses monocolored hybrid {2/W} as generic 2", () => {
    expect(parseManaCost("{2/W}")).toEqual(expect.objectContaining({ generic: 2 }));
  });

  it("parses a complex mixed cost {X}{R}{R}{2/G}{C}", () => {
    const cost = parseManaCost("{X}{R}{R}{2/G}{C}");
    expect(cost).toEqual(
      expect.objectContaining({
        X: 0,
        red: 2,
        generic: 2,
        colorless: 1,
      }),
    );
  });

  it("returns null when the cost string has no valid symbols", () => {
    // Exercises the `|| []` fallback on the symbol matcher.
    expect(parseManaCost("not a mana cost")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseManaCost("")).toBeNull();
  });

  it("treats lowercase {x} as the X symbol", () => {
    expect(parseManaCost("{x}")).toEqual(expect.objectContaining({ X: 0 }));
  });
});

// ---------------------------------------------------------------------------
// parseActivatedAbilities + parseEffect — every effect type branch
// ---------------------------------------------------------------------------
describe("parseActivatedAbilities — effect type branches", () => {
  const ability = (text: string) =>
    parseActivatedAbilities(text, TYPE)[0];

  it("classifies 'deals N damage' as damage (regression for issue #1098)", () => {
    const a = ability("{2}{R}: ~ deals 3 damage to any target.");
    expect(a).toBeTruthy();
    expect(a!.effectType).toBe("damage");
    expect(a!.value).toBe(3);
  });

  it("classifies 'deal N damage' (imperative) as damage", () => {
    const a = ability("{R}: deal 2 damage to target creature.");
    expect(a!.effectType).toBe("damage");
  });

  it("classifies destroy effects", () => {
    expect(ability("{2}{W}: Destroy target enchantment.")!.effectType).toBe(
      "destroy",
    );
  });

  it("classifies exile effects", () => {
    expect(ability("{2}{W}: Exile target creature.")!.effectType).toBe("exile");
  });

  it("classifies draw effects", () => {
    const a = ability("{T}: Draw 2 cards.");
    expect(a!.effectType).toBe("draw");
    expect(a!.value).toBe(2);
  });

  it("classifies token creation effects", () => {
    expect(
      ability("{1}{W}: Create a 1/1 white Soldier creature token.")!.effectType,
    ).toBe("createToken");
  });

  it("classifies counter-spell effects", () => {
    expect(ability("{U}: Counter target spell.")!.effectType).toBe("counter");
  });

  it("classifies life gain effects", () => {
    expect(ability("{W}: You gain 3 life.")!.effectType).toBe("gainLife");
  });

  it("classifies life loss effects", () => {
    expect(ability("{B}: Target player loses 2 life.")!.effectType).toBe(
      "loseLife",
    );
  });

  it("classifies life loss for the 'you lose' form too", () => {
    expect(ability("{B}: You lose 2 life.")!.effectType).toBe("loseLife");
  });

  it("classifies tap effects", () => {
    expect(ability("{U}: Tap target creature.")!.effectType).toBe("tap");
  });

  it("classifies +1/+1 counter effects as addCounter", () => {
    expect(
      ability("{G}: Put a +1/+1 counter on target creature.")!.effectType,
    ).toBe("addCounter");
  });

  it("classifies 'return ... to hand' effects", () => {
    expect(
      ability("{U}: Return target creature to hand.")!.effectType,
    ).toBe("return");
  });

  it("classifies library search effects", () => {
    expect(
      ability("{1}{G}: Search your library for a creature card.")!.effectType,
    ).toBe("search");
  });

  it("classifies 'put ... into play' effects", () => {
    expect(
      ability("{3}{G}: Put a creature card into play.")!.effectType,
    ).toBe("putIntoPlay");
  });

  it("classifies 'gain control' effects", () => {
    expect(
      ability("{2}{U}: Gain control of target creature.")!.effectType,
    ).toBe("gainControl");
  });

  it("falls back to generic effect for unknown verbs", () => {
    expect(ability("{1}: Scry 2.")!.effectType).toBe("generic");
  });
});

// ---------------------------------------------------------------------------
// parseActivatedAbilities — cost branches (exile-from-graveyard, additional)
// ---------------------------------------------------------------------------
describe("parseActivatedAbilities — cost branches", () => {
  it("parses exile-from-graveyard as a cost alongside mana", () => {
    const a = parseActivatedAbilities(
      "{1}, Exile this card from your graveyard: Draw a card.",
      TYPE,
    )[0];
    expect(a).toBeTruthy();
    expect(a!.costs.exile).toBe(true);
    expect(a!.costs.mana).not.toBeNull();
  });

  it("parses pay-life costs", () => {
    const a = parseActivatedAbilities("Pay 2 life: Draw a card.", TYPE)[0];
    expect(a).toBeTruthy();
    expect(a!.costs.payLife).toBe(2);
  });

  it("parses discard costs", () => {
    // discard + mana together form a valid cost (a discard-only cost is not
    // treated as valid by the current parser; documented limitation).
    const a = parseActivatedAbilities(
      "{1}, Discard a card: Draw 2 cards.",
      TYPE,
    )[0];
    expect(a).toBeTruthy();
    expect(a!.costs.discard).toBe(true);
  });

  it("ignores sentences without a cost/effect colon", () => {
    expect(parseActivatedAbilities("Flying. Trample.", TYPE)).toEqual([]);
  });

  it("skips a colon sentence whose cost cannot be parsed", () => {
    // "Say hello: hi" — no tap/mana/sac/life/discard => parseAbilityCost null.
    expect(parseActivatedAbilities("Say hello: hi.", TYPE)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseTriggeredAbilities + parseTriggerText — every trigger event branch
// ---------------------------------------------------------------------------
describe("parseTriggeredAbilities — trigger event branches", () => {
  const trigger = (text: string) =>
    parseTriggeredAbilities(text)[0]?.trigger?.event;

  it("maps 'enters the battlefield' to entersBattlefield", () => {
    expect(trigger("When ~ enters the battlefield, draw a card.")).toBe(
      "entersBattlefield",
    );
  });

  it("maps 'leaves the battlefield' to leavesBattlefield", () => {
    expect(trigger("When ~ leaves the battlefield, draw a card.")).toBe(
      "leavesBattlefield",
    );
  });

  it("maps 'dies' to dies", () => {
    expect(trigger("When ~ dies, draw a card.")).toBe("dies");
  });

  it("maps 'deals damage' to damageDealt", () => {
    expect(trigger("Whenever ~ deals damage, draw a card.")).toBe(
      "damageDealt",
    );
  });

  it("maps 'attacks' to attacked", () => {
    expect(trigger("Whenever ~ attacks, draw a card.")).toBe("attacked");
  });

  it("maps 'becomes blocked' to blocked", () => {
    expect(trigger("When ~ becomes blocked, draw a card.")).toBe("blocked");
  });

  it("maps 'you cast a spell' to spellCast", () => {
    expect(trigger("Whenever you cast a spell, draw a card.")).toBe("spellCast");
  });

  it("maps 'a spell is cast' to spellCast", () => {
    expect(trigger("Whenever a spell is cast, draw a card.")).toBe("spellCast");
  });

  it("maps 'you cast' (non-spell) to cast", () => {
    expect(trigger("Whenever you cast a creature, draw a card.")).toBe("cast");
  });

  it("maps 'is played' to cast", () => {
    expect(trigger("Whenever ~ is played, draw a card.")).toBe("cast");
  });

  it("maps 'at the end of turn' to turnEnds", () => {
    expect(trigger("At the end of turn, sacrifice ~.")).toBe("turnEnds");
  });

  it("maps 'end of the turn' to turnEnds", () => {
    expect(trigger("At the end of the turn, sacrifice ~.")).toBe("turnEnds");
  });

  it("maps upkeep triggers to upkeep", () => {
    expect(trigger("At the beginning of your upkeep, draw a card.")).toBe(
      "upkeep",
    );
  });

  it("maps 'beginning of your draw step' to drawStep", () => {
    expect(trigger("At the beginning of your draw step, draw a card.")).toBe(
      "drawStep",
    );
  });

  it("maps 'beginning of the end step' to phaseEnds", () => {
    expect(trigger("At the beginning of the end step, draw a card.")).toBe(
      "phaseEnds",
    );
  });

  it("maps combat damage triggers to combatDamageStepEnds", () => {
    expect(
      trigger("At the beginning of combat damage step, draw a card."),
    ).toBe("combatDamageStepEnds");
  });

  it("maps 'counters are put' to counterAdded", () => {
    expect(
      trigger("Whenever one or more counters are put on ~, draw a card."),
    ).toBe("counterAdded");
  });

  it("maps 'counter is placed' to counterAdded", () => {
    expect(
      trigger("Whenever a counter is placed on ~, draw a card."),
    ).toBe("counterAdded");
  });

  it("maps life gain triggers to lifeGain", () => {
    expect(trigger("Whenever you gain life, draw a card.")).toBe("lifeGain");
  });

  it("maps life loss triggers to lifeLost", () => {
    expect(trigger("Whenever an opponent loses life, draw a card.")).toBe(
      "lifeLost",
    );
  });

  it("maps 'ability is activated' to abilityActivated", () => {
    expect(
      trigger("Whenever an ability is activated, draw a card."),
    ).toBe("abilityActivated");
  });

  it("maps 'put into a graveyard' to dies", () => {
    expect(
      trigger("Whenever ~ is put into a graveyard from anywhere, draw a card."),
    ).toBe("dies");
  });

  it("classifies unrecognized triggers as unknown (not entersBattlefield)", () => {
    expect(trigger("When ~ becomes monstrous, draw a card.")).toBe("unknown");
  });

  it("parses a 'when' trigger that carries an intervening effect", () => {
    const abilities = parseTriggeredAbilities(
      "When ~ enters the battlefield, you may sacrifice it.",
    );
    expect(abilities).toHaveLength(1);
    expect(abilities[0].effect).toContain("sacrifice");
  });
});

// ---------------------------------------------------------------------------
// parseStaticAbilities — debuff and 'have' patterns
// ---------------------------------------------------------------------------
describe("parseStaticAbilities — pattern branches", () => {
  it("detects static debuffs (get -N/-N)", () => {
    const abilities = parseStaticAbilities(
      "Creatures your opponents control get -1/-1.",
      TYPE,
    );
    expect(
      abilities.some((a) => a.ability === "staticEffect"),
    ).toBe(true);
  });

  it("detects 'have' keyword grants", () => {
    const abilities = parseStaticAbilities(
      "Creatures you control have flying.",
      TYPE,
    );
    expect(abilities.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// extractKeywords — ability words and mechanic keywords
// ---------------------------------------------------------------------------
describe("extractKeywords — keyword categories", () => {
  it("extracts ability words (e.g. landfall)", () => {
    const kws = extractKeywords(
      "Landfall — Whenever a land enters the battlefield under your control, you gain 1 life.",
      "",
    );
    expect(kws).toContainEqual(
      expect.objectContaining({ keyword: "landfall", type: "abilityWord" }),
    );
  });

  it("extracts non-evergreen mechanic keywords (e.g. prototype)", () => {
    const kws = extractKeywords("Prototype {2}{U} — 3/3", "");
    expect(kws).toContainEqual(
      expect.objectContaining({ keyword: "prototype", type: "mechanic" }),
    );
  });

  it("returns no duplicates when a word appears in both lists", () => {
    const kws = extractKeywords("raid and revolt trigger here", "");
    const raids = kws.filter((k) => k.keyword === "raid");
    expect(raids.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// parsePowerToughness / parseLoyalty (via parseOracleText)
// ---------------------------------------------------------------------------
describe("parseOracleText — power/toughness and loyalty branches", () => {
  it("parses numeric power/toughness from the type line", () => {
    const result = parseOracleText(
      createMockCard({ type_line: "Creature — Human 4/5" }),
    );
    expect(result.powerToughness).toEqual({
      power: 4,
      toughness: 5,
      isVariable: false,
    });
  });

  it("parses variable power (* / N)", () => {
    const result = parseOracleText(
      createMockCard({ type_line: "Creature — Elemental */3" }),
    );
    expect(result.powerToughness).toEqual({
      power: 0,
      toughness: 3,
      isVariable: true,
    });
  });

  it("parses variable toughness (N / *)", () => {
    const result = parseOracleText(
      createMockCard({ type_line: "Creature — Horror 4/*" }),
    );
    expect(result.powerToughness).toEqual({
      power: 4,
      toughness: 0,
      isVariable: true,
    });
  });

  it("parses loyalty from bracketed type line", () => {
    const result = parseOracleText(
      createMockCard({ type_line: "Planeswalker — Jace [4]" }),
    );
    expect(result.loyalty).toBe(4);
  });

  it("parses text with reminder text and exposes it separately", () => {
    const result = parseOracleText(
      createMockCard({
        oracle_text: "Flying (This creature can't be blocked except by reach.)",
      }),
    );
    expect(result.reminderText).toContain("can't be blocked");
    expect(result.keywords).toContainEqual(
      expect.objectContaining({ keyword: "flying" }),
    );
  });
});

// ---------------------------------------------------------------------------
// canGoOnStack
// ---------------------------------------------------------------------------
describe("canGoOnStack — type line branches", () => {
  it("returns true for instants", () => {
    expect(canGoOnStack(createMockCard({ type_line: "Instant" }))).toBe(true);
  });

  it("returns true for sorceries", () => {
    expect(canGoOnStack(createMockCard({ type_line: "Sorcery" }))).toBe(true);
  });

  it("returns true for permanents with an activated ability (colon)", () => {
    expect(
      canGoOnStack(
        createMockCard({
          type_line: "Creature — Human",
          oracle_text: "{T}: Draw a card.",
        }),
      ),
    ).toBe(true);
  });

  it("returns false for permanents without activated abilities", () => {
    expect(
      canGoOnStack(
        createMockCard({ type_line: "Creature — Human", oracle_text: "Flying" }),
      ),
    ).toBe(false);
  });

  it("returns false when type line and oracle text are missing", () => {
    expect(
      canGoOnStack(
        createMockCard({ type_line: undefined, oracle_text: undefined }),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatManaCost / manaCostsEqual / getManaValue
// ---------------------------------------------------------------------------
describe("formatManaCost", () => {
  it("returns empty string for null", () => {
    expect(formatManaCost(null)).toBe("");
  });

  it("renders X, generic, and colored symbols", () => {
    expect(
      formatManaCost({
        generic: 2,
        colorless: 0,
        white: 1,
        blue: 0,
        black: 0,
        red: 1,
        green: 0,
        X: 0,
        snow: 0,
      }),
    ).toBe("{X}{2}{W}{R}");
  });

  it("renders colorless and snow symbols", () => {
    expect(
      formatManaCost({
        generic: 0,
        colorless: 1,
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        X: null,
        snow: 1,
      }),
    ).toBe("{C}{S}");
  });
});

describe("manaCostsEqual", () => {
  const a = parseManaCost("{2}{R}")!;
  it("treats two null costs as equal", () => {
    expect(manaCostsEqual(null, null)).toBe(true);
  });

  it("treats one null cost as unequal", () => {
    expect(manaCostsEqual(a, null)).toBe(false);
    expect(manaCostsEqual(null, a)).toBe(false);
  });

  it("compares equal costs as equal", () => {
    expect(manaCostsEqual(a, parseManaCost("{2}{R}"))).toBe(true);
  });

  it("compares differing costs as unequal", () => {
    expect(manaCostsEqual(a, parseManaCost("{2}{G}"))).toBe(false);
  });
});

describe("getManaValue", () => {
  it("returns 0 for null", () => {
    expect(getManaValue(null)).toBe(0);
  });

  it("sums generic, colored (rounded up), and snow", () => {
    // generic 2 + white 1 (ceil) + snow 1 = 4; X adds nothing.
    expect(
      getManaValue({
        generic: 2,
        colorless: 0,
        white: 1,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        X: 0,
        snow: 1,
      }),
    ).toBe(4);
  });

  it("rounds up half-color contributions from hybrid mana", () => {
    // Current implementation sums ceil() of each half-color, so a single
    // hybrid pip {W/U} (white 0.5 + blue 0.5) counts as mana value 2.
    expect(getManaValue(parseManaCost("{W/U}"))).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Modal / split card branches
// ---------------------------------------------------------------------------
describe("parseModes — count mismatch branch", () => {
  it("returns null when fewer modes than required are present", () => {
    // "Choose three" requires >= 3 modes but only 2 are provided.
    expect(parseModes("Choose three — A / B")).toBeNull();
  });
});

describe("getModesForModalSpell — target type branches", () => {
  it("detects target planeswalker", () => {
    const card = createMockCard({
      oracle_text:
        "Choose one —\n• Destroy target planeswalker.\n• Draw a card.",
    });
    const modes = getModesForModalSpell(card)!;
    expect(modes[0].targetTypes).toContain("planeswalker");
  });

  it("detects 'any target'", () => {
    const card = createMockCard({
      oracle_text: "Choose one —\n• Deal damage to any target.\n• Draw a card.",
    });
    const modes = getModesForModalSpell(card)!;
    expect(modes[0].targetTypes).toContain("any");
  });

  it("defaults unspecified 'target' to 'any'", () => {
    const card = createMockCard({
      oracle_text: "Choose one —\n• Destroy target.\n• Draw a card.",
    });
    const modes = getModesForModalSpell(card)!;
    expect(modes[0].targetTypes).toContain("any");
  });
});

describe("getSplitCardHalves — malformed split text", () => {
  it("returns null for a split card whose text has no separator", () => {
    const card = createMockCard({
      layout: "split",
      oracle_text: "Only one half here.",
    });
    expect(getSplitCardHalves(card)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseXCost — default argument branch
// ---------------------------------------------------------------------------
describe("parseXCost — default availableMana argument", () => {
  it("defaults availableMana to 10 when omitted", () => {
    const card = createMockCard({
      mana_cost: "{X}{R}",
      oracle_text: "Deal X damage to any target.",
    });
    const result = parseXCost(card); // no second arg => default 10
    expect(result.hasX).toBe(true);
    expect(result.maxX).toBe(9); // 10 - 1 (red) = 9
  });
});

// ---------------------------------------------------------------------------
// Alternative cost parsers — every keyword + malformed/empty branches
// ---------------------------------------------------------------------------
describe("parseAlternativeCost — keyword branches", () => {
  it("parses Flashback", () => {
    const r = parseAlternativeCost("Flashback {2}{R}");
    expect(r.hasAlternativeCost).toBe(true);
    expect(r.costType).toBe(AlternativeCostType.FLASHBACK);
    expect(r.manaCost).not.toBeNull();
    expect(r.additionalRequirement).toContain("graveyard");
  });

  it("parses Buyback", () => {
    const r = parseAlternativeCost("Buyback {3}");
    expect(r.costType).toBe(AlternativeCostType.BUYBACK);
  });

  it("parses Bestow", () => {
    const r = parseAlternativeCost("Bestow {2}{W}");
    expect(r.costType).toBe(AlternativeCostType.BESTOW);
    expect(r.additionalRequirement).toContain("Aura");
  });

  it("parses Escape (em dash)", () => {
    const r = parseAlternativeCost("Escape—{4}{R}");
    expect(r.costType).toBe(AlternativeCostType.ESCAPE);
  });

  it("parses Spectacle", () => {
    const r = parseAlternativeCost("Spectacle {1}{R}");
    expect(r.costType).toBe(AlternativeCostType.SPECTACLE);
    expect(r.isAvailable).toBe(false);
  });

  it("parses Kicker", () => {
    const r = parseAlternativeCost("Kicker {2}{U}");
    expect(r.costType).toBe(AlternativeCostType.KICKER);
  });

  it("parses Multikicker as KICKER", () => {
    const r = parseAlternativeCost("Multikicker {1}");
    expect(r.hasAlternativeCost).toBe(true);
    expect(r.costType).toBe(AlternativeCostType.KICKER);
    expect(r.description).toContain("Multikicker");
  });

  it("returns no alternative cost for plain text", () => {
    const r = parseAlternativeCost("Deal 3 damage to any target.");
    expect(r.hasAlternativeCost).toBe(false);
    expect(r.costType).toBeNull();
  });

  it("returns no alternative cost for empty text", () => {
    const r = parseAlternativeCost("");
    expect(r.hasAlternativeCost).toBe(false);
  });
});

describe("parseBuyback", () => {
  it("returns empty info for empty text", () => {
    expect(parseBuyback("").hasBuyback).toBe(false);
  });
  it("returns empty info when no buyback is present", () => {
    expect(parseBuyback("Deal 2 damage.").hasBuyback).toBe(false);
  });
  it("parses a buyback cost", () => {
    const r = parseBuyback("Buyback {2}");
    expect(r.hasBuyback).toBe(true);
    expect(r.buybackCost).not.toBeNull();
  });
});

describe("parseFlashback", () => {
  it("returns empty info for empty text", () => {
    expect(parseFlashback("").hasFlashback).toBe(false);
  });
  it("returns empty info when no flashback is present", () => {
    expect(parseFlashback("Draw a card.").hasFlashback).toBe(false);
  });
  it("parses a flashback cost", () => {
    const r = parseFlashback("Flashback {1}{R}");
    expect(r.hasFlashback).toBe(true);
    expect(r.description).toContain("Flashback");
  });
});

describe("parseBestow", () => {
  it("returns empty info for empty text", () => {
    expect(parseBestow("").hasBestow).toBe(false);
  });
  it("returns empty info when no bestow is present", () => {
    expect(parseBestow("Flying.").hasBestow).toBe(false);
  });
  it("parses a bestow cost", () => {
    const r = parseBestow("Bestow {2}{W}");
    expect(r.hasBestow).toBe(true);
    expect(r.bestowCost).not.toBeNull();
  });
});

describe("parsePrototype", () => {
  it("returns empty info for empty text", () => {
    expect(parsePrototype("").hasPrototype).toBe(false);
  });
  it("returns empty info when no prototype is present", () => {
    expect(parsePrototype("Flying, vigilance.").hasPrototype).toBe(false);
  });
  it("parses prototype with an em dash", () => {
    const r = parsePrototype("Prototype {2}{U} — 3/3");
    expect(r.hasPrototype).toBe(true);
    expect(r.prototypePower).toBe(3);
    expect(r.prototypeToughness).toBe(3);
    expect(r.prototypeManaCostParsed).not.toBeNull();
  });
  it("parses prototype with a hyphen separator", () => {
    const r = parsePrototype("Prototype {1}{R}-2/2");
    expect(r.hasPrototype).toBe(true);
    expect(r.prototypePower).toBe(2);
    expect(r.prototypeToughness).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Missing optional fields — exercises the `card.field || ""` default branches
// ---------------------------------------------------------------------------
describe("missing optional card fields", () => {
  it("parseOracleText tolerates an undefined type line", () => {
    const result = parseOracleText(
      createMockCard({ type_line: undefined, oracle_text: "Flying" }),
    );
    expect(result.powerToughness).toBeUndefined();
    expect(result.keywords.length).toBeGreaterThan(0);
  });

  it("isModalSpell / hasFuse / getModesForModalSpell / getSplitCardHalves tolerate undefined oracle text", () => {
    const noText = createMockCard({
      oracle_text: undefined,
      layout: "split",
    });
    expect(isModalSpell(noText)).toBe(false);
    expect(hasFuse(noText)).toBe(false);
    expect(getModesForModalSpell(noText)).toBeNull();
    expect(getSplitCardHalves(noText)).toBeNull();
  });

  it("parseXCost tolerates an undefined oracle text", () => {
    const card = createMockCard({
      mana_cost: "{X}{R}",
      oracle_text: undefined,
    });
    const r = parseXCost(card, 5);
    expect(r.hasX).toBe(true);
    expect(r.description).toBe("Choose a value for X");
  });
});
