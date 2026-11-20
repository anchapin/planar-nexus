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

### The review pipeline (no key, no network)

`scripts/card-scripts/pipeline-lib.ts` is the review-only half of the
pipeline: it takes a card list, asks a model for one JSON script per card,
checks every answer against the zod schema and writes the result to a review
directory. The model is reached through a `ModelClient` interface
(`draft(prompt) => reply`), so the same code runs with the deterministic
stub and with a real model.

Four things can come out of a run, one per card:

- **drafted**: the reply validated against `CardScriptSchema`, so the script
  is written as `drafts/<card>.json`.
- **invalid**: the reply was not valid JSON or not a valid script. It is
  logged in `failures.json` and **nothing is written** for that card.
- **needs new op**: the card has an effect the op-set can't express, so the
  model refused (`{"needs_new_op": [...]}`). The refusal is recorded, and no
  script is guessed for it.
- **skipped**: the card was not drafted at all (already scripted, no
  abilities beyond keywords, unsupported card type).

Run it over the hand-written sample cards with the stub model:

```sh
npx tsx scripts/draft-card-scripts.ts \
  --input scripts/data/card-scripts-sample-cards.json \
  --out draft-out --model stub
```

The sample list (`scripts/data/card-scripts-sample-cards.json`) covers a card
the ops cover, a card with an effect they don't ("As an additional cost to
cast Soul Snare, exile a card from your hand."), and a card the stub answers
with broken JSON. The stub's canned replies are in
`scripts/data/card-scripts-sample-stub-replies.json`; point `--stub-replies`
at another file to use your own.

Output layout (`--out`, default `draft-out/`, which is gitignored):

```
draft-out/
  drafts/<card>.json   one schema-valid draft per card
  run-summary.json     drafted / failed / needs-new-op counts and lists
  failures.json        the failure log (invalid drafts; nothing was written)
  needs-new-op.json    one record per refused card
  missing-ops.json     the missing-ops list: the uncovered effects, most
                       common first, with the cards that need them
```

**Alex runs it with a real model.** The stub is the default; a real
provider is selected with `--model` and configured with environment
variables only (never in the repo, never in a log):

```sh
DRAFT_LLM_MODEL=<model id> ANTHROPIC_API_KEY=... npx tsx scripts/draft-card-scripts.ts \
  --input scripts/data/card-scripts-sample-cards.json --out draft-out --model anthropic
DRAFT_LLM_MODEL=<model id> OPENAI_API_KEY=... OPENAI_BASE_URL=... npx tsx scripts/draft-card-scripts.ts \
  --input scripts/data/card-scripts-sample-cards.json --out draft-out --model openai
```

`DRAFT_LLM_MODEL` names the model, `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
are the provider keys and `OPENAI_BASE_URL` points at any OpenAI-compatible
server (a local Ollama, for instance). Those calls cost money, so they are
the owner's to make: the keys live in the `llm-spend` environment and the
set-mode run (the **Draft card scripts** workflow) is the normal way to
spend them.

**The review rule.** Every draft is a proposal: check it against the card
before it goes anywhere. The pipeline never writes into the game's script
corpus (`src/lib/game-state/card-scripts/cards/`) — it refuses to — and
nothing merges unreviewed. A draft only becomes a card script when a human
moves it there, after reading the card.

The prompt is built from the repo's own op-set description
(`buildSystemPrompt` in `scripts/card-scripts/draft-lib.ts`), the same text
the SFT and DPO exports use, and the card's oracle text is the user
message. Every prompt is checked for Forge script syntax; Forge scripts are
never used as examples or as training data.

Tests: `npx jest tests/card-scripts-pipeline.test.ts`.

## Fine-tuning dataset (#2551)

Every accepted script is an oracle-text -> script-JSON pair, so the whole
card-script corpus can be exported as SFT data:

```sh
npx tsx scripts/export-card-script-dataset.ts [--out dataset-out] [--dry-run]
```

It writes two ETF files (brewery-ai's "Empero Trace Format", one JSON object
per line):

- `train.jsonl`: every accepted card script.
- `eval.jsonl`: the 20-card #2514 bake-off gold set
  (`scripts/data/bakeoff-cards.json`), held out of training.

Each record is an ETF trace: `system` is the drafting prompt's op-set
description (the same text `scripts/card-scripts/draft-lib.ts` sends to the
model), `user` is the oracle text and `assistant` is the script JSON, which
validates against `CardScriptSchema`. The export fails loudly if a gold card
reaches the training file. The output is a local artifact and is not
committed (`dataset-out/` is gitignored).

The SFT run plan and cost estimate for the fine-tuning step are in
[`docs/card-scripts/sft-run-plan.md`](card-scripts/sft-run-plan.md). It is a
plan only: no training run has happened, and it needs Alex's approval before
any GPU is rented or used.

### Preference pairs for DPO (#2551, step 2)

SFT data teaches the model what a good script looks like; DPO data teaches
it what a _bad_ answer looks like, by putting the two side by side. A
drafting run produces both, so the run can be exported as preference pairs:

```sh
npx tsx scripts/export-card-script-preferences.ts \
  [--drafts scripts/data/card-script-drafts.json] [--out dataset-out] [--dry-run]
```

It writes one file:

- `preferences.jsonl`: one DPO pair per card that has both a good and a
  bad answer.

Each record is the step-1 ETF record plus the two answers:

```json
{
  "etf": 1,
  "id": "shock",
  "system": "<the drafting prompt's op-set description>",
  "user": "<the oracle text>",
  "chosen": "<the answer we want>",
  "rejected": "<the answer we don't>",
  "messages": [{ "role": "user", "content": "<the oracle text>" }],
  "meta": {
    "source": "local:card-script-drafts",
    "license": "MIT",
    "tags": ["card-scripts", "dpo", "train"],
    "card": "Shock",
    "expect": "draft",
    "chosen_source": "arm-a",
    "rejected_source": "arm-b"
  }
}
```

The `system` prompt is the same op-set description the SFT export uses and
the `user` prompt is the same oracle text, so the SFT and DPO data agree on
what a prompt and a good answer look like. The `chosen` side of a draft pair
is the bare script object, byte-for-byte the same shape as the step-1
`assistant` turn.

Two kinds of pair come out of a run:

- **draft cards**: `chosen` is the schema-valid draft, `rejected` is the
  invalid (or false) draft the same run also produced.
- **needs-new-op cards**: `chosen` is the explicit refusal
  (`{"needs_new_op": [...]}`), `rejected` is the forced/guessed script the
  model wrote instead of refusing.

Which reply is good is decided by the repo's own validator
(`CardScriptSchema`, plus the drafting pipeline's mode and spell/permanent
checks) — never by a label stored in the source file. The source only says
which cards are meant to be drafted and which are meant to be refused.
The gold set (`scripts/data/bakeoff-cards.json`) never reaches a training
pair, the export fails loudly on a malformed draft log or a malformed pair,
and cards that produce no pair are reported with the reason.

#### The data source: a draft log

The source is the **draft log**: the raw replies of a drafting run, one entry
per card. `scripts/card-scripts/preference-lib.ts` reads it and pairs the
replies.

```json
{
  "cards": [
    {
      "name": "Shock",
      "oracle_text": "Shock deals 2 damage to any target.",
      "type_line": "Instant",
      "expect": "draft",
      "replies": [
        { "source": "arm-a", "reply": "{\"script\": {...}}" },
        { "source": "arm-b", "reply": "{\"script\": {...}}" }
      ]
    },
    {
      "name": "Glimmerburst",
      "oracle_text": "...",
      "expect": "needs_new_op",
      "replies": [
        { "source": "arm-a", "reply": "{\"needs_new_op\": [\"...\"]}" }
      ]
    }
  ]
}
```

A worked example of the format (fixture replies, including a gold card
that must be held out) is committed at
`scripts/data/preference-draft-log.example.json`; run the export with
`--drafts scripts/data/preference-draft-log.example.json --dry-run` to see
the pairing and skip report without writing anything.

**No real draft log exists in this repo yet.** `scripts/draft-card-scripts.ts`
and `scripts/card-script-bakeoff.ts` keep only the _judged outcome_ of a
reply (the script, the list of missing ops, or the schema errors) and drop
the reply itself, so the rejected drafts of a past run cannot be recovered;
the committed reports under `docs/card-scripts/drafts/` list card names and
error strings only. The pairing above is therefore exercised against the
repo's own validator and fixture replies
(`tests/card-script-preferences.test.ts`), and **live pair generation waits
for a drafting run that persists its raw replies** (a `drafts.json` in the
format above). Until then the export has nothing to pair: with no draft log at
all it fails with a clear message, and with a log that has no cards it
writes an empty `preferences.jsonl`.
