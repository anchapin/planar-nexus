/**
 * Test Fixtures for Card Database
 *
 * Provides standardized test data for card database tests.
 * These fixtures ensure consistent, repeatable test execution.
 */

import type { MinimalCard } from "../card-database";

export type Card = MinimalCard;

/**
 * Minimal card fixture for basic testing
 */
export const basicCard: Card = {
  id: "test-001",
  name: "Test Creature",
  mana_cost: "{2}{R}",
  cmc: 3,
  type_line: "Creature — Human Warrior",
  oracle_text:
    "Haste\nWhen Test Creature enters the battlefield, it deals 1 damage to any target.",
  colors: ["R"],
  color_identity: ["R"],
  rarity: "U",
  set: "TEST",
  collector_number: "001",
  power: "3",
  toughness: "2",
  legalities: {
    commander: "legal",
    standard: "not_legal",
    modern: "legal",
    legacy: "legal",
    vintage: "legal",
  },
};

/**
 * Complete fixture set for comprehensive testing
 */
export const testCards: Card[] = [
  // Basic Lands
  {
    id: "test-002",
    name: "Plains",
    mana_cost: "",
    cmc: 0,
    type_line: "Land — Plains",
    oracle_text: "({T}: Add {W})",
    colors: [],
    color_identity: ["W"],
    rarity: "L",
    set: "TEST",
    collector_number: "002",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },
  {
    id: "test-003",
    name: "Island",
    mana_cost: "",
    cmc: 0,
    type_line: "Land — Island",
    oracle_text: "({T}: Add {U})",
    colors: [],
    color_identity: ["U"],
    rarity: "L",
    set: "TEST",
    collector_number: "003",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },
  {
    id: "test-004",
    name: "Swamp",
    mana_cost: "",
    cmc: 0,
    type_line: "Land — Swamp",
    oracle_text: "({T}: Add {B})",
    colors: [],
    color_identity: ["B"],
    rarity: "L",
    set: "TEST",
    collector_number: "004",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },
  {
    id: "test-005",
    name: "Mountain",
    mana_cost: "",
    cmc: 0,
    type_line: "Land — Mountain",
    oracle_text: "({T}: Add {R})",
    colors: [],
    color_identity: ["R"],
    rarity: "L",
    set: "TEST",
    collector_number: "005",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },
  {
    id: "test-006",
    name: "Forest",
    mana_cost: "",
    cmc: 0,
    type_line: "Land — Forest",
    oracle_text: "({T}: Add {G})",
    colors: [],
    color_identity: ["G"],
    rarity: "L",
    set: "TEST",
    collector_number: "006",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },

  // White Cards
  {
    id: "test-007",
    name: "Test Angel",
    mana_cost: "{3}{W}{W}",
    cmc: 5,
    type_line: "Creature — Angel",
    oracle_text:
      "Flying, vigilance\nWhen Test Angel enters the battlefield, you gain 4 life.",
    colors: ["W"],
    color_identity: ["W"],
    rarity: "R",
    set: "TEST",
    collector_number: "007",
    power: "4",
    toughness: "4",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },
  {
    id: "test-008",
    name: "Test Knight",
    mana_cost: "{2}{W}",
    cmc: 3,
    type_line: "Creature — Knight",
    oracle_text: "First strike\nOther Knight creatures you control get +1/+1.",
    colors: ["W"],
    color_identity: ["W"],
    rarity: "U",
    set: "TEST",
    collector_number: "008",
    power: "2",
    toughness: "2",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },

  // Blue Cards
  {
    id: "test-009",
    name: "Test Wizard",
    mana_cost: "{2}{U}{U}",
    cmc: 4,
    type_line: "Creature — Wizard",
    oracle_text: "When Test Wizard enters the battlefield, draw two cards.",
    colors: ["U"],
    color_identity: ["U"],
    rarity: "R",
    set: "TEST",
    collector_number: "009",
    power: "3",
    toughness: "3",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },
  {
    id: "test-010",
    name: "Test Counterspell",
    mana_cost: "{1}{U}",
    cmc: 2,
    type_line: "Instant",
    oracle_text:
      "Counter target creature spell unless its controller pays {3}.",
    colors: ["U"],
    color_identity: ["U"],
    rarity: "C",
    set: "TEST",
    collector_number: "010",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },

  // Black Cards
  {
    id: "test-011",
    name: "Test Demon",
    mana_cost: "{4}{B}{B}",
    cmc: 6,
    type_line: "Creature — Demon",
    oracle_text:
      "Flying\nAt the beginning of your upkeep, sacrifice a creature.",
    colors: ["B"],
    color_identity: ["B"],
    rarity: "M",
    set: "TEST",
    collector_number: "011",
    power: "6",
    toughness: "6",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },
  {
    id: "test-012",
    name: "Test Zombie",
    mana_cost: "{1}{B}",
    cmc: 2,
    type_line: "Creature — Zombie",
    oracle_text:
      "When Test Zombie dies, create a 2/2 black Zombie creature token.",
    colors: ["B"],
    color_identity: ["B"],
    rarity: "C",
    set: "TEST",
    collector_number: "012",
    power: "2",
    toughness: "2",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },

  // Red Cards
  {
    id: "test-013",
    name: "Test Dragon",
    mana_cost: "{4}{R}{R}",
    cmc: 6,
    type_line: "Creature — Dragon",
    oracle_text:
      "Flying, haste\nWhen Test Dragon enters the battlefield, it deals 3 damage to each opponent.",
    colors: ["R"],
    color_identity: ["R"],
    rarity: "R",
    set: "TEST",
    collector_number: "013",
    power: "5",
    toughness: "5",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },
  basicCard, // Test Creature

  // Green Cards
  {
    id: "test-014",
    name: "Test Beast",
    mana_cost: "{3}{G}{G}",
    cmc: 5,
    type_line: "Creature — Beast",
    oracle_text: "Trample\nWhen Test Beast enters the battlefield, populate.",
    colors: ["G"],
    color_identity: ["G"],
    rarity: "U",
    set: "TEST",
    collector_number: "014",
    power: "5",
    toughness: "5",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },
  {
    id: "test-015",
    name: "Test Elf",
    mana_cost: "{G}",
    cmc: 1,
    type_line: "Creature — Elf Druid",
    oracle_text:
      "{T}: Add {G}{G}. Spend this mana only to cast creature spells.",
    colors: ["G"],
    color_identity: ["G"],
    rarity: "C",
    set: "TEST",
    collector_number: "015",
    power: "1",
    toughness: "1",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },

  // Multicolor Cards
  {
    id: "test-016",
    name: "Test Hero",
    mana_cost: "{W}{U}{B}",
    cmc: 3,
    type_line: "Creature — Human Advisor",
    oracle_text:
      "{T}: Look at the top three cards of your library. Put one into your hand and the rest into your graveyard.",
    colors: ["W", "U", "B"],
    color_identity: ["W", "U", "B"],
    rarity: "R",
    set: "TEST",
    collector_number: "016",
    power: "2",
    toughness: "2",
    legalities: {
      commander: "legal",
      standard: "not_legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },

  // Artifact Cards
  {
    id: "test-017",
    name: "Test Equipment",
    mana_cost: "{3}",
    cmc: 3,
    type_line: "Artifact — Equipment",
    oracle_text:
      "Equipped creature gets +2/+2 and has first strike.\nEquip {2}",
    colors: [],
    color_identity: [],
    rarity: "U",
    set: "TEST",
    collector_number: "017",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },

  // Enchantment Cards
  {
    id: "test-018",
    name: "Test Aura",
    mana_cost: "{2}{W}",
    cmc: 3,
    type_line: "Enchantment — Aura",
    oracle_text:
      "Enchant creature\nEnchanted creature gets +2/+2 and has vigilance.",
    colors: ["W"],
    color_identity: ["W"],
    rarity: "C",
    set: "TEST",
    collector_number: "018",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },

  // Sorcery Cards
  {
    id: "test-019",
    name: "Test Sorcery",
    mana_cost: "{3}{R}",
    cmc: 4,
    type_line: "Sorcery",
    oracle_text: "Test Sorcery deals 4 damage to any target.",
    colors: ["R"],
    color_identity: ["R"],
    rarity: "C",
    set: "TEST",
    collector_number: "019",
    legalities: {
      commander: "legal",
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
    },
  },
];

/**
 * Sample deck for testing import/export functionality
 */
export const sampleDeck = {
  name: "Test Aggro Deck",
  format: "Standard",
  cards: [
    { card: testCards[5], quantity: 4 }, // Test Angel
    { card: testCards[6], quantity: 4 }, // Test Knight
    { card: testCards[13], quantity: 4 }, // Test Elf
    { card: testCards[11], quantity: 4 }, // Test Dragon
    { card: testCards[0], quantity: 4 }, // Plains
    { card: testCards[4], quantity: 4 }, // Forest
  ],
  sideboard: [],
};

/**
 * Creates a deep copy of a card fixture
 * Useful for tests that need to modify card properties
 */
export function createCardCopy(card: Card): Card {
  return JSON.parse(JSON.stringify(card));
}

/**
 * Creates a shuffled copy of the test card array
 * Useful for testing search and sorting functionality
 */
export function createShuffledDeck(): Card[] {
  const shuffled = [...testCards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Filters test cards by color
 */
export function getCardsByColor(color: string): Card[] {
  return testCards.filter((card) => card.colors?.includes(color));
}

/**
 * Filters test cards by type
 */
export function getCardsByType(type: string): Card[] {
  return testCards.filter((card) => card.type_line?.includes(type));
}

/**
 * Filters test cards by mana value (CMC) range
 */
export function getCardsByCmcRange(min: number, max: number): Card[] {
  return testCards.filter((card) => card.cmc >= min && card.cmc <= max);
}

// ============================================================================
// M21 Set Cards for Draft/Sealed Testing
// ============================================================================

/**
 * M21 set cards for draft and sealed testing.
 * Required: 10+ commons + 3+ uncommons per pack generation.
 */
export const m21TestCards: Card[] = [
  // 10 Commons
  {
    id: "m21-001",
    name: "Soldier",
    mana_cost: "{W}",
    cmc: 1,
    type_line: "Creature — Human Soldier",
    oracle_text: "Vigilance",
    colors: ["W"],
    color_identity: ["W"],
    rarity: "common",
    set: "M21",
    collector_number: "001",
    power: "1",
    toughness: "1",
    legalities: { commander: "legal" },
  },
  {
    id: "m21-002",
    name: "Pouncing Span",
    mana_cost: "{1}{G}",
    cmc: 3,
    type_line: "Creature — Cat",
    oracle_text:
      "Trample\nWhen Pouncing Span enters the battlefield, you may have it fight up to one target creature.",
    colors: ["G"],
    color_identity: ["G"],
    rarity: "common",
    set: "M21",
    collector_number: "002",
    power: "3",
    toughness: "2",
    legalities: { commander: "legal" },
  },
  {
    id: "m21-003",
    name: "Water Elemental",
    mana_cost: "{2}{U}",
    cmc: 4,
    type_line: "Elemental",
    oracle_text: "",
    colors: ["U"],
    color_identity: ["U"],
    rarity: "common",
    set: "M21",
    collector_number: "003",
    power: "3",
    toughness: "3",
    legalities: { commander: "legal" },
  },
  {
    id: "m21-004",
    name: "Bloodprice Executioner",
    mana_cost: "{1}{B}{B}",
    cmc: 3,
    type_line: "Creature — Vampire Knight",
    oracle_text:
      "When Bloodprice Executioner enters the battlefield, it deals 1 damage to any target.",
    colors: ["B"],
    color_identity: ["B"],
    rarity: "common",
    set: "M21",
    collector_number: "004",
    power: "3",
    toughness: "2",
    legalities: { commander: "legal" },
  },
  {
    id: "m21-005",
    name: "Pyre Spider",
    mana_cost: "{2}{R}",
    cmc: 4,
    type_line: "Creature — Spider",
    oracle_text:
      "Reach\nWhen Pyre Spider enters the battlefield, it deals 2 damage to any target.",
    colors: ["R"],
    color_identity: ["R"],
    rarity: "common",
    set: "M21",
    collector_number: "005",
    power: "2",
    toughness: "3",
    legalities: { commander: "legal" },
  },
  {
    id: "m21-006",
    name: "Silverflame Paladin",
    mana_cost: "{2}{W}",
    cmc: 4,
    type_line: "Creature — Human Knight",
    oracle_text:
      "When Silverflame Paladin enters the battlefield, it gets +2/+2 until end of turn.",
    colors: ["W"],
    color_identity: ["W"],
    rarity: "common",
    set: "M21",
    collector_number: "006",
    power: "2",
    toughness: "2",
    legalities: { commander: "legal" },
  },
  {
    id: "m21-007",
    name: "Deepwood Trapper",
    mana_cost: "{1}{G}",
    cmc: 2,
    type_line: "Creature — Elf Scout",
    oracle_text: "",
    colors: ["G"],
    color_identity: ["G"],
    rarity: "common",
    set: "M21",
    collector_number: "007",
    power: "2",
    toughness: "1",
    legalities: { commander: "legal" },
  },
  {
    id: "m21-008",
    name: "Dive In",
    mana_cost: "{U}",
    cmc: 1,
    type_line: "Instant",
    oracle_text: "Draw a card.",
    colors: ["U"],
    color_identity: ["U"],
    rarity: "common",
    set: "M21",
    collector_number: "008",
    legalities: { commander: "legal" },
  },
  {
    id: "m21-009",
    name: "Fire Ants",
    mana_cost: "{1}{R}",
    cmc: 2,
    type_line: "Creature — Insect",
    oracle_text:
      "Haste\nWhen Fire Ants enters the battlefield, it deals 1 damage to any target.",
    colors: ["R"],
    color_identity: ["R"],
    rarity: "common",
    set: "M21",
    collector_number: "009",
    power: "1",
    toughness: "3",
    legalities: { commander: "legal" },
  },
  {
    id: "m21-010",
    name: "Gloomhunter",
    mana_cost: "{3}{B}",
    cmc: 4,
    type_line: "Creature — Shade",
    oracle_text:
      "When Gloomhunter enters the battlefield, you may sacrifice a creature.",
    colors: ["B"],
    color_identity: ["B"],
    rarity: "common",
    set: "M21",
    collector_number: "010",
    power: "4",
    toughness: "3",
    legalities: { commander: "legal" },
  },
  // Uncommons (3+)
  {
    id: "m21-011",
    name: "Stormclaw Dragon",
    mana_cost: "{3}{R}{R}",
    cmc: 5,
    type_line: "Dragon",
    oracle_text:
      "Flying, trample\nWhen Stormclaw Dragon enters the battlefield, it deals 2 damage to any target.",
    colors: ["R"],
    color_identity: ["R"],
    rarity: "uncommon",
    set: "M21",
    collector_number: "011",
    power: "4",
    toughness: "4",
    legalities: { commander: "legal" },
  },
  {
    id: "m21-012",
    name: "Archon of Sun's Grace",
    mana_cost: "{2}{W}{W}",
    cmc: 4,
    type_line: "Enchantment Creature — Archon",
    oracle_text:
      "When Archon of Sun's Grace enters the battlefield, you gain 3 life.",
    colors: ["W"],
    color_identity: ["W"],
    rarity: "uncommon",
    set: "M21",
    collector_number: "012",
    power: "3",
    toughness: "3",
    legalities: { commander: "legal" },
  },
  {
    id: "m21-013",
    name: "Vengeful Rephaos",
    mana_cost: "{3}{U}{B}",
    cmc: 5,
    type_line: "Creature — Spirit",
    oracle_text:
      "When Vengeful Rephaos enters the battlefield, you gain 2 life.",
    colors: ["U", "B"],
    color_identity: ["U", "B"],
    rarity: "uncommon",
    set: "M21",
    collector_number: "013",
    power: "4",
    toughness: "3",
    legalities: { commander: "legal" },
  },
  // Rare
  {
    id: "m21-014",
    name: "Basilika Snake",
    mana_cost: "{3}{G}{G}",
    cmc: 5,
    type_line: "Creature — Snake",
    oracle_text:
      "Reach\nWhen Basilika Snake enters the battlefield, it deals 3 damage to any target.",
    colors: ["G"],
    color_identity: ["G"],
    rarity: "rare",
    set: "M21",
    collector_number: "014",
    power: "5",
    toughness: "5",
    legalities: { commander: "legal" },
  },
];
