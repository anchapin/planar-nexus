#!/usr/bin/env node
/**
 * Refresh `scripts/data/standard-keywords.json` from Scryfall (#2360).
 *
 * The gameplay gap report scopes keyword enforcement to Standard (epic #2300):
 * a keyword is in scope when at least one Standard-legal card carries it. This
 * script pages through `legal:standard` on Scryfall and records, per keyword,
 * how many Standard-legal cards have it (union of `keywords` across faces).
 *
 * The snapshot is committed so the report is deterministic and runs offline.
 * Re-run after a set release or rotation:
 *
 *   npx tsx scripts/refresh-standard-keywords.ts
 */

import * as fs from "fs";
import * as path from "path";

interface ScryfallCard {
  keywords?: string[];
  card_faces?: { keywords?: string[] }[];
}

interface ScryfallPage {
  data: ScryfallCard[];
  has_more: boolean;
  next_page?: string;
  total_cards: number;
}

const OUT = path.resolve(__dirname, "data", "standard-keywords.json");
const SOURCE =
  "https://api.scryfall.com/cards/search?q=legal%3Astandard&unique=cards";
// Scryfall asks for 50-100ms between requests.
const DELAY_MS = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const counts = new Map<string, number>();
  let cardCount = 0;
  let url: string | undefined = SOURCE;

  while (url) {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "planar-nexus-gap-report/1.0",
      },
    });
    if (!res.ok) {
      throw new Error(`Scryfall ${res.status} for ${url}`);
    }
    const page = (await res.json()) as ScryfallPage;
    for (const card of page.data) {
      cardCount++;
      const keywords = new Set<string>(
        [
          ...(card.keywords ?? []),
          ...(card.card_faces ?? []).flatMap((f) => f.keywords ?? []),
        ].map((k) => k.toLowerCase()),
      );
      for (const k of keywords) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    url = page.has_more ? page.next_page : undefined;
    if (url) await sleep(DELAY_MS);
  }

  const keywords = Object.fromEntries(
    [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
  const snapshot = {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    source: SOURCE,
    cardCount,
    note: "Keyword -> number of Standard-legal cards carrying it (Scryfall `keywords`, all faces). Regenerate with `npx tsx scripts/refresh-standard-keywords.ts`.",
    keywords,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");
  console.info(
    `Wrote ${counts.size} keywords from ${cardCount} Standard-legal cards to ${path.relative(process.cwd(), OUT)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
