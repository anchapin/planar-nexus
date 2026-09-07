/**
 * E2E: QR join flow for P2P multiplayer (issue #1728).
 *
 * Covers host→join via the shipped mechanism end to end:
 *   1. HOST creates a lobby and renders the connection QR (encoding the
 *      serialized signaling offer) alongside the copyable offer string.
 *   2. JOIN taps "Scan QR Code"; CI browsers have no camera/BarcodeDetector,
 *      so the page must show the explained fallback (not a silent no-op —
 *      the bug this issue tracks) while manual entry keeps working.
 *   3. The REAL offer string from the host page is pasted into the join
 *      page and the join completes through the existing signaling path.
 *
 * Determinism: real WebRTC handshakes can't run headless (mDNS candidates
 * don't resolve in CI sandboxes), so a fake RTCPeerConnection is installed
 * via addInitScript. The fake satisfies the same surface the transport
 * layer consumes (offer/answer creation, description setters, state
 * events); the transport code itself is untouched. BarcodeDetector is
 * removed to pin the graceful-fallback branch — real scanning with a
 * mocked detector is covered by the Jest unit tests.
 */
import { test, expect, type Page } from "@playwright/test";

/** Minimal data-channel-only SDP — small enough to always fit in a QR. */
const FAKE_SDP =
  "v=0\r\n" +
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1\r\n" +
  "s=-\r\n" +
  "t=0 0\r\n" +
  "a=group:BUNDLE 0\r\n" +
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n" +
  "c=IN IP4 0.0.0.0\r\n" +
  "a=ice-ufrag:AbCd\r\n" +
  "a=ice-pwd:abcdefghijklmnopqrstuvwx\r\n" +
  "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF\r\n" +
  "a=setup:actpass\r\n" +
  "a=mid:0\r\n" +
  "a=sctp-port:5000\r\n" +
  "a=max-message-size:262144\r\n";

async function installDeterministicPeerApi(page: Page) {
  await page.addInitScript((sdp: string) => {
    // Pin the graceful-fallback branch of the QR scanner: CI Chromium has no
    // camera anyway, but macOS/Windows Chromium do ship BarcodeDetector.
    try {
      delete (window as unknown as { BarcodeDetector?: unknown })
        .BarcodeDetector;
    } catch {
      /* already absent */
    }

    class FakeRTCSessionDescription {
      constructor(desc: RTCSessionDescriptionInit) {
        Object.assign(this, desc);
      }
    }
    class FakeRTCIceCandidate {
      constructor(candidate: RTCIceCandidateInit) {
        Object.assign(this, candidate);
      }
    }

    function fireConnected(pc: {
      connectionState: string;
      iceConnectionState: string;
      onconnectionstatechange: (() => void) | null;
      oniceconnectionstatechange: (() => void) | null;
    }) {
      pc.connectionState = "connected";
      pc.iceConnectionState = "connected";
      pc.onconnectionstatechange?.();
      pc.oniceconnectionstatechange?.();
    }

    class FakeRTCPeerConnection {
      connectionState = "new";
      iceConnectionState = "new";
      iceGatheringState = "new";
      localDescription: RTCSessionDescriptionInit | null = null;
      remoteDescription: RTCSessionDescriptionInit | null = null;
      onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null =
        null;
      onconnectionstatechange: (() => void) | null = null;
      oniceconnectionstatechange: (() => void) | null = null;
      ondatachannel:
        ((event: { channel: Record<string, unknown> }) => void) | null = null;

      createDataChannel(): Record<string, unknown> {
        const channel: Record<string, unknown> = {
          readyState: "open",
          bufferedAmount: 0,
          send: () => {},
          close: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
        };
        // The transport assigns .onopen after creation; fire it async then.
        Object.defineProperty(channel, "onopen", {
          configurable: true,
          set: (cb: (() => void) | null) => {
            if (cb) {
              (channel as { _onopen?: () => void })._onopen = cb;
              setTimeout(cb, 0);
            }
          },
          get: () => (channel as { _onopen?: () => void })._onopen,
        });
        return channel;
      }

      async createOffer(): Promise<RTCSessionDescriptionInit> {
        return { type: "offer", sdp };
      }

      async createAnswer(): Promise<RTCSessionDescriptionInit> {
        return { type: "answer", sdp };
      }

      async setLocalDescription(
        desc: RTCSessionDescriptionInit,
      ): Promise<void> {
        this.localDescription = desc;
        // Only the answering side has a remote description at this point;
        // the offerer keeps waiting so its QR/offer UI stays on screen.
        if (this.remoteDescription) {
          queueMicrotask(() => fireConnected(this));
        }
      }

      async setRemoteDescription(
        desc: RTCSessionDescriptionInit,
      ): Promise<void> {
        this.remoteDescription = desc;
        queueMicrotask(() => fireConnected(this));
      }

      async addIceCandidate(): Promise<void> {}

      close(): void {
        this.connectionState = "closed";
      }

      addEventListener(): void {}
      removeEventListener(): void {}
      getStats(): Promise<Map<string, never>> {
        return Promise.resolve(new Map());
      }
    }

    (window as unknown as Record<string, unknown>).RTCPeerConnection =
      FakeRTCPeerConnection;
    (window as unknown as Record<string, unknown>).RTCSessionDescription =
      FakeRTCSessionDescription;
    (window as unknown as Record<string, unknown>).RTCIceCandidate =
      FakeRTCIceCandidate;
  }, FAKE_SDP);
}

test.describe("QR join flow (#1728)", () => {
  test("host renders connection QR; join falls back gracefully and joins with the real code", async ({
    page,
  }) => {
    await installDeterministicPeerApi(page);

    // --- HOST: create lobby, get the connection QR + offer string ---
    await page.goto("/multiplayer/p2p-host");
    await page.waitForLoadState("networkidle");

    await page.getByLabel("Your Name *").fill("Host Alice");
    await page.getByLabel("Game Name *").fill("QR E2E Game");
    await page.getByRole("button", { name: "Create Lobby" }).click();

    await expect(
      page.getByText("Waiting for opponent to connect..."),
    ).toBeVisible({ timeout: 20000 });

    // The QR encodes the serialized connection code (the signaling offer).
    const qrImage = page.getByRole("img", { name: "Connection QR code" });
    await expect(qrImage).toBeVisible({ timeout: 20000 });
    await expect(qrImage).toHaveAttribute("src", /^data:image\/png;base64,/);

    // The same connection code is copyable as text for the manual path.
    const offerTextarea = page.getByLabel(/your offer to share/i);
    await expect(offerTextarea).toBeVisible({ timeout: 10000 });
    const connectionCode = await offerTextarea.inputValue();
    expect(connectionCode).toContain('"type":"offer"');
    expect(connectionCode.length).toBeGreaterThan(50);

    // --- JOIN: scan unavailable → explained fallback, manual entry works ---
    await page.goto("/multiplayer/p2p-join");
    await page.waitForLoadState("networkidle");

    await page.getByLabel("Your Name *").fill("Join Bob");
    await page.getByRole("button", { name: "Scan QR Code" }).click();

    // The pre-fix bug: this tap silently flipped to manual entry with no
    // explanation. Now the fallback is explicit…
    await expect(
      page.getByText(/qr scanning isn't available in this browser/i),
    ).toBeVisible();

    // …and manual entry completes the join with the host's real code.
    await page.getByLabel("Connection Code *").fill(connectionCode);
    await page.getByRole("button", { name: "Join Game" }).click();

    await expect(page.getByRole("heading", { name: "Connected!" })).toBeVisible(
      { timeout: 15000 },
    );
    await expect(
      page.getByText("Direct peer-to-peer connection is active."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start Game" }),
    ).toBeVisible();
  });
});
