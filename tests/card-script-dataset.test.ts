/**
 * Card-script fine-tuning dataset export (#2551, step 1).
 *
 * Covers the ETF record shape, the #2514 gold-set hold-out and the export
 * CLI end to end: the script is run against the repo's real card scripts
 * and the two files it writes are checked line by line.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CardScriptSchema,
  type CardScript,
} from "../src/lib/game-state/card-scripts/schema";
import {
  buildDataset,
  checkDataset,
  checkRecord,
  parseJsonl,
  recordId,
  renderJsonl,
  splitByGold,
  toEtfRecord,
  type Dataset,
  type EtfRecord,
} from "../scripts/card-scripts/dataset-lib";
import { buildSystemPrompt, judgeReply, type DraftCard } from "../scripts/card-scripts/draft-lib";
import { exportDataset } from "../scripts/export-card-script-dataset";

const ROOT = join(__dirname, "..");
const GOLD_LIST = join(ROOT, "scripts", "data", "bakeoff-cards.json");
const goldNames = (
  JSON.parse(readFileSync(GOLD_LIST, "utf8")) as {
    gold: string[];
  }
).gold;

const lightningStrike = JSON.parse(
  readFileSync(
    join(
      ROOT,
      "src",
      "lib",
      "game-state",
      "card-scripts",
      "cards",
      "lightning_strike.json",
    ),
    "utf8",
  ),
) as CardScript;

describe("ETF records", () => {
  const system = buildSystemPrompt();
  const record = toEtfRecord(lightningStrike, system, "train");

  it("carries the system prompt, the oracle text and the drafting reply", () => {
    expect(record.system).toBe(system);
    expect(record.user).toBe(lightningStrike.oracle);
    expect(record.assistant).toBe(JSON.stringify({ script: lightningStrike }));
  });

  it("is an ETF trace record with a user turn and an assistant turn", () => {
    expect(record.etf).toBe(1);
    expect(record.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(record.messages[0].content).toBe(record.user);
    expect(record.messages[1].content).toBe(record.assistant);
    expect(record.meta.tags).toContain("sft");
  });

  it("has an assistant turn that is a drafting reply holding a valid script", () => {
    const parsed = JSON.parse(record.assistant) as { script: unknown };
    expect(CardScriptSchema.safeParse(parsed.script).success).toBe(true);
    expect(checkRecord(record)).toEqual([]);
  });

  it("gives every card a stable id", () => {
    expect(recordId(lightningStrike)).toBe("lightning_strike");
    expect(recordId({ ...lightningStrike, name: "Bilbo's Deadly Slice" })).toBe(
      "bilbo_s_deadly_slice",
    );
  });

  it("rejects a bare script target: the reply needs the envelope", () => {
    const bare: EtfRecord = {
      ...record,
      assistant: JSON.stringify(lightningStrike),
    };
    expect(checkRecord(bare).join(" ")).toContain(
      'assistant turn is not a drafting reply: it has no "script" object',
    );
  });

  it("reports a broken record instead of passing it", () => {
    const broken: EtfRecord = {
      ...record,
      assistant: JSON.stringify({ script: { name: "Nope", oracle: "Nope." } }),
    };
    expect(checkRecord(broken).join(" ")).toContain("not a valid card script");
  });
});

describe("gold-set hold-out", () => {
  it("puts the #2514 gold cards in the eval split only", () => {
    const gold = goldNames.slice(0, 3);
    const { train, eval: evalScripts } = splitByGold([lightningStrike], gold);
    expect(evalScripts).toHaveLength(0);
    expect(train).toHaveLength(1);
  });

  it("matches gold names case-insensitively", () => {
    const { train, eval: evalScripts } = splitByGold(
      [lightningStrike],
      [lightningStrike.name.toUpperCase()],
    );
    expect(evalScripts).toHaveLength(1);
    expect(train).toHaveLength(0);
  });

  it("flags a gold card that leaked into the training split", () => {
    const system = buildSystemPrompt();
    const dataset = buildDataset(
      [lightningStrike],
      [lightningStrike.name],
      system,
    );
    expect(checkDataset(dataset, [lightningStrike.name])).toEqual([]);
    // Force a leak and make sure the check catches it.
    const leaked: Dataset = {
      train: [toEtfRecord(lightningStrike, system, "train")],
      eval: [],
    };
    expect(checkDataset(leaked, [lightningStrike.name]).join(" ")).toContain(
      "leaked into the training split",
    );
  });
});

describe("the exported format and the judge agree (#2914)", () => {
  const system = buildSystemPrompt();
  const record = toEtfRecord(lightningStrike, system, "train");
  const card: DraftCard = {
    name: lightningStrike.name,
    type_line: "Instant",
    layout: "normal",
    oracle_text: lightningStrike.oracle,
  };

  it("judges an exported target as a draft, not as an invalid reply", () => {
    const outcome = judgeReply(card, record.assistant);
    expect(outcome.kind).toBe("drafted");
    expect(outcome.kind === "invalid" ? outcome.errors : []).toEqual([]);
  });

  it("judges a bare script target as invalid: that is the old format", () => {
    const outcome = judgeReply(card, JSON.stringify(lightningStrike));
    expect(outcome.kind).toBe("invalid");
    expect(
      outcome.kind === "invalid" ? outcome.errors.join(" ") : "",
    ).toContain('reply has neither "script" nor "needs_new_op"');
  });

  it("judges an exported gold-card target as a draft too", () => {
    const outDir = mkdtempSync(join(tmpdir(), "card-script-dataset-judge-"));
    try {
      const exported = exportDataset({ outDir });
      const lines = readFileSync(exported.evalFile, "utf8")
        .split("\n")
        .filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const record2 = JSON.parse(line) as EtfRecord;
        const script = (JSON.parse(record2.assistant) as { script: CardScript })
          .script;
        const outcome = judgeReply(
          {
            name: script.name,
            type_line: "",
            layout: "normal",
            oracle_text: script.oracle,
          },
          record2.assistant,
        );
        expect(outcome.kind).toBe("drafted");
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe("exported dataset", () => {
  const outDir = mkdtempSync(join(tmpdir(), "card-script-dataset-"));
  const result = exportDataset({ outDir });
  const trainLines = readFileSync(result.trainFile, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const evalLines = readFileSync(result.evalFile, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("writes one JSON object per line, and every line parses", () => {
    expect(parseJsonl(readFileSync(result.trainFile, "utf8"))).toHaveLength(
      trainLines.length,
    );
    for (const line of [...trainLines, ...evalLines]) {
      const parsed = JSON.parse(line) as EtfRecord;
      expect(typeof parsed.system).toBe("string");
      expect(typeof parsed.user).toBe("string");
      expect(typeof parsed.assistant).toBe("string");
    }
  });

  it("renders the same records it writes", () => {
    const record = toEtfRecord(lightningStrike, buildSystemPrompt(), "train");
    const rendered = renderJsonl([record]);
    expect(rendered.split("\n").filter((l) => l.length > 0)).toHaveLength(1);
    expect(parseJsonl(rendered)[0]).toEqual(record);
  });

  it("writes the assistant turn as a drafting reply holding a schema-valid script", () => {
    for (const line of trainLines) {
      const parsed = JSON.parse(line) as EtfRecord;
      const reply = JSON.parse(parsed.assistant) as { script: unknown };
      expect(CardScriptSchema.safeParse(reply.script).success).toBe(true);
    }
  });

  it("holds the 20 gold cards out of the training file", () => {
    expect(evalLines).toHaveLength(goldNames.length);
    const trainCardNames = trainLines.map((l) => {
      const record = JSON.parse(l) as EtfRecord;
      return (JSON.parse(record.assistant) as { script: CardScript }).script.name;
    });
    for (const gold of goldNames) {
      expect(trainCardNames).not.toContain(gold);
    }
    const evalCardNames = evalLines.map((l) => {
      const record = JSON.parse(l) as EtfRecord;
      return (JSON.parse(record.assistant) as { script: CardScript }).script.name;
    });
    expect([...evalCardNames].sort()).toEqual([...goldNames].sort());
  });

  it("covers every accepted card script exactly once", () => {
    const scriptFiles = readdirSync(
      join(ROOT, "src", "lib", "game-state", "card-scripts", "cards"),
    ).filter((f) => f.endsWith(".json"));
    expect(trainLines.length + evalLines.length).toBe(scriptFiles.length);
  });
});
