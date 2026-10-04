/**
 * Drafts card scripts for a Standard set (or a card list) with an LLM (#2491).
 *
 *   DRAFT_LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... DRAFT_LLM_MODEL=<model> \
 *     npx tsx scripts/draft-card-scripts.ts --set dsk [--limit 20] [--dry-run]
 *   ... --cards "Helpful Hunter;Shivan Dragon"
 *
 * Providers: anthropic (ANTHROPIC_API_KEY), openai (OPENAI_API_KEY, optional
 * OPENAI_BASE_URL for any OpenAI-compatible server such as Ollama).
 *
 * Schema-valid drafts are written to src/lib/game-state/card-scripts/cards/,
 * the index is rebuilt, and a report goes to docs/card-scripts/drafts/.
 * Nothing merges unreviewed: open the result as a PR.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CardScriptSchema, type CardScript } from "../src/lib/game-state/card-scripts/schema";
import {
  buildPrompt,
  judgeReply,
  renderReport,
  scriptFileName,
  skipReason,
  type DraftCard,
  type DraftOutcome,
} from "./card-scripts/draft-lib";

const ROOT = join(__dirname, "..");
const CARDS_DIR = join(ROOT, "src", "lib", "game-state", "card-scripts", "cards");
const REPORT_DIR = join(ROOT, "docs", "card-scripts", "drafts");
const UA = { "User-Agent": "planar-nexus-card-scripts/1.0", Accept: "application/json" };
/** Our own scripts used as few-shot examples, covering each ability shape. */
const EXAMPLES = ["Lightning Strike", "Dragon Fodder", "Vampire Spawn", "Ironpaw Aspirant", "Shivan Dragon", "Vampire Neonate"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function scryfall(query: string): Promise<DraftCard[]> {
  const out: DraftCard[] = [];
  let url: string | null =
    "https://api.scryfall.com/cards/search?" + new URLSearchParams({ q: query, unique: "cards", order: "set" });
  while (url) {
    const res: Response = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`Scryfall ${res.status} for ${query}`);
    const page = (await res.json()) as { data: DraftCard[]; next_page?: string };
    out.push(...page.data);
    url = page.next_page ?? null;
    await sleep(120);
  }
  return out;
}

async function loadCards(): Promise<{ title: string; cards: DraftCard[] }> {
  const set = arg("set");
  const list = arg("cards");
  if (set) return { title: set.toUpperCase(), cards: await scryfall(`set:${set} f:standard`) };
  if (list) {
    const cards: DraftCard[] = [];
    for (const name of list.split(";").map((s) => s.trim()).filter(Boolean)) {
      const res = await fetch("https://api.scryfall.com/cards/named?" + new URLSearchParams({ exact: name }), { headers: UA });
      if (!res.ok) throw new Error(`Scryfall ${res.status} for ${name}`);
      cards.push((await res.json()) as DraftCard);
      await sleep(120);
    }
    return { title: "card list", cards };
  }
  throw new Error("pass --set <code> or --cards \"Name;Name\"");
}

function loadOwnScripts(): CardScript[] {
  return readdirSync(CARDS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => CardScriptSchema.parse(JSON.parse(readFileSync(join(CARDS_DIR, f), "utf8"))));
}

async function complete(prompt: string): Promise<string> {
  const provider = process.env.DRAFT_LLM_PROVIDER ?? "anthropic";
  const model = process.env.DRAFT_LLM_MODEL;
  if (!model) throw new Error("set DRAFT_LLM_MODEL");
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("set ANTHROPIC_API_KEY");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1500, temperature: 0, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { content: Array<{ type: string; text?: string }> };
    return body.content.map((c) => c.text ?? "").join("");
  }
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY ?? "";
    const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, temperature: 0, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return body.choices[0]?.message.content ?? "";
  }
  throw new Error(`unknown DRAFT_LLM_PROVIDER ${provider}`);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limit = Number(arg("limit") ?? Infinity);
  const { title, cards } = await loadCards();
  const own = loadOwnScripts();
  const scripted = new Set(own.map((s) => s.name.toLowerCase()));
  const examples = EXAMPLES.map((n) => own.find((s) => s.name === n)).filter((s): s is CardScript => !!s);

  const outcomes: DraftOutcome[] = [];
  let drafted = 0;
  for (const card of cards) {
    const reason = skipReason(card, scripted);
    if (reason) {
      outcomes.push({ kind: "skipped", name: card.name, reason });
      continue;
    }
    if (drafted >= limit) {
      outcomes.push({ kind: "skipped", name: card.name, reason: "over --limit" });
      continue;
    }
    drafted++;
    const prompt = buildPrompt(card, examples);
    if (dryRun) {
      outcomes.push({ kind: "skipped", name: card.name, reason: "dry run" });
      continue;
    }
    let outcome: DraftOutcome;
    try {
      outcome = judgeReply(card, await complete(prompt));
    } catch (e) {
      outcome = { kind: "invalid", name: card.name, errors: [(e as Error).message] };
    }
    outcomes.push(outcome);
    console.info(`${outcome.kind.padEnd(12)} ${card.name}`);
    if (outcome.kind === "drafted") {
      writeFileSync(join(CARDS_DIR, scriptFileName(card.name)), JSON.stringify(outcome.script, null, 2) + "\n");
    }
  }

  const report = renderReport(title, outcomes);
  mkdirSync(REPORT_DIR, { recursive: true });
  const reportFile = join(REPORT_DIR, `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`);
  writeFileSync(reportFile, report);
  if (!dryRun) execFileSync("npx", ["tsx", join(ROOT, "scripts", "build-card-script-index.ts")], { stdio: "inherit" });
  console.info(`report: ${reportFile}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
