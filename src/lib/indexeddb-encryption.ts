/**
 * @fileOverview IndexedDB AES-GCM Encryption Layer (issue #1984)
 *
 * Provides AES-256-GCM encryption for all IndexedDB read/write operations.
 * Key is derived from a device-bound secret stored in localStorage using
 * PBKDF2 (100,000 iterations, SHA-256). Each record is encrypted with a
 * random 12-byte IV stored alongside the ciphertext.
 *
 * Feature flag: `ENCRYPTION_ENABLED_KEY` in localStorage defaults to true.
 * Users who opt out store records in plaintext (no re-encryption of
 * existing records — they are left as-is and read as unencrypted).
 */

const ENCRYPTION_ENABLED_KEY = "planar-nexus:encryption-enabled";
const DEVICE_SECRET_KEY = "planar-nexus:device-secret";
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

let cachedKey: CryptoKey | null = null;

function isEncryptionEnabled(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const val = localStorage.getItem(ENCRYPTION_ENABLED_KEY);
    if (val === null) return true;
    return val === "true";
  } catch {
    return false;
  }
}

function getOrCreateDeviceSecret(): string {
  try {
    let secret = localStorage.getItem(DEVICE_SECRET_KEY);
    if (!secret) {
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      secret = Array.from(array)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      localStorage.setItem(DEVICE_SECRET_KEY, secret);
    }
    return secret;
  } catch {
    throw new Error(
      "[indexeddb-encryption] Cannot access localStorage — device secret unavailable",
    );
  }
}

async function deriveKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const secret = getOrCreateDeviceSecret();
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  const salt = encoder.encode("PlanarNexus-IDB-v1");
  cachedKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );

  return cachedKey;
}

export async function encrypt(plaintext: string): Promise<string> {
  if (!isEncryptionEnabled()) return plaintext;

  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );

  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);

  return btoa(String.fromCharCode(...combined));
}

export async function decrypt(ciphertext: string): Promise<string> {
  if (!isEncryptionEnabled()) return ciphertext;

  try {
    const key = await deriveKey();
    const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, IV_LENGTH);
    const data = combined.slice(IV_LENGTH);

    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data,
    );

    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error(
      "[indexeddb-encryption] Decryption failed — wrong key or corrupted data",
    );
  }
}

export function setEncryptionEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENCRYPTION_ENABLED_KEY, String(enabled));
    cachedKey = null;
  } catch {
    // localStorage unavailable — silently ignore
  }
}

export function isEncryptionOptedOut(): boolean {
  return !isEncryptionEnabled();
}
