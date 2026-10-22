# Card scripts

Cards are described as data: a short JSON file per card listing effects from a
small shared vocabulary. The engine resolves a scripted card from its script
instead of parsing oracle text.

The approach is inspired by how Forge scaled to ~28,500 cards with a card
scripting language. No Forge scripts are copied (Forge is GPL-3.0; this repo
is MIT). Every script here is written for this project.

## Format

```json
{
  "name": "Lightning Strike",
  "oracle": "Lightning Strike deals 3 damage to any target.",
  "spell": [{ "op": "DealDamage", "amount": 3, "target": "any" }]
}
```

- `name`: exact English card name.
- `oracle`: the oracle text the script was written against.
- `spell`: effects of an instant or sorcery, applied in order. Targeted effects
  consume the spell's chosen targets in order.

Ops today: `DealDamage`, `Draw`, `GainLife`, `LoseLife`, `CreateToken`,
`Destroy`, `Exile`, `Counter`, `Pump`, `PutCounters`, `Surveil`. Permanents use
`triggers` (`etb` and `landfall` so far) and `activated`. See
`src/lib/game-state/card-scripts/schema.ts`.

## Adding a card

1. Add `src/lib/game-state/card-scripts/cards/<card_name>.json`.
2. Run `npx tsx scripts/build-card-script-index.ts`.
3. Run `npx jest src/lib/game-state/card-scripts`.

New ops go in `schema.ts` and `interpret.ts`, built on existing engine
resolution helpers.

## Tests

Tests are split per op/mechanism under
`src/lib/game-state/card-scripts/__tests__/`, one file per concern (for example
`mill.test.ts`, `scry.test.ts`, `return-from-zone.test.ts`), rather than one
large file (#2642). No file is over ~1,000 lines.

Shared builders (`card`, `put`, `spell`, `cardTarget`, `playerTarget`,
`battlefield`, `id`, `CARDS_DIR`) live in `__tests__/helpers.ts`; import them
from there rather than redefining them locally.

Adding a test for a new op? Put it in the matching per-op file, or create a
new one and register it here. Run the whole group with:

```sh
npx jest src/lib/game-state/card-scripts/__tests__
```

The card-script index (`cards/index.generated.ts`) is generated and gitignored.
Every entry point that runs the engine tests regenerates it first — `pretest`,
`pretypecheck`, `prelint`, `predev`, and `premutate` — so a plain
`npm test` or `npm run mutate:<module>` is fine from a clean clone.

## Drafting scripts with an LLM

`scripts/draft-card-scripts.ts` drafts scripts for a Standard set or a card
list (#2491):

```sh
GEMINI_API_KEY=... npx tsx scripts/draft-card-scripts.ts --set dsk --limit 50
npx tsx scripts/draft-card-scripts.ts --set dsk --dry-run   # no LLM calls
```

The default provider is `gemini-batch` with `gemini-3.1-flash-lite`, the
bake-off winner (#2514: 29/30 new cards right, no false drafts, about $0.18
per 1,000 cards). The whole set goes in one Batch API job, which can take a
while; if it outlives the timeout, rerun with `--gemini-batch batches/...`
(same set and `--limit`) to collect it. `DRAFT_LLM_MODEL` picks another
Gemini model.

`DRAFT_LLM_PROVIDER=anthropic` (`ANTHROPIC_API_KEY`) or `openai`
(`OPENAI_API_KEY`, plus `OPENAI_BASE_URL` for any OpenAI-compatible server,
including a local Ollama) call one card at a time and need `DRAFT_LLM_MODEL`.

- Every reply gets a mechanical clean-up first (echoed card fields dropped,
  `{T}` moved from the mana cost to `tap`, `subject` dropped on events that
  ignore it), then is checked against the zod schema; failures go in the
  report and are not written.
- When a card needs an effect the schema can't express, the model must answer
  `needs_new_op`. The report tallies these so the most common missing ops are
  first.
- Schema-valid drafts are written to `cards/` and the index is rebuilt. Review
  every draft against the card before merging.
- Few-shot examples come only from this repo's scripts, and every prompt is
  checked for Forge script syntax. Never prompt with or train on Forge scripts.

The **Draft card scripts** workflow (Actions tab) runs the same thing for one
set and opens a draft PR with the report as its body. Only the repo owner can
run it, and its keys (`GEMINI_API_KEY`, or `ANTHROPIC_API_KEY` /
`OPENAI_API_KEY`) live in the `llm-spend` environment.
