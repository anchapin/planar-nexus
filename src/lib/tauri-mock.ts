/**
 * @fileOverview Tauri IPC dev/test shim (issue #1433).
 *
 * Why this exists
 * ---------------
 * The Tauri 2 desktop E2E (`e2e/tauri-deck-builder.spec.ts`) exercises the
 * *same* Next.js dev server (`localhost:9002`) the Tauri webview loads via
 * `devUrl`. The deck-builder UI is identical in both contexts — what differs
 * is the presence of the Tauri IPC bridge (`window.__TAURI_INTERNALS__` and
 * `window.__TAURI__`). Several modules branch on those globals
 * (`src/lib/updater.ts` `isTauriEnvironment()`, `src/lib/indexeddb-storage.ts`
 * `isTauri()`), and we want the dev-server E2E to take the *desktop* branch
 * so the desktop code paths are actually covered — without shipping a real
 * Tauri binary into CI.
 *
 * This module installs a minimal, rejecting IPC shim onto `window` so the
 * desktop branches are taken while every concrete IPC call fails gracefully
 * (the existing call sites — notably `checkForDesktopUpdate()` — already
 * swallow errors and degrade to a no-op, so the app remains fully usable).
 *
 * Production safety
 * -----------------
 * The shim is **double-gated** and has zero production surface:
 *
 *   1. `process.env.NEXT_PUBLIC_TAURI_FALLBACK` must equal exactly `"1"`.
 *      This is a build-time `NEXT_PUBLIC_*` inlined by Next, so a production
 *      build (`next build`) compiled without the flag can never contain an
 *      active shim — the installer is dead code that tree-shakes to nothing.
 *   2. `process.env.NODE_ENV !== "production"`. Belt-and-suspenders: even if
 *      someone accidentally sets the flag in a prod build, the installer
 *      refuses to touch `window`.
 *
 * The installer is also **idempotent** — calling it more than once (e.g. on
 * React re-mount or across HMR reloads) is a no-op once the marker is set.
 *
 * Consumption
 * -----------
 * Two entry points install the same shim so the desktop path is active both
 * when the dev server boots with the flag and when Playwright drives it:
 *
 *   - `src/components/tauri-dev-fallback.tsx` — mounted once in the root
 *     layout; calls {@link installTauriDevFallback} on the client.
 *   - `e2e/tauri-deck-builder.spec.ts` — injects the equivalent globals via
 *     `page.addInitScript` *before* any app JS evaluates, for determinism.
 */

/**
 * Marker attribute set on `document.documentElement` once the shim is active,
 * so E2E specs can assert the desktop path is engaged without poking at
 * private globals.
 */
export const TAURI_DEV_FALLBACK_ATTR = "data-tauri-dev-fallback";

/**
 * The exact env value that activates the shim. Typed as a literal so callers
 * can compare without magic strings.
 */
export const TAURI_FALLBACK_FLAG_VALUE = "1" as const;

/**
 * True iff the dev-fallback flag is set. Exposed for tests and for the
 * layout component so they don't repeat the env-string dance.
 *
 * Reads `process.env.NEXT_PUBLIC_TAURI_FALLBACK` (inlined by Next at compile
 * time for the client bundle) — absent/unset/any other value yields `false`.
 */
export function isTauriDevFallbackEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_TAURI_FALLBACK === TAURI_FALLBACK_FLAG_VALUE &&
    process.env.NODE_ENV !== "production"
  );
}

/**
 * The descriptive error every mocked IPC call rejects with. Centralised so
 * call sites and tests can match on a stable prefix.
 */
export const TAURI_DEV_FALLBACK_ERROR =
  "tauri-dev-fallback: IPC is mocked; this call only succeeds inside a real Tauri webview";

/**
 * Install the minimal Tauri IPC shim onto `window`.
 *
 * Installs:
 *   - `window.__TAURI_INTERNALS__` with an `invoke` that rejects (matches the
 *     shape `src/lib/updater.ts` probes via `isTauriEnvironment()`).
 *   - `window.__TAURI__` (matches the shape `src/lib/indexeddb-storage.ts`
 *     probes via `isTauri()`).
 *
 * No-op when:
 *   - the flag is off (production safety),
 *   - `window` is undefined (SSR / Node / jest without jsdom),
 *   - the shim was already installed this session (idempotent — checked via
 *     the marker attribute so HMR / re-mounts don't double-install).
 *
 * @returns `true` if the shim was installed this call, `false` otherwise.
 */
export function installTauriDevFallback(): boolean {
  if (!isTauriDevFallbackEnabled()) return false;
  if (typeof window === "undefined") return false;

  const w = window as Window & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };

  const docEl = document.documentElement;
  // Idempotency guard. Use the DOM marker rather than a global flag so the
  // check survives HMR full-reloads that recreate module state.
  if (
    docEl.getAttribute(TAURI_DEV_FALLBACK_ATTR) === TAURI_FALLBACK_FLAG_VALUE
  ) {
    return false;
  }

  // A rejecting invoke is the safe default: every existing call site that
  // hits Tauri IPC (updater, fs) wraps the call in try/catch and degrades
  // to a no-op, so a rejected promise never surfaces to the user. We never
  // resolve because no dev-server path can actually service a Tauri command.
  const rejectingInvoke = (_cmd: string): Promise<never> =>
    Promise.reject(new Error(TAURI_DEV_FALLBACK_ERROR));

  w.__TAURI_INTERNALS__ = { invoke: rejectingInvoke };
  w.__TAURI__ = { invoke: rejectingInvoke };

  docEl.setAttribute(TAURI_DEV_FALLBACK_ATTR, TAURI_FALLBACK_FLAG_VALUE);
  return true;
}
