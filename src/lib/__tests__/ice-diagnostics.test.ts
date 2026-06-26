/**
 * ICE / NAT-traversal diagnostics — data-layer unit tests.
 * Issue #1088: NAT-type classifier + getStats aggregation coverage.
 *
 * These tests mock RTCPeerConnection events / RTCStatsReport as plain data and
 * assert the pure classification + aggregation logic. No browser WebRTC stack.
 */

import {
  classifyCandidateType,
  classifyNATType,
  deriveICEPhase,
  extractSelectedCandidatePair,
  buildDiagnosticsSnapshot,
  inferIPFamily,
  toCandidateRecord,
  isICEDiagnosticsSupported,
  ICEDiagnosticsCollector,
  MAX_STORED_CANDIDATES,
  type CandidateCounts,
  type ICEDiagnosticsSnapshot,
} from "../ice-diagnostics";

const HOST_CAND =
  "candidate:842163049 1 udp 1677729535 192.168.1.5 53427 typ host generation 0 ufrag 5p+J";
const SRFLX_CAND =
  "candidate:842163049 1 udp 1677729535 203.0.113.7 53427 typ srflx raddr 192.168.1.5 rport 53427 generation 0";
const RELAY_CAND =
  "candidate:842163049 1 tcp 1518280447 198.51.100.3 443 typ relay tcptype passive generation 0";
const PRFLX_CAND =
  "candidate:842163049 1 udp 1677729535 203.0.113.99 41255 typ prflx generation 0";
const IPV6_HOST_CAND =
  "candidate:842163049 1 udp 1677729535 2001:db8::1 53427 typ host generation 0";

function emptyCounts(): CandidateCounts {
  return { host: 0, srflx: 0, prflx: 0, relay: 0, unknown: 0 };
}

describe("classifyCandidateType", () => {
  it.each([
    ["host", HOST_CAND],
    ["srflx", SRFLX_CAND],
    ["relay", RELAY_CAND],
    ["prflx", PRFLX_CAND],
  ])("classifies a raw %s candidate SDP line", (expected, sdp) => {
    expect(classifyCandidateType(sdp)).toBe(expected);
  });

  it("prefers a structured .type property when present", () => {
    expect(classifyCandidateType({ type: "srflx" })).toBe("srflx");
    expect(classifyCandidateType({ type: "relay" })).toBe("relay");
  });

  it("falls back to SDP parsing when .type is invalid", () => {
    expect(classifyCandidateType({ type: "bogus", candidate: HOST_CAND })).toBe(
      "host",
    );
  });

  it("returns unknown for malformed / empty / null candidates", () => {
    expect(classifyCandidateType(null)).toBe("unknown");
    expect(classifyCandidateType(undefined)).toBe("unknown");
    expect(classifyCandidateType("candidate:garbage no typ here")).toBe(
      "unknown",
    );
    expect(classifyCandidateType({})).toBe("unknown");
    expect(classifyCandidateType({ candidate: null })).toBe("unknown");
  });
});

describe("inferIPFamily", () => {
  it("detects IPv4", () => {
    expect(inferIPFamily("192.168.1.5")).toBe("ipv4");
    expect(inferIPFamily("10.0.0.1")).toBe("ipv4");
  });
  it("detects IPv6 (including bracketed)", () => {
    expect(inferIPFamily("2001:db8::1")).toBe("ipv6");
    expect(inferIPFamily("[2001:db8::1]")).toBe("ipv6");
  });
  it("returns unknown for empty / non-IP", () => {
    expect(inferIPFamily(null)).toBe("unknown");
    expect(inferIPFamily("")).toBe("unknown");
    expect(inferIPFamily("localhost")).toBe("unknown");
  });
});

describe("toCandidateRecord", () => {
  it("normalizes a host candidate record", () => {
    const rec = toCandidateRecord(HOST_CAND, 1000);
    expect(rec).not.toBeNull();
    expect(rec?.type).toBe("host");
    expect(rec?.address).toBe("192.168.1.5");
    expect(rec?.protocol).toBe("udp");
    expect(rec?.ipFamily).toBe("ipv4");
    expect(rec?.timestamp).toBe(1000);
  });

  it("normalizes a relay candidate with TCP", () => {
    const rec = toCandidateRecord(RELAY_CAND)!;
    expect(rec.type).toBe("relay");
    expect(rec.protocol).toBe("tcp");
    expect(rec.address).toBe("198.51.100.3");
  });

  it("classifies IPv6 host family", () => {
    const rec = toCandidateRecord(IPV6_HOST_CAND)!;
    expect(rec.ipFamily).toBe("ipv6");
  });

  it("returns null for the end-of-gathering null candidate", () => {
    expect(toCandidateRecord(null)).toBeNull();
    expect(toCandidateRecord({ candidate: null })).toBeNull();
  });
});

describe("classifyNATType", () => {
  it("returns restrictive for host-only candidates", () => {
    expect(classifyNATType({ ...emptyCounts(), host: 3 })).toBe("restrictive");
  });

  it("returns cone when srflx candidates are present", () => {
    expect(classifyNATType({ ...emptyCounts(), host: 2, srflx: 1 })).toBe(
      "cone",
    );
  });

  it("returns cone when only prflx is present", () => {
    expect(classifyNATType({ ...emptyCounts(), prflx: 1 })).toBe("cone");
  });

  it("returns turn-dependent when a relay candidate is gathered", () => {
    expect(classifyNATType({ ...emptyCounts(), host: 2, relay: 1 })).toBe(
      "turn-dependent",
    );
  });

  it("returns turn-dependent when the selected pair uses relay", () => {
    expect(
      classifyNATType(
        { ...emptyCounts(), host: 2, srflx: 1 },
        {
          localType: "relay",
          remoteType: "host",
          localAddress: null,
          remoteAddress: null,
          nominated: true,
          currentRttMs: null,
          packetsSent: null,
          packetsReceived: null,
          packetsLost: null,
          bytesSent: null,
          bytesReceived: null,
        },
      ),
    ).toBe("turn-dependent");
  });

  it("returns unknown when nothing was gathered", () => {
    expect(classifyNATType(emptyCounts())).toBe("unknown");
  });
});

describe("deriveICEPhase", () => {
  it("maps ICE connection states to phases", () => {
    expect(deriveICEPhase(null, "connected")).toBe("connected");
    expect(deriveICEPhase(null, "completed")).toBe("completed");
    expect(deriveICEPhase(null, "failed")).toBe("failed");
    expect(deriveICEPhase(null, "disconnected")).toBe("disconnected");
    expect(deriveICEPhase(null, "closed")).toBe("closed");
    expect(deriveICEPhase(null, "checking")).toBe("connecting");
  });

  it("surfaces 'gathering' before checks begin", () => {
    expect(deriveICEPhase("gathering", "new")).toBe("gathering");
    expect(deriveICEPhase("complete", "new")).toBe("connecting");
  });

  it("defaults to new with no signal", () => {
    expect(deriveICEPhase(null, null)).toBe("new");
    expect(deriveICEPhase("new", "new")).toBe("new");
  });
});

describe("extractSelectedCandidatePair", () => {
  function buildReport(
    entries: Array<[string, Record<string, unknown>]>,
  ): Map<string, unknown> {
    return new Map(entries);
  }

  it("extracts the nominated pair with types, addresses, RTT and counts", () => {
    const report = buildReport([
      [
        "L1",
        {
          type: "local-candidate",
          candidateType: "srflx",
          address: "203.0.113.7",
        },
      ],
      [
        "R1",
        { type: "remote-candidate", candidateType: "host", ip: "192.168.1.9" },
      ],
      [
        "P1",
        {
          type: "candidate-pair",
          localCandidateId: "L1",
          remoteCandidateId: "R1",
          nominated: true,
          state: "succeeded",
          currentRoundTripTime: 0.05,
          packetsSent: 100,
          packetsReceived: 95,
          packetsLost: 5,
          bytesSent: 1000,
          bytesReceived: 900,
        },
      ],
    ]);

    const pair = extractSelectedCandidatePair(report);
    expect(pair).not.toBeNull();
    expect(pair?.localType).toBe("srflx");
    expect(pair?.remoteType).toBe("host");
    expect(pair?.localAddress).toBe("203.0.113.7");
    expect(pair?.remoteAddress).toBe("192.168.1.9");
    expect(pair?.nominated).toBe(true);
    expect(pair?.currentRttMs).toBe(50);
    expect(pair?.packetsSent).toBe(100);
    expect(pair?.packetsLost).toBe(5);
  });

  it("prefers a nominated pair over a merely succeeded one", () => {
    const report = buildReport([
      ["L1", { type: "local-candidate", candidateType: "host" }],
      ["R1", { type: "remote-candidate", candidateType: "host" }],
      [
        "P-succ",
        {
          type: "candidate-pair",
          localCandidateId: "L1",
          remoteCandidateId: "R1",
          state: "succeeded",
        },
      ],
      [
        "P-nom",
        {
          type: "candidate-pair",
          localCandidateId: "L1",
          remoteCandidateId: "R1",
          nominated: true,
          state: "in-progress",
        },
      ],
    ]);
    expect(extractSelectedCandidatePair(report)?.nominated).toBe(true);
  });

  it("falls back to a succeeded pair when none is nominated", () => {
    const report = buildReport([
      ["L1", { type: "local-candidate", candidateType: "host" }],
      ["R1", { type: "remote-candidate", candidateType: "host" }],
      [
        "P",
        {
          type: "candidate-pair",
          localCandidateId: "L1",
          remoteCandidateId: "R1",
          state: "succeeded",
        },
      ],
    ]);
    const pair = extractSelectedCandidatePair(report);
    expect(pair).not.toBeNull();
    expect(pair?.nominated).toBe(false);
  });

  it("returns null when no candidate pair is usable", () => {
    const report = buildReport([
      ["L1", { type: "local-candidate", candidateType: "host" }],
      [
        "P",
        {
          type: "candidate-pair",
          localCandidateId: "L1",
          state: "waiting", // score 0
        },
      ],
    ]);
    expect(extractSelectedCandidatePair(report)).toBeNull();
  });

  it("returns null for an empty / non-Map report", () => {
    expect(extractSelectedCandidatePair(null)).toBeNull();
    expect(extractSelectedCandidatePair(undefined)).toBeNull();
    expect(extractSelectedCandidatePair({} as never)).toBeNull();
  });
});

describe("ICEDiagnosticsCollector", () => {
  it("counts candidate types as they are recorded", () => {
    const c = new ICEDiagnosticsCollector();
    c.recordCandidate(HOST_CAND);
    c.recordCandidate(HOST_CAND);
    c.recordCandidate(SRFLX_CAND);
    c.recordCandidate(RELAY_CAND);

    const counts = c.getCandidateCounts();
    expect(counts.host).toBe(2);
    expect(counts.srflx).toBe(1);
    expect(counts.relay).toBe(1);
    expect(counts.unknown).toBe(0);
  });

  it("ignores the end-of-gathering null candidate", () => {
    const c = new ICEDiagnosticsCollector();
    c.recordCandidate(null);
    c.recordCandidate({ candidate: null });
    expect(c.getCandidateCounts().host).toBe(0);
    expect(c.getSnapshot().totalGathered).toBe(0);
  });

  it("records candidate errors", () => {
    const c = new ICEDiagnosticsCollector();
    c.recordCandidateError({
      url: "stun:stun.l.google.com:19302",
      errorCode: 701,
      errorText: "STUN host unreachable",
    });
    const snap = c.getSnapshot();
    expect(snap.candidateErrors).toHaveLength(1);
    expect(snap.candidateErrors[0]?.errorCode).toBe(701);
    expect(snap.candidateErrors[0]?.url).toContain("stun.l.google.com");
  });

  it("tracks gathering timing and connection timestamp", () => {
    const c = new ICEDiagnosticsCollector();
    c.recordGatheringState("gathering");
    c.recordState("checking", "gathering");
    c.recordState("connected", "complete");
    const snap = c.getSnapshot();
    expect(snap.gatheringStartedAt).not.toBeNull();
    expect(snap.gatheringCompleteAt).not.toBeNull();
    expect(snap.connectedAt).not.toBeNull();
    expect(snap.phase).toBe("connected");
  });

  it("caps stored candidates at MAX_STORED_CANDIDATES", () => {
    const c = new ICEDiagnosticsCollector();
    for (let i = 0; i < MAX_STORED_CANDIDATES + 10; i++) {
      c.recordCandidate(HOST_CAND);
    }
    const snap = c.getSnapshot();
    expect(snap.candidates.length).toBe(MAX_STORED_CANDIDATES);
    // counts still reflect the true total
    expect(snap.candidateCounts.host).toBe(MAX_STORED_CANDIDATES + 10);
    expect(snap.totalGathered).toBe(MAX_STORED_CANDIDATES + 10);
  });

  it("merges a stats report into the snapshot selected pair", () => {
    const c = new ICEDiagnosticsCollector();
    c.recordCandidate(SRFLX_CAND);
    const report = new Map<string, unknown>([
      ["L1", { type: "local-candidate", candidateType: "srflx" }],
      ["R1", { type: "remote-candidate", candidateType: "host" }],
      [
        "P1",
        {
          type: "candidate-pair",
          localCandidateId: "L1",
          remoteCandidateId: "R1",
          nominated: true,
          currentRoundTripTime: 0.023,
        },
      ],
    ]);
    const snap = c.getSnapshot(report);
    expect(snap.selectedPair).not.toBeNull();
    expect(snap.selectedPair?.currentRttMs).toBe(23);
  });

  it("reset() clears all collected data", () => {
    const c = new ICEDiagnosticsCollector();
    c.recordCandidate(HOST_CAND);
    c.recordState("connected", "complete");
    c.reset();
    const snap = c.getSnapshot();
    expect(snap.totalGathered).toBe(0);
    expect(snap.connectedAt).toBeNull();
    expect(snap.phase).toBe("new");
  });
});

describe("buildDiagnosticsSnapshot", () => {
  it("derives natType and totalGathered from inputs", () => {
    const snap: ICEDiagnosticsSnapshot = buildDiagnosticsSnapshot({
      candidateCounts: { ...emptyCounts(), host: 2, srflx: 1 },
      candidates: [],
      candidateErrors: [],
      iceConnectionState: "connected",
      gatheringState: "complete",
      hasTurnConfigured: true,
      gatheringStartedAt: 1000,
      gatheringCompleteAt: 1500,
      connectedAt: 1600,
      statsReport: null,
    });
    expect(snap.natType).toBe("cone");
    expect(snap.totalGathered).toBe(3);
    expect(snap.gatheringDurationMs).toBe(500);
    expect(snap.phase).toBe("connected");
    expect(snap.hasTurnConfigured).toBe(true);
    // snapshot copies counts so callers can't mutate internal state
    expect(snap.candidateCounts).toEqual({
      host: 2,
      srflx: 1,
      prflx: 0,
      relay: 0,
      unknown: 0,
    });
  });
});

describe("isICEDiagnosticsSupported", () => {
  const original = (window as { RTCPeerConnection?: unknown })
    .RTCPeerConnection;

  afterEach(() => {
    (window as { RTCPeerConnection?: unknown }).RTCPeerConnection = original;
  });

  it("returns false when RTCPeerConnection is absent", () => {
    (window as { RTCPeerConnection?: unknown }).RTCPeerConnection = undefined;
    expect(isICEDiagnosticsSupported()).toBe(false);
  });

  it("returns true when RTCPeerConnection is available", () => {
    (window as any).RTCPeerConnection = function MockPC() {};
    expect(isICEDiagnosticsSupported()).toBe(true);
  });
});
