/**
 * Card Image Resolution System
 * 
 * This module provides functionality to resolve card images from a user's local directory
 * rather than fetching from Scryfall. This follows the Cockatrice/XMage model to avoid
 * legal issues with hosting MTG card images.
 * 
 * Users must provide their own card images organized by set/collector_number.
 */

import type { ScryfallCard } from '@/app/actions';

// Partial ScryfallCard for image resolution (only required fields)
type CardForImageResolution = {
  id: string;
  set?: string;
  collector_number?: string;
  name?: string;
  color_identity?: string[];
};

// Storage key for user's image directory
const IMAGE_DIRECTORY_KEY = 'planar-nexus-image-directory';

// File extensions to try when resolving images
const IMAGE_EXTENSIONS = ['.jpg', '.png', '.jpeg', '.webp'];

/**
 * Get the user's configured image directory from localStorage
 */
export function getImageDirectory(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(IMAGE_DIRECTORY_KEY);
}

/**
 * Set the user's image directory in localStorage
 */
export function setImageDirectory(directory: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(IMAGE_DIRECTORY_KEY, directory);
}

/**
 * Clear the user's image directory setting
 */
export function clearImageDirectory(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(IMAGE_DIRECTORY_KEY);
}

/**
 * Check if custom images are enabled (directory is set)
 */
export function isCustomImagesEnabled(): boolean {
  const dir = getImageDirectory();
  return dir !== null && dir.trim().length > 0;
}

/**
 * Resolve a card's image path from local directory
 * 
 * @param card - The card to resolve image for (partial ScryfallCard)
 * @param imageDir - Optional override for image directory
 * @param size - Image size to request ('small', 'normal', 'large')
 * @returns The resolved image URL or null if not found
 */
export function resolveCardImage(
  card: CardForImageResolution, 
  imageDir?: string | null,
  _size: 'small' | 'normal' | 'large' = 'normal'
): string | null {
  // Use provided directory or get from storage
  const dir = imageDir ?? getImageDirectory();
  
  if (!dir || dir.trim() === '') {
    return null;
  }

  // Get collector number - handle different card types
  const collectorNumber = card.collector_number || '0';
  
  // Get set code (lowercase)
  const setCode = (card.set || 'unk').toLowerCase();
  
  // Build base path: {dir}/{set}/{collector_number}
  const basePath = `${dir}/${setCode}/${collectorNumber}`;
  
  // Try each extension
  for (const ext of IMAGE_EXTENSIONS) {
    // In a browser context with File System Access API, we could verify existence
    // For now, we return the expected path and let the image tag handle 404s
    return basePath + ext;
  }
  
  return null;
}

/**
 * Get card fallback image (card back placeholder)
 * 
 * This returns a placeholder that should be shown when:
 * - User hasn't configured an image directory
 * - The local image file doesn't exist
 */
export function getCardBackImage(): string {
  // Return a placeholder SVG or data URI for card back
  return '/card-back.svg';
}

/**
 * Resolve card image with fallback to card back
 * 
 * @param card - The card to resolve image for (partial ScryfallCard)
 * @param imageDir - Optional override for image directory
 * @param size - Image size to request
 * @returns The resolved image URL or card back as fallback
 */
export function resolveCardImageWithFallback(
  card: CardForImageResolution,
  imageDir?: string | null,
  size: 'small' | 'normal' | 'large' = 'normal'
): string {
  const localImage = resolveCardImage(card, imageDir, size);
  return localImage || getCardBackImage();
}

/**
 * Format: Determine if card should show image or text fallback
 */
export interface CardDisplayOption {
  showImage: boolean;
  imageUrl: string | null;
}

/**
 * Get display option for a card based on configuration
 */
export function getCardDisplayOption(card: ScryfallCard): CardDisplayOption {
  const imageDir = getImageDirectory();
  
  if (!imageDir || imageDir.trim() === '') {
    return {
      showImage: false,
      imageUrl: null,
    };
  }
  
  const imageUrl = resolveCardImage(card, imageDir);
  
  return {
    showImage: !!imageUrl,
    imageUrl,
  };
}

/**
 * Validate that an image directory path looks reasonable
 * This is a basic validation - actual file access would require File System Access API
 */
export function validateImageDirectory(path: string): { valid: boolean; error?: string } {
  if (!path || path.trim().length === 0) {
    return { valid: false, error: 'Directory path cannot be empty' };
  }
  
  // Basic path validation - could be enhanced based on specific platform requirements
  if (path.length < 3) {
    return { valid: false, error: 'Directory path is too short' };
  }
  
  // Check for obviously invalid characters (basic check)
  if (path.includes('..') || path.includes('~')) {
    return { valid: false, error: 'Directory path contains invalid characters' };
  }
  
  return { valid: true };
}
