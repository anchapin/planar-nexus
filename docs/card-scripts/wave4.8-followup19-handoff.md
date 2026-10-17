# Wave 4.8 follow-up 19 handoff — Next session

## Mission

The Wave 4.8 follow-up 18 loop ran on the
`wave4.8-followup18` branch (not yet merged to `main`)
and shipped two lanes (Hornet Queen DSC 184; static
self-grant triggered abilities — CR 603.2 grant
semantics) plus a mid-loop + loop-done summary inside
PR [#2802](https://github.com/anchapin/planar-nexus/pull/2802).
Three priority lanes remain multi-lane per the
follow-up 18 handoff's process rules. **This handoff
opens the next loop: continue the aggressive, iterative
loop to work on these issues one at a time**, picking
the smallest pick-up-able piece of each open lane,
landing it as its own commit on `main` (merge the
follow-up 18 PR first, then proceed), then immediately
moving to the next piece of the same lane (or the next
lane in priority order) without waiting for a fresh
human handoff.

The aggressive loop is the same model the follow-up 14
/ 16 / 17 / 18 loops ran: per-piece commit + per-piece
push + loop-done summary at the end. Pick strictly in
the priority order below; finish one lane's smallest
piece (or break the current piece into a fresh
sub-piece) before moving to the next. **If a piece
grows past ~150 LOC or reveals a second pattern, back
out, document in `wave4-blockers.md`, and either pick a
smaller sub-piece of the same lane or move to the next
lane — do not park.**

The follow-up 18 loop done summary (at the bottom of
`docs/card-scripts/wave4-blockers.md` on the
`wave4.8-followup18` branch) is the authoritative state
of the queue; this handoff re-states the remaining
lanes for self-containment.

## Quick start

```
cd /home/alex/Projects/planar-nexus
git fetch origin
git checkout main
git pull --ff-only
# Merge the follow-up 18 PR (#2802) if it isn't already
# merged; the loop's commits sit on the
# `wave4.8-followup18` branch and aren't in main yet.
gh pr merge 2802 --merge   # if still open
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any leftover
#  from prior waves)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
# verify 762 / 14419 green (follow-up 18 baseline
# after PR #2802 lands)
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

1. **Lane 116 — X-spent-on-other-spells arm
   (`CastFilterSchema.X_spent_on_spell`)**. v1 minimum
   is two engine pieces: (a) read the stored X into the
   cast-time X-resolver (`evaluateCastVariable`-style
   helper) so an effect with this arm sees the
   previously-stored X value when a spell whose `X` was
   spent on an earlier spell is now resolving; (b) write
   `state.castVariableValues` at cast time when the
   caster chooses `X`. The schema arm itself is a small
   `z.enum` addition; the wiring is the bulk of the LOC
   budget. **Smallest single piece** is the **schema +
   read-only path**: add `X_spent_on_spell` to the
   cast-filter X enum, surface a helper that reads
   `state.castVariableValues` for the active cast, and
   ship a synthetic test exercising a "this spell's X
   equals the X spent on the previous spell" arm — no
   cast-time write yet. The write step is the next
   sub-piece (write at cast time + integrate into the
   cast flow). Combined the two pieces stay under
   ~150 LOC; if the schema + read path itself grows
   past that bound, **STOP** and document. Otherwise
   proceed. ~30-50 LOC schema + ~50-100 LOC engine =
   ~80-150 LOC total.

2. **Lane 114 piece 2 — Avenger of Zendikar JSON
   (multi-lane substrate extension)**. Lane 66's
   `embedded_static` token wiring is shipped; lane 14's
   `embeddedStaticKeywords` plumbing is verified; lane
   97's `CreateToken.X: "yourCreatures"` is the
   precedent. The smallest pick-up-able piece is the
   `CreateToken.X` enum extension to add a new arm —
   `X: "landsYouControl"` — parallel to lane 97's
   `yourCreatures`. The arm reads the controller's
   battlefield land count at token-create time (the
   existing `computeX` helper at
   `src/lib/game-state/keyword-actions/scripted-statics.ts`
   already has a `kind === "lands"` branch — promote it
   to a small `resolveCreateTokenAmount` arm). Then a
   separate sub-piece ships the **Landfall "you may put
   a +1/+1 counter on each Plant you control"**
   half — that needs a `target: "each_creature"` mode
   on `PutCounters` with a `subtype` filter (parallel to
   the existing `affects.subtype` filter on
   `StaticSchema`). The "each" target mode is the
   second pattern; if it grows past ~50 LOC by itself,
   back out and document. Otherwise ship both halves
   and close the lane end-to-end. ~30-50 LOC per
   sub-piece.

3. **Lane 61 — Replacement effect for death
   (Whip of Erebos, False Dawn)**. Parked pending the
   foundational replacement-effect layer per the
   follow-up 2 handoff's process rules; the lane 61a
   schema (`CardScriptSchema.replacement_effects`)
   exists, the lane 61b death_replacement meta-static
   arm is shipped (Whip of Erebos uses it). The
   smaller pick-up-able piece is **opening a fresh
   multi-lane plan** for whatever foundational
   replacement-effect layer is still missing — read
   `wave4-blockers.md` lane 61 sections for the current
   state and pick the smallest sub-piece the foundation
   enables. If the foundational layer requires a
   multi-piece plan, **STOP and document** in
   `wave4-blockers.md` and pick from a still-open lane.
   ~50-200 LOC depending on the open question.

## Process rules for the aggressive loop

The aggressive loop is NOT a "land one lane and stop"
loop. The cadence is:

1. Pick the smallest piece of the next lane.
2. Read the relevant files end-to-end BEFORE writing
   — schema arms, engine paths, existing test helpers,
   prior-lane commit messages for commit-message shape.
3. Land the piece as one self-contained commit on the
   working branch:
   `git checkout -b wave4.8-followup19 main` →
   schema delta → engine delta → JSON → test file →
   gates → commit → push → PR (one PR per lane; the
   follow-up 17 precedent allows multiple lanes in one
   PR when the loop spans several).
4. **Immediately** move to the next piece of the same
   lane (or the next lane in priority order) without
   waiting for a fresh human handoff. The follow-up 18
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
  114 and 116 in the same change is a bug; pick one.

### Per-piece checklist (every commit)

```
# 1. Read all upstream files end-to-end
grep -n "field-name" src/lib/game-state/card-scripts/schema.ts
grep -n "field-name" src/lib/game-state/card-scripts/interpret.ts

# 2. Write the schema delta (Zod, docstring, registry)
# 3. Write the engine delta (the smallest engine change that satisfies the schema)
# 4. Write the JSON (real-card first; scan scripts only if no real card exists)
# 5. Write the test file (parallel to lane112 / lane117 / lane59 patterns)
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
   108 / 113 piece 2 / 117 / 118 / 119 precedent — the
   follow-up 18 loop used it cleanly).
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
   (follow-up 19, lane NNN)` where NNN is the
   priority-queue lane number, or
   `[AI-assisted] feat(card-scripts): <one-line>
   (follow-up 19, lane NNN, piece 1/2)` when a lane
   takes two pieces.

### Test-count ratchet

- Update the test-count docs in the same commit as
   any test change. Use `npm run ratchet:test-count`
   for the canonical path. The `--live <counts.json>`
   fallback via
   `node scripts/ratchet-test-count.mjs --live
   <counts.json>` bypasses the AI flake
   mid-ratchet — use it liberally if the
   forge-gate / forge-selfplay / expert-agent flake
   strikes (the handoff documents this as the safe
   path when the flake strikes mid-ratchet).

### AI flake budget

- 1-2 extra CI runs per piece on the known
   order-dependent forge-gate / forge-selfplay /
   expert-agent "is deterministic for a seed" flake.
   Budget for 1 extra CI run per piece on this loop.

### Engine-size budget

- 3800 lines cap (bumped in the follow-up 18 lane 112
   commit). If a piece pushes schema.ts over 3800,
   bump the budget in the same commit with a
   docstring entry in
   `scripts/check-engine-size-budget.mjs` mirroring
   the follow-up 12 / 13 / 14 / 15 / 16 / 17 / 18
   historical precedent.

### Mid-loop progress notes

After every 5th piece, append a **mid-loop progress
note** to `docs/card-scripts/wave4-blockers.md` under
a new `## Wave 4.8 follow-up 19 mid-loop progress
(pieces 1-N)` section listing:

- Pieces shipped (commit hashes + one-line subject).
- Lanes fully closed.
- Pieces in progress.
- Test-suite delta vs. follow-up 18 baseline
  (762 suites / 14419 cases).
- Engine-size budget delta.
- Known issues / carry-overs.

This lets a fresh session pick up cleanly if context
runs out mid-loop.

## End-of-loop check

After the aggressive loop exhausts the priority list
(or hits a piece that exceeds the lane-envelope rule
and is documented as a follow-up), append a **"Wave
4.8 follow-up 19 loop done summary"** to
`docs/card-scripts/wave4-blockers.md` covering:

- Pieces shipped (per-lane commit hashes).
- Lanes fully closed.
- Lanes still open (multi-lane follow-ups).
- Net test-suite / case delta.
- Net engine-size budget delta.
- Any new open work discovered during the loop.

Then **stop**. The next follow-up loop opens fresh.

## Verified follow-up 18 baseline (this loop's starting state)

- `git log --oneline -1` →
   `b093f234 [AI-assisted] docs(card-scripts): wave
   4.8 follow-up 18 loop done summary (2 lanes
   shipped; 3 multi-lane)` on `wave4.8-followup18`
   branch (PR #2802 still open at handoff write time —
   merge it to `main` first so the loop's commits are
   visible to the new session).
- After merge: `grep "Test suites" docs/onboarding.md`
   → `**Test suites:** 762`
- After merge: `grep "Test cases" docs/onboarding.md`
   → `**Test cases:** 14419 (14412 passed + 7 skipped)`
- Engine-size budget cap: `3800` (bumped from 3750
   in the follow-up 18 lane 112 commit)
- Branch: `wave4.8-followup19` (created at the start
   of the loop with
   `git checkout -b wave4.8-followup19 main`)
- Working directory: clean (the follow-up 18 branch
   merged to main)
- Follow-up 18 ship commits: `b0be5a5b`
   (Hornet Queen / lane 114 piece 1/2) and
   `a2ba9be6` (lane 112 — static self-grant). Both
   landed on `wave4.8-followup18` in PR #2802. PR
   #2802's body summary documents the lane-by-lane
   disposition and full gates-green state.
- Follow-up 18 doc commits: `f60a66a1` (mid-loop
   progress note) and `b093f234` (loop-done summary),
   both on `wave4.8-followup18` inside PR #2802.
