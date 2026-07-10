/**
 * Unit tests for src/components/desktop-update-banner.tsx (issue #1403).
 *
 * Strategy: mock the `useDesktopUpdate` hook so we can drive every
 * supported combination of `(isSupported, updateAvailable)` from the
 * test. The banner is mounted with @testing-library/react and we assert
 * on the data-testid hooks documented inline.
 */

import { render, screen, fireEvent, act } from "@testing-library/react";

jest.mock("@/hooks/use-desktop-update", () => ({
  useDesktopUpdate: jest.fn(),
}));

jest.mock("@/lib/updater", () => ({
  __esModule: true,
  downloadAndInstallDesktopUpdate: jest.fn(),
  relaunchDesktop: jest.fn(),
  UPDATER_PUBKEY_FINGERPRINT: "dW50cnVzdGVkIGNvbW1lbm",
}));

import { useDesktopUpdate } from "@/hooks/use-desktop-update";
import {
  downloadAndInstallDesktopUpdate,
  relaunchDesktop,
  type DesktopUpdateResult,
} from "@/lib/updater";

import { DesktopUpdateBanner } from "../desktop-update-banner";

const mockedHook = jest.mocked(useDesktopUpdate);
const mockedDownload = jest.mocked(downloadAndInstallDesktopUpdate);
const mockedRelaunch = jest.mocked(relaunchDesktop);

interface MockHookState {
  isSupported: boolean;
  updateAvailable: boolean;
  result: DesktopUpdateResult | null;
}

function setHookState(state: MockHookState): void {
  mockedHook.mockReturnValue({
    status: state.isSupported ? "checked" : "unsupported",
    isSupported: state.isSupported,
    updateAvailable: state.updateAvailable,
    result: state.result,
    recheck: jest.fn(),
  });
}

describe("DesktopUpdateBanner (issue #1403)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  it("renders nothing when not running in Tauri", () => {
    setHookState({
      isSupported: false,
      updateAvailable: false,
      result: null,
    });
    const { container } = render(<DesktopUpdateBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when no update is available", () => {
    setHookState({
      isSupported: true,
      updateAvailable: false,
      result: { available: false, currentVersion: "1.0.0" },
    });
    const { container } = render(<DesktopUpdateBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the banner with the version + restart/later buttons when an update is available", () => {
    setHookState({
      isSupported: true,
      updateAvailable: true,
      result: {
        available: true,
        version: "1.2.3",
        notes: "Security fixes",
        publishedAt: "2026-07-10T12:00:00Z",
        pubkeyFingerprint: "dW50cnVzdGVkIGNvbW1lbm",
      },
    });
    render(<DesktopUpdateBanner />);
    expect(screen.getByTestId("desktop-update-banner")).toBeInTheDocument();
    expect(screen.getByText(/Update available: v1\.2\.3/)).toBeInTheDocument();
    expect(
      screen.getByTestId("desktop-update-banner-restart"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("desktop-update-banner-later"),
    ).toBeInTheDocument();
  });

  it("hides the banner when the user clicks 'Later' for the current session", () => {
    setHookState({
      isSupported: true,
      updateAvailable: true,
      result: {
        available: true,
        version: "1.2.3",
        notes: null,
        publishedAt: null,
        pubkeyFingerprint: "dW50cnVzdGVkIGNvbW1lbm",
      },
    });
    const { rerender } = render(<DesktopUpdateBanner />);
    expect(screen.getByTestId("desktop-update-banner")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("desktop-update-banner-later"));

    // Re-render with the same hook state — the banner should now be
    // suppressed by the sessionStorage dismiss.
    rerender(<DesktopUpdateBanner />);
    expect(screen.queryByTestId("desktop-update-banner")).toBeNull();
  });

  it("clicking 'Restart now' triggers downloadAndInstall + relaunch", async () => {
    mockedDownload.mockResolvedValueOnce(undefined);
    mockedRelaunch.mockResolvedValueOnce(undefined);

    setHookState({
      isSupported: true,
      updateAvailable: true,
      result: {
        available: true,
        version: "1.2.3",
        notes: null,
        publishedAt: null,
        pubkeyFingerprint: "dW50cnVzdGVkIGNvbW1lbm",
      },
    });
    render(<DesktopUpdateBanner />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("desktop-update-banner-restart"));
    });

    expect(mockedDownload).toHaveBeenCalledTimes(1);
    expect(mockedRelaunch).toHaveBeenCalledTimes(1);
  });

  it("surfaces an inline error when downloadAndInstall throws", async () => {
    mockedDownload.mockRejectedValueOnce(new Error("network blip"));

    setHookState({
      isSupported: true,
      updateAvailable: true,
      result: {
        available: true,
        version: "1.2.3",
        notes: null,
        publishedAt: null,
        pubkeyFingerprint: "dW50cnVzdGVkIGNvbW1lbm",
      },
    });
    render(<DesktopUpdateBanner />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("desktop-update-banner-restart"));
    });
    expect(
      await screen.findByTestId("desktop-update-banner-error"),
    ).toHaveTextContent("network blip");
  });
});
