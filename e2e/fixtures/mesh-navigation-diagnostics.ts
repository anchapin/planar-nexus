/**
 * Per-peer navigation diagnostics for the mesh E2E fixture (issue #2604).
 *
 * WHY
 * ---
 * On WebKit the mesh peers intermittently lose their page state mid-test:
 * the harness globals (`window.__peer`) disappear and Playwright reports
 * "Execution context was destroyed". That message only says the execution
 * context went away — it does NOT say whether the document was reloaded, a
 * frame navigated, the renderer crashed, or the page was closed.
 *
 * This module makes the reload VISIBLE, per peer, with:
 *   - the peer id,
 *   - a monotonic timestamp (ms since the diagnostic was installed) plus
 *     the wall-clock ISO time,
 *   - the URL that was navigated to / loaded,
 *   - whether the frame was the main frame,
 *   - and the app-side console errors that surrounded the navigation
 *     (the IndexedDB "closed database" / "IndexedDB not available"
 *     messages reported in issue #2604).
 *
 * The events are printed to the test process stdout (so they land in the
 * Playwright list-reporter output and in CI logs) AND retained in memory so
 * a failing test can assert on / dump them.
 *
 * The diagnostics are READ-ONLY: they never touch the page, never install
 * init scripts, and never influence timing. They can therefore stay in the
 * fixture permanently without changing what the mesh tests exercise.
 */
import type { Frame, Page } from "@playwright/test";

/** One recorded navigation / load / error event. */
export interface MeshNavEvent {
  /** Peer id (the harness `playerId`). */
  peerId: string;
  /** Event kind. */
  kind:
    | "framenavigated"
    | "load"
    | "domcontentloaded"
    | "pageerror"
    | "console"
    | "crash"
    | "close";
  /** Wall-clock ISO timestamp of the event. */
  at: string;
  /** Milliseconds since the diagnostics were installed. */
  sinceInstallMs: number;
  /** URL the event refers to (empty string when not applicable). */
  url: string;
  /** Whether the event refers to the main frame (navigation events only). */
  isMainFrame: boolean | null;
  /** Free-form detail (console text, error message, …). */
  detail: string;
}

/** Handle returned by {@link installMeshNavigationDiagnostics}. */
export interface MeshNavigationDiagnostics {
  peerId: string;
  /** Every event seen so far, oldest first. */
  events: MeshNavEvent[];
  /** Number of main-frame `framenavigated` events (i.e. document loads). */
  navigationCount(): number;
  /** Number of `load` events on the main frame. */
  loadCount(): number;
  /** One-line summary, e.g. `navs=2 loads=2 errors=1`. */
  summary(): string;
}

/**
 * Console/error substrings that are worth keeping in the diagnostics even
 * when the console level is "info"/"log" — these are the messages issue
 * #2604 quotes from the WebKit logs.
 */
const INTERESTING_CONSOLE_PATTERN =
  /indexeddb|indexed db|idbdatabase|closed database|localstorage|chunk|reload|service worker|serviceworker|hydrat|migration/i;

/**
 * Install the per-peer navigation diagnostics on `page`.
 *
 * @param page   The peer page to observe.
 * @param peerId The harness peer id, used as the log prefix.
 */
export function installMeshNavigationDiagnostics(
  page: Page,
  peerId: string,
): MeshNavigationDiagnostics {
  const installedAt = Date.now();
  const events: MeshNavEvent[] = [];

  const record = (
    kind: MeshNavEvent["kind"],
    url: string,
    isMainFrame: boolean | null,
    detail: string,
  ): void => {
    const now = Date.now();
    const event: MeshNavEvent = {
      peerId,
      kind,
      at: new Date(now).toISOString(),
      sinceInstallMs: now - installedAt,
      url,
      isMainFrame,
      detail,
    };
    events.push(event);
    // Keep the detail short so a chatty page cannot flood the CI log.
    const shortDetail = detail.replace(/\s+/g, " ").slice(0, 300);
    console.log(
      `[mesh-nav] peer=${peerId} event=${kind} t=+${event.sinceInstallMs}ms ` +
        `at=${event.at} main=${String(isMainFrame)} url=${url || "-"}` +
        (shortDetail ? ` detail=${shortDetail}` : ""),
    );
  };

  const frameUrl = (frame: Frame): string => {
    try {
      return frame.url();
    } catch {
      return "";
    }
  };

  page.on("framenavigated", (frame) => {
    record("framenavigated", frameUrl(frame), safeIsMainFrame(frame), "");
  });

  page.on("load", () => {
    record("load", safePageUrl(page), true, "");
    // The PerformanceNavigationTiming entry tells a RELOAD apart from a
    // fresh navigation ("reload" vs "navigate") — the decisive bit for
    // issue #2604 ("did the document get reloaded?").
    void captureNavigationType(page, peerId, record);
  });

  page.on("domcontentloaded", () => {
    record("domcontentloaded", safePageUrl(page), true, "");
  });

  page.on("pageerror", (error) => {
    record("pageerror", safePageUrl(page), null, error.message);
  });

  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "error" ||
      message.type() === "warning" ||
      INTERESTING_CONSOLE_PATTERN.test(text)
    ) {
      record("console", safePageUrl(page), null, `[${message.type()}] ${text}`);
    }
  });

  // A reload re-fetches the main document: log document-level requests so
  // the reload is visible as a network event too (with the HTTP status).
  page.on("response", (response) => {
    if (response.request().resourceType() !== "document") return;
    record(
      "console",
      safePageUrl(page),
      null,
      `[doc-response] status=${response.status()} url=${response.url()}`,
    );
  });

  page.on("crash", () => {
    record("crash", safePageUrl(page), null, "page crashed");
  });

  page.on("close", () => {
    record("close", safePageUrl(page), null, "page closed");
  });

  const diagnostics: MeshNavigationDiagnostics = {
    peerId,
    events,
    navigationCount: () =>
      events.filter(
        (e) => e.kind === "framenavigated" && e.isMainFrame === true,
      ).length,
    loadCount: () => events.filter((e) => e.kind === "load").length,
    summary: () => {
      const navs = diagnostics.navigationCount();
      const loads = diagnostics.loadCount();
      const errors = events.filter(
        (e) => e.kind === "pageerror" || e.kind === "crash",
      ).length;
      return `peer=${peerId} navs=${navs} loads=${loads} errors=${errors}`;
    },
  };

  record(
    "console",
    safePageUrl(page),
    null,
    "[mesh-nav] diagnostics installed",
  );

  return diagnostics;
}

/**
 * Print a compact per-peer summary of the collected diagnostics. Called
 * from the spec's `finally` blocks so the summary is visible even when
 * the test failed.
 */
export function summarizeMeshNavigationDiagnostics(
  diagnostics: MeshNavigationDiagnostics[],
): void {
  for (const d of diagnostics) {
    console.log(`[mesh-nav] SUMMARY ${d.summary()}`);
    for (const event of d.events) {
      if (event.kind === "framenavigated" || event.kind === "load") {
        console.log(
          `[mesh-nav]   ${d.peerId} ${event.kind} t=+${event.sinceInstallMs}ms url=${event.url}`,
        );
      }
    }
  }
}

function safeIsMainFrame(frame: Frame): boolean | null {
  try {
    return frame === frame.page().mainFrame();
  } catch {
    return null;
  }
}

function safePageUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return "";
  }
}

/**
 * Read the current document's navigation entry and record it. A `reload`
 * type means the document was reloaded in place (the page state — and with
 * it the injected `window.__peer` harness — is gone); `navigate` means a
 * fresh navigation happened.
 */
async function captureNavigationType(
  page: Page,
  peerId: string,
  record: (
    kind: MeshNavEvent["kind"],
    url: string,
    isMainFrame: boolean | null,
    detail: string,
  ) => void,
): Promise<void> {
  try {
    const info = await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      return {
        type: entry?.type ?? "unknown",
        redirectCount: entry?.redirectCount ?? -1,
        durationMs: entry ? Math.round(entry.duration) : -1,
        referrer: document.referrer || "",
      };
    });
    record(
      "console",
      safePageUrl(page),
      null,
      `[nav-type] ${info.type} redirects=${info.redirectCount} ` +
        `durationMs=${info.durationMs} referrer=${info.referrer || "-"}`,
    );
  } catch (error) {
    record(
      "console",
      safePageUrl(page),
      null,
      `[nav-type] unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
