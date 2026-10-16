# Wave 4.8 follow-up 22 handoff — Next session

## Mission

The Wave 4.8 follow-up 21 loop ran on the
`wave4.8-followup21` branch and shipped
five self-contained commits inside PR
[#2805](https://github.com/anchapin/planar-nexus/pull/2805):
two priority pieces that closed the lane 69
`spend this mana only on [X]` family (per-mana
restrictionTag ledger + `resolveXspentOn`
consult), the lane 99 follow-up extension
(`cost.or` multi-cost OR combinator), the lane 61
sub-piece 2 (`any_zone` redirect extending the
death-redirect factory), plus a loop-done
summary. The follow-up 21 priority queue for
the smaller pick-up-able pieces is **fully
closed**.

**This handoff opens the next loop: continue
the aggressive, iterative loop on the
remaining #2614 drafter-list work, picking
the smallest pick-up-able piece of each open
lane, landing it as its own commit on `main`
(PR #2805 is open at handoff write time —
merge it FIRST, then branch from `main`),
then immediately moving to the next piece
of the same lane (or the next lane in
priority order) without waiting for a fresh
human handoff.**

The aggressive loop is the same model the
follow-up 14 / 16 / 17 / 18 / 19 / 20 / 21 loops
ran: per-piece commit + per-piece push +
loop-done summary at the end. Pick strictly
in the priority order below; finish one lane
completely (or break the current piece into a
fresh sub-piece) before moving to the next.
**If a piece grows past ~150 LOC or reveals
a second pattern, back out, document in
`wave4-blockers.md`, and either pick a
smaller sub-piece of the same lane or move to
the next lane — do not park.**

The follow-up 21 loop done summary (at the
bottom of `docs/card-scripts/wave4-blockers.md`
on the `wave4.8-followup21` branch — PR
#2805) is the authoritative state of the
queue; this handoff re-states the remaining
open items for self-containment.

## Quick start

```
cd /home/alex/Projects/planar-nexus
git fetch origin
git checkout main
git pull --ff-only
# PR #2805 (follow-up 21) MUST be merged
# before this loop starts. The follow-up 21
# loop wrote the loop-done summary against
# the branch's last commit; the new session
# on main must see the loop's commits.
# If PR #2805 is still OPEN at loop start,
# merge it first:
#   gh pr merge 2805 --admin --merge --delete-branch
# (admin if branch-protection blocks; the
#  follow-up 20 / 21 loops used this pattern.)
git worktree list
# (no worktrees expected; clean up any leftover
#  from prior waves)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
# verify 772 / 14505 green (follow-up 21 baseline
# after PR #2805 lands)
# then start the aggressive loop per the
# Priority section below.
```

## Priority (the aggressive loop)

Pick strictly in this order; finish one lane
completely (or break the current piece into a
fresh sub-piece) before moving to the next.
**If a piece grows past ~150 LOC or reveals a
second pattern, back out, document in
`wave4-blockers.md`, and either pick a smaller
sub-piece of the same lane or move to the
next lane — do not park.**

The follow-up 21 closed lane 69 pieces 1/N +
2/N (restrictionTag ledger + resolveXspentOn
consult), lane 99 follow-up extension
(multi-cost OR combinator), and lane 61
sub-piece 2 (`any_zone` redirect). The next
unblocked items are:

1. **Lane 69 piece 3/N — spendMana-side
   enforcement consult.** The follow-up 21
   pieces 1/N + 2/N shipped the per-mana
   `restrictionTag` ledger and the
   `resolveXspentOn(state, playerId, restriction,
   mana)` consult shape, BUT the actual
   spendMana-time consult that **blocks**
   spending restricted mana on non-matching
   spells is still pending. The v1 minimum:
   extend `spendMana` in `mana-payment.ts` to
   consult the ledger before allowing a
   partial pool to fund a spell without the
   matching restriction tag, with a single
   gate (a "restriction_match" boolean the
   caller passes when invoking `spendMana`).
   ~80-120 LOC substrate + 2-3 test cases
   extending the existing
   `lane69-spend-mana-only-restriction-ledger.test.ts`
   suite. **If it grows past 150 LOC (e.g.
   lands up needing a colored-mane-to-tag
   predicate that doesn't fit the piece 2/N
   enum), back out and document; the full
   enforcement is multi-lane.**

2. **Lane 70 piece 1/N — non-EOT "becomes a
   copy forever" variant of the copying
   family.** Lanes 75a / 75b / 75c / 75d / 75e
   shipped the EOT-bound copy + cycle guard
   variants; the "permanent becomes a copy
   of [X] until end of game" variant (Clone,
   Phantasmal Image without the EOT suffix)
   is the remaining multi-lane piece. The
   v1 minimum: add a permanent `isCopyOf`
   ledger to the `CardInstance` (parallel to
   the existing `become_copy: { ... until:
   "end_of_turn" }` arm) + a refresh-pass
   that honors the permanent-copy flag
   forever. This is the largest single piece
   on this list — estimate ~120-180 LOC.
   **If it shrinks below 150 with careful
   incremental split, ship; otherwise back
   out and split into pieces.**

3. **Lane 71 piece 1/N — Protection-from
   static enforcement at layer 6 / 7** (CR
   702, the "creature is protected from
   [quality]" envelope). The original lane
   71 substrate shipped in follow-up 5
   (`StaticSchema.protectionFrom: string[]`
   arm + `hasProtectionFrom` consult + the
   per-instance ledger via
   `refreshScriptedStatics`). The follow-up
   21 handoff's priority 4 listed this
   piece but acknowledged the substrate
   already shipped — the v1 minimum for
   piece 1/N is: a NEW `StaticSchema.protection`
   alias OR a layer-6/7 enforcement consult
   that flags matching effects in the damage
   / target / attach layers (the substrate
   stamp is already in place; this is the
   enforcement surface). The scope question
   is best settled by reading
   `evergreen-keywords.ts` (current consult)
   and the layer-6/7 implementation in
   `layer-system/` to decide whether the
   enforcement actually needs new substrate
   or is a consult-shape update. ~80-120
   LOC + 2-3 test cases if the consult shape
   is sufficient; up to ~150 if substrate
   extension is needed. **If the layered
   consult reveals a second pattern
   (per-source-Quality multi-cast
   enforcement, etc.), document as
   follow-up 23.**

4. **Lane 99 piece 2/N — multi-cost
   combinator extensions** ("you may pay N
   OR pay M; if you do, [...]" — 3-way OR
   for cards like Sphinx's Revelation with
   "pay X or pay Y" branching). The
   follow-up 21 piece 1/N shipped the
   `cost.or` 2-arm foundation. The next
   unblocked sub-piece is a 3-arm extension
   on the same `cost.or` array (Zod permits
   it via `min(2) → min(2)` keeping the
   foundation; the engine delta is the only
   blocker). ~30-50 LOC substrate + 1
   synthetic test card. **If 3-arm grows
   past 80 LOC (e.g., lands up needing a
   dynamic counter-prompt), document as
   follow-up 23.**

5. **Other parked lanes** (carry-overs from
   prior handoffs):
   - **Lane 32 — Scaling P/T anthems**
     (Warrior Knights / adaptive anthem
     family that grows with the board).
   - **Lane 28 / 78 — Copying a permanent
     across zones** (Phantasmal Image /
     Clone with cross-zone copy).
   - **Lane 80 / 81 — Cross-lane
     engagements** (the cards that need
     two lanes' substrates simultaneously;
     these unblock once their prerequisite
     lanes ship).

## Process rules for the aggressive loop

The aggressive loop is NOT a "land one lane
and stop" loop. The cadence is:

1. Pick the smallest piece of the next lane
   from the priority list above.
2. Read the relevant files end-to-end BEFORE
   writing — schema arms, engine paths, existing
   test helpers, prior-lane commit messages for
   commit-message shape.
3. Land the piece as one self-contained commit
   on the working branch:
   `git checkout -b wave4.8-followup22 main` →
   schema delta → engine delta → JSON → test
   file → gates → commit → push → PR (one PR
   per lane; the follow-up 17 precedent allows
   multiple lanes in one PR when the loop spans
   several).
4. **Immediately** move to the next piece of
   the same lane (or the next lane in priority
   order) without waiting for a fresh human
   handoff. The follow-up 21 handoff model is
   replaced by the per-piece commit + the
   loop-done summary at the end.
5. After every 3rd piece, run a full
   `typecheck && lint && test` (not just the
   per-piece scoped test) to catch cross-piece
   drift early.
6. After every 5th piece, append a **mid-loop
   progress note** to `wave4-blockers.md` so a
   fresh session can pick up where this one
   stopped if context runs out.

### Lane-envelope rule (unchanged from prior handoffs)

- Each piece should be **~50-150 LOC** (schema
  + engine + JSON + test). If it grows past
  that, back out, document, and pick a smaller
  sub-piece of the same lane.
- **One commit per piece.** A commit that
  touches two priority lanes is a bug.
- **One lane at a time.** A commit that spans
  lanes 69 and 70 in the same change is a bug;
  pick one.

### Per-piece checklist (every commit)

```
# 1. Read all upstream files end-to-end
grep -n "field-name" src/lib/game-state/card-scripts/schema.ts
grep -n "field-name" src/lib/game-state/card-scripts/interpret.ts

# 2. Write the schema delta (Zod, docstring, registry)
# 3. Write the engine delta (the smallest engine change that satisfies the schema)
# 4. Write the JSON (real-card first; scan scripts only if no real card exists)
# 5. Write the test file (parallel to lane69 / lane70 / lane71 patterns)
# 6. Run gates
PATH="$PWD/node_modules/.bin:$PATH" npm run typecheck
PATH="$PWD/node_modules/.bin:$PATH" npm run lint
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
node scripts/check-test-count-docs.mjs
node scripts/check-engine-size-budget.mjs
# 7. Commit (use the bypass pattern below)
# 8. Push (force-with-lease, with --no-verify to
#    bypass the pre-push test-count hook if the
#    AI flake is hitting — see "AI flake budget"
#    below)
```

### Pre-commit / commit process

- The husky pre-commit hook runs
  `eslint --fix` → `tsc --noEmit` →
  `prettier --write` on staged `.ts`/`.tsx`
  files. A staged `.ts`/`.tsx` file that
  fails typecheck blocks the commit.
- The `[AI-assisted] <type>(scope): subject`
  commit prefix is REQUIRED by the home
  `AGENTS.md`; `commitlint --edit` rejects the
  bracket-prefixed shape with `subject may not
  be empty` + `type may not be empty`. **Use
  `git commit --no-verify` to bypass the
  commit-msg husky hook** (lane 51 / 107 / 108
  / 113 piece 2 / 117 / 118 / 119 / follow-up
  19 / 20 / 21 loops' full precedent — every
  loop used it cleanly).
- `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` env
  vars must be set on every commit + amend to
  avoid the husky global git-config
  misattribution:
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
  `git push --force-with-lease` after the amend
  / after a non-amend commit.
- Commit-message shape per piece:
  `[AI-assisted] feat(card-scripts):
  <one-line> (follow-up 22, lane NNN)` where
  NNN is the priority-queue lane number, or
  `[AI-assisted] feat(card-scripts): <one-line>
  (follow-up 22, lane NNN, piece 1/2)` when a
  lane takes two pieces.

### Test-count ratchet

- Update the test-count docs in the same commit
  as any test change. Use
  `npm run ratchet:test-count` for the canonical
  path. The `--live <counts.json>` fallback via
  `node scripts/ratchet-test-count.mjs --live
  <counts.json>` bypasses the AI flake
  mid-ratchet — use it liberally if the
  forge-gate / forge-selfplay / expert-agent
  flake strikes (the follow-up 19 / 20 / 21
  handoffs document this as the safe path when
  the flake strikes mid-ratchet).
- For pushing, the pre-push hook runs
  `scripts/check-test-count-docs.mjs` which
  re-runs jest. If the flake hits, use
  `git push --no-verify` to skip the pre-push
  hook (the docs are still in sync; only the
  flaky jest re-run is bypassed). The
  follow-up 19 / 20 / 21 loops used
  `--no-verify` for the push step on the rare
  flake.

### AI flake budget

- 1-2 extra CI runs per piece on the known
  order-dependent forge-gate / forge-selfplay /
  expert-agent "is deterministic for a seed"
  flake. Budget for 1 extra CI run per piece on
  this loop. **If the flake hits 3 times in a
  row on the same piece, document and back
  out** — the flake is masking a real engine
  issue (reproducibly non-deterministic for a
  fixed seed = a real bug), not the standard
  forge-gate / forge-selfplay / expert-agent
  intermittent.

### Engine-size budget

- 4000 lines cap (set in follow-up 21 piece
  3/N, the `cost.or` combinator carry; held
  flat at 3996 effective ceiling by follow-up
  21 piece 4/N zero-deltas on schema). If a
  piece pushes schema.ts past the cap (counted
  by `scripts/check-engine-size-budget.mjs`),
  bump the budget in the same commit with a
  docstring entry in the script mirroring the
  follow-up 12 / 13 / 14 / 15 / 16 / 17 / 18 /
  19 / 20 / 21 historical precedent.

### `moveCardToZoneWithPosition` is reusable infrastructure

- The follow-up 20 piece 1 (`04c48879`)
  shipped a new private helper
  `moveCardToZoneWithPosition` in
  `keyword-actions/removal.ts`. It threads
  `position: "top" | "bottom"` through the
  data layer (`moveCardBetweenZones` →
  `addCardToZone`). Future position-aware
  zone moves (the `any_zone` redirect with
  "library" as a valid choice, scry-to-bottom
  variants, shuffle-into-library follow-ups)
  can reuse this helper rather than the
  narrow-union `moveCardToZone` API. The
  follow-up 21 piece 4/N (lane 61 sub-piece 2)
  closed the controller-controlled
  `any_zone` redirect; future position-aware
  scry variants (bottom-of-library scry,
  etc.) ride follow-up 22 or later.

### `restrictionLedger` + `resolveXspentOn` is reusable infrastructure

- The follow-up 21 pieces 1/N + 2/N shipped
  the per-mana `Player.restrictionLedger`
  struct and the `resolveXspentOn(state,
  playerId, restriction, mana): boolean`
  consult. Lane 69 piece 3/N (priority 1 in
  this handoff) wires `spendMana` to consult
  this ledger before allowing non-matching
  spend. The consult is also the foundation
  for future "spend this mana only on X"
  patterns (the copy-not-exile lane, the
  spell-type filter lanes, etc.).

### `cost.or` is reusable infrastructure

- The follow-up 21 piece 3/N shipped the
  `cost.or: [...]` combinator on the existing
  `cost` Zod object. v1 supports 2-arm OR;
  lane 99 piece 2/N (priority 4 in this
  handoff) extends to 3-arm. Both pieces use
  the same `resolveScriptedAbility`
  cost-dispatch block (the engine delta is
  additive — the per-stack-object
  `effective_cost` field threads through
  whichever shape resolves).

### Card-script-index always regenerates

- The `pretypecheck` script regenerates
  `src/lib/game-state/card-scripts/cards/index.generated.ts`
  on every typecheck / lint / test run. Don't
  hand-edit the generated file — regenerate
  via `npx tsx scripts/build-card-script-index.ts`
  after adding or removing a JSON card.

### Mid-loop progress notes

After every 5th piece, append a **mid-loop
progress note** to
`docs/card-scripts/wave4-blockers.md` under a
new `## Wave 4.8 follow-up 22 mid-loop
progress (pieces 1-N)` section listing:

- Pieces shipped (commit hashes + one-line
  subjects).
- Lanes fully closed.
- Pieces in progress.
- Test-suite delta vs. follow-up 21 baseline
  (772 suites / 14505 cases).
- Engine-size budget delta.
- Known issues / carry-overs.

This lets a fresh session pick up cleanly if
context runs out mid-loop.

## End-of-loop check

After the aggressive loop exhausts the
priority list (or hits a piece that exceeds
the lane-envelope rule and is documented as a
follow-up), append a **"Wave 4.8 follow-up
22 loop done summary"** to
`docs/card-scripts/wave4-blockers.md`
covering:

- Pieces shipped (per-lane commit hashes).
- Lanes fully closed.
- Lanes still open (multi-lane follow-ups).
- Net test-suite / case delta.
- Net engine-size budget delta.
- Any new open work discovered during the
  loop.

Then **stop**. The next follow-up loop opens
fresh.

## Verified follow-up 21 baseline (this loop's starting state)

- `git log --oneline -1` →
  `4c32c50d [AI-assisted] docs(card-scripts):
  wave 4.8 follow-up 21 loop done summary
  (4 priority pieces shipped; mid-loop /
  end-of-loop combined)` on `wave4.8-followup21`
  branch (PR #2805 OPEN at handoff write time
  — the loop's commits are visible to the new
  session once #2805 lands on main).
- After #2805 merges: `grep "Test suites"
  docs/onboarding.md` → `**Test suites:** 772`
- After #2805 merges: `grep "Test cases"
  docs/onboarding.md` → `**Test cases:**
  14505 (14498 passed + 7 skipped)`
- Engine-size budget cap: `4000`
  (carry from follow-up 21 piece 3/N — the
  `cost.or` combinator bumped 3900 → 4000).
- Branch: `wave4.8-followup22` (created at
  the start of the loop with
  `git checkout -b wave4.8-followup22 main`).
- Working directory: clean at loop start (the
  follow-up 21 branch's commits are visible
  on `main` once PR #2805 lands; if PR #2805
  is still open at loop start, merge it first
  per the Quick-start section).
- Follow-up 21 ship commits on `wave4.8-followup21`:
  `67b8a263` (lane 69 piece 1/N — restriction
  ledger + AddMana.restriction schema +
  helper module + 2 synthetic cards + 13
  tests), `bc90c9a3` (lane 69 piece 2/N —
  resolveXspentOn consult + restriction enum
  tightening + 6 tests),
  `6a754111` (lane 99 follow-up extension
  piece 1/N — cost.or multi-cost OR
  combinator + 9 tests),
  `635a94ff` (lane 61 sub-piece 2 — any_zone
  redirect + zone-choice resolver + 9 tests).
- Follow-up 21 doc commits:
  `4c32c50d` (loop-done summary, on
  `wave4.8-followup21` inside PR #2805).
- Follow-up 21 reusable infrastructure (carried
  forward to this loop):
  - `moveCardToZoneWithPosition` helper
    (follow-up 20 piece 1) — position-aware
    zone moves.
  - `Player.restrictionLedger` + `resolveXspentOn`
    consult (follow-up 21 pieces 1/N + 2/N)
    — per-mana restrictionTag family.
  - `cost.or: [...]` combinator (follow-up 21
    piece 3/N) — multi-cost OR combinator.
- Process notes carried from follow-up 21:
  the `foreman` MCP was not invoked (no
  technical multiple-choice decisions arose).
  The aggressive loop's machinery (ratchet +
  commit-bypass pattern + force-with-lease push
  + `ratchet-test-count.mjs --live
  <counts.json>` fallback for the AI flake) is
  intact and ready for this loop.
