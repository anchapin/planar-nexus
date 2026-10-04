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

## Drafting scripts with an LLM

`scripts/draft-card-scripts.ts` drafts scripts for a Standard set or a card
list (#2491):

```sh
DRAFT_LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... DRAFT_LLM_MODEL=<model> \
  npx tsx scripts/draft-card-scripts.ts --set dsk --limit 50
npx tsx scripts/draft-card-scripts.ts --set dsk --dry-run   # no LLM calls
```

`DRAFT_LLM_PROVIDER=openai` with `OPENAI_BASE_URL` works with any
OpenAI-compatible server, including a local Ollama.

- Every reply is checked against the zod schema; failures go in the report and
  are not written.
- When a card needs an effect the schema can't express, the model must answer
  `needs_new_op`. The report tallies these so the most common missing ops are
  first.
- Schema-valid drafts are written to `cards/` and the index is rebuilt. Review
  every draft against the card before merging.
- Few-shot examples come only from this repo's scripts, and every prompt is
  checked for Forge script syntax. Never prompt with or train on Forge scripts.

The **Draft card scripts** workflow (Actions tab) runs the same thing for one
set and opens a draft PR with the report as its body. It needs an
`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` repo secret.
