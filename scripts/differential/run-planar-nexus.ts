#!/usr/bin/env tsx
/**
 * Run every differential scenario through the planar-nexus engine (#2411).
 *
 *   npx tsx scripts/differential/run-planar-nexus.ts [scenario.json ...]
 *     [--out outcomes.json] [--compare other-engine-outcomes.json]
 *     [--refresh-cards]
 *
 * Card data comes from scripts/differential/cards.snapshot.json. With
 * --refresh-cards, any card a scenario names that is missing from the
 * snapshot is fetched from Scryfall (exact name) and the snapshot rewritten.
 *
 * Prints one row per scenario: match, mismatch (with fields) or couldn't
 * express. Without --compare, rows are against each scenario's rules-derived
 * `expect` block; with it, against another engine's outcome file.
 */
import * as fs from "fs";
import * as path from "path";
import { runScenario, type CardLookup } from "./planar-nexus-runner";
import { diffExpected, diffOutcomes, formatRows } from "./diff";
import { scenarioCardNames, type Scenario } from "./scenario";
import type { ScryfallCard } from "../../src/lib/game-state/types";

const DIR = __dirname;
const SNAPSHOT = path.join(DIR, "cards.snapshot.json");
const SCENARIO_DIR = path.join(DIR, "scenarios");

/** Fields the engine reads; everything else is dropped from the snapshot. */
const KEEP = [
  "id",
  "oracle_id",
  "name",
  "mana_cost",
  "cmc",
  "type_line",
  "oracle_text",
  "power",
  "toughness",
  "loyalty",
  "colors",
  "color_identity",
  "keywords",
  "produced_mana",
  "layout",
  "card_faces",
  "legalities",
] as const;

export function loadScenarios(files: string[]): Scenario[] {
  const list =
    files.length > 0
      ? files
      : fs
          .readdirSync(SCENARIO_DIR)
          .filter((f) => f.endsWith(".json"))
          .sort()
          .map((f) => path.join(SCENARIO_DIR, f));
  return list.map((f) => JSON.parse(fs.readFileSync(f, "utf-8")) as Scenario);
}

export function loadSnapshot(): CardLookup {
  if (!fs.existsSync(SNAPSHOT)) return {};
  return JSON.parse(fs.readFileSync(SNAPSHOT, "utf-8")) as CardLookup;
}

async function fetchCard(name: string): Promise<ScryfallCard> {
  const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`;
  // eslint-disable-next-line no-restricted-syntax -- dev-only script reading public Scryfall card data
  const res = await fetch(url, {
    headers: {
      "User-Agent": "planar-nexus-differential/0.1",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Scryfall ${res.status} for "${name}"`);
  const full = (await res.json()) as Record<string, unknown>;
  const slim: Record<string, unknown> = {};
  for (const k of KEEP) if (full[k] !== undefined) slim[k] = full[k];
  return slim as unknown as ScryfallCard;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = flag("--out");
  const compare = flag("--compare");
  const refresh = args.includes("--refresh-cards");
  const files = args.filter(
    (a, i) =>
      a.endsWith(".json") &&
      !["--out", "--compare"].includes(args[i - 1] ?? ""),
  );

  const scenarios = loadScenarios(files);
  const cards = loadSnapshot();
  const missing = [...new Set(scenarios.flatMap(scenarioCardNames))].filter(
    (n) => !cards[n],
  );
  if (missing.length > 0 && refresh) {
    for (const name of missing) {
      cards[name] = await fetchCard(name);
      await new Promise((r) => setTimeout(r, 100)); // Scryfall asks for 50-100ms
    }
    const sorted = Object.fromEntries(
      Object.entries(cards).sort(([a], [b]) => a.localeCompare(b)),
    );
    fs.writeFileSync(SNAPSHOT, JSON.stringify(sorted, null, 2) + "\n");
  } else if (missing.length > 0) {
    console.error(
      `missing card data (run with --refresh-cards): ${missing.join(", ")}`,
    );
  }

  const outcomes = scenarios.map((s) => runScenario(s, cards));
  const json = JSON.stringify(outcomes, null, 2);
  if (out) fs.writeFileSync(out, json + "\n");
  else process.stdout.write(json + "\n");
  let rows;
  if (compare) {
    const other = JSON.parse(
      fs.readFileSync(compare, "utf-8"),
    ) as typeof outcomes;
    rows = outcomes.map((o) => {
      const match = other.find((x) => x.scenario === o.scenario);
      return match
        ? diffOutcomes(o, match)
        : {
            scenario: o.scenario,
            verdict: "couldn't express" as const,
            differences: [`no outcome in ${compare}`],
          };
    });
  } else {
    rows = scenarios.map((s, i) => diffExpected(s, outcomes[i]));
  }
  console.error(formatRows(rows));
  for (const o of outcomes) {
    for (const e of o.errors) console.error(`note ${o.scenario}: ${e}`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
