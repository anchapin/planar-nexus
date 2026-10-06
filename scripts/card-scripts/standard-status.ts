#!/usr/bin/env node
/**
 * Standard card coverage snapshot (epic #2487).
 *
 * For every Standard-legal card (Scryfall `legal:standard`), bucket it into:
 *   - scripted: a card script exists under src/lib/game-state/card-scripts/cards/
 *   - basic_land: a basic land (Plains, Island, Swamp, Mountain, Forest, Wastes)
 *   - vanilla: no rules text and no keywords on any face
 *   - keyword_only: every non-blank line of oracle text (after stripping reminder
 *     text in parentheses) is exactly one of the card's own `keywords`, so the
 *     engine can resolve it from the card itself with no script
 *   - unscripted: anything else
 *
 * Writes reports/standard-status.json and prints the counts. The scoreboard for
 * every later phase lives in this file.
 *
 *   npx tsx scripts/card-scripts/standard-status.ts
 *
 * Re-run after any set release or rotation (Scryfall `legal:standard` shifts).
 * Refresh with --fresh to ignore the 24-hour cache; the script pages through
 * `legal:standard` so it costs ~30 pages and ~3.6s of Scryfall calls.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const CARDS_DIR = join(
  ROOT,
  "src",
  "lib",
  "game-state",
  "card-scripts",
  "cards",
);
const REPORT_DIR = join(ROOT, "reports");
const OUT = join(REPORT_DIR, "standard-status.json");
const CACHE = join(ROOT, "scripts", "data", "standard-cards-cache.json");
const UA = {
  "User-Agent": "planar-nexus-standard-status/1.0",
  Accept: "application/json",
};
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const BASIC_LANDS = new Set([
  "Plains",
  "Island",
  "Swamp",
  "Mountain",
  "Forest",
  "Wastes",
  "Snow-Covered Plains",
  "Snow-Covered Island",
  "Snow-Covered Swamp",
  "Snow-Covered Mountain",
  "Snow-Covered Forest",
]);

interface ScryfallFace {
  name?: string;
  oracle_text?: string;
  keywords?: string[];
  mana_cost?: string;
}

interface ScryfallCard {
  name: string;
  layout: string;
  type_line: string;
  oracle_text?: string;
  card_faces?: ScryfallFace[];
  keywords?: string[];
  legalities?: Record<string, string>;
  set?: string;
  set_type?: string;
}

interface StatusCard {
  name: string;
  bucket: "scripted" | "basic_land" | "vanilla" | "keyword_only" | "unscripted";
  set?: string;
  layout?: string;
  type_line?: string;
  reason?: string;
}

interface StatusReport {
  generatedAt: string;
  totalStandard: number;
  counts: Record<StatusCard["bucket"], number>;
  perSet: Record<string, Record<StatusCard["bucket"], number>>;
  cards: StatusCard[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function fetchStandardCards(): Promise<ScryfallCard[]> {
  if (
    !process.argv.includes("--fresh") &&
    existsSync(CACHE) &&
    Date.now() -
      new Date(readFileSync(CACHE, "utf-8").split("\n")[0]).getTime() <
      CACHE_TTL_MS
  ) {
    const raw = readFileSync(CACHE, "utf-8");
    const nl = raw.indexOf("\n");
    return JSON.parse(raw.slice(nl + 1)) as ScryfallCard[];
  }
  const out: ScryfallCard[] = [];
  let url: string | null =
    "https://api.scryfall.com/cards/search?" +
    new URLSearchParams({ q: "legal:standard", unique: "cards", order: "set" });
  while (url) {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`Scryfall ${res.status} for ${url}`);
    const page = res.json() as unknown as Promise<{
      data: ScryfallCard[];
      next_page?: string;
    }>;
    const data = await page;
    out.push(...data.data);
    url = data.next_page ?? null;
    if (url) await sleep(120);
  }
  mkdirSync(join(ROOT, "scripts", "data"), { recursive: true });
  writeFileSync(
    CACHE,
    `${new Date().toISOString()}\n${JSON.stringify(out, null, 2)}\n`,
  );
  return out;
}

function joinFaces(card: ScryfallCard): {
  oracle: string;
  keywords: string[];
} {
  if (card.card_faces && card.card_faces.length > 0) {
    const oracle = card.card_faces
      .map((f) => f.oracle_text ?? "")
      .filter((t) => t.length > 0)
      .join("\n//\n");
    const keywords = new Set<string>();
    for (const f of card.card_faces)
      for (const k of f.keywords ?? []) keywords.add(k);
    return { oracle, keywords: [...keywords] };
  }
  return {
    oracle: card.oracle_text ?? "",
    keywords: [...(card.keywords ?? [])],
  };
}

function isKeywordOnly(oracle: string, keywords: string[]): boolean {
  // Strip reminder text in parentheses (CR 101.2) and discard blank lines.
  // Each printed line is either a comma-joined list of keywords ("Flying,
  // vigilance") or a single keyword action like "Crew 1". We test each line:
  // split by commas, then for each fragment split off a trailing cost
  // ("{N}", "N", or "—cost") and check the keyword head is registered.
  const lines = oracle
    .replace(/\([^)]*\)/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return false;
  const kwLower = new Set(keywords.map((k) => k.toLowerCase()));
  for (const line of lines) {
    const parts = line
      .split(/,\s*/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    for (const part of parts) {
      // Strip a trailing keyword action cost (Crew 1, Equip {3}, Suspend 2—{U}).
      // The head is one of the card's keywords; everything after the first
      // run of {N} / digits / em-dash costs is a cost or reminder, not text.
      const head = part
        .replace(/(\{[^}]+\}|\d+|—.*)$/, "")
        .trim()
        .toLowerCase();
      if (!kwLower.has(head)) return false;
    }
  }
  return true;
}

function bucket(card: ScryfallCard, scripted: ReadonlySet<string>): StatusCard {
  const base: StatusCard = {
    name: card.name,
    set: card.set,
    layout: card.layout,
    type_line: card.type_line,
    bucket: "unscripted",
  };
  if (scripted.has(card.name.toLowerCase())) {
    return { ...base, bucket: "scripted" };
  }
  if (BASIC_LANDS.has(card.name)) {
    return { ...base, bucket: "basic_land" };
  }
  const { oracle, keywords } = joinFaces(card);
  if (!oracle && keywords.length === 0) {
    return { ...base, bucket: "vanilla" };
  }
  if (isKeywordOnly(oracle, keywords)) {
    return { ...base, bucket: "keyword_only" };
  }
  return base;
}

async function main() {
  const cards = await fetchStandardCards();
  const scripted = new Set(
    readdirSync(CARDS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) =>
        (
          JSON.parse(readFileSync(join(CARDS_DIR, f), "utf-8")) as {
            name: string;
          }
        ).name.toLowerCase(),
      ),
  );
  const report: StatusReport = {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    totalStandard: cards.length,
    counts: {
      scripted: 0,
      basic_land: 0,
      vanilla: 0,
      keyword_only: 0,
      unscripted: 0,
    },
    perSet: {},
    cards: [],
  };
  for (const c of cards) {
    const entry = bucket(c, scripted);
    report.cards.push(entry);
    report.counts[entry.bucket]++;
    const setKey = (c.set ?? "unknown").toUpperCase();
    if (!report.perSet[setKey]) {
      report.perSet[setKey] = {
        scripted: 0,
        basic_land: 0,
        vanilla: 0,
        keyword_only: 0,
        unscripted: 0,
      };
    }
    report.perSet[setKey][entry.bucket]++;
  }
  report.cards.sort((a, b) => a.name.localeCompare(b.name));
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
  const pct = (n: number) =>
    cards.length === 0 ? "0.0" : ((n / cards.length) * 100).toFixed(1);
  console.info(`Standard card coverage (epic #2487)`);
  console.info(`  total Standard:  ${cards.length}`);
  console.info(
    `  scripted:        ${report.counts.scripted} (${pct(report.counts.scripted)}%)`,
  );
  console.info(
    `  basic_land:      ${report.counts.basic_land} (${pct(report.counts.basic_land)}%)`,
  );
  console.info(
    `  vanilla:         ${report.counts.vanilla} (${pct(report.counts.vanilla)}%)`,
  );
  console.info(
    `  keyword_only:    ${report.counts.keyword_only} (${pct(report.counts.keyword_only)}%)`,
  );
  console.info(
    `  unscripted:      ${report.counts.unscripted} (${pct(report.counts.unscripted)}%)`,
  );
  const working =
    report.counts.scripted +
    report.counts.basic_land +
    report.counts.vanilla +
    report.counts.keyword_only;
  console.info(
    `  working:         ${working} (${pct(working)}%) = scripted + basic + vanilla + keyword_only`,
  );
  console.info(`  report: ${OUT}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
