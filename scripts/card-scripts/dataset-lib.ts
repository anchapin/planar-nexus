/**
 * Card-script fine-tuning dataset export (#2551, step 1: dataset export).
 *
 * Every card script this repo has accepted (the hand-written and reviewed
 * ones under `src/lib/game-state/card-scripts/cards/`) is an oracle-text ->
 * script-JSON pair, which is exactly one SFT example. This module turns
 * those scripts into ETF records (brewery-ai's "Empero Trace Format", v1)
 * and keeps the #2514 bake-off gold set out of the training split.
 *
 * ETF shape (one JSON object per line, `.jsonl`):
 *
 *   {"etf": 1,
 *    "id": "bilbos_deadly_slice",
 *    "system": "<the drafting prompt's op-set description>",
 *    "messages": [{"role": "user", "content": "<oracle text>"},
 *                 {"role": "assistant", "content": "<script JSON>"}],
 *    "user": "<oracle text>",
 *    "assistant": "<script JSON>",
 *    "meta": {"source": "local:card-scripts", "license": "MIT",
 *             "tags": ["card-scripts", "sft", "train"]}}
 *
 * - `messages` is the ETF trace record (#2551 links brewery-ai's
 *   `docs/etf.md`); `system` is ETF's shorthand for a leading system
 *   message, and `user`/`assistant` repeat the two turns at the top level
 *   so a plain `jq '.user, .assistant'` check works on the file. ETF ignores
 *   unknown fields, so the extra copies are harmless.
 * - `system` is the drafting prompt's op-set description, reused verbatim
 *   from `draft-lib.ts` (`buildSystemPrompt`) — never a second copy of it.
 * - `user` is the oracle text the script was written against.
 * - `assistant` is the script JSON itself, so it validates against
 *   `CardScriptSchema` — the same validator the drafting pipeline uses.
 *
 * The assistant turn is the bare script object, not the drafting reply
 * envelope (`{"script": ...}`): the reply envelope is the *pipeline's*
 * transport format, and a model fine-tuned on the bare script has to be
 * wrapped again when it is plugged back into `judgeReply`.
 *
 * No Forge scripts are ever used: the source of every example is this
 * repo's own JSON.
 */
import {
  CardScriptSchema,
  type CardScript,
} from "../../src/lib/game-state/card-scripts/schema";

/** One ETF record: a system prompt plus a user/assistant turn. */
export interface EtfRecord {
  etf: 1;
  id: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  user: string;
  assistant: string;
  meta: {
    source: string;
    license: string;
    tags: string[];
  };
}

export type DatasetSplit = "train" | "eval";

export interface Dataset {
  train: EtfRecord[];
  eval: EtfRecord[];
}

/** Stable, file-name-like id for a card script. */
export function recordId(script: CardScript): string {
  return (
    script.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "card"
  );
}

/**
 * The ETF record for one card script. `system` is the shared op-set
 * description; the user turn is the oracle text; the assistant turn is the
 * script JSON.
 */
export function toEtfRecord(
  script: CardScript,
  system: string,
  split: DatasetSplit,
): EtfRecord {
  const user = script.oracle;
  const assistant = JSON.stringify(script);
  return {
    etf: 1,
    id: recordId(script),
    system,
    messages: [
      { role: "user", content: user },
      { role: "assistant", content: assistant },
    ],
    user,
    assistant,
    meta: {
      source: "local:card-scripts",
      license: "MIT",
      tags: ["card-scripts", "sft", split],
    },
  };
}

/**
 * Splits the scripts into the training split and the held-out eval split.
 * The eval split is the #2514 bake-off gold set (cards this repo scripts by
 * hand); gold cards never reach the training file.
 */
export function splitByGold(
  scripts: readonly CardScript[],
  goldNames: readonly string[],
): { train: CardScript[]; eval: CardScript[] } {
  const gold = new Set(goldNames.map((n) => n.trim().toLowerCase()));
  const train: CardScript[] = [];
  const evalScripts: CardScript[] = [];
  for (const script of scripts) {
    if (gold.has(script.name.trim().toLowerCase())) evalScripts.push(script);
    else train.push(script);
  }
  return { train, eval: evalScripts };
}

/** Builds the whole dataset: training records plus the held-out gold split. */
export function buildDataset(
  scripts: readonly CardScript[],
  goldNames: readonly string[],
  system: string,
): Dataset {
  const { train, eval: evalScripts } = splitByGold(scripts, goldNames);
  return {
    train: train.map((s) => toEtfRecord(s, system, "train")),
    eval: evalScripts.map((s) => toEtfRecord(s, system, "eval")),
  };
}

/** One JSON object per line, the ETF file layout. */
export function renderJsonl(records: readonly EtfRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

/** Reads an ETF file back into records (used by the checks and the tests). */
export function parseJsonl(text: string): unknown[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as unknown);
}

/**
 * Checks one record: the system prompt is there, the user turn is not
 * empty, and the assistant turn is a card script the schema accepts.
 * Returns the problems found (empty when the record is fine).
 */
export function checkRecord(record: EtfRecord): string[] {
  const errors: string[] = [];
  if (!record.system.trim()) errors.push("empty system prompt");
  if (!record.user.trim()) errors.push("empty user turn");
  if (!record.assistant.trim()) errors.push("empty assistant turn");
  const parsed = CardScriptSchema.safeParse(
    JSON.parse(record.assistant) as unknown,
  );
  if (!parsed.success) {
    errors.push(
      `assistant is not a valid card script: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  const roles = record.messages.map((m) => m.role);
  if (roles.join(",") !== "user,assistant") {
    errors.push(`messages must be one user turn then one assistant turn`);
  } else if (
    record.messages[0].content !== record.user ||
    record.messages[1].content !== record.assistant
  ) {
    errors.push("messages and the top-level user/assistant fields disagree");
  }
  return errors;
}

/**
 * Checks a whole split: every record is well formed, and no gold card
 * leaked into the training split. Returns the problems found.
 */
export function checkDataset(
  dataset: Dataset,
  goldNames: readonly string[],
): string[] {
  const errors: string[] = [];
  const gold = new Set(goldNames.map((n) => n.trim().toLowerCase()));
  for (const record of dataset.train) {
    for (const e of checkRecord(record))
      errors.push(`train ${record.id}: ${e}`);
  }
  for (const record of dataset.eval) {
    for (const e of checkRecord(record)) errors.push(`eval ${record.id}: ${e}`);
  }
  for (const record of dataset.train) {
    const name = (JSON.parse(record.assistant) as { name: string }).name;
    if (gold.has(name.trim().toLowerCase())) {
      errors.push(`gold card ${name} leaked into the training split`);
    }
  }
  return errors;
}
