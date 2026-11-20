/**
 * @fileoverview Wire-protocol types for the rules-engine Web Worker
 * (issue #2417, slice 1).
 *
 * The engine worker owns an authoritative `GameState` and exposes an action
 * API to the main thread. The transport is a plain request/response
 * envelope protocol (ids, one response per request) rather than a Comlink
 * proxy, because the engine has to stay self-contained (#1724) and because
 * the protocol needs to be inspectable in tests: response-id matching,
 * unknown-id handling and the error envelope are all part of the contract.
 *
 * Three pieces make up the protocol:
 *
 *   request   `{ id, type: "init" | "dispatch", ... }`
 *   response  `{ id, ok: true, state }` | `{ id, ok: false, error }`
 *   action    the engine mutation the worker applies to its held state
 *
 * The `id` is a monotonically increasing number chosen by the client. Every
 * response carries back the id of the request it answers, so the client can
 * match responses to pending promises even when they arrive out of order.
 *
 * Error contract: an action that the engine rejects (or that throws inside
 * the engine) is reported as an error envelope — never as a silent success
 * and never as a dead worker. The client turns the envelope back into a
 * rejected promise carrying the engine error, so callers can distinguish
 * "the rules said no" from "the transport broke".
 */

import type { CardInstanceId, GameState, PlayerId } from "@/lib/game-state";

/**
 * The transferable projection of a `GameState`.
 *
 * `GameState` carries three values that cannot cross a structured-clone
 * boundary:
 *
 *   - `replacementEffectManager` — a class instance (`ReplacementEffectManager`)
 *   - `layerSystem` — a class instance (`LayerSystem`)
 *   - `random` — an optional RNG *function*
 *
 * Structured clone drops class prototypes (the engine would call methods
 * that no longer exist) and throws `DataCloneError` on functions, so those
 * three fields are stripped from the wire format and re-created on the
 * receiving side by {@link fromEngineStateSnapshot}. Everything else —
 * including the `players` / `cards` / `zones` Maps and the nested
 * `commanderDamage` / `blockers` Maps — is structured-clone safe and is
 * transferred verbatim.
 */
export type EngineStateSnapshot = Omit<
  GameState,
  "replacementEffectManager" | "layerSystem" | "random"
>;

/**
 * The action API exposed by the engine worker.
 *
 * Every variant maps 1:1 onto a public engine entry point (the
 * `@/lib/game-state` barrel). The worker never reaches into engine
 * internals — it calls the same functions the main thread calls today, so
 * moving the loop into the worker cannot change the rules outcome.
 */
export type EngineWorkerAction =
  /** Play a land from hand (`playLand`). */
  | { type: "play_land"; playerId: PlayerId; cardId: CardInstanceId }
  /** Tap a permanent (`tapCardAction`). */
  | { type: "tap_card"; cardId: CardInstanceId }
  /** Untap a permanent (`untapCardAction`). */
  | { type: "untap_card"; cardId: CardInstanceId }
  /** Draw a card (`drawCard`). */
  | { type: "draw_card"; playerId: PlayerId }
  /** Pass priority (`passPriority`). */
  | { type: "pass_priority"; playerId: PlayerId }
  /** Deal damage to a player (`dealDamageToPlayer`). */
  | { type: "deal_damage"; playerId: PlayerId; amount: number }
  /** Gain life (`gainLife`). */
  | { type: "gain_life"; playerId: PlayerId; amount: number }
  /** Concede the game (`concede`). */
  | { type: "concede"; playerId: PlayerId }
  /** Declare attackers (`declareAttackers`). */
  | {
      type: "declare_attackers";
      attackers: Array<{
        cardId: CardInstanceId;
        defenderId: PlayerId | CardInstanceId;
      }>;
    }
  /** Declare blockers (`declareBlockers`). */
  | {
      type: "declare_blockers";
      blockers: Array<{
        cardId: CardInstanceId;
        attackerId: CardInstanceId;
      }>;
    }
  /** Run the state-based-action check (`checkStateBasedActionsFromGameState`). */
  | { type: "check_state_based_actions" };

/** Request discriminator values. */
export type EngineWorkerRequestType = "init" | "dispatch";

/** Hand the worker the initial authoritative state. */
export interface EngineWorkerInitRequest {
  /** Client-generated id; echoed back on the response. */
  id: number;
  type: "init";
  /** Initial state, already reduced to its transferable projection. */
  state: EngineStateSnapshot;
}

/** Apply one action to the worker's held state. */
export interface EngineWorkerDispatchRequest {
  /** Client-generated id; echoed back on the response. */
  id: number;
  type: "dispatch";
  /** The action to apply through the public engine API. */
  action: EngineWorkerAction;
}

/** Every request the worker understands. */
export type EngineWorkerRequest =
  EngineWorkerInitRequest | EngineWorkerDispatchRequest;

/**
 * The error payload of an error envelope.
 *
 * `name` carries the engine error class (e.g. `Error` for a thrown engine
 * error, `EngineActionError` for an action the rules rejected) and
 * `message` carries the engine's own message — the client re-throws both so
 * the caller sees the same error it would have seen on the main thread.
 */
export interface EngineWorkerErrorPayload {
  name: string;
  message: string;
}

/** Successful response: the id of the request plus the resulting state. */
export interface EngineWorkerSuccessResponse {
  id: number;
  ok: true;
  /**
   * The full resulting state.
   *
   * Slice 1 ships the **whole** state per action — there is no patch/diff
   * helper for `GameState` in the repo yet (the JSON serializer in
   * `state-serialization.ts` and the gzip envelopes in
   * `game-state-compression.ts` are whole-state formats, not deltas), so a
   * diff/patch transport is a later optimisation, not a slice-1 concern.
   */
  state: EngineStateSnapshot;
}

/** Failed response: the id of the request plus the engine error. */
export interface EngineWorkerErrorResponse {
  id: number;
  ok: false;
  error: EngineWorkerErrorPayload;
}

/** Every response the worker sends. */
export type EngineWorkerResponse =
  EngineWorkerSuccessResponse | EngineWorkerErrorResponse;
