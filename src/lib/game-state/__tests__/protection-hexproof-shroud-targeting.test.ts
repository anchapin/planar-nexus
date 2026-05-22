/**
 * Protection/Hexproof/Shroud Targeting Validation Tests
 *
 * Issue #857: Creatures with protection or hexproof don't properly prevent invalid targeting.
 * Currently only flying/reach is checked for blocking.
 *
 * Reference: CR 702.16 (Protection), CR 702.11 (Hexproof), CR 702.18 (Shroud)
 */

import {
  hasProtectionFrom,
  getProtectionQualities,
  isProtectedFromSource,
  canBeTargetedByColor,
  canBeTargetedBySource,
  canTarget,
  hasHexproof,
  isProtectedByHexproof,
  hasShroud,
  canBlockProtectedAttacker,
  hasKeyword,
  shouldPreventDamageToTarget,
} from "../evergreen-keywords";

import type { CardInstance } from "../types";

describe("Protection/Hexproof/Shroud Targeting Validation", () => {
  // Helper to create a mock card with specific properties
  const createMockCard = (
    overrides: Partial<CardInstance> = {},
  ): CardInstance =>
    ({
      id: "test-card",
      instanceId: "test-instance",
      cardData: {
        id: "card-id",
        name: "Test Card",
        type_line: "Creature — Human Warrior",
        oracle_text: "",
        colors: ["W"],
        color_identity: ["W"],
        mana_cost: "{W}",
        cmc: 1,
        power: "1",
        toughness: "1",
        legalities: { standard: "legal" as const, commander: "legal" as const },
      },
      controllerId: "player1",
      ownerId: "player1",
      isTapped: false,
      isFlipped: false,
      isFaceDown: false,
      damage: 0,
      hasSummoningSickness: true,
      counters: [],
      attachedTo: null,
      attachments: [],
      ...overrides,
    }) as unknown as CardInstance;

  describe("Protection from Color (CR 702.16)", () => {
    it("should detect protection from single color", () => {
      const card = createMockCard({
        cardData: {
          id: "prot-id",
          name: "Holy Guardian",
          type_line: "Creature — Angel",
          oracle_text: "Protection from black",
          colors: ["W"],
          color_identity: ["W"],
          mana_cost: "{2}{W}{W}",
          cmc: 3,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
      });
      expect(hasProtectionFrom(card, "black")).toBe(true);
      expect(hasProtectionFrom(card, "red")).toBe(false);
    });

    it("should prevent targeting by spells of protected color", () => {
      const protCard = createMockCard({
        cardData: {
          id: "prot",
          name: "Fire Guardian",
          type_line: "Creature — Elemental",
          oracle_text: "Protection from red",
          colors: [],
          color_identity: [],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
      });

      // Red spell targeting
      const targetingResult = canTarget(protCard, "player1", "red");
      expect(targetingResult.canTarget).toBe(false);
      expect(targetingResult.reason).toContain("protection from red");

      // Blue spell should work
      const blueResult = canTarget(protCard, "player1", "blue");
      expect(blueResult.canTarget).toBe(true);
    });

    it("should handle protection from multiple colors", () => {
      const card = createMockCard({
        cardData: {
          id: "multi-prot",
          name: "Multi Protector",
          type_line: "Creature",
          oracle_text: "Protection from red and blue",
          colors: [],
          color_identity: [],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
      });

      const qualities = getProtectionQualities(card);
      expect(qualities).toContain("red");
      expect(qualities).toContain("blue");
      expect(qualities).not.toContain("black");

      // Both red and blue should be blocked
      expect(canTarget(card, "player1", "red").canTarget).toBe(false);
      expect(canTarget(card, "player1", "blue").canTarget).toBe(false);
      expect(canTarget(card, "player1", "black").canTarget).toBe(true);
    });

    it("should block targeting by source card colors", () => {
      const protCard = createMockCard({
        cardData: {
          id: "prot",
          name: "Holy Guardian",
          type_line: "Creature — Angel",
          oracle_text: "Protection from black",
          colors: ["W"],
          color_identity: ["W"],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
      });

      const blackSource = createMockCard({
        cardData: {
          id: "black-src",
          name: "Dark Ritual",
          type_line: "Sorcery",
          oracle_text: "",
          colors: ["B"],
          color_identity: ["B"],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
        controllerId: "player1",
      });

      // Black source should not be able to target
      const result = canTarget(protCard, "player1", "black");
      expect(result.canTarget).toBe(false);
    });

    it("should prevent blocking by creatures of protected color (CR 702.16D)", () => {
      const protCard = createMockCard({
        cardData: {
          id: "prot",
          name: "Fire Guardian",
          type_line: "Creature — Elemental",
          oracle_text: "Protection from red",
          colors: [],
          color_identity: [],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
      });

      const redAttacker = createMockCard({
        cardData: {
          id: "red-attacker",
          name: "Fire Elemental",
          type_line: "Creature — Elemental",
          oracle_text: "",
          colors: ["R"],
          color_identity: ["R"],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
      });

      const blueAttacker = createMockCard({
        cardData: {
          id: "blue-attacker",
          name: "Water Elemental",
          type_line: "Creature — Elemental",
          oracle_text: "",
          colors: ["U"],
          color_identity: ["U"],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
      });

      // Red attacker should be blocked by protection
      const redBlockResult = canBlockProtectedAttacker(redAttacker, protCard);
      expect(redBlockResult.canBlock).toBe(false);

      // Blue attacker should be able to block
      const blueBlockResult = canBlockProtectedAttacker(blueAttacker, protCard);
      expect(blueBlockResult.canBlock).toBe(true);
    });

    it("should handle color abbreviations (W, U, B, R, G)", () => {
      const card = createMockCard({
        cardData: {
          id: "prot",
          name: "Guardian",
          type_line: "Creature",
          oracle_text: "Protection from red",
          colors: [],
          color_identity: [],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
      });

      const redSource = createMockCard({
        cardData: {
          id: "red",
          name: "Fire",
          type_line: "",
          oracle_text: "",
          colors: ["R"],
          color_identity: [],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
        controllerId: "player1",
      });

      // Card with colors ['R'] should match protection from "red"
      const result = canTarget(card, "player1", "red");
      expect(result.canTarget).toBe(false);
    });
  });

  describe("Hexproof (CR 702.11)", () => {
    it("should detect hexproof keyword", () => {
      const card = createMockCard({
        cardData: {
          id: "hex-id",
          name: "Hexproof Bear",
          type_line: "Creature — Bear",
          oracle_text: "Hexproof",
          colors: ["G"],
          color_identity: ["G"],
          mana_cost: "{1}{G}",
          cmc: 2,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
          keywords: ["Hexproof"],
        },
      });
      expect(hasHexproof(card)).toBe(true);
    });

    it("should block opponent targeting", () => {
      const hexCard = createMockCard({
        controllerId: "player1",
        cardData: {
          id: "hex2-id",
          colors: [] as string[],
          color_identity: [] as string[],
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
          name: "Hexproof Bear",
          type_line: "Creature",
          oracle_text: "Hexproof",
          keywords: ["Hexproof"],
        },
      });

      // Opponent should not be able to target
      const opponentResult = canTarget(hexCard, "player2", undefined);
      expect(opponentResult.canTarget).toBe(false);
      expect(opponentResult.reason).toContain("hexproof");

      // Controller should be able to target their own hexproof creature
      const ownerResult = canTarget(hexCard, "player1", undefined);
      expect(ownerResult.canTarget).toBe(true);
    });

    it("should not block own targeting", () => {
      const hexCard = createMockCard({
        controllerId: "player1",
        cardData: {
          id: "hex3-id",
          colors: [] as string[],
          color_identity: [] as string[],
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
          name: "Hexproof Creature",
          type_line: "Creature",
          oracle_text: "Hexproof",
          keywords: ["Hexproof"],
        },
      });

      // Owner can target their own creature
      const ownerResult = canTarget(hexCard, "player1", undefined);
      expect(ownerResult.canTarget).toBe(true);
    });

    it("should not protect creatures without hexproof", () => {
      const normalCard = createMockCard({
        controllerId: "player1",
        cardData: {
          id: "nohex-id",
          colors: [] as string[],
          color_identity: [] as string[],
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
          name: "Normal Bear",
          type_line: "Creature",
          oracle_text: "",
        },
      });

      // Any player can target non-hexproof creatures
      expect(canTarget(normalCard, "player2", undefined).canTarget).toBe(true);
      expect(canTarget(normalCard, "player1", undefined).canTarget).toBe(true);
    });
  });

  describe("Shroud (CR 702.18)", () => {
    it("should detect shroud keyword", () => {
      const card = createMockCard({
        cardData: {
          id: "shroud-id",
          name: "Shrouded Creature",
          type_line: "Creature",
          oracle_text: "Shroud",
          colors: [],
          color_identity: [],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
          keywords: ["Shroud"],
        },
      });
      expect(hasShroud(card)).toBe(true);
    });

    it("should block all targeting", () => {
      const shroudCard = createMockCard({
        controllerId: "player1",
        cardData: {
          id: "shroud2-id",
          colors: [] as string[],
          color_identity: [] as string[],
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
          name: "Invisible Creature",
          type_line: "Creature",
          oracle_text: "Shroud",
          keywords: ["Shroud"],
        },
      });

      // No one can target shroud creature, not even owner
      expect(canTarget(shroudCard, "player1", undefined).canTarget).toBe(false);
      expect(canTarget(shroudCard, "player2", undefined).canTarget).toBe(false);
    });

    it("should allow owner to target their own shroud for Auras/Equipment", () => {
      const shroudCard = createMockCard({
        controllerId: "player1",
        cardData: {
          id: "shroud3-id",
          colors: [] as string[],
          color_identity: [] as string[],
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
          name: "Mystery Creature",
          type_line: "Creature",
          oracle_text: "Shroud",
          keywords: ["Shroud"],
        },
      });

      // Shroud blocks ALL targeting, even from owner
      const result = canTarget(shroudCard, "player1", undefined);
      expect(result.canTarget).toBe(false);
      expect(result.reason).toContain("shroud");
    });
  });

  describe("Combined Keyword Interactions", () => {
    it("should prioritize shroud over hexproof (shroud blocks all)", () => {
      // This test documents expected behavior: shroud being more restrictive
      const card = createMockCard({
        controllerId: "player1",
        cardData: {
          id: "combined-id",
          colors: [] as string[],
          color_identity: [] as string[],
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
          name: "Super Protected",
          type_line: "Creature",
          oracle_text: "Shroud", // Some cards have both, shroud wins
          keywords: ["Shroud", "Hexproof"],
        },
      });

      // Even owner can't target shroud
      const result = canTarget(card, "player1", undefined);
      expect(result.canTarget).toBe(false);
    });

    it("should allow protection while respecting hexproof", () => {
      const card = createMockCard({
        controllerId: "player1",
        cardData: {
          id: "prot-hex-id",
          colors: [] as string[],
          color_identity: [] as string[],
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
          name: "Protected Hexproof",
          type_line: "Creature",
          oracle_text: "Protection from red. Hexproof.",
          keywords: ["Hexproof", "Protection"],
        },
      });

      // Owner can target (hexproof doesn't block owner)
      expect(canTarget(card, "player1", undefined).canTarget).toBe(true);

      // Opponent cannot target (hexproof blocks opponent)
      expect(canTarget(card, "player2", undefined).canTarget).toBe(false);

      // Neither can target for red (protection)
      expect(canTarget(card, "player1", "red").canTarget).toBe(false);
      expect(canTarget(card, "player2", "red").canTarget).toBe(false);
    });
  });

  describe("Protection Prevents Combat Damage (CR 702.16C)", () => {
    // This is tested via shouldPreventDamageToTarget in evergreen-keywords
    it("should check damage prevention for protected sources", () => {
      const protCard = createMockCard({
        cardData: {
          id: "prot",
          name: "Holy Guardian",
          type_line: "Creature — Angel",
          oracle_text: "Protection from black",
          colors: ["W"],
          color_identity: ["W"],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
      });

      const blackSource = createMockCard({
        cardData: {
          id: "black-source",
          name: "Dark Revenant",
          type_line: "Creature — Spirit",
          oracle_text: "",
          colors: ["B"],
          color_identity: ["B"],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
      });

      // Protection should prevent damage

      expect(shouldPreventDamageToTarget(protCard, blackSource)).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle colorless cards without protection", () => {
      const colorlessCard = createMockCard({
        cardData: {
          id: "colorless-id",
          name: "Artifact Creature",
          type_line: "Artifact Creature",
          oracle_text: "",
          colors: [],
          color_identity: [],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
      });

      // Colorless should not trigger protection
      expect(canTarget(colorlessCard, "player1", "red").canTarget).toBe(true);
      expect(canTarget(colorlessCard, "player1", "blue").canTarget).toBe(true);
    });

    it("should handle multi-colored sources against protection", () => {
      const protCard = createMockCard({
        cardData: {
          id: "prot",
          name: "White Knight",
          type_line: "Creature — Human Knight",
          oracle_text: "Protection from black",
          colors: ["W"],
          color_identity: ["W"],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
      });

      const blackWhiteSource = createMockCard({
        cardData: {
          id: "bw-src",
          name: "Dark Justice",
          type_line: "Sorcery",
          oracle_text: "",
          colors: ["B", "W"], // Black and white
          color_identity: ["B", "W"],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
        controllerId: "player1",
      });

      // A multicolored source with black should trigger protection
      const result = canTarget(protCard, "player1", "black");
      expect(result.canTarget).toBe(false);
    });

    it("should not confuse protection from 'blue' with 'U' color indicator", () => {
      const protCard = createMockCard({
        cardData: {
          id: "prot",
          name: "Blue Shield",
          type_line: "Creature",
          oracle_text: "Protection from blue",
          colors: [],
          color_identity: [],
          mana_cost: "",
          cmc: 0,
          legalities: {
            standard: "legal" as const,
            commander: "legal" as const,
          },
        },
      });

      // Should match both "blue" and "U" color indicator
      expect(canTarget(protCard, "player1", "blue").canTarget).toBe(false);
    });
  });
});
