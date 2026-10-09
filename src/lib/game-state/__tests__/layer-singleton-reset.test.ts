/**
 * #2620: the module-level layer system (read by combat for power and
 * toughness) must start each game empty, so overrides and cached
 * characteristics from an earlier game neither leak into the next one nor
 * pile up across a long session.
 */
import { describe, it, expect } from "@jest/globals";
import { createInitialGameState } from "../game-state";
import { layerSystem } from "../layer-system";

describe("shared layer system reset on new game (#2620)", () => {
  it("leaves no overrides or cache entries behind when a new game starts", () => {
    createInitialGameState(["p1", "p2"], 20, false);
    for (let i = 0; i < 25; i++) {
      layerSystem.getOverrides(`old-game-card-${i}`).power = i;
    }
    expect(layerSystem.getOverrideCount()).toBe(25);

    createInitialGameState(["p1", "p2"], 20, false);

    expect(layerSystem.getOverrideCount()).toBe(0);
    expect(layerSystem.getCacheSize()).toBe(0);
    expect(layerSystem.getOverrides("old-game-card-3").power).toBeUndefined();
  });

  it("keeps the shared layer system bounded across many games", () => {
    for (let game = 0; game < 50; game++) {
      createInitialGameState(["p1", "p2"], 20, false);
      for (let i = 0; i < 40; i++) {
        layerSystem.getOverrides(`g${game}-card-${i}`);
      }
    }
    expect(layerSystem.getOverrideCount()).toBe(40);
  });
});
