/**
 * Unit tests for custom game mode creation
 * Tests the new generic format system that allows creating custom formats without code changes
 */

import {
  createGameMode,
  registerGameMode,
  validateDeckFormat,
  getGameMode,
  getAllGameModes,
  findGameModeByName,
  getFormatDisplayName,
  DEFAULT_RULES,
  type Format,
} from "../game-rules";

describe("Custom Game Modes - Creation", () => {
  beforeEach(() => {
    // Clean up any custom modes registered during tests
    // Note: This is a simplification - in production, you'd want proper cleanup
  });

  it("should create a custom game mode with unique rules", () => {
    const customMode = createGameMode({
      name: "Turbo Format",
      description: "Fast-paced format with 30-card decks",
      deckRules: {
        ...DEFAULT_RULES.constructed,
        minCards: 30,
        maxCards: 30,
        startingLife: 15,
      },
      rules: [
        "30 cards exactly",
        "Maximum 4 copies of each card",
        "15 starting life",
        "No sideboard",
      ],
    });

    expect(customMode.id).toBe("turbo-format");
    expect(customMode.name).toBe("Turbo Format");
    expect(customMode.deckRules.minCards).toBe(30);
    expect(customMode.deckRules.startingLife).toBe(15);
  });

  it("should create a commander-style format with custom life total", () => {
    const customMode = createGameMode({
      name: "Tiny Commander",
      description: "Commander format with 50-card decks",
      deckRules: {
        ...DEFAULT_RULES.singleCommander,
        minCards: 50,
        maxCards: 50,
        startingLife: 30,
        commanderDamage: 15,
      },
      rules: [
        "50 cards exactly (including commander)",
        "Maximum 1 copy of each card",
        "30 starting life",
        "15 commander damage eliminates a player",
      ],
    });

    expect(customMode.id).toBe("tiny-commander");
    expect(customMode.deckRules.minCards).toBe(50);
    expect(customMode.deckRules.startingLife).toBe(30);
    expect(customMode.deckRules.commanderDamage).toBe(15);
  });

  it("should create a format with custom ban list", () => {
    const customMode = createGameMode({
      name: "No Sol Ring Format",
      description: "Constructed format without Sol Ring",
      deckRules: DEFAULT_RULES.constructed,
      rules: [
        "Standard constructed rules",
        "Sol Ring is banned",
      ],
      banList: ["sol ring"],
    });

    expect(customMode.banList).toContain("sol ring");
  });

  it("should create a format with restricted list", () => {
    const customMode = createGameMode({
      name: "Vintage Lite",
      description: "Vintage format with fewer restrictions",
      deckRules: DEFAULT_RULES.constructed,
      rules: [
        "Vintage-style format",
        "Some cards restricted to 1 copy",
      ],
      restrictedList: ["black lotus", "ancestral recall"],
    });

    expect(customMode.restrictedList).toContain("black lotus");
    expect(customMode.restrictedList).toContain("ancestral recall");
  });

  it("should handle special characters in format name", () => {
    const customMode = createGameMode({
      name: "Test@Format!",
      description: "Test",
      deckRules: DEFAULT_RULES.constructed,
      rules: [],
    });

    expect(customMode.id).toBe("testformat");
  });
});

describe("Custom Game Modes - Registration", () => {
  it("should register and retrieve a custom game mode", () => {
    const customMode = createGameMode({
      name: "My Custom Format",
      description: "A custom format I created",
      deckRules: DEFAULT_RULES.constructed,
      rules: ["Custom rule 1"],
    });

    registerGameMode(customMode);

    const retrieved = getGameMode("my-custom-format");
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe("My Custom Format");
  });

  it("should list all game modes including custom ones", () => {
    const customMode = createGameMode({
      name: "Custom One",
      description: "First custom",
      deckRules: DEFAULT_RULES.constructed,
      rules: [],
    });

    registerGameMode(customMode);

    const modes = getAllGameModes();
    const customModes = modes.filter((m) => m.id === "custom-one");

    expect(customModes.length).toBeGreaterThan(0);
  });

  it("should find game mode by name (case-insensitive)", () => {
    const customMode = createGameMode({
      name: "Case Test Format",
      description: "Test",
      deckRules: DEFAULT_RULES.constructed,
      rules: [],
    });

    registerGameMode(customMode);

    const found = findGameModeByName("CASE TEST FORMAT");
    expect(found).toBeDefined();
    expect(found?.id).toBe("case-test-format");
  });
});

describe("Custom Game Modes - Validation", () => {
  it("should validate decks against custom format rules", () => {
    const customMode = createGameMode({
      name: "Mini Deck",
      description: "Small deck format",
      deckRules: {
        ...DEFAULT_RULES.constructed,
        minCards: 30,
        maxCards: 30,
      },
      rules: ["30 cards exactly"],
    });

    registerGameMode(customMode);

    const deck = Array(30).fill({ name: "Forest", count: 1 });
    const result = validateDeckFormat(deck, "mini-deck" as Format);

    expect(result.isValid).toBe(true);
    expect(result.deckSize).toBe(30);
  });

  it("should reject decks that don't meet custom format requirements", () => {
    const customMode = createGameMode({
      name: "Mini Deck",
      description: "Small deck format",
      deckRules: {
        ...DEFAULT_RULES.constructed,
        minCards: 30,
        maxCards: 30,
      },
      rules: ["30 cards exactly"],
    });

    registerGameMode(customMode);

    const deck = Array(60).fill({ name: "Forest", count: 1 });
    const result = validateDeckFormat(deck, "mini-deck" as Format);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Deck must have at most 30 cards (has 60)");
  });

  it("should enforce custom ban lists", () => {
    const customMode = createGameMode({
      name: "No Sol Ring",
      description: "Format without Sol Ring",
      deckRules: DEFAULT_RULES.constructed,
      rules: ["Sol Ring is banned"],
      banList: ["sol ring"],
    });

    registerGameMode(customMode);

    const deck = [
      { name: "Sol Ring", count: 4 },
      ...Array(56).fill({ name: "Forest", count: 1 }),
    ];
    const result = validateDeckFormat(deck, "no-sol-ring" as Format);

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("sol ring is banned"))).toBe(true);
  });

  it("should enforce custom restricted lists", () => {
    const customMode = createGameMode({
      name: "Restricted Vintage",
      description: "Vintage with custom restrictions",
      deckRules: DEFAULT_RULES.constructed,
      rules: ["Black Lotus restricted to 1 copy"],
      restrictedList: ["black lotus"],
    });

    registerGameMode(customMode);

    const deck = [
      { name: "Black Lotus", count: 2 },
      ...Array(58).fill({ name: "Forest", count: 1 }),
    ];
    const result = validateDeckFormat(deck, "restricted-vintage" as Format);

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("restricted"))).toBe(true);
  });

  it("should allow 1 copy of restricted card in custom format", () => {
    const customMode = createGameMode({
      name: "Restricted Vintage",
      description: "Vintage with custom restrictions",
      deckRules: DEFAULT_RULES.constructed,
      rules: ["Black Lotus restricted to 1 copy"],
      restrictedList: ["black lotus"],
    });

    registerGameMode(customMode);

    const deck = [
      { name: "Black Lotus", count: 1 },
      ...Array(59).fill({ name: "Forest", count: 1 }),
    ];
    const result = validateDeckFormat(deck, "restricted-vintage" as Format);

    expect(result.isValid).toBe(true);
  });
});

describe("Custom Game Modes - Display Names", () => {
  it("should return display name for custom format", () => {
    const customMode = createGameMode({
      name: "My Awesome Format",
      description: "Test",
      deckRules: DEFAULT_RULES.constructed,
      rules: [],
    });

    registerGameMode(customMode);

    const displayName = getFormatDisplayName("my-awesome-format" as Format);
    expect(displayName).toBe("My Awesome Format");
  });
});

describe("Default Rules - Reusability", () => {
  it("should provide default rules for commander-style formats", () => {
    expect(DEFAULT_RULES.singleCommander.maxCopies).toBe(1);
    expect(DEFAULT_RULES.singleCommander.minCards).toBe(100);
    expect(DEFAULT_RULES.singleCommander.startingLife).toBe(40);
    expect(DEFAULT_RULES.singleCommander.commanderDamage).toBe(21);
  });

  it("should provide default rules for constructed formats", () => {
    expect(DEFAULT_RULES.constructed.maxCopies).toBe(4);
    expect(DEFAULT_RULES.constructed.minCards).toBe(60);
    expect(DEFAULT_RULES.constructed.startingLife).toBe(20);
    expect(DEFAULT_RULES.constructed.commanderDamage).toBeNull();
  });

  it("should provide default rules for limited formats", () => {
    expect(DEFAULT_RULES.limited.maxCopies).toBe(4);
    expect(DEFAULT_RULES.limited.minCards).toBe(40);
    expect(DEFAULT_RULES.limited.startingLife).toBe(20);
  });

  it("should allow extending default rules", () => {
    const extendedRules = {
      ...DEFAULT_RULES.constructed,
      startingLife: 25,
    };

    expect(extendedRules.minCards).toBe(60); // From default
    expect(extendedRules.startingLife).toBe(25); // Overridden
  });
});
