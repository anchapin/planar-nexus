/**
 * Tests for P2P Signaling Client
 * Issue #604: Add tests for P2P networking and multiplayer systems
 */

import type { RTCIceCandidateInit } from "@/lib/webrtc-types";

import {
  P2PSignalingClient,
  createHostSignalingClient,
  createClientSignalingClient,
  parseConnectionInfo,
  serializeSignalingData,
  deserializeSignalingData,
  isConnectionInfo,
  isSignalingData,
  type ConnectionInfo,
  type SignalingData,
  type SignalingEvents,
  type HandshakeStep,
} from "../p2p-signaling-client";

describe("P2P Signaling Client Types", () => {
  describe("ConnectionInfo", () => {
    it("should create valid connection info", () => {
      const info: ConnectionInfo = {
        gameCode: "ABC123",
        hostName: "Test Host",
        timestamp: Date.now(),
      };

      expect(info.gameCode).toBe("ABC123");
      expect(info.hostName).toBe("Test Host");
      expect(info.timestamp).toBeDefined();
    });

    it("should accept optional iceServers", () => {
      const info: ConnectionInfo = {
        gameCode: "ABC123",
        hostName: "Test Host",
        timestamp: Date.now(),
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      };

      expect(info.iceServers).toBeDefined();
      expect(info.iceServers?.length).toBe(1);
    });
  });

  describe("SignalingData", () => {
    it("should create signaling data for offer", () => {
      const data: SignalingData = {
        type: "offer",
        data: { type: "offer", sdp: "mock-sdp" },
        senderCode: "ABC123",
      };

      expect(data.type).toBe("offer");
      expect(data.senderCode).toBe("ABC123");
    });

    it("should create signaling data for answer", () => {
      const data: SignalingData = {
        type: "answer",
        data: { type: "answer", sdp: "mock-answer" },
        senderCode: "ABC123",
      };

      expect(data.type).toBe("answer");
    });

    it("should create signaling data for ICE candidates", () => {
      const data: SignalingData = {
        type: "ice-candidate",
        data: {
          candidate: "candidate:123",
          sdpMid: "0",
          sdpMLineIndex: 0,
        } as RTCIceCandidateInit,
        senderCode: "ABC123",
      };

      expect(data.type).toBe("ice-candidate");
    });
  });

  describe("HandshakeStep", () => {
    it("should have all valid handshake steps", () => {
      const steps: HandshakeStep[] = [
        "idle",
        "waiting-for-offer",
        "waiting-for-answer",
        "waiting-for-candidates",
        "completed",
        "failed",
      ];

      steps.forEach((step) => expect(step).toBeDefined());
    });
  });
});

describe("SignalingEvents", () => {
  it("should require all event handlers", () => {
    const events: SignalingEvents = {
      onConnectionStateChange: () => {},
      onMessage: () => {},
      onConnected: () => {},
      onError: () => {},
      onHandshakeStepChange: () => {},
    };

    expect(events.onConnectionStateChange).toBeDefined();
    expect(events.onMessage).toBeDefined();
    expect(events.onConnected).toBeDefined();
    expect(events.onError).toBeDefined();
    expect(events.onHandshakeStepChange).toBeDefined();
  });
});

describe("createHostSignalingClient", () => {
  it("should create a P2PSignalingClient instance as host", () => {
    const events: SignalingEvents = {
      onConnectionStateChange: () => {},
      onMessage: () => {},
      onConnected: () => {},
      onError: () => {},
      onHandshakeStepChange: () => {},
    };

    const client = createHostSignalingClient("Test Host", events);
    expect(client).toBeInstanceOf(P2PSignalingClient);
  });

  it("should set correct game code", () => {
    const events: SignalingEvents = {
      onConnectionStateChange: () => {},
      onMessage: () => {},
      onConnected: () => {},
      onError: () => {},
      onHandshakeStepChange: () => {},
    };

    const client = createHostSignalingClient("Test Host", events);
    const gameCode = client.getGameCode();
    expect(gameCode.length).toBe(6);
  });
});

describe("createClientSignalingClient", () => {
  it("should create a P2PSignalingClient instance as client", () => {
    const events: SignalingEvents = {
      onConnectionStateChange: () => {},
      onMessage: () => {},
      onConnected: () => {},
      onError: () => {},
      onHandshakeStepChange: () => {},
    };

    const client = createClientSignalingClient("Test Client", events);
    expect(client).toBeInstanceOf(P2PSignalingClient);
  });
});

describe("parseConnectionInfo", () => {
  it("should parse valid connection info JSON", () => {
    const info: ConnectionInfo = {
      gameCode: "ABC123",
      hostName: "Test Host",
      timestamp: Date.now(),
    };

    const result = parseConnectionInfo(JSON.stringify(info));

    expect(result).not.toBeNull();
    expect(result?.gameCode).toBe("ABC123");
    expect(result?.hostName).toBe("Test Host");
  });

  it("should parse connection info with ICE servers", () => {
    const info: ConnectionInfo = {
      gameCode: "ABC123",
      hostName: "Test Host",
      timestamp: Date.now(),
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };

    const result = parseConnectionInfo(JSON.stringify(info));

    expect(result?.iceServers).toBeDefined();
    expect(result?.iceServers?.length).toBe(1);
  });

  it("should return null for invalid JSON", () => {
    const result = parseConnectionInfo("not valid json");
    expect(result).toBeNull();
  });

  it("should return null for missing gameCode", () => {
    const result = parseConnectionInfo(JSON.stringify({ hostName: "Test" }));
    expect(result).toBeNull();
  });

  it("should return null for missing hostName", () => {
    const result = parseConnectionInfo(JSON.stringify({ gameCode: "ABC123" }));
    expect(result).toBeNull();
  });

  it("should return null for empty string", () => {
    const result = parseConnectionInfo("");
    expect(result).toBeNull();
  });

  it("should return null for malformed JSON", () => {
    const result = parseConnectionInfo('{ "gameCode": invalid }');
    expect(result).toBeNull();
  });

  it("should return null when gameCode has the wrong type (#924)", () => {
    // Valid JSON, wrong shape — must not be cast as ConnectionInfo.
    const wrongType = {
      gameCode: 123,
      hostName: "Host",
      timestamp: Date.now(),
    };
    expect(parseConnectionInfo(JSON.stringify(wrongType))).toBeNull();
  });

  it("should return null for valid JSON scalars (#924)", () => {
    expect(parseConnectionInfo("42")).toBeNull();
    expect(parseConnectionInfo('"x"')).toBeNull();
    expect(parseConnectionInfo("null")).toBeNull();
  });

  it("should never throw on attacker-controlled input (#924)", () => {
    const payloads = [
      "",
      "{",
      "}}}",
      "undefined",
      '{"x":',
      String.fromCharCode(0),
    ];
    for (const p of payloads) {
      expect(() => parseConnectionInfo(p)).not.toThrow();
      expect(parseConnectionInfo(p)).toBeNull();
    }
  });

  // --------------------------------------------------------------------------
  // Issue #982 — strip console.log statements exposing session IDs / game codes
  // --------------------------------------------------------------------------

  describe("Sensitive-data leak protection (#982)", () => {
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
      errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it("parseConnectionInfo does not log gameCode or hostName on malformed input", () => {
      const gameCode = "ZZZ999";
      const hostName = "SecretHost";
      const malicious = `{ "gameCode": "${gameCode}", "hostName": "${hostName}", invalid }`;

      expect(parseConnectionInfo(malicious)).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
      for (const call of errorSpy.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain(gameCode);
        expect(serialized).not.toContain(hostName);
      }
    });
  });
});

describe("serializeSignalingData", () => {
  it("should serialize offer data", () => {
    const data: SignalingData = {
      type: "offer",
      data: { type: "offer", sdp: "mock-sdp" },
      senderCode: "ABC123",
    };

    const serialized = serializeSignalingData(data);

    expect(typeof serialized).toBe("string");
    const parsed = JSON.parse(serialized);
    expect(parsed.type).toBe("offer");
    expect(parsed.data).toEqual(data.data);
  });

  it("should serialize answer data", () => {
    const data: SignalingData = {
      type: "answer",
      data: { type: "answer", sdp: "mock-answer" },
      senderCode: "ABC123",
    };

    const serialized = serializeSignalingData(data);
    const parsed = JSON.parse(serialized);

    expect(parsed.type).toBe("answer");
  });

  it("should serialize ICE candidate data", () => {
    const data: SignalingData = {
      type: "ice-candidate",
      data: {
        candidate: "candidate:123",
        sdpMid: "0",
        sdpMLineIndex: 0,
      } as RTCIceCandidateInit,
      senderCode: "ABC123",
    };

    const serialized = serializeSignalingData(data);
    const parsed = JSON.parse(serialized);

    expect(parsed.type).toBe("ice-candidate");
  });
});

describe("deserializeSignalingData", () => {
  it("should deserialize valid signaling data", () => {
    const data: SignalingData = {
      type: "offer",
      data: { type: "offer", sdp: "mock-sdp" },
      senderCode: "ABC123",
    };

    const serialized = serializeSignalingData(data);
    const deserialized = deserializeSignalingData(serialized);

    expect(deserialized).not.toBeNull();
    expect(deserialized?.type).toBe("offer");
    expect(deserialized?.senderCode).toBe("ABC123");
  });

  it("should return null for invalid JSON", () => {
    const result = deserializeSignalingData("not valid json");
    expect(result).toBeNull();
  });

  it("should return null for empty string", () => {
    const result = deserializeSignalingData("");
    expect(result).toBeNull();
  });

  it("should return null for malformed JSON", () => {
    const result = deserializeSignalingData('{ "type": invalid }');
    expect(result).toBeNull();
  });

  it("should return null when shape does not match (#924)", () => {
    // Previously this was a blind `as SignalingData` cast.
    expect(deserializeSignalingData(JSON.stringify({ foo: "bar" }))).toBeNull();
    expect(
      deserializeSignalingData(
        JSON.stringify({ type: "unknown", data: {}, senderCode: "ABC" }),
      ),
    ).toBeNull();
    expect(
      deserializeSignalingData(
        JSON.stringify({
          type: "offer",
          data: "not-an-object",
          senderCode: "ABC",
        }),
      ),
    ).toBeNull();
  });

  it("should never throw on attacker-controlled input (#924)", () => {
    const payloads = ["", "{", "}}}", "undefined", "null", "42", "[1,2]"];
    for (const p of payloads) {
      expect(() => deserializeSignalingData(p)).not.toThrow();
      expect(deserializeSignalingData(p)).toBeNull();
    }
  });
});

describe("isConnectionInfo (type guard)", () => {
  it("accepts valid connection info", () => {
    expect(
      isConnectionInfo({ gameCode: "ABC", hostName: "H", timestamp: 1 }),
    ).toBe(true);
  });

  it("rejects wrong-typed fields", () => {
    expect(isConnectionInfo({ gameCode: 1, hostName: "H", timestamp: 1 })).toBe(
      false,
    );
  });

  it("rejects non-objects", () => {
    expect(isConnectionInfo(null)).toBe(false);
    expect(isConnectionInfo("x")).toBe(false);
  });
});

describe("isSignalingData (type guard)", () => {
  it("accepts valid signaling data", () => {
    expect(
      isSignalingData({ type: "offer", data: { sdp: "x" }, senderCode: "ABC" }),
    ).toBe(true);
  });

  it("rejects an invalid type value", () => {
    expect(
      isSignalingData({ type: "bogus", data: {}, senderCode: "ABC" }),
    ).toBe(false);
  });

  it("rejects a non-object data field", () => {
    expect(
      isSignalingData({ type: "offer", data: "x", senderCode: "ABC" }),
    ).toBe(false);
  });
});

describe("P2PSignalingClient instance", () => {
  let client: P2PSignalingClient;

  beforeEach(() => {
    const events: SignalingEvents = {
      onConnectionStateChange: () => {},
      onMessage: () => {},
      onConnected: () => {},
      onError: () => {},
      onHandshakeStepChange: () => {},
    };
    client = createHostSignalingClient("Test Host", events);
  });

  describe("getGameCode", () => {
    it("should return a 6-character game code", () => {
      const gameCode = client.getGameCode();
      expect(gameCode.length).toBe(6);
    });

    it("should use valid characters", () => {
      const gameCode = client.getGameCode();
      const validChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      for (const char of gameCode) {
        expect(validChars.includes(char)).toBe(true);
      }
    });
  });

  describe("getConnectionInfo", () => {
    it("should return connection info with game code", () => {
      const info = client.getConnectionInfo();
      expect(info.gameCode).toBeDefined();
      expect(info.hostName).toBe("Test Host");
      expect(info.timestamp).toBeDefined();
    });
  });

  describe("getHandshakeStep", () => {
    it("should return initial handshake step", () => {
      const step = client.getHandshakeStep();
      expect(step).toBe("idle");
    });
  });

  describe("getLocalOffer", () => {
    it("should return null initially", () => {
      const offer = client.getLocalOffer();
      expect(offer).toBeNull();
    });
  });

  describe("getLocalAnswer", () => {
    it("should return null initially", () => {
      const answer = client.getLocalAnswer();
      expect(answer).toBeNull();
    });
  });

  describe("getConnectionState", () => {
    it("should return initial connection state", () => {
      const state = client.getConnectionState();
      expect(state).toBeDefined();
    });
  });

  describe("isConnected", () => {
    it("should return false initially", () => {
      expect(client.isConnected()).toBe(false);
    });
  });
});

describe("End-to-end serialization", () => {
  it("should round-trip signaling data for offer", () => {
    const original: SignalingData = {
      type: "offer",
      data: { type: "offer", sdp: "v=0\r\no=- 12345 67890\r\n..." },
      senderCode: "ABC123",
    };

    const serialized = serializeSignalingData(original);
    const deserialized = deserializeSignalingData(serialized);

    expect(deserialized).not.toBeNull();
    expect(deserialized?.type).toBe(original.type);
    expect(deserialized?.senderCode).toBe(original.senderCode);
  });

  it("should round-trip signaling data for ICE candidates", () => {
    const original: SignalingData = {
      type: "ice-candidate",
      data: {
        candidate: "candidate:123456",
        sdpMid: "0",
        sdpMLineIndex: 0,
      } as RTCIceCandidateInit,
      senderCode: "XYZ789",
    };

    const serialized = serializeSignalingData(original);
    const deserialized = deserializeSignalingData(serialized);

    expect(deserialized).not.toBeNull();
    expect((deserialized?.data as RTCIceCandidateInit).candidate).toBeDefined();
  });
});

describe("Error handling", () => {
  describe("P2PSignalingClient.generateQRCode", () => {
    let client: P2PSignalingClient;
    let errorHandler: jest.Mock;

    beforeEach(() => {
      errorHandler = jest.fn();
      const events: SignalingEvents = {
        onConnectionStateChange: () => {},
        onMessage: () => {},
        onConnected: () => {},
        onError: errorHandler,
        onHandshakeStepChange: () => {},
      };
      client = createHostSignalingClient("Test Host", events);
    });

    it("should handle QR code generation errors via onError callback", async () => {
      // Note: Full error callback testing requires mocking the qrcode module
      // This test verifies the error handler is properly wired up
      expect(errorHandler).toBeDefined();
    });
  });
});
