/**
 * @fileoverview Unit tests for the opt-in telemetry module (issue #1112).
 *
 * Covers the acceptance criteria from the issue:
 *  - Telemetry is OFF by default; only the consent flag is ever persisted.
 *  - Enabling consent turns capture ON; disabling turns it back OFF.
 *  - No sensitive / card / deck / peer data is present in the payload.
 */
import {
  isTelemetryEnabled,
  setTelemetryConsent,
  captureError,
  captureMessage,
  buildPayload,
  sanitizeText,
  setTelemetryTransport,
  resetTelemetryTransport,
  getTelemetryEndpoint,
  type TelemetryPayload,
  type TelemetryTransport,
} from "../telemetry";

const CONSENT_KEY = "planar-nexus:telemetry-consent";

// The full allowlist of keys a payload may ever contain. The "no sensitive
// data" test asserts every payload's keys are a subset of this set.
const ALLOWED_PAYLOAD_KEYS: ReadonlyArray<keyof TelemetryPayload> = [
  "type",
  "message",
  "stack",
  "surface",
  "appVersion",
  "timestamp",
];

describe("telemetry consent", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetTelemetryTransport();
  });

  it("is OFF by default", () => {
    expect(isTelemetryEnabled()).toBe(false);
    expect(window.localStorage.getItem(CONSENT_KEY)).toBeNull();
  });

  it("persisting consent does not transmit anything", () => {
    const transport = jest.fn();
    setTelemetryTransport(transport);

    setTelemetryConsent(true);
    expect(isTelemetryEnabled()).toBe(true);
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe("true");
    // Flipping the consent flag must not, on its own, send a payload.
    expect(transport).not.toHaveBeenCalled();

    setTelemetryConsent(false);
    expect(isTelemetryEnabled()).toBe(false);
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe("false");
  });

  it("fails closed when localStorage throws", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    expect(isTelemetryEnabled()).toBe(false);
    jest.restoreAllMocks();
  });
});

describe("telemetry capture gating", () => {
  let transport: jest.MockedFunction<TelemetryTransport>;

  beforeEach(() => {
    window.localStorage.clear();
    transport = jest.fn();
    setTelemetryTransport(transport);
  });

  afterEach(() => {
    resetTelemetryTransport();
  });

  it("does NOT transmit when consent is off (default)", () => {
    expect(isTelemetryEnabled()).toBe(false);

    captureError(new Error("boom"), "renderer");
    captureMessage("ai flow failed", "AI");
    captureError(new Error("p2p dead"), "P2P");

    expect(transport).not.toHaveBeenCalled();
  });

  it("transmits once consent is ON", () => {
    setTelemetryConsent(true);

    captureError(new Error("boom"), "renderer");

    expect(transport).toHaveBeenCalledTimes(1);
    const payload = transport.mock.calls[0][0];
    expect(payload.surface).toBe("renderer");
    expect(payload.type).toBe("Error");
    expect(payload.message).toBe("boom");
    expect(payload.appVersion).toBeTruthy();
    expect(typeof payload.timestamp).toBe("string");
  });

  it("stops transmitting immediately after consent is turned back OFF", () => {
    setTelemetryConsent(true);
    captureError(new Error("one"), "renderer");
    expect(transport).toHaveBeenCalledTimes(1);

    setTelemetryConsent(false);
    captureError(new Error("two"), "renderer");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("honors the coarse surface tag", () => {
    setTelemetryConsent(true);
    captureError(new Error("a"), "AI");
    captureError(new Error("b"), "P2P");
    captureError(new Error("c"), "SW");

    const surfaces = transport.mock.calls.map((c) => c[0].surface);
    expect(surfaces).toEqual(["AI", "P2P", "SW"]);
  });

  it("swallows transport failures silently", () => {
    setTelemetryConsent(true);
    setTelemetryTransport(() => {
      throw new Error("network down");
    });

    expect(() => captureError(new Error("x"), "renderer")).not.toThrow();
  });
});

describe("telemetry payload sanitization", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetTelemetryTransport();
  });

  it("only ever carries the allowlisted payload keys", () => {
    setTelemetryConsent(true);
    const transport = jest.fn();
    setTelemetryTransport(transport);

    captureError(new Error("e"), "P2P");
    captureMessage("m", "AI");
    captureError({ name: "Foo", message: "bar", stack: "s" }, "SW");
    // string error with a deck id embedded
    captureError("failed for deckId=abc-123", "renderer");

    for (const call of transport.mock.calls) {
      const payload = call[0] as TelemetryPayload;
      const keys = Object.keys(payload);
      for (const key of keys) {
        expect(ALLOWED_PAYLOAD_KEYS).toContain(key as keyof TelemetryPayload);
      }
    }
  });

  it("never includes forbidden data fields in the payload", () => {
    const payload = buildPayload(new Error("oops"), "P2P") as unknown as Record<
      string,
      unknown
    >;

    const forbidden = [
      "cards",
      "card",
      "deck",
      "decks",
      "decklist",
      "peerId",
      "peer",
      "roomCode",
      "ip",
      "email",
      "userId",
      "token",
      "name", // user/peer names
      "players",
      "hand",
    ];
    for (const field of forbidden) {
      expect(payload).not.toHaveProperty(field);
    }
  });

  it("redacts sensitive substrings from message and stack", () => {
    const err = {
      name: "TypeError",
      message:
        'failed for peerId=9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d deckId="monoR"',
      stack: "at x (y) peer_id: 12ab34cd-... ; email=a@b.com?token=sek",
    };
    const payload = buildPayload(err, "P2P");

    expect(payload.message).not.toMatch(/9b1deb4d/i);
    expect(payload.message).not.toMatch(/monoR/);
    expect(payload.stack ?? "").not.toMatch(/a@b\.com/);
    expect(payload.stack ?? "").not.toMatch(/token=sek/);
    expect(payload.message).toContain("[REDACTED]");
  });

  it("sanitizeText truncates very long input", () => {
    const long = "x".repeat(10_000);
    const out = sanitizeText(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("[truncated]");
  });

  it("sanitizeText handles non-string / nullish input", () => {
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(undefined)).toBe("");
    expect(sanitizeText(42)).toBe("42");
  });
});

describe("telemetry endpoint resolution", () => {
  const envKey = "NEXT_PUBLIC_TELEMETRY_ENDPOINT";

  afterEach(() => {
    delete process.env[envKey];
    delete process.env["NEXT_PUBLIC_APP_VERSION"];
  });

  it("returns undefined when no endpoint is configured", () => {
    delete process.env[envKey];
    expect(getTelemetryEndpoint()).toBeUndefined();
  });

  it("returns the trimmed endpoint when configured", () => {
    process.env[envKey] = "  https://collector.example.com/t  ";
    expect(getTelemetryEndpoint()).toBe("https://collector.example.com/t");
  });
});
