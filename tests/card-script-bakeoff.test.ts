/**
 * Card-script model bake-off helpers (#2491).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CardScriptSchema,
  type CardScript,
} from "../src/lib/game-state/card-scripts/schema";
import {
  agreement,
  geminiBatchBody,
  normalizeScript,
  parseArms,
  parseChat,
  parseGeminiBatch,
  priceFor,
  priceForArm,
  renderBakeoffReport,
  sameScript,
  scoreArm,
  DEFAULT_PRICES,
  type BakeoffList,
  type CardResult,
} from "../scripts/card-scripts/bakeoff-lib";
import {
  chatLocal,
  localBaseUrl,
  runLocalArm,
  DEFAULT_LOCAL_BASE_URL,
  type LocalFetch,
} from "../scripts/card-scripts/local-arm";
import type { DraftCard } from "../scripts/card-scripts/draft-lib";

const ROOT = join(__dirname, "..");
const list = JSON.parse(
  readFileSync(join(ROOT, "scripts/data/bakeoff-cards.json"), "utf8"),
) as BakeoffList;
const scriptNames = new Set(
  readdirSync(join(ROOT, "src/lib/game-state/card-scripts/cards"))
    .filter((f) => f.endsWith(".json"))
    .map(
      (f) =>
        (
          JSON.parse(
            readFileSync(
              join(ROOT, "src/lib/game-state/card-scripts/cards", f),
              "utf8",
            ),
          ) as { name: string }
        ).name,
    ),
);

const shock: CardScript = CardScriptSchema.parse({
  name: "Shock",
  oracle: "Shock deals 2 damage to any target.",
  spell: [{ op: "DealDamage", amount: 2, target: "any" }],
});

describe("bake-off card list", () => {
  it("has 20 gold and 30 new cards with no overlap", () => {
    expect(list.gold).toHaveLength(20);
    expect(list.new).toHaveLength(30);
    const names = [...list.gold, ...list.new.map((c) => c.name)];
    expect(new Set(names).size).toBe(50);
  });

  it("never uses a few-shot example as a gold card", () => {
    for (const ex of [
      "Lightning Strike",
      "Dragon Fodder",
      "Vampire Spawn",
      "Ironpaw Aspirant",
      "Shivan Dragon",
      "Vampire Neonate",
    ]) {
      expect(list.gold).not.toContain(ex);
    }
  });

  it("only lists gold cards this repo scripts", () => {
    // The set is frozen at the bake-off (#2514). New cards may gain scripts
    // later through the drafting pipeline, so only the gold half is checked.
    for (const g of list.gold) expect(scriptNames.has(g)).toBe(true);
    for (const c of list.new) {
      expect(["draft", "needs_new_op", "either"]).toContain(c.expect);
    }
  });
});

describe("parseArms", () => {
  it("splits provider:model specs, keeping colons in the model", () => {
    expect(
      parseArms("zai:glm-5.3-flash, openrouter:google/gemma-4-31b-it:free"),
    ).toEqual([
      { id: "zai:glm-5.3-flash", provider: "zai", model: "glm-5.3-flash" },
      {
        id: "openrouter:google/gemma-4-31b-it:free",
        provider: "openrouter",
        model: "google/gemma-4-31b-it:free",
      },
    ]);
  });

  it("rejects unknown providers", () => {
    expect(() => parseArms("anthropic:x")).toThrow(/unknown provider/);
  });
});

describe("Gemini batch", () => {
  it("builds inline requests keyed per card", () => {
    const body = geminiBatchBody([{ key: "card-0", prompt: "hi" }], "job");
    expect(body.batch.input_config.requests.requests[0]).toEqual({
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        generation_config: { temperature: 0 },
      },
      metadata: { key: "card-0" },
    });
  });

  it("returns null while running and throws when the job dies", () => {
    expect(
      parseGeminiBatch({
        done: false,
        metadata: { state: "JOB_STATE_RUNNING" },
      }),
    ).toBeNull();
    expect(() =>
      parseGeminiBatch({
        done: false,
        metadata: { state: "JOB_STATE_EXPIRED" },
      }),
    ).toThrow(/EXPIRED/);
  });

  it("reads text, skips thoughts and counts thinking tokens as output", () => {
    const op = {
      done: true,
      metadata: { state: "JOB_STATE_SUCCEEDED" },
      response: {
        inlinedResponses: {
          inlinedResponses: [
            {
              metadata: { key: "card-0" },
              response: {
                candidates: [
                  {
                    content: {
                      parts: [
                        { text: "thinking", thought: true },
                        { text: "{}" },
                      ],
                    },
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 100,
                  candidatesTokenCount: 20,
                  thoughtsTokenCount: 5,
                },
              },
            },
            { metadata: { key: "card-1" }, error: { message: "blocked" } },
          ],
        },
      },
    };
    const out = parseGeminiBatch(op)!;
    expect(out.get("card-0")).toEqual({
      text: "{}",
      usage: { input: 100, output: 25 },
    });
    expect(out.get("card-1")).toEqual({ error: "blocked" });
  });
});

describe("parseChat", () => {
  it("reads content, usage and the serving model", () => {
    expect(
      parseChat({
        model: "x/y:free",
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    ).toEqual({
      text: "ok",
      usage: { input: 3, output: 4 },
      model: "x/y:free",
    });
  });

  it("throws on an error body", () => {
    expect(() => parseChat({ error: { message: "nope" } })).toThrow("nope");
  });
});

describe("script comparison", () => {
  it("ignores wording and key order", () => {
    const reworded = CardScriptSchema.parse({
      oracle: "x",
      name: "Shock",
      spell: [{ target: "any", amount: 2, op: "DealDamage" }],
    });
    expect(sameScript(shock, reworded)).toBe(true);
    expect(
      normalizeScript({ text: "t", b: 1, a: [{ name: "n", c: 2 }] }),
    ).toEqual({ a: [{ c: 2 }], b: 1 });
  });

  it("notices a behaviour change", () => {
    const three = CardScriptSchema.parse({
      name: "Shock",
      oracle: "x",
      spell: [{ op: "DealDamage", amount: 3, target: "any" }],
    });
    expect(sameScript(shock, three)).toBe(false);
  });
});

describe("scoreArm", () => {
  const mini: BakeoffList = {
    gold: ["Shock"],
    new: [
      { name: "A", expect: "draft" },
      { name: "B", expect: "needs_new_op" },
      { name: "C", expect: "needs_new_op" },
    ],
  };
  const gold = new Map([["Shock", shock]]);
  const results: CardResult[] = [
    {
      name: "Shock",
      outcome: { kind: "drafted", name: "Shock", script: shock },
      usage: { input: 1_000_000, output: 0 },
    },
    {
      name: "A",
      outcome: { kind: "drafted", name: "A", script: shock },
      usage: { input: 0, output: 1_000_000 },
    },
    {
      name: "B",
      outcome: { kind: "needs_new_op", name: "B", missing: ["x"] },
      usage: { input: 0, output: 0 },
    },
    {
      name: "C",
      outcome: { kind: "drafted", name: "C", script: shock },
      usage: { input: 0, output: 0 },
    },
  ];

  it("counts exact gold matches, correct calls and false drafts", () => {
    const s = scoreArm(
      { id: "zai:glm-5.3-flash", provider: "zai", model: "glm-5.3-flash" },
      results,
      mini,
      gold,
      DEFAULT_PRICES,
      12,
    );
    expect(s).toMatchObject({
      goldExact: 1,
      newCorrect: 2,
      newFalseDraft: 1,
      errors: 0,
    });
    expect(s.costUsd).toBeCloseTo(0.15 + 0.5);
    expect(s.costPer1000Cards).toBeCloseTo((0.65 / 4) * 1000);
  });

  it("prices free models at zero and unknown models as unknown", () => {
    expect(priceFor("openrouter/free", {})).toEqual({ input: 0, output: 0 });
    expect(priceFor("google/gemma-4-31b-it:free", {})).toEqual({
      input: 0,
      output: 0,
    });
    expect(Number.isNaN(priceFor("mystery", {}).input)).toBe(true);
  });

  it("reports agreement and renders a table row per arm", () => {
    const byArm = new Map([
      ["a", results],
      ["b", results],
    ]);
    const agree = agreement(byArm, ["A", "B", "C"]);
    expect(agree).toEqual([
      { name: "A", arms: ["a", "b"], agree: true },
      { name: "C", arms: ["a", "b"], agree: true },
    ]);
    const s = scoreArm(
      { id: "a", provider: "zai", model: "glm-5.3-flash" },
      results,
      mini,
      gold,
      DEFAULT_PRICES,
      1,
    );
    const md = renderBakeoffReport([s], mini, agree, ["note"]);
    expect(md).toContain("| a | 1/1 (100%) | 2/3 (67%) | 1 |");
    expect(md).toContain("- note");
  });
});

describe("local arm (#2886)", () => {
  const shockCard: DraftCard = {
    name: "Shock",
    oracle_text: "Shock deals 2 damage to any target.",
    type_line: "Instant",
    layout: "normal",
  };

  it("parses local arms, mixed with hosted arms", () => {
    expect(parseArms("local:qwen3.5-2b")).toEqual([
      { id: "local:qwen3.5-2b", provider: "local", model: "qwen3.5-2b" },
    ]);
    expect(parseArms("zai:glm-5.3-flash, local:qwen3.5-2b")).toHaveLength(2);
  });

  it("prices a local arm at $0 regardless of the price table", () => {
    const arm = parseArms("local:qwen3.5-2b")[0];
    expect(priceForArm(arm, { "qwen3.5-2b": { input: 9, output: 9 } })).toEqual(
      { input: 0, output: 0 },
    );
    expect(
      priceForArm(
        { id: "zai:glm-5.3-flash", provider: "zai", model: "glm-5.3-flash" },
        DEFAULT_PRICES,
      ),
    ).toEqual({ input: 0.15, output: 0.5 });
  });

  it("resolves the local base URL from the environment, stripping slashes", () => {
    expect(localBaseUrl({})).toBe(DEFAULT_LOCAL_BASE_URL);
    expect(
      localBaseUrl({ LOCAL_BAKEOFF_BASE_URL: "http://127.0.0.1:8000/v1/" }),
    ).toBe("http://127.0.0.1:8000/v1");
  });

  it("drafts through a stub OpenAI-compatible endpoint with no key", async () => {
    const calls: Array<{ url: string; init?: Parameters<LocalFetch>[1] }> = [];
    const stub: LocalFetch = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            { message: { content: JSON.stringify({ script: shock }) } },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        text: async () => "",
      };
    };
    const results = await runLocalArm(
      parseArms("local:qwen3.5-2b")[0],
      [shockCard],
      new Map([["Shock", "prompt"]]),
      { baseUrl: "http://127.0.0.1:9999/v1/", fetchImpl: stub },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:9999/v1/chat/completions");
    const body = JSON.parse(calls[0].init?.body ?? "{}") as {
      model: string;
      temperature: number;
    };
    expect(body.model).toBe("qwen3.5-2b");
    expect(body.temperature).toBe(0);
    expect(calls[0].init?.headers?.authorization).toBeUndefined();
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toEqual({
      kind: "drafted",
      name: "Shock",
      script: shock,
    });
    expect(results[0].usage).toEqual({ input: 100, output: 50 });

    const gold = new Map([["Shock", shock]]);
    const mini: BakeoffList = { gold: ["Shock"], new: [] };
    const score = scoreArm(
      parseArms("local:qwen3.5-2b")[0],
      results,
      mini,
      gold,
      DEFAULT_PRICES,
      2,
    );
    expect(score.goldExact).toBe(1);
    expect(score.costUsd).toBe(0);
    expect(score.costPer1000Cards).toBe(0);
    const md = renderBakeoffReport([score], mini, [], []);
    expect(md).toContain(
      "| local:qwen3.5-2b | 1/1 (100%) | 0/0 (-) | 0 | 0 | 0 | 100 / 50 | $0.0000 | $0.0000 | 2s |",
    );
  });

  it("sends a bearer token only when one is configured", async () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const stub: LocalFetch = async (_url, init) => {
      seen.push(init?.headers);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"needs_new_op":["x"]}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        text: async () => "",
      };
    };
    await chatLocal(
      "http://127.0.0.1:9999/v1",
      "sekrit",
      "qwen3.5-2b",
      "prompt",
      stub,
    );
    expect(seen[0]?.authorization).toBe("Bearer sekrit");
  });

  it("turns a failing local server into a per-card error, not a crash", async () => {
    const stub: LocalFetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "boom",
    });
    const results = await runLocalArm(
      parseArms("local:qwen3.5-2b")[0],
      [shockCard],
      new Map([["Shock", "prompt"]]),
      { baseUrl: "http://127.0.0.1:9999/v1", fetchImpl: stub },
    );
    expect(results[0].outcome.kind).toBe("error");
    expect(results[0].usage).toEqual({ input: 0, output: 0 });
  });
});
