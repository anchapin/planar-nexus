/**
 * @fileOverview Saved games management system
 *
 * Issue #33: Phase 2.3: Add saved games browser
 * Unit 16: Local Storage Migration - Updated to use IndexedDB
 * Issue #1572: Split saved-games IndexedDB record into metadata + payload
 *              stores so the list view stops loading every replayJson.
 *
 * Provides:
 * - Save game to IndexedDB
 * - Load saved games list
 * - Delete saved games
 * - Game metadata management
 * - Export/import functionality
 * - Backward compatibility with localStorage
 */

import type { GameState } from "./game-state/types";
import type { Replay } from "./game-state/replay";
import {
  indexedDBStorage,
  StoredGame,
  StoredGameMeta,
  StoredGamePayload,
  SAVED_GAMES_META_STORE,
  SAVED_GAMES_PAYLOAD_STORE,
} from "./indexeddb-storage";
import {
  serializeGameState,
  deserializeGameState,
  mapReviver,
} from "./game-state/state-serialization";
import {
  compressGameStateJson,
  decompressGameStateJson,
} from "./game-state/game-state-compression";
import { serializeReplayJson } from "./saved-game-serialize-bridge";

export interface SavedGame {
  /** Unique identifier */
  id: string;
  /** Game name/title */
  name: string;
  /** Game format */
  format: string;
  /** Player names */
  playerNames: string[];
  /** When the game was saved */
  savedAt: number;
  /** When the game was created */
  createdAt: number;
  /** Current turn number */
  turnNumber: number;
  /** Current phase */
  currentPhase: string;
  /** Game status */
  status: "not_started" | "in_progress" | "paused" | "completed";
  /** Winner(s) if completed */
  winners?: string[];
  /** Whether this is an auto-save */
  isAutoSave: boolean;
  /** Auto-save slot number (if isAutoSave is true) */
  autoSaveSlot?: number;
  /** Game state snapshot (serialized) */
  gameStateJson: string;
  /** Replay data (optional) */
  replayJson?: string;
}

/**
 * Cheap projection of {@link SavedGame} returned by
 * {@link SavedGamesManager.getAllSavedGames} (issue #1572).
 *
 * Carries EVERY field the saved-games list view renders (name, format,
 * playerNames, status, savedAt, turnNumber, currentPhase, isAutoSave,
 * autoSaveSlot) plus a `hasReplay` boolean so the UI can decide whether
 * to surface the "Share Replay" affordance — without paying the cost of
 * fetching the corresponding `saved-games-payloads` row.
 *
 * Use {@link SavedGamesManager.getSavedGame} (or
 * {@link SavedGamesManager.getSavedGamePayload}) when the full payload
 * bytes are needed.
 */
export interface SavedGameMeta {
  /** Unique identifier */
  id: string;
  /** Game name/title */
  name: string;
  /** Game format */
  format: string;
  /** Player names */
  playerNames: string[];
  /** When the game was saved */
  savedAt: number;
  /** When the game was created */
  createdAt: number;
  /** Current turn number */
  turnNumber: number;
  /** Current phase */
  currentPhase: string;
  /** Game status */
  status: "not_started" | "in_progress" | "paused" | "completed";
  /** Winner(s) if completed */
  winners?: string[];
  /** Whether this is an auto-save */
  isAutoSave: boolean;
  /** Auto-save slot number (if isAutoSave is true) */
  autoSaveSlot?: number;
  /** True iff the corresponding payload row has a non-empty `replayJson`. */
  hasReplay: boolean;
}

const STORAGE_KEY = "planar_nexus_saved_games";
const AUTO_SAVE_PREFIX = "planar_nexus_auto_save_";
const MAX_AUTO_SAVE_SLOTS = 3;

/**
 * Saved games manager with IndexedDB support
 */
class SavedGamesManager {
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize storage.
   *
   * Idempotent and race-safe: concurrent callers share the same in-flight
   * promise so initialization only runs once. If initialization fails, the
   * cached promise is cleared so a subsequent call can retry instead of
   * remaining permanently rejected.
   */
  private initialize(): Promise<void> {
    // Already initialized: resolve immediately.
    if (this.initialized) {
      return Promise.resolve();
    }

    // Initialization already in flight: piggyback on the existing promise.
    if (this.initPromise) {
      return this.initPromise;
    }

    // Start initialization and cache the promise so concurrent callers
    // collapse onto a single in-flight initialization.
    this.initPromise = (async () => {
      try {
        await indexedDBStorage.initialize();
        this.initialized = true;
      } catch (error) {
        // Clear the cached promise so a later call can retry rather than
        // being stuck with a permanently-rejected promise.
        this.initPromise = null;
        throw error;
      }
    })();

    return this.initPromise;
  }

  /**
   * Reset internal initialization state.
   *
   * Intended for use in tests to isolate the shared singleton between cases.
   */
  _resetInitState(): void {
    this.initPromise = null;
    this.initialized = false;
  }

  /**
   * Convert SavedGame to StoredGame for IndexedDB.
   *
   * The compact {@code gameStateJson} is gzip-compressed (base64-enveloped) at
   * this storage boundary so IndexedDB holds a much smaller payload. The
   * in-memory {@link SavedGame} contract (a directly JSON-parseable string)
   * is preserved by {@link fromStoredGame} on read.
   *
   * Issue #1423: `async` because {@link compressGameStateJson} drives the
   * native `CompressionStream` API.
   *
   * Issue #1572 — kept for legacy callers / tests that need the
   * monolithic shape. New save paths route through {@link toMetaAndPayload}
   * instead so the list view never sees the heavy columns.
   */
  private async toStoredGame(game: SavedGame): Promise<StoredGame> {
    return {
      ...game,
      gameStateJson: await compressGameStateJson(game.gameStateJson),
      metadata: {},
    };
  }

  /**
   * Convert StoredGame to SavedGame from IndexedDB.
   *
   * Decompresses the {@code gameStateJson} written by {@link toStoredGame}.
   * Legacy uncompressed saves (pretty-printed or compact JSON) pass through
   * unchanged for backward compatibility.
   *
   * Issue #1423: `async` because {@link decompressGameStateJson} drives the
   * native `DecompressionStream` API.
   */
  private async fromStoredGame(stored: StoredGame): Promise<SavedGame> {
    const { metadata: _, gameStateJson, ...rest } = stored;
    return {
      ...rest,
      gameStateJson: await decompressGameStateJson(gameStateJson),
    };
  }

  /**
   * Convert a SavedGame into the meta + payload pair written to the
   * v3-split IndexedDB stores (issue #1572).
   *
   * `gameStateJson` is gzip-compressed (issue #1020 / #1423) before
   * landing in the payload row; `replayJson` is taken as-is (already a
   * string by the time it reaches this seam, courtesy of the off-thread
   * bridge in #1577). The meta row carries a {@code hasReplay} flag so
   * the list view can render the share affordance without fetching the
   * payload bytes.
   */
  private async toMetaAndPayload(
    game: SavedGame,
  ): Promise<{ meta: StoredGameMeta; payload: StoredGamePayload }> {
    const meta: StoredGameMeta = {
      id: game.id,
      name: game.name,
      format: game.format,
      playerNames: game.playerNames,
      savedAt: game.savedAt,
      createdAt: game.createdAt,
      turnNumber: game.turnNumber,
      currentPhase: game.currentPhase,
      status: game.status,
      winners: game.winners,
      isAutoSave: game.isAutoSave,
      autoSaveSlot: game.autoSaveSlot,
      hasReplay: typeof game.replayJson === "string" && game.replayJson.length > 0,
    };
    const payload: StoredGamePayload = {
      id: game.id,
      gameStateJson: await compressGameStateJson(game.gameStateJson),
      replayJson: game.replayJson,
    };
    return { meta, payload };
  }

  /**
   * Join a meta row with its (optional) payload row into the in-memory
   * {@link SavedGame} shape.
   *
   * If the payload row is missing (e.g. partial migration, deletion race),
   * the returned {@link SavedGame} has empty `gameStateJson` and no
   * `replayJson`; callers that strictly need the bytes (loadGameState /
   * loadReplay) should call {@link getSavedGamePayload} instead and
   * short-circuit on `null`.
   */
  private async fromMetaAndPayload(
    meta: StoredGameMeta,
    payload: StoredGamePayload | null,
  ): Promise<SavedGame> {
    const stored: StoredGame = {
      id: meta.id,
      name: meta.name,
      format: meta.format,
      playerNames: meta.playerNames,
      savedAt: meta.savedAt,
      createdAt: meta.createdAt,
      turnNumber: meta.turnNumber,
      currentPhase: meta.currentPhase,
      status: meta.status,
      winners: meta.winners,
      isAutoSave: meta.isAutoSave,
      autoSaveSlot: meta.autoSaveSlot,
      gameStateJson: payload?.gameStateJson ?? "",
      replayJson: payload?.replayJson,
      metadata: {},
    };
    return this.fromStoredGame(stored);
  }

  /**
   * Get all saved games.
   *
   * Issue #1572 — returns the {@link SavedGameMeta} projection (cheap
   * metadata + `hasReplay` flag) so the list view never pulls the
   * multi-MB `gameStateJson` / `replayJson` columns on mount. Use
   * {@link getSavedGame} when the full payload is required.
   */
  async getAllSavedGames(): Promise<SavedGameMeta[]> {
    if (typeof window === "undefined") return [];

    try {
      await this.initialize();
      const metas = await indexedDBStorage.getAll<StoredGameMeta>(
        SAVED_GAMES_META_STORE,
      );
      if (metas.length > 0) {
        return metas
          .map((m) => this.metaRowToMeta(m))
          .sort((a, b) => b.savedAt - a.savedAt);
      }

      // Pre-#1572 database that hasn't migrated yet (shouldn't be
      // reachable after the onupgradeneeded split runs, but stay defensive).
      const legacy = await indexedDBStorage.getAll<StoredGame>("saved-games");
      return legacy
        .map((g) => ({
          id: g.id,
          name: g.name,
          format: g.format,
          playerNames: g.playerNames,
          savedAt: g.savedAt,
          createdAt: g.createdAt,
          turnNumber: g.turnNumber,
          currentPhase: g.currentPhase,
          status: g.status,
          winners: g.winners,
          isAutoSave: g.isAutoSave,
          autoSaveSlot: g.autoSaveSlot,
          hasReplay:
            typeof g.replayJson === "string" && g.replayJson.length > 0,
        }))
        .sort((a, b) => b.savedAt - a.savedAt);
    } catch (error) {
      console.error("Failed to get saved games from IndexedDB:", error);

      // Fallback to localStorage
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return [];

        const games: SavedGame[] = JSON.parse(stored);
        return games
          .map((g) => this.savedGameToMeta(g))
          .sort((a, b) => b.savedAt - a.savedAt);
      } catch (e) {
        console.error("Failed to parse saved games from localStorage:", e);
        return [];
      }
    }
  }

  /**
   * Project an IndexedDB meta row into the public {@link SavedGameMeta}.
   * Internal seam — strips the storage-only field set and freezes the
   * shape so callers can't accidentally mutate IndexedDB state.
   */
  private metaRowToMeta(m: StoredGameMeta): SavedGameMeta {
    return {
      id: m.id,
      name: m.name,
      format: m.format,
      playerNames: m.playerNames,
      savedAt: m.savedAt,
      createdAt: m.createdAt,
      turnNumber: m.turnNumber,
      currentPhase: m.currentPhase,
      status: m.status,
      winners: m.winners,
      isAutoSave: m.isAutoSave,
      autoSaveSlot: m.autoSaveSlot,
      hasReplay: m.hasReplay,
    };
  }

  /**
   * Project an in-memory {@link SavedGame} down to {@link SavedGameMeta}.
   * Used for the localStorage fallback and for ad-hoc projections (e.g.
   * after a fresh save before the IndexedDB read-back completes).
   */
  private savedGameToMeta(game: SavedGame): SavedGameMeta {
    return {
      id: game.id,
      name: game.name,
      format: game.format,
      playerNames: game.playerNames,
      savedAt: game.savedAt,
      createdAt: game.createdAt,
      turnNumber: game.turnNumber,
      currentPhase: game.currentPhase,
      status: game.status,
      winners: game.winners,
      isAutoSave: game.isAutoSave,
      autoSaveSlot: game.autoSaveSlot,
      hasReplay:
        typeof game.replayJson === "string" && game.replayJson.length > 0,
    };
  }

  /**
   * Get saved game by ID — fetches meta + payload and joins into a
   * full {@link SavedGame}. Use {@link getSavedGamePayload} when only
   * the heavy bytes are needed.
   */
  async getSavedGame(id: string): Promise<SavedGame | null> {
    try {
      await this.initialize();
      const meta = await indexedDBStorage.get<StoredGameMeta>(
        SAVED_GAMES_META_STORE,
        id,
      );
      if (meta) {
        const payload = await indexedDBStorage.get<StoredGamePayload>(
          SAVED_GAMES_PAYLOAD_STORE,
          id,
        );
        return this.fromMetaAndPayload(meta, payload);
      }

      // Fallback to the legacy store for pre-#1572 databases that
      // haven't migrated yet.
      const legacy = await indexedDBStorage.get<StoredGame>(
        "saved-games",
        id,
      );
      return legacy ? await this.fromStoredGame(legacy) : null;
    } catch (error) {
      console.error("Failed to get saved game from IndexedDB:", error);

      // Fallback to localStorage
      const games = await this.getAllSavedGames();
      return games.find((g) => g.id === id)
        ? // localStorage fallback path: re-fetch the matching row from
          // localStorage directly so we can hand back the full payload
          // (the meta projection doesn't carry gameStateJson / replayJson).
          this.findSavedGameInLocalStorage(id)
        : null;
    }
  }

  /**
   * Read only the payload bytes for a saved game. Used by the
   * open-saved-game path when the caller already has the meta row and
   * doesn't want to pay the cost of re-projecting.
   */
  async getSavedGamePayload(
    id: string,
  ): Promise<StoredGamePayload | null> {
    try {
      await this.initialize();
      return await indexedDBStorage.get<StoredGamePayload>(
        SAVED_GAMES_PAYLOAD_STORE,
        id,
      );
    } catch (error) {
      console.error(
        "Failed to read saved-game payload from IndexedDB:",
        error,
      );
      return null;
    }
  }

  /**
   * Look up a single saved game in the localStorage fallback blob and
   * return the full payload (or null if the id is unknown).
   */
  private findSavedGameInLocalStorage(id: string): SavedGame | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      const games: SavedGame[] = JSON.parse(stored);
      return games.find((g) => g.id === id) ?? null;
    } catch (e) {
      console.error(
        "Failed to read saved-game payload from localStorage fallback:",
        e,
      );
      return null;
    }
  }

  /**
   * Save a game
   */
  async saveGame(game: SavedGame): Promise<SavedGame> {
    try {
      await this.initialize();
      const { meta, payload } = await this.toMetaAndPayload(game);
      await indexedDBStorage.set(SAVED_GAMES_META_STORE, meta);
      await indexedDBStorage.set(SAVED_GAMES_PAYLOAD_STORE, payload);
      return game;
    } catch (error) {
      console.error("Failed to save game to IndexedDB:", error);

      // Fallback to localStorage — read the full SavedGame[] blob
      // (not the meta projection) so we can replace in place without
      // losing payload bytes.
      const existing = this.readLocalStorageGames();
      const idx = existing.findIndex((g) => g.id === game.id);
      if (idx >= 0) {
        existing[idx] = game;
      } else {
        existing.push(game);
      }
      this.saveGamesToLocalStorage(existing);

      return game;
    }
  }

  /**
   * Read the full localStorage fallback blob (all {@link SavedGame}s).
   * Returns an empty array if the blob is missing or corrupt.
   */
  private readLocalStorageGames(): SavedGame[] {
    if (typeof window === "undefined") return [];
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? (parsed as SavedGame[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Delete a saved game
   */
  async deleteGame(id: string): Promise<boolean> {
    try {
      await this.initialize();
      // Issue #1572 — clean up every store that might still hold a
      // row for this id (the legacy monolithic store + the new meta
      // + payload pair). The migration deletes the legacy row on
      // upgrade, but a user who downgrades back to v2 would still see
      // their monolithic rows in backups, so we leave that store
      // around; deleting from all three keeps the contract honest.
      await indexedDBStorage.delete(SAVED_GAMES_META_STORE, id);
      await indexedDBStorage.delete(SAVED_GAMES_PAYLOAD_STORE, id);
      await indexedDBStorage.delete("saved-games", id);
      return true;
    } catch (error) {
      console.error("Failed to delete game from IndexedDB:", error);

      // Fallback to localStorage — read the full SavedGame[] blob (not the
      // meta projection) so the fallback preserves the heavy payload
      // bytes for the rows we keep.
      const games = this.readLocalStorageGames();
      const filteredGames = games.filter((g) => g.id !== id);

      if (filteredGames.length === games.length) {
        return false; // No game was deleted
      }

      this.saveGamesToLocalStorage(filteredGames);
      return true;
    }
  }

  /**
   * Get only manual saves (not auto-saves) — issue #1572: meta-only.
   */
  async getManualSaves(): Promise<SavedGameMeta[]> {
    const games = await this.getAllSavedGames();
    return games.filter((g) => !g.isAutoSave);
  }

  /**
   * Get only auto-saves — issue #1572: meta-only.
   */
  async getAutoSaves(): Promise<SavedGameMeta[]> {
    const games = await this.getAllSavedGames();
    return games
      .filter((g) => g.isAutoSave)
      .sort((a, b) => (a.autoSaveSlot || 0) - (b.autoSaveSlot || 0));
  }

  /**
   * Save game state to auto-save slot
   */
  async saveToAutoSave(
    gameState: GameState,
    replay: Replay | null,
    slot: number = 0,
  ): Promise<SavedGame> {
    // First, delete any existing auto-save in this slot
    const existingAutoSaves = await this.getAutoSaves();
    const existingInSlot = existingAutoSaves.find(
      (g) => g.autoSaveSlot === slot,
    );
    if (existingInSlot) {
      await this.deleteGame(existingInSlot.id);
    }

    const now = Date.now();
    // Issue #1577: serialize the replay off the main thread when the worker
    // is available. For a 4-player Commander game this stringify is a
    // 50–200 MB synchronous call that used to block the frame right after a
    // game action; the bridge falls back to the identical synchronous
    // `JSON.stringify(replay, mapReplacer)` when no worker exists (jsdom,
    // SSR, CSP-blocked).
    const replayJson = await serializeReplayJson(replay);
    const autoSave: SavedGame = {
      id: `${AUTO_SAVE_PREFIX}${slot}_${now}`,
      name: `Auto-Save ${slot + 1}`,
      format: "unknown", // Would be stored in gameState
      playerNames: Array.from(gameState.players.values()).map((p) => p.name),
      savedAt: now,
      createdAt: gameState.createdAt,
      turnNumber: gameState.turn.turnNumber,
      currentPhase: gameState.turn.currentPhase,
      status: gameState.status,
      winners: gameState.winners,
      isAutoSave: true,
      autoSaveSlot: slot,
      gameStateJson: serializeGameState(gameState),
      replayJson,
    };

    return this.saveGame(autoSave);
  }

  /**
   * Perform auto-save with slot rotation
   */
  async autoSave(
    gameState: GameState,
    replay: Replay | null,
  ): Promise<SavedGame> {
    const autoSaves = await this.getAutoSaves();

    // Find oldest slot or use slot 0
    let targetSlot = 0;
    if (autoSaves.length >= MAX_AUTO_SAVE_SLOTS) {
      // Use the oldest slot
      targetSlot = autoSaves[0].autoSaveSlot || 0;
    } else {
      // Find first available slot
      const usedSlots = new Set(autoSaves.map((g) => g.autoSaveSlot));
      for (let i = 0; i < MAX_AUTO_SAVE_SLOTS; i++) {
        if (!usedSlots.has(i)) {
          targetSlot = i;
          break;
        }
      }
    }

    return this.saveToAutoSave(gameState, replay, targetSlot);
  }

  /**
   * Search saved games by name or player — issue #1572: meta-only.
   */
  async searchGames(query: string): Promise<SavedGameMeta[]> {
    if (!query.trim()) return this.getAllSavedGames();

    const lowerQuery = query.toLowerCase();
    const games = await this.getAllSavedGames();
    return games.filter(
      (game) =>
        game.name.toLowerCase().includes(lowerQuery) ||
        game.playerNames.some((name) =>
          name.toLowerCase().includes(lowerQuery),
        ),
    );
  }

  /**
   * Filter saved games by status — issue #1572: meta-only.
   */
  async filterByStatus(
    status: SavedGame["status"],
  ): Promise<SavedGameMeta[]> {
    const games = await this.getAllSavedGames();
    return games.filter((g) => g.status === status);
  }

  /**
   * Filter saved games by format — issue #1572: meta-only.
   */
  async filterByFormat(format: string): Promise<SavedGameMeta[]> {
    const games = await this.getAllSavedGames();
    return games.filter((g) => g.format === format);
  }

  /**
   * Load game state from saved game. Issue #1572 — fetches ONLY the
   * payload row (no meta round-trip), so the open-game flow pays one
   * IndexedDB read instead of two.
   */
  async loadGameState(id: string): Promise<GameState | null> {
    const payload = await this.getSavedGamePayload(id);
    if (!payload) {
      // Fallback: read the legacy monolithic store for pre-#1572 databases
      // that haven't migrated yet.
      const legacy = await this.getSavedGame(id);
      if (!legacy) return null;
      try {
        return deserializeGameState(legacy.gameStateJson);
      } catch (e) {
        console.error("Failed to parse game state:", e);
        return null;
      }
    }

    try {
      return deserializeGameState(
        await decompressGameStateJson(payload.gameStateJson),
      );
    } catch (e) {
      console.error("Failed to parse game state:", e);
      return null;
    }
  }

  /**
   * Load replay from saved game. Issue #1572 — fetches ONLY the payload
   * row.
   */
  async loadReplay(id: string): Promise<Replay | null> {
    const payload = await this.getSavedGamePayload(id);
    if (!payload?.replayJson) {
      // Fallback to the legacy monolithic store for pre-#1572 databases.
      const legacy = await this.getSavedGame(id);
      if (!legacy?.replayJson) return null;
      try {
        return JSON.parse(legacy.replayJson, mapReviver);
      } catch (e) {
        console.error("Failed to parse replay:", e);
        return null;
      }
    }

    try {
      return JSON.parse(payload.replayJson, mapReviver);
    } catch (e) {
      console.error("Failed to parse replay:", e);
      return null;
    }
  }

  /**
   * Clear all saved games — issue #1572: clears the meta + payload
   * stores AND the legacy store (the migration leaves pre-#1572 rows
   * in the legacy store until a later cleanup; clearing it here is
   // safe because the meta + payload pair is now authoritative).
   */
  async clearAll(): Promise<void> {
    try {
      await this.initialize();
      await indexedDBStorage.clear(SAVED_GAMES_META_STORE);
      await indexedDBStorage.clear(SAVED_GAMES_PAYLOAD_STORE);
      await indexedDBStorage.clear("saved-games");

      // Also clear localStorage for backward compatibility
      if (typeof window !== "undefined") {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      console.error("Failed to clear saved games:", error);

      // Fallback to localStorage
      if (typeof window !== "undefined") {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }

  /**
   * Export saved game to JSON file — issue #1572: reads the full
   * record (meta + payload) so the exported file is byte-identical to
   * the pre-#1572 export shape (legacy importers still work).
   */
  async exportGame(id: string): Promise<void> {
    const game = await this.getSavedGame(id);
    if (!game) return;

    const blob = new Blob([JSON.stringify(game, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `saved-game-${game.name.replace(/\s+/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Import saved game from JSON file — issue #1572: routes through the
   * meta + payload split via {@link saveGame}.
   */
  async importGame(file: File): Promise<SavedGame | null> {
    try {
      const text = await file.text();
      const game = JSON.parse(text) as SavedGame;

      // Generate new ID to avoid conflicts
      game.id = `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      game.savedAt = Date.now();

      return this.saveGame(game);
    } catch (e) {
      console.error("Failed to import game:", e);
      return null;
    }
  }

  /**
   * Save games to localStorage (fallback)
   */
  private saveGamesToLocalStorage(games: SavedGame[]): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
  }
}

// Singleton instance
export const savedGamesManager = new SavedGamesManager();

/**
 * Helper to create a SavedGame from game state
 */
export async function createSavedGame(
  name: string,
  format: string,
  gameState: GameState,
  replay?: Replay | null,
): Promise<SavedGame> {
  // Issue #1577: same off-main-thread replay serialization seam as
  // `saveToAutoSave` — byte-identical fallback when no worker is available.
  const replayJson = await serializeReplayJson(replay);
  return {
    id: `save-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    format,
    playerNames: Array.from(gameState.players.values()).map((p) => p.name),
    savedAt: Date.now(),
    createdAt: gameState.createdAt,
    turnNumber: gameState.turn.turnNumber,
    currentPhase: gameState.turn.currentPhase,
    status: gameState.status,
    winners: gameState.winners,
    isAutoSave: false,
    gameStateJson: serializeGameState(gameState),
    replayJson,
  };
}

/**
 * Format timestamp to readable date
 */
export function formatSavedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
}

/**
 * Get status display text
 */
export function getStatusDisplay(status: SavedGame["status"]): string {
  switch (status) {
    case "not_started":
      return "Not Started";
    case "in_progress":
      return "In Progress";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    default:
      return status;
  }
}

/**
 * Get count of saved games — issue #1572: counts the cheap meta store
 * (no payload round-trip).
 */
export async function getSavedGamesCount(): Promise<number> {
  try {
    await indexedDBStorage.initialize();
    // Prefer the v3 meta store; fall back to the legacy store for
    // pre-#1572 databases that haven't migrated yet.
    const metaCount = await indexedDBStorage.count(SAVED_GAMES_META_STORE);
    if (metaCount > 0) return metaCount;
    return await indexedDBStorage.count("saved-games");
  } catch (error) {
    console.error("Failed to get saved games count:", error);

    // Fallback to localStorage
    if (typeof window === "undefined") return 0;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return 0;
    try {
      const games = JSON.parse(stored);
      return Array.isArray(games) ? games.length : 0;
    } catch {
      return 0;
    }
  }
}
