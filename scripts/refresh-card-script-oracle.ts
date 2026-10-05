#!/usr/bin/env node
/**
 * Refresh `scripts/data/card-script-oracle.json` from Scryfall (#2492).
 *
 * For every card script, records whether the card is Standard-legal and its
 * current oracle text. The gameplay gap report reads this snapshot to show
 * script coverage of the Standard pool and to flag scripts whose `oracle`
 * copy has drifted from Scryfall after errata. Committed so the report stays
 * deterministic and runs offline. Re-run after adding scripts or after a set
 * release:
 *
 *   npx tsx scripts/refresh-card-script-oracle.ts
 *
 * Uses Scryfall's /cards/collection endpoint (75 names per request), so a
 * refresh is a couple of requests rather than a page per 175 cards.
 */

import * as fs from "fs";
import * as path from "path";
import {
  scryfallOracle,
  type ScriptOracleSnapshot,
  type ScryfallOracleCard,
} from "./card-scripts/coverage";

interface CollectionCard extends ScryfallOracleCard {
  legalities?: Record<string, string>;
}

interface CollectionResponse {
  data: CollectionCard[];
  not_found?: { name?: string }[];
}

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "scripts", "data", "card-script-oracle.json");
const STANDARD_SNAPSHOT = path.join(
  ROOT,
  "scripts",
  "data",
  "standard-keywords.json",
);
const SCRIPTS_DIR = path.join(
  ROOT,
  "src",
  "lib",
  "game-state",
  "card-scripts",
  "cards",
);
const ENDPOINT = "https://api.scryfall.com/cards/collection";
const BATCH = 75;
// Scryfall asks for 50-100ms between requests.
const DELAY_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchBatch(names: string[]): Promise<CollectionResponse> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "planar-nexus-gap-report/1.0",
      },
      body: JSON.stringify({ identifiers: names.map((name) => ({ name })) }),
    });
    if (res.ok) return (await res.json()) as CollectionResponse;
    if (res.status !== 429 || attempt >= 5) {
      throw new Error(`Scryfall ${res.status} for ${ENDPOINT}`);
    }
    await sleep(1000 * 2 ** attempt);
  }
}

async function main(): Promise<void> {
  const names = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map(
      (f) =>
        (
          JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, f), "utf-8")) as {
            name: string;
          }
        ).name,
    )
    .sort((a, b) => a.localeCompare(b));

  // Index results by full name and front-face name: scripts name a
  // double-faced card by its front face.
  const found = new Map<string, CollectionCard>();
  for (let i = 0; i < names.length; i += BATCH) {
    if (i > 0) await sleep(DELAY_MS);
    const { data } = await fetchBatch(names.slice(i, i + BATCH));
    for (const card of data) {
      found.set(card.name, card);
      const front = card.card_faces?.[0]?.name;
      if (front && !found.has(front)) found.set(front, card);
    }
  }

  const cards: ScriptOracleSnapshot["cards"] = {};
  for (const name of names) {
    const card = found.get(name);
    cards[name] = card
      ? {
          standard: card.legalities?.standard === "legal",
          oracle: scryfallOracle(card),
        }
      : { standard: false, oracle: null };
  }

  const standard = JSON.parse(fs.readFileSync(STANDARD_SNAPSHOT, "utf-8")) as {
    cardCount: number;
  };
  const snapshot: ScriptOracleSnapshot & { note: string } = {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    standardCardCount: standard.cardCount,
    note: "Card script name -> Standard legality and current Scryfall oracle text, for script coverage and errata drift in the gap report (#2492). standardCardCount comes from standard-keywords.json. Regenerate with `npx tsx scripts/refresh-card-script-oracle.ts`.",
    cards,
  };
  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");
  const missing = names.filter((n) => cards[n].oracle === null);
  console.info(
    `Wrote ${names.length} card scripts to ${path.relative(process.cwd(), OUT)}` +
      (missing.length ? ` (not found on Scryfall: ${missing.join(", ")})` : ""),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
