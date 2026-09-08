/**
 * QRCodeDisplay unit tests
 * Issue #1728: QR rendering of the raw connection-code payload with
 * graceful overflow fallback.
 */

import { render, screen, waitFor } from "@testing-library/react";
import QRCode from "qrcode";
import { QRCodeDisplay } from "@/components/qr-code-display";

jest.mock("qrcode", () => ({
  toDataURL: jest.fn(),
  toCanvas: jest.fn(),
}));

const mockedToDataURL = QRCode.toDataURL as jest.MockedFunction<
  typeof QRCode.toDataURL
>;
const mockedToCanvas = QRCode.toCanvas as jest.MockedFunction<
  typeof QRCode.toCanvas
>;

const CONNECTION_CODE = JSON.stringify({
  type: "offer",
  data: { type: "offer", sdp: "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\n" },
  senderCode: "ABC123",
});

describe("QRCodeDisplay (issue #1728)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedToCanvas.mockResolvedValue(undefined as never);
  });

  it("renders a QR image encoding the raw connection-code payload", async () => {
    mockedToDataURL.mockResolvedValue("data:image/png;base64,MOCKQR" as never);

    render(<QRCodeDisplay payload={CONNECTION_CODE} gameCode="ABC123" />);

    const img = await screen.findByRole("img", {
      name: /connection qr code/i,
    });
    expect(img).toHaveAttribute("src", "data:image/png;base64,MOCKQR");

    await waitFor(() =>
      expect(mockedToDataURL).toHaveBeenCalledWith(
        CONNECTION_CODE,
        expect.objectContaining({ errorCorrectionLevel: "L" }),
      ),
    );
  });

  it("explains and stays usable when the payload is too long for a QR code", async () => {
    mockedToDataURL.mockRejectedValue(
      new Error("code length overflow") as never,
    );

    render(
      <QRCodeDisplay payload={CONNECTION_CODE.repeat(50)} gameCode="ABC123" />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/too long to display as a qr code/i),
      ).toBeInTheDocument(),
    );
    // The manual fallback hint must be present…
    expect(
      screen.getByText(/share it manually using copy and paste/i),
    ).toBeInTheDocument();
    // …and no broken QR image should render.
    expect(
      screen.queryByRole("img", { name: /connection qr code/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a generating placeholder while the payload QR is pending", () => {
    let resolveQr: (value: string) => void = () => {};
    mockedToDataURL.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveQr = resolve;
      }) as never,
    );

    render(<QRCodeDisplay payload={CONNECTION_CODE} gameCode="ABC123" />);

    expect(
      screen.getByLabelText(/generating connection qr code/i),
    ).toBeInTheDocument();

    resolveQr("data:image/png;base64,DONE");
  });

  it("falls back to the legacy game-code canvas QR when no payload is given", async () => {
    render(<QRCodeDisplay gameCode="XYZ789" />);

    await waitFor(() =>
      expect(mockedToCanvas).toHaveBeenCalledWith(
        expect.anything(),
        "planar-nexus://join?code=XYZ789",
        expect.objectContaining({ errorCorrectionLevel: "M" }),
      ),
    );
    expect(
      screen.queryByRole("img", { name: /connection qr code/i }),
    ).not.toBeInTheDocument();
  });
});
