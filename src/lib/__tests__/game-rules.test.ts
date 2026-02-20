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
  type Format,
} from "../game-rules";

describe("Game Rules - Format Rules", () => {
  describe("formatRules", () => {
    it("should have all required formats defined", () => {
      const formats: Format[] = [
        "commander",
        "standard",
        "modern",
        "pioneer",
        "legacy",
        "vintage",
        "pauper",
      ];
      formats.forEach((format) => {
        expect(formatRules[format]).toBeDefined();
      });
    });

    it("should have correct min/max cards for commander", () => {
      expect(formatRules.commander.minCards).toBe(100);
      expect(formatRules.commander.maxCards).toBe(100);
    });

    it("should have correct min cards for constructed formats", () => {
      const constructedFormats: Format[] = [
        "standard",
        "modern",
        "pioneer",
        "legacy",
        "vintage",
        "pauper",
      ];
      constructedFormats.forEach((format) => {
        expect(formatRules[format].minCards).toBe(60);
      });
    });

    it("should have correct max copies for each format", () => {
      expect(formatRules.commander.maxCopies).toBe(1);
      const otherFormats: Format[] = [
        "standard",
        "modern",
        "pioneer",
        "legacy",
        "vintage",
        "pauper",
      ];
      otherFormats.forEach((format) => {
        expect(formatRules[format].maxCopies).toBe(4);
      });
    });

    it("should have correct starting life for commander", () => {
      expect(formatRules.commander.startingLife).toBe(40);
    });

    it("should have correct starting life for constructed formats", () => {
      const constructedFormats: Format[] = [
        "standard",
        "modern",
        "pioneer",
        "legacy",
        "vintage",
        "pauper",
      ];
      constructedFormats.forEach((format) => {
        expect(formatRules[format].startingLife).toBe(20);
      });
    });

    it("should have correct commander damage threshold", () => {
      expect(formatRules.commander.commanderDamage).toBe(21);
      const otherFormats: Format[] = [
        "standard",
        "modern",
        "pioneer",
        "legacy",
        "vintage",
        "pauper",
      ];
      otherFormats.forEach((format) => {
        expect(formatRules[format].commanderDamage).toBeNull();
      });
    });

    it("should have correct sideboard settings", () => {
      expect(formatRules.commander.usesSideboard).toBe(false);
      expect(formatRules.commander.sideboardSize).toBe(0);

      const formatsWithSideboard: Format[] = [
        "standard",
        "modern",
        "pioneer",
        "legacy",
        "vintage",
        "pauper",
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
  describe("Commander format validation", () => {
    it("should reject a commander deck with less than 100 cards", () => {
      const deck = [{ name: "Sol Ring", count: 1 }];
      const result = validateDeckFormat(deck, "commander", {
        name: "Ghired, Shell of the Ghireds",
        color_identity: ["R", "W"],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Commander decks must have exactly 100 cards (has 1)"
      );
    });

    it("should reject a commander deck with more than 100 cards", () => {
      const deck = Array(101).fill({ name: "Forest", count: 1 });
      const result = validateDeckFormat(deck, "commander", {
        name: "Ghired, Shell of the Ghireds",
        color_identity: ["R", "W"],
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Commander decks must have exactly 100 cards (has 101)"
      );
    });

    it("should accept a valid commander deck with 100 cards", () => {
      const deck = [
        { name: "Ghired, Shell of the Ghireds", count: 1, color_identity: ["R", "W"] },
        { name: "Forest", count: 35 },
        { name: "Mountain", count: 35 },
        { name: "Sol Ring", count: 1, color_identity: [] },
        { name: "Lightning Bolt", count: 4, color_identity: ["R"] },
        { name: "Swords to Plowshares", count: 4, color_identity: ["W"] },
        { name: "Cultivate", count: 4, color_identity: ["G"] },
        { name: "其他红色/白色卡", count: 16, color_identity: ["R", "W"] },
      ];
      const result = validateDeckFormat(deck, "commander", {
        name: "Ghired, Shell of the Ghireds",
        color_identity: ["R", "W"],
      });

      expect(result.isValid).toBe(true);
      expect(result.deckSize).toBe(100);
    });

    it("should reject cards outside commander's color identity", () => {
      const deck = [
        { name: "Counterspell", count: 4, color_identity: ["U"] }, // Blue not in RW
      ];
      const result = validateDeckFormat(deck, "commander", {
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
      const result = validateDeckFormat(deck, "commander", {
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
        { name: "Star Compass", count: 4, color_identity: [] },
      ];
      const result = validateDeckFormat(deck, "commander", {
        name: "Ghired, Shell of the Ghireds",
        color_identity: ["R", "W"],
      });

      expect(result.isValid).toBe(true);
    });

    it("should warn when no commander is specified", () => {
      const deck = [{ name: "Forest", count: 100 }];
      const result = validateDeckFormat(deck, "commander");

      expect(result.hasCommander).toBe(false);
      expect(result.warnings).toContain(
        "No commander specified - ensure deck follows color identity rules"
      );
    });
  });

  describe("Standard/Modern format validation", () => {
    it("should reject decks with less than 60 cards", () => {
      const deck = [{ name: "Lightning Bolt", count: 4 }];
      const result = validateDeckFormat(deck, "standard");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Deck must have at least 60 cards (has 4)"
      );
    });

    it("should accept a deck with exactly 60 cards", () => {
      const deck = Array(60).fill({ name: "Forest", count: 1 });
      const result = validateDeckFormat(deck, "standard");

      expect(result.isValid).toBe(true);
    });

    it("should reject more than 4 copies of a card", () => {
      const deck = [{ name: "Lightning Bolt", count: 5 }];
      const result = validateDeckFormat(deck, "standard");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "lightning bolt has 5 copies, maximum is 4 in standard"
      );
    });

    it("should allow exactly 4 copies of a card", () => {
      const deck = [{ name: "Lightning Bolt", count: 4 }];
      const result = validateDeckFormat(deck, "standard");

      expect(result.isValid).toBe(true);
    });
  });

  describe("Vintage format validation", () => {
    it("should allow restricted cards but limit to 1 copy", () => {
      const deck = [
        { name: "Black Lotus", count: 2 }, // Restricted in vintage
      ];
      const result = validateDeckFormat(deck, "vintage");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "black lotus is restricted in Vintage - maximum 1 copy allowed"
      );
    });

    it("should allow exactly 1 copy of a restricted card", () => {
      const deck = [
        { name: "Black Lotus", count: 1 },
      ];
      const result = validateDeckFormat(deck, "vintage");

      expect(result.isValid).toBe(true);
    });
  });

  describe("Ban list validation", () => {
    it("should reject banned cards in commander", () => {
      const deck = [
        { name: "Black Lotus", count: 1 },
      ];
      const result = validateDeckFormat(deck, "commander");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("black lotus is banned in commander");
    });

    it("should reject banned cards in modern", () => {
      const deck = [
        { name: "Jace, the Mind Sculptor", count: 1 },
      ];
      const result = validateDeckFormat(deck, "modern");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "jace, the mind sculptor is banned in modern"
      );
    });

    it("should be case insensitive for ban list", () => {
      const deck = [
        { name: "BLACK LOTUS", count: 1 },
      ];
      const result = validateDeckFormat(deck, "commander");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("black lotus is banned in commander");
    });
  });
});

describe("Game Rules - validateSideboard", () => {
  it("should reject sideboards in commander format", () => {
    const sideboard = [{ name: "Lightning Bolt", count: 1 }];
    const result = validateSideboard(sideboard, "commander");

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Commander format does not use sideboards"
    );
  });

  it("should accept a valid sideboard", () => {
    const sideboard = [
      { name: "Lightning Bolt", count: 4 },
      { name: "Counterspell", count: 4 },
      { name: "Duress", count: 4 },
      { name: "Negate", count: 3 },
    ];
    const result = validateSideboard(sideboard, "standard");

    expect(result.isValid).toBe(true);
  });

  it("should reject sideboards larger than allowed", () => {
    const sideboard = Array(20).fill({ name: "Forest", count: 1 });
    const result = validateSideboard(sideboard, "standard");

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Sideboard must have at most 15 cards (has 20)"
    );
  });

  it("should reject more than 4 copies of a card in sideboard", () => {
    const sideboard = [{ name: "Lightning Bolt", count: 5 }];
    const result = validateSideboard(sideboard, "standard");

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Sideboard: lightning bolt has 5 copies, maximum is 4"
    );
  });
});

describe("Game Rules - isDeckLegal", () => {
  it("should return true for a legal commander deck", () => {
    const deck = [
      { name: "Ghired, Shell of the Ghireds", count: 1, color_identity: ["R", "W"] },
      { name: "Forest", count: 35 },
      { name: "Mountain", count: 35 },
      { name: "Lightning Bolt", count: 4, color_identity: ["R"] },
      { name: "Swords to Plowshares", count: 4, color_identity: ["W"] },
      { name: "Glassdust Hulk", count: 1, color_identity: ["R", "W"] },
      { name: ".other R/W cards", count: 20, color_identity: ["R", "W"] },
    ];
    const result = isDeckLegal(
      deck,
      "commander",
      {
        name: "Ghired, Shell of the Ghireds",
        color_identity: ["R", "W"],
      }
    );

    expect(result).toBe(true);
  });

  it("should return false for an illegal commander deck", () => {
    const deck = [
      { name: "Counterspell", count: 4, color_identity: ["U"] },
    ];
    const result = isDeckLegal(
      deck,
      "commander",
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
    it("should return 40 for commander", () => {
      expect(getStartingLife("commander")).toBe(40);
    });

    it("should return 20 for constructed formats", () => {
      const formats: Format[] = [
        "standard",
        "modern",
        "pioneer",
        "legacy",
        "vintage",
        "pauper",
      ];
      formats.forEach((format) => {
        expect(getStartingLife(format)).toBe(20);
      });
    });
  });

  describe("getCommanderDamageThreshold", () => {
    it("should return 21 for commander", () => {
      expect(getCommanderDamageThreshold("commander")).toBe(21);
    });

    it("should return null for non-commander formats", () => {
      const formats: Format[] = [
        "standard",
        "modern",
        "pioneer",
        "legacy",
        "vintage",
        "pauper",
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
    it("should return false for commander", () => {
      expect(formatUsesSideboard("commander")).toBe(false);
    });

    it("should return true for constructed formats", () => {
      const formats: Format[] = [
        "standard",
        "modern",
        "pioneer",
        "legacy",
        "vintage",
        "pauper",
      ];
      formats.forEach((format) => {
        expect(formatUsesSideboard(format)).toBe(true);
      });
    });
  });

  describe("getSideboardSize", () => {
    it("should return 0 for commander", () => {
      expect(getSideboardSize("commander")).toBe(0);
    });

    it("should return 15 for constructed formats", () => {
      const formats: Format[] = [
        "standard",
        "modern",
        "pioneer",
        "legacy",
        "vintage",
        "pauper",
      ];
      formats.forEach((format) => {
        expect(getSideboardSize(format)).toBe(15);
      });
    });
  });

  describe("getFormatRulesDescription", () => {
    it("should return descriptions for commander", () => {
      const descriptions = getFormatRulesDescription("commander");
      expect(descriptions.length).toBeGreaterThan(0);
      expect(descriptions).toContain("100 cards exactly (including commander)");
    });

    it("should return descriptions for standard", () => {
      const descriptions = getFormatRulesDescription("standard");
      expect(descriptions.length).toBeGreaterThan(0);
      expect(descriptions).toContain("Minimum 60 cards");
    });
  });

  describe("getFormatDisplayName", () => {
    it("should return proper display names", () => {
      expect(getFormatDisplayName("commander")).toBe("Commander");
      expect(getFormatDisplayName("standard")).toBe("Standard");
      expect(getFormatDisplayName("modern")).toBe("Modern");
      expect(getFormatDisplayName("pioneer")).toBe("Pioneer");
      expect(getFormatDisplayName("legacy")).toBe("Legacy");
      expect(getFormatDisplayName("vintage")).toBe("Vintage");
      expect(getFormatDisplayName("pauper")).toBe("Pauper");
    });
  });
});

describe("Game Rules - Ban lists and restricted lists", () => {
  it("should have a vintage restricted list", () => {
    expect(vintageRestrictedList.size).toBeGreaterThan(0);
    expect(vintageRestrictedList.has("black lotus")).toBe(true);
  });

  it("should have a commander ban list", () => {
    expect(banLists.commander.length).toBeGreaterThan(0);
    expect(banLists.commander).toContain("black lotus");
  });

  it("should have ban lists for all formats", () => {
    const formats: Format[] = [
      "commander",
      "standard",
      "modern",
      "pioneer",
      "legacy",
      "vintage",
      "pauper",
    ];
    formats.forEach((format) => {
      expect(banLists[format]).toBeDefined();
      expect(Array.isArray(banLists[format])).toBe(true);
    });
  });
});
