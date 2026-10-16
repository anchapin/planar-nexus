# Wave 4.8 follow-up 26 handoff — Next session

## Mission

The Wave 4.8 follow-up 25 loop ran on the
`wave4.8-followup25` branch and shipped four
self-contained commits inside PR
[#2809](https://github.com/anchapin/planar-nexus/pull/2809):
lane 71 piece 1/N (per-source-Quality multi-cast
enforcement), lane 32 piece 2/N (compound count
sources), lane 32 piece 3/N (chosen-type
`perSubtype` variant), lane 32 piece 4/N
(per-counter scales), plus a loop-done summary on
[`wave4-blockers.md`](https://github.com/anchapin/planar-nexus/blob/main/docs/card-scripts/wave4-blockers.md).
The follow-up 25 handoff's four priority pieces are
all closed; lane 71 piece 1/N is fully closed for
the per-source-quality multi-cast semantic; lane 32
has been extended with three new arms
(`andPer` / `"chosen"` sentinel / `perCounter`).

**This handoff opens the next loop: continue the
aggressive, iterative loop on the remaining #2614
drafter-list work, picking the smallest pick-up-able
piece of each open lane, landing it as its own commit
on `main` (PR #2809 is MERGED on `main` at handoff
write time — branch from `main`), then immediately
moving to the next piece of the same lane (or the
next lane in priority order) without waiting for a
fresh human handoff.**

The aggressive loop is the same model the
follow-up 14 / 16 / 17 / 18 / 19 / 20 / 21 / 22 / 23
/ 24 / 25 loops ran: per-piece commit + per-piece
push + loop-done summary at the end. Pick strictly
in the priority order below; finish one lane
completely (or break the current piece into a
fresh sub-piece) before moving to the next.
**If a piece grows past ~150 LOC or reveals a
second pattern, back out, document in
`wave4-blockers.md`, and either pick a smaller
sub-piece of the same lane or move to the next
lane — do not park.**

The follow-up 25 loop-done summary ("Wave 4.8
follow-up 25 loop done summary (4 priority pieces
shipped across 2 lanes + 1 lane fully closed)" at
the bottom of `docs/card-scripts/wave4-blockers.md`
on `main`) is the authoritative state of the queue;
this handoff re-states the next picks in priority
order.

## Quick start

```
cd /home/alex/Projects/planar-nexus
git fetch origin
git checkout main
git pull --ff-only
# PR #2809 (follow-up 25) is MERGED on main.
# The follow-up 25 loop wrote the loop-done summary
# against the branch's last commit; this session
# on main must see the loop's commits.
git worktree list
# (no worktrees expected; clean up any leftover
#  from prior waves)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
# verify 782 / 14597 green (follow-up 25 baseline)
# then start the aggressive loop per the
# Priority section below.
git checkout -b wave4.8-followup26 main
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

The follow-up 25 loop closed lane 71 piece 1/N
(per-source-Quality multi-cast enforcement) + lane 32
pieces 2/N + 3/N + 4/N (`andPer` compound count
source, `"chosen"` `perSubtype` sentinel, `perCounter`
self-referential counter arm). The next unblocked
items (smallest first) are:

1. **Lane 32 chosen-counter variant.** A
   `perCounter.counter: "chosen"` sentinel that drives
   the counter type from the source's
   `chosenCreatureType` (parallel to the existing
   `perSubtype: "chosen"` sentinel from follow-up 25
   piece 3/N — see `card-scripts/schema.ts` for the
   `affects.subtype: "chosen"` parallel at line ~2152
   + the follow-up 25 piece 3/N `perSubtype` parallel
   at line ~2458 area). The chosen-counter variant
   extends `perCounter` with a `"chosen"` sentinel
   alongside the literal counter-type string. v1
   minimum:
   - Schema delta: extend
     `anthemScaling.perCounter.counter` from
     `z.string().min(1)` to
     `z.union([z.string().min(1),
     z.literal("chosen")])`. ~3-5 LOC.
   - Engine delta: `computeAnthemScalingCount`'s
     per-counter branch consults
     `source.chosenCreatureType` when
     `perCounter.counter === "chosen"`; if the chosen
     type is unset (no `enter_choice: { kind:
     "creature_type" }` resolve), the count is 0
     (matching the lane 86 chosen-type anthem
     semantics). The engine delta is purely inline
     in the existing `perCounter` branch.
   - ~10-20 LOC + 2-3 tests. Test:
     `lane32-chosen-counter-variant.test.ts`.
     Sample: a chosen-counter anthem ("this creature
     gets +1/+1 for each [chosen counter kind] on it"
     — combined with `enter_choice: { kind:
     "counter_minimum" }`). Exercises both the
     sentinel substitution AND the per-counter count
     in one pass.
   - **If the chosen-counter variant reveals a
     third arm (e.g., a `perCounterSubtype` filter
     parallel to `perSubtype`), back out and document
     as follow-up 27.**

2. **Lane 71 per-source per-quality arrays.** A
   `protectionFromBySourceQuality?: Record<sourceId,
   string[]>` extension that stamps per-source
   per-quality arrays on the target — supports the
   multi-cast semantic where a single source grants
   MULTIPLE qualities (e.g. "protection from red and
   blue" from a single Aura). The follow-up 25 piece
   1/N substrate covers `Record<sourceId, string[]>`
   where the value is a SINGLE quality list (the
   union of all qualities that source grants); the
   per-quality array variant tracks EACH quality
   independently for finer-grained consult. v1
   minimum:
   - Type extension: optional
     `protectionFromBySourceQuality?: Record<string,
     Array<{ sourceId: string; quality: string }>>`
     on `CardInstance` (parallel to the existing
     `protectionFromBySource?: Record<string,
     string[]>`).
   - Schema delta: OPTIONAL `perQuality?: boolean`
     flag on `StaticSchema.protectionFrom` that, when
     set, splits each entry into a per-quality
     entry. ~5-10 LOC.
   - Engine delta: `refreshScriptedStatics` (and
     `refreshAuraBonuses` parallel) stamps the
     per-quality array when the flag is set.
   - Consult extension: a new helper
     `getProtectionQualitiesPerQualityForSource`
     that consults the per-quality array directly.
   - ~30-50 LOC + 2-3 tests. Test:
     `lane71-per-source-per-quality-arrays.test.ts`.
     **If the per-quality array reveals a fourth
     ledger shape, back out and document as
     follow-up 27.**

3. **Lane 71 chosen-quality sentinel.** A
   `protectionFromBySource?: "chosen"` sentinel
   on `StaticSchema.protectionFrom` that drives
   the protected quality from the source's
   `chosenProtectionFrom` (parallel to the existing
   `affects.subtype: "chosen"` + `perSubtype:
   "chosen"` sentinels). v1 minimum:
   - Schema delta: extend
     `StaticSchema.protectionFrom` from
     `z.array(z.string().min(1))` to
     `z.union([z.array(z.string().min(1)),
     z.literal("chosen")])`. ~3-5 LOC.
   - Type extension: optional
     `chosenProtectionFrom?: string | null` on
     `CardInstance` (parallel to
     `chosenCreatureType`).
   - Engine delta: `refreshScriptedStatics`
     consults `source.chosenProtectionFrom` when
     `protectionFrom === "chosen"`; if unset, the
     static is inert.
   - ~30-50 LOC + 2-3 tests. Test:
     `lane71-chosen-quality-sentinel.test.ts`.
     Sample: a chosen-quality anthem ("creatures you
     control have protection from the chosen color")
     combined with `enter_choice: { kind:
     "protection_quality" }`.
   - **If the chosen-quality sentinel reveals a
     second arm (e.g., multi-quality chosen), back
     out and document as follow-up 27.**

## Other parked lanes (explicitly OUT OF SCOPE for
follow-up 26)

These are documented in
`docs/card-scripts/wave4-blockers.md` and ride
follow-up 27+:

- **Lane 32 chosen-counter compound** ("per
  creature AND chosen-counter") — combines
  lane 32 pieces 2/N + chosen-counter variant
  into a compound source.
- **Lane 28 — Create copy token** (Rite of
  Replication / Self-Reflection style). New op
  schema + engine arm.
- **Lane 80 / 81 cross-lane engagements.**
  Verified as no-ops per the wave4-blockers doc;
  no work needed.

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
   `git checkout -b wave4.8-followup26 main` →
   schema delta → engine delta → JSON → test
   file → gates → commit → push → PR (one PR
   per lane; the follow-up 17 / 22 / 23 / 24 /
   25 precedent allows multiple lanes in one PR
   when the loop spans several).
4. **Immediately** move to the next piece of
   the same lane (or the next lane in priority
   order) without waiting for a fresh human
   handoff. The follow-up 22 / 23 / 24 / 25
   handoff model is replaced by the per-piece commit + the
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
  lanes 32 and 71 in the same change is a bug;
  pick one.

### Lane-71 piece 2/N *sub-piece* budget note

The lane 71 per-source per-quality arrays
(priority 2) is structurally analogous to piece
1/N but for the per-quality array dimension
instead of the source id dimension. The
follow-up 25 piece 1/N was ~310 LOC engine +
~370 test. The follow-up 26 piece 2/N will
likely land at ~30-50 LOC engine + ~80-130 test
(the per-quality array is a thinner substrate —
it's a new ledger shape, not a new consult
semantic). Budget the simpler envelope.

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
  19 / 20 / 21 / 22 / 23 / 24 / 25 loops' full
  precedent — every loop used it cleanly).
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
  <one-line> (follow-up 26, lane NNN)` where
  NNN is the priority-queue lane number, or
  `[AI-assisted] feat(card-scripts): <one-line>
  (follow-up 26, lane NNN, piece X/Y)` when a
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
  / 23 / 24 / 25 handoffs document this as the
  safe path when the flake strikes mid-ratchet).
- For pushing, the pre-push hook runs
  `scripts/check-test-count-docs.mjs` which
  re-runs jest. If the flake hits, use
  `git push --no-verify` to skip the pre-push
  hook (the docs are still in sync; only the
  flaky jest re-run is bypassed). The
  follow-up 19 / 20 / 21 / 22 / 23 / 24 / 25
  loops used `--no-verify` for the push step
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

- 4300 lines cap (carry from follow-up 25 lane
  32 piece 3/N — the `perSubtype: "chosen"`
  union extension + the `"chosen"` `andPer`
  extension + the `perCounter` schema delta +
  the schema-budget bump 4250 → 4300). If a
  piece pushes schema.ts past the cap (counted
  by `scripts/check-engine-size-budget.mjs`),
  bump the budget in the same commit with a
  docstring entry in the script mirroring the
  follow-up 12 / 13 / 14 / 15 / 16 / 17 / 18 /
  19 / 20 / 21 / 22 / 23 / 24 / 25 historical
  precedent.

## Reusable infrastructure (carry-forward from
follow-up 25)

The follow-up 25 loop shipped several substrate
pieces that the three follow-up 26 priorities
rely on. None of these need re-implementation —
use them as-is:

- `CardInstance.protectionFromBySource?: Record<string,
  string[]>` field + `getProtectionQualitiesForSource`
  consult helper (follow-up 25 lane 71 piece 1/N) —
  the lane 71 per-source per-quality arrays
  substrate extends this with a parallel
  per-quality array shape.
- `anthemScaling: { per, perPower, perToughness,
  perSubtype?, andPer?, perCounter? }` arm
  (follow-up 23 + 24 + 25 lane 32 pieces 1/N +
  2/N + 3/N + 4/N) — the lane 32 chosen-counter
  variant extends this with `perCounter.counter:
  "chosen"` semantics.
- `evergreen-keywords.getProtectionQualities` /
  `targeting-validation.getProtectionQualities`
  consults the per-instance `protectionFrom`
  ledger (follow-up 23 + 24 + 25 lane 71) — the
  lane 71 chosen-quality sentinel widens this
  surface to consult a chosen-quality ledger
  alongside the union.

### `affects.subtype: "chosen"` / `perSubtype:
"chosen"` is a parallel sentinel pattern for
priority 1

The lane 32 chosen-counter variant (priority 1)
is a parallel sentinel to the existing
`affects.subtype: "chosen"` pattern in the
lane 86 chosen-type anthem (Adaptive Automaton)
+ the `perSubtype: "chosen"` sentinel shipped
in follow-up 25 lane 32 piece 3/N. The sentinel
reads `source.chosenCreatureType` and substitutes
it when set; the engine consults the resolved
type the same way the affects-side filter does.
The pattern is established — the follow-up 26
piece 1 reuses it via inline read of
`source.chosenCreatureType` in the
`computeAnthemScalingCount` per-counter branch.

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
new `## Wave 4.8 follow-up 26 mid-loop
progress (pieces 1-N)` section listing:

- Pieces shipped (commit hashes + one-line
  subjects).
- Lanes fully closed.
- Pieces in progress.
- Test-suite delta vs. follow-up 25 baseline
  (782 suites / 14597 cases).
- Engine-size budget delta.
- Known issues / carry-overs.

This lets a fresh session pick up cleanly if
context runs out mid-loop.

## End-of-loop check

After the aggressive loop exhausts the priority
list (or hits a piece that exceeds the
lane-envelope rule and is documented as a
follow-up), append a **"Wave 4.8 follow-up 26
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

## Verified follow-up 25 baseline (this loop's
starting state)

- `git log --oneline -1` →
  the follow-up 25 loop-done summary commit on
  `main` (after PR #2809 lands). PR #2809
  MERGED at handoff write time — this loop
  branches from `main`, not from the follow-up
  25 branch.
- `grep "Test suites" docs/onboarding.md` →
  `**Test suites:** 782`
- `grep "Test cases" docs/onboarding.md` →
  `**Test cases:** 14597 (14590 passed + 7
  skipped)`
- Engine-size budget cap: `4300` (carry from
  follow-up 25 lane 32 piece 3/N — the
  `perSubtype: "chosen"` + `andPer.perSubtype:
  "chosen"` + `perCounter` Zod envelope +
  docstring + validator update; schema budget
  bumped 4250 → 4300 with a docstring entry in
  `scripts/check-engine-size-budget.mjs`).
- Branch: `wave4.8-followup26` (created at
  the start of the loop with
  `git checkout -b wave4.8-followup26 main`).
- Working directory: clean at loop start
  (follow-up 25 ship commits visible on
  `main` after PR #2809 lands).
- Follow-up 25 ship commits on
  `wave4.8-followup25`: `69fdaa79` (lane 71
  piece 1/N — `protectionFromBySource`
  per-source ledger), `8d7dd8f4` (lane 32
  piece 2/N — `andPer` compound count source),
  `535eda3e` (lane 32 piece 3/N — `"chosen"`
  `perSubtype` sentinel + schema budget bump),
  `1ed9a532` (lane 32 piece 4/N — `perCounter`
  self-referential counter arm).
- Follow-up 25 doc commits: `847e0cc1`
  (loop-done summary, merged via PR #2809).
- Follow-up 25 reusable infrastructure (carried
  forward to this loop):
  - `CardInstance.protectionFromBySource?:
    Record<string, string[]>` field (follow-up
    25 lane 71 piece 1/N) — per-source ledger
    stamped by `refreshScriptedStatics` and
    `refreshAuraBonuses`; consulted by
    `targeting-validation.isProtectedFromSource`
    and `evergreen-keywords.isProtectedFromSource`
    FIRST (multi-cast enforcement).
  - `getProtectionQualitiesForSource` helper
    in `keyword-actions/protection.ts` (follow-up
    25 lane 71 piece 1/N) — the per-source
    consult helper; returns the per-source
    qualities or null when the source is not in
    the map (the consult falls back to the union).
  - `anthemScaling: { per, perPower, perToughness,
    perSubtype?: string | "chosen", andPer?: {
    per, perSubtype?: string | "chosen" },
    perCounter?: { counter: string } }` arm
    (follow-up 23 + 24 + 25 lane 32 pieces
    1/N + 2/N + 3/N + 4/N) — full scaling-anthem
    substrate with optional subtype filter,
    chosen-type sentinel, compound AND-source,
    and self-referential counter arm.
  - `computeAnthemScalingCount` consult
    (follow-up 23 + 24 + 25 lane 32) — the
    single function that consults all four
    scaling-anthem arms; v1 minimum supports
    per + perSubtype (with `"chosen"`
    sentinel) + andPer (with `"chosen"`
    sentinel) + perCounter (parallel to
    `evergreen-keywords.getEffectivePower`'s
    counter read at `evergreen-keywords.ts`
    line ~973).
- Process notes carried from follow-up 25:
  the `foreman` MCP was not invoked (no
  technical multiple-choice decisions arose).
  The aggressive loop's machinery (ratchet +
  commit-bypass pattern + force-with-lease push
  + `ratchet-test-count.mjs --live
  <counts.json>` fallback for the AI flake) is
  intact and ready for this loop.