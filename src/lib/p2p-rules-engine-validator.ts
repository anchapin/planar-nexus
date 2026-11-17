/**
 * @fileoverview Rules-engine validator factory for the P2P transport
 * (issue #1089), split out of `p2p-game-connection.ts` (issue #2472).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `createRulesEngineValidator` builds a {@link PeerActionValidator} that
 * delegates to the engine's `ValidationService.validateAction`. That service
 * reaches the whole rules engine (card scripts, spell casting, keyword
 * actions, mana rules) — roughly 1.8 MB of engine source.
 *
 * `p2p-game-connection.ts` is imported by the multiplayer LOBBY route
 * (`/multiplayer` -> `p2p-connection-indicator-section` -> `use-p2p-connection`
 * -> `p2p-game-connection`), because the lobby renders the live P2P status
 * chip. Keeping the engine behind a static VALUE import in that module
 * dragged the engine into the lobby route's module graph, and the on-demand
 * `next dev` compile of `/multiplayer` then blew past Playwright's 30 s
 * navigation timeout (issue #2472, CI job E2E).
 *
 * The validator is only ever built by the HOST game route (the caller hands
 * in the authoritative state), never by the lobby. Keeping it in its own
 * module means the lobby's graph simply never reaches the engine: the
 * transport module stays free of engine imports.
 *
 * The module keeps the sanctioned leaf entry point
 * (`@/lib/game-state/lite-validation`) so the #1710 barrel-only rule stays
 * satisfied — no deep engine sub-path is imported from here.
 */

import { ValidationService } from "@/lib/game-state/lite-validation";
import type {
  GameState,
  GameAction,
  PlayerId,
} from "@/lib/game-state/lite";
import type { PeerActionValidator } from "./p2p-game-connection";

/**
 * Build a {@link PeerActionValidator} that delegates to the rules engine
 * (`ValidationService.validateAction`) against the host's authoritative state.
 *
 * The host supplies `getState`, which must return its OWN authoritative
 * {@link GameState} at call time — never a state claimed by the peer. The wire
 * payload (`{ action, data }`) plus the originating `senderId` are mapped to
 * the engine's {@link GameAction} and validated in place; the action is NOT
 * applied (this only decides legality). Issue #1089.
 *
 * Example (authoritative host):
 * ```ts
 * createP2PGameConnection({
 *   // ...
 *   validatePeerActions: true,
 *   validatePeerAction: createRulesEngineValidator(
 *     () => authoritativeGameStateRef.current,
 *   ),
 * });
 * ```
 *
 * This wrapper only delegates — it does not reimplement rules. Unknown action
 * types therefore fall through to `ValidationService.validateAction`'s default
 * handling.
 */
export function createRulesEngineValidator(
  getState: () => GameState,
  modeId?: string,
): PeerActionValidator {
  return (peerAction, senderId) => {
    const state = getState();
    const gameAction = {
      type: peerAction.action,
      playerId: senderId as PlayerId,
      timestamp: Date.now(),
      data: peerAction.data,
    } as unknown as GameAction;
    const result = ValidationService.validateAction(state, gameAction, modeId);
    return { isValid: result.isValid, reason: result.reason };
  };
}
