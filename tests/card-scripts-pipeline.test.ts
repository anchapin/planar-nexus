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
