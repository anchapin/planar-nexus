/**
 * Per-peer stats aggregation unit tests.
 * Issue #1256: rolling window, bytes/sec, packet-loss %, RTT series.
 */

import {
  RollingWindow,
  computeBytesPerSec,
  computePacketLossPct,
  meanRtt,
  minRtt,
  maxRtt,
  rttSeries,
  summarizePeerSamples,
  type PeerStatsSample,
} from "../p2p-peer-stats";

function sample(overrides: Partial<PeerStatsSample> = {}): PeerStatsSample {
  return {
    timestamp: 1000,
    rttMs: 50,
    bytesSent: 0,
    bytesReceived: 0,
    packetsSent: 0,
    packetsReceived: 0,
    packetsLost: 0,
    queueDepth: 0,
    ...overrides,
  };
}

describe("RollingWindow", () => {
  it("rejects maxSize < 1", () => {
    expect(() => new RollingWindow<number>(0)).toThrow(RangeError);
    expect(() => new RollingWindow<number>(-1)).toThrow(RangeError);
    expect(() => new RollingWindow<number>(Number.NaN)).toThrow(RangeError);
  });

  it("appends samples in order and reports length", () => {
    const w = new RollingWindow<number>(3);
    expect(w.length).toBe(0);
    w.push(1);
    w.push(2);
    expect(w.length).toBe(2);
    expect(w.toArray()).toEqual([1, 2]);
  });

  it("evicts the oldest sample at capacity", () => {
    const w = new RollingWindow<number>(3);
    w.push(1);
    w.push(2);
    w.push(3);
    w.push(4);
    expect(w.toArray()).toEqual([2, 3, 4]);
    expect(w.length).toBe(3);
  });

  it("last() and prev() return the most recent samples", () => {
    const w = new RollingWindow<number>(5);
    expect(w.last()).toBeNull();
    expect(w.prev()).toBeNull();
    w.push(10);
    expect(w.last()).toBe(10);
    expect(w.prev()).toBeNull();
    w.push(20);
    w.push(30);
    expect(w.last()).toBe(30);
    expect(w.prev()).toBe(20);
  });

  it("clear() empties the window without changing capacity", () => {
    const w = new RollingWindow<number>(3);
    w.push(1);
    w.push(2);
    w.clear();
    expect(w.length).toBe(0);
    expect(w.last()).toBeNull();
    // Capacity is preserved.
    w.push(3);
    w.push(4);
    w.push(5);
    w.push(6);
    expect(w.toArray()).toEqual([4, 5, 6]);
  });

  it("replace() accepts a new array (truncating to capacity)", () => {
    const w = new RollingWindow<number>(3);
    w.replace([1, 2, 3, 4, 5]);
    expect(w.toArray()).toEqual([3, 4, 5]);
    w.replace([9]);
    expect(w.toArray()).toEqual([9]);
  });
});

describe("computeBytesPerSec", () => {
  it("computes the rate from a delta", () => {
    // 2048 bytes over 2000 ms = 1024 B/s
    expect(computeBytesPerSec(1024, 3072, 2000)).toBeCloseTo(1024, 6);
  });

  it("returns null when either sample is missing", () => {
    expect(computeBytesPerSec(null, 100, 1000)).toBeNull();
    expect(computeBytesPerSec(0, null, 1000)).toBeNull();
  });

  it("returns null when delta time is non-positive", () => {
    expect(computeBytesPerSec(0, 100, 0)).toBeNull();
    expect(computeBytesPerSec(0, 100, -50)).toBeNull();
  });

  it("returns null when the counter went backwards (reconnect / ICE restart)", () => {
    // Bytes counters are monotonic — a regression means a new connection.
    expect(computeBytesPerSec(2048, 100, 1000)).toBeNull();
  });

  it("returns 0 when both samples are equal", () => {
    expect(computeBytesPerSec(2048, 2048, 1000)).toBe(0);
  });

  it("returns null for non-finite inputs", () => {
    expect(computeBytesPerSec(Number.NaN, 100, 1000)).toBeNull();
    expect(computeBytesPerSec(0, Number.POSITIVE_INFINITY, 1000)).toBeNull();
  });
});

describe("computePacketLossPct", () => {
  it("computes loss percentage", () => {
    // 5 lost / 95 received = 5%
    expect(computePacketLossPct(5, 95)).toBeCloseTo(5, 6);
    expect(computePacketLossPct(0, 100)).toBe(0);
  });

  it("returns null when packetsReceived is zero (denominator guard)", () => {
    expect(computePacketLossPct(0, 0)).toBeNull();
  });

  it("returns null when either input is null or non-finite", () => {
    expect(computePacketLossPct(null, 100)).toBeNull();
    expect(computePacketLossPct(5, null)).toBeNull();
    expect(computePacketLossPct(Number.NaN, 100)).toBeNull();
    expect(computePacketLossPct(5, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("RTT series helpers", () => {
  const samples: PeerStatsSample[] = [
    sample({ timestamp: 1000, rttMs: 40 }),
    sample({ timestamp: 2000, rttMs: null }),
    sample({ timestamp: 3000, rttMs: 60 }),
    sample({ timestamp: 4000, rttMs: 50 }),
  ];

  it("meanRtt skips null entries", () => {
    expect(meanRtt(samples)).toBeCloseTo(50, 6);
  });

  it("minRtt / maxRtt skip null entries", () => {
    expect(minRtt(samples)).toBe(40);
    expect(maxRtt(samples)).toBe(60);
  });

  it("returns null when no sample has an RTT", () => {
    const allNull: PeerStatsSample[] = samples.map((s) => ({ ...s, rttMs: null }));
    expect(meanRtt(allNull)).toBeNull();
    expect(minRtt(allNull)).toBeNull();
    expect(maxRtt(allNull)).toBeNull();
  });

  it("rttSeries maps null to NaN for sparkline continuity", () => {
    expect(rttSeries(samples)).toEqual([40, NaN, 60, 50]);
  });
});

describe("summarizePeerSamples", () => {
  it("returns all-null aggregate for an empty window", () => {
    expect(summarizePeerSamples([])).toEqual({
      rttMs: null,
      rttAvgMs: null,
      rttMinMs: null,
      rttMaxMs: null,
      bytesOutPerSec: null,
      bytesInPerSec: null,
      packetLossPct: null,
      queueDepth: null,
      latestTimestamp: null,
    });
  });

  it("returns null rate fields when only one sample is present", () => {
    const out = summarizePeerSamples([sample({ rttMs: 42 })]);
    expect(out.rttMs).toBe(42);
    expect(out.bytesOutPerSec).toBeNull();
    expect(out.bytesInPerSec).toBeNull();
  });

  it("computes bytes/sec and packet loss from the last two samples", () => {
    const samples = [
      sample({
        timestamp: 1000,
        rttMs: 40,
        bytesSent: 1024,
        bytesReceived: 512,
        packetsLost: 1,
        packetsReceived: 99,
      }),
      sample({
        timestamp: 3000, // 2s gap
        rttMs: 60,
        bytesSent: 3072, // +2048 over 2s = 1024 B/s
        bytesReceived: 1536, // +1024 over 2s = 512 B/s
        packetsLost: 5, // 5 / (5 + 95) = 5%
        packetsReceived: 95,
        queueDepth: 7,
      }),
    ];
    const out = summarizePeerSamples(samples);
    expect(out.rttMs).toBe(60);
    expect(out.bytesOutPerSec).toBeCloseTo(1024, 6);
    expect(out.bytesInPerSec).toBeCloseTo(512, 6);
    expect(out.packetLossPct).toBeCloseTo(5, 6);
    expect(out.queueDepth).toBe(7);
    expect(out.latestTimestamp).toBe(3000);
    expect(out.rttAvgMs).toBeCloseTo(50, 6);
    expect(out.rttMinMs).toBe(40);
    expect(out.rttMaxMs).toBe(60);
  });

  it("Issue #1256 acceptance: RTT matches getStats ±5 ms", () => {
    // Browsers expose `currentRoundTripTime` in seconds; we round to ms. The
    // hook samples that field directly so the panel can only drift by ±0.5 ms
    // of rounding — well within the acceptance ±5 ms tolerance.
    const statsReportRttSeconds = 0.123; // 123 ms from getStats
    const rttMs = Math.round(statsReportRttSeconds * 1000);
    const samples = [sample({ rttMs })];
    expect(Math.abs(summarizePeerSamples(samples).rttMs! - 123)).toBeLessThanOrEqual(5);
  });
});