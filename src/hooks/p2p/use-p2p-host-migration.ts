/**
 * Issue #916 — host migration concern for the P2P hook.
 *
 * Owns the `HostMigrationManager` lifecycle, the authoritative-host id
 * state, and the roster/migration message routing. Extracted verbatim from
 * `src/hooks/use-p2p-connection.ts` (issue #1927); composed by
 * `useP2PConnection`.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { GameState } from "@/lib/game-state";
import type {
  P2PGameConnection,
  SignalingRole,
} from "@/lib/p2p-game-connection";
import type {
  HostMigrationManager,
  HostMigrationMessage,
  HostMigrationResult,
  PeerRosterEntry,
} from "@/lib/p2p-host-migration";
import { createHostMigrationManager } from "@/lib/p2p-host-migration";
import type { ConflictResolutionManager } from "@/lib/p2p-conflict-resolution";
import { logger } from "@/lib/logger";
import { rotateSessionKeyOnPromotion } from "./rotate-session-key-on-promotion";

const p2pLogger = logger.child("P2PConnection");

export interface UseP2PHostMigrationResult {
  /** Current authoritative host id (updates on host migration). */
  currentHostId: string;
  /** Ref mirror of `currentHostId` for stable late-binding reads. */
  currentHostIdRef: RefObject<string>;
  /** Cache the latest authoritative game state so a promoted host can adopt it. */
  cacheGameStateForMigration: (gameState: GameState) => void;
  /** Track a newly-joined peer for successor-selection purposes. */
  registerPeerForMigration: (
    peerPlayerId: string,
    peerPlayerName: string,
  ) => void;
  /** Inspect a game-action message and route host-migration messages. */
  handleMigrationGameAction: (action: string, data: unknown) => void;
  /** Handle a peer leaving; runs migration when the host dropped. */
  handlePeerLeftForMigration: (
    peerPlayerId: string,
    reason: "host-disconnected" | "host-left",
  ) => void;
  /** Reset the manager + host id for a fresh session (`closeConnection`). */
  resetHostMigration: () => void;
}

export function useP2PHostMigration(options: {
  enableHostMigration: boolean;
  playerId: string;
  playerName: string;
  role: SignalingRole;
  fallbackHostId: string;
  migrationPeers: PeerRosterEntry[];
  onHostMigrated?: (result: HostMigrationResult) => void;
  onGameTerminated?: (reason: string) => void;
  setError: (error: string | null) => void;
  connectionRef: RefObject<P2PGameConnection | null>;
  conflictManagerRef: RefObject<ConflictResolutionManager | null>;
}): UseP2PHostMigrationResult {
  const {
    enableHostMigration,
    playerId,
    playerName,
    role,
    fallbackHostId,
    migrationPeers,
  } = options;

  const [currentHostId, setCurrentHostIdState] =
    useState<string>(fallbackHostId);
  const hostMigrationRef = useRef<HostMigrationManager | null>(null);
  // Mirrors `currentHostId` so the once-created onReconnect handler reads the
  // latest authority without re-creating the connection.
  const currentHostIdRef = useRef(fallbackHostId);
  currentHostIdRef.current = currentHostId;
  // Keep latest callbacks in refs so the manager's event handlers (created
  // once) always see the current props without re-creating the manager.
  const onHostMigratedRef = useRef(options.onHostMigrated);
  const onGameTerminatedRef = useRef(options.onGameTerminated);
  onHostMigratedRef.current = options.onHostMigrated;
  onGameTerminatedRef.current = options.onGameTerminated;

  const setCurrentHostId = useCallback((hostId: string) => {
    setCurrentHostIdState(hostId);
  }, []);

  // Initialize host migration manager
  useEffect(() => {
    if (enableHostMigration && !hostMigrationRef.current) {
      hostMigrationRef.current = createHostMigrationManager({
        localPlayerId: playerId,
        initialHostId: fallbackHostId,
        initialPeers: migrationPeers,
        events: {
          onPromotedToHost: (result) => {
            p2pLogger.info(
              "Promoted to host after migration",
              result.newHostId,
            );
            // Issue #1391 — rotate the HMAC session key so post-migration
            // envelopes are signed under fresh material. The previous host's
            // key is invalidated; followers still holding it reject any
            // post-migration envelope signed under it (issue #1252
            // acceptance criterion #2). Sequence-number continuity is
            // preserved by the transport's `adoptOutgoingSeq` (#1091), so
            // no additional anti-replay change is needed here.
            rotateSessionKeyOnPromotion(
              options.connectionRef.current,
              p2pLogger,
            );
            options.conflictManagerRef.current?.updateConfig({
              hostId: result.newHostId,
            });
            onHostMigratedRef.current?.(result);
          },
          onHostChanged: (result) => {
            p2pLogger.info("Remote peer promoted to host", result.newHostId);
            options.conflictManagerRef.current?.updateConfig({
              hostId: result.newHostId,
            });
            onHostMigratedRef.current?.(result);
          },
          onTerminated: (reason) => {
            p2pLogger.warn("Multiplayer game terminated", reason);
            options.setError(reason);
            onGameTerminatedRef.current?.(reason);
          },
        },
      });
      // Issue #1567 — seed the original host's roster entry with the
      // host-attested joinSeq (0). If the host was already in
      // `migrationPeers` with a lower sequence, that entry is honoured
      // (the counter is just advanced past it).
      if (role === "host") {
        hostMigrationRef.current.seedHostJoinSeq(playerName);
      }
      setCurrentHostIdState(hostMigrationRef.current.getHostId());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableHostMigration, playerId, fallbackHostId]);

  // Cache the latest authoritative game state so a promoted host can adopt it.
  const cacheGameStateForMigration = useCallback((gameState: GameState) => {
    hostMigrationRef.current?.setLastKnownGameState(gameState);
  }, []);

  // Track a newly-joined peer for successor-selection purposes.
  // Issue #1567 — when the local client is the host, mint the next
  // monotonic joinSeq and broadcast it under the HMAC envelope (#1252)
  // so followers cannot forge a low sequence. Followers record the
  // host-attested seq via `recordHostJoinSeq` when the roster-assignment
  // arrives (handled by `handleMigrationGameAction` below).
  const registerPeerForMigration = useCallback(
    (peerPlayerId: string, peerPlayerName: string) => {
      const manager = hostMigrationRef.current;
      if (!manager) return;
      if (manager.isLocalHost()) {
        const entry = manager.assignNextJoinSeq(peerPlayerId, peerPlayerName);
        // Broadcast the host-attested joinSeq to every peer so each
        // follower's roster carries the authoritative sequence. The
        // game-action channel rides under the HMAC envelope (#1252), so
        // a malicious peer cannot claim a lower sequence for itself.
        options.connectionRef.current?.sendGameAction("roster-assignment", {
          playerId: entry.playerId,
          playerName: entry.playerName,
          joinSeq: entry.joinSeq,
        });
        return;
      }
      // Follower path: the host will tell us the authoritative joinSeq
      // shortly. Record a sentinel (joinSeq = MAX_SAFE_INTEGER so this
      // peer is effectively ignored by the sort comparator until the
      // host's assignment arrives) and let `handleMigrationGameAction`
      // overwrite it. Using MAX_SAFE_INTEGER is safe — the host's real
      // sequence will be a small non-negative integer, so the placeholder
      // can never win succession.
      manager.upsertPeer({
        playerId: peerPlayerId,
        playerName: peerPlayerName,
        joinedAt: Date.now(),
        joinSeq: Number.MAX_SAFE_INTEGER,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Issue #1567 — handle a host-broadcast roster-assignment message.
  // The message carries the host-attested `joinSeq` for one peer; we
  // update the local roster so successor selection sees the same value
  // every other peer does.
  const handleRosterAssignment = useCallback((payload: unknown) => {
    const manager = hostMigrationRef.current;
    if (!manager) return;
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as { playerId?: unknown }).playerId !== "string" ||
      typeof (payload as { joinSeq?: unknown }).joinSeq !== "number"
    ) {
      return; // malformed — drop silently
    }
    const { playerId: assignedId, joinSeq } = payload as {
      playerId: string;
      joinSeq: number;
    };
    // Defensive: only accept non-negative finite integers. A peer
    // replaying an older assignment or attempting a negative seq is
    // rejected — the transport's HMAC envelope (#1252) is the
    // primary defence; this is belt-and-suspenders.
    if (
      !Number.isFinite(joinSeq) ||
      joinSeq < 0 ||
      !Number.isInteger(joinSeq)
    ) {
      return;
    }
    manager.recordHostJoinSeq(assignedId, joinSeq);
  }, []);

  // Apply a received host-migration message (idempotent).
  const applyHostMigrationMessage = useCallback(
    (message: HostMigrationMessage) => {
      const manager = hostMigrationRef.current;
      if (!manager) return;
      const result = manager.applyMigration(message);
      if (result) {
        setCurrentHostId(manager.getHostId());
      }
    },
    [setCurrentHostId],
  );

  // Handle a peer leaving. If it was the host, run migration: the deterministic
  // successor broadcasts a migration message and promotes itself; others apply
  // it on receipt. If too few peers remain, the manager terminates cleanly.
  const handlePeerLeftForMigration = useCallback(
    (peerPlayerId: string, reason: "host-disconnected" | "host-left") => {
      const manager = hostMigrationRef.current;
      if (!manager) return;

      const wasHost = manager.getHostId() === peerPlayerId;
      manager.removePeer(peerPlayerId);

      if (!wasHost) return;

      const result = manager.initiateMigration(reason);
      if (result.terminated) {
        // onTerminated event already fired by the manager.
        return;
      }

      if (result.promotedSelf) {
        setCurrentHostId(manager.getHostId());
        const message = manager.buildMigrationMessage(result);
        options.connectionRef.current?.sendGameAction(
          "host-migration",
          message,
        );
      }
      // Non-successor peers do nothing here; they apply the successor's
      // broadcast via applyHostMigrationMessage when it arrives.
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setCurrentHostId],
  );

  // Inspect a game-action message and route host-migration messages.
  // Issue #1567 — also routes `roster-assignment` messages carrying the
  // host-attested joinSeq for newly-admitted peers.
  const handleMigrationGameAction = useCallback(
    (action: string, data: unknown) => {
      if (action === "host-migration") {
        if (!data || typeof data !== "object") return;
        const message = data as HostMigrationMessage;
        if (message.type !== "host-migration") return;
        applyHostMigrationMessage(message);
        return;
      }
      if (action === "roster-assignment") {
        handleRosterAssignment(data);
        return;
      }
    },
    [applyHostMigrationMessage, handleRosterAssignment],
  );

  const resetHostMigration = useCallback(() => {
    hostMigrationRef.current?.reset();
    setCurrentHostIdState(fallbackHostId);
  }, [fallbackHostId]);

  return {
    currentHostId,
    currentHostIdRef,
    cacheGameStateForMigration,
    registerPeerForMigration,
    handleMigrationGameAction,
    handlePeerLeftForMigration,
    resetHostMigration,
  };
}
