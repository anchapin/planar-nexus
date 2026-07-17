/**
 * Unit tests for the Tauri dev-fallback shim (issue #1433).
 *
 * Locks in the production-safety contract (double gating) and the in-page
 * error string that `e2e/tauri-deck-builder.spec.ts` depends on. The actual
 * window manipulation is exercised against the real `window`/`document`
 * globals jsdom provides.
 */
import {
  installTauriDevFallback,
  isTauriDevFallbackEnabled,
  TAURI_DEV_FALLBACK_ATTR,
  TAURI_DEV_FALLBACK_ERROR,
  TAURI_FALLBACK_FLAG_VALUE,
} from "@/lib/tauri-mock";

/**
 * Helper: set `process.env.NODE_ENV` despite its read-only @types/node
 * annotation (the runtime value is mutable). Keeps each test self-contained.
 */
function setNodeEnv(value: string) {
  (process.env as { NODE_ENV: string }).NODE_ENV = value;
}

describe("tauri-mock env gating (production safety)", () => {
  const ENV_FLAG = "NEXT_PUBLIC_TAURI_FALLBACK";
  let origFlag: string | undefined;
  let origNodeEnv: string | undefined;

  beforeEach(() => {
    origFlag = process.env[ENV_FLAG];
    origNodeEnv = process.env.NODE_ENV;
    // jsdom sets NODE_ENV to "test"; reset to a deterministic baseline.
    setNodeEnv("development");
  });

  afterEach(() => {
    if (origFlag === undefined) delete process.env[ENV_FLAG];
    else process.env[ENV_FLAG] = origFlag;
    setNodeEnv(origNodeEnv as string);
  });

  it("is disabled when the flag is unset", () => {
    delete process.env[ENV_FLAG];
    expect(isTauriDevFallbackEnabled()).toBe(false);
  });

  it("is disabled when the flag has any value other than '1'", () => {
    process.env[ENV_FLAG] = "true";
    expect(isTauriDevFallbackEnabled()).toBe(false);
    process.env[ENV_FLAG] = "0";
    expect(isTauriDevFallbackEnabled()).toBe(false);
  });

  it("is disabled in production even when the flag is '1'", () => {
    process.env[ENV_FLAG] = TAURI_FALLBACK_FLAG_VALUE;
    setNodeEnv("production");
    expect(isTauriDevFallbackEnabled()).toBe(false);
  });

  it("is enabled only when flag is '1' and NODE_ENV is not production", () => {
    process.env[ENV_FLAG] = TAURI_FALLBACK_FLAG_VALUE;
    setNodeEnv("development");
    expect(isTauriDevFallbackEnabled()).toBe(true);
  });
});

describe("installTauriDevFallback", () => {
  const ENV_FLAG = "NEXT_PUBLIC_TAURI_FALLBACK";

  beforeEach(() => {
    process.env[ENV_FLAG] = TAURI_FALLBACK_FLAG_VALUE;
    setNodeEnv("development");
    // Clean slate: no globals, no marker.
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    document.documentElement.removeAttribute(TAURI_DEV_FALLBACK_ATTR);
  });

  it("installs the IPC globals and the DOM marker when enabled", () => {
    const installed = installTauriDevFallback();
    expect(installed).toBe(true);

    expect(
      (window as unknown as { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__,
    ).toBeDefined();
    expect(
      (window as unknown as { __TAURI__?: unknown }).__TAURI__,
    ).toBeDefined();
    expect(document.documentElement.getAttribute(TAURI_DEV_FALLBACK_ATTR)).toBe(
      TAURI_FALLBACK_FLAG_VALUE,
    );
  });

  it("installs an invoke that rejects with the canonical error", async () => {
    installTauriDevFallback();
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__?: { invoke: (cmd: string) => Promise<never> };
      }
    ).__TAURI_INTERNALS__;
    expect(typeof internals?.invoke).toBe("function");

    await expect(
      internals!.invoke("plugin:updater|get_version"),
    ).rejects.toThrow(TAURI_DEV_FALLBACK_ERROR);
  });

  it("is idempotent — a second install is a no-op", () => {
    expect(installTauriDevFallback()).toBe(true);
    expect(installTauriDevFallback()).toBe(false);
  });

  it("is a total no-op when the flag is off (production safety)", () => {
    delete process.env[ENV_FLAG];
    expect(installTauriDevFallback()).toBe(false);
    expect(
      (window as unknown as { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__,
    ).toBeUndefined();
    expect(
      document.documentElement.getAttribute(TAURI_DEV_FALLBACK_ATTR),
    ).toBeNull();
  });
});

describe("tauri-mock contract with the e2e spec", () => {
  // `e2e/tauri-deck-builder.spec.ts` inlines TAURI_DEV_FALLBACK_ERROR inside
  // its addInitScript (page context can't import TS). This test fails if the
  // two drift, which would otherwise only surface as a flaky e2e.
  it("exports the error string the e2e init script duplicates", () => {
    expect(TAURI_DEV_FALLBACK_ERROR).toBe(
      "tauri-dev-fallback: IPC is mocked; this call only succeeds inside a real Tauri webview",
    );
    expect(TAURI_DEV_FALLBACK_ERROR.length).toBeGreaterThan(0);
  });
});
