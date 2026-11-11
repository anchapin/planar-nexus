/**
 * Exports the card-script fine-tuning dataset (#2551, step 1).
 *
 *   npx tsx scripts/export-card-script-dataset.ts [--out dataset-out] [--dry-run]
 *
 * Reads every accepted card script under
 * `src/lib/game-state/card-scripts/cards/`, turns each one into an ETF
 * record (system = the drafting prompt's op-set description, user = the
 * oracle text, assistant = the drafting reply `{"script": {...}}`) and
 * writes two files:
 *
 *   <out>/train.jsonl   every script except the whole #2514 bake-off set
 *                       (the gold set and the 'new' set)
 *   <out>/eval.jsonl    the #2514 bake-off gold set (20 hand-scripted cards)
 *
 * The bake-off card list comes from `scripts/data/bakeoff-cards.json` — the
 * same list the bake-off scores against — so a fine-tuned model is evaluated
 * on cards it has never been trained on. The export fails loudly if any
 * bake-off card (gold or new) reaches the training file or a record is
 * malformed.
 *
 * The dataset is a local artifact: it is not committed (see .gitignore).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CardScriptSchema,
  type CardScript,
} from "../src/lib/game-state/card-scripts/schema";
import {
  buildDataset,
  checkDataset,
  parseBakeoffNames,
  renderJsonl,
  type BakeoffNames,
  type Dataset,
} from "./card-scripts/dataset-lib";
import { buildSystemPrompt } from "./card-scripts/draft-lib";

const ROOT = join(__dirname, "..");
const CARDS_DIR = join(
  ROOT,
  "src",
  "lib",
  "game-state",
  "card-scripts",
  "cards",
);
const GOLD_LIST = join(ROOT, "scripts", "data", "bakeoff-cards.json");
const DEFAULT_OUT = join(ROOT, "dataset-out");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Every accepted card script, parsed with the schema the engine uses. */
export function loadCardScripts(cardsDir: string): CardScript[] {
  return readdirSync(cardsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) =>
      CardScriptSchema.parse(
        JSON.parse(readFileSync(join(cardsDir, f), "utf8")),
      ),
    );
}

/**
 * The #2514 bake-off card list: the gold set (the eval split) and the
 * 'new' set (the bake-off cards this repo has no script for). Both sets
 * are held out of the training split (#2915).
 */
export function loadBakeoffNames(goldList: string): BakeoffNames {
  const raw = JSON.parse(readFileSync(goldList, "utf8")) as unknown;
  return parseBakeoffNames(raw);
}

export interface ExportOptions {
  cardsDir?: string;
  goldList?: string;
  outDir?: string;
  dryRun?: boolean;
}

export interface ExportResult {
  outDir: string;
  dataset: Dataset;
  trainFile: string;
  evalFile: string;
}

/**
 * Builds the dataset and writes the two ETF files. Throws when a bake-off
 * card (gold or new) leaked into the training split, when a bake-off 'new'
 * card has an accepted script (the 'new' set must measure unscripted
 * cards), or when a record does not hold up.
 */
export function exportDataset(options: ExportOptions = {}): ExportResult {
  const cardsDir = options.cardsDir ?? CARDS_DIR;
  const goldList = options.goldList ?? GOLD_LIST;
  const outDir = resolve(options.outDir ?? DEFAULT_OUT);
  const dryRun = options.dryRun ?? false;

  const scripts = loadCardScripts(cardsDir);
  const bakeoff = loadBakeoffNames(goldList);
  const goldNames = bakeoff.gold;
  const system = buildSystemPrompt();
  const dataset = buildDataset(scripts, goldNames, system, bakeoff.new);

  const problems = checkDataset(dataset, bakeoff);
  if (problems.length) {
    throw new Error(
      `dataset check failed:\n  ${problems.slice(0, 20).join("\n  ")}`,
    );
  }
  if (dataset.eval.length !== goldNames.length) {
    throw new Error(
      `gold set has ${goldNames.length} cards but only ${dataset.eval.length} are scripted`,
    );
  }
  // The bake-off 'new' set measures unscripted cards: a 'new' card with an
  // accepted script would be trained on and could no longer be scored as
  // "new". Fail loudly instead of quietly dropping it from train (#2915).
  const scripted = new Set(scripts.map((s) => s.name.trim().toLowerCase()));
  const scriptedNew = bakeoff.new.filter((n) =>
    scripted.has(n.trim().toLowerCase()),
  );
  if (scriptedNew.length) {
    throw new Error(
      `bake-off 'new' cards must be unscripted, but these have an accepted ` +
        `script: ${scriptedNew.join(", ")}`,
    );
  }

  const trainFile = join(outDir, "train.jsonl");
  const evalFile = join(outDir, "eval.jsonl");
  if (!dryRun) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(trainFile, renderJsonl(dataset.train));
    writeFileSync(evalFile, renderJsonl(dataset.eval));
  }
  return { outDir, dataset, trainFile, evalFile };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = exportDataset({ outDir: arg("out"), dryRun });
  const { dataset } = result;
  console.info(
    `card scripts: ${dataset.train.length} training pairs, ${dataset.eval.length} held-out gold pairs`,
  );
  console.info(`train: ${result.trainFile}`);
  console.info(`eval:  ${result.evalFile}`);
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
