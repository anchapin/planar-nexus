# Phase 4.5: P2P Networking Research & Architecture Decision

## Issues Addressed

- **#81**: Design hybrid P2P with lightweight signaling
- **#80**: Consider WebSocket fallback
- **#79**: Evaluate Firebase Realtime Database for signaling

## Executive Summary

This document provides a comprehensive analysis of networking options for Planar Nexus multiplayer, focusing on improving the current WebRTC P2P implementation (Issue #57) which currently lacks a signaling mechanism.

**Recommendation**: Implement a hybrid approach combining:
1. **Primary**: WebRTC P2P with lightweight WebSocket-based signaling
2. **Fallback**: WebSocket relay for NAT-traversal failures
3. **Optional**: Firebase RTDB as signaling backend (for specific use cases)

---

## Current State Analysis

### Existing Implementation (`src/lib/webrtc-p2p.ts`)

The current WebRTC implementation provides:
- RTCPeerConnection management with STUN servers
- Data channels for game state sync
- Reconnection logic
- Game state serialization

**Current Limitation**:
- No signaling mechanism implemented
- ICE candidates must be exchanged manually (QR code or copy-paste)
- No fallback when P2P fails

---

## Option 1: WebSocket Signaling Server

### Description
Deploy a lightweight WebSocket server to handle WebRTC signaling (offer/answer/ICE exchange) and optionally relay messages when P2P fails.

### Pros
- ✅ Full control over signaling flow
- ✅ Can implement custom game state relay
- ✅ Lower latency than Firebase
- ✅ Industry standard approach (used by major apps)
- ✅ Supports both signaling and data relay
- ✅ No external dependencies

### Cons
- ❌ Requires server deployment (cost)
- ❌ Must handle WebSocket connections at scale
- ❌ Maintenance burden
- ❌ Requires TLS certificate management

### Implementation Complexity: Medium

### Estimated Cost
- Self-hosted: $5-20/month (VPS)
- Managed: $20-100/month (Socket.io cloud, Cloudflare Workers)

---

## Option 2: Firebase Realtime Database

### Description
Use Firebase RTDB as a signaling backend, storing ICE candidates and game state deltas in JSON tree.

### Pros
- ✅ Zero server management
- ✅ Built-in real-time sync
- ✅ Scales automatically
- ✅ Free tier available (100 connections, 1GB storage)
- ✅ Works offline with sync

### Cons
- ❌ Higher latency than WebSocket
- ❌ Data model not ideal for signaling
- ❌ Cost increases with usage
- ❌ Requires Firebase account/setup
- ❌ Less control over connection lifecycle
- ❌ Not ideal for high-frequency updates

### Implementation Complexity: Low (Firebase SDK is straightforward)

### Estimated Cost
- Free tier: 100 simultaneous connections, 1GB storage, 100GB bandwidth
- Pay-as-you-go: ~$1-5/month for typical usage

### Firebase RTDB Schema Design
```json
{
  "rooms": {
    "<gameCode>": {
      "host": {
        "offer": "<base64-sdp>",
        "iceCandidates": ["<candidate1>", "..."]
      },
      "peers": {
        "<peerId>": {
          "answer": "<base64-sdp>",
          "iceCandidates": ["<candidate1>", "..."]
        }
      },
      "state": "waiting|active|completed",
      "lastUpdate": 1234567890
    }
  }
}
```

---

## Option 3: WebRTC with Public STUN + Manual Fallback

### Description
Enhance existing WebRTC implementation with:
1. More STUN servers for better NAT traversal
2. Manual ICE exchange via QR code (existing)
3. TURN server for fallback (when STUN fails)
4. User-initiated fallback to server relay

### Pros
- ✅ No external service required (except TURN)
- ✅ Maintains P2P when possible
- ✅ Privacy-preserving
- ✅ Reduces server costs

### Cons
- ❌ TURN servers cost money (Twilio, Metered.ca)
- ❌ Manual fallback is user-hostile
- ❌ Not all users have QR code capability
- ❌ Still no signaling server

### TURN Server Options
- **Twilio**: $0.01/GB (free tier: 500MB/month)
- **Metered.ca**: $5/month unlimited
- **Open Relay Project**: Free (but unreliable)

---

## Option 4: Hybrid P2P with Lightweight Signaling (Recommended)

### Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Player A  │────▶│  Signaling  │◀────│   Player B  │
│  (WebRTC)   │     │  (WebSocket │     │  (WebRTC)   │
└─────────────┘     │   or Firebase)    └─────────────┘
       │                   │                   │
       │  (direct P2P)    │                   │
       └──────────────────┴──────────────────┘
                           │
                    (fallback relay)
                           │
                    ┌──────▼──────┐
                    │   Relay     │
                    │  (optional) │
                    └─────────────┘
```

### Implementation Plan

#### Phase 1: WebSocket Signaling Server
1. Deploy lightweight WebSocket server (Node.js + ws library)
2. Implement signaling protocol (offer/answer/ICE)
3. Add room management (create/join/leave)
4. Integrate with existing WebRTC code

#### Phase 2: Client Integration
1. Update `WebRTCConnection` to use signaling
2. Implement automatic reconnection
3. Add connection quality detection
4. Implement fallback logic

#### Phase 3: Relay Fallback
1. Add relay mode for NAT traversal failures
2. Implement message routing through server
3. Optimize relay for minimal bandwidth

#### Phase 4 (Optional): Firebase Integration
1. Implement Firebase signaling as alternative
2. Support offline scenarios
3. Add cross-platform compatibility

### Signaling Protocol

```typescript
// Signaling message types
type SignalingMessage = 
  | { type: 'join'; roomId: string; playerId: string }
  | { type: 'leave'; roomId: string; playerId: string }
  | { type: 'offer'; roomId: string; from: string; sdp: string }
  | { type: 'answer'; roomId: string; from: string; sdp: string }
  | { type: 'ice-candidate'; roomId: string; from: string; candidate: RTCIceCandidate }
  | { type: 'relay'; roomId: string; from: string; to: string; payload: unknown };
```

---

## Cost Analysis

| Option | Setup Cost | Monthly Cost | Complexity |
|--------|------------|--------------|------------|
| WebSocket Server | $0 | $5-20 | Medium |
| Firebase RTDB | $0 | $0-10 | Low |
| Hybrid (Recommended) | $0 | $10-30 | Medium |
| Manual Only | $0 | $5 (TURN) | Low |

---

## Recommendation

**Implement Option 4: Hybrid P2P with WebSocket Signaling**

### Rationale
1. Maintains P2P benefits (low latency, no server costs for data)
2. Solves the signaling problem elegantly
3. Provides fallback for edge cases
4. Industry-proven approach
5. Extensible for future features

### Implementation Priority

1. **Immediate**: Add TURN server support for basic fallback
2. **Short-term**: Implement WebSocket signaling server
3. **Medium-term**: Add relay fallback mode
4. **Long-term**: Consider Firebase for specific use cases

---

## Related Files

- `src/lib/webrtc-p2p.ts` - Existing P2P implementation
- `src/lib/p2p-signaling.ts` - Future signaling module
- `src/lib/lobby-manager.ts` - Lobby management
- `src/hooks/use-p2p-lobby.ts` - P2P lobby hook

---

## Open Questions

1. **Hosting**: Should signaling server be self-hosted or use a managed service?
2. **Scaling**: How many concurrent games should be supported?
3. **Authentication**: Should signaling require authentication?
4. **Relay Policy**: When should relay mode be automatically triggered?

---

## References

- [WebRTC Signaling Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling)
- [Firebase RTDB Pricing](https://firebase.google.com/pricing)
- [WebSocket vs WebRTC](https://bloggeek.me/webrtc/websocket-webrtc/)

---

*Document created: 2026-02-17*
*Related Issues: #79, #80, #81*
*Parent: Phase 4: Multiplayer*
