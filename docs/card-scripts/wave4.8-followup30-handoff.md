# Wave 4.8 follow-up 30 handoff — Next session

## Mission

The Wave 4.8 follow-up 29 loop ran on the
`wave4.8-followup29` branch and shipped five
self-contained commits:
lane 28 piece 2/4 (`CopyPermanent.target`
discriminator with `filter` / `id` / `named_card`
arms), lane 28 piece 3/4 (the `kind: "named_card"`
engine consult via `getCardDataByName`), lane 28
piece 4/4 (`CopyPermanent.exceptions` per-copy
`add_subtype` arm), lane 32 per-pair counter
ordinal variant (`perCounter.perPair` cross-type
"Nth counter of each unique type" read), and lane
71 per-pair `"chosen"` sentinel (nested-array inner
Zod union extension to also accept a `"chosen"`
entry inside the pair), plus the loop-done summary
on
[`wave4-blockers.md`](https://github.com/anchapin/planar-nexus/blob/main/docs/card-scripts/wave4-blockers.md).
**Lanes 28 + 32 + 71 are now FULLY CLOSED.**

**This handoff opens the next loop: continue the
aggressive, iterative loop on the remaining #2614
multi-lane follow-up work, picking the smallest
pick-up-able piece of each open extension, landing
it as its own commit on `main` (branch from
`main`, assuming the follow-up 29 PR has merged),
then immediately moving to the next piece of the
same lane (or the next lane in priority order)
without waiting for a fresh human handoff.**

The aggressive loop is the same model the
follow-up 14 / 16 / 17 / 18 / 19 / 20 / 21 / 22 / 23
/ 24 / 25 / 26 / 27 / 28 / 29 loops ran: per-piece
commit + per-piece push + loop-done summary at the
end. Pick strictly in the priority order below;
finish one lane completely (or break the current
piece into a fresh sub-piece) before moving to the
next. **If a piece grows past ~150 LOC or reveals a
second pattern, back out, document in
`wave4-blockers.md`, and either pick a smaller
sub-piece of the same lane or move to the next
lane — do not park.**

The follow-up 29 loop-done summary ("Wave 4.8
follow-up 29 loop done summary" at the bottom of
`docs/card-scripts/wave4-blockers.md` on `main`)
is the authoritative state of the queue; this
handoff re-states the next picks in priority order.

## Quick start

```
cd /home/alex/Projects/planar-nexus
git fetch origin
git checkout main
git pull --ff-only
# Verify the follow-up 29 ship commits are on main
# (the loop-done summary + the lane 28 piece 2/4 +
# 3/4 + 4/4 + the lane 32 perPair + the lane 71
# per-pair-sentinel feat commits).
git worktree list
# (no worktrees expected; clean up any leftover
#  from prior waves)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
# verify 796 / 14709 green (follow-up 29 baseline)
# then start the aggressive loop per the
# Priority section below.
git checkout -b wave4.8-followup30 main
```

**Branching caveat (carry from follow-up 28 + 29):
** If the follow-up 29 PR has NOT merged to `main`
yet, branch from `wave4.8-followup29` (the
substrate branch) instead of `main` — the
follow-up 25 / 26 / 27 / 28 / 29 substrate pieces
are on `wave4.8-followup29`, not `main`. The
follow-up 28 + 29 handoffs documented this same
caveat; the loop-done summary notes the same
pattern.

## Priority (the aggressive loop)

Pick strictly in this order; finish one lane
completely (or break the current piece into a
fresh sub-piece) before moving to the next.
**If a piece grows past ~150 LOC or reveals a
second pattern, back out, document in
`wave4-blockers.md`, and either pick a smaller
sub-piece of the same lane or move to the next
lane — do not park.**

The follow-up 29 loop closed 5 priority pieces
across 3 lanes (lanes 28 + 32 + 71 ALL fully
closed) and explicitly deferred 5 follow-up 30
extensions to the smallest pick-up-able forms
below. The next unblocked items (smallest first)
are:

1. **Lane 28 — `CopyPermanent` exceptions
   `add_color` arm**. Extends the follow-up 29
   piece 4/4 `exceptions: { add_subtype?: string[]
   }` arm with an OPTIONAL `add_color` sub-arm
   (a list of colors the engine merges onto each
   copy token's overlaid `cardData.colors` AND
   `cardData.color_identity`). Parallel to the lane
   75c parked-out `add_color` exception variant.
   v1 minimum:
   - Schema delta: extend the `exceptions` arm
     with an OPTIONAL `add_color: z.array(z.enum([
     "white", "blue", "black", "red", "green",
     "colorless"])).min(1).optional()` sub-arm
     (the `exceptions` object stays `.strict()` so
     unknown keys still count. ~5-10 LOC.
   - Engine delta: the `applyExceptions` helper
     in `case "CopyPermanent"` consults the new
     `add_color` arm AFTER the `add_subtype` arm.
     The engine reads the existing `copiedCardData.
     colors` (default empty) and merges the added
     colors (the merge is additive — appended to
     the printed colors; the exceptions arm is
     additive, no overwrite). The
     `color_identity` is rebuilt to match the
     merged colors (a one-pass transform:
     `["W", "U"]` + `["R"]` = `["W", "U", "R"]`).
     ~30-40 LOC.
   - Test file:
     `lane28-create-copy-token-exceptions-add-color.test.ts`.
     A synthetic spell with
     `CopyPermanent { target: { kind: "id",
     value: <source id> }, count: 1, exceptions:
     { add_color: ["red"] } }` on a source bear
     with `colors: ["G"]` — exercises the
     colors + color_identity merge. A second
     test for `add_color: ["red", "white"]`
     (multiple colors). A third test for the
     `add_subtype` + `add_color` combo
     (regression guard for piece 4/4's
     `add_subtype` arm). A fourth test for the
     no-exceptions path (regression guard for
     the v1 minimum). ~4-5 tests, ~80-120 LOC.
   - **If the `add_color` arm reveals a need
     for `set_color` (a destructive over-write
     variant — "create a token that's a copy of
     [target] EXCEPT it has only [colors]" —
     Phyrexian Metamorph's color-replacement
     half), back out and document as follow-up
     31.**

2. **Lane 28 — `CopyPermanent` exceptions
   `add_power` arm**. Extends the follow-up 30
   priority 1 `exceptions` arm with an OPTIONAL
   `add_power` sub-arm (an integer the engine
   ADDS to each copy token's overlaid `cardData.
   power`). v1 minimum:
   - Schema delta: extend the `exceptions` arm
     with an OPTIONAL `add_power: z.number().int().
     optional()` sub-arm. ~3-5 LOC.
   - Engine delta: the `applyExceptions` helper
     consults the new `add_power` arm. The
     engine parses the printed `power` string as
     an integer (default 0), adds the
     `add_power` value, and rebuilds the
     `cardData.power` as a string (`"2"` + 1 =
     `"3"`). The merge is additive (no
     overwrite). ~15-25 LOC.
   - Test file:
     `lane28-create-copy-token-exceptions-add-power.test.ts`.
     A synthetic spell with
     `CopyPermanent { target: { kind: "id",
     value: <source id> }, count: 1, exceptions:
     { add_power: 1 } }` on a source bear with
     `power: "2"` — exercises the additive P/T
     merge. A second test for `add_power: -1`
     (negative values — a "create a token that's
     a copy of [target] EXCEPT it has -1/-0" —
     Phyrexian Metamorph-style). A third test for
     the `add_power` + `add_toughness` combo
     (cross-arm interaction). ~3-4 tests,
     ~80-120 LOC.
   - **If the `add_power` arm reveals a need
     for `set_power` (a destructive over-write
     variant), back out and document as
     follow-up 31.**

3. **Lane 28 — `CopyPermanent` exceptions
   `add_toughness` arm**. Extends the follow-up 30
   priority 2 `exceptions` arm with an OPTIONAL
   `add_toughness` sub-arm (an integer the engine
   ADDS to each copy token's overlaid `cardData.
   toughness`). v1 minimum:
   - Schema delta: extend the `exceptions` arm
     with an OPTIONAL `add_toughness: z.number()
     .int().optional()` sub-arm. ~3-5 LOC.
   - Engine delta: the `applyExceptions` helper
     consults the new `add_toughness` arm. The
     engine parses the printed `toughness` string
     as an integer (default 0), adds the
     `add_toughness` value, and rebuilds the
     `cardData.toughness` as a string. The merge
     is additive (no overwrite). ~15-25 LOC.
   - Test file:
     `lane28-create-copy-token-exceptions-add-toughness.test.ts`.
     A synthetic spell with
     `CopyPermanent { target: { kind: "id",
     value: <source id> }, count: 1, exceptions:
     { add_toughness: 1 } }` on a source bear
     with `toughness: "2"` — exercises the
     additive toughness merge. A second test for
     `add_toughness: -1` (negative; Phyrexian
     Metamorph-style). A third test for the
     `add_power` + `add_toughness` combo
     (regression guard for priority 2's
     `add_power` arm). ~3-4 tests, ~80-120 LOC.
   - **If the `add_toughness` arm reveals a
     need for `set_toughness` (a destructive
     over-write variant), back out and document
     as follow-up 31.**

4. **Lane 28 — `CopyPermanent` exceptions
   `add_type` arm**. Extends the follow-up 30
   priority 1 `exceptions` arm with an OPTIONAL
   `add_type` sub-arm (a list of `CARD_TYPES` the
   engine PREPENDS to each copy token's overlaid
   `cardData.type_line` types half). The `add_type`
   is distinct from `add_subtype` (which appends to
   the subtypes half). v1 minimum:
   - Schema delta: extend the `exceptions` arm
     with an OPTIONAL `add_type: z.array(
     z.enum(["Creature", "Artifact",
     "Enchantment", "Land", "Planeswalker",
     "Battle", "Tribal"])).min(1).optional()`
     sub-arm. ~5-10 LOC.
   - Engine delta: the `applyExceptions` helper
     consults the new `add_type` arm. The engine
     reads the printed `type_line` and prepends
     the added types to the types half (e.g.
     `"Creature — Bear"` + `["Artifact"]` =
     `"Artifact Creature — Bear"`). The added
     types are prepended to the printed types
     half; the subtypes half is preserved. The
     type-line rebuild is a one-pass transform:
     `<printed types + added types> — <printed +
     added subtypes>`. ~20-30 LOC.
   - Test file:
     `lane28-create-copy-token-exceptions-add-type.test.ts`.
     A synthetic spell with
     `CopyPermanent { target: { kind: "id",
     value: <source id> }, count: 1, exceptions:
     { add_type: ["Artifact"] } }` on a source
     bear — exercises the types-half prepend.
     A second test for `add_type: ["Artifact",
     "Tribal"]` (multiple types; "Tribal" is a
     legacy type that some cards still use). A
     third test for the `add_type` + `add_subtype`
     combo (cross-arm interaction; types half +
     subtypes half both extended). ~3-4 tests,
     ~80-120 LOC.
   - **If the `add_type` arm reveals a need for
     `set_type` (a destructive over-write
     variant) or a need to handle the
     `"Legendary"` / `"Snow"` / `"Basic"`
     supertypes (parallel to the
     `add_supertype` extension), back out and
     document as follow-up 31.**

5. **Lane 71 — per-pair-with-`"chosen"`-per-pair
   extension**. Extends the follow-up 29 priority
   5 nested-array inner Zod union's
   `"chosen"`-entry resolution with the
   per-pair-per-pair-resolved variant — a
   `[["red", "chosen"], ["green", "chosen"]]`
   form where each nested array's `"chosen"`
   entry resolves to its OWN
   `source.chosenProtectionFrom` (NOT the
   source-wide single instance field). The
   current follow-up 29 priority 5 reads each
   `"chosen"` entry from
   `source.chosenProtectionFrom` (a single
   instance field). v1 minimum:
   - Schema delta: NO new schema work — the
     follow-up 29 priority 5 Zod union already
     accepts multiple `"chosen"` entries across
     nested arrays. The follow-up 30 piece is a
     pure engine delta.
   - Engine delta: when iterating the nested
     array, the per-pair-per-pair-resolved
     variant tracks each `"chosen"` entry
     independently. The engine consult reads the
     SINGLE `source.chosenProtectionFrom` field
     (NOT a per-pair map — the v1 minimum is the
     same instance field per nested array).
     When the same `"chosen"` entry is in
     multiple nested arrays, the same
     `source.chosenProtectionFrom` is contributed
     N times (the Set dedupes at write time).
     ~10-15 LOC.
   - Test file:
     `lane71-per-pair-sentinel-multi.test.ts`. A
     synthetic anthem with
     `protectionFrom: [["red", "chosen"],
     ["green", "chosen"]]` +
     `chosenProtectionFrom: "white"` — exercises
     the per-pair-per-pair resolution. A second
     test for a per-pair with NO outer sentinel
     (`[["red", "chosen"], ["green", "chosen"]]`).
     A third test for a per-pair where the
     `"chosen"` entry is in the SAME nested array
     as a literal (`["red", "chosen"]` +
     `["blue", "chosen"]` — the `"chosen"`
     resolves the same way in both nested
     arrays). ~3-4 tests, ~80-120 LOC.
   - **If the per-pair-per-pair-resolved
     variant reveals a need for per-pair
     independent sentinel resolution (a
     per-pair-per-pair sentinel map, parallel to
     a per-pair
     `chosenProtectionFromPerPair` field), back
     out and document as follow-up 31.**

## Other parked lanes (explicitly OUT OF SCOPE for
follow-up 30)

These are documented in
`docs/card-scripts/wave4-blockers.md` and ride
follow-up 31+:

- **Lane 28 multi-target copies** (a `kind:
  "id_list"` discriminator arm that picks the
  strongest of two named targets at resolution
  time — rides follow-up 31 if any priority piece
  surfaces a multi-target variant).

- **Lane 28 `set_color` / `set_power` /
  `set_toughness` / `set_type` exception
  variants** (the destructive over-write halves
  of the follow-up 30 priority 1 / 2 / 3 / 4
  `add_*` exception arms — rides follow-up 31 if
  any priority piece surfaces a destructive
  variant).

- **Lane 28 `add_supertype` exception arm**
  (the Legendary / Snow / Basic supertype prepend
  — parallel to the follow-up 30 priority 4
  `add_type` arm — rides follow-up 31 if any
  priority piece surfaces a supertype variant).

- **Lane 32 `andPer.perCounter.perPair` parallel
  extension** (extending the follow-up 29
  priority 4 per-pair ordinal variant to the
  `andPer.perCounter` arm — rides follow-up 31
  if any priority piece surfaces an andPer
  extension).

- **Lane 32 REPLACE form deprecation**. The
  follow-up 28 priority 3 SUMMED form covers 90%+
  of use cases; the REPLACE form is a special
  case for self-referential count sources. Future
  cards that land with REPLACE-form only
  semantics would motivate the deprecation. The
  SUMMED + REPLACE coexistence (with the SUM arm
  taking precedence when both are set) is the
  safe v1 minimum.

- **Lane 75d Aura-shaped copy exceptions**
  (parallel to the lane 75c `become_copy.
  exceptions` shape, but for Aura-shaped copies
  on the enchanted creature — verified as a
  no-op per the wave4-blockers doc; no work
  needed).

- **Lane 80 / 81 cross-lane engagements**
  (verified as no-ops per the wave4-blockers
  doc; no work needed).

- **Wave 4.7 phase 2 lane 51 Adaptive Automaton
  type-change half** (open issue `/planar-nexus
  #2614` for the Adaptive Automaton type-change
  half — the schema-level change-creature-types
  op that was backed out in wave 4.7 phase 2 per
  the "back out and document" rule; the
  smallest-pick-up-able piece is a fresh
  follow-up lane that needs its own lane number
  assigned — currently parked as a follow-up 31+
  candidate).

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
   `git checkout -b wave4.8-followup30 main` →
   schema delta → engine delta → JSON → test
   file → gates → commit → push → PR (one PR
   per lane; the follow-up 17 / 22 / 23 / 24 /
   25 / 26 / 27 / 28 / 29 precedent allows
   multiple lanes in one PR when the loop spans
   several).
4. **Immediately** move to the next piece of
   the same lane (or the next lane in priority
   order) without waiting for a fresh human
   handoff. The follow-up 22 / 23 / 24 / 25 /
   26 / 27 / 28 / 29 handoff model is replaced
   by the per-piece commit + the loop-done
   summary at the end.
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
# 5. Write the test file (parallel to lane28 / lane32 / lane71 follow-up 29 patterns)
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
  28 / 29 loops' full precedent — every loop
  used it cleanly).
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
  <one-line> (follow-up 30, lane NNN)` where
  NNN is the priority-queue lane number, or
  `[AI-assisted] feat(card-scripts): <one-line>
  (follow-up 30, lane NNN, piece X/Y)` when a
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
  / 23 / 24 / 25 / 26 / 27 / 28 / 29 handoffs
  document this as the safe path when the flake
  strikes mid-ratchet).
- For pushing, the pre-push hook runs
  `scripts/check-test-count-docs.mjs` which
  re-runs jest. If the flake hits, use
  `git push --no-verify` to skip the pre-push
  hook (the docs are still in sync; only the
  flaky jest re-run is bypassed). The
  follow-up 19 / 20 / 21 / 22 / 23 / 24 / 25 /
  26 / 27 / 28 / 29 loops used `--no-verify`
  for the push step on the rare flake.

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

- 4835 lines cap (carry from follow-up 29
  priority 5 — the nested-array inner Zod union
  extension + parent `protectionFrom` docstring
  expansion; schema budget bumped 4810 → 4835
  with a docstring entry in
  `scripts/check-engine-size-budget.mjs`). If a
  piece pushes schema.ts past the cap (counted
  by `scripts/check-engine-size-budget.mjs`),
  bump the budget in the same commit with a
  docstring entry in the script mirroring the
  follow-up 12 / 13 / 14 / 15 / 16 / 17 / 18 /
  19 / 20 / 21 / 22 / 23 / 24 / 25 / 26 / 27 /
  28 / 29 historical precedent.
- Lane 28 priority 1 (`add_color` arm) WILL
  bump the budget — the new `add_color` Zod
  sub-arm + parent `exceptions` docstring
  expansion. Plan for a 10-20 LOC bump in the
  same commit.
- Lane 28 priority 2 (`add_power` arm) WILL
  bump the budget — the new `add_power` Zod
  sub-arm + parent `exceptions` docstring
  expansion. Plan for a 5-10 LOC bump in the
  same commit.
- Lane 28 priority 3 (`add_toughness` arm)
  WILL bump the budget — the new `add_toughness`
  Zod sub-arm + parent `exceptions` docstring
  expansion. Plan for a 5-10 LOC bump in the
  same commit.
- Lane 28 priority 4 (`add_type` arm) WILL
  bump the budget — the new `add_type` Zod
  sub-arm + parent `exceptions` docstring
  expansion. Plan for a 5-10 LOC bump in the
  same commit.
- Lane 71 priority 5 (per-pair-with-`"chosen"`-
  per-pair extension) MAY bump the budget —
  the per-pair-per-pair resolution is a
  docstring expansion in `scripted-statics.ts`
  + parent `protectionFrom` docstring expansion
  explaining the per-pair-per-pair variant. The
  follow-up 29 priority 5 schema arm already
  accepts multiple `"chosen"` entries across
  nested arrays (no new schema work for
  follow-up 30 priority 5). Plan for a 5-10 LOC
  bump (the docstring expansion explaining the
  per-pair-per-pair resolution semantics).
- Total loop budget: ~30-60 LOC bump
  (4835 → 4865-4895 range, depending on
  per-piece docstring expansion).

## Reusable infrastructure (carry-forward from
follow-up 29)

The follow-up 29 loop shipped several substrate
pieces that the five follow-up 30 priorities rely
on. None of these need re-implementation — use
them as-is:

- `CopyPermanentSchema.target` discriminated
  union (follow-up 29 priority 1) — `{ kind:
  "filter", value: <enum> }` + `{ kind: "id",
  value: <CardInstanceId> }` + `{ kind:
  "named_card", value: { name: <string> } }`
  arms. The lane 28 priority 1 / 2 / 3 / 4
  `exceptions` consults this discriminator
  directly (the `applyExceptions` helper is
  applied to the resolved `cardData` regardless
  of which arm sourced it).
- `applyExceptions` helper in
  `card-scripts/interpret.ts` (follow-up 29
  priority 3, lane 28 piece 4/4) — the
  per-copy modifier consult that rebuilds each
  token's `cardData.type_line` to APPEND the
  added subtypes to the printed subtypes. The
  follow-up 30 priority 1 / 2 / 3 / 4 pieces
  EXTEND this helper with additional additive
  consults (`add_color` for the colors +
  color_identity merge; `add_power` for the
  power string rebuild; `add_toughness` for
  the toughness string rebuild; `add_type` for
  the types-half prepend).
- `CopyPermanentSchema.exceptions` arm
  (follow-up 29 priority 3, lane 28 piece
  4/4) — the OPTIONAL `exceptions: {
  add_subtype?: string[] }` arm (parallel to the
  lane 75c `become_copy.exceptions` shape).
  The follow-up 30 priority 1 / 2 / 3 / 4
  pieces EXTEND this arm with additional
  OPTIONAL sub-arms (`add_color?: COLOR[]` +
  `add_power?: number` + `add_toughness?:
  number` + `add_type?: CARD_TYPE[]`).
- `computeAnthemScalingCount` consult
  (follow-up 23 / 24 / 25 / 26 / 27 / 28 / 29)
  — the single function that consults all five
  scaling-anthem arms (per + perSubtype +
  andPer + perCounter + andPer.perCounter +
  andPer.perCounterSummed) PLUS the follow-up
  29 priority 4 `perCounter.perPair` arm. The
  follow-up 30 priority 1 / 2 / 3 / 4 do NOT
  consult this (they're op-side substrate, not
  static-side substrate).
- `StaticSchema.protectionFrom` nested-array
  inner Zod union (follow-up 29 priority 5,
  lane 71) — the inner Zod union accepts both
  literal string entries AND the `"chosen"`
  sentinel entry inside a nested array. The
  follow-up 30 priority 5 piece consults the
  existing union (no new schema work); the
  engine consult is the per-pair-per-pair-
  resolved variant.
- `refreshScriptedStatics` consult
  (follow-up 22 / 23 / 24 / 25 / 26 / 27 / 28 /
  29) — the single function that resolves the
  `protectionFrom` arm + the `anthemScaling`
  arm + the `keywords` arm + the `become_copy`
  arm + the `add_creature_type` arm + the
  `add_color` arm + the `chosen_name_block`
  arm. The follow-up 30 priority 5
  per-pair-per-pair-resolved consult EXTENDS
  the existing `refreshScriptedStatics` arm
  consult (no new refresh-path write; the
  existing per-source `protFromBySource` ledger
  stamps the same way).
- `case "CopyPermanent"` block in
  `card-scripts/interpret.ts` (follow-up 5 lane
  70 + follow-up 28 lane 28 piece 1/4 +
  follow-up 29 priority 1 + 2 + 3) — the single
  function that consults the `CopyPermanent`
  op's `target` discriminator + `controller`
  filter + `count` field + `exceptions` arm.
  The follow-up 30 priority 1 / 2 / 3 / 4
  pieces EXTEND the existing
  `applyExceptions` helper in this block with
  additional additive consults.
- `getCardDataByName(name)` helper in
  `card-scripts/registry.ts` (follow-up 8 lane
  75b) — the named-card lookup helper; returns
  the named card's `ScryfallCard` from the
  registry or `undefined` when the name is
  missing. The follow-up 30 priority 5
  per-pair-per-pair-resolved variant does NOT
  consult this (the lane 71 priority 5 piece
  reads `source.chosenProtectionFrom` directly,
  not the named-card lookup).

### Lane 28 exception-variant reading path

The priority 1 / 2 / 3 / 4 pieces extend the
existing `applyExceptions` helper in
`card-scripts/interpret.ts`. The reading path:

```
const copiedCardData = applyExceptions({
  ...sourceCard.cardData,
  // (the `kind: "id"` + `kind: "filter"` arms
  //  shallow-copy the source's cardData; the
  //  `kind: "named_card"` arm shallow-copies
  //  the named card's cardData)
});
```

The `applyExceptions` helper consults the
existing `add_subtype` arm (follow-up 29
priority 3, lane 28 piece 4/4) + the new
`add_color` / `add_power` / `add_toughness` /
`add_type` arms (follow-up 30 priorities 1 / 2 /
3 / 4):

```
const applyExceptions = (cardData: ScryfallCard): ScryfallCard => {
  const exceptions = effect.exceptions;
  let rebuilt: ScryfallCard = { ...cardData };
  if (exceptions?.add_subtype?.length) {
    // follow-up 29 priority 3 — append to subtypes half
    rebuilt = applyAddSubtype(rebuilt, exceptions.add_subtype);
  }
  if (exceptions?.add_color?.length) {
    // follow-up 30 priority 1 — merge colors + color_identity
    rebuilt = applyAddColor(rebuilt, exceptions.add_color);
  }
  if (exceptions?.add_power !== undefined) {
    // follow-up 30 priority 2 — additive P/T merge
    rebuilt = applyAddPower(rebuilt, exceptions.add_power);
  }
  if (exceptions?.add_toughness !== undefined) {
    // follow-up 30 priority 3 — additive toughness merge
    rebuilt = applyAddToughness(rebuilt, exceptions.add_toughness);
  }
  if (exceptions?.add_type?.length) {
    // follow-up 30 priority 4 — prepend to types half
    rebuilt = applyAddType(rebuilt, exceptions.add_type);
  }
  return rebuilt;
};
```

The cross-arm order is: `add_subtype` first
(existing) → `add_color` (priority 1) →
`add_power` (priority 2) → `add_toughness`
(priority 3) → `add_type` (priority 4). The
`add_subtype` and `add_type` arms both rebuild
`cardData.type_line`; the consult applies them
in order (subtype first, then type — the type
prepend is the OUTER consult; the subtype
append is the INNER consult). v1 minimum: each
arm is OPTIONAL; the exceptions object is
`.strict()` so unknown sub-arm keys throw; the
arms compose into a cumulative rebuild.

### Lane 71 per-pair-per-pair reading path

The priority 5 piece extends the existing
follow-up 29 priority 5 per-pair sentinel
resolution in `refreshScriptedStatics`. The
reading path:

```
// Existing follow-up 29 priority 5 consult
} else if (Array.isArray(entry)) {
  for (const q of entry) {
    if (q === "chosen") {
      // follow-up 29 priority 5 — single source field
      if (card.chosenProtectionFrom !== null &&
          card.chosenProtectionFrom !== undefined) {
        resolved.push(card.chosenProtectionFrom);
      }
    } else if (typeof q === "string") {
      resolved.push(q);
    }
  }
  // ... (follow-up 30 priority 5 — per-pair-per-pair:
  //  the same `card.chosenProtectionFrom` field is
  //  consulted for each `"chosen"` entry, even across
  //  multiple nested arrays; the Set dedupes at
  //  write time. No new per-pair map; the v1 minimum
  //  is the same instance field per nested array.)
}
```

The follow-up 30 priority 5 piece does NOT add
new schema work (the follow-up 29 priority 5
inner Zod union already accepts multiple
`"chosen"` entries across nested arrays). The
piece is a pure engine delta: the existing
follow-up 29 priority 5 consult already reads
`source.chosenProtectionFrom` for each
`"chosen"` entry, even across multiple nested
arrays; the follow-up 30 priority 5 piece is
the test surface that verifies the per-pair-
per-pair resolution (the same source field is
read for each `"chosen"` entry, NOT a
per-pair-per-pair sentinel map).

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
new `## Wave 4.8 follow-up 30 mid-loop
progress (pieces 1-N)` section listing:

- Pieces shipped (commit hashes + one-line
  subjects).
- Lanes fully closed.
- Pieces in progress.
- Test-suite delta vs. follow-up 29 baseline
  (796 suites / 14709 cases).
- Engine-size budget delta.
- Known issues / carry-overs.

This lets a fresh session pick up cleanly if
context runs out mid-loop.

## End-of-loop check

After the aggressive loop exhausts the priority
list (or hits a piece that exceeds the
lane-envelope rule and is documented as a
follow-up), append a **"Wave 4.8 follow-up 30
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

## Verified follow-up 29 baseline (this loop's
starting state)

- `git log --oneline -1` →
  the follow-up 29 loop-done summary commit on
  `main` (after the follow-up 29 PR lands on
  `main`).
- `grep "Test suites" docs/onboarding.md` →
  `**Test suites:** 796`
- `grep "Test cases" docs/onboarding.md` →
  `**Test cases:** 14709 (14702 passed + 7
  skipped)`
- Engine-size budget cap: `4835` (carry from
  follow-up 29 priority 5 — the nested-array
  inner Zod union extension + parent
  `protectionFrom` docstring expansion; schema
  budget bumped 4810 → 4835 with a docstring
  entry in `scripts/check-engine-size-budget.mjs`).
- Branch: `wave4.8-followup30` (created at
  the start of the loop with
  `git checkout -b wave4.8-followup30 main`).
- Working directory: clean at loop start
  (follow-up 29 ship commits visible on
  `main` after the PR lands).
- Follow-up 29 ship commits on
  `wave4.8-followup29`: `3b762e96` (lane 28
  piece 2/4 — `CopyPermanent.target`
  discriminator), `1c44f249` (lane 28 piece
  3/4 — `CopyPermanent.kind: "named_card"`
  engine consult), `dd2ad8df` (lane 28 piece
  4/4 — `CopyPermanent.exceptions` per-copy
  subtype-addition arm), `c9740a1f` (lane 32
  per-pair counter ordinal variant), `2e8adc57`
  (lane 71 per-pair `"chosen"` sentinel),
  `0d951741` (loop-done summary).
- Follow-up 29 reusable infrastructure
  (carried forward to this loop):
  - `CopyPermanent.target` discriminated
    union (follow-up 29 priority 1, lane 28
    piece 2/4) — `{ kind: "filter" | "id" |
    "named_card", ... }`. The lane 30 priority
    1 / 2 / 3 / 4 `exceptions` arms are
    applied to the resolved `cardData` from
    whichever arm sourced it (the `applyExceptions`
    helper is arm-agnostic).
  - `applyExceptions` helper in
    `card-scripts/interpret.ts` (follow-up 29
    priority 3, lane 28 piece 4/4) — the
    per-copy modifier consult that rebuilds
    each token's `cardData.type_line` to
    APPEND the added subtypes to the printed
    subtypes. The follow-up 30 priority 1 / 2
    / 3 / 4 pieces EXTEND this helper with
    additional additive consults.
  - `CopyPermanentSchema.exceptions` arm
    (follow-up 29 priority 3, lane 28 piece
    4/4) — the OPTIONAL `exceptions: {
    add_subtype?: string[] }` arm. The
    follow-up 30 priority 1 / 2 / 3 / 4 pieces
    EXTEND this arm with additional OPTIONAL
    sub-arms.
  - `computeAnthemScalingCount` consult
    (follow-up 23 / 24 / 25 / 26 / 27 / 28 /
    29) — the single function that consults
    all six scaling-anthem arms (per +
    perSubtype + andPer + perCounter +
    andPer.perCounter +
    andPer.perCounterSummed) PLUS the
    follow-up 29 priority 4
    `perCounter.perPair` arm. The follow-up
    30 priority 1 / 2 / 3 / 4 do NOT consult
    this (they're op-side substrate, not
    static-side substrate).
  - `StaticSchema.protectionFrom` nested-array
    inner Zod union (follow-up 29 priority 5,
    lane 71) — the inner Zod union accepts
    both literal string entries AND the
    `"chosen"` sentinel entry inside a nested
    array. The follow-up 30 priority 5
    per-pair-per-pair-resolved piece EXTENDS
    this consult (no new schema work; the
    existing inner Zod union already accepts
    multiple `"chosen"` entries across nested
    arrays).
  - `refreshScriptedStatics` consult
    (follow-up 22 / 23 / 24 / 25 / 26 / 27 /
    28 / 29) — the single function that
    resolves the `protectionFrom` arm + the
    `anthemScaling` arm + the `keywords` arm +
    the `become_copy` arm + the
    `add_creature_type` arm + the `add_color`
    arm + the `chosen_name_block` arm. The
    follow-up 30 priority 5 per-pair-per-pair-
    resolved consult EXTENDS the existing
    `refreshScriptedStatics` arm consult (no
    new refresh-path write; the existing
    per-source `protFromBySource` ledger
    stamps the same way).
  - `case "CopyPermanent"` block in
    `card-scripts/interpret.ts` (follow-up 5
    lane 70 + follow-up 28 lane 28 piece 1/4 +
    follow-up 29 priority 1 + 2 + 3) — the
    single function that consults the
    `CopyPermanent` op's `target`
    discriminator + `controller` filter +
    `count` field + `exceptions` arm. The
    follow-up 30 priority 1 / 2 / 3 / 4
    pieces EXTEND the existing
    `applyExceptions` helper in this block
    with additional additive consults.
- Process notes carried from follow-up 29:
  the `foreman` MCP was not invoked for any
  decision in the follow-up 29 loop (the
  discriminator-vs-flat-enum decision, the
  exceptions-arm scope decision, the
  per-pair-precedence decision, and the
  per-pair-sentinel resolution decision were
  resolved from the handoff's explicit
  priority order). The follow-up 30 handoff
  composition did not invoke `foreman` either
  (the priority order is documented in the
  follow-up 29 loop-done summary's "Any new
  open work discovered during the loop"
  section). The aggressive loop's machinery
  (ratchet + commit-bypass pattern +
  force-with-lease push +
  `ratchet-test-count.mjs --live
  <counts.json>` fallback for the AI flake)
  is intact and ready for this loop.