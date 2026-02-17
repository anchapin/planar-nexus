/**
 * Secure API Key Storage Module
 * Issue #48: Implement secure local storage for API keys
 * 
 * This module provides secure storage for AI provider API keys
 * using the Web Crypto API for encryption.
 */

import type { AIProvider } from '@/ai/providers';

/**
 * Storage key prefix for API keys
 */
const STORAGE_KEY_PREFIX = 'planar_nexus_ai_keys';

/**
 * Encrypted key storage structure
 */
interface EncryptedKeyData {
  iv: string;
  encryptedData: string;
}

/**
 * API Key storage entry
 */
export interface StoredApiKey {
  provider: AIProvider;
  key: string;
  model?: string;
  addedAt: number;
  lastUsed?: number;
}

/**
 * Provider key status
 */
export interface ProviderKeyStatus {
  provider: AIProvider;
  hasKey: boolean;
  isValid?: boolean;
  lastValidated?: number;
}

/**
 * Get the encryption key from password-derived key
 * Uses PBKDF2 to derive a key from a session-specific value
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  // Use a combination of localStorage-available identifier and random salt
  // In production, this should use a user password or device key
  const salt = 'planar_nexus_secure_salt_v1';
  const encoder = new TextEncoder();
  
  // Use a combination of factors to derive the key
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(salt + window.location.origin),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data using AES-GCM
 */
async function encrypt(data: string, key: CryptoKey): Promise<EncryptedKeyData> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(data)
  );
  
  return {
    iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
    encryptedData: Array.from(new Uint8Array(encryptedBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join(''),
  };
}

/**
 * Decrypt data using AES-GCM
 */
async function decrypt(encryptedData: EncryptedKeyData, key: CryptoKey): Promise<string> {
  const iv = new Uint8Array(encryptedData.iv.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const data = new Uint8Array(encryptedData.encryptedData.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  
  return new TextDecoder().decode(decryptedBuffer);
}

/**
 * Store an API key for a provider
 */
export async function storeApiKey(
  provider: AIProvider, 
  apiKey: string, 
  model?: string
): Promise<void> {
  const key = await getEncryptionKey();
  
  const keyData: StoredApiKey = {
    provider,
    key: apiKey,
    model,
    addedAt: Date.now(),
  };
  
  const encrypted = await encrypt(JSON.stringify(keyData), key);
  
  localStorage.setItem(
    `${STORAGE_KEY_PREFIX}_${provider}`,
    JSON.stringify(encrypted)
  );
  
  // Update key status
  await updateKeyStatus(provider, { hasKey: true, isValid: undefined });
}

/**
 * Retrieve an API key for a provider
 */
export async function getApiKey(provider: AIProvider): Promise<string | null> {
  const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}_${provider}`);
  
  if (!stored) {
    return null;
  }
  
  try {
    const key = await getEncryptionKey();
    const encryptedData: EncryptedKeyData = JSON.parse(stored);
    const decrypted = await decrypt(encryptedData, key);
    const keyData: StoredApiKey = JSON.parse(decrypted);
    
    // Update last used timestamp
    keyData.lastUsed = Date.now();
    const reEncrypted = await encrypt(JSON.stringify(keyData), key);
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}_${provider}`,
      JSON.stringify(reEncrypted)
    );
    
    return keyData.key;
  } catch (error) {
    console.error('Failed to decrypt API key:', error);
    return null;
  }
}

/**
 * Delete an API key for a provider
 */
export async function deleteApiKey(provider: AIProvider): Promise<void> {
  localStorage.removeItem(`${STORAGE_KEY_PREFIX}_${provider}`);
  await updateKeyStatus(provider, { hasKey: false, isValid: undefined });
}

/**
 * Check if a provider has an API key stored
 */
export async function hasApiKey(provider: AIProvider): Promise<boolean> {
  return localStorage.getItem(`${STORAGE_KEY_PREFIX}_${provider}`) !== null;
}

/**
 * Get all providers with stored keys
 */
export async function getProvidersWithKeys(): Promise<AIProvider[]> {
  const providers: AIProvider[] = ['google', 'openai', 'anthropic', 'zaic', 'custom'];
  const result: AIProvider[] = [];
  
  for (const provider of providers) {
    if (await hasApiKey(provider)) {
      result.push(provider);
    }
  }
  
  return result;
}

/**
 * Key status storage management
 */
const STATUS_STORAGE_KEY = `${STORAGE_KEY_PREFIX}_status`;

async function getStatusStorage(): Promise<Record<AIProvider, ProviderKeyStatus>> {
  const stored = localStorage.getItem(STATUS_STORAGE_KEY);
  const defaultStatus: Record<AIProvider, ProviderKeyStatus> = {
    google: { provider: 'google', hasKey: false },
    openai: { provider: 'openai', hasKey: false },
    anthropic: { provider: 'anthropic', hasKey: false },
    zaic: { provider: 'zaic', hasKey: false },
    custom: { provider: 'custom', hasKey: false },
  };
  
  if (!stored) {
    return defaultStatus;
  }
  
  try {
    const key = await getEncryptionKey();
    const encryptedData: EncryptedKeyData = JSON.parse(stored);
    const decrypted = await decrypt(encryptedData, key);
    return JSON.parse(decrypted);
  } catch {
    return defaultStatus;
  }
}

async function saveStatusStorage(status: Record<AIProvider, ProviderKeyStatus>): Promise<void> {
  const key = await getEncryptionKey();
  const encrypted = await encrypt(JSON.stringify(status), key);
  localStorage.setItem(STATUS_STORAGE_KEY, JSON.stringify(encrypted));
}

async function updateKeyStatus(
  provider: AIProvider, 
  updates: Partial<ProviderKeyStatus>
): Promise<void> {
  const status = await getStatusStorage();
  status[provider] = { ...status[provider], ...updates };
  await saveStatusStorage(status);
}

/**
 * Get the status of all provider keys
 */
export async function getAllKeyStatus(): Promise<ProviderKeyStatus[]> {
  const status = await getStatusStorage();
  return Object.values(status);
}

/**
 * Validate an API key by making a test request
 */
export async function validateApiKey(
  provider: AIProvider, 
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    // For Google AI, test with a minimal request
    if (provider === 'google') {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
        { method: 'GET' }
      );
      
      if (!response.ok) {
        const error = await response.json();
        return { 
          valid: false, 
          error: error.error?.message || 'Invalid API key' 
        };
      }
      return { valid: true };
    }
    
    // For OpenAI, test with a models list request
    if (provider === 'openai') {
      const response = await fetch(
        'https://api.openai.com/v1/models',
        {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        }
      );
      
      if (!response.ok) {
        const error = await response.json();
        return { 
          valid: false, 
          error: error.error?.message || 'Invalid API key' 
        };
      }
      return { valid: true };
    }
    
    // For Anthropic, test with a models list request
    if (provider === 'anthropic') {
      const response = await fetch(
        'https://api.anthropic.com/v1/models',
        {
          headers: { 
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
        }
      );
      
      if (!response.ok) {
        const error = await response.json();
        return { 
          valid: false, 
          error: error.error?.message || 'Invalid API key' 
        };
      }
      return { valid: true };
    }
    
    // For Z.ai, test with a minimal request
    if (provider === 'zaic') {
      const response = await fetch(
        'https://api.z-ai.com/v1/models',
        {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        }
      );
      
      if (!response.ok) {
        const error = await response.text();
        return { 
          valid: false, 
          error: error || 'Invalid API key' 
        };
      }
      return { valid: true };
    }
    
    return { valid: false, error: 'Unknown provider' };
  } catch (error) {
    return { 
      valid: false, 
      error: error instanceof Error ? error.message : 'Network error' 
    };
  }
}

/**
 * Clear all stored API keys (for logout)
 */
export async function clearAllApiKeys(): Promise<void> {
  const providers: AIProvider[] = ['google', 'openai', 'anthropic', 'zaic', 'custom'];
  
  for (const provider of providers) {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}_${provider}`);
  }
  
  localStorage.removeItem(STATUS_STORAGE_KEY);
}

/**
 * Export keys (for backup - returns encrypted blob)
 * User must provide a password for additional encryption
 */
export async function exportKeys(password: string): Promise<string> {
  const providers = await getProvidersWithKeys();
  const keys: Record<string, string> = {};
  
  for (const provider of providers) {
    const key = await getApiKey(provider);
    if (key) {
      keys[provider] = key;
    }
  }
  
  // Derive key from password
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const exportKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('planar_nexus_export_salt'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  
  const encrypted = await encrypt(JSON.stringify(keys), exportKey);
  return JSON.stringify(encrypted);
}

/**
 * Import keys from backup
 */
export async function importKeys(
  encryptedBlob: string, 
  password: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );
    
    const importKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('planar_nexus_export_salt'),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    
    const encryptedData: EncryptedKeyData = JSON.parse(encryptedBlob);
    const decrypted = await decrypt(encryptedData, importKey);
    const keys: Record<string, string> = JSON.parse(decrypted);
    
    // Store each key
    for (const [provider, key] of Object.entries(keys)) {
      await storeApiKey(provider as AIProvider, key);
    }
    
    return true;
  } catch {
    return false;
  }
}
