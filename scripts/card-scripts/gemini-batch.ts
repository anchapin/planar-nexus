/**
 * Gemini Batch API runner shared by the drafting pipeline and the bake-off
 * (#2491). Submits one inline batch (keys card-0, card-1, ...), then polls
 * until it finishes or the timeout passes. Batch is paid-tier only and costs
 * half the interactive price.
 */
import {
  geminiBatchBody,
  parseGeminiBatch,
  type GeminiItem,
} from "./bakeoff-lib";

export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiBatchResult =
  | { done: true; name: string; items: Map<string, GeminiItem> }
  | { done: false; name: string };

export interface GeminiBatchOptions {
  model: string;
  prompts: readonly string[];
  apiKey: string;
  displayName: string;
  /** An already-submitted batch ("batches/...") to resume instead of submitting. */
  resume?: string;
  timeoutMin: number;
  pollMs?: number;
  log?: (line: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runGeminiBatch(
  opts: GeminiBatchOptions,
): Promise<GeminiBatchResult> {
  const headers = {
    "content-type": "application/json",
    "x-goog-api-key": opts.apiKey,
  };
  let name = opts.resume;
  if (!name) {
    const items = opts.prompts.map((prompt, i) => ({
      key: `card-${i}`,
      prompt,
    }));
    const res = await fetch(
      `${GEMINI_API}/models/${opts.model}:batchGenerateContent`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(geminiBatchBody(items, opts.displayName)),
      },
    );
    if (!res.ok)
      throw new Error(
        `Gemini batch create ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    name = ((await res.json()) as { name: string }).name;
    opts.log?.(`submitted ${name} (resume with --gemini-batch ${name})`);
  }
  const deadline = Date.now() + opts.timeoutMin * 60_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${GEMINI_API}/${name}`, { headers });
    if (!res.ok)
      throw new Error(
        `Gemini batch poll ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    const parsed = parseGeminiBatch(await res.json());
    if (parsed) return { done: true, name, items: parsed };
    await sleep(opts.pollMs ?? 30_000);
  }
  return { done: false, name };
}
