/**
 * P2P Join Page unit tests
 * Issue #1728: QR scan flow with graceful fallback + detection wiring.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import P2PJoinPage from "../page";
import { useP2PSignaling } from "@/hooks/use-p2p-signaling";

jest.mock("@/hooks/use-p2p-signaling", () => ({
  useP2PSignaling: jest.fn(),
}));

const mockUseP2PSignaling = useP2PSignaling as jest.MockedFunction<
  typeof useP2PSignaling
>;

const VALID_OFFER = JSON.stringify({
  type: "offer",
  data: { type: "offer", sdp: "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\n" },
  senderCode: "ABC123",
});

const initializeAsClient = jest.fn();
const startClientConnection = jest.fn();

function mockSignaling(overrides: Record<string, unknown> = {}) {
  initializeAsClient.mockResolvedValue(undefined);
  startClientConnection.mockResolvedValue(
    JSON.stringify({
      type: "answer",
      data: { type: "answer", sdp: "" },
      senderCode: "XYZ",
    }),
  );

  mockUseP2PSignaling.mockReturnValue({
    connectionState: "disconnected",
    handshakeStep: "idle",
    qrCode: null,
    gameCode: "",
    connectionInfo: null,
    error: null,
    isConnected: false,
    localOffer: null,
    localAnswer: null,
    remoteOffer: null,
    remoteAnswer: null,
    initializeAsHost: jest.fn(),
    initializeAsClient,
    startHostConnection: jest.fn(),
    startClientConnection,
    handleAnswer: jest.fn(),
    addIceCandidate: jest.fn(),
    parseConnectionInfo: jest.fn(),
    sendMessage: jest.fn(),
    close: jest.fn(),
    reset: jest.fn(),
    ...overrides,
  } as ReturnType<typeof useP2PSignaling>);
}

/** Installs a BarcodeDetector + camera stack that immediately "scans" payload. */
function installScanningCamera(payload: string) {
  class MockBarcodeDetector {
    detect = jest.fn(() => Promise.resolve([{ rawValue: payload }]));
  }
  (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector =
    MockBarcodeDetector;

  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [] }),
    },
    configurable: true,
    writable: true,
  });
  window.HTMLMediaElement.prototype.play = jest.fn(() =>
    Promise.resolve(),
  ) as unknown as typeof window.HTMLMediaElement.prototype.play;
}

const user = userEvent.setup();

beforeEach(() => {
  jest.clearAllMocks();
  mockSignaling();
});

afterEach(() => {
  delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
  Object.defineProperty(navigator, "mediaDevices", {
    value: undefined,
    configurable: true,
    writable: true,
  });
});

describe("P2PJoinPage QR flow (issue #1728)", () => {
  it("explains the fallback instead of silently flipping when scanning is unsupported", async () => {
    // No BarcodeDetector installed (default jsdom state).
    render(<P2PJoinPage />);

    await user.type(screen.getByLabelText(/your name/i), "Bob");
    await user.click(screen.getByRole("button", { name: /scan qr code/i }));

    expect(
      await screen.findByText(/qr scanning isn't available in this browser/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/pasting the host's connection code below/i),
    ).toBeInTheDocument();

    // Manual entry keeps working: code field accepts input and join is armed.
    // JSON braces break userEvent's key-descriptor parsing — set directly.
    fireEvent.change(screen.getByLabelText(/connection code/i), {
      target: { value: VALID_OFFER },
    });
    expect(screen.getByRole("button", { name: /join game/i })).toBeEnabled();

    // The unsupported path must not initialize a signaling client.
    expect(initializeAsClient).not.toHaveBeenCalled();
  });

  it("populates the connection code and joins when a valid offer QR is scanned", async () => {
    installScanningCamera(VALID_OFFER);
    render(<P2PJoinPage />);

    await user.type(screen.getByLabelText(/your name/i), "Bob");
    await user.click(screen.getByRole("button", { name: /scan qr code/i }));

    // Detection auto-fires from the mocked camera; the code lands in the
    // manual-entry field and the join path runs with the scanned payload.
    await waitFor(() => expect(initializeAsClient).toHaveBeenCalledWith("Bob"));
    await waitFor(() =>
      expect(startClientConnection).toHaveBeenCalledWith(VALID_OFFER),
    );
    expect(await screen.findByDisplayValue(VALID_OFFER)).toBeInTheDocument();

    // Scanner closes itself after a successful detection.
    await waitFor(() =>
      expect(
        screen.queryByLabelText(/camera preview for qr code scanning/i),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows a notice and does not join when the QR is not a connection code", async () => {
    installScanningCamera("https://example.com/not-a-connection-code");
    render(<P2PJoinPage />);

    await user.type(screen.getByLabelText(/your name/i), "Bob");
    await user.click(screen.getByRole("button", { name: /scan qr code/i }));

    expect(
      await screen.findByText(
        /doesn't contain a planar nexus connection code/i,
      ),
    ).toBeInTheDocument();
    expect(startClientConnection).not.toHaveBeenCalled();
    expect(
      screen.queryByDisplayValue("https://example.com/not-a-connection-code"),
    ).not.toBeInTheDocument();
  });

  it("keeps the manual join path working end to end", async () => {
    render(<P2PJoinPage />);

    await user.type(screen.getByLabelText(/your name/i), "Bob");
    fireEvent.change(screen.getByLabelText(/connection code/i), {
      target: { value: VALID_OFFER },
    });
    await user.click(screen.getByRole("button", { name: /join game/i }));

    await waitFor(() =>
      expect(startClientConnection).toHaveBeenCalledWith(VALID_OFFER),
    );
  });
});
