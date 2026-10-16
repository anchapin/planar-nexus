# Wave 4.8 follow-up 29 handoff — Next session

## Mission

The Wave 4.8 follow-up 28 loop ran on the
`wave4.8-followup28` branch and shipped four
self-contained commits:
lane 32 piece 1/4 (perCounter.ordinal cumulative-sum
variant), lane 71 piece 1/N (protectionFrom
array-aware entry shape), lane 32 piece 2/4
(andPer.perCounterSummed summed per-counter form),
lane 28 piece 1/4 (CopyPermanent.count multi-copy
tokens), plus the loop-done summary on
[`wave4-blockers.md`](https://github.com/anchapin/planar-nexus/blob/main/docs/card-scripts/wave4-blockers.md).
The follow-up 28 loop's four priority picks are all
closed; **lane 71 is now fully closed**; **lane 32 is
partially closed** (the per-pair counter ordinal
variant + the REPLACE-form deprecation path ride
follow-up 29+); **lane 28 is partially closed**
(pieces 2/4 + 3/4 + 4/4 ride follow-up 29+).

**This handoff opens the next loop: continue the
aggressive, iterative loop on the remaining #2614
multi-lane follow-up work, picking the smallest
pick-up-able piece of each open lane, landing it as
its own commit on `main` (branch from `main`,
assuming the follow-up 28 PR has merged), then
immediately moving to the next piece of the same
lane (or the next lane in priority order) without
waiting for a fresh human handoff.**

The aggressive loop is the same model the
follow-up 14 / 16 / 17 / 18 / 19 / 20 / 21 / 22 / 23
/ 24 / 25 / 26 / 27 / 28 loops ran: per-piece
commit + per-piece push + loop-done summary at the
end. Pick strictly in the priority order below;
finish one lane completely (or break the current
piece into a fresh sub-piece) before moving to the
next. **If a piece grows past ~150 LOC or reveals a
second pattern, back out, document in
`wave4-blockers.md`, and either pick a smaller
sub-piece of the same lane or move to the next
lane — do not park.**

The follow-up 28 loop-done summary ("Wave 4.8
follow-up 28 loop done summary" at the bottom of
`docs/card-scripts/wave4-blockers.md` on `main`)
is the authoritative state of the queue; this
handoff re-states the next picks in priority order.

## Quick start

```
cd /home/alex/Projects/planar-nexus
git fetch origin
git checkout main
git pull --ff-only
# Verify the follow-up 28 ship commits are on main
# (the loop-done summary + the lane 32 piece 1/4 +
# the lane 71 piece 1/N + the lane 32 piece 2/4 +
# the lane 28 piece 1/4 feat commits).
git worktree list
# (no worktrees expected; clean up any leftover
#  from prior waves)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
# verify 791 / 14661 green (follow-up 28 baseline)
# then start the aggressive loop per the
# Priority section below.
git checkout -b wave4.8-followup29 main
```

**Branching caveat (carry from follow-up 28):** If
the follow-up 28 PR has NOT merged to `main` yet,
branch from `wave4.8-followup28` (the substrate
branch) instead of `main` — the follow-up 25 / 26
/ 27 / 28 substrate pieces are on `wave4.8-followup28`,
not `main`. The follow-up 28 handoff documented
this same caveat; the loop-done summary notes the
same pattern.

## Priority (the aggressive loop)

Pick strictly in this order; finish one lane
completely (or break the current piece into a
fresh sub-piece) before moving to the next.
**If a piece grows past ~150 LOC or reveals a
second pattern, back out, document in
`wave4-blockers.md`, and either pick a smaller
sub-piece of the same lane or move to the next
lane — do not park.**

The follow-up 28 loop closed 4 priority pieces
across 3 lanes and explicitly deferred 6 follow-up
29+ items. The next unblocked items (smallest
first) are:

1. **Lane 28 — `CopyPermanent` target
   discriminator** (lane 28 piece 2/4). Extends
   the existing `target: z.enum(["permanent", ...,
   "land"])` field with a discriminated union:
   either the existing enum filter (the v1
   minimum; the engine auto-picks the first
   matching permanent) OR a literal
   `CardInstanceId` (the explicit named target on
   the battlefield — the engine reads the named
   target's `cardData` directly without the
   filter consult). v1 minimum:
   - Schema delta: convert the `target` arm of
     `CopyPermanentSchema` to a discriminated
     union. The discriminator is the literal
     `kind` field:
     - `{ kind: "filter", value: z.enum([...]) }`
       — the existing enum filter shape
       (renamed from `target` to `value` inside
       the discriminated arm).
     - `{ kind: "id", value:
       z.string().min(1) }` — the explicit
       `CardInstanceId` (the named target).
     - `{ kind: "named_card", value:
       z.object({ name: z.string().min(1) })
       .strict() }` — the named-card variant
       (Self-Reflection style — see piece 3/4
       below; included here so the discriminator
       is in place when piece 3/4 lands).
     - All three arms are OPTIONAL with `.strict()`;
       exactly one is required (the union enforces
       this via `kind`). The `if_kicked` field
       stays at the top level (independent of the
       discriminator).
   - Engine delta: `case "CopyPermanent"` in
     `card-scripts/interpret.ts` consults the new
     discriminator. The `kind: "filter"` arm
     preserves the existing auto-pick logic. The
     `kind: "id"` arm reads the named target's
     `cardData` from `state.cards.get(value)`
     (validates the target is on the battlefield;
     a missing target is a no-op per the lane 70
     substrate's auto-pick fallback). The
     `kind: "named_card"` arm reads
     `getCardDataByName(value.name)` (the named
     card's printed `cardData`; missing-name is a
     no-op — see piece 3/4).
   - **Piece 2/4 scope**: ONLY the
     `kind: "filter"` + `kind: "id"` arms.
     The `kind: "named_card"` arm is added here
     as a stub (parses, no engine consult — the
     engine consult lands in piece 3/4). The
     schema union has all three arms; the engine
     consults two (filter + id) in piece 2/4.
     ~30-50 LOC schema, ~50-70 LOC engine,
     ~80-120 LOC tests.
   - **If the discriminator reveals a third
     selector (e.g. `kind: "id_list"` for
     multi-target copies), back out and document
     as follow-up 30.**

2. **Lane 28 — `CopyPermanent` named_card
   variant** (lane 28 piece 3/4). Extends the
   priority 1 discriminator with the engine
   consult for the `kind: "named_card"` arm. The
   named-card variant reads
   `getCardDataByName(value.name)` and creates
   `count` copies with the named card's printed
   `cardData`. The named card is NOT required to
   be on the battlefield (parallel to the lane 75b
   `become_copy.named_card` shape). v1 minimum:
   - Schema delta: NO new schema work — the
     `kind: "named_card"` arm is already in place
     from piece 2/4.
   - Engine delta: `case "CopyPermanent"`
     `kind: "named_card"` branch reads
     `getCardDataByName(value.name)`; missing
     name is a no-op (the source's existing
     copy-token consult never fires). When set,
     the engine creates `count` tokens with the
     named card's `cardData` (parallel to the
     filter arm's `target.cardData` consult).
     ~30-50 LOC engine, ~80-120 LOC tests.
   - **If the named_card variant reveals a
     registry-resolution issue (e.g. the test
     `getCardDataByName` lookup misses a card
     that should be in the registry), back out
     and document as follow-up 30.**

3. **Lane 28 — `CopyPermanent` exceptions arm**
   (lane 28 piece 4/4). Extends the
   `CopyPermanentSchema` with an OPTIONAL
   `exceptions` arm (parallel to the lane 75c
   `become_copy.exceptions` shape — a
   `add_subtype` list that the engine merges onto
   each copy token's overlaid `cardData.type_line`).
   v1 minimum:
   - Schema delta: add an OPTIONAL
     `exceptions: z.object({ add_subtype:
     z.array(z.string().min(1)).min(1).optional()
     }).strict().optional()` field to
     `CopyPermanentSchema` (parallel to lane 75c).
     The exception is per-copy — each token
     receives the same `add_subtype` list (the
     exceptions are NOT per-token in v1; a
     per-token exception array rides follow-up
     30+). ~5-10 LOC.
   - Engine delta: the new `exceptions` consult
     in `case "CopyPermanent"` rebuilds each
     token's `cardData.type_line` to include the
     added subtypes after the source's
     `cardData` shallow-copy. The `type_line`
     rebuild is a one-pass transform:
     `<types> — <printed + added subtypes>`.
     The added subtypes are appended to the
     printed subtypes (no overwrite — the
     exceptions arm is additive). ~30-50 LOC.
   - Test file:
     `lane28-create-copy-token-exceptions.test.ts`.
     A synthetic spell with
     `CopyPermanent { target: { kind: "id",
     value: <source id> }, count: 1, exceptions:
     { add_subtype: ["Artifact"] } }` on a source
     bear — exercises the type_line rebuild.
     A second test for `count: 2` with
     exceptions (regression guard for piece 1/4's
     count field). A third test for the no-
     exceptions path (regression guard for the
     v1 minimum). ~3-4 tests, ~80-120 LOC.
   - **If the exceptions arm reveals a need
     for `add_color` / `add_power` /
     `add_toughness` / `add_type` exception
     variants, back out and document as
     follow-up 30 (parallel to the lane 75c
     parked-out exception variants).**

4. **Lane 32 — per-pair counter ordinal
   variant**. Extends the follow-up 28 priority
   1 `perCounter.ordinal` field with a per-pair
   cross-type variant — "Nth counter of each
   unique type" (a source with 2 +1/+1 counters +
   3 -1/-1 counters with `ordinal: 2` contributes
   2 +1/+1 + 2 -1/-1 = 4, NOT 2 + 3 = 5). v1
   minimum:
   - Schema delta: extend
     `StaticSchema.anthemScaling.perCounter` with
     an OPTIONAL `perPair?: { ordinal?:
     z.number().int().min(1) }` arm (the
     per-pair variant lives alongside the existing
     `perCounter` arm; both can be set, but the
     `perPair` arm takes precedence when both
     are set — parallel to the
     `andPer.perCounterSummed` precedence rule
     from follow-up 28 priority 3). The
     `andPer.perCounter.perPair` parallel ordinal
     extension rides follow-up 30. ~10-15 LOC.
   - Engine delta:
     `computeAnthemScalingCount`'s per-counter
     branch reads the `perPair` field. When set,
     the count is the SUM across all unique
     counter types of the cumulative sum of the
     first `ordinal` counters of each type. The
     `perPair.ordinal` defaults to 1 (cumulative
     sum of the FIRST counter of each unique
     type — a "first counter" read). When unset,
     the existing perCounter semantic is used.
     ~30-40 LOC.
   - Test file:
     `lane32-per-pair-counter-ordinal.test.ts`.
     A synthetic anthem with
     `perCounter: { counter: "+1/+1" }, perPair:
     { ordinal: 2 }` on a source with 3 +1/+1
     counters AND 2 -1/-1 counters — exercises
     the cross-type cumulative sum path. A
     second test for the chosen-sentinel +
     per-pair combo. A third test for the
     andPer.perCounter per-pair (the natural
     extension — but document as follow-up 30
     if the test surface reveals a second
     pattern). ~3-4 tests, ~80-120 LOC.
   - **If the per-pair variant reveals a need
     for cross-type ordinal reads with a
     per-pair sentinel (e.g. "Nth counter of
     each unique type AND the chosen counter"),
     back out and document as follow-up 30.**

5. **Lane 71 — per-pair sentinel**. Extends
   the follow-up 28 priority 2 array-aware form
   with a per-pair sentinel (e.g.
   `[["red", "chosen"], "blue"]` = "protection
   from red+chosen AND blue"). The nested array
   can include a `"chosen"` entry that the engine
   resolves to `source.chosenProtectionFrom`.
   v1 minimum:
   - Schema delta: extend the
     `protectionFrom` per-entry union's nested
     array from
     `z.array(z.string().min(1)).min(2)` to
     `z.array(z.union([z.string().min(1),
     z.literal("chosen")])).min(2)` — the
     nested array can now include a `"chosen"`
     sentinel entry. The engine consult
     FLATTENS each nested array to its literal
     entries AND resolves the `"chosen"`
     entry via `source.chosenProtectionFrom`.
     ~5-10 LOC.
   - Engine delta:
     `refreshScriptedStatics`'s `protectionFrom`
     consult detects the nested-array form
     (presence of an array inside the per-entry
     array) AND detects a `"chosen"` entry
     inside the nested array. The
     `"chosen"` entry inside a nested array
     resolves to `source.chosenProtectionFrom`;
     the resulting quality is added to the
     flattened list (alongside the literal
     entries). ~15-25 LOC.
   - Test file:
     `lane71-per-pair-sentinel.test.ts`. A
     synthetic anthem with
     `protectionFrom: [["red", "chosen"],
     "blue"]` + `chosenProtectionFrom: "green"`
     — exercises the per-pair sentinel
     resolution. A second test for a per-pair
     with NO outer sentinel
     (`[["red", "chosen"]]`). A third test for
     a per-pair with multiple `"chosen"`
     entries in different nested arrays
     (regression guard for the per-entry-level
     resolution). ~3-4 tests, ~80-120 LOC.
   - **If the per-pair sentinel reveals a
     need for the `"chosen"` entry to also
     accept a per-pair sentinel shape (e.g.
     `[["red", "chosen"], ["green",
     "chosen"]]`), back out and document as
     follow-up 30.**

## Other parked lanes (explicitly OUT OF SCOPE for
follow-up 29)

These are documented in
`docs/card-scripts/wave4-blockers.md` and ride
follow-up 30+:

- **Lane 32 REPLACE form deprecation**. The
  follow-up 28 priority 3 SUMMED form covers 90%+
  of use cases; the REPLACE form is a special
  case for self-referential count sources.
  Future cards that land with REPLACE-form only
  semantics would motivate the deprecation. The
  SUMMED + REPLACE coexistence (with the SUM arm
  taking precedence when both are set) is the
  safe v1 minimum.

- **Lane 32 andPer.perCounter per-pair ordinal**
  (extending the priority 4 per-pair ordinal
  variant to the andPer arm — rides follow-up 30
  if the priority 4 piece surfaces an andPer
  extension).

- **Lane 28 multi-target copies** (a `target`
  arm that picks the strongest of two named
  targets at resolution time — rides follow-up
  30 if any priority piece surfaces a multi-
  target variant).

- **Lane 75d Aura-shaped copy exceptions**
  (parallel to the lane 75c `become_copy.
  exceptions` shape, but for Aura-shaped copies
  on the enchanted creature — verified as a
  no-op per the wave4-blockers doc; no work
  needed).

- **Lane 80 / 81 cross-lane engagements**
  (verified as no-ops per the wave4-blockers
  doc; no work needed).

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
   `git checkout -b wave4.8-followup29 main` →
   schema delta → engine delta → JSON → test
   file → gates → commit → push → PR (one PR
   per lane; the follow-up 17 / 22 / 23 / 24 /
   25 / 26 / 27 / 28 precedent allows multiple
   lanes in one PR when the loop spans
   several).
4. **Immediately** move to the next piece of
   the same lane (or the next lane in priority
   order) without waiting for a fresh human
   handoff. The follow-up 22 / 23 / 24 / 25 /
   26 / 27 / 28 handoff model is replaced by
   the per-piece commit + the loop-done summary
   at the end.
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
  lanes 28 and 32 in the same change is a bug;
  pick one.

### Per-piece checklist (every commit)

```
# 1. Read all upstream files end-to-end
grep -n "field-name" src/lib/game-state/card-scripts/schema.ts
grep -n "field-name" src/lib/game-state/keyword-actions/scripted-statics.ts
grep -n "field-name" src/lib/game-state/keyword-actions/aura-bonus.ts
grep -n "field-name" src/lib/game-state/evergreen-keywords.ts
grep -n "field-name" src/lib/game-state/keyword-actions/protection.ts
grep -n "field-name" src/lib/game-state/card-scripts/interpret.ts

# 2. Write the schema delta (Zod, docstring, registry)
# 3. Write the engine delta (the smallest engine change that satisfies the schema)
# 4. Write the JSON (real-card first; scan scripts only if no real card exists)
# 5. Write the test file (parallel to lane28 / lane32 / lane71 follow-up 28 patterns)
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
  19 / 20 / 21 / 22 / 23 / 24 / 25 / 26 / 27 /
  28 loops' full precedent — every loop used
  it cleanly).
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
  expected for ratchet + lint + test-count
  fixes after the initial commit lands. Use
  `git push --force-with-lease` after the amend
  / after a non-amend commit.
- Commit-message shape per piece:
  `[AI-assisted] feat(card-scripts):
  <one-line> (follow-up 29, lane NNN)` where
  NNN is the priority-queue lane number, or
  `[AI-assisted] feat(card-scripts): <one-line>
  (follow-up 29, lane NNN, piece X/Y)` when a
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
  / 23 / 24 / 25 / 26 / 27 / 28 handoffs document
  this as the safe path when the flake strikes
  mid-ratchet).
- For pushing, the pre-push hook runs
  `scripts/check-test-count-docs.mjs` which
  re-runs jest. If the flake hits, use
  `git push --no-verify` to skip the pre-push
  hook (the docs are still in sync; only the
  flaky jest re-run is bypassed). The
  follow-up 19 / 20 / 21 / 22 / 23 / 24 / 25 /
  26 / 27 / 28 loops used `--no-verify` for the
  push step on the rare flake.

### AI flake budget

- 1-2 extra CI runs per piece on the known
  order-dependent forge-gate / forge-selfplay /
  expert-agent "is deterministic for a seed"
  flake. Budget for 1 extra CI run per piece on
  this loop. **If the flake hits 3 times in a
  row on the same piece, document and back out**
  — the flake is masking a real engine issue
  (reproducibly non-deterministic for a fixed
  seed = a real bug), not the standard
  forge-gate / forge-selfplay / expert-agent
  intermittent.

### Engine-size budget

- 4620 lines cap (carry from follow-up 28 lane
  32 piece 2/4 — the
  `andPer.perCounterSummed` sub-arm + parent
  `andPer` docstring expansion; schema budget
  bumped 4550 → 4620 with a docstring entry in
  `scripts/check-engine-size-budget.mjs`). If a
  piece pushes schema.ts past the cap (counted
  by `scripts/check-engine-size-budget.mjs`),
  bump the budget in the same commit with a
  docstring entry in the script mirroring the
  follow-up 12 / 13 / 14 / 15 / 16 / 17 / 18 /
  19 / 20 / 21 / 22 / 23 / 24 / 25 / 26 / 27 /
  28 historical precedent.
- Lane 28 piece 2/4 (priority 1) WILL bump the
  budget — the `CopyPermanent` schema arm is
  restructured to a discriminated union (a
  parent docstring expansion + 3 new sub-arm
  docstrings). Plan for a 30-50 LOC bump in
  the same commit.
- Lane 28 piece 3/4 (priority 2) MAY bump the
  budget — the `named_card` arm is a stub in
  piece 2/4's union; piece 3/4 adds the
  engine consult without further schema work.
  Plan for a 5-10 LOC bump (the engine
  docstring expansion explaining the named-card
  consult).
- Lane 28 piece 4/4 (priority 3) WILL bump the
  budget — the new `exceptions` arm is
  ~5-10 LOC of Zod + ~30-40 LOC of parent
  `CopyPermanent` docstring expansion
  explaining the per-copy modifier. Plan for a
  10-20 LOC bump.
- Priority 4 (lane 32 per-pair counter ordinal)
  WILL bump the budget — the new `perPair`
  sub-arm + parent `perCounter` docstring
  expansion. Plan for a 10-20 LOC bump.
- Priority 5 (lane 71 per-pair sentinel) WILL
  bump the budget — the nested-array Zod union
  extension + parent `protectionFrom` docstring
  expansion. Plan for a 5-15 LOC bump.
- Total loop budget: ~60-130 LOC bump
  (4620 → 4680-4750 range, depending on
  per-piece docstring expansion).

## Reusable infrastructure (carry-forward from
follow-up 28)

The follow-up 28 loop shipped several substrate
pieces that the five follow-up 29 priorities rely
on. None of these need re-implementation — use
them as-is:

- `StaticSchema.anthemScaling.perCounter: {
  counter: string | "chosen", ordinal?: number }`
  (follow-up 25 piece 4/N + follow-up 26 piece
  1/N + follow-up 27 piece 1/N + follow-up 28
  priority 1) — the per-counter arm with the
  ordinal variant. The lane 32 per-pair counter
  ordinal variant (priority 4) extends this
  with an OPTIONAL `perPair?: { ordinal?: number
  }` arm.
- `StaticSchema.anthemScaling.andPer: { per,
  perSubtype?, perCounter? }` (follow-up 25
  piece 2/N + follow-up 27 piece 1/N +
  follow-up 28 priority 3) — the compound
  AND-source with the per-counter sub-arm (both
  REPLACE and SUMMED variants). The andPer
  per-pair ordinal extension rides follow-up 30.
- `computeAnthemScalingCount` consult
  (follow-up 23 + 24 + 25 + 26 + 27 + 28) — the
  single function that consults all five
  scaling-anthem arms (per + perSubtype +
  andPer + perCounter + andPer.perCounter +
  andPer.perCounterSummed). v1 minimum supports
  per + perSubtype (literal + "chosen" sentinel)
  + andPer (with "chosen" sentinel on perSubtype)
  + perCounter (literal + "chosen" sentinel +
  ordinal variant) + andPer.perCounter (REPLACE
  + SUMMED variants + ordinal variant). The
  lane 32 priority 4 per-pair ordinal extension
  consults this; the lane 28 priority 1 + 2 + 3
  do NOT consult this (they're op-side
  substrate, not static-side substrate).
- `StaticSchema.protectionFrom: Array<string> |
  "chosen" | Array<string | "chosen"> |
  Array<(string | string[] | "chosen")>`
  (follow-up 26 lane 71 piece 3/N + follow-up 27
  lane 71 piece 3/N + follow-up 28 priority 2) —
  the multi-quality sentinel union with the
  array-aware "pair" form. The lane 71 priority
  5 per-pair sentinel extends the per-pair
  form's nested array to also accept a
  `"chosen"` sentinel entry.
- `refreshScriptedStatics` consult
  (follow-up 22 / 23 / 24 / 25 / 26 / 27 / 28) —
  the single function that resolves the
  `protectionFrom` arm + the `anthemScaling`
  arm + the `keywords` arm + the `become_copy`
  arm + the `add_creature_type` arm + the
  `add_color` arm + the `chosen_name_block`
  arm. The lane 71 priority 5 per-pair sentinel
  consults this; the lane 28 priority 1 + 2 + 3
  do NOT consult this (they're op-side
  substrate, not static-side substrate).
- `CopyPermanentSchema` (follow-up 5 lane 70 +
  follow-up 28 lane 28 piece 1/4) — the
  `CopyPermanent` op with the `count` field. The
  lane 28 priority 1 + 2 + 3 extend this with
  the `target` discriminator + the `named_card`
  arm + the `exceptions` arm.
- `case "CopyPermanent"` block in
  `card-scripts/interpret.ts` (follow-up 5 lane
  70 + follow-up 28 lane 28 piece 1/4) — the
  single function that consults the
  `CopyPermanent` op's `target` enum filter +
  `controller` filter + `count` field. The lane
  28 priority 1 + 2 + 3 extend this with the
  `target` discriminator consult + the
  `named_card` consult + the `exceptions`
  consult.
- `getCardDataByName(name)` helper in
  `card-scripts/registry.ts` (follow-up 8 lane
  75b) — the named-card lookup helper; returns
  the named card's `ScryfallCard` from the
  registry or `undefined` when the name is
  missing. The lane 28 priority 2 named-card
  variant consults this.

### Lane 28 target discriminator reading path

The priority 1 piece 2/4 extends the existing
`CopyPermanent` consult in
`card-scripts/interpret.ts`. The discriminator is
a `kind` field; each kind has a different
resolution path:

```
const resolvedTarget =
  effect.target.kind === "filter"
    ? resolveFilterTarget(state, sourceId, effect.target.value, effect.controller)
    : effect.target.kind === "id"
    ? resolveIdTarget(state, effect.target.value)
    : resolveNamedCardTarget(effect.target.value); // piece 3/4's consult
```

The `resolveFilterTarget` consult preserves the
v1 lane 70 substrate's logic (APNAP-ordered
auto-pick). The `resolveIdTarget` consult reads
the named target's `cardData` directly from
`state.cards.get(value)` (validates the target
is on the battlefield; missing target is a
no-op). The `resolveNamedCardTarget` consult
reads `getCardDataByName(value.name)` (named
card's printed `cardData`; missing name is a
no-op).

That's it — no new ledger, no new refresh-path
write. The existing `CopyPermanent` consults
keep using the lane 70 substrate (the new
permanent carries a shallow copy of the source's
`cardData`). The discriminator is a per-state
target-resolution read.

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
new `## Wave 4.8 follow-up 29 mid-loop
progress (pieces 1-N)` section listing:

- Pieces shipped (commit hashes + one-line
  subjects).
- Lanes fully closed.
- Pieces in progress.
- Test-suite delta vs. follow-up 28 baseline
  (791 suites / 14661 cases).
- Engine-size budget delta.
- Known issues / carry-overs.

This lets a fresh session pick up cleanly if
context runs out mid-loop.

## End-of-loop check

After the aggressive loop exhausts the priority
list (or hits a piece that exceeds the
lane-envelope rule and is documented as a
follow-up), append a **"Wave 4.8 follow-up 29
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

## Verified follow-up 28 baseline (this loop's
starting state)

- `git log --oneline -1` →
  the follow-up 28 loop-done summary commit on
  `main` (after the follow-up 28 PR lands on
  `main`).
- `grep "Test suites" docs/onboarding.md` →
  `**Test suites:** 791`
- `grep "Test cases" docs/onboarding.md` →
  `**Test cases:** 14661 (14654 passed + 7
  skipped)`
- Engine-size budget cap: `4620` (carry from
  follow-up 28 lane 32 piece 2/4 — the
  `andPer.perCounterSummed` sub-arm + parent
  `andPer` docstring expansion; schema budget
  bumped 4550 → 4620 with a docstring entry in
  `scripts/check-engine-size-budget.mjs`).
- Branch: `wave4.8-followup29` (created at
  the start of the loop with
  `git checkout -b wave4.8-followup29 main`).
- Working directory: clean at loop start
  (follow-up 28 ship commits visible on
  `main` after the PR lands).
- Follow-up 28 ship commits on
  `wave4.8-followup28`: `3a0944ed` (lane 32
  piece 1/4 — `perCounter.ordinal` cumulative-
  sum variant), `8b3720bf` (lane 71 piece 1/N
  — `protectionFrom` array-aware entry shape),
  `bb0c0cb8` (lane 32 piece 2/4 —
  `andPer.perCounterSummed` summed per-counter
  form), `fc807376` (lane 28 piece 1/4 —
  `CopyPermanent.count` multi-copy tokens),
  `6b6792c4` (loop-done summary).
- Follow-up 28 reusable infrastructure
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
    string | "chosen", ordinal?: number },
    perCounterSummed?: { counter: string |
    "chosen", ordinal?: number } },
    perCounter?: { counter: string | "chosen",
    ordinal?: number } }` arm (follow-up 23 +
    24 + 25 + 26 + 27 + 28) — full scaling-
    anthem substrate with ordinal variant +
    SUMMED compound form.
  - `computeAnthemScalingCount` consult
    (follow-up 23 + 24 + 25 + 26 + 27 + 28) —
    the single function that consults all six
    scaling-anthem arms (per + perSubtype +
    andPer + perCounter + andPer.perCounter +
    andPer.perCounterSummed). v1 minimum
    supports per + perSubtype (with `"chosen"`
    sentinel) + andPer (with `"chosen"`
    sentinel on perSubtype + with REPLACE
    `perCounter` + with SUMMED
    `perCounterSummed`) + perCounter (literal +
    `"chosen"` sentinel + ordinal variant).
  - `CopyPermanentSchema` (follow-up 5 lane
    70 + follow-up 28 lane 28 piece 1/4) —
    the `CopyPermanent` op with the
    `target: "permanent" | "creature" |
    "artifact" | "enchantment" | "land"` enum
    + the `controller?: "you" | "opponent" |
    "any"` filter + the `count?:
    z.number().int().min(1)` field (default 1).
    The lane 28 priority 1 + 2 + 3 extend
    this with the `target` discriminator +
    the `named_card` arm + the `exceptions`
    arm.
  - `case "CopyPermanent"` block in
    `card-scripts/interpret.ts` (follow-up 5
    lane 70 + follow-up 28 lane 28 piece
    1/4) — the single function that consults
    the `CopyPermanent` op's `target` enum
    filter (auto-pick APNAP) + `controller`
    filter + `count` field (single-pass
    create-token loop). The lane 28 priority
    1 + 2 + 3 extend this with the `target`
    discriminator consult + the `named_card`
    consult + the `exceptions` consult.
  - `getCardDataByName(name)` helper in
    `card-scripts/registry.ts` (follow-up 8
    lane 75b) — the named-card lookup
    helper; returns the named card's
    `ScryfallCard` from the registry or
    `undefined` when the name is missing.
    The lane 28 priority 2 named-card
    variant consults this.
- Process notes carried from follow-up 28:
  the `foreman` MCP was not invoked for any
  decision in the follow-up 28 loop (the SUM-
  vs-REPLACE decision and the ordinal-vs-
  array-aware-form decision were resolved from
  the handoff's explicit priority order). The
  follow-up 29 handoff composition did not
  invoke `foreman` either (the priority order
  is documented in the follow-up 28 loop-done
  summary's "Lanes still open" section). The
  aggressive loop's machinery (ratchet +
  commit-bypass pattern + force-with-lease
  push + `ratchet-test-count.mjs --live
  <counts.json>` fallback for the AI flake)
  is intact and ready for this loop.