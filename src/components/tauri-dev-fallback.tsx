/**
 * @fileOverview Client-side mount point for the Tauri dev/test fallback
 * shim (issue #1433).
 *
 * Renders nothing. Its sole job is to call
 * {@link installTauriDevFallback} on the client so that, when the dev
 * server boots with `NEXT_PUBLIC_TAURI_FALLBACK=1`, the desktop code paths
 * (`isTauri()` / `isTauriEnvironment()`) engage against the dev server.
 *
 * Production safety is enforced inside the installer (double-gated on the
 * flag + `NODE_ENV`), so this component is harmless to mount unconditionally
 * — in a production build it is a no-op that returns `null`. See
 * `src/lib/tauri-mock.ts` for the full gating contract.
 */

"use client";

import { useEffect } from "react";

import { installTauriDevFallback } from "@/lib/tauri-mock";

/**
 * Invisible mount for the Tauri dev-fallback shim. Place once in the root
 * layout; it renders `null` and performs a one-shot, idempotent install.
 */
export function TauriDevFallback(): null {
  useEffect(() => {
    installTauriDevFallback();
  }, []);

  return null;
}
