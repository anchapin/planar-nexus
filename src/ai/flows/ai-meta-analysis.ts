/**
 * @fileOverview Meta analysis flow for deck optimization.
 *
 * Issue #1073: route the meta-analysis flow through the LLM provider instead
 * of emitting heuristic-only output, while keeping the heuristic engine as the
 * documented LOCAL-FIRST fallback.
 *
 * Resolution strategy:
 *   1. Always compute the deck-specific heuristic snapshot first. It is both
 *      the grounding context handed to the LLM AND the guaranteed fallback.
 *   2. If a provider is configured, ask the LLM to produce a richer, deck-aware
 *      {@link MetaAnalysisOutput} grounded in that snapshot. The response is
 *      parsed and strictly validated — malformed LLM output is never surfaced.
 *   3. Provider failover composes with the factory chain (issue #1077): on a
 *      provider error, setup failure, or unparseable response, the next
 *      configured provider is tried.
 *   4. When no provider is configured, every provider fails, or every response
 *      fails validation, the heuristic output is returned unchanged.
 *
 * - analyzeMetaAndSuggest - Analyzes the metagame and provides deck improvement suggestions.
 * - MetaAnalysisInput - The input type for analyzeMetaAndSuggest function.
 * - MetaAnalysisOutput - The return type for analyzeMetaAndSuggest function.
 */

import {
  getAIModel,
  getProviderFailoverChain,
  isProviderConfigured,
} from "@/ai/providers/factory";
import { analyzeMetaHeuristic } from "@/lib/heuristic-meta-analysis";
import { importDecklist } from "@/lib/server-card-operations";

export interface MetaAnalysisInput {
  decklist: string;
  format: string;
  focusArchetype?: string;
}

// Extended interface for heuristic analysis
interface HeuristicCard {
  name: string;
  count: number;
  id: string;
  cmc: number;
  colors: string[];
  legalities: Record<string, string>;
  type_line: string;
  mana_cost: string;
  color_identity: string[];
}

/**
 * Represents a card suggestion with name and quantity
 */
export interface CardSuggestion {
  name: string;
  quantity: number;
  reason: string;
}

/**
 * Represents a matchup recommendation
 */
export interface MatchupRecommendation {
  archetype: string;
  recommendation: string;
  sideboardNotes?: string;
}

/**
 * Meta analysis output
 */
export interface MetaAnalysisOutput {
  metaOverview: string;
  deckStrengths: string[];
  deckWeaknesses: string[];
  matchupAnalysis: MatchupRecommendation[];
  cardSuggestions: {
    cardsToAdd: CardSuggestion[];
    cardsToRemove: CardSuggestion[];
  };
  sideboardSuggestions?: CardSuggestion[];
  strategicAdvice: string;
}

/**
 * Options for {@link analyzeMetaAndSuggest}. All optional — when omitted (the
 * default client call), the flow stays heuristic-only and the behavior is
 * byte-for-byte identical to the pre-#1073 implementation.
 */
export interface AnalyzeMetaOptions {
  /**
   * Optional provider name to lead the failover chain. When omitted, the
   * factory's {@link getProviderFailoverChain} default order is used.
   */
  provider?: string | null;
  /** Optional model id forwarded to every provider. */
  modelId?: string;
  /** Ordered provider names to try; overrides the factory chain (test seam). */
  providers?: ReadonlyArray<string>;
  /** Abort signal; aborting cancels the LLM call and returns the heuristic. */
  signal?: AbortSignal | null;
  /** Test seam: override provider resolution. Defaults to the real factory. */
  getModel?: (provider: string, modelId?: string) => Promise<unknown>;
  /** Test seam: override credential detection. Defaults to the real factory. */
  isConfigured?: (provider: string) => boolean;
  /** Test seam: override the LLM text call. Defaults to a lazy `ai` import. */
  generateText?: (args: {
    model: unknown;
    system: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
    abortSignal?: AbortSignal | null;
  }) => Promise<{ text: string }>;
}

/**
 * Convert heuristic meta analysis output to the expected format
 */
function convertHeuristicOutput(
  heuristicResult: ReturnType<typeof analyzeMetaHeuristic>,
  format: string
): MetaAnalysisOutput {
  // Extract deck strengths and weaknesses from the analysis
  const deckStrengths: string[] = [];
  const deckWeaknesses: string[] = [];

  // Analyze the heuristic recommendations to infer strengths/weaknesses
  heuristicResult.recommendations.forEach(rec => {
    if (rec.description.includes("naturally strong")) {
      deckStrengths.push(`Strong against ${rec.matchup.against}`);
    } else if (rec.description.includes("struggles against")) {
      deckWeaknesses.push(`Weak against ${rec.matchup.against}`);
    }
  });

  // Add format-specific strengths/weaknesses
  if (format === 'commander') {
    deckStrengths.push("Access to powerful Commanders and effects");
    deckWeaknesses.push("Slower game pace may struggle against fast combo");
  } else if (format === 'modern') {
    deckStrengths.push("Access to powerful modern cards");
    deckWeaknesses.push("Must prepare for diverse meta");
  }

  // Convert heuristic recommendations to matchup analysis
  const matchupAnalysis: MatchupRecommendation[] = heuristicResult.recommendations.map(rec => ({
    archetype: rec.matchup.against,
    recommendation: rec.description,
    sideboardNotes: rec.matchup.strategy,
  }));

  // Convert card suggestions with reasons
  const allCardsToAdd = heuristicResult.recommendations.flatMap(rec => rec.cardsToAdd || []);
  const allCardsToRemove = heuristicResult.recommendations.flatMap(rec => rec.cardsToRemove || []);

  const cardSuggestions: {
    cardsToAdd: CardSuggestion[];
    cardsToRemove: CardSuggestion[];
  } = {
    cardsToAdd: allCardsToAdd.map(card => ({
      name: card.name,
      quantity: card.quantity,
      reason: `Improves performance against metagame archetypes based on heuristic analysis`,
    })),
    cardsToRemove: allCardsToRemove.map(card => ({
      name: card.name,
      quantity: card.quantity,
      reason: `Underperforming in current metagame according to heuristic analysis`,
    })),
  };

  // Generate strategic advice
  const strategicAdvice = `Based on the ${format} metagame, focus on ${heuristicResult.currentMeta} ` +
    `${heuristicResult.archetypes.slice(0, 3).map(a => a.name).join(', ')} are the dominant archetypes. ` +
    `Prepare your deck with appropriate answers and strategies for these common matchups. ` +
    `The heuristic analysis suggests optimizing for ${heuristicResult.recommendations.map(r => r.title).join(' and ')}.`;

  return {
    metaOverview: heuristicResult.currentMeta,
    deckStrengths,
    deckWeaknesses,
    matchupAnalysis,
    cardSuggestions,
    sideboardSuggestions: cardSuggestions.cardsToAdd.slice(0, 5), // Limit sideboard suggestions
    strategicAdvice,
  };
}

/**
 * Build the heuristic output with card-legality validation and add/remove
 * quantity rebalancing. Extracted verbatim from {@link analyzeMetaAndSuggest}
 * so the LLM-enrichment path and the fallback share one validated heuristic
 * base, and the offline path remains byte-for-byte identical to pre-#1073.
 */
async function buildHeuristicOutput(
  input: MetaAnalysisInput,
  heuristicResult: ReturnType<typeof analyzeMetaHeuristic>
): Promise<MetaAnalysisOutput> {
  // Validate card suggestions for legality
  const validatedOutput = convertHeuristicOutput(heuristicResult, input.format);

  // Validate cards to add for legality
  if (validatedOutput.cardSuggestions.cardsToAdd.length > 0) {
    const cardNamesToValidate = validatedOutput.cardSuggestions.cardsToAdd
      .map(c => `${c.quantity} ${c.name}`)
      .join('\n');

    const importResult = await importDecklist(cardNamesToValidate, input.format);

    if (importResult.notFound.length > 0 || importResult.illegal.length > 0) {
      // Remove illegal or not found cards
      validatedOutput.cardSuggestions.cardsToAdd = validatedOutput.cardSuggestions.cardsToAdd.filter(
        c => !importResult.notFound.includes(c.name) && !importResult.illegal.includes(c.name)
      );
    }
  }

  // Ensure equal counts in card suggestions
  const addCount = validatedOutput.cardSuggestions.cardsToAdd.reduce((sum, c) => sum + c.quantity, 0);
  const removeCount = validatedOutput.cardSuggestions.cardsToRemove.reduce((sum, c) => sum + c.quantity, 0);

  if (addCount !== removeCount) {
    // Adjust removals to match additions
    while (validatedOutput.cardSuggestions.cardsToRemove.reduce((sum, c) => sum + c.quantity, 0) > addCount) {
      const last = validatedOutput.cardSuggestions.cardsToRemove.pop();
      if (last) {
        last.quantity = Math.max(0, last.quantity - 1);
        if (last.quantity > 0) {
          validatedOutput.cardSuggestions.cardsToRemove.push(last);
        }
      }
    }
  }

  return validatedOutput;
}

/**
 * Extract a JSON value from an LLM text response. Tolerates markdown code
 * fences and surrounding prose; returns `null` when nothing parses so the
 * caller can fall back to the heuristic output.
 */
export function extractJsonFromLLM(text: string): unknown {
  if (!text) return null;

  let cleaned = text.trim();

  // Strip a ```json / ``` code fence if present.
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    cleaned = fence[1].trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through to brace extraction.
  }

  // Fallback: pull out the outermost {...} block.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
}

function toCardSuggestion(value: unknown): CardSuggestion | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) return null;
  const rawQuantity = Number(record.quantity);
  const quantity = Number.isFinite(rawQuantity) ? Math.max(1, Math.floor(rawQuantity)) : 1;
  const reason = isNonEmptyString(record.reason) ? record.reason : "LLM suggestion";
  return { name, quantity, reason };
}

function toCardSuggestionArray(value: unknown): CardSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(toCardSuggestion)
    .filter((card): card is CardSuggestion => card !== null);
}

function toMatchupRecommendation(value: unknown): MatchupRecommendation | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const archetype = typeof record.archetype === "string" ? record.archetype.trim() : "";
  const recommendation = typeof record.recommendation === "string" ? record.recommendation.trim() : "";
  if (!archetype || !recommendation) return null;
  const sideboardNotes = typeof record.sideboardNotes === "string" && record.sideboardNotes.trim()
    ? record.sideboardNotes
    : undefined;
  return sideboardNotes === undefined
    ? { archetype, recommendation }
    : { archetype, recommendation, sideboardNotes };
}

/**
 * Validate and coerce an arbitrary LLM-produced value into a
 * {@link MetaAnalysisOutput}. Returns `null` when the shape is structurally
 * unsalvageable so the caller falls back to the heuristic output rather than
 * surfacing malformed content to the user.
 */
export function coerceMetaAnalysisOutput(raw: unknown): MetaAnalysisOutput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const metaOverview = typeof record.metaOverview === "string" ? record.metaOverview.trim() : "";
  const strategicAdvice = typeof record.strategicAdvice === "string" ? record.strategicAdvice.trim() : "";
  if (!metaOverview || !strategicAdvice) return null;

  const deckStrengths = toStringArray(record.deckStrengths);
  const deckWeaknesses = toStringArray(record.deckWeaknesses);

  const matchupAnalysis = Array.isArray(record.matchupAnalysis)
    ? record.matchupAnalysis
        .map(toMatchupRecommendation)
        .filter((m): m is MatchupRecommendation => m !== null)
    : [];

  const cardSuggestionsRecord =
    typeof record.cardSuggestions === "object" && record.cardSuggestions !== null
      ? (record.cardSuggestions as Record<string, unknown>)
      : {};
  const cardsToAdd = toCardSuggestionArray(cardSuggestionsRecord.cardsToAdd);
  const cardsToRemove = toCardSuggestionArray(cardSuggestionsRecord.cardsToRemove);

  // Require at least one substantive, validated section beyond the overview so
  // a bare `{ metaOverview, strategicAdvice }` never displaces the heuristic.
  const hasSubstance =
    matchupAnalysis.length > 0 ||
    cardsToAdd.length > 0 ||
    cardsToRemove.length > 0 ||
    deckStrengths.length > 0 ||
    deckWeaknesses.length > 0;
  if (!hasSubstance) return null;

  const sideboardSuggestions = Array.isArray(record.sideboardSuggestions)
    ? toCardSuggestionArray(record.sideboardSuggestions)
    : undefined;

  const output: MetaAnalysisOutput = {
    metaOverview,
    deckStrengths,
    deckWeaknesses,
    matchupAnalysis,
    cardSuggestions: { cardsToAdd, cardsToRemove },
    strategicAdvice,
  };
  if (sideboardSuggestions && sideboardSuggestions.length > 0) {
    output.sideboardSuggestions = sideboardSuggestions;
  }
  return output;
}

/**
 * Build the system + user messages that ask the LLM for a structured,
 * deck-specific meta analysis grounded in the heuristic snapshot.
 */
function buildMetaLLMMessages(
  input: MetaAnalysisInput,
  heuristic: MetaAnalysisOutput,
): {
  system: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
} {
  const system = [
    "You are an expert Magic: The Gathering metagame analyst.",
    "Produce a STRICT JSON object (no prose, no markdown fences) matching this TypeScript type exactly:",
    "{ metaOverview: string; deckStrengths: string[]; deckWeaknesses: string[];",
    "  matchupAnalysis: { archetype: string; recommendation: string; sideboardNotes?: string }[];",
    "  cardSuggestions: { cardsToAdd: { name: string; quantity: number; reason: string }[];",
    "                     cardsToRemove: { name: string; quantity: number; reason: string }[] };",
    "  sideboardSuggestions?: { name: string; quantity: number; reason: string }[];",
    "  strategicAdvice: string }.",
    "Reference the player's SPECIFIC deck, archetype and cards (never generic boilerplate).",
    "Keep the total quantity of cardsToAdd equal to the total quantity of cardsToRemove.",
    "Output ONLY the JSON object.",
  ].join(" ");

  const grounding = {
    format: input.format,
    focusArchetype: input.focusArchetype ?? null,
    decklist: input.decklist,
    heuristicSnapshot: {
      metaOverview: heuristic.metaOverview,
      deckStrengths: heuristic.deckStrengths,
      deckWeaknesses: heuristic.deckWeaknesses,
      matchupAnalysis: heuristic.matchupAnalysis,
      cardSuggestions: heuristic.cardSuggestions,
    },
  };

  const user = `Analyse this deck's metagame position and return the JSON object.\n\n${JSON.stringify(
    grounding,
    null,
    2,
  )}`;

  return { system, messages: [{ role: "user", content: user }] };
}

/**
 * Try to produce a richer, LLM-generated {@link MetaAnalysisOutput} grounded in
 * the heuristic snapshot. Returns `null` when no provider is configured, every
 * provider fails, or every response fails validation — in all those cases the
 * caller returns the heuristic output unchanged (local-first fallback).
 *
 * Failure policy mirrors the conversational coach (issue #1077): a provider
 * error, model-setup error, or unparseable response advances to the next
 * provider in the failover chain.
 */
async function tryEnrichMetaWithLLM(
  input: MetaAnalysisInput,
  heuristic: MetaAnalysisOutput,
  opts: AnalyzeMetaOptions,
): Promise<MetaAnalysisOutput | null> {
  const chain =
    opts.providers && opts.providers.length > 0
      ? [...opts.providers]
      : getProviderFailoverChain(opts.provider ?? null);
  if (chain.length === 0) return null;

  const isConfigured = opts.isConfigured ?? isProviderConfigured;

  // Local-first: if nothing in the chain is configured, skip the LLM entirely
  // (and avoid importing the `ai` package) so unconfigured deployments behave
  // exactly like the heuristic-only flow.
  if (!chain.some((provider) => isConfigured(provider))) {
    return null;
  }

  const getModel = opts.getModel ?? getAIModel;
  const generate =
    opts.generateText ??
    (async (args: {
      model: unknown;
      system: string;
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      temperature?: number;
      abortSignal?: AbortSignal | null;
    }) => {
      // Lazy import keeps the heavy `ai` package out of the initial bundle and
      // out of client bundles where this branch is never reached (no provider
      // is configured client-side). Mirrors `board-state-vision.ts` (#1022).
      const { generateText } = await import("ai");
      const result = await generateText({
        model: args.model as never,
        system: args.system,
        messages: args.messages,
        temperature: args.temperature,
        ...(args.abortSignal ? { abortSignal: args.abortSignal } : {}),
      });
      return { text: result.text };
    });

  const { system, messages } = buildMetaLLMMessages(input, heuristic);

  for (const provider of chain) {
    if (opts.signal?.aborted) return null;

    // Skip providers without detectable credentials (doomed network calls).
    if (!isConfigured(provider)) continue;

    let model: unknown;
    try {
      model = await getModel(provider, opts.modelId);
    } catch {
      // Model setup failed — try the next provider.
      continue;
    }

    if (opts.signal?.aborted) return null;

    let text: string;
    try {
      const result = await generate({
        model,
        system,
        messages,
        temperature: 0.2,
        abortSignal: opts.signal ?? null,
      });
      text = result.text;
    } catch {
      // Provider errored — fail over to the next provider.
      continue;
    }

    const parsed = extractJsonFromLLM(text);
    const coerced = parsed == null ? null : coerceMetaAnalysisOutput(parsed);
    if (coerced) {
      return coerced;
    }
    // Valid JSON but wrong schema, or empty/unparseable — advance to the next
    // provider; if all are exhausted, the caller falls back to heuristic.
  }

  return null;
}

export async function analyzeMetaAndSuggest(
  input: MetaAnalysisInput,
  opts: AnalyzeMetaOptions = {}
): Promise<MetaAnalysisOutput> {
  // Parse the decklist to get card data
  const lines = input.decklist.split('\n').filter(line => line.trim() !== '');
  const cards: HeuristicCard[] = [];

  // Simple parser
  for (const line of lines) {
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (match) {
      const [, quantity, name] = match;
      cards.push({
        name: name.trim(),
        count: parseInt(quantity, 10),
        // Add placeholder properties to satisfy DeckCard type
        id: crypto.randomUUID(),
        cmc: 0,
        colors: [],
        legalities: {},
        type_line: 'Unknown',
        mana_cost: '{0}',
        color_identity: [],
      });
    }
  }

  // Use heuristic analysis as grounding context AND fallback.
  const heuristicResult = analyzeMetaHeuristic(
    input.decklist,
    input.format,
    cards,
    input.focusArchetype
  );

  // Build the validated heuristic output (legality + rebalance) once; it is the
  // guaranteed local-first fallback when no provider is configured or the LLM
  // fails to produce valid structured output.
  const heuristicOutput = await buildHeuristicOutput(input, heuristicResult);

  // Attempt LLM enrichment; on any failure (no provider, error, parse failure,
  // failover exhausted) return the heuristic output unchanged.
  const enriched = await tryEnrichMetaWithLLM(input, heuristicOutput, opts);
  return enriched ?? heuristicOutput;
}
