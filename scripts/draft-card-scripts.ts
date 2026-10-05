/**
 * Drafts card scripts for a Standard set (or a card list) with an LLM (#2491).
 *
 *   GEMINI_API_KEY=... npx tsx scripts/draft-card-scripts.ts --set dsk [--limit 20] [--dry-run]
 *   ... --cards "Helpful Hunter;Shivan Dragon"
 *   ... --gemini-batch batches/abc   # resume a batch that outlived the timeout
 *
 * Providers (DRAFT_LLM_PROVIDER): gemini-batch, the default, picked by the
 * bake-off (#2514): one Gemini Batch API job for the whole set, model
 * DRAFT_LLM_MODEL (default gemini-3.1-flash-lite), GEMINI_API_KEY.
 * anthropic (ANTHROPIC_API_KEY) and openai (OPENAI_API_KEY, optional
 * OPENAI_BASE_URL for any OpenAI-compatible server such as Ollama) call one
 * card at a time and need DRAFT_LLM_MODEL.
 *
 * Schema-valid drafts are written to src/lib/game-state/card-scripts/cards/,
 * the index is rebuilt, and a report goes to docs/card-scripts/drafts/.
 * Nothing merges unreviewed: open the result as a PR.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CardScriptSchema,
  type CardScript,
} from "../src/lib/game-state/card-scripts/schema";
import { runGeminiBatch } from "./card-scripts/gemini-batch";
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
const CARDS_DIR = join(
  ROOT,
  "src",
  "lib",
  "game-state",
  "card-scripts",
  "cards",
);
const REPORT_DIR = join(ROOT, "docs", "card-scripts", "drafts");
const UA = {
  "User-Agent": "planar-nexus-card-scripts/1.0",
  Accept: "application/json",
};
/** Our own scripts used as few-shot examples, covering each ability shape. */
const EXAMPLES = [
  "Lightning Strike",
  "Dragon Fodder",
  "Vampire Spawn",
  "Ironpaw Aspirant",
  "Shivan Dragon",
  "Vampire Neonate",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function scryfall(query: string): Promise<DraftCard[]> {
  const out: DraftCard[] = [];
  let url: string | null =
    "https://api.scryfall.com/cards/search?" +
    new URLSearchParams({ q: query, unique: "cards", order: "set" });
  while (url) {
    const res: Response = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`Scryfall ${res.status} for ${query}`);
    const page = (await res.json()) as {
      data: DraftCard[];
      next_page?: string;
    };
    out.push(...page.data);
    url = page.next_page ?? null;
    await sleep(120);
  }
  return out;
}

async function loadCards(): Promise<{ title: string; cards: DraftCard[] }> {
  const set = arg("set");
  const list = arg("cards");
  if (set)
    return {
      title: set.toUpperCase(),
      cards: await scryfall(`set:${set} f:standard`),
    };
  if (list) {
    const cards: DraftCard[] = [];
    for (const name of list
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const res = await fetch(
        "https://api.scryfall.com/cards/named?" +
          new URLSearchParams({ exact: name }),
        { headers: UA },
      );
      if (!res.ok) throw new Error(`Scryfall ${res.status} for ${name}`);
      cards.push((await res.json()) as DraftCard);
      await sleep(120);
    }
    return { title: "card list", cards };
  }
  throw new Error('pass --set <code> or --cards "Name;Name"');
}

function loadOwnScripts(): CardScript[] {
  return readdirSync(CARDS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) =>
      CardScriptSchema.parse(
        JSON.parse(readFileSync(join(CARDS_DIR, f), "utf8")),
      ),
    );
}

const PROVIDER = process.env.DRAFT_LLM_PROVIDER ?? "gemini-batch";
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

async function complete(prompt: string): Promise<string> {
  const provider = PROVIDER;
  const model = process.env.DRAFT_LLM_MODEL;
  if (!model) throw new Error("set DRAFT_LLM_MODEL");
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("set ANTHROPIC_API_KEY");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok)
      throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    return body.content.map((c) => c.text ?? "").join("");
  }
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY ?? "";
    const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return body.choices[0]?.message.content ?? "";
  }
  throw new Error(`unknown DRAFT_LLM_PROVIDER ${provider}`);
}

type Queued = { card: DraftCard; prompt: string };

/** Replies for every queued card, in order: a string, or an Error for that card. */
async function draftAll(
  queue: readonly Queued[],
  title: string,
): Promise<Array<string | Error>> {
  if (PROVIDER !== "gemini-batch") {
    const out: Array<string | Error> = [];
    for (const q of queue) {
      try {
        out.push(await complete(q.prompt));
      } catch (e) {
        out.push(e as Error);
      }
    }
    return out;
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("set GEMINI_API_KEY");
  const model = process.env.DRAFT_LLM_MODEL || DEFAULT_GEMINI_MODEL;
  const batch = await runGeminiBatch({
    model,
    prompts: queue.map((q) => q.prompt),
    apiKey,
    displayName: `planar-nexus-drafts-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
    resume: arg("gemini-batch") || process.env.DRAFT_GEMINI_BATCH || undefined,
    timeoutMin: Number(process.env.DRAFT_GEMINI_TIMEOUT_MIN ?? 150),
    log: (line) => console.info(`[gemini ${model}] ${line}`),
  });
  if (!batch.done) {
    throw new Error(
      `Gemini batch ${batch.name} is still running: rerun with --gemini-batch ${batch.name} (same set and --limit)`,
    );
  }
  let input = 0;
  let output = 0;
  const replies = queue.map((_, i) => {
    const item = batch.items.get(`card-${i}`);
    if (!item) return new Error("missing from batch");
    if ("error" in item) return new Error(item.error);
    input += item.usage.input;
    output += item.usage.output;
    return item.text;
  });
  console.info(`[gemini ${model}] ${input} input / ${output} output tokens`);
  return replies;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limit = Number(arg("limit") ?? Infinity);
  const { title, cards } = await loadCards();
  const own = loadOwnScripts();
  const scripted = new Set(own.map((s) => s.name.toLowerCase()));
  const examples = EXAMPLES.map((n) => own.find((s) => s.name === n)).filter(
    (s): s is CardScript => !!s,
  );

  const outcomes: DraftOutcome[] = [];
  const queue: Queued[] = [];
  for (const card of cards) {
    const reason = skipReason(card, scripted);
    if (reason) {
      outcomes.push({ kind: "skipped", name: card.name, reason });
      continue;
    }
    if (queue.length >= limit) {
      outcomes.push({
        kind: "skipped",
        name: card.name,
        reason: "over --limit",
      });
      continue;
    }
    const prompt = buildPrompt(card, examples);
    if (dryRun) {
      outcomes.push({ kind: "skipped", name: card.name, reason: "dry run" });
      continue;
    }
    queue.push({ card, prompt });
  }

  const replies = queue.length ? await draftAll(queue, title) : [];
  queue.forEach(({ card }, i) => {
    const reply = replies[i];
    const outcome: DraftOutcome =
      reply instanceof Error || reply === undefined
        ? {
            kind: "invalid",
            name: card.name,
            errors: [reply?.message ?? "no reply"],
          }
        : judgeReply(card, reply);
    outcomes.push(outcome);
    console.info(`${outcome.kind.padEnd(12)} ${card.name}`);
    if (outcome.kind === "drafted") {
      writeFileSync(
        join(CARDS_DIR, scriptFileName(card.name)),
        JSON.stringify(outcome.script, null, 2) + "\n",
      );
    }
  });

  const report = renderReport(title, outcomes);
  mkdirSync(REPORT_DIR, { recursive: true });
  const reportFile = join(
    REPORT_DIR,
    `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`,
  );
  writeFileSync(reportFile, report);
  if (!dryRun)
    execFileSync(
      "npx",
      ["tsx", join(ROOT, "scripts", "build-card-script-index.ts")],
      { stdio: "inherit" },
    );
  console.info(`report: ${reportFile}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
