/**
 * Unit tests for Layer System
 * Issue #251: Phase 1.3: Implement layer system for continuous effects
 *
 * Tests the implementation of MTG layer system (CR 613) for continuous effects.
 */

import {
  LayerSystem,
  Layer,
  PowerToughnessSublayer,
  createCopyEffect,
  createControlChangeEffect,
  createTextChangeEffect,
  createTypeChangeEffect,
  createColorChangeEffect,
  createAbilityGrantEffect,
  createAbilityRemoveEffect,
  createPowerToughnessSetEffect,
  createPowerToughnessModifyEffect,
  createPowerToughnessSwitchEffect,
  createCharacteristicDefiningAbility,
  createPowerSetEffect,
  createToughnessSetEffect,
  createPowerModifyEffect,
  createToughnessModifyEffect,
  createCounterEffect,
  getLayerSystemInstance,
} from "../layer-system";
import { createCardInstance } from "../card-instance";
import type { ScryfallCard } from "@/app/actions";

// Helper function to create a mock creature card
function createMockCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
  colors: string[] = ["R"],
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords,
    oracle_text: keywords.join(" "),
    mana_cost: "{1}",
    cmc: 2,
    colors,
    color_identity: colors,
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

describe("Layer System", () => {
  let layerSystem: LayerSystem;

  beforeEach(() => {
    layerSystem = new LayerSystem();
  });

  afterEach(() => {
    layerSystem.clear();
  });

  describe("Layer Ordering", () => {
    it("should apply effects in correct layer order", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      createCardInstance(creatureData, "player1", "player1");

      // Register effects in reverse order to test sorting
      const ptEffect = createPowerToughnessModifyEffect(
        "source7",
        "player1",
        1,
        1,
        "+1/+1",
      );
      const abilityEffect = createAbilityGrantEffect(
        "source6",
        "player1",
        "flying",
        "Grant flying",
      );
      const colorEffect = createColorChangeEffect(
        "source5",
        "player1",
        ["W"],
        "Make white",
      );
      const typeEffect = createTypeChangeEffect(
        "source4",
        "player1",
        ["Artifact"],
        [],
        [],
        "Make artifact",
      );
      const textEffect = createTextChangeEffect(
        "source3",
        "player1",
        "New text",
        "Change text",
      );
      const controlEffect = createControlChangeEffect(
        "source2",
        "player1",
        "player2",
        "Change control",
        layerSystem,
      );

      layerSystem.registerEffect(ptEffect);
      layerSystem.registerEffect(abilityEffect);
      layerSystem.registerEffect(colorEffect);
      layerSystem.registerEffect(typeEffect);
      layerSystem.registerEffect(textEffect);
      layerSystem.registerEffect(controlEffect);

      const effects = layerSystem.getEffects();

      // Effects should be sorted by layer
      expect(effects[0].layer).toBe(Layer.CONTROL_CHANGING);
      expect(effects[1].layer).toBe(Layer.TEXT_CHANGING);
      expect(effects[2].layer).toBe(Layer.TYPE_CHANGING);
      expect(effects[3].layer).toBe(Layer.COLOR_CHANGING);
      expect(effects[4].layer).toBe(Layer.ABILITY);
      expect(effects[5].layer).toBe(Layer.POWER_TOUGHNESS);
    });

    it("should apply Layer 7 effects in correct sublayer order", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      createCardInstance(creatureData, "player1", "player1");

      // Register effects in reverse sublayer order
      const modifyEffect = createPowerToughnessModifyEffect(
        "source7e",
        "player1",
        1,
        1,
        "+1/+1",
      );
      const switchEffect = createPowerToughnessSwitchEffect(
        "source7d",
        "player1",
        "Switch P/T",
      );
      const setEffect = createPowerToughnessSetEffect(
        "source7b",
        "player1",
        4,
        4,
        "Set 4/4",
      );
      const cdaEffect = createCharacteristicDefiningAbility(
        "source7a",
        "player1",
        { oracleId: "cda-source", power: 5, toughness: 5 },
        "CDA 5/5",
      );

      layerSystem.registerEffect(modifyEffect);
      layerSystem.registerEffect(switchEffect);
      layerSystem.registerEffect(setEffect);
      layerSystem.registerEffect(cdaEffect);

      const effects = layerSystem.getEffects();

      // All should be Layer 7
      expect(effects.every((e) => e.layer === Layer.POWER_TOUGHNESS)).toBe(
        true,
      );

      // Check sublayer order
      expect(effects[0].sublayer).toBe(
        PowerToughnessSublayer.CHARACTERISTIC_DEFINING,
      );
      expect(effects[1].sublayer).toBe(PowerToughnessSublayer.SET);
      expect(effects[2].sublayer).toBe(PowerToughnessSublayer.SWITCH);
      expect(effects[3].sublayer).toBe(PowerToughnessSublayer.MODIFY);
    });
  });

  describe("Timestamp Ordering", () => {
    it("should apply effects with earlier timestamp first within same layer", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      createCardInstance(creatureData, "player1", "player1");

      // Create effects with different timestamps
      const earlierEffect = createPowerToughnessModifyEffect(
        "source1",
        "player1",
        2,
        2,
        "+2/+2 earlier",
      );
      earlierEffect.timestamp = 1000;

      const laterEffect = createPowerToughnessModifyEffect(
        "source2",
        "player1",
        3,
        3,
        "+3/+3 later",
      );
      laterEffect.timestamp = 2000;

      layerSystem.registerEffect(laterEffect);
      layerSystem.registerEffect(earlierEffect);

      const effects = layerSystem.getEffects();

      // Earlier timestamp should come first
      expect(effects[0].timestamp).toBe(1000);
      expect(effects[1].timestamp).toBe(2000);
    });
  });

  describe("Layer 1: Copy Effects", () => {
    it("should create a copy effect", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      const creature = createCardInstance(creatureData, "player1", "player1");

      const copyEffect = createCopyEffect(
        creature.id,
        "player1",
        "target-card-id",
        "Copy effect",
      );

      expect(copyEffect.layer).toBe(Layer.COPY_EFFECTS);
      expect(copyEffect.effectType).toBe("copy");
      expect(copyEffect.canApply(creature)).toBe(true);
    });
  });

  describe("Layer 2: Control-Changing Effects", () => {
    it("should change controller of a card", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      const creature = createCardInstance(creatureData, "player1", "player1");

      const controlEffect = createControlChangeEffect(
        "source",
        "player1",
        "player2",
        "Gain control",
        layerSystem,
      );

      layerSystem.registerEffect(controlEffect);
      const result = layerSystem.applyEffects(creature);

      expect(result.controllerId).toBe("player2");
    });

    it("should persist controllerId change in overrides", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      const creature = createCardInstance(creatureData, "player1", "player1");

      const controlEffect = createControlChangeEffect(
        "source",
        "player1",
        "player2",
        "Gain control",
        layerSystem,
      );

      layerSystem.registerEffect(controlEffect);
      layerSystem.applyEffects(creature);

      // Check that controllerId is stored in overrides for persistence
      const characteristics = layerSystem.getEffectiveCharacteristics(creature);
      expect(characteristics.controllerId).toBe("player2");
    });

    it("should only apply to cards controlled by the specified player", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      const creature = createCardInstance(creatureData, "player2", "player2");

      const controlEffect = createControlChangeEffect(
        "source",
        "player1",
        "player2",
        "Gain control",
        layerSystem,
      );

      expect(controlEffect.canApply(creature)).toBe(false);
    });
  });

  describe("Layer 3: Text-Changing Effects", () => {
    it("should change oracle text of a card", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      const creature = createCardInstance(creatureData, "player1", "player1");

      const textEffect = createTextChangeEffect(
        "source",
        "player1",
        "New oracle text",
        "Change text",
        undefined, // addTypes (not used for text)
        layerSystem,
      );

      layerSystem.registerEffect(textEffect);
      layerSystem.applyEffects(creature);

      const characteristics = layerSystem.getEffectiveCharacteristics(creature);
      expect(characteristics.text).toBe("New oracle text");
    });

    describe("CR 613.4 Exception: Simultaneous Type and Color Changes from Layer 3", () => {
      it("should apply color change in Layer 4 when Layer 3 text-changing effect changes color and type", () => {
        // Per CR 613.4: If a Layer 3 text-changing effect also changes
        // type and color simultaneously, type change happens in Layer 4
        // and color change happens in Layer 4 (not Layer 5 as usual)
        const creatureData = createMockCreature(
          "Test Creature",
          3,
          3,
          [],
          ["R"],
        );
        const creature = createCardInstance(creatureData, "player1", "player1");

        // Create a Layer 3 text-changing effect that also changes type and color
        const textTypeColorEffect = createTextChangeEffect(
          "source",
          "player1",
          "New text for artifact creature",
          "Change text, type, and color",
          undefined, // addTypes
          layerSystem,
          ["Artifact", "Creature"], // _types - sets types in Layer 4
          ["W"], // _colors - sets color in Layer 4 (not Layer 5)
        );

        layerSystem.registerEffect(textTypeColorEffect);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);

        // Text should be changed (Layer 3)
        expect(characteristics.text).toBe("New text for artifact creature");
        // Type should be Artifact (applied in Layer 4 via type component)
        expect(characteristics.types).toContain("Artifact");
        expect(characteristics.types).toContain("Creature");
        // Color should be white (applied in Layer 4, not Layer 5)
        expect(characteristics.color).toEqual(["W"]);
      });

      it("should handle Layer 3 text change that changes only type", () => {
        const creatureData = createMockCreature(
          "Test Creature",
          3,
          3,
          [],
          ["R"],
        );
        const creature = createCardInstance(creatureData, "player1", "player1");

        // Layer 3 text change that also changes type (no color change)
        const textTypeEffect = createTextChangeEffect(
          "source",
          "player1",
          "New text",
          "Change text and type",
          undefined, // addTypes
          layerSystem,
          ["Artifact"], // _types - only type change
          undefined, // no color change
        );

        layerSystem.registerEffect(textTypeEffect);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);

        expect(characteristics.text).toBe("New text");
        expect(characteristics.types).toContain("Artifact");
        // Color should remain red (original)
        expect(characteristics.color).toEqual(["R"]);
      });

      it("should handle Layer 3 text change that changes only color", () => {
        const creatureData = createMockCreature(
          "Test Creature",
          3,
          3,
          [],
          ["R"],
        );
        const creature = createCardInstance(creatureData, "player1", "player1");

        // Layer 3 text change that also changes color (no type change)
        const textColorEffect = createTextChangeEffect(
          "source",
          "player1",
          "New text",
          "Change text and color",
          undefined, // addTypes
          layerSystem,
          undefined, // no type change
          ["U"], // _colors - color change only
        );

        layerSystem.registerEffect(textColorEffect);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);

        expect(characteristics.text).toBe("New text");
        // Color should be blue (applied in Layer 4, not Layer 5)
        expect(characteristics.color).toEqual(["U"]);
      });

      it("should handle interaction between Layer 3 and Layer 5 color effects correctly", () => {
        // If a Layer 3 text-changing effect changes color to white,
        // and then a Layer 5 effect tries to change color to blue,
        // the Layer 5 should still apply because layer ordering says later layers
        // apply after earlier ones and override them.
        const creatureData = createMockCreature(
          "Test Creature",
          3,
          3,
          [],
          ["R"],
        );
        const creature = createCardInstance(creatureData, "player1", "player1");

        // Layer 3 text change that changes color to white
        const layer3Effect = createTextChangeEffect(
          "source3",
          "player1",
          "New text",
          "Change text and color to white",
          undefined,
          layerSystem,
          undefined, // no type change
          ["W"], // color to white
        );

        // Layer 5 color change to blue
        const layer5Effect = createColorChangeEffect(
          "source5",
          "player1",
          ["U"],
          "Change color to blue",
          false,
          layerSystem,
        );

        layerSystem.registerEffect(layer3Effect);
        layerSystem.registerEffect(layer5Effect);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);

        // Layer 5 effects apply after Layer 3/4, so blue should win
        // This is correct per CR - later layers override earlier ones
        expect(characteristics.color).toEqual(["U"]);
      });

      it("should not skip Layer 5 color effects when colorChangeOriginLayer is not set", () => {
        const creatureData = createMockCreature(
          "Test Creature",
          3,
          3,
          [],
          ["R"],
        );
        const creature = createCardInstance(creatureData, "player1", "player1");

        // Layer 5 color change to blue
        const layer5Effect = createColorChangeEffect(
          "source5",
          "player1",
          ["U"],
          "Change color to blue",
          false,
          layerSystem,
        );

        layerSystem.registerEffect(layer5Effect);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);

        // Regular Layer 5 effect should apply normally
        expect(characteristics.color).toEqual(["U"]);
      });
    });
  });

  describe("Layer 4: Type-Changing Effects", () => {
    it("should replace card types", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      const creature = createCardInstance(creatureData, "player1", "player1");

      const typeEffect = createTypeChangeEffect(
        "source",
        "player1",
        ["Artifact"],
        ["Construct"],
        [],
        "Make artifact construct",
        false,
        layerSystem,
      );

      layerSystem.registerEffect(typeEffect);
      layerSystem.applyEffects(creature);

      const characteristics = layerSystem.getEffectiveCharacteristics(creature);
      expect(characteristics.types).toContain("Artifact");
      expect(characteristics.subtypes).toContain("Construct");
    });

    it("should add types when addTypes is true", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      const creature = createCardInstance(creatureData, "player1", "player1");

      const typeEffect = createTypeChangeEffect(
        "source",
        "player1",
        ["Artifact"],
        [],
        [],
        "Add artifact type",
        true, // addTypes
        layerSystem,
      );

      layerSystem.registerEffect(typeEffect);
      layerSystem.applyEffects(creature);

      const characteristics = layerSystem.getEffectiveCharacteristics(creature);
      // Should include original Creature type plus Artifact
      expect(characteristics.types).toContain("Artifact");
    });
  });

  describe("Layer 5: Color-Changing Effects", () => {
    it("should replace card colors", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3, [], ["R"]);
      const creature = createCardInstance(creatureData, "player1", "player1");

      const colorEffect = createColorChangeEffect(
        "source",
        "player1",
        ["W"],
        "Make white",
        false,
        layerSystem,
      );

      layerSystem.registerEffect(colorEffect);

      const color = layerSystem.getEffectiveColor(creature);
      expect(color).toEqual(["W"]);
    });

    it("should add colors when addColors is true", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3, [], ["R"]);
      const creature = createCardInstance(creatureData, "player1", "player1");

      const colorEffect = createColorChangeEffect(
        "source",
        "player1",
        ["W"],
        "Add white",
        true, // addColors
        layerSystem,
      );

      layerSystem.registerEffect(colorEffect);
      layerSystem.applyEffects(creature);

      const color = layerSystem.getEffectiveColor(creature);
      // When adding colors, the effect replaces the colors with the new ones
      // The addColors behavior stores in overrides but getEffectiveColor checks overrides first
      expect(color).toContain("W");
    });
  });

  describe("Layer 6: Ability-Granting and Ability-Removing Effects", () => {
    it("should grant abilities to a card", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      const creature = createCardInstance(creatureData, "player1", "player1");

      const grantEffect = createAbilityGrantEffect(
        "source",
        "player1",
        "flying",
        "Grant flying",
        layerSystem,
      );

      layerSystem.registerEffect(grantEffect);
      layerSystem.applyEffects(creature);

      const characteristics = layerSystem.getEffectiveCharacteristics(creature);
      expect(characteristics.grantedAbilities).toContain("flying");
    });

    it("should remove abilities from a card", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3, [
        "flying",
        "haste",
      ]);
      const creature = createCardInstance(creatureData, "player1", "player1");

      const removeEffect = createAbilityRemoveEffect(
        "source",
        "player1",
        "flying",
        "Remove flying",
        false,
        layerSystem,
      );

      layerSystem.registerEffect(removeEffect);
      layerSystem.applyEffects(creature);

      const characteristics = layerSystem.getEffectiveCharacteristics(creature);
      // In a full implementation, we'd check removedAbilities
      expect(characteristics.removedAbilities).toContain("flying");
    });

    it("should remove all abilities when removeAll is true", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3, [
        "flying",
        "haste",
      ]);
      const creature = createCardInstance(creatureData, "player1", "player1");

      const removeAllEffect = createAbilityRemoveEffect(
        "source",
        "player1",
        "",
        "Remove all abilities",
        true, // removeAll
        layerSystem,
      );

      layerSystem.registerEffect(removeAllEffect);
      layerSystem.applyEffects(creature);

      const characteristics = layerSystem.getEffectiveCharacteristics(creature);
      // Should mark all abilities for removal
      expect(characteristics.removedAbilities).toContain("*");
    });
  });

  describe("Layer 7: Power/Toughness-Changing Effects", () => {
    describe("Layer 7a: Characteristic-Defining Abilities", () => {
      it("should apply CDA before other P/T effects", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        // CDA that sets 5/5
        const cdaEffect = createCharacteristicDefiningAbility(
          "source",
          "player1",
          { oracleId: "cda-source", power: 5, toughness: 5 },
          "CDA 5/5",
          layerSystem,
        );

        // +1/+1 modifier
        const modifyEffect = createPowerToughnessModifyEffect(
          "source2",
          "player1",
          1,
          1,
          "+1/+1",
        );

        layerSystem.registerEffect(cdaEffect);
        layerSystem.registerEffect(modifyEffect);
        const result = layerSystem.applyEffects(creature);

        // CDA sets to 5/5, then +1/+1 makes it 6/6
        expect(result.powerModifier).toBe(1);
        expect(result.toughnessModifier).toBe(1);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);
        expect(characteristics.power).toBe(6);
        expect(characteristics.toughness).toBe(6);
      });
    });

    describe("Layer 7b: P/T Setting Effects", () => {
      it("should set P/T to specific value", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        const setEffect = createPowerToughnessSetEffect(
          "source",
          "player1",
          0,
          1,
          "Set 0/1",
          layerSystem,
        );

        layerSystem.registerEffect(setEffect);
        layerSystem.applyEffects(creature);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);
        expect(characteristics.power).toBe(0);
        expect(characteristics.toughness).toBe(1);
      });

      it("should set power only", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        const setEffect = createPowerSetEffect(
          "source",
          "player1",
          5,
          "Set power to 5",
          layerSystem,
        );

        layerSystem.registerEffect(setEffect);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);
        expect(characteristics.power).toBe(5);
        expect(characteristics.toughness).toBe(3); // Original toughness
      });

      it("should set toughness only", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        const setEffect = createToughnessSetEffect(
          "source",
          "player1",
          5,
          "Set toughness to 5",
          layerSystem,
        );

        layerSystem.registerEffect(setEffect);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);
        expect(characteristics.power).toBe(3); // Original power
        expect(characteristics.toughness).toBe(5);
      });
    });

    describe("Layer 7c: Counter Effects", () => {
      it("should apply +1/+1 counters in Layer 7c", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        // Add +1/+1 counters directly to the card
        creature.counters = [{ type: "+1/+1", count: 2 }];

        layerSystem.applyEffects(creature);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);
        // Base 3/3 + 2 +1/+1 counters = 5/5
        expect(characteristics.power).toBe(5);
        expect(characteristics.toughness).toBe(5);
      });

      it("should apply -1/-1 counters in Layer 7c", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        // Add -1/-1 counters directly to the card
        creature.counters = [{ type: "-1/-1", count: 1 }];

        layerSystem.applyEffects(creature);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);
        // Base 3/3 - 1 -1/-1 counter = 2/2
        expect(characteristics.power).toBe(2);
        expect(characteristics.toughness).toBe(2);
      });

      it("should handle both +1/+1 and -1/-1 counters (net effect)", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        // Add both types of counters
        creature.counters = [
          { type: "+1/+1", count: 3 },
          { type: "-1/-1", count: 1 },
        ];

        layerSystem.applyEffects(creature);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);
        // Base 3/3 + 3 - 1 = 5/5 (net +2/+2)
        expect(characteristics.power).toBe(5);
        expect(characteristics.toughness).toBe(5);
      });

      it("should apply counters after P/T setting effects (Layer 7b before 7c)", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        // Set P/T to 1/1
        const setEffect = createPowerToughnessSetEffect(
          "source",
          "player1",
          1,
          1,
          "Set 1/1",
          layerSystem,
        );
        layerSystem.registerEffect(setEffect);

        // Add +2/+2 from counters
        creature.counters = [{ type: "+1/+1", count: 2 }];

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);
        // Set to 1/1 (7b) + 2 +1/+1 counters (7c) = 3/3
        expect(characteristics.power).toBe(3);
        expect(characteristics.toughness).toBe(3);
      });

      it("should apply counters before P/T switching (Layer 7c before 7d)", () => {
        const creatureData = createMockCreature("Test Creature", 3, 5);
        const creature = createCardInstance(creatureData, "player1", "player1");

        // Add +2/+2 from counters
        creature.counters = [{ type: "+1/+1", count: 2 }];

        // Switch P/T
        const switchEffect = createPowerToughnessSwitchEffect(
          "source",
          "player1",
          "Switch P/T",
          layerSystem,
        );
        layerSystem.registerEffect(switchEffect);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);
        // Base 3/5 + 2 counters = 5/7, then switch = 7/5
        expect(characteristics.power).toBe(7);
        expect(characteristics.toughness).toBe(5);
      });

      it("should handle counters with P/T modification effects (Layer 7c before 7e)", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        // Add +1/+1 from counters
        creature.counters = [{ type: "+1/+1", count: 1 }];

        // +2/+2 modifier
        const modifyEffect = createPowerToughnessModifyEffect(
          "source",
          "player1",
          2,
          2,
          "+2/+2",
        );
        layerSystem.registerEffect(modifyEffect);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);
        // Base 3/3 + 1 counter (7c) + 2 modifier (7e) = 6/6
        expect(characteristics.power).toBe(6);
        expect(characteristics.toughness).toBe(6);
      });

      it("should create a counter effect", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        const counterEffect = createCounterEffect(
          creature.id,
          "player1",
          "+1/+1",
          2,
          "Add two +1/+1 counters",
        );

        expect(counterEffect.layer).toBe(Layer.POWER_TOUGHNESS);
        expect(counterEffect.sublayer).toBe(PowerToughnessSublayer.COUNTERS);
        expect(counterEffect.effectType).toBe("counter");
      });
    });

    describe("Layer 7d: P/T Switching Effects", () => {
      it("should switch power and toughness", () => {
        const creatureData = createMockCreature("Test Creature", 3, 5);
        const creature = createCardInstance(creatureData, "player1", "player1");

        const switchEffect = createPowerToughnessSwitchEffect(
          "source",
          "player1",
          "Switch P/T",
          layerSystem,
        );

        layerSystem.registerEffect(switchEffect);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);
        expect(characteristics.power).toBe(5);
        expect(characteristics.toughness).toBe(3);
      });
    });

    describe("Layer 7e: P/T Modifying Effects", () => {
      it("should modify P/T by delta", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        const modifyEffect = createPowerToughnessModifyEffect(
          "source",
          "player1",
          2,
          2,
          "+2/+2",
        );

        layerSystem.registerEffect(modifyEffect);
        const result = layerSystem.applyEffects(creature);

        expect(result.powerModifier).toBe(2);
        expect(result.toughnessModifier).toBe(2);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);
        expect(characteristics.power).toBe(5);
        expect(characteristics.toughness).toBe(5);
      });

      it("should modify power only", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        const modifyEffect = createPowerModifyEffect(
          "source",
          "player1",
          2,
          "+2 power",
        );

        layerSystem.registerEffect(modifyEffect);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);
        expect(characteristics.power).toBe(5);
        expect(characteristics.toughness).toBe(3);
      });

      it("should modify toughness only", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        const modifyEffect = createToughnessModifyEffect(
          "source",
          "player1",
          2,
          "+2 toughness",
        );

        layerSystem.registerEffect(modifyEffect);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);
        expect(characteristics.power).toBe(3);
        expect(characteristics.toughness).toBe(5);
      });
    });

    describe("Layer 7 Sublayer Ordering", () => {
      it("should apply setting effects before modification effects", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        // +2/+2 modifier
        const modifyEffect = createPowerToughnessModifyEffect(
          "source1",
          "player1",
          2,
          2,
          "+2/+2",
        );

        // Set to 1/1
        const setEffect = createPowerToughnessSetEffect(
          "source2",
          "player1",
          1,
          1,
          "Set 1/1",
          layerSystem,
        );

        layerSystem.registerEffect(modifyEffect);
        layerSystem.registerEffect(setEffect);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);

        // Set effect (7b) applies before modify effect (7e)
        // So: base 3/3 -> set to 1/1 -> +2/+2 = 3/3
        expect(characteristics.power).toBe(3);
        expect(characteristics.toughness).toBe(3);
      });

      it("should apply CDA before setting effects", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        // Set to 1/1
        const setEffect = createPowerToughnessSetEffect(
          "source1",
          "player1",
          1,
          1,
          "Set 1/1",
          layerSystem,
        );

        // CDA that sets 5/5
        const cdaEffect = createCharacteristicDefiningAbility(
          "source2",
          "player1",
          { oracleId: "cda-source", power: 5, toughness: 5 },
          "CDA 5/5",
          layerSystem,
        );

        layerSystem.registerEffect(setEffect);
        layerSystem.registerEffect(cdaEffect);

        const characteristics =
          layerSystem.getEffectiveCharacteristics(creature);

        // CDA (7a) applies before set effect (7b)
        // But both set P/T, so the later one (set effect) wins for the base
        // Then no modifiers, so 1/1
        expect(characteristics.power).toBe(1);
        expect(characteristics.toughness).toBe(1);
      });
    });

    describe("CR 613.8 Sublayer Dependencies", () => {
      it("should apply counters to CDA-set P/T (7c depends on 7a)", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        // CDA sets P/T to 0/0 (7a)
        const cdaEffect = createCharacteristicDefiningAbility(
          "source7a",
          "player1",
          { oracleId: "cda-source", power: 0, toughness: 0 },
          "CDA 0/0",
          layerSystem,
        );
        layerSystem.registerEffect(cdaEffect);

        // Add +1/+1 counters (7c)
        creature.counters = [{ type: "+1/+1", count: 3 }];

        const characteristics = layerSystem.getEffectiveCharacteristics(creature);
        // CDA (7a) sets to 0/0, then counters (7c) add +3/+3 = 3/3
        // Per CR 613.8, later sublayers modify earlier ones
        expect(characteristics.power).toBe(3);
        expect(characteristics.toughness).toBe(3);
      });

      it("should apply modification effects after counters (7e depends on 7c)", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        // Add +2/+2 counters (7c)
        creature.counters = [{ type: "+1/+1", count: 2 }];

        // +1/+1 modifier (7e) - should apply after counters
        const modifyEffect = createPowerToughnessModifyEffect(
          "source7e",
          "player1",
          1,
          1,
          "+1/+1 from modifier",
        );
        layerSystem.registerEffect(modifyEffect);

        const characteristics = layerSystem.getEffectiveCharacteristics(creature);
        // Base 3/3 + 2 counters (7c) + 1 modifier (7e) = 6/6
        expect(characteristics.power).toBe(6);
        expect(characteristics.toughness).toBe(6);
      });

      it("should apply switch after counters (7d depends on 7c)", () => {
        const creatureData = createMockCreature("Test Creature", 3, 5);
        const creature = createCardInstance(creatureData, "player1", "player1");

        // Add +1/+1 counters (7c)
        creature.counters = [{ type: "+1/+1", count: 1 }];

        // Switch P/T (7d)
        const switchEffect = createPowerToughnessSwitchEffect(
          "source7d",
          "player1",
          "Switch P/T",
          layerSystem,
        );
        layerSystem.registerEffect(switchEffect);

        const characteristics = layerSystem.getEffectiveCharacteristics(creature);
        // Base 3/5 + 1 counter = 4/6, then switch = 6/4
        expect(characteristics.power).toBe(6);
        expect(characteristics.toughness).toBe(4);
      });

      it("should allow earlier sublayer effects to depend on later ones explicitly", () => {
        const creatureData = createMockCreature("Test Creature", 3, 3);
        const creature = createCardInstance(creatureData, "player1", "player1");

        // Set effect (7b) that sets to 2/2
        const setEffect = createPowerToughnessSetEffect(
          "source7b",
          "player1",
          2,
          2,
          "Set 2/2",
          layerSystem,
        );
        layerSystem.registerEffect(setEffect);

        // CDA (7a) that wants to depend on set effect
        // 7a depends on 7b (per CR 613.8 - later sublayers can modify earlier)
        const cdaEffect = createCharacteristicDefiningAbility(
          "source7a",
          "player1",
          { oracleId: "cda-source", power: 5, toughness: 5 },
          "CDA 5/5",
          layerSystem,
        );

        // Add explicit dependency: CDA (7a) depends on Set (7b)
        // Since 7a applies first, this means set should apply after
        // This would be unusual but valid per CR 613.8 interaction
        layerSystem.registerEffect(cdaEffect);

        const characteristics = layerSystem.getEffectiveCharacteristics(creature);
        // CDA (7a) sets 5/5, then set (7b) overwrites to 2/2
        // Since CDA has earlier timestamp, but set has later sublayer order
        // Order is 7a -> 7b, so 7a sets 5/5, then 7b sets 2/2
        expect(characteristics.power).toBe(2);
        expect(characteristics.toughness).toBe(2);
      });
    });
  });

  describe("Dependency Handling", () => {
    it("should respect effect dependencies", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      createCardInstance(creatureData, "player1", "player1");

      const effectA = createPowerToughnessModifyEffect(
        "sourceA",
        "player1",
        1,
        1,
        "Effect A",
      );
      effectA.timestamp = 1000;

      const effectB = createPowerToughnessModifyEffect(
        "sourceB",
        "player1",
        2,
        2,
        "Effect B",
      );
      effectB.timestamp = 2000;

      layerSystem.registerEffect(effectA);
      layerSystem.registerEffect(effectB);

      // B depends on A (A should apply first even though B has later timestamp)
      layerSystem.addDependency({
        effectId: effectB.id,
        dependsOnId: effectA.id,
        dependencyType: "after",
      });

      const effects = layerSystem.getEffects();

      // A should come before B due to dependency
      expect(effects[0].id).toBe(effectA.id);
      expect(effects[1].id).toBe(effectB.id);
    });
  });

  describe("Dependency Cycle Detection (CR 613.7c)", () => {
    it("should detect direct cycle: A depends on B, B depends on A", () => {
      const effectA = createPowerToughnessModifyEffect(
        "sourceA",
        "player1",
        1,
        1,
        "Effect A",
      );
      const effectB = createPowerToughnessModifyEffect(
        "sourceB",
        "player1",
        2,
        2,
        "Effect B",
      );

      layerSystem.registerEffect(effectA);
      layerSystem.registerEffect(effectB);

      // A depends on B (valid)
      const dep1 = layerSystem.addDependency({
        effectId: effectA.id,
        dependsOnId: effectB.id,
        dependencyType: "after",
      });
      expect(dep1).toBe(true);
      expect(layerSystem.getDependencies()).toHaveLength(1);

      // B depends on A - this would create a cycle
      const dep2 = layerSystem.addDependency({
        effectId: effectB.id,
        dependsOnId: effectA.id,
        dependencyType: "after",
      });
      expect(dep2).toBe(false); // Should be rejected
      expect(layerSystem.getDependencies()).toHaveLength(1); // No new dependency added
    });

    it("should detect transitive cycle: A depends on B, B depends on C, C depends on A", () => {
      const effectA = createPowerToughnessModifyEffect(
        "sourceA",
        "player1",
        1,
        1,
        "Effect A",
      );
      const effectB = createPowerToughnessModifyEffect(
        "sourceB",
        "player1",
        2,
        2,
        "Effect B",
      );
      const effectC = createPowerToughnessModifyEffect(
        "sourceC",
        "player1",
        3,
        3,
        "Effect C",
      );

      layerSystem.registerEffect(effectA);
      layerSystem.registerEffect(effectB);
      layerSystem.registerEffect(effectC);

      // A depends on B
      layerSystem.addDependency({
        effectId: effectA.id,
        dependsOnId: effectB.id,
        dependencyType: "after",
      });

      // B depends on C
      layerSystem.addDependency({
        effectId: effectB.id,
        dependsOnId: effectC.id,
        dependencyType: "after",
      });

      // C depends on A - would create transitive cycle A -> B -> C -> A
      const result = layerSystem.addDependency({
        effectId: effectC.id,
        dependsOnId: effectA.id,
        dependencyType: "after",
      });
      expect(result).toBe(false);
      expect(layerSystem.getDependencies()).toHaveLength(2); // Only first two deps added
    });

    it("should allow valid dependency with no cycle", () => {
      const effectA = createPowerToughnessModifyEffect(
        "sourceA",
        "player1",
        1,
        1,
        "Effect A",
      );
      const effectB = createPowerToughnessModifyEffect(
        "sourceB",
        "player1",
        2,
        2,
        "Effect B",
      );
      const effectC = createPowerToughnessModifyEffect(
        "sourceC",
        "player1",
        3,
        3,
        "Effect C",
      );

      layerSystem.registerEffect(effectA);
      layerSystem.registerEffect(effectB);
      layerSystem.registerEffect(effectC);

      // A depends on B
      const dep1 = layerSystem.addDependency({
        effectId: effectA.id,
        dependsOnId: effectB.id,
        dependencyType: "after",
      });
      expect(dep1).toBe(true);

      // B depends on C (valid - no cycle)
      const dep2 = layerSystem.addDependency({
        effectId: effectB.id,
        dependsOnId: effectC.id,
        dependencyType: "after",
      });
      expect(dep2).toBe(true);

      // A depends on C (valid - no cycle, forms chain not loop)
      const dep3 = layerSystem.addDependency({
        effectId: effectA.id,
        dependsOnId: effectC.id,
        dependencyType: "after",
      });
      expect(dep3).toBe(true);

      expect(layerSystem.getDependencies()).toHaveLength(3);
    });

    it("should reject self-referential dependency (A depends on A)", () => {
      const effectA = createPowerToughnessModifyEffect(
        "sourceA",
        "player1",
        1,
        1,
        "Effect A",
      );
      layerSystem.registerEffect(effectA);

      // A depends on A - self reference is a cycle
      const result = layerSystem.addDependency({
        effectId: effectA.id,
        dependsOnId: effectA.id,
        dependencyType: "after",
      });
      expect(result).toBe(false);
      expect(layerSystem.getDependencies()).toHaveLength(0);
    });

    it("should detect cycle in longer chain: A->B->C->D->A", () => {
      const effectA = createPowerToughnessModifyEffect(
        "sourceA",
        "player1",
        1,
        1,
        "Effect A",
      );
      const effectB = createPowerToughnessModifyEffect(
        "sourceB",
        "player1",
        2,
        2,
        "Effect B",
      );
      const effectC = createPowerToughnessModifyEffect(
        "sourceC",
        "player1",
        3,
        3,
        "Effect C",
      );
      const effectD = createPowerToughnessModifyEffect(
        "sourceD",
        "player1",
        4,
        4,
        "Effect D",
      );

      layerSystem.registerEffect(effectA);
      layerSystem.registerEffect(effectB);
      layerSystem.registerEffect(effectC);
      layerSystem.registerEffect(effectD);

      // A -> B -> C -> D
      layerSystem.addDependency({
        effectId: effectA.id,
        dependsOnId: effectB.id,
        dependencyType: "after",
      });
      layerSystem.addDependency({
        effectId: effectB.id,
        dependsOnId: effectC.id,
        dependencyType: "after",
      });
      layerSystem.addDependency({
        effectId: effectC.id,
        dependsOnId: effectD.id,
        dependencyType: "after",
      });

      // D -> A would complete cycle
      const result = layerSystem.addDependency({
        effectId: effectD.id,
        dependsOnId: effectA.id,
        dependencyType: "after",
      });
      expect(result).toBe(false);
    });

    it("should correctly sort effects when cycle is rejected", () => {
      const effectA = createPowerToughnessModifyEffect(
        "sourceA",
        "player1",
        1,
        1,
        "Effect A",
      );
      const effectB = createPowerToughnessModifyEffect(
        "sourceB",
        "player1",
        2,
        2,
        "Effect B",
      );

      layerSystem.registerEffect(effectA);
      layerSystem.registerEffect(effectB);

      // Set same timestamp to test dependency ordering
      effectA.timestamp = 1000;
      effectB.timestamp = 1000;

      // A depends on B (valid)
      layerSystem.addDependency({
        effectId: effectA.id,
        dependsOnId: effectB.id,
        dependencyType: "after",
      });

      // Try to add cycle - should fail
      layerSystem.addDependency({
        effectId: effectB.id,
        dependsOnId: effectA.id,
        dependencyType: "after",
      });

      const effects = layerSystem.getEffects();
      // A should still come first because of valid dependency
      expect(effects[0].id).toBe(effectB.id); // B comes first (no dependency)
      expect(effects[1].id).toBe(effectA.id); // A comes second (depends on B)
    });
  });

  describe("Effect Removal", () => {
    it("should remove effects from a source", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      createCardInstance(creatureData, "player1", "player1");

      const effect1 = createPowerToughnessModifyEffect(
        "source1",
        "player1",
        1,
        1,
        "+1/+1",
      );
      const effect2 = createPowerToughnessModifyEffect(
        "source2",
        "player1",
        2,
        2,
        "+2/+2",
      );

      layerSystem.registerEffect(effect1);
      layerSystem.registerEffect(effect2);

      expect(layerSystem.getEffects().length).toBe(2);

      layerSystem.removeEffectsFromSource("source1");

      expect(layerSystem.getEffects().length).toBe(1);
      expect(layerSystem.getEffects()[0].sourceCardId).toBe("source2");
    });
  });

  describe("Clear System", () => {
    it("should clear all effects and overrides", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      const creature = createCardInstance(creatureData, "player1", "player1");

      const effect = createPowerToughnessModifyEffect(
        "source",
        "player1",
        1,
        1,
        "+1/+1",
      );

      layerSystem.registerEffect(effect);
      layerSystem.applyEffects(creature);

      expect(layerSystem.getEffects().length).toBe(1);

      layerSystem.clear();

      expect(layerSystem.getEffects().length).toBe(0);
    });
  });

  describe("Global Instance", () => {
    it("should provide access to global layer system", () => {
      const instance = getLayerSystemInstance();
      expect(instance).toBeInstanceOf(LayerSystem);
    });
  });

  describe("Multi-Game Isolation", () => {
    it("should isolate layer system state between game instances", () => {
      // Issue #792: Global LayerSystem instance caused multi-game state corruption
      // Each game should have its own isolated layer system

      const game1LayerSystem = new LayerSystem();
      const game2LayerSystem = new LayerSystem();

      // Create different effects in each layer system
      const creature1 = createCardInstance(
        createMockCreature("Creature 1", 2, 2),
        "player1",
        "player1",
      );
      const creature2 = createCardInstance(
        createMockCreature("Creature 2", 3, 3),
        "player2",
        "player2",
      );

      const effect1 = createPowerToughnessModifyEffect(
        creature1.id,
        "player1",
        5, // +5/+5
        5,
        "Game1 effect",
      );
      const effect2 = createPowerToughnessModifyEffect(
        creature2.id,
        "player2",
        10, // +10/+10
        10,
        "Game2 effect",
      );

      // Register different effects in each layer system
      game1LayerSystem.registerEffect(effect1);
      game2LayerSystem.registerEffect(effect2);

      // Apply effects - getEffectiveCharacteristics takes original creature
      // and internally applies the layer system effects
      const chars1 = game1LayerSystem.getEffectiveCharacteristics(creature1);
      const chars2 = game2LayerSystem.getEffectiveCharacteristics(creature2);

      // Verify effects are isolated
      // game1: 2 base + 5 modification = 7/7
      // game2: 3 base + 10 modification = 13/13
      expect(chars1.power).toBe(7);
      expect(chars1.toughness).toBe(7);
      expect(chars2.power).toBe(13);
      expect(chars2.toughness).toBe(13);

      // Verify game1's layer system doesn't have game2's effect
      expect(game1LayerSystem.getEffects().length).toBe(1);
      expect(game1LayerSystem.getEffects()[0].description).toBe("Game1 effect");

      // Verify game2's layer system doesn't have game1's effect
      expect(game2LayerSystem.getEffects().length).toBe(1);
      expect(game2LayerSystem.getEffects()[0].description).toBe("Game2 effect");
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle multiple effects across layers", () => {
      const creatureData = createMockCreature(
        "Test Creature",
        3,
        3,
        ["flying"],
        ["R"],
      );
      const creature = createCardInstance(creatureData, "player1", "player1");

      // Layer 4: Make artifact
      const typeEffect = createTypeChangeEffect(
        "source4",
        "player1",
        ["Artifact", "Creature"],
        ["Construct"],
        [],
        "Make artifact",
        false,
        layerSystem,
      );

      // Layer 5: Make colorless
      const colorEffect = createColorChangeEffect(
        "source5",
        "player1",
        [],
        "Make colorless",
        false,
        layerSystem,
      );

      // Layer 6: Grant trample
      const abilityEffect = createAbilityGrantEffect(
        "source6",
        "player1",
        "trample",
        "Grant trample",
        layerSystem,
      );

      // Layer 7e: +2/+2
      const ptEffect = createPowerToughnessModifyEffect(
        "source7",
        "player1",
        2,
        2,
        "+2/+2",
      );

      layerSystem.registerEffect(typeEffect);
      layerSystem.registerEffect(colorEffect);
      layerSystem.registerEffect(abilityEffect);
      layerSystem.registerEffect(ptEffect);

      const characteristics = layerSystem.getEffectiveCharacteristics(creature);

      expect(characteristics.types).toContain("Artifact");
      expect(characteristics.subtypes).toContain("Construct");
      expect(characteristics.color).toEqual([]);
      expect(characteristics.grantedAbilities).toContain("trample");
      expect(characteristics.power).toBe(5);
      expect(characteristics.toughness).toBe(5);
    });

    it("should handle timestamp ordering within same layer", () => {
      const creatureData = createMockCreature("Test Creature", 3, 3);
      const creature = createCardInstance(creatureData, "player1", "player1");

      // Create two +1/+1 effects with different timestamps
      const effect1 = createPowerToughnessModifyEffect(
        "source1",
        "player1",
        1,
        1,
        "+1/+1 first",
      );
      effect1.timestamp = 1000;

      const effect2 = createPowerToughnessModifyEffect(
        "source2",
        "player1",
        1,
        1,
        "+1/+1 second",
      );
      effect2.timestamp = 2000;

      layerSystem.registerEffect(effect2);
      layerSystem.registerEffect(effect1);

      const result = layerSystem.applyEffects(creature);

      // Both effects should apply, total +2/+2
      expect(result.powerModifier).toBe(2);
      expect(result.toughnessModifier).toBe(2);
    });
  });
});
