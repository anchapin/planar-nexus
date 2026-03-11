# Unit 10: Client-Side Multiplayer Signaling

## Overview

This unit implements client-side peer-to-peer (P2P) signaling for multiplayer games, removing dependencies on server-side signaling infrastructure. Players can establish WebRTC connections by manually exchanging connection information via QR codes, copy-paste, or other out-of-band methods.

## Architecture

### Key Components

1. **LocalSignalingClient** (`src/lib/local-signaling-client.ts`)
   - Manages WebRTC signaling without a server
   - Handles offer/answer/ICE candidate exchange
   - Provides connection state management
   - Supports QR code serialization for data transfer

2. **P2PGameConnection** (`src/lib/p2p-game-connection.ts`)
   - Combines WebRTC peer connection with local signaling
   - Manages data channels for game communication
   - Handles message routing (game state, chat, actions)
   - Provides connection health monitoring

3. **useP2PConnection Hook** (`src/hooks/use-p2p-connection.ts`)
   - React hook for managing P2P connections in UI components
   - Provides simplified API for game developers
   - Handles connection lifecycle automatically

## Connection Flow

### Host Flow

1. Host initializes connection as host
2. Creates WebRTC offer
3. Serializes offer for sharing (QR code / copy-paste)
4. Waits for joiner's answer
5. Exchanges ICE candidates
6. Establishes P2P data channel
7. Connection ready for game

### Joiner Flow

1. Joiner receives host's offer (QR code / paste)
2. Initializes connection as joiner with offer
3. Creates WebRTC answer
4. Serializes answer for sharing
5. Exchanges ICE candidates
6. Establishes P2P data channel
7. Connection ready for game

## Usage Examples

### Hosting a Game

```typescript
'use client';

import { useP2PConnection } from '@/hooks/use-p2p-connection';

export function HostGame() {
  const {
    connectionState,
    signalingState,
    initializeAsHost,
    processAnswer,
    processIceCandidates,
    isConnected,
  } = useP2PConnection({
    playerId: 'player-123',
    playerName: 'Host Player',
    role: 'host',
    gameCode: 'ABC123',
  });

  const handleStartHosting = async () => {
    // Create offer
    const offer = await initializeAsHost();

    // Display QR code or copy to clipboard
    displayQRCode(offer);
  };

  const handleAnswerReceived = async (answer: RTCSessionDescriptionInit) => {
    await processAnswer(answer);
  };

  const handleIceCandidatesReceived = async (candidates: RTCIceCandidateInit[]) => {
    await processIceCandidates(candidates);
  };

  return (
    <div>
      {connectionState === 'disconnected' && (
        <button onClick={handleStartHosting}>Start Hosting</button>
      )}
      {connectionState === 'signaling' && (
        <div>Waiting for player to join...</div>
      )}
      {connectionState === 'connected' && (
        <div>Connected! Game ready.</div>
      )}
    </div>
  );
}
```

### Joining a Game

```typescript
'use client';

import { useP2PConnection } from '@/hooks/use-p2p-connection';

export function JoinGame() {
  const {
    connectionState,
    initializeAsJoiner,
    processIceCandidates,
    isConnected,
  } = useP2PConnection({
    playerId: 'player-456',
    playerName: 'Joining Player',
    role: 'joiner',
  });

  const handleJoinGame = async (offer: RTCSessionDescriptionInit) => {
    // Create answer
    const answer = await initializeAsJoiner(offer);

    // Display QR code or copy to clipboard
    displayQRCode(answer);
  };

  const handleIceCandidatesReceived = async (candidates: RTCIceCandidateInit[]) => {
    await processIceCandidates(candidates);
  };

  return (
    <div>
      <input
        type="text"
        placeholder="Paste host's offer"
        onChange={(e) => {
          const offer = JSON.parse(e.target.value);
          handleJoinGame(offer);
        }}
      />
      {connectionState === 'connected' && (
        <div>Connected! Game ready.</div>
      )}
    </div>
  );
}
```

### Sending Game State

```typescript
// Send full game state sync
connection.sendGameState(gameState, true);

// Send incremental update
connection.sendGameState(gameState, false);
```

### Sending Chat Messages

```typescript
connection.sendChat('Hello opponent!');
```

## QR Code Integration

The implementation includes utilities for encoding/decoding signaling data as QR codes:

```typescript
import {
  createSignalingDataTransfer,
  serializeForQRCode,
  deserializeFromQRCode,
  isDataTooLargeForQRCode,
  chunkDataForQRCode,
  assembleChunks,
} from '@/lib/local-signaling-client';

// Create transfer object
const transfer = createSignalingDataTransfer('offer', offer);

// Serialize for QR code
const encoded = serializeForQRCode(transfer);

// Check if data is too large
if (isDataTooLargeForQRCode(encoded)) {
  // Use multi-step sharing
  const chunks = chunkDataForQRCode(encoded);
  // Display chunks one by one
} else {
  // Single QR code
  generateQRCode(encoded);
}

// Deserialize received data
const received = deserializeFromQRCode(encoded);
```

## Connection States

### P2PConnectionState

- `disconnected`: No active connection
- `signaling`: Exchanging offer/answer
- `connecting`: Exchanging ICE candidates
- `connected`: Connection established
- `reconnecting`: Attempting to reconnect
- `failed`: Connection failed

### ConnectionPhase (Signaling)

- `idle`: Not started
- `creating-offer`: Host creating offer
- `waiting-for-answer`: Host waiting for answer
- `creating-answer`: Joiner creating answer
- `exchanging-ice`: Exchanging ICE candidates
- `connecting`: Establishing connection
- `connected`: Signaling complete
- `failed`: Signaling failed

## Message Types

### Game Message Types

- `game-state-sync`: Synchronize game state
- `game-action`: Player game action
- `chat`: Chat message
- `player-joined`: Player joined game
- `player-left`: Player left game
- `ping`: Connection health check
- `pong`: Ping response

## Benefits of Client-Side Signaling

1. **No Server Dependencies**: Eliminates need for signaling server
2. **Privacy**: Connection data only shared between players
3. **Offline Capable**: Works without internet (for local network)
4. **Cost-Free**: No server hosting costs
5. **Simple Deployment**: No server infrastructure required
6. **Direct P2P**: Once connected, no third-party involvement

## Limitations

1. **Manual Exchange**: Players must manually share connection info
2. **Not Ideal for Matchmaking**: No automatic lobby/matching system
3. **Two-Player Focus**: Designed for 1v1, multi-player requires mesh network
4. **NAT Traversal**: May require TURN servers for some network configurations

## ICE Configuration

The implementation uses ICE configuration for NAT traversal:

```typescript
import { ICEConfigurationManager } from '@/lib/ice-config';

const iceManager = new ICEConfigurationManager({
  stunServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ],
  turnServers: [
    {
      urls: 'turn:your-turn-server.com:3478',
      username: 'user',
      credential: 'pass',
    },
  ],
  enableIPv6: true,
});

const config = iceManager.getRTCConfiguration();
```

## Testing

Run tests with:

```bash
npm test src/lib/__tests__/local-signaling-client.test.ts
```

## Migration from Server Signaling

To migrate from server-based signaling:

1. Replace `SignalingClient` with `LocalSignalingClient`
2. Update UI to display QR codes instead of waiting for server
3. Add manual input for receiving connection data
4. Update offer/answer exchange logic
5. Test connection flow end-to-end

## Future Enhancements

1. **QR Code Library Integration**: Add QR code generation library
2. **Near Field Communication**: Support NFC for mobile devices
3. **Bluetooth LE**: Support BLE for nearby devices
4. **Mesh Network**: Support multi-player mesh connections
5. **Connection Recovery**: Automatic reconnection after disconnect
6. **Bandwidth Optimization**: Delta compression for game state

## Related Files

- `src/lib/local-signaling-client.ts` - Core signaling implementation
- `src/lib/p2p-game-connection.ts` - P2P connection manager
- `src/hooks/use-p2p-connection.ts` - React hook
- `src/lib/__tests__/local-signaling-client.test.ts` - Unit tests
- `src/lib/ice-config.ts` - ICE configuration (existing)
- `src/lib/webrtc-p2p.ts` - WebRTC utilities (existing)

## Dependencies

- `react-native-webrtc`: WebRTC support
- No external signaling server required
- QR code library (optional, for UI)

## Troubleshooting

### Connection Fails

- Check ICE candidate exchange
- Verify STUN/TURN server configuration
- Ensure both players use same WebRTC version
- Check network firewall settings

### ICE Candidates Not Received

- Ensure data channel is open before sending
- Check connection state before adding candidates
- Verify candidate format is correct

### QR Code Too Large

- Use chunking utility for large data
- Reduce ICE candidate count
- Use higher QR code version

## Performance Considerations

1. **Game State Sync**: Use delta syncs for frequent updates
2. **Message Batching**: Batch multiple actions into single message
3. **Compression**: Compress game state before sending
4. **Rate Limiting**: Limit message send rate to avoid flooding

## Security Considerations

1. **Data Validation**: Validate all received messages
2. **Encryption**: WebRTC provides built-in encryption
3. **Authentication**: Verify player identity before accepting
4. **Rate Limiting**: Prevent message flooding attacks
