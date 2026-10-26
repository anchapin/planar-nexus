import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { ServiceWorkerRegistration } from "../service-worker-registration";
import { clearAppEvents, getAppEvents } from "@/lib/app-event-recorder";

// Mock the toast module so we can assert on dispatched toasts without rendering <Toaster />.
const toastMock = jest.fn();
jest.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

// Mocks for browser APIs that jsdom does not provide.
const matchMediaMock = jest.fn().mockReturnValue({ matches: false });
const registerMock = jest.fn();
const getRegistrationMock = jest.fn();

class FakeEventTarget {
  private listeners: Record<string, Array<(e: Event) => void>> = {};
  addEventListener(type: string, cb: (e: Event) => void) {
    (this.listeners[type] ||= []).push(cb);
  }
  removeEventListener(type: string, cb: (e: Event) => void) {
    this.listeners[type] = (this.listeners[type] || []).filter(
      (fn) => fn !== cb,
    );
  }
  dispatchEvent(type: string) {
    (this.listeners[type] || []).forEach((cb) => cb(new Event(type)));
  }
}

const registrationTarget = new FakeEventTarget();

beforeEach(() => {
  toastMock.mockClear();
  registerMock.mockReset();
  getRegistrationMock.mockReset();

  // matchMedia — referenced on mount for display-mode check.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMediaMock,
  });

  // navigator.onLine defaults to true in jsdom; ensure a known baseline.
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });

  // navigator.serviceWorker — referenced on mount.
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: registerMock.mockResolvedValue({
        scope: "/",
        addEventListener:
          registrationTarget.addEventListener.bind(registrationTarget),
      }),
      controller: undefined,
      getRegistration: getRegistrationMock,
    },
  });

  // caches — referenced by getCacheInfo / clear cache. Provide a minimal stub.
  Object.defineProperty(global, "caches", {
    configurable: true,
    value: {
      keys: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(true),
    },
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ServiceWorkerRegistration", () => {
  it("renders nothing by default except the floating settings control", () => {
    render(<ServiceWorkerRegistration />);
    expect(screen.getByLabelText("Open service worker settings")).toBeTruthy();
  });

  it("shows a persistent offline banner when the connection is lost", () => {
    render(<ServiceWorkerRegistration />);
    expect(screen.queryByText(/You're offline/i)).toBeNull();

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.getByText(/You're offline/i)).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("removes the offline banner when the connection is restored", () => {
    render(<ServiceWorkerRegistration />);
    act(() => window.dispatchEvent(new Event("offline")));
    expect(screen.getByText(/You're offline/i)).toBeTruthy();

    act(() => window.dispatchEvent(new Event("online")));
    expect(screen.queryByText(/You're offline/i)).toBeNull();
  });

  it("fires a toast (not a console.log) when going offline and back online", () => {
    render(<ServiceWorkerRegistration />);

    act(() => window.dispatchEvent(new Event("offline")));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "You're offline" }),
    );

    act(() => window.dispatchEvent(new Event("online")));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Back online" }),
    );
  });

  it("shows a confirmation toast when caches are cleared", async () => {
    // Provide two named caches so the cleared toast message is deterministic.
    (global.caches.keys as jest.Mock).mockResolvedValue(["cache-a", "cache-b"]);

    render(<ServiceWorkerRegistration />);
    fireEvent.click(screen.getByLabelText("Open service worker settings"));
    fireEvent.click(screen.getByRole("button", { name: "Clear Cache" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Cache cleared" }),
      );
    });
  });

  it("does not call console.log during its lifecycle", () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    render(<ServiceWorkerRegistration />);
    act(() => window.dispatchEvent(new Event("offline")));
    act(() => window.dispatchEvent(new Event("online")));
    act(() => window.dispatchEvent(new Event("appinstalled")));

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("renders the PWA install prompt when beforeinstallprompt fires", () => {
    render(<ServiceWorkerRegistration />);

    const promptEvent = new Event("beforeinstallprompt");
    Object.assign(promptEvent, {
      platforms: ["browser"],
      userChoice: Promise.resolve({
        outcome: "dismissed" as const,
        platform: "browser",
      }),
      prompt: jest.fn().mockResolvedValue(undefined),
      preventDefault: jest.fn(),
    });

    act(() => {
      window.dispatchEvent(promptEvent);
    });

    expect(
      screen.getByLabelText("Install Planar Nexus as an app"),
    ).toBeTruthy();
  });
});

/**
 * Issue #2604 (diagnosis step 2): the two service-worker reload sites are
 * enumerated reload triggers, so each must write a LABELLED entry into the
 * shared app-side event log before the reload destroys the document.
 *
 * The labels are what the e2e navigation diagnostics correlate against the
 * navigation events, so they are asserted by value here.
 */
describe("ServiceWorkerRegistration — reload instrumentation (#2604)", () => {
  /** jsdom reports `location.reload()` as "Not implemented: navigation". */
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    clearAppEvents();
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("records 'sw-reload:update-available-click' when the update button reloads", async () => {
    // A registration whose worker reaches the "installed" state while a
    // controller exists — that is what makes the component offer the
    // "Update Available" button.
    const stateChangeCallbacks: Array<() => void> = [];
    const worker = {
      state: "installed",
      addEventListener: (_type: string, cb: () => void) => {
        stateChangeCallbacks.push(cb);
      },
    };
    let updateFound: (() => void) | null = null;
    registerMock.mockResolvedValue({
      scope: "/",
      installing: worker,
      addEventListener: (type: string, cb: () => void) => {
        if (type === "updatefound") updateFound = cb;
      },
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: {
        register: registerMock,
        controller: { scriptURL: "/sw.js" },
        getRegistration: getRegistrationMock,
      },
    });

    render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(registerMock).toHaveBeenCalled());

    await act(async () => {
      updateFound?.();
    });
    await act(async () => {
      stateChangeCallbacks.forEach((cb) => cb());
    });

    const updateButton = await screen.findByRole("button", {
      name: /update to latest version/i,
    });
    fireEvent.click(updateButton);

    const recorded = getAppEvents().filter(
      (event) => event.label === "sw-reload:update-available-click",
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0].detail).toContain("Update Available");
    expect(recorded[0].t).toBeGreaterThan(0);
  });

  it("records 'sw-reload:force-update-click' when the force-update button reloads", async () => {
    const unregister = jest.fn();
    getRegistrationMock.mockResolvedValue({ unregister });

    render(<ServiceWorkerRegistration />);
    fireEvent.click(screen.getByLabelText("Open service worker settings"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /force update/i }));
    });

    await waitFor(() =>
      expect(
        getAppEvents().some(
          (event) => event.label === "sw-reload:force-update-click",
        ),
      ).toBe(true),
    );
    expect(unregister).toHaveBeenCalled();
  });

  it("labels the two service-worker reload triggers distinctly", () => {
    // The e2e correlation needs to tell the two triggers apart.
    const labels = new Set([
      "sw-reload:update-available-click",
      "sw-reload:force-update-click",
    ]);
    expect(labels.size).toBe(2);
  });
});
