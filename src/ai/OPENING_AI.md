# Opening-Hand Sequencing (AI Opponent)

> Issue #1416 — difficulty-scaled opening-hand sequencing for turns 1-3.
> Parallel to `COMBAT_AI.md` / `STACK_INTERACTION_AI.md`. Lives next to the
> helper it documents: `src/ai/opening-turn-plan.ts`.

The opening three turns of a Magic game are the most consequential. Before
this module the AI played every turn identically — `playLandIfAvailable`
grabbed the first land in hand and `castCreatures` dumped every affordable
creature by CMC. There was no turn-1 vs turn-3 distinction and Easy opened
indistinguishably from Expert. The opener is the AI's first impression on
every game; a flat opener erodes the player's confidence in the difficulty
selector.

## Design

`chooseOpeningTurnPlan(state, playerId, difficulty, format, turnNumber, rng)`
is a **pure** function (no engine mutation, no I/O) that returns an
`OpeningTurnPlan` for turns 1-3 and `null` otherwise. The turn loop consults
it once in the **pre-combat main phase** (`runMainPhase`, `phase ===
"precombat_main"`) and threads the result into `playLandIfAvailable` and
`castCreatures`. Post-combat main and turns > 3 fall back to the legacy
difficulty-agnostic main-phase logic unchanged.

```ts
interface OpeningTurnPlan {
  landToPlay: CardInstanceId | null; // played in place of "first land found"
  spellToCast: CardInstanceId | null; // cast in place of the CMC-sort dump
  holdMana: boolean; // skip creatures this turn entirely
  reasoning: string; // surfaced via config.onCommentary
}
```

When the plan is present, `castCreatures` is **authoritative** — it casts the
planned creature (or holds all creatures when `holdMana`) and returns without
falling through to the legacy path. This keeps the opener to one deliberate
spell per turn. The plan's color-feasibility check prevents off-curve picks;
if the engine still rejects the cast (unexpected), the AI simply casts
nothing that turn — acceptable for a deliberate opener.

The turn number is read from the engine's `gameState.turn.turnNumber`
directly (no per-game counter, no `AITurnConfig` change) — the engine already
tracks it authoritatively.

### Turn-counter surfacing

`runMainPhase` reads `currentState.turn?.turnNumber ?? 0` and only computes
the plan for `1 <= turnNumber <= OPENING_TURNS_MAX` (3). This keeps the
helper's turn-window logic in one place and avoids a config-level mutation
that sibling issues would have to rebase around.

## Per-tier opening patterns

### Easy — sloppy

- **Land**: a _random_ land from hand (deterministic via the supplied `rng`).
  May pick a tapped land when an untapped basic is available.
- **Spell**: greedy — the highest-CMC creature within `turnNumber + 2` reach,
  **ignoring color requirements**. Above-curve picks fail the engine's cast
  validation and waste the turn (the documented Easy blunder). 25% of the
  time the plan randomly holds and does nothing.
- **Feel**: drops a tapped land T1 into a color-mismatched 2-drop; routinely
  wastes T2 attempting a 3-drop it can't pay for.

### Medium — on-curve

- **Land**: the highest-scored land (untapped basics that enable the hand's
  colored pips > untapped basics > untapped duals > tapped lands).
- **Spell**: "curves out" — prefers a creature with CMC equal to the turn
  number, then the highest CMC at or below turn number (to use mana), then
  higher power. Only color-feasible picks are considered.
- **Hold**: when the only on-curve play is off-color, holds all creatures and
  replays the hand next turn.
- **Feel**: leads T1 1-drop → T2 2-drop → T3 3-drop when colors allow.

### Hard — 1-turn lookahead

- Everything Medium does, plus:
- **T1 mana-dork lead**: if a {T}:Add-mana creature is on-color, leads with it
  to accelerate the T2/T3 curve.
- **Curve protection**: holds a 1-drop on T1 if casting it would strand the
  T2 2-drop's only colored source (1-source conflict detection).
- **Land sequencing**: scores fetch lands for color fixing (a fetch that can
  find a demanded color beats an off-color basic); penalizes tapped lands
  heavily on T1/T2.

### Expert — 2-turn plan

- Everything Hard does, plus:
- **Removal lead vs threats**: if the opponent's T1 board has a creature with
  power ≥ 2, holds the creature plan entirely so `castOtherSpells` can lead
  with removal (the AI does not develop into a faster clock).
- **Mana-dork acceleration**: on T1, plays a mana dork specifically to ramp
  into a T2 3-drop or T3 4-drop (checks for those targets in hand).
- **Color sequencing**: scores fetch lands with an extra flexibility bonus
  (the option-value of cracking for whichever color the draw step reveals).

## Land scoring

`scoreLand(land, demand, turnNumber, difficulty)` ranks candidate lands:

| Factor                       | Effect                                                          |
| ---------------------------- | --------------------------------------------------------------- |
| Untapped                     | +2                                                              |
| Tapped                       | −2 on T1/T2, −0.5 on T3 (tempo cost is front-loaded)            |
| Produces a demanded color    | +3 per color                                                    |
| Basic                        | +1 (land-type-matters, no life cost)                            |
| Fetch finds a demanded color | +2 per color (Hard/Expert only — Medium doesn't think to crack) |
| Fetch flexibility            | +0.5 (Expert only — option-value)                               |

"Demanded color" = the weighted pip count across near-term creatures
(`computeColorDemand`): on-curve creatures (cmc ≤ turn) count double, the
next turn's spells (cmc ≤ turn+2) count single.

## Determinism

The only nondeterministic input is `rng` (used only by Easy's random land
pick and random hold). Tests pass a seeded `() => number` for fully
reproducible plans. Medium / Hard / Expert are fully deterministic given the
game state.

## Integration points

| Call site             | Change                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `runMainPhase`        | computes the plan once for `precombat_main`, surfaces `reasoning` via `onCommentary`, threads the plan into both helpers |
| `playLandIfAvailable` | new optional `openingPlan` param; when `landToPlay` is set, plays THAT land instead of the first found                   |
| `castCreatures`       | new optional `openingPlan` param; when present, casts `spellToCast` (or holds) and returns — no legacy fallback          |
| `castOtherSpells`     | unchanged — Expert's `holdMana` lets removal flow through this legacy path                                               |

## Sibling-issue boundaries

The `ai-turn-loop.ts` edits are deliberately minimal (one import block, one
plan-computation block in `runMainPhase`, one new optional param + short-circuit
block each in `playLandIfAvailable` and `castCreatures`) so the sibling
`ai-turn-loop.ts` clique (#1413, #1414, #1415) rebases cleanly. All opening
logic lives in `opening-turn-plan.ts`; tests live in
`src/ai/__tests__/opening-turn-plan.test.ts`.

## Out of scope

- Fetch-land _cracking_ sequencing (which color to crack for) is handled by
  the activated-ability step (`runAbilityActivation`, issue #1386), not here.
  The plan only picks _which_ land to play.
- Per-format opening tuning (Limited vs Constructed openers) — the `format`
  parameter is threaded through for future use but currently unused.
- `castOtherSpells` (removal, ramp spells, planeswalkers) is not governed by
  the opening plan; only creatures are. Expert's "lead removal vs threat"
  works by holding creatures via `holdMana` and letting `castOtherSpells` run.
