/**
 * Card-script model bake-off (#2491): the pure parts, kept free of I/O so they
 * can be unit tested. scripts/card-script-bakeoff.ts is the CLI.
 *
 * Every arm (provider + model) drafts the same fixed 50 cards from
 * scripts/data/bakeoff-cards.json with the same prompt. Gold cards are scored
 * against this repo's hand-written scripts; new cards against the outcome the
 * current op set should produce (a draft, or an honest needs_new_op).
 */
import type { CardScript } from "../../src/lib/game-state/card-scripts/schema";
import type { DraftOutcome } from "./draft-lib";

export type Provider = "gemini-batch" | "zai" | "openrouter";

export interface Arm {
  id: string;
  provider: Provider;
  model: string;
}

export type Expect = "draft" | "needs_new_op" | "either";

export interface BakeoffList {
  gold: string[];
  new: Array<{ name: string; expect: Expect }>;
}

export interface Usage {
  input: number;
  output: number;
}

export interface CardResult {
  name: string;
  outcome: DraftOutcome | { kind: "error"; name: string; error: string };
  usage: Usage;
}

/** USD per 1M tokens. */
export interface Price {
  input: number;
  output: number;
}

/**
 * Approximate list prices (USD per 1M tokens) read from third-party price
 * trackers in October 2026; Gemini figures are the 50%-off Batch rate.
 * Override with BAKEOFF_PRICES='{"model":{"input":x,"output":y}}'.
 */
export const DEFAULT_PRICES: Record<string, Price> = {
  "gemini-3.1-flash-lite": { input: 0.125, output: 0.75 },
  "gemini-3.5-flash-lite": { input: 0.15, output: 1.25 },
  "glm-5.3-flash": { input: 0.15, output: 0.5 },
};

export function priceFor(model: string, prices: Record<string, Price>): Price {
  if (model.endsWith(":free") || model === "openrouter/free")
    return { input: 0, output: 0 };
  return prices[model] ?? { input: NaN, output: NaN };
}

/** Parses "provider:model" specs, e.g. "zai:glm-5.3-flash". */
export function parseArms(spec: string): Arm[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(":");
      if (i < 0) throw new Error(`arm "${s}" must be provider:model`);
      const provider = s.slice(0, i) as Provider;
      if (!["gemini-batch", "zai", "openrouter"].includes(provider)) {
        throw new Error(`unknown provider in arm "${s}"`);
      }
      const model = s.slice(i + 1);
      return { id: `${provider}:${model}`, provider, model };
    });
}

/** Body for POST models/{model}:batchGenerateContent with inline requests. */
export function geminiBatchBody(
  items: ReadonlyArray<{ key: string; prompt: string }>,
  displayName: string,
) {
  return {
    batch: {
      display_name: displayName,
      input_config: {
        requests: {
          requests: items.map((it) => ({
            request: {
              contents: [{ role: "user", parts: [{ text: it.prompt }] }],
              generation_config: { temperature: 0 },
            },
            metadata: { key: it.key },
          })),
        },
      },
    },
  };
}

interface GeminiContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

export type GeminiItem = { text: string; usage: Usage } | { error: string };

/**
 * Reads a finished batch operation. Returns null while it is still running;
 * throws when the job ended without results.
 */
export function parseGeminiBatch(op: unknown): Map<string, GeminiItem> | null {
  const o = (op ?? {}) as {
    done?: boolean;
    metadata?: { state?: string };
    response?: { inlinedResponses?: unknown };
    error?: { message?: string };
  };
  const state = o.metadata?.state;
  if (
    !o.done &&
    state !== "JOB_STATE_SUCCEEDED" &&
    state !== "BATCH_STATE_SUCCEEDED"
  ) {
    if (state && /FAILED|CANCELLED|EXPIRED/.test(state))
      throw new Error(`Gemini batch ${state}`);
    return null;
  }
  if (o.error)
    throw new Error(`Gemini batch error: ${o.error.message ?? "unknown"}`);
  const raw = o.response?.inlinedResponses as unknown;
  const list =
    (Array.isArray(raw)
      ? raw
      : (raw as { inlinedResponses?: unknown[] } | undefined)
          ?.inlinedResponses) ?? [];
  const out = new Map<string, GeminiItem>();
  for (const entry of list as Array<{
    metadata?: { key?: string };
    key?: string;
    response?: GeminiContentResponse;
    error?: { message?: string };
  }>) {
    const key = entry.metadata?.key ?? entry.key;
    if (!key) continue;
    if (entry.error || !entry.response) {
      out.set(key, { error: entry.error?.message ?? "no response" });
      continue;
    }
    const parts = entry.response.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("");
    const u = entry.response.usageMetadata ?? {};
    out.set(key, {
      text,
      usage: {
        input: u.promptTokenCount ?? 0,
        output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      },
    });
  }
  return out;
}

/** Reads an OpenAI-style chat completion (Z.ai, OpenRouter). */
export function parseChat(body: unknown): {
  text: string;
  usage: Usage;
  model?: string;
} {
  const b = (body ?? {}) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
    error?: { message?: string };
  };
  if (b.error) throw new Error(b.error.message ?? "provider error");
  return {
    text: b.choices?.[0]?.message?.content ?? "",
    usage: {
      input: b.usage?.prompt_tokens ?? 0,
      output: b.usage?.completion_tokens ?? 0,
    },
    model: b.model,
  };
}

/** Drops wording fields so two scripts compare on behaviour only. */
export function normalizeScript(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeScript);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      if (k === "name" || k === "oracle" || k === "text") continue;
      out[k] = normalizeScript((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function sameScript(a: CardScript, b: CardScript): boolean {
  return (
    JSON.stringify(normalizeScript(a)) === JSON.stringify(normalizeScript(b))
  );
}

export interface ArmScore {
  arm: string;
  goldExact: number;
  goldDifferent: number;
  goldRefused: number;
  goldInvalid: number;
  newCorrect: number;
  newFalseDraft: number;
  newFalseRefusal: number;
  newInvalid: number;
  errors: number;
  usage: Usage;
  costUsd: number;
  costPer1000Cards: number;
  seconds: number;
}

export function scoreArm(
  arm: Arm,
  results: readonly CardResult[],
  list: BakeoffList,
  gold: ReadonlyMap<string, CardScript>,
  prices: Record<string, Price>,
  seconds: number,
): ArmScore {
  const s: ArmScore = {
    arm: arm.id,
    goldExact: 0,
    goldDifferent: 0,
    goldRefused: 0,
    goldInvalid: 0,
    newCorrect: 0,
    newFalseDraft: 0,
    newFalseRefusal: 0,
    newInvalid: 0,
    errors: 0,
    usage: { input: 0, output: 0 },
    costUsd: 0,
    costPer1000Cards: 0,
    seconds,
  };
  const expect = new Map(list.new.map((c) => [c.name, c.expect]));
  for (const r of results) {
    s.usage.input += r.usage.input;
    s.usage.output += r.usage.output;
    const o = r.outcome;
    if (o.kind === "error") {
      s.errors++;
      continue;
    }
    const g = gold.get(r.name);
    if (g) {
      if (o.kind === "drafted") {
        if (sameScript(o.script, g)) s.goldExact++;
        else s.goldDifferent++;
      } else if (o.kind === "needs_new_op") s.goldRefused++;
      else s.goldInvalid++;
      continue;
    }
    const e = expect.get(r.name) ?? "either";
    if (o.kind === "invalid" || o.kind === "skipped") s.newInvalid++;
    else if (e === "either") s.newCorrect++;
    else if (o.kind === "drafted") {
      if (e === "draft") s.newCorrect++;
      else s.newFalseDraft++;
    } else if (e === "needs_new_op") s.newCorrect++;
    else s.newFalseRefusal++;
  }
  const p = priceFor(arm.model, prices);
  s.costUsd = (s.usage.input * p.input + s.usage.output * p.output) / 1e6;
  s.costPer1000Cards = results.length ? (s.costUsd / results.length) * 1000 : 0;
  return s;
}

/** New cards two or more arms drafted, and whether they drafted the same thing. */
export function agreement(
  byArm: ReadonlyMap<string, readonly CardResult[]>,
  newNames: readonly string[],
) {
  const rows: Array<{ name: string; arms: string[]; agree: boolean }> = [];
  for (const name of newNames) {
    const drafts: Array<[string, CardScript]> = [];
    for (const [arm, results] of byArm) {
      const o = results.find((r) => r.name === name)?.outcome;
      if (o?.kind === "drafted") drafts.push([arm, o.script]);
    }
    if (drafts.length < 2) continue;
    rows.push({
      name,
      arms: drafts.map((d) => d[0]),
      agree: drafts.every((d) => sameScript(d[1], drafts[0][1])),
    });
  }
  return rows;
}

const pct = (n: number, d: number) =>
  d ? `${Math.round((100 * n) / d)}%` : "-";
const usd = (n: number) =>
  Number.isNaN(n) ? "unknown" : `$${n.toFixed(n < 1 ? 4 : 2)}`;

export function renderBakeoffReport(
  scores: readonly ArmScore[],
  list: BakeoffList,
  agree: ReturnType<typeof agreement>,
  notes: readonly string[] = [],
): string {
  const g = list.gold.length;
  const n = list.new.length;
  const lines = [
    "# Card-script model bake-off",
    "",
    `${g} gold cards (scored against hand-written scripts) and ${n} new cards (scored against the expected draft or needs_new_op). Same prompt for every arm.`,
    "",
    "| Arm | Gold exact | New correct | False drafts | Invalid | Errors | Tokens in / out | Cost | Per 1,000 cards | Time |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...scores.map(
      (s) =>
        `| ${s.arm} | ${s.goldExact}/${g} (${pct(s.goldExact, g)}) | ${s.newCorrect}/${n} (${pct(s.newCorrect, n)}) | ${s.newFalseDraft} | ${s.goldInvalid + s.newInvalid} | ${s.errors} | ${s.usage.input.toLocaleString("en-US")} / ${s.usage.output.toLocaleString("en-US")} | ${usd(s.costUsd)} | ${usd(s.costPer1000Cards)} | ${Math.round(s.seconds)}s |`,
    ),
    "",
    "False drafts are the dangerous failure: a script for a card whose abilities the op set can't express, so the card would play wrong.",
    "Gold exact is strict (wording fields ignored, everything else must match). Gold drafts that differ are listed in results.json for review.",
    "",
  ];
  if (agree.length) {
    lines.push(
      `Cross-arm agreement on new cards drafted by two or more arms: ${agree.filter((a) => a.agree).length}/${agree.length}.`,
      "",
    );
  }
  for (const note of notes) lines.push(`- ${note}`);
  return lines.join("\n") + "\n";
}
