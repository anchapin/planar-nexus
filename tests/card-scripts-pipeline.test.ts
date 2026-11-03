/**
 * Card-script drafting pipeline, review-only edition (#2491): the stub-model
 * end-to-end run and the pure helpers.
 *
 * No network and no key: the model is the deterministic stub, so the four
 * paths of the pipeline (valid draft, invalid draft, needs new op, missing
 * ops) are covered without a paid call.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDraftPrompt,
  createStubModelClient,
  runDraftPipeline,
  summarize,
  writeRunOutput,
  type PipelineCard,
} from "../scripts/card-scripts/pipeline-lib";
import {
  buildPreferencePairs,
  parseDraftLog,
} from "../scripts/card-scripts/preference-lib";
import { buildSystemPrompt } from "../scripts/card-scripts/draft-lib";
import { CardScriptSchema } from "../src/lib/game-state/card-scripts/schema";

const BOLT: PipelineCard = {
  name: "Ember Bolt",
  typeLine: "Instant",
  oracleText: "Ember Bolt deals 3 damage to any target.",
};

const SENTRY: PipelineCard = {
  name: "Thornwood Sentry",
  typeLine: "Creature — Elf",
  oracleText: "When Thornwood Sentry enters the battlefield, gain 2 life.",
};

const SNARE: PipelineCard = {
  name: "Soul Snare",
  typeLine: "Enchantment — Aura",
  oracleText:
    "As an additional cost to cast Soul Snare, exile a card from your hand.",
};

const BROKEN: PipelineCard = {
  name: "Broken Codex",
  typeLine: "Instant",
  oracleText: "Broken Codex deals 2 damage to any target.",
};

const VALID_REPLY = JSON.stringify({
  script: {
    name: "Ember Bolt",
    oracle: "Ember Bolt deals 3 damage to any target.",
    spell: [{ op: "DealDamage", amount: 3, target: "any" }],
  },
});

const INVALID_REPLY =
  'Here you go: {"script": {"name": "Broken Codex", "spell": [{"op": "DealDamage"';

const SENTRY_REPLY = JSON.stringify({
  script: {
    name: "Thornwood Sentry",
    oracle: "When Thornwood Sentry enters the battlefield, gain 2 life.",
    triggers: [
      {
        text: "When Thornwood Sentry enters the battlefield, gain 2 life.",
        event: "etb",
        subject: "self",
        effects: [{ op: "GainLife", amount: 2, who: "you" }],
      },
    ],
  },
});

const REFUSAL_REPLY = JSON.stringify({
  needs_new_op: ["additional costs (exile a card from your hand)"],
});

const STUB = [
  { cardName: "Ember Bolt", reply: VALID_REPLY },
  { cardName: "Thornwood Sentry", reply: SENTRY_REPLY },
  { cardName: "Broken Codex", reply: INVALID_REPLY },
  { cardName: "Soul Snare", reply: REFUSAL_REPLY },
];

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "card-scripts-pipeline-"));
}

describe("card-script drafting pipeline (stub model)", () => {
  it("writes a schema-valid draft for a card the ops cover", async () => {
    const out = tempDir();
    const client = createStubModelClient(STUB);
    const run = await runDraftPipeline({ client, cards: [BOLT] });
    const written = writeRunOutput(out, run);

    expect(run.summary.drafted).toBe(1);
    expect(run.summary.failed).toBe(0);
    const draft = join(out, "drafts", "ember_bolt.json");
    expect(existsSync(draft)).toBe(true);
    expect(written.files).toContain(draft);

    const script = CardScriptSchema.parse(
      JSON.parse(readFileSync(draft, "utf8")),
    );
    expect(script.name).toBe("Ember Bolt");
    expect(script.oracle).toBe(BOLT.oracleText);
    expect(script.spell).toEqual([
      { op: "DealDamage", amount: 3, target: "any" },
    ]);
  });

  it("logs an invalid draft and writes no script for it", async () => {
    const out = tempDir();
    const client = createStubModelClient(STUB);
    const run = await runDraftPipeline({ client, cards: [BROKEN] });
    writeRunOutput(out, run);

    expect(run.summary.drafted).toBe(0);
    expect(run.summary.failed).toBe(1);
    expect(run.summary.failures[0].name).toBe("Broken Codex");
    expect(run.summary.failures[0].errors.length).toBeGreaterThan(0);
    expect(existsSync(join(out, "drafts", "broken_codex.json"))).toBe(false);

    const failures = JSON.parse(
      readFileSync(join(out, "failures.json"), "utf8"),
    ) as Array<{ name: string; errors: string[] }>;
    expect(failures).toHaveLength(1);
    expect(failures[0].name).toBe("Broken Codex");
  });

  it("records an unknown effect as needs new op and scripts nothing", async () => {
    const out = tempDir();
    const client = createStubModelClient(STUB);
    const run = await runDraftPipeline({ client, cards: [SNARE] });
    writeRunOutput(out, run);

    expect(run.summary.drafted).toBe(0);
    expect(run.summary.needsNewOp).toBe(1);
    expect(run.summary.needsNewOpCards[0]).toEqual({
      name: "Soul Snare",
      missing: ["additional costs (exile a card from your hand)"],
    });
    expect(existsSync(join(out, "drafts", "soul_snare.json"))).toBe(false);

    const refusals = JSON.parse(
      readFileSync(join(out, "needs-new-op.json"), "utf8"),
    ) as Array<{ name: string }>;
    expect(refusals.map((r) => r.name)).toEqual(["Soul Snare"]);
  });

  it("names the uncovered effects in the missing-ops list", async () => {
    const out = tempDir();
    const client = createStubModelClient(STUB);
    const run = await runDraftPipeline({
      client,
      cards: [BOLT, SNARE, BROKEN, SENTRY],
    });
    writeRunOutput(out, run);

    expect(run.summary.missingOps).toEqual([
      {
        missing: "additional costs (exile a card from your hand)",
        cards: ["Soul Snare"],
      },
    ]);
    const missing = JSON.parse(
      readFileSync(join(out, "missing-ops.json"), "utf8"),
    ) as Array<{ missing: string; cards: string[] }>;
    expect(missing[0].cards).toEqual(["Soul Snare"]);
  });

  it("writes the run summary next to the drafts", async () => {
    const out = tempDir();
    const client = createStubModelClient(STUB);
    const run = await runDraftPipeline({
      client,
      cards: [BOLT, SNARE, BROKEN],
    });
    writeRunOutput(out, run);

    const summary = JSON.parse(
      readFileSync(join(out, "run-summary.json"), "utf8"),
    ) as { drafted: number; failed: number; needsNewOp: number };
    expect(summary.drafted).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.needsNewOp).toBe(1);
  });

  it("refuses to write drafts into the card script corpus", async () => {
    const out = tempDir();
    const client = createStubModelClient(STUB);
    const run = await runDraftPipeline({ client, cards: [BOLT] });
    expect(() =>
      writeRunOutput(
        join(
          __dirname,
          "..",
          "src",
          "lib",
          "game-state",
          "card-scripts",
          "cards",
        ),
        run,
      ),
    ).toThrow(/card script corpus/);
    expect(existsSync(join(out, "drafts"))).toBe(false);
  });
});

describe("card-script drafting pipeline (draft log)", () => {
  /** A schema-invalid answer for the same card: the pairing needs one. */
  const BOLT_INVALID_REPLY = JSON.stringify({
    script: {
      name: "Ember Bolt",
      oracle: "Ember Bolt deals 3 damage to any target.",
      spell: [{ op: "DealDamage", target: "any" }],
    },
  });

  /** The stub answers the same card twice: once well, once badly. */
  const MIXED_STUB = [
    { cardName: "Ember Bolt", reply: VALID_REPLY },
    { cardName: "Ember Bolt", reply: BOLT_INVALID_REPLY },
    { cardName: "Soul Snare", reply: REFUSAL_REPLY },
  ];

  it("writes a draft log the preference export can read", async () => {
    const out = tempDir();
    const client = createStubModelClient(MIXED_STUB);
    const run = await runDraftPipeline({
      client,
      cards: [BOLT, BOLT, SNARE],
    });
    const written = writeRunOutput(out, run);

    const logFile = join(out, "draft-log.json");
    expect(existsSync(logFile)).toBe(true);
    expect(written.files).toContain(logFile);

    const log = parseDraftLog(
      JSON.parse(readFileSync(logFile, "utf8")) as unknown,
    );
    expect(log.cards.map((c) => c.name)).toEqual(["Ember Bolt", "Soul Snare"]);

    const bolt = log.cards[0];
    expect(bolt.oracle_text).toBe(BOLT.oracleText);
    expect(bolt.type_line).toBe("Instant");
    expect(bolt.expect).toBe("draft");
    // Every reply is kept verbatim, the invalid one too.
    const texts = (replies: Array<{ reply: string } | string>) =>
      replies.map((r) => (typeof r === "string" ? r : r.reply));
    expect(texts(bolt.replies)).toEqual([VALID_REPLY, BOLT_INVALID_REPLY]);

    const snare = log.cards[1];
    expect(snare.expect).toBe("needs_new_op");
    expect(texts(snare.replies)).toEqual([REFUSAL_REPLY]);
  });

  it("turns the written draft log into preference pairs", async () => {
    const out = tempDir();
    const client = createStubModelClient(MIXED_STUB);
    const run = await runDraftPipeline({
      client,
      cards: [BOLT, BOLT, SNARE],
    });
    writeRunOutput(out, run);

    const log = parseDraftLog(
      JSON.parse(readFileSync(join(out, "draft-log.json"), "utf8")) as unknown,
    );
    const { pairs, skipped } = buildPreferencePairs(log, buildSystemPrompt());
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    const pair = pairs[0];
    expect(pair.meta.card).toBe("Ember Bolt");
    expect(pair.user).toBe(BOLT.oracleText);
    expect(pair.system).toBe(buildSystemPrompt());
    expect(JSON.parse(pair.chosen)).toEqual({
      name: "Ember Bolt",
      oracle: BOLT.oracleText,
      spell: [{ op: "DealDamage", amount: 3, target: "any" }],
    });
    expect(JSON.parse(pair.rejected)).toEqual({
      name: "Ember Bolt",
      oracle: BOLT.oracleText,
      spell: [{ op: "DealDamage", target: "any" }],
    });
    // The refusal-only card has nothing to pair against.
    expect(skipped.map((s) => s.name)).toEqual(["Soul Snare"]);
  });

  it("leaves the failure, refusal and summary files in their old shape", async () => {
    const out = tempDir();
    const client = createStubModelClient(MIXED_STUB);
    const run = await runDraftPipeline({
      client,
      cards: [BOLT, BOLT, SNARE],
    });
    writeRunOutput(out, run);

    const summary = JSON.parse(
      readFileSync(join(out, "run-summary.json"), "utf8"),
    ) as { drafted: number; failed: number; needsNewOp: number };
    expect(summary).toMatchObject({ drafted: 1, failed: 1, needsNewOp: 1 });

    const failures = JSON.parse(
      readFileSync(join(out, "failures.json"), "utf8"),
    ) as Array<{ name: string; errors: string[] }>;
    expect(failures).toHaveLength(1);
    expect(failures[0].name).toBe("Ember Bolt");
    expect(Array.isArray(failures[0].errors)).toBe(true);

    const refusals = JSON.parse(
      readFileSync(join(out, "needs-new-op.json"), "utf8"),
    ) as Array<{ name: string; missing: string[] }>;
    expect(refusals).toEqual([
      {
        name: "Soul Snare",
        missing: ["additional costs (exile a card from your hand)"],
      },
    ]);
  });

  it("logs no card the model never answered", async () => {
    const out = tempDir();
    const client = {
      draft: async () => {
        throw new Error("model unavailable");
      },
    };
    const run = await runDraftPipeline({ client, cards: [BOLT] });
    writeRunOutput(out, run);

    const log = parseDraftLog(
      JSON.parse(readFileSync(join(out, "draft-log.json"), "utf8")) as unknown,
    );
    expect(log.cards).toEqual([]);
  });

  it("logs no card the pipeline skipped", async () => {
    const out = tempDir();
    const client = createStubModelClient(STUB);
    const run = await runDraftPipeline({
      client,
      cards: [BOLT],
      alreadyScripted: new Set(["ember bolt"]),
    });
    writeRunOutput(out, run);

    const log = parseDraftLog(
      JSON.parse(readFileSync(join(out, "draft-log.json"), "utf8")) as unknown,
    );
    expect(log.cards).toEqual([]);
  });
});

describe("card-script drafting pipeline (prompts)", () => {
  it("uses the repo's op-set description as the system prompt", () => {
    const prompt = buildDraftPrompt(BOLT);
    expect(prompt.system).toBe(buildSystemPrompt());
    expect(prompt.system).toContain("DealDamage");
  });

  it("uses the oracle text as the user message", () => {
    const prompt = buildDraftPrompt(SENTRY);
    expect(prompt.user).toBe(SENTRY.oracleText);
    expect(prompt.text).toContain("Card: Thornwood Sentry");
    expect(prompt.text).toContain(SENTRY.oracleText);
  });

  it("never puts Forge script syntax in a prompt", () => {
    expect(() =>
      buildDraftPrompt({
        name: "Forge Sample",
        oracleText: "NumDmg$ 3",
      }),
    ).toThrow(/Forge/);
  });
});

describe("card-script drafting pipeline (failures)", () => {
  it("logs a model error as a failure instead of writing a draft", async () => {
    const out = tempDir();
    const client = {
      draft: async () => {
        throw new Error("model unavailable");
      },
    };
    const run = await runDraftPipeline({ client, cards: [BOLT] });
    writeRunOutput(out, run);

    expect(run.summary.drafted).toBe(0);
    expect(run.summary.failed).toBe(1);
    expect(run.summary.failures[0].errors[0]).toContain("model unavailable");
    expect(existsSync(join(out, "drafts", "ember_bolt.json"))).toBe(false);
  });

  it("counts every outcome in the summary", () => {
    const summary = summarize([
      { kind: "drafted", name: "A", script: { name: "A", oracle: "x" } },
      { kind: "invalid", name: "B", errors: ["boom"] },
      { kind: "needs_new_op", name: "C", missing: ["a new op"] },
      { kind: "skipped", name: "D", reason: "already scripted" },
    ]);
    expect(summary.drafted).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.needsNewOp).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.missingOps).toEqual([{ missing: "a new op", cards: ["C"] }]);
  });

  it("skips cards that are already scripted", async () => {
    const client = createStubModelClient(STUB);
    const run = await runDraftPipeline({
      client,
      cards: [BOLT],
      alreadyScripted: new Set(["ember bolt"]),
    });
    expect(run.summary.skipped).toBe(1);
    expect(run.summary.drafted).toBe(0);
  });
});
