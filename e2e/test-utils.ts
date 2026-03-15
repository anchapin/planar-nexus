
import { test as base, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Load test cards from fixture
const testCards = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/test-cards.json'), 'utf8'));

/**
 * Helper to seed the IndexedDB card database in the browser
 */
export async function seedCardDatabase(page: Page) {
  await page.addInitScript((cards) => {
    const DB_NAME = 'PlanarNexusCardDB';
    const DB_VERSION = 2;
    const STORE_NAME = 'cards';

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('name_lower', 'name_lower', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      // Clear existing cards
      store.clear();

      // Add test cards
      cards.forEach((card: any) => {
        store.put({
          ...card,
          name_lower: card.name.toLowerCase()
        });
      });

      transaction.oncomplete = () => {
        console.log('IndexedDB seeded with test cards');
        (window as any).dbSeeded = true;
      };
    };

    request.onerror = (event) => {
      console.error('IndexedDB seed error:', (event.target as IDBOpenDBRequest).error);
      (window as any).dbSeedError = (event.target as IDBOpenDBRequest).error?.message;
    };
  }, testCards);
}

/**
 * Wait for the database seeding to complete
 */
export async function waitForDbSeed(page: Page) {
  await page.waitForFunction(() => 
    (window as any).dbSeeded === true || (window as any).dbSeedError !== undefined,
    { timeout: 15000 }
  );
  
  const error = await page.evaluate(() => (window as any).dbSeedError);
  if (error) {
    throw new Error(`IndexedDB seeding failed: ${error}`);
  }
}

export const test = base.extend({
  // Add any custom fixtures here if needed
});

export { expect };
