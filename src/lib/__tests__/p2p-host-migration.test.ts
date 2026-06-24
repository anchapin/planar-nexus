/**
 * Host Migration Tests — Issue #916
 *
 * Covers: deterministic successor selection, host-disconnect promotion,
 * state adoption, peer notification (idempotent apply), and clean
 * termination when no peers remain.
 */

import {
  HostMigrationManager,
  createHostMigrationManager,
  selectHostSuccessor,
  buildMigrationId,
  type HostMigrationMessage,
  type PeerRosterEntry,
  type HostMigrationResult,
} from '../p2p-host-migration';

const PEERS: PeerRosterEntry[] = [
  { playerId: 'host', playerName: 'Host', joinedAt: 100 },
  { playerId: 'alice', playerName: 'Alice', joinedAt: 200 },
  { playerId: 'bob', playerName: 'Bob', joinedAt: 300 },
  { playerId: 'carol', playerName: 'Carol', joinedAt: 400 },
];

describe('selectHostSuccessor', () => {
  it('excludes the leaving host', () => {
    expect(selectHostSuccessor(PEERS, 'host')).toBe('alice');
  });

  it('is deterministic regardless of input order', () => {
    const shuffled = [PEERS[3], PEERS[0], PEERS[2], PEERS[1]];
    expect(selectHostSuccessor(shuffled, 'host')).toBe('alice');
  });

  it('breaks ties on joinedAt by lexicographic playerId', () => {
    const sameTime: PeerRosterEntry[] = [
      { playerId: 'zoe', playerName: 'Z', joinedAt: 500 },
      { playerId: 'amy', playerName: 'A', joinedAt: 500 },
      { playerId: 'mike', playerName: 'M', joinedAt: 500 },
    ];
    expect(selectHostSuccessor(sameTime)).toBe('amy');
  });

  it('returns null when no candidates remain', () => {
    expect(selectHostSuccessor([PEERS[0]], 'host')).toBeNull();
    expect(selectHostSuccessor([], 'host')).toBeNull();
  });
});

describe('buildMigrationId', () => {
  it('produces a stable id for the same inputs', () => {
    const a = buildMigrationId('host', 'alice', ['alice', 'bob', 'carol']);
    const b = buildMigrationId('host', 'alice', ['alice', 'bob', 'carol']);
    expect(a).toBe(b);
    expect(a).toContain('host');
    expect(a).toContain('alice');
  });

  it('differs when the new host differs', () => {
    const a = buildMigrationId('host', 'alice', ['alice', 'bob']);
    const b = buildMigrationId('host', 'bob', ['bob', 'carol']);
    expect(a).not.toBe(b);
  });
});

describe('HostMigrationManager — successor promotion', () => {
  it('promotes the deterministic successor when the local client is it', () => {
    const promoted: HostMigrationResult[] = [];
    const changed: HostMigrationResult[] = [];

    const manager = new HostMigrationManager({
      localPlayerId: 'alice',
      initialHostId: 'host',
      initialPeers: PEERS,
      events: {
        onPromotedToHost: (r) => promoted.push(r),
        onHostChanged: (r) => changed.push(r),
      },
    });

    expect(manager.isLocalHost()).toBe(false);
    const result = manager.initiateMigration('host-disconnected');

    expect(result.terminated).toBe(false);
    expect(result.promotedSelf).toBe(true);
    expect(result.newHostId).toBe('alice');
    expect(result.previousHostId).toBe('host');
    expect(result.remainingPeers).toEqual(['alice', 'bob', 'carol']);
    expect(promoted).toHaveLength(1);
    expect(promoted[0].newHostId).toBe('alice');
    expect(changed).toHaveLength(0);
    expect(manager.isLocalHost()).toBe(true);
    expect(manager.getHostId()).toBe('alice');
  });

  it('does not promote when the local client is not the successor', () => {
    const promoted: HostMigrationResult[] = [];
    const manager = new HostMigrationManager({
      localPlayerId: 'bob',
      initialHostId: 'host',
      initialPeers: PEERS,
      events: { onPromotedToHost: (r) => promoted.push(r) },
    });

    const result = manager.initiateMigration('host-disconnected');

    // alice (earliest join) should be the computed successor, not bob.
    expect(result.newHostId).toBe('alice');
    expect(result.promotedSelf).toBe(false);
    expect(promoted).toHaveLength(0);
    // The local client must not have flipped its own authority.
    expect(manager.isLocalHost()).toBe(false);
  });

  it('removes the leaving host from the roster on migration', () => {
    const manager = new HostMigrationManager({
      localPlayerId: 'alice',
      initialHostId: 'host',
      initialPeers: PEERS,
    });
    manager.initiateMigration('host-disconnected');
    expect(manager.hasPeer('host')).toBe(false);
    expect(manager.getRoster().map((p) => p.playerId)).toEqual([
      'alice',
      'bob',
      'carol',
    ]);
  });
});

describe('HostMigrationManager — state adoption', () => {
  it('the promoted host adopts and broadcasts the last known game state', () => {
    const manager = new HostMigrationManager({
      localPlayerId: 'alice',
      initialHostId: 'host',
      initialPeers: PEERS,
    });
    const authoritativeState = { turn: 5, players: ['alice', 'bob', 'carol'] };
    manager.setLastKnownGameState(authoritativeState);

    const result = manager.initiateMigration('host-disconnected');
    const message = manager.buildMigrationMessage(result);

    expect(message.gameState).toBe(authoritativeState);
    expect(manager.getLastKnownGameState()).toBe(authoritativeState);
  });

  it('a follower adopts the authoritative state shipped by the new host', () => {
    const follower = new HostMigrationManager({
      localPlayerId: 'bob',
      initialHostId: 'host',
      initialPeers: PEERS,
    });

    const incomingState = { turn: 6 };
    const message: HostMigrationMessage = {
      type: 'host-migration',
      migrationId: buildMigrationId('host', 'alice', ['alice', 'bob', 'carol']),
      previousHostId: 'host',
      newHostId: 'alice',
      remainingPeers: ['alice', 'bob', 'carol'],
      gameState: incomingState,
      reason: 'host-disconnected',
      timestamp: Date.now(),
    };

    const result = follower.applyMigration(message);
    expect(result).not.toBeNull();
    expect(result?.newHostId).toBe('alice');
    expect(follower.getLastKnownGameState()).toBe(incomingState);
    expect(follower.getHostId()).toBe('alice');
    expect(follower.isLocalHost()).toBe(false);
  });
});

describe('HostMigrationManager — peer notification & idempotency', () => {
  it('applies a received migration message exactly once', () => {
    const changed: HostMigrationResult[] = [];
    const follower = new HostMigrationManager({
      localPlayerId: 'bob',
      initialHostId: 'host',
      initialPeers: PEERS,
      events: { onHostChanged: (r) => changed.push(r) },
    });

    const message: HostMigrationMessage = {
      type: 'host-migration',
      migrationId: 'mig-host-alice-alice,bob,carol',
      previousHostId: 'host',
      newHostId: 'alice',
      remainingPeers: ['alice', 'bob', 'carol'],
      gameState: null,
      reason: 'host-disconnected',
      timestamp: 1,
    };

    const first = follower.applyMigration(message);
    const second = follower.applyMigration(message); // duplicate

    expect(first).not.toBeNull();
    expect(second).toBeNull(); // idempotent no-op
    expect(changed).toHaveLength(1);
    expect(follower.getHostId()).toBe('alice');
  });

  it('ignores malformed messages', () => {
    const follower = new HostMigrationManager({
      localPlayerId: 'bob',
      initialHostId: 'host',
      initialPeers: PEERS,
    });
    expect(follower.applyMigration({ ...({} as any) })).toBeNull();
    expect(
      follower.applyMigration({ ...({ type: 'host-migration' } as any), migrationId: 'x' }),
    ).toBeNull();
    expect(follower.getHostId()).toBe('host');
  });

  it('promotes self when receiving a message naming the local client', () => {
    const promoted: HostMigrationResult[] = [];
    const local = new HostMigrationManager({
      localPlayerId: 'alice',
      initialHostId: 'host',
      initialPeers: PEERS,
      events: { onPromotedToHost: (r) => promoted.push(r) },
    });
    const message: HostMigrationMessage = {
      type: 'host-migration',
      migrationId: 'mig-host-alice-alice,bob,carol',
      previousHostId: 'host',
      newHostId: 'alice',
      remainingPeers: ['alice', 'bob', 'carol'],
      gameState: null,
      reason: 'host-left',
      timestamp: 1,
    };
    const result = local.applyMigration(message);
    expect(result?.promotedSelf).toBe(true);
    expect(promoted).toHaveLength(1);
    expect(local.isLocalHost()).toBe(true);
  });
});

describe('HostMigrationManager — clean termination', () => {
  it('terminates when not enough peers remain (1v1, opponent host leaves)', () => {
    const terminated: string[] = [];
    const manager = new HostMigrationManager({
      localPlayerId: 'alice',
      initialHostId: 'host',
      // Only the host and the local client.
      initialPeers: [
        { playerId: 'host', playerName: 'Host', joinedAt: 100 },
        { playerId: 'alice', playerName: 'Alice', joinedAt: 200 },
      ],
      events: { onTerminated: (reason) => terminated.push(reason) },
    });

    const result = manager.initiateMigration('host-left');
    expect(result.terminated).toBe(true);
    expect(result.newHostId).toBe('');
    expect(result.promotedSelf).toBe(false);
    expect(terminated).toHaveLength(1);
    expect(terminated[0]).toMatch(/not enough players/i);
    expect(manager.getStatus()).toBe('terminated');
  });

  it('continues when enough peers remain (3-player game, host leaves)', () => {
    const terminated: string[] = [];
    const manager = new HostMigrationManager({
      localPlayerId: 'alice',
      initialHostId: 'host',
      initialPeers: [
        { playerId: 'host', playerName: 'Host', joinedAt: 100 },
        { playerId: 'alice', playerName: 'Alice', joinedAt: 200 },
        { playerId: 'bob', playerName: 'Bob', joinedAt: 300 },
      ],
      events: { onTerminated: (r) => terminated.push(r) },
    });

    const result = manager.initiateMigration('host-disconnected');
    expect(result.terminated).toBe(false);
    expect(result.newHostId).toBe('alice');
    expect(terminated).toHaveLength(0);
  });

  it('respects a custom minPlayersToContinue threshold', () => {
    const manager = new HostMigrationManager({
      localPlayerId: 'alice',
      initialHostId: 'host',
      initialPeers: [
        { playerId: 'host', playerName: 'Host', joinedAt: 100 },
        { playerId: 'alice', playerName: 'Alice', joinedAt: 200 },
        { playerId: 'bob', playerName: 'Bob', joinedAt: 300 },
      ],
      minPlayersToContinue: 3,
    });
    const result = manager.initiateMigration('host-disconnected');
    expect(result.terminated).toBe(true);
  });
});

describe('HostMigrationManager — roster management', () => {
  it('upsertPeer / removePeer keep the roster in sync', () => {
    const manager = new HostMigrationManager({
      localPlayerId: 'alice',
      initialHostId: 'host',
      initialPeers: [PEERS[0], PEERS[1]],
    });
    manager.upsertPeer({ playerId: 'bob', playerName: 'Bob', joinedAt: 300 });
    expect(manager.hasPeer('bob')).toBe(true);
    manager.removePeer('bob');
    expect(manager.hasPeer('bob')).toBe(false);
  });

  it('computeSuccessor reflects live roster changes', () => {
    const manager = new HostMigrationManager({
      localPlayerId: 'carol',
      initialHostId: 'host',
      initialPeers: PEERS,
    });
    // alice drops before the host does.
    manager.removePeer('alice');
    expect(manager.computeSuccessor('host')).toBe('bob');
  });

  it('reset clears migration tracking', () => {
    const manager = new HostMigrationManager({
      localPlayerId: 'alice',
      initialHostId: 'host',
      initialPeers: PEERS,
    });
    manager.setLastKnownGameState({ x: 1 });
    manager.reset();
    expect(manager.getLastKnownGameState()).toBeNull();
    expect(manager.getStatus()).toBe('stable');
  });
});

describe('createHostMigrationManager factory', () => {
  it('creates a working manager instance', () => {
    const manager = createHostMigrationManager({
      localPlayerId: 'alice',
      initialHostId: 'host',
      initialPeers: PEERS,
    });
    expect(manager).toBeInstanceOf(HostMigrationManager);
    expect(manager.getHostId()).toBe('host');
  });
});

describe('End-to-end migration scenario', () => {
  it('successor broadcasts; followers apply; everyone agrees on the new host', () => {
    // Three clients with identical rosters.
    const successor = new HostMigrationManager({
      localPlayerId: 'alice',
      initialHostId: 'host',
      initialPeers: PEERS,
    });
    const followerBob = new HostMigrationManager({
      localPlayerId: 'bob',
      initialHostId: 'host',
      initialPeers: PEERS,
    });
    const followerCarol = new HostMigrationManager({
      localPlayerId: 'carol',
      initialHostId: 'host',
      initialPeers: PEERS,
    });

    // The host disconnects. Alice (successor) initiates and builds the message.
    successor.setLastKnownGameState({ turn: 9 });
    const result = successor.initiateMigration('host-disconnected');
    expect(result.promotedSelf).toBe(true);
    const message = successor.buildMigrationMessage(result);

    // Followers receive and apply the broadcast.
    const bobResult = followerBob.applyMigration(message);
    const carolResult = followerCarol.applyMigration(message);

    expect(bobResult?.newHostId).toBe('alice');
    expect(carolResult?.newHostId).toBe('alice');

    // Every peer now agrees on the new host and the adopted state.
    expect(successor.getHostId()).toBe('alice');
    expect(followerBob.getHostId()).toBe('alice');
    expect(followerCarol.getHostId()).toBe('alice');
    expect(followerBob.getLastKnownGameState()).toEqual({ turn: 9 });
    expect(followerCarol.getLastKnownGameState()).toEqual({ turn: 9 });

    // A duplicate delivery is a no-op.
    expect(followerBob.applyMigration(message)).toBeNull();
  });
});
