/**
 * Tests for P2P Direct Connection
 * Issue #604: Add tests for P2P networking and multiplayer systems
 */

import {
  parseConnectionData,
  parseICECandidateData,
  generateConnectionString,
  generateICECandidateString,
  validateConnectionData,
  getConnectionState,
  handleICEExchange,
  isConnectionData,
  isICECandidateData,
  type ConnectionData,
  type ICECandidateData,
} from "../p2p-direct-connection";

describe("P2P Direct Connection Utilities", () => {
  describe("parseConnectionData", () => {
    it("should parse valid JSON connection data", () => {
      const connectionData: ConnectionData = {
        type: "offer",
        sessionId: "session-123",
        timestamp: Date.now(),
        sdp: { type: "offer", sdp: "mock-sdp" },
        gameCode: "ABC123",
        hostName: "Test Host",
        format: "commander",
      };

      const result = parseConnectionData(JSON.stringify(connectionData));

      expect(result).not.toBeNull();
      expect(result?.type).toBe("offer");
      expect(result?.sessionId).toBe("session-123");
      expect(result?.gameCode).toBe("ABC123");
      expect(result?.hostName).toBe("Test Host");
    });

    it("should parse answer type connection data", () => {
      const connectionData: ConnectionData = {
        type: "answer",
        sessionId: "session-456",
        timestamp: Date.now(),
        sdp: { type: "answer", sdp: "mock-answer-sdp" },
        gameCode: "XYZ789",
        hostName: "Host Player",
        format: "commander",
      };

      const result = parseConnectionData(JSON.stringify(connectionData));

      expect(result).not.toBeNull();
      expect(result?.type).toBe("answer");
    });

    it("should return null for invalid JSON", () => {
      const result = parseConnectionData("not valid json");
      expect(result).toBeNull();
    });

    it("should return null for missing required fields", () => {
      const invalidData = {
        type: "offer",
        // missing sessionId, sdp, gameCode
      };

      const result = parseConnectionData(JSON.stringify(invalidData));
      expect(result).toBeNull();
    });

    it("should return null for empty string", () => {
      const result = parseConnectionData("");
      expect(result).toBeNull();
    });

    it("should reject malformed JSON", () => {
      const result = parseConnectionData('{ "type": "offer", invalid }');
      expect(result).toBeNull();
    });

    it("should return null when required fields have the wrong type (#924)", () => {
      // Valid JSON, wrong shape — must not be cast as ConnectionData.
      const wrongTypes = {
        type: 123,
        sessionId: "session-123",
        timestamp: Date.now(),
        sdp: { type: "offer", sdp: "mock-sdp" },
        gameCode: "ABC123",
        hostName: "Host",
        format: "commander",
      };
      expect(parseConnectionData(JSON.stringify(wrongTypes))).toBeNull();
    });

    it("should return null when sdp is missing (#924)", () => {
      const noSdp = {
        type: "offer",
        sessionId: "session-123",
        timestamp: Date.now(),
        gameCode: "ABC123",
        hostName: "Host",
        format: "commander",
      };
      expect(parseConnectionData(JSON.stringify(noSdp))).toBeNull();
    });

    it("should return null for valid JSON scalars (#924)", () => {
      expect(parseConnectionData("42")).toBeNull();
      expect(parseConnectionData('"a string"')).toBeNull();
      expect(parseConnectionData("null")).toBeNull();
    });

    it("should never throw on attacker-controlled input (#924)", () => {
      const payloads = [
        "",
        "{",
        "}}}",
        "undefined",
        '{"id":',
        String.fromCharCode(0),
      ];
      for (const p of payloads) {
        expect(() => parseConnectionData(p)).not.toThrow();
        expect(parseConnectionData(p)).toBeNull();
      }
    });
  });

  describe("parseICECandidateData", () => {
    it("should parse valid ICE candidate data", () => {
      const iceData: ICECandidateData = {
        type: "ice-candidate",
        sessionId: "session-123",
        candidate: {
          candidate: "candidate:123456789",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      };

      const result = parseICECandidateData(JSON.stringify(iceData));

      expect(result).not.toBeNull();
      expect(result?.type).toBe("ice-candidate");
      expect(result?.sessionId).toBe("session-123");
      expect(result?.candidate).toBeDefined();
    });

    it("should return null for invalid JSON", () => {
      const result = parseICECandidateData("invalid");
      expect(result).toBeNull();
    });

    it("should return null for missing required fields", () => {
      const invalidData = {
        type: "ice-candidate",
        // missing sessionId, candidate
      };

      const result = parseICECandidateData(JSON.stringify(invalidData));
      expect(result).toBeNull();
    });

    it("should return null when candidate has the wrong type (#924)", () => {
      const wrongType = {
        type: "ice-candidate",
        sessionId: "session-123",
        candidate: "not-an-object",
      };
      expect(parseICECandidateData(JSON.stringify(wrongType))).toBeNull();
    });
  });

  describe("isConnectionData (type guard)", () => {
    it("accepts a valid ConnectionData", () => {
      const valid: ConnectionData = {
        type: "offer",
        sessionId: "s",
        timestamp: Date.now(),
        sdp: { type: "offer", sdp: "x" },
        gameCode: "ABC123",
        hostName: "Host",
        format: "commander",
      };
      expect(isConnectionData(valid)).toBe(true);
    });

    it("rejects an invalid type value", () => {
      expect(
        isConnectionData({
          type: "bogus",
          sessionId: "s",
          gameCode: "g",
          hostName: "h",
          timestamp: 1,
          sdp: {},
        }),
      ).toBe(false);
    });

    it("rejects non-objects", () => {
      expect(isConnectionData(null)).toBe(false);
      expect(isConnectionData("offer")).toBe(false);
      expect(isConnectionData(42)).toBe(false);
    });
  });

  describe("isICECandidateData (type guard)", () => {
    it("accepts valid ICE candidate data", () => {
      expect(
        isICECandidateData({
          type: "ice-candidate",
          sessionId: "s",
          candidate: { candidate: "c" },
        }),
      ).toBe(true);
    });

    it("rejects a non-object candidate", () => {
      expect(
        isICECandidateData({
          type: "ice-candidate",
          sessionId: "s",
          candidate: "c",
        }),
      ).toBe(false);
    });
  });

  describe("generateConnectionString", () => {
    it("should generate valid JSON string", () => {
      const connectionData: ConnectionData = {
        type: "offer",
        sessionId: "session-123",
        timestamp: Date.now(),
        sdp: { type: "offer", sdp: "mock-sdp" },
        gameCode: "ABC123",
        hostName: "Test Host",
        format: "commander",
      };

      const result = generateConnectionString(connectionData);

      expect(typeof result).toBe("string");
      const parsed = JSON.parse(result);
      expect(parsed.type).toBe("offer");
      expect(parsed.sessionId).toBe("session-123");
    });

    it("should generate string for answer type", () => {
      const connectionData: ConnectionData = {
        type: "answer",
        sessionId: "session-456",
        timestamp: Date.now(),
        sdp: { type: "answer", sdp: "mock-answer" },
        gameCode: "XYZ789",
        hostName: "Host",
        format: "commander",
      };

      const result = generateConnectionString(connectionData);
      const parsed = JSON.parse(result);

      expect(parsed.type).toBe("answer");
    });
  });

  describe("generateICECandidateString", () => {
    it("should generate valid ICE candidate string", () => {
      const candidate: RTCIceCandidateInit = {
        candidate: "candidate:123456789",
        sdpMid: "0",
        sdpMLineIndex: 0,
      };

      const result = generateICECandidateString("session-123", candidate);

      expect(typeof result).toBe("string");
      const parsed = JSON.parse(result);
      expect(parsed.type).toBe("ice-candidate");
      expect(parsed.sessionId).toBe("session-123");
      expect(parsed.candidate).toBeDefined();
    });
  });

  describe("validateConnectionData", () => {
    it("should validate correct connection data", () => {
      const connectionData: ConnectionData = {
        type: "offer",
        sessionId: "session-123",
        timestamp: Date.now(),
        sdp: { type: "offer", sdp: "mock-sdp" },
        gameCode: "ABC123",
        hostName: "Test Host",
        format: "commander",
      };

      expect(validateConnectionData(connectionData)).toBe(true);
    });

    it("should reject missing type", () => {
      const connectionData = {
        sessionId: "session-123",
        timestamp: Date.now(),
        sdp: { type: "offer", sdp: "mock-sdp" },
        gameCode: "ABC123",
      } as any;

      expect(validateConnectionData(connectionData)).toBe(false);
    });

    it("should reject invalid type", () => {
      const connectionData: ConnectionData = {
        type: "invalid" as any,
        sessionId: "session-123",
        timestamp: Date.now(),
        sdp: { type: "offer", sdp: "mock-sdp" },
        gameCode: "ABC123",
        hostName: "Test Host",
        format: "commander",
      };

      expect(validateConnectionData(connectionData)).toBe(false);
    });

    it("should reject old timestamp (more than 1 hour)", () => {
      const connectionData: ConnectionData = {
        type: "offer",
        sessionId: "session-123",
        timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
        sdp: { type: "offer", sdp: "mock-sdp" },
        gameCode: "ABC123",
        hostName: "Test Host",
        format: "commander",
      };

      expect(validateConnectionData(connectionData)).toBe(false);
    });

    it("should accept recent timestamp", () => {
      const connectionData: ConnectionData = {
        type: "offer",
        sessionId: "session-123",
        timestamp: Date.now() - 30 * 60 * 1000, // 30 minutes ago
        sdp: { type: "offer", sdp: "mock-sdp" },
        gameCode: "ABC123",
        hostName: "Test Host",
        format: "commander",
      };

      expect(validateConnectionData(connectionData)).toBe(true);
    });

    it("should reject missing sessionId", () => {
      const connectionData = {
        type: "offer",
        timestamp: Date.now(),
        sdp: { type: "offer", sdp: "mock-sdp" },
        gameCode: "ABC123",
      } as any;

      expect(validateConnectionData(connectionData)).toBe(false);
    });

    it("should reject missing gameCode", () => {
      const connectionData: ConnectionData = {
        type: "offer",
        sessionId: "session-123",
        timestamp: Date.now(),
        sdp: { type: "offer", sdp: "mock-sdp" },
        // missing gameCode
        hostName: "Test Host",
        format: "commander",
      } as any;

      expect(validateConnectionData(connectionData)).toBe(false);
    });
  });

  describe("getConnectionState", () => {
    it("should return null for non-existent session", () => {
      const result = getConnectionState("non-existent-session");
      expect(result).toBeNull();
    });
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

    it("parseConnectionData does not log the raw input on failure", () => {
      // Malicious input that embeds a session id and a game code — even though
      // the current logger prints a static message, this test fails loudly if a
      // future contributor adds `console.error("...", input)`.
      const session = "host-1700000000000-abc12345";
      const gameCode = "ZZZ999";
      const malicious = `{ "sessionId": "${session}", "gameCode": "${gameCode}" }`;

      expect(parseConnectionData(malicious)).toBeNull();

      expect(errorSpy).toHaveBeenCalled();
      for (const call of errorSpy.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain(session);
        expect(serialized).not.toContain(gameCode);
      }
    });

    it("handleICEExchange does not embed sessionId in the thrown error", async () => {
      const sessionId = `host-1700000000000-leak1234`;
      // No session was created for this id, so the manager will reject.
      let caught: unknown = null;
      try {
        await handleICEExchange(sessionId, { candidate: "x" }, {
          playerId: "p1",
          playerName: "p1",
        } as never);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      const message = (caught as Error).message;
      // #982: the sessionId must NOT leak through the thrown error message
      // (it can propagate up to higher-level error reporters / console output).
      expect(message).not.toContain(sessionId);
      // Sanity: the generic message is still informative.
      expect(message).toMatch(/session not found/i);
    });
  });
});

describe("ConnectionData Type", () => {
  it("should have correct type for offer", () => {
    const data: ConnectionData = {
      type: "offer",
      sessionId: "test",
      timestamp: Date.now(),
      sdp: { type: "offer", sdp: "test" },
      gameCode: "TEST",
      hostName: "Host",
      format: "commander",
    };
    expect(data.type).toBe("offer");
  });

  it("should have correct type for answer", () => {
    const data: ConnectionData = {
      type: "answer",
      sessionId: "test",
      timestamp: Date.now(),
      sdp: { type: "answer", sdp: "test" },
      gameCode: "TEST",
      hostName: "Host",
      format: "commander",
    };
    expect(data.type).toBe("answer");
  });
});
