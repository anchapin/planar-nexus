# Headless game simulation harness (issue #1065)

`game-simulator.ts` runs AI-vs-AI **full games to completion without any UI or
browser** and aggregates the **player win rate per difficulty tier**. It is the
tool that verifies the documented difficulty targets in
[`DIFFICULTY_CONFIGS`](../ai-difficulty.ts) (≈ 80 / 60 / 40 / 25 % player win
rate for easy / medium / hard / expert) and that **higher difficulty actually
wins more** — closing the validation gap left by the weight-learning loop
(#1066).

## Why a separate driver?

The production [`runAITurn`](../ai-turn-loop.ts) controller is paced for the UI:
it sleeps between actions and never resolves combat damage (the game board does
that separately). Neither property is acceptable for a fast, deterministic batch
harness, so the simulator drives the rules engine directly:

```
init → (untap → draw → main(cast) → combat(attack/block/resolve) → cleanup
       → next turn)* → terminal
```

Every engine primitive it calls (`createInitialGameState`, `loadDeckForPlayer`,
`playLand`, `castSpell`/`resolveTopOfStack`, `declareAttackers`/
`declareBlockers`/`resolveCombatDamage`, `checkStateBasedActions`,
`startNextTurn`) is the real one under `src/lib/game-state/` — nothing is mocked.

## How difficulty moves win rate

Three levers, all derived from the live `DIFFICULTY_CONFIGS`
(`randomnessFactor` + `blunderChance` → a `skill` score):

1. **Casting discipline** — higher tiers cast more of their affordable curve
   (bigger board).
2. **Attack aggression** — higher tiers send more creatures to combat.
3. **Block discipline** — higher tiers make more recommended blocks (better
   defense).

The probabilities are strictly monotonic across tiers, so win-rate separation is
guaranteed to be measurable.

## Determinism & termination

- **Seeded.** A mulberry32 PRNG replaces `Math.random` for the whole run (deck
  shuffle + every blunder roll). Same `(seed, gameIndex, difficulties, decks)`
  → bit-identical game. Reproduce any result by reusing its seed.
- **Always terminates.** Every game is capped at `maxTurns` (default 80); a game
  that reaches the cap is recorded as a **draw**, so the harness can never loop
  forever.
- **Fair matchups.** Each matchup alternates which seat plays first, cancelling
  the first-turn advantage (expert-vs-expert lands near 50 %).

## Fixtures

Decks are fixed, fully-determined 60-card pools (`buildDeck`) with generic-cost
vanilla creatures so mana payment and combat stay simple and reproducible. Three
archetypes are available — `aggro`, `midrange`, `control` — matching the deck
pool called out in #1065. The default sweep uses a **midrange mirror** so
difficulty is the only variable.

## Usage

### As a Jest suite (CI)

```bash
npm test -- simulation              # both harness + win-rate suites
npm test -- difficulty-winrate      # win-rate monotonicity + fairness
npm test -- game-simulator          # harness contract (termination, determinism)
```

### As a script (offline tuning)

```bash
npm run simulate                    # runs the simulation suites verbosely
SIM_FULL=1 npm run simulate         # adds the N=200 full tuning report
```

Sample report (midrange mirror vs an expert baseline, N=200):

```
easy    vs expert  → 13.5% win
medium  vs expert  → 41.5% win
hard    vs expert  → 51.0% win
expert  vs expert  → 54.0% win
```

## API

| Export                      | Purpose                                              |
| --------------------------- | ---------------------------------------------------- |
| `simulateGame(config)`      | One deterministic full game → `GameOutcome`          |
| `simulateMatchup(p, o, c)`  | N games of a pairing → aggregated `MatchResult`      |
| `simulateDifficultySweep(c)`| Each tier vs a fixed baseline → `MatchResult[]`      |
| `buildDeck(archetype)`      | Fixed 60-card fixture deck                           |
| `mulberry32(seed)`          | The seeded PRNG (exposed for reproducibility tests)  |

> **Note on targets.** The configured *targets* (80/60/40/25 %) describe a human
> player vs the AI. This harness plays **AI vs AI**, so its absolute rates are
> not the target numbers — what matters is the **ordering** (harder tier wins
> more) and the **separation**, which is what the assertions check.
