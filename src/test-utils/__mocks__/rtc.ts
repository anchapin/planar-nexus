/**
 * WebRTC global mocks for jsdom.
 *
 * jsdom implements no WebRTC surface (no RTCPeerConnection, RTCDataChannel,
 * RTCSessionDescription, RTCIceCandidate). The P2P transport modules
 * (`webrtc-p2p.ts`, `p2p-signaling-client.ts`, `p2p-direct-connection.ts`)
 * construct these globals directly, so behavioral tests install this
 * controllable fake, drive the REAL module code against it, and restore the
 * originals afterwards.
 *
 * The fake records every operation the modules perform (offers, descriptions,
 * candidates, data channels, sent payloads) so tests can assert on the
 * signaling traffic without a network.
 */

/**
 * Controllable RTCDataChannel fake. Starts `open` and records every send.
 */
export class MockRTCDataChannel {
  readyState: RTCDataChannelState = "open";
  bufferedAmount = 0;
  onopen: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onbufferedamountlow: ((ev?: unknown) => void) | null = null;
  /** Payloads handed to send(), in order. */
  sent: string[] = [];

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = "closed";
  }
}

/**
 * Failure knobs a test can flip on the instance before the module under test
 * touches the corresponding API.
 */
export interface MockPCFailureKnobs {
  failConstruction?: boolean;
  failCreateOffer?: boolean;
  failCreateAnswer?: boolean;
  failAddIceCandidate?: boolean;
  failSetRemoteDescription?: boolean;
  failCreateDataChannel?: boolean;
  failGetStats?: boolean;
}

/**
 * Controllable RTCPeerConnection fake. Records construction configs and every
 * signaling operation; supports both the `on*` property handlers and
 * addEventListener (used by the ICE diagnostics collector).
 */
export class MockRTCPeerConnection {
  /** Every instance constructed since the last reset, oldest first. */
  static instances: MockRTCPeerConnection[] = [];
  /**
   * When true, the NEXT construction throws (and the flag resets). Used to
   * exercise module-under-test init failure paths.
   */
  static failNextConstruction = false;

  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "new";
  signalingState: RTCSignalingState = "stable";
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;

  onicecandidate:
    ((event: { candidate: RTCIceCandidateInit | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: { channel: MockRTCDataChannel }) => void) | null =
    null;

  /** Config passed to the constructor. */
  readonly constructedConfig: RTCConfiguration | undefined;
  /** Configs passed to setConfiguration(). */
  readonly setConfigurationCalls: RTCConfiguration[] = [];
  /** Options of every createOffer() call. */
  readonly createOfferCalls: RTCOfferOptions[] = [];
  readonly localDescriptions: RTCSessionDescriptionInit[] = [];
  readonly remoteDescriptions: RTCSessionDescriptionInit[] = [];
  readonly addedCandidates: RTCIceCandidateInit[] = [];
  /** Data channels handed out via createDataChannel(). */
  readonly createdChannels: MockRTCDataChannel[] = [];
  closed = false;

  // Failure knobs (see MockPCFailureKnobs).
  failCreateOffer = false;
  failCreateAnswer = false;
  failAddIceCandidate = false;
  failSetRemoteDescription = false;
  failCreateDataChannel = false;
  failGetStats = false;

  private listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(config?: RTCConfiguration) {
    this.constructedConfig = config;
    const fail =
      MockRTCPeerConnection.failNextConstruction ||
      Boolean((config as MockPCFailureKnobs | undefined)?.failConstruction);
    MockRTCPeerConnection.failNextConstruction = false;
    if (fail) {
      throw new Error("MockRTCPeerConnection: construction failed (test)");
    }
    MockRTCPeerConnection.instances.push(this);
  }

  // ── addEventListener surface (ICE diagnostics collector) ──────────────
  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (l) => l !== listener,
    );
  }

  /** Test helper: dispatch an event to addEventListener subscribers. */
  emit(type: string, event: unknown): void {
    for (const l of this.listeners[type] ?? []) l(event);
  }

  // ── RTCPeerConnection API ─────────────────────────────────────────────
  setConfiguration(config: RTCConfiguration): void {
    this.setConfigurationCalls.push(config);
  }

  async createOffer(
    options?: RTCOfferOptions,
  ): Promise<RTCSessionDescriptionInit> {
    if (this.failCreateOffer) {
      throw new Error("MockRTCPeerConnection: createOffer failed (test)");
    }
    this.createOfferCalls.push(options ?? {});
    return {
      type: "offer",
      sdp: `mock-offer-${this.createOfferCalls.length}`,
    };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    if (this.failCreateAnswer) {
      throw new Error("MockRTCPeerConnection: createAnswer failed (test)");
    }
    return { type: "answer", sdp: "mock-answer" };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc;
    this.localDescriptions.push(desc);
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    if (this.failSetRemoteDescription) {
      throw new Error(
        "MockRTCPeerConnection: setRemoteDescription failed (test)",
      );
    }
    this.remoteDescription = desc;
    this.remoteDescriptions.push(desc);
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.failAddIceCandidate) {
      throw new Error("MockRTCPeerConnection: addIceCandidate failed (test)");
    }
    this.addedCandidates.push(candidate);
  }

  createDataChannel(label: string): MockRTCDataChannel {
    if (this.failCreateDataChannel) {
      throw new Error("MockRTCPeerConnection: createDataChannel failed (test)");
    }
    void label;
    const channel = new MockRTCDataChannel();
    this.createdChannels.push(channel);
    return channel;
  }

  async getStats(): Promise<Map<string, unknown>> {
    if (this.failGetStats) {
      throw new Error("MockRTCPeerConnection: getStats failed (test)");
    }
    return new Map();
  }

  close(): void {
    this.closed = true;
    this.connectionState = "closed";
  }
}

/** Minimal RTCSessionDescription fake (webrtc-p2p wraps descriptions in it). */
export class MockRTCSessionDescription {
  readonly type: RTCSdpType;
  readonly sdp: string;
  constructor(init: RTCSessionDescriptionInit) {
    this.type = init.type;
    this.sdp = init.sdp ?? "";
  }
}

/** Minimal RTCIceCandidate fake. */
export class MockRTCIceCandidate {
  readonly candidate: string | null;
  constructor(init: RTCIceCandidateInit) {
    this.candidate = init.candidate ?? null;
  }
}

/**
 * Install the fake WebRTC globals and reset the instance registry.
 * Returns the originals so {@link uninstallWebrtcGlobals} can restore them.
 */
export function installWebrtcGlobals(): {
  RTCPeerConnection: unknown;
  RTCSessionDescription: unknown;
  RTCIceCandidate: unknown;
} {
  const g = globalThis as Record<string, unknown>;
  const originals = {
    RTCPeerConnection: g.RTCPeerConnection,
    RTCSessionDescription: g.RTCSessionDescription,
    RTCIceCandidate: g.RTCIceCandidate,
  };
  g.RTCPeerConnection = MockRTCPeerConnection;
  g.RTCSessionDescription = MockRTCSessionDescription;
  g.RTCIceCandidate = MockRTCIceCandidate;
  resetMockRTC();
  return originals;
}

/** Restore globals captured by {@link installWebrtcGlobals}. */
export function uninstallWebrtcGlobals(originals: {
  RTCPeerConnection: unknown;
  RTCSessionDescription: unknown;
  RTCIceCandidate: unknown;
}): void {
  const g = globalThis as Record<string, unknown>;
  g.RTCPeerConnection = originals.RTCPeerConnection;
  g.RTCSessionDescription = originals.RTCSessionDescription;
  g.RTCIceCandidate = originals.RTCIceCandidate;
  resetMockRTC();
}

/** Clear the constructed-instance registry. */
export function resetMockRTC(): void {
  MockRTCPeerConnection.instances = [];
  MockRTCPeerConnection.failNextConstruction = false;
}

/** Most recently constructed fake peer connection. */
export function latestPC(): MockRTCPeerConnection {
  const instances = MockRTCPeerConnection.instances;
  if (instances.length === 0) {
    throw new Error("latestPC(): no MockRTCPeerConnection constructed yet");
  }
  return instances[instances.length - 1];
}
