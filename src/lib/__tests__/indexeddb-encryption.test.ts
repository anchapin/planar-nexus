/**
 * @fileOverview IndexedDB Encryption Tests (issue #1984)
 *
 * Tests AES-GCM encryption/decryption, opt-out feature flag,
 * and integration with IndexedDBStorage get/set operations.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import {
  encrypt,
  decrypt,
  setEncryptionEnabled,
  isEncryptionOptedOut,
} from "../indexeddb-encryption";
import { IndexedDBStorage } from "../indexeddb-storage";

const TEST_SECRET = "test-device-secret-for-encryption";
const TEST_DB_NAME = "TestEncryptionDB";
const ENCRYPTION_ENABLED_KEY = "planar-nexus:encryption-enabled";
const DEVICE_SECRET_KEY = "planar-nexus:device-secret";

describe("indexeddb-encryption", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(ENCRYPTION_ENABLED_KEY);
      localStorage.removeItem(DEVICE_SECRET_KEY);
    }
  });

  afterEach(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(ENCRYPTION_ENABLED_KEY);
      localStorage.removeItem(DEVICE_SECRET_KEY);
    }
  });

  describe("encrypt / decrypt round-trip", () => {
    it("returns the original plaintext after decrypt(encrypt(x))", async () => {
      const plaintext = JSON.stringify({
        id: "deck-1",
        name: "Test Deck",
        cards: [],
      });
      const ciphertext = await encrypt(plaintext);
      expect(ciphertext).not.toBe(plaintext);
      expect(typeof ciphertext).toBe("string");
      const decrypted = await decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    it("produces different ciphertexts for the same plaintext (random IV)", async () => {
      const plaintext = JSON.stringify({ id: "deck-1", name: "Test Deck" });
      const ct1 = await encrypt(plaintext);
      const ct2 = await encrypt(plaintext);
      expect(ct1).not.toBe(ct2);
      const d1 = await decrypt(ct1);
      const d2 = await decrypt(ct2);
      expect(d1).toBe(plaintext);
      expect(d2).toBe(plaintext);
    });

    it("isEncryptionOptedOut returns false by default", () => {
      expect(isEncryptionOptedOut()).toBe(false);
    });

    it("setEncryptionEnabled(false) makes isEncryptionOptedOut return true", () => {
      setEncryptionEnabled(false);
      expect(isEncryptionOptedOut()).toBe(true);
      setEncryptionEnabled(true);
      expect(isEncryptionOptedOut()).toBe(false);
    });

    it("when opted out, encrypt returns plaintext unchanged", async () => {
      setEncryptionEnabled(false);
      const plaintext = "hello world";
      const result = await encrypt(plaintext);
      expect(result).toBe(plaintext);
    });

    it("when opted out, decrypt returns ciphertext unchanged", async () => {
      setEncryptionEnabled(false);
      const ciphertext = "hello world";
      const result = await decrypt(ciphertext);
      expect(result).toBe(ciphertext);
    });
  });
});

describe("IndexedDBStorage + encryption integration", () => {
  let storage: IndexedDBStorage;

  beforeEach(() => {
    storage = new IndexedDBStorage({
      dbName: TEST_DB_NAME,
      version: 1,
      stores: ["decks"],
    });
  });

  afterEach(async () => {
    try {
      await storage.clearAll();
      await storage.close();
    } catch {
      // ignore
    }
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(ENCRYPTION_ENABLED_KEY);
      localStorage.removeItem(DEVICE_SECRET_KEY);
    }
  });

  it("stores and retrieves an encrypted record", async () => {
    await storage.initialize();
    const record = { id: "deck-1", name: "My Deck", cards: [] };
    await storage.set("decks", record);
    const retrieved = await storage.get<typeof record>("decks", "deck-1");
    expect(retrieved).toEqual(record);
  });

  it("getAll returns encrypted records decrypted", async () => {
    await storage.initialize();
    await storage.set("decks", { id: "deck-1", name: "Deck One", cards: [] });
    await storage.set("decks", { id: "deck-2", name: "Deck Two", cards: [] });
    const all = await storage.getAll<{ id: string; name: string }>("decks");
    expect(all).toContainEqual({ id: "deck-1", name: "Deck One", cards: [] });
    expect(all).toContainEqual({ id: "deck-2", name: "Deck Two", cards: [] });
  });

  it("setAll stores multiple encrypted records", async () => {
    await storage.initialize();
    const records = [
      { id: "deck-a", name: "Alpha", cards: [] },
      { id: "deck-b", name: "Beta", cards: [] },
    ];
    await storage.setAll("decks", records);
    const all = await storage.getAll<{ id: string; name: string }>("decks");
    expect(all).toHaveLength(2);
    expect(all).toContainEqual({ id: "deck-a", name: "Alpha", cards: [] });
    expect(all).toContainEqual({ id: "deck-b", name: "Beta", cards: [] });
  });

  it("deletes an encrypted record", async () => {
    await storage.initialize();
    await storage.set("decks", { id: "deck-1", name: "To Delete", cards: [] });
    await storage.delete("decks", "deck-1");
    const retrieved = await storage.get("decks", "deck-1");
    expect(retrieved).toBeNull();
  });
});
