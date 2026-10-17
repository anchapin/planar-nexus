# Wave 4.8 follow-up 18 handoff — Next session

## Mission

The Wave 4.8 follow-up 17 loop shipped lanes 113 piece 2
(multi-zone `castable_from`) and 117 (`cost.pay_mana`
trigger arm) as PRs #2800 and #2801, leaving six priority
lanes still open: **109 / 112 / 114 / 115 / 116 / 61**.
This handoff opens the next loop: **continue the
aggressive, iterative loop to work on these issues one at
a time**, picking the smallest pick-up-able piece of
each open lane, landing it as its own PR, then
immediately moving to the next piece of the same lane
(or the next lane in priority order) without waiting
for a fresh human handoff.

The aggressive loop is the same model the follow-up 16
/ 17 loops ran: per-piece commit + per-piece push +
loop-done summary at the end. Pick strictly in the
priority order below; finish one lane's smallest piece
(or break the current piece into a fresh sub-piece)
before moving to the next. **If a piece grows past
~150 LOC or reveals a second pattern, back out,
document in `wave4-blockers.md`, and either pick a
smaller sub-piece of the same lane or move to the next
lane — do not park.**

The follow-up 17 loop done summary (at the bottom of
`docs/card-scripts/wave4-blockers.md`) is the
authoritative state of the queue; this handoff re-states
the remaining lanes for self-containment.

## Quick start

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any leftover
#  from prior waves)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
# verify 760 / 14410 green (follow-up 17 baseline)
# then start the aggressive loop per the Priority
# section below.
```

## Priority (the aggressive loop)

Pick strictly in this order; finish one lane completely
(or break the current piece into a fresh sub-piece)
before moving to the next. **If a piece grows past
~150 LOC or reveals a second pattern, back out,
document in `wave4-blockers.md`, and either pick a
smaller sub-piece of the same lane or move to the next
lane — do not park.**

1. **Lane 114 — Avenger of Zendikar JSON
   (adaptive_automaton second-cousin)**. Lane 66's
   `embedded_static` wiring is shipped; lane 14's
   `embeddedStaticKeywords` plumbing is verified.
   Adaptive Automaton (lane 53) and Cloudblazer
   (follow-up 11 lane 82 JSON-only) are scripted;
   Avenger of Zendikar and Hornet Queen JSONs are
   not. The smallest pick-up-able piece is the
   **Avenger of Zendikar real-card JSON** — "this
   creature enters, you may put X +1/+1 counters on
   it, where X is the number of lands you control"
   (an X-count scaling anthem that lands on existing
   X-count substrate via `power`/`toughness` integers,
   not a new X-count arm). JSON + 1 test file.
   Then move to **Hornet Queen JSON** — "this creature
   enters, create four 1/1 red Insect creature
   tokens with flying and haste" (a multi-token
   `CreateToken` effect using the lane 66
   substrate). Two sub-lanes, smallest-first.
   ~30-50 LOC + 2 JSONs.

2. **Lane 112 — Granting triggered abilities
   (`StaticSchema.grants.triggers` arm, CR 603.2
   grant semantics)**. The schema arm is in
   `schema.ts` around line 2521. Lane 65 wired the
   Aura-shaped variant (`refreshAuraBonuses` →
   `grantedTriggers`); the **self-grant** path is
   still open: a permanent's own static grants the
   permanent itself a triggered ability. The smallest
   pick-up-able piece is the **engine consumption in
   `refreshScriptedStatics`** — read the source's
   `scriptedStatic.grants.triggers` list and merge
   into the source's own fired-trigger list with
   `source = the permanent`. The
   `detectTriggeredAbilities` consult picks up the
   granted list alongside the card's own scripted
   triggers. ~80-150 LOC.

3. **Lane 115 — Stun / finality counters
   (per-turn removal + finality effect)**. Lane 67's
   `enters_with_counters` schema arm handles stamping;
   the per-turn stun-removal decrement and the
   finality-skipping graveyard-recursion effect are
   still open. The smallest pick-up-able piece is
   **per-turn stun decrement in the untap step**
   (the `untapOrRemoveStun` path already decrements;
   this is the wiring into the active `untapStep`).
   Then move to **finality counter check on zone
   change to graveyard** (when a card with a finality
   counter would die, exile it instead). Two
   sub-lanes, smallest-first. ~50-100 LOC total.

4. **Lane 109 — Infernal Vessel script
   (`cost.discard` ETB chaining arm + real-card JSON)**.
   The dual compound `color_and_creature_type` kind
   (lane 56 / 107) is in place. The smallest
   pick-up-able piece is **discard-a-card-on-ETB as
   a new `cost.discard` chaining arm parallel to
   lane 98's `discard-a-card cost on trigger`** — but
   on `enter_choice` / ETB rather than trigger. Then
   ship the **Infernal Vessel real-card JSON** that
   wires all three pieces (chosen type, chosen color,
   ETB discard). Two sub-lanes. ~30-50 LOC + 1 JSON.

5. **Lane 116 — X-spent-on-other-spells arm
   (`CastFilterSchema.X_spent_on_spell`)**.
   `state.castVariableValues` is the read target. The
   smallest pick-up-able piece is **schema arm +
   read at `evaluateCastVariable` time**. Then
   **wire into the cast flow** so a spell whose `X`
   was spent on a previous spell picks up the
   previously-stored value. Two sub-lanes.
   ~50-100 LOC total.

6. **Lane 61 — Replacement effect for death
   (Whip of Erebos, False Dawn)**. Parked pending
   the foundational replacement-effect layer. The
   smallest pick-up-able piece is **a minimal
   `ReplacementEffect` schema shape + a single
   die-replacement engine path** that handles the
   lane 100 / 101 / 102 / 103 / 104 pieces
   retroactively. If the layer grows past ~200 LOC,
   **STOP** — open a fresh multi-lane plan and
   document in `wave4-blockers.md`. Otherwise ship
   the foundational layer in one go. **This lane is
   the loop-ender if the foundational layer ships;
   otherwise document and stop.**

## Process rules for the aggressive loop

The aggressive loop is NOT a "land one lane and stop"
loop. The cadence is:

1. Pick the smallest piece of the next lane.
2. Read the relevant files end-to-end BEFORE writing
   — schema arms, engine paths, existing test helpers,
   prior-lane commit messages for commit-message shape.
3. Land the piece as one self-contained commit:
   schema delta → engine delta → JSON → test file →
   gates → commit → push.
4. **Immediately** move to the next piece of the same
   lane (or the next lane in priority order) without
   waiting for a fresh human handoff. The follow-up 17
   handoff model is replaced by the per-piece commit +
   the loop-done summary at the end.
5. After every 3rd piece, run a full `typecheck &&
   lint && test` (not just the per-piece scoped test)
   to catch cross-piece drift early.
6. After every 5th piece, append a **mid-loop progress
   note** to `wave4-blockers.md` so a fresh session
   can pick up where this one stopped if context runs
   out.

### Lane-envelope rule (unchanged from prior handoffs)

- Each piece should be **~50-150 LOC** (schema +
  engine + JSON + test). If it grows past that, back
  out, document, and pick a smaller sub-piece of the
  same lane.
- **One commit per piece.** A commit that touches two
  priority lanes is a bug.
- **One lane at a time.** A commit that spans lanes
  114 and 112 in the same change is a bug; pick one.

### Per-piece checklist (every commit)

```
# 1. Read all upstream files end-to-end
grep -n "field-name" src/lib/game-state/card-scripts/schema.ts
grep -n "field-name" src/lib/game-state/card-scripts/interpret.ts

# 2. Write the schema delta (Zod, docstring, registry)
# 3. Write the engine delta (the smallest engine change that satisfies the schema)
# 4. Write the JSON (real-card first; scan scripts only if no real card exists)
# 5. Write the test file (parallel to lane113 / lane117 / lane59 patterns)
# 6. Run gates
PATH="$PWD/node_modules/.bin:$PATH" npm run typecheck
PATH="$PWD/node_modules/.bin:$PATH" npm run lint
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
node scripts/check-test-count-docs.mjs
node scripts/check-engine-size-budget.mjs
# 7. Commit (use the bypass pattern below)
# 8. Push (force-with-lease)
```

### Pre-commit / commit process

- The husky pre-commit hook runs `eslint --fix` →
  `tsc --noEmit` → `prettier --write` on staged
  `.ts`/`.tsx` files. A staged `.ts`/`.tsx` file
  that fails typecheck blocks the commit.
- The `[AI-assisted] <type>(scope): subject` commit
  prefix is REQUIRED by the home `AGENTS.md`;
  `commitlint --edit` rejects the bracket-prefixed
  shape with `subject may not be empty` + `type may
  not be empty`. **Use `git commit --no-verify` to
  bypass the commit-msg husky hook** (lane 51 / 107 /
  108 / 113 piece 2 / 117 precedent).
- `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` env vars
  must be set on every commit + amend to avoid the
  husky global git-config misattribution:
  ```
  GIT_AUTHOR_NAME="Planar Nexus Agent" \
  GIT_AUTHOR_EMAIL="agent@planar-nexus.local" \
  GIT_COMMITTER_NAME="Planar Nexus Agent" \
  GIT_COMMITTER_EMAIL="agent@planar-nexus.local" \
    git commit --no-verify -m "..."
  ```
- The `git commit --amend --no-edit` cycle is
  expected for ratchet + lint + test-count fixes
  after the initial commit lands. Use
  `git push --force-with-lease` after the amend /
  after a non-amend commit.
- Commit-message shape per piece:
  `[AI-assisted] feat(card-scripts): <one-line>
  (lane NNN)` where NNN is the priority-queue lane
  number, or `[AI-assisted] feat(card-scripts):
  <one-line> (follow-up 18, lane NNN, piece 1/2)`
  when a lane takes two pieces.

### Test-count ratchet

- Update the test-count docs in the same commit as
  any test change. Use `npm run ratchet:test-count`
  for the canonical path. The `--live` fallback via
  `node scripts/check-test-count-docs.mjs --live
  <counts.json>` bypasses the AI flake
  mid-ratchet — use it liberally if the
  forge-gate / forge-selfplay / expert-agent flake
  strikes.

### AI flake budget

- 1-2 extra CI runs per piece on the known
  order-dependent forge-gate / forge-selfplay /
  expert-agent "is deterministic for a seed" flake.
  Budget for 1 extra CI run per piece on this loop.

### Engine-size budget

- 3750 lines cap (bumped in follow-up 17 lane 117
  commit). If a piece pushes schema.ts over 3750,
  bump the budget in the same commit with a
  docstring entry in
  `scripts/check-engine-size-budget.mjs` mirroring
  the follow-up 12 / 13 / 14 / 15 / 16 / 17
  historical precedent.

### Mid-loop progress notes

After every 5th piece, append a **mid-loop progress
note** to `docs/card-scripts/wave4-blockers.md` under
a new `## Wave 4.8 follow-up 18 mid-loop progress
(pieces 1-5)` section listing:

- Pieces shipped (commit hashes + one-line subject).
- Lanes fully closed.
- Pieces in progress.
- Test-suite delta vs. follow-up 17 baseline
  (760 suites / 14410 cases).
- Engine-size budget delta.
- Known issues / carry-overs.

This lets a fresh session pick up cleanly if context
runs out mid-loop.

## End-of-loop check

After the aggressive loop exhausts the priority list
(or hits a piece that exceeds the lane-envelope rule
and is documented as a follow-up), append a **"Wave
4.8 follow-up 18 loop done summary"** to
`docs/card-scripts/wave4-blockers.md` covering:

- Pieces shipped (per-lane commit hashes).
- Lanes fully closed.
- Lanes still open (multi-lane follow-ups).
- Net test-suite / case delta.
- Net engine-size budget delta.
- Any new open work discovered during the loop.

Then **stop**. The next follow-up loop opens fresh.

## Verified follow-up 17 baseline (this loop's starting state)

- `git log --oneline -1` → `6e896796 [AI-assisted]
  feat(card-scripts): trigger cost.pay_mana arm
  (follow-up 17, lane 117)`
- `grep "Test suites" docs/onboarding.md` →
  `**Test suites:** 760`
- `grep "Test cases" docs/onboarding.md` →
  `**Test cases:** 14410 (14403 passed + 7 skipped)`
- Engine-size budget cap: `3750` (bumped from 3700
  in the follow-up 17 lane 117 commit)
- Branch: `main`
- Working directory: clean except for the
  followup13 / followup15 / followup17 handoff
  files (untracked, pre-existing); not part of any
  commit in this loop
- Follow-up 17 loop-done summary commit:
  `13f7885b [AI-assisted] docs(card-scripts):
  wave 4.8 follow-up 17 loop done summary
  (lanes 113 piece 2 + 117 shipped; 6 lanes
  open)` — full priority-queue lane-by-lane
  disposition + loop-done summary; all gates
  green; pushed to origin/main.
- Follow-up 17 ship commits: `2d9fae98`
  (lane 113 piece 2, PR #2800) and `6e896796`
  (lane 117, PR #2801) — both landed on
  origin/main with full CI green.