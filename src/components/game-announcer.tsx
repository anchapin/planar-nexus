"use client";

/**
 * Game-state announcer (#1267).
 *
 * Mounts a visually-hidden polite live region next to the game board and
 * publishes a sequence of spoken messages whenever the engine game state
 * transitions:
 *
 *   - turn swap (active player changes)
 *   - phase change (Untap → Upkeep → Draw → Main 1 → Combat → Main 2 → End)
 *   - priority change (which player currently has priority)
 *   - life-total change (each player's life)
 *
 * The component is the screen-reader counterpart to the existing visual
 * signals on the board. It satisfies WCAG 2.1 SC 4.1.3 (Status Messages):
 * dynamic changes must be programmatically determinable without focus.
 *
 * Design notes:
 *   - Uses `aria-live="polite"` so announcements do not interrupt whatever the
 *     screen-reader is currently reading. Critical state (player lost, game
 *     ended) is intentionally not handled here — it lives on a separate
 *     `role="alert"` region elsewhere in the app, which IS allowed to barge
 *     in (per WAI-ARIA 1.2 §5.3).
 *   - Throttled to one announcement per `THROTTLE_MS` ms to avoid spam during
 *     batched state mutations (e.g. combat damage + life loss + state-based
 *     actions in the same tick). The first announcement of a burst publishes
 *     immediately; the next is queued and flushed after the throttle window.
 *   - Identical successive announcements are dropped so screen-readers do not
 *     repeat themselves.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Phase } from "@/lib/game-state/types";
import type { GameState, Player, PlayerId, Turn } from "@/lib/game-state/types";
import { getPhaseName } from "@/lib/game-state/turn-phases";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Upper bound on announcements per real-time window. Tuned per the issue
 * acceptance criteria. The value was chosen so that combat damage + cleanup
 * (which often fires two-or-three state mutations in the same tick) deliver
 * the most important signal first and queue anything secondary, rather than
 * flooding the user with overlapping messages.
 */
export const THROTTLE_MS = 750;

/**
 * Minimum life-total delta worth announcing. Smaller fluctuations (e.g.
 * from replacement effects that bounce by 0) are intentionally skipped so
 * the live region is not spammed when the engine churns.
 */
export const LIFE_DELTA_THRESHOLD = 1;

// ---------------------------------------------------------------------------
// Pure helpers — exposed for unit testing and reuse.
// ---------------------------------------------------------------------------

/**
 * Get the display name of a player, falling back to "the opponent" if the
 * engine state does not yet know the player's name. Keeps announcements
 * grammatically correct when the local view of the game has not finished
 * loading metadata.
 */
function playerDisplayName(player: Player | undefined): string {
  if (!player) return "the opponent";
  const trimmed = player.name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "the opponent";
}

/**
 * Returns "you" / "your" etc. when the player is the local player, otherwise
 * the player's display name. The fallback to "Opponent" mirrors the
 * surface-area guarantees of use-game-engine (playerNames = ["Opponent",
 * "You"]) — names of "You" almost always indicate the local viewpoint, so
 * we honor them even if `localPlayerId` is not provided. Mirrors the existing
 * game-board.tsx behavior where `currentPlayer.name` is spoken as-is.
 */
function possessiveLabel(
  player: Player | undefined,
  localPlayerId: PlayerId | null,
): string {
  if (!player) return "Opponent";
  if (localPlayerId && player.id === localPlayerId) {
    return "your";
  }
  const name = playerDisplayName(player);
  if (localPlayerId === null && name.toLowerCase() === "you") {
    return "your";
  }
  return `${name}'s`;
}

/**
 * Map an engine phase to a human-readable announcement chunk. The strings
 * here are what blind users will hear; spell out the MTG terms ("first
 * strike combat damage") without abbreviations and avoid symbols a screen
 * reader would pronounce ("/"  → "slash").
 */
function describePhase(phase: Phase): string {
  switch (phase) {
    case Phase.UNTAP:
      return "Untap step";
    case Phase.UPKEEP:
      return "Upkeep step";
    case Phase.DRAW:
      return "Draw step";
    case Phase.PRECOMBAT_MAIN:
      return "Main phase 1";
    case Phase.BEGIN_COMBAT:
      return "Beginning of combat";
    case Phase.DECLARE_ATTACKERS:
      return "Declare attackers";
    case Phase.DECLARE_BLOCKERS:
      return "Declare blockers";
    case Phase.COMBAT_DAMAGE_FIRST_STRIKE:
      return "First strike combat damage";
    case Phase.COMBAT_DAMAGE:
      return "Combat damage";
    case Phase.END_COMBAT:
      return "End of combat";
    case Phase.POSTCOMBAT_MAIN:
      return "Main phase 2";
    case Phase.END:
      return "Ending phase";
    case Phase.CLEANUP:
      return "Cleanup step";
    default:
      // Defensive fallback — engine may add a new phase before this code
      // knows about it. We surface the engine's canonical name.
      return getPhaseName(phase);
  }
}

/**
 * Walk two turns and describe what changed between them. The set of
 * transitions we surface is intentionally narrow — turn swap and phase —
 * because they are the only engine-level turn mutations a screen-reader
 * user truly needs to know about.
 */
function diffTurns(
  prev: Turn,
  next: Turn,
  nextState: GameState,
  localPlayerId: PlayerId | null,
): string[] {
  const out: string[] = [];
  const active = nextState.players.get(next.activePlayerId);

  if (prev.activePlayerId !== next.activePlayerId) {
    // "your" / "Opponent's" / "Alex's" — possessiveLabel produces both
    // forms already; we just capitalize the first letter for the local
    // player to read naturally as the start of a sentence.
    const label = possessiveLabel(active, localPlayerId);
    out.push(`${capitalize(label)} turn — ${describePhase(next.currentPhase)}`);
  } else if (prev.currentPhase !== next.currentPhase) {
    out.push(`Now in ${describePhase(next.currentPhase)}`);
  } else if (prev.turnNumber !== next.turnNumber) {
    // Should not be reachable (active player change also bumps turn), but we
    // keep it for robustness against future engine refactors.
    out.push(`Turn ${next.turnNumber} begins`);
  }
  return out;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Diff the priority player between two engine states.
 * Returns a list with at most one announcement describing who now has priority.
 */
function diffPriority(
  prev: GameState,
  next: GameState,
  localPlayerId: PlayerId | null,
): string[] {
  if (prev.priorityPlayerId === next.priorityPlayerId) return [];
  const nextPlayer = next.players.get(next.priorityPlayerId ?? "");
  if (!next.priorityPlayerId || !nextPlayer) return [];

  if (localPlayerId && next.priorityPlayerId === localPlayerId) {
    return ["You have priority"];
  }
  if (!localPlayerId && playerDisplayName(nextPlayer).toLowerCase() === "you") {
    return ["You have priority"];
  }
  return [`${playerDisplayName(nextPlayer)} has priority`];
}

/**
 * Diff life totals between two engine states. Returns one announcement per
 * player whose net delta exceeds `LIFE_DELTA_THRESHOLD`. Players who joined or
 * left are skipped — life changes are local to known players.
 */
function diffLifeTotals(prev: GameState, next: GameState): string[] {
  const out: string[] = [];
  for (const [id, nextPlayer] of next.players) {
    const prevPlayer = prev.players.get(id);
    if (!prevPlayer) continue;
    const delta = nextPlayer.life - prevPlayer.life;
    if (Math.abs(delta) < LIFE_DELTA_THRESHOLD) continue;

    const signWord = delta > 0 ? "gains" : "loses";
    const amount = Math.abs(delta);
    out.push(
      `${playerDisplayName(nextPlayer)} ${signWord} ${amount} life (now ${nextPlayer.life})`,
    );
  }
  return out;
}

/**
 * Compute the ordered list of announcements that should be spoken given a
 * transition from `prev` to `next`. Pure — does not touch React state, DOM,
 * timers, or any global. Exported for direct unit testing.
 *
 * The function deliberately returns multiple strings so callers (the
 * `<GameAnnouncer>` component, or test fixtures) can throttle and speak them
 * one at a time.
 */
export function deriveGameStateAnnouncements(
  prev: GameState | null,
  next: GameState,
  localPlayerId: PlayerId | null = null,
): string[] {
  if (!prev) return [];

  const announcements: string[] = [];
  announcements.push(...diffTurns(prev.turn, next.turn, next, localPlayerId));
  announcements.push(...diffPriority(prev, next, localPlayerId));
  announcements.push(...diffLifeTotals(prev, next));
  return announcements;
}

// ---------------------------------------------------------------------------
// Hook — `useGameAnnouncer()`
//
// Provides imperative `announce(message)` to any descendant so non-state-driven
// events (e.g. "Pack opened", "Draft complete", "Pick 3 of 14") can reuse the
// same polite live region instead of mounting a parallel one.
// ---------------------------------------------------------------------------

interface GameAnnouncerContextValue {
  announce: (message: string) => void;
}

const GameAnnouncerContext = createContext<GameAnnouncerContextValue | null>(
  null,
);

/**
 * Hook returning `{ announce }`. Throws when called outside a
 * `<GameAnnouncer>` subtree so callers find wiring mistakes during
 * development instead of silently dropping accessibility-critical updates.
 */
export function useGameAnnouncer(): GameAnnouncerContextValue {
  const ctx = useContext(GameAnnouncerContext);
  if (!ctx) {
    throw new Error(
      "useGameAnnouncer must be used inside <GameAnnouncer>. Mount a " +
        "<GameAnnouncer engineState={...} /> near the game board.",
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Component — `<GameAnnouncer>`
//
// Owns the polite live region and the throttle queue. Reactively translates
// engine state transitions into spoken text and feeds it through the throttle
// so screen-readers receive a coherent stream of updates.
// ---------------------------------------------------------------------------

export interface GameAnnouncerProps {
  /** Current game state. When `null`, the announcer clears and waits. */
  engineState: GameState | null;
  /** Optional id of the local player so messages can use "You" / "Your". */
  localPlayerId?: PlayerId | null;
  /** Override the throttling window. Useful for tests; production callers
   * should leave this alone. */
  throttleMs?: number;
  /** Optional descendants. The component owns a context that
   * `useGameAnnouncer()` reads from — children rendered here can call the
   * imperative `announce()` against the same polite live region. */
  children?: React.ReactNode;
}

/**
 * Live region that announces game-state transitions (#1267).
 *
 * Mount next to `<GameBoard>`. The component is intentionally inert on the
 * server (it renders nothing, then hydrates with an empty region) so it does
 * not block first paint.
 */
export function GameAnnouncer({
  engineState,
  localPlayerId = null,
  throttleMs = THROTTLE_MS,
  children,
}: GameAnnouncerProps) {
  const [message, setMessage] = useState<string>("");
  const prevStateRef = useRef<GameState | null>(null);
  const queueRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpokenRef = useRef<string>("");

  // Imperative announce — lets deep children reuse this region for non-engine
  // events. Also implements the throttle / dedup, so manual calls and
  // transition-driven calls share the same output buffer.
  const enqueue = useCallback((text: string) => {
    if (!text) return;
    // Drop noise — don't repeat the exact same announcement back-to-back.
    if (text === lastSpokenRef.current) return;
    queueRef.current.push(text);
  }, []);

  const flush = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      timerRef.current = null;
      return;
    }
    lastSpokenRef.current = next;
    setMessage(next);
    timerRef.current = setTimeout(flush, throttleMs);
  }, [throttleMs]);

  const announce = useCallback(
    (text: string) => {
      enqueue(text);
      if (timerRef.current === null) {
        flush();
      }
    },
    [enqueue, flush],
  );

  // Cancel any pending timer on unmount so we don't call setState on an
  // unmounted component.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      queueRef.current = [];
    };
  }, []);

  // Track engine-state transitions.
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = engineState;

    if (!engineState) {
      // Game reset: clear the queue + the spoken text so the next game
      // announces its first transition cleanly.
      queueRef.current = [];
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      lastSpokenRef.current = "";
      setMessage("");
      return;
    }

    const announcements = deriveGameStateAnnouncements(
      prev,
      engineState,
      localPlayerId,
    );
    for (const text of announcements) {
      enqueue(text);
    }
    if (announcements.length > 0 && timerRef.current === null) {
      flush();
    }
  }, [engineState, localPlayerId, enqueue, flush]);

  const ctxValue = useMemo<GameAnnouncerContextValue>(
    () => ({ announce }),
    [announce],
  );

  return (
    <GameAnnouncerContext.Provider value={ctxValue}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="game-announcer"
      >
        {message}
      </div>
    </GameAnnouncerContext.Provider>
  );
}

/** @internal — exposed for unit tests only. */
export const __testing = {
  describePhase,
  diffTurns,
  diffPriority,
  diffLifeTotals,
  deriveGameStateAnnouncements,
  playerDisplayName,
  possessiveLabel,
  THROTTLE_MS,
  LIFE_DELTA_THRESHOLD,
};
