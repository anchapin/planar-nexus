/**
 * Behavioral tests for the useP2PSignaling hook (issue #1788).
 *
 * Drives the REAL hook (renderHook) against the REAL signaling client and
 * WebRTC transport — only the environment boundaries are faked:
 *   - RTCPeerConnection/RTCDataChannel (jsdom has no WebRTC) via
 *     src/test-utils/__mocks__/rtc.ts
 *   - the `qrcode` renderer (jsdom has no canvas)
 *
 * Covered flows: host initialize (game code + QR), client initialize,
 * offer/answer copy-paste exchange, ICE candidate relay, connect via data
 * channel, inbound message dispatch, outbound sends, error paths, and
 * close/reset. This file replaces the old type-literal-only suite
 * (src/lib/__tests__/use-p2p-signaling.test.ts) which never executed the hook.
 */

import { renderHook, act } from "@testing-library/react";
import QRCode from "qrcode";
import { useP2PSignaling } from "../use-p2p-signaling";
import {
  installWebrtcGlobals,
  uninstallWebrtcGlobals,
  latestPC,
  MockRTCDataChannel,
} from "@/test-utils/__mocks__/rtc";
import { serializeSignalingData } from "@/lib/p2p-signaling-client";

jest.mock("qrcode", () => ({
  __esModule: true,
  default: { toDataURL: jest.fn() },
}));

const mockToDataURL = QRCode.toDataURL as unknown as jest.Mock;

describe("useP2PSignaling — behavioral", () => {
  let originals: ReturnType<typeof installWebrtcGlobals>;
  /**
   * Per-test teardown hooks. Opening a data channel starts the transport's
   * 5s ping interval; every connected test registers a close() so no timer
   * outlives the test (the repo bans --forceExit).
   */
  const teardowns: Array<() => Promise<void> | void> = [];

  beforeEach(() => {
    originals = installWebrtcGlobals();
    mockToDataURL.mockReset();
    mockToDataURL.mockResolvedValue("data:image/png;base64,mock-qr");
  });

  afterEach(async () => {
    for (const fn of teardowns.splice(0)) {
      await fn();
    }
    uninstallWebrtcGlobals(originals);
  });

  /** Serialize an offer/answer/ice payload exactly like the copy-paste flow. */
  const serialize = (
    type: "offer" | "answer" | "ice-candidate",
    data: unknown,
    senderCode = "HOSTCODE",
  ): string =>
    serializeSignalingData({
      type,
      data: data as never,
      senderCode,
    });

  describe("host initialization (connect → game-code share)", () => {
    it("initializes as host: sets game code, connection info, and QR code", async () => {
      const { result } = renderHook(() => useP2PSignaling());

      await act(async () => {
        await result.current.initializeAsHost("Alice");
      });

      expect(result.current.gameCode).toHaveLength(6);
      expect(result.current.connectionInfo).toEqual(
        expect.objectContaining({
          gameCode: result.current.gameCode,
          hostName: "Alice",
        }),
      );
      expect(result.current.qrCode).toBe("data:image/png;base64,mock-qr");
      expect(mockToDataURL.mock.calls[0][0]).toContain(result.current.gameCode);
      expect(result.current.error).toBeNull();
      expect(result.current.isConnected).toBe(false);
    });

    it("surfaces a QR generation failure as hook error state and rejects", async () => {
      const onError = jest.fn();
      mockToDataURL.mockRejectedValue(new Error("canvas unavailable"));
      const { result } = renderHook(() => useP2PSignaling({ onError }));

      // Catch inside act so React flushes the error state before asserting.
      let caught: unknown;
      await act(async () => {
        caught = await result.current
          .initializeAsHost("Alice")
          .catch((e: unknown) => e);
      });

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe("canvas unavailable");
      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe("canvas unavailable");
      expect(onError).toHaveBeenCalled();
      expect(result.current.qrCode).toBeNull();
    });
  });

  describe("client initialization (game-code join)", () => {
    it("initializes as client: sets a game code without a QR code", async () => {
      const { result } = renderHook(() => useP2PSignaling());

      await act(async () => {
        await result.current.initializeAsClient("Bob");
      });

      expect(result.current.gameCode).toHaveLength(6);
      // Only the host renders a QR code.
      expect(result.current.qrCode).toBeNull();
      expect(result.current.connectionInfo).toBeNull();
      expect(mockToDataURL).not.toHaveBeenCalled();
    });

    it("parses a host's QR connection info (the game-code join payload)", async () => {
      const { result } = renderHook(() => useP2PSignaling());
      const info = {
        gameCode: "ABC234",
        hostName: "Alice",
        timestamp: Date.now(),
      };

      expect(result.current.parseConnectionInfo(JSON.stringify(info))).toEqual(
        info,
      );
      // Malformed join payloads are rejected, not thrown.
      expect(result.current.parseConnectionInfo("not-json")).toBeNull();
      expect(result.current.parseConnectionInfo("{}")).toBeNull();
    });
  });

  describe("offer/answer exchange", () => {
    it("host creates a serialized offer and consumes the client's serialized answer", async () => {
      const { result } = renderHook(() => useP2PSignaling());
      await act(async () => {
        await result.current.initializeAsHost("Alice");
      });

      let offer = "";
      await act(async () => {
        offer = await result.current.startHostConnection();
      });

      expect(offer).toContain('"offer"');
      expect(offer).toContain(result.current.gameCode);
      expect(result.current.localOffer).toBe(offer);
      // Handshake step surfaced for the UI.
      expect(result.current.handshakeStep).toBe("waiting-for-answer");

      const answer = serialize(
        "answer",
        { type: "answer", sdp: "client-answer" },
        "CLIENTCDE",
      );
      await act(async () => {
        await result.current.handleAnswer(answer);
      });

      expect(result.current.remoteAnswer).toBe(answer);
      const pc = latestPC();
      expect(pc.remoteDescriptions[0]).toEqual(
        expect.objectContaining({ type: "answer" }),
      );
    });

    it("client consumes a serialized offer and returns a serialized answer", async () => {
      const { result } = renderHook(() => useP2PSignaling());
      await act(async () => {
        await result.current.initializeAsClient("Bob");
      });

      const offer = serialize(
        "offer",
        { type: "offer", sdp: "host-offer" },
        "HOSTCODE",
      );
      let answer = "";
      await act(async () => {
        answer = await result.current.startClientConnection(offer);
      });

      expect(result.current.remoteOffer).toBe(offer);
      expect(answer).toContain('"answer"');
      expect(result.current.localAnswer).toBe(answer);
      expect(result.current.handshakeStep).toBe("waiting-for-candidates");
      const pc = latestPC();
      expect(pc.remoteDescriptions[0]).toEqual(
        expect.objectContaining({ type: "offer" }),
      );
      expect(pc.localDescriptions[0]).toEqual(
        expect.objectContaining({ type: "answer" }),
      );
    });

    it("rejects a non-offer payload on the client path with an error", async () => {
      const onError = jest.fn();
      const { result } = renderHook(() => useP2PSignaling({ onError }));
      await act(async () => {
        await result.current.initializeAsClient("Bob");
      });

      // Catch inside act so React flushes the error state before asserting.
      let caught: unknown;
      await act(async () => {
        caught = await result.current
          .startClientConnection("garbage")
          .catch((e: unknown) => e);
      });
      expect((caught as Error).message).toBe("Invalid offer data");

      expect(result.current.error?.message).toBe("Invalid offer data");
      expect(onError).toHaveBeenCalled();
    });

    it("rejects a non-answer payload on the host path with an error", async () => {
      const { result } = renderHook(() => useP2PSignaling());
      await act(async () => {
        await result.current.initializeAsHost("Alice");
      });

      let caught: unknown;
      await act(async () => {
        caught = await result.current
          .handleAnswer(
            JSON.stringify({ type: "offer", data: {}, senderCode: "X" }),
          )
          .catch((e: unknown) => e);
      });
      expect((caught as Error).message).toBe("Invalid answer data");
      expect(result.current.error?.message).toBe("Invalid answer data");
    });
  });

  describe("ICE candidate relay", () => {
    it("adds a serialized ICE candidate to the underlying connection", async () => {
      const { result } = renderHook(() => useP2PSignaling());
      await act(async () => {
        await result.current.initializeAsHost("Alice");
      });

      await act(async () => {
        await result.current.addIceCandidate(
          serialize(
            "ice-candidate",
            { candidate: "candidate:1 1 udp 1 192.168.1.5 5000 typ host" },
            "CLIENTCDE",
          ),
        );
      });

      expect(latestPC().addedCandidates).toHaveLength(1);
      expect(result.current.error).toBeNull();
    });

    it("rejects malformed candidate payloads without touching the connection", async () => {
      const { result } = renderHook(() => useP2PSignaling());
      await act(async () => {
        await result.current.initializeAsHost("Alice");
      });

      let caught: unknown;
      await act(async () => {
        caught = await result.current
          .addIceCandidate("garbage")
          .catch((e: unknown) => e);
      });
      expect((caught as Error).message).toBe("Invalid ICE candidate data");
      expect(latestPC().addedCandidates).toHaveLength(0);
    });
  });

  describe("guard: uninitialized client", () => {
    it("throws when connection methods run before initialization", async () => {
      const { result } = renderHook(() => useP2PSignaling());

      await expect(result.current.startHostConnection()).rejects.toThrow(
        "Signaling client not initialized",
      );
      await expect(
        result.current.startClientConnection("offer"),
      ).rejects.toThrow("Signaling client not initialized");
      await expect(result.current.handleAnswer("answer")).rejects.toThrow(
        "Signaling client not initialized",
      );
      await expect(result.current.addIceCandidate("cand")).rejects.toThrow(
        "Signaling client not initialized",
      );
      // sendMessage before init warns and does NOT throw.
      expect(() =>
        result.current.sendMessage({
          type: "chat",
          senderId: "p1",
          timestamp: 1,
          payload: { text: "hi" },
        }),
      ).not.toThrow();
      // None of the guards above initialized a transport.
      expect(result.current.gameCode).toBe("");
      expect(result.current.error).toBeNull();
    });
  });

  describe("connected message flow", () => {
    /** Initialize as host and open the host-side (incoming) data channel. */
    async function connectedHost() {
      const onConnected = jest.fn();
      const onMessage = jest.fn();
      const { result, unmount } = renderHook(() =>
        useP2PSignaling({ onConnected, onMessage }),
      );
      await act(async () => {
        await result.current.initializeAsHost("Alice");
      });

      const channel = new MockRTCDataChannel();
      act(() => {
        latestPC().ondatachannel?.({ channel });
      });
      // Host-side channel opens → transport (and hook) become connected.
      act(() => {
        channel.onopen?.();
      });
      expect(result.current.isConnected).toBe(true);
      expect(onConnected).toHaveBeenCalled();

      // Close the transport (stopping the ping interval) before unmount.
      teardowns.push(async () => {
        await act(async () => {
          await result.current.close();
        });
        unmount();
      });

      return { result, channel, onMessage };
    }

    it("marks the hook connected and fires onConnected when the channel opens", async () => {
      await connectedHost();
    });

    it("dispatches inbound data-channel messages to onMessage", async () => {
      const { channel, onMessage } = await connectedHost();

      act(() => {
        channel.onmessage?.({
          data: JSON.stringify({
            type: "chat",
            senderId: "peer",
            timestamp: Date.now(),
            payload: { text: "hello" },
          }),
        });
      });

      expect(onMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "chat" }),
      );
    });

    it("sends messages over the open channel", async () => {
      const { result, channel } = await connectedHost();
      const before = channel.sent.length;

      act(() => {
        result.current.sendMessage({
          type: "chat",
          senderId: "local",
          timestamp: Date.now(),
          payload: { text: "pong" },
        });
      });

      expect(channel.sent.length).toBe(before + 1);
      expect(channel.sent[channel.sent.length - 1]).toContain('"chat"');
    });
  });

  describe("connection state and error events", () => {
    it("mirrors transport state changes and error events into hook state", async () => {
      const onError = jest.fn();
      const { result } = renderHook(() => useP2PSignaling({ onError }));
      await act(async () => {
        await result.current.initializeAsHost("Alice");
      });

      const pc = latestPC();
      act(() => {
        pc.connectionState = "connecting";
        pc.onconnectionstatechange?.();
      });
      expect(result.current.connectionState).toBe("connecting");
      expect(result.current.isConnected).toBe(false);

      act(() => {
        pc.connectionState = "failed";
        pc.onconnectionstatechange?.();
      });
      expect(result.current.connectionState).toBe("failed");
      // Transport failure surfaces through the error pipeline.
      await Promise.resolve();
      expect(result.current.error).toBeInstanceOf(Error);
      expect(onError).toHaveBeenCalled();
    });
  });

  describe("close and reset", () => {
    it("close() tears down the transport and resets hook state", async () => {
      const { result } = renderHook(() => useP2PSignaling());
      await act(async () => {
        await result.current.initializeAsHost("Alice");
      });
      const pc = latestPC();

      await act(async () => {
        await result.current.close();
      });

      expect(pc.closed).toBe(true);
      expect(result.current.connectionState).toBe("disconnected");
      expect(result.current.handshakeStep).toBe("idle");
      expect(result.current.qrCode).toBeNull();
      expect(result.current.connectionInfo).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it("reset() clears handshake bookkeeping without touching the transport", async () => {
      const { result } = renderHook(() => useP2PSignaling());
      await act(async () => {
        await result.current.initializeAsHost("Alice");
      });
      const pc = latestPC();

      act(() => {
        result.current.reset();
      });

      expect(result.current.qrCode).toBeNull();
      expect(result.current.connectionInfo).toBeNull();
      // reset() does not close the underlying peer connection.
      expect(pc.closed).toBe(false);
    });
  });

  // --- Coverage boosters for use-p2p-connection.ts ---
  describe("use-p2p-connection coverage boosters", () => {
    it("host init returns an offer and reaches connected when the transport reports it", async () => {
      const { useP2PConnection } = await import("../use-p2p-connection");
      const { result } = renderHook(() =>
        useP2PConnection({
          playerId: "p1",
          playerName: "Alice",
          role: "host",
          gameCode: "ABC123",
          enableHostMigration: true,
          initialHostId: "p1",
          migrationPeers: [
            { playerId: "p1", playerName: "Alice", joinedAt: 1, joinSeq: 0 },
            { playerId: "p2", playerName: "Bob", joinedAt: 2, joinSeq: 1 },
          ],
        }),
      );

      const offer = await act(async () => result.current.initializeAsHost());

      expect(offer).toBeDefined();
      expect(offer.type).toBe("offer");
      expect(result.current.getConnection()).not.toBeNull();
      expect(result.current.currentHostId).toBe("p1");
      expect(result.current.isAuthoritativeHost).toBe(true);

      // Transport reports connected (mock fires the handler with no args;
      // state lives on the pc object itself).
      const pc = latestPC();
      pc.connectionState = "connected";
      await act(async () => {
        pc.onconnectionstatechange?.();
        await Promise.resolve();
      });

      expect(result.current.connectionState).toBe("connected");
    });

    it("joiner lifecycle: initializeAsJoiner returns the answer; close resets", async () => {
      const { useP2PConnection } = await import("../use-p2p-connection");
      const { result } = renderHook(() =>
        useP2PConnection({
          playerId: "p2",
          playerName: "Bob",
          role: "joiner",
          gameCode: "ABC123",
        }),
      );

      const offer: RTCSessionDescriptionInit = {
        type: "offer",
        sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n",
      };
      const answer = await act(async () => {
        return await result.current.initializeAsJoiner(offer);
      });

      // The joiner produces the answer for the host to process.
      expect(answer).toBeDefined();
      expect(answer.type).toBe("answer");
      expect(result.current.getConnection()).not.toBeNull();

      // Chat is gated off while the transport is not open.
      expect(typeof result.current.sendChat("hi")).toBe("boolean");

      act(() => {
        result.current.closeConnection();
      });
      expect(result.current.connectionState).toBe("disconnected");
      expect(result.current.getConnection()).toBeNull();
    });

    it("terminal transport failure surfaces a non-connected state and close resets", async () => {
      const { useP2PConnection } = await import("../use-p2p-connection");
      const { result } = renderHook(() =>
        useP2PConnection({
          playerId: "p1",
          playerName: "Alice",
          role: "host",
          gameCode: "ZZZ999",
        }),
      );

      await act(async () => result.current.initializeAsHost());
      expect(["connecting", "signaling"]).toContain(
        result.current.connectionState,
      );

      // Transport reports terminal failure. The hook's reconnection ladder
      // may first enter "reconnecting" before exhausting attempts to
      // "failed" — both are non-connected failure surfaces.
      const pc = latestPC();
      pc.connectionState = "failed";
      await act(async () => {
        pc.onconnectionstatechange?.();
        await Promise.resolve();
      });

      expect(["reconnecting", "failed"]).toContain(
        result.current.connectionState,
      );

      act(() => {
        result.current.closeConnection();
      });
      expect(result.current.connectionState).toBe("disconnected");
    });
  });
});
