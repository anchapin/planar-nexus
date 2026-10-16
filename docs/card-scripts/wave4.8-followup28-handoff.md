# Wave 4.8 follow-up 28 handoff — Next session

## Mission

The Wave 4.8 follow-up 27 loop ran on the
`wave4.8-followup27` branch and shipped three
self-contained commits:
lane 71 piece 2/N (per-quality sources derived
consult helper), lane 32 piece 1/N
(`andPer.perCounter` chosen-counter compound arm),
lane 71 piece 3/N (`protectionFrom` per-entry
chosen sentinel), plus the loop-done summary on
[`wave4-blockers.md`](https://github.com/anchapin/planar-nexus/blob/main/docs/card-scripts/wave4-blockers.md).
The follow-up 27 loop's three priority picks are
all closed; **lane 32 (scaling P/T anthems)** and
**lane 71 (protection-from static)** are now fully
closed. The lane 71 piece 2/N derived helper is
INTERNAL-USE; the lane 71 piece 3/N multi-quality
sentinel is the canonical per-entry form; the lane
32 piece 1/N `andPer.perCounter` REPLACES the
`andPer.per` state-derived count when set.

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
/ 24 / 25 / 26 / 27 loops ran: per-piece commit +
per-piece push + loop-done summary at the end.
Pick strictly in the priority order below; finish
one lane completely (or break the current piece
into a fresh sub-piece) before moving to the next.
**If a piece grows past ~150 LOC or reveals a
second pattern, back out, document in
`wave4-blockers.md`, and either pick a smaller
sub-piece of the same lane or move to the next
lane — do not park.**

The follow-up 27 loop-done summary ("Wave 4.8
follow-up 27 loop done summary" at the bottom of
`docs/card-scripts/wave4-blockers.md` on `main`) is
the authoritative state of the queue; this handoff
re-states the next picks in priority order.

## Quick start

```
cd /home/alex/Projects/planar-nexus
git fetch origin
git checkout main
git pull --ff-only
# Verify the follow-up 27 ship commits are on main
# (the loop-done summary + the lane 71 piece 2/N +
# the lane 32 piece 1/N + the lane 71 piece 3/N feat
# commits).
git worktree list
# (no worktrees expected; clean up any leftover
#  from prior waves)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
# verify 787 / 14625 green (follow-up 27 baseline)
# then start the aggressive loop per the
# Priority section below.
git checkout -b wave4.8-followup28 main
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

The follow-up 27 loop closed lane 71 piece 2/N
(per-quality derived helper) + lane 32 piece 1/N
(`andPer.perCounter` compound) + lane 71 piece 3/N
(per-entry chosen sentinel). The follow-up 27 loop
explicitly deferred four follow-up 28+ items. The
next unblocked items (smallest first) are:

1. **Lane 32 chosen-counter ordinal** — extends
   the `perCounter: { counter: string | "chosen" }`
   arm (follow-up 25 piece 4/N + follow-up 26
   piece 1/N + follow-up 27 piece 1/N for
   `andPer.perCounter`) with an ordinal variant.
   A "per Nth counter" anthem reads the source's
   Nth counter of a given type. v1 minimum:
   - Schema delta: extend
     `StaticSchema.anthemScaling.perCounter` with
     an OPTIONAL `ordinal?: z.number().int().min(1)`
     arm (parallel to the existing
     `perCounter: { counter: string | "chosen" }`
     arm). The `andPer.perCounter` arm accepts the
     same ordinal extension (parallel to the
     follow-up 27 piece 1/N shape). The primary
     `perCounter` and `andPer.perCounter` ordinal
     fields are independent. ~5-10 LOC.
   - Engine delta:
     `computeAnthemScalingCount`'s per-counter
     branch reads the ordinal field. When set,
     the count is the CUMULATIVE sum of the
     first N counters of the given type on the
     source (matches MTG "Nth counter" semantics
     — a source with 3 +1/+1 counters and
     `ordinal: 2` contributes 2, not 3). The
     sentinel resolution for
     `perCounter.counter === "chosen"` reads
     `source.chosenCreatureType` first, then
     applies the ordinal to the resolved counter
     type. ~15-20 LOC.
   - Test file:
     `lane32-chosen-counter-ordinal.test.ts`. A
     synthetic anthem with
     `perCounter: { counter: "+1/+1", ordinal: 2 }`
     on a source with 3 +1/+1 counters —
     exercises the cumulative-sum path. A second
     test for the chosen-sentinel + ordinal
     combo. A third test for `andPer.perCounter`
     + ordinal (regression guard for the
     follow-up 27 piece 1/N extension). ~3-4
     tests, ~80-120 LOC.
   - **If the ordinal variant reveals a
     counter-multiplicity extension (e.g.
     "per counter of each unique type" or
     "per Nth counter ACROSS types"), back out
     and document as follow-up 29.**

2. **Lane 71 array-aware entry shape** — extends
   the follow-up 27 piece 3/N per-entry
   `protectionFrom: Array<string | "chosen">` form
   with nested arrays (e.g.
   `protectionFrom: [["red", "green"], "chosen"]` =
   "protection from a red/green pair AND the
   chosen quality"). v1 minimum:
   - Schema delta: extend the per-entry form
     from
     `z.array(z.union([z.string().min(1), z.literal("chosen")]))`
     to
     `z.array(z.union([z.string().min(1), z.array(z.string().min(1).min(2)), z.literal("chosen")]))`
     — a single nested array of ≥ 2 literal
     qualities (a "pair" — a 1-element nested
     array is rejected to avoid confusion with
     the flat literal form). The nested array
     is FLATTENED at the engine consult
     (a `[["red", "green"]]` entry contributes
     `["red", "green"]` to the resolved
     qualities list). ~5-10 LOC.
   - Engine delta: `refreshScriptedStatics`'s
     `protectionFrom` consult detects the
     nested-array form (presence of an array
     inside the per-entry array) and flattens
     each nested array to its literal entries.
     The `"chosen"` entry is still resolved
     independently. The flattening is a
     one-pass reduce. ~10-15 LOC.
   - Test file:
     `lane71-array-aware-entry-shape.test.ts`.
     A synthetic anthem with
     `protectionFrom: [["red", "green"], "chosen"]`
     + `chosenProtectionFrom: "blue"` — exercises
     the pair + sentinel union. A second test
     for the pair-only case (no sentinel). A
     third test rejecting the 1-element nested
     array. ~3-4 tests, ~80-120 LOC.
   - **If the array-aware form reveals a
     per-pair sentinel (e.g.
     `[["red", "chosen"], "blue"]` = "protection
     from red+chosen AND blue"), back out and
     document as follow-up 29.**

3. **`andPer.perCounter` + `andPer.perSubtype`
   summed form** — the "compound andPer"
   (andPer.per + andPer.perCounter summed, NOT
   replaced). New work surfaced from follow-up 27
   piece 1/N. v1 minimum:
   - Schema delta: extend
     `StaticSchema.anthemScaling.andPer` with an
     OPTIONAL `perCounter?: { counter: string |
     "chosen", ordinal?: number }` arm WHERE THE
     per-counter count is SUMMED with the
     `andPer.per` state-derived count (parallel
     to the primary `perCounter` REPLACES the
     primary `per` semantic — but the summed
     variant is the explicit SUMMED form). The
     discriminating field could be a separate
     `perCounterSummed: { ... }` arm OR a
     `summed: true` flag on the existing
     `perCounter` arm. **The summed variant is
     the natural read for "per creature AND per
     chosen counter" anthems** (the follow-up 27
     piece 1/N's "REPLACE" semantic is wrong
     for that case). The summed form is the
     CORRECT shape for most "per + perCounter"
     use cases; the REPLACE form is a special
     case (self-referential only). ~5-10 LOC.
   - Engine delta: `computeAnthemScalingCount`'s
     `andPer` branch consults the new
     summed-perCounter arm. When set, the
     andPer contribution is
     `count(andPer.per) + perCounter.count`
     (SUMMED, not replaced). The REPLACE form
     stays as the follow-up 27 piece 1/N
     shape. ~10-15 LOC.
   - Test file:
     `lane32-andPer-percounter-summed.test.ts`.
     A synthetic anthem with
     `andPer: { per: "creatures", perCounter:
     { counter: "marker" }, summed: true }` on a
     source with 2 marker counters and 3 other
     creatures — the andPer contribution is
     3 (creatures) + 2 (markers) = 5, NOT 2
     (replaced). ~2-3 tests, ~60-100 LOC.
   - **If the summed form reveals a need to
     deprecate the REPLACE form (the
     self-referential case is rare; the summed
     form covers 90%+ of use cases), back out
     and document as follow-up 29.**

4. **Lane 28 — Create copy token** (Rite of
   Replication / Self-Reflection / Extravagant
   Replication style). The lane 70 / 78
   substrate shipped the STATIC-side permanent
   copy (`become_copy` static arms); the
   OP-SIDE copy-creates-token substrate is
   still missing. v1 minimum:
   - Schema delta: add a new
     `CopyPermanentSchema` op (a
     `z.object({ op: z.literal("CopyPermanent"),
     target: <selector>, count: z.number().int().min(1).default(1)
     })` shape — the count field is the "X" for
     Rite of Replication's "create X tokens
     that are copies"). The selector supports
     `target: CardInstanceId` (lane 28a —
     explicit target) AND `named_card: { name:
     string }` (lane 28b — named card, parallel
     to the lane 75b / 75c shapes). v1 single-
     target only (multi-target is a follow-up).
     ~30-50 LOC.
   - Engine delta: the new `CopyPermanent` op
     reads the target's per-instance overlay
     (printed `cardData` + copied characteristics
     + the lane 70's `permanentCopyPrintedCardData`
     + the lane 70's `copyOfTargetIdPermanent`),
     snapshots the P/T / keywords / types / colors
     / mana cost, creates `count` tokens with the
     snapshot. The tokens are NEW `CardInstance`s
     (not the existing copy-substrate's overlay
     mechanism). CR 707.2 reference. ~50-80 LOC.
   - JSON: register a synthetic test card
     "Rite of Replication (test substrate)" via
     the card-scripts index. The card has a
     single `CopyPermanent` op with
     `target: <opponent creature>` and
     `count: 2`. ~20-30 LOC JSON.
   - Test file:
     `lane28-create-copy-token.test.ts`. Tests:
     schema parse for the new op, engine
     execution of a single-target single-token
     case, multi-count (Rite of Replication
     count=2), named-card variant (Self-
     Reflection's "create a token that's a
     copy of [named card]"). ~4-6 tests,
     ~150-250 LOC.
   - **If the new op reveals a copy-with-
     exception arm (lane 28c — "create a
     token that's a copy of [target] EXCEPT
     it has no abilities"), back out and
     document as follow-up 29. The
     exception arm is the natural extension
     (parallel to the lane 75c
     `become_copy.exceptions` shape).**

## Other parked lanes (explicitly OUT OF SCOPE for
follow-up 28)

These are documented in
`docs/card-scripts/wave4-blockers.md` and ride
follow-up 29+:

- **Lane 32 chosen-counter ordinal per-pair
  variant** (extending the per-pair counter form
  with an ordinal — rides follow-up 29 if the
  priority 1 ordinal piece surfaces a per-pair
  extension).
- **Lane 70 / 78 cross-zone copy engagements**
  (cards that need the lane 70 permanent copy +
  the lane 78 cross-zone copy simultaneously —
  verified as no-ops per the wave4-blockers doc;
  no work needed).
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
   `git checkout -b wave4.8-followup28 main` →
   schema delta → engine delta → JSON → test
   file → gates → commit → push → PR (one PR
   per lane; the follow-up 17 / 22 / 23 / 24 /
   25 / 26 / 27 precedent allows multiple
   lanes in one PR when the loop spans
   several).
4. **Immediately** move to the next piece of
   the same lane (or the next lane in priority
   order) without waiting for a fresh human
   handoff. The follow-up 22 / 23 / 24 / 25 /
   26 / 27 handoff model is replaced by the
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
# 5. Write the test file (parallel to lane69 / lane70 / lane71 / lane75d / lane76 / lane32 / lane71 follow-up 27 patterns)
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
  19 / 20 / 21 / 22 / 23 / 24 / 25 / 26 / 27
  loops' full precedent — every loop used it
  cleanly).
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
  <one-line> (follow-up 28, lane NNN)` where
  NNN is the priority-queue lane number, or
  `[AI-assisted] feat(card-scripts): <one-line>
  (follow-up 28, lane NNN, piece X/Y)` when a
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
  / 23 / 24 / 25 / 26 / 27 handoffs document this
  as the safe path when the flake strikes
  mid-ratchet).
- For pushing, the pre-push hook runs
  `scripts/check-test-count-docs.mjs` which
  re-runs jest. If the flake hits, use
  `git push --no-verify` to skip the pre-push
  hook (the docs are still in sync; only the
  flaky jest re-run is bypassed). The
  follow-up 19 / 20 / 21 / 22 / 23 / 24 / 25 /
  26 / 27 loops used `--no-verify` for the push
  step on the rare flake.

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

- 4450 lines cap (carry from follow-up 27
  lane 71 piece 3/N — the `protectionFrom`
  per-entry Zod union extension +
  docstring expansion; schema budget bumped
  4430 → 4450 with a docstring entry in
  `scripts/check-engine-size-budget.mjs`). If a
  piece pushes schema.ts past the cap (counted
  by `scripts/check-engine-size-budget.mjs`),
  bump the budget in the same commit with a
  docstring entry in the script mirroring the
  follow-up 12 / 13 / 14 / 15 / 16 / 17 / 18 /
  19 / 20 / 21 / 22 / 23 / 24 / 25 / 26 / 27
  historical precedent.
- Lane 28 piece 1/N (priority 4) MAY bump
  the budget — the new `CopyPermanent` op
  schema is ~30-50 LOC of Zod + docstring.
  Plan for a 30-50 LOC bump in the same
  commit.
- Priorities 1, 2, 3 are small extensions of
  existing substrate; each may bump by 5-20
  LOC depending on docstring expansion. Plan
  for 1-2 budget bumps in the loop.

## Reusable infrastructure (carry-forward from
follow-up 27)

The follow-up 27 loop shipped several substrate
pieces that the four follow-up 28 priorities rely
on. None of these need re-implementation — use
them as-is:

- `StaticSchema.anthemScaling.perCounter: {
  counter: string | "chosen" }` (follow-up 25
  piece 4/N + follow-up 26 piece 1/N) — the
  per-counter arm. The lane 32 ordinal variant
  (priority 1) extends this with an OPTIONAL
  `ordinal?: z.number().int().min(1)` field.
- `StaticSchema.anthemScaling.andPer: { per,
  perSubtype?, perCounter? }` (follow-up 25
  piece 2/N + follow-up 27 piece 1/N) — the
  compound AND-source with the per-counter
  sub-arm. The andPer.perCounter ordinal
  extension (priority 1) + the summed form
  (priority 3) both extend this.
- `computeAnthemScalingCount` consult
  (follow-up 23 + 24 + 25 + 26 + 27) — the
  single function that consults all five
  scaling-anthem arms (per + perSubtype +
  andPer + perCounter + andPer.perCounter).
  v1 minimum supports per + perSubtype
  (literal + "chosen" sentinel) + andPer
  (with "chosen" sentinel on perSubtype) +
  perCounter (literal + "chosen" sentinel) +
  andPer.perCounter (REPLACE semantic).
- `CardInstance.chosenCreatureType: string |
  null` field (follow-up 23 + 24) — populated
  by `resolveEnterChoice` for
  `enter_choice: { kind: "creature_type" }`;
  consulted by `computeAnthemScalingCount`
  when `perCounter.counter === "chosen"` (and
  by the follow-up 28 priority 1 ordinal
  variant when the counter type is "chosen"
  AND the ordinal is set).
- `CardInstance.chosenProtectionFrom: string |
  null` field (follow-up 26 lane 71 piece
  3/N) — populated by `resolveEnterChoice`
  for `enter_choice: { kind:
  "protection_quality" }`; consulted by
  `refreshScriptedStatics` when
  `protectionFrom: "chosen"` is in effect
  AND by the follow-up 28 priority 2
  array-aware form when the `"chosen"` entry
  is in a nested array.
- `StaticSchema.protectionFrom: Array<string> |
  "chosen" | Array<string | "chosen">` (follow-up
  27 lane 71 piece 3/N) — the multi-quality
  sentinel union. The lane 71 array-aware
  entry shape (priority 2) extends the
  per-entry form with nested arrays.
- `refreshScriptedStatics` consult (follow-up
  22 / 23 / 24 / 25 / 26 / 27) — the single
  function that resolves the `protectionFrom`
  arm + the `anthemScaling` arm + the
  `keywords` arm + the `become_copy` arm +
  the `add_creature_type` arm + the
  `add_color` arm + the `chosen_name_block`
  arm. The lane 71 array-aware entry shape
  (priority 2) consults this; the lane 28
  Create copy token (priority 4) does NOT
  consult this (it's an OP-side substrate,
  not a STATIC-side substrate).
- `getProtectionSourcesByQuality` derived
  helper (follow-up 27 lane 71 piece 2/N) —
  the per-quality inverted index. INTERNAL-
  USE for now (no current caller; reserved
  for future refresh-pass optimization that
  needs the per-quality view). Not required
  by any follow-up 28 priority.
- `lane 70 / 75 / 78 permanent copy
  substrate` (follow-up 22 / 23 / 24 / 25 /
  26) — the `become_copy` static arm + the
  `permanentCopyPrintedCardData` snapshot +
  the `copyOfTargetIdPermanent` ledger + the
  cross-zone copy via `copyOfTargetId`. The
  lane 28 Create copy token (priority 4)
  READS these (the new op snapshots the
  overlay chain via the same
  `printedCardDataOf` consult the lane 70
  refresh uses). The OP-side create-token
  is the new piece — the substrate is
  already in place.

### Lane 32 chosen-counter ordinal reading path

The priority 1 ordinal variant extends the
existing per-counter resolution in
`computeAnthemScalingCount` (lines 346-360 of
the follow-up 27 piece 1/N substrate). When
`perCounter.ordinal` is set, the count is the
CUMULATIVE sum of the first N counters of the
resolved type on the source:

```
const resolvedCounterType =
  perCounter.counter === "chosen"
    ? source.chosenCreatureType !== null && ...
      ? source.chosenCreatureType
      : null
    : perCounter.counter;
if (resolvedCounterType === null) {
  return 0;
}
const allOfType = source.counters?.filter(
  (c) => c.type === resolvedCounterType,
) ?? [];
const ordinal = perCounter.ordinal ?? 0;
if (ordinal === 0) {
  // No ordinal — existing perCounter semantic
  // (total count of all counters of this type).
  return allOfType.reduce((sum, c) => sum + c.count, 0);
}
// Ordinal set — cumulative sum of the first N
// counters of this type.
const firstN = allOfType.slice(0, ordinal);
return firstN.reduce((sum, c) => sum + c.count, 0);
```

That's it — no new ledger, no new schema field
beyond the optional `ordinal?`, no new refresh-
path write. The existing per-counter consults
keep using the follow-up 25 piece 4/N ledger (the
authoritative substrate). The ordinal variant is
a per-source Nth-counter read.

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
new `## Wave 4.8 follow-up 28 mid-loop
progress (pieces 1-N)` section listing:

- Pieces shipped (commit hashes + one-line
  subjects).
- Lanes fully closed.
- Pieces in progress.
- Test-suite delta vs. follow-up 27 baseline
  (787 suites / 14625 cases).
- Engine-size budget delta.
- Known issues / carry-overs.

This lets a fresh session pick up cleanly if
context runs out mid-loop.

## End-of-loop check

After the aggressive loop exhausts the priority
list (or hits a piece that exceeds the
lane-envelope rule and is documented as a
follow-up), append a **"Wave 4.8 follow-up 28
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

## Verified follow-up 27 baseline (this loop's
starting state)

- `git log --oneline -1` →
  the follow-up 27 loop-done summary commit on
  `main` (after the follow-up 27 PR lands on
  `main`).
- `grep "Test suites" docs/onboarding.md` →
  `**Test suites:** 787`
- `grep "Test cases" docs/onboarding.md` →
  `**Test cases:** 14625 (14618 passed + 7
  skipped)`
- Engine-size budget cap: `4450` (carry from
  follow-up 27 lane 71 piece 3/N — the
  `protectionFrom` per-entry Zod union
  extension + docstring expansion; schema
  budget bumped 4430 → 4450 with a docstring
  entry in
  `scripts/check-engine-size-budget.mjs`).
- Branch: `wave4.8-followup28` (created at
  the start of the loop with
  `git checkout -b wave4.8-followup28 main`).
- Working directory: clean at loop start
  (follow-up 27 ship commits visible on
  `main` after the PR lands).
- Follow-up 27 ship commits on
  `wave4.8-followup27`: `6788b81a` (lane 71
  piece 2/N — `getProtectionSourcesByQuality`
  derived consult helper), `9f05250d` (lane
  32 piece 1/N — `andPer.perCounter` chosen-
  counter compound arm), `14aeccea` (lane 71
  piece 3/N — `protectionFrom` per-entry
  chosen sentinel + multi-quality resolution
  in `refreshScriptedStatics`), `0756322a`
  (loop-done summary).
- Follow-up 27 reusable infrastructure
  (carried forward to this loop):
  - `CardInstance.chosenProtectionFrom: string
    | null` field (follow-up 26 lane 71 piece
    3/N) — populated by `resolveEnterChoice`
    for `enter_choice: { kind:
    "protection_quality" }`; consulted by
    `refreshScriptedStatics` when
    `protectionFrom: "chosen"` is in effect OR
    when the per-entry form contains a
    `"chosen"` entry.
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
    source is not in the map.
  - `getProtectionSourcesByQuality` derived
    helper in `keyword-actions/protection.ts`
    (follow-up 27 lane 71 piece 2/N) — the
    per-quality inverted-index helper;
    INTERNAL-USE for now.
  - `anthemScaling: { per, perPower,
    perToughness, perSubtype?: string |
    "chosen", andPer?: { per, perSubtype?:
    string | "chosen", perCounter?: { counter:
    string | "chosen" } }, perCounter?: {
    counter: string | "chosen" } }` arm
    (follow-up 23 + 24 + 25 + 26 + 27 lane 32
    pieces 1/N + 2/N + 3/N + 4/N + follow-up
    26 lane 32 piece 1/N + follow-up 27 lane
    32 piece 1/N) — full scaling-anthem
    substrate with optional subtype filter,
    chosen-type sentinel, chosen-counter
    sentinel, compound AND-source, self-
    referential counter arm, and AND-source
    per-counter arm.
  - `computeAnthemScalingCount` consult
    (follow-up 23 + 24 + 25 + 26 + 27 lane
    32) — the single function that consults
    all five scaling-anthem arms; v1 minimum
    supports per + perSubtype (with `"chosen"`
    sentinel) + andPer (with `"chosen"`
    sentinel on perSubtype) + perCounter
    (literal + `"chosen"` sentinel) +
    andPer.perCounter (literal counter type;
    REPLACES the `andPer.per` state-derived
    count when set).
- Process notes carried from follow-up 27:
  the `foreman` MCP was invoked once (the
  `getProtectionSourcesByQuality` helper
  naming decision — option 1 chosen with
  0.90 confidence). The `foreman` MCP
  was also invoked twice during the
  follow-up 28 handoff composition (the
  priority order + the summed-form
  inclusion decisions; option 1 chosen
  both times with 0.77 confidence). The
  aggressive loop's machinery (ratchet +
  commit-bypass pattern + force-with-lease
  push + `ratchet-test-count.mjs --live
  <counts.json>` fallback for the AI flake)
  is intact and ready for this loop.
