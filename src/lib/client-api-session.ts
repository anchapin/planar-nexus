/**
 * Client-side API session utilities.
 *
 * Provides functions to sync the browser's localStorage user identity with
 * the server-side `pn_session` cookie that API routes verify.
 *
 * Flow:
 * 1. After user sign-in (or on app start), call syncApiSession() to read
 *    the userId from localStorage and POST it to /api/auth/session, which
 *    sets the httpOnly pn_session cookie.
 * 2. All subsequent API calls automatically include the cookie (same-origin).
 * 3. On logout, call clearApiSession() to delete the cookie.
 */

const USER_STORAGE_KEY = "planar_nexus_user";
const PLAYER_ID_KEY = "planar_nexus_player_id";

/**
 * Read the current user/player identity from localStorage.
 * Returns null if no identity is found.
 */
export function getLocalUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    // Try the user object first
    const userRaw = localStorage.getItem(USER_STORAGE_KEY);
    if (userRaw) {
      const user = JSON.parse(userRaw) as { id?: unknown };
      if (user?.id && typeof user.id === "string") {
        return user.id;
      }
    }
    // Fall back to player ID (used in multiplayer context)
    const playerId = localStorage.getItem(PLAYER_ID_KEY);
    if (playerId && typeof playerId === "string" && playerId.trim() !== "") {
      return playerId.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sync the localStorage identity to the server-side session cookie.
 * Call this after sign-in or on app start to establish the API session.
 */
export async function syncApiSession(): Promise<void> {
  const userId = getLocalUserId();
  if (!userId) return;
  try {
    await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
  } catch {
    // Session sync is best-effort; API calls will return 401 if not synced.
  }
}

/**
 * Clear the server-side session cookie (logout).
 */
export async function clearApiSession(): Promise<void> {
  try {
    await fetch("/api/auth/session", { method: "DELETE" });
  } catch {
    // Best-effort
  }
}
