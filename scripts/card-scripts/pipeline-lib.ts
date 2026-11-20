/**
 * Card-script drafting pipeline, review-only edition (#2491).
 *
 * The pipeline takes a card list (name + oracle text), asks a model for a
 * JSON card script, checks the answer against the zod schema and writes the
 * result to a review directory. It is deliberately the *pure* half of the
 * pipeline: no network, no provider SDK, no secret. The model is reached
 * through the {@link ModelClient} interface, so tests and demo runs use a
 * deterministic stub and a real model (a paid call) is only ever made by
 * somebody who deliberately configures one.
 *
 * Rules this module enforces:
 *
 * - A draft is written only when it validates against `CardScriptSchema`
 *   (the same validator the engine uses) — an invalid answer is logged in
 *   the failure log and nothing is written.
 * - A card whose effect the op-set can't express comes back as a
 *   "needs new op" refusal. It never becomes a guessed script.
 * - Drafts land in a review directory as proposals. Nothing here writes
 *   into the game's script corpus (`src/lib/game-state/card-scripts/cards`),
 *   and nothing merges.
 *
 * The prompt is built from the repo's own op-set description
 * (`buildSystemPrompt` in `draft-lib.ts`), never from Forge scripts, and
 * the Forge guard (`assertNoForgeContent`) runs on every prompt.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  assertNoForgeContent,
  buildSystemPrompt,
  judgeReply,
  scriptFileName,
  skipReason,
  tallyMissingOps,
  type DraftCard,
  type DraftOutcome,
} from "./draft-lib";
import type { CardScript } from "../../src/lib/game-state/card-scripts/schema";
import type { CardExpectation, DraftLog, DraftLogCard } from "./preference-lib";

/**
 * A model that can draft one card script. The only thing the pipeline
 * needs from a model is "here is a prompt, give me the reply text".
 *
 * A real client is configured with environment variables (model id and the
 * provider's key) and is never used by the tests or by the stub runs.
 */
export interface ModelClient {
  draft(prompt: string): Promise<string>;
}

/** One card to draft: its name and the oracle text the script is written against. */
export interface PipelineCard {
  name: string;
  oracleText: string;
  /**
   * The card's type line ("Instant", "Creature — Cat"), when it is known.
   * Optional: without it the spell/permanent cross-check is skipped, the
   * schema check still runs.
   */
  typeLine?: string;
}

/** The prompt for one card: the op-set description plus the card's text. */
export interface DraftPrompt {
  /** The op-set description, reused verbatim from `draft-lib.ts`. */
  system: string;
  /** The card's oracle text. */
  user: string;
  /** What is actually sent to the model. */
  text: string;
}

/** The card as the drafting library wants it. */
export function toDraftCard(card: PipelineCard): DraftCard {
  return {
    name: card.name,
    oracle_text: card.oracleText,
    type_line: card.typeLine ?? "",
    layout: "normal",
    keywords: [],
  };
}

/**
 * Builds the prompt for one card.
 *
 * The system part is the repo's own op-set description — the same text the
 * SFT export (`export-card-script-dataset.ts`) and the DPO export use — so a
 * prompt built here is the prompt the model was trained on. The user part is
 * the card's oracle text.
 */
export function buildDraftPrompt(card: PipelineCard): DraftPrompt {
  const system = buildSystemPrompt();
  const user = card.oracleText;
  const text = `${system}\n\nCard: ${card.name}\n\n${user}`;
  assertNoForgeContent(text);
  return { system, user, text };
}

/** The card name the prompt builder put in the prompt, if any. */
export function cardNameFromPrompt(prompt: string): string | null {
  const m = /^Card:\s*(.+)$/m.exec(prompt);
  return m ? m[1].trim() : null;
}

/** One canned reply for one card. */
export interface StubReply {
  cardName: string;
  /** The raw reply text, exactly as a model would return it. */
  reply: string;
}

/** A stub client that also records the prompts it was given. */
export interface StubModelClient extends ModelClient {
  readonly prompts: string[];
}

/** The reply a stub falls back to when it has no canned answer for a card. */
export const STUB_FALLBACK_REPLY =
  '{"needs_new_op": ["the stub model has no answer for this card"]}';

/**
 * A deterministic stand-in for a model: it answers with the canned reply of
 * the card named in the prompt, and refuses (needs new op) for every card
 * it has no answer for. Tests use it to cover the valid, invalid and
 * unknown-effect paths without a network call.
 *
 * A card may have several canned replies: they are handed out in order,
 * one per call, and the last one is repeated when the card is asked for
 * again. That is how a run collects more than one answer for the same
 * card — the draft log keeps every reply of a card, so the preference
 * export has a good answer and a bad one to pair.
 */
export function createStubModelClient(
  replies: readonly StubReply[],
  fallbackReply: string = STUB_FALLBACK_REPLY,
): StubModelClient {
  const byName = new Map<string, string[]>();
  for (const r of replies) {
    const key = r.cardName.trim().toLowerCase();
    const list = byName.get(key);
    if (list) list.push(r.reply);
    else byName.set(key, [r.reply]);
  }
  const asked = new Map<string, number>();
  const prompts: string[] = [];
  return {
    prompts,
    async draft(prompt: string): Promise<string> {
      prompts.push(prompt);
      const name = cardNameFromPrompt(prompt);
      const key = name ? name.toLowerCase() : "";
      const list = byName.get(key);
      if (!list || list.length === 0) return fallbackReply;
      const seen = asked.get(key) ?? 0;
      asked.set(key, seen + 1);
      return list[seen % list.length];
    },
  };
}

/** The result of drafting one card. */
export interface DraftStepResult {
  card: PipelineCard;
  outcome: DraftOutcome;
  /** The raw reply the model gave (kept for the run log). */
  reply: string;
  /** The prompt that was sent. */
  prompt: string;
}

/**
 * Asks the model for one card's script and judges the answer.
 *
 * The reply is judged by the pipeline's own validator (`judgeReply`), so a
 * schema-invalid answer is reported as `invalid` and a refusal is reported
 * as `needs_new_op`. A model that throws (network error, no key) is an
 * `invalid` outcome too: nothing is written for it.
 */
export async function draftCard(
  client: ModelClient,
  card: PipelineCard,
): Promise<DraftStepResult> {
  const prompt = buildDraftPrompt(card);
  let reply: string;
  try {
    reply = await client.draft(prompt.text);
  } catch (e) {
    return {
      card,
      reply: "",
      prompt: prompt.text,
      outcome: {
        kind: "invalid",
        name: card.name,
        errors: [`model call failed: ${(e as Error).message}`],
      },
    };
  }
  return {
    card,
    reply,
    prompt: prompt.text,
    outcome: judgeReply(toDraftCard(card), reply),
  };
}

/** What a run produced, in numbers and in lists. */
export interface RunSummary {
  /** Cards with a schema-valid draft. */
  drafted: number;
  /** Cards whose reply was not written (schema failure or model error). */
  failed: number;
  /** Cards the model refused because the op-set can't express them. */
  needsNewOp: number;
  /** Cards that weren't drafted at all (already scripted, no abilities, ...). */
  skipped: number;
  /** The drafted cards and the file each one was written to. */
  draftedCards: Array<{ name: string; file: string }>;
  /** The failure log: what was rejected and why. */
  failures: Array<{ name: string; errors: string[] }>;
  /** One record per card the model refused. */
  needsNewOpCards: Array<{ name: string; missing: string[] }>;
  /** The missing-ops list: the uncovered effects, most common first. */
  missingOps: Array<{ missing: string; cards: string[] }>;
}

/**
 * One raw model reply of a run, kept so the run can be written as a draft
 * log (the input of the preference export).
 */
export interface RunReply {
  /** The card the model was asked about. */
  name: string;
  /** The oracle text the prompt was built from. */
  oracleText: string;
  /** The card's type line, when the card list knows it. */
  typeLine?: string;
  /** The raw reply text, exactly as the model gave it. */
  reply: string;
  /** What the pipeline made of the reply. */
  outcome: DraftOutcome;
}

/** A whole run. */
export interface PipelineRun {
  outcomes: DraftOutcome[];
  summary: RunSummary;
  /**
   * The raw replies of the run, one per card the model was asked about.
   * A card may have more than one (a re-draft), and every reply is kept
   * verbatim — including the invalid and the refused ones.
   */
  replies: RunReply[];
}

/** Options for {@link runDraftPipeline}. */
export interface RunOptions {
  client: ModelClient;
  cards: readonly PipelineCard[];
  /** Names that already have a script; they are skipped. */
  alreadyScripted?: ReadonlySet<string>;
}

/** Builds the run summary from the outcomes. */
export function summarize(outcomes: readonly DraftOutcome[]): RunSummary {
  const of = <K extends DraftOutcome["kind"]>(k: K) =>
    outcomes.filter(
      (o): o is Extract<DraftOutcome, { kind: K }> => o.kind === k,
    );
  const drafted = of("drafted");
  const failures = of("invalid");
  const needs = of("needs_new_op");
  return {
    drafted: drafted.length,
    failed: failures.length,
    needsNewOp: needs.length,
    skipped: of("skipped").length,
    draftedCards: drafted.map((o) => ({
      name: o.name,
      file: scriptFileName(o.name),
    })),
    failures: failures.map((o) => ({ name: o.name, errors: o.errors })),
    needsNewOpCards: needs.map((o) => ({
      name: o.name,
      missing: o.missing,
    })),
    missingOps: tallyMissingOps(outcomes),
  };
}

/**
 * Runs the pipeline over a card list. Every card ends in exactly one
 * outcome: drafted, invalid (logged, never written), needs new op, or
 * skipped.
 */
export async function runDraftPipeline(
  options: RunOptions,
): Promise<PipelineRun> {
  const alreadyScripted = options.alreadyScripted ?? new Set<string>();
  const outcomes: DraftOutcome[] = [];
  const replies: RunReply[] = [];
  for (const card of options.cards) {
    const reason = skipReason(toDraftCard(card), alreadyScripted);
    if (reason) {
      outcomes.push({ kind: "skipped", name: card.name, reason });
      continue;
    }
    const step = await draftCard(options.client, card);
    outcomes.push(step.outcome);
    replies.push({
      name: card.name,
      oracleText: card.oracleText,
      typeLine: card.typeLine,
      reply: step.reply,
      outcome: step.outcome,
    });
  }
  return { outcomes, summary: summarize(outcomes), replies };
}

/**
 * The label a draft-log card gets: what the run showed for it.
 *
 * - a card the run drafted is a "draft" card;
 * - a card the run refused (needs new op) is a "needs_new_op" card;
 * - a card whose only answer was invalid is "either": the run did not
 *   say what the card is supposed to be.
 */
function logExpectation(outcomes: readonly DraftOutcome[]): CardExpectation {
  const kinds = new Set(outcomes.map((o) => o.kind));
  if (kinds.has("drafted")) return "draft";
  if (kinds.has("needs_new_op")) return "needs_new_op";
  return "either";
}

/**
 * Builds the draft log of a run: the raw replies, one entry per card, in
 * the shape `preference-lib.ts` reads (`parseDraftLog`).
 *
 * Every reply is kept verbatim — the invalid ones and the refusals too:
 * they are the rejected side of a preference pair. A card the model never
 * answered (a skipped card, a failed model call) has no reply and is not
 * in the log.
 */
export function buildDraftLog(run: PipelineRun): DraftLog {
  const cards: DraftLogCard[] = [];
  const byName = new Map<string, DraftLogCard>();
  const outcomes = new Map<string, DraftOutcome[]>();
  for (const entry of run.replies ?? []) {
    if (!entry.reply.trim()) continue;
    const key = entry.name.trim().toLowerCase();
    let card = byName.get(key);
    if (!card) {
      card = {
        name: entry.name,
        oracle_text: entry.oracleText,
        type_line: entry.typeLine,
        expect: "either",
        replies: [],
      };
      byName.set(key, card);
      cards.push(card);
      outcomes.set(key, []);
    }
    card.replies.push({ source: "run", reply: entry.reply });
    outcomes.get(key)?.push(entry.outcome);
  }
  for (const card of cards) {
    const key = card.name.trim().toLowerCase();
    card.expect = logExpectation(outcomes.get(key) ?? []);
  }
  return { cards };
}

/** The files a run wrote. */
export interface WriteOutputResult {
  /** Every path written, in the order they were written. */
  files: string[];
  summary: RunSummary;
}

/**
 * Refuses to write into the game's script corpus: drafts are proposals for
 * review, and nothing here may land in `src/lib/game-state/card-scripts/cards`
 * without a human moving it there.
 */
export function assertReviewOutputDir(outputDir: string): string {
  const dir = resolve(outputDir);
  const corpus = join(
    resolve(__dirname, "..", ".."),
    "src",
    "lib",
    "game-state",
    "card-scripts",
    "cards",
  );
  if (dir === corpus || dir.startsWith(corpus + "/")) {
    throw new Error(
      "refusing to write drafts into the card script corpus; drafts are review proposals",
    );
  }
  return dir;
}

/**
 * Writes the run to a review directory:
 *
 * - `drafts/<card>.json` — one file per schema-valid draft.
 * - `run-summary.json` — the counts and the lists.
 * - `failures.json` — the failure log (invalid drafts; nothing was written).
 * - `needs-new-op.json` — one record per refused card.
 * - `missing-ops.json` — the missing-ops list.
 * - `draft-log.json` — the raw replies of the run, in the draft-log shape
 *   the preference export reads (`preference-lib.ts`).
 */
export function writeRunOutput(
  outputDir: string,
  run: PipelineRun,
): WriteOutputResult {
  const dir = assertReviewOutputDir(outputDir);
  const draftsDir = join(dir, "drafts");
  mkdirSync(draftsDir, { recursive: true });
  const files: string[] = [];
  const write = (name: string, value: unknown) => {
    const path = join(dir, name);
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    files.push(path);
  };

  for (const outcome of run.outcomes) {
    if (outcome.kind !== "drafted") continue;
    const path = join(draftsDir, scriptFileName(outcome.name));
    writeFileSync(
      path,
      `${JSON.stringify(outcome.script satisfies CardScript, null, 2)}\n`,
      "utf8",
    );
    files.push(path);
  }

  write("run-summary.json", run.summary);
  write("failures.json", run.summary.failures);
  write("needs-new-op.json", run.summary.needsNewOpCards);
  write("missing-ops.json", run.summary.missingOps);
  write("draft-log.json", buildDraftLog(run));
  return { files, summary: run.summary };
}

/** A short, human-readable summary of a run, for the CLI's output. */
export function renderRunSummary(summary: RunSummary): string {
  const lines = [
    `${summary.drafted} drafted, ${summary.failed} failed the schema, ` +
      `${summary.needsNewOp} need new ops, ${summary.skipped} skipped.`,
  ];
  for (const card of summary.draftedCards) {
    lines.push(`  drafted: ${card.name} -> drafts/${card.file}`);
  }
  for (const failure of summary.failures) {
    lines.push(`  failed: ${failure.name}: ${failure.errors.join("; ")}`);
  }
  for (const card of summary.needsNewOpCards) {
    lines.push(`  needs new op: ${card.name}: ${card.missing.join("; ")}`);
  }
  for (const op of summary.missingOps) {
    lines.push(`  missing op: ${op.missing} (${op.cards.join(", ")})`);
  }
  return lines.join("\n");
}
