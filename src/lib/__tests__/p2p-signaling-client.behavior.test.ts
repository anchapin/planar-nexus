/**
 * Behavioral tests for P2PSignalingClient (issue #1788).
 *
 * Drives the REAL P2PSignalingClient (and its REAL WebRTCConnection) against
 * the fake WebRTC globals from src/test-utils/__mocks__/rtc.ts and a mocked
 * `qrcode` renderer. Complements the pure-function suite in
 * p2p-signaling-client.test.ts, which covers the parse/serialize guards —
 * this file covers the class state machine: initialize, QR generation,
 * offer/answer handshake steps, ICE candidates, send gating, and close.
 */

import QRCode from "qrcode";
import {
  createHostSignalingClient,
  createClientSignalingClient,
  type SignalingEvents,
} from "../p2p-signaling-client";
import {
  installWebrtcGlobals,
  uninstallWebrtcGlobals,
  latestPC,
  MockRTCPeerConnection,
  MockRTCDataChannel,
} from "@/test-utils/__mocks__/rtc";

jest.mock("qrcode", () => ({
  __esModule: true,
  default: { toDataURL: jest.fn() },
}));

const mockToDataURL = QRCode.toDataURL as unknown as jest.Mock;

/** A SignalingEvents recorder: every callback captured as a jest mock. */
function makeEvents(): SignalingEvents & {
  onConnectionStateChange: jest.Mock;
  onMessage: jest.Mock;
  onConnected: jest.Mock;
  onError: jest.Mock;
  onHandshakeStepChange: jest.Mock;
} {
  return {
    onConnectionStateChange: jest.fn(),
    onMessage: jest.fn(),
    onConnected: jest.fn(),
    onError: jest.fn(),
    onHandshakeStepChange: jest.fn(),
  };
}

describe("P2PSignalingClient — behavioral", () => {
  let originals: ReturnType<typeof installWebrtcGlobals>;

  beforeEach(() => {
    originals = installWebrtcGlobals();
    mockToDataURL.mockReset();
    mockToDataURL.mockResolvedValue("data:image/png;base64,mock-qr");
  });

  afterEach(() => {
    uninstallWebrtcGlobals(originals);
  });

  it("initialize() creates the underlying WebRTC connection (host + client)", async () => {
    const hostEvents = makeEvents();
    const host = createHostSignalingClient("Alice", hostEvents);
    await host.initialize();
    expect(host.getConnectionState()).toBe("connecting");
    expect(hostEvents.onConnectionStateChange).toHaveBeenCalledWith(
      "connecting",
    );
    // Host registers the incoming data-channel listener on the PC.
    expect(latestPC().ondatachannel).toBeInstanceOf(Function);

    const clientEvents = makeEvents();
    const client = createClientSignalingClient("Bob", clientEvents);
    await client.initialize();
    expect(client.getConnectionState()).toBe("connecting");
    expect(clientEvents.onError).not.toHaveBeenCalled();
    expect(client.getHandshakeStep()).toBe("idle");
  });

  it("initialize() reports transport init failures via onError and fails the handshake", async () => {
    MockRTCPeerConnection.failNextConstruction = true;
    const events = makeEvents();
    const client = createClientSignalingClient("Alice", events);

    // Swallowed: initialize reports through events instead of throwing.
    await expect(client.initialize()).resolves.toBeUndefined();
    expect(events.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("test") }),
    );
    expect(events.onHandshakeStepChange).toHaveBeenCalledWith("failed");
    expect(client.getHandshakeStep()).toBe("failed");
  });

  it("getConnectionInfo()/getGameCode() expose the join payload", async () => {
    const client = createHostSignalingClient("Alice", makeEvents());
    await client.initialize();

    expect(client.getGameCode()).toHaveLength(6);
    expect(client.getConnectionInfo()).toEqual({
      gameCode: client.getGameCode(),
      hostName: "Alice",
      timestamp: expect.any(Number),
    });
  });

  it("generateQRCode() renders the connection info and surfaces renderer failures", async () => {
    const events = makeEvents();
    const client = createHostSignalingClient("Alice", events);
    await client.initialize();

    await expect(client.generateQRCode()).resolves.toBe(
      "data:image/png;base64,mock-qr",
    );
    expect(mockToDataURL.mock.calls[0][0]).toContain(client.getGameCode());

    // Renderer failure: onError fires AND the error rethrows to the caller.
    mockToDataURL.mockRejectedValueOnce(new Error("no canvas"));
    await expect(client.generateQRCode()).rejects.toThrow("no canvas");
    expect(events.onError).toHaveBeenCalled();
  });

  it("startHostConnection() creates an offer and moves to waiting-for-answer", async () => {
    const events = makeEvents();
    const client = createHostSignalingClient("Alice", events);
    await client.initialize();

    const offer = await client.startHostConnection();

    expect(offer).toEqual(
      expect.objectContaining({ type: "offer", sdp: expect.any(String) }),
    );
    expect(client.getLocalOffer()).toEqual(offer);
    expect(client.getHandshakeStep()).toBe("waiting-for-answer");
    const pc = latestPC();
    expect(pc.createOfferCalls).toHaveLength(1);
    expect(pc.localDescriptions[0]).toEqual(offer);
  });

  it("startHostConnection() surfaces offer failures and fails the handshake", async () => {
    const events = makeEvents();
    const client = createHostSignalingClient("Alice", events);
    await client.initialize();
    latestPC().failCreateOffer = true;

    await expect(client.startHostConnection()).rejects.toThrow();
    expect(events.onError).toHaveBeenCalled();
    expect(client.getHandshakeStep()).toBe("failed");
  });

  it("startClientConnection() answers an offer and moves to waiting-for-candidates", async () => {
    const events = makeEvents();
    const client = createClientSignalingClient("Bob", events);
    await client.initialize();

    const answer = await client.startClientConnection({
      type: "offer",
      sdp: "host-sdp",
    });

    expect(answer).toEqual(
      expect.objectContaining({ type: "answer", sdp: expect.any(String) }),
    );
    expect(client.getLocalAnswer()).toEqual(answer);
    expect(client.getHandshakeStep()).toBe("waiting-for-candidates");
    const pc = latestPC();
    expect(pc.remoteDescriptions[0]).toEqual(
      expect.objectContaining({ type: "offer" }),
    );
  });

  it("startClientConnection() surfaces answer failures and fails the handshake", async () => {
    const events = makeEvents();
    const client = createClientSignalingClient("Bob", events);
    await client.initialize();
    latestPC().failSetRemoteDescription = true;

    await expect(
      client.startClientConnection({ type: "offer", sdp: "sdp" }),
    ).rejects.toThrow();
    expect(events.onError).toHaveBeenCalled();
    expect(client.getHandshakeStep()).toBe("failed");
  });

  it("handleAnswer() applies the remote answer (host side)", async () => {
    const events = makeEvents();
    const client = createHostSignalingClient("Alice", events);
    await client.initialize();
    await client.startHostConnection();

    await client.handleAnswer({ type: "answer", sdp: "client-answer" });

    expect(latestPC().remoteDescriptions.at(-1)).toEqual(
      expect.objectContaining({ type: "answer" }),
    );
    expect(events.onError).not.toHaveBeenCalled();
  });

  it("handleAnswer() surfaces failures and fails the handshake", async () => {
    const events = makeEvents();
    const client = createHostSignalingClient("Alice", events);
    await client.initialize();
    latestPC().failSetRemoteDescription = true;

    await expect(
      client.handleAnswer({ type: "answer", sdp: "sdp" }),
    ).rejects.toThrow();
    expect(events.onHandshakeStepChange).toHaveBeenCalledWith("failed");
  });

  it("addIceCandidate() applies candidates and never breaks the connection on failure", async () => {
    const events = makeEvents();
    const client = createHostSignalingClient("Alice", events);
    await client.initialize();

    const candidate = {
      candidate: "candidate:1 1 udp 1 192.168.1.5 5000 typ host",
    };
    await expect(client.addIceCandidate(candidate)).resolves.toBeUndefined();
    expect(latestPC().addedCandidates).toEqual([candidate]);

    // Candidate errors are swallowed by design (non-fatal).
    latestPC().failAddIceCandidate = true;
    await expect(client.addIceCandidate(candidate)).resolves.toBeUndefined();
  });

  it("forwards connection state changes from the transport", async () => {
    const events = makeEvents();
    const client = createHostSignalingClient("Alice", events);
    await client.initialize();

    const pc = latestPC();
    pc.connectionState = "connected";
    pc.onconnectionstatechange?.();

    expect(events.onConnectionStateChange).toHaveBeenCalledWith("connected");
    expect(client.getConnectionState()).toBe("connected");
    expect(client.isConnected()).toBe(true);
  });

  it("sendMessage() is gated on the transport being connected", async () => {
    const events = makeEvents();
    const client = createHostSignalingClient("Alice", events);
    await client.initialize();

    // Not connected yet: the send is refused without touching a channel.
    client.sendMessage({
      type: "chat",
      senderId: "p1",
      timestamp: 1,
      payload: { text: "hi" },
    });
    expect(events.onMessage).not.toHaveBeenCalled();

    // Connect via the host-side data channel, then send for real.
    const pc = latestPC();
    const channel = new MockRTCDataChannel();
    pc.ondatachannel?.({ channel });
    channel.onopen?.();
    client.sendMessage({
      type: "chat",
      senderId: "p1",
      timestamp: 1,
      payload: { text: "hi" },
    });
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]).toContain('"chat"');
  });

  it("close() tears down the transport and resets the handshake", async () => {
    const events = makeEvents();
    const client = createHostSignalingClient("Alice", events);
    await client.initialize();
    await client.startHostConnection();
    const pc = latestPC();

    await client.close();

    expect(pc.closed).toBe(true);
    expect(client.getWebRTCConnection()).toBeNull();
    expect(client.getLocalOffer()).toBeNull();
    expect(client.getLocalAnswer()).toBeNull();
    expect(client.getConnectionState()).toBe("disconnected");
    expect(client.isConnected()).toBe(false);
    expect(client.getHandshakeStep()).toBe("idle");
    expect(events.onHandshakeStepChange).toHaveBeenCalledWith("idle");
  });

  // --- Coverage boosters for webrtc-p2p.ts / p2p-direct-connection.ts ---
  describe("webrtc-p2p / p2p-direct-connection coverage", () => {
    it("WebRTCConnection initializes a peer connection, wires ICE + data channel handlers, and closes", async () => {
      const { WebRTCConnection } = await import("../webrtc-p2p");
      const conn = new WebRTCConnection({
        playerId: "h1",
        playerName: "Alice",
        isHost: true,
        gameCode: "game-123",
      });

      await conn.initialize();
      const pc = latestPC();
      expect(pc).toBeDefined();
      expect(pc.onicecandidate).toBeTruthy();
      expect(pc.ondatachannel).toBeTruthy();

      // Simulate ICE candidate gathering through the registered handler.
      expect(() =>
        pc.onicecandidate?.({
          candidate: {
            candidate: "candidate:1 1 UDP 2122252543 192.168.1.1 5000 typ host",
            sdpMid: "0",
            sdpMLineIndex: 0,
          },
        } as never),
      ).not.toThrow();

      // Simulate the remote opening a data channel.
      const channel = new MockRTCDataChannel();
      pc.ondatachannel?.({ channel });
      await Promise.resolve();
      expect(channel.onopen).toBeTruthy();

      conn.close();
      expect(pc.closed).toBe(true);
    });

    it("sessionManager singleton tracks sessions, ICE candidates, and state", async () => {
      const { sessionManager } = await import("../p2p-direct-connection");
      const { WebRTCConnection } = await import("../webrtc-p2p");
      const conn = new WebRTCConnection({
        playerId: "h1",
        playerName: "Alice",
        isHost: true,
        gameCode: "g1",
      });
      const connectionData = {
        type: "offer" as const,
        sessionId: "sess-1",
        timestamp: Date.now(),
        sdp: {
          type: "offer" as const,
          sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n",
        },
        gameCode: "g1",
        hostName: "Alice",
        format: "v1",
      };

      sessionManager.createSession("sess-1", conn, connectionData);
      expect(sessionManager.getSession("sess-1")).toBeDefined();

      const ice: RTCIceCandidateInit = {
        candidate: "candidate:2 1 UDP 2122252543 192.168.1.1 5001 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      };
      sessionManager.addICECandidate("sess-1", ice);
      expect(sessionManager.getICECandidates("sess-1")).toContainEqual(ice);

      sessionManager.updateSessionState("sess-1", "connected");
      expect(sessionManager.getSession("sess-1")?.state).toBe("connected");

      sessionManager.closeSession("sess-1");
      expect(sessionManager.getSession("sess-1")).toBeUndefined();
    });
  });
});
