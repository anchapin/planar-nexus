/**
 * WebRTC P2P Connection Tests
 *
 * Tests for the WebRTC P2P module which provides peer-to-peer connections
 * for multiplayer games.
 * Issue #604: Add tests for P2P networking
 * Issue #915: attemptReconnection() ICE restart + bounded retries
 */

import {
  DEFAULT_RTC_CONFIG,
  generateGameCode,
  WebRTCConnection,
  type P2PEvents,
} from "../webrtc-p2p";

describe("WebRTC P2P", () => {
  describe("generateGameCode", () => {
    it("should generate a game code with default length of 6", () => {
      const code = generateGameCode();

      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[A-Z0-9]+$/);
    });

    it("should generate a game code with custom length", () => {
      const code = generateGameCode(4);

      expect(code).toHaveLength(4);
    });

    it("should generate unique codes", () => {
      const codes = new Set();

      for (let i = 0; i < 100; i++) {
        codes.add(generateGameCode());
      }

      // Should have mostly unique codes (allowing for tiny collision possibility)
      expect(codes.size).toBeGreaterThan(90);
    });
  });

  describe("DEFAULT_RTC_CONFIG", () => {
    it("should have STUN servers configured", () => {
      expect(DEFAULT_RTC_CONFIG).toBeDefined();
      expect(DEFAULT_RTC_CONFIG.iceServers).toBeDefined();
      expect(Array.isArray(DEFAULT_RTC_CONFIG.iceServers)).toBe(true);
      expect(DEFAULT_RTC_CONFIG.iceServers?.length ?? 0).toBeGreaterThan(0);
    });

    it("should have valid STUN server URLs", () => {
      const servers = DEFAULT_RTC_CONFIG.iceServers ?? [];
      for (const server of servers) {
        expect(server.urls).toMatch(/^stun:/);
      }
    });
  });
});

// =============================================================================
// Issue #915: attemptReconnection() — ICE restart with bounded retries
// =============================================================================

/**
 * Minimal data channel mock.
 */
class MockDataChannel {
  readyState = "open";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {
    this.readyState = "closed";
  }
}

/**
 * Minimal RTCPeerConnection mock that records the operations needed to verify
 * the ICE restart reconnection logic.
 */
let lastCreatedPC: MockRTCPeerConnection | null = null;

class MockRTCPeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  signalingState: RTCSignalingState = "stable";

  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onicecandidate:
    | ((event: { candidate: RTCIceCandidateInit | null }) => void)
    | null = null;
  ondatachannel: ((event: { channel: MockDataChannel }) => void) | null = null;

  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;

  createOfferCalls: RTCOfferOptions[] = [];
  setConfigurationCalls = 0;
  closed = false;

  constructor(_config?: RTCConfiguration) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastCreatedPC = this;
  }

  setConfiguration(config: RTCConfiguration): void {
    this.setConfigurationCalls++;
    void config;
  }

  async createOffer(
    options?: RTCOfferOptions,
  ): Promise<RTCSessionDescriptionInit> {
    this.createOfferCalls.push(options ?? {});
    return {
      type: "offer",
      sdp: `mock-restart-sdp-${this.createOfferCalls.length}`,
    };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: "answer", sdp: "mock-answer" };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc;
  }

  async addIceCandidate(_candidate: RTCIceCandidateInit): Promise<void> {}

  createDataChannel(label: string): MockDataChannel {
    void label;
    return new MockDataChannel();
  }

  async getStats(): Promise<Map<string, unknown>> {
    return new Map();
  }

  close(): void {
    this.closed = true;
    this.connectionState = "closed";
  }
}

describe("WebRTCConnection reconnection (issue #915)", () => {
  const ORIGINAL_RTCP = global.RTCPeerConnection;

  beforeEach(() => {
    // jsdom has no RTCPeerConnection; provide a controllable mock.
    (global as { RTCPeerConnection?: unknown }).RTCPeerConnection =
      MockRTCPeerConnection as unknown as typeof RTCPeerConnection;
  });

  afterEach(() => {
    (global as { RTCPeerConnection?: unknown }).RTCPeerConnection =
      ORIGINAL_RTCP;
  });

  /** Poll-based wait that works with real timers and async reconnect loops. */
  async function waitFor<T>(
    fn: () => T | undefined | null,
    { timeout = 3000, interval = 5 } = {},
  ): Promise<T> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = fn();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`waitFor timed out after ${timeout}ms`);
  }

  type ConnOptions = {
    isHost?: boolean;
    maxReconnectAttempts?: number;
    reconnectBaseDelayMs?: number;
    reconnectAttemptTimeoutMs?: number;
    onReconnectOffer?: P2PEvents["onReconnectOffer"];
    onError?: P2PEvents["onError"];
    onConnectionStateChange?: P2PEvents["onConnectionStateChange"];
  };

  async function makeConnection(opts: ConnOptions = {}): Promise<{
    conn: WebRTCConnection;
    pc: MockRTCPeerConnection;
    offerSpy: jest.Mock;
    errorSpy: jest.Mock;
    stateSpy: jest.Mock;
  }> {
    const offerSpy = jest.fn();
    const errorSpy = jest.fn();
    const stateSpy = jest.fn();

    const conn = new WebRTCConnection({
      playerId: "p1",
      playerName: "Player 1",
      isHost: opts.isHost ?? true,
      enableICEMonitoring: false,
      maxReconnectAttempts: opts.maxReconnectAttempts ?? 3,
      reconnectBaseDelayMs: opts.reconnectBaseDelayMs ?? 2,
      reconnectAttemptTimeoutMs: opts.reconnectAttemptTimeoutMs ?? 30,
      events: {
        onReconnectOffer: opts.onReconnectOffer ?? offerSpy,
        onError: opts.onError ?? errorSpy,
        onConnectionStateChange: opts.onConnectionStateChange ?? stateSpy,
      },
    });

    await conn.initialize();

    const pc = lastCreatedPC as MockRTCPeerConnection;
    lastCreatedPC = null;
    return { conn, pc, offerSpy, errorSpy, stateSpy };
  }

  function fireICEState(
    pc: MockRTCPeerConnection,
    state: RTCIceConnectionState,
  ): void {
    pc.iceConnectionState = state;
    pc.oniceconnectionstatechange?.();
  }

  function fireConnectionState(
    pc: MockRTCPeerConnection,
    state: RTCPeerConnectionState,
  ): void {
    pc.connectionState = state;
    pc.onconnectionstatechange?.();
  }

  it("performs an ICE restart on ICE disconnect and recovers to connected", async () => {
    const { conn, pc, offerSpy } = await makeConnection();

    // Establish the connection first.
    fireConnectionState(pc, "connected");
    expect(conn.getConnectionState()).toBe("connected");

    // Simulate a transient ICE disconnect.
    fireICEState(pc, "disconnected");

    // The host should initiate an ICE restart (createOffer with iceRestart).
    await waitFor(() => (pc.createOfferCalls.length > 0 ? true : false));
    expect(pc.createOfferCalls[0]).toEqual({ iceRestart: true });
    expect(pc.setConfigurationCalls).toBeGreaterThan(0);
    // A restart offer must be emitted for the signaling layer to forward.
    await waitFor(() => (offerSpy.mock.calls.length > 0 ? true : false));
    expect(offerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "offer" }),
      "",
    );
    expect(conn.getConnectionState()).toBe("reconnecting");

    // Simulate the peer completing renegotiation → connection recovers.
    fireConnectionState(pc, "connected");

    await waitFor(() =>
      conn.getConnectionState() === "connected" ? true : false,
    );
    expect(conn.getConnectionState()).toBe("connected");
    // Exactly one restart offer for a single successful recovery.
    expect(offerSpy).toHaveBeenCalledTimes(1);
  });

  it("retries with backoff up to max attempts then transitions to terminal failed (not stuck reconnecting)", async () => {
    const { conn, pc, errorSpy } = await makeConnection({
      maxReconnectAttempts: 2,
      reconnectBaseDelayMs: 2,
      reconnectAttemptTimeoutMs: 15,
    });

    fireConnectionState(pc, "connected");
    expect(conn.getConnectionState()).toBe("connected");

    // ICE disconnect that never recovers.
    fireICEState(pc, "disconnected");

    // Must NOT strand in "reconnecting": it reaches the terminal "failed" state.
    await waitFor(() =>
      conn.getConnectionState() === "failed" ? true : false,
    );
    expect(conn.getConnectionState()).toBe("failed");
    expect(conn.getConnectionState()).not.toBe("reconnecting");

    // Two attempts ⇒ two ICE restart offers.
    expect(pc.createOfferCalls).toHaveLength(2);
    expect(pc.createOfferCalls.every((o) => o.iceRestart === true)).toBe(true);

    // An actionable error must be surfaced when retries are exhausted.
    await waitFor(() => (errorSpy.mock.calls.length > 0 ? true : false));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const reported = errorSpy.mock.calls[0][0] as Error;
    expect(reported.message).toMatch(/exhausted|unreachable/i);
  });

  it("does not retry beyond maxReconnectAttempts", async () => {
    const { conn, pc } = await makeConnection({
      maxReconnectAttempts: 3,
      reconnectBaseDelayMs: 1,
      reconnectAttemptTimeoutMs: 8,
    });

    fireConnectionState(pc, "connected");
    fireICEState(pc, "disconnected");

    await waitFor(() =>
      conn.getConnectionState() === "failed" ? true : false,
    );
    // Exactly maxReconnectAttempts restart offers — no unbounded retrying.
    expect(pc.createOfferCalls).toHaveLength(3);
  });

  it("answerer (non-host) does not generate a restart offer (avoids glare) and still terminates", async () => {
    const { conn, pc, offerSpy } = await makeConnection({
      isHost: false,
      maxReconnectAttempts: 2,
      reconnectAttemptTimeoutMs: 15,
    });

    fireConnectionState(pc, "connected");
    fireICEState(pc, "disconnected");

    await waitFor(() =>
      conn.getConnectionState() === "failed" ? true : false,
    );
    expect(conn.getConnectionState()).toBe("failed");
    // The answerer must not create offers (the host drives the restart).
    expect(pc.createOfferCalls).toHaveLength(0);
    expect(offerSpy).not.toHaveBeenCalled();
  });

  it("close() during reconnection settles the cycle without stranding", async () => {
    const { conn, pc } = await makeConnection({
      maxReconnectAttempts: 5,
      reconnectAttemptTimeoutMs: 50,
    });

    fireConnectionState(pc, "connected");
    fireICEState(pc, "disconnected");

    // While a reconnection attempt is in flight, close the connection.
    await waitFor(() =>
      conn.getConnectionState() === "reconnecting" ? true : false,
    );
    conn.close();

    // Give the in-flight async cycle a tick to settle.
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(conn.getConnectionState()).toBe("disconnected");
    // It must not have transitioned into a perpetual reconnecting loop.
    expect(conn.isConnected()).toBe(false);
  });
});

// =============================================================================
// Issue #1088: getDiagnostics() — ICE candidate / NAT-traversal observability
// =============================================================================

/**
 * RTCPeerConnection mock that supports addEventListener (so the diagnostics
 * collector actually subscribes) and emits candidate/state events on demand.
 */
let lastDiagPC: DiagnosticsPC | null = null;

class DiagnosticsPC {
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "new";
  localDescription: RTCSessionDescriptionInit | null = null;
  private listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastDiagPC = this;
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (l) => l !== listener,
    );
  }
  emit(type: string, event: unknown): void {
    for (const l of this.listeners[type] ?? []) l(event);
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: "sdp" };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = d;
  }
  createDataChannel(): unknown {
    return { close: () => {} };
  }
  async getStats(): Promise<Map<string, unknown>> {
    return new Map();
  }
  close(): void {
    this.connectionState = "closed";
  }
}

describe("WebRTCConnection.getDiagnostics() (issue #1088)", () => {
  const ORIGINAL_RTCP = global.RTCPeerConnection;

  beforeEach(() => {
    (global as { RTCPeerConnection?: unknown }).RTCPeerConnection =
      DiagnosticsPC as unknown as typeof RTCPeerConnection;
    lastDiagPC = null;
  });

  afterEach(() => {
    (global as { RTCPeerConnection?: unknown }).RTCPeerConnection =
      ORIGINAL_RTCP;
  });

  it("returns null before a peer connection exists", async () => {
    const conn = new WebRTCConnection({
      playerId: "p1",
      playerName: "P1",
      isHost: true,
      enableICEMonitoring: false,
    });
    expect(await conn.getDiagnostics()).toBeNull();
  });

  it("reports candidate types, ICE state and NAT type via the collector", async () => {
    const conn = new WebRTCConnection({
      playerId: "p1",
      playerName: "P1",
      isHost: true,
      enableICEMonitoring: false,
    });
    await conn.initialize();
    const pc = lastDiagPC as DiagnosticsPC;

    // Simulate ICE gathering producing a host + srflx candidate.
    pc.emit("icegatheringstatechange", {});
    // First set the gathering state on the mock, then re-emit so the collector
    // reads the updated value.
    pc.iceGatheringState = "gathering";
    pc.emit("icegatheringstatechange", {});
    pc.emit("icecandidate", {
      candidate: {
        candidate: "candidate:1 1 udp 1 192.168.1.5 5000 typ host generation 0",
      },
    });
    pc.emit("icecandidate", {
      candidate: {
        candidate:
          "candidate:2 1 udp 2 203.0.113.7 5001 typ srflx generation 0",
      },
    });
    pc.iceGatheringState = "complete";
    pc.emit("icegatheringstatechange", {});
    pc.iceConnectionState = "connected";
    pc.emit("iceconnectionstatechange", {});

    const diag = await conn.getDiagnostics();
    expect(diag).not.toBeNull();
    expect(diag?.candidateCounts.host).toBe(1);
    expect(diag?.candidateCounts.srflx).toBe(1);
    expect(diag?.natType).toBe("cone");
    expect(diag?.iceConnectionState).toBe("connected");
    expect(diag?.phase).toBe("connected");
    expect(diag?.totalGathered).toBe(2);

    conn.close();
    // Detaching must not throw and the connection is gone.
    expect(await conn.getDiagnostics()).toBeNull();
  });
});
