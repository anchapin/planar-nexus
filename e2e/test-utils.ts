import { test as base, expect, Page } from "@playwright/test";
import fs from "fs";
import path from "path";

// Load test cards from fixture
const testCards = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/test-cards.json"), "utf8"),
);

/**
 * Helper to seed the IndexedDB card database in the browser
 * This uses page.evaluate to run in the actual page context after navigation
 */
export async function seedCardDatabase(page: Page) {
  await page.evaluate(async (cards) => {
    const DB_NAME = "PlanarNexusCardDB";
    const DB_VERSION = 2;
    const STORE_NAME = "cards";

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("name", "name", { unique: false });
          store.createIndex("name_lower", "name_lower", { unique: false });
        }
      };

      request.onsuccess = (event: Event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        store.clear();

        cards.forEach((card: any) => {
          store.put({
            ...card,
            name_lower: card.name.toLowerCase(),
          });
        });

        transaction.oncomplete = () => {
          console.log("IndexedDB seeded with test cards");
          (window as any).dbSeeded = true;
          resolve();
        };

        transaction.onerror = () => {
          const error = transaction.error;
          console.error("IndexedDB transaction error:", error);
          (window as any).dbSeedError = error?.message || "Transaction failed";
          reject(new Error(`IndexedDB transaction failed: ${error?.message}`));
        };
      };

      request.onerror = (event: Event) => {
        const error = (event.target as IDBOpenDBRequest).error;
        console.error("IndexedDB open error:", error);
        (window as any).dbSeedError = error?.message || "Open failed";
        reject(new Error(`IndexedDB open failed: ${error?.message}`));
      };
    });
  }, testCards);
}

/**
 * Wait for the database seeding to complete
 * @deprecated Since seedCardDatabase now uses Promise, seeding is complete when the function returns
 */
export async function waitForDbSeed(page: Page): Promise<void> {
  // No-op: seedCardDatabase now awaits completion internally
  // Kept for backwards compatibility
}

export const test = base.extend({
  // Add any custom fixtures here if needed
});

export { expect };
