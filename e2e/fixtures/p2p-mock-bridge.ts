/**
 * P2P Mock WebRTC Transport Bridge
 *
 * Issue #1012: E2E Playwright tests for the multiplayer P2P game flow.
 *
 * Provides a deterministic, network-free transport for driving the multiplayer
 * message protocol across two Playwright browser contexts. The real app uses
 * `RTCPeerConnection` + an `RTCDataChannel` to exchange `GameMessage` payloads
 * (see `src/lib/p2p-game-connection.ts`). Here we replace that transport with
 * an in-memory bridge so two browser contexts behave as two peers connected via
 * mock signaling — no SDP exchange, STUN/TURN, or real network required.
 *
 * The message contract (types + validation) is mirrored exactly from
 * `src/lib/p2p-game-connection.ts` so the harness exercises the same wire
 * format the production code emits and consumes. The
 * `validate game message contract` test fails if the two drift.
 */
import type { Page } from "@playwright/test";

/**
 * Valid GameMessage types — must match `GameMessageType` in
 * src/lib/p2p-game-connection.ts.
 */
export const GAME_MESSAGE_TYPES = [
  "game-state-sync",
  "game-action",
  "chat",
  "player-joined",
  "player-left",
  "ping",
  "pong",
] as const;

export type GameMessageType = (typeof GAME_MESSAGE_TYPES)[number];

export interface GameMessage {
  type: GameMessageType;
  senderId: string;
  timestamp: number;
  data: unknown;
}

/**
 * Type guard mirroring `isGameMessage` from p2p-game-connection.ts.
 * Data-channel messages are untrusted and must be validated before use.
 */
export function isGameMessage(value: unknown): value is GameMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.type === "string" &&
    (GAME_MESSAGE_TYPES as readonly string[]).includes(v.type) &&
    typeof v.senderId === "string" &&
    typeof v.timestamp === "number"
  );
}

/**
 * In-page source that installs the mock WebRTC transport.
 *
 * Replaces `window.RTCPeerConnection` with a mock that:
 *  - resolves the signaling SDP methods with stub descriptions
 *  - creates a mock data channel (stored on `window.__mockDataChannel`)
 *  - routes every `channel.send(raw)` to `window.__p2pOutgoing(raw)` (bridged)
 *  - exposes `window.__p2pDeliver(raw)` for inbound messages
 *  - exposes `window.__p2pOpenChannel()` to flip the channel to "open"
 *
 * Register via `page.addInitScript(MOCK_TRANSPORT_INIT)` before navigation,
 * and expose the `__p2pOutgoing` binding via `exposeBinding` before any send.
 */
export const MOCK_TRANSPORT_INIT = `
(function () {
  if (window.__p2pMockInstalled) return;
  window.__p2pMockInstalled = true;

  function MockDataChannel(label) {
    this.label = label;
    this.readyState = "connecting";
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
  }
  MockDataChannel.prototype.send = function (raw) {
    if (this.readyState !== "open") {
      throw new Error("RTCDataChannel is not in the open state");
    }
    if (typeof window.__p2pOutgoing === "function") {
      window.__p2pOutgoing(String(raw));
    }
  };
  MockDataChannel.prototype.close = function () {
    this.readyState = "closed";
    if (typeof this.onclose === "function") this.onclose();
  };

  function MockRTCPeerConnection() {
    this.connectionState = "new";
    this.iceConnectionState = "new";
    this.signalingState = "stable";
    this.onconnectionstatechange = null;
    this.oniceconnectionstatechange = null;
    this.onicecandidate = null;
    this.ondatachannel = null;
    this.localDescription = null;
    this.remoteDescription = null;
  }
  MockRTCPeerConnection.prototype.setConfiguration = function () {};
  MockRTCPeerConnection.prototype.createOffer = async function () {
    return { type: "offer", sdp: "mock-offer-sdp" };
  };
  MockRTCPeerConnection.prototype.createAnswer = async function () {
    return { type: "answer", sdp: "mock-answer-sdp" };
  };
  MockRTCPeerConnection.prototype.setLocalDescription = async function (d) {
    this.localDescription = d;
  };
  MockRTCPeerConnection.prototype.setRemoteDescription = async function (d) {
    this.remoteDescription = d;
  };
  MockRTCPeerConnection.prototype.addIceCandidate = async function () {};
  MockRTCPeerConnection.prototype.createDataChannel = function (label) {
    var ch = new MockDataChannel(label);
    window.__mockDataChannel = ch;
    return ch;
  };
  MockRTCPeerConnection.prototype.getStats = async function () {
    return new Map();
  };
  MockRTCPeerConnection.prototype.close = function () {
    this.connectionState = "closed";
  };

  window.RTCPeerConnection = MockRTCPeerConnection;
  window.webkitRTCPeerConnection = MockRTCPeerConnection;
  window.__MockDataChannel = MockDataChannel;

  // Peer context calls this to deliver a raw inbound message.
  window.__p2pDeliver = function (raw) {
    var ch = window.__mockDataChannel;
    if (!ch || ch.readyState !== "open") return false;
    if (typeof ch.onmessage === "function") {
      ch.onmessage({ data: String(raw) });
    }
    return true;
  };

  // Flip the mock data channel to "open" (signaling complete).
  window.__p2pOpenChannel = function () {
    var ch = window.__mockDataChannel;
    if (!ch) return false;
    ch.readyState = "open";
    if (typeof ch.onopen === "function") ch.onopen();
    return true;
  };
})();
`;

export interface PeerOptions {
  playerId: string;
  playerName: string;
  role: "host" | "joiner";
}

/**
 * In-page source that creates a peer on `window.__peer`. The peer mirrors the
 * public send surface of `P2PGameConnection` (sendGameAction, sendGameState,
 * sendChat, sendPlayerJoined/Left, sendPing/Pong) and validates every message
 * with `isGameMessage` so the harness exercises the real wire contract.
 */
export function PEER_HARNESS_SOURCE(opts: PeerOptions): string {
  return `
(function () {
  var VALID_TYPES = ${JSON.stringify([...GAME_MESSAGE_TYPES])};
  function isGameMessage(value) {
    if (typeof value !== "object" || value === null) return false;
    return typeof value.type === "string" && VALID_TYPES.indexOf(value.type) !== -1
      && typeof value.senderId === "string" && typeof value.timestamp === "number";
  }

  var playerId = ${JSON.stringify(opts.playerId)};
  var playerName = ${JSON.stringify(opts.playerName)};
  var role = ${JSON.stringify(opts.role)};
  var channel = window.__mockDataChannel;
  var received = [];
  var handlers = {};
  var lastReceivedAt = null;

  function stamp(type, data) {
    return { type: type, senderId: playerId, timestamp: Date.now(), data: data };
  }

  function dispatch(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return false; }
    if (!isGameMessage(msg)) return false;
    received.push(msg);
    lastReceivedAt = Date.now();
    (handlers[msg.type] || []).forEach(function (fn) { try { fn(msg); } catch (e) {} });
    (handlers["*"] || []).forEach(function (fn) { try { fn(msg); } catch (e) {} });
    return true;
  }

  if (channel) channel.onmessage = function (ev) { dispatch(ev.data); };

  window.__peer = {
    playerId: playerId,
    playerName: playerName,
    role: role,
    received: received,
    lastReceivedAt: function () { return lastReceivedAt; },
    on: function (type, fn) {
      (handlers[type] = handlers[type] || []).push(fn);
    },
    isConnected: function () { return !!channel && channel.readyState === "open"; },
    send: function (msg) {
      if (!isGameMessage(msg)) throw new Error("Invalid message");
      if (!channel || channel.readyState !== "open") return false;
      channel.send(JSON.stringify(msg));
      return true;
    },
    sendGameAction: function (action, data) {
      return window.__peer.send(stamp("game-action", { action: action, data: data }));
    },
    sendGameState: function (gameState, isFullSync) {
      return window.__peer.send(stamp("game-state-sync", { gameState: gameState, isFullSync: !!isFullSync }));
    },
    sendChat: function (text) {
      return window.__peer.send(stamp("chat", { senderName: playerName, text: text }));
    },
    sendPlayerJoined: function (id, name) {
      return window.__peer.send(stamp("player-joined", { playerId: id, playerName: name }));
    },
    sendPlayerLeft: function (id) {
      return window.__peer.send(stamp("player-left", { playerId: id }));
    },
    sendPing: function () { return window.__peer.send(stamp("ping", null)); },
    sendPong: function () { return window.__peer.send(stamp("pong", null)); },
  };
})();
`;
}

/**
 * Set up a page as a P2P peer: install the mock transport, wire the outgoing
 * binding to deliver to the peer page, navigate, create the data channel, and
 * build the peer harness. The channel is left in "connecting" state; call
 * {@link openChannels} once both peers are wired to flip them to "open".
 *
 * @param page        The Playwright page for this peer.
 * @param peerPage    The Playwright page for the remote peer (forward target).
 * @param baseURL     App URL to navigate to (a real origin for the app).
 * @param opts        Peer identity.
 */
export async function setupPeerPage(
  page: Page,
  peerPage: Page,
  baseURL: string,
  opts: PeerOptions,
): Promise<void> {
  // Forward every outgoing message to the peer page's deliver handler.
  // exposeBinding is once-per-name-per-page, so the bridge is established here.
  await page.exposeBinding("__p2pOutgoing", async (_source, payload: string) => {
    await peerPage.evaluate(
      (p) => (window as unknown as { __p2pDeliver: (r: string) => boolean }).__p2pDeliver(p),
      payload,
    );
  });

  await page.addInitScript(MOCK_TRANSPORT_INIT);
  await page.goto(baseURL);
  await page.waitForLoadState("domcontentloaded");

  // Create the mock data channel by instantiating a mock RTCPeerConnection,
  // then build the peer harness bound to it.
  await page.evaluate(() => {
    const pc = new RTCPeerConnection();
    pc.createDataChannel("game");
  });
  await page.evaluate(PEER_HARNESS_SOURCE(opts));
}

/**
 * Flip the mock data channels on both pages to "open", simulating completed
 * signaling. Must be called after both peers are wired via setupPeerPage.
 */
export async function openChannels(...pages: Page[]): Promise<void> {
  for (const page of pages) {
    await page.evaluate(
      () => (window as unknown as { __p2pOpenChannel: () => boolean }).__p2pOpenChannel(),
    );
  }
}

/**
 * Get all messages received by the peer on a page, optionally filtered by type.
 */
export async function getReceivedMessages(
  page: Page,
  type?: GameMessageType,
): Promise<GameMessage[]> {
  return page.evaluate((t) => {
    const all = (window as any).__peer?.received ?? [];
    return t ? all.filter((m: GameMessage) => m.type === t) : [...all];
  }, type);
}

/**
 * Wait until a peer on `page` has received a message matching `predicate`.
 * Polls the in-page received log. Returns the matching message.
 */
export async function waitForMessage(
  page: Page,
  predicateSrc: string,
  timeoutMs = 5000,
): Promise<GameMessage> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const match = await page.evaluate((src) => {
      const pred = new Function("m", "return (" + src + ")(m)");
      const all = (window as any).__peer?.received ?? [];
      return all.find(pred) ?? null;
    }, predicateSrc);
    if (match) return match as GameMessage;
    if (Date.now() > deadline) {
      throw new Error(`waitForMessage timed out after ${timeoutMs}ms`);
    }
    await page.waitForTimeout(25);
  }
}
