/**
 * @fileOverview Deterministic intent classification for the conversational AI
 * coach (issue #1387).
 *
 * Before the coach assembles its system prompt, the latest user turn is
 * classified into one of a small, documented set of coaching intents. This
 * gives the route a deterministic signal to (a) tune tier-specific response
 * guidance and (b) surface the detected intent in telemetry/tests — instead of
 * relying solely on the LLM inferring the task from a generic prompt.
 *
 * Design goals:
 *   - **Deterministic & dependency-free.** No ML model, no network call; pure
 *     regex signal matching so behaviour is fully testable and auditable.
 *   - **Confidence-scored with safe fallback.** Every result carries a
 *     `[0,1]` confidence and the list of signals that fired. Below a
 *     documented threshold the classifier returns `unknown` rather than
 *     guessing, so the prompt falls back to the generic coach guidance.
 *   - **Sanitization-first.** Callers must sanitize the message *before*
 *     classifying (issue #1107). The classifier never sees raw injection
 *     payloads because {@link sanitizeUserInput} redacts them upstream. This
 *     module re-applies a light control-char strip defensively but does not
 *     duplicate the full injection-redaction pass.
 *   - **Server-authoritative.** The route ignores any client-supplied
 *     `intent` field; classification always runs server-side on the latest
 *     user turn.
 */

/**
 * The supported coaching intents. `unknown` is the low-confidence fallback:
 * the prompt assembly layer treats it as "no specific intent detected" and
 * emits the generic coach guidance instead of intent-specific routing.
 *
 * The values are the canonical identifiers used in the sanitized intent block
 * injected into the system prompt and in telemetry.
 */
export type CoachIntent =
  | "analyze"
  | "wincon"
  | "cut"
  | "swap"
  | "card-analysis"
  | "sideboard"
  | "mulligan"
  | "rules"
  | "matchup"
  | "meta"
  | "unknown";

/**
 * Optional context that can sharpen classification. Currently only
 * `deckCardNames` is consulted (to promote a bare card-name mention toward
 * `card-analysis`). All fields are optional and unknown/empty context is
 * always safe.
 */
export interface CoachIntentContext {
  format?: string;
  archetype?: string;
  /** Lowercased card names currently in the deck, for card-name heuristics. */
  deckCardNames?: readonly string[];
}

/**
 * Result of classifying a single user message.
 */
export interface CoachIntentResult {
  intent: CoachIntent;
  /** `[0,1]` — 0 means no signal matched, 1 means strong/agreement. */
  confidence: number;
  /** Human-readable labels of the signals that fired, for telemetry/tests. */
  matchedSignals: string[];
}

/**
 * A single signal: a case-insensitive regex plus a weight and a label.
 * Weights are tuned so that *one* clear phrasal match is enough to clear the
 * confidence threshold, while ambiguous single-word matches need corroboration.
 */
interface IntentSignal {
  pattern: RegExp;
  weight: number;
  label: string;
}

// All patterns are compiled case-insensitive. Word boundaries (`\b`) are used
// liberally to avoid sub-word false positives ("cut" inside "execute").
const SIGNALS: Record<Exclude<CoachIntent, "unknown">, IntentSignal[]> = {
  analyze: [
    {
      label: "analyze/review",
      weight: 1,
      pattern:
        /\b(?:analy[sz]e|review|overview|assess|assessment|critique|evaluate the deck|how(?:'s| is) (?:my|the) deck (?:looking|doing|look|do)|what do you think|thoughts on (?:my |the )?deck|give me feedback|deck review)\b/i,
    },
    {
      label: "strengths/weaknesses",
      weight: 1,
      pattern:
        /\b(?:strengths and weaknesses|pros and cons|what(?:'s| is) (?:good|bad|wrong) (?:about |with )?(?:my |the )?deck|how can i improve (?:my |the )?deck)\b/i,
    },
  ],
  wincon: [
    {
      label: "win-condition",
      weight: 1.5,
      pattern:
        /\b(?:win condition|wincon|win con|how do(?:es|) (?:this|my) deck win|how do i win|primary win|alternate win|alternate win condition|finisher|closer|kill condition)\b/i,
    },
    {
      label: "game-plan",
      weight: 1,
      pattern:
        /\b(?:what(?:'s| is) (?:my |the )?(?:game ?plan|path to victory|route to winning|endgame))\b/i,
    },
  ],
  cut: [
    {
      label: "cut/remove",
      weight: 1.5,
      pattern:
        /\b(?:(?:what |which |any )?(?:should |can |to |may )?i (?:cut|remove|drop|take out)|what to cut|cards? to cut|cards? to remove|take out|trim (?:down|from)|drop from|what(?:'s| is) the weakest|worst (?:card|cards|include)|cut (?:this|that|some|any|it|them))\b/i,
    },
    {
      label: "cuts-suggestion",
      weight: 1,
      pattern:
        /\b(?:cut suggestions|removal suggestions|which cards? (?:are|seem) weakest|what(?:'s| is) underperforming|dead weight|making room for)\b/i,
    },
  ],
  swap: [
    {
      label: "swap/add",
      weight: 1.5,
      pattern:
        /\b(?:what should i add|cards? to add|additions?|upgrades?|what (?:can|should) i (?:swap|include|bring in)|better (?:card|cards|option|options)|replacements?|substitutes?|what would you (?:add|swap in))\b/i,
    },
    {
      label: "swap-in-for",
      weight: 1,
      pattern:
        /\bswap (?:in|out)|replace .{0,40} (?:with|for)|sidegrade\b/i,
    },
  ],
  "card-analysis": [
    {
      label: "card-evaluation",
      weight: 1.5,
      pattern:
        /\b(?:is [a-z][a-z' -]{1,40} (?:good|worth it|worth including|worth running)(?: here| in this deck| in here)?|how (?:good|bad) is [a-z][a-z' -]{1,40}(?: here| in this deck)?|should i (?:run|play|include|keep) [a-z][a-z' -]{1,40}(?: here| in this deck)?|evaluate [a-z][a-z' -]{1,40})\b/i,
    },
    {
      label: "card-role",
      weight: 1,
      pattern:
        /\b(?:what(?:'s| is) [a-z][a-z' -]{1,40} (?:for|doing (?:here|in this deck)|role)|why [a-z][a-z' -]{1,40} (?:here|in this deck)|how does [a-z][a-z' -]{1,40} fit)\b/i,
    },
  ],
  sideboard: [
    {
      label: "sideboard",
      weight: 1.5,
      pattern:
        /\b(?:side ?board|sideboarding|board (?:in|out)|post-?board|pre-?board|hate (?:card|pieces?)|silver bullet|answer to .{0,30} (?:from the board|sideboard))\b/i,
    },
    {
      label: "sideboard-build",
      weight: 1,
      pattern:
        /\b(?:what (?:to|should i) put in (?:my |the )?sideboard|sideboard (?:plan|slots|guide|recommendations?))\b/i,
    },
  ],
  mulligan: [
    {
      label: "mulligan",
      weight: 1.5,
      pattern:
        /\b(?:mulligan|mull|should i keep|keep or|keep this hand|opening hand|draw seven|keep (?:this|that)|is this (?:hand|keep) (?:good|keepable))\b/i,
    },
    {
      label: "hand-advice",
      weight: 1,
      pattern:
        /\b(?:should i (?:keep|mull) (?:this|my (?:hand|opener))|is my opener (?:good|keepable|worth keeping))\b/i,
    },
  ],
  rules: [
    {
      label: "rules-question",
      weight: 1.5,
      pattern:
        /\b(?:how do(?:es|) (?:this|that|the stack|priority) work|can i .{0,40} (?:in response|at instant speed)|am i allowed to|is it legal to|does .{0,40} trigger|what happens when|stack (?:resolve|priority)|ruling(?:s)?|interaction between|timing (?:rule|rules)|layer system|state-based action)\b/i,
    },
    {
      label: "rules-mechanics",
      weight: 1,
      pattern:
        /\b(?:how does .{0,30} (?:resolve|work mechanically)|rule question|rules clarification|step by step)\b/i,
    },
  ],
  matchup: [
    {
      label: "matchup",
      weight: 1.5,
      pattern:
        /\b(?:matchup|match up|match-?up|versus|against (?:aggro|control|combo|burn|midrange|ramp|tempo|mill)|how do i (?:beat|beat this|beat that deck|play against)|how to beat|what beats|favored (?:against|vs)|unfavou?rable|unwinnable)\b/i,
    },
    {
      label: "opponent-deck",
      weight: 1,
      pattern:
        /\b(?:playing against .{0,30}|sideboard (?:guide|plan) (?:vs|against)|how does this deck do (?:against|vs))\b/i,
    },
  ],
  meta: [
    {
      label: "meta-positioning",
      weight: 1.5,
      pattern:
        /\b(?:meta(?:game)?|meta (?:call|choice|positioning)|metagame (?:breakdown|share|analysis)|what(?:'s| is) (?:being played|the best deck)|top (?:deck|decks|tier)|tier list|format breakdown|positioning)\b/i,
    },
    {
      label: "meta-call",
      weight: 1,
      pattern:
        /\b(?:is this deck (?:meta|viable|competitive|good right now)|meta (?:relevance|fit)|should i (?:play|bring) this (?:to|at) (?:a |the )?(?:tournament|fnm|event))\b/i,
    },
  ],
};

/**
 * Score at which confidence saturates to 1.0. Tuned so that a single
 * weight-1 phrasal match yields ~0.67 confidence (clearly above the
 * threshold) and a weight-1.5 match yields 1.0. This keeps classification
 * responsive without over-committing on a single ambiguous keyword.
 */
const CONFIDENCE_FULL = 1.5;

/**
 * Minimum confidence to report a non-`unknown` intent. Below this the
 * classifier falls back to `unknown` so the prompt layer emits generic coach
 * guidance instead of mis-routing. Documented here so the threshold is
 * discoverable in tests and telemetry.
 */
export const MIN_CONFIDENCE = 0.35;

/**
 * Defensive strip of control/formatting characters that survived the upstream
 * {@link sanitizeUserInput} pass (e.g. if classification is ever called on
 * unsanitized input). Newlines collapse to spaces so multi-word signals match
 * across line breaks.
 */
function normalizeForClassification(text: unknown): string {
  const str = typeof text === "string" ? text : text == null ? "" : String(text);
  return str
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u200B-\u200D\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classify a (already-sanitized) coach chat message into a supported intent.
 *
 * The function is pure and deterministic: identical inputs always yield
 * identical outputs. When `context.deckCardNames` is provided, a bare mention
 * of a card that is *in the deck* — with no other intent firing strongly — is
 * promoted toward `card-analysis`, matching the natural pattern "so, ragavan?"
 *
 * @param message The latest user turn. Callers should sanitize this via
 *   {@link sanitizeUserInput} first (issue #1107).
 * @param context Optional deck/format context for disambiguation.
 * @returns A {@link CoachIntentResult} with the best intent, a `[0,1]`
 *   confidence, and the labels of signals that fired. Returns `unknown` when
 *   no intent clears {@link MIN_CONFIDENCE}.
 */
export function classifyCoachIntent(
  message: unknown,
  context: CoachIntentContext = {},
): CoachIntentResult {
  const text = normalizeForClassification(message);

  if (!text) {
    return { intent: "unknown", confidence: 0, matchedSignals: [] };
  }

  let bestIntent: Exclude<CoachIntent, "unknown"> | null = null;
  let bestScore = 0;
  let bestSignals: string[] = [];
  let secondScore = 0;

  for (const intent of Object.keys(SIGNALS) as Array<
    Exclude<CoachIntent, "unknown">
  >) {
    const signals = SIGNALS[intent];
    let score = 0;
    const fired: string[] = [];
    for (const sig of signals) {
      if (sig.pattern.test(text)) {
        score += sig.weight;
        fired.push(sig.label);
      }
    }
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestIntent = intent;
      bestSignals = fired;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  // Card-name-in-deck heuristic: a bare mention of a card that is in the
  // deck, with no clearly stronger intent, is likely "tell me about this
  // card's role here". Only promote when nothing else cleared the full
  // threshold, to avoid stealing a real cut/wincon/etc. classification.
  if (
    bestScore < CONFIDENCE_FULL &&
    context.deckCardNames &&
    context.deckCardNames.length > 0
  ) {
    const lower = text.toLowerCase();
    const hitCard = context.deckCardNames.some(
      (name) => name.length > 3 && lower.includes(name.toLowerCase()),
    );
    if (hitCard) {
      bestIntent = "card-analysis";
      bestScore = Math.max(bestScore, 1);
      bestSignals = bestSignals.length
        ? bestSignals
        : ["deck-card-mention"];
    }
  }

  if (bestIntent === null || bestScore <= 0) {
    return { intent: "unknown", confidence: 0, matchedSignals: [] };
  }

  // Confidence: saturate at CONFIDENCE_FULL, discounted slightly when a close
  // runner-up also fired (ambiguity). The discount keeps genuinely ambiguous
  // questions from reporting over-confident single intents.
  const rawConfidence = Math.min(1, bestScore / CONFIDENCE_FULL);
  const ambiguityDiscount =
    secondScore > 0 ? (secondScore / bestScore) * 0.25 : 0;
  const confidence = Math.max(0, rawConfidence - ambiguityDiscount);

  if (confidence < MIN_CONFIDENCE) {
    return { intent: "unknown", confidence, matchedSignals: bestSignals };
  }

  return {
    intent: bestIntent,
    confidence: Math.round(confidence * 1000) / 1000,
    matchedSignals: bestSignals,
  };
}

/**
 * Human-readable label for each intent, used in the sanitized intent block
 * injected into the system prompt. Kept separate from the canonical id so the
 * prompt-facing copy can be tuned without touching the classifier values.
 */
export const COACH_INTENT_LABELS: Record<CoachIntent, string> = {
  analyze: "Deck analysis / review",
  wincon: "Win condition",
  cut: "Card cuts",
  swap: "Card additions / swaps",
  "card-analysis": "Specific card evaluation",
  sideboard: "Sideboard guidance",
  mulligan: "Mulligan / opening hand advice",
  rules: "Rules clarification",
  matchup: "Matchup analysis",
  meta: "Meta / metagame positioning",
  unknown: "General coaching (no specific intent detected)",
};
