/**
 * @fileOverview Context builder for the conversational AI coach.
 * Converts deck data and metadata into LLM-friendly formats.
 */

import { ChatMessage } from "@/types/chat";
import {
  SECURITY_PREAMBLE,
  sanitizeUserInput,
  wrapUntrusted,
} from "@/ai/prompt-security";
import type { CoachIntentResult } from "@/ai/coach-intent";
import { COACH_INTENT_LABELS } from "@/ai/coach-intent";
import {
  normalizeDifficultyLevel,
  type DifficultyLevel,
} from "@/ai/ai-difficulty";

// Reuse types from actions.ts to avoid duplication or circular deps
export interface MinimalCard {
  id: string;
  name: string;
  cmc: number;
  type_line: string;
  colors: string[];
  color_identity: string[];
  legalities: Record<string, string>;
  oracle_text?: string;
  mana_cost?: string;
  image_uris?: {
    small: string;
    normal: string;
    large: string;
  };
}

export interface ScryfallCard extends MinimalCard {
  power?: string;
  toughness?: string;
  keywords?: string[];
  faces?: number;
}

export interface DeckCard extends ScryfallCard {
  count: number;
}

/**
 * Formats a decklist into a concise text representation for the LLM.
 * Groups cards by type and includes key info like CMC.
 */
export function formatDeckForLLM(cards: DeckCard[]): string {
  if (!cards || cards.length === 0) {
    return "No cards in deck yet.";
  }

  // Group by type
  const grouped: Record<string, DeckCard[]> = {
    Creatures: [],
    Planeswalkers: [],
    "Instants/Sorceries": [],
    "Artifacts/Enchantments": [],
    Lands: [],
    Other: [],
  };

  cards.forEach((card) => {
    const type = card.type_line.toLowerCase();
    if (type.includes("creature")) grouped["Creatures"].push(card);
    else if (type.includes("planeswalker")) grouped["Planeswalkers"].push(card);
    else if (type.includes("instant") || type.includes("sorcery"))
      grouped["Instants/Sorceries"].push(card);
    else if (type.includes("artifact") || type.includes("enchantment"))
      grouped["Artifacts/Enchantments"].push(card);
    else if (type.includes("land")) grouped["Lands"].push(card);
    else grouped["Other"].push(card);
  });

  let output = "";
  for (const [groupName, groupCards] of Object.entries(grouped)) {
    if (groupCards.length > 0) {
      output += `\n### ${groupName}\n`;
      output += groupCards
        .map(
          (card) =>
            `${card.count}x ${card.name} (${card.mana_cost || "No cost"})`,
        )
        .join("\n");
      output += "\n";
    }
  }

  return output.trim();
}

/**
 * Formats a digested context into a concise text representation for the LLM.
 * This is used for payload reduction when the full deck/game state is too large.
 */
export function formatDigestedContextForLLM(context: any): string {
  if (!context) return "";

  let output = "### Digested Game Context\n";

  if (context.deckSummary) {
    const ds = context.deckSummary;
    output += `**Deck Stats**: ${ds.totalCards} cards, Avg CMC: ${ds.averageCmc.toFixed(2)}, Colors: ${ds.colors.join(", ")}\n`;
    output += `**Types**: ${Object.entries(ds.typeCounts)
      .map(([type, count]) => `${count} ${type}`)
      .join(", ")}\n`;
    output += `**Key Cards**: ${ds.keyCards.join(", ")}\n`;
    output += `**Mana Curve**: ${ds.manaCurve.join("/")}\n\n`;
  }

  if (context.gameSummary) {
    const gs = context.gameSummary;
    output += `**Current Game**: Turn ${gs.turn}, Phase: ${gs.phase}, Active: ${gs.activePlayerId}\n`;
    gs.players.forEach((p: any) => {
      output += `- **${p.id}**: Life: ${p.life}, Hand: ${p.handSize}, Mana: ${p.manaAvailable}`;
      if (p.keyPermanents && p.keyPermanents.length > 0) {
        output += `, Board: ${p.keyPermanents.join(", ")}`;
      }
      output += "\n";
    });
  }

  return output.trim();
}

/**
 * Tier-specific response guidance for the coach (issue #1387). The difficulty
 * tier is normalized to the canonical four-value set before lookup, with
 * anything unknown defaulting to `medium`.
 */
const TIER_GUIDANCE: Record<DifficultyLevel, string> = {
  easy: "Response depth: EASY tier. Define any jargon you use with a short glossary note. End with exactly ONE concrete next action the player should take. Keep explanations simple, encouraging, and beginner-friendly.",
  medium:
    "Response depth: MEDIUM tier. Give a concise rationale for each recommendation — explain the 'why' in a sentence or two. Avoid deep tangent analysis unless the player asks.",
  hard: "Response depth: HARD tier. Provide trade-off analysis: weigh alternatives, note opportunity costs, and cover the relevant edge cases. Assume the player understands the fundamentals.",
  expert:
    "Response depth: EXPERT tier. Assume tournament-level knowledge. Discuss matchups, meta assumptions, optimal lines, and niche interactions. Skip beginner explanations.",
};

/**
 * Builds the system context for the AI coach.
 *
 * Issue #923: prefers a STRUCTURED deck analysis (archetype, synergy clusters,
 * curve, roles, strengths/gaps) over a raw card-by-card decklist so the coach's
 * advice is specific and grounded. When `structuredAnalysis` is provided it is
 * the primary context; a raw `deckList` is only included as a terse reference
 * (and omitted entirely when structured analysis is present).
 *
 * Issue #1387: classifies the latest user turn's intent (via the caller) and
 * injects a sanitized **intent block** so the coach's behaviour is routed to
 * intent-specific guidance instead of relying on the model to infer the task.
 * A normalized difficulty tier adds tier-specific response-depth guidance;
 * unknown/missing difficulty defaults to `medium`.
 */
export function buildCoachSystemPrompt(
  format: string,
  deckList: string,
  archetype?: string,
  strategy?: string,
  digestedContext?: string,
  structuredAnalysis?: string,
  intent?: CoachIntentResult,
  difficulty?: string,
): string {
  let prompt = `You are an expert Magic: The Gathering coach. You are helping a player improve their deck.\n\n`;

  // Issue #1107: reinforce the system prompt so embedded instructions inside
  // untrusted fields cannot override the coach's task or exfiltrate the prompt.
  prompt += `${SECURITY_PREAMBLE}\n\n`;

  // Issue #1107: every user-controlled field is sanitized and/or fenced before
  // it touches the prompt. Short metadata fields are sanitized; large free-form
  // blobs (decklist, digested context, structured analysis) are wrapped in
  // unambiguous data fences.
  prompt += `**Current Format**: ${sanitizeUserInput(format)}\n`;

  if (archetype) {
    prompt += `**Detected Archetype**: ${sanitizeUserInput(archetype)}\n`;
  }

  if (strategy) {
    prompt += `**General Strategy**: ${sanitizeUserInput(strategy)}\n`;
  }

  if (digestedContext) {
    prompt += `\n${wrapUntrusted(digestedContext, "game_context")}\n`;
  }

  if (structuredAnalysis) {
    // Structured analysis replaces the raw card list — reason about clusters,
    // curve and roles rather than re-deriving them from individual card names.
    prompt += `\n${wrapUntrusted(structuredAnalysis, "structured_analysis")}\n\n`;
  } else if (deckList && deckList !== "No cards in deck yet.") {
    // Fallback (no structured analysis available): include the raw list, fenced.
    prompt += `\n**Decklist**:\n${wrapUntrusted(deckList, "decklist")}\n\n`;
  }

  prompt += `Your goal is to provide strategic advice, card recommendations, and answer questions about the deck's performance. `;
  prompt += `Be encouraging but honest about card quality and synergy. `;
  prompt += `When suggesting cards to cut, explain why (e.g., too expensive, off-plan, redundant). `;
  prompt += `When suggesting cards to add, highlight their synergy with the existing cards.\n`;

  prompt += `\nYou have access to the searchCardsTool. Use it to find cards that might be better than the current choices or to explore new options. `;
  prompt += `Focus on identifying win conditions and ensuring the deck has a consistent game plan.\n\n`;

  // Issue #1387: inject the classified intent block so the coach routes to the
  // right mode of response. Only the canonical intent id and its human label
  // are surfaced (sanitized) — no client-controlled prompt text is trusted.
  // The confidence + matched signals give the model calibration context
  // without leaking classifier internals.
  if (intent) {
    const intentLabel =
      COACH_INTENT_LABELS[intent.intent] ??
      COACH_INTENT_LABELS.unknown;
    prompt += `\n**Classified Intent**: ${sanitizeUserInput(intent.intent)} — ${sanitizeUserInput(intentLabel)}\n`;
    prompt += `Confidence: ${intent.confidence.toFixed(2)} (matched: ${sanitizeUserInput(
      intent.matchedSignals.join(", ") || "none",
    )})\n`;
    prompt += `Tailor your answer to this intent. If the intent is \`unknown\`, answer the player's question directly and naturally.\n\n`;
  }

  // Issue #1387: tier-specific response-depth guidance. Unknown/missing
  // difficulty is normalized to `medium` per the issue's acceptance criteria.
  const tier = normalizeDifficultyLevel(difficulty);
  prompt += `${TIER_GUIDANCE[tier]}\n`;

  prompt += `\nHandle the following intents based on user messages:\n`;
  prompt += `- **Analyze/Review**: Give a general overview of the deck's strengths and weaknesses.\n`;
  prompt += `- **Wincon**: Identify the primary and secondary ways the deck wins games.\n`;
  prompt += `- **Cut**: Recommend specific cards to remove, prioritizing those that don't fit the deck's goals.\n`;
  prompt += `- **Swap/Add**: Suggest new cards to add, either to fill holes or improve overall power level.\n`;
  prompt += `- **Card Analysis**: Provide a detailed breakdown of a specific card's role in the current deck context.\n`;
  prompt += `- **Sideboard**: Advise on sideboard construction and boarding plans against specific decks.\n`;
  prompt += `- **Mulligan**: Advise on keeping or mulliganing an opening hand.\n`;
  prompt += `- **Rules**: Clarify rules, interactions, and timing; cite the relevant rule briefly.\n`;
  prompt += `- **Matchup**: Analyse how the deck fares against a specific opponent archetype.\n`;
  prompt += `- **Meta**: Discuss the deck's positioning in the current metagame.`;

  return prompt;
}

/**
 * Default token budget for the coach conversation history (issue #1238).
 * Reserved against the *combined* size of the system prompt + retained
 * messages, leaving headroom for the model's response. Conservative default
 * for the chat context window; tune via {@link PrepareConversationHistoryOptions.maxTokens}.
 */
export const DEFAULT_CONVERSATION_TOKEN_BUDGET = 8_000;

/**
 * Default hard cap on the number of retained turns, independent of the token
 * budget. Prevents pathological inputs (e.g. many tiny messages) from blowing
 * up the request size.
 */
export const DEFAULT_CONVERSATION_MAX_MESSAGES = 50;

/**
 * Default heuristic for estimating token count from raw text.
 * The "characters per token" rule of thumb is ~4 for English/code; the coach
 * payload is English prose plus structured-analysis blocks, so 4 is a safe
 * average.
 */
export const DEFAULT_CHARS_PER_TOKEN = 4;

/** Options that control how {@link prepareConversationHistory} prunes history. */
export interface PrepareConversationHistoryOptions {
  /**
   * Hard cap on retained messages. Independent of the token budget — even
   * tiny messages count toward this so we never ship an unbounded array.
   * Defaults to {@link DEFAULT_CONVERSATION_MAX_MESSAGES}.
   */
  maxMessages?: number;
  /**
   * Token budget. Reserved against the *combined* size of `systemContent`
   * (typically the guardrailed system prompt) and the retained messages,
   * so we never exceed the model's context window. Defaults to
   * {@link DEFAULT_CONVERSATION_TOKEN_BUDGET}.
   */
  maxTokens?: number;
  /** Characters-per-token heuristic (see {@link estimateTokens}). */
  charsPerToken?: number;
  /**
   * Content of the system prompt that will be sent alongside the messages.
   * Reserved against the token budget so the budget reflects the *full*
   * prompt size, not just the visible conversation. Typically passed by the
   * coach route after `buildCoachSystemPrompt` runs.
   */
  systemContent?: string;
}

/**
 * Estimates the token count of an arbitrary string using a chars/4 heuristic.
 * Exported so callers (and tests) can audit or override the budget math.
 */
export function estimateTokens(
  text: string | undefined | null,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN,
): number {
  if (!text) return 0;
  if (charsPerToken <= 0) return 0;
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Prepares the conversation history for the LLM.
 *
 * Issue #1238: the prior implementation sliced to a fixed `maxMessages` (10),
 * which is fragile for long sessions — a single deck-analysis answer can be
 * several thousand characters and ten of them easily blows past the model's
 * context window. This version is **token-aware**:
 *
 *   - Reserves room for `systemContent` (the structured-analysis + SECURITY_PREAMBLE
 *     block built by `buildCoachSystemPrompt`) against `maxTokens`.
 *   - Walks the history backwards from the **newest** message, always
 *     retaining the latest turn intact (issue acceptance criteria).
 *   - Drops the oldest non-system messages until the retained slice fits
 *     inside both the message cap and the token budget.
 *   - Honors backward compatibility: a numeric second argument is still
 *     accepted and treated as `maxMessages` with the default token budget.
 *
 * The structured-analysis context is preserved by always reserving
 * `systemContent` in the budget — pruning never erases the system prompt,
 * only old turns.
 */
export function prepareConversationHistory(
  messages: ChatMessage[],
  optionsOrMax: PrepareConversationHistoryOptions | number = {},
): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  // Backward-compat overload: `prepareConversationHistory(msgs, 10)` still works.
  const opts: PrepareConversationHistoryOptions =
    typeof optionsOrMax === "number" ? { maxMessages: optionsOrMax } : optionsOrMax;

  const {
    maxMessages = DEFAULT_CONVERSATION_MAX_MESSAGES,
    maxTokens = DEFAULT_CONVERSATION_TOKEN_BUDGET,
    charsPerToken = DEFAULT_CHARS_PER_TOKEN,
    systemContent,
  } = opts;

  // Map ChatMessage to Vercel AI SDK message format
  const mapped = messages.map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  if (mapped.length === 0) return mapped;

  // Fast path: under both caps → return as-is.
  const systemTokens = estimateTokens(systemContent, charsPerToken);
  const remainingBudget = maxTokens - systemTokens;
  if (mapped.length <= maxMessages && remainingBudget > 0) {
    const totalTokens = mapped.reduce(
      (sum, m) => sum + estimateTokens(m.content, charsPerToken),
      0,
    );
    if (totalTokens <= remainingBudget) return mapped;
  }

  // Pruning pass: walk backwards from the latest message, always keeping the
  // newest turn intact. Older turns are admitted only if both the message cap
  // and the token budget allow. Non-system messages are the only candidates
  // for pruning (defensive — system messages here would be the result of a
  // misconfigured caller, since the route already drops them).
  const retained: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
  let tokensUsed = 0;

  for (let i = mapped.length - 1; i >= 0; i--) {
    const msg = mapped[i];
    const msgTokens = estimateTokens(msg.content, charsPerToken);

    // Latest message is always preserved — guarantees the user's prompt
    // reaches the model even if it is the only thing that fits.
    if (i === mapped.length - 1) {
      retained.unshift(msg);
      tokensUsed += msgTokens;
      continue;
    }

    if (retained.length >= maxMessages) break;
    if (tokensUsed + msgTokens > remainingBudget) continue;

    retained.unshift(msg);
    tokensUsed += msgTokens;
  }

  return retained;
}
