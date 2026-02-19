/**
 * Firebase Configuration
 * Issue #305: Add Firebase Realtime Database for signaling/state
 * 
 * This module provides Firebase configuration and initialization for
 * signaling and game state management.
 */

import { initializeApp, FirebaseApp, getApps, getApp } from 'firebase/app';
import { 
  getDatabase, 
  Database, 
  enableLogging as enableDatabaseLogging 
} from 'firebase/database';
import { 
  getAuth, 
  Auth, 
  signInAnonymously 
} from 'firebase/auth';

/**
 * Firebase configuration interface
 */
export interface FirebaseConfigOptions {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

/**
 * Firebase configuration from environment variables
 */
export function getFirebaseConfig(): FirebaseConfigOptions | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!apiKey || !authDomain || !databaseURL || !projectId) {
    console.warn('[Firebase] Missing configuration. Firebase features will be disabled.');
    return null;
  }

  return {
    apiKey,
    authDomain,
    databaseURL,
    projectId,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

/**
 * Firebase service singleton
 */
class FirebaseService {
  private app: FirebaseApp | null = null;
  private database: Database | null = null;
  private auth: Auth | null = null;
  private initialized = false;
  private config: FirebaseConfigOptions | null = null;

  /**
   * Initialize Firebase with configuration
   */
  initialize(config?: FirebaseConfigOptions): boolean {
    if (this.initialized) {
      return true;
    }

    this.config = config || getFirebaseConfig();
    
    if (!this.config) {
      console.warn('[Firebase] No configuration available');
      return false;
    }

    try {
      // Check if already initialized
      if (getApps().length > 0) {
        this.app = getApp();
      } else {
        this.app = initializeApp(this.config);
      }

      this.database = getDatabase(this.app);
      this.auth = getAuth(this.app);
      this.initialized = true;

      console.log('[Firebase] Initialized successfully');
      return true;
    } catch (error) {
      console.error('[Firebase] Initialization failed:', error);
      return false;
    }
  }

  /**
   * Get the Firebase app instance
   */
  getAppInstance(): FirebaseApp | null {
    return this.app;
  }

  /**
   * Get the Realtime Database instance
   */
  getDatabaseInstance(): Database | null {
    if (!this.initialized) {
      this.initialize();
    }
    return this.database;
  }

  /**
   * Get the Auth instance
   */
  getAuthInstance(): Auth | null {
    if (!this.initialized) {
      this.initialize();
    }
    return this.auth;
  }

  /**
   * Sign in anonymously for authentication
   */
  async signInAnonymouslyUser(): Promise<string | null> {
    if (!this.auth) {
      console.warn('[Firebase] Auth not initialized');
      return null;
    }

    try {
      const result = await signInAnonymously(this.auth);
      return result.user.uid;
    } catch (error) {
      console.error('[Firebase] Anonymous sign-in failed:', error);
      return null;
    }
  }

  /**
   * Check if Firebase is initialized and available
   */
  isAvailable(): boolean {
    return this.initialized && this.database !== null;
  }

  /**
   * Enable debug logging for Firebase
   */
  enableLogging(enabled: boolean = true): void {
    enableDatabaseLogging(enabled);
  }

  /**
   * Get the current configuration
   */
  getConfig(): FirebaseConfigOptions | null {
    return this.config;
  }
}

// Export singleton instance
export const firebaseService = new FirebaseService();

/**
 * Initialize Firebase with optional configuration
 */
export function initializeFirebase(config?: FirebaseConfigOptions): boolean {
  return firebaseService.initialize(config);
}

/**
 * Check if Firebase is available
 */
export function isFirebaseAvailable(): boolean {
  return firebaseService.isAvailable();
}

/**
 * Get Firebase database instance
 */
export function getFirebaseDatabase(): Database | null {
  return firebaseService.getDatabaseInstance();
}
