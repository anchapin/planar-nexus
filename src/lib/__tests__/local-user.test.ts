/**
 * Tests for local user management
 */

import {
  signIn,
  signOut,
  getCurrentUser,
  isAuthenticated,
  getUserPreferences,
  updateUserPreferences,
  getUserPreference,
} from '../local-user';

describe('Local User Management', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    // Clean up after each test
    localStorage.clear();
  });

  describe('signIn', () => {
    it('should create a new user when none exists', () => {
      const user = signIn('Test Player');

      expect(user).toBeDefined();
      expect(user.name).toBe('Test Player');
      expect(user.id).toBeDefined();
      expect(user.id).toMatch(/^user_/);
      expect(user.createdAt).toBeGreaterThan(0);
      expect(user.lastLoginAt).toBeGreaterThan(0);
      expect(user.preferences).toEqual({});
    });

    it('should update existing user when signing in again', () => {
      const user1 = signIn('Player One');
      const user2 = signIn('Player Two');

      expect(user1.id).toBe(user2.id);
      expect(user2.name).toBe('Player Two');
      expect(user2.lastLoginAt).toBeGreaterThan(user1.lastLoginAt);
    });

    it('should persist user across reloads (simulated)', () => {
      const user1 = signIn('Persistent Player');

      // Simulate reload by clearing in-memory user
      (global as any).clearLocalUser();

      const user2 = getCurrentUser();

      expect(user2).toBeDefined();
      expect(user2?.id).toBe(user1.id);
      expect(user2?.name).toBe('Persistent Player');
    });
  });

  describe('getCurrentUser', () => {
    it('should return null when no user is signed in', () => {
      const user = getCurrentUser();
      expect(user).toBeNull();
    });

    it('should return current user when signed in', () => {
      signIn('Current User');
      const user = getCurrentUser();

      expect(user).toBeDefined();
      expect(user?.name).toBe('Current User');
    });
  });

  describe('isAuthenticated', () => {
    it('should return false when not signed in', () => {
      expect(isAuthenticated()).toBe(false);
    });

    it('should return true when signed in', () => {
      signIn('Auth User');
      expect(isAuthenticated()).toBe(true);
    });
  });

  describe('signOut', () => {
    it('should clear the current user', () => {
      signIn('Sign Out User');
      expect(isAuthenticated()).toBe(true);

      signOut();

      expect(isAuthenticated()).toBe(false);
      expect(getCurrentUser()).toBeNull();
    });

    it('should allow signing in again after sign out', () => {
      signIn('First User');
      signOut();

      const newUser = signIn('Second User');

      expect(newUser.name).toBe('Second User');
      expect(isAuthenticated()).toBe(true);
    });
  });

  describe('User Preferences', () => {
    it('should start with empty preferences', () => {
      signIn('Pref User');
      const prefs = getUserPreferences();

      expect(prefs).toEqual({});
    });

    it('should update preferences', () => {
      signIn('Pref User');

      updateUserPreferences({
        theme: 'dark',
        soundEnabled: true,
        volume: 0.5,
      });

      const prefs = getUserPreferences();

      expect(prefs.theme).toBe('dark');
      expect(prefs.soundEnabled).toBe(true);
      expect(prefs.volume).toBe(0.5);
    });

    it('should merge preferences on update', () => {
      signIn('Pref User');

      updateUserPreferences({ theme: 'dark', volume: 0.5 });
      updateUserPreferences({ soundEnabled: false });

      const prefs = getUserPreferences();

      expect(prefs.theme).toBe('dark');
      expect(prefs.volume).toBe(0.5);
      expect(prefs.soundEnabled).toBe(false);
    });

    it('should get single preference with default', () => {
      signIn('Pref User');

      const theme = getUserPreference('theme', 'light');

      expect(theme).toBe('light');
    });

    it('should get single preference with value', () => {
      signIn('Pref User');

      updateUserPreferences({ theme: 'dark' });

      const theme = getUserPreference('theme', 'light');

      expect(theme).toBe('dark');
    });

    it('should get typed preference', () => {
      signIn('Pref User');

      updateUserPreferences({ volume: 0.75 });

      const volume = getUserPreference<number>('volume', 1.0);

      expect(typeof volume).toBe('number');
      expect(volume).toBe(0.75);
    });
  });
});
