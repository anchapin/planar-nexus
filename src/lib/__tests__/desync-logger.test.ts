/**
 * Desync Logger Tests
 * Issue #1096: cover desync detection/resolution logging edge cases.
 *
 * The DesyncLogger records multiplayer desync events (detected/resolved/
 * ignored/escalated), aggregates statistics, persists to localStorage, and
 * emits human-readable debug reportsers. These tests assert concrete event
 * shape, type transitions, and aggregation math — not just "no throw".
 */

import {
  DesyncLogger,
  getDesyncLogger,
  resetDesyncLogger,
  createDesyncLogger,
  type DesyncEvent,
} from "../desync-logger";
import type {
  HashDiscrepancy,
  ConflictResolution,
} from "../game-state/deterministic-sync";

const SAMPLE_DISCREPANCIES: HashDiscrepancy[] = [
  {
    category: "player",
    description: "Life total for p2",
    localValue: "20",
    remoteValue: "17",
  },
  {
    category: "stack",
    description: "Stack size",
    localValue: "2",
    remoteValue: "1",
  },
];

const SAMPLE_RESOLUTION: ConflictResolution = {
  resolved: true,
  strategy: "authoritative",
  resolutionActions: [],
  conflictDescription: "authoritative replay",
};

describe("DesyncLogger - construction & config", () => {
  it("applies default config when none provided", () => {
    const logger = new DesyncLogger({ persistToStorage: false });
    const stats = logger.getStatistics();
    expect(stats.totalEvents).toBe(0);
    expect(stats.successRate).toBe(1);
  });

  it("honours a custom maxEvents cap", () => {
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
      maxEvents: 3,
    });
    for (let i = 0; i < 5; i++) {
      logger.logIgnored("local", "remote", "h-l", "h-r", `reason-${i}`);
    }
    // Only the most recent `maxEvents` are retained.
    expect(logger.getEvents().length).toBe(3);
    const reasons = logger.getEvents().map((e) => (e.context as any).reason);
    expect(reasons).toEqual(["reason-2", "reason-3", "reason-4"]);
  });

  it("does not touch storage when persistence is disabled", () => {
    const key = `desync_disabled_${Date.now()}`;
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
      storageKey: key,
    });
    logger.logIgnored("local", "remote", "a", "b", "x");
    expect(localStorage.getItem(key)).toBeNull();
  });
});

describe("DesyncLogger - logDetection", () => {
  it('records a "detected" event with full context', () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: true,
    });

    const event = logger.logDetection(
      "local-peer",
      "remote-peer",
      "hash-local",
      "hash-remote",
      42,
      SAMPLE_DISCREPANCIES,
      { turn: 5 },
    );

    expect(event.type).toBe("detected");
    expect(event.localPeerId).toBe("local-peer");
    expect(event.remotePeerId).toBe("remote-peer");
    expect(event.localHash).toBe("hash-local");
    expect(event.remoteHash).toBe("hash-remote");
    expect(event.sequenceNumber).toBe(42);
    expect(event.discrepancies).toBe(SAMPLE_DISCREPANCIES);
    expect(event.context).toEqual({ turn: 5 });
    expect(event.id).toMatch(/^desync_/);

    expect(logger.getEvents()).toHaveLength(1);
    expect(logger.getEvents()[0]).toBe(event);
    // Console warning carries the desync summary.
    expect(warnSpy).toHaveBeenCalled();
    const logged = warnSpy.mock.calls[0][1] as any;
    expect(logged.peer).toBe("remote-peer");
    expect(logged.discrepancies).toBe(2);

    warnSpy.mockRestore();
  });

  it("suppresses console output when logToConsole is false", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });

    logger.logDetection("l", "r", "a", "b", 1, []);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("DesyncLogger - lifecycle transitions", () => {
  it("transitions detected -> resolved and records resolution time", () => {
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    const detected = logger.logDetection(
      "l",
      "r",
      "a",
      "b",
      1,
      SAMPLE_DISCREPANCIES,
    );

    logger.logResolution(detected.id, SAMPLE_RESOLUTION, 37);

    const resolved = logger.getEvents().find((e) => e.id === detected.id)!;
    expect(resolved.type).toBe("resolved");
    expect(resolved.resolution).toEqual(SAMPLE_RESOLUTION);
    expect(resolved.resolutionTime).toBe(37);
  });

  it('logs an "ignored" event carrying the reason', () => {
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    const ev = logger.logIgnored("l", "r", "a", "b", "stale handshake");
    expect(ev.type).toBe("ignored");
    expect(ev.context).toEqual({ reason: "stale handshake" });
    expect(ev.sequenceNumber).toBe(0);
    expect(ev.discrepancies).toEqual([]);
  });

  it("escalates a previously-detected event and annotates context", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: true,
    });
    const detected = logger.logDetection("l", "r", "a", "b", 1, []);

    logger.logEscalated(detected.id, "manual review required");

    const escalated = logger.getEvents().find((e) => e.id === detected.id)!;
    expect(escalated.type).toBe("escalated");
    expect((escalated.context as any).escalationReason).toBe(
      "manual review required",
    );
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("is a no-op when resolving/escalating an unknown event id", () => {
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    expect(() =>
      logger.logResolution("nope", SAMPLE_RESOLUTION, 1),
    ).not.toThrow();
    expect(() => logger.logEscalated("nope", "x")).not.toThrow();
    // No events were mutated into resolved/escalated.
    expect(logger.getEventsByType("resolved")).toHaveLength(0);
    expect(logger.getEventsByType("escalated")).toHaveLength(0);
  });
});

describe("DesyncLogger - querying", () => {
  function populated(): DesyncLogger {
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    const a = logger.logDetection(
      "me",
      "peerA",
      "h",
      "hX",
      1,
      SAMPLE_DISCREPANCIES,
    );
    logger.logResolution(a.id, SAMPLE_RESOLUTION, 10);
    logger.logIgnored("me", "peerB", "h", "hY", "transient");
    return logger;
  }

  it("filters events by type", () => {
    const logger = populated();
    expect(logger.getEventsByType("resolved")).toHaveLength(1);
    expect(logger.getEventsByType("ignored")).toHaveLength(1);
    expect(logger.getEventsByType("detected")).toHaveLength(0);
  });

  it("filters events by peer", () => {
    const logger = populated();
    expect(logger.getEventsByPeer("peerA")).toHaveLength(1);
    expect(logger.getEventsByPeer("peerB")).toHaveLength(1);
    expect(logger.getEventsByPeer("peerC")).toHaveLength(0);
  });

  it("returns the N most recent events", () => {
    const logger = populated();
    const recent = logger.getRecentEvents(1);
    expect(recent).toHaveLength(1);
    expect(recent[0].type).toBe("ignored");
  });
});

describe("DesyncLogger - statistics aggregation", () => {
  it("aggregates counts, peer map, average resolution time, and success rate", () => {
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    const a = logger.logDetection(
      "me",
      "peerA",
      "h",
      "hX",
      1,
      SAMPLE_DISCREPANCIES,
    );
    logger.logResolution(a.id, SAMPLE_RESOLUTION, 40);
    const b = logger.logDetection("me", "peerA", "h", "hX2", 2, [
      {
        category: "player",
        description: "Life total for p1",
        localValue: "20",
        remoteValue: "18",
      },
    ]);
    logger.logEscalated(b.id, "unrecoverable");
    logger.logIgnored("me", "peerB", "h", "hY", "stale");

    const stats = logger.getStatistics();
    expect(stats.totalEvents).toBe(3);
    expect(stats.byType.resolved).toBe(1);
    expect(stats.byType.escalated).toBe(1);
    expect(stats.byType.ignored).toBe(1);
    expect(stats.byPeer.get("peerA")).toBe(2);
    expect(stats.byPeer.get("peerB")).toBe(1);
    expect(stats.avgResolutionTime).toBe(40);
    // successRate = resolved / (resolved + escalated) = 1/2
    expect(stats.successRate).toBeCloseTo(0.5, 5);
    // commonDiscrepancies iterates every event's discrepancies regardless of
    // type. "player" appears once in `a` (SAMPLE_DISCREPANCIES) and once in
    // `b` => count 2; "stack" appears once in `a` => count 1. Sorted desc.
    expect(stats.commonDiscrepancies).toEqual([
      { category: "player", count: 2 },
      { category: "stack", count: 1 },
    ]);
  });

  it("reports successRate 1.0 when there are no resolved/escalated events", () => {
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    logger.logIgnored("me", "peer", "a", "b", "x");
    expect(logger.getStatistics().successRate).toBe(1);
    expect(logger.getStatistics().avgResolutionTime).toBe(0);
  });
});

describe("DesyncLogger - debug report", () => {
  it("renders a report for a known event", () => {
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    const ev = logger.logDetection(
      "local",
      "remote",
      "hL",
      "hR",
      9,
      SAMPLE_DISCREPANCIES,
    );
    logger.logResolution(ev.id, SAMPLE_RESOLUTION, 12);

    const report = logger.createDebugReport(ev.id);
    expect(report).toContain("Desync Event Report");
    expect(report).toContain(ev.id);
    expect(report).toContain("Local:  hL");
    expect(report).toContain("Remote: hR");
    expect(report).toContain("Sequence: 9");
    expect(report).toContain("Life total for p2");
    expect(report).toContain("Strategy: authoritative");
    expect(report).toContain("Time: 12ms");
  });

  it("returns a not-found message for an unknown id", () => {
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    expect(logger.createDebugReport("missing")).toBe("Event not found");
  });
});

describe("DesyncLogger - export / import", () => {
  it("round-trips events through export and import", () => {
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    logger.logIgnored("l", "r", "a", "b", "round-trip");
    const exported = logger.exportLogs();

    const parsed = JSON.parse(exported);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.statistics.totalEvents).toBe(1);

    const target = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    target.importLogs(exported);
    expect(target.getEvents()).toHaveLength(1);
    expect((target.getEvents()[0].context as any).reason).toBe("round-trip");
  });

  it("ignores malformed import payload without throwing", () => {
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => logger.importLogs("{ not json")).not.toThrow();
    expect(logger.getEvents()).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it("ignores import payload without an events array", () => {
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    logger.logIgnored("l", "r", "a", "b", "keep");
    logger.importLogs(JSON.stringify({ events: "not-an-array" }));
    // Existing events are preserved when payload is invalid.
    expect(logger.getEvents()).toHaveLength(1);
  });
});

describe("DesyncLogger - persistence", () => {
  it("persists events to localStorage and reloads them on construction", () => {
    const key = `desync_persist_${Date.now()}_${Math.random()}`;
    localStorage.removeItem(key);

    const writer = new DesyncLogger({
      persistToStorage: true,
      logToConsole: false,
      storageKey: key,
    });
    writer.logDetection("local", "remote", "hL", "hR", 7, SAMPLE_DISCREPANCIES);
    const stored = localStorage.getItem(key);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).length).toBe(1);

    // A fresh instance with the same key must rehydrate from storage.
    const reader = new DesyncLogger({
      persistToStorage: true,
      logToConsole: false,
      storageKey: key,
    });
    expect(reader.getEvents()).toHaveLength(1);
    expect(reader.getEvents()[0].sequenceNumber).toBe(7);

    localStorage.removeItem(key);
  });

  it("clearLogs empties memory and storage", () => {
    const key = `desync_clear_${Date.now()}`;
    const logger = new DesyncLogger({
      persistToStorage: true,
      logToConsole: false,
      storageKey: key,
    });
    logger.logIgnored("l", "r", "a", "b", "temp");
    expect(localStorage.getItem(key)).not.toBeNull();

    logger.clearLogs();
    expect(logger.getEvents()).toHaveLength(0);
    expect(localStorage.getItem(key)).toBeNull();
  });
});

describe("DesyncLogger - singleton & factory", () => {
  it("getDesyncLogger returns a shared singleton until reset", () => {
    resetDesyncLogger();
    const a = getDesyncLogger({ persistToStorage: false, logToConsole: false });
    const b = getDesyncLogger();
    expect(a).toBe(b);
    resetDesyncLogger();
    const c = getDesyncLogger({ persistToStorage: false, logToConsole: false });
    expect(c).not.toBe(a);
    resetDesyncLogger();
  });

  it("createDesyncLogger always returns a fresh instance", () => {
    const a = createDesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    const b = createDesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    expect(a).not.toBe(b);
    expect(a).toBeInstanceOf(DesyncLogger);
  });
});

describe("DesyncLogger - event id uniqueness", () => {
  it("generates monotonically unique ids", () => {
    const logger = new DesyncLogger({
      persistToStorage: false,
      logToConsole: false,
    });
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(logger.logIgnored("l", "r", "a", "b", "r").id);
    }
    expect(ids.size).toBe(50);
  });
});
