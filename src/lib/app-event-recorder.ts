/**
 * @fileOverview Shared app-side event recorder (issue #2604 — diagnosis step 2).
 *
 * WHY
 * ---
 * PR #2865 (diagnosis step 1) proved that a second main-frame navigation /
 * reload makes a WebKit mesh peer lose its page state ~15.4s into the
 * setup, with no dev-server recompile involved. Its stated next step was
 * verbatim: "correlate the navigation timestamp against app-side
 * storage/recovery logging on a failing run".
 *
 * That correlation needs ONE app-side log that:
 *
 *   1. is written by the app itself (not by the test harness), so it can be
 *      compared with the harness' navigation timestamps;
 *   2. survives the very navigation being diagnosed — a plain in-memory
 *      array is wiped by the reload, so the log is ALSO mirrored into
 *      `sessionStorage`, which survives a same-tab reload (but not a
 *      cross-tab navigation, which is exactly the semantics we want: one
 *      log per peer tab);
 *   3. never changes app behaviour. Everything here is recording only: no
 *      storage logic, no service-worker logic and no error-boundary logic
 *      is altered by this module. The single global it touches is
 *      `indexedDB.open`, which is wrapped (not replaced) so every open /
 *      upgrade / blocked / error event in the app is observable — including
 *      the opens performed by modules this diagnosis is not allowed to edit
 *      (`p2p-reconnect-store.ts`, `src/lib/migrations/*`).
 *
 * CLOCK BASIS
 * -----------
 * The correlation clock is `Date.now()` (wall clock, epoch milliseconds).
 *
 * `performance.now()` is deliberately NOT the correlation clock: it is
 * relative to the *document's* time origin, so it resets to ~0 on every
 * reload — precisely the boundary we are trying to correlate across. Two
 * `performance.now()` readings taken before and after a reload are NOT
 * comparable (they come from two different time origins), while two
 * `Date.now()` readings from the same machine are directly comparable.
 * `performance.now()` is still recorded per entry as `sinceLoadMs`, but
 * only as an intra-document ordering aid.
 *
 * The e2e navigation diagnostics (`e2e/fixtures/mesh-navigation-diagnostics.ts`)
 * use `Date.now()` as well, so app-side entries and navigation events share
 * one clock basis and can be differenced directly.
 */

/**
 * `sessionStorage` key holding the JSON mirror of the event log.
 *
 * `sessionStorage` (not `localStorage`) is deliberate: it is scoped to the
 * tab, so each mesh peer keeps its OWN log, and it survives a reload of
 * that tab — which is the navigation we are diagnosing. It is cleared when
 * the tab/context is closed, so a stale log can never leak between peers.
 */
export const APP_EVENT_STORAGE_KEY = "planar-nexus:app-events";

/**
 * Console marker prefixed to every recorded event.
 *
 * The e2e fixture captures these console lines live (they arrive in the
 * test process BEFORE a navigation can destroy the page), which is the
 * only way to keep the pre-reload part of the log when the page's
 * execution context is destroyed mid-test.
 */
export const APP_EVENT_CONSOLE_MARKER = "[app-event]";

/**
 * Maximum number of entries kept in the log (in memory and in the
 * mirror). The log is a diagnostic aid, not a data store: a runaway loop
 * must not be able to fill the tab's storage quota.
 */
export const MAX_APP_EVENTS = 500;

/**
 * Global key under which the ACTIVE recorder instance publishes its
 * `record` function.
 *
 * The IndexedDB wrapper is installed once per page (it patches
 * `indexedDB.open`), but it must not be bound to one particular module
 * instance: a document can end up with a freshly evaluated module (a
 * reload, a lazily re-imported chunk) while the wrapper is still in
 * place. Dispatching through this global keeps the events flowing into
 * whichever recorder instance is currently installed.
 */
const ACTIVE_RECORDER_KEY = "__planarActiveAppEventRecorder";

/** One recorded app-side event. */
export interface AppEventEntry {
  /**
   * Monotonic sequence number. Continues across a reload (the counter is
   * derived from the mirrored log), so entries can be ordered even if two
   * events share the same millisecond.
   */
  seq: number;
  /** Stable, greppable label, e.g. `sw-reload:update-available-click`. */
  label: string;
  /**
   * Correlation timestamp — `Date.now()` epoch milliseconds. See the
   * "CLOCK BASIS" note in the file header.
   */
  t: number;
  /** ISO rendering of {@link AppEventEntry.t} (human-readable). */
  at: string;
  /**
   * `performance.now()` at the time of the event — milliseconds since THIS
   * document's time origin. Intra-document only; NOT comparable across a
   * reload.
   */
  sinceLoadMs: number | null;
  /** Free-form detail (db name, version, error text, …). */
  detail: string;
}

/** In-memory log (the "live" copy for the current document). */
let events: AppEventEntry[] = [];

/** Sequence counter for the current document (continues the mirror's). */
let nextSeq = 1;

/** Whether {@link installAppEventRecorder} already ran in this document. */
let installed = false;

/**
 * Whether the `sessionStorage` mirror is usable. Safari/WebKit in private
 * mode can throw on `setItem` (quota / privacy), and some embedded
 * webviews have no `sessionStorage` at all. When the mirror is
 * unavailable the recorder keeps working with the in-memory log only —
 * it never throws and never blocks the caller.
 */
let mirrorAvailable = true;

/** In-memory log accessor (read-only view for callers/tests). */
export function getAppEvents(): AppEventEntry[] {
  return events;
}

/** True when the recorder has been installed in this document. */
export function isAppEventRecorderInstalled(): boolean {
  return installed;
}

/**
 * True when the `sessionStorage` mirror is writable. False in WebKit
 * private mode / storage-blocked contexts — the case issue #2604 reports.
 */
export function isAppEventMirrorAvailable(): boolean {
  return mirrorAvailable;
}

/**
 * Record one app-side event.
 *
 * Never throws: a diagnostic aid must not be able to break the app it
 * observes. Returns the recorded entry (or `null` when the entry could
 * not be created at all).
 *
 * @param label  Stable label, e.g. `idb:blocked`.
 * @param detail Optional human-readable detail.
 */
export function recordAppEvent(
  label: string,
  detail = "",
): AppEventEntry | null {
  try {
    const t = Date.now();
    const entry: AppEventEntry = {
      seq: nextSeq++,
      label,
      t,
      at: new Date(t).toISOString(),
      sinceLoadMs: readPerformanceNow(),
      detail: typeof detail === "string" ? detail : String(detail),
    };

    events.push(entry);
    if (events.length > MAX_APP_EVENTS) {
      events.splice(0, events.length - MAX_APP_EVENTS);
    }

    // Mirror first: if the mirror write fails we still keep the in-memory
    // copy, and the failure is recorded ONCE (not on every event) to
    // avoid a console flood in a storage-blocked context.
    writeMirror();

    // Live console line — this is what the e2e fixture captures, because a
    // console line survives the navigation that destroys the page.
    writeConsole(entry);

    return entry;
  } catch {
    return null;
  }
}

/**
 * Install the recorder in the current document:
 *
 *   - rehydrates the log from the `sessionStorage` mirror (so the events
 *     recorded BEFORE a reload are still there AFTER it),
 *   - publishes the live log on `window.__planarAppEvents`,
 *   - wraps `indexedDB.open` so every open / upgrade / blocked / error
 *     event is recorded (see {@link installIndexedDbOpenInstrumentation}),
 *   - records the `app:document-load` entry, which is the app-side proof
 *     of whether the document was RELOADED or freshly navigated.
 *
 * Safe to call more than once (the second call is a no-op).
 */
export function installAppEventRecorder(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  rehydrateFromMirror();

  // Publish the live array on `window` so an e2e `page.evaluate` can read
  // it directly (in addition to the `sessionStorage` mirror).
  try {
    Object.defineProperty(window, "__planarAppEvents", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: events,
    });
  } catch {
    // Non-fatal: the mirror + console channel still work.
  }

  installIndexedDbOpenInstrumentation();

  // Publish this instance as the active recorder so the (page-lifetime)
  // IndexedDB wrapper keeps writing into the CURRENT instance.
  try {
    (globalThis as unknown as Record<string, unknown>)[ACTIVE_RECORDER_KEY] = (
      label: string,
      detail = "",
    ) => recordAppEvent(label, detail);
  } catch {
    // ignore
  }

  // Central "the document is going away" probe. `pagehide` fires for EVERY
  // way a document can be torn down — a reload button, a `location.href`
  // navigation, a browser-initiated navigation — which means the reload
  // triggers that live outside this diagnosis' editable surface are still
  // observable here. `beforeunload` is deliberately NOT used: a
  // `beforeunload` listener can make the browser show its "leave site?"
  // prompt, i.e. it would change behaviour. `pagehide` cannot.
  try {
    window.addEventListener("pagehide", () => {
      recordAppEvent("app:pagehide", describeDocumentLoad());
    });
  } catch {
    // ignore
  }

  recordAppEvent("app:recorder-install", describeDocumentLoad());
  recordAppEvent("app:document-load", describeDocumentLoad());
}

/**
 * Drop every recorded event (in memory AND in the mirror). Test helper —
 * the app never calls this.
 */
export function clearAppEvents(): void {
  events = [];
  nextSeq = 1;
  try {
    window.sessionStorage.removeItem(APP_EVENT_STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

/* ------------------------------------------------------------------ */
/* internals                                                          */
/* ------------------------------------------------------------------ */

/**
 * Record an event through the ACTIVE recorder instance (the one that was
 * installed last in this document). Used by the page-lifetime IndexedDB
 * wrapper, which must not be bound to a single module instance.
 */
function dispatchToActiveRecorder(label: string, detail = ""): void {
  try {
    const dispatcher = (globalThis as unknown as Record<string, unknown>)[
      ACTIVE_RECORDER_KEY
    ];
    if (typeof dispatcher === "function") {
      (dispatcher as (label: string, detail: string) => unknown)(label, detail);
      return;
    }
  } catch {
    // ignore
  }
  // No active recorder (e.g. the wrapper ran before `install`) — fall back
  // to this module's own log.
  recordAppEvent(label, detail);
}

/** `performance.now()` when available, `null` otherwise (SSR / old hosts). */
function readPerformanceNow(): number | null {
  try {
    if (
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
    ) {
      return Math.round(performance.now() * 1000) / 1000;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Describe how the current document was loaded: navigation type
 * (`reload` / `navigate` / `back_forward`), the URL and the document's
 * own performance origin.
 */
function describeDocumentLoad(): string {
  const parts: string[] = [];
  try {
    const entry = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    if (entry) {
      parts.push(`type=${entry.type}`);
      parts.push(`redirects=${entry.redirectCount}`);
    } else {
      parts.push("type=unknown");
    }
  } catch {
    parts.push("type=unknown");
  }
  try {
    parts.push(`url=${location.href}`);
  } catch {
    // ignore
  }
  return parts.join(" ");
}

/** Write the mirror into `sessionStorage`; never throws. */
function writeMirror(): void {
  try {
    const storage = window.sessionStorage;
    if (!storage) {
      mirrorAvailable = false;
      return;
    }
    storage.setItem(APP_EVENT_STORAGE_KEY, JSON.stringify(events));
    mirrorAvailable = true;
  } catch {
    // WebKit private mode / blocked storage: keep the in-memory log.
    mirrorAvailable = false;
  }
}

/** Read the mirror back into memory; never throws. */
function rehydrateFromMirror(): void {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(APP_EVENT_STORAGE_KEY);
  } catch {
    mirrorAvailable = false;
    return;
  }
  if (!raw) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;

  const restored: AppEventEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<AppEventEntry>;
    if (typeof candidate.label !== "string") continue;
    restored.push({
      seq:
        typeof candidate.seq === "number" ? candidate.seq : restored.length + 1,
      label: candidate.label,
      t: typeof candidate.t === "number" ? candidate.t : Date.now(),
      at: typeof candidate.at === "string" ? candidate.at : "",
      sinceLoadMs:
        typeof candidate.sinceLoadMs === "number"
          ? candidate.sinceLoadMs
          : null,
      detail: typeof candidate.detail === "string" ? candidate.detail : "",
    });
  }

  restored.sort((a, b) => a.seq - b.seq);
  events = restored.slice(-MAX_APP_EVENTS);
  const last = events[events.length - 1];
  nextSeq = last ? last.seq + 1 : 1;
}

/** Emit the live console line consumed by the e2e fixture. */
function writeConsole(entry: AppEventEntry): void {
  try {
    if (typeof console === "undefined" || typeof console.info !== "function") {
      return;
    }
    // A single string argument: the Playwright console listener receives
    // it verbatim (`message.text()`), so the e2e side can parse it back.
    console.info(`${APP_EVENT_CONSOLE_MARKER} ${JSON.stringify(entry)}`);
  } catch {
    // ignore
  }
}

/**
 * Wrap `indexedDB.open` so EVERY open in the app is observable.
 *
 * Why a wrapper instead of per-call-site logging: the open/upgrade/blocked
 * paths live in modules this diagnosis is not allowed to edit
 * (`p2p-reconnect-store.ts`, `src/lib/migrations/indexeddb-*.ts`) as well
 * as in the ones it is (`card-database.ts`, `indexeddb-storage.ts`). A
 * single wrapper covers all of them with one logging-only change.
 *
 * The wrapper is transparent: it calls the original `open`, returns the
 * original request, and only ADDS event listeners to that request (the
 * caller's own `on*` handlers are untouched). The `versionchange` event is
 * deliberately NOT logged here — it is recorded centrally by
 * `registerVersionChangeClose()` in `indexeddb-open-events.ts`, which every
 * database module already uses, so the log carries exactly one
 * `idb:versionchange-close` entry per event.
 */
function installIndexedDbOpenInstrumentation(): void {
  try {
    const factory: IDBFactory | undefined =
      typeof indexedDB !== "undefined" ? indexedDB : undefined;
    if (!factory) return;

    const patched = factory as IDBFactory & {
      __planarOpenInstrumented?: boolean;
      open: IDBFactory["open"];
    };
    if (patched.__planarOpenInstrumented) return;

    const originalOpen = patched.open.bind(factory);
    patched.open = function instrumentedOpen(
      this: IDBFactory,
      name: string,
      version?: number,
    ): IDBOpenDBRequest {
      let request: IDBOpenDBRequest;
      try {
        request = originalOpen(name, version);
      } catch (error) {
        // A SYNCHRONOUS throw from `indexedDB.open` is a real failure mode
        // (quota, private-mode quirks — see the open path in
        // `p2p-reconnect-store.ts`). Record it and re-throw unchanged: the
        // instrumentation never swallows an error.
        dispatchToActiveRecorder(
          "idb:open-error",
          `db=${name} thrown: ${
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error)
          }`,
        );
        throw error;
      }
      try {
        dispatchToActiveRecorder(
          "idb:open-request",
          `db=${name} version=${version === undefined ? "default" : version}`,
        );

        request.addEventListener("upgradeneeded", (event) => {
          // oldVersion/newVersion live on the IDBVersionChangeEvent, not
          // on the request (event.target) — read them off the event.
          const vcEvent = event as IDBVersionChangeEvent;
          let oldVersion = -1;
          let newVersion = -1;
          try {
            oldVersion = vcEvent.oldVersion ?? -1;
            newVersion = vcEvent.newVersion ?? -1;
          } catch {
            // ignore
          }
          dispatchToActiveRecorder(
            "idb:upgrade",
            `db=${name} oldVersion=${oldVersion} newVersion=${newVersion}`,
          );
        });

        request.addEventListener("blocked", () => {
          dispatchToActiveRecorder("idb:blocked", `db=${name}`);
        });

        request.addEventListener("success", () => {
          let openVersion = -1;
          try {
            openVersion = request.result?.version ?? -1;
          } catch {
            // ignore
          }
          dispatchToActiveRecorder(
            "idb:open-success",
            `db=${name} version=${openVersion}`,
          );
        });

        request.addEventListener("error", () => {
          let errorName = "unknown";
          let message = "";
          try {
            errorName = request.error?.name ?? "unknown";
            message = request.error?.message ?? "";
          } catch {
            // ignore
          }
          dispatchToActiveRecorder(
            "idb:open-error",
            `db=${name} error=${errorName} ${message}`.trim(),
          );
        });
      } catch {
        // Instrumentation must never break an open.
      }
      return request;
    } as IDBFactory["open"];

    patched.__planarOpenInstrumented = true;
  } catch {
    // No IndexedDB (SSR, exotic host) — nothing to instrument.
  }
}
