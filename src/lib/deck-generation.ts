/**
 * Deck generation for the single-player game page.
 *
 * Extracted verbatim from `src/app/(app)/game/[id]/page.tsx` (issue #1715).
 * These builders construct demo/starter/AI decks as `ScryfallCard[]` for the
 * engine's `loadDeckForPlayer`, and expand persisted `DeckCard[]` (with
 * counts) into individual card entries.
 *
 * Behavior-preserving move: bodies are unchanged from the page version.
 */

import type { ScryfallCard, SavedDeck } from "@/lib/card-database";
import type { DifficultyLevel } from "@/ai/ai-difficulty";
import {
  BASIC_LAND_NAMES,
  getBasicLandColor,
  getBasicLandManaAbility,
  getBasicLandManaAbilityByColor,
} from "@/lib/basic-land-data";

/**
 * Generate a simple deck for testing/demo purposes
 * In a real implementation, this would use the player's actual deck
 */
export function generateSimpleDeck(): ScryfallCard[] {
  const deck: ScryfallCard[] = [];

  // 24 basic lands (even distribution)
  for (let i = 0; i < 24; i++) {
    const landName = BASIC_LAND_NAMES[i % 5];
    deck.push({
      id: `land-${i}`,
      name: landName,
      type_line: "Basic Land",
      mana_cost: "",
      oracle_text: getBasicLandManaAbility(landName),
      colors: [],
      color_identity: [getBasicLandColor(landName)],
      legalities: { standard: "legal", modern: "legal", commander: "legal" },
      images: { normal: "", art_crop: "" },
      cmc: 0,
      power: undefined,
      toughness: undefined,
    } as ScryfallCard);
  }

  // 36 creature spells (simple bears for demo)
  for (let i = 0; i < 36; i++) {
    const isGrizzly = i % 2 === 0;
    deck.push({
      id: `creature-${i}`,
      name: isGrizzly ? "Grizzly Bears" : "Balduvian Bears",
      type_line: "Creature — Bear",
      mana_cost: "{1}{G}",
      oracle_text: "",
      colors: ["G"],
      color_identity: ["G"],
      legalities: { standard: "legal", modern: "legal", commander: "legal" },
      images: { normal: "", art_crop: "" },
      cmc: 2,
      power: "2",
      toughness: "2",
    } as ScryfallCard);
  }

  return deck;
}

/**
 * Helper to create a basic land card
 */
export function createLandCard(
  name: string,
  color: string,
  index: number,
): ScryfallCard {
  return {
    id: `land-${name}-${index}`,
    name,
    type_line: "Basic Land",
    mana_cost: "",
    oracle_text: getBasicLandManaAbilityByColor(color),
    colors: [],
    color_identity: [color],
    legalities: { standard: "legal", modern: "legal", commander: "legal" },
    images: { normal: "", art_crop: "" },
    cmc: 0,
    power: undefined,
    toughness: undefined,
  } as ScryfallCard;
}

/**
 * Helper to create a creature card
 */
export function createCreatureCard(
  name: string,
  manaCost: string,
  power: number,
  toughness: number,
  colors: string[],
  index: number,
): ScryfallCard {
  // Simple CMC calculation from mana cost
  let cmc = 0;
  const matches = manaCost.match(/\{([^}]+)\}/g);
  if (matches) {
    for (const m of matches) {
      const symbol = m.slice(1, -1);
      const num = parseInt(symbol, 10);
      cmc += isNaN(num) ? 1 : num;
    }
  }

  return {
    id: `creature-${name.replace(/\s+/g, "-")}-${index}`,
    name,
    type_line: "Creature",
    mana_cost: manaCost,
    oracle_text: "",
    colors,
    color_identity: colors,
    legalities: { standard: "legal", modern: "legal", commander: "legal" },
    images: { normal: "", art_crop: "" },
    cmc,
    power: power.toString(),
    toughness: toughness.toString(),
  } as ScryfallCard;
}

/**
 * Generate a themed starter deck based on deck ID
 */
export function generateStarterDeck(deckId: string): ScryfallCard[] {
  const deck: ScryfallCard[] = [];

  if (deckId === "starter-aggro") {
    // 24 lands: 12 Mountain, 12 Forest
    for (let i = 0; i < 12; i++) deck.push(createLandCard("Mountain", "R", i));
    for (let i = 0; i < 12; i++) deck.push(createLandCard("Forest", "G", i));
    // 36 aggressive creatures
    for (let i = 0; i < 12; i++)
      deck.push(createCreatureCard("Goblin Guide", "{R}", 2, 2, ["R"], i));
    for (let i = 0; i < 12; i++)
      deck.push(
        createCreatureCard(
          "Burning-Tree Emissary",
          "{R}{G}",
          2,
          2,
          ["R", "G"],
          i,
        ),
      );
    for (let i = 0; i < 12; i++)
      deck.push(createCreatureCard("Kird Ape", "{R}", 1, 1, ["R"], i));
  } else if (deckId === "starter-control") {
    // 24 lands: 12 Island, 12 Plains
    for (let i = 0; i < 12; i++) deck.push(createLandCard("Island", "U", i));
    for (let i = 0; i < 12; i++) deck.push(createLandCard("Plains", "W", i));
    // 36 control creatures
    for (let i = 0; i < 12; i++)
      deck.push(createCreatureCard("Cloudfin Raptor", "{U}", 0, 1, ["U"], i));
    for (let i = 0; i < 12; i++)
      deck.push(createCreatureCard("Wall of Omens", "{1}{W}", 0, 4, ["W"], i));
    for (let i = 0; i < 12; i++)
      deck.push(createCreatureCard("Serra Angel", "{3}{W}{W}", 4, 4, ["W"], i));
  } else if (deckId === "starter-test") {
    // Bulk filler cards first (drawn after opening hand)
    for (let i = 0; i < 10; i++) deck.push(createLandCard("Mountain", "R", i));
    for (let i = 0; i < 10; i++) deck.push(createLandCard("Island", "U", i));
    for (let i = 0; i < 10; i++) deck.push(createLandCard("Forest", "G", i));
    for (let i = 0; i < 10; i++)
      deck.push(createCreatureCard("Goblin Guide", "{R}", 2, 2, ["R"], i));
    for (let i = 0; i < 10; i++)
      deck.push(createCreatureCard("Memnite", "{0}", 1, 1, [], i));
    for (let i = 0; i < 10; i++)
      deck.push(createCreatureCard("Counterspell", "{U}{U}", 0, 0, ["U"], i));
    for (let i = 0; i < 10; i++)
      deck.push(createCreatureCard("Lightning Bolt", "{R}", 3, 0, ["R"], i));
    // Test-specific cards last (opening hand = last 7 of array, drawn from end)
    // Arrange so last 7 cards are: Forest, Mountain, Ward Beetle, Cycling Drake, Explore Ranger, Flashback Bolt, Convoke Angel
    for (let i = 0; i < 9; i++)
      deck.push(createCreatureCard("Ward Beetle", "{1}{G}", 2, 3, ["G"], i));
    for (let i = 0; i < 9; i++)
      deck.push(createCreatureCard("Cycling Drake", "{3}{U}", 2, 4, ["U"], i));
    for (let i = 0; i < 9; i++)
      deck.push(createCreatureCard("Explore Ranger", "{1}{G}", 2, 2, ["G"], i));
    for (let i = 0; i < 9; i++)
      deck.push(createCreatureCard("Convoke Angel", "{3}{W}", 3, 3, ["W"], i));
    for (let i = 0; i < 9; i++)
      deck.push(createCreatureCard("Flashback Bolt", "{1}{R}", 2, 1, ["R"], i));
    // Ensure opening hand (drawn last = end of array): Forest, Mountain, Ward Beetle, Cycling Drake, Explore Ranger, Flashback Bolt, Convoke Angel
    deck.push(createLandCard("Forest", "G", 99));
    deck.push(createLandCard("Mountain", "R", 99));
    deck.push(createCreatureCard("Ward Beetle", "{1}{G}", 2, 3, ["G"], 99));
    deck.push(createCreatureCard("Cycling Drake", "{3}{U}", 2, 4, ["U"], 99));
    deck.push(createCreatureCard("Explore Ranger", "{1}{G}", 2, 2, ["G"], 99));
    deck.push(createCreatureCard("Flashback Bolt", "{1}{R}", 2, 1, ["R"], 99));
    deck.push(createCreatureCard("Convoke Angel", "{3}{W}", 3, 3, ["W"], 99));
  } else {
    // starter-midrange: 12 Swamp, 12 Forest
    for (let i = 0; i < 12; i++) deck.push(createLandCard("Swamp", "B", i));
    for (let i = 0; i < 12; i++) deck.push(createLandCard("Forest", "G", i));
    // 36 midrange creatures
    for (let i = 0; i < 12; i++)
      deck.push(createCreatureCard("Llanowar Elves", "{G}", 1, 1, ["G"], i));
    for (let i = 0; i < 12; i++)
      deck.push(
        createCreatureCard("Balduvian Bears", "{1}{G}", 2, 2, ["G"], i),
      );
    for (let i = 0; i < 12; i++)
      deck.push(
        createCreatureCard("Golgari Brownscale", "{1}{G}{G}", 2, 3, ["G"], i),
      );
  }

  return deck;
}

/**
 * Generate an AI deck based on theme and difficulty
 */
export function generateAIDeck(
  theme: string,
  _difficulty: DifficultyLevel,
): ScryfallCard[] {
  const lowerTheme = theme.toLowerCase();
  if (
    lowerTheme.includes("aggro") ||
    lowerTheme.includes("red") ||
    lowerTheme.includes("aggressive")
  ) {
    return generateStarterDeck("starter-aggro");
  }
  if (lowerTheme.includes("control") || lowerTheme.includes("blue")) {
    return generateStarterDeck("starter-control");
  }
  if (lowerTheme.includes("midrange") || lowerTheme.includes("green")) {
    return generateStarterDeck("starter-midrange");
  }
  return generateSimpleDeck();
}

/**
 * Expand DeckCard[] (with count) into individual ScryfallCard[] for the engine
 */
export function expandDeckCards(deckCards: SavedDeck["cards"]): ScryfallCard[] {
  const expanded: ScryfallCard[] = [];
  for (const card of deckCards) {
    for (let i = 0; i < card.count; i++) {
      // Create a unique ID for each copy
      const copy: ScryfallCard = {
        ...card,
        id: `${card.id}-${i}`,
      };
      expanded.push(copy);
    }
  }
  return expanded;
}
