/**
 * Issue #1391 — rotate the per-session HMAC key on the active connection
 * after the local peer is promoted to host. Generates a fresh 32-byte
 * secret and pushes it onto the transport via `setSessionKey`, so every
 * subsequent outbound envelope is signed under the new key and every
 * inbound envelope must verify against it.
 *
 * The previous host's key is invalidated: a follower that still holds the
 * pre-migration key rejects any post-migration envelope signed under it
 * (issue #1252 acceptance criterion #2). The transport preserves
 * sequence-number continuity across the rotation via `adoptOutgoingSeq`
 * (#1091), so anti-replay high-water marks are not reset.
 *
 * Extracted from `src/hooks/use-p2p-connection.ts` (issue #1927) and
 * re-exported from the hook module so existing imports keep working.
 * Exported (and unit-tested directly) so the security-critical wiring is
 * verifiable without mounting the full React hook. A `null` connection
 * (promotion before the transport is established) is a safe no-op.
 *
 * @returns the new key hex, or `null` when there is no active connection.
 */

import { generateSessionKey } from "@/lib/p2p-handshake";
import type { P2PGameConnection } from "@/lib/p2p-game-connection";
import { logger } from "@/lib/logger";

const p2pLogger = logger.child("P2PConnection");

export function rotateSessionKeyOnPromotion(
  connection: P2PGameConnection | null,
  log = p2pLogger,
): string | null {
  if (!connection) {
    log.debug(
      "Skipping session-key rotation: no active P2P connection on promotion",
    );
    return null;
  }
  const previousKey = connection.getSessionKey();
  const newKey = generateSessionKey();
  connection.setSessionKey(newKey);
  log.info("Rotated HMAC session key after promotion to host", {
    rotated: previousKey !== null,
  });
  return newKey;
}
