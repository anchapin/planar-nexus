/**
 * WebRTC Type Definitions
 *
 * Provides standard WebRTC type definitions for web applications.
 * These types are compatible with the standard WebRTC API in browsers.
 */

/**
 * RTCSessionDescriptionInit interface
 * Matches the standard WebRTC RTCSessionDescriptionInit interface
 */
export interface RTCSessionDescriptionInit {
  type: RTCSdpType;
  sdp?: string;
}

/**
 * RTCIceCandidateInit interface
 * Matches the standard WebRTC RTCIceCandidateInit interface
 */
export interface RTCIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}