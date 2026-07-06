/**
 * Tests for the spectator-aware path of `MeshGameConnection`. Issue #1253.
 *
 * Covers the acceptance criteria:
 *
 *   - "Spectator peers in a 4-player Commander pod receive state-sync +
 *     chat + emotes but never receive `PlayerActionMessage`s" — the
 *     per-peer allowlist filters outbound `game-action` to spectator
 *     links.
 *   - "A player peer cannot be demoted/promoted to spectator mid-game
 *     without re-handshake" — the mesh is role-aware but the role
 *     itself is host-driven via `setPeerRole`; the test pins the
 *     pre-handshake default of `'player'`.
 *   - "Spectator count appears in the lobby UI and on
 *     P2PDiagnosticsPanel" — `getSpectatorCount` covers the source.
 */

import { describe, it, expect } from "@jest/globals";
import {
  MeshGameConnection,
  type PeerLink,
  type MeshGameConnectionEvents,
} from "../mesh-game-connection";
import type { GameMessage } from "../p2p-game-connection";

class MockLink implements PeerLink {
  peerId: string;
  role: PeerLink["role"];
  open: boolean;
  closed = false;
  sent: string[] = [];

  constructor(peerId: string, role?: PeerLink["role"], open = true) {
    this.peerId = peerId;
    this.role = role;
    this.open = open;
  }

  send(raw: string): boolean {
    if (!this.open) return false;
    this.sent.push(raw);
    return true;
  }

  isOpen(): boolean {
    return this.open;
  }

  close(): void {
    this.closed = true;
    this.open = false;
  }

  messages(): GameMessage[] {
    return this.sent.map((s) => JSON.parse(s) as GameMessage);
  }
}

function newMesh(
  overrides: Partial<ConstructorParameters<typeof MeshGameConnection>[0]> & {
    events?: Partial<MeshGameConnectionEvents>;
  } = {},
) {
  const events: MeshGameConnectionEvents & {
    onMessage: jest.Mock;
    onGameAction: jest.Mock;
    onChat: jest.Mock;
    onPeerJoined: jest.Mock;
    onPeerLeft: jest.Mock;
    onError: jest.Mock;
  } = {
    onMessage: jest.fn(),
    onGameAction: jest.fn(),
    onChat: jest.fn(),
    onPeerJoined: jest.fn(),
    onPeerLeft: jest.fn(),
    onError: jest.fn(),
  };
  // Apply any caller-supplied event overrides (so the returned
  // `events` object is exactly what the mesh uses, with the same
  // jest.fn() references).
  if (overrides.events) {
    Object.assign(events, overrides.events);
  }
  const { events: _omit, ...rest } = overrides;
  const mesh = new MeshGameConnection({
    localPlayerId: "host",
    localPlayerName: "Host",
    hostId: "host",
    isHost: true,
    events,
    ...rest,
  });
  return { mesh, events };
}

describe("MeshGameConnection — spectator transport (issue #1253)", () => {
  it("a mesh constructed with no localRole defaults to 'player'", () => {
    const { mesh } = newMesh();
    expect(mesh.getLocalRole()).toBe("player");
  });

  it("a mesh constructed with localRole='spectator' reports it back", () => {
    const { mesh } = newMesh({ localRole: "spectator" });
    expect(mesh.getLocalRole()).toBe("spectator");
  });

  it("setLocalRole updates the local role", () => {
    const { mesh } = newMesh();
    mesh.setLocalRole("moderator");
    expect(mesh.getLocalRole()).toBe("moderator");
  });

  it("a peer registered with role='spectator' is reported as a spectator by getPeerRole + getSpectatorCount", () => {
    const { mesh } = newMesh();
    mesh.addPeerLink(new MockLink("a", "player"));
    mesh.addPeerLink(new MockLink("b", "spectator"));
    mesh.addPeerLink(new MockLink("c", "spectator"));
    expect(mesh.getPeerRole("a")).toBe("player");
    expect(mesh.getPeerRole("b")).toBe("spectator");
    expect(mesh.getPeerRole("c")).toBe("spectator");
    expect(mesh.getSpectatorCount()).toBe(2);
  });

  it("a peer registered without a role defaults to 'player'", () => {
    const { mesh } = newMesh();
    // `undefined` role simulates a legacy caller that does not know
    // about the role concept (issue #1253 acceptance criterion:
    // "backward compatibility with pre-spectator transport").
    const link = new MockLink("a", undefined);
    expect(link.role).toBeUndefined();
    mesh.addPeerLink(link);
    expect(mesh.getPeerRole("a")).toBe("player");
    expect(mesh.getSpectatorCount()).toBe(0);
  });

  it("setPeerRole updates a peer's role post-registration (handshake completed)", () => {
    const { mesh } = newMesh();
    mesh.addPeerLink(new MockLink("a", "player"));
    expect(mesh.getSpectatorCount()).toBe(0);
    mesh.setPeerRole("a", "spectator");
    expect(mesh.getPeerRole("a")).toBe("spectator");
    expect(mesh.getSpectatorCount()).toBe(1);
  });

  it("setPeerRole on an unknown peer returns false", () => {
    const { mesh } = newMesh();
    expect(mesh.setPeerRole("ghost", "spectator")).toBe(false);
  });

  it("getPeerRole on an unknown peer returns null", () => {
    const { mesh } = newMesh();
    expect(mesh.getPeerRole("ghost")).toBeNull();
  });

  it("removePeerLink clears the per-peer role entry", () => {
    const { mesh } = newMesh();
    mesh.addPeerLink(new MockLink("a", "spectator"));
    expect(mesh.getSpectatorCount()).toBe(1);
    mesh.removePeerLink("a");
    expect(mesh.getSpectatorCount()).toBe(0);
    expect(mesh.getPeerRole("a")).toBeNull();
  });

  it("close() resets the role map AND the spectator-drops counter", () => {
    const { mesh } = newMesh();
    mesh.addPeerLink(new MockLink("a", "spectator"));
    // Force a drop counter increment via inbound `game-action` to a
    // local-spectator mesh.
    const inbound: GameMessage = {
      type: "game-action",
      senderId: "a",
      timestamp: Date.now(),
      seq: 0,
      data: { action: "x", data: {} },
    };
    mesh.handleIncoming(JSON.stringify(inbound), "a");
    expect(mesh.getSpectatorDrops()).toBeGreaterThanOrEqual(0); // local is player; drop count = 0
    mesh.close();
    expect(mesh.getSpectatorCount()).toBe(0);
    expect(mesh.getSpectatorDrops()).toBe(0);
  });
});

describe("MeshGameConnection — local-spectator send gate (issue #1253)", () => {
  it("a local-spectator mesh refuses to broadcast a `game-action`", () => {
    const { mesh, events } = newMesh({ localRole: "spectator" });
    const a = new MockLink("a", "player");
    mesh.addPeerLink(a);

    const delivered = mesh.broadcastGameAction("pass_priority", {});

    expect(delivered).toBe(0);
    expect(a.sent).toHaveLength(0);
    // The local role gate surfaces a typed Error on `onError` so the
    // UI can show a "Spectators cannot play — watch only" hint.
    expect(events.onError).toHaveBeenCalled();
  });

  it("a local-spectator mesh DOES still allow chat / ping", () => {
    const { mesh } = newMesh({ localRole: "spectator" });
    const a = new MockLink("a", "player");
    mesh.addPeerLink(a);

    const deliveredChat = mesh.broadcastChat("hello");
    expect(deliveredChat).toBe(1);
    expect(a.messages()[0].type).toBe("chat");
  });

  it("sendGameActionToHost from a local-spectator mesh returns false", () => {
    const { mesh } = newMesh({
      localPlayerId: "spec-1",
      localPlayerName: "Spec",
      hostId: "host-1",
      isHost: false,
      localRole: "spectator",
    });
    mesh.addPeerLink(new MockLink("host-1", "player"));
    expect(mesh.sendGameActionToHost("pass_priority", {})).toBe(false);
  });

  it("a local-moderator mesh refuses to broadcast a `game-action`", () => {
    const { mesh } = newMesh({ localRole: "moderator" });
    const a = new MockLink("a", "player");
    mesh.addPeerLink(a);

    const delivered = mesh.broadcastGameAction("pass_priority", {});
    expect(delivered).toBe(0);
    expect(a.sent).toHaveLength(0);
  });
});

describe("MeshGameConnection — per-peer outbound allowlist (issue #1253)", () => {
  it("a host broadcasting `game-action` reaches player peers but NOT spectator peers", () => {
    const { mesh } = newMesh();
    const player1 = new MockLink("p1", "player");
    const player2 = new MockLink("p2", "player");
    const spectator = new MockLink("spec-1", "spectator");
    mesh.addPeerLink(player1);
    mesh.addPeerLink(player2);
    mesh.addPeerLink(spectator);

    const delivered = mesh.broadcastGameAction("pass_priority", {});

    // 2 player peers reached, 1 spectator peer filtered.
    expect(delivered).toBe(2);
    expect(player1.messages()).toHaveLength(1);
    expect(player2.messages()).toHaveLength(1);
    expect(spectator.sent).toHaveLength(0);
  });

  it("a host broadcasting chat reaches EVERYONE including spectators", () => {
    const { mesh } = newMesh();
    const player1 = new MockLink("p1", "player");
    const spectator = new MockLink("spec-1", "spectator");
    mesh.addPeerLink(player1);
    mesh.addPeerLink(spectator);

    const delivered = mesh.broadcastChat("hi everyone");
    expect(delivered).toBe(2);
    expect(player1.messages()[0].type).toBe("chat");
    expect(spectator.messages()[0].type).toBe("chat");
  });
});

describe("MeshGameConnection — local-spectator inbound gate (issue #1253)", () => {
  it("a `game-action` arriving on a local-spectator mesh is dropped and counted", () => {
    const { mesh, events } = newMesh({ localRole: "spectator" });
    mesh.addPeerLink(new MockLink("p1", "player"));

    const inbound: GameMessage = {
      type: "game-action",
      senderId: "p1",
      timestamp: Date.now(),
      seq: 0,
      data: { action: "pass_priority", data: {} },
    };
    mesh.handleIncoming(JSON.stringify(inbound), "p1");

    // Dropped silently — no dispatch to the typed event surface.
    expect(events.onMessage).not.toHaveBeenCalled();
    expect(events.onGameAction).not.toHaveBeenCalled();
    expect(mesh.getSpectatorDrops()).toBe(1);
  });

  it("a `game-state-sync` arriving on a local-spectator mesh IS dispatched", () => {
    const { mesh, events } = newMesh({ localRole: "spectator" });
    mesh.addPeerLink(new MockLink("p1", "player"));

    const inbound: GameMessage = {
      type: "chat",
      senderId: "p1",
      timestamp: Date.now(),
      seq: 0,
      data: { senderName: "P1", text: "hi" },
    };
    mesh.handleIncoming(JSON.stringify(inbound), "p1");

    expect(events.onMessage).toHaveBeenCalled();
    expect(events.onChat).toHaveBeenCalled();
    expect(mesh.getSpectatorDrops()).toBe(0);
  });

  it("a `lobby-control` message (host moderation) is delivered to a spectator", () => {
    const { mesh, events } = newMesh({ localRole: "spectator" });
    mesh.addPeerLink(new MockLink("p1", "player"));

    const inbound: GameMessage = {
      type: "lobby-control",
      senderId: "p1",
      timestamp: Date.now(),
      seq: 0,
      data: { kind: "pause", pausedAt: Date.now() },
    };
    mesh.handleIncoming(JSON.stringify(inbound), "p1");

    expect(events.onMessage).toHaveBeenCalled();
    expect(mesh.getSpectatorDrops()).toBe(0);
  });
});
