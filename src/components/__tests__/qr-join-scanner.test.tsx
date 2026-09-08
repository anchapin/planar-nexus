/**
 * QRJoinScanner unit tests
 * Issue #1728: camera scanning via BarcodeDetector with graceful fallback.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { QRJoinScanner, isQrScanSupported } from "@/components/qr-join-scanner";

const CONNECTION_CODE = JSON.stringify({
  type: "offer",
  data: { type: "offer", sdp: "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\n" },
  senderCode: "ABC123",
});

const stopTrack = jest.fn();
const getUserMediaMock = jest.fn();

function installCamera({
  detectResult,
}: {
  detectResult?: Promise<Array<{ rawValue: string }>>;
} = {}) {
  const detect = jest.fn(
    () => detectResult ?? Promise.resolve([{ rawValue: CONNECTION_CODE }]),
  );
  class MockBarcodeDetector {
    detect = detect;
  }
  (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector =
    MockBarcodeDetector;

  getUserMediaMock.mockResolvedValue({
    getTracks: () => [{ stop: stopTrack }],
  });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: getUserMediaMock },
    configurable: true,
    writable: true,
  });

  return { detect };
}

beforeEach(() => {
  jest.clearAllMocks();
  // jsdom has no media stack: silence HTMLMediaElement.play.
  window.HTMLMediaElement.prototype.play = jest.fn(() =>
    Promise.resolve(),
  ) as unknown as typeof window.HTMLMediaElement.prototype.play;
});

afterEach(() => {
  delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
  Object.defineProperty(navigator, "mediaDevices", {
    value: undefined,
    configurable: true,
    writable: true,
  });
});

describe("isQrScanSupported", () => {
  it("reports unsupported when BarcodeDetector is missing", () => {
    expect(isQrScanSupported()).toBe(false);
  });

  it("reports supported when BarcodeDetector and getUserMedia exist", () => {
    installCamera();
    expect(isQrScanSupported()).toBe(true);
  });
});

describe("QRJoinScanner (issue #1728)", () => {
  it("renders an explained fallback when scanning is unsupported", async () => {
    const onCancel = jest.fn();
    render(<QRJoinScanner onDetect={jest.fn()} onCancel={onCancel} />);

    expect(
      await screen.findByText(/qr scanning not available/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/barcode detection api or has no camera access/i),
    ).toBeInTheDocument();
    expect(getUserMediaMock).not.toHaveBeenCalled();

    screen.getByRole("button", { name: /enter code manually/i }).click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("detects a QR payload and hands it to onDetect", async () => {
    const onDetect = jest.fn();
    installCamera();

    render(<QRJoinScanner onDetect={onDetect} onCancel={jest.fn()} />);

    await waitFor(() => expect(onDetect).toHaveBeenCalledWith(CONNECTION_CODE));
    expect(await screen.findByText(/qr code detected/i)).toBeInTheDocument();
  });

  it("explains camera failures and keeps manual entry available", async () => {
    const onCancel = jest.fn();
    installCamera();
    getUserMediaMock.mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );

    render(<QRJoinScanner onDetect={jest.fn()} onCancel={onCancel} />);

    expect(await screen.findByText(/camera unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /enter code manually/i }),
    ).toBeInTheDocument();
  });

  it("stops camera tracks when unmounted", async () => {
    const onDetect = jest.fn();
    installCamera({
      detectResult: Promise.resolve([]), // never detects; keeps loop idle
    });

    const { unmount } = render(
      <QRJoinScanner onDetect={onDetect} onCancel={jest.fn()} />,
    );

    // Wait for the camera to actually start before tearing down.
    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalled());
    unmount();

    expect(stopTrack).toHaveBeenCalled();
    expect(onDetect).not.toHaveBeenCalled();
  });
});
