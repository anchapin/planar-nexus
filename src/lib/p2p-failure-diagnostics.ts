/**
 * Actionable P2P connection-failure diagnostics.
 * Issue #926: surface actionable diagnostics instead of failing silently when
 * a TURN relay is unconfigured/unreachable.
 *
 * Classifies WebRTC connection failures into actionable categories, each with a
 * human-readable `reason` (why it failed) and a `remediation` hint (what to do).
 * The UI consumes these so the user sees a meaningful message — e.g. that a
 * TURN server must be added to traverse a restrictive NAT — instead of a
 * generic "Connection Failed".
 */

/**
 * Actionable failure categories surfaced to the user.
 */
export type ConnectionFailureCategory =
  | "TURN_UNCONFIGURED"
  | "ICE_FAILED"
  | "SIGNALING_UNREACHABLE"
  | "PEER_UNREACHABLE"
  | "UNKNOWN";

/**
 * Where the failure originated, used to pick the right category.
 */
export type ConnectionFailureContext =
  | "ice" // ICE gathering/connection could not establish a path
  | "signaling" // signaling channel could not be reached
  | "peer" // remote peer never answered / dropped after retries
  | "generic"; // cause unknown

/**
 * A categorized, user-facing diagnostic.
 */
export interface ConnectionFailureDiagnostic {
  category: ConnectionFailureCategory;
  /** Human-readable explanation of why the connection failed. */
  reason: string;
  /** Actionable suggestion for how to recover. */
  remediation: string;
}

/**
 * Input for failure classification.
 */
export interface ClassifyFailureInput {
  /** The RTCConfiguration in use (to detect TURN presence). */
  rtcConfig?: RTCConfiguration | null;
  /** Where the failure originated. */
  failureContext?: ConnectionFailureContext;
  /** Optional underlying cause for extra context. */
  cause?: string;
}

/**
 * Returns true when the configuration contains at least one TURN/TURNs relay
 * server. STUN-only configs cannot traverse symmetric NATs and are the most
 * common cause of silent P2P failure (the #926 case).
 */
export function hasTurnServer(config?: RTCConfiguration | null): boolean {
  if (!config?.iceServers) return false;

  for (const server of config.iceServers) {
    const raw = server.urls;
    const urls = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const url of urls) {
      if (typeof url === "string" && /^turns?:/i.test(url)) {
        return true;
      }
    }
  }
  return false;
}

const DIAGNOSTICS: Record<
  ConnectionFailureCategory,
  Omit<ConnectionFailureDiagnostic, "category">
> = {
  TURN_UNCONFIGURED: {
    reason:
      "Peer-to-peer connection failed and no TURN relay is configured. Restrictive networks (such as symmetric NAT) require a TURN server to relay traffic between peers.",
    remediation:
      "Add a TURN server in network settings to traverse restrictive networks.",
  },
  ICE_FAILED: {
    reason:
      "The connection could not be established (ICE failed). No usable network path between the peers was found.",
    remediation:
      "Both peers should retry. Check your network, VPN, proxy, or firewall settings.",
  },
  SIGNALING_UNREACHABLE: {
    reason:
      "Could not reach the signaling channel used to exchange connection details.",
    remediation:
      "Check your internet connection and try again. The signaling service may be temporarily unavailable.",
  },
  PEER_UNREACHABLE: {
    reason:
      "The remote peer could not be reached; reconnection attempts were exhausted.",
    remediation:
      "Make sure both peers are online and on compatible networks, then retry.",
  },
  UNKNOWN: {
    reason: "The peer-to-peer connection failed for an unknown reason.",
    remediation:
      "Retry the connection. If it keeps failing, check your network settings.",
  },
};

/**
 * Classify a connection failure into an actionable diagnostic.
 *
 * Detection:
 *  - `signaling` context              → SIGNALING_UNREACHABLE
 *  - `peer` context                   → PEER_UNREACHABLE
 *  - `ice` context + no TURN server   → TURN_UNCONFIGURED (the #926 silent failure)
 *  - `ice` context + TURN configured  → ICE_FAILED
 *  - anything else                    → UNKNOWN
 */
export function classifyConnectionFailure(
  input: ClassifyFailureInput = {},
): ConnectionFailureDiagnostic {
  const context = input.failureContext ?? "generic";

  let category: ConnectionFailureCategory;
  switch (context) {
    case "signaling":
      category = "SIGNALING_UNREACHABLE";
      break;
    case "peer":
      category = "PEER_UNREACHABLE";
      break;
    case "ice":
      category = hasTurnServer(input.rtcConfig)
        ? "ICE_FAILED"
        : "TURN_UNCONFIGURED";
      break;
    case "generic":
    default:
      category = "UNKNOWN";
      break;
  }

  const base = DIAGNOSTICS[category];
  const reason = input.cause ? `${base.reason} (${input.cause})` : base.reason;

  return { category, reason, remediation: base.remediation };
}

/**
 * Combine a diagnostic into a single actionable message suitable for error
 * events and toasts.
 */
export function getFailureMessage(
  diagnostic: ConnectionFailureDiagnostic,
): string {
  return `${diagnostic.reason} ${diagnostic.remediation}`;
}
