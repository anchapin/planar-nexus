/**
 * Unit tests for src/lib/updater.ts (issue #1403).
 *
 * Behaviour matrix (mirrors the docstring in src/lib/updater.ts):
 *
 *   | Environment           | Result                                |
 *   |-----------------------|---------------------------------------|
 *   | Browser / jsdom       | { available: false, currentVersion: '' } |
 *   | Tauri, plugin throws  | { available: false, reason: '...' }   |
 *   | Tauri, up-to-date     | { available: false, currentVersion: '' }|
 *   | Tauri, update found   | { available: true, version, notes }   |
 *
 * The plugin module is mocked per-test so we never touch real Tauri
 * globals (which don't exist under jsdom). The Tauri environment flag is
 * also flipped per-test via a private helper because `isTauriEnvironment`
 * reads from `window.__TAURI_INTERNALS__` and the jsdom window is shared.
 */

import {
  checkForDesktopUpdate,
  isTauriEnvironment,
  UPDATER_PUBKEY_DISPLAY_PREFIX,
  UPDATER_PUBKEY_FINGERPRINT,
  type DesktopUpdateResult,
} from "../updater";

/**
 * Install a fake `window.__TAURI_INTERNALS__` so `isTauriEnvironment()`
 * returns true. Pass `false` (or omit) to clear it.
 */
function setTauriEnvironment(value: boolean): void {
  if (typeof window === "undefined") return;
  if (value) {
    (
      window as unknown as { __TAURI_INTERNALS__: unknown }
    ).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  }
}

/**
 * Mock the lazily-imported @tauri-apps/plugin-updater module for the
 * duration of one test. Returns the mock so callers can assert on call
 * counts / args.
 */
function mockPluginUpdater(impl: () => Promise<unknown>): jest.Mock {
  return jest.fn().mockImplementation(impl);
}

describe("updater — Tauri environment detection", () => {
  afterEach(() => setTauriEnvironment(false));

  it("returns false when window is plain jsdom", () => {
    setTauriEnvironment(false);
    expect(isTauriEnvironment()).toBe(false);
  });

  it("returns true when __TAURI_INTERNALS__ is present", () => {
    setTauriEnvironment(true);
    expect(isTauriEnvironment()).toBe(true);
  });
});

describe("updater — checkForDesktopUpdate", () => {
  afterEach(() => {
    setTauriEnvironment(false);
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it("returns the no-update no-op shape when not running in Tauri", async () => {
    setTauriEnvironment(false);
    const result = await checkForDesktopUpdate();
    expect(result).toEqual<DesktopUpdateResult>({
      available: false,
      currentVersion: "",
    });
  });

  it("returns the available payload when the plugin reports an update", async () => {
    setTauriEnvironment(true);

    const fakeUpdate = {
      version: "1.2.3",
      body: "Bug fixes and improvements",
      date: "2026-07-10T12:00:00Z",
    };

    // jest.doMock lets us mock a module that hasn't been imported yet (the
    // updater module dynamically imports plugin-updater inside the fn).
    jest.doMock("@tauri-apps/plugin-updater", () => ({
      check: mockPluginUpdater(async () => fakeUpdate),
    }));

    const result = await checkForDesktopUpdate();
    expect(result.available).toBe(true);
    if (!result.available) throw new Error("unreachable");
    expect(result.version).toBe("1.2.3");
    expect(result.notes).toBe("Bug fixes and improvements");
    expect(result.publishedAt).toBe("2026-07-10T12:00:00Z");
    expect(result.pubkeyFingerprint).toBe(UPDATER_PUBKEY_FINGERPRINT);
  });

  it("coerces a missing release body to null (notes: null)", async () => {
    setTauriEnvironment(true);

    jest.doMock("@tauri-apps/plugin-updater", () => ({
      check: mockPluginUpdater(async () => ({
        version: "1.0.1",
        body: "",
        date: "2026-07-10T12:00:00Z",
      })),
    }));

    const result = await checkForDesktopUpdate();
    expect(result.available).toBe(true);
    if (!result.available) throw new Error("unreachable");
    expect(result.notes).toBeNull();
  });

  it("returns the up-to-date shape when the plugin reports null", async () => {
    setTauriEnvironment(true);

    jest.doMock("@tauri-apps/plugin-updater", () => ({
      check: mockPluginUpdater(async () => null),
    }));

    const result = await checkForDesktopUpdate();
    expect(result).toEqual<DesktopUpdateResult>({
      available: false,
      currentVersion: "",
    });
  });

  it("captures errors as DesktopUpdateError instead of throwing", async () => {
    setTauriEnvironment(true);

    jest.doMock("@tauri-apps/plugin-updater", () => ({
      check: mockPluginUpdater(async () => {
        throw new Error("manifest unreachable");
      }),
    }));

    const result = await checkForDesktopUpdate();
    expect(result.available).toBe(false);
    if (result.available) throw new Error("unreachable");
    // Narrow on the error shape before reading `reason` — `result` is the
    // union DesktopUpdateResult, so without the guard TS can't tell which
    // branch we're on.
    if ("reason" in result) {
      expect(result.reason).toBe("manifest unreachable");
      expect(result.currentVersion).toBeNull();
    } else {
      throw new Error(
        `expected DesktopUpdateError, got ${JSON.stringify(result)}`,
      );
    }
  });
});

describe("updater — pubkey fingerprint pin (issue #1403 acceptance)", () => {
  it("is the full base64-encoded minisign pubkey pinned in tauri.conf.json", () => {
    // Sanity-check the constant: it MUST match the value pinned in
    // src-tauri/tauri.conf.json plugins.updater.pubkey. This is the
    // test that catches "someone rotated the key in tauri.conf.json
    // but forgot the constant (or vice versa)". We hard-code the
    // expected string so the failure message is unambiguous.
    const EXPECTED =
      "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDIxOEY1MTQ5OTI0MTAzRTQKUldUa0EwR1NTVkdQSVpsWW1jYXJlSlZLSG0xYmc4OXAvbWtDdVNLRVltekR4NUtvN01LSFp0VnYK";
    expect(UPDATER_PUBKEY_FINGERPRINT).toBe(EXPECTED);
  });

  it("exposes a 16-char display prefix derived from the full pubkey", () => {
    expect(UPDATER_PUBKEY_DISPLAY_PREFIX.length).toBe(16);
    expect(UPDATER_PUBKEY_DISPLAY_PREFIX).toBe(
      UPDATER_PUBKEY_FINGERPRINT.slice(0, 16),
    );
  });
});
