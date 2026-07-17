/**
 * Free-cast Test-Mode API — DEV/TEST ONLY
 *
 * A test-only bridge that lets E2E (Playwright) tests drive the REAL rules
 * engine (`src/lib/game-state`) to set up arbitrary board states and cast
 * spells ignoring mana cost, so Standard mechanics (Cycling, Flashback,
 * Explore, Convoke) can be exercised without the full single-player land-drop
 * setup.
 *
 * # Production safety
 *
 * This module is only *attached* to `window.__TEST__` by
 * `src/app/(app)/game/[id]/page.tsx` inside a block guarded by
 * `process.env.NODE_ENV !== 'production'` (a compile-time constant that
 * Next.js inlines — the whole registration is dead-code-eliminated from
 * production builds) AND a runtime opt-in flag (`?testMode=free-cast` URL
 * param or `planar-nexus:test-mode === 'free-cast'` in localStorage). Both
 * gates must pass. The hook therefore can NEVER activate in a production
 * build, even if an attacker sets the localStorage flag — the code that would
 * read it is not in the bundle.
 *
 * See issue #1431.
 */

import {
  castSpell,
  drawCard as engineDrawCard,
  passPriority,
  checkStateBasedActions,
  parseCycling,
  parseFlashback,
  type GameState,
  type ManaPool,
  type Target,
  type PlayerId,
  type CardInstanceId,
} from "@/lib/game-state";
import {
  cycleCard,
  moveCardToZone,
  tapCardAction,
  untapCardAction,
} from "@/lib/game-state/keyword-actions";

/**
 * The localStorage key that opts a page into free-cast test mode.
 * Mirrors the existing `planar-nexus:onboarded` convention.
 */
export const FREE_CAST_LOCAL_STORAGE_KEY = "planar-nexus:test-mode";

/**
 * The URL query-param value that opts a page into free-cast test mode.
 */
export const FREE_CAST_QUERY_VALUE = "free-cast";

/**
 * Runtime check used by the page to decide whether to attach the hook.
 * MUST be called from inside a `process.env.NODE_ENV !== 'production'`
 * compile-time guard so this code path is unreachable in prod builds.
 */
export function shouldAttachFreeCastHook(): boolean {
  if (typeof window === "undefined") return false;
  const url = new URLSearchParams(window.location.search);
  if (url.get("testMode") === FREE_CAST_QUERY_VALUE) return true;
  try {
    return (
      window.localStorage.getItem(FREE_CAST_LOCAL_STORAGE_KEY) ===
      FREE_CAST_QUERY_VALUE
    );
  } catch {
    return false;
  }
}

/** Serialized result returned by every hook action. */
export interface HookResult {
  success: boolean;
  error?: string;
  /** Human-readable description of what happened (mirrors engine result). */
  description?: string;
  /** Alternative-cost tags the engine stamped on a cast (e.g. ["flashback"]). */
  alternativeCostsUsed?: string[];
}

/** Per-player per-zone card counts, for deterministic assertions. */
export interface ZoneCounts {
  hand: number;
  graveyard: number;
  library: number;
  battlefield: number;
  exile: number;
  stack: number;
}

/** Options for {@link FreeCastTestApi.freeCast}. */
export interface FreeCastOptions {
  /** Override the casting player (defaults to the human player). */
  playerId?: PlayerId;
  /**
   * Cast via an alternative cost. Only "flashback" is wired here — it casts
   * from the graveyard (CR 702.66) using the cost parsed from oracle text.
   */
  alternativeCost?: { type: "flashback" };
  /** Card instance ID to target (for targeted spells). */
  targetCardId?: CardInstanceId;
  /** Player ID to target (for burn spells targeting a player). */
  targetPlayerId?: PlayerId;
}

/** Constructor deps — supplied by the page component. */
export interface FreeCastDeps {
  /** Read the live game state (the page's ref avoids stale closures). */
  getState: () => GameState | null;
  /** Commit a new game state (the page's setState triggers React render). */
  setState: (state: GameState) => void;
}

/**
 * Create the free-cast API object. Every method calls into the real rules
 * engine so the genuine code paths (mana payment, zone moves, cycling draw,
 * flashback cast) are exercised — not stubbed.
 */
export function createFreeCastApi(deps: FreeCastDeps): FreeCastTestApi {
  const { getState, setState } = deps;

  /** Commit a state and run state-based actions (keeps SBA invariants honest). */
  const commit = (next: GameState): GameState => {
    const resolved = checkStateBasedActions(next).state;
    setState(resolved);
    return resolved;
  };

  /** Find the human ("Player") and AI player IDs. */
  const resolvePlayerIds = (
    state: GameState,
  ): { human: PlayerId; ai: PlayerId } => {
    const players = Array.from(state.players.values());
    const human = players.find((p) => !p.name.includes("AI")) ?? players[0];
    const ai =
      players.find((p) => p.name.includes("AI")) ?? players[1] ?? players[0];
    return { human: human.id, ai: ai.id };
  };

  return {
    getZoneCounts(playerId) {
      const state = getState();
      if (!state) throw new Error("Game state not initialized");
      const pid = playerId ?? resolvePlayerIds(state).human;
      const count = (zone: string) =>
        state.zones.get(`${pid}-${zone}`)?.cardIds.length ?? 0;
      return {
        hand: count("hand"),
        graveyard: count("graveyard"),
        library: count("library"),
        battlefield: count("battlefield"),
        exile: count("exile"),
        stack: state.zones.get("stack")?.cardIds.length ?? 0,
      };
    },

    getCardZone(cardId) {
      const state = getState();
      if (!state) return null;
      const card = state.cards.get(cardId);
      if (card?.currentZoneKey) return card.currentZoneKey;
      for (const [key, zone] of state.zones) {
        if (zone.cardIds.includes(cardId)) return key;
      }
      return null;
    },

    findCardId(opts) {
      const state = getState();
      if (!state) return null;
      const pid = opts.playerId ?? resolvePlayerIds(state).human;
      const zonesToSearch: string[] = opts.zone
        ? [opts.zone === "stack" ? "stack" : `${pid}-${opts.zone}`]
        : Array.from(state.zones.keys());
      const needle = opts.name?.toLowerCase();
      for (const zoneKey of zonesToSearch) {
        const zone = state.zones.get(zoneKey);
        if (!zone) continue;
        for (const id of zone.cardIds) {
          const card = state.cards.get(id);
          if (!card) continue;
          if (needle && card.cardData.name.toLowerCase() !== needle) continue;
          return id;
        }
      }
      return null;
    },

    getPlayerIds() {
      const state = getState();
      if (!state) throw new Error("Game state not initialized");
      return resolvePlayerIds(state);
    },

    addMana(playerId, mana) {
      const state = getState();
      if (!state) return false;
      const player = state.players.get(playerId);
      if (!player) return false;
      const pool: ManaPool = { ...player.manaPool };
      for (const key of Object.keys(mana) as (keyof ManaPool)[]) {
        const add = mana[key] ?? 0;
        pool[key] = (pool[key] ?? 0) + add;
      }
      const players = new Map(state.players);
      players.set(playerId, { ...player, manaPool: pool });
      setState({ ...state, players });
      return true;
    },

    patchCardOracle(cardId, oracleText, typeLine) {
      const state = getState();
      if (!state) return false;
      const card = state.cards.get(cardId);
      if (!card) return false;
      const cards = new Map(state.cards);
      cards.set(cardId, {
        ...card,
        cardData: {
          ...card.cardData,
          oracle_text: oracleText,
          ...(typeLine !== undefined ? { type_line: typeLine } : {}),
        },
      });
      setState({ ...state, cards });
      return true;
    },

    moveCard(cardId, zone) {
      const state = getState();
      if (!state)
        return { success: false, error: "Game state not initialized" };
      const result = moveCardToZone(state, cardId, zone);
      if (result.success) commit(result.state);
      return {
        success: result.success,
        error: result.error,
        description: result.description,
      };
    },

    drawCard(playerId) {
      const state = getState();
      if (!state)
        return { success: false, error: "Game state not initialized" };
      const pid = playerId ?? resolvePlayerIds(state).human;
      const next = engineDrawCard(state, pid);
      commit(next);
      return { success: true };
    },

    tapCard(cardId) {
      const state = getState();
      if (!state)
        return { success: false, error: "Game state not initialized" };
      const result = tapCardAction(state, cardId);
      if (result.success) commit(result.state);
      return { success: result.success, error: result.error };
    },

    untapCard(cardId) {
      const state = getState();
      if (!state)
        return { success: false, error: "Game state not initialized" };
      const result = untapCardAction(state, cardId);
      if (result.success) commit(result.state);
      return { success: result.success, error: result.error };
    },

    freeCast(cardId, options = {}) {
      const state = getState();
      if (!state)
        return { success: false, error: "Game state not initialized" };
      const ids = resolvePlayerIds(state);
      const playerId = options.playerId ?? ids.human;
      const card = state.cards.get(cardId);
      if (!card) return { success: false, error: `Card ${cardId} not found` };

      // Give the caster effectively-unlimited mana so the REAL mana-payment
      // path in castSpell runs without being blocked. This is what makes the
      // cast "free" — the validation + spend still executes against a full pool.
      const players = new Map(state.players);
      const caster = players.get(playerId);
      if (!caster) return { success: false, error: "Caster not found" };
      players.set(playerId, {
        ...caster,
        manaPool: {
          colorless: 50,
          white: 50,
          blue: 50,
          black: 50,
          red: 50,
          green: 50,
          generic: 0,
        },
      });
      const working: GameState = { ...state, players };

      const targets: Target[] = [];
      if (options.targetCardId) {
        targets.push({
          type: "card",
          targetId: options.targetCardId,
          isValid: true,
        });
      } else if (options.targetPlayerId) {
        targets.push({
          type: "player",
          targetId: options.targetPlayerId,
          isValid: true,
        });
      }

      const result = castSpell(
        working,
        playerId,
        cardId,
        targets,
        [],
        0,
        false,
        options.alternativeCost,
      );
      if (!result.success) {
        // Roll back the mana grant so the visible pool is unchanged on failure.
        setState(state);
        return { success: false, error: result.error };
      }

      // Two passes of priority resolve a single top-of-stack spell in a
      // 2-player game (opponent passes, caster passes → resolve). Mirrors the
      // existing handleCardClick resolution path.
      let resolved = result.state;
      const opponent = playerId === ids.human ? ids.ai : ids.human;
      if (resolved.stack.length > 0) {
        resolved = passPriority(resolved, opponent);
        resolved = passPriority(resolved, playerId);
      }
      commit(resolved);

      const top = result.state.stack[result.state.stack.length - 1];
      return {
        success: true,
        description: `Free-cast ${card.cardData.name}`,
        alternativeCostsUsed: top?.alternativeCostsUsed,
      };
    },

    cycle(cardId, playerId) {
      const state = getState();
      if (!state)
        return { success: false, error: "Game state not initialized" };
      const ids = resolvePlayerIds(state);
      const pid = playerId ?? ids.human;

      // Grant enough mana to pay any cycling cost parsed from oracle text.
      const players = new Map(state.players);
      const player = players.get(pid);
      if (!player) return { success: false, error: "Player not found" };
      players.set(pid, {
        ...player,
        manaPool: { ...player.manaPool, generic: 50, colorless: 50 },
      });
      const working: GameState = { ...state, players };

      const result = cycleCard(working, pid, cardId);
      if (result.success) {
        commit(result.state);
      } else {
        // Roll back the mana grant on failure.
        setState(state);
      }
      return {
        success: result.success,
        error: result.error,
        description: result.description,
      };
    },

    resolveStack() {
      const state = getState();
      if (!state)
        return { success: false, error: "Game state not initialized" };
      const ids = resolvePlayerIds(state);
      let resolved = state;
      if (resolved.stack.length > 0) {
        resolved = passPriority(resolved, ids.ai);
        resolved = passPriority(resolved, ids.human);
      }
      commit(resolved);
      return { success: true };
    },

    parseCyclingInfo(oracleText) {
      const info = parseCycling(oracleText);
      return {
        hasCycling: info.hasCycling,
        variant: String(info.variant ?? ""),
      };
    },

    parseFlashbackInfo(oracleText) {
      const info = parseFlashback(oracleText);
      return { hasFlashback: info.hasFlashback };
    },
  };
}

/** The full hook surface attached to `window.__TEST__`. */
export interface FreeCastTestApi {
  /** Per-zone card counts for a player (defaults to the human player). */
  getZoneCounts(playerId?: PlayerId): ZoneCounts;
  /** Zone key a card currently lives in (e.g. `player-1-hand`), or null. */
  getCardZone(cardId: CardInstanceId): string | null;
  /** Find the first card instance id matching name and/or zone. */
  findCardId(opts: {
    name?: string;
    zone?: string;
    playerId?: PlayerId;
  }): CardInstanceId | null;
  /** Resolve the human + AI player IDs. */
  getPlayerIds(): { human: PlayerId; ai: PlayerId };
  /** Add mana to a player's pool (real ManaPool mutation). */
  addMana(playerId: PlayerId, mana: Partial<ManaPool>): boolean;
  /** Overwrite a card's oracle_text (and optionally type_line) to add keywords. */
  patchCardOracle(
    cardId: CardInstanceId,
    oracleText: string,
    typeLine?: string,
  ): boolean;
  /** Move a card to a zone via the real `moveCardToZone`. */
  moveCard(
    cardId: CardInstanceId,
    zone: "graveyard" | "exile" | "hand" | "library" | "battlefield",
  ): HookResult;
  /** Draw a card via the real engine `drawCard`. */
  drawCard(playerId?: PlayerId): HookResult;
  /** Tap a permanent via the real `tapCardAction`. */
  tapCard(cardId: CardInstanceId): HookResult;
  /** Untap a permanent via the real `untapCardAction`. */
  untapCard(cardId: CardInstanceId): HookResult;
  /**
   * Cast a spell ignoring its mana cost (the real `castSpell` runs against a
   * full mana pool), then resolve it. Returns the alternative costs the engine
   * stamped on the resulting stack object (e.g. `["flashback"]`).
   */
  freeCast(cardId: CardInstanceId, options?: FreeCastOptions): HookResult;
  /** Activate cycling on a hand card via the real `cycleCard` (CR 702.30). */
  cycle(cardId: CardInstanceId, playerId?: PlayerId): HookResult;
  /** Pass priority twice to resolve the top of the stack. */
  resolveStack(): HookResult;
  /** Expose the real `parseCycling` parser for keyword-wiring assertions. */
  parseCyclingInfo(oracleText: string): {
    hasCycling: boolean;
    variant: string;
  };
  /** Expose the real `parseFlashback` parser for keyword-wiring assertions. */
  parseFlashbackInfo(oracleText: string): { hasFlashback: boolean };
}
