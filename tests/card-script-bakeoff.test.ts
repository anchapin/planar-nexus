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
  renderBakeoffReport,
  sameScript,
  scoreArm,
  DEFAULT_PRICES,
  type BakeoffList,
  type CardResult,
} from "../scripts/card-scripts/bakeoff-lib";

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
