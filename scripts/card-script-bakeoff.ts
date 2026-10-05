/**
 * Card-script model bake-off (#2491). Drafts the fixed 50 cards in
 * scripts/data/bakeoff-cards.json with every arm and scores them.
 *
 *   GEMINI_API_KEY=... ZAI_API_KEY=... OPENROUTER_API_KEY=... \
 *     npx tsx scripts/card-script-bakeoff.ts \
 *       --arms "gemini-batch:gemini-3.1-flash-lite,zai:glm-5.3-flash,openrouter:openrouter/free" \
 *       [--out bakeoff-out] [--gemini-batch batches/abc]   # resume a submitted batch
 *
 * An arm whose key is missing is skipped. Nothing is written to the card
 * scripts directory: drafts, replies and token counts land in --out
 * (results.json + report.md) for review. Every call's tokens are logged.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CardScriptSchema,
  type CardScript,
} from "../src/lib/game-state/card-scripts/schema";
import {
  buildPrompt,
  judgeReply,
  type DraftCard,
} from "./card-scripts/draft-lib";
import {
  DEFAULT_PRICES,
  agreement,
  parseArms,
  parseChat,
  renderBakeoffReport,
  scoreArm,
  type Arm,
  type ArmScore,
  type BakeoffList,
  type CardResult,
  type Price,
} from "./card-scripts/bakeoff-lib";
import { runGeminiBatch } from "./card-scripts/gemini-batch";

const ROOT = join(__dirname, "..");
const CARDS_DIR = join(
  ROOT,
  "src",
  "lib",
  "game-state",
  "card-scripts",
  "cards",
);
const LIST = join(ROOT, "scripts", "data", "bakeoff-cards.json");
/** Same few-shot examples as draft-card-scripts.ts; none are in the gold set. */
const EXAMPLES = [
  "Lightning Strike",
  "Dragon Fodder",
  "Vampire Spawn",
  "Ironpaw Aspirant",
  "Shivan Dragon",
  "Vampire Neonate",
];
const UA = {
  "User-Agent": "planar-nexus-card-scripts/1.0",
  Accept: "application/json",
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function scryfallCollection(
  names: readonly string[],
): Promise<DraftCard[]> {
  const out: DraftCard[] = [];
  for (let i = 0; i < names.length; i += 75) {
    const res = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { ...UA, "content-type": "application/json" },
      body: JSON.stringify({
        identifiers: names.slice(i, i + 75).map((name) => ({ name })),
      }),
    });
    if (!res.ok) throw new Error(`Scryfall ${res.status}`);
    const body = (await res.json()) as {
      data: DraftCard[];
      not_found?: unknown[];
    };
    if (body.not_found?.length)
      throw new Error(
        `Scryfall could not find ${JSON.stringify(body.not_found)}`,
      );
    out.push(...body.data);
    await sleep(150);
  }
  return out;
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

function logCall(arm: Arm, name: string, input: number, output: number) {
  console.info(`[${arm.id}] ${name}: ${input} in / ${output} out tokens`);
}

async function chat(
  base: string,
  key: string,
  model: string,
  prompt: string,
  extra: Record<string, unknown> = {},
) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "HTTP-Referer": "https://github.com/anchapin/planar-nexus",
        "X-Title": "planar-nexus card-script bake-off",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        ...extra,
      }),
    });
    if (res.status === 429 && attempt < 3) {
      const text = await res.text();
      // A daily free-model cap won't clear by waiting: give up on this card.
      if (/per-day|daily|free-models-per-day/i.test(text))
        throw new Error(`daily limit: ${text.slice(0, 200)}`);
      await sleep(15_000 * (attempt + 1));
      continue;
    }
    if (!res.ok)
      throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
    return parseChat(await res.json());
  }
}

async function runChatArm(
  arm: Arm,
  cards: readonly DraftCard[],
  prompts: Map<string, string>,
): Promise<CardResult[] | string> {
  const isZai = arm.provider === "zai";
  const key = isZai ? process.env.ZAI_API_KEY : process.env.OPENROUTER_API_KEY;
  if (!key)
    return `skipped: ${isZai ? "ZAI_API_KEY" : "OPENROUTER_API_KEY"} not set`;
  const base = isZai
    ? (process.env.ZAI_BASE_URL ?? "https://api.z.ai/api/paas/v4")
    : "https://openrouter.ai/api/v1";
  // OpenRouter free models allow 20 requests a minute; stay under it.
  const gapMs = isZai ? 0 : 3_500;
  const concurrency = isZai ? 4 : 1;
  const results: CardResult[] = new Array(cards.length);
  let next = 0;
  let dailyCapHit = false;
  const routed = new Map<string, number>();
  async function worker() {
    while (next < cards.length) {
      const i = next++;
      const card = cards[i];
      if (dailyCapHit) {
        results[i] = {
          name: card.name,
          outcome: {
            kind: "error",
            name: card.name,
            error: "daily limit reached earlier in the run",
          },
          usage: { input: 0, output: 0 },
        };
        continue;
      }
      try {
        const reply = await chat(
          base,
          key!,
          arm.model,
          prompts.get(card.name)!,
          isZai ? {} : { temperature: 0 },
        );
        logCall(arm, card.name, reply.usage.input, reply.usage.output);
        if (reply.model)
          routed.set(reply.model, (routed.get(reply.model) ?? 0) + 1);
        results[i] = {
          name: card.name,
          outcome: judgeReply(card, reply.text),
          usage: reply.usage,
        };
      } catch (e) {
        const error = (e as Error).message;
        if (error.startsWith("daily limit")) dailyCapHit = true;
        results[i] = {
          name: card.name,
          outcome: { kind: "error", name: card.name, error },
          usage: { input: 0, output: 0 },
        };
      }
      if (gapMs) await sleep(gapMs);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (routed.size > 1 || arm.model === "openrouter/free") {
    console.info(
      `[${arm.id}] served by: ${[...routed].map(([m, n]) => `${m} x${n}`).join(", ")}`,
    );
  }
  return results;
}

async function runGeminiArm(
  arm: Arm,
  cards: readonly DraftCard[],
  prompts: Map<string, string>,
): Promise<CardResult[] | string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return "skipped: GEMINI_API_KEY not set";
  const batch = await runGeminiBatch({
    model: arm.model,
    prompts: cards.map((c) => prompts.get(c.name)!),
    apiKey: key,
    displayName: `planar-nexus-bakeoff-${Date.now()}`,
    resume: arg("gemini-batch"),
    timeoutMin: Number(process.env.BAKEOFF_GEMINI_TIMEOUT_MIN ?? 100),
    log: (line) => console.info(`[${arm.id}] ${line}`),
  });
  if (!batch.done)
    return `still running: rerun with --gemini-batch ${batch.name}`;
  return cards.map((card, i) => {
    const item = batch.items.get(`card-${i}`);
    if (!item || "error" in item) {
      return {
        name: card.name,
        outcome: {
          kind: "error" as const,
          name: card.name,
          error: item ? item.error : "missing from batch",
        },
        usage: { input: 0, output: 0 },
      };
    }
    logCall(arm, card.name, item.usage.input, item.usage.output);
    return {
      name: card.name,
      outcome: judgeReply(card, item.text),
      usage: item.usage,
    };
  });
}

async function main() {
  const arms = parseArms(
    arg("arms") ??
      process.env.BAKEOFF_ARMS ??
      "gemini-batch:gemini-3.1-flash-lite,zai:glm-5.3-flash,openrouter:openrouter/free",
  );
  const outDir = arg("out") ?? join(ROOT, "bakeoff-out");
  const prices: Record<string, Price> = {
    ...DEFAULT_PRICES,
    ...JSON.parse(process.env.BAKEOFF_PRICES ?? "{}"),
  };
  const list = JSON.parse(readFileSync(LIST, "utf8")) as BakeoffList;
  const own = loadOwnScripts();
  const gold = new Map(
    list.gold.map((n) => {
      const s = own.find((x) => x.name === n);
      if (!s) throw new Error(`gold card ${n} has no script`);
      return [n, s] as const;
    }),
  );
  const examples = EXAMPLES.map((n) => own.find((s) => s.name === n)).filter(
    (s): s is CardScript => !!s,
  );
  const cards = await scryfallCollection([
    ...list.gold,
    ...list.new.map((c) => c.name),
  ]);
  const prompts = new Map(cards.map((c) => [c.name, buildPrompt(c, examples)]));

  const byArm = new Map<string, CardResult[]>();
  const scores: ArmScore[] = [];
  const notes: string[] = [];
  await Promise.all(
    arms.map(async (arm) => {
      const t0 = Date.now();
      try {
        const r =
          arm.provider === "gemini-batch"
            ? await runGeminiArm(arm, cards, prompts)
            : await runChatArm(arm, cards, prompts);
        if (typeof r === "string") {
          notes.push(`${arm.id}: ${r}`);
          return;
        }
        byArm.set(arm.id, r);
        scores.push(
          scoreArm(arm, r, list, gold, prices, (Date.now() - t0) / 1000),
        );
      } catch (e) {
        notes.push(`${arm.id}: failed: ${(e as Error).message}`);
      }
    }),
  );
  scores.sort(
    (a, b) =>
      arms.findIndex((x) => x.id === a.arm) -
      arms.findIndex((x) => x.id === b.arm),
  );
  if (arms.some((a) => a.provider === "gemini-batch"))
    notes.push("Gemini time is batch queue time, not model speed.");
  const report = renderBakeoffReport(
    scores,
    list,
    agreement(
      byArm,
      list.new.map((c) => c.name),
    ),
    notes,
  );
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.md"), report);
  writeFileSync(
    join(outDir, "results.json"),
    JSON.stringify(
      { scores, results: Object.fromEntries(byArm), notes },
      null,
      2,
    ) + "\n",
  );
  console.info(report);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
