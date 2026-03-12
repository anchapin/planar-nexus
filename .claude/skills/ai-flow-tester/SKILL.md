---
name: ai-flow-tester
description: Test and validate Genkit AI flows with sample inputs
disable-model-invocation: false
argument-hint: "[flow-name] [--input FILE] [--compare-output] [--prompt PROMPT]"
allowed-tools: Bash, Read, Write, Edit, Glob
---

# AI Flow Tester

Test and validate Genkit AI flows for the Planar Nexus deck coach and opponent generation systems.

## Usage

### Test a specific flow
```bash
/ai-flow-tester ai-deck-coach-review
```

### Test with custom input file
```bash
/ai-flow-tester ai-opponent-deck-generation --input test-deck.json
```

### Test with custom prompt
```bash
/ai-flow-tester ai-deck-coach-review --prompt "Analyze this Modern deck: 4x Ragavan, 4x Lightning Bolt..."
```

### Compare output against expected schema
```bash
/ai-flow-tester ai-deck-coach-review --compare-output
```

## Available Flows

Located in `/src/ai/flows/`:

1. **ai-deck-coach-review** - Analyzes decklists and generates strategic suggestions
   - Input: Decklist with card names and quantities
   - Output: Strategic analysis, suggestions, weakness identification

2. **ai-opponent-deck-generation** - Creates AI opponent decks
   - Input: Format, difficulty level, archetype preferences
   - Output: Generated decklist matching criteria

## Workflow

### 1. Flow Discovery
- Lists all available flows in `/src/ai/flows/`
- Reads flow configuration to understand input/output schemas

### 2. Test Execution
- Runs the Genkit flow with test input
- Captures output and validates against Zod schema
- Reports any errors or validation failures

### 3. Output Analysis
- Displays structured output
- Compares against expected schema (if --compare-output)
- Highlights any missing or malformed fields

### 4. Iteration
- Allows prompt refinement
- Re-runs flow with adjusted parameters
- Tracks improvements across iterations

## Test Input Templates

### Deck Coach Review Test Input
```json
{
  "decklist": "4x Ragavan, Nimble Pilgrim\n4x Lightning Bolt\n4x Murktide Regent\n...",
  "format": "Modern",
  "focus": "overall"
}
```

### Opponent Deck Generation Test Input
```json
{
  "format": "Modern",
  "difficulty": "intermediate",
  "archetype": "aggro",
  "colorIdentity": "red"
}
```

## Validation Checks

- ✅ Flow executes without errors
- ✅ Output matches Zod schema
- ✅ Response time < 10 seconds
- ✅ Structured output is valid JSON
- ✅ All required fields present

## Error Handling

- **Flow not found**: Lists available flows and suggests closest match
- **Schema validation error**: Shows which fields failed and why
- **Timeout**: Retries with exponential backoff (max 3 attempts)
- **API rate limit**: Waits and retries after delay

## Examples

### Quick smoke test
```bash
/ai-flow-tester ai-deck-coach-review --prompt "4x Lightning Bolt, 4x Lava Spike, 20x Mountain"
```

### Full validation with schema check
```bash
/ai-flow-tester ai-opponent-deck-generation --input src/ai/flows/test-inputs/opponent-deck.json --compare-output
```

### Iterative prompt tuning
```bash
/ai-flow-tester ai-deck-coach-review --prompt "Analyze this Legacy Storm deck..."
# Review output, then refine:
/ai-flow-tester ai-deck-coach-review --prompt "Analyze this Legacy Storm deck. Focus on combo consistency and mana base optimization."
```

## Integration

### Genkit Configuration
Flows are configured in `/src/ai/genkit.ts`:
- Model: `gemini-1.5-flash-latest`
- Plugin: Google AI

### Server Actions
Flows are invoked via server actions in `/src/app/actions.ts` with `'use server'` directive.

## Troubleshooting

### Flow returns empty output
- Check input format matches expected schema
- Verify API key is set in `.env`
- Increase model temperature for more creative outputs

### Schema validation fails
- Review Zod schema in flow file
- Check for missing required fields in output
- Update flow prompt to be more explicit about output format

### Rate limiting
- Add retry logic with exponential backoff
- Cache common test inputs
- Use `--delay` flag between rapid tests
