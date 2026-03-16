/**
 * Card image resolver tests
 */

import { getImageDirectory, clearImageDirectory, isCustomImagesEnabled, getCardBackImage, validateImageDirectory } from '../card-image-resolver';

describe('card-image-resolver', () => {
  beforeEach(() => {
    clearImageDirectory();
  });

  describe('getImageDirectory', () => {
    it('should return null initially', () => {
      const dir = getImageDirectory();
      expect(dir).toBeNull();
    });
  });

  describe('clearImageDirectory', () => {
    it('should not throw', () => {
      expect(() => clearImageDirectory()).not.toThrow();
    });
  });

  describe('isCustomImagesEnabled', () => {
    it('should return boolean', () => {
      const enabled = isCustomImagesEnabled();
      expect(typeof enabled).toBe('boolean');
    });
  });

  describe('getCardBackImage', () => {
    it('should return string', () => {
      const image = getCardBackImage();
      expect(typeof image).toBe('string');
    });
  });

  describe('validateImageDirectory', () => {
    it('should return validation result object', () => {
      const result = validateImageDirectory('/some/path');
      expect(result).toBeDefined();
      expect('valid' in result).toBe(true);
    });
  });
});
