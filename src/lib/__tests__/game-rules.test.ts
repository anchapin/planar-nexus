/**
 * Unit tests for game rules module
 * Issue #98: Add comprehensive unit tests for game rules
 */

import {
  formatRules,
  validateDeckFormat,
  validateSideboard,
  isDeckLegal,
  getStartingLife,
  getCommanderDamageThreshold,
  getMaxHandSize,
  formatUsesSideboard,
  getSideboardSize,
  getFormatRulesDescription,
  getFormatDisplayName,
  isBasicLand,
  banLists,
  vintageRestrictedList,
  gameModes,
  getAllGameModes,
  createGameMode,
  registerGameMode,
  findGameModeByName,
  getGameMode,
  getGameModeDescription,
  type Format,
} from "../game-rules";

describe("Game Rules - Format Rules", () => {
  describe("formatRules", () => {
    it("should have all required formats defined", () => {
      const formats: Format[] = [
        "legendary-commander",
        "constructed-core",
        "constructed-legacy",
        "constructed-vintage",
        "constructed-extended",
        "constructed-restricted",
        "constructed-pioneer",
      ];
      formats.forEach((format) => {
        expect(formatRules[format]).toBeDefined();
      });
    });

    it("should have correct min/max cards for legendary-commander", () => {
      expect(formatRules["legendary-commander"].minCards).toBe(100);
      expect(formatRules["legendary-commander"].maxCards).toBe(100);
    });

    it("should have correct min cards for constructed formats", () => {
      const constructedFormats: Format[] = [
        "constructed-core",
        "constructed-legacy",
        "constructed-vintage",
        "constructed-extended",
        "constructed-restricted",
        "constructed-pioneer",
      ];
      constructedFormats.forEach((format) => {
        expect(formatRules[format].minCards).toBe(60);
      });
    });

    it("should have correct max copies for each format", () => {
      expect(formatRules["legendary-commander"].maxCopies).toBe(1);
      const otherFormats: Format[] = [
        "constructed-core",
        "constructed-legacy",
        "constructed-vintage",
        "constructed-extended",
        "constructed-restricted",
        "constructed-pioneer",
      ];
      otherFormats.forEach((format) => {
        expect(formatRules[format].maxCopies).toBe(4);
      });
    });

    it("should have correct starting life for legendary-commander", () => {
      expect(formatRules["legendary-commander"].startingLife).toBe(40);
    });

    it("should have correct starting life for constructed formats", () => {
      const constructedFormats: Format[] = [
        "constructed-core",
        "constructed-legacy",
        "constructed-vintage",
        "constructed-extended",
        "constructed-restricted",
        "constructed-pioneer",
      ];
      constructedFormats.forEach((format) => {
        expect(formatRules[format].startingLife).toBe(20);
      });
    });

    it("should have correct commander damage threshold", () => {
      expect(formatRules["legendary-commander"].commanderDamage).toBe(21);
      const otherFormats: Format[] = [
        "constructed-core",
        "constructed-legacy",
        "constructed-vintage",
        "constructed-extended",
        "constructed-restricted",
        "constructed-pioneer",
      ];
      otherFormats.forEach((format) => {
        expect(formatRules[format].commanderDamage).toBeNull();
      });
    });

    it("should have correct sideboard settings", () => {
      expect(formatRules["legendary-commander"].usesSideboard).toBe(false);
      expect(formatRules["legendary-commander"].sideboardSize).toBe(0);

      const formatsWithSideboard: Format[] = [
        "constructed-core",
        "constructed-legacy",
        "constructed-vintage",
        "constructed-extended",
        "constructed-restricted",
        "constructed-pioneer",
      ];
      formatsWithSideboard.forEach((format) => {
        expect(formatRules[format].usesSideboard).toBe(true);
        expect(formatRules[format].sideboardSize).toBe(15);
      });
    });
  });
});

describe("Game Rules - isBasicLand", () => {
  const basicLands = [
    "forest",
    "island",
    "mountain",
    "plains",
    "swamp",
    "wastes",
    "snow-covered forest",
    "snow-covered island",
    "snow-covered mountain",
    "snow-covered plains",
    "snow-covered swamp",
  ];

  basicLands.forEach((land) => {
    it(`should recognize ${land} as a basic land`, () => {
      expect(isBasicLand(land)).toBe(true);
    });

    it(`should recognize ${land.toUpperCase()} as a basic land (case insensitive)`, () => {
      expect(isBasicLand(land.toUpperCase())).toBe(true);
    });

    it(`should recognize ${land} with extra spaces as a basic land`, () => {
      expect(isBasicLand(`  ${land}  `)).toBe(true);
    });
  });

  it("should not recognize non-basic lands as basic", () => {
    expect(isBasicLand("dark ritual")).toBe(false);
    expect(isBasicLand("sol ring")).toBe(false);
    expect(isBasicLand("bloodstained mire")).toBe(false);
  });
});

describe("Game Rules - validateDeckFormat", () => {
  describe("Legendary Commander format validation", () => {
    it("should reject a legendary commander deck with less than 100 cards", () => {
      const deck = [{ name: "Sol Ring", count: 1 }];
      const result = validateDeckFormat(deck, "legendary-commander", {
        name: "Ghired, Shell of the Ghireds",
        color_identity: ["R", "W"],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Legendary Commander decks must have exactly 100 cards (has 1)"
      );
    });

    it("should reject a legendary commander deck with more than 100 cards", () => {
      const deck = Array(101).fill({ name: "Forest", count: 1 });
      const result = validateDeckFormat(deck, "legendary-commander", {
        name: "Ghired, Shell of the Ghireds",
        color_identity: ["R", "W"],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Legendary Commander decks must have exactly 100 cards (has 101)"
      );
    });

    it("should accept a valid legendary commander deck with 100 cards", () => {
      // Create a valid legendary commander deck with 100 singleton cards
      const deck: { name: string; count: number; color_identity?: string[] }[] = [
        { name: "Ghired, Shell of the Ghireds", count: 1, color_identity: ["R", "W", "G"] },
        { name: "Forest", count: 35 },
        { name: "Mountain", count: 35 },
        { name: "Sol Ring", count: 1, color_identity: [] },
        { name: "Lightning Bolt", count: 1, color_identity: ["R"] },
        { name: "Swords to Plowshares", count: 1, color_identity: ["W"] },
        { name: "Cultivate", count: 1, color_identity: ["G"] },
      ];
      // Add 25 more unique cards to reach 100
      for (let i = 1; i <= 25; i++) {
        deck.push({ name: `Unique Card ${i}`, count: 1, color_identity: ["R", "W", "G"] });
      }
      const result = validateDeckFormat(deck, "legendary-commander", {
        name: "Ghired, Shell of the Ghireds",
        color_identity: ["R", "W", "G"],
      });

      expect(result.isValid).toBe(true);
      expect(result.deckSize).toBe(100);
    });

    it("should reject cards outside legendary's color identity", () => {
      const deck = [
        { name: "Counterspell", count: 4, color_identity: ["U"] }, // Blue not in RW
      ];
      const result = validateDeckFormat(deck, "legendary-commander", {
        name: "Ghired, Shell of the Ghireds",
        color_identity: ["R", "W"],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("Color identity violation"))).toBe(
        true
      );
    });

    it("should allow basic lands regardless of color identity", () => {
      const deck = [
        { name: "Swamp", count: 10, color_identity: ["B"] },
        { name: "Island", count: 10, color_identity: ["U"] },
      ];
      const result = validateDeckFormat(deck, "legendary-commander", {
        name: "Ghired, Shell of the Ghireds",
        color_identity: ["R", "W"],
      });

      // Basic lands should not trigger color identity errors
      expect(result.errors.some((e) => e.includes("Color identity violation"))).toBe(
        false
      );
    });

    it("should allow colorless cards", () => {
      const deck = [
        { name: "Sol Ring", count: 1, color_identity: [] },
        { name: "Star Compass", count: 1, color_identity: [] },
        { name: "Forest", count: 98 }, // Fill to 100 cards
      ];
      const result = validateDeckFormat(deck, "legendary-commander", {
        name: "Ghired, Shell of the Ghireds",
        color_identity: ["R", "W"],
      });

      expect(result.isValid).toBe(true);
    });

    it("should warn when no legendary is specified", () => {
      const deck = [{ name: "Forest", count: 100 }];
      const result = validateDeckFormat(deck, "legendary-commander");

      expect(result.hasCommander).toBe(false);
      expect(result.warnings).toContain(
        "No legendary specified - ensure deck follows color identity rules"
      );
    });
  });

  describe("Constructed format validation", () => {
    it("should reject decks with less than 60 cards", () => {
      const deck = [{ name: "Lightning Bolt", count: 4 }];
      const result = validateDeckFormat(deck, "constructed-core");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Deck must have at least 60 cards (has 4)"
      );
    });

    it("should accept a deck with exactly 60 cards", () => {
      const deck = Array(60).fill({ name: "Forest", count: 1 });
      const result = validateDeckFormat(deck, "constructed-core");

      expect(result.isValid).toBe(true);
    });

    it("should reject more than 4 copies of a card", () => {
      const deck = [{ name: "Lightning Bolt", count: 5 }];
      const result = validateDeckFormat(deck, "constructed-core");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "lightning bolt has 5 copies, maximum is 4 in Constructed Core"
      );
    });

    it("should allow exactly 4 copies of a card", () => {
      const deck = [
        { name: "Lightning Bolt", count: 4 },
        { name: "Forest", count: 56 }, // Fill to 60 cards
      ];
      const result = validateDeckFormat(deck, "constructed-core");

      expect(result.isValid).toBe(true);
    });
  });

  describe("Constructed Vintage format validation", () => {
    it("should allow restricted cards but limit to 1 copy", () => {
      const deck = [
        { name: "Black Lotus", count: 2 }, // Restricted in vintage
      ];
      const result = validateDeckFormat(deck, "constructed-vintage");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "black lotus is restricted in Constructed Vintage - maximum 1 copy allowed"
      );
    });

    it("should allow exactly 1 copy of a restricted card", () => {
      const deck = [
        { name: "Black Lotus", count: 1 },
        { name: "Forest", count: 59 }, // Fill to 60 cards
      ];
      const result = validateDeckFormat(deck, "constructed-vintage");

      expect(result.isValid).toBe(true);
    });
  });

  describe("Ban list validation", () => {
    it("should reject banned cards in legendary-commander", () => {
      const deck = [
        { name: "Black Lotus", count: 1 },
      ];
      const result = validateDeckFormat(deck, "legendary-commander");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("black lotus is banned in Legendary Commander");
    });

    it("should reject banned cards in constructed-legacy", () => {
      const deck = [
        { name: "Jace, the Mind Sculptor", count: 1 },
      ];
      const result = validateDeckFormat(deck, "constructed-legacy");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "jace, the mind sculptor is banned in Constructed Legacy"
      );
    });

    it("should be case insensitive for ban list", () => {
      const deck = [
        { name: "BLACK LOTUS", count: 1 },
      ];
      const result = validateDeckFormat(deck, "legendary-commander");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("black lotus is banned in Legendary Commander");
    });
  });
});

describe("Game Rules - validateSideboard", () => {
  it("should reject sideboards in legendary-commander format", () => {
    const sideboard = [{ name: "Lightning Bolt", count: 1 }];
    const result = validateSideboard(sideboard, "legendary-commander");

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Legendary Commander format does not use sideboards"
    );
  });

  it("should accept a valid sideboard", () => {
    const sideboard = [
      { name: "Lightning Bolt", count: 4 },
      { name: "Counterspell", count: 4 },
      { name: "Duress", count: 4 },
      { name: "Negate", count: 3 },
    ];
    const result = validateSideboard(sideboard, "constructed-core");

    expect(result.isValid).toBe(true);
  });

  it("should reject sideboards larger than allowed", () => {
    const sideboard = Array(20).fill({ name: "Forest", count: 1 });
    const result = validateSideboard(sideboard, "constructed-core");

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Sideboard must have at most 15 cards (has 20)"
    );
  });

  it("should reject more than 4 copies of a card in sideboard", () => {
    const sideboard = [{ name: "Lightning Bolt", count: 5 }];
    const result = validateSideboard(sideboard, "constructed-core");

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Sideboard: lightning bolt has 5 copies, maximum is 4"
    );
  });
});

describe("Game Rules - isDeckLegal", () => {
  it("should return true for a legal legendary commander deck", () => {
    // Create a valid legendary commander deck with 100 singleton cards
    const deck: { name: string; count: number; color_identity?: string[] }[] = [
      { name: "Ghired, Shell of the Ghireds", count: 1, color_identity: ["R", "W", "G"] },
      { name: "Forest", count: 35 },
      { name: "Mountain", count: 35 },
      { name: "Lightning Bolt", count: 1, color_identity: ["R"] },
      { name: "Swords to Plowshares", count: 1, color_identity: ["W"] },
      { name: "Cultivate", count: 1, color_identity: ["G"] },
    ];
    // Add 26 more unique cards to reach 100
    for (let i = 1; i <= 26; i++) {
      deck.push({ name: `Unique Card ${i}`, count: 1, color_identity: ["R", "W", "G"] });
    }
    const result = isDeckLegal(
      deck,
      "legendary-commander",
      {
        name: "Ghired, Shell of the Ghireds",
        color_identity: ["R", "W", "G"],
      }
    );

    expect(result).toBe(true);
  });

  it("should return false for an illegal legendary commander deck", () => {
    const deck = [
      { name: "Counterspell", count: 4, color_identity: ["U"] },
    ];
    const result = isDeckLegal(
      deck,
      "legendary-commander",
      {
        name: "Ghired, Shell of the Ghireds",
        color_identity: ["R", "W"],
      }
    );

    expect(result).toBe(false);
  });
});

describe("Game Rules - Helper functions", () => {
  describe("getStartingLife", () => {
    it("should return 40 for legendary-commander", () => {
      expect(getStartingLife("legendary-commander")).toBe(40);
    });

    it("should return 20 for constructed formats", () => {
      const formats: Format[] = [
        "constructed-core",
        "constructed-legacy",
        "constructed-vintage",
        "constructed-extended",
        "constructed-restricted",
        "constructed-pioneer",
      ];
      formats.forEach((format) => {
        expect(getStartingLife(format)).toBe(20);
      });
    });
  });

  describe("getCommanderDamageThreshold", () => {
    it("should return 21 for legendary-commander", () => {
      expect(getCommanderDamageThreshold("legendary-commander")).toBe(21);
    });

    it("should return null for non-legendary-commander formats", () => {
      const formats: Format[] = [
        "constructed-core",
        "constructed-legacy",
        "constructed-vintage",
        "constructed-extended",
        "constructed-restricted",
        "constructed-pioneer",
      ];
      formats.forEach((format) => {
        expect(getCommanderDamageThreshold(format)).toBeNull();
      });
    });
  });

  describe("getMaxHandSize", () => {
    it("should return 7 for all formats", () => {
      expect(getMaxHandSize()).toBe(7);
    });
  });

  describe("formatUsesSideboard", () => {
    it("should return false for legendary-commander", () => {
      expect(formatUsesSideboard("legendary-commander")).toBe(false);
    });

    it("should return true for constructed formats", () => {
      const formats: Format[] = [
        "constructed-core",
        "constructed-legacy",
        "constructed-vintage",
        "constructed-extended",
        "constructed-restricted",
        "constructed-pioneer",
      ];
      formats.forEach((format) => {
        expect(formatUsesSideboard(format)).toBe(true);
      });
    });
  });

  describe("getSideboardSize", () => {
    it("should return 0 for legendary-commander", () => {
      expect(getSideboardSize("legendary-commander")).toBe(0);
    });

    it("should return 15 for constructed formats", () => {
      const formats: Format[] = [
        "constructed-core",
        "constructed-legacy",
        "constructed-vintage",
        "constructed-extended",
        "constructed-restricted",
        "constructed-pioneer",
      ];
      formats.forEach((format) => {
        expect(getSideboardSize(format)).toBe(15);
      });
    });
  });

  describe("getFormatRulesDescription", () => {
    it("should return descriptions for legendary-commander", () => {
      const descriptions = getFormatRulesDescription("legendary-commander");
      expect(descriptions.length).toBeGreaterThan(0);
      expect(descriptions).toContain("100 cards exactly (including legendary)");
    });

    it("should return descriptions for constructed-core", () => {
      const descriptions = getFormatRulesDescription("constructed-core");
      expect(descriptions.length).toBeGreaterThan(0);
      expect(descriptions).toContain("Minimum 60 cards");
    });
  });

  describe("getFormatDisplayName", () => {
    it("should return proper display names", () => {
      expect(getFormatDisplayName("legendary-commander")).toBe("Legendary Commander");
      expect(getFormatDisplayName("constructed-core")).toBe("Constructed Core");
      expect(getFormatDisplayName("constructed-legacy")).toBe("Constructed Legacy");
      expect(getFormatDisplayName("constructed-vintage")).toBe("Constructed Vintage");
      expect(getFormatDisplayName("constructed-extended")).toBe("Constructed Extended");
      expect(getFormatDisplayName("constructed-restricted")).toBe("Constructed Restricted");
      expect(getFormatDisplayName("constructed-pioneer")).toBe("Constructed Pioneer");
    });
  });
});

describe("Game Rules - Ban lists and restricted lists", () => {
  it("should have a constructed-vintage restricted list", () => {
    expect(vintageRestrictedList.size).toBeGreaterThan(0);
    expect(vintageRestrictedList.has("black lotus")).toBe(true);
  });

  it("should have a legendary-commander ban list", () => {
    expect(banLists["legendary-commander"].length).toBeGreaterThan(0);
    expect(banLists["legendary-commander"]).toContain("black lotus");
  });

  it("should have ban lists for all formats", () => {
    const formats: Format[] = [
      "legendary-commander",
      "constructed-core",
      "constructed-legacy",
      "constructed-vintage",
      "constructed-extended",
      "constructed-restricted",
      "constructed-pioneer",
    ];
    formats.forEach((format) => {
      expect(banLists[format]).toBeDefined();
      expect(Array.isArray(banLists[format])).toBe(true);
    });
  });
});

describe("Game Rules - Game Mode System", () => {
  describe("getAllGameModes", () => {
    it("should return all game modes", () => {
      const modes = getAllGameModes();
      expect(modes.length).toBeGreaterThan(0);
      expect(modes.every((mode) => mode.id && mode.name && mode.description)).toBe(true);
    });
  });

  describe("getGameMode", () => {
    it("should return game mode by id", () => {
      const mode = getGameMode("legendary-commander");
      expect(mode).toBeDefined();
      expect(mode?.name).toBe("Legendary Commander");
    });

    it("should return undefined for non-existent mode", () => {
      const mode = getGameMode("non-existent");
      expect(mode).toBeUndefined();
    });
  });

  describe("findGameModeByName", () => {
    it("should find game mode by name (case-insensitive)", () => {
      const mode = findGameModeByName("LEGENDARY COMMANDER");
      expect(mode).toBeDefined();
      expect(mode?.id).toBe("legendary-commander");
    });

    it("should return undefined for non-existent name", () => {
      const mode = findGameModeByName("Non Existent Format");
      expect(mode).toBeUndefined();
    });
  });

  describe("createGameMode", () => {
    it("should create a custom game mode", () => {
      const customMode = createGameMode({
        name: "Custom Format",
        description: "A custom game mode",
        deckRules: DEFAULT_RULES.constructed,
        rules: [
          "Custom rule 1",
          "Custom rule 2",
        ],
        banList: ["banned card"],
      });

      expect(customMode.id).toBe("custom-format");
      expect(customMode.name).toBe("Custom Format");
      expect(customMode.description).toBe("A custom game mode");
      expect(customMode.deckRules).toEqual(DEFAULT_RULES.constructed);
      expect(customMode.rules.length).toBe(2);
      expect(customMode.banList).toContain("banned card");
    });

    it("should handle special characters in name", () => {
      const customMode = createGameMode({
        name: "Test Format!",
        description: "Test",
        deckRules: DEFAULT_RULES.constructed,
        rules: [],
      });

      expect(customMode.id).toBe("test-format");
    });
  });

  describe("registerGameMode", () => {
    it("should register a custom game mode", () => {
      const customMode = createGameMode({
        name: "Test Format",
        description: "Test description",
        deckRules: DEFAULT_RULES.constructed,
        rules: ["Test rule"],
      });

      registerGameMode(customMode);

      const retrieved = getGameMode("test-format");
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("Test Format");
    });

    it("should allow validating decks with custom mode", () => {
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
  });

  describe("getGameModeDescription", () => {
    it("should return description for legendary-commander", () => {
      const desc = getGameModeDescription("legendary-commander");
      expect(desc).toBe("Single-commander format with 100-card decks and 40 starting life");
    });

    it("should return description for constructed-core", () => {
      const desc = getGameModeDescription("constructed-core");
      expect(desc).toBe("Standard constructed format with current card pool");
    });
  });
});

describe("Game Rules - Default Rules", () => {
  it("should have default rules for single commander", () => {
    expect(DEFAULT_RULES.singleCommander.maxCopies).toBe(1);
    expect(DEFAULT_RULES.singleCommander.minCards).toBe(100);
    expect(DEFAULT_RULES.singleCommander.startingLife).toBe(40);
    expect(DEFAULT_RULES.singleCommander.commanderDamage).toBe(21);
  });

  it("should have default rules for constructed", () => {
    expect(DEFAULT_RULES.constructed.maxCopies).toBe(4);
    expect(DEFAULT_RULES.constructed.minCards).toBe(60);
    expect(DEFAULT_RULES.constructed.startingLife).toBe(20);
    expect(DEFAULT_RULES.constructed.commanderDamage).toBeNull();
  });

  it("should have default rules for limited", () => {
    expect(DEFAULT_RULES.limited.maxCopies).toBe(4);
    expect(DEFAULT_RULES.limited.minCards).toBe(40);
    expect(DEFAULT_RULES.limited.startingLife).toBe(20);
    expect(DEFAULT_RULES.limited.commanderDamage).toBeNull();
  });
});
