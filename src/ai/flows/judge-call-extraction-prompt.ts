/**
 * Judge-Call Extraction Prompt — fixture-generation tooling (Issue #1816)
 *
 * Relocated from `src/lib/game-state/judge-call-extraction-prompt.ts` so the
 * rules-engine directory no longer contains LLM prompt text. The prompt is
 * pure AI/tooling data: it is fed to an LLM alongside a tournament-coverage
 * transcript segment to produce JudgeCallSegment-compatible JSON, which then
 * feeds the engine's judge-call edge-case fixtures (see
 * `src/lib/game-state/judge-call-edge-cases.ts`).
 *
 * The rules-engine boundary (`src/lib/game-state/`) is exported only through
 * its barrel and is the mutation-tested correctness core; LLM prompt strings
 * invite edits from the AI-tooling side of the repo for no rules reason, and
 * every such edit touches the directory whose merge gate is the strictest.
 *
 * `scripts/check-no-prompt-in-engine.mjs` is the regression guard: a CI gate
 * that fails the build if any prompt-style string ("You are a " or similar
 * role signatures) is reintroduced under `src/lib/game-state/`.
 *
 * Issue #682 - Brainstorm §10 example prompt
 */

export const JUDGE_CALL_EXTRACTION_PROMPT = `You are a Magic: The Gathering rules analyst. Given a transcript segment from tournament coverage, extract any judge-call or rules dispute information into structured JSON.

## Input
A transcript segment from a Magic: The Gathering tournament broadcast (YouTube, Twitch, etc.).

## Task
Identify any segments where players call a judge, dispute a rule, or question an interaction. For each segment found, produce a JSON object with these fields:

- id: "jc-XXX" (unique identifier)
- source: Description of the broadcast source
- keywordTrigger: Which keyword triggered detection ("call a judge", "judge!", "rules question", "actually that's wrong", "wait, that shouldn't work", or similar)
- gameStateDescription: Detailed description of the board state and game situation at the time of the judge call
- ruleInQuestion: The specific rule or mechanic being disputed
- correctRuling: The correct ruling according to the Comprehensive Rules, with CR references
- cards: Array of card names involved in the interaction
- interactionType: One of: "state-based-action", "combat", "stack", "priority", "replacement-effect", "mana", "layer-system", "spell-casting", "ability", "zones", "commander-damage", "turn-phases"
- crReference: Comprehensive Rules reference(s) (e.g., "CR 702.2c")

## Output Format
Return a JSON array of extracted segments. If no judge calls are found, return an empty array.

## Keywords to Search For
- "call a judge"
- "judge!"
- "rules question"
- "actually that's wrong"
- "wait, that shouldn't work"
- "that doesn't work"
- "I need a judge"
- "can I get a judge"
- "ruling"
- "how does that work"
- "appeal"

## Rules References
Always cite the specific Comprehensive Rules (CR) sections. Common relevant sections:
- CR 117: Priority
- CR 601-605: Casting Spells, Abilities
- CR 606: Loyalty Abilities
- CR 609: Effects
- CR 613: Layer System
- CR 614-616: Replacement/Prevention Effects
- CR 701: Regeneration
- CR 702: Keyword Abilities
- CR 704: State-Based Actions
- CR 709: Split Cards
- CR 903: Commander Format
- CR 506-511: Combat

## Important Guidelines
1. Be precise about game state - include life totals, mana available, card positions when mentioned
2. The correct ruling must be based on official MTG Comprehensive Rules, not player opinions
3. Map to the most specific interaction type
4. Include ALL cards mentioned in the interaction
5. If the ruling outcome is ambiguous from the transcript, note it as "pending-review"
`;
