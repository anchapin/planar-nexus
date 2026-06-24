/**
 * Tests for P2P failure diagnostics
 * Issue #926: surface actionable diagnostics instead of failing silently when
 * a TURN relay is unconfigured/unreachable.
 */

import {
  hasTurnServer,
  classifyConnectionFailure,
  getFailureMessage,
  type ClassifyFailureInput,
} from "../p2p-failure-diagnostics";

describe("hasTurnServer", () => {
  it("returns false when config is null/undefined", () => {
    expect(hasTurnServer(null)).toBe(false);
    expect(hasTurnServer(undefined)).toBe(false);
  });

  it("returns false when iceServers is empty", () => {
    expect(hasTurnServer({ iceServers: [] })).toBe(false);
  });

  it("returns false for STUN-only config", () => {
    expect(
      hasTurnServer({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      }),
    ).toBe(false);
  });

  it("returns true when a turn:// URL is present", () => {
    expect(
      hasTurnServer({
        iceServers: [{ urls: "turn:turn.example.com:3478" }],
      }),
    ).toBe(true);
  });

  it("returns true when a turns:// URL is present", () => {
    expect(
      hasTurnServer({
        iceServers: [{ urls: "turns:turn.example.com:443" }],
      }),
    ).toBe(true);
  });

  it("returns true when turn is in a urls array", () => {
    expect(
      hasTurnServer({
        iceServers: [
          { urls: ["stun:stun.example.com", "turn:turn.example.com"] },
        ],
      }),
    ).toBe(true);
  });

  it("is case-insensitive for turn/turns schemes", () => {
    expect(
      hasTurnServer({ iceServers: [{ urls: "TURN:turn.example.com:3478" }] }),
    ).toBe(true);
    expect(
      hasTurnServer({ iceServers: [{ urls: "Turns:turn.example.com:443" }] }),
    ).toBe(true);
  });

  it("returns false for non-turn/stuns schemes", () => {
    expect(
      hasTurnServer({
        iceServers: [{ urls: "stun:stun.example.com:3478" }],
      }),
    ).toBe(false);
    expect(
      hasTurnServer({
        iceServers: [{ urls: "http:example.com" }],
      }),
    ).toBe(false);
  });
});

describe("classifyConnectionFailure", () => {
  it('maps "signaling" context to SIGNALING_UNREACHABLE', () => {
    const result = classifyConnectionFailure({ failureContext: "signaling" });
    expect(result.category).toBe("SIGNALING_UNREACHABLE");
    expect(result.reason).toContain("signaling");
    expect(result.remediation).toBeTruthy();
  });

  it('maps "peer" context to PEER_UNREACHABLE', () => {
    const result = classifyConnectionFailure({ failureContext: "peer" });
    expect(result.category).toBe("PEER_UNREACHABLE");
    expect(result.reason).toContain("peer");
    expect(result.remediation).toBeTruthy();
  });

  it('maps "ice" context + no TURN server to TURN_UNCONFIGURED (#926)', () => {
    const result = classifyConnectionFailure({
      failureContext: "ice",
      rtcConfig: { iceServers: [{ urls: "stun:stun.example.com" }] },
    });
    expect(result.category).toBe("TURN_UNCONFIGURED");
    expect(result.reason).toContain("TURN");
  });

  it('maps "ice" context + TURN configured to ICE_FAILED', () => {
    const result = classifyConnectionFailure({
      failureContext: "ice",
      rtcConfig: { iceServers: [{ urls: "turn:turn.example.com:3478" }] },
    });
    expect(result.category).toBe("ICE_FAILED");
    expect(result.reason).toContain("ICE failed");
  });

  it('maps "generic" context to UNKNOWN', () => {
    const result = classifyConnectionFailure({ failureContext: "generic" });
    expect(result.category).toBe("UNKNOWN");
  });

  it("defaults to generic context", () => {
    const result = classifyConnectionFailure({});
    expect(result.category).toBe("UNKNOWN");
  });

  it("appends cause to reason when provided", () => {
    const result = classifyConnectionFailure({
      failureContext: "ice",
      rtcConfig: { iceServers: [{ urls: "stun:stun.example.com" }] },
      cause: "iceConnectionState=failed",
    });
    expect(result.reason).toContain("iceConnectionState=failed");
  });

  it("includes remediation in result", () => {
    const result = classifyConnectionFailure({ failureContext: "signaling" });
    expect(typeof result.remediation).toBe("string");
    expect(result.remediation.length).toBeGreaterThan(0);
  });
});

describe("getFailureMessage", () => {
  it("combines reason and remediation into a single string", () => {
    const diagnostic = classifyConnectionFailure({
      failureContext: "signaling",
    });
    const message = getFailureMessage(diagnostic);
    expect(message).toContain(diagnostic.reason);
    expect(message).toContain(diagnostic.remediation);
  });
});

describe("failure classification scenarios", () => {
  it("detects TURN_UNCONFIGURED when iceServers is undefined", () => {
    const result = classifyConnectionFailure({
      failureContext: "ice",
      rtcConfig: undefined,
    });
    expect(result.category).toBe("TURN_UNCONFIGURED");
  });

  it("detects TURN_UNCONFIGURED when iceServers is empty array", () => {
    const result = classifyConnectionFailure({
      failureContext: "ice",
      rtcConfig: { iceServers: [] },
    });
    expect(result.category).toBe("TURN_UNCONFIGURED");
  });

  it("detects ICE_FAILED when TURN server exists alongside STUN", () => {
    const result = classifyConnectionFailure({
      failureContext: "ice",
      rtcConfig: {
        iceServers: [
          { urls: "stun:stun.example.com" },
          { urls: "turn:turn.example.com" },
        ],
      },
    });
    expect(result.category).toBe("ICE_FAILED");
  });
});
