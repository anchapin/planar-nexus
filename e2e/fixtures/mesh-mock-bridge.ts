/**
 * P2P Multi-Peer Mesh Mock Transport Bridge
 *
 * Issue #1258: E2E Playwright tests for the 3+ player mesh topology. Extends
 * the 1:1 bridge from `p2p-mock-bridge.ts` to an N-peer full mesh where each
 * peer holds a direct outbound link to every other peer. The 1:1 bridge
 * remains untouched (it powers the closed #1012 / #1094 / #1096 / #604 suites)
 * so this file deliberately lives alongside it as a parallel harness.
 *
 * Topology:
 *
 *       peer-A
 *        / | \
 *       /  |  \        <- the host fan-out is one broadcast() call, one
 *      /   |   \          link per remote peer, no central relay.
 * peer-B --+-- peer-C
 *           |
 *         peer-D  (joins mid-game; the test verifies D is the only peer that
 *                   sees the post-join "ready-check", not A/B/C.)
 *
 * The mesh's "non-blocking slow peer" property is testable here: each
 * peer's `send()` is a synchronous call into the bridge, and a single
 * `broadcast` only blocks for the duration of one local serialization step
 * regardless of how slow the slowest peer's delivery is. The slow-peer
 * harness in this file adds a configurable `deliveryDelayMs` on one
 * peer's link so a test can prove the OTHER peers still get the message
 * while the slow peer's delivery is still in flight.
 */
import type { Page, Browser, BrowserContext } from "@playwright/test";
import {
  GAME_MESSAGE_TYPES,
  MOCK_TRANSPORT_INIT,
  type GameMessage,
  type GameMessageType,
  type PeerOptions,
} from "./p2p-mock-bridge";

/**
 * Mesh-specific peer options. Extends the 1:1 PeerOptions with a per-peer
 * `linkProfile` used by the slow-peer test.
 */
export interface MeshPeerOptions extends PeerOptions {
  /**
   * Optional profile controlling how this peer's outbound link behaves.
   * Defaults to `{ deliveryDelayMs: 0, dropFraction: 0 }` — instant, no drops.
   * The slow-peer test sets a non-zero `deliveryDelayMs` to simulate a
   * throttled transport without needing CDP `Network.emulateNetworkConditions`
   * (which only affects real network, not the in-process mock channel).
   */
  linkProfile?: {
    deliveryDelayMs?: number;
    dropFraction?: number;
  };
}

/**
 * Build an in-page source for a mesh-aware peer harness. Differences from
 * the 1:1 harness:
 *  - `peers` map: `{ [peerId]: { received, lastReceivedAt } }` so a test can
 *    observe the fan-out per neighbor without mutating the single
 *    `__peer.received` global.
 *  - `sendToPeer(targetId, msg)` for targeted sends and `broadcast(msg)` for
 *    fan-out, mirroring `MeshGameConnection` semantics.
 *  - `addNeighbor(peerId)` / `removeNeighbor(peerId)` for mid-game join.
 */
function buildMeshPeerHarness(opts: MeshPeerOptions): string {
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
  var linkProfile = ${JSON.stringify(opts.linkProfile ?? {})};

  var perPeerReceived = {};
  var handlers = {};
  var allReceived = [];
  var allReceivedCount = 0;       // includes duplicates/replays (wire-level)
  var appliedReceived = [];       // excludes duplicates/replays (anti-replay view)
  var replayedReceived = [];      // duplicates/replays seen on the wire
  var lastReceivedAt = null;
  // Per-sender anti-replay high-water mark, mirroring MeshGameConnection's
  // AntiReplayTracker (issue #1091). A message with seq <= the mark is
  // considered a duplicate/replay and dropped from appliedReceived.
  // It still lands in allReceived (wire-level view) for diagnostics.
  var lastAppliedSeq = {};
  var openPeers = {};  // peerId -> { send(raw), close() } outbound handle

  var channel = window.__mockDataChannel;

  var outgoingSeq = 0;
  function stamp(type, data, seqOverride) {
    var msg = { type: type, senderId: playerId, timestamp: Date.now(), data: data };
    if (typeof seqOverride === "number") msg.seq = seqOverride;
    else msg.seq = outgoingSeq++;
    return msg;
  }

  function recordReceive(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return null; }
    if (!isGameMessage(msg)) return null;
    allReceived.push(msg);
    allReceivedCount++;
    lastReceivedAt = Date.now();
    var src = msg.senderId;
    if (!perPeerReceived[src]) perPeerReceived[src] = [];
    perPeerReceived[src].push(msg);
    // Anti-replay: drop seq <= lastAppliedSeq[senderId]. Mirrors the
    // production MeshGameConnection pipeline (issue #1091) and is what
    // makes the "replay rejection" E2E test observable end-to-end.
    var seq = typeof msg.seq === "number" ? msg.seq : null;
    var high = lastAppliedSeq[src];
    var isReplay = seq !== null && high !== undefined && seq <= high;
    if (isReplay) {
      replayedReceived.push(msg);
    } else {
      appliedReceived.push(msg);
      if (seq !== null) lastAppliedSeq[src] = seq;
    }
    (handlers[msg.type] || []).forEach(function (fn) { try { fn(msg); } catch (e) {} });
    (handlers["*"] || []).forEach(function (fn) { try { fn(msg); } catch (e) {} });
    return msg;
  }

  // Outbound factory: the slow-peer test uses deliveryDelayMs to defer
  // actual delivery, but the SEND call returns synchronously (so
  // mesh.broadcast() is non-blocking). The binding signature accepts the
  // target ids so the source peer does not need to stash them in a global
  // between broadcast() and the binding body — that race would let
  // rapid-fire broadcasts confuse the routing table.
  function makeOutbound(targetIdsFn) {
    return {
      send: function (raw) {
        if (linkProfile.dropFraction && Math.random() < linkProfile.dropFraction) {
          return false;
        }
        var delay = linkProfile.deliveryDelayMs || 0;
        var args = [targetIdsFn(), String(raw)];
        if (delay > 0) {
          setTimeout(function () { window.__p2pFanout(args[0], args[1]); }, delay);
        } else {
          window.__p2pFanout(args[0], args[1]);
        }
        return true;
      },
      close: function () {},
    };
  }

  if (channel) channel.onmessage = function (ev) { recordReceive(ev.data); };

  // The test delivers an inbound message by setting window.__p2pPending
  // (raw string + sender id) and calling window.__p2pFlush. This sidesteps
  // the limit of one exposeBinding per name and lets the binding body route
  // dynamically to whichever peer the harness is currently associated with.
  window.__p2pRecord = function (raw) { return recordReceive(raw); };

  window.__peer = {
    playerId: playerId,
    playerName: playerName,
    role: role,
    received: allReceived,
    appliedReceived: appliedReceived,
    replayedReceived: replayedReceived,
    perPeerReceived: perPeerReceived,
    lastReceivedAt: function () { return lastReceivedAt; },
    getLastAppliedSeq: function (fromPeerId) {
      return lastAppliedSeq[fromPeerId] !== undefined
        ? lastAppliedSeq[fromPeerId]
        : null;
    },
    on: function (type, fn) {
      (handlers[type] = handlers[type] || []).push(fn);
    },
    isConnected: function () { return true; },
    knownPeers: function () { return Object.keys(openPeers); },
    addNeighbor: function (toPeerId) {
      if (!toPeerId || toPeerId === playerId) return false;
      if (openPeers[toPeerId]) return false;
      // Each outbound represents a single logical link to one peer. The
      // target list is closed over toPeerId (not Object.keys(openPeers))
      // so broadcast(msg), which iterates over openPeers and calls each
      // outbound's send() once per message, fans out exactly once per
      // neighbor instead of N^2 times. Previously the snapshot was the
      // full openPeers set, which caused peer-b to receive a 3-peer
      // broadcast three times (once per outer iteration times three
      // inner targets), making the mesh test flake with 3 identical
      // messages on peer-b.
      var targetIdsFn = function () { return [toPeerId]; };
      openPeers[toPeerId] = makeOutbound(targetIdsFn);
      return true;
    },
    removeNeighbor: function (toPeerId) {
      var p = openPeers[toPeerId];
      if (!p) return false;
      p.close();
      delete openPeers[toPeerId];
      return true;
    },
    sendToPeer: function (toPeerId, msg) {
      if (!isGameMessage(msg)) throw new Error("Invalid message");
      var p = openPeers[toPeerId];
      if (!p) return false;
      return p.send(JSON.stringify(msg));
    },
    broadcast: function (msg) {
      if (!isGameMessage(msg)) throw new Error("Invalid message");
      var raw = JSON.stringify(msg);
      var targets = Object.keys(openPeers);
      var delivered = 0;
      for (var id in openPeers) {
        if (openPeers[id].send(raw)) delivered++;
      }
      return delivered;
    },
    send: function (msg) {
      if (!isGameMessage(msg)) throw new Error("Invalid message");
      if (!channel || channel.readyState !== "open") return false;
      channel.send(JSON.stringify(msg));
      return true;
    },
    sendGameAction: function (action, data) {
      return window.__peer.broadcast(stamp("game-action", { action: action, data: data }));
    },
    sendGameState: function (gameState, isFullSync) {
      return window.__peer.broadcast(stamp("game-state-sync", { gameState: gameState, isFullSync: !!isFullSync }));
    },
    sendChat: function (text) {
      return window.__peer.broadcast(stamp("chat", { senderName: playerName, text: text }));
    },
    sendPlayerJoined: function (id, name) {
      return window.__peer.broadcast(stamp("player-joined", { playerId: id, playerName: name }));
    },
    sendPlayerLeft: function (id) {
      return window.__peer.broadcast(stamp("player-left", { playerId: id }));
    },
    sendPing: function () { return window.__peer.broadcast(stamp("ping", null)); },
    sendPong: function () { return window.__peer.broadcast(stamp("pong", null)); },
  };
})();
`;
}

interface PendingDelivery {
  fromPeerId: string;
  toPeerId: string;
  raw: string;
}
// PendingDelivery is reserved for future per-delivery diagnostics — the
// current binding body delivers directly via `__p2pRecord` so the
// interface has no consumer yet. Keep the type for forward-compat.
void (null as unknown as PendingDelivery);

/**
 * Set up N pages as a full-mesh of peers. Each page gets the mock
 * RTCPeerConnection (from MOCK_TRANSPORT_INIT), a mesh-aware peer harness on
 * `window.__peer`, and a per-page `__p2pFanout(raw)` binding. The test calls
 * {@link deliverOnPage} to deliver a message from a remote peer to the local
 * page — that helper uses the `__p2pFanout` binding to push the raw string
 * into the page's `__peer.__p2pRecord` function.
 *
 * The pages are NOT yet linked to each other. Call {@link openMeshChannels}
 * (or {@link linkMeshPeers} for a partial link) to add the outbound neighbor
 * links. This split lets the mid-game-join test activate the new peer's
 * links after the game has already started.
 */
export async function setupMeshPeerPages(
  pages: Page[],
  baseURL: string,
  opts: MeshPeerOptions[],
): Promise<void> {
  if (pages.length !== opts.length) {
    throw new Error(
      `setupMeshPeerPages: pages.length (${pages.length}) !== opts.length (${opts.length})`,
    );
  }
  if (pages.length < 3) {
    throw new Error(
      `setupMeshPeerPages requires at least 3 peers (got ${pages.length})`,
    );
  }

  // Build a map from playerId to Page for fanout routing.
  const pageById = new Map<string, Page>();
  for (let i = 0; i < pages.length; i++) {
    pageById.set(opts[i].playerId, pages[i]);
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    // Per-page fanout binding: receives (targetIds[], raw) and delivers the
    // raw message to each target page. The source peer (this page) is
    // determined by the closure; the receiver uses `recordReceive` which
    // attributes the source by `msg.senderId` carried in the payload.
    await page.exposeBinding(
      "__p2pFanout",
      async (_src, targetIds: string[], raw: string) => {
        if (!Array.isArray(targetIds) || typeof raw !== "string") {
          return 0;
        }
        const sourcePlayerId = opts[i].playerId;
        let delivered = 0;
        for (const toPeerId of targetIds) {
          const target = pageById.get(toPeerId);
          if (!target) continue;
          await target.evaluate(
            ([fromPeerId, payload]) => {
              const w = window as unknown as {
                __p2pRecord: (raw: string) => unknown;
              };
              // Inject the source id into the envelope so the receiver's
              // `recordReceive` can attribute the message by senderId.
              // The payload is the broadcast wire bytes; we re-stamp the
              // senderId by rewriting it on the local receiver's view
              // (the original senderId is already in the JSON because
              // the source peer stamped it before broadcasting). The
              // `fromPeerId` argument is unused here; recordReceive
              // attributes by msg.senderId, which is the source.
              void fromPeerId;
              w.__p2pRecord(payload);
            },
            [sourcePlayerId, raw] as [string, string],
          );
          delivered++;
        }
        return delivered;
      },
    );

    await page.addInitScript(MOCK_TRANSPORT_INIT);
    await page.goto(baseURL);
    await page.waitForLoadState("domcontentloaded");

    await page.evaluate(() => {
      const pc = new RTCPeerConnection();
      pc.createDataChannel("game");
    });
    await page.evaluate(buildMeshPeerHarness(opts[i]));
  }
}

/**
 * Wire outbound links between every pair of pages so broadcasts from any
 * peer fan out to every other peer (full-mesh). Use {@link linkMeshPeers}
 * for partial meshes (e.g. mid-game join: only activate the new peer's
 * links after the game has started).
 */
export async function openMeshChannels(
  pages: Page[],
  opts: MeshPeerOptions[],
): Promise<LinkSummary> {
  return linkMeshPeers(
    pages,
    opts,
    opts.map((_, i) => i),
  );
}

/**
 * Wire outbound links from each page in `pages` to every page NOT in
 * `pages` (the "left-out" set) and from every page NOT in `pages` to
 * every page in `pages`. Used to bring a new peer into the mesh.
 */
export interface LinkSummary {
  /** playerId -> number of outbound links registered. */
  outboundByPlayerId: Record<string, number>;
  /** playerId -> number of inbound links received. */
  inboundByPlayerId: Record<string, number>;
}

export async function linkMeshPeers(
  pages: Page[],
  allOpts: MeshPeerOptions[],
  linkFromIndices: number[],
): Promise<LinkSummary> {
  const outboundByPlayerId: Record<string, number> = {};
  const inboundByPlayerId: Record<string, number> = {};
  const fromIds = new Set(linkFromIndices.map((i) => allOpts[i].playerId));
  for (let i = 0; i < allOpts.length; i++) {
    inboundByPlayerId[allOpts[i].playerId] = 0;
    outboundByPlayerId[allOpts[i].playerId] = 0;
  }
  // For each "from" peer, register an outbound link to every other peer.
  for (const i of linkFromIndices) {
    const fromPage = pages[i];
    const fromId = allOpts[i].playerId;
    for (let j = 0; j < allOpts.length; j++) {
      if (i === j) continue;
      const toId = allOpts[j].playerId;
      await fromPage.evaluate(
        (toPeerId: string) =>
          (
            window as unknown as {
              __peer: { addNeighbor: (id: string) => boolean };
            }
          ).__peer.addNeighbor(toPeerId),
        toId,
      );
      outboundByPlayerId[fromId] = (outboundByPlayerId[fromId] ?? 0) + 1;
      inboundByPlayerId[toId] = (inboundByPlayerId[toId] ?? 0) + 1;
    }
  }
  // The 'fromIds' set is currently unused after construction but kept for
  // clarity: outbound links are registered for these peers only.
  void fromIds;
  return { outboundByPlayerId, inboundByPlayerId };
}

/**
 * Get all messages received by a peer from a specific remote sender.
 * Mirrors the per-peer log the harness keeps in `window.__peer.perPeerReceived`.
 */
export async function getMessagesFrom(
  page: Page,
  fromPeerId: string,
  type?: GameMessageType,
): Promise<GameMessage[]> {
  return page.evaluate(
    ([from, t]) => {
      const w = window as unknown as {
        __peer?: { perPeerReceived?: Record<string, GameMessage[]> };
      };
      const map = w.__peer?.perPeerReceived ?? {};
      const arr = map[from] ?? [];
      return t ? arr.filter((m) => m.type === t) : [...arr];
    },
    [fromPeerId, type] as [string, GameMessageType | undefined],
  );
}

/**
 * Get the count of `received` entries on a peer (every neighbor).
 */
export async function getReceivedCount(
  page: Page,
  type?: GameMessageType,
): Promise<number> {
  return page.evaluate((t) => {
    const w = window as unknown as {
      __peer?: { received?: GameMessage[] };
    };
    const arr = w.__peer?.received ?? [];
    return t ? arr.filter((m) => m.type === t).length : arr.length;
  }, type);
}

/**
 * Wait until a peer has received at least `n` messages (optionally of `type`).
 */
export async function waitForReceiveCount(
  page: Page,
  n: number,
  type?: GameMessageType,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await getReceivedCount(page, type);
    if (count >= n) return;
    await page.waitForTimeout(25);
  }
  const got = await getReceivedCount(page, type);
  throw new Error(
    `waitForReceiveCount timed out: expected >= ${n}${type ? " " + type : ""}, got ${got}`,
  );
}

/**
 * Get the list of peer ids this page has outbound links to (its neighbors).
 */
export async function getKnownPeers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __peer?: { knownPeers?: () => string[] };
    };
    return w.__peer?.knownPeers?.() ?? [];
  });
}

/**
 * Build a fresh browser context for one peer.
 */
export async function newPeerContext(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}
