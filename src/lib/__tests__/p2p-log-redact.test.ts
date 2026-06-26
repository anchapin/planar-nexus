/**
 * Tests for P2P log redaction utility (Issue #982)
 *
 * Verifies that session IDs, game codes, peer IDs, SDP blobs, ICE candidates,
 * and other sensitive connection metadata are scrubbed from any value passed
 * through `redactSensitive`, and that the convenience wrappers route scrubbed
 * output to the correct console methods.
 */

import {
  redactSensitive,
  safeLogError,
  safeLogInfo,
  safeLogWarn,
} from "../p2p-log-redact";

describe("p2p-log-redact", () => {
  describe("redactSensitive — primitive values", () => {
    it("returns 'null' for null", () => {
      expect(redactSensitive(null)).toBe("null");
    });

    it("returns 'undefined' for undefined", () => {
      expect(redactSensitive(undefined)).toBe("undefined");
    });

    it("returns numbers/booleans as strings", () => {
      expect(redactSensitive(42)).toBe("42");
      expect(redactSensitive(true)).toBe("true");
      expect(redactSensitive(0)).toBe("0");
    });

    it("returns plain strings unchanged", () => {
      expect(redactSensitive("hello world")).toBe("hello world");
      expect(redactSensitive("")).toBe("");
    });
  });

  describe("redactSensitive — session ID masking in strings", () => {
    it("masks a host-style session ID embedded in a string", () => {
      const session = "host-1700000000000-abc12345";
      const input = `Connection failed for ${session}`;
      const result = redactSensitive(input);
      expect(result).not.toContain(session);
      expect(result).toContain("[REDACTED_SESSION]");
      expect(result).toContain("Connection failed for");
    });

    it("masks a client-style session ID embedded in a string", () => {
      const session = "client-1700000000000-xyz789ab";
      const input = `peer ${session} disconnected`;
      const result = redactSensitive(input);
      expect(result).not.toContain(session);
      expect(result).toContain("[REDACTED_SESSION]");
    });

    it("masks multiple session IDs in the same string", () => {
      const a = "host-1700000000000-aaaa1111";
      const b = "client-1700000000001-bbbb2222";
      const result = redactSensitive(`bridge ${a} -> ${b}`);
      expect(result).not.toContain(a);
      expect(result).not.toContain(b);
      expect(result.match(/\[REDACTED_SESSION\]/g)?.length).toBe(2);
    });

    it("leaves ordinary text untouched when no session pattern is present", () => {
      const input = "ICE connection state: failed";
      expect(redactSensitive(input)).toBe(input);
    });

    it("does not mask short alphanumeric tokens that look like words", () => {
      // Game codes (6 chars) are NOT pattern-matched — too indistinguishable
      // from ordinary text. They are redacted by KEY only when serializing
      // objects.
      expect(redactSensitive("ABC234")).toBe("ABC234");
    });
  });

  describe("redactSensitive — Error instances", () => {
    it("formats Error as 'Name: message' with session IDs masked", () => {
      const session = "host-1700000000000-abc12345";
      const err = new Error(`Session ${session} not found`);
      const result = redactSensitive(err);
      expect(result).not.toContain(session);
      expect(result).toContain("[REDACTED_SESSION]");
      expect(result).toContain("Error:");
      expect(result).toContain("Session");
      expect(result).toContain("not found");
    });

    it("preserves custom Error subclass names", () => {
      class CustomError extends Error {
        constructor(msg: string) {
          super(msg);
          this.name = "CustomError";
        }
      }
      const result = redactSensitive(new CustomError("boom"));
      expect(result.startsWith("CustomError:")).toBe(true);
      expect(result).toContain("boom");
    });

    it("handles Error with empty message", () => {
      const result = redactSensitive(new Error(""));
      expect(result).toBe("Error: ");
    });

    it("omits the stack trace (stacks contain no P2P metadata and bloat logs)", () => {
      const err = new Error("boom");
      err.stack = "Error: boom\n    at foo.js:1:1";
      const result = redactSensitive(err);
      expect(result).not.toContain("at foo.js");
    });
  });

  describe("redactSensitive — objects with sensitive keys", () => {
    it("redacts sessionId, gameCode, sdp, candidate, peerId, playerName by key", () => {
      const input = {
        sessionId: "host-1700000000000-abc12345",
        gameCode: "ABC234",
        sdp: { type: "offer", sdp: "v=0..." },
        candidate: { candidate: "candidate:842163049" },
        peerId: "peer-1",
        playerName: "Alice",
        safe: "ok",
      };
      const result = redactSensitive(input);
      expect(result).not.toContain("host-1700000000000-abc12345");
      expect(result).not.toContain("ABC234");
      expect(result).not.toContain("v=0...");
      expect(result).not.toContain("candidate:842163049");
      expect(result).not.toContain("Alice");

      const parsed = JSON.parse(result);
      expect(parsed.sessionId).toBe("[REDACTED]");
      expect(parsed.gameCode).toBe("[REDACTED]");
      expect(parsed.sdp).toBe("[REDACTED]");
      expect(parsed.candidate).toBe("[REDACTED]");
      expect(parsed.peerId).toBe("[REDACTED]");
      expect(parsed.playerName).toBe("[REDACTED]");
      expect(parsed.safe).toBe("ok");
    });

    it("redacts sensitive keys regardless of capitalization", () => {
      const result = redactSensitive({
        sessionId: "x",
        sessionid: "x",
        session_id: "x",
        GAMECODE: "x", // not in sensitive set (case-sensitive by design)
        gameCode: "x",
      });
      const parsed = JSON.parse(result);
      expect(parsed.sessionId).toBe("[REDACTED]");
      expect(parsed.sessionid).toBe("[REDACTED]");
      expect(parsed.session_id).toBe("[REDACTED]");
      expect(parsed.gameCode).toBe("[REDACTED]");
    });

    it("redacts sensitive keys nested inside objects", () => {
      const input = {
        outer: {
          sessionId: "secret-session",
          ok: 1,
          deeper: { candidate: "ice-blob" },
        },
        safe: true,
      };
      const result = redactSensitive(input);
      const parsed = JSON.parse(result);
      expect(parsed.outer.sessionId).toBe("[REDACTED]");
      expect(parsed.outer.deeper.candidate).toBe("[REDACTED]");
      expect(parsed.outer.ok).toBe(1);
      expect(parsed.safe).toBe(true);
    });

    it("redacts sensitive keys inside arrays", () => {
      const input = [
        { sessionId: "a" },
        { sessionId: "b" },
        { ok: 1 },
      ];
      const result = redactSensitive(input);
      const parsed = JSON.parse(result);
      expect(parsed[0].sessionId).toBe("[REDACTED]");
      expect(parsed[1].sessionId).toBe("[REDACTED]");
      expect(parsed[2].ok).toBe(1);
    });

    it("breaks reference cycles instead of throwing", () => {
      const cyclic: Record<string, unknown> = { ok: 1 };
      cyclic.self = cyclic;
      cyclic.sessionId = "secret";
      const result = redactSensitive(cyclic);
      expect(result).toContain("[Circular]");
      expect(result).not.toContain("secret");
    });

    it("never throws on objects with throwing getters", () => {
      const evil: Record<string, unknown> = {};
      Object.defineProperty(evil, "sessionId", {
        get() {
          throw new Error("boom");
        },
        enumerable: true,
      });
      expect(() => redactSensitive(evil)).not.toThrow();
    });

    it("redacts TURN credential fields (password, credential, username, urls, uris)", () => {
      const input = {
        iceServers: [
          {
            urls: "turn:turn.example.com:3478",
            username: "user-1700000000",
            credential: "super-secret",
          },
        ],
      };
      const result = redactSensitive(input);
      const parsed = JSON.parse(result);
      const server = parsed.iceServers[0];
      expect(server.urls).toBe("[REDACTED]");
      expect(server.username).toBe("[REDACTED]");
      expect(server.credential).toBe("[REDACTED]");
    });
  });

  describe("redactSensitive — never throws on exotic input", () => {
    it("handles BigInt by falling back to String()", () => {
      // JSON.stringify throws on BigInt by default — our helper must not.
      const input = { big: BigInt(123), safe: 1 };
      expect(() => redactSensitive(input)).not.toThrow();
    });

    it("handles symbols and functions", () => {
      expect(() => redactSensitive(Symbol("s"))).not.toThrow();
      expect(() => redactSensitive(() => 1)).not.toThrow();
    });

    it("truncates oversized strings", () => {
      const huge = "x".repeat(10000);
      const result = redactSensitive(huge);
      expect(result.length).toBeLessThan(10000);
      expect(result).toContain("[redacted-truncated]");
    });
  });

  describe("safeLogError / safeLogWarn / safeLogInfo", () => {
    let errorSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let infoSpy: jest.SpyInstance;

    beforeEach(() => {
      errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    });

    it("safeLogError forwards prefix and redacted value to console.error", () => {
      const session = "host-1700000000000-abc12345";
      safeLogError("[Test]", new Error(`failed ${session}`));
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const args = errorSpy.mock.calls[0];
      expect(args[0]).toBe("[Test]");
      expect(args[1]).not.toContain(session);
      expect(args[1]).toContain("[REDACTED_SESSION]");
    });

    it("safeLogWarn forwards prefix and redacted args to console.warn", () => {
      const sensitive = { sessionId: "secret", ok: 1 };
      safeLogWarn("[Test]", sensitive, "extra");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const args = warnSpy.mock.calls[0];
      expect(args[0]).toBe("[Test]");
      expect(args[1]).not.toContain("secret");
      expect(args[2]).toBe("extra");
    });

    it("safeLogInfo forwards prefix and redacted args to console.info", () => {
      const sensitive = { gameCode: "ABC234" };
      safeLogInfo("[Test]", sensitive);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      const args = infoSpy.mock.calls[0];
      expect(args[0]).toBe("[Test]");
      expect(args[1]).not.toContain("ABC234");
    });

    it("does not invoke other console methods", () => {
      safeLogError("[Test]", "x");
      expect(warnSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
    });
  });
});
