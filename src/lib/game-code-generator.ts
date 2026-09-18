/**
 * Game code generation utilities for lobby management
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed similar-looking characters (0, O, I, 1)
const CODE_LENGTH = 6;

/**
 * Generate a unique game code for lobby identification
 * Format: 6-character alphanumeric string (e.g., "A3B7K9")
 * Uses a reduced character set to avoid confusing characters
 */
export function generateGameCode(): string {
  // Issue #1906: refuse to silently fall back to Math.random(). A predictable
  // game-code generator would let attackers brute-force lobby codes. Mirror the
  // canonical contract from src/app/api/signaling/route.ts (#1568).
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error(
      'generateGameCode requires crypto.getRandomValues — refusing to fall back to Math.random (issue #1906 contract)'
    );
  }

  const randomValues = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(randomValues);

  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomValues[i] % ALPHABET.length];
  }

  return code;
}

/**
 * Format a game code with hyphens for readability (e.g., "A3B-7K9")
 */
export function formatGameCode(code: string): string {
  if (code.length !== CODE_LENGTH) return code;
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/**
 * Validate a game code format
 */
export function isValidGameCode(code: string): boolean {
  const cleanedCode = code.replace(/-/g, '').toUpperCase();
  if (cleanedCode.length !== CODE_LENGTH) return false;

  // Check all characters are valid
  for (const char of cleanedCode) {
    if (!ALPHABET.includes(char)) return false;
  }

  return true;
}

/**
 * Normalize a game code by removing hyphens and converting to uppercase
 */
export function normalizeGameCode(code: string): string {
  return code.replace(/-/g, '').toUpperCase();
}

/**
 * Generate a unique lobby ID
 */
export function generateLobbyId(): string {
  return `lobby_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate a unique player ID
 */
export function generatePlayerId(): string {
  return `player_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
