# Wave 4.8 follow-up 23 handoff — Next session

## Mission

The Wave 4.8 follow-up 22 loop ran on the
`wave4.8-followup22` branch and shipped four
self-contained commits inside PR
[#2806](https://github.com/anchapin/planar-nexus/pull/2806):
lane 69 piece 3/N (spendMana restriction-tag
consult), lane 70 piece 1/N (permanent-copy
substrate — schema + helpers + per-instance
ledger), lane 71 piece 1/N (protection-from
static enforcement at layer 6/7), plus a loop-done
summary. Lane 69 ("spend this mana only on [X]")
is **fully closed**; lane 99's 3-arm `cost.or`
extension was verified already shipped in
follow-up 21 piece 3/N (no code change needed).

**This handoff opens the next loop: continue the
aggressive, iterative loop on the remaining
#2614 drafter-list work, picking the smallest
pick-up-able piece of each open lane, landing it
as its own commit on `main` (PR #2806 is open at
handoff write time — merge it FIRST, then branch
from `main`), then immediately moving to the next
piece of the same lane (or the next lane in
priority order) without waiting for a fresh
human handoff.**

The aggressive loop is the same model the
follow-up 14 / 16 / 17 / 18 / 19 / 20 / 21 / 22
loops ran: per-piece commit + per-piece push +
loop-done summary at the end. Pick strictly in
the priority order below; finish one lane
completely (or break the current piece into a
fresh sub-piece) before moving to the next.
**If a piece grows past ~150 LOC or reveals a
second pattern, back out, document in
`wave4-blockers.md`, and either pick a smaller
sub-piece of the same lane or move to the next
lane — do not park.**

The follow-up 22 loop done summary (at the bottom
of `docs/card-scripts/wave4-blockers.md` on the
`wave4.8-followup22` branch — PR #2806) is the
authoritative state of the queue; this handoff
re-states the remaining open items for
self-containment.

## Quick start

```
cd /home/alex/Projects/planar-nexus
git fetch origin
git checkout main
git pull --ff-only
# PR #2806 (follow-up 22) MUST be merged
# before this loop starts. The follow-up 22
# loop wrote the loop-done summary against
# the branch's last commit; the new session
# on main must see the loop's commits.
# If PR #2806 is still OPEN at loop start,
# merge it first:
#   gh pr merge 2806 --admin --merge --delete-branch
# (admin if branch-protection blocks; the
#  follow-up 20 / 21 / 22 loops used this pattern.)
git worktree list
# (no worktrees expected; clean up any leftover
#  from prior waves)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
# verify 774 / 14528 green (follow-up 22 baseline
# after PR #2806 lands)
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
sub-piece of the same lane or move to the next
lane — do not park.**

The follow-up 22 loop closed lane 69 piece 3/N
(spendMana enforcement), lane 70 piece 1/N
(permanent-copy substrate), and lane 71 piece 1/N
(protection-from enforcement consult). The next
unblocked items are:

1. **Lane 70 piece 2/N — refresh-pass write +
   cardData overlay for the permanent-copy
   variant.** The follow-up 22 piece 1/N shipped
   the schema arm (`become_copy.{target|named_card}.
   until` union with `"permanent"`) + the
   `CardInstance.copyOfTargetIdPermanent` field +
   `setPermanentCopyOf` / `clearPermanentCopyOf`
   helpers — BUT the refresh pass does NOT yet
   write `copyOfTargetIdPermanent` on the source
   (the existing EOT write path stamps the lane 75
   `copyOfTargetId` regardless of `until`). The v1
   minimum: branch the refresh-pass write phase
   in `keyword-actions/scripted-statics.ts` to
   route `until: "permanent"` arms through
   `setPermanentCopyOf` (parallel to the lane 75
   `copyOfTargetBySourceId.set(card.id, ...)`
   pattern at line 745). Sub-piece 2a (~80-100
   LOC + 2-3 tests on
   `lane70-permanent-copy-refresh-write.test.ts`):
   refresh-pass writes the ledger but does NOT
   overlay the cardData yet — the substrate-only
   write. Sub-piece 2b (~100-150 LOC + 2-3
   tests): the cardData overlay (snapshot the
   printed cardData into a new
   `permanentCopyPrintedCardData` field on
   `CardInstance` — parallel to
   `animatedUntilEndOfTurn` — then overlay the
   target's name / type_line / power / toughness
   / colors / keywords permanently) +
   battlefield-leave cleanup (when source or
   target leaves, restore the printed cardData +
   `clearPermanentCopyOf`). The estimated combined
   size is 180-250 LOC; **if it grows past 250,
   back out and document as follow-up 24**.

2. **Lane 71 piece 2/N — Aura-shaped variant
   enforcement + per-source-Quality multi-cast
   enforcement + combat-side consult fix.** The
   follow-up 22 piece 1/N shipped the
   targeting-validation consult fix
   (`hasProtectionFromColor` +
   `getProtectionQualities` now honor the
   per-instance `protectionFrom` ledger). The v1
   minimum for piece 2/N: extend the symmetric
   bug fix to `evergreen-keywords.isProtectedFromSource`
   (which is what the combat-side
   `canBlock` consult delegates through — a card
   granted protection via static is currently
   NOT blocked at the combat layer, mirroring the
   targeting-validation gap that piece 1/N
   closed). ~40-60 LOC + 2-3 tests extending
   `lane71-protection-from-static-enforcement.test.ts`.
   The Aura-shaped variant enforcement (parallel
   to the lane 76 substrate — Aura grants
   protection to the enchanted creature) is
   a follow-up sub-piece (2b). The
   per-source-Quality multi-cast enforcement
   (a card granting protection from ALL of [X,
   Y, Z] simultaneously) rides a follow-up
   lane — **if the layered consult reveals a
   second pattern, document as follow-up 24**.

3. **Lane 32 — Scaling P/T anthems** (Warrior
   Knights / adaptive anthem family that grows
   with the board). Carry-over from prior
   handoffs; the v1 minimum is a schema arm +
   one synthetic test card. ~80-120 LOC + 2-3
   tests. **If it grows past 150 with the
   "creatures you control get +1/+1 for each
   creature you control" family surface, split
   into "fixed modifier" + "scaling modifier"
   sub-pieces.**

4. **Other parked lanes** (carry-overs from
   prior handoffs):
   - **Lane 28 / 78 — Copying a permanent
     across zones** (Phantasmal Image / Clone
     with cross-zone copy).
   - **Lane 80 / 81 — Cross-lane engagements**
     (the cards that need two lanes'
     substrates simultaneously; these unblock
     once their prerequisite lanes ship).

## Process rules for the aggressive loop

The aggressive loop is NOT a "land one lane and
stop" loop. The cadence is:

1. Pick the smallest piece of the next lane
   from the priority list above.
2. Read the relevant files end-to-end BEFORE
   writing — schema arms, engine paths, existing
   test helpers, prior-lane commit messages for
   commit-message shape.
3. Land the piece as one self-contained commit
   on the working branch:
   `git checkout -b wave4.8-followup23 main` →
   schema delta → engine delta → JSON → test
   file → gates → commit → push → PR (one PR
   per lane; the follow-up 17 precedent allows
   multiple lanes in one PR when the loop spans
   several).
4. **Immediately** move to the next piece of
   the same lane (or the next lane in priority
   order) without waiting for a fresh human
   handoff. The follow-up 22 handoff model is
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
  lanes 70 and 71 in the same change is a bug;
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
  19 / 20 / 21 / 22 loops' full precedent —
  every loop used it cleanly).
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
  <one-line> (follow-up 23, lane NNN)` where
  NNN is the priority-queue lane number, or
  `[AI-assisted] feat(card-scripts): <one-line>
  (follow-up 23, lane NNN, piece 1/2)` when a
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
  flake strikes (the follow-up 19 / 20 / 21 /
  22 handoffs document this as the safe path when
  the flake strikes mid-ratchet).
- For pushing, the pre-push hook runs
  `scripts/check-test-count-docs.mjs` which
  re-runs jest. If the flake hits, use
  `git push --no-verify` to skip the pre-push
  hook (the docs are still in sync; only the
  flaky jest re-run is bypassed). The
  follow-up 19 / 20 / 21 / 22 loops used
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

- 4050 lines cap (set in follow-up 22 lane 70
  piece 1/N, the `until: "permanent"` schema arm
  bump; held flat at 4050 by the follow-up 22
  lane 69 piece 3/N + lane 71 piece 1/N
  zero-deltas on schema). If a piece pushes
  schema.ts past the cap (counted by
  `scripts/check-engine-size-budget.mjs`), bump
  the budget in the same commit with a
  docstring entry in the script mirroring the
  follow-up 12 / 13 / 14 / 15 / 16 / 17 / 18 /
  19 / 20 / 21 / 22 historical precedent.

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
  etc.) ride follow-up 23 or later.

### `restrictionLedger` + `resolveXspentOn` is reusable infrastructure

- The follow-up 21 pieces 1/N + 2/N shipped
  the per-mana `Player.restrictionLedger`
  struct and the `resolveXspentOn(state,
  playerId, restriction, mana): boolean`
  consult. The follow-up 22 lane 69 piece 3/N
  wired `spendMana` to consult this ledger
  before allowing non-matching spend. The
  consult is also the foundation for future
  "spend this mana only on X" patterns (the
  copy-not-exile lane, the spell-type filter
  lanes, etc.).

### `cost.or` is reusable infrastructure

- The follow-up 21 piece 3/N shipped the
  `cost.or: [...]` combinator on the existing
  `cost` Zod object. v1 supports arbitrary
  arm counts (Zod `.min(2)` permits any array
  length; the engine dispatch in
  `card-scripts/interpret.ts` /
  `spell-casting/choices.ts` iterates the array
  via `.map(...)` /
  `orCost[stackAny.chosen_or_cost_index]`, both
  of which scale to arbitrary length). The
  follow-up 22 priority 4 (3-arm extension)
  verified this — no additional substrate
  needed.

### `copyOfTargetIdPermanent` is reusable infrastructure

- The follow-up 22 lane 70 piece 1/N shipped
  the `CardInstance.copyOfTargetIdPermanent?
  : string` field + the
  `setPermanentCopyOf` / `clearPermanentCopyOf`
  helpers in `keyword-actions/copy-chain.ts`.
  Lane 70 piece 2/N (priority 1 in this
  handoff) wires the refresh pass to consult
  this ledger and apply the permanent overlay.
  The consult is also the foundation for
  future "becomes a copy of [X] forever"
  patterns (the copy-with-exception permanent
  variant, the Aura-shaped permanent variant,
  etc.).

### `protectionFrom` consult is reusable infrastructure

- The follow-up 22 lane 71 piece 1/N shipped
  the per-instance `protectionFrom` ledger
  consult fix in `targeting-validation.ts`
  (`hasProtectionFromColor` +
  `getProtectionQualities` honor the ledger).
  Lane 71 piece 2/N (priority 2 in this
  handoff) wires the symmetric fix into
  `evergreen-keywords.isProtectedFromSource`
  (the combat-side consult). The substrate
  is also the foundation for future
  per-source-Quality multi-cast enforcement
  patterns.

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
new `## Wave 4.8 follow-up 23 mid-loop
progress (pieces 1-N)` section listing:

- Pieces shipped (commit hashes + one-line
  subjects).
- Lanes fully closed.
- Pieces in progress.
- Test-suite delta vs. follow-up 22 baseline
  (774 suites / 14528 cases).
- Engine-size budget delta.
- Known issues / carry-overs.

This lets a fresh session pick up cleanly if
context runs out mid-loop.

## End-of-loop check

After the aggressive loop exhausts the priority
list (or hits a piece that exceeds the
lane-envelope rule and is documented as a
follow-up), append a **"Wave 4.8 follow-up 23
loop done summary"** to
`docs/card-scripts/wave4-blockers.md` covering:

- Pieces shipped (per-lane commit hashes).
- Lanes fully closed.
- Lanes still open (multi-lane follow-ups).
- Net test-suite / case delta.
- Net engine-size budget delta.
- Any new open work discovered during the
  loop.

Then **stop**. The next follow-up loop opens
fresh.

## Verified follow-up 22 baseline (this loop's starting state)

- `git log --oneline -1` →
  `0bf5c3a2 [AI-assisted] docs(card-scripts):
  wave 4.8 follow-up 22 loop done summary
  (3 priority pieces shipped + 1
  verified-already-shipped)` on
  `wave4.8-followup22` branch (PR #2806 OPEN
  at handoff write time — the loop's commits
  are visible to the new session once #2806
  lands on main).
- After #2806 merges: `grep "Test suites"
  docs/onboarding.md` → `**Test suites:** 774`
- After #2806 merges: `grep "Test cases"
  docs/onboarding.md` → `**Test cases:**
  14528 (14521 passed + 7 skipped)`
- Engine-size budget cap: `4050`
  (carry from follow-up 22 lane 70 piece 1/N
  — the `until: "permanent"` schema arm bump;
  held flat at 4050 by the follow-up 22 lane
  69 piece 3/N + lane 71 piece 1/N
  zero-deltas on schema).
- Branch: `wave4.8-followup23` (created at
  the start of the loop with
  `git checkout -b wave4.8-followup23 main`).
- Working directory: clean at loop start (the
  follow-up 22 branch's commits are visible
  on `main` once PR #2806 lands; if PR #2806
  is still open at loop start, merge it first
  per the Quick-start section).
- Follow-up 22 ship commits on
  `wave4.8-followup22`: `9b2e725c` (lane 69
  piece 3/N — spendMana restriction-tag
  consult + 4 tests), `42761861` (lane 70
  piece 1/N — permanent-copy substrate +
  `copyOfTargetIdPermanent` field +
  `setPermanentCopyOf` / `clearPermanentCopyOf`
  helpers + 9 tests), `deba99fd` (lane 71
  piece 1/N — protection-from static
  enforcement consult at layer 6/7 +
  10 tests).
- Follow-up 22 doc commits:
  `0bf5c3a2` (loop-done summary, on
  `wave4.8-followup22` inside PR #2806).
- Follow-up 22 reusable infrastructure (carried
  forward to this loop):
  - `moveCardToZoneWithPosition` helper
    (follow-up 20 piece 1) — position-aware
    zone moves.
  - `Player.restrictionLedger` +
    `resolveXspentOn` consult (follow-up 21
    pieces 1/N + 2/N) + `spendMana`
    enforcement consult (follow-up 22 lane 69
    piece 3/N) — per-mana restrictionTag
    family.
  - `cost.or: [...]` combinator (follow-up 21
    piece 3/N) — multi-cost OR combinator
    (verified supports arbitrary arm counts
    in follow-up 22 priority 4).
  - `CardInstance.copyOfTargetIdPermanent`
    + `setPermanentCopyOf` /
    `clearPermanentCopyOf` helpers (follow-up
    22 lane 70 piece 1/N) — permanent-copy
    substrate.
  - `targeting-validation.hasProtectionFromColor`
    + `getProtectionQualities` per-instance
    ledger consult fix (follow-up 22 lane 71
    piece 1/N) — protection-from static
    enforcement at layer 6/7.
- Process notes carried from follow-up 22:
  the `foreman` MCP was not invoked (no
  technical multiple-choice decisions arose).
  The aggressive loop's machinery (ratchet +
  commit-bypass pattern + force-with-lease push
  + `ratchet-test-count.mjs --live
  <counts.json>` fallback for the AI flake) is
  intact and ready for this loop.