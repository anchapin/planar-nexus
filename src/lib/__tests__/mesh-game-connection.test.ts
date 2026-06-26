/**
 * Tests for the game-message-level multi-peer mesh.
 * Issue #1087: "[Multiplayer] Support 3+ player mesh topology in the P2P
 * connection layer".
 *
 * Covers: 3+ peer join, broadcast delivery to all, targeted send, peer
 * leave/disconnect, per-sender anti-replay across multiple senders (#1091),
 * host-side action validation from any peer (#1089), per-link rate limiting
 * (#1111), host-migration rewiring, and the trust pipeline (malformed /
 * oversize / missing-seq rejection).
 */

import {
  MeshGameConnection,
  createMeshGameConnection,
  type PeerLink,
  type MeshGameConnectionEvents,
} from "../mesh-game-connection";
import type { GameMessage } from "../p2p-game-connection";

/** The event handle: each callback is a jest.Mock so call sites can assert. */
interface MockEvents {
  onMessage: jest.Mock;
  onGameAction: jest.Mock;
  onChat: jest.Mock;
  onPeerJoined: jest.Mock;
  onPeerLeft: jest.Mock;
  onError: jest.Mock;
}

/** A controllable stand-in for a peer's data-channel-backed transport link. */
class MockLink implements PeerLink {
  peerId: string;
  open: boolean;
  closed = false;
  sent: string[] = [];

  constructor(peerId: string, open = true) {
    this.peerId = peerId;
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

  /** Parsed messages this link received, in order. */
  messages(): GameMessage[] {
    return this.sent.map((s) => JSON.parse(s) as GameMessage);
  }
}

/** Build a wire-string GameMessage for inbound injection. */
const inbound = (
  senderId: string,
  seq: number,
  overrides: Partial<GameMessage> & { type?: GameMessage["type"] } = {},
): string => {
  const msg: GameMessage = {
    type: "game-action",
    senderId,
    timestamp: Date.now(),
    seq,
    data: { action: "pass_priority", data: {} },
    ...overrides,
  };
  return JSON.stringify(msg);
};

const newMesh = (
  overrides: Partial<ConstructorParameters<typeof MeshGameConnection>[0]> & {
    events?: Partial<MeshGameConnectionEvents>;
  } = {},
): { mesh: MeshGameConnection; events: MockEvents } => {
  const events: MockEvents = {
    onMessage: jest.fn(),
    onGameAction: jest.fn(),
    onChat: jest.fn(),
    onPeerJoined: jest.fn(),
    onPeerLeft: jest.fn(),
    onError: jest.fn(),
  };
  // Apply caller event overrides onto the shared handle so the returned
  // `events` object is exactly what the mesh uses (same references).
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
};

describe("MeshGameConnection — construction & host role", () => {
  it("requires localPlayerId and hostId", () => {
    expect(
      () =>
        new MeshGameConnection({
          localPlayerId: "",
          localPlayerName: "x",
          hostId: "h",
          isHost: true,
        }),
    ).toThrow();
    expect(
      () =>
        new MeshGameConnection({
          localPlayerId: "x",
          localPlayerName: "x",
          hostId: "",
          isHost: true,
        }),
    ).toThrow();
  });

  it("reports host id + host flag", () => {
    const { mesh } = newMesh();
    expect(mesh.isHost()).toBe(true);
    expect(mesh.getHostId()).toBe("host");
  });

  it("createMeshGameConnection factory returns a working instance", () => {
    const mesh = createMeshGameConnection({
      localPlayerId: "p1",
      localPlayerName: "P1",
      hostId: "p1",
      isHost: true,
    });
    expect(mesh.getPeerCount()).toBe(0);
  });
});

describe("MeshGameConnection — peer membership (3+ players)", () => {
  it("adds three peers and reports them", () => {
    const { mesh, events } = newMesh();
    expect(mesh.addPeerLink(new MockLink("p1"))).toBe(true);
    expect(mesh.addPeerLink(new MockLink("p2"))).toBe(true);
    expect(mesh.addPeerLink(new MockLink("p3"))).toBe(true);

    expect(mesh.getPeerCount()).toBe(3);
    expect(mesh.getPeerIds().sort()).toEqual(["p1", "p2", "p3"]);
    expect(mesh.hasPeer("p2")).toBe(true);
    // onPeerJoined fired once per new peer.
    expect(events.onPeerJoined).toHaveBeenCalledTimes(3);
  });

  it("rejects adding the local player as a peer", () => {
    const { mesh } = newMesh();
    expect(mesh.addPeerLink(new MockLink("host"))).toBe(false);
    expect(mesh.getPeerCount()).toBe(0);
  });

  it("rejects adding an empty peer id", () => {
    const { mesh } = newMesh();
    expect(mesh.addPeerLink(new MockLink(""))).toBe(false);
  });

  it("replacing a peer link closes the old link and keeps the count flat", () => {
    const { mesh, events } = newMesh();
    const first = new MockLink("p1");
    mesh.addPeerLink(first);
    const second = new MockLink("p1");
    // Replace returns false (not a NEW peer) but the old link is closed.
    expect(mesh.addPeerLink(second)).toBe(false);
    expect(first.closed).toBe(true);
    expect(mesh.getPeerCount()).toBe(1);
    // Only one onPeerJoined (the original add).
    expect(events.onPeerJoined).toHaveBeenCalledTimes(1);
  });

  it("removing a peer closes its link, drops it from the mesh, emits onPeerLeft", () => {
    const { mesh, events } = newMesh();
    const link = new MockLink("p1");
    mesh.addPeerLink(link);
    expect(mesh.removePeerLink("p1")).toBe(true);

    expect(link.closed).toBe(true);
    expect(mesh.hasPeer("p1")).toBe(false);
    expect(events.onPeerLeft).toHaveBeenCalledWith("p1");
  });

  it("removePeerLink is a no-op for an unknown peer", () => {
    const { mesh } = newMesh();
    expect(mesh.removePeerLink("ghost")).toBe(false);
  });
});

describe("MeshGameConnection — broadcast delivery to all peers", () => {
  it("delivers a broadcast to every open link (3 players)", () => {
    const { mesh } = newMesh();
    const a = new MockLink("a");
    const b = new MockLink("b");
    const c = new MockLink("c");
    mesh.addPeerLink(a);
    mesh.addPeerLink(b);
    mesh.addPeerLink(c);

    const delivered = mesh.broadcastGameAction("pass_priority", {});

    expect(delivered).toBe(3);
    expect(a.messages()).toHaveLength(1);
    expect(b.messages()).toHaveLength(1);
    expect(c.messages()).toHaveLength(1);
    // Same authoritative message reached every peer.
    for (const link of [a, b, c]) {
      const m = link.messages()[0];
      expect(m.type).toBe("game-action");
      expect(m.senderId).toBe("host");
      expect(m.data).toEqual({ action: "pass_priority", data: {} });
    }
  });

  it("stamps one shared monotonic seq per broadcast across all peers", () => {
    const { mesh } = newMesh();
    const a = new MockLink("a");
    const b = new MockLink("b");
    mesh.addPeerLink(a);
    mesh.addPeerLink(b);

    mesh.broadcastGameAction("act1", {});
    mesh.broadcastGameAction("act2", {});

    // First broadcast → seq 0 to both; second broadcast → seq 1 to both.
    expect(a.messages()[0].seq).toBe(0);
    expect(b.messages()[0].seq).toBe(0);
    expect(a.messages()[1].seq).toBe(1);
    expect(b.messages()[1].seq).toBe(1);
    expect(mesh.getOutgoingSeq()).toBe(2);
  });

  it("skips closed links and returns only the count reached", () => {
    const { mesh } = newMesh();
    const open = new MockLink("open");
    const closed = new MockLink("closed", false);
    mesh.addPeerLink(open);
    mesh.addPeerLink(closed);

    expect(mesh.broadcastGameAction("x", {})).toBe(1);
    expect(open.messages()).toHaveLength(1);
    expect(closed.sent).toHaveLength(0);
  });

  it("broadcasts chat with the local sender name", () => {
    const { mesh } = newMesh({
      localPlayerId: "me",
      localPlayerName: "Me",
      hostId: "me",
    });
    const a = new MockLink("a");
    mesh.addPeerLink(a);

    mesh.broadcastChat("hello world");
    expect(a.messages()[0]).toEqual(
      expect.objectContaining({
        type: "chat",
        senderId: "me",
        data: { senderName: "Me", text: "hello world" },
      }),
    );
  });

  it("broadcast to an empty mesh reaches nobody (0)", () => {
    const { mesh } = newMesh();
    expect(mesh.broadcastGameAction("x", {})).toBe(0);
  });
});

describe("MeshGameConnection — targeted send (send-to-one)", () => {
  it("delivers only to the targeted peer", () => {
    const { mesh } = newMesh();
    const a = new MockLink("a");
    const b = new MockLink("b");
    const c = new MockLink("c");
    mesh.addPeerLink(a);
    mesh.addPeerLink(b);
    mesh.addPeerLink(c);

    expect(mesh.sendToPeer("b", { type: "chat", data: { text: "psst" } })).toBe(
      true,
    );
    expect(b.messages()).toHaveLength(1);
    expect(a.sent).toHaveLength(0);
    expect(c.sent).toHaveLength(0);
  });

  it("returns false for an unknown peer", () => {
    const { mesh } = newMesh();
    expect(mesh.sendToPeer("ghost", { type: "chat", data: {} })).toBe(false);
  });

  it("returns false when the target link is closed", () => {
    const { mesh } = newMesh();
    const dead = new MockLink("dead", false);
    mesh.addPeerLink(dead);
    expect(mesh.sendToPeer("dead", { type: "chat", data: {} })).toBe(false);
  });
});

describe("MeshGameConnection — host-authoritative routing", () => {
  it("a non-host routes its game-action to the host only", () => {
    const { mesh } = newMesh({
      localPlayerId: "p2",
      localPlayerName: "P2",
      hostId: "host",
      isHost: false,
    });
    const host = new MockLink("host");
    const other = new MockLink("p3");
    mesh.addPeerLink(host);
    mesh.addPeerLink(other);

    expect(mesh.sendGameActionToHost("cast_spell", { target: "x" })).toBe(true);
    expect(host.messages()).toHaveLength(1);
    expect(other.sent).toHaveLength(0);
    expect(host.messages()[0].type).toBe("game-action");
  });

  it("a host sending to itself is a no-op (returns false)", () => {
    const { mesh } = newMesh(); // local == host
    mesh.addPeerLink(new MockLink("p2"));
    expect(mesh.sendGameActionToHost("cast", {})).toBe(false);
  });
});

describe("MeshGameConnection — inbound trust pipeline", () => {
  it("forwards a well-formed game-action to onMessage + onGameAction", () => {
    const { mesh, events } = newMesh();
    mesh.addPeerLink(new MockLink("p1"));

    mesh.handleIncoming(inbound("p1", 0), "p1");

    expect(events.onMessage).toHaveBeenCalledTimes(1);
    expect(events.onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "game-action", senderId: "p1", seq: 0 }),
      "p1",
    );
    expect(events.onGameAction).toHaveBeenCalledWith("pass_priority", {}, "p1");
  });

  it("forwards chat to onChat with sender + text", () => {
    const { mesh, events } = newMesh();
    mesh.addPeerLink(new MockLink("p1"));
    mesh.handleIncoming(
      inbound("p1", 0, {
        type: "chat",
        data: { senderName: "P1", text: "hi" },
      }),
      "p1",
    );
    expect(events.onChat).toHaveBeenCalledWith("p1", "P1", "hi");
  });

  it("rejects malformed JSON without forwarding", () => {
    const { mesh, events } = newMesh();
    mesh.addPeerLink(new MockLink("p1"));
    expect(() => mesh.handleIncoming("{ not json", "p1")).not.toThrow();
    expect(events.onMessage).not.toHaveBeenCalled();
  });

  it("rejects valid JSON of the wrong shape", () => {
    const { mesh, events } = newMesh();
    mesh.addPeerLink(new MockLink("p1"));
    mesh.handleIncoming(JSON.stringify({ type: "evil", senderId: "x" }), "p1");
    mesh.handleIncoming(JSON.stringify({ foo: "bar" }), "p1");
    expect(events.onMessage).not.toHaveBeenCalled();
  });

  it("rejects a well-shaped message missing the required seq field", () => {
    const { mesh, events } = newMesh();
    mesh.addPeerLink(new MockLink("p1"));
    mesh.handleIncoming(
      JSON.stringify({
        type: "game-action",
        senderId: "p1",
        timestamp: 1,
        data: { action: "pass" },
      }),
      "p1",
    );
    expect(events.onMessage).not.toHaveBeenCalled();
  });

  it("rejects an oversize message before forwarding", () => {
    const { mesh, events } = newMesh();
    mesh.addPeerLink(new MockLink("p1"));
    const huge = "x".repeat(300 * 1024);
    mesh.handleIncoming(
      inbound("p1", 0, { data: { action: "pass", junk: huge } }),
      "p1",
    );
    expect(events.onMessage).not.toHaveBeenCalled();
  });

  it("does not break the mesh when a handler throws", () => {
    const { mesh } = newMesh({
      events: {
        onMessage: () => {
          throw new Error("boom");
        },
      },
    });
    mesh.addPeerLink(new MockLink("p1"));
    // The thrown handler error is caught — mesh stays usable.
    expect(() => mesh.handleIncoming(inbound("p1", 0), "p1")).not.toThrow();
    // A subsequent well-formed message still parses (mesh alive).
    mesh.handleIncoming(inbound("p1", 1), "p1");
  });
});

describe("MeshGameConnection — per-sender anti-replay across N senders (#1091)", () => {
  it("accepts an increasing stream from one sender and tracks the high-water mark", () => {
    const { mesh, events } = newMesh();
    mesh.addPeerLink(new MockLink("p1"));
    for (let s = 0; s < 4; s++) {
      mesh.handleIncoming(inbound("p1", s), "p1");
    }
    expect(mesh.getLastAppliedSeq("p1")).toBe(3);
    expect(events.onMessage).toHaveBeenCalledTimes(4);
  });

  it("drops a duplicate seq (same payload identity) from one sender", () => {
    const { mesh, events } = newMesh();
    mesh.addPeerLink(new MockLink("p1"));
    mesh.handleIncoming(inbound("p1", 5), "p1");
    mesh.handleIncoming(inbound("p1", 5), "p1"); // duplicate
    expect(events.onMessage).toHaveBeenCalledTimes(1);
    expect(mesh.getLastAppliedSeq("p1")).toBe(5);
  });

  it("drops a stale (older) seq that straggles in", () => {
    const { mesh, events } = newMesh();
    mesh.addPeerLink(new MockLink("p1"));
    mesh.handleIncoming(inbound("p1", 10), "p1");
    mesh.handleIncoming(inbound("p1", 9), "p1"); // stale
    expect(events.onMessage).toHaveBeenCalledTimes(1);
  });

  it("tracks three senders independently — each may start at seq 0", () => {
    const { mesh, events } = newMesh();
    mesh.addPeerLink(new MockLink("a"));
    mesh.addPeerLink(new MockLink("b"));
    mesh.addPeerLink(new MockLink("c"));

    mesh.handleIncoming(inbound("a", 0), "a");
    mesh.handleIncoming(inbound("b", 0), "b");
    mesh.handleIncoming(inbound("c", 0), "c");
    mesh.handleIncoming(inbound("a", 1), "a");
    mesh.handleIncoming(inbound("a", 0), "a"); // replay of a:0 → dropped
    mesh.handleIncoming(inbound("c", 0), "c"); // replay of c:0 → dropped

    expect(events.onMessage).toHaveBeenCalledTimes(4);
    expect(mesh.getLastAppliedSeq("a")).toBe(1);
    expect(mesh.getLastAppliedSeq("b")).toBe(0);
    expect(mesh.getLastAppliedSeq("c")).toBe(0);
  });

  it("advanceIncomingSeq jumps the high-water mark (full-sync reconciliation)", () => {
    const { mesh, events } = newMesh();
    mesh.addPeerLink(new MockLink("p1"));
    mesh.handleIncoming(inbound("p1", 2), "p1");
    mesh.advanceIncomingSeq("p1", 100);
    // Everything <= 100 is now a replay.
    mesh.handleIncoming(inbound("p1", 50), "p1");
    mesh.handleIncoming(inbound("p1", 100), "p1");
    expect(events.onMessage).toHaveBeenCalledTimes(1);
    mesh.handleIncoming(inbound("p1", 101), "p1");
    expect(events.onMessage).toHaveBeenCalledTimes(2);
  });

  it("resetIncomingSeq lets a sender start fresh", () => {
    const { mesh, events } = newMesh();
    mesh.addPeerLink(new MockLink("p1"));
    mesh.handleIncoming(inbound("p1", 9), "p1");
    mesh.resetIncomingSeq("p1");
    expect(mesh.getLastAppliedSeq("p1")).toBeNull();
    mesh.handleIncoming(inbound("p1", 0), "p1"); // accepted again
    expect(events.onMessage).toHaveBeenCalledTimes(2);
  });
});

describe("MeshGameConnection — host-side action validation (#1089)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("the host forwards a LEGAL action from any peer", () => {
    const validator = jest.fn(() => ({ isValid: true }));
    const { mesh, events } = newMesh({
      validatePeerActions: true,
      validatePeerAction: validator,
    });
    mesh.addPeerLink(new MockLink("p1"));
    mesh.handleIncoming(inbound("p1", 0), "p1");
    expect(events.onMessage).toHaveBeenCalledTimes(1);
    expect(validator).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pass_priority" }),
      "p1",
    );
  });

  it("the host REJECTS an illegal action and does NOT forward it", () => {
    const validator = jest.fn(() => ({ isValid: false, reason: "Illegal" }));
    const { mesh, events } = newMesh({
      validatePeerActions: true,
      validatePeerAction: validator,
    });
    const link = new MockLink("p1");
    mesh.addPeerLink(link);

    mesh.handleIncoming(inbound("p1", 0), "p1");

    expect(events.onMessage).not.toHaveBeenCalled();
    expect(events.onGameAction).not.toHaveBeenCalled();
    // A typed error was sent back over the sender's link.
    const err = link.messages()[0];
    expect(err.type).toBe("error");
    expect(err.data).toEqual(
      expect.objectContaining({
        code: "action_rejected",
        action: "pass_priority",
        reason: "Illegal",
        rejectedSeq: 0,
      }),
    );
  });

  it("the rejection uses a default reason when the validator omits one", () => {
    const { mesh } = newMesh({
      validatePeerActions: true,
      validatePeerAction: jest.fn(() => ({ isValid: false })),
    });
    const link = new MockLink("p1");
    mesh.addPeerLink(link);
    mesh.handleIncoming(inbound("p1", 0), "p1");
    expect((link.messages()[0].data as { reason: string }).reason).toBe(
      "Action rejected by host",
    );
  });

  it("fail-closed: gate enabled without a validator rejects the action", () => {
    const { mesh, events } = newMesh({ validatePeerActions: true });
    const link = new MockLink("p1");
    mesh.addPeerLink(link);
    mesh.handleIncoming(inbound("p1", 0), "p1");
    expect(events.onMessage).not.toHaveBeenCalled();
    expect((link.messages()[0].data as { reason: string }).reason).toBe(
      "No action validator configured",
    );
  });

  it("opt-in: a NON-host does not validate actions even if a validator is set", () => {
    const validator = jest.fn(() => ({ isValid: true }));
    const { mesh, events } = newMesh({
      localPlayerId: "p2",
      hostId: "host",
      isHost: false,
      validatePeerActions: true,
      validatePeerAction: validator,
    });
    mesh.addPeerLink(new MockLink("host"));
    mesh.handleIncoming(inbound("host", 0), "host");
    // Non-host forwards without consulting the validator.
    expect(events.onMessage).toHaveBeenCalledTimes(1);
    expect(validator).not.toHaveBeenCalled();
  });

  it("a throwing validator is treated as a rejection (never applied)", () => {
    const { mesh, events } = newMesh({
      validatePeerActions: true,
      validatePeerAction: () => {
        throw new Error("validator crashed");
      },
    });
    mesh.addPeerLink(new MockLink("p1"));
    mesh.handleIncoming(inbound("p1", 0), "p1");
    expect(events.onMessage).not.toHaveBeenCalled();
  });

  it("does not corrupt state: a later legal action still applies", () => {
    const validator = jest.fn((a) =>
      a.action === "evil"
        ? { isValid: false, reason: "Illegal" }
        : { isValid: true },
    );
    const { mesh, events } = newMesh({
      validatePeerActions: true,
      validatePeerAction: validator,
    });
    mesh.addPeerLink(new MockLink("p1"));
    mesh.handleIncoming(inbound("p1", 0, { data: { action: "evil" } }), "p1");
    mesh.handleIncoming(
      inbound("p1", 1, { data: { action: "pass_priority" } }),
      "p1",
    );
    expect(events.onMessage).toHaveBeenCalledTimes(1);
    expect(events.onMessage.mock.calls[0][0].seq).toBe(1);
  });
});

describe("MeshGameConnection — per-link rate limiting (#1111)", () => {
  it("drops messages from a flooding peer without affecting other peers", () => {
    const { mesh, events } = newMesh({
      rateLimit: { maxMessages: 2, windowMs: 60_000 },
    });
    mesh.addPeerLink(new MockLink("flooder"));
    mesh.addPeerLink(new MockLink("nice"));

    // Flooder blasts 3 messages (limit is 2) — 3rd dropped.
    mesh.handleIncoming(inbound("flooder", 0), "flooder");
    mesh.handleIncoming(inbound("flooder", 1), "flooder");
    mesh.handleIncoming(inbound("flooder", 2), "flooder");
    // Nice peer is unaffected by the flooder's budget.
    mesh.handleIncoming(inbound("nice", 0), "nice");

    const forwardedSenders = events.onMessage.mock.calls.map(
      (c: unknown[]) => (c[0] as GameMessage).senderId,
    );
    expect(forwardedSenders).toEqual(["flooder", "flooder", "nice"]);
  });
});

describe("MeshGameConnection — host-migration rewiring (#946)", () => {
  it("setHostId updates the host and routes sendGameActionToHost to the new host", () => {
    const { mesh } = newMesh({
      localPlayerId: "p2",
      localPlayerName: "P2",
      hostId: "oldhost",
      isHost: false,
    });
    const oldHost = new MockLink("oldhost");
    const newHost = new MockLink("newhost");
    mesh.addPeerLink(oldHost);
    mesh.addPeerLink(newHost);

    mesh.sendGameActionToHost("act", {}); // → oldhost
    expect(oldHost.messages()).toHaveLength(1);

    mesh.setHostId("newhost"); // migration
    expect(mesh.getHostId()).toBe("newhost");
    expect(mesh.isHost()).toBe(false);

    mesh.sendGameActionToHost("act", {}); // → newhost
    expect(newHost.messages()).toHaveLength(1);
    expect(oldHost.messages()).toHaveLength(1); // unchanged
  });

  it("setHostId promotes the local client to host when it is the successor", () => {
    const { mesh } = newMesh({
      localPlayerId: "p2",
      hostId: "oldhost",
      isHost: false,
    });
    mesh.setHostId("p2");
    expect(mesh.isHost()).toBe(true);
    // Now host: sendGameActionToHost is a no-op.
    expect(mesh.sendGameActionToHost("act", {})).toBe(false);
  });

  it("adoptOutgoingSeq continues the counter for the successor", () => {
    const { mesh } = newMesh();
    // A peer link is required: broadcast short-circuits on an empty mesh and
    // would not stamp an outgoing seq.
    mesh.addPeerLink(new MockLink("a"));
    mesh.broadcastGameAction("a", {}); // seq 0
    mesh.broadcastGameAction("b", {}); // seq 1
    expect(mesh.getOutgoingSeq()).toBe(2);
    mesh.adoptOutgoingSeq(50); // adopt previous host's high-water mark
    mesh.broadcastGameAction("c", {});
    expect(mesh.getOutgoingSeq()).toBe(51);
  });

  it("adoptOutgoingSeq never regresses the counter", () => {
    const { mesh } = newMesh();
    mesh.adoptOutgoingSeq(100);
    mesh.adoptOutgoingSeq(5); // ignored
    expect(mesh.getOutgoingSeq()).toBe(100);
  });
});

describe("MeshGameConnection — teardown", () => {
  it("close() closes every link and clears anti-replay state", () => {
    const { mesh } = newMesh();
    const a = new MockLink("a");
    const b = new MockLink("b");
    mesh.addPeerLink(a);
    mesh.addPeerLink(b);
    mesh.handleIncoming(inbound("a", 0), "a"); // seed anti-replay

    mesh.close();

    expect(a.closed).toBe(true);
    expect(b.closed).toBe(true);
    expect(mesh.getPeerCount()).toBe(0);
    expect(mesh.getLastAppliedSeq("a")).toBeNull();
  });

  it("close() is idempotent", () => {
    const { mesh } = newMesh();
    mesh.addPeerLink(new MockLink("a"));
    expect(() => {
      mesh.close();
      mesh.close();
    }).not.toThrow();
  });
});
