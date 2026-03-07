# Local Storage Modules Guide

This guide explains the local storage modules that replaced Firebase in Planar Nexus.

## Overview

Planar Nexus now uses local storage exclusively, with no cloud dependencies. This provides:
- Complete offline functionality
- Privacy-focused data handling
- Zero cloud costs
- Fast local operations

## Modules

### 1. Local User Management (`/src/lib/local-user.ts`)

Manages user authentication and preferences using localStorage.

#### Features
- User authentication with display names
- Unique user ID generation
- User preferences storage
- Session persistence
- Sign in/sign out functionality

#### Usage

```typescript
import { signIn, signOut, getCurrentUser, isAuthenticated } from '@/lib/local-user';

// Sign in
const user = signIn('Player Name');
console.log('User ID:', user.id);
console.log('User Name:', user.name);

// Check if authenticated
if (isAuthenticated()) {
  console.log('User is signed in');
}

// Get current user
const currentUser = getCurrentUser();
if (currentUser) {
  console.log('Welcome back:', currentUser.name);
}

// Sign out
signOut();
```

#### User Preferences

```typescript
import { getUserPreferences, updateUserPreferences, getUserPreference } from '@/lib/local-user';

// Update preferences
updateUserPreferences({
  theme: 'dark',
  soundEnabled: true,
  volume: 0.75,
});

// Get all preferences
const prefs = getUserPreferences();

// Get specific preference with default
const theme = getUserPreference<string>('theme', 'light');
const volume = getUserPreference<number>('volume', 1.0);
```

#### Storage Details
- **Storage Key:** `planar_nexus_user`
- **Preferences Key:** `planar_nexus_preferences`
- **Storage Type:** localStorage
- **Persistence:** Persists across browser sessions

### 2. Local Game Storage (`/src/lib/local-game-storage.ts`)

Manages game state persistence using IndexedDB.

#### Features
- Game session creation and joining
- Game state persistence
- Game code to game ID mapping
- Version-controlled state updates
- Offline queue for updates
- Host/client role management
- Game status tracking

#### Usage

```typescript
import { createGame, joinGame, updateGameState, getGameState } from '@/lib/local-game-storage';

// Create a game as host
const session = await createGame(
  hostId,
  'Host Player',
  'ABC123',  // game code
  initialGameState,
  {
    onGameStateUpdate: (gameState, version) => {
      console.log('Game state updated:', version);
    },
    onPlayerJoined: (playerId, playerName) => {
      console.log('Player joined:', playerName);
    },
    onPlayerLeft: (playerId) => {
      console.log('Player left:', playerId);
    },
    onConnectionStateChange: (connected) => {
      console.log('Connection state:', connected);
    },
    onError: (error) => {
      console.error('Error:', error);
    }
  }
);

// Join a game as client
const session = await joinGame(
  'ABC123',  // game code
  playerId,
  'Client Player',
  {
    // same callbacks
  }
);

// Update game state
await updateGameState(newGameState, true);  // true = full sync

// Get current game state
const state = await getGameState();

// Leave game
await leaveGame();

// End game
await endGame();
```

#### Storage Details
- **Database Name:** `PlanarNexusGameDB`
- **Database Version:** 1
- **Object Store:** `games`
- **Indexes:** `gameCode`, `status`, `updatedAt`
- **Storage Type:** IndexedDB
- **Persistence:** Persists across browser sessions
- **Capacity:** Typically 50MB+ (browser-dependent)

### 3. Card Database (`/src/lib/card-database.ts`)

Manages card storage with IndexedDB (pre-existing, no changes).

#### Features
- Offline card search
- Fuzzy search with Fuse.js
- Card validation
- Format legality checking
- Bulk import/export

#### Usage

```typescript
import { searchCardsOffline, getCardByName, isCardLegal } from '@/lib/card-database';

// Search cards
const cards = await searchCardsOffline('Lightning Bolt', {
  maxCards: 20,
  format: 'modern',
});

// Get card by name
const card = await getCardByName('Sol Ring');

// Check legality
const isLegal = await isCardLegal('Lightning Bolt', 'modern');

// Validate deck
const validation = await validateDeckOffline(cards, 'modern');
if (validation.valid) {
  console.log('Deck is legal!');
} else {
  console.log('Illegal cards:', validation.illegalCards);
}
```

### 4. Saved Games (`/src/lib/saved-games.ts`)

Manages saved games with localStorage (pre-existing, no changes).

#### Usage

```typescript
import { saveGame, getAllSavedGames, loadGame, deleteGame } from '@/lib/saved-games';

// Save a game
await saveGame({
  id: 'game-123',
  name: 'My Game',
  format: 'commander',
  playerNames: ['Player 1', 'Player 2'],
  // ... other fields
});

// Get all saved games
const games = getAllSavedGames();

// Load a game
const game = loadGame('game-123');

// Delete a game
await deleteGame('game-123');
```

## P2P Multiplayer

Multiplayer uses PeerJS for signaling (pre-existing, no changes).

### P2P Signaling (`/src/lib/p2p-signaling.ts`)

```typescript
import { createHostSignaling, createClientSignaling } from '@/lib/p2p-signaling';

// Host
const host = createHostSignaling('Player Name', {
  onConnectionStateChange: (state) => {
    console.log('Connection:', state);
  },
  onMessage: (message, peerId) => {
    console.log('Message:', message);
  },
  onPeerConnected: (peerId) => {
    console.log('Peer connected:', peerId);
  },
  onError: (error) => {
    console.error('Error:', error);
  }
});

await host.initialize('ABC123');  // game code

// Client
const client = createClientSignaling('Player Name', {
  // same callbacks
});

await client.initialize();
await client.connectToGame('ABC123');
```

## Data Storage Strategy

### IndexedDB Usage
- **Cards:** Large dataset, structured queries
- **Game State:** Complex objects, version control
- **Capacity:** 50MB+ (browser-dependent)

### localStorage Usage
- **User Session:** Small, frequently accessed
- **User Preferences:** Small, frequently accessed
- **Saved Games:** Metadata and snapshots
- **Configuration:** Various app settings
- **Capacity:** 5-10MB (browser-dependent)

### Best Practices

1. **Use IndexedDB for:**
   - Large datasets (cards, game state)
   - Complex objects that need querying
   - Data that needs version control

2. **Use localStorage for:**
   - Small configuration values
   - User preferences
   - Session data
   - Frequently accessed simple data

3. **Error Handling:**
   ```typescript
   try {
     await updateGameState(gameState);
   } catch (error) {
     console.error('Failed to update game state:', error);
     // Handle error appropriately
   }
   ```

4. **Async Operations:**
   - All IndexedDB operations are async
   - Use `await` for all storage operations
   - Handle errors appropriately

## Privacy and Security

### Data Privacy
- All data stays local to the user's device
- No data is sent to cloud services
- User has complete control over their data

### Data Security
- Data stored in browser storage
- Clearing browser data removes all stored data
- No encryption by default (can be added if needed)

### Data Export (Future Enhancement)
To add data export/import:
```typescript
// Export
const data = {
  user: getCurrentUser(),
  cards: await getAllCards(),
  games: await getAllSavedGames(),
  // ...
};
downloadJSON(data, 'planar-nexus-backup.json');

// Import
const data = await uploadJSON();
// Restore data to IndexedDB/localStorage
```

## Migration from Firebase

### User Authentication
**Before (Firebase):**
```typescript
import { signInAnonymously } from 'firebase/auth';
const result = await signInAnonymously(auth);
const userId = result.user.uid;
```

**After (Local):**
```typescript
import { signIn } from '@/lib/local-user';
const user = signIn('Player Name');
const userId = user.id;
```

### Game State Storage
**Before (Firebase):**
```typescript
import { ref, set } from 'firebase/database';
await set(ref(db, `games/${gameId}/state`), gameState);
```

**After (Local):**
```typescript
import { updateGameState } from '@/lib/local-game-storage';
await updateGameState(gameState, true);
```

### Signaling
**Before (Firebase):**
```typescript
import { FirebaseSignalingService } from '@/lib/firebase';
const signaling = new FirebaseSignalingService({ /* ... */ });
```

**After (PeerJS - Already Implemented):**
```typescript
import { createHostSignaling } from '@/lib/p2p-signaling';
const host = createHostSignaling(playerName, { /* ... */ });
```

## Testing

### Local User Management
```typescript
import { signIn, getCurrentUser, isAuthenticated } from '@/lib/local-user';

const user = signIn('Test Player');
expect(user.name).toBe('Test Player');
expect(isAuthenticated()).toBe(true);
```

### Local Game Storage
```typescript
import { createGame, getGameState } from '@/lib/local-game-storage';

await createGame(hostId, hostName, 'TEST123', initialState);
const state = await getGameState();
expect(state).toBeDefined();
```

## Troubleshooting

### Common Issues

1. **IndexedDB Quota Exceeded**
   - Solution: Implement data cleanup or ask user to clear old data
   - Code: Catch error and handle gracefully

2. **localStorage Not Available**
   - Solution: Check if browser supports localStorage
   - Code: `if (typeof window !== 'undefined' && window.localStorage)`

3. **Data Not Persisting**
   - Solution: Check for errors in async operations
   - Code: Always use `await` and handle errors

4. **Browser Compatibility**
   - Solution: Check for IndexedDB and localStorage support
   - Code: Feature detection before using APIs

## Performance Tips

1. **Batch Updates**
   - Queue multiple updates and process together
   - Reduces database operations

2. **Index Your Data**
   - Create indexes for frequently queried fields
   - Improves query performance

3. **Avoid Unnecessary Reads**
   - Cache frequently accessed data in memory
   - Only read from storage when necessary

4. **Use Transactions Wisely**
   - Group related operations in transactions
   - Improves performance and consistency

## Resources

- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [localStorage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [PeerJS Documentation](https://peerjs.com/docs/)
- [Fuse.js Documentation](https://fusejs.io/)
