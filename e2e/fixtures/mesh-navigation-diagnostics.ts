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
 *
 * APP-SIDE CORRELATION (issue #2604, diagnosis step 2)
 * ---------------------------------------------------
 * PR #2865 (diagnosis step 1) proved the reload happens ~15.4s into the
 * setup with no dev-server recompile, and its stated next step was to
 * "correlate the navigation timestamp against app-side storage/recovery
 * logging on a failing run". The app now records every reload trigger and
 * every IndexedDB open/upgrade/blocked/versionchange/recovery event into a
 * shared in-page event log (`src/lib/app-event-recorder.ts`), which is
 * mirrored into `sessionStorage` so it survives the very navigation being
 * diagnosed.
 *
 * This fixture picks that log up in two complementary ways:
 *
 *   1. LIVE (primary): the recorder prints every entry to the console with
 *      an `[app-event]` marker. The console listener below captures those
 *      lines as they happen — i.e. BEFORE a navigation can destroy the
 *      page's execution context. This is the only channel that keeps the
 *      pre-reload part of the log when the context dies mid-test.
 *   2. MIRROR (cross-check): after each load the fixture reads the
 *      `sessionStorage` mirror through `page.evaluate`, which survives the
 *      navigation. Best-effort: a destroyed context is tolerated.
 *
 * CLOCK BASIS
 * -----------
 * Both channels use `Date.now()` (wall clock, epoch milliseconds). The
 * app-side recorder deliberately does NOT use `performance.now()` as its
 * correlation clock: `performance.now()` is relative to the *document's*
 * time origin and therefore resets on every reload — exactly the boundary
 * we are correlating across — while two `Date.now()` readings from the
 * same machine are directly comparable. The app events additionally carry
 * `sinceLoadMs` (a `performance.now()` reading), which is useful for
 * ordering WITHIN one document but is never used for the cross-navigation
 * correlation below.
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
    | "app-event"
    | "crash"
    | "close";
  /** Wall-clock ISO timestamp of the event. */
  at: string;
  /**
   * Epoch milliseconds (`Date.now()`) of the event — the correlation clock
   * shared with the app-side event log.
   */
  t: number;
  /** Milliseconds since the diagnostics were installed. */
  sinceInstallMs: number;
  /** URL the event refers to (empty string when not applicable). */
  url: string;
  /** Whether the event refers to the main frame (navigation events only). */
  isMainFrame: boolean | null;
  /** Free-form detail (console text, error message, …). */
  detail: string;
}

/**
 * One app-side event, mirrored from the in-page recorder
 * (`src/lib/app-event-recorder.ts`).
 */
export interface MeshAppEvent {
  /** Peer id (the harness `playerId`). */
  peerId: string;
  /** Monotonic sequence number (continues across a reload). */
  seq: number;
  /** Stable label, e.g. `idb:blocked` or `sw-reload:update-available-click`. */
  label: string;
  /** Epoch milliseconds (`Date.now()`) — the correlation clock. */
  t: number;
  /** ISO rendering of {@link MeshAppEvent.t}. */
  at: string;
  /** `performance.now()` since THIS document loaded (intra-document only). */
  sinceLoadMs: number | null;
  /** Free-form detail. */
  detail: string;
}

/** Handle returned by {@link installMeshNavigationDiagnostics}. */
export interface MeshNavigationDiagnostics {
  peerId: string;
  /** Every event seen so far, oldest first. */
  events: MeshNavEvent[];
  /** Every app-side event seen so far, oldest first. */
  appEvents: MeshAppEvent[];
  /** Number of main-frame `framenavigated` events (i.e. document loads). */
  navigationCount(): number;
  /** Number of `load` events on the main frame. */
  loadCount(): number;
  /** Number of app-side events captured so far. */
  appEventCount(): number;
  /**
   * Read the app-side event log from the page's `sessionStorage` mirror.
   * Best-effort: resolves `null` when the execution context is gone.
   */
  readAppEventMirror(): Promise<MeshAppEvent[] | null>;
  /** One-line summary, e.g. `navs=2 loads=2 errors=1 appEvents=7`. */
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
 * Marker that identifies an app-side recorder line in the console stream.
 * Must match `APP_EVENT_CONSOLE_MARKER` in `src/lib/app-event-recorder.ts`.
 */
const APP_EVENT_MARKER = "[app-event]";

/**
 * `sessionStorage` key of the app-side event mirror. Must match
 * `APP_EVENT_STORAGE_KEY` in `src/lib/app-event-recorder.ts`.
 */
const APP_EVENT_STORAGE_KEY = "planar-nexus:app-events";

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
  const appEvents: MeshAppEvent[] = [];

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
      t: now,
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
    // Cross-check the live console capture against the app-side
    // `sessionStorage` mirror, which survives the navigation.
    void captureAppEventMirror(page, peerId, appEvents);
  });

  page.on("domcontentloaded", () => {
    record("domcontentloaded", safePageUrl(page), true, "");
  });

  page.on("pageerror", (error) => {
    record("pageerror", safePageUrl(page), null, error.message);
  });

  page.on("console", (message) => {
    const text = message.text();
    // Issue #2604 (diagnosis step 2): the app-side recorder prints every
    // entry with an `[app-event]` marker. Capture those FIRST — they are
    // the app-side half of the correlation, and they are only visible
    // while the page is alive.
    const appEvent = parseAppEventConsoleText(text);
    if (appEvent) {
      const entry: MeshAppEvent = { ...appEvent, peerId };
      appEvents.push(entry);
      record(
        "app-event",
        safePageUrl(page),
        null,
        `[app-event] ${entry.label} t=${entry.t} ${entry.detail}`.trim(),
      );
      return;
    }
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
    appEvents,
    navigationCount: () =>
      events.filter(
        (e) => e.kind === "framenavigated" && e.isMainFrame === true,
      ).length,
    loadCount: () => events.filter((e) => e.kind === "load").length,
    appEventCount: () => appEvents.length,
    readAppEventMirror: () => readAppEventMirror(page, peerId),
    summary: () => {
      const navs = diagnostics.navigationCount();
      const loads = diagnostics.loadCount();
      const errors = events.filter(
        (e) => e.kind === "pageerror" || e.kind === "crash",
      ).length;
      return `peer=${peerId} navs=${navs} loads=${loads} errors=${errors} appEvents=${diagnostics.appEventCount()}`;
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
 *
 * Issue #2604 (diagnosis step 2): the summary now ALSO prints the peer's
 * app-side event log (the reload triggers and the IndexedDB
 * open/upgrade/blocked/versionchange/recovery events), each line
 * correlated against the nearest main-frame navigation event on the SAME
 * clock basis (`Date.now()`).
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

    // App-side correlation (issue #2604, diagnosis step 2).
    const correlations = correlateAppEvents(d.events, d.appEvents);
    if (correlations.length > 0) {
      console.log(
        `[mesh-nav]   ${d.peerId} app-side events (clock=Date.now, correlated with the nearest main-frame navigation):`,
      );
      for (const correlation of correlations) {
        console.log(
          `[mesh-nav]   ${formatAppEventLine(d.peerId, correlation)}`,
        );
      }
    }
  }
}

/**
 * One app-side event together with its correlation against the nearest
 * main-frame navigation event.
 */
export interface AppEventCorrelation {
  /** The app-side event. */
  event: MeshAppEvent;
  /**
   * Signed milliseconds to the nearest main-frame navigation event
   * (negative = the app event happened BEFORE the navigation). `null`
   * when the peer never navigated.
   */
  deltaMs: number | null;
  /** Kind of the navigation event correlated with, if any. */
  navKind: MeshNavEvent["kind"] | null;
}

/**
 * Parse an app-side recorder console line.
 *
 * Returns `null` for any console line that is not an app-side event (the
 * caller keeps its normal handling for those). Exported for unit tests.
 */
export function parseAppEventConsoleText(text: string): MeshAppEvent | null {
  if (typeof text !== "string") return null;
  const index = text.indexOf(APP_EVENT_MARKER);
  if (index === -1) return null;
  const payload = text.slice(index + APP_EVENT_MARKER.length).trim();
  if (!payload.startsWith("{")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const candidate = parsed as Partial<MeshAppEvent>;
  if (typeof candidate.label !== "string" || candidate.label.length === 0) {
    return null;
  }
  return {
    peerId: "",
    seq: typeof candidate.seq === "number" ? candidate.seq : 0,
    label: candidate.label,
    t: typeof candidate.t === "number" ? candidate.t : 0,
    at: typeof candidate.at === "string" ? candidate.at : "",
    sinceLoadMs:
      typeof candidate.sinceLoadMs === "number" ? candidate.sinceLoadMs : null,
    detail: typeof candidate.detail === "string" ? candidate.detail : "",
  };
}

/**
 * Correlate the app-side events with the nearest main-frame navigation
 * event. Both sides use `Date.now()` (epoch milliseconds), so the delta is
 * directly meaningful.
 *
 * Exported for unit tests.
 */
export function correlateAppEvents(
  navEvents: MeshNavEvent[],
  appEvents: MeshAppEvent[],
): AppEventCorrelation[] {
  const navigations = navEvents.filter(
    (e) =>
      (e.kind === "framenavigated" || e.kind === "load") &&
      e.isMainFrame !== false,
  );

  return appEvents.map((event) => {
    let nearest: MeshNavEvent | null = null;
    let nearestDelta = Number.POSITIVE_INFINITY;
    for (const nav of navigations) {
      const delta = event.t - nav.t;
      if (Math.abs(delta) < Math.abs(nearestDelta)) {
        nearest = nav;
        nearestDelta = delta;
      }
    }
    return {
      event,
      deltaMs: nearest ? nearestDelta : null,
      navKind: nearest ? nearest.kind : null,
    };
  });
}

/**
 * Render one correlated app-side event as a log line.
 *
 * Exported for unit tests.
 */
export function formatAppEventLine(
  peerId: string,
  correlation: AppEventCorrelation,
): string {
  const { event, deltaMs, navKind } = correlation;
  const detail = event.detail ? ` — ${event.detail}` : "";
  if (deltaMs === null) {
    return `${peerId} ${event.label} t=${event.t}${detail} (no navigation observed)`;
  }
  const relation =
    deltaMs === 0
      ? "at the navigation"
      : deltaMs < 0
        ? `${Math.abs(deltaMs)}ms before the ${navKind}`
        : `${deltaMs}ms after the ${navKind}`;
  return `${peerId} ${event.label} t=${event.t}${detail} (${relation})`;
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

/**
 * Read the app-side event log from the page.
 *
 * Two sources, merged (the mirror first — it is the one that survives a
 * navigation):
 *   - the `sessionStorage` mirror written by `src/lib/app-event-recorder.ts`,
 *   - the live `window.__planarAppEvents` array.
 *
 * Tolerates a destroyed execution context (resolves `null`).
 */
async function readAppEventMirror(
  page: Page,
  peerId: string,
): Promise<MeshAppEvent[] | null> {
  try {
    const raw = await page.evaluate((storageKey) => {
      const mirror: string | null = (() => {
        try {
          return window.sessionStorage.getItem(storageKey);
        } catch {
          return null;
        }
      })();
      const live = (() => {
        try {
          const array = (window as unknown as { __planarAppEvents?: unknown })
            .__planarAppEvents;
          return Array.isArray(array) ? array : [];
        } catch {
          return [];
        }
      })();
      return { mirror, live };
    }, APP_EVENT_STORAGE_KEY);

    const entries: MeshAppEvent[] = [];
    const seen = new Set<string>();

    const push = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const candidate = value as Partial<MeshAppEvent>;
      if (typeof candidate.label !== "string") return;
      const key = `${candidate.seq ?? ""}|${candidate.label}|${
        candidate.t ?? ""
      }`;
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({
        peerId,
        seq: typeof candidate.seq === "number" ? candidate.seq : 0,
        label: candidate.label,
        t: typeof candidate.t === "number" ? candidate.t : 0,
        at: typeof candidate.at === "string" ? candidate.at : "",
        sinceLoadMs:
          typeof candidate.sinceLoadMs === "number"
            ? candidate.sinceLoadMs
            : null,
        detail: typeof candidate.detail === "string" ? candidate.detail : "",
      });
    };

    if (raw.mirror) {
      try {
        const parsed: unknown = JSON.parse(raw.mirror);
        if (Array.isArray(parsed)) parsed.forEach(push);
      } catch {
        // A corrupt mirror must not break the diagnostics.
      }
    }
    raw.live.forEach(push);

    entries.sort((a, b) => a.seq - b.seq || a.t - b.t);
    return entries;
  } catch {
    // The execution context is gone (the very failure we diagnose) — the
    // live console capture already holds what was recorded before it.
    return null;
  }
}

/**
 * Capture the app-side event mirror after a load and merge it into the
 * live list (the mirror may hold entries that were recorded before a
 * navigation the console listener could not deliver).
 */
async function captureAppEventMirror(
  page: Page,
  peerId: string,
  appEvents: MeshAppEvent[],
): Promise<void> {
  const mirrored = await readAppEventMirror(page, peerId);
  if (!mirrored || mirrored.length === 0) return;

  const seen = new Set(appEvents.map((e) => `${e.seq}|${e.label}|${e.t}`));
  let added = 0;
  for (const entry of mirrored) {
    const key = `${entry.seq}|${entry.label}|${entry.t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    appEvents.push(entry);
    added += 1;
  }
  if (added > 0) {
    appEvents.sort((a, b) => a.seq - b.seq || a.t - b.t);
    console.log(
      `[mesh-nav] peer=${peerId} app-side mirror added ${added} event(s) ` +
        `after load (total=${appEvents.length})`,
    );
  }
}
