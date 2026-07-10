/**
 * @fileOverview DesktopUpdateBanner — in-app "new version available" toast
 * for the Tauri 2 desktop build (issue #1403).
 *
 * Mounted at the root layout so it surfaces across the entire app. Renders
 * nothing when:
 *   - the user is on the web build (useDesktopUpdate().isSupported === false)
 *   - no update is available
 *   - the user has dismissed this release for the session
 *
 * Two actions:
 *   - "Restart now" → downloads + installs + relaunches the desktop binary.
 *   - "Later"      → hides the banner for the current session (sessionStorage).
 *
 * No native alert/confirm dialogs are used — per the closed UX lane, all
 * user-facing prompts must go through the React tree.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, X } from "lucide-react";

import { useDesktopUpdate } from "@/hooks/use-desktop-update";
import {
  downloadAndInstallDesktopUpdate,
  relaunchDesktop,
  UPDATER_PUBKEY_DISPLAY_PREFIX,
} from "@/lib/updater";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";

const DISMISS_STORAGE_KEY = "planar_nexus_updater_dismissed_version";

interface DismissState {
  version: string;
}

function readDismissed(): DismissState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DismissState>;
    if (typeof parsed.version === "string") return { version: parsed.version };
    return null;
  } catch {
    return null;
  }
}

function writeDismissed(state: DismissState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage quota / disabled — silently ignore. The banner will reappear
    // on the next render, which is acceptable: we never want to crash
    // the layout because the user said "Later".
  }
}

/**
 * Render the in-app "Update available" banner. Mounted once at the root
 * layout; renders `null` in every state other than "Tauri + update found".
 */
export function DesktopUpdateBanner() {
  const { isSupported, updateAvailable, result } = useDesktopUpdate();
  const [installing, setInstalling] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-read session dismiss on mount + whenever the available version
  // changes (so a later "Later" decision still suppresses the banner for
  // the current session).
  const availableVersion =
    result && "version" in result ? result.version : null;
  useEffect(() => {
    const d = readDismissed();
    setDismissedVersion(d?.version ?? null);
  }, [availableVersion]);

  const visible = useMemo(() => {
    if (!isSupported) return false;
    if (!updateAvailable) return false;
    if (!result || result.available !== true) return false;
    if (dismissedVersion && dismissedVersion === result.version) return false;
    return true;
  }, [isSupported, updateAvailable, result, dismissedVersion]);

  const handleLater = useCallback(() => {
    if (!result || result.available !== true) return;
    writeDismissed({ version: result.version });
    setDismissedVersion(result.version);
  }, [result]);

  const handleRestart = useCallback(async () => {
    if (!result || result.available !== true) return;
    setError(null);
    setInstalling(true);
    try {
      await downloadAndInstallDesktopUpdate();
      await relaunchDesktop();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("updater", "download/install failed", err);
      setError(msg);
      setInstalling(false);
    }
  }, [result]);

  if (!visible || !result || result.available !== true) return null;

  const { version, notes } = result;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="desktop-update-banner"
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-3xl",
        "border border-border/60 bg-background/95 backdrop-blur",
        "shadow-lg rounded-t-lg p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        "transition-transform",
      )}
    >
      <div className="flex items-start gap-3">
        <Download
          className="h-5 w-5 mt-0.5 text-primary shrink-0"
          aria-hidden
        />
        <div className="flex flex-col gap-1 min-w-0">
          <p className="text-sm font-semibold">Update available: v{version}</p>
          {notes ? (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {notes}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              A new desktop build is ready. Restart to install.
            </p>
          )}
          <p className="text-[10px] text-muted-foreground/70 font-mono">
            Signed by {UPDATER_PUBKEY_DISPLAY_PREFIX}…
          </p>
          {error ? (
            <p
              role="alert"
              className="text-xs text-destructive"
              data-testid="desktop-update-banner-error"
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={handleLater}
          disabled={installing}
          className={cn(
            "inline-flex items-center justify-center rounded-md border border-input",
            "bg-background px-3 py-1.5 text-xs font-medium",
            "hover:bg-accent hover:text-accent-foreground",
            "disabled:opacity-50 disabled:pointer-events-none",
          )}
          data-testid="desktop-update-banner-later"
        >
          <X className="h-3 w-3 mr-1" aria-hidden />
          Later
        </button>
        <button
          type="button"
          onClick={handleRestart}
          disabled={installing}
          className={cn(
            "inline-flex items-center justify-center rounded-md",
            "bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium",
            "hover:bg-primary/90",
            "disabled:opacity-50 disabled:pointer-events-none",
          )}
          data-testid="desktop-update-banner-restart"
        >
          <Download className="h-3 w-3 mr-1" aria-hidden />
          {installing ? "Installing…" : "Restart now"}
        </button>
      </div>
    </div>
  );
}
