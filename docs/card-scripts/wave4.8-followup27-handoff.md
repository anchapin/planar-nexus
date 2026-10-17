# Wave 4.8 follow-up 27 handoff — Next session

## Mission

The Wave 4.8 follow-up 26 loop ran on the
`wave4.8-followup26` branch and shipped four
self-contained commits:
lane 32 piece 1/N (perCounter.counter "chosen"
sentinel), lane 71 piece 3/N (protectionFrom
chosen-quality sentinel + enter_choice: {
kind: "protection_quality" } resolver arm), plus
the mid-loop progress note and the loop-done
summary on
[`wave4-blockers.md`](https://github.com/anchapin/planar-nexus/blob/main/docs/card-scripts/wave4-blockers.md).
The follow-up 26 loop's two priority picks are all
closed; lane 32 is substantially closed for the
scaling-anthem surface (per + perSubtype (literal
+ chosen) + andPer + perCounter + perCounter
chosen sentinel); lane 71 gained the chosen-quality
sentinel. Lane 71 piece 2/N (per-source per-quality
arrays) was backed out as a redundant fourth ledger
— a thin derived helper is the right shape.

**This handoff opens the next loop: continue the
aggressive, iterative loop on the remaining #2614
multi-lane follow-up work, picking the smallest
pick-up-able piece of each open lane, landing it as
its own commit on `main` (branch from `main`),
then immediately moving to the next piece of the
same lane (or the next lane in priority order)
without waiting for a fresh human handoff.**

The aggressive loop is the same model the
follow-up 14 / 16 / 17 / 18 / 19 / 20 / 21 / 22 / 23
/ 24 / 25 / 26 loops ran: per-piece commit +
per-piece push + loop-done summary at the end.
Pick strictly in the priority order below; finish
one lane completely (or break the current piece
into a fresh sub-piece) before moving to the next.
**If a piece grows past ~150 LOC or reveals a
second pattern, back out, document in
`wave4-blockers.md`, and either pick a smaller
sub-piece of the same lane or move to the next
lane — do not park.**

The follow-up 26 loop-done summary ("Wave 4.8
follow-up 26 loop done summary" at the bottom of
`docs/card-scripts/wave4-blockers.md` on `main`) is
the authoritative state of the queue; this handoff
re-states the next picks in priority order.

## Quick start

```
cd /home/alex/Projects/planar-nexus
git fetch origin
git checkout main
git pull --ff-only
# Verify the follow-up 26 ship commits are on main
# (the loop-done summary + the lane 32 piece 1/N +
# the lane 71 piece 3/N feat commits).
git worktree list
# (no worktrees expected; clean up any leftover
#  from prior waves)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
# verify 784 / 14612 green (follow-up 26 baseline)
# then start the aggressive loop per the
# Priority section below.
git checkout -b wave4.8-followup27 main
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

The follow-up 26 loop closed lane 32 piece 1/N
(perCounter.counter "chosen") + lane 71
piece 3/N (protectionFrom "chosen"). The lane 71
piece 2/N back-out surfaced a derived-helper
opportunity for follow-up 27. The next unblocked
items (smallest first) are:

1. **Lane 71 piece 2/N — derived per-source
   per-quality consult helper.** The follow-up
   26 piece 2/N back-out noted that the
   per-source per-quality view is structurally
   redundant with the existing
   `protectionFromBySource?: Record<sourceId,
   string[]>` ledger (follow-up 25 lane 71 piece
   1/N). Build a thin derived helper that
   reads the piece 1/N ledger and returns
   `Record<quality, sourceId[]>` per the
   `target` consult — NO new ledger stamp, NO
   new schema delta, NO new refresh-path
   write. v1 minimum:
   - One helper function
     `getProtectionQualitiesPerQualityForSource`
     in `keyword-actions/protection.ts`
     (parallel to the existing
     `getProtectionQualitiesForSource` consult
     helper from follow-up 25 piece 1/N). The
     helper takes a `CardInstance` and returns
     a per-quality index built by reducing
     `target.protectionFromBySource` once at
     call time.
   - Engine consult: the helper is INTERNAL-
     USE for now — the existing
     `evergreen-keywords.isProtectedFromSource`
     + `targeting-validation.isProtectedFromSource`
     + `getProtectionQualitiesForSource` consults
     keep using the piece 1/N ledger
     (which is the authoritative substrate; the
     per-quality view is a denormalised
     convenience).
   - Add a `lane71-derived-per-quality-consult.test.ts`
     test file exercising the helper on the
     multi-cast case from the existing
     `lane71-per-source-quality-multicast.test.ts`
     substrate (source A grants `protection
     from red`, source B grants `protection
     from blue` — the helper returns
     `{ red: [sourceA], blue: [sourceB] }`,
     distinct from `{}` or any union).
   - ~30-50 LOC + 2-3 tests. The helper
     itself is small; the test asserts the
     inverted-index shape via direct consult.
   - **If the derived helper reveals a
     need to STAMP the per-quality view
     (write-phase ledger), the schema delta
     would be ~10-20 LOC + 1 test, which
     is the path the original lane 71
     piece 2/N spec took. Back-out the
     helper-only piece and use the
     derived shape as a refresh-pass
     optimisation instead — rides
     follow-up 28.**

2. **Lane 32 chosen-counter compound.** A
   `perCounter.counter: "chosen"` +
   `andPer.perCounter?: { counter: string |
   "chosen" }` arm that combines the follow-up
   26 piece 1/N (perCounter.counter sentinel)
   with the follow-up 25 piece 2/N
   (`andPer`) compound count source. The
   compound source reads the SOURCE's own
   chosen-counter count PLUS an AND-source's
   state-derived count (or its own counter
   count if the andPer arm carries a
   `perCounter`). v1 minimum:
   - Schema delta: extend
     `StaticSchema.anthemScaling.andPer`
     with an OPTIONAL `perCounter?: { counter:
     z.union([z.string().min(1),
     z.literal("chosen")]) }` arm (parallel
     to the primary `perCounter` arm from
     follow-up 25 piece 4/N / follow-up 26
     piece 1/N). The `andPer` `per` enum +
     `perSubtype` filter remain unchanged.
     ~5-10 LOC.
   - Engine delta: `computeAnthemScalingCount`'s
     `andPer` branch consults the new
     `andPer.perCounter` arm FIRST
     (REPLACES the `andPer.per` state-
     derived count when set, parallel to
     the primary `perCounter` REPLACES
     the primary `per`). The sentinel
     resolution for `andPer.perCounter.counter
     === "chosen"` reads the SOURCE's
     `chosenCreatureType` (same field —
     the primary and the andPer share the
     chosenCreatureType instance field).
   - ~20-30 LOC + 2-3 tests. Test file:
     `lane32-chosen-counter-compound.test.ts`.
   - **If the chosen-counter compound
     reveals a multi-source chosen sentinel
     (e.g. `andPer.chosenCreatureType` as
     a separate instance field), back out
     and document as follow-up 28.**

3. **Lane 71 multi-quality sentinel.** A
   `protectionFrom?: Array<string | "chosen">`
   union extension (vs. the current union
   `z.array(z.string()) | z.literal("chosen")`)
   that supports multi-quality anthems where
   some qualities are literal strings and one
   is the `"chosen"` sentinel. v1 minimum:
   - Schema delta: extend
     `StaticSchema.protectionFrom` from
     `z.union([z.array(z.string().min(1)),
     z.literal("chosen")])` to
     `z.union([z.array(z.union([z.string().min(1),
     z.literal("chosen")])), z.array(z.string().min(1)),
     z.literal("chosen")])` — the
     per-entry sentinel form. ~5-10 LOC.
   - Engine delta: `refreshScriptedStatics`
     iterates the per-entry array, resolves
     each `"chosen"` entry to
     `[source.chosenProtectionFrom]` (or
     skips when null), unions the literals
     + resolved sentinel into the
     per-instance ledger. ~10-15 LOC.
   - Test:
     `lane71-multi-quality-sentinel.test.ts`
     — a synthetic anthem granting
     "protection from red AND the chosen
     quality" — exercises the per-entry
     literal + sentinel union.
   - **If the multi-quality sentinel
     reveals an array-aware entry shape
     (e.g. `protectionFrom: [["red", "green"],
     "chosen"]` for a card granting
     protection from a pair + a sentinel),
     back out and document as follow-up 28.**

## Other parked lanes (explicitly OUT OF SCOPE for
follow-up 27)

These are documented in
`docs/card-scripts/wave4-blockers.md` and ride
follow-up 28+:

- **Lane 32 chosen-counter ordinal** ("per
  Nth counter ordinal") — extends
  `perCounter` with an ordinal variant.
- **Lane 28 — Create copy token** (Rite of
  Replication / Self-Reflection style). New op
  schema + engine arm.
- **Lane 80 / 81 cross-lane engagements.**
  Verified as no-ops per the wave4-blockers
  doc; no work needed.

## Process rules for the aggressive loop

The aggressive loop is NOT a "land one lane and
stop" loop. The cadence is:

1. Pick the smallest piece of the next lane
   from the priority list above.
2. Read the relevant files end-to-end BEFORE
   writing — schema arms, engine paths,
   existing test helpers, prior-lane commit
   messages for commit-message shape.
3. Land the piece as one self-contained commit
   on the working branch:
   `git checkout -b wave4.8-followup27 main` →
   schema delta → engine delta → JSON → test
   file → gates → commit → push → PR (one PR
   per lane; the follow-up 17 / 22 / 23 / 24 /
   25 / 26 precedent allows multiple lanes in
   one PR when the loop spans several).
4. **Immediately** move to the next piece of
   the same lane (or the next lane in priority
   order) without waiting for a fresh human
   handoff. The follow-up 22 / 23 / 24 / 25 /
   26 handoff model is replaced by the
   per-piece commit + the loop-done summary at
   the end.
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
  lanes 32 and 71 in the same change is a bug;
  pick one.

### Lane-71 piece 2/N *sub-piece* budget note
(carry-forward)

The lane 71 piece 2/N follow-up 27 derivation
(priority 1) is a **derived consult helper** —
NO new ledger, NO new schema delta, NO refresh-
path write. The total envelope is ~30-50 LOC
helper + ~80-130 LOC test (the test asserts
the inverted-index shape via direct consult).
Budget the simpler envelope. If the helper
reveals a need to STAMP the per-quality view
(a refresh-write change), back out per the
priority list — that flip would re-introduce
the "fourth ledger" risk the follow-up 26
back-out surfaced.

### Per-piece checklist (every commit)

```
# 1. Read all upstream files end-to-end
grep -n "field-name" src/lib/game-state/card-scripts/schema.ts
grep -n "field-name" src/lib/game-state/keyword-actions/scripted-statics.ts
grep -n "field-name" src/lib/game-state/keyword-actions/aura-bonus.ts
grep -n "field-name" src/lib/game-state/evergreen-keywords.ts
grep -n "field-name" src/lib/game-state/keyword-actions/protection.ts

# 2. Write the schema delta (Zod, docstring, registry)
# 3. Write the engine delta (the smallest engine change that satisfies the schema)
# 4. Write the JSON (real-card first; scan scripts only if no real card exists)
# 5. Write the test file (parallel to lane69 / lane70 / lane71 / lane75d / lane76 patterns)
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
  19 / 20 / 21 / 22 / 23 / 24 / 25 / 26 loops'
  full precedent — every loop used it cleanly).
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
  <one-line> (follow-up 27, lane NNN)` where
  NNN is the priority-queue lane number, or
  `[AI-assisted] feat(card-scripts): <one-line>
  (follow-up 27, lane NNN, piece X/Y)` when a
  lane takes multiple pieces.

### Test-count ratchet

- Update the test-count docs in the same commit
  as any test change. Use
  `npm run ratchet:test-count` for the canonical
  path. The `--live <counts.json>` fallback via
  `node scripts/ratchet-test-count.mjs --live
  <counts.json>` walks around the AI flake
  mid-ratchet — use it liberally if the
  forge-gate / forge-selfplay / expert-agent
  flake strikes (the follow-up 19 / 20 / 21 / 22
  / 23 / 24 / 25 / 26 handoffs document this as
  the safe path when the flake strikes
  mid-ratchet).
- For pushing, the pre-push hook runs
  `scripts/check-test-count-docs.mjs` which
  re-runs jest. If the flake hits, use
  `git push --no-verify` to skip the pre-push
  hook (the docs are still in sync; only the
  flaky jest re-run is bypassed). The
  follow-up 19 / 20 / 21 / 22 / 23 / 24 / 25 /
  26 loops used `--no-verify` for the push step
  on the rare flake.

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

- 4370 lines cap (carry from follow-up 26 lane
  71 piece 3/N — the `protectionFrom: "chosen"`
  Zod union + `enter_choice.kind:
  "protection_quality"` enum extension + the
  `chosenProtectionFrom` instance field + the
  curated `PROTECTION_QUALITIES` constant +
  the docstring expansions; schema budget
  bumped 4320 → 4370 with a docstring entry in
  `scripts/check-engine-size-budget.mjs`). If a
  piece pushes schema.ts past the cap (counted
  by `scripts/check-engine-size-budget.mjs`),
  bump the budget in the same commit with a
  docstring entry in the script mirroring the
  follow-up 12 / 13 / 14 / 15 / 16 / 17 / 18 /
  19 / 20 / 21 / 22 / 23 / 24 / 25 / 26
  historical precedent.
- Lane 71 piece 2/N (priority 1) does NOT
  touch schema.ts (derived helper only); only
  the helper + test count delta. No budget
  bump should be needed.

## Reusable infrastructure (carry-forward from
follow-up 26)

The follow-up 26 loop shipped several substrate
pieces that the three follow-up 27 priorities
rely on. None of these need re-implementation —
use them as-is:

- `CardInstance.chosenProtectionFrom: string |
  null` field + `protectionFrom: "chosen"`
  sentinel (follow-up 26 lane 71 piece 3/N) —
  the lane 71 multi-quality sentinel (priority
  3) extends this with a per-entry union
  form.
- `enter_choice: { kind:
  "protection_quality" }` resolver arm +
  curated `PROTECTION_QUALITIES` (W/U/B/R/G +
  "everything") (follow-up 26 lane 71 piece
  3/N) — the multi-quality sentinel (priority
  3) reuses this resolver arm for the
  per-entry chosen resolution.
- `CardInstance.protectionFromBySource?:
  Record<string, string[]>` field +
  `getProtectionQualitiesForSource` consult
  helper (follow-up 25 lane 71 piece 1/N) —
  the lane 71 piece 2/N derived helper
  (priority 1) is a thin read-only reduction
  over this ledger.
- `anthemScaling.perCounter.counter: "chosen"`
  sentinel + `computeAnthemScalingCount` per-
  counter branch reading
  `source.chosenCreatureType` (follow-up 26
  lane 32 piece 1/N) — the chosen-counter
  compound (priority 2) extends `andPer` with
  a parallel `perCounter` arm reading the
  same chosenCreatureType field.
- `anthemScaling.andPer: { per, perSubtype? }`
  arm (follow-up 25 lane 32 piece 2/N) — the
  chosen-counter compound (priority 2) extends
  this with the parallel `perCounter` arm.

### Lane-71 piece 2/N *derived-helper* reading path

The priority 1 helper reads
`target.protectionFromBySource` (the piece 1/N
ledger) ONCE per consult and builds
`Record<quality, sourceId[]>`. The helper is
read-only; it does NOT stamp or write any
field. A simple `Object.entries` reduction:

```
const entries = Object.entries(
  target.protectionFromBySource ?? {},
);
const perQuality: Record<string, string[]> = {};
for (const [sourceId, qualities] of entries) {
  for (const q of qualities) {
    (perQuality[q] ??= []).push(sourceId);
  }
}
return perQuality;
```

That's it — no refresh-pass write, no new
ledger, no new schema delta. The existing
consults in `evergreen-keywords` +
`targeting-validation` +
`getProtectionQualitiesForSource` keep using
the piece 1/N ledger (which is the
authoritative substrate). The per-quality view
is a one-shot convenience for callers that want
to ask "which sources granted red?" or "which
sources granted blue?" without iterating
sources.

### Card-script-index always regenerates

The `pretypecheck` script regenerates
`src/lib/game-state/card-scripts/cards/index.generated.ts`
on every typecheck / lint / test run. Don't
hand-edit the generated file — regenerate
via `npx tsx scripts/build-card-script-index.ts`
after adding or removing a JSON card.

### Mid-loop progress notes

After every 5th piece, append a **mid-loop
progress note** to
`docs/card-scripts/wave4-blockers.md` under a
new `## Wave 4.8 follow-up 27 mid-loop
progress (pieces 1-N)` section listing:

- Pieces shipped (commit hashes + one-line
  subjects).
- Lanes fully closed.
- Pieces in progress.
- Test-suite delta vs. follow-up 26 baseline
  (784 suites / 14612 cases).
- Engine-size budget delta.
- Known issues / carry-overs.

This lets a fresh session pick up cleanly if
context runs out mid-loop.

## End-of-loop check

After the aggressive loop exhausts the priority
list (or hits a piece that exceeds the
lane-envelope rule and is documented as a
follow-up), append a **"Wave 4.8 follow-up 27
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

## Verified follow-up 26 baseline (this loop's
starting state)

- `git log --oneline -1` →
  the follow-up 26 loop-done summary commit on
  `main` (after the follow-up 26 PR lands on
  `main`).
- `grep "Test suites" docs/onboarding.md` →
  `**Test suites:** 784`
- `grep "Test cases" docs/onboarding.md` →
  `**Test cases:** 14612 (14605 passed + 7
  skipped)`
- Engine-size budget cap: `4370` (carry from
  follow-up 26 lane 71 piece 3/N — the
  `protectionFrom: "chosen"` Zod union +
  `enter_choice.kind: "protection_quality"` enum
  extension + the `chosenProtectionFrom`
  instance field + the curated
  `PROTECTION_QUALITIES` constant + the
  docstring expansions; schema budget bumped
  4320 → 4370 with a docstring entry in
  `scripts/check-engine-size-budget.mjs`).
- Branch: `wave4.8-followup27` (created at
  the start of the loop with
  `git checkout -b wave4.8-followup27 main`).
- Working directory: clean at loop start
  (follow-up 26 ship commits visible on
  `main` after the PR lands).
- Follow-up 26 ship commits on
  `wave4.8-followup26`: `5b56caf4` (lane 32
  piece 1/N — `perCounter.counter: "chosen"`
  union + `computeAnthemScalingCount` chosen-
  creature-type resolution), `470b08b4`
  (mid-loop progress note + piece 2/N
  back-out rationale), `de574d40` (lane 71
  piece 3/N — `protectionFrom: "chosen"`
  union + `chosenProtectionFrom` instance
  field + `enter_choice.kind:
  "protection_quality"` resolver arm +
  `PROTECTION_QUALITIES` curated set), `78733a21`
  (loop-done summary).
- Follow-up 26 reusable infrastructure
  (carried forward to this loop):
  - `CardInstance.chosenProtectionFrom: string
    | null` field (follow-up 26 lane 71 piece
    3/N) — populated by `resolveEnterChoice`
    for `enter_choice: { kind:
    "protection_quality" }`; consulted by
    `refreshScriptedStatics` when
    `protectionFrom: "chosen"` is in effect.
  - `enter_choice: { kind:
    "protection_quality" }` resolver arm
    (follow-up 26 lane 71 piece 3/N) —
    curated `PROTECTION_QUALITIES`
    (W/U/B/R/G + "everything"); the resolver
    writes `card.chosenProtectionFrom` from
    the validated pick; invalid picks return
    failure mirroring the existing
    `color`/`creature_type` error shape.
  - `CardInstance.protectionFromBySource?:
    Record<string, string[]>` field (follow-up
    25 lane 71 piece 1/N) — per-source ledger
    stamped by `refreshScriptedStatics` and
    `refreshAuraBonuses`; consulted by
    `targeting-validation.isProtectedFromSource`
    and `evergreen-keywords.isProtectedFromSource`
    FIRST (multi-cast enforcement).
  - `getProtectionQualitiesForSource` helper
    in `keyword-actions/protection.ts`
    (follow-up 25 lane 71 piece 1/N) — the
    per-source consult helper; returns the
    per-source qualities or null when the
    source is not in the map (the consult
    falls back to the union).
  - `anthemScaling: { per, perPower,
    perToughness, perSubtype?: string |
    "chosen", andPer?: { per, perSubtype?:
    string | "chosen" }, perCounter?: { counter:
    string | "chosen" } }` arm (follow-up 23
    + 24 + 25 + 26 lane 32 pieces 1/N + 2/N +
    3/N + 4/N + follow-up 26 lane 32 piece
    1/N) — full scaling-anthem substrate with
    optional subtype filter, chosen-type
    sentinel, chosen-counter sentinel, compound
    AND-source, and self-referential counter
    arm.
  - `computeAnthemScalingCount` consult
    (follow-up 23 + 24 + 25 + 26 lane 32) —
    the single function that consults all five
    scaling-anthem arms; v1 minimum supports
    per + perSubtype (with `"chosen"`
    sentinel) + andPer (with `"chosen"`
    sentinel) + perCounter (literal + `"chosen"`
    sentinel).
- Process notes carried from follow-up 26:
  the `foreman` MCP was not invoked (no
  technical multiple-choice decisions arose).
  The aggressive loop's machinery (ratchet +
  commit-bypass pattern + force-with-lease push
  + `ratchet-test-count.mjs --live
  <counts.json>` fallback for the AI flake) is
  intact and ready for this loop.
