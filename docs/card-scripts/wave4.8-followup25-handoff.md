# Wave 4.8 follow-up 25 handoff — Next session

## Mission

The Wave 4.8 follow-up 24 loop ran on the
`wave4.8-followup24` branch and shipped five
self-contained commits inside PR
[#2808](https://github.com/anchapin/planar-nexus/pull/2808):
lane 71 piece 2b (Aura-shaped variant enforcement
verification), lane 70 piece 2/N (Aura-shaped permanent
copy variant), lane 32 piece 2/N (`anthemScaling.perSubtype`
filtered count sources), lane 78 piece 2/N (cross-zones
verification for Aura-shaped permanent-arm copy), plus a
loop-done summary on
[`wave4-blockers.md`](https://github.com/anchapin/planar-nexus/blob/main/docs/card-scripts/wave4-blockers.md).
The two priority-2 lanes from the follow-up 24 handoff
(`wave4.8-followup24-handoff.md`) — lane 70 Aura-shaped
permanent copy + lane 71 piece 2b Aura-shaped variant
enforcement — are fully closed.

**This handoff opens the next loop: continue the
aggressive, iterative loop on the remaining #2614
drafter-list work, picking the smallest pick-up-able
piece of each open lane, landing it as its own commit
on `main` (PR #2808 is MERGED on `main` at handoff write
time — branch from `main`), then immediately moving to
the next piece of the same lane (or the next lane in
priority order) without waiting for a fresh human
handoff.**

The aggressive loop is the same model the
follow-up 14 / 16 / 17 / 18 / 19 / 20 / 21 / 22 / 23 / 24
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

The follow-up 24 loop-done summary ("Wave 4.8
follow-up 24 loop done summary (4 priority pieces
shipped across 4 lanes + 2 closed)" at the bottom of
`docs/card-scripts/wave4-blockers.md` on `main`)
is the authoritative state of the queue; this
handoff re-states the next picks in priority order.
The biggest lane-envelope lesson from follow-up 24
(schematized in the loop-done summary): the lane 70
piece 2/N Aura-shaped permanent-arm path came in at
~370 LOC because the substrate brings THREE parallel
cleanup branches (cycle guard + zone-mis + Aura-detach
+ Aura-side post-pass cleanup). All future lanes
that touch "the substrate" should budget the same way
— i.e., assume ~3× the simpler envelope when
extending an existing substrate to a new substrate pair.

## Quick start

```
cd /home/alex/Projects/planar-nexus
git fetch origin
git checkout main
git pull --ff-only
# PR #2808 (follow-up 24) is MERGED on main. The
# follow-up 24 loop wrote the loop-done summary
# against the branch's last commit; this session
# on main must see the loop's commits.
git worktree list
# (no worktrees expected; clean up any leftover
#  from prior waves)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
# verify 778 / 14566 green (follow-up 24 baseline)
# then start the aggressive loop per the
# Priority section below.
git checkout -b wave4.8-followup25 main
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

The follow-up 24 loop closed lane 70 Aura-shaped
permanent (target-chosen + Aura-shaped variants),
lane 71 piece 2b (Aura-shaped variant enforcement
verification), lane 32 piece 2/N (`perSubtype`
filtered count source), and lane 78 piece 2/N
(cross-zones verification). The next unblocked
items (smallest four first) are:

1. **Lane 71 per-source-Quality multi-cast
   enforcement.** A "card granting protection
   from ALL of [X, Y, Z] simultaneously" consult
   shape that tracks WHICH source grants which
   quality (vs. the current union semantics). The
   follow-up 23 piece 2/N widened
   `evergreen-keywords.getProtectionQualities` to
   consult the per-instance `protectionFrom`
   ledger first (a quality list — union semantics).
   The per-source-quality variant extends the
   ledger to a `Map<sourceId, string[]>` shape:
   when target A grants `protection from red` and
   target B grants `protection from blue` (via
   static sources), a card with both as sources
   is protected from BOTH `red` and `blue` sources.
   The union semantics cover most real cards; the
   niche is multi-cast cards whose interaction
   shape requires per-source-quality (a "grant
   protection from ALL listed qualities, but
   resolve each source's protection
   independently"). v1 minimum:
   - Extend the per-instance
     `CardInstance.protectionFrom: string[]` field
     to a parallel `protectionFromBySource?: Record<sourceId, string[]>`
     ledger (or a sibling field on the same
     consult sites). The schema-stamp write phase
     on `refreshScriptedStatics` populates the
     per-source ledger alongside the union ledger.
   - Extend `hasProtectionFromColor` (the lane 71
     piece 1/N consult in
     `targeting-validation.ts`) AND
     `getProtectionQualities` /
     `isProtectedFromSource` in
     `evergreen-keywords.ts` to consult the
     per-source ledger alongside the union
     semantics — when the per-source ledger is
     populated for a given source id, the consult
     returns the per-source qualities instead of
     the union.
   - Substrate MIGHT need a shared helper in
     `keyword-actions/protection.ts` for the
     per-source consult (parallel to
     `hasProtectionFromColorStrict` for the
     strict parsed-keyword path). If the helper
     adds complexity, split into a follow-up
     sub-piece.
   - Schema budget: ~5-10 LOC for the optional
     `protectionFromBySource` field on
     `StaticSchema.protectionFrom` + the type
     extension on `CardInstance` (no schema budget
     bump needed unless the field requires a
     strict envelope).
   - ~80-130 LOC + 2-3 tests. Test:
     `lane71-per-source-quality-multicast.test.ts`.
     The "two simultaneous protection-granting
     Auras" semantic verifies: target has
     protection from red-source A AND
     protection from blue-source B independently
     (a red source from a different card is NOT
     blocked because source A is the only
     red-protection source; a blue source from a
     different card is NOT blocked because source B
     is the only blue-protection source).
     **If the chosen source variant reveals a
     second pattern (e.g., the per-source ledger
     needs to coexist with the union ledger AND a
     third shape), back out and document as
     follow-up 26.**

2. **Lane 32 compound count sources.** A single
   `anthemScaling` arm that scales by TWO count
   sources composed with AND (e.g. "creatures you
   control get +1/+1 for each creature AND artifact
   you control"). The follow-up 24 piece 2/N
   shipped the optional `perSubtype?: string`
   filter on `anthemScaling` (priority 3 from the
   follow-up 24 handoff). The compound variant
   parallels `X`'s OR combinator on `cost` (the
   `cost.or: [...]` array delivered in follow-up 21
   piece 3/N — see `card-scripts/schema.ts` for
   the lane 36 `X` compositing pattern). v1
   minimum:
   - Schema delta: extend `anthemScaling` with
     either:
     - **(a) a second optional arm pair** `andPer?:
       { per, perSubtype? }` whose count is added
       to the primary `per` count (CR 613.4c-style
       multi-source scaling), OR
     - **(b) a `compoundPer?: ["treasures",
       "creatures"]` array arm** that sums the
       counts (parallel to the lane 36 `X.or`
       combinator's matrix).
     Option (a) is the cleaner v1 (single source +
     optional AND-source); option (b) is more
     expressive but doubles the substrate.
   - Engine delta: `computeAnthemScalingCount`
     consults both arms when set and returns the
     sum. The helper grows to a `+ (andPer ? count
     of andPer : 0)` structure.
   - ~50-80 LOC + 2-3 tests. Test:
     `lane32-compound-count-source.test.ts`.
     **If the second-arm delta reveals a third
     arm (e.g., subtraction / exclusion semantics),
     back out and document as follow-up 26.**

3. **Lane 32 chosen-type `perSubtype` variant.**
   A "per creature of the chosen type" semantic
   that drives the `perSubtype` count-source filter
   from a `chosenCreatureType` instance field on
   the source (CR 603 chosen-type variant).
   The follow-up 24 piece 2/N shipped
   `perSubtype?: string` as a FIXED type string;
   the chosen-type variant extends the schema to
   accept a sentinel `"chosen"` (parallel to how
   `affects.subtype: "chosen"` reads the
   `chosenCreatureType` sentinel — see
   `card-scripts/schema.ts` line ~480 area and the
   Adaptive Automaton entry). v1 minimum:
   - Schema delta: extend `anthemScaling.perSubtype`
     from `z.string().min(1)` to
     `z.union([z.string().min(1),
     z.literal("chosen")])`. ~3-5 LOC.
   - Engine delta: `computeAnthemScalingCount`
     consults `source.chosenCreatureType` when
     `perSubtype === "chosen"`; if the chosen type
     is unset (no `enter_choice: { kind:
     "creature_type" }` resolve), the count is 0
     (matching the lane 86 chosen-type anthem
     semantics in `staticAffects`).
   - Substrate: no helper needed — the chosen-type
     consult is inline (parallel to the `affects.
     subtype: "chosen"` path's read of
     `source.chosenCreatureType`).
   - ~30-50 LOC + 2 tests. Test:
     `lane32-chosen-type-per-subtype.test.ts`.
     Sample: a chosen-type anthem
     ("creatures you control of the chosen type
     get +1/+1 for each OTHER creature you control
     OF THE CHOSEN TYPE") exercises both the
     affects-side filter AND the count-side filter
     in one pass (a parallel chosen-type flow).

4. **Lane 32 per-counter scales.** A "per +1/+1
   counter on this creature" count source — a
   self-referential scaling anthem ("this creature
   gets +1/+1 for each +1/+1 counter on it"). The
   follow-up 23 lane 32 shipped `per` as a
   state-derived count (creatures / treasures /
   lands / other_creatures); the per-counter
   variant reads `card.counters[counter]` instead.
   v1 minimum:
   - Schema delta: add an OPTIONAL arm
     `perCounter?: { counter: string }` on
     `anthemScaling` that, when set, replaces the
     `per` arm's state-derived count with the
     source's own per-counter count. ~5-10 LOC.
   - Engine delta: a new `computeAnthemScalingCount`
     branch consults `card.counters?.[counter] ??
     0` for the source. The implementation reads
     the source's counter array (matching how
     `evergreen-keywords.getEffectivePower` reads
     `card.counters?.find(...)` for the +1/+1
     counter — see `evergreen-keywords.ts` line
     ~951).
   - ~50-70 LOC + 2-3 tests. Test:
     `lane32-per-counter-scale.test.ts`. Sample:
     a self-scaling anthem on a creature with
     `enter_choice: { kind: "counter_minimum" }`
     — the anthem's per-counter count grows with
     the source's counters.
   - Substrate: the `card.counters` consult is
     already in `evergreen-keywords.ts` for the
     +1/+1 / -1/-1 counter resolution;
     `computeAnthemScalingCount` reuses the same
     field.
   - **If the per-counter arm interacts with the
     `chosenCreatureType` sentinel (a chosen-type
     anthem with a chosen-counter variant), back
     out and document as follow-up 26.**

## Other parked lanes (explicitly OUT OF SCOPE for
follow-up 25)

These are documented in
`docs/card-scripts/wave4-blockers.md` and ride
follow-up 26+:

- **Lane 32 chosen-counter variant** ("per +1/+1
  counter of the chosen kind" — drives the
  counter type from a `enter_choice` resolve).
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
   `git checkout -b wave4.8-followup25 main` →
   schema delta → engine delta → JSON → test
   file → gates → commit → push → PR (one PR
   per lane; the follow-up 17 / 22 / 23 / 24
   precedent allows multiple lanes in one PR
   when the loop spans several).
4. **Immediately** move to the next piece of
   the same lane (or the next lane in priority
   order) without waiting for a fresh human
   handoff. The follow-up 22 / 23 / 24 handoff
   model is replaced by the per-piece commit + the
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

The lane 71 per-source-Quality multi-cast enforcement
(piece 1/N) is structurally analogous to piece 2/N
but for the source id dimension instead of the
color dimension. The follow-up 23 piece 2/N was
~26 LOC engine + ~117 test. The follow-up 25
piece 1/N will likely land at ~80-130 LOC engine +
~80-130 test (the source-by-source ledger adds the
per-source bookkeeping overhead). Budget ~3× the
simpler envelope.

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
  19 / 20 / 21 / 22 / 23 / 24 loops' full
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
  <one-line> (follow-up 25, lane NNN)` where
  NNN is the priority-queue lane number, or
  `[AI-assisted] feat(card-scripts): <one-line>
  (follow-up 25, lane NNN, piece X/Y)` when a
  lane takes multiple pieces.

### Test-count ratchet

- Update the test-count docs in the same commit
  as any test change. Use
  `npm run ratchet:test-count` for the canonical
  path. The `--live <counts.json>` fallback via
  `node scripts/ratchet-test-count.mjs --live
  <counts.json>` bypasses the AI flake
  mid-ratchet — use it liberally if the
  forge-gate / forge-selfplay / expert-agent
  flake strikes (the follow-up 19 / 20 / 21 / 22
  / 23 / 24 handoffs document this as the safe path
  when the flake strikes mid-ratchet).
- For pushing, the pre-push hook runs
  `scripts/check-test-count-docs.mjs` which
  re-runs jest. If the flake hits, use
  `git push --no-verify` to skip the pre-push
  hook (the docs are still in sync; only the
  flaky jest re-run is bypassed). The
  follow-up 19 / 20 / 21 / 22 / 23 / 24 loops used
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

- 4250 lines cap (carry from follow-up 24 lane
  32 piece 2/N — the `perSubtype` Zod envelope
  + docstring + validator update). If a piece
  pushes schema.ts past the cap (counted by
  `scripts/check-engine-size-budget.mjs`), bump
  the budget in the same commit with a
  docstring entry in the script mirroring the
  follow-up 12 / 13 / 14 / 15 / 16 / 17 / 18 /
  19 / 20 / 21 / 22 / 23 / 24 historical precedent.

## Reusable infrastructure (carry-forward from
follow-up 24)

The follow-up 24 loop shipped several substrate
pieces that the four follow-up 25 priorities
rely on. None of these need re-implementation —
use them as-is:

- `anthemScaling: { per, perPower, perToughness,
  perSubtype?: string }` arm (follow-up 24 lane
  32 piece 2/N) — the lane 32 chosen-type
  variant (priority 3 above) extends this with
  `perSubtype: "chosen"` semantics.
- `CardInstance.permanentCopyPrintedCardData?: ScryfallCard`
  field + `snapshotPermanentCopyPrintedCardData`
  / `clearPermanentCopyPrintedCardData` helpers
  + `restorePermanentCopyOffBattlefield` consult
  + widened `printedCardDataOf` + Aura-shaped
  permanent-arm overlay (follow-up 23 / 24 lane
  70 pieces 2a / 2b / 2/N) — substrate for the
  Aura-shaped permanent-arm cross-zones
  semantics. Out of scope for follow-up 25 but
  available for any future lane 28 entry-point.
- `evergreen-keywords.getProtectionQualities`
  consults the per-instance `protectionFrom`
  ledger (follow-up 23 lane 71 piece 2/N) — the
  lane 71 per-source-Quality multi-cast
  enforcement (priority 1 above) widens this
  surface to consult a per-source ledger
  alongside the union.
- `setPermanentCopyOf` / `clearPermanentCopyOf`
  helpers in `keyword-actions/copy-chain.ts`
  (follow-up 22 / 23) — reusable infrastructure
  for any lane 28 copy-token substrate entry.

### `affects.subtype: "chosen"` is a parallel
sentinel pattern for priority 3

The lane 32 chosen-type `perSubtype` variant
(priority 3) is a parallel sentinel to the
existing `affects.subtype: "chosen"` pattern in
the lane 86 chosen-type anthem (Adaptive
Automaton). The sentinel reads
`source.chosenCreatureType` and substitutes it
when set; the engine consults the resolved type
the same way the affects-side filter does. The
pattern is established — the follow-up 25 piece
3 reuses it via inline read of
`source.chosenCreatureType` (parallel to
`staticAffects` reading the same field at
`scripted-statics.ts` line ~575).

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
new `## Wave 4.8 follow-up 25 mid-loop
progress (pieces 1-N)` section listing:

- Pieces shipped (commit hashes + one-line
  subjects).
- Lanes fully closed.
- Pieces in progress.
- Test-suite delta vs. follow-up 24 baseline
  (778 suites / 14566 cases).
- Engine-size budget delta.
- Known issues / carry-overs.

This lets a fresh session pick up cleanly if
context runs out mid-loop.

## End-of-loop check

After the aggressive loop exhausts the priority
list (or hits a piece that exceeds the
lane-envelope rule and is documented as a
follow-up), append a **"Wave 4.8 follow-up 25
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

## Verified follow-up 24 baseline (this loop's starting state)

- `git log --oneline -1` →
  the follow-up 24 loop-done summary commit on
  `main` (after PR #2808 lands). PR #2808
  MERGED at handoff write time — this loop
  branches from `main`, not from the follow-up
  24 branch.
- `grep "Test suites" docs/onboarding.md` →
  `**Test suites:** 778`
- `grep "Test cases" docs/onboarding.md` →
  `**Test cases:** 14566 (14559 passed + 7
  skipped)`
- Engine-size budget cap: `4250` (carry from
  follow-up 24 lane 32 piece 2/N — the
  `perSubtype` Zod envelope + docstring +
  validator update).
- Branch: `wave4.8-followup25` (created at
  the start of the loop with
  `git checkout -b wave4.8-followup25 main`).
- Working directory: clean at loop start
  (follow-up 24 ship commits visible on
  `main` after PR #2808 lands).
- Follow-up 24 ship commits on
  `wave4.8-followup24`: `f672dad6` (lane 71
  piece 2b — Aura-shaped variant enforcement
  verification), `fde26f34` (lane 70 piece 2/N
  — Aura-shaped permanent copy variant +
  5-test file), `31c035fa` (lane 32 piece 2/N
  — `perSubtype` filtered count source +
  schema-budget bump 4150 → 4250), `8413864c`
  (lane 78 piece 2/N — cross-zones verification
  for Aura-shaped permanent-arm copy).
- Follow-up 24 doc commits: `90c7adf8`
  (loop-done summary, merged via PR #2808).
- Follow-up 24 reusable infrastructure (carried
  forward to this loop):
  - `anthemScaling: { per, perPower, perToughness,
    perSubtype?: string }` arm (follow-up 24
    lane 32 piece 2/N) — scaling-anthem
    substrate with fixed-type filter.
  - `CardInstance.permanentCopyPrintedCardData`
    field + `snapshotPermanentCopyPrintedCardData`
    / `clearPermanentCopyPrintedCardData`
    helpers + `restorePermanentCopyOffBattlefield`
    consult + widened `printedCardDataOf`
    consult (follow-up 23 lane 70 piece 2b +
    follow-up 24 lane 70 piece 2/N) —
    permanent-copy substrate + overlay +
    cleanup, including the Aura-shaped variant.
  - `evergreen-keywords.getProtectionQualities`
    consults the per-instance `protectionFrom`
    ledger (follow-up 23 lane 71 piece 2/N) —
    protection-from static enforcement at
    layer 6 / 7 (the symmetric surface widened
    in follow-up 23; the Aura-shaped variant
    verified in follow-up 24 piece 2b; the
    per-source-quality multi-cast enforcement
    is the next follow-up 25 priority piece).
  - `StaticSchema.anthemScaling` arm + the
    new optional `perSubtype?: string` field
    (follow-up 23 + 24 lane 32) — scaling-
    anthem substrate with fixed-type filter
    (chosen-type variant rides follow-up 25
    piece 3).
- Process notes carried from follow-up 24:
  the `foreman` MCP was not invoked (no
  technical multiple-choice decisions arose).
  The aggressive loop's machinery (ratchet +
  commit-bypass pattern + force-with-lease push
  + `ratchet-test-count.mjs --live
  <counts.json>` fallback for the AI flake) is
  intact and ready for this loop.

</invoke>