/**
 * @fileoverview Wire-protocol types for the AI-opponent Web Worker
 * (planar-nexus issue #2417, slice 2).
 *
 * The AI worker is the sibling of the rules-engine worker
 * (`src/lib/game-state/engine-worker*`, slice 1): it owns one AI turn and
 * runs it off the main thread. The protocol mirrors slice 1's shape so the
 * two transports can be reasoned about the same way:
 *
 *   request   `{ id, type: "ai_turn", state, aiPlayerId, config }`
 *   response  `{ id, ok: true, state, result }` | `{ id, ok: false, error }`
 *
 * plus one extra message kind that slice 1 does not need:
 *
 *   event     `{ id, type: "commentary", text }`
 *
 * The commentary event exists because the AI turn emits commentary through
 * `AITurnConfig.onCommentary` while it runs. A worker cannot call a
 * function on the main thread, so the worker *emits* the text as an event
 * and the client re-dispatches it to the caller's callback — the UI keeps
 * seeing the same commentary lines in the same order.
 *
 * Why the AI worker lives under `src/ai/` and not next to the engine:
 * the rules engine is self-contained (issue #1724 / ESLint
 * `engineOutboundBoundaryBlock`), so `src/lib/game-state/**` may not import
 * application code — the AI turn loop could never be imported by the
 * engine worker. The AI worker therefore imports the AI turn loop *and*
 * reaches the rules engine through the engine's public barrel
 * (`@/lib/game-state`, issue #1710), which keeps both boundaries intact.
 *
 * State transfer: the engine's `GameState` carries two class instances
 * (`replacementEffectManager`, `layerSystem`) and an optional RNG *function*
 * (`random`), none of which survive a structured clone. They are stripped
 * from the wire format and re-created on the receiving side, exactly like
 * slice 1's `EngineStateSnapshot` (see `ai-turn-worker-state.ts`).
 */

import type { GameState, Phase, PlayerId } from "@/lib/game-state";

import type { AIAction } from "../ai-action-executor";
import type { DifficultyFormat, DifficultyLevel } from "../ai-difficulty";
import type { DeckArchetype } from "../game-state-evaluator";
import type { OpponentBluffHistory, OpponentBluffSignals } from "../opponent-bluff-history";

/**
 * The transferable projection of a `GameState`.
 *
 * Identical in shape to slice 1's `EngineStateSnapshot`: the two engine
 * manager instances and the optional `random` function are stripped, the
 * rest (including the `players` / `cards` / `zones` Maps) is cloned
 * verbatim.
 */
export type AITurnStateSnapshot = Omit<
  GameState,
  "replacementEffectManager" | "layerSystem" | "random"
>;

/**
 * The transferable subset of {@link AITurnConfig}.
 *
 * Only plain data crosses the worker boundary. Two config fields are
 * deliberately absent:
 *
 *   - `onCommentary` — a function; it is replaced by the commentary event
 *     stream (the worker emits the text, the client calls the callback).
 *   - `swingTracker` — a class instance (`BoardSwingTracker`); a structured
 *     clone would drop its prototype. A config carrying a swing tracker is
 *     not transferable and falls back to the synchronous path.
 */
export interface AITurnWorkerConfig {
  difficulty: DifficultyLevel;
  delayMs: number;
  skipPhases?: Phase[];
  format?: DifficultyFormat;
  archetype?: DeckArchetype;
  opponentBluffHistory?: OpponentBluffHistory;
}

/**
 * The turn result without the final state.
 *
 * The state travels in its own field of the response envelope (as the
 * transferable snapshot); everything else the turn loop produced is plain
 * data and rides along here.
 */
export interface AITurnWorkerResult {
  success: boolean;
  actionsTaken: AIAction[];
  error?: string;
  phase?: string;
  nextOpponentBluffHistory?: OpponentBluffHistory;
  opponentBluffSignals?: readonly OpponentBluffSignals[];
}

/** Request discriminator values. */
export type AITurnWorkerRequestType = "ai_turn";

/** Ask the worker to play one AI turn. */
export interface AITurnWorkerRequest {
  /** Client-generated id; echoed back on the response. */
  id: number;
  type: "ai_turn";
  /** The state the turn starts from (transferable projection). */
  state: AITurnStateSnapshot;
  /** The player the AI controls. */
  aiPlayerId: PlayerId;
  /** The transferable turn configuration. */
  config: AITurnWorkerConfig;
}

/** A commentary line emitted while the turn runs. */
export interface AITurnWorkerCommentaryEvent {
  /** Id of the turn request the line belongs to. */
  id: number;
  type: "commentary";
  text: string;
}

/** Every message the main thread sends to the AI worker. */
export type AITurnWorkerRequestMessage = AITurnWorkerRequest;

/** Every message the AI worker sends back. */
export type AITurnWorkerResponseMessage =
  | AITurnWorkerCommentaryEvent
  | AITurnWorkerSuccessResponse
  | AITurnWorkerErrorResponse;

/** Successful response: the id of the request plus the resulting state. */
export interface AITurnWorkerSuccessResponse {
  id: number;
  ok: true;
  /** The state after the AI turn (transferable projection). */
  state: AITurnStateSnapshot;
  /** Everything else the turn produced. */
  result: AITurnWorkerResult;
}

/** Failed response: the id of the request plus the error. */
export interface AITurnWorkerErrorResponse {
  id: number;
  ok: false;
  error: {
    name: string;
    message: string;
  };
}

/** Every response envelope the worker sends. */
export type AITurnWorkerResponse =
  | AITurnWorkerSuccessResponse
  | AITurnWorkerErrorResponse;
