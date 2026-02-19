/**
 * Firebase Integration Module
 * Issue #305: Add Firebase Realtime Database for signaling/state
 * 
 * This module exports all Firebase-related functionality for the application.
 */

// Configuration
export {
  firebaseService,
  initializeFirebase,
  isFirebaseAvailable,
  getFirebaseDatabase,
  getFirebaseConfig,
  type FirebaseConfigOptions,
} from './firebase-config';

// Signaling
export {
  FirebaseSignalingService,
  createFirebaseSignalingService,
  type FirebaseSignalingSession,
  type FirebaseSignalingCallbacks,
} from './firebase-signaling';

// Game State
export {
  FirebaseGameStateService,
  createFirebaseGameStateService,
  type FirebaseGameSession,
  type GameStateUpdate,
  type FirebaseGameStateCallbacks,
} from './firebase-game-state';

// Re-export from original locations for backward compatibility
export * from './firebase-config';
export * from './firebase-signaling';
