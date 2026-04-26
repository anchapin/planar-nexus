import { test as base, expect, Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const testCards = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/test-cards.json"), "utf8"),
);
const scryfallSets = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/scryfall-sets.json"), "utf8"),
);

export async function seedCardDatabase(page: Page) {
  await page.addInitScript((cards) => {
    const DB_NAME = "PlanarNexusCardDB";
    const DB_VERSION = 2;
    const STORE_NAME = "cards";

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("name", "name", { unique: false });
        store.createIndex("name_lower", "name_lower", { unique: false });
      }
    };

    request.onsuccess = (event) => {
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
      };
    };

    request.onerror = (event) => {
      console.error(
        "IndexedDB seed error:",
        (event.target as IDBOpenDBRequest).error,
      );
      (window as any).dbSeedError = (
        event.target as IDBOpenDBRequest
      ).error?.message;
    };
  }, testCards);
}

export async function waitForDbSeed(page: Page) {
  await page.waitForFunction(
    () =>
      (window as any).dbSeeded === true ||
      (window as any).dbSeedError !== undefined,
    { timeout: 15000 },
  );

  const error = await page.evaluate(() => (window as any).dbSeedError);
  if (error) {
    throw new Error(`IndexedDB seeding failed: ${error}`);
  }
}

export async function mockScryfallApi(page: Page) {
  await page.route("**/api.scryfall.com/sets**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/sets" || url.pathname === "/sets/") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(scryfallSets),
      });
    } else {
      const setCode = url.pathname
        .split("/")
        .filter(Boolean)
        .pop()
        ?.toLowerCase();
      const set = scryfallSets.data.find(
        (s: any) => s.code.toLowerCase() === setCode,
      );

      if (set) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ object: "set", ...set }),
        });
      } else {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            object: "error",
            code: "not_found",
            status: 404,
          }),
        });
      }
    }
  });
}

export const test = base.extend({});

export { expect };
