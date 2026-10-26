/**
 * Exports the card-script preference pairs for DPO fine-tuning (#2551,
 * step 2).
 *
 *   npx tsx scripts/export-card-script-preferences.ts \
 *     [--drafts scripts/data/card-script-drafts.json] [--out dataset-out] [--dry-run]
 *
 * Reads a *draft log* — the raw replies a drafting run left behind — and
 * writes one DPO pair per card that has both a good and a bad answer:
 *
 *   <out>/preferences.jsonl
 *
 * The pairs use the same system prompt (the drafting op-set description)
 * and the same user prompt (the oracle text) as the step-1 SFT export
 * (`scripts/export-card-script-dataset.ts`), so the SFT and DPO data agree.
 *
 * The gold set (`scripts/data/bakeoff-cards.json`) never reaches a
 * training pair, and the export fails loudly when a pair is malformed.
 *
 * Data source: the draft log. `scripts/draft-card-scripts.ts` and
 * `scripts/card-script-bakeoff.ts` do not persist raw replies today, so
 * there is no real draft log in the repo yet: until a run writes one, this
 * export has nothing to pair. The output is a local artifact and is not
 * committed (`dataset-out/` is gitignored).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildPreferencePairs,
  checkPreferences,
  parseDraftLog,
  type PreferencePair,
  type SkippedCard,
} from "./card-scripts/preference-lib";
import { buildSystemPrompt } from "./card-scripts/draft-lib";
import { renderJsonl } from "./card-scripts/dataset-lib";

const ROOT = join(__dirname, "..");
const GOLD_LIST = join(ROOT, "scripts", "data", "bakeoff-cards.json");
const DEFAULT_DRAFTS = join(ROOT, "scripts", "data", "card-script-drafts.json");
const DEFAULT_OUT = join(ROOT, "dataset-out");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** The #2514 bake-off gold set: never a training pair. */
export function loadGoldNames(goldList: string): string[] {
  const list = JSON.parse(readFileSync(goldList, "utf8")) as {
    gold?: string[];
  };
  if (!Array.isArray(list.gold)) {
    throw new Error(`${goldList} has no "gold" list`);
  }
  return list.gold;
}

export interface PreferenceExportOptions {
  /** Path of the draft log. */
  draftsFile?: string;
  goldList?: string;
  outDir?: string;
  dryRun?: boolean;
}

export interface PreferenceExportResult {
  outDir: string;
  pairs: PreferencePair[];
  skipped: SkippedCard[];
  preferencesFile: string;
}

/**
 * Builds the preference pairs and writes `preferences.jsonl`. Throws when
 * the draft log is malformed or a pair does not hold up.
 */
export function exportPreferences(
  options: PreferenceExportOptions = {},
): PreferenceExportResult {
  const draftsFile = resolve(options.draftsFile ?? DEFAULT_DRAFTS);
  const goldList = options.goldList ?? GOLD_LIST;
  const outDir = resolve(options.outDir ?? DEFAULT_OUT);
  const dryRun = options.dryRun ?? false;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(draftsFile, "utf8"));
  } catch (e) {
    throw new Error(
      `cannot read the draft log ${draftsFile}: ${(e as Error).message}. ` +
        "A drafting run has to persist its raw replies (see docs/card-scripts.md).",
    );
  }
  const log = parseDraftLog(raw);
  const goldNames = loadGoldNames(goldList);
  const system = buildSystemPrompt();
  const { pairs, skipped } = buildPreferencePairs(log, system, goldNames);

  const problems = checkPreferences(pairs, goldNames);
  if (problems.length) {
    throw new Error(
      `preference check failed:\n  ${problems.slice(0, 20).join("\n  ")}`,
    );
  }

  const preferencesFile = join(outDir, "preferences.jsonl");
  if (!dryRun) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(preferencesFile, pairs.length ? renderJsonl(pairs) : "");
  }
  return { outDir, pairs, skipped, preferencesFile };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = exportPreferences({
    draftsFile: arg("drafts"),
    outDir: arg("out"),
    dryRun,
  });
  console.info(
    `preference pairs: ${result.pairs.length} (${result.skipped.length} cards skipped)`,
  );
  for (const skip of result.skipped) {
    console.info(`  skipped ${skip.name}: ${skip.reason}`);
  }
  console.info(`preferences: ${result.preferencesFile}`);
  if (dryRun) console.info("dry run: nothing written");
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
