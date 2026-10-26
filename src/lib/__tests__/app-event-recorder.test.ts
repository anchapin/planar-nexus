/**
 * @fileoverview Unit tests for the shared app-side event recorder
 * (issue #2604 — diagnosis step 2).
 *
 * The recorder is the app-side half of the navigation correlation that
 * PR #2865 asked for ("correlate the navigation timestamp against
 * app-side storage/recovery logging on a failing run"). These tests pin
 * the four properties the e2e fixture depends on:
 *
 *   1. APPEND / ORDER — events are appended in call order with a
 *      monotonic sequence number that continues across a reload.
 *   2. STORAGE MIRROR — the log is mirrored into `sessionStorage` under
 *      the documented key, in a shape a fresh document can rehydrate.
 *   3. GRACEFUL DEGRADATION — when `sessionStorage` is unavailable
 *      (WebKit private mode / storage-blocked context, the case issue
 *      #2604 describes) the recorder keeps the in-memory log and never
 *      throws.
 *   4. IDB LIFECYCLE — the recorder observes the IndexedDB open /
 *      upgrade / blocked / error events of every database in the app.
 */

/** The recorder module, re-importable so each test gets fresh state. */
type RecorderModule = typeof import("../app-event-recorder");

/**
 * Load a FRESH copy of the recorder module. The module keeps its log in
 * module scope (that is the point: the log belongs to the document), so
 * every test starts from a clean instance. `jest.resetModules()` +
 * dynamic import gives us the "new document" semantics the reload
 * scenario needs.
 */
async function loadRecorder(): Promise<RecorderModule> {
  jest.resetModules();
  return (await import("../app-event-recorder")) as RecorderModule;
}

/** Labels of the recorded events, in order. */
function labels(recorder: RecorderModule): string[] {
  return recorder.getAppEvents().map((event) => event.label);
}

describe("app-event-recorder — append and order (#2604)", () => {
  it("appends events in call order with a monotonic sequence number", async () => {
    const recorder = await loadRecorder();

    recorder.recordAppEvent("first", "a");
    recorder.recordAppEvent("second", "b");
    recorder.recordAppEvent("third", "c");

    const events = recorder.getAppEvents();
    expect(labels(recorder)).toEqual(["first", "second", "third"]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(events[0].detail).toBe("a");
  });

  it("stamps every event with a Date.now() correlation timestamp and an ISO twin", async () => {
    const recorder = await loadRecorder();
    const before = Date.now();

    const entry = recorder.recordAppEvent("sw-reload:update-available-click");

    expect(entry).not.toBeNull();
    expect(entry?.t).toBeGreaterThanOrEqual(before);
    expect(entry?.t).toBeLessThanOrEqual(Date.now());
    expect(entry?.at).toBe(new Date(entry!.t).toISOString());
  });

  it("never throws and keeps recording when the caller passes a non-string detail", async () => {
    const recorder = await loadRecorder();

    expect(() =>
      recorder.recordAppEvent("weird", undefined as unknown as string),
    ).not.toThrow();
    expect(labels(recorder)).toEqual(["weird"]);
  });

  it("caps the log so a runaway loop cannot fill the tab's storage", async () => {
    const recorder = await loadRecorder();

    for (let i = 0; i < recorder.MAX_APP_EVENTS + 25; i += 1) {
      recorder.recordAppEvent(`event-${i}`);
    }

    const events = recorder.getAppEvents();
    expect(events.length).toBe(recorder.MAX_APP_EVENTS);
    // The OLDEST entries are dropped, the newest are kept.
    expect(events[events.length - 1].label).toBe(
      `event-${recorder.MAX_APP_EVENTS + 24}`,
    );
  });
});

describe("app-event-recorder — sessionStorage mirror (#2604)", () => {
  it("mirrors the log into sessionStorage under the documented key", async () => {
    const recorder = await loadRecorder();

    recorder.recordAppEvent("idb:open-request", "db=PlanarNexusStorage");
    recorder.recordAppEvent("idb:blocked", "db=PlanarNexusStorage");

    const raw = window.sessionStorage.getItem(recorder.APP_EVENT_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      label: "idb:open-request",
      detail: "db=PlanarNexusStorage",
    });
    expect(typeof parsed[0].t).toBe("number");
    expect(typeof parsed[0].at).toBe("string");
    expect(typeof parsed[0].seq).toBe("number");
  });

  it("rehydrates the mirrored log in a fresh document (the reload case)", async () => {
    const first = await loadRecorder();
    first.recordAppEvent("sw-reload:force-update-click", "before reload");
    first.recordAppEvent("app:pagehide", "type=reload");

    // A "reload" creates a NEW document: a fresh module instance that
    // starts with an empty in-memory log and rehydrates from the mirror.
    const second = await loadRecorder();
    expect(second.getAppEvents()).toHaveLength(0);

    second.installAppEventRecorder();

    expect(labels(second)).toEqual([
      "sw-reload:force-update-click",
      "app:pagehide",
      "app:recorder-install",
      "app:document-load",
    ]);
    // The sequence continues across the document boundary.
    const seqs = second.getAppEvents().map((event) => event.seq);
    expect(seqs).toEqual([1, 2, 3, 4]);
  });

  it("keeps the pre-reload entries when the new document records its own events", async () => {
    const first = await loadRecorder();
    first.recordAppEvent("idb:blocked-reject", "db=Cards");

    const second = await loadRecorder();
    second.installAppEventRecorder();
    second.recordAppEvent("idb:open-request", "db=PlanarNexusStorage");

    const labelsSeen = labels(second);
    expect(labelsSeen[0]).toBe("idb:blocked-reject");
    expect(labelsSeen).toContain("idb:open-request");
    // The mirror now carries BOTH documents' entries.
    const raw = window.sessionStorage.getItem(second.APP_EVENT_STORAGE_KEY);
    expect(JSON.parse(raw as string)).toHaveLength(labelsSeen.length);
  });
});

describe("app-event-recorder — graceful degradation without storage (#2604)", () => {
  it("keeps the in-memory log when sessionStorage.setItem throws (private mode)", async () => {
    const recorder = await loadRecorder();
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError: storage is full");
        },
        removeItem: () => undefined,
      },
    });

    try {
      expect(() =>
        recorder.recordAppEvent("idb:open-error", "db=X"),
      ).not.toThrow();
      expect(labels(recorder)).toEqual(["idb:open-error"]);
      expect(recorder.isAppEventMirrorAvailable()).toBe(false);
    } finally {
      if (original) Object.defineProperty(window, "sessionStorage", original);
    }
  });

  it("survives a sessionStorage accessor that throws on access", async () => {
    const recorder = await loadRecorder();
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: storage is disabled");
      },
    });

    try {
      expect(() => recorder.installAppEventRecorder()).not.toThrow();
      expect(() => recorder.recordAppEvent("app:pagehide")).not.toThrow();
      expect(labels(recorder)).toContain("app:pagehide");
      expect(recorder.isAppEventMirrorAvailable()).toBe(false);
    } finally {
      if (original) Object.defineProperty(window, "sessionStorage", original);
    }
  });

  it("ignores a corrupt mirror instead of throwing", async () => {
    const recorder = await loadRecorder();
    window.sessionStorage.setItem(recorder.APP_EVENT_STORAGE_KEY, "{not json");

    const fresh = await loadRecorder();
    expect(() => fresh.installAppEventRecorder()).not.toThrow();
    expect(fresh.getAppEvents().every((event) => event.label.length > 0)).toBe(
      true,
    );
  });
});

describe("app-event-recorder — console channel for the e2e fixture (#2604)", () => {
  it("prints a parseable '[app-event] <json>' console line per event", async () => {
    const recorder = await loadRecorder();
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});

    try {
      recorder.recordAppEvent("sw-reload:update-available-click", "clicked");
      expect(infoSpy).toHaveBeenCalledTimes(1);
      const line = String(infoSpy.mock.calls[0][0]);
      expect(line.startsWith(recorder.APP_EVENT_CONSOLE_MARKER)).toBe(true);
      const payload = JSON.parse(
        line.slice(recorder.APP_EVENT_CONSOLE_MARKER.length).trim(),
      );
      expect(payload).toMatchObject({
        label: "sw-reload:update-available-click",
        detail: "clicked",
      });
      expect(typeof payload.t).toBe("number");
    } finally {
      infoSpy.mockRestore();
    }
  });
});

describe("app-event-recorder — IndexedDB open lifecycle (#2604)", () => {
  it("records the open request, the upgrade and the successful open", async () => {
    const recorder = await loadRecorder();
    recorder.installAppEventRecorder();

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("RecorderTestDb", 1);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    const recorded = labels(recorder);
    expect(recorded).toContain("idb:open-request");
    expect(recorded).toContain("idb:upgrade");
    expect(recorded).toContain("idb:open-success");

    const openRequest = recorder
      .getAppEvents()
      .find((event) => event.label === "idb:open-request");
    expect(openRequest?.detail).toContain("db=RecorderTestDb");
    expect(openRequest?.detail).toContain("version=1");
  });

  it("records a failed open without breaking the caller", async () => {
    const recorder = await loadRecorder();
    recorder.installAppEventRecorder();

    // Version 0 is invalid: per the IDB spec the open throws synchronously
    // (TypeError). The recorder's contract is to record the failure and
    // re-throw unchanged — the instrumentation never swallows an error —
    // so the caller sees exactly the throw the uninstrumented open gives.
    expect(() => indexedDB.open("RecorderInvalidDb", 0)).toThrow(
      /version cannot be 0/i,
    );

    expect(labels(recorder)).toContain("idb:open-error");
  });
});
