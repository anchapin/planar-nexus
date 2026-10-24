# Differential rules testing vs a reference engine — spike report (#2411)

**Scope of this step:** the planar-nexus side only — the engine-neutral
scenario format, its runtime validator, the planar-side runner, and worked
examples. Running Forge (or any second engine) is step 2 and is **not**
done here.

## Where the format and runner already stood

`scripts/differential/` already contained the scenario types
(`scenario.ts`), the planar runner (`planar-nexus-runner.ts`), an outcome
differ (`diff.ts`), a CLI (`run-planar-nexus.ts`), a committed card-data
snapshot (`cards.snapshot.json`, slim Scryfall records so runs need no
network), and 8 scenarios covering raid, converge, kicker, landfall,
fight, an ETB tapped land, an aura, and a threshold card. The jest suite
`tests/differential-runner.test.ts` runs every scenario file through the
engine and diffs the observed outcome against the scenario's `expect`
block.

## What this PR adds

1. **A runtime validator for the format** (`scripts/differential/validate.ts`).
   The TypeScript types cannot check JSON on disk — and the format's whole
   point is to be shared with a second runner that cannot type-check it.
   The Zod schema is `.strict()` on every object (a typo like `life_total`
   is rejected, not silently ignored), asserts it agrees with the
   hand-written types at compile time (`AssertEqual` against `Scenario`),
   and reports one readable `path: message` line per problem.
   `loadScenarioFile()` throws a single readable error; `validateScenario()`
   returns `{ ok, scenario | errors }` for programmatic use.
   CLI: `npx tsx scripts/differential/validate-scenario.ts <file.json> [...]`
   (exit 0 = valid, 1 = invalid with each problem printed).
2. **Validation wired into the runner**: `loadScenarios()` in
   `run-planar-nexus.ts` now loads every scenario file through
   `loadScenarioFile()`, so an invalid file fails loudly before it reaches
   the engine instead of running with missing fields.
3. **A `createToken` action** (`{ do: "createToken", player, card, tokenName?, count? }`),
   so token creation (CR 701.6) is expressible without a spell that makes
   the token; `scenarioCardNames()` now also collects cards named by
   actions, so the snapshot cannot miss data for a card that starts in no
   zone.
4. **Three worked example scenarios** (below), plus the `Llanowar Elves`
   record they need in `cards.snapshot.json`.
5. **Validator unit tests** (`tests/differential-validate.test.ts`, 7 tests):
   valid object/file accepted; unknown top-level key, misspelled player
   field, <2 players, and unknown phase rejected; non-JSON file rejected
   with a readable error. Test-count docs ratcheted 862 → 863 suites,
   14911 → 14918 cases (suite count measured via `jest --listTests`,
   case count via the new suite's own delta, per the small-machine
   method in AGENTS.md).

## The format, by example

`scripts/differential/scenarios/worked-land-and-vanilla.json`:

```json
{
  "id": "worked-land-and-vanilla",
  "refs": "#2411",
  "description": "Worked example: a player with two green mana casts a vanilla 1/1 (Llanowar Elves) and plays a Forest.",
  "players": [
    { "life": 20, "hand": ["Forest", "Llanowar Elves"], "library": 0, "manaPool": { "G": 1 } },
    { "life": 20, "library": 0 }
  ],
  "phase": "precombat_main",
  "actions": [
    { "do": "cast", "player": 0, "card": "Llanowar Elves" },
    { "do": "resolveStack" },
    { "do": "playLand", "player": 0, "card": "Forest" }
  ],
  "observe": ["life", "battlefield", "hand", "graveyard", "library"],
  "expect": [
    { "life": 20, "battlefield": [{ "name": "Forest" }, { "name": "Llanowar Elves", "power": 1, "toughness": 1 }], "hand": [], "graveyard": [], "library": 0 },
    { "life": 20, "library": 0 }
  ]
}
```

A scenario names: starting zones/permanents per player, life, starting
phase, an action sequence (`cast` with targets, `playLand`, `createToken`,
`attack`, `resolveStack`, `advanceTo`, …), the fields to observe (`life`,
`battlefield`, `hand`, `graveyard`, `exile`, `library`, `stack`), and —
until a second engine exists — a rules-derived `expect` block. The runner
emits `{ scenario, engine, status, players: [...observed fields...], errors }`,
which is exactly the artefact a reference-engine runner will later be
diffed against with `diff.ts`.

## Verified runs (this machine, this PR)

- `npx jest tests/differential-runner.test.ts --runInBand` — **14 passed**
  (every scenario in `scenarios/`, including the 3 new worked ones, matches
  its `expect` block).
- `npx jest tests/differential-validate.test.ts --runInBand` — **7 passed**.
- `npx tsx scripts/differential/run-planar-nexus.ts <the 3 worked scenarios> --out out.json`:

  ```
  match            worked-land-and-vanilla
  match            worked-burn-spell
  match            worked-token-creation
  ```

  Observed outcomes include: burn spell — caster's graveyard `["Shock"]`,
  opponent life 20 → 18; token creation — battlefield gains
  `{ "name": "Elf", "power": 1, "toughness": 1, "token": true }`.
- Validator CLI on a scenario with `life_total` instead of `life` and one
  player — exit 1, `INVALID …` with per-field problems; on
  `worked-burn-spell.json` — exit 0, `ok … (worked-burn-spell)`.
- `npm run typecheck` — exit 0.

## The Forge bridge: what could NOT be verified from here

The issue's starting point is manamind's `src/manamind/forge_interface/`
(`forge_client.py` over Py4J/JPype, `game_runner.py`, `state_parser.py`).
**That code is not in this repository**, so this spike cannot and does not
claim anything about its completeness — in particular not whether it can
set up an arbitrary board state and step a scenario, or only run whole
games. That audit has to happen in the manamind repo, and it is the first
task of step 2. Nothing about Forge was run, downloaded, or vendored here.

## Licensing guardrails (from the issue, unchanged)

- planar-nexus stays MIT. Forge (GPL-3.0) is dev/test tooling only: a
  separate process, never bundled, vendored, or shipped in the app or the
  Tauri build.
- No Forge card scripts or Java code are copied into this repo. Only
  *outcomes* are compared.
- If rules logic ever needs porting, the source is XMage (MIT), credited —
  never Forge.

## Recommended step 2

1. Audit manamind's `forge_interface/` **in the manamind repo**: can it
   place specific permanents, set life/phase, and step actions, or only
   run whole games? Write the answer down before building anything.
2. If it can step: implement a Forge-side runner that consumes this exact
   scenario format and emits the same outcome shape; diff with `diff.ts`
   over the existing 11 scenarios and file engine bugs as issues (do not
   fix them inside the differential-testing PRs).
3. If it can only run whole games: scope a thin state-setup shim on the
   Forge side (still a separate process), or fall back to XMage as the
   oracle, and record the decision on #2411.
