/**
 * Targeted mutation suite for `src/lib/game-state/keyword-actions/*` (#2186).
 *
 * Stryker mutates code under keyword-actions/ and these tests exist so each
 * mutant can be killed (or intentionally survived). Keep these focused on the
 * per-family behaviors — comprehensive behavior coverage lives in the regular
 * `__tests__/` suites.
 */
import {
  ventureIntoDungeon,
  type KeywordActionResult,
} from "@/lib/game-state/keyword-actions";
import type { GameState, PlayerId } from "@/lib/game-state/types";

const PLAYER: PlayerId = "p1" as PlayerId;

function emptyState(): GameState {
  return {
    players: new Map([
      [
        PLAYER,
        {
          id: PLAYER,
          life: 20,
          manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
          library: [],
          hand: [],
          graveyard: [],
          battlefield: [],
          exile: [],
          dungeonId: null,
          dungeonProgress: null,
        },
      ],
    ]),
  } as unknown as GameState;
}

describe("keyword-actions — ventureIntoDungeon", () => {
  it("returns a failure result when the player is missing", () => {
    const state = emptyState();
    const result = ventureIntoDungeon(state, "missing" as PlayerId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it("starts the Undercity dungeon from room 0 for the default dungeon id", () => {
    const state = emptyState();
    const result: KeywordActionResult = ventureIntoDungeon(state, PLAYER);
    expect(result.success).toBe(true);
    expect(result.description).toBeTruthy();
  });
});
