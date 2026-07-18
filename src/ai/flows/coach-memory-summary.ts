/**
 * @fileoverview Coach memory summary for pruned conversation history (issue #1417).
 *
 * Long coaching sessions are token-aware (issue #1238): once history exceeds
 * the budget the oldest turns are silently dropped. That keeps requests safe
 * but loses user goals, budget/power constraints, prior card decisions,
 * matchup context, and explanations the player may reference later ("that
 * plan", "the second cut").
 *
 * This module defines a compact, persisted summary that captures the durable
 * signal from pruned turns:
 *
 *   - {@link CoachMemorySummarySchema} — a zod schema describing the summary
 *     shape, used both at the route boundary (validating a client-supplied
 *     summary) and at the storage boundary (graceful degradation for older
 *     conversations that pre-date the summary field).
 *   - {@link buildCoachMemorySummary} — a deterministic, dependency-free
 *     extractor that walks the about-to-be-pruned messages, recognises the
 *     canonical categories (goals, constraints, accepted/rejected swaps,
 *     matchup targets, unresolved questions), and merges them with any prior
 *     summary so the memory grows monotonically across a long session.
 *   - {@link renderCoachMemorySummaryForPrompt} — renders the summary into a
 *     fenced, sanitized block suitable for inclusion in the system prompt as
 *     **trusted system-maintained context**, clearly separated from
 *     user-authored text so the coach treats it as background rather than a
 *     user demand.
 *
 * Design notes:
 *  - The MVP extractor is **deterministic and never invokes an LLM** — per the
 *    issue's acceptance criteria, summary generation must not block the
 *    request path or introduce a new failure mode. Future LLM-assisted
 *    summarisation can layer on top by extending `BuildCoachMemorySummaryOptions`,
 *    but the default path is local + fast.
 *  - The summary is bounded by a *separate* token cap
 *    ({@link DEFAULT_SUMMARY_TOKEN_BUDGET}) so memory growth cannot itself
 *    become the reason history is pruned.
 *  - The summary is derived from user content, so it is still sanitized
 *    (control chars stripped, injection phrases redacted) before it is fenced
 *    into the prompt. It is "trusted" in the sense that it is
 *    server-maintained and stable across turns, not in the sense that the
 *    model should obey directives embedded inside it.
 */

import { z } from "zod";
import type { ChatMessage } from "@/types/chat";
import {
  DEFAULT_CHARS_PER_TOKEN,
  estimateTokens,
} from "@/ai/flows/context-builder";
import { sanitizeUserInput } from "@/ai/prompt-security";

// ============================================================================
// SCHEMA
// ============================================================================

/**
 * Envelope schema version. Bumped when the on-disk shape changes; routes and
 * storage helpers reject mismatched envelopes defensively.
 */
export const COACH_MEMORY_SUMMARY_VERSION = 1;

/**
 * Default hard cap on the size of the rendered summary, in tokens. Kept
 * separate from the conversation-history budget ({@link
 * DEFAULT_CONVERSATION_TOKEN_BUDGET}) so summary growth cannot, by itself,
 * cause history to be pruned. 600 tokens ≈ 2.4k chars is comfortably under
 * the smallest model's context window while leaving room for several entries
 * per category.
 */
export const DEFAULT_SUMMARY_TOKEN_BUDGET = 600;

/**
 * Per-entry length cap (chars). Each summary entry is a short factual
 * statement derived from a single message — clamping keeps one verbose turn
 * from monopolising the summary.
 */
export const SUMMARY_ENTRY_MAX_CHARS = 200;

/**
 * Per-category entry cap. Prevents a single category (e.g. unresolved
 * questions) from filling the entire summary budget at the expense of others.
 */
export const SUMMARY_MAX_ENTRIES_PER_CATEGORY = 8;

/**
 * zod schema describing the persisted coach-memory summary.
 *
 * Every category is a list of short strings; absent categories are
 * represented by an empty array. The {@link CoachMemorySummary.version}
 * field lets future loaders reject or migrate older envelopes.
 */
export const CoachMemorySummarySchema = z.object({
  /** Schema-version discriminator for forward-compatible loading. */
  version: z.literal(COACH_MEMORY_SUMMARY_VERSION),
  /** ISO timestamp of the most recent summary update. */
  updatedAt: z.string().min(1),
  /**
   * Short, durable player goals ("win the long game", "build a tight
   * budget Rakdos aggro", "beat Control"). Extracted from user turns.
   */
  goals: z.array(z.string()).max(SUMMARY_MAX_ENTRIES_PER_CATEGORY),
  /**
   * Budget / power-level / format constraints the player stated ("under
   * $50", "no proxies", "casual, not cEDH", "Modern legal"). Extracted
   * from user turns.
   */
  constraints: z.array(z.string()).max(SUMMARY_MAX_ENTRIES_PER_CATEGORY),
  /**
   * Card swaps the player has agreed to in earlier (now-pruned) turns
   * ("+ Doom Blade, - Murder"). Used so the coach does not re-suggest a
   * rejected cut or re-recommend an already-accepted addition.
   */
  acceptedSwaps: z.array(z.string()).max(SUMMARY_MAX_ENTRIES_PER_CATEGORY),
  /** Swaps the coach proposed and the player explicitly rejected. */
  rejectedSwaps: z.array(z.string()).max(SUMMARY_MAX_ENTRIES_PER_CATEGORY),
  /**
   * Archetypes / decks the player asked about ("How do I beat Mono-Red?",
   * "vs control"). Used to ground future matchup questions in the prior
   * discussion.
   */
  matchupTargets: z.array(z.string()).max(SUMMARY_MAX_ENTRIES_PER_CATEGORY),
  /**
   * Open questions the player asked but that were pruned before the coach
   * could answer in a retained turn. Surfaces as "you may want to revisit"
   * context for the next turn.
   */
  unresolvedQuestions: z
    .array(z.string())
    .max(SUMMARY_MAX_ENTRIES_PER_CATEGORY),
  /**
   * Tokens of the rendered summary, cached at build time so the prompt
   * assembler can reserve against the conversation budget without
   * re-computing.
   */
  tokenEstimate: z.number().nonnegative(),
});

/** Inferred TypeScript type for {@link CoachMemorySummarySchema}. */
export type CoachMemorySummary = z.infer<typeof CoachMemorySummarySchema>;

/**
 * Categories that hold short factual strings. Used by the builder to keep
 * the code below branch-free and by tests to assert coverage.
 */
export const SUMMARY_CATEGORIES = [
  "goals",
  "constraints",
  "acceptedSwaps",
  "rejectedSwaps",
  "matchupTargets",
  "unresolvedQuestions",
] as const;

/** Union type of the summary category keys. */
export type SummaryCategory = (typeof SUMMARY_CATEGORIES)[number];

// ============================================================================
// EMPTY / HELPERS
// ============================================================================

/**
 * Build an empty summary seed. Used by the route when no prior summary was
 * supplied (a fresh conversation or an older record without the field).
 */
export function emptyCoachMemorySummary(
  now: Date = new Date(),
): CoachMemorySummary {
  return {
    version: COACH_MEMORY_SUMMARY_VERSION,
    updatedAt: now.toISOString(),
    goals: [],
    constraints: [],
    acceptedSwaps: [],
    rejectedSwaps: [],
    matchupTargets: [],
    unresolvedQuestions: [],
    tokenEstimate: 0,
  };
}

/**
 * True when the summary has no entries in any category. Used to skip the
 * prompt injection for fresh / no-signal conversations.
 */
export function isSummaryEmpty(summary: CoachMemorySummary): boolean {
  return SUMMARY_CATEGORIES.every((c) => summary[c].length === 0);
}

/**
 * Clamp a single extracted entry. Strips newlines (entries are single-line)
 * and caps length so one verbose message cannot dominate the summary.
 */
function clampEntry(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= SUMMARY_ENTRY_MAX_CHARS) return oneLine;
  return `${oneLine.slice(0, SUMMARY_ENTRY_MAX_CHARS - 1)}…`;
}

/**
 * Add an entry to a category list, skipping empties and de-duplicating
 * case-insensitively. Returns a new array (immutability for safe merge).
 */
function withEntry(list: string[], value: string): string[] {
  const cleaned = clampEntry(value);
  if (!cleaned) return list;
  const lower = cleaned.toLowerCase();
  if (list.some((existing) => existing.toLowerCase() === lower)) return list;
  return [...list, cleaned];
}

// ============================================================================
// DETERMINISTIC EXTRACTORS
// ============================================================================

/**
 * Curated, branch-free signal patterns. Each pattern is paired with the
 * category it contributes to and a deterministic projection that turns the
 * matched user/assistant message into a short summary entry.
 *
 * Patterns are deliberately conservative:
 *  - They prefer multi-word phrases so legitimate MTG vocabulary ("win",
 *    "cut", "budget") is not false-positive matched on its own.
 *  - They operate on lower-cased text but project the original-case snippet
 *    so the summary remains readable.
 *  - Each pattern documents its rationale inline for future maintainers.
 */
interface SignalPattern {
  /** What this recognises, for documentation / debugging only. */
  name: string;
  /** Category the match contributes to. */
  category: SummaryCategory;
  /** Case-insensitive source regex (no `g` flag — used with `.test`). */
  pattern: RegExp;
  /**
   * Project a matched message into a short summary entry. Returning `null`
   * signals a false positive (e.g. an assistant turn that mentioned but
   * didn't propose a swap).
   */
  project: (message: string) => string | null;
}

// Helper: pull a short context window around the first match of `pattern`.
function snippetAround(
  message: string,
  pattern: RegExp,
  windowChars = 120,
): string {
  const lower = message.toLowerCase();
  const match = pattern.exec(lower);
  if (!match) return message.slice(0, windowChars);
  const start = Math.max(0, match.index - 20);
  const end = Math.min(message.length, match.index + windowChars);
  return message.slice(start, end).trim();
}

// Goal phrasing — user turns that name what the player is working toward.
const GOAL_PATTERNS: SignalPattern[] = [
  {
    name: "i-want-to",
    category: "goals",
    pattern: /\bi\s+(?:want|need|hope|'m trying|am trying|aim|intend)\s+to\b/,
    project: (m) =>
      snippetAround(
        m,
        /\bi\s+(?:want|need|hope|'m trying|am trying|aim|intend)\s+to\b/,
      ),
  },
  {
    name: "my-goal",
    category: "goals",
    pattern:
      /\b(?:my|the)\s+(?:goal|win condition|win-?con|game ?plan|plan)\s+(?:is|was)\b/,
    project: (m) =>
      snippetAround(
        m,
        /\b(?:my|the)\s+(?:goal|win condition|win-?con|game ?plan|plan)\s+(?:is|was)\b/,
      ),
  },
  {
    name: "trying-to-beat",
    category: "goals",
    pattern:
      /\btrying\s+to\s+(?:beat|win|outrace|outlast|outvalue|grind\s+out)\b/,
    project: (m) =>
      snippetAround(
        m,
        /\btrying\s+to\s+(?:beat|win|outrace|outlast|outvalue|grind\s+out)\b/,
      ),
  },
];

// Constraint phrasing — budget, power level, format legality, proxies.
const CONSTRAINT_PATTERNS: SignalPattern[] = [
  {
    name: "budget-dollar",
    category: "constraints",
    pattern:
      /\b(?:under|below|within|around|no more than|<=?)\s*\$?\s*\d+|\$\d+\s*(?:budget|max|limit)|\bbudget\s+(?:of\s+)?\$?\d+/,
    project: (m) => snippetAround(m, /\$|budget/),
  },
  {
    name: "power-level",
    category: "constraints",
    pattern:
      /\b(?:power\s*level|pl|lvl|cedh|c-edh|high\s+power|mid\s+power|low\s+power|casual|competitive)\b/,
    project: (m) =>
      snippetAround(
        m,
        /\b(?:power\s*level|pl|lvl|cedh|c-edh|high\s+power|mid\s+power|low\s+power|casual|competitive)\b/,
      ),
  },
  {
    name: "no-proxies",
    category: "constraints",
    pattern:
      /\b(?:no|without|without\s+using)\s+proxies|proxy[- ]free|only\s+real\s+cards\b/,
    project: (m) => snippetAround(m, /prox/),
  },
  {
    name: "format-legality",
    category: "constraints",
    pattern:
      /\b(?:must\s+be|keep\s+it|has\s+to\s+be|needs?\s+to\s+be)\s+(?:modern|legacy|standard|pioneer|commander|vintage|pauper|historic|alchemy)\s+legal\b/,
    project: (m) =>
      snippetAround(
        m,
        /\b(?:modern|legacy|standard|pioneer|commander|vintage|pauper|historic|alchemy)\b/i,
      ),
  },
];

// Swap proposals — assistant turns recommending a cut or addition.
const SWAP_PROPOSE_PATTERN =
  /\b(?:cut|drop|remove|swap|replace|take\s+out|side\s+out|trim)\b[\s\S]{0,80}?\b(?:for|with|in\s+favor\s+of|add(?:ing)?)\b|\b(?:add|bring\s+in|slot\s+in|try\s+out)\b[\s\S]{0,80}?\b(?:over|instead\s+of|replacing|cutting|for)\b/i;

// Matchup targets — user turns naming an archetype they care about.
// Includes "beat X" / "hose X" phrasings common in coaching ("How do I
// beat Mono-Red?", "hose control"). `against`/`vs`/`versus` are also
// recognised. Match group 1 captures the trailing target window.
const MATCHUP_PATTERN =
  /\b(?:against|vs\.?|versus|into|fighting|facing|hate\s+playing\s+against|beat(?:ing)?|lose\s+to|losing\s+to|hose|struggle\s+(?:against|with)|weak\s+(?:against|to))\s+([a-z][a-z\s'-]{2,})/i;

// Unresolved questions — user turns that ended in `?` (after the assistant
// has not yet had a chance to answer in a retained turn).
const QUESTION_PATTERN = /\?\s*$/;

/**
 * Extract a swap description from an assistant message. Recognises the
 * "...cut X for Y..." / "...add X over Y..." family. Returns `null` when the
 * message mentions swaps conceptually but doesn't itself propose one.
 */
function extractSwapProposal(message: string): string | null {
  if (!SWAP_PROPOSE_PATTERN.test(message)) return null;
  // Take the first 160 chars around the proposal — enough for the coach and
  // user to recognise "the second cut" later without blowing the entry cap.
  return snippetAround(message, SWAP_PROPOSE_PATTERN, 160);
}

/**
 * Extract a matchup target from a user message. Strips leading
 * "against"/"vs"/"beat"/"struggle against" so the entry is just the
 * archetype name + window.
 */
function extractMatchupTarget(message: string): string | null {
  const match = message.match(MATCHUP_PATTERN);
  if (!match) return null;
  // The captured group is the archetype window after the lead verb; we
  // still surface the full match for context, just without the lead verb.
  const lead = match[0].slice(0, match[0].length - match[1].length);
  const stripped = message
    .slice(match.index! + lead.length, match.index! + match[0].length)
    .trim();
  return stripped || match[0].trim();
}

/**
 * Detect explicit user acceptance ("yes", "good call", "done", "added") or
 * rejection ("no", "pass", "don't like it", "not for me") of the most recent
 * assistant proposal. Returns `"accepted" | "rejected" | null`.
 *
 * Order matters: rejection phrases are checked first so a "no" / "not for me"
 * is never misread as the affirmative inside a longer sentence.
 */
function detectSwapVerdict(
  userMessage: string,
): "accepted" | "rejected" | null {
  const lower = userMessage.toLowerCase();
  // Rejection phrases first — covers short replies ("no", "pass", "not for
  // me") and longer ones ("don't, thanks", "leave it as is"). The
  // standalone "not for me" is matched explicitly because it does not pair
  // with "don't" in natural prose.
  const rejected =
    /\b(?:no(?:pe)?|pass|skip|don'?t(?:\s+like|,?\s+thanks?|,?\s+not\s+for\s+me)?|hard\s+pass|not\s+(?:a\s+fan|for\s+me|going\s+to)|leave\s+it|keep\s+the\s+current|undo)\b/.test(
      lower,
    );
  if (rejected) return "rejected";
  const accepted =
    /\b(?:yes(?:|sir|sah|please)?|yeah|yep|ok(?:ay)?|sure|done|added|slotted|will\s+do|good\s+(?:call|idea)|love\s+it|makes\s+sense)\b/.test(
      lower,
    );
  return accepted ? "accepted" : null;
}

// ============================================================================
// BUILDER
// ============================================================================

/**
 * Options accepted by {@link buildCoachMemorySummary}.
 */
export interface BuildCoachMemorySummaryOptions {
  /**
   * Prior summary to merge into, if any. The merge is monotonic: existing
   * entries are preserved (de-duplicated against new ones), so memory only
   * grows across a session up to the per-category cap.
   */
  priorSummary?: CoachMemorySummary | null;
  /**
   * Token budget the rendered summary must fit within. Entries are dropped
   * oldest-first per category until the rendered form fits. Defaults to
   * {@link DEFAULT_SUMMARY_TOKEN_BUDGET}.
   */
  maxTokens?: number;
  /** Characters-per-token heuristic (see {@link estimateTokens}). */
  charsPerToken?: number;
  /** Override the `now` timestamp (tests). */
  now?: Date;
}

/**
 * Build (or update) a coach-memory summary from a slice of conversation
 * messages, merging with any prior summary.
 *
 * The input is expected to be the **about-to-be-pruned** slice — i.e. the
 * oldest messages that will no longer reach the model. The latest turn is
 * always retained by {@link prepareConversationHistory}, so it never needs
 * to be summarized.
 *
 * The extractor is deterministic, side-effect-free, and never throws — per
 * the issue's acceptance criteria, summary generation must always leave the
 * existing token-pruning behavior intact as the fallback.
 */
export function buildCoachMemorySummary(
  messages: ReadonlyArray<ChatMessage>,
  options: BuildCoachMemorySummaryOptions = {},
): CoachMemorySummary {
  const {
    priorSummary = null,
    maxTokens = DEFAULT_SUMMARY_TOKEN_BUDGET,
    charsPerToken = DEFAULT_CHARS_PER_TOKEN,
    now = new Date(),
  } = options;

  // Start from a copy of the prior summary (or empty) so the merge is
  // monotonic across calls within the same session.
  const seed: CoachMemorySummary = priorSummary
    ? {
        ...priorSummary,
        goals: [...priorSummary.goals],
        constraints: [...priorSummary.constraints],
        acceptedSwaps: [...priorSummary.acceptedSwaps],
        rejectedSwaps: [...priorSummary.rejectedSwaps],
        matchupTargets: [...priorSummary.matchupTargets],
        unresolvedQuestions: [...priorSummary.unresolvedQuestions],
      }
    : emptyCoachMemorySummary(now);

  // The most recent assistant proposal, used to attribute the next user
  // turn's "yes/no" verdict. Walks the messages in order so the pairing
  // reflects the natural turn-taking.
  let pendingProposal: string | null = null;

  for (const message of messages) {
    const content = message.content ?? "";
    if (!content.trim()) continue;
    const lower = content.toLowerCase();

    if (message.role === "assistant") {
      // Recognise an explicit swap proposal to attribute the next user reply.
      const proposal = extractSwapProposal(content);
      if (proposal) {
        pendingProposal = proposal;
      }
      continue;
    }

    if (message.role === "user") {
      // 1. Goal extraction.
      for (const signal of GOAL_PATTERNS) {
        if (signal.pattern.test(lower)) {
          const entry = signal.project(content);
          if (entry) seed.goals = withEntry(seed.goals, entry);
        }
      }

      // 2. Constraint extraction.
      for (const signal of CONSTRAINT_PATTERNS) {
        if (signal.pattern.test(lower)) {
          const entry = signal.project(content);
          if (entry) seed.constraints = withEntry(seed.constraints, entry);
        }
      }

      // 3. Matchup target extraction.
      const matchup = extractMatchupTarget(content);
      if (matchup) {
        seed.matchupTargets = withEntry(seed.matchupTargets, matchup);
      }

      // 4. Unresolved question extraction — only when the user message is
      //    itself a question (we cannot reliably tell if the assistant
      //    answered it in a retained turn, but a trailing-`?` user turn
      //    that gets pruned is a strong signal it was never settled).
      if (QUESTION_PATTERN.test(content.trim())) {
        seed.unresolvedQuestions = withEntry(
          seed.unresolvedQuestions,
          content.trim(),
        );
      }

      // 5. Swap verdict attribution — apply the user's "yes"/"no" to the
      //    most recent assistant proposal (if any). This lets future turns
      //    reference "that swap I rejected" without the full transcript.
      if (pendingProposal) {
        const verdict = detectSwapVerdict(content);
        if (verdict === "accepted") {
          seed.acceptedSwaps = withEntry(seed.acceptedSwaps, pendingProposal);
        } else if (verdict === "rejected") {
          seed.rejectedSwaps = withEntry(seed.rejectedSwaps, pendingProposal);
        }
        // A non-committal reply ("interesting", "hmm") leaves the proposal
        // pending so a later "ok, let's do it" still attributes correctly.
        if (verdict !== null) pendingProposal = null;
      }
    }
  }

  // Refresh timestamp + token estimate, then bound to the budget.
  seed.updatedAt = now.toISOString();
  return boundSummary(seed, { maxTokens, charsPerToken });
}

// ============================================================================
// BOUNDING
// ============================================================================

/**
 * Bound a summary so the rendered form fits within `maxTokens`. Drops the
 * oldest entry per category (FIFO) until the rendered token estimate fits.
 *
 * Per-category caps ({@link SUMMARY_MAX_ENTRIES_PER_CATEGORY}) are also
 * enforced here, in a single pass, so callers cannot accidentally exceed
 * them by passing a hand-built summary.
 */
export function boundSummary(
  summary: CoachMemorySummary,
  options: { maxTokens?: number; charsPerToken?: number } = {},
): CoachMemorySummary {
  const {
    maxTokens = DEFAULT_SUMMARY_TOKEN_BUDGET,
    charsPerToken = DEFAULT_CHARS_PER_TOKEN,
  } = options;

  let bounded: CoachMemorySummary = {
    ...summary,
    goals: summary.goals.slice(-SUMMARY_MAX_ENTRIES_PER_CATEGORY),
    constraints: summary.constraints.slice(-SUMMARY_MAX_ENTRIES_PER_CATEGORY),
    acceptedSwaps: summary.acceptedSwaps.slice(
      -SUMMARY_MAX_ENTRIES_PER_CATEGORY,
    ),
    rejectedSwaps: summary.rejectedSwaps.slice(
      -SUMMARY_MAX_ENTRIES_PER_CATEGORY,
    ),
    matchupTargets: summary.matchupTargets.slice(
      -SUMMARY_MAX_ENTRIES_PER_CATEGORY,
    ),
    unresolvedQuestions: summary.unresolvedQuestions.slice(
      -SUMMARY_MAX_ENTRIES_PER_CATEGORY,
    ),
  };

  // Iteratively drop the oldest entry from each non-empty category until the
  // rendered form fits. We rotate through categories round-robin so no
  // single category is emptied first.
  let guard = 0;
  const maxIterations = SUMMARY_CATEGORIES.reduce(
    (sum, c) => sum + bounded[c].length,
    0,
  );
  while (guard <= maxIterations) {
    const tokens = estimateTokens(renderSummaryText(bounded), charsPerToken);
    bounded.tokenEstimate = tokens;
    if (tokens <= maxTokens) return bounded;
    let dropped = false;
    for (const category of SUMMARY_CATEGORIES) {
      if (bounded[category].length > 0) {
        bounded = {
          ...bounded,
          [category]: bounded[category].slice(1),
        };
        dropped = true;
        break;
      }
    }
    if (!dropped) break;
    guard += 1;
  }
  bounded.tokenEstimate = estimateTokens(
    renderSummaryText(bounded),
    charsPerToken,
  );
  return bounded;
}

// ============================================================================
// RENDER (prompt injection)
// ============================================================================

/**
 * Plain-text render of the summary, used both for prompt injection and for
 * the token estimate. Format is deliberately terse and section-structured
 * so the model can attribute facts to a category without parsing prose.
 */
export function renderSummaryText(summary: CoachMemorySummary): string {
  const lines: string[] = [];
  const section = (label: string, entries: string[]) => {
    if (entries.length === 0) return;
    lines.push(`${label}:`);
    for (const entry of entries) lines.push(`- ${entry}`);
  };
  section("Goals", summary.goals);
  section("Constraints", summary.constraints);
  section("Accepted swaps", summary.acceptedSwaps);
  section("Rejected swaps", summary.rejectedSwaps);
  section("Matchup targets", summary.matchupTargets);
  section("Unresolved questions", summary.unresolvedQuestions);
  return lines.join("\n");
}

/**
 * Render the summary as a fenced, sanitized block suitable for inclusion in
 * the system prompt as **trusted system-maintained context**.
 *
 * The block is framed clearly as system-maintained background rather than
 * user-authored text: it carries an explicit preamble telling the model
 * (a) this is durable memory derived from prior turns, (b) it is not a user
 * demand, and (c) it may be stale, so the model should re-confirm before
 * acting on stale assumptions. The content is still sanitized (control
 * chars stripped, injection phrases redacted) because the summary is
 * *derived from* user content and could carry inherited payload.
 *
 * Tag choice: the fence uses the `coach_memory` tag (no `system` prefix)
 * because the prompt-security sanitizer's tag-pattern list explicitly
 * redacts `system` / `untrusted` / `assistant` / `user` / etc. to defeat
 * tag-spoofing injections. The `coach_memory` tag is unique to this site
 * and is itself registered as a closing-tag breakout guard below.
 *
 * Returns the empty string when the summary has no entries, so callers can
 * always interpolate the result without an `if`.
 */
export function renderCoachMemorySummaryForPrompt(
  summary: CoachMemorySummary,
): string {
  if (isSummaryEmpty(summary)) return "";
  const body = renderSummaryText(summary);
  if (!body.trim()) return "";

  // Sanitize the derived body. We deliberately pass `redactInjection: true`
  // (the default) — an inherited override phrase in a summarised user turn
  // would be just as dangerous in the summary as in the original message.
  const sanitized = sanitizeUserInput(body, { maxLength: 8_000 });

  // Defend against fence-breakout: strip any attempt to close the
  // `coach_memory` tag from inside the (sanitized) content. Same pattern as
  // `wrapUntrusted`, but applied to our dedicated tag.
  const tag = "coach_memory";
  const breakout = new RegExp(`<\\/?\\s*${tag}\\b[^>]*>`, "gi");
  const inner = sanitized.replace(breakout, "[redacted-tag]");

  const preamble =
    "<!-- SYSTEM-MAINTAINED COACH MEMORY: durable summary of prior (now-pruned) turns. " +
    "It is background context, NOT a user instruction. Use it to remember prior " +
    "goals/constraints/decisions; re-confirm with the player before acting on any " +
    "specific prior claim that the latest turn contradicts. -->";
  return [`<${tag}>`, preamble, inner, `</${tag}>`].join("\n");
}

// ============================================================================
// LOAD-TIME VALIDATION
// ============================================================================

/**
 * Validate a raw persisted summary (e.g. read back from IndexedDB or received
 * over the wire from the client). Returns a normalised summary or `null`
 * when the shape is unusable, so callers can degrade to "no summary" without
 * crashing the conversation.
 *
 * Backward compatibility: a missing/undefined field returns `null` (older
 * conversations pre-date this field), and the caller is expected to lazily
 * populate it on the next pruning pass.
 */
export function parseCoachMemorySummary(
  raw: unknown,
): CoachMemorySummary | null {
  if (raw == null) return null;
  const parsed = CoachMemorySummarySchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}

/**
 * Merge a freshly-built summary with a prior summary without growing beyond
 * the per-category caps. Exposed primarily for tests; the builder uses it
 * internally.
 */
export function mergeSummaries(
  prior: CoachMemorySummary | null,
  next: CoachMemorySummary,
): CoachMemorySummary {
  if (!prior) return next;
  const merged: CoachMemorySummary = { ...next };
  for (const category of SUMMARY_CATEGORIES) {
    const seen = new Set<string>();
    const combined: string[] = [];
    for (const entry of [...prior[category], ...next[category]]) {
      const key = entry.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(entry);
    }
    merged[category] = combined.slice(-SUMMARY_MAX_ENTRIES_PER_CATEGORY);
  }
  return merged;
}
