/**
 * Tests for the P2P leveled logger (Issue #987)
 *
 * Covers the acceptance criteria:
 *   - Leveled logger (debug/info/warn/error) used by the P2P infrastructure.
 *   - In PRODUCTION builds, debug/info are gated off (the body is wrapped in
 *     a `process.env.NODE_ENV !== 'production'` guard that the bundler can
 *     dead-code-eliminate).
 *   - warn/error ALWAYS emit, in development AND production.
 *   - A configurable level (NEXT_PUBLIC_P2P_LOG_LEVEL) controls dev verbosity.
 *   - The message is forwarded as the first argument to console.* so the #982
 *     redaction layer and existing test spies keep working.
 */

import {
  P2PLogger,
  createP2PLogger,
  p2pLogger,
  resolveP2PLevel,
} from "../p2p-logger";

// Capture the original NODE_ENV so every test can restore it. Several tests
// mutate process.env.NODE_ENV to emulate production builds.
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

interface ConsoleSpies {
  debug: jest.SpyInstance;
  info: jest.SpyInstance;
  warn: jest.SpyInstance;
  error: jest.SpyInstance;
}

let spies: ConsoleSpies;

beforeEach(() => {
  spies = {
    debug: jest.spyOn(console, "debug").mockImplementation(() => {}),
    info: jest.spyOn(console, "info").mockImplementation(() => {}),
    warn: jest.spyOn(console, "warn").mockImplementation(() => {}),
    error: jest.spyOn(console, "error").mockImplementation(() => {}),
  };
});

afterEach(() => {
  // Restore console spies so they never leak into other test files sharing
  // the same Jest worker (the global `console` object is process-wide).
  jest.restoreAllMocks();
  setEnv(ORIGINAL_NODE_ENV);
});

function setEnv(env: string | undefined): void {
  // `process.env.NODE_ENV` is typed read-only by @types/node; cast to a
  // mutable record so tests can emulate development / production builds.
  const envRecord = process.env as Record<string, string | undefined>;
  if (env === undefined) {
    delete envRecord.NODE_ENV;
  } else {
    envRecord.NODE_ENV = env;
  }
}

describe("resolveP2PLevel", () => {
  it("accepts each valid level (case-insensitive)", () => {
    expect(resolveP2PLevel("debug", "warn")).toBe("debug");
    expect(resolveP2PLevel("INFO", "warn")).toBe("info");
    expect(resolveP2PLevel("Warn", "debug")).toBe("warn");
    expect(resolveP2PLevel("ERROR", "debug")).toBe("error");
  });

  it("normalizes to lowercase", () => {
    expect(resolveP2PLevel("DEBUG", "info")).toBe("debug");
    expect(resolveP2PLevel("Error", "info")).toBe("error");
  });

  it("falls back for unknown / missing values", () => {
    expect(resolveP2PLevel("trace", "info")).toBe("info");
    expect(resolveP2PLevel("", "warn")).toBe("warn");
    expect(resolveP2PLevel(undefined, "error")).toBe("error");
    expect(resolveP2PLevel("verbose", "debug")).toBe("debug");
  });
});

describe("P2PLogger", () => {
  describe("message forwarding (redaction compatibility)", () => {
    it("forwards the message as the first console argument", () => {
      const log = new P2PLogger();
      log.error("[WebRTC] init failed:", "detail");
      expect(spies.error).toHaveBeenCalledTimes(1);
      expect(spies.error.mock.calls[0][0]).toBe("[WebRTC] init failed:");
      expect(spies.error.mock.calls[0][1]).toBe("detail");
    });
  });

  describe("warn / error always emit (dev + production)", () => {
    it("warn emits in development and forwards args verbatim", () => {
      setEnv("development");
      const log = new P2PLogger();
      log.warn("[WebRTC] Rate limit exceeded", { count: 3 });
      expect(spies.warn).toHaveBeenCalledTimes(1);
      expect(spies.warn.mock.calls[0][0]).toBe("[WebRTC] Rate limit exceeded");
    });

    it("error emits in development", () => {
      setEnv("development");
      const log = new P2PLogger();
      log.error("[Signaling] Failed:", new Error("boom"));
      expect(spies.error).toHaveBeenCalledTimes(1);
    });

    it("warn emits in a PRODUCTION environment (not stripped)", () => {
      setEnv("production");
      const log = new P2PLogger();
      log.warn("[ICE] No TURN servers configured");
      expect(spies.warn).toHaveBeenCalledTimes(1);
    });

    it("error emits in a PRODUCTION environment (not stripped)", () => {
      setEnv("production");
      const log = new P2PLogger();
      log.error("[WebRTC] Failed to initialize:", "redacted");
      expect(spies.error).toHaveBeenCalledTimes(1);
      expect(spies.error.mock.calls[0][0]).toBe(
        "[WebRTC] Failed to initialize:",
      );
    });
  });

  describe("debug / info are gated off in production (stripping)", () => {
    it("debug does NOT emit in a PRODUCTION environment", () => {
      setEnv("production");
      const log = new P2PLogger();
      log.debug("[WebRTC] negotiating", { sdp: "secret" });
      expect(spies.debug).not.toHaveBeenCalled();
    });

    it("info does NOT emit in a PRODUCTION environment", () => {
      setEnv("production");
      const log = new P2PLogger();
      log.info("[ICE] Connection state:", "connected");
      expect(spies.info).not.toHaveBeenCalled();
    });

    it("production gating holds even when minLevel is explicitly 'debug'", () => {
      // The build-time NODE_ENV guard must win over any runtime level config.
      setEnv("production");
      const log = new P2PLogger({ minLevel: "debug" });
      log.debug("should be stripped");
      log.info("also stripped");
      expect(spies.debug).not.toHaveBeenCalled();
      expect(spies.info).not.toHaveBeenCalled();
    });
  });

  describe("debug / info emit in development, gated by minLevel", () => {
    it("debug and info emit when minLevel is 'debug' (default)", () => {
      setEnv("development");
      const log = new P2PLogger();
      log.debug("d");
      log.info("i");
      expect(spies.debug).toHaveBeenCalledTimes(1);
      expect(spies.info).toHaveBeenCalledTimes(1);
    });

    it("minLevel 'info' suppresses debug but allows info", () => {
      setEnv("development");
      const log = new P2PLogger({ minLevel: "info" });
      log.debug("d");
      log.info("i");
      expect(spies.debug).not.toHaveBeenCalled();
      expect(spies.info).toHaveBeenCalledTimes(1);
    });

    it("minLevel 'warn' suppresses debug and info (warn/error still emit)", () => {
      setEnv("development");
      const log = new P2PLogger({ minLevel: "warn" });
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
      expect(spies.debug).not.toHaveBeenCalled();
      expect(spies.info).not.toHaveBeenCalled();
      expect(spies.warn).toHaveBeenCalledTimes(1);
      expect(spies.error).toHaveBeenCalledTimes(1);
    });

    it("minLevel 'error' keeps warn/error emitting (they are never level-gated)", () => {
      setEnv("development");
      const log = new P2PLogger({ minLevel: "error" });
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
      expect(spies.debug).not.toHaveBeenCalled();
      expect(spies.info).not.toHaveBeenCalled();
      // warn/error always surface, regardless of minLevel (acceptance criterion).
      expect(spies.warn).toHaveBeenCalledTimes(1);
      expect(spies.error).toHaveBeenCalledTimes(1);
    });
  });

  describe("createP2PLogger factory + child loggers", () => {
    it("creates a logger and forwards errors", () => {
      const log = createP2PLogger("WebRTC");
      log.error("[WebRTC] boom");
      expect(spies.error).toHaveBeenCalledTimes(1);
    });

    it("child shares the parent's level config", () => {
      setEnv("development");
      const parent = new P2PLogger({ minLevel: "warn" });
      const child = parent.child("DataChannel");
      child.debug("d");
      child.info("i");
      child.warn("w");
      expect(spies.debug).not.toHaveBeenCalled();
      expect(spies.info).not.toHaveBeenCalled();
      expect(spies.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe("shared instance", () => {
    it("p2pLogger exposes the four leveled methods", () => {
      expect(typeof p2pLogger.debug).toBe("function");
      expect(typeof p2pLogger.info).toBe("function");
      expect(typeof p2pLogger.warn).toBe("function");
      expect(typeof p2pLogger.error).toBe("function");
    });
  });
});
