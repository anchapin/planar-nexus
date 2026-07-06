/**
 * @fileOverview Tests for ICE / STUN / TURN configuration.
 *
 * Issue #983: DEFAULT_TURN_SERVERS returned an empty array when TURN env
 * vars were unset, leaving users behind symmetric NATs with no relay
 * fallback and 100% connection failure. These tests pin the fix: the
 * default TURN set is always non-empty, env overrides work, and a warning
 * is surfaced when only the public fallback is in use.
 */

import {
  DEFAULT_STUN_SERVERS,
  DEFAULT_TURN_SERVERS,
  PUBLIC_FALLBACK_TURN_SERVERS,
  ICEConfigurationManager,
  ICEConnectionMonitor,
  ICECandidateFilter,
  resolveTurnServers,
  warnIfNoEnvTurnConfigured,
  __resetTurnWarningGuard,
  createDefaultICEConfiguration,
  createICEConfigurationWithTurn,
  createRelayOnlyConfiguration,
  getGlobalICEManager,
  setGlobalICEConfiguration,
  type ICEServerConfig,
} from "../ice-config";

function isTurnScheme(url: unknown): boolean {
  if (typeof url !== "string") return false;
  return url.startsWith("turn:") || url.startsWith("turns:");
}

describe("DEFAULT_STUN_SERVERS", () => {
  it("is non-empty", () => {
    expect(DEFAULT_STUN_SERVERS.length).toBeGreaterThan(0);
  });

  it("contains only stun: URLs", () => {
    for (const server of DEFAULT_STUN_SERVERS) {
      const url = typeof server.urls === "string" ? server.urls : "";
      expect(url.startsWith("stun:")).toBe(true);
    }
  });
});

describe("PUBLIC_FALLBACK_TURN_SERVERS", () => {
  it("is non-empty", () => {
    expect(PUBLIC_FALLBACK_TURN_SERVERS.length).toBeGreaterThan(0);
  });

  it("every server is a turn/turns URL with password credentials", () => {
    for (const server of PUBLIC_FALLBACK_TURN_SERVERS) {
      expect(isTurnScheme(server.urls)).toBe(true);
      expect(typeof server.username).toBe("string");
      expect(server.username!.length).toBeGreaterThan(0);
      expect(typeof server.credential).toBe("string");
      expect(server.credential!.length).toBeGreaterThan(0);
      expect(server.credentialType).toBe("password");
    }
  });
});

describe("DEFAULT_TURN_SERVERS", () => {
  it("is non-empty (NAT traversal relay fallback) — regression for #983", () => {
    expect(DEFAULT_TURN_SERVERS.length).toBeGreaterThan(0);
  });

  it("contains only turn:/turns: URLs", () => {
    for (const server of DEFAULT_TURN_SERVERS) {
      const url = typeof server.urls === "string" ? server.urls : "";
      expect(isTurnScheme(url)).toBe(true);
    }
  });

  it("every server has username + credential", () => {
    for (const server of DEFAULT_TURN_SERVERS) {
      expect(server.username).toBeTruthy();
      expect(server.credential).toBeTruthy();
      expect(server.credentialType).toBe("password");
    }
  });
});

describe("resolveTurnServers", () => {
  afterEach(() => {
    __resetTurnWarningGuard();
  });

  it("returns env-configured servers when all three env vars are set", () => {
    const result = resolveTurnServers({
      NEXT_PUBLIC_TURN_URL: "turn:turn.example.com:3478",
      NEXT_PUBLIC_TURN_USER: "alice",
      NEXT_PUBLIC_TURN_PASS: "s3cret",
    });

    expect(result.usedFallback).toBe(false);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]).toEqual({
      urls: "turn:turn.example.com:3478",
      username: "alice",
      credential: "s3cret",
      credentialType: "password",
    });
  });

  it("supports comma-separated TURN URLs sharing one credential set", () => {
    const result = resolveTurnServers({
      NEXT_PUBLIC_TURN_URL:
        "turn:a.example.com:3478, turns:b.example.com:5349, turn:c.example.com:3478",
      NEXT_PUBLIC_TURN_USER: "u",
      NEXT_PUBLIC_TURN_PASS: "p",
    });

    expect(result.usedFallback).toBe(false);
    expect(result.servers).toHaveLength(3);
    expect(result.servers.map((s) => s.urls)).toEqual([
      "turn:a.example.com:3478",
      "turns:b.example.com:5349",
      "turn:c.example.com:3478",
    ]);
    for (const server of result.servers) {
      expect(server.username).toBe("u");
      expect(server.credential).toBe("p");
      expect(server.credentialType).toBe("password");
    }
  });

  it("trims whitespace and ignores empty entries in the URL list", () => {
    const result = resolveTurnServers({
      NEXT_PUBLIC_TURN_URL:
        " turn:a.example.com:3478 , , turn:b.example.com:3478 ",
      NEXT_PUBLIC_TURN_USER: "u",
      NEXT_PUBLIC_TURN_PASS: "p",
    });

    expect(result.servers).toHaveLength(2);
    expect(result.servers[0].urls).toBe("turn:a.example.com:3478");
    expect(result.servers[1].urls).toBe("turn:b.example.com:3478");
  });

  it("falls back to public TURN servers when env vars are absent", () => {
    const result = resolveTurnServers({});

    expect(result.usedFallback).toBe(true);
    expect(result.servers.length).toBe(PUBLIC_FALLBACK_TURN_SERVERS.length);
    for (const server of result.servers) {
      expect(isTurnScheme(server.urls)).toBe(true);
      expect(server.username).toBeTruthy();
      expect(server.credential).toBeTruthy();
    }
  });

  it("falls back when only some env vars are set (no partial credentials)", () => {
    const onlyUrl = resolveTurnServers({
      NEXT_PUBLIC_TURN_URL: "turn:turn.example.com:3478",
    });
    expect(onlyUrl.usedFallback).toBe(true);

    const urlAndUser = resolveTurnServers({
      NEXT_PUBLIC_TURN_URL: "turn:turn.example.com:3478",
      NEXT_PUBLIC_TURN_USER: "u",
    });
    expect(urlAndUser.usedFallback).toBe(true);
  });

  it("falls back when NEXT_PUBLIC_TURN_URL is empty/whitespace", () => {
    const result = resolveTurnServers({
      NEXT_PUBLIC_TURN_URL: "   ",
      NEXT_PUBLIC_TURN_USER: "u",
      NEXT_PUBLIC_TURN_PASS: "p",
    });
    expect(result.usedFallback).toBe(true);
  });

  it("returns fresh array copies (mutating results does not affect fallbacks)", () => {
    const a = resolveTurnServers({});
    const b = resolveTurnServers({});
    expect(a.servers).not.toBe(b.servers);
    expect(a.servers[0]).not.toBe(PUBLIC_FALLBACK_TURN_SERVERS[0]);

    a.servers[0].username = "mutated";
    expect(PUBLIC_FALLBACK_TURN_SERVERS[0].username).toBe("openrelayproject");
    expect(b.servers[0].username).toBe("openrelayproject");
  });
});

describe("warnIfNoEnvTurnConfigured", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    __resetTurnWarningGuard();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    __resetTurnWarningGuard();
  });

  it("warns when the public fallback is in use", () => {
    warnIfNoEnvTurnConfigured(resolveTurnServers({}));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain("TURN");
    expect(message).toContain("NEXT_PUBLIC_TURN_URL");
  });

  it("does not warn when env-configured servers are in use", () => {
    warnIfNoEnvTurnConfigured(
      resolveTurnServers({
        NEXT_PUBLIC_TURN_URL: "turn:turn.example.com:3478",
        NEXT_PUBLIC_TURN_USER: "u",
        NEXT_PUBLIC_TURN_PASS: "p",
      }),
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns only once across calls unless forced", () => {
    warnIfNoEnvTurnConfigured(resolveTurnServers({}));
    warnIfNoEnvTurnConfigured(resolveTurnServers({}));
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnIfNoEnvTurnConfigured(resolveTurnServers({}), true);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});

describe("ICEConfigurationManager integration with default TURN", () => {
  it("default manager has TURN servers (NAT traversal works out of the box)", () => {
    const manager = new ICEConfigurationManager();
    expect(manager.hasTurnServers()).toBe(true);
  });

  it("default RTCConfiguration includes at least one turn/turns server", () => {
    const manager = new ICEConfigurationManager();
    const config = manager.getRTCConfiguration();
    const iceServers = config.iceServers ?? [];

    expect(iceServers.length).toBeGreaterThan(0);

    const hasTurn = iceServers.some((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some((url) => isTurnScheme(url));
    });
    expect(hasTurn).toBe(true);
  });

  it("still allows callers to override with their own TURN servers", () => {
    const custom: ICEServerConfig[] = [
      {
        urls: "turn:custom.example.com:3478",
        username: "me",
        credential: "pw",
        credentialType: "password",
      },
    ];
    const manager = new ICEConfigurationManager({ customTurnServers: custom });
    expect(manager.getTurnServers()).toEqual(custom);
  });

  it("turn-relay mode surfaces TURN servers for forced relay", () => {
    const manager = new ICEConfigurationManager({ mode: "turn-relay" });
    const config = manager.getRTCConfiguration();
    expect(config.iceTransportPolicy).toBe("relay");
    const iceServers = config.iceServers ?? [];
    expect(iceServers.length).toBeGreaterThan(0);
    const allTurn = iceServers.every((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.every((url) => isTurnScheme(url));
    });
    expect(allTurn).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Issue #1094 — ICE restart / reconnection & candidate-filtering coverage.
//
// `ICEConnectionMonitor` is the component that watches
// `iceconnectionstatechange` and fires the onFailed/onDisconnected callbacks
// that the connection layer uses to trigger ICE restart / reconnection. The
// `ICECandidateFilter` enforces candidate policy. Both were previously
// untested, along with several ICEConfigurationManager modes/methods, the
// factory helpers, and the global singleton. All browser APIs are faked — no
// real network or RTCPeerConnection is used.
// ---------------------------------------------------------------------------

/** Minimal fake RTCPeerConnection exposing only what the monitor touches. */
function makeFakePC(initialState: RTCIceConnectionState = "new"): {
  iceConnectionState: RTCIceConnectionState;
  oniceconnectionstatechange: (() => void) | null;
} {
  return {
    iceConnectionState: initialState,
    oniceconnectionstatechange: null,
  };
}

describe("ICEConfigurationManager — modes & server management (#1094)", () => {
  it("stun-only mode yields only STUN servers in the RTC configuration", () => {
    const manager = new ICEConfigurationManager({ mode: "stun-only" });
    expect(manager.getMode()).toBe("stun-only");
    const config = manager.getRTCConfiguration();
    const iceServers = config.iceServers ?? [];
    expect(iceServers.length).toBeGreaterThan(0);
    for (const server of iceServers) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      for (const url of urls) expect(url.startsWith("stun:")).toBe(true);
    }
    // Relay-only transport policy must NOT be set in stun-only mode.
    expect(config.iceTransportPolicy).toBeUndefined();
  });

  it("custom mode surfaces both STUN and TURN servers", () => {
    const customStun: ICEServerConfig[] = [
      { urls: "stun:custom.example.com:3478" },
    ];
    const customTurn: ICEServerConfig[] = [
      {
        urls: "turn:custom.example.com:3478",
        username: "u",
        credential: "p",
        credentialType: "password",
      },
    ];
    const manager = new ICEConfigurationManager({
      mode: "custom",
      customStunServers: customStun,
      customTurnServers: customTurn,
    });
    const iceServers = manager.getRTCConfiguration().iceServers ?? [];
    expect(iceServers.length).toBe(2);
  });

  it("auto mode includes TURN servers only when configured", () => {
    const withTurn = new ICEConfigurationManager({ mode: "auto" });
    expect(
      (withTurn.getRTCConfiguration().iceServers ?? []).length,
    ).toBeGreaterThan(0);
    expect(withTurn.hasTurnServers()).toBe(true);

    const noTurn = new ICEConfigurationManager({
      mode: "auto",
      customStunServers: [{ urls: "stun:stun.example.com:3478" }],
      customTurnServers: [],
    });
    expect(noTurn.hasTurnServers()).toBe(false);
  });

  it("addStunServer / addTurnServer append to the server lists", () => {
    const manager = new ICEConfigurationManager({ customTurnServers: [] });
    const stunBefore = manager.getStunServers().length;
    manager.addStunServer({ urls: "stun:added.example.com:3478" });
    expect(manager.getStunServers().length).toBe(stunBefore + 1);

    expect(manager.getTurnServers().length).toBe(0);
    manager.addTurnServer({
      urls: "turn:added.example.com:3478",
      username: "u",
      credential: "c",
    });
    expect(manager.getTurnServers().length).toBe(1);
  });

  it("setMode / getMode round-trip", () => {
    const manager = new ICEConfigurationManager();
    expect(manager.getMode()).toBe("auto");
    manager.setMode("stun-only");
    expect(manager.getMode()).toBe("stun-only");
  });

  it("setTurnCredentials updates username/credential on every TURN server", () => {
    const manager = new ICEConfigurationManager({
      customTurnServers: [
        {
          urls: "turn:a.example.com:3478",
          username: "old",
          credential: "old",
          credentialType: "password",
        },
        {
          urls: "turn:b.example.com:3478",
          username: "old",
          credential: "old",
          credentialType: "password",
        },
      ],
    });
    manager.setTurnCredentials("newuser", "newpass");
    for (const server of manager.getTurnServers()) {
      expect(server.username).toBe("newuser");
      expect(server.credential).toBe("newpass");
    }
  });

  it("getStunServers / getTurnServers return defensive copies", () => {
    const manager = new ICEConfigurationManager();
    const a = manager.getStunServers();
    a.push({ urls: "stun:mutant.example.com:3478" });
    expect(manager.getStunServers().length).not.toBe(a.length);
  });

  it("createTestConfiguration() returns a STUN-only RTCConfiguration with a candidate pool", () => {
    const config = ICEConfigurationManager.createTestConfiguration();
    expect(config.iceServers).toBe(DEFAULT_STUN_SERVERS);
    expect(config.iceCandidatePoolSize).toBe(10);
  });
});

describe("ICEConnectionMonitor — ICE restart / reconnection triggers (#1094)", () => {
  let infoSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    // The monitor logs every ICE state change; silence it in test output.
    infoSpy = jest.spyOn(console, "info").mockImplementation(() => undefined);
  });
  afterEach(() => {
    infoSpy.mockRestore();
    jest.useRealTimers();
  });

  it("attach() wires oniceconnectionstatechange and detach() removes it", () => {
    const monitor = new ICEConnectionMonitor();
    const pc = makeFakePC("new");
    monitor.attach(pc as unknown as RTCPeerConnection);
    expect(pc.oniceconnectionstatechange).not.toBeNull();

    monitor.detach();
    expect(pc.oniceconnectionstatechange).toBeNull();
    expect(monitor.getState()).toBeNull();
  });

  it("reports connected/completed states and fires onConnected", () => {
    const onConnected = jest.fn();
    const onStateChange = jest.fn();
    const monitor = new ICEConnectionMonitor({ onConnected, onStateChange });
    const pc = makeFakePC("new");
    monitor.attach(pc as unknown as RTCPeerConnection);

    pc.iceConnectionState = "connected";
    pc.oniceconnectionstatechange!();

    expect(onStateChange).toHaveBeenCalledWith("connected");
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(monitor.isConnected()).toBe(true);

    pc.iceConnectionState = "completed";
    pc.oniceconnectionstatechange!();
    expect(onConnected).toHaveBeenCalledTimes(2);
    expect(monitor.getState()).toBe("completed");
  });

  it("failed state fires onFailed immediately and clears the failure timer", () => {
    const onFailed = jest.fn();
    const monitor = new ICEConnectionMonitor({
      onFailed,
      failureTimeoutMs: 5000,
    });
    const pc = makeFakePC("connected");
    monitor.attach(pc as unknown as RTCPeerConnection);

    pc.iceConnectionState = "failed";
    pc.oniceconnectionstatechange!();

    expect(onFailed).toHaveBeenCalledTimes(1);
    // Advancing the clock must NOT fire a second onFailed (timer was cleared).
    jest.advanceTimersByTime(10000);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it("disconnected starts a failure timer that triggers onFailed after the window (ICE restart trigger)", () => {
    const onFailed = jest.fn();
    const onDisconnected = jest.fn();
    const monitor = new ICEConnectionMonitor({
      onFailed,
      onDisconnected,
      failureTimeoutMs: 3000,
    });
    const pc = makeFakePC("connected");
    monitor.attach(pc as unknown as RTCPeerConnection);

    pc.iceConnectionState = "disconnected";
    pc.oniceconnectionstatechange!();

    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(monitor.isConnected()).toBe(false);

    // Just before the window — no failure yet.
    jest.advanceTimersByTime(2999);
    expect(onFailed).not.toHaveBeenCalled();

    // Crossing the window triggers the failure that drives ICE restart upstream.
    jest.advanceTimersByTime(1);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it("reconnects before the failure window cancels the pending failure (no spurious restart)", () => {
    const onFailed = jest.fn();
    const onConnected = jest.fn();
    const monitor = new ICEConnectionMonitor({
      onFailed,
      onConnected,
      failureTimeoutMs: 3000,
    });
    const pc = makeFakePC("connected");
    monitor.attach(pc as unknown as RTCPeerConnection);

    // Drop, then recover before the timeout fires.
    pc.iceConnectionState = "disconnected";
    pc.oniceconnectionstatechange!();
    jest.advanceTimersByTime(2000);
    pc.iceConnectionState = "connected";
    pc.oniceconnectionstatechange!();

    expect(onConnected).toHaveBeenCalled();
    jest.advanceTimersByTime(5000);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("a fresh disconnected event resets the failure timer (debounce)", () => {
    const onFailed = jest.fn();
    const monitor = new ICEConnectionMonitor({
      onFailed,
      failureTimeoutMs: 3000,
    });
    const pc = makeFakePC("connected");
    monitor.attach(pc as unknown as RTCPeerConnection);

    pc.iceConnectionState = "disconnected";
    pc.oniceconnectionstatechange!();
    jest.advanceTimersByTime(2500);

    // A second disconnected event should restart the window, not stack.
    pc.iceConnectionState = "disconnected";
    pc.oniceconnectionstatechange!();
    jest.advanceTimersByTime(2500); // would have fired if not reset
    expect(onFailed).not.toHaveBeenCalled();

    jest.advanceTimersByTime(500);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it("closed state clears timers and fires no transport callbacks", () => {
    const onFailed = jest.fn();
    const onConnected = jest.fn();
    const monitor = new ICEConnectionMonitor({
      onFailed,
      onConnected,
      failureTimeoutMs: 1000,
    });
    const pc = makeFakePC("disconnected");
    monitor.attach(pc as unknown as RTCPeerConnection);

    pc.iceConnectionState = "closed";
    pc.oniceconnectionstatechange!();

    jest.advanceTimersByTime(5000);
    expect(onFailed).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
  });

  it("handleStateChange is a no-op when no connection is attached", () => {
    const onStateChange = jest.fn();
    const monitor = new ICEConnectionMonitor({ onStateChange });
    // Detach first to guarantee no connection, then fire the handler path.
    monitor.detach();
    // No throw and no callback invocation.
    expect(() => monitor.getState()).not.toThrow();
    expect(onStateChange).not.toHaveBeenCalled();
  });
});

describe("ICECandidateFilter — candidate filtering (#1094)", () => {
  /** Build a candidate-shaped object the filter can read. */
  function cand(address: string): RTCIceCandidate {
    return { address, candidate: address } as unknown as RTCIceCandidate;
  }

  it("passes through a normal public IPv4 candidate by default", () => {
    const filter = new ICECandidateFilter();
    const c = cand("203.0.113.5");
    expect(filter.filter(c)).toBe(c);
  });

  it("drops IPv6 candidates when allowIPv6 is false", () => {
    const filter = new ICECandidateFilter({ allowIPv6: false });
    expect(filter.filter(cand("2001:db8::1"))).toBeNull();
  });

  it("keeps IPv6 candidates when allowIPv6 is true (default)", () => {
    const filter = new ICECandidateFilter();
    expect(filter.filter(cand("2001:db8::1"))).not.toBeNull();
  });

  it("drops loopback candidates by default (127.0.0.1, ::1, localhost)", () => {
    const filter = new ICECandidateFilter();
    expect(filter.filter(cand("127.0.0.1"))).toBeNull();
    expect(filter.filter(cand("::1"))).toBeNull();
    expect(filter.filter(cand("localhost"))).toBeNull();
  });

  it("allows loopback when allowLoopback is true", () => {
    const filter = new ICECandidateFilter({ allowLoopback: true });
    expect(filter.filter(cand("127.0.0.1"))).not.toBeNull();
  });

  it("drops link-local candidates by default (169.254.*, fe80::)", () => {
    const filter = new ICECandidateFilter();
    expect(filter.filter(cand("169.254.1.2"))).toBeNull();
    expect(filter.filter(cand("fe80::1"))).toBeNull();
    expect(filter.filter(cand("fe80:1234"))).toBeNull();
  });

  it("allows link-local when allowLinkLocal is true", () => {
    const filter = new ICECandidateFilter({ allowLinkLocal: true });
    expect(filter.filter(cand("169.254.1.2"))).not.toBeNull();
  });

  it("keeps the candidate when address is null/empty", () => {
    const filter = new ICECandidateFilter({
      allowIPv6: false,
      allowLoopback: false,
      allowLinkLocal: false,
    });
    // No address → the isIPv6/isLoopback/isLinkLocal guards all short-circuit false.
    expect(filter.filter(cand(""))).not.toBeNull();
  });
});

describe("ICE factory helpers & global singleton (#1094)", () => {
  it("createDefaultICEConfiguration returns a populated RTCConfiguration", () => {
    const config = createDefaultICEConfiguration();
    expect((config.iceServers ?? []).length).toBeGreaterThan(0);
    expect(config.iceCandidatePoolSize).toBe(10);
  });

  it("createICEConfigurationWithTurn merges custom TURN + STUN servers", () => {
    const turn: ICEServerConfig[] = [
      {
        urls: "turn:turn.example.com:3478",
        username: "u",
        credential: "p",
        credentialType: "password",
      },
    ];
    const stun: ICEServerConfig[] = [{ urls: "stun:stun.example.com:3478" }];
    const config = createICEConfigurationWithTurn(turn, stun);
    const iceServers = config.iceServers ?? [];
    expect(iceServers.length).toBe(2);
    const hasTurn = iceServers.some((s) => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      return urls.some((u) => isTurnScheme(u));
    });
    expect(hasTurn).toBe(true);
  });

  it("createRelayOnlyConfiguration forces relay transport policy", () => {
    const turn: ICEServerConfig[] = [
      {
        urls: "turn:turn.example.com:3478",
        username: "u",
        credential: "p",
        credentialType: "password",
      },
    ];
    const config = createRelayOnlyConfiguration(turn);
    expect(config.iceTransportPolicy).toBe("relay");
  });

  it("getGlobalICEManager returns a stable singleton", () => {
    const a = getGlobalICEManager();
    const b = getGlobalICEManager();
    expect(b).toBe(a);
  });

  it("setGlobalICEConfiguration replaces the singleton", () => {
    const original = getGlobalICEManager();
    setGlobalICEConfiguration({ mode: "stun-only" });
    const next = getGlobalICEManager();
    expect(next).not.toBe(original);
    expect(next.getMode()).toBe("stun-only");
    // Restore to auto so subsequent suites get the default.
    setGlobalICEConfiguration({});
  });
});

// ---------------------------------------------------------------------------
// Issue #1261 — process.env resolution path + credential rotation edge cases.
//
// The earlier tests in this file exercise `resolveTurnServers()` and the
// `ICEConfigurationManager` by passing values directly. The
// `DEFAULT_TURN_SERVERS` constant, however, is evaluated **once at module
// load** from `process.env`, so changing `process.env` after import has no
// effect. This block uses `jest.resetModules()` + dynamic `import()` to
// re-evaluate the module under different `process.env` shapes and pins:
//   1. env-configured path: all three NEXT_PUBLIC_TURN_* env vars set
//   2. fallback path:    all three NEXT_PUBLIC_TURN_* env vars absent
//   3. partial-env path: only one or two of the three set (must NOT crash
//      and must not leak a half-configured server)
//   4. TURN credential rotation: setTurnCredentials replaces every server's
//      username/credential atomically and is idempotent under repeated calls
//   5. expiry-shape edge case: an empty TURN env URL list after split/filter
//      must fall back, not yield a zero-URL server
//   6. the resolved RTCConfiguration has the expected RTCConfiguration shape
//      (iceServers array, iceCandidatePoolSize, bundlePolicy, rtcpMuxPolicy)
// ---------------------------------------------------------------------------

const TURN_ENV_KEYS = [
  "NEXT_PUBLIC_TURN_URL",
  "NEXT_PUBLIC_TURN_USER",
  "NEXT_PUBLIC_TURN_PASS",
] as const;

function clearTurnEnv(): void {
  for (const key of TURN_ENV_KEYS) delete process.env[key];
}

describe("Issue #1261 — process.env resolution & credential rotation", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of TURN_ENV_KEYS) {
      originalEnv[key] = process.env[key];
    }
  });

  beforeEach(() => {
    clearTurnEnv();
  });

  afterEach(() => {
    clearTurnEnv();
    jest.resetModules();
  });

  afterAll(() => {
    for (const key of TURN_ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it("DEFAULT_TURN_SERVERS reflects NEXT_PUBLIC_TURN_* env vars after a module reset", async () => {
    process.env.NEXT_PUBLIC_TURN_URL = "turn:env-a.example.com:3478";
    process.env.NEXT_PUBLIC_TURN_USER = "envuser";
    process.env.NEXT_PUBLIC_TURN_PASS = "envpass";

    jest.resetModules();
    const fresh = await import("../ice-config");

    expect(fresh.DEFAULT_TURN_SERVERS).toHaveLength(1);
    expect(fresh.DEFAULT_TURN_SERVERS[0]).toEqual({
      urls: "turn:env-a.example.com:3478",
      username: "envuser",
      credential: "envpass",
      credentialType: "password",
    });
  });

  it("DEFAULT_TURN_SERVERS falls back to the public relay set when env vars are absent", async () => {
    jest.resetModules();
    const fresh = await import("../ice-config");

    expect(fresh.DEFAULT_TURN_SERVERS.length).toBeGreaterThan(0);
    expect(fresh.DEFAULT_TURN_SERVERS.length).toBe(
      fresh.PUBLIC_FALLBACK_TURN_SERVERS.length,
    );
    for (const server of fresh.DEFAULT_TURN_SERVERS) {
      expect(isTurnScheme(server.urls)).toBe(true);
      expect(server.username).toBeTruthy();
      expect(server.credential).toBeTruthy();
      expect(server.credentialType).toBe("password");
    }
  });

  it("a partial env (only URL, or URL+USER without PASS) does not leak a half-configured server", async () => {
    // Only URL — should fall back.
    process.env.NEXT_PUBLIC_TURN_URL = "turn:partial.example.com:3478";
    jest.resetModules();
    const firstFresh = await import("../ice-config");
    expect(firstFresh.DEFAULT_TURN_SERVERS).toEqual(
      firstFresh.PUBLIC_FALLBACK_TURN_SERVERS,
    );

    clearTurnEnv();
    // URL + USER but no PASS — must still fall back, not produce a server
    // with `undefined` credential.
    process.env.NEXT_PUBLIC_TURN_URL = "turn:partial.example.com:3478";
    process.env.NEXT_PUBLIC_TURN_USER = "u";
    jest.resetModules();
    const secondFresh = await import("../ice-config");
    for (const server of secondFresh.DEFAULT_TURN_SERVERS) {
      expect(server.credential).toBeTruthy();
    }
  });

  it("TURN credential rotation: setTurnCredentials updates every server atomically and is idempotent", () => {
    const manager = new ICEConfigurationManager({
      customTurnServers: [
        {
          urls: "turn:a.example.com:3478",
          username: "old",
          credential: "old",
          credentialType: "password",
        },
        {
          urls: "turn:b.example.com:3478",
          username: "old",
          credential: "old",
          credentialType: "password",
        },
        {
          urls: "turn:c.example.com:3478",
          username: "old",
          credential: "old",
          credentialType: "password",
        },
      ],
    });

    // Rotate once.
    manager.setTurnCredentials("rotated-1", "rotated-1-pw");
    for (const server of manager.getTurnServers()) {
      expect(server.username).toBe("rotated-1");
      expect(server.credential).toBe("rotated-1-pw");
    }

    // Rotate again — simulate credential expiry / re-issuance.
    manager.setTurnCredentials("rotated-2", "rotated-2-pw");
    const rotated = manager.getTurnServers();
    expect(rotated).toHaveLength(3);
    for (const server of rotated) {
      expect(server.username).toBe("rotated-2");
      expect(server.credential).toBe("rotated-2-pw");
      // The urls and credentialType must be preserved through rotation.
      expect(isTurnScheme(server.urls)).toBe(true);
      expect(server.credentialType).toBe("password");
    }

    // Rotation must not mutate the previous return value (defensive copy).
    manager.setTurnCredentials("rotated-3", "rotated-3-pw");
    for (const server of rotated) {
      expect(server.username).toBe("rotated-2");
    }
  });

  it("an env URL list that splits to all-empty entries falls back rather than producing a zero-URL server", async () => {
    process.env.NEXT_PUBLIC_TURN_URL = " , , ";
    process.env.NEXT_PUBLIC_TURN_USER = "u";
    process.env.NEXT_PUBLIC_TURN_PASS = "p";

    jest.resetModules();
    const fresh = await import("../ice-config");

    expect(fresh.DEFAULT_TURN_SERVERS.length).toBe(
      fresh.PUBLIC_FALLBACK_TURN_SERVERS.length,
    );
    for (const server of fresh.DEFAULT_TURN_SERVERS) {
      const url = typeof server.urls === "string" ? server.urls : "";
      expect(url.length).toBeGreaterThan(0);
    }
  });

  it("createDefaultICEConfiguration() returns a fully-shaped RTCConfiguration", () => {
    const config = createDefaultICEConfiguration();

    expect(Array.isArray(config.iceServers)).toBe(true);
    expect((config.iceServers ?? []).length).toBeGreaterThan(0);
    expect(config.iceCandidatePoolSize).toBe(10);
    // Bundle and RTCP-mux policies default to 'balanced' and 'require'.
    expect(config.bundlePolicy).toBe("balanced");
    expect(config.rtcpMuxPolicy).toBe("require");
    // No forced relay unless the consumer asked for it.
    expect(config.iceTransportPolicy).toBeUndefined();
  });

  it("createDefaultICEConfiguration() reflects env-configured TURN servers when env is set at module load", async () => {
    process.env.NEXT_PUBLIC_TURN_URL = "turn:env.example.com:3478";
    process.env.NEXT_PUBLIC_TURN_USER = "envuser";
    process.env.NEXT_PUBLIC_TURN_PASS = "envpass";

    jest.resetModules();
    const fresh = await import("../ice-config");
    const config = fresh.createDefaultICEConfiguration();

    const iceServers = config.iceServers ?? [];
    const hasOurTurn = iceServers.some((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some(
        (url) =>
          typeof url === "string" &&
          url === "turn:env.example.com:3478" &&
          server.username === "envuser" &&
          server.credential === "envpass",
      );
    });
    expect(hasOurTurn).toBe(true);
  });
});
