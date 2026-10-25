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
import { buildSystemPrompt } from "../scripts/card-scripts/draft-lib";
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

  it("carries the system prompt, the oracle text and the script JSON", () => {
    expect(record.system).toBe(system);
    expect(record.user).toBe(lightningStrike.oracle);
    expect(record.assistant).toBe(JSON.stringify(lightningStrike));
  });

  it("is an ETF trace record with a user turn and an assistant turn", () => {
    expect(record.etf).toBe(1);
    expect(record.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(record.messages[0].content).toBe(record.user);
    expect(record.messages[1].content).toBe(record.assistant);
    expect(record.meta.tags).toContain("sft");
  });

  it("has an assistant turn that is a valid card script", () => {
    const parsed = CardScriptSchema.safeParse(
      JSON.parse(record.assistant) as unknown,
    );
    expect(parsed.success).toBe(true);
    expect(checkRecord(record)).toEqual([]);
  });

  it("gives every card a stable id", () => {
    expect(recordId(lightningStrike)).toBe("lightning_strike");
    expect(recordId({ ...lightningStrike, name: "Bilbo's Deadly Slice" })).toBe(
      "bilbo_s_deadly_slice",
    );
  });

  it("reports a broken record instead of passing it", () => {
    const broken: EtfRecord = {
      ...record,
      assistant: JSON.stringify({ name: "Nope", oracle: "Nope." }),
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

  it("writes the assistant turn as a schema-valid card script", () => {
    for (const line of trainLines) {
      const parsed = JSON.parse(line) as EtfRecord;
      expect(
        CardScriptSchema.safeParse(JSON.parse(parsed.assistant) as unknown)
          .success,
      ).toBe(true);
    }
  });

  it("holds the 20 gold cards out of the training file", () => {
    expect(evalLines).toHaveLength(goldNames.length);
    const trainNames = trainLines.map(
      (l) => (JSON.parse(l) as EtfRecord).assistant,
    );
    const trainCardNames = trainNames.map(
      (a) => (JSON.parse(a) as CardScript).name,
    );
    for (const gold of goldNames) {
      expect(trainCardNames).not.toContain(gold);
    }
    const evalCardNames = evalLines.map(
      (l) =>
        (JSON.parse((JSON.parse(l) as EtfRecord).assistant) as CardScript).name,
    );
    expect([...evalCardNames].sort()).toEqual([...goldNames].sort());
  });

  it("covers every accepted card script exactly once", () => {
    const scriptFiles = readdirSync(
      join(ROOT, "src", "lib", "game-state", "card-scripts", "cards"),
    ).filter((f) => f.endsWith(".json"));
    expect(trainLines.length + evalLines.length).toBe(scriptFiles.length);
  });
});
