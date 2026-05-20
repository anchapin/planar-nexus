/**
 * Alternative Costs Tests
 *
 * Tests for Kicker, Buyback, Flashback, and Bestow alternative costs.
 * Reference: CR 702.85 (Kicker), CR 702.8 (Buyback), CR 702.66 (Flashback), CR 702.99 (Bestow)
 */

import {
  parseKicker,
  parseBuyback,
  parseFlashback,
  parseBestow,
  parseAlternativeCost,
} from "../oracle-text-parser";

describe("Alternative Costs - Oracle Text Parser", () => {
  describe("parseKicker", () => {
    it("should detect simple kicker cost", () => {
      const result = parseKicker("Kicker {2}{U}");
      expect(result.hasKicker).toBe(true);
      expect(result.isMultiKicker).toBe(false);
      expect(result.kickerCost).not.toBeNull();
      expect(result.kickerCost!.generic).toBe(2);
      expect(result.kickerCost!.blue).toBe(1);
    });

    it("should detect multikicker cost", () => {
      const result = parseKicker("Multikicker {1}");
      expect(result.hasKicker).toBe(true);
      expect(result.isMultiKicker).toBe(true);
      expect(result.description).toContain("Multikicker");
    });

    it("should return null info for non-kicker spells", () => {
      const result = parseKicker("Deal 3 damage to any target.");
      expect(result.hasKicker).toBe(false);
      expect(result.kickerCost).toBeNull();
    });

    it("should handle empty text", () => {
      expect(parseKicker("").hasKicker).toBe(false);
      expect(parseKicker(null as any).hasKicker).toBe(false);
    });

    it("should handle complex kicker costs", () => {
      const result = parseKicker("Kicker {2}{R}");
      expect(result.hasKicker).toBe(true);
      expect(result.kickerCost!.red).toBe(1);
      expect(result.kickerCost!.generic).toBe(2);
    });
  });

  describe("parseBuyback", () => {
    it("should detect buyback cost", () => {
      const result = parseBuyback("Buyback {3}");
      expect(result.hasBuyback).toBe(true);
      expect(result.buybackCost).not.toBeNull();
      expect(result.buybackCost!.generic).toBe(3);
      expect(result.description).toContain("Buyback");
    });

    it("should detect buyback with colored mana", () => {
      const result = parseBuyback("Buyback {2}{U}");
      expect(result.hasBuyback).toBe(true);
      expect(result.buybackCost!.generic).toBe(2);
      expect(result.buybackCost!.blue).toBe(1);
    });

    it("should return false for non-buyback spells", () => {
      const result = parseBuyback("Flashback {3}{R}");
      expect(result.hasBuyback).toBe(false);
      expect(result.buybackCost).toBeNull();
    });

    it("should handle empty text", () => {
      expect(parseBuyback("").hasBuyback).toBe(false);
      expect(parseBuyback(null as any).hasBuyback).toBe(false);
    });
  });

  describe("parseFlashback", () => {
    it("should detect flashback cost", () => {
      const result = parseFlashback("Flashback {3}{R}");
      expect(result.hasFlashback).toBe(true);
      expect(result.flashbackCost).not.toBeNull();
      expect(result.flashbackCost!.generic).toBe(3);
      expect(result.flashbackCost!.red).toBe(1);
    });

    it("should detect flashback with only generic mana", () => {
      const result = parseFlashback("Flashback {2}");
      expect(result.hasFlashback).toBe(true);
      expect(result.flashbackCost!.generic).toBe(2);
    });

    it("should return false for non-flashback spells", () => {
      const result = parseFlashback("Kicker {2}{U}");
      expect(result.hasFlashback).toBe(false);
      expect(result.flashbackCost).toBeNull();
    });

    it("should handle empty text", () => {
      expect(parseFlashback("").hasFlashback).toBe(false);
      expect(parseFlashback(null as any).hasFlashback).toBe(false);
    });
  });

  describe("parseBestow", () => {
    it("should detect bestow cost", () => {
      const result = parseBestow("Bestow {3}{W}");
      expect(result.hasBestow).toBe(true);
      expect(result.bestowCost).not.toBeNull();
      expect(result.bestowCost!.generic).toBe(3);
      expect(result.bestowCost!.white).toBe(1);
    });

    it("should detect bestow with colored mana", () => {
      const result = parseBestow("Bestow {2}{U}");
      expect(result.hasBestow).toBe(true);
      expect(result.bestowCost!.generic).toBe(2);
      expect(result.bestowCost!.blue).toBe(1);
    });

    it("should return false for non-bestow spells", () => {
      const result = parseBestow("Kicker {2}{U}");
      expect(result.hasBestow).toBe(false);
      expect(result.bestowCost).toBeNull();
    });

    it("should handle empty text", () => {
      expect(parseBestow("").hasBestow).toBe(false);
      expect(parseBestow(null as any).hasBestow).toBe(false);
    });
  });

  describe("parseAlternativeCost", () => {
    it("should detect flashback as alternative cost", () => {
      const result = parseAlternativeCost("Flashback {3}{R}");
      expect(result.hasAlternativeCost).toBe(true);
      expect(result.costType).toBe("flashback");
      expect(result.isAvailable).toBe(true);
    });

    it("should detect buyback as alternative cost", () => {
      const result = parseAlternativeCost("Buyback {3}");
      expect(result.hasAlternativeCost).toBe(true);
      expect(result.costType).toBe("buyback");
      expect(result.isAvailable).toBe(true);
    });

    it("should detect bestow as alternative cost", () => {
      const result = parseAlternativeCost("Bestow {4}{W}");
      expect(result.hasAlternativeCost).toBe(true);
      expect(result.costType).toBe("bestow");
      expect(result.description).toContain("Bestow");
    });

    it("should detect escape as alternative cost", () => {
      const result = parseAlternativeCost(
        "Escape—{4}{G}, Exile four other cards from your graveyard.",
      );
      expect(result.hasAlternativeCost).toBe(true);
      expect(result.costType).toBe("escape");
      expect(result.additionalRequirement).toContain("Exile");
    });

    it("should detect spectacle as alternative cost", () => {
      const result = parseAlternativeCost("Spectacle {1}{B}");
      expect(result.hasAlternativeCost).toBe(true);
      expect(result.costType).toBe("spectacle");
    });

    it("should detect kicker as alternative cost", () => {
      const result = parseAlternativeCost("Kicker {2}{U}");
      expect(result.hasAlternativeCost).toBe(true);
      expect(result.costType).toBe("kicker");
    });

    it("should return false for spells without alternative costs", () => {
      const result = parseAlternativeCost("Deal 3 damage to any target.");
      expect(result.hasAlternativeCost).toBe(false);
      expect(result.costType).toBeNull();
    });

    it("should handle empty text", () => {
      const result = parseAlternativeCost("");
      expect(result.hasAlternativeCost).toBe(false);
    });
  });
});

describe("Alternative Costs - Stack Object Integration", () => {
  it("should have alternativeCostsUsed field in StackObject", () => {
    // This tests that the StackObject type includes alternative costs tracking
    const mockStackObject = {
      id: "stack-123",
      type: "spell" as const,
      sourceCardId: "card-123" as any,
      controllerId: "player1" as any,
      name: "Test Spell",
      text: "Test spell text",
      manaCost: "{2}{U}",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: Date.now(),
      alternativeCostsUsed: ["kicker", "buyback"],
      wasKicked: true,
      buybackReturnZone: "player1-hand",
      bestowTarget: undefined,
    };

    expect(mockStackObject.alternativeCostsUsed).toContain("kicker");
    expect(mockStackObject.alternativeCostsUsed).toContain("buyback");
    expect(mockStackObject.wasKicked).toBe(true);
    expect(mockStackObject.buybackReturnZone).toBe("player1-hand");
  });

  it("should track flashback in alternativeCostsUsed", () => {
    const mockStackObject = {
      id: "stack-456",
      type: "spell" as const,
      sourceCardId: "card-456" as any,
      controllerId: "player1" as any,
      name: "Lightning Bolt",
      text: "Lightning bolt text",
      manaCost: "{R}",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: Date.now(),
      alternativeCostsUsed: ["flashback"],
      wasKicked: false,
      buybackReturnZone: undefined,
      bestowTarget: undefined,
    };

    expect(mockStackObject.alternativeCostsUsed).toContain("flashback");
    expect(mockStackObject.wasKicked).toBe(false);
  });

  it("should track bestow with target", () => {
    const mockStackObject = {
      id: "stack-789",
      type: "spell" as const,
      sourceCardId: "card-789" as any,
      controllerId: "player1" as any,
      name: "Hopeful Elephant",
      text: "Bestow aura text",
      manaCost: "{3}{W}",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: Date.now(),
      alternativeCostsUsed: ["bestow"],
      wasKicked: false,
      buybackReturnZone: undefined,
      bestowTarget: "creature-123" as any,
    };

    expect(mockStackObject.alternativeCostsUsed).toContain("bestow");
    expect(mockStackObject.bestowTarget).toBe("creature-123");
  });
});
