/**
 * Free-cast test-mode helpers for E2E (issue #1431).
 *
 * These wrap the dev-only `window.__TEST__` hook exposed by
 * `src/app/(app)/game/[id]/page.tsx` (gated by NODE_ENV + opt-in flag — see
 * `src/lib/dev/free-cast-test-mode.ts`). They let Playwright tests drive the
 * REAL rules engine to set up arbitrary board states and cast spells ignoring
 * mana cost, so Standard mechanics (Cycling / Flashback / Explore / Convoke)
 * can be exercised without the full land-drop dance.
 *
 * Usage:
 *   await enableFreeCast(page);
 *   const api = freeCastApi(page);
 *   await api.freeCast(cardId);
 */

import type { Page, expect as PWexpect } from "@playwright/test";

/** The localStorage flag the page reads to opt into free-cast mode. */
export const FREE_CAST_FLAG = "planar-nexus:test-mode";

/**
 * Mark the page context so that the NEXT navigation to `/game/...` attaches
 * the free-cast hook. Must run before the game page loads (we register it as
 * an init script so it is set on every new document, including the redirect to
 * the game route).
 */
export async function enableFreeCast(page: Page) {
  await page.addInitScript((flag) => {
    try {
      window.localStorage.setItem(flag, "free-cast");
    } catch {
      /* ignore — some contexts block localStorage */
    }
  }, FREE_CAST_FLAG);
}

/**
 * Wait for the free-cast hook to be attached to the current document.
 * Throws a clear error if the hook is missing (e.g. production build).
 */
export async function waitForFreeCastHook(page: Page, timeout = 10000) {
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __TEST__?: unknown }).__TEST__ ===
      "object",
    { timeout },
  );
}

/** A typed wrapper around the `window.__TEST__` hook. */
export interface FreeCastApi {
  /** Per-zone card counts for a player (defaults to the human player). */
  getZoneCounts(playerId?: string): Promise<{
    hand: number;
    graveyard: number;
    library: number;
    battlefield: number;
    exile: number;
    stack: number;
  }>;
  /** Zone key a card lives in (e.g. `player-1-hand`), or null. */
  getCardZone(cardId: string): Promise<string | null>;
  /** First card instance id matching name and/or zone, or null. */
  findCardId(opts: {
    name?: string;
    zone?: string;
    playerId?: string;
  }): Promise<string | null>;
  /** Resolve the human + AI player IDs. */
  getPlayerIds(): Promise<{ human: string; ai: string }>;
  /** Add mana to a player's pool. */
  addMana(playerId: string, mana: Record<string, number>): Promise<boolean>;
  /** Overwrite a card's oracle_text (and optionally type_line). */
  patchCardOracle(
    cardId: string,
    oracleText: string,
    typeLine?: string,
  ): Promise<boolean>;
  /** Move a card to a zone via the real engine. */
  moveCard(
    cardId: string,
    zone: "graveyard" | "exile" | "hand" | "library" | "battlefield",
  ): Promise<{ success: boolean; error?: string; description?: string }>;
  /** Draw a card via the real engine. */
  drawCard(playerId?: string): Promise<{ success: boolean; error?: string }>;
  /** Tap a permanent via the real engine. */
  tapCard(cardId: string): Promise<{ success: boolean; error?: string }>;
  /** Untap a permanent via the real engine. */
  untapCard(cardId: string): Promise<{ success: boolean; error?: string }>;
  /** Cast a spell ignoring mana cost, then resolve it. */
  freeCast(
    cardId: string,
    options?: {
      playerId?: string;
      alternativeCost?: { type: "flashback" };
      targetCardId?: string;
      targetPlayerId?: string;
    },
  ): Promise<{
    success: boolean;
    error?: string;
    description?: string;
    alternativeCostsUsed?: string[];
  }>;
  /** Activate cycling (CR 702.30) via the real engine. */
  cycle(
    cardId: string,
    playerId?: string,
  ): Promise<{ success: boolean; error?: string; description?: string }>;
  /** Resolve the top of the stack. */
  resolveStack(): Promise<{ success: boolean; error?: string }>;
  /** Real `parseCycling` parser result. */
  parseCyclingInfo(
    oracleText: string,
  ): Promise<{ hasCycling: boolean; variant: string }>;
  /** Real `parseFlashback` parser result. */
  parseFlashbackInfo(oracleText: string): Promise<{ hasFlashback: boolean }>;
}

/**
 * Build a typed wrapper around the page-side hook. Each method round-trips
 * through `page.evaluate` so the real engine code runs in the browser.
 */
export function freeCastApi(page: Page): FreeCastApi {
  const call =
    <A extends unknown[], R>(method: string) =>
    async (...args: A): Promise<R> => {
      return page.evaluate(
        ({ method, args }) => {
          const api = (
            window as unknown as {
              __TEST__?: Record<string, (...a: unknown[]) => unknown>;
            }
          ).__TEST__;
          if (!api || typeof api[method] !== "function") {
            throw new Error(
              `window.__TEST__.${method} is not available — ensure free-cast test mode is enabled (NEXT_PUBLIC/NODE_ENV dev + ${FREE_CAST_FLAG} localStorage flag) and the game page has mounted.`,
            );
          }
          return api[method](...args) as R;
        },
        { method, args },
      );
    };
  return {
    getZoneCounts: call("getZoneCounts"),
    getCardZone: call("getCardZone"),
    findCardId: call("findCardId"),
    getPlayerIds: call("getPlayerIds"),
    addMana: call("addMana"),
    patchCardOracle: call("patchCardOracle"),
    moveCard: call("moveCard"),
    drawCard: call("drawCard"),
    tapCard: call("tapCard"),
    untapCard: call("untapCard"),
    freeCast: call("freeCast"),
    cycle: call("cycle"),
    resolveStack: call("resolveStack"),
    parseCyclingInfo: call("parseCyclingInfo"),
    parseFlashbackInfo: call("parseFlashbackInfo"),
  };
}

/**
 * Convenience: assert the free-cast hook attached after navigating to the
 * game page. Useful at the top of a test right after the game starts.
 */
export async function assertFreeCastReady(page: Page, expect: typeof PWexpect) {
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () =>
            typeof (window as unknown as { __TEST__?: unknown }).__TEST__ ===
            "object",
        ),
      { timeout: 10000 },
    )
    .toBe(true);
}
