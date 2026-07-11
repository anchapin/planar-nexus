/**
 * @fileOverview Tauri 2 desktop auto-update wrapper (issue #1403).
 *
 * This module is the single frontend entry point for the in-app updater
 * UX. It wraps `@tauri-apps/plugin-updater`'s `check()` so the rest of the
 * app never has to touch Tauri-specific globals, the call can be mocked in
 * tests, and the runtime invariant "no update available → silent no-op,
 * never throw" is enforced in one place.
 *
 * Wire diagram:
 *
 *   src/hooks/use-desktop-update.ts
 *           │
 *           ▼
 *   src/lib/updater.ts  ← this file
 *           │
 *           ▼
 *   @tauri-apps/plugin-updater.check()     (only inside Tauri webview)
 *
 * The `updater:default` capability (src-tauri/capabilities/default.json)
 * must be granted for `check()` / `downloadAndInstall()` to succeed at
 * runtime. The capability-audit test (tests/capability-audit.test.ts)
 * enforces the inverse: this file MUST be imported by the frontend
 * whenever the `updater:default` permission is granted, otherwise the
 * audit test fails.
 */

import { logger } from "@/lib/logger";

/**
 * Stable identity for the updater subsystem so log lines from the hook,
 * the banner, and this module can be grep'd together.
 */
const LOG_NAMESPACE = "updater";

/**
 * The full base64-encoded minisign public key pinned in
 * src-tauri/tauri.conf.json `plugins.updater.pubkey`. Surfaced in logs
 * and the "Update available" banner so operators can verify the
 * running binary trusts the right signing key without grepping the
 * bundle. Named "fingerprint" because that is its operator-facing
 * purpose, but the value is the entire pubkey (both the
 * `untrusted comment:` line and the key material line) so a single
 * equality check is sufficient to detect drift between this constant
 * and the bundle config.
 */
export const UPDATER_PUBKEY_FINGERPRINT =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDIxOEY1MTQ5OTI0MTAzRTQKUldUa0EwR1NTVkdQSVpsWW1jYXJlSlZLSG0xYmc4OXAvbWtDdVNLRVltekR4NUtvN01LSFp0VnYK";

/**
 * Operator-friendly 16-character prefix of the minisign pubkey, used
 * by the in-app "Update available" banner. Derived from
 * {@link UPDATER_PUBKEY_FINGERPRINT} so the two can never disagree.
 */
export const UPDATER_PUBKEY_DISPLAY_PREFIX = UPDATER_PUBKEY_FINGERPRINT.slice(
  0,
  16,
);

// ---------------------------------------------------------------------------
// Tauri runtime detection
// ---------------------------------------------------------------------------

/**
 * Return true iff we are executing inside the Tauri 2 webview. In the
 * browser (or under jsdom in unit tests) this returns false and the
 * updater becomes a pure no-op so the rest of the app never has to
 * branch.
 *
 * Detection mirrors src/lib/indexeddb-storage.ts isTauri() but is kept
 * here to avoid a runtime dependency on the storage module and to make
 * the contract obvious to readers of this file.
 */
export function isTauriEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
    undefined
  );
}

// ---------------------------------------------------------------------------
// Public types — kept narrow so the hook and the banner can render without
// importing @tauri-apps/plugin-updater (which would pull Tauri globals into
// the SSR/jest graph).
// ---------------------------------------------------------------------------

export interface DesktopUpdateAvailable {
  /** A newer release was found. */
  available: true;
  /** Semver string from the release manifest. */
  version: string;
  /** Release notes / changelog body (may be empty). */
  notes: string | null;
  /** When the update was published, ISO-8601 (may be null on malformed manifests). */
  publishedAt: string | null;
  /** The first 16 chars of the signing pubkey the running binary trusts. */
  pubkeyFingerprint: string;
}

export interface DesktopUpdateNone {
  /** No newer release than the currently running version. */
  available: false;
  /** The version reported as "current" by the manifest comparator. */
  currentVersion: string;
}

export interface DesktopUpdateError {
  /** The check failed; details are in `reason`. */
  available: false;
  currentVersion: string | null;
  reason: string;
}

/** Discriminated union returned by {@link checkForDesktopUpdate}. */
export type DesktopUpdateResult =
  DesktopUpdateAvailable | DesktopUpdateNone | DesktopUpdateError;

// ---------------------------------------------------------------------------
// checkForDesktopUpdate — pure-async, never throws
// ---------------------------------------------------------------------------

/**
 * Perform the in-app auto-update check.
 *
 * Returns a discriminated result instead of throwing so the caller (the
 * React hook) can render an appropriate state without try/catch noise.
 *
 * Behaviour matrix:
 *
 *   | Environment           | Behaviour                              |
 *   |-----------------------|----------------------------------------|
 *   | Browser / jsdom       | { available: false, currentVersion: '' }|
 *   | Tauri, offline/error  | { available: false, reason: '...' }    |
 *   | Tauri, up-to-date     | { available: false, currentVersion }   |
 *   | Tauri, update found   | { available: true, version, notes }    |
 *
 * The underlying `@tauri-apps/plugin-updater` is dynamically imported so
 *   (a) the module is never evaluated in a non-Tauri bundle, and
 *   (b) jest can mock it via `jest.mock('@tauri-apps/plugin-updater')`.
 */
export async function checkForDesktopUpdate(): Promise<DesktopUpdateResult> {
  if (!isTauriEnvironment()) {
    return { available: false, currentVersion: "" };
  }

  try {
      // @ts-expect-error TS2307 - lazy Tauri import
      const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();

    if (!update) {
      // No update available — `check()` returns null in that case. We
      // don't have a direct read of the "current" version from this
      // path, so we expose the empty string and let the caller fall
      // back to a build-time constant if it cares.
      logger.debug(LOG_NAMESPACE, "No update available");
      return { available: false, currentVersion: "" };
    }

    const version = update.version ?? "unknown";
    const notes =
      typeof update.body === "string" && update.body.length > 0
        ? update.body
        : null;
    const publishedAt =
      typeof update.date === "string" && update.date.length > 0
        ? update.date
        : null;

    logger.info(LOG_NAMESPACE, `Update available: ${version}`);
    return {
      available: true,
      version,
      notes,
      publishedAt,
      pubkeyFingerprint: UPDATER_PUBKEY_FINGERPRINT,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(LOG_NAMESPACE, `Update check failed: ${reason}`);
    return {
      available: false,
      currentVersion: null,
      reason,
    };
  }
}

/**
 * Download and install the update previously surfaced by
 * {@link checkForDesktopUpdate}. Throws on failure — callers (the banner)
 * are expected to wrap this in try/catch and surface the failure inline.
 *
 * Note: this function does NOT call `relaunch()`. Restart is an explicit
 * user gesture (the "Restart now" button in the banner), so it stays
 * out of band here. See {@link relaunchDesktop} for that step.
 */
export async function downloadAndInstallDesktopUpdate(): Promise<void> {
  if (!isTauriEnvironment()) return;
  // @ts-expect-error TS2307 - lazy Tauri import
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return;
  await update.downloadAndInstall();
}

/**
 * Relaunch the desktop app after an installed update. Imported lazily
 * to keep `@tauri-apps/plugin-process` out of the non-Tauri bundle.
 */
export async function relaunchDesktop(): Promise<void> {
  if (!isTauriEnvironment()) return;
  // @ts-expect-error TS2307 - lazy Tauri import
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
