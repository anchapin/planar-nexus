/**
 * Local User Management Module
 * Replaces Firebase Auth with simple localStorage-based user management
 */

export interface LocalUser {
  /** Unique user ID */
  id: string;
  /** Display name */
  name: string;
  /** When the user was created */
  createdAt: number;
  /** Last login time */
  lastLoginAt: number;
  /** User preferences */
  preferences?: Record<string, unknown>;
}

const USER_STORAGE_KEY = 'planar_nexus_user';
const USER_PREFERENCES_KEY = 'planar_nexus_preferences';

/**
 * Local User Manager
 * Handles user authentication and preferences using localStorage
 */
class LocalUserManager {
  private currentUser: LocalUser | null = null;

  /**
   * Get current user
   */
  getCurrentUser(): LocalUser | null {
    if (this.currentUser) {
      return this.currentUser;
    }

    if (typeof window === 'undefined') {
      return null;
    }

    try {
      const stored = localStorage.getItem(USER_STORAGE_KEY);
      if (stored) {
        const user = JSON.parse(stored) as LocalUser;
        this.currentUser = user;
        return user;
      }
    } catch (error) {
      console.error('Failed to parse user from localStorage:', error);
    }

    return null;
  }

  /**
   * Sign in with a name (creates new user if doesn't exist)
   */
  signIn(userName: string): LocalUser {
    if (typeof window === 'undefined') {
      throw new Error('signIn can only be called in the browser');
    }

    let user = this.getCurrentUser();

    if (!user) {
      // Create new user
      user = {
        id: this.generateUserId(),
        name: userName,
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
        preferences: {},
      };

      this.saveUser(user);
    } else {
      // Update last login and name if changed
      user.name = userName;
      user.lastLoginAt = Date.now();
      this.saveUser(user);
    }

    this.currentUser = user;
    return user;
  }

  /**
   * Sign out current user
   */
  signOut(): void {
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.removeItem(USER_STORAGE_KEY);
    this.currentUser = null;
  }

  /**
   * Update user preferences
   */
  updatePreferences(preferences: Record<string, unknown>): void {
    const user = this.getCurrentUser();
    if (!user) {
      throw new Error('No user signed in');
    }

    user.preferences = { ...user.preferences, ...preferences };
    this.saveUser(user);
  }

  /**
   * Get user preferences
   */
  getPreferences(): Record<string, unknown> {
    const user = this.getCurrentUser();
    return user?.preferences || {};
  }

  /**
   * Get a specific preference value
   */
  getPreference<T = unknown>(key: string, defaultValue?: T): T | undefined {
    const preferences = this.getPreferences();
    return (preferences[key] as T) ?? defaultValue;
  }

  /**
   * Generate a unique user ID
   */
  private generateUserId(): string {
    // Generate a UUID-like ID
    return 'user_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Save user to localStorage
   */
  private saveUser(user: LocalUser): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } catch (error) {
      console.error('Failed to save user to localStorage:', error);
    }
  }

  /**
   * Check if user is signed in
   */
  isAuthenticated(): boolean {
    return this.getCurrentUser() !== null;
  }

  /**
   * Get user display name
   */
  getDisplayName(): string {
    const user = this.getCurrentUser();
    return user?.name || 'Guest';
  }

  /**
   * Get user ID
   */
  getUserId(): string {
    const user = this.getCurrentUser();
    return user?.id || '';
  }
}

// Export singleton instance
export const localUserManager = new LocalUserManager();

/**
 * Sign in with a name
 */
export function signIn(userName: string): LocalUser {
  return localUserManager.signIn(userName);
}

/**
 * Sign out current user
 */
export function signOut(): void {
  localUserManager.signOut();
}

/**
 * Get current user
 */
export function getCurrentUser(): LocalUser | null {
  return localUserManager.getCurrentUser();
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return localUserManager.isAuthenticated();
}

/**
 * Get user preferences
 */
export function getUserPreferences(): Record<string, unknown> {
  return localUserManager.getPreferences();
}

/**
 * Update user preferences
 */
export function updateUserPreferences(preferences: Record<string, unknown>): void {
  localUserManager.updatePreferences(preferences);
}

/**
 * Get a specific preference value
 */
export function getUserPreference<T = unknown>(key: string, defaultValue?: T): T | undefined {
  return localUserManager.getPreference<T>(key, defaultValue);
}
