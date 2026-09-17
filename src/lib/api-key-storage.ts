/**
 * API Key Storage Module — DEPRECATED (issue #1799, part 1 of 2)
 *
 * #1799 — every operation in this module has been hard-disabled so the
 * AES key derivation can no longer be invoked from production code.
 *
 * The previous implementation derived the AES key in `getEncryptionKey`
 * from the hardcoded string `'planar_nexus_secure_salt_v1'` concatenated
 * with `window.location.origin` — both fully recoverable by any script
 * running on the page (XSS, malicious dependency). The "encryption"
 * was theater: an attacker reading the localStorage ciphertext could
 * decrypt the user's OpenAI / Anthropic / Google keys offline, and the
 * code's own comment acknowledged "in production, this should use a
 * user password or device key".
 *
 * The repository has moved provider API keys server-side via /api/ai-proxy
 * (issue #522); the local vault is redundant with that architecture and
 * has now been confirmed to provide no confidentiality. This module is
 * preserved as a fail-fast surface — every export below throws the same
 * deprecation error — so any caller that has not migrated to the proxy
 * routes will fail loudly at runtime rather than silently leaking keys.
 *
 * Migration plan (issue #1799, part 2 of 2 — same PR):
 *   - `subscription-plan-display.tsx` — replace `hasApiKey(provider)` with
 *     `GET /api/ai-proxy/validate?provider=X` (a 200 response means the
 *     server is configured for that provider, equivalent to "has key" in
 *     the user's mental model).
 *   - `subscription-detection.ts` — drop the `detectSubscription` /
 *     `validateSubscription` / `detectAllSubscriptions` family, which
 *     required the user's key to call provider APIs directly. Server-side
 *     tier detection is filed as a follow-up issue and is out of scope
 *     here.
 *   - Once those callers migrate, this module is deleted.
 *
 * Until then: every export throws. Historical localStorage entries
 * (`planar_nexus_ai_keys_*`) are NOT auto-cleared; users may purge via
 * DevTools. Removing them silently here would be a hidden destructive
 * action that the throwers explicitly avoid — pre-#1799 users still own
 * their keys via their recovery passphrase (exportKeys + importKeys).
 */

import type { AIProvider } from "@/ai/providers";

/**
 * Public type signatures are preserved for any downstream code that
 * imported them. They are intentionally NOT removed alongside the
 * deprecated functions so the migration in `subscription-plan-display`
 * can drop the import surface cleanly once caller migration lands.
 */
export interface StoredApiKey {
  provider: AIProvider;
  key: string;
  model?: string;
  addedAt: number;
  lastUsed?: number;
}

export interface ProviderKeyStatus {
  provider: AIProvider;
  hasKey: boolean;
  isValid?: boolean;
  lastValidated?: number;
}

/**
 * Single canonical deprecation message — every thrower returns this so a
 * grep on the message in CI logs surfaces every spot a caller forgot to
 * migrate.
 */
const DEPRECATION_MESSAGE =
  "api-key-storage is deprecated as of issue #1799 — the AES key derivation " +
  "used a recoverable constant + window.location.origin, providing zero " +
  "confidentiality against any XSS or malicious dependency. Provider keys must " +
  "live server-side via /api/ai-proxy. Every export from this module throws " +
  "until caller migration lands; if you reached this error in production, " +
  "the migration to the proxy routes is incomplete.";

function _throwDeprecated(): never {
  throw new Error(DEPRECATION_MESSAGE);
}

/**
 * Store an API key for a provider — deprecated, throws.
 *
 * Pre-#1799: encrypted the key with the broken constant+origin-derived
 * AES key and persisted it to localStorage.
 */
export async function storeApiKey(
  _provider: AIProvider,
  _apiKey: string,
  _model?: string,
): Promise<void> {
  _throwDeprecated();
}

/**
 * Retrieve an API key for a provider — deprecated, throws.
 *
 * Pre-#1799: would have decrypted the localStorage entry and returned
 * the plaintext key. Now throws — clients must NOT have plaintext keys.
 */
export async function getApiKey(_provider: AIProvider): Promise<string | null> {
  _throwDeprecated();
}

/**
 * Delete an API key for a provider — deprecated, throws.
 *
 * Note: a side-effect-free `localStorage.removeItem` would silently
 * mutate browser state without the caller's knowledge. The throw makes
 * the intent explicit ("no, you can't remove what's not there").
 */
export async function deleteApiKey(_provider: AIProvider): Promise<void> {
  _throwDeprecated();
}

/**
 * Check if a provider has an API key stored — deprecated, throws.
 *
 * Pre-#1799: a boolean check on localStorage. This is the migration's
 * first casualty — `subscription-plan-display.tsx` calls this with no
 * error handling, so the throw is intentional: callers MUST migrate to
 * `/api/ai-proxy/validate?provider=X`.
 */
export async function hasApiKey(_provider: AIProvider): Promise<boolean> {
  _throwDeprecated();
}

/**
 * Get all providers with stored keys — deprecated, throws.
 */
export async function getProvidersWithKeys(): Promise<AIProvider[]> {
  _throwDeprecated();
}

/**
 * Get the status of all provider keys — deprecated, throws.
 */
export async function getAllKeyStatus(): Promise<ProviderKeyStatus[]> {
  _throwDeprecated();
}

/**
 * Validate an API key against a provider — deprecated, throws.
 *
 * This function was already marked `@deprecated` pre-#1799; the proxy
 * route `/api/ai-proxy/validate` is the supported validation path.
 */
export async function validateApiKey(
  _provider: AIProvider,
  _apiKey: string,
): Promise<{ valid: boolean; error?: string }> {
  _throwDeprecated();
}

/**
 * Clear all stored API keys — INTENTIONALLY a no-op (logs only).
 *
 * Cleared silently on logout would mutate browser state without the
 * caller's knowledge (and is racy — partial failures could leave a
 * half-cleared vault). The historical `planar_nexus_ai_keys_*` entries
 * are NOT auto-purged. Users who care may remove them via DevTools.
 * The warning makes the intent visible in console so observability is
 * preserved.
 */
export async function clearAllApiKeys(): Promise<void> {
  if (typeof console !== "undefined") {
    console.warn(
      "api-key-storage.clearAllApiKeys is a no-op (#1799). Historical " +
        "stored entries (if any) are no longer reachable through this " +
        "module — keys now live server-side at /api/ai-proxy.",
    );
  }
}

/**
 * Export keys (password-wrapped backup blob) — deprecated, throws.
 *
 * Pre-#1799: this used the user's passphrase via PBKDF2 (the correct
 * path), but the exported blob only contained keys re-wrapped by the
 * broken local-AES layer. With the local layer gone, there's nothing
 * to export. A server-side key export feature is a separate product
 * decision and out of scope here.
 */
export async function exportKeys(_password: string): Promise<string> {
  _throwDeprecated();
}

/**
 * Import keys from a backup blob — deprecated, throws.
 *
 * See `exportKeys` — without the local-storage target, there's nothing
 * to import into.
 */
export async function importKeys(
  _encryptedBlob: string,
  _password: string,
): Promise<boolean> {
  _throwDeprecated();
}
