/**
 * Unit tests for Targeting Validation System
 * Issue #857: Protection/hexproof targeting validation (CR 702.16)
 *
 * Tests CR 702.16 (Protection), CR 702.11 (Hexproof), CR 702.18 (Shroud)
 */

import { createInitialGameState, startGame } from "../game-state";
import type { ScryfallCard } from "@/app/actions";
import type {
  CardInstance,
  GameState,
  PlayerId,
  CardInstanceId,
} from "../types";
import { createCardInstance } from "../card-instance";
import {
  hasShroud,
  hasProtectionFromColor,
  getProtectionQualities,
  getCardColors,
  isProtectedFromSource,
  hasHexproof,
  isProtectedByHexproof,
  canTargetCard,
  validateSpellTargets,
  getWardRequirements,
  getTargetingRestrictions,
  TargetValidationResult,
} from "../targeting-validation";

/**
 * Create a mock creature for testing
 */
function createMockCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
  colors: string[] = ["R"],
  oracleText: string = "",
): ScryfallCard {
  return {
    id: `mock-creature-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    type_line: "Creature — Human Soldier",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords,
    oracle_text: oracleText || keywords.join(". "),
    mana_cost: "{1}",
    cmc: 1,
    colors,
    color_identity: colors,
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as unknown as ScryfallCard;
}

/**
 * Create a mock spell for testing targeting
 */
function createMockSpell(
  name: string,
  colors: string[] = ["R"],
  oracleText: string = "",
): ScryfallCard {
  return {
    id: `mock-spell-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    type_line: "Instant",
    keywords: [],
    oracle_text: oracleText || `Deal 3 damage to any target.`,
    mana_cost: "{1}",
    cmc: 1,
    colors,
    color_identity: colors,
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as unknown as ScryfallCard;
}

describe("Targeting Validation System", () => {
  describe("hasShroud (CR 702.18)", () => {
    it("should detect shroud from oracle text", () => {
      const card = createMockCreature(
        "SilverKnight",
        2,
        2,
        [],
        ["W"],
        "Flash. Hexproof. Shroud.",
      );
      const instance = createCardInstance(card, "player1", "player1");

      expect(hasShroud(instance)).toBe(true);
    });

    it("should return false when card has no shroud", () => {
      const card = createMockCreature(
        "SilverKnight",
        2,
        2,
        [],
        ["W"],
        "Flash. Hexproof.",
      );
      const instance = createCardInstance(card, "player1", "player1");

      expect(hasShroud(instance)).toBe(false);
    });

    it("should be case insensitive", () => {
      const card = createMockCreature(
        "SilverKnight",
        2,
        2,
        [],
        ["W"],
        "SHROUD",
      );
      const instance = createCardInstance(card, "player1", "player1");

      expect(hasShroud(instance)).toBe(true);
    });

    it("should not match words containing 'shroud' as substring", () => {
      const card = createMockCreature(
        "SilverKnight",
        2,
        2,
        [],
        ["W"],
        "This has the word unshroud",
      );
      const instance = createCardInstance(card, "player1", "player1");

      expect(hasShroud(instance)).toBe(false);
    });
  });

  describe("hasProtectionFromColor (CR 702.16)", () => {
    it("should detect protection from a single color", () => {
      const card = createMockCreature(
        "Guardian",
        2,
        2,
        [],
        ["W"],
        "Protection from red",
      );
      const instance = createCardInstance(card, "player1", "player1");

      expect(hasProtectionFromColor(instance, "red")).toBe(true);
      expect(hasProtectionFromColor(instance, "blue")).toBe(false);
    });

    it("should detect protection from multiple colors", () => {
      const card = createMockCreature(
        "Guardian",
        2,
        2,
        [],
        ["W"],
        "Protection from red and blue",
      );
      const instance = createCardInstance(card, "player1", "player1");

      expect(hasProtectionFromColor(instance, "red")).toBe(true);
      expect(hasProtectionFromColor(instance, "blue")).toBe(true);
    });

    it("should handle color symbols", () => {
      const card = createMockCreature(
        "Guardian",
        2,
        2,
        [],
        ["W"],
        "Protection from black",
      );
      const instance = createCardInstance(card, "player1", "player1");

      expect(hasProtectionFromColor(instance, "black")).toBe(true);
      expect(hasProtectionFromColor(instance, "B")).toBe(true);
    });
  });

  describe("getProtectionQualities (CR 702.16)", () => {
    it("should extract single protection quality", () => {
      const card = createMockCreature(
        "Guardian",
        2,
        2,
        [],
        ["W"],
        "Protection from black",
      );
      const instance = createCardInstance(card, "player1", "player1");

      const qualities = getProtectionQualities(instance);
      expect(qualities).toContain("black");
    });

    it("should extract multiple protection qualities", () => {
      const card = createMockCreature(
        "Guardian",
        2,
        2,
        [],
        ["W"],
        "Protection from red and blue",
      );
      const instance = createCardInstance(card, "player1", "player1");

      const qualities = getProtectionQualities(instance);
      expect(qualities).toContain("red");
      expect(qualities).toContain("blue");
    });

    it("should return empty array when no protection", () => {
      const card = createMockCreature("Guardian", 2, 2, [], ["W"], "Flying");
      const instance = createCardInstance(card, "player1", "player1");

      const qualities = getProtectionQualities(instance);
      expect(qualities).toEqual([]);
    });
  });

  describe("hasHexproof (CR 702.11)", () => {
    it("should detect hexproof from oracle text", () => {
      const card = createMockCreature("Silverg", 2, 2, [], ["U"], "Hexproof");
      const instance = createCardInstance(card, "player1", "player1");

      expect(hasHexproof(instance)).toBe(true);
    });

    it("should return false when card has no hexproof", () => {
      const card = createMockCreature("Silverg", 2, 2, [], ["U"], "Flying");
      const instance = createCardInstance(card, "player1", "player1");

      expect(hasHexproof(instance)).toBe(false);
    });
  });

  describe("isProtectedByHexproof (CR 702.11)", () => {
    it("should return true when opponent tries to target hexproof creature", () => {
      const card = createMockCreature("Silverg", 2, 2, [], ["U"], "Hexproof");
      const instance = createCardInstance(card, "player1", "player1");

      expect(isProtectedByHexproof(instance, "player2")).toBe(true);
    });

    it("should return false when controller tries to target own creature", () => {
      const card = createMockCreature("Silverg", 2, 2, [], ["U"], "Hexproof");
      const instance = createCardInstance(card, "player1", "player1");

      expect(isProtectedByHexproof(instance, "player1")).toBe(false);
    });

    it("should return false when creature has no hexproof", () => {
      const card = createMockCreature("Silverg", 2, 2, [], ["U"], "Flying");
      const instance = createCardInstance(card, "player1", "player1");

      expect(isProtectedByHexproof(instance, "player2")).toBe(false);
    });
  });

  describe("isProtectedFromSource (CR 702.16)", () => {
    it("should detect when target has protection from source color", () => {
      // Target has protection from red
      const targetCard = createMockCreature(
        "Guardian",
        2,
        2,
        [],
        ["W"],
        "Protection from red",
      );
      const target = createCardInstance(targetCard, "player1", "player1");

      // Source is red
      const sourceCard = createMockSpell(
        "Lightning Bolt",
        ["R"],
        "Lightning Bolt deals 3 damage",
      );
      const source = createCardInstance(sourceCard, "player2", "player2");

      expect(isProtectedFromSource(target, source)).toBe(true);
    });

    it("should return false when source color has no protection", () => {
      // Target has protection from red
      const targetCard = createMockCreature(
        "Guardian",
        2,
        2,
        [],
        ["W"],
        "Protection from red",
      );
      const target = createCardInstance(targetCard, "player1", "player1");

      // Source is blue
      const sourceCard = createMockSpell(
        "Counterspell",
        ["U"],
        "Counter target spell",
      );
      const source = createCardInstance(sourceCard, "player2", "player2");

      expect(isProtectedFromSource(target, source)).toBe(false);
    });

    it("should handle multicolor sources correctly", () => {
      // Target has protection from red
      const targetCard = createMockCreature(
        "Guardian",
        2,
        2,
        [],
        ["W"],
        "Protection from red",
      );
      const target = createCardInstance(targetCard, "player1", "player1");

      // Source is red/blue
      const sourceCard = createMockSpell(
        " Volcanic " as string,
        ["R", "U"],
        "Deal 3 damage",
      );
      const source = createCardInstance(sourceCard, "player2", "player2");

      expect(isProtectedFromSource(target, source)).toBe(true);
    });
  });

  describe("canTargetCard (CR 702.16/702.11/702.18)", () => {
    it("should reject targeting when target has shroud", () => {
      const targetCard = createMockCreature(
        "Invisible",
        2,
        2,
        [],
        ["U"],
        "Shroud",
      );
      const target = createCardInstance(targetCard, "player1", "player1");

      const sourceCard = createMockSpell("Shock", ["R"], "Deal 2 damage");
      const source = createCardInstance(sourceCard, "player2", "player2");

      const result = canTargetCard(target, source, "player2");

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("shroud");
    });

    it("should reject targeting when target has hexproof and source is opponent", () => {
      const targetCard = createMockCreature(
        "Silverg",
        2,
        2,
        [],
        ["U"],
        "Hexproof",
      );
      const target = createCardInstance(targetCard, "player1", "player1");

      const sourceCard = createMockSpell("Shock", ["R"], "Deal 2 damage");
      const source = createCardInstance(sourceCard, "player2", "player2");

      const result = canTargetCard(target, source, "player2");

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("hexproof");
    });

    it("should allow targeting when source controller is same as target controller", () => {
      const targetCard = createMockCreature(
        "Silverg",
        2,
        2,
        [],
        ["U"],
        "Hexproof",
      );
      const target = createCardInstance(targetCard, "player1", "player1");

      const sourceCard = createMockSpell("Shock", ["R"], "Deal 2 damage");
      const source = createCardInstance(sourceCard, "player1", "player1");

      const result = canTargetCard(target, source, "player1");

      expect(result.valid).toBe(true);
    });

    it("should reject targeting when target has protection from source color", () => {
      const targetCard = createMockCreature(
        "Guardian",
        2,
        2,
        [],
        ["W"],
        "Protection from red",
      );
      const target = createCardInstance(targetCard, "player1", "player1");

      const sourceCard = createMockSpell(
        "Lightning Bolt",
        ["R"],
        "Deal 3 damage",
      );
      const source = createCardInstance(sourceCard, "player2", "player2");

      const result = canTargetCard(target, source, "player2");

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("protection");
    });

    it("should allow targeting when no protection/hexproof/shroud", () => {
      const targetCard = createMockCreature(
        "Soldier",
        2,
        2,
        [],
        ["W"],
        "Flying",
      );
      const target = createCardInstance(targetCard, "player1", "player1");

      const sourceCard = createMockSpell(
        "Lightning Bolt",
        ["R"],
        "Deal 3 damage",
      );
      const source = createCardInstance(sourceCard, "player2", "player2");

      const result = canTargetCard(target, source, "player2");

      expect(result.valid).toBe(true);
    });
  });

  describe("validateSpellTargets", () => {
    // Helper to create minimal game state for testing
    function createMinimalState(
      player1Name: string,
      player2Name: string,
    ): GameState {
      const initialState = createInitialGameState(
        [player1Name, player2Name],
        20,
        false,
      );
      return startGame(initialState);
    }

    it("should validate multiple targets", () => {
      const state = createMinimalState("player1", "player2");

      // Create target with protection from red
      const target1Card = createMockCreature(
        "Guardian",
        2,
        2,
        [],
        ["W"],
        "Protection from red",
      );
      const target1 = createCardInstance(target1Card, "player2", "player2");

      // Create another target
      const target2Card = createMockCreature("Soldier", 2, 2, [], ["W"], "");
      const target2 = createCardInstance(target2Card, "player2", "player2");

      // Create source
      const sourceCard = createMockSpell(
        "Lightning Bolt",
        ["R"],
        "Deal 3 damage",
      );
      const source = createCardInstance(sourceCard, "player1", "player1");

      // Add cards to state
      state.cards.set(target1.id, target1);
      state.cards.set(target2.id, target2);
      state.cards.set(source.id, source);

      const result = validateSpellTargets(state, source.id, [
        target1.id,
        target2.id,
      ]);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("protection");
    });

    it("should return valid when all targets are legal", () => {
      const state = createMinimalState("player1", "player2");

      // Create targets
      const target1Card = createMockCreature("Soldier1", 2, 2, [], ["W"], "");
      const target1 = createCardInstance(target1Card, "player2", "player2");

      const target2Card = createMockCreature("Soldier2", 2, 2, [], ["W"], "");
      const target2 = createCardInstance(target2Card, "player2", "player2");

      // Create source
      const sourceCard = createMockSpell("Fireball", ["R"], "Deal 3 damage");
      const source = createCardInstance(sourceCard, "player1", "player1");

      // Add cards to state
      state.cards.set(target1.id, target1);
      state.cards.set(target2.id, target2);
      state.cards.set(source.id, source);

      const result = validateSpellTargets(state, source.id, [
        target1.id,
        target2.id,
      ]);

      expect(result.valid).toBe(true);
    });
  });

  describe("getTargetingRestrictions", () => {
    it("should list all targeting restrictions", () => {
      const card = createMockCreature(
        "Armored",
        2,
        2,
        [],
        ["W"],
        "Protection from red. Hexproof. Shroud.",
      );
      const instance = createCardInstance(card, "player1", "player1");

      const restrictions = getTargetingRestrictions(instance);

      expect(restrictions).toContain("Shroud (can't be targeted)");
      expect(restrictions).toContain(
        "Hexproof (can't be targeted by opponents)",
      );
      expect(restrictions).toContain("Protection from red");
    });

    it("should return empty array for unrestricted cards", () => {
      const card = createMockCreature("Soldier", 2, 2, [], ["W"], "Flying");
      const instance = createCardInstance(card, "player1", "player1");

      const restrictions = getTargetingRestrictions(instance);

      expect(restrictions).toEqual([]);
    });
  });

  describe("Integration scenarios", () => {
    it("should block Lightning Bolt from targeting white protection creature", () => {
      // Creature with protection from red
      const creatureCard = createMockCreature(
        "White Knight",
        2,
        2,
        [],
        ["W"],
        "Protection from red. First strike.",
      );
      const creature = createCardInstance(creatureCard, "player2", "player2");

      // Lightning Bolt (red)
      const boltCard = createMockSpell(
        "Lightning Bolt",
        ["R"],
        "Lightning Bolt deals 3 damage to any target.",
      );
      const bolt = createCardInstance(boltCard, "player1", "player1");

      const result = canTargetCard(creature, bolt, "player1");

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("protection");
    });

    it("should block blue player from targeting opponent's hexproof creature", () => {
      // Hexproof creature controlled by player2
      const creatureCard = createMockCreature(
        "Mistfolk",
        2,
        2,
        [],
        ["U"],
        "Hexproof",
      );
      const creature = createCardInstance(creatureCard, "player2", "player2");

      // Counterspell cast by player1 targeting the hexproof creature
      const counterCard = createMockSpell(
        "Counterspell",
        ["U"],
        "Counter target spell",
      );
      const counter = createCardInstance(counterCard, "player1", "player1");

      const result = canTargetCard(creature, counter, "player1");

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("hexproof");
    });

    it("should allow targeting own hexproof creature", () => {
      // Hexproof creature controlled by player1
      const creatureCard = createMockCreature(
        "Mistfolk",
        2,
        2,
        [],
        ["U"],
        "Hexproof",
      );
      const creature = createCardInstance(creatureCard, "player1", "player1");

      // Buff spell cast by player1 targeting own creature
      const buffCard = createMockSpell(
        "Boost",
        ["U"],
        "Target creature gets +1/+1",
      );
      const buff = createCardInstance(buffCard, "player1", "player1");

      const result = canTargetCard(creature, buff, "player1");

      expect(result.valid).toBe(true);
    });

    it("should block shroud creature from being targeted by any source", () => {
      // Shroud creature
      const creatureCard = createMockCreature(
        "InvisibleStalker",
        2,
        2,
        [],
        ["U"],
        "Hexproof. Shroud.",
      );
      const creature = createCardInstance(creatureCard, "player1", "player1");

      // Any spell
      const spellCard = createMockSpell("Any Spell", ["U"], "Do something");
      const spell = createCardInstance(spellCard, "player1", "player1");

      const result = canTargetCard(creature, spell, "player1");

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("shroud");
    });
  });

  // -------------------------------------------------------------------------
  // Ward (CR 702.21) — Issue #970
  //
  // Ward is fundamentally different from shroud/hexproof/protection: it does
  // NOT block targeting. The target is legal, but a ward cost payment is
  // required; if unpaid at resolution, the spell/ability is countered.
  // -------------------------------------------------------------------------

  describe("Ward targeting validation (CR 702.21) — Issue #970", () => {
    function createWardedCreature(
      name: string,
      oracleText: string,
    ): ScryfallCard {
      return {
        id: `mock-warded-${name.toLowerCase().replace(/\s+/g, "-")}`,
        name,
        type_line: "Creature — Test",
        power: "2",
        toughness: "2",
        keywords: [],
        oracle_text: oracleText,
        mana_cost: "{1}{U}",
        cmc: 2,
        colors: ["U"],
        color_identity: ["U"],
        legalities: { standard: "legal", commander: "legal" },
        card_faces: undefined,
        layout: "normal",
      } as unknown as ScryfallCard;
    }

    function createMinimalState(p1: string, p2: string): GameState {
      const initialState = createInitialGameState([p1, p2], 20, false);
      return startGame(initialState);
    }

    it("surfaces a ward requirement (target still valid) when an opponent targets a warded permanent", () => {
      const targetCard = createWardedCreature("Warded", "Ward {2}");
      const target = createCardInstance(targetCard, "player2", "player2");

      const sourceCard = createMockSpell("Shock", ["R"], "Deal 2 damage");
      const source = createCardInstance(sourceCard, "player1", "player1");

      const result = canTargetCard(target, source, "player1");

      // Targeting is LEGAL — ward is a payment trigger, not a hard block.
      expect(result.valid).toBe(true);
      // ...but a ward payment is required.
      expect(result.wardRequired).toBeDefined();
      expect(result.wardRequired?.targetCardId).toBe(target.id);
      expect(result.wardRequired?.wardControllerId).toBe("player2");
      expect(result.wardRequired?.cost).toMatchObject({
        kind: "mana",
        generic: 2,
      });
    });

    it("does NOT surface ward when the controller targets their own warded permanent", () => {
      const targetCard = createWardedCreature("Warded", "Ward {2}");
      const target = createCardInstance(targetCard, "player1", "player1");

      const sourceCard = createMockSpell("Giant Growth", ["G"], "+3/+3");
      const source = createCardInstance(sourceCard, "player1", "player1");

      const result = canTargetCard(target, source, "player1");

      expect(result.valid).toBe(true);
      expect(result.wardRequired).toBeUndefined();
    });

    it("does NOT surface ward for a non-warded target", () => {
      const targetCard = createMockCreature("Plain", 2, 2, [], ["W"], "Flying");
      const target = createCardInstance(targetCard, "player2", "player2");

      const sourceCard = createMockSpell("Shock", ["R"], "Deal 2 damage");
      const source = createCardInstance(sourceCard, "player1", "player1");

      const result = canTargetCard(target, source, "player1");

      expect(result.valid).toBe(true);
      expect(result.wardRequired).toBeUndefined();
    });

    it("surfaces ward only for opponent (not for the ward permanent's controller)", () => {
      const targetCard = createWardedCreature("Warded", "Ward {1}{U}");
      const target = createCardInstance(targetCard, "player2", "player2");

      const sourceCard = createMockSpell("Shock", ["R"], "Deal 2 damage");
      const source = createCardInstance(sourceCard, "player1", "player1");

      // Opponent (player1) -> ward triggers.
      expect(canTargetCard(target, source, "player1").wardRequired).toBeDefined();

      // Controller (player2) targeting their own warded permanent -> no ward.
      expect(
        canTargetCard(target, source, "player2").wardRequired,
      ).toBeUndefined();
    });

    it("parses a life-ward cost into the requirement", () => {
      const targetCard = createWardedCreature("Life Warded", "Ward—Pay 3 life.");
      const target = createCardInstance(targetCard, "player2", "player2");

      const sourceCard = createMockSpell("Shock", ["R"], "Deal 2 damage");
      const source = createCardInstance(sourceCard, "player1", "player1");

      const result = canTargetCard(target, source, "player1");

      expect(result.valid).toBe(true);
      expect(result.wardRequired?.cost).toMatchObject({
        kind: "life",
        amount: 3,
      });
    });

    it("still applies shroud/hexproof/protection BEFORE ward (hard blocks win)", () => {
      // A permanent with both shroud and ward cannot be targeted at all.
      const targetCard = createWardedCreature(
        "Lockdown",
        "Shroud. Ward {2}.",
      );
      const target = createCardInstance(targetCard, "player2", "player2");

      const sourceCard = createMockSpell("Shock", ["R"], "Deal 2 damage");
      const source = createCardInstance(sourceCard, "player1", "player1");

      const result = canTargetCard(target, source, "player1");

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("shroud");
      expect(result.wardRequired).toBeUndefined();
    });
  });

  describe("validateSpellTargets ward aggregation (CR 702.21) — Issue #970", () => {
    function createWardedCreature(
      name: string,
      oracleText: string,
    ): ScryfallCard {
      return {
        id: `mock-warded-${name.toLowerCase().replace(/\s+/g, "-")}`,
        name,
        type_line: "Creature — Test",
        power: "2",
        toughness: "2",
        keywords: [],
        oracle_text: oracleText,
        mana_cost: "{1}{U}",
        cmc: 2,
        colors: ["U"],
        color_identity: ["U"],
        legalities: { standard: "legal", commander: "legal" },
        card_faces: undefined,
        layout: "normal",
      } as unknown as ScryfallCard;
    }

    function createMinimalState(p1: string, p2: string): GameState {
      const initialState = createInitialGameState([p1, p2], 20, false);
      return startGame(initialState);
    }

    it("collects ward requirements for multiple warded targets", () => {
      const state = createMinimalState("player1", "player2");

      const w1Card = createWardedCreature("Warded One", "Ward {2}");
      const w1 = createCardInstance(w1Card, "player2", "player2");
      const w2Card = createWardedCreature("Warded Two", "Ward {1}");
      const w2 = createCardInstance(w2Card, "player2", "player2");
      const sourceCard = createMockSpell("Fireball", ["R"], "Deal damage");
      const source = createCardInstance(sourceCard, "player1", "player1");

      state.cards.set(w1.id, w1);
      state.cards.set(w2.id, w2);
      state.cards.set(source.id, source);

      const result = validateSpellTargets(state, source.id, [w1.id, w2.id]);

      expect(result.valid).toBe(true);
      expect(result.wardRequirements).toHaveLength(2);
      expect(result.wardRequirements?.map((w) => w.targetCardId)).toEqual(
        expect.arrayContaining([w1.id, w2.id]),
      );
    });

    it("getWardRequirements returns the same requirements ergonomically", () => {
      const state = createMinimalState("player1", "player2");

      const wCard = createWardedCreature("Warded", "Ward {2}");
      const w = createCardInstance(wCard, "player2", "player2");
      const sourceCard = createMockSpell("Shock", ["R"], "Deal 2 damage");
      const source = createCardInstance(sourceCard, "player1", "player1");

      state.cards.set(w.id, w);
      state.cards.set(source.id, source);

      const reqs = getWardRequirements(state, source.id, [w.id]);

      expect(reqs).toHaveLength(1);
      expect(reqs[0].targetCardId).toBe(w.id);
      expect(reqs[0].cost).toMatchObject({ kind: "mana", generic: 2 });
    });

    it("returns no ward requirements for a non-targeted spell (empty targets)", () => {
      const state = createMinimalState("player1", "player2");

      const sourceCard = createMockSpell("Divination", ["U"], "Draw 2 cards");
      const source = createCardInstance(sourceCard, "player1", "player1");
      state.cards.set(source.id, source);

      // No targets at all — ward never triggers.
      const result = validateSpellTargets(state, source.id, []);

      expect(result.valid).toBe(true);
      expect(result.wardRequirements).toBeUndefined();
      expect(getWardRequirements(state, source.id, [])).toEqual([]);
    });

    it("still returns the first hard-block reason (ward does not override protection)", () => {
      const state = createMinimalState("player1", "player2");

      // A target that has BOTH protection from red AND ward — protection wins.
      const targetCard = createMockCreature(
        "Guardian",
        2,
        2,
        [],
        ["W"],
        "Protection from red. Ward {2}.",
      );
      const target = createCardInstance(targetCard, "player2", "player2");
      const sourceCard = createMockSpell("Shock", ["R"], "Deal 2 damage");
      const source = createCardInstance(sourceCard, "player1", "player1");

      state.cards.set(target.id, target);
      state.cards.set(source.id, source);

      const result = validateSpellTargets(state, source.id, [target.id]);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("protection");
      expect(result.wardRequirements).toBeUndefined();
    });

    it("treats a warded permanent with no ward cost as still valid (no requirement surfaced)", () => {
      // Edge case: if a card's oracle text says "Ward" but parsing somehow
      // yields no cost, canTargetCard must not crash and must not surface a
      // requirement with a null cost. The default-cost path in evergreen
      // keywords means this is mostly defensive.
      const state = createMinimalState("player1", "player2");

      const wCard = createWardedCreature("Warded", "Ward {2}");
      const w = createCardInstance(wCard, "player2", "player2");
      const sourceCard = createMockSpell("Shock", ["R"], "Deal 2 damage");
      const source = createCardInstance(sourceCard, "player1", "player1");

      state.cards.set(w.id, w);
      state.cards.set(source.id, source);

      const result = validateSpellTargets(state, source.id, [w.id]);
      expect(result.valid).toBe(true);
      // A cost IS surfaced here because {2} parses cleanly.
      expect(result.wardRequirements?.[0].cost).toBeDefined();
    });
  });

  describe("getTargetingRestrictions includes ward (CR 702.21)", () => {
    it("lists ward as a payment restriction (not a hard block)", () => {
      const card = createCardInstance(
        {
          id: "mock-restrict-warded",
          name: "Warded",
          type_line: "Creature — Test",
          power: "2",
          toughness: "2",
          keywords: [],
          oracle_text: "Ward {2}. Flying.",
          mana_cost: "{1}{U}",
          cmc: 2,
          colors: ["U"],
          color_identity: ["U"],
          legalities: { standard: "legal", commander: "legal" },
          card_faces: undefined,
          layout: "normal",
        } as unknown as ScryfallCard,
        "player1",
        "player1",
      );

      const restrictions = getTargetingRestrictions(card);

      expect(restrictions.some((r) => /^Ward/.test(r))).toBe(true);
    });
  });
});
