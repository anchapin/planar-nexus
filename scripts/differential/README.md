# Differential rules scenarios (engine-neutral format)

This folder holds the **engine-neutral scenario format** and the **planar-nexus
runner** for differential rules testing (issue #2411, steps 1 and 2).

The point of the format is that the *same* JSON file can be executed by
planar-nexus and by a second, reference engine (Forge), and the two engines'
observable outcomes compared. To keep that possible:

* cards are referenced by **exact English card name** — never by an engine
  internal id, a database row id or a deck index;
* every value is a plain JSON value (no functions, no engine types);
* a scenario never names a *rule*: it names a board, a sequence of actions and
  the fields to observe. The rules-derived expectation lives in a separate
  `expect` block so the two engines can be compared against each other as well
  as against it.

Only **outcomes** live in this repo. No card scripts, no rules text and no
other engine's code are vendored here (see *Licensing* below).

---

## Files

| File | Purpose |
| --- | --- |
| `scenario.ts` | The TypeScript types of the format (source of truth). |
| `validate.ts` | The matching Zod schema + `loadScenarioFile()`; rejects a malformed file before it reaches the engine. |
| `planar-nexus-runner.ts` | Runs a scenario through the planar-nexus engine (`@/lib/game-state` barrel) and returns a normalised outcome. |
| `run-planar-nexus.ts` | CLI: runs every scenario, prints one row per scenario and dumps the outcome JSON. |
| `diff.ts` | Compares an outcome against a scenario's `expect` block or against another engine's outcome file. |
| `cards.snapshot.json` | Card data (Scryfall) for the cards the scenarios mention, so the runner never touches the network. |
| `scenarios/*.json` | The seeded scenarios. |

## Running

```bash
# every seeded scenario: one row per scenario on stderr, outcome JSON on stdout
npx tsx scripts/differential/run-planar-nexus.ts

# a subset, writing the outcome JSON to a file
npx tsx scripts/differential/run-planar-nexus.ts scripts/differential/scenarios/raid-searslicer-goblin.json --out outcomes.json

# compare this engine's outcomes against another engine's outcome file
npx tsx scripts/differential/run-planar-nexus.ts --compare forge-outcomes.json
```

The runner is **deterministic**: same scenario file + same card snapshot ⇒
same outcome JSON, byte for byte. It is headless — no React, no browser, no
network — so it runs in CI.

Exit code `0` means every scenario ran; a scenario whose engine run reported
an error is reported as a mismatch, not silently skipped.

---

## The scenario format

A scenario is one JSON object. Every key is optional except `id`,
`description` and `players`.

```jsonc
{
  "id": "raid-searslicer-goblin",      // unique id, also the row label
  "description": "…",                   // one line, shown in the CLI table
  "refs": "#2408",                      // issue/PR this scenario guards
  "activePlayer": 0,                    // default 0
  "phase": "precombat_main",            // default precombat_main
  "players": [ /* exactly two */ , /* exactly two */ ],
  "actions": [ /* the action sequence, in order */ ],
  "observe": ["life", "battlefield"],   // default: every observed field
  "expect": [ /* expected outcome for player 0 */, /* …player 1 */ ],
  "expectStack": ["Shock"]              // expected stack contents, as a SET
}
```

### `players[]`

Exactly two players, index 0 and 1. Player 0 is the active player unless
`activePlayer` says otherwise.

| Key | Meaning |
| --- | --- |
| `life` | Starting life total (default 20). |
| `battlefield[]` | Permanents on the battlefield: `{ card, id?, tapped?, summoningSick?, counters? }`. `card` is the exact English name; `id` is an optional label other actions/targets can refer to; `counters` maps a counter type (e.g. `"+1/+1"`) to a count. |
| `hand[]`, `graveyard[]` | Cards in that zone: a card name, or `{ card, id? }` when the card needs a label. |
| `library` | Library contents (top first) as a list of cards, or a number meaning "that many basic Forests". |
| `manaPool` | Mana already in the pool, by colour letter `W U B R G C`. A letter left out means zero. |

### `actions[]`

An ordered list. Each action is one of:

| Action | Fields | Meaning |
| --- | --- | --- |
| `cast` | `player`, `card`, `targets?`, `x?`, `kicked?` | Cast a spell. `targets` entries are `{ card }` (a labelled card, or the first card with that name) or `{ player }`. |
| `playLand` | `player`, `card` | Play a land card. |
| `resolveStack` | — | Resolve the whole stack, top first, including the triggers it causes. |
| `attack` | `player`, `attackers[]`, `defender?` | Declare the listed labels/creatures as attackers. |
| `advanceTo` | `phase` | Pass priority until the game reaches that phase of the current turn (`upkeep`, `draw`, `precombat_main`, `begin_combat`, `declare_attackers`, `postcombat_main`, `end`). |
| `createToken` | `player`, `card`, `tokenName?`, `count?` | Create a token directly on the battlefield (CR 701.6). `card` names the card whose printed stats the token copies; `tokenName` overrides the name the token is observed under. |

### Observed fields (`observe`)

The fields a runner may report for each player: `life`, `battlefield`, `hand`,
`graveyard`, `exile`, `library`, `stack`, `manaPool`. `observe` restricts the
report; omitting it means "report everything". Each battlefield permanent is
observed as `{ name, tapped, power?, toughness?, counters?, token? }`.

`stack` is the list of card names currently on the stack. Every list is
**sorted** before it is compared, so two engines agree on contents even when
they order the same contents differently.

### `expect[]` / `expectStack`

`expect` is the rules-derived expected outcome, one entry per player. Only
the fields that are present are checked; a battlefield permanent is matched on
the keys it lists (so `{ "name": "Goblin", "token": true }` matches any Goblin
token). `expectStack` lists the expected stack contents and is compared as a
**set**; an omitted `expectStack` means "do not check the stack", while
`expectStack: []` means "the stack must be empty".

`expect` is what lets a scenario be checked *before* a reference engine is
wired in — and it stays as the independent, rules-derived expectation once one
is.

### Adding a scenario

1. Write `scripts/differential/scenarios/<name>.json` following the shape
   above.
2. The card data for every card the scenario mentions must be present in
   `cards.snapshot.json`. To add a card, run the runner with `--refresh-cards`
   (it fetches the card from Scryfall and rewrites the snapshot). *No network
   is available in an offline checkout — ask for the card data to be added.*
3. Run `npx tsx scripts/differential/run-planar-nexus.ts` and check the row
   for your scenario reads `match`.

A scenario file that does not match the format is **rejected** with a
readable message (`scripts/differential/validate-scenario.ts` validates a
single file) rather than being run with missing fields.

---

## Seeded scenarios

The seeds are drawn from the rules slices named in issue #2411 — raid,
converge, landfall and the ETB/persist slice:

| Scenario id | Slice | What it pins down |
| --- | --- | --- |
| `raid-searslicer-goblin` | raid (#2408) | Searslicer Goblin attacks; the end-step raid trigger creates a 1/1 Goblin token and the defender is at 18. |
| `converge-rancorous-archaic` | converge (#2409) | Rancorous Archaic cast with five mana enters with four +1/+1 counters (CR 702.119). |
| `landfall-rampaging-baloths` | landfall (#2399) | Playing a Forest with Rampaging Baloths out creates a 4/4 green Beast token. |
| `landfall-etb-scoured-barrens` | landfall + ETB (#2399, #2410) | Playing Scoured Barrens triggers landfall *and* the land's ETB: a 4/4 Beast token, the land enters tapped, and the controller is at 21 life. |
| `etb-land-scoured-barrens` | ETB (#2410) | Scoured Barrens enters tapped and its ETB trigger gains 1 life. |
| `aura-ethereal-armor` | aura/PT (#2396) | Ethereal Armor on Searslicer Goblin makes it 3/2. |
| `fight-primal-might` | fight (#2400) | Primal Might X=1 makes the goblin 3/2 and it fights Billowing Shriekmass (2/3): both die. |
| `kicker-burst-lightning` | kicker (#2300) | Kicked Burst Lightning deals 4; unkicked Shock deals 2 more. |
| `threshold-billowing-shriekmass` | threshold (#2300) | Billowing Shriekmass with seven cards in its graveyard is 4/4. |
| `mana-pool-colorless-spent` | mana (#2937) | `{1}{C}` spent from a seeded `{R:1, C:1}` pool empties the pool (guards the #2870 class of bug). |
| `stack-shock-resolved` / `stack-shock-unresolved` | stack (#2920) | The stack is empty after resolution, and holds `Shock` before it. |
| `token-cease-baloths-burst-lightning` | token (#2896) | A token that dies to damage ceases to exist (CR 704.5d) — in neither battlefield nor graveyard. |
| `worked-burn-spell`, `worked-land-and-vanilla`, `worked-token-creation` | worked examples (#2411) | A spell, a land plus a vanilla creature, and a direct token creation. |

### Known gaps

* **persist** — the engine implements the keyword
  (`src/lib/game-state/keyword-actions/persist.ts`) but the committed card
  snapshot contains no card with the `persist` keyword, and adding one needs a
  Scryfall refresh (`--refresh-cards`), i.e. network access. Until such a card
  is in the snapshot, no persist scenario can be seeded.
* **triggers** — the outcome records the *result* of the triggers that fired
  (life, counters, tokens, stack) but not a list of the triggers themselves;
  the observed fields are `life`, `battlefield`, `hand`, `graveyard`,
  `exile`, `library`, `stack` and `manaPool`.

---

## Determinism and licensing guardrails

* Deterministic: no RNG, no wall-clock, no network, no hidden state. The
  outcome JSON is a pure function of the scenario file and the card snapshot.
* The format carries **outcomes only**. Card data in `cards.snapshot.json` is
  public Scryfall metadata (name, cost, type line, keywords, stats) used to
  drive the engine; no card script, no rules text and no other engine's
  source code is copied into this repository.
