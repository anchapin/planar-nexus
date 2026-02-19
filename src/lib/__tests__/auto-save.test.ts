/**
 * @fileOverview Tests for auto-save functionality
 * 
 * Issue #269: Auto-save functionality for game states
 */

import {
  getAutoSaveConfig,
  setAutoSaveConfig,
  resetAutoSaveConfig,
  isTriggerEnabled,
  toggleTrigger,
  DEFAULT_AUTO_SAVE_CONFIG,
  type AutoSaveTrigger,
} from '../auto-save-config';

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    get store() {
      return store;
    },
  };
})();

// Setup before each test
beforeEach(() => {
  mockLocalStorage.clear();
  Object.defineProperty(global, 'localStorage', {
    value: mockLocalStorage,
    writable: true,
  });
});

describe('auto-save-config', () => {
  describe('getAutoSaveConfig', () => {
    it('should return default config when no config is stored', () => {
      const config = getAutoSaveConfig();
      
      expect(config).toEqual(DEFAULT_AUTO_SAVE_CONFIG);
      expect(config.enabled).toBe(true);
      expect(config.triggers).toContain('end_of_turn');
      expect(config.maxAutoSaves).toBe(3);
    });

    it('should return stored config when available', () => {
      const customConfig = {
        enabled: false,
        maxAutoSaves: 5,
        showIndicator: false,
      };
      
      mockLocalStorage.setItem(
        'planar_nexus_auto_save_config',
        JSON.stringify(customConfig)
      );
      
      const config = getAutoSaveConfig();
      
      expect(config.enabled).toBe(false);
      expect(config.maxAutoSaves).toBe(5);
      expect(config.showIndicator).toBe(false);
      // Should still have default values for unspecified options
      expect(config.useSlotRotation).toBe(true);
    });

    it('should merge stored config with defaults', () => {
      const partialConfig = {
        enabled: false,
      };
      
      mockLocalStorage.setItem(
        'planar_nexus_auto_save_config',
        JSON.stringify(partialConfig)
      );
      
      const config = getAutoSaveConfig();
      
      expect(config.enabled).toBe(false);
      expect(config.triggers).toEqual(DEFAULT_AUTO_SAVE_CONFIG.triggers);
      expect(config.maxAutoSaves).toBe(DEFAULT_AUTO_SAVE_CONFIG.maxAutoSaves);
    });

    it('should return default config if stored config is invalid JSON', () => {
      mockLocalStorage.setItem(
        'planar_nexus_auto_save_config',
        'invalid json'
      );
      
      const config = getAutoSaveConfig();
      
      expect(config).toEqual(DEFAULT_AUTO_SAVE_CONFIG);
    });

    it('should handle undefined window gracefully', () => {
      // Temporarily remove window
      const originalWindow = global.window;
      // @ts-expect-error - Testing behavior when window is undefined
      delete global.window;
      
      const config = getAutoSaveConfig();
      expect(config).toEqual(DEFAULT_AUTO_SAVE_CONFIG);
      
      // Restore window
      global.window = originalWindow;
    });
  });

  describe('setAutoSaveConfig', () => {
    it('should save config to localStorage', () => {
      setAutoSaveConfig({ enabled: false });
      
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'planar_nexus_auto_save_config',
        expect.any(String)
      );
      
      const savedConfig = JSON.parse(mockLocalStorage.store['planar_nexus_auto_save_config']);
      expect(savedConfig.enabled).toBe(false);
    });

    it('should merge with existing config', () => {
      // Set initial config
      setAutoSaveConfig({ enabled: false, maxAutoSaves: 5 });
      
      // Update only enabled
      setAutoSaveConfig({ enabled: true });
      
      const config = getAutoSaveConfig();
      expect(config.enabled).toBe(true);
      expect(config.maxAutoSaves).toBe(5); // Should preserve previous value
    });

    it('should handle undefined window gracefully', () => {
      const originalWindow = global.window;
      // @ts-expect-error - Testing behavior when window is undefined
      delete global.window;
      
      // Should not throw
      expect(() => setAutoSaveConfig({ enabled: false })).not.toThrow();
      
      global.window = originalWindow;
    });
  });

  describe('isTriggerEnabled', () => {
    it('should return true for enabled triggers', () => {
      expect(isTriggerEnabled('end_of_turn')).toBe(true);
      expect(isTriggerEnabled('after_combat')).toBe(true);
      expect(isTriggerEnabled('pass_priority')).toBe(true);
      expect(isTriggerEnabled('before_modal')).toBe(true);
    });

    it('should return false for disabled triggers', () => {
      expect(isTriggerEnabled('card_played')).toBe(false);
      expect(isTriggerEnabled('spell_resolved')).toBe(false);
    });

    it('should return false when auto-save is disabled', () => {
      setAutoSaveConfig({ enabled: false });
      
      expect(isTriggerEnabled('end_of_turn')).toBe(false);
    });
  });

  describe('toggleTrigger', () => {
    it('should enable a disabled trigger', () => {
      expect(isTriggerEnabled('card_played')).toBe(false);
      
      toggleTrigger('card_played');
      
      expect(isTriggerEnabled('card_played')).toBe(true);
    });

    it('should disable an enabled trigger', () => {
      expect(isTriggerEnabled('end_of_turn')).toBe(true);
      
      toggleTrigger('end_of_turn');
      
      expect(isTriggerEnabled('end_of_turn')).toBe(false);
    });

    it('should preserve other triggers', () => {
      toggleTrigger('card_played');
      
      expect(isTriggerEnabled('end_of_turn')).toBe(true);
      expect(isTriggerEnabled('card_played')).toBe(true);
    });
  });

  describe('resetAutoSaveConfig', () => {
    it('should remove config from localStorage', () => {
      setAutoSaveConfig({ enabled: false });
      expect(mockLocalStorage.store['planar_nexus_auto_save_config']).toBeDefined();
      
      resetAutoSaveConfig();
      
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('planar_nexus_auto_save_config');
      expect(getAutoSaveConfig()).toEqual(DEFAULT_AUTO_SAVE_CONFIG);
    });
  });

  describe('default configuration', () => {
    it('should have recommended triggers enabled', () => {
      expect(DEFAULT_AUTO_SAVE_CONFIG.triggers).toContain('end_of_turn');
      expect(DEFAULT_AUTO_SAVE_CONFIG.triggers).toContain('after_combat');
      expect(DEFAULT_AUTO_SAVE_CONFIG.triggers).toContain('pass_priority');
      expect(DEFAULT_AUTO_SAVE_CONFIG.triggers).toContain('before_modal');
    });

    it('should have reasonable defaults', () => {
      expect(DEFAULT_AUTO_SAVE_CONFIG.enabled).toBe(true);
      expect(DEFAULT_AUTO_SAVE_CONFIG.maxAutoSaves).toBe(3);
      expect(DEFAULT_AUTO_SAVE_CONFIG.useSlotRotation).toBe(true);
      expect(DEFAULT_AUTO_SAVE_CONFIG.showIndicator).toBe(true);
      expect(DEFAULT_AUTO_SAVE_CONFIG.autoCleanup).toBe(true);
    });

    it('should have periodic save disabled by default', () => {
      expect(DEFAULT_AUTO_SAVE_CONFIG.enablePeriodic).toBe(false);
      expect(DEFAULT_AUTO_SAVE_CONFIG.periodicIntervalMs).toBeNull();
    });
  });
});
