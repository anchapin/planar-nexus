/**
 * Unit tests for deck generation helpers extracted from the single-player
 * game page (issue #1715).
 *
 * These lock in the exact shapes/counts the engine's `loadDeckForPlayer`
 * relies on. Behavior-preserving extraction: the assertions document the
 * pre-existing (moved-verbatim) behavior.
 */

import {
  generateSimpleDeck,
  createLandCard,
  createCreatureCard,
  generateStarterDeck,
  generateAIDeck,
  expandDeckCards,
} from "@/lib/deck-generation";
import type { DeckCard } from "@/lib/card-database";
import {
  BASIC_LAND_NAMES,
  getBasicLandManaAbilityByColor,
} from "@/lib/basic-land-data";

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

describe("generateSimpleDeck", () => {
  it("produces a deterministic 60-card deck (24 lands + 36 creatures)", () => {
    const deck = generateSimpleDeck();
    expect(deck).toHaveLength(60);

    const lands = deck.filter((c) => c.type_line === "Basic Land");
    const creatures = deck.filter((c) => c.type_line === "Creature — Bear");
    expect(lands).toHaveLength(24);
    expect(creatures).toHaveLength(36);
  });

  it("cycles the five basic lands (first four get 5 copies, last gets 4)", () => {
    const deck = generateSimpleDeck();
    const lands = deck.filter((c) => c.type_line === "Basic Land");
    const counts = countBy(lands, (c) => c.name);
    BASIC_LAND_NAMES.forEach((name, idx) => {
      expect(counts.get(name)).toBe(idx < 4 ? 5 : 4);
    });
    // Lands appear in cycling order, not grouped
    expect(lands.slice(0, 5).map((c) => c.name)).toEqual(BASIC_LAND_NAMES);
  });

  it("alternates bear names starting with Grizzly Bears", () => {
    const deck = generateSimpleDeck();
    const creatures = deck.filter((c) => c.type_line === "Creature — Bear");
    expect(creatures[0].name).toBe("Grizzly Bears");
    expect(creatures[1].name).toBe("Balduvian Bears");
    expect(creatures[35].name).toBe("Balduvian Bears");
  });

  it("is deterministic across calls", () => {
    expect(generateSimpleDeck()).toEqual(generateSimpleDeck());
  });

  it("emits unique ids", () => {
    const deck = generateSimpleDeck();
    const ids = new Set(deck.map((c) => c.id));
    expect(ids.size).toBe(60);
  });
});

describe("createLandCard", () => {
  it("builds a basic land with color-keyed mana ability", () => {
    const forest = createLandCard("Forest", "G", 3);
    expect(forest.id).toBe("land-Forest-3");
    expect(forest.name).toBe("Forest");
    expect(forest.type_line).toBe("Basic Land");
    expect(forest.mana_cost).toBe("");
    expect(forest.oracle_text).toBe(getBasicLandManaAbilityByColor("G"));
    expect(forest.colors).toEqual([]);
    expect(forest.color_identity).toEqual(["G"]);
    expect(forest.cmc).toBe(0);
    expect(forest.power).toBeUndefined();
    expect(forest.toughness).toBeUndefined();
  });
});

describe("createCreatureCard", () => {
  it("computes CMC from generic and colored symbols", () => {
    const serra = createCreatureCard(
      "Serra Angel",
      "{3}{W}{W}",
      4,
      4,
      ["W"],
      0,
    );
    expect(serra.cmc).toBe(5);
    expect(serra.mana_cost).toBe("{3}{W}{W}");
    expect(serra.power).toBe("4");
    expect(serra.toughness).toBe("4");
    expect(serra.type_line).toBe("Creature");
    expect(serra.colors).toEqual(["W"]);
    expect(serra.color_identity).toEqual(["W"]);
  });

  it("treats zero-cost artifacts-style costs as CMC 0", () => {
    const memnite = createCreatureCard("Memnite", "{0}", 1, 1, [], 2);
    expect(memnite.cmc).toBe(0);
    expect(memnite.id).toBe("creature-Memnite-2");
  });

  it("counts every colored symbol", () => {
    const counterspell = createCreatureCard(
      "Counterspell",
      "{U}{U}",
      0,
      0,
      ["U"],
      1,
    );
    expect(counterspell.cmc).toBe(2);
  });

  it("hyphenates ids from multi-word names", () => {
    const guide = createCreatureCard("Goblin Guide", "{R}", 2, 2, ["R"], 4);
    expect(guide.id).toBe("creature-Goblin-Guide-4");
  });
});

describe("generateStarterDeck", () => {
  it.each([
    [
      "starter-aggro",
      ["Mountain", "Forest"],
      ["Goblin Guide", "Burning-Tree Emissary", "Kird Ape"],
    ],
    [
      "starter-control",
      ["Island", "Plains"],
      ["Cloudfin Raptor", "Wall of Omens", "Serra Angel"],
    ],
    [
      "starter-midrange",
      ["Swamp", "Forest"],
      ["Llanowar Elves", "Balduvian Bears", "Golgari Brownscale"],
    ],
  ])("%s is 60 cards with 12 of each name", (deckId, lands, creatures) => {
    const deck = generateStarterDeck(deckId);
    expect(deck).toHaveLength(60);

    const counts = countBy(deck, (c) => c.name);
    for (const land of lands) expect(counts.get(land)).toBe(12);
    for (const creature of creatures) expect(counts.get(creature)).toBe(12);

    const ids = new Set(deck.map((c) => c.id));
    expect(ids.size).toBe(60);
  });

  it("falls back to the midrange branch for unknown starter ids", () => {
    const deck = generateStarterDeck("starter-unknown");
    expect(deck).toHaveLength(60);
    const counts = countBy(deck, (c) => c.name);
    expect(counts.get("Swamp")).toBe(12);
    expect(counts.get("Llanowar Elves")).toBe(12);
  });

  describe("starter-test fixture deck", () => {
    const deck = generateStarterDeck("starter-test");

    it("has the expected fixture size (70 filler + 45 setup + 7 opening hand)", () => {
      expect(deck).toHaveLength(122);
    });

    it("ends with the scripted 7-card opening hand order", () => {
      const names = deck.slice(-7).map((c) => c.name);
      expect(names).toEqual([
        "Forest",
        "Mountain",
        "Ward Beetle",
        "Cycling Drake",
        "Explore Ranger",
        "Flashback Bolt",
        "Convoke Angel",
      ]);
    });

    it("has unique ids despite repeated names", () => {
      const ids = new Set(deck.map((c) => c.id));
      expect(ids.size).toBe(122);
    });
  });

  it("is deterministic across calls", () => {
    expect(generateStarterDeck("starter-aggro")).toEqual(
      generateStarterDeck("starter-aggro"),
    );
  });
});

describe("generateAIDeck", () => {
  it.each([
    ["Red Aggro Burn", "Goblin Guide"],
    ["Aggressive Theme", "Kird Ape"],
    ["aggro", "Burning-Tree Emissary"],
  ])("maps %s to the aggro starter deck", (theme, marker) => {
    const deck = generateAIDeck(theme, "medium");
    expect(deck.map((c) => c.name)).toContain(marker);
  });

  it.each([
    ["Blue Control", "Cloudfin Raptor"],
    ["control", "Serra Angel"],
  ])("maps %s to the control starter deck", (theme, marker) => {
    const deck = generateAIDeck(theme, "medium");
    expect(deck.map((c) => c.name)).toContain(marker);
  });

  it.each([
    ["Green Midrange", "Llanowar Elves"],
    ["midrange", "Golgari Brownscale"],
  ])("maps %s to the midrange starter deck", (theme, marker) => {
    const deck = generateAIDeck(theme, "medium");
    expect(deck.map((c) => c.name)).toContain(marker);
  });

  it("falls back to the simple demo deck for unmatched themes", () => {
    const deck = generateAIDeck("Zombie Tribal", "medium");
    expect(deck).toHaveLength(60);
    expect(deck.map((c) => c.name)).toContain("Grizzly Bears");
  });

  it("ignores the difficulty argument (deck shape does not depend on it)", () => {
    expect(generateAIDeck("aggro", "easy")).toEqual(
      generateAIDeck("aggro", "expert"),
    );
  });
});

describe("expandDeckCards", () => {
  const bear = createCreatureCard("Grizzly Bears", "{1}{G}", 2, 2, ["G"], 0);
  const bolt = createCreatureCard("Lightning Bolt", "{R}", 3, 0, ["R"], 0);

  it("expands counts into individual copies with suffixed ids", () => {
    const deckCards: DeckCard[] = [
      { ...bear, count: 3 },
      { ...bolt, count: 2 },
    ];
    const expanded = expandDeckCards(deckCards);
    expect(expanded).toHaveLength(5);

    const bearIds = expanded
      .filter((c) => c.name === "Grizzly Bears")
      .map((c) => c.id);
    expect(bearIds).toEqual([`${bear.id}-0`, `${bear.id}-1`, `${bear.id}-2`]);

    const boltIds = expanded
      .filter((c) => c.name === "Lightning Bolt")
      .map((c) => c.id);
    expect(boltIds).toEqual([`${bolt.id}-0`, `${bolt.id}-1`]);
  });

  it("preserves all other card fields on each copy", () => {
    // Note: the spread copies the DeckCard wholesale, so `count` rides along
    // on each expanded ScryfallCard (pre-existing behavior, harmless extra).
    const expanded = expandDeckCards([{ ...bear, count: 1 }]);
    expect(expanded[0]).toEqual({ ...bear, count: 1, id: `${bear.id}-0` });
  });

  it("returns an empty array for an empty deck", () => {
    expect(expandDeckCards([])).toEqual([]);
  });
});
