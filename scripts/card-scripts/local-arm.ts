/**
 * The `local` arm of the card-script bake-off (#2886): an OpenAI-compatible
 * server running the fine-tuned SFT adapter (vLLM, Ollama, llama.cpp, ...).
 *
 * The arm speaks the same chat-completions shape as the hosted chat arms
 * (`scripts/draft-card-scripts.ts` reaches such a server through
 * OPENAI_BASE_URL), so the prompt, the judging and the scoring stay exactly
 * the same. Two differences:
 *
 * - No API key is required. A key is only sent when one is configured
 *   (LOCAL_BAKEOFF_API_KEY), for servers started with an auth token.
 * - The API cost is $0: it is our own hardware. `priceForArm` in
 *   bakeoff-lib.ts turns that into a $0 row, never into "unknown".
 */
import { judgeReply, type DraftCard } from "./draft-lib";
import { parseChat, type Arm, type CardResult } from "./bakeoff-lib";

/** Env var naming the OpenAI-compatible base URL of the local server. */
export const LOCAL_BASE_URL_ENV = "LOCAL_BAKEOFF_BASE_URL";
/** Env var with an optional bearer token (servers started with --api-key). */
export const LOCAL_API_KEY_ENV = "LOCAL_BAKEOFF_API_KEY";
/** Where a local server usually listens (vLLM's default). */
export const DEFAULT_LOCAL_BASE_URL = "http://localhost:8000/v1";

/** The bit of the fetch response this arm reads. */
export interface LocalResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** A fetch call this arm makes. The global fetch satisfies it. */
export type LocalFetch = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<LocalResponse>;

export interface LocalArmOptions {
  /** Base URL of the OpenAI-compatible server, without a trailing slash. */
  baseUrl?: string;
  /** Optional bearer token; no Authorization header is sent when unset. */
  apiKey?: string;
  /** Injectable fetch, so tests can point at a stub server. */
  fetchImpl?: LocalFetch;
}

/** The configured local server URL, from the environment or the default. */
export function localBaseUrl(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): string {
  return (env[LOCAL_BASE_URL_ENV] ?? DEFAULT_LOCAL_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

/** One chat completion against the local server. */
export async function chatLocal(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  prompt: string,
  fetchImpl: LocalFetch = fetch as unknown as LocalFetch,
): Promise<{ text: string; usage: { input: number; output: number } }> {
  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok)
    throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  const parsed = parseChat(await res.json());
  return { text: parsed.text, usage: parsed.usage };
}

/**
 * Drafts every card with the local server and judges the replies exactly
 * like the hosted chat arms do. A failing card becomes an error result, so
 * one broken card never loses the whole arm.
 */
export async function runLocalArm(
  arm: Arm,
  cards: readonly DraftCard[],
  prompts: ReadonlyMap<string, string>,
  options: LocalArmOptions = {},
): Promise<CardResult[]> {
  const baseUrl = (options.baseUrl ?? localBaseUrl()).replace(/\/+$/, "");
  const apiKey = options.apiKey ?? process.env[LOCAL_API_KEY_ENV];
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as LocalFetch);
  const results: CardResult[] = [];
  for (const card of cards) {
    const prompt = prompts.get(card.name) ?? "";
    try {
      const reply = await chatLocal(
        baseUrl,
        apiKey,
        arm.model,
        prompt,
        fetchImpl,
      );
      results.push({
        name: card.name,
        outcome: judgeReply(card, reply.text),
        usage: reply.usage,
      });
    } catch (e) {
      results.push({
        name: card.name,
        outcome: {
          kind: "error",
          name: card.name,
          error: (e as Error).message,
        },
        usage: { input: 0, output: 0 },
      });
    }
  }
  return results;
}
