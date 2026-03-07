# Client-Side Multiplayer Signaling

## Overview

This implementation provides a client-side P2P multiplayer connection system using QR codes and manual code entry, eliminating the need for Firebase or any external signaling server.

## Architecture

### Components

1. **Client-Side Signaling Service** (`src/lib/client-signaling.ts`)
   - Manages WebRTC signaling without external servers
   - Creates and processes connection data (offers/answers)
   - Handles ICE candidates exchange
   - Encodes/decodes connection data for QR codes

2. **QR Code Generator** (`src/lib/qr-code-generator.ts`)
   - Generates QR codes from connection data
   - Provides download and copy functionality
   - Supports clipboard API for manual code entry

3. **Connection QR Code Component** (`src/components/connection-qr-code.tsx`)
   - React component for displaying QR codes
   - Supports both QR code scanning and manual code entry
   - Provides user-friendly interface for sharing connection data

4. **Updated WebRTC Connection** (`src/lib/webrtc-p2p.ts`)
   - Integrated with client-side signaling
   - Creates offers/answers for P2P connection
   - Manages ICE candidate collection and exchange

## How It Works

### Host Flow

1. Host creates a lobby
2. P2P connection is initialized
3. WebRTC offer is created
4. Connection data (offer + ICE candidates) is generated
5. QR code is displayed containing the connection data
6. Host shares QR code or connection string with opponent

### Client Flow

1. Client navigates to join page
2. Scans host's QR code or pastes connection string
3. Connection data is decoded and validated
4. WebRTC answer is created
5. Answer is sent back to host
6. P2P connection is established

### Connection Data Format

Connection data is encoded as base64 JSON:

```typescript
interface ConnectionData {
  type: 'offer' | 'answer';
  sessionId: string;
  sdp: string; // JSON stringified SDP
  iceCandidates: RTCIceCandidateInit[];
  timestamp: number;
}
```

## Key Features

- **No External Server Required**: Complete P2P without Firebase
- **QR Code Support**: Easy connection via QR code scanning
- **Manual Entry**: Fallback option for direct code entry
- **Clipboard Support**: Copy/paste connection strings
- **NAT Traversal**: Uses STUN/TURN servers for connection
- **Connection Timeout**: 30-second timeout for connection attempts
- **Error Handling**: Comprehensive error reporting

## Usage

### Host Setup

```typescript
// Create P2P connection as host
const p2pConnection = createP2PConnection({
  playerId: 'host-id',
  playerName: 'Host Player',
  isHost: true,
  events: {
    onConnectionStateChange: (state) => console.log('State:', state),
    onError: (error) => console.error('Error:', error),
  },
});

// Initialize connection
await p2pConnection.initialize();

// Create offer data for sharing
const offerData = await p2pConnection.createOfferData();

// Display QR code or share connection string
<ConnectionQRCode connectionData={offerData} isHost={true} />
```

### Client Setup

```typescript
// Receive connection data from host (via QR code or manual entry)
const hostConnectionData = decodeConnectionData(hostString);

// Create P2P connection as client
const p2pConnection = createP2PConnection({
  playerId: 'client-id',
  playerName: 'Client Player',
  isHost: false,
  remoteConnectionData: hostConnectionData,
  events: {
    onConnectionStateChange: (state) => {
      if (state === 'connected') {
        // Connection established!
      }
    },
    onError: (error) => console.error('Error:', error),
  },
});

// Initialize connection
await p2pConnection.initialize();
```

## Security Considerations

- Connection data is encoded in base64 but not encrypted
- For production, consider adding encryption layer
- Connection data should be shared only with trusted peers
- Session IDs are unique per connection attempt

## Testing

Run tests with:

```bash
npm test -- client-signaling.test.ts
```

## Troubleshooting

### Connection Fails

1. Ensure both parties are on compatible networks
2. Check that STUN/TURN servers are accessible
3. Try manual code entry if QR code fails
4. Verify ICE candidates are being exchanged

### QR Code Issues

1. Ensure good lighting for scanning
2. Try downloading QR code and scanning from image
3. Use manual code entry as fallback
4. Check that connection data is valid before sharing

### NAT Traversal Problems

1. Ensure STUN servers are working
2. Consider adding TURN server for relay
3. Check firewall settings
4. Try direct connection on same network

## Future Enhancements

- Add encryption for connection data
- Support for multiple players (beyond 1v1)
- Connection retry with new ICE candidates
- Connection statistics and diagnostics
- QR code with metadata (game format, player count)
- Integration with device camera for QR scanning
