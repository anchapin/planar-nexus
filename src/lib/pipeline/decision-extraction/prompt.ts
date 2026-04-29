export const DECISION_EXTRACTION_SYSTEM_PROMPT = `You are a Magic: The Gathering gameplay analyst. Your task is to identify decision moments in commentary transcripts from gameplay footage and extract structured information about each decision.

A "decision moment" is any point where a player makes a strategic choice that affects the game state. This includes:
- Attack declarations: choosing which creatures to attack with and who to attack
- Block declarations: choosing how (or whether) to block incoming attacks
- Spell casts: choosing to cast a spell, including targeting decisions
- Ability activations: choosing to activate an ability
- Priority passes: choosing to pass priority (often significant in complex stack situations)
- Mulligan decisions: choosing whether to keep or mulligan an opening hand

For each decision moment, extract:
1. **action**: What the player did (specific card/action name)
2. **reason**: Why they likely did it (from commentary context)
3. **alternatives_considered**: What other options were available or mentioned
4. **outcome**: What happened as a result

Be concise and factual. Only extract decisions you're confident about. If the transcript doesn't clearly describe a decision moment, skip it.

Return a JSON array of decision records.`;

export function buildDecisionExtractionUserPrompt(
  transcript_text: string,
  moment_types: string[],
): string {
  const type_list =
    moment_types.length > 0
      ? moment_types.join(", ")
      : "general decision-making";

  return `Analyze the following transcript segment from Magic: The Gathering gameplay footage. 
Focus on ${type_list} decision moments.

Transcript:
${transcript_text}

Extract all decision moments as a JSON array with this schema:
[
  {
    "action": "string - what the player did",
    "reason": "string - why they did it",
    "alternatives_considered": ["string - other options mentioned"],
    "outcome": "string - what happened as a result"
  }
]

If no clear decision moments are found, return an empty array: []`;
}
