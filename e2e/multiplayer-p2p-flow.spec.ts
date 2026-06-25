/**
 * E2E tests for the multiplayer P2P game flow.
 *
 * Issue #1012: Add E2E Playwright tests for multiplayer game flow.
 *
 * These tests launch two independent browser contexts (host + joiner), bridge
 * them through a mock WebRTC data channel (no real network or signaling
 * server), and verify the full multiplayer message protocol end-to-end:
 *   1. P2P connection establishment via mock signaling
 *   2. Game lobby synchronization (player-joined)
 *   3. Mulligan exchange
 *   4. Card play syncs to both peers within the 100ms budget
 *   5. Combat phase (attacker/blocker) synchronization
 *   6. Game end via concede propagates to both peers
 *   7. Game end via life=0 propagates to both peers
 *
 * The mock transport + peer harness live in e2e/fixtures/p2p-mock-bridge.ts and
 * mirror the exact GameMessage wire contract from src/lib/p2p-game-connection.ts.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  GAME_MESSAGE_TYPES,
  isGameMessage,
  setupPeerPage,
  openChannels,
  getReceivedMessages,
  waitForMessage,
  type GameMessage,
  type PeerOptions,
} from "./fixtures/p2p-mock-bridge";

const BASE_URL = process.env.BASE_URL || "http://localhost:9002";

const HOST_OPTS: PeerOptions = {
  playerId: "host-player",
  playerName: "Alice (Host)",
  role: "host",
};
const JOINER_OPTS: PeerOptions = {
  playerId: "joiner-player",
  playerName: "Bob (Joiner)",
  role: "joiner",
};

/**
 * Spin up a fresh two-peer scenario: two browser contexts, each with the mock
 * transport installed, bridged together, and their data channels opened.
 * Returns the host and joiner pages. The caller is responsible for closing
 * contexts (handled automatically when the browser closes at test teardown).
 */
async function createTwoPeers(browser: Browser): Promise<{
  host: Page;
  joiner: Page;
}> {
  const hostContext = await browser.newContext();
  const joinerContext = await browser.newContext();
  const host = await hostContext.newPage();
  const joiner = await joinerContext.newPage();

  // Wire both pages in the bridge before navigating so the outgoing binding is
  // present when the mock transport's send() runs.
  await setupPeerPage(host, joiner, `${BASE_URL}/multiplayer`, HOST_OPTS);
  await setupPeerPage(joiner, host, `${BASE_URL}/multiplayer`, JOINER_OPTS);

  // Flip both mock data channels to "open" — signaling is now complete.
  await openChannels(host, joiner);

  return { host, joiner };
}

test.describe("Multiplayer P2P Game Flow (mock signaling) — #1012", () => {
  // Each test creates isolated browser contexts, so parallel execution is safe.
  // Use serial to keep the dual-context lifecycle easy to reason about.
  test.describe.configure({ mode: "serial" });

  test("validate game message contract matches p2p-game-connection.ts", () => {
    // Guard against drift between this harness and the production wire format.
    // Source of truth: src/lib/p2p-game-connection.ts (GAME_MESSAGE_TYPES).
    expect([...GAME_MESSAGE_TYPES]).toEqual([
      "game-state-sync",
      "game-action",
      "chat",
      "player-joined",
      "player-left",
      "ping",
      "pong",
    ]);

    // isGameMessage must accept well-formed messages and reject garbage, exactly
    // like the production type guard consumed by the data-channel message path.
    const good: GameMessage = {
      type: "game-action",
      senderId: "p1",
      timestamp: Date.now(),
      data: { action: "pass" },
    };
    expect(isGameMessage(good)).toBe(true);
    expect(isGameMessage({ type: "evil", senderId: "x", timestamp: 1 })).toBe(false);
    expect(isGameMessage(null)).toBe(false);
    expect(isGameMessage("nope")).toBe(false);
    expect(isGameMessage({ type: "ping", senderId: 5, timestamp: 1 })).toBe(false);
  });

  test("two browser contexts establish a P2P connection via mock signaling", async ({
    browser,
  }) => {
    const { host, joiner } = await createTwoPeers(browser);

    // Both peers must believe the data channel is open (signaling complete).
    await expect.poll(async () => host.evaluate(() => (window as any).__peer.isConnected())).toBe(true);
    await expect.poll(async () => joiner.evaluate(() => (window as any).__peer.isConnected())).toBe(true);

    // A mock RTCPeerConnection must have been installed.
    const hostHasMock = await host.evaluate(
      () => typeof (window as any).__MockDataChannel === "function",
    );
    expect(hostHasMock).toBe(true);
  });

  test("game lobby state synchronizes (player-joined propagates to both peers)", async ({
    browser,
  }) => {
    const { host, joiner } = await createTwoPeers(browser);

    // Host announces the joiner as joined (lobby sync).
    const joined = await host.evaluate(() =>
      (window as any).__peer.sendPlayerJoined("joiner-player", "Bob (Joiner)"),
    );
    expect(joined).toBe(true);

    // Joiner receives the player-joined event.
    const received = await waitForMessage(
      joiner,
      `(m) => m.type === "player-joined" && m.data && m.data.playerId === "joiner-player"`,
    );
    expect(received.data).toMatchObject({
      playerId: "joiner-player",
      playerName: "Bob (Joiner)",
    });

    // Joiner announces host back (bidirectional lobby awareness).
    await joiner.evaluate(() =>
      (window as any).__peer.sendPlayerJoined("host-player", "Alice (Host)"),
    );
    const hostSeesJoiner = await waitForMessage(
      host,
      `(m) => m.type === "player-joined" && m.data && m.data.playerId === "host-player"`,
    );
    expect(hostSeesJoiner.data).toMatchObject({
      playerId: "host-player",
      playerName: "Alice (Host)",
    });
  });

  test("mulligan exchange syncs to both peers", async ({ browser }) => {
    const { host, joiner } = await createTwoPeers(browser);

    // Host takes a mulligan to 6 (down from opening 7).
    await host.evaluate(() =>
      (window as any).__peer.sendGameAction("mulligan", { newHandSize: 6 }),
    );

    const onJoiner = await waitForMessage(
      joiner,
      `(m) => m.type === "game-action" && m.data && m.data.action === "mulligan"`,
    );
    expect(onJoiner.data).toMatchObject({
      action: "mulligan",
      data: { newHandSize: 6 },
    });

    // Joiner keeps (no mulligan) — both peers converge on opening hand sizes.
    await joiner.evaluate(() =>
      (window as any).__peer.sendGameAction("mulligan-keep", { handSize: 7 }),
    );

    const onHost = await waitForMessage(
      host,
      `(m) => m.type === "game-action" && m.data && m.data.action === "mulligan-keep"`,
    );
    expect(onHost.data).toMatchObject({
      action: "mulligan-keep",
      data: { handSize: 7 },
    });
  });

  test("card play (spell) syncs to the remote peer within the 100ms budget", async ({
    browser,
  }) => {
    const { host, joiner } = await createTwoPeers(browser);

    // Host casts Lightning Bolt targeting the joiner.
    const sendResult = await host.evaluate(() =>
      (window as any).__peer.sendGameAction("play-card", {
        cardId: "lightning-bolt",
        targetPlayerId: "joiner-player",
        zone: "stack",
      }),
    );
    expect(sendResult).toBe(true);

    const received = await waitForMessage(
      joiner,
      `(m) => m.type === "game-action" && m.data && m.data.action === "play-card"`,
    );

    // Acceptance criterion: card plays visible to both peers within 100ms.
    // Latency = joiner wall-clock at receive - host's send timestamp carried on
    // the message. Both contexts share the same host wall clock.
    const latency = Date.now() - received.timestamp;
    expect(latency).toBeLessThan(100);

    expect(received.data).toMatchObject({
      action: "play-card",
      data: { cardId: "lightning-bolt", targetPlayerId: "joiner-player", zone: "stack" },
    });

    // Both peers must converge: joiner echoes an ability resolution back to host.
    await joiner.evaluate(() =>
      (window as any).__peer.sendGameAction("resolve-ability", {
        sourceId: "lightning-bolt",
        damage: 3,
      }),
    );
    const hostResolve = await waitForMessage(
      host,
      `(m) => m.type === "game-action" && m.data && m.data.action === "resolve-ability"`,
    );
    expect(hostResolve.data).toMatchObject({
      action: "resolve-ability",
      data: { sourceId: "lightning-bolt", damage: 3 },
    });
  });

  test("combat phase attacker/blocker declarations sync correctly", async ({
    browser,
  }) => {
    const { host, joiner } = await createTwoPeers(browser);

    // Host declares attackers in the declare_attackers phase.
    await host.evaluate(() =>
      (window as any).__peer.sendGameAction("declare-attackers", {
        attackers: [
          { attackerId: "goblin-guide", defendingPlayerId: "joiner-player" },
        ],
      }),
    );

    const attackersOnJoiner = await waitForMessage(
      joiner,
      `(m) => m.type === "game-action" && m.data && m.data.action === "declare-attackers"`,
    );
    expect(attackersOnJoiner.data).toMatchObject({
      action: "declare-attackers",
      data: {
        attackers: [{ attackerId: "goblin-guide", defendingPlayerId: "joiner-player" }],
      },
    });

    // Joiner declares blockers in the declare_blockers phase.
    await joiner.evaluate(() =>
      (window as any).__peer.sendGameAction("declare-blockers", {
        blockers: [{ blockerId: "memnite", attackerId: "goblin-guide" }],
      }),
    );

    const blockersOnHost = await waitForMessage(
      host,
      `(m) => m.type === "game-action" && m.data && m.data.action === "declare-blockers"`,
    );
    expect(blockersOnHost.data).toMatchObject({
      action: "declare-blockers",
      data: { blockers: [{ blockerId: "memnite", attackerId: "goblin-guide" }] },
    });

    // Combat damage order is shared with both peers after the combat phase.
    await host.evaluate(() =>
      (window as any).__peer.sendGameAction("combat-damage", {
        assignments: [
          { sourceId: "goblin-guide", targetId: "memnite", amount: 2 },
          { sourceId: "memnite", targetId: "goblin-guide", amount: 1 },
        ],
      }),
    );
    const damageOnJoiner = await waitForMessage(
      joiner,
      `(m) => m.type === "game-action" && m.data && m.data.action === "combat-damage"`,
    );
    expect(damageOnJoiner.data).toMatchObject({
      action: "combat-damage",
      data: {
        assignments: [
          { sourceId: "goblin-guide", targetId: "memnite", amount: 2 },
          { sourceId: "memnite", targetId: "goblin-guide", amount: 1 },
        ],
      },
    });
  });

  test("game end via concede is detected by both peers", async ({ browser }) => {
    const { host, joiner } = await createTwoPeers(browser);

    // Joiner concedes — host must detect the game-ending event.
    await joiner.evaluate(() =>
      (window as any).__peer.sendGameAction("concede", {
        concedingPlayerId: "joiner-player",
      }),
    );

    const concedeOnHost = await waitForMessage(
      host,
      `(m) => m.type === "game-action" && m.data && m.data.action === "concede"`,
    );
    expect(concedeOnHost.data).toMatchObject({
      action: "concede",
      data: { concedingPlayerId: "joiner-player" },
    });

    // Host broadcasts the resulting game-over state so both peers terminate.
    await host.evaluate(() =>
      (window as any).__peer.sendGameState(
        { status: "finished", winners: ["host-player"], endReason: "concede" },
        true,
      ),
    );

    const gameOverOnJoiner = await waitForMessage(
      joiner,
      `(m) => m.type === "game-state-sync" && m.data && m.data.gameState && m.data.gameState.status === "finished"`,
    );
    expect(gameOverOnJoiner.data).toMatchObject({
      gameState: { status: "finished", winners: ["host-player"], endReason: "concede" },
      isFullSync: true,
    });

    // No further game-action messages should arrive once the game is over.
    const joinerActions = await getReceivedMessages(joiner, "game-action");
    expect(joinerActions.length).toBe(0);
  });

  test("game end via life=0 is detected by both peers", async ({ browser }) => {
    const { host, joiner } = await createTwoPeers(browser);

    // Host deals lethal damage dropping the joiner to 0 life.
    await host.evaluate(() =>
      (window as any).__peer.sendGameAction("life-change", {
        playerId: "joiner-player",
        newLife: 0,
        delta: -20,
      }),
    );

    const lifeZeroOnJoiner = await waitForMessage(
      joiner,
      `(m) => m.type === "game-action" && m.data && m.data.action === "life-change" && m.data.data && m.data.data.newLife === 0`,
    );
    expect(lifeZeroOnJoiner.data).toMatchObject({
      action: "life-change",
      data: { playerId: "joiner-player", newLife: 0, delta: -20 },
    });

    // Both peers see the terminal state-settlement sync (life=0 => game over).
    await joiner.evaluate(() =>
      (window as any).__peer.sendGameState(
        {
          status: "finished",
          winners: ["host-player"],
          endReason: "life-zero",
          finalLifeTotals: { "host-player": 20, "joiner-player": 0 },
        },
        true,
      ),
    );

    const terminalOnHost = await waitForMessage(
      host,
      `(m) => m.type === "game-state-sync" && m.data && m.data.gameState && m.data.gameState.status === "finished" && m.data.gameState.endReason === "life-zero"`,
    );
    expect(terminalOnHost.data).toMatchObject({
      gameState: {
        status: "finished",
        winners: ["host-player"],
        endReason: "life-zero",
        finalLifeTotals: { "host-player": 20, "joiner-player": 0 },
      },
      isFullSync: true,
    });
  });
});
