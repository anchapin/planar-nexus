/**
 * Tests for the per-peer role model. Issue #1253.
 *
 * Covers the acceptance criteria from the issue:
 *
 *   - "Spectator peers in a 4-player Commander pod receive state-sync +
 *     chat + emotes but never receive PlayerActionMessages" — encoded
 *     by `SPECTATOR_INBOUND_ALLOWED_TYPES` and `isMessageAllowedForRole`.
 *   - "A player peer cannot be demoted/promoted to spectator mid-game
 *     without re-handshake" — encoded by `isRoleTransitionAllowed`.
 *   - "Coverage maintained" — unit-level coverage of every helper in
 *     `peer-role.ts`.
 */

import { describe, it, expect } from "@jest/globals";
import {
  DEFAULT_PEER_ROLE,
  MODERATOR_INBOUND_ALLOWED_TYPES,
  READ_ONLY_OUTBOUND_ALLOWED_TYPES,
  REJECT_SENT_AS_MODERATOR,
  REJECT_SENT_AS_SPECTATOR,
  SPECTATOR_INBOUND_ALLOWED_TYPES,
  isMessageAllowedForRole,
  isRoleAllowedToSend,
  isRoleTransitionAllowed,
  rejectionReasonForSend,
  type PeerRole,
} from "../peer-role";
import type { GameMessageType } from "../p2p-game-connection";

describe("peer-role — DEFAULT_PEER_ROLE", () => {
  it("is 'player' (the legacy default)", () => {
    expect(DEFAULT_PEER_ROLE).toBe("player");
  });
});

describe("peer-role — SPECTATOR_INBOUND_ALLOWED_TYPES", () => {
  const ALLOWED: GameMessageType[] = [
    "game-state-sync",
    "request-state-sync",
    "chat",
    "player-joined",
    "player-left",
    "ping",
    "pong",
    "error",
    "lobby-control",
  ];

  it.each(ALLOWED)("spectators may receive %s", (type) => {
    expect(SPECTATOR_INBOUND_ALLOWED_TYPES.has(type)).toBe(true);
  });

  const DISALLOWED: GameMessageType[] = ["game-action"];

  it.each(DISALLOWED)(
    "spectators may NOT receive %s (PlayerActionMessage drop)",
    (type) => {
      expect(SPECTATOR_INBOUND_ALLOWED_TYPES.has(type)).toBe(false);
    },
  );
});

describe("peer-role — MODERATOR_INBOUND_ALLOWED_TYPES", () => {
  it("is a strict superset of SPECTATOR_INBOUND_ALLOWED_TYPES", () => {
    for (const t of SPECTATOR_INBOUND_ALLOWED_TYPES) {
      expect(MODERATOR_INBOUND_ALLOWED_TYPES.has(t)).toBe(true);
    }
  });

  it("additionally includes game-action so judges can audit the action log", () => {
    expect(MODERATOR_INBOUND_ALLOWED_TYPES.has("game-action")).toBe(true);
  });
});

describe("peer-role — READ_ONLY_OUTBOUND_ALLOWED_TYPES", () => {
  it("includes chat, ping, request-state-sync", () => {
    expect(READ_ONLY_OUTBOUND_ALLOWED_TYPES.has("chat")).toBe(true);
    expect(READ_ONLY_OUTBOUND_ALLOWED_TYPES.has("ping")).toBe(true);
    expect(READ_ONLY_OUTBOUND_ALLOWED_TYPES.has("request-state-sync")).toBe(
      true,
    );
  });

  it("does NOT include game-action (the read-only gate)", () => {
    expect(READ_ONLY_OUTBOUND_ALLOWED_TYPES.has("game-action")).toBe(false);
  });
});

describe("peer-role — isMessageAllowedForRole", () => {
  it("a player may receive every type", () => {
    const all: GameMessageType[] = [
      "game-state-sync",
      "game-action",
      "chat",
      "player-joined",
      "player-left",
      "ping",
      "pong",
      "error",
      "request-state-sync",
      "lobby-control",
    ];
    for (const t of all) {
      expect(isMessageAllowedForRole("player", t)).toBe(true);
    }
  });

  it("a spectator may receive state-sync + chat + emotes but NOT game-action", () => {
    expect(isMessageAllowedForRole("spectator", "game-state-sync")).toBe(true);
    expect(isMessageAllowedForRole("spectator", "chat")).toBe(true);
    expect(isMessageAllowedForRole("spectator", "ping")).toBe(true);
    expect(isMessageAllowedForRole("spectator", "error")).toBe(true);
    // PlayerActionMessage drop — the headline acceptance criterion.
    expect(isMessageAllowedForRole("spectator", "game-action")).toBe(false);
  });

  it("a moderator may receive every type (including game-action for audit)", () => {
    expect(isMessageAllowedForRole("moderator", "game-state-sync")).toBe(true);
    expect(isMessageAllowedForRole("moderator", "game-action")).toBe(true);
    expect(isMessageAllowedForRole("moderator", "chat")).toBe(true);
  });
});

describe("peer-role — isRoleAllowedToSend", () => {
  it("a player may send every type", () => {
    expect(isRoleAllowedToSend("player", "game-action")).toBe(true);
    expect(isRoleAllowedToSend("player", "chat")).toBe(true);
  });

  it("a spectator may NOT send game-action (read-only role)", () => {
    expect(isRoleAllowedToSend("spectator", "game-action")).toBe(false);
  });

  it("a moderator may NOT send game-action (read-only role)", () => {
    expect(isRoleAllowedToSend("moderator", "game-action")).toBe(false);
  });

  it("a spectator may send chat, ping, request-state-sync", () => {
    expect(isRoleAllowedToSend("spectator", "chat")).toBe(true);
    expect(isRoleAllowedToSend("spectator", "ping")).toBe(true);
    expect(isRoleAllowedToSend("spectator", "request-state-sync")).toBe(true);
  });
});

describe("peer-role — rejectionReasonForSend", () => {
  it("returns null for a role-allowed send", () => {
    expect(rejectionReasonForSend("player", "game-action")).toBeNull();
    expect(rejectionReasonForSend("spectator", "chat")).toBeNull();
  });

  it("returns the spectator-specific reason when a spectator tries to send a game-action", () => {
    expect(rejectionReasonForSend("spectator", "game-action")).toBe(
      REJECT_SENT_AS_SPECTATOR,
    );
  });

  it("returns the moderator-specific reason when a moderator tries to send a game-action", () => {
    expect(rejectionReasonForSend("moderator", "game-action")).toBe(
      REJECT_SENT_AS_MODERATOR,
    );
  });
});

describe("peer-role — isRoleTransitionAllowed", () => {
  it("same-role transitions are always allowed", () => {
    const roles: PeerRole[] = ["player", "spectator", "moderator"];
    for (const r of roles) {
      expect(isRoleTransitionAllowed(r, r)).toBe(true);
    }
  });

  it("player → spectator requires re-handshake (returns false)", () => {
    expect(isRoleTransitionAllowed("player", "spectator")).toBe(false);
  });

  it("spectator → player requires re-handshake (returns false)", () => {
    expect(isRoleTransitionAllowed("spectator", "player")).toBe(false);
  });

  it("spectator → moderator is non-cross-boundary (returns true)", () => {
    // Both are non-player; the mesh trusts the host's ack to enforce
    // the actual semantics. The function only flags the player ⇄
    // non-player crossing.
    expect(isRoleTransitionAllowed("spectator", "moderator")).toBe(true);
    expect(isRoleTransitionAllowed("moderator", "spectator")).toBe(true);
  });

  it("player → moderator requires re-handshake (returns false)", () => {
    expect(isRoleTransitionAllowed("player", "moderator")).toBe(false);
  });
});
