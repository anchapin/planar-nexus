/**
 * Host Migration Tests — Issue #916
 *
 * Covers: deterministic successor selection, host-disconnect promotion,
 * state adoption, peer notification (idempotent apply), and clean
 * termination when no peers remain.
 *
 * Issue #1567 — host-attested join sequence:
 *  Successor selection previously sorted by `joinedAt` (peer-self-reported),
 *  which a malicious peer could forge. These tests now drive `selectHostSuccessor`
 *  with a host-attested `joinSeq` (see {@link PeerRosterEntry.joinSeq}) and
 *  assert that a peer claiming `joinedAt: 0` cannot steal succession when its
 *  `joinSeq` is larger than the legitimate successor's.
 */

import {
  HostMigrationManager,
  createHostMigrationManager,
  selectHostSuccessor,
  buildMigrationId,
  type HostMigrationMessage,
  type PeerRosterEntry,
  type HostMigrationResult,
} from "../p2p-host-migration";

const PEERS: PeerRosterEntry[] = [
  { playerId: "host", playerName: "Host", joinedAt: 100, joinSeq: 0 },
  { playerId: "alice", playerName: "Alice", joinedAt: 200, joinSeq: 1 },
  { playerId: "bob", playerName: "Bob", joinedAt: 300, joinSeq: 2 },
  { playerId: "carol", playerName: "Carol", joinedAt: 400, joinSeq: 3 },
];

describe("selectHostSuccessor", () => {
  it("excludes the leaving host", () => {
    expect(selectHostSuccessor(PEERS, "host")).toBe("alice");
  });

  it("is deterministic regardless of input order", () => {
    const shuffled = [PEERS[3], PEERS[0], PEERS[2], PEERS[1]];
    expect(selectHostSuccessor(shuffled, "host")).toBe("alice");
  });

  it("breaks ties on joinSeq by lexicographic playerId", () => {
    // Issue #1567 — the comparator now reads `joinSeq`, not `joinedAt`.
    const sameSeq: PeerRosterEntry[] = [
      { playerId: "zoe", playerName: "Z", joinedAt: 500, joinSeq: 7 },
      { playerId: "amy", playerName: "A", joinedAt: 500, joinSeq: 7 },
      { playerId: "mike", playerName: "M", joinedAt: 500, joinSeq: 7 },
    ];
    expect(selectHostSuccessor(sameSeq)).toBe("amy");
  });

  it("returns null when no candidates remain", () => {
    expect(selectHostSuccessor([PEERS[0]], "host")).toBeNull();
    expect(selectHostSuccessor([], "host")).toBeNull();
  });

  // Issue #1567 — security property: a peer that self-reports a forged
  // `joinedAt: 0` cannot seize succession when its host-attested `joinSeq`
  // is larger than the legitimate successor's. This is the threat model
  // the new field neutralises.
  it("ignores peer-self-reported joinedAt when joinSeq is authoritative (lying peer test)", () => {
    const lying: PeerRosterEntry[] = [
      // Alice is the legitimate earliest joiner (joinSeq 1).
      { playerId: "alice", playerName: "Alice", joinedAt: 200, joinSeq: 1 },
      // Bob lies about joinedAt to claim the earliest arrival, but the
      // host assigned him joinSeq 5 — much later than Alice's. He MUST
      // not win.
      {
        playerId: "bob",
        playerName: "Bob",
        joinedAt: 0,
        joinSeq: 5,
      },
    ];
    expect(selectHostSuccessor(lying, "host")).toBe("alice");
  });

  // Issue #1567 — the explicit acceptance-criterion scenario from the
  // issue body: A reports joinedAt=0/joinSeq=5, B reports joinedAt=very-
  // large/joinSeq=2. B wins because `joinSeq` dominates.
  it("selects the peer with the lower joinSeq even when joinedAt claims otherwise", () => {
    const peers: PeerRosterEntry[] = [
      {
        playerId: "a",
        playerName: "A",
        joinedAt: 0,
        joinSeq: 5,
      },
      {
        playerId: "b",
        playerName: "B",
        joinedAt: 9999999999999,
        joinSeq: 2,
      },
    ];
    expect(selectHostSuccessor(peers, "host")).toBe("b");
  });

  // Belt-and-suspenders: four peers in a mesh, one lies about joinedAt.
  // The legitimate earliest joiner must still be chosen.
  it("honest peers use joinSeq; lying peers are ignored (4-player mesh)", () => {
    const peers: PeerRosterEntry[] = [
      { playerId: "host", playerName: "Host", joinedAt: 100, joinSeq: 0 },
      { playerId: "alice", playerName: "Alice", joinedAt: 200, joinSeq: 1 },
      { playerId: "bob", playerName: "Bob", joinedAt: 300, joinSeq: 2 },
      // Carol lies about joinedAt, claims joinSeq 99 (no one else has
      // touched that) but host gave her 5. She MUST not win over alice.
      {
        playerId: "carol",
        playerName: "Carol",
        joinedAt: 0,
        joinSeq: 5,
      },
    ];
    expect(selectHostSuccessor(peers, "host")).toBe("alice");
  });

  it("uses joinSeq and never reads joinedAt for ordering", () => {
    // Pure unit-test of the comparator: a peer with the smallest
    // joinedAt but the largest joinSeq is placed last; a peer with
    // the largest joinedAt but the smallest joinSeq is placed first.
    const peers: PeerRosterEntry[] = [
      {
        playerId: "first",
        playerName: "First",
        joinedAt: Number.MAX_SAFE_INTEGER,
        joinSeq: 0,
      },
      {
        playerId: "middle",
        playerName: "Middle",
        joinedAt: 1,
        joinSeq: 1,
      },
      {
        playerId: "last",
        playerName: "Last",
        joinedAt: 0,
        joinSeq: 2,
      },
    ];
    const ordered = [...peers].sort((a, b) => {
      if (a.joinSeq !== b.joinSeq) return a.joinSeq - b.joinSeq;
      return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
    });
    expect(ordered.map((p) => p.playerId)).toEqual(["first", "middle", "last"]);
    expect(selectHostSuccessor(peers, "host")).toBe("first");
  });
});

describe("buildMigrationId", () => {
  it("produces a stable id for the same inputs", () => {
    const a = buildMigrationId("host", "alice", ["alice", "bob", "carol"]);
    const b = buildMigrationId("host", "alice", ["alice", "bob", "carol"]);
    expect(a).toBe(b);
    expect(a).toContain("host");
    expect(a).toContain("alice");
  });

  it("differs when the new host differs", () => {
    const a = buildMigrationId("host", "alice", ["alice", "bob"]);
    const b = buildMigrationId("host", "bob", ["bob", "carol"]);
    expect(a).not.toBe(b);
  });
});

describe("HostMigrationManager — successor promotion", () => {
  it("promotes the deterministic successor when the local client is it", () => {
    const promoted: HostMigrationResult[] = [];
    const changed: HostMigrationResult[] = [];

    const manager = new HostMigrationManager({
      localPlayerId: "alice",
      initialHostId: "host",
      initialPeers: PEERS,
      events: {
        onPromotedToHost: (r) => promoted.push(r),
        onHostChanged: (r) => changed.push(r),
      },
    });

    expect(manager.isLocalHost()).toBe(false);
    const result = manager.initiateMigration("host-disconnected");

    expect(result.terminated).toBe(false);
    expect(result.promotedSelf).toBe(true);
    expect(result.newHostId).toBe("alice");
    expect(result.previousHostId).toBe("host");
    expect(result.remainingPeers).toEqual(["alice", "bob", "carol"]);
    expect(promoted).toHaveLength(1);
    expect(promoted[0].newHostId).toBe("alice");
    expect(changed).toHaveLength(0);
    expect(manager.isLocalHost()).toBe(true);
    expect(manager.getHostId()).toBe("alice");
  });

  it("does not promote when the local client is not the successor", () => {
    const promoted: HostMigrationResult[] = [];
    const manager = new HostMigrationManager({
      localPlayerId: "bob",
      initialHostId: "host",
      initialPeers: PEERS,
      events: { onPromotedToHost: (r) => promoted.push(r) },
    });

    const result = manager.initiateMigration("host-disconnected");

    // alice (earliest join) should be the computed successor, not bob.
    expect(result.newHostId).toBe("alice");
    expect(result.promotedSelf).toBe(false);
    expect(promoted).toHaveLength(0);
    // The local client must not have flipped its own authority.
    expect(manager.isLocalHost()).toBe(false);
  });

  it("removes the leaving host from the roster on migration", () => {
    const manager = new HostMigrationManager({
      localPlayerId: "alice",
      initialHostId: "host",
      initialPeers: PEERS,
    });
    manager.initiateMigration("host-disconnected");
    expect(manager.hasPeer("host")).toBe(false);
    expect(manager.getRoster().map((p) => p.playerId)).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
  });
});

describe("HostMigrationManager — state adoption", () => {
  it("the promoted host adopts and broadcasts the last known game state", () => {
    const manager = new HostMigrationManager({
      localPlayerId: "alice",
      initialHostId: "host",
      initialPeers: PEERS,
    });
    const authoritativeState = { turn: 5, players: ["alice", "bob", "carol"] };
    manager.setLastKnownGameState(authoritativeState);

    const result = manager.initiateMigration("host-disconnected");
    const message = manager.buildMigrationMessage(result);

    expect(message.gameState).toBe(authoritativeState);
    expect(manager.getLastKnownGameState()).toBe(authoritativeState);
  });

  it("a follower adopts the authoritative state shipped by the new host", () => {
    const follower = new HostMigrationManager({
      localPlayerId: "bob",
      initialHostId: "host",
      initialPeers: PEERS,
    });

    const incomingState = { turn: 6 };
    const message: HostMigrationMessage = {
      type: "host-migration",
      migrationId: buildMigrationId("host", "alice", ["alice", "bob", "carol"]),
      previousHostId: "host",
      newHostId: "alice",
      remainingPeers: ["alice", "bob", "carol"],
      gameState: incomingState,
      reason: "host-disconnected",
      timestamp: Date.now(),
    };

    const result = follower.applyMigration(message);
    expect(result).not.toBeNull();
    expect(result?.newHostId).toBe("alice");
    expect(follower.getLastKnownGameState()).toBe(incomingState);
    expect(follower.getHostId()).toBe("alice");
    expect(follower.isLocalHost()).toBe(false);
  });
});

describe("HostMigrationManager — peer notification & idempotency", () => {
  it("applies a received migration message exactly once", () => {
    const changed: HostMigrationResult[] = [];
    const follower = new HostMigrationManager({
      localPlayerId: "bob",
      initialHostId: "host",
      initialPeers: PEERS,
      events: { onHostChanged: (r) => changed.push(r) },
    });

    const message: HostMigrationMessage = {
      type: "host-migration",
      migrationId: "mig-host-alice-alice,bob,carol",
      previousHostId: "host",
      newHostId: "alice",
      remainingPeers: ["alice", "bob", "carol"],
      gameState: null,
      reason: "host-disconnected",
      timestamp: 1,
    };

    const first = follower.applyMigration(message);
    const second = follower.applyMigration(message); // duplicate

    expect(first).not.toBeNull();
    expect(second).toBeNull(); // idempotent no-op
    expect(changed).toHaveLength(1);
    expect(follower.getHostId()).toBe("alice");
  });

  it("ignores malformed messages", () => {
    const follower = new HostMigrationManager({
      localPlayerId: "bob",
      initialHostId: "host",
      initialPeers: PEERS,
    });
    expect(follower.applyMigration({ ...({} as any) })).toBeNull();
    expect(
      follower.applyMigration({
        ...({ type: "host-migration" } as any),
        migrationId: "x",
      }),
    ).toBeNull();
    expect(follower.getHostId()).toBe("host");
  });

  it("promotes self when receiving a message naming the local client", () => {
    const promoted: HostMigrationResult[] = [];
    const local = new HostMigrationManager({
      localPlayerId: "alice",
      initialHostId: "host",
      initialPeers: PEERS,
      events: { onPromotedToHost: (r) => promoted.push(r) },
    });
    const message: HostMigrationMessage = {
      type: "host-migration",
      migrationId: "mig-host-alice-alice,bob,carol",
      previousHostId: "host",
      newHostId: "alice",
      remainingPeers: ["alice", "bob", "carol"],
      gameState: null,
      reason: "host-left",
      timestamp: 1,
    };
    const result = local.applyMigration(message);
    expect(result?.promotedSelf).toBe(true);
    expect(promoted).toHaveLength(1);
    expect(local.isLocalHost()).toBe(true);
  });
});

describe("HostMigrationManager — clean termination", () => {
  it("terminates when not enough peers remain (1v1, opponent host leaves)", () => {
    const terminated: string[] = [];
    const manager = new HostMigrationManager({
      localPlayerId: "alice",
      initialHostId: "host",
      // Only the host and the local client.
      initialPeers: [
        { playerId: "host", playerName: "Host", joinedAt: 100, joinSeq: 0 },
        { playerId: "alice", playerName: "Alice", joinedAt: 200, joinSeq: 1 },
      ],
      events: { onTerminated: (reason) => terminated.push(reason) },
    });

    const result = manager.initiateMigration("host-left");
    expect(result.terminated).toBe(true);
    expect(result.newHostId).toBe("");
    expect(result.promotedSelf).toBe(false);
    expect(terminated).toHaveLength(1);
    expect(terminated[0]).toMatch(/not enough players/i);
    expect(manager.getStatus()).toBe("terminated");
  });

  it("continues when enough peers remain (3-player game, host leaves)", () => {
    const terminated: string[] = [];
    const manager = new HostMigrationManager({
      localPlayerId: "alice",
      initialHostId: "host",
      initialPeers: [
        { playerId: "host", playerName: "Host", joinedAt: 100, joinSeq: 0 },
        { playerId: "alice", playerName: "Alice", joinedAt: 200, joinSeq: 1 },
        { playerId: "bob", playerName: "Bob", joinedAt: 300, joinSeq: 2 },
      ],
      events: { onTerminated: (r) => terminated.push(r) },
    });

    const result = manager.initiateMigration("host-disconnected");
    expect(result.terminated).toBe(false);
    expect(result.newHostId).toBe("alice");
    expect(terminated).toHaveLength(0);
  });

  it("respects a custom minPlayersToContinue threshold", () => {
    const manager = new HostMigrationManager({
      localPlayerId: "alice",
      initialHostId: "host",
      initialPeers: [
        { playerId: "host", playerName: "Host", joinedAt: 100, joinSeq: 0 },
        { playerId: "alice", playerName: "Alice", joinedAt: 200, joinSeq: 1 },
        { playerId: "bob", playerName: "Bob", joinedAt: 300, joinSeq: 2 },
      ],
      minPlayersToContinue: 3,
    });
    const result = manager.initiateMigration("host-disconnected");
    expect(result.terminated).toBe(true);
  });
});

describe("HostMigrationManager — roster management", () => {
  it("upsertPeer / removePeer keep the roster in sync", () => {
    const manager = new HostMigrationManager({
      localPlayerId: "alice",
      initialHostId: "host",
      initialPeers: [PEERS[0], PEERS[1]],
    });
    manager.upsertPeer({
      playerId: "bob",
      playerName: "Bob",
      joinedAt: 300,
      joinSeq: 2,
    });
    expect(manager.hasPeer("bob")).toBe(true);
    manager.removePeer("bob");
    expect(manager.hasPeer("bob")).toBe(false);
  });

  it("computeSuccessor reflects live roster changes", () => {
    const manager = new HostMigrationManager({
      localPlayerId: "carol",
      initialHostId: "host",
      initialPeers: PEERS,
    });
    // alice drops before the host does.
    manager.removePeer("alice");
    expect(manager.computeSuccessor("host")).toBe("bob");
  });

  it("reset clears migration tracking", () => {
    const manager = new HostMigrationManager({
      localPlayerId: "alice",
      initialHostId: "host",
      initialPeers: PEERS,
    });
    manager.setLastKnownGameState({ x: 1 });
    manager.reset();
    expect(manager.getLastKnownGameState()).toBeNull();
    expect(manager.getStatus()).toBe("stable");
  });
});

describe("createHostMigrationManager factory", () => {
  it("creates a working manager instance", () => {
    const manager = createHostMigrationManager({
      localPlayerId: "alice",
      initialHostId: "host",
      initialPeers: PEERS,
    });
    expect(manager).toBeInstanceOf(HostMigrationManager);
    expect(manager.getHostId()).toBe("host");
  });
});

describe("End-to-end migration scenario", () => {
  it("successor broadcasts; followers apply; everyone agrees on the new host", () => {
    // Three clients with identical rosters.
    const successor = new HostMigrationManager({
      localPlayerId: "alice",
      initialHostId: "host",
      initialPeers: PEERS,
    });
    const followerBob = new HostMigrationManager({
      localPlayerId: "bob",
      initialHostId: "host",
      initialPeers: PEERS,
    });
    const followerCarol = new HostMigrationManager({
      localPlayerId: "carol",
      initialHostId: "host",
      initialPeers: PEERS,
    });

    // The host disconnects. Alice (successor) initiates and builds the message.
    successor.setLastKnownGameState({ turn: 9 });
    const result = successor.initiateMigration("host-disconnected");
    expect(result.promotedSelf).toBe(true);
    const message = successor.buildMigrationMessage(result);

    // Followers receive and apply the broadcast.
    const bobResult = followerBob.applyMigration(message);
    const carolResult = followerCarol.applyMigration(message);

    expect(bobResult?.newHostId).toBe("alice");
    expect(carolResult?.newHostId).toBe("alice");

    // Every peer now agrees on the new host and the adopted state.
    expect(successor.getHostId()).toBe("alice");
    expect(followerBob.getHostId()).toBe("alice");
    expect(followerCarol.getHostId()).toBe("alice");
    expect(followerBob.getLastKnownGameState()).toEqual({ turn: 9 });
    expect(followerCarol.getLastKnownGameState()).toEqual({ turn: 9 });

    // A duplicate delivery is a no-op.
    expect(followerBob.applyMigration(message)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Issue #1567 — host-attested join sequence tests
// ---------------------------------------------------------------------------

describe("HostMigrationManager — host-attested join sequence (issue #1567)", () => {
  it("initialPeers drive the nextJoinSeq counter past the maximum", () => {
    const manager = new HostMigrationManager({
      localPlayerId: "host",
      initialHostId: "host",
      initialPeers: [
        { playerId: "host", playerName: "Host", joinedAt: 100, joinSeq: 0 },
        { playerId: "alice", playerName: "Alice", joinedAt: 200, joinSeq: 1 },
        { playerId: "bob", playerName: "Bob", joinedAt: 300, joinSeq: 7 },
      ],
    });
    // Counter is advanced past the seeded max (7), so the next minted
    // sequence must be 8 — never reusing bob's 7.
    expect(manager.peekNextJoinSeq()).toBe(8);
    const next = manager.assignNextJoinSeq("carol", "Carol");
    expect(next.joinSeq).toBe(8);
  });

  it("assignNextJoinSeq is strictly monotonic across multiple admits", () => {
    const manager = new HostMigrationManager({
      localPlayerId: "host",
      initialHostId: "host",
      initialPeers: [
        { playerId: "host", playerName: "Host", joinedAt: 100, joinSeq: 0 },
      ],
    });
    const a = manager.assignNextJoinSeq("alice", "Alice");
    const b = manager.assignNextJoinSeq("bob", "Bob");
    const c = manager.assignNextJoinSeq("carol", "Carol");
    expect([a.joinSeq, b.joinSeq, c.joinSeq]).toEqual([1, 2, 3]);
  });

  it("assignNextJoinSeq records the entry in the roster", () => {
    const manager = new HostMigrationManager({
      localPlayerId: "host",
      initialHostId: "host",
      initialPeers: [
        { playerId: "host", playerName: "Host", joinedAt: 100, joinSeq: 0 },
      ],
    });
    const entry = manager.assignNextJoinSeq("alice", "Alice");
    expect(manager.hasPeer("alice")).toBe(true);
    const rostered = manager.getRoster().find((p) => p.playerId === "alice");
    expect(rostered).toBeDefined();
    expect(rostered?.joinSeq).toBe(entry.joinSeq);
    expect(rostered?.joinedAt).toBe(entry.joinedAt);
  });

  it("seedHostJoinSeq assigns joinSeq 0 to the original host", () => {
    const manager = new HostMigrationManager({
      localPlayerId: "host",
      initialHostId: "host",
      initialPeers: [],
    });
    expect(manager.hasPeer("host")).toBe(false);
    manager.seedHostJoinSeq("Host");
    const host = manager.getRoster().find((p) => p.playerId === "host");
    expect(host).toBeDefined();
    expect(host?.joinSeq).toBe(0);
    // And the counter advances so the next peer gets joinSeq 1.
    expect(manager.peekNextJoinSeq()).toBe(1);
  });

  it("seedHostJoinSeq is idempotent when the host is already in the roster", () => {
    const manager = new HostMigrationManager({
      localPlayerId: "host",
      initialHostId: "host",
      initialPeers: [
        { playerId: "host", playerName: "Host", joinedAt: 100, joinSeq: 0 },
      ],
    });
    manager.seedHostJoinSeq("Host");
    // The pre-seeded entry (joinSeq 0) is preserved; the counter does not
    // double-advance past it.
    expect(manager.peekNextJoinSeq()).toBe(1);
  });

  it("recordHostJoinSeq updates an existing peer with the host-attested sequence", () => {
    const manager = new HostMigrationManager({
      localPlayerId: "host",
      initialHostId: "host",
      initialPeers: [
        { playerId: "host", playerName: "Host", joinedAt: 100, joinSeq: 0 },
      ],
    });
    // The follower learned about alice via player-joined and tentatively
    // assigned a placeholder joinSeq; the host's roster-assignment
    // broadcast updates it to the authoritative value.
    manager.upsertPeer({
      playerId: "alice",
      playerName: "Alice",
      joinedAt: 999_999_999_999,
      joinSeq: Number.MAX_SAFE_INTEGER,
    });
    manager.recordHostJoinSeq("alice", 1);
    const alice = manager.getRoster().find((p) => p.playerId === "alice");
    expect(alice?.joinSeq).toBe(1);
  });

  it("recordHostJoinSeq creates a placeholder entry for an unknown peer", () => {
    const manager = new HostMigrationManager({
      localPlayerId: "host",
      initialHostId: "host",
      initialPeers: [
        { playerId: "host", playerName: "Host", joinedAt: 100, joinSeq: 0 },
      ],
    });
    manager.recordHostJoinSeq("alice", 1);
    const alice = manager.getRoster().find((p) => p.playerId === "alice");
    expect(alice).toBeDefined();
    expect(alice?.joinSeq).toBe(1);
  });

  it("recordHostJoinSeq advances the counter so subsequent host mints stay unique", () => {
    const manager = new HostMigrationManager({
      localPlayerId: "host",
      initialHostId: "host",
      initialPeers: [
        { playerId: "host", playerName: "Host", joinedAt: 100, joinSeq: 0 },
      ],
    });
    manager.recordHostJoinSeq("alice", 5);
    // The follower bumped its counter past 5; the host's next mint is 6.
    expect(manager.peekNextJoinSeq()).toBe(6);
  });

  it("selectHostSuccessor uses joinSeq even when peer claims joinedAt 0 (issue acceptance)", () => {
    // The exact scenario from the issue body: A reports joinedAt 0 /
    // joinSeq 5, B reports joinedAt huge / joinSeq 2.
    const peers: PeerRosterEntry[] = [
      { playerId: "a", playerName: "A", joinedAt: 0, joinSeq: 5 },
      {
        playerId: "b",
        playerName: "B",
        joinedAt: 9999999999999,
        joinSeq: 2,
      },
    ];
    expect(selectHostSuccessor(peers, "host")).toBe("b");
  });

  it("computeSuccessor ignores joinedAt and follows joinSeq", () => {
    // Real integration test: a malicious peer sets joinedAt: 0 in its own
    // upsertPeer call, but its host-attested joinSeq is larger than
    // alice's. The manager's computeSuccessor (which uses the internal
    // peersList) must still pick alice.
    const manager = new HostMigrationManager({
      localPlayerId: "host",
      initialHostId: "host",
      initialPeers: [
        { playerId: "host", playerName: "Host", joinedAt: 100, joinSeq: 0 },
        { playerId: "alice", playerName: "Alice", joinedAt: 200, joinSeq: 1 },
        {
          playerId: "bob",
          playerName: "Bob",
          joinedAt: 0, // bob lies
          joinSeq: 5, // host-attested: bob joined later
        },
      ],
    });
    expect(manager.computeSuccessor("host")).toBe("alice");
  });

  it("peersList orders by joinSeq asc, not joinedAt asc", () => {
    const manager = new HostMigrationManager({
      localPlayerId: "host",
      initialHostId: "host",
      initialPeers: [
        // Pre-seed in reverse-joinSeq order to prove the comparator, not
        // insertion, drives the snapshot.
        { playerId: "late", playerName: "Late", joinedAt: 0, joinSeq: 9 },
        { playerId: "mid", playerName: "Mid", joinedAt: 0, joinSeq: 5 },
        { playerId: "early", playerName: "Early", joinedAt: 999, joinSeq: 2 },
      ],
    });
    expect(manager.getRoster().map((p) => p.playerId)).toEqual([
      "early",
      "mid",
      "late",
    ]);
  });

  it("initiateMigration uses joinSeq for successor selection (successor announcement order)", () => {
    // The HostMigrationResult.remainingPeers array is the canonical order
    // that flows into the wire — issue #1567 must preserve joinSeq order
    // even when peers' joinedAt claims disagree.
    const manager = new HostMigrationManager({
      localPlayerId: "host",
      initialHostId: "host",
      initialPeers: [
        { playerId: "host", playerName: "Host", joinedAt: 100, joinSeq: 0 },
        { playerId: "alice", playerName: "Alice", joinedAt: 200, joinSeq: 1 },
        { playerId: "bob", playerName: "Bob", joinedAt: 0, joinSeq: 2 }, // lies
      ],
    });
    const result = manager.initiateMigration("host-disconnected");
    expect(result.remainingPeers).toEqual(["alice", "bob"]);
  });
});
