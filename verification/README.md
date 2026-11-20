# Formal law suite (gdp-wired): mana pool + turn structure

Laws about the stateful core of the rules engine, **proven for every possible
sequence of operations** with [gdp-wired](https://gdpwired.dev) — not sampled
like a test, not fuzzed like a property check. If a law is false, the prover
returns a concrete operation sequence that breaks it.

## Run it

```bash
npm run test:laws         # proofs + negative controls (plain Node, ~15 s)
npm run test:laws:drift   # models vs the real engine functions (tsx)
```

Both run in CI as the `law-suite` job, which gates the build.

| File | What it is |
|---|---|
| `models.mjs` | The rules, transcribed from the engine code (sources named at the top) |
| `run-laws.mjs` | The law suites: mana (5 step laws + 1 invariant), turn (6 step laws + 7 decision laws), combined (3 step laws), plus negative controls |
| `../scripts/check-law-suite-drift.ts` | Drift guard: compiled models vs the real `addMana`/`spendMana`/`advancePhase`/… on 3,522 seeded random steps |

## What is proven

**Mana** (`src/lib/game-state/mana/`): a successful spend removes exactly the
total cost; a refused spend leaves the pool unchanged; a spend never increases
any bucket; add/empty are exact; colorless spent never exceeds colorless added.

**Turn** (`src/lib/game-state/turn-phases.ts`): advance moves exactly one of
the 13 steps and stays at cleanup; nextTurn resets to untap and consumes an
extra turn; the `advanceToNextPhase` wrapper skips the first-strike step
exactly when nobody has first/double strike (CR 510.5); priority and
sorcery-speed decisions match `playersGetPriority` /
`canCastSorcerySpeedSpells`.

**Combined**: advancing a phase empties all mana pools (CR 500.4).

**Negative controls** keep the suite honest: a `spendMana` variant with the
colorless check dropped is refused (counterexample: one spend of 1 colorless
from an empty pool), a wrap-at-cleanup turn variant is refused, and a
deliberately false law — that `advancePhase` itself skips first-strike — is
refused, because the skip lives only in the wrapper.

## Simplifications, stated plainly

- The mana model keeps **one colored bucket (white) + colorless + generic** of
  the real seven. Colored buckets are symmetric in `addMana` and in
  `spendMana`'s per-color refusal checks; the generic spillover order among
  colors changes *which* color pays, never totals, refusals, or a single
  color's own-cost law — which is all the laws state. Mana production,
  restrictions, and other colors' interactions are not modelled.
- The first-strike skip is modelled with a `hasFirstStriker` input standing in
  for `shouldHaveFirstStrikeStep(state)`; the wrapper's other side effects
  (priority reset, untap processing, triggers) are not modelled.
- gdp-wired is pinned (`gdp-wired` in devDependencies, exact version): it is a
  young tool, used here strictly as a test-time prover — never at runtime.

## Why the drift guard matters

A proof is only as good as its model. `scripts/check-law-suite-drift.ts` is the contract that
keeps the transcription honest: any edit to the real mana/turn functions that
changes the projected behaviour fails the drift check before the proofs can
go stale. When it fails, update `models.mjs` and the laws together — do not
just re-pin the expected values.
