/**
 * Card-script preference pairs for DPO fine-tuning (#2551, step 2).
 *
 * Step 1 (`scripts/card-scripts/dataset-lib.ts`) exports every accepted card
 * script as an SFT example. This module turns a *drafting run* into DPO
 * preference pairs: for one card, the response we want (`chosen`) and the
 * response we don't (`rejected`).
 *
 * Two kinds of pair come out of a run:
 *
 * - **draft cards**: the run produced both a schema-valid draft and an
 *   invalid (or false) one. `chosen` is the valid draft, `rejected` is the
 *   invalid one.
 * - **needs-new-op cards**: the card needs an effect the op set can't
 *   express, so the right answer is the explicit refusal. `chosen` is the
 *   `{"needs_new_op": [...]}` reply, `rejected` is the forced/guessed script
 *   the model wrote instead of refusing.
 *
 * The pairs use the *same* system prompt (the drafting op-set description,
 * `buildSystemPrompt()`) and the *same* user prompt (the oracle text) as
 * the step-1 SFT export, so SFT and DPO data agree on what a prompt and a
 * good answer look like. The chosen side of a draft pair is byte-identical
 * in shape to the step-1 assistant turn: the bare script object.
 *
 * Validity is decided by the repo's own validator (`CardScriptSchema`, plus
 * the drafting pipeline's mode and spell/permanent checks) — never by a
 * label stored in the source file. The source only says which cards are
 * meant to be drafted and which are meant to be refused; whether a reply is
 * a good script is the schema's call.
 *
 * Data source: a *draft log* — the raw replies of a drafting run, one entry
 * per card. `scripts/draft-card-scripts.ts` and `scripts/card-script-bakeoff.ts`
 * do not persist raw replies today (they keep only the judged outcome), so
 * no real rejected draft is stored in this repo yet: live pairs wait for a
 * run that writes the log this module reads. See docs/card-scripts.md.
 */
import {
  CardScriptSchema,
  type CardScript,
} from "../../src/lib/game-state/card-scripts/schema";
import {
  checkModes,
  extractJson,
  normalizeDraft,
  type DraftCard,
} from "./draft-lib";
import { slugId } from "./dataset-lib";

/**
 * What the run says a card should be scripted as. "either" is the label
 * `scripts/data/bakeoff-cards.json` gives to ambiguous cards: a draft is
 * fine, a refusal is fine too.
 */
export type CardExpectation = "draft" | "needs_new_op" | "either";

/** One model answer to one card. */
export interface DraftCandidate {
  /** Where the answer came from (arm, model, run) — only used for the report. */
  source?: string;
  /** The raw model reply. */
  reply: string;
}

/** One card in the draft log. */
export interface DraftLogCard {
  name: string;
  /** The oracle text the prompt is built from (also the DPO user prompt). */
  oracle_text: string;
  /** Scryfall type line. Optional; the spell/permanent check needs it. */
  type_line?: string;
  /** "draft" for a card that must be scripted, "needs_new_op" for a refusal. */
  expect?: CardExpectation;
  /** Alias for `expect` ("labelled needs-new-op" in the issue). */
  label?: CardExpectation;
  /** Every reply the run got for this card (strings are read as replies). */
  replies: Array<DraftCandidate | string>;
}

/** The whole draft log: what a drafting run left behind. */
export interface DraftLog {
  cards: DraftLogCard[];
}

/** One DPO pair, in the ETF shape step 1 uses plus chosen/rejected. */
export interface PreferencePair {
  etf: 1;
  id: string;
  system: string;
  user: string;
  chosen: string;
  rejected: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  meta: {
    source: string;
    license: string;
    tags: string[];
    card: string;
    expect: CardExpectation;
    chosen_source?: string;
    rejected_source?: string;
  };
}

/** A card that produced no pair, and why. */
export interface SkippedCard {
  name: string;
  reason: string;
}

/** The result of a pairing run: the pairs plus what was left out. */
export interface PreferenceResult {
  pairs: PreferencePair[];
  skipped: SkippedCard[];
}

/** What the validator says about one reply. */
export type CandidateVerdict =
  | { kind: "drafted"; script: CardScript }
  | { kind: "needs_new_op"; missing: string[] }
  | { kind: "invalid"; errors: string[] };

/**
 * Reads a draft log and fails loudly on anything malformed: the file must
 * be an object with a `cards` array, every card needs a name, oracle text
 * and at least one reply, and every card must be labelled (or expected) to
 * be drafted or refused.
 */
export function parseDraftLog(raw: unknown): DraftLog {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("draft log: expected a JSON object");
  }
  const cards = (raw as { cards?: unknown }).cards;
  if (!Array.isArray(cards)) {
    throw new Error('draft log: expected a "cards" array');
  }
  const parsed: DraftLogCard[] = [];
  cards.forEach((entry, i) => {
    const where = `draft log card #${i}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${where}: expected an object`);
      return;
    }
    const card = entry as Record<string, unknown>;
    const name = typeof card.name === "string" ? card.name.trim() : "";
    if (!name) problems.push(`${where}: missing "name"`);
    const oracle =
      typeof card.oracle_text === "string" ? card.oracle_text.trim() : "";
    if (!oracle) problems.push(`${where}: missing "oracle_text"`);
    const expect = card.expect ?? card.label;
    if (
      expect !== "draft" &&
      expect !== "needs_new_op" &&
      expect !== "either"
    ) {
      problems.push(
        `${where}: missing a "draft", "needs_new_op" or "either" label (use "expect" or "label")`,
      );
    }
    const rawReplies = card.replies;
    if (!Array.isArray(rawReplies) || rawReplies.length === 0) {
      problems.push(`${where}: needs at least one reply`);
    }
    const replies: DraftCandidate[] = [];
    if (Array.isArray(rawReplies)) {
      rawReplies.forEach((r, j) => {
        if (typeof r === "string") {
          replies.push({ reply: r });
          return;
        }
        if (!r || typeof r !== "object" || Array.isArray(r)) {
          problems.push(`${where} reply #${j}: expected a string or an object`);
          return;
        }
        const reply = (r as Record<string, unknown>).reply;
        if (typeof reply !== "string" || !reply.trim()) {
          problems.push(`${where} reply #${j}: missing "reply"`);
          return;
        }
        const source = (r as Record<string, unknown>).source;
        replies.push({
          reply,
          source: typeof source === "string" ? source : undefined,
        });
      });
    }
    parsed.push({
      name,
      oracle_text: oracle,
      type_line:
        typeof card.type_line === "string" ? card.type_line : undefined,
      expect: expect as CardExpectation | undefined,
      label: card.label as CardExpectation | undefined,
      replies,
    });
  });
  if (problems.length) {
    throw new Error(`draft log is malformed:\n  ${problems.join("\n  ")}`);
  }
  return { cards: parsed };
}

/**
 * Judges one reply the way the drafting pipeline does: the reply envelope
 * is read, echoed card fields are dropped, and the script is checked against
 * `CardScriptSchema` (plus the pipeline's mode and spell/permanent checks
 * when the card's type line is known).
 */
export function judgeCandidate(
  card: DraftLogCard,
  reply: string,
): CandidateVerdict {
  let parsed: unknown;
  try {
    parsed = extractJson(reply);
  } catch (e) {
    return { kind: "invalid", errors: [(e as Error).message] };
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  if (Array.isArray(obj.needs_new_op)) {
    const missing = obj.needs_new_op.map(String).filter(Boolean);
    return {
      kind: "needs_new_op",
      missing: missing.length ? missing : ["unspecified"],
    };
  }
  if (!obj.script || typeof obj.script !== "object") {
    return {
      kind: "invalid",
      errors: ['reply has neither "script" nor "needs_new_op"'],
    };
  }
  const candidate = {
    ...normalizeDraft(obj.script as Record<string, unknown>),
    name: card.name,
    oracle: card.oracle_text,
  };
  const result = CardScriptSchema.safeParse(candidate);
  if (!result.success) {
    return {
      kind: "invalid",
      errors: result.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
      ),
    };
  }
  const script = result.data;
  if (card.type_line) {
    const draftCard: DraftCard = {
      name: card.name,
      type_line: card.type_line,
      layout: "normal",
      oracle_text: card.oracle_text,
    };
    const spell = /\b(Instant|Sorcery)\b/.test(card.type_line);
    if (spell && !script.spell && !script.modes) {
      return {
        kind: "invalid",
        errors: ["instant or sorcery scripted without spell effects"],
      };
    }
    if (!spell && (script.spell || script.modes)) {
      return {
        kind: "invalid",
        errors: ["permanent scripted with spell effects"],
      };
    }
    const modeErrors = checkModes(draftCard, script);
    if (modeErrors.length > 0) return { kind: "invalid", errors: modeErrors };
  }
  return { kind: "drafted", script };
}

/** The assistant text of a refusal: the envelope the model replied with. */
export function refusalText(missing: readonly string[]): string {
  return JSON.stringify({ needs_new_op: [...missing] });
}

/**
 * The assistant text of a rejected (invalid) reply: the script the model
 * wrote, exactly as it wrote it. Falls back to the whole reply object, and
 * then to the raw reply, when there is no script to take out of it.
 */
export function rejectedText(reply: string): string {
  try {
    const obj = extractJson(reply) as Record<string, unknown>;
    if (obj && typeof obj === "object" && obj.script) {
      return JSON.stringify(obj.script);
    }
    return JSON.stringify(obj);
  } catch {
    return reply.trim();
  }
}

/**
 * Builds the preference pairs of a draft log.
 *
 * Rules:
 * - gold cards (#2514 bake-off set) never produce a pair — they are the
 *   held-out eval set;
 * - a "draft" card needs one schema-valid reply (chosen) and one invalid
 *   reply (rejected);
 * - a "needs_new_op" card needs one refusal (chosen) and one forced script
 *   (rejected);
 * - anything else is skipped, with the reason, so the caller can report it.
 */
export function buildPreferencePairs(
  log: DraftLog,
  system: string,
  goldNames: readonly string[] = [],
): PreferenceResult {
  const gold = new Set(goldNames.map((n) => n.trim().toLowerCase()));
  const pairs: PreferencePair[] = [];
  const skipped: SkippedCard[] = [];
  for (const card of log.cards) {
    if (gold.has(card.name.trim().toLowerCase())) {
      skipped.push({ name: card.name, reason: "gold card, held out for eval" });
      continue;
    }
    if (!card.oracle_text.trim()) {
      skipped.push({ name: card.name, reason: "no oracle text" });
      continue;
    }
    const expect: CardExpectation =
      card.expect ?? card.label ?? "draft";
    const verdicts = card.replies.map((raw) => {
      const candidate: DraftCandidate =
        typeof raw === "string" ? { reply: raw } : raw;
      return { candidate, verdict: judgeCandidate(card, candidate.reply) };
    });
    const valid = verdicts.find((v) => v.verdict.kind === "drafted");
    const invalid = verdicts.find((v) => v.verdict.kind === "invalid");
    const refusal = verdicts.find((v) => v.verdict.kind === "needs_new_op");

    let chosen: string | undefined;
    let rejected: string | undefined;
    let chosenSource: string | undefined;
    let rejectedSource: string | undefined;
    if (expect === "needs_new_op") {
      if (!refusal) {
        skipped.push({
          name: card.name,
          reason: "no needs-new-op refusal to use as the chosen reply",
        });
        continue;
      }
      if (!valid) {
        skipped.push({
          name: card.name,
          reason: "no forced draft to pair the refusal against",
        });
        continue;
      }
      chosen = refusalText(
        refusal.verdict.kind === "needs_new_op"
          ? refusal.verdict.missing
          : ["unspecified"],
      );
      rejected = JSON.stringify(
        valid.verdict.kind === "drafted" ? valid.verdict.script : {},
      );
      chosenSource = refusal.candidate.source;
      rejectedSource = valid.candidate.source;
    } else {
      if (!valid) {
        skipped.push({
          name: card.name,
          reason: "no schema-valid draft to use as the chosen reply",
        });
        continue;
      }
      if (!invalid) {
        skipped.push({
          name: card.name,
          reason: "no invalid draft to pair the chosen draft against",
        });
        continue;
      }
      chosen = JSON.stringify(
        valid.verdict.kind === "drafted" ? valid.verdict.script : {},
      );
      rejected = rejectedText(invalid.candidate.reply);
      chosenSource = valid.candidate.source;
      rejectedSource = invalid.candidate.source;
    }
    if (!chosen.trim() || !rejected.trim()) {
      skipped.push({ name: card.name, reason: "empty chosen or rejected reply" });
      continue;
    }
    pairs.push({
      etf: 1,
      id: slugId(card.name),
      system,
      user: card.oracle_text,
      chosen,
      rejected,
      messages: [{ role: "user", content: card.oracle_text }],
      meta: {
        source: "local:card-script-drafts",
        license: "MIT",
        tags: ["card-scripts", "dpo", "train"],
        card: card.name,
        expect,
        chosen_source: chosenSource,
        rejected_source: rejectedSource,
      },
    });
  }
  return { pairs, skipped };
}

/**
 * Checks one pair: the prompts are there, the two answers differ, and the
 * answers are the kind of answer the card asked for. Returns the problems
 * found (empty when the pair is fine).
 */
export function checkPreferencePair(pair: PreferencePair): string[] {
  const errors: string[] = [];
  if (!pair.system.trim()) errors.push("empty system prompt");
  if (!pair.user.trim()) errors.push("empty user prompt");
  if (!pair.chosen.trim()) errors.push("empty chosen reply");
  if (!pair.rejected.trim()) errors.push("empty rejected reply");
  if (pair.chosen.trim() === pair.rejected.trim()) {
    errors.push("chosen and rejected are the same reply");
  }
  const messages = pair.messages ?? [];
  if (
    messages.length !== 1 ||
    messages[0].role !== "user" ||
    messages[0].content !== pair.user
  ) {
    errors.push("messages must hold the user turn with the oracle text");
  }
  if (pair.meta.expect === "needs_new_op") {
    let chosen: unknown;
    try {
      chosen = JSON.parse(pair.chosen) as unknown;
    } catch {
      errors.push("chosen reply of a needs-new-op card is not JSON");
      chosen = undefined;
    }
    const missing = (chosen as { needs_new_op?: unknown } | undefined)
      ?.needs_new_op;
    if (!Array.isArray(missing) || missing.length === 0) {
      errors.push("chosen reply of a needs-new-op card is not a refusal");
    }
    let rejected: unknown;
    try {
      rejected = JSON.parse(pair.rejected) as unknown;
    } catch {
      errors.push("rejected reply of a needs-new-op card is not JSON");
      rejected = undefined;
    }
    if (
      !CardScriptSchema.safeParse(rejected as unknown).success
    ) {
      errors.push("rejected reply of a needs-new-op card is not a card script");
    }
  } else {
    let chosen: unknown;
    try {
      chosen = JSON.parse(pair.chosen) as unknown;
    } catch {
      errors.push("chosen reply is not JSON");
      chosen = undefined;
    }
    const parsed = CardScriptSchema.safeParse(chosen as unknown);
    if (!parsed.success) {
      errors.push(
        `chosen reply is not a valid card script: ${parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ")}`,
      );
    }
  }
  return errors;
}

/**
 * Checks every pair and the gold hold-out: a gold card must never reach a
 * training pair. Returns the problems found.
 */
export function checkPreferences(
  pairs: readonly PreferencePair[],
  goldNames: readonly string[] = [],
): string[] {
  const errors: string[] = [];
  const gold = new Set(goldNames.map((n) => n.trim().toLowerCase()));
  for (const pair of pairs) {
    for (const e of checkPreferencePair(pair)) errors.push(`${pair.id}: ${e}`);
    if (gold.has(pair.meta.card.trim().toLowerCase())) {
      errors.push(`${pair.id}: gold card leaked into the training pairs`);
    }
  }
  return errors;
}
