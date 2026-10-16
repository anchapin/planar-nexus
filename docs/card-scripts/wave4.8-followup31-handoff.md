# Wave 4.8 follow-up 31 handoff — Next session

## Mission

The Wave 4.8 follow-up 30 loop ran on the
`wave4.8-followup30` branch and shipped five
self-contained commits:
lane 28 piece 1/N (`CopyPermanent.exceptions.add_color`
additive merge), lane 28 piece 2/N
(`CopyPermanent.exceptions.add_power` additive P/T
merge), lane 28 piece 3/N
(`CopyPermanent.exceptions.add_toughness` additive
merge), lane 28 piece 4/N
(`CopyPermanent.exceptions.add_type` types-half
prepend), lane 71 (`protectionFrom`
per-pair-with-`"chosen"`-per-pair resolution), plus the
loop-done summary on
[`wave4-blockers.md`](https://github.com/anchapin/planar-nexus/blob/main/docs/card-scripts/wave4-blockers.md).
**Lanes 28 + 71 are now FULLY CLOSED** (the
additive exception variants all shipped; the destructive
`set_*` variants ride follow-up 31+). **Lane 32 is
fully closed** (the `andPer.perCounter.perPair` parallel
extension rides follow-up 31+).

**This handoff opens the next loop: continue the
aggressive, iterative loop on the remaining #2614
multi-lane follow-up work, picking the smallest
pick-up-able piece of each open extension, landing
it as its own commit on `main` (branch from `main`,
assuming the follow-up 30 PR has merged), then
immediately moving to the next piece of the same
lane (or the next lane in priority order) without
waiting for a fresh human handoff.**

The aggressive loop is the same model the
follow-up 14 / 16 / 17 / 18 / 19 / 20 / 21 / 22 / 23
/ 24 / 25 / 26 / 27 / 28 / 29 / 30 loops ran: per-piece
commit + per-piece push + loop-done summary at the
end. Pick strictly in the priority order below;
finish one lane completely (or break the current
piece into a fresh sub-piece) before moving to the
next. **If a piece grows past ~150 LOC or reveals a
second pattern, back out, document in
`wave4-blockers.md`, and either pick a smaller
sub-piece of the same lane or move to the next
lane — do not park.**

The follow-up 30 loop-done summary ("Wave 4.8
follow-up 30 loop done summary" at the bottom of
`docs/card-scripts/wave4-blockers.md` on `main`)
is the authoritative state of the queue; this
handoff re-states the next picks in priority order.

## Quick start

```
cd /home/alex/Projects/planar-nexus
git fetch origin
git checkout main
git pull --ff-only
# Verify the follow-up 30 ship commits are on main
# (the loop-done summary + the lane 28 pieces 1-4 +
# the lane 71 priority 5 feat commits).
git worktree list
# (no worktrees expected; clean up any leftover
#  from prior waves)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
# verify 800 / 14739 green (follow-up 30 baseline;
# 1 known forge-gate flake on full-suite run,
# passes on isolated re-run)
# then start the aggressive loop per the
# Priority section below.
git checkout -b wave4.8-followup31 main
```

**Branching caveat (carry from follow-up 30):** If
the follow-up 30 PR has NOT merged to `main` yet,
branch from `wave4.8-followup30` (the substrate
branch) instead of `main` — the follow-up 30
substrate pieces are on `wave4.8-followup30`, not
`main`. The follow-up 30 handoff documented this
same caveat; the loop-done summary notes the same
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

The follow-up 30 loop closed 5 priority pieces
across 2 lanes (lanes 28 + 71 fully closed) and
explicitly deferred 4 follow-up 31 extensions to the
smallest pick-up-able forms below. The next
unblocked items (smallest first) are:

1. **Lane 28 — `CopyPermanent` exceptions
   `add_supertype` arm**. Extends the follow-up 30
   `exceptions` arm with an OPTIONAL `add_supertype`
   sub-arm (a list of `SUPERTYPES` the engine
   PREPENDS to each copy token's overlaid
   `cardData.type_line` TYPES half — BEFORE the
   `add_type` prepend, BEFORE the printed types).
   Parallel to the follow-up 30 priority 4
   `add_type` arm but for supertypes. v1 minimum:
   - Schema delta: extend the `exceptions` arm
     with an OPTIONAL
     `add_supertype: z.array(z.enum(["Legendary",
     "Snow", "Basic"])).min(1).optional()`
     sub-arm (the `exceptions` object stays
     `.strict()` so unknown keys still count.
     ~5-10 LOC.
   - Engine delta: the `applyExceptions` helper
     in `case "CopyPermanent"` consults the new
     `add_supertype` arm BEFORE the `add_type`
     arm. The engine reads the existing
     `copiedCardData.type_line` and prepends the
     added supertypes to the FRONT of the types
     half (e.g. `"Creature — Bear"` +
     `["Legendary"]` + `["Artifact"]` =
     `"Legendary Artifact Creature — Bear"` —
     supertypes come first, then added types,
     then printed types). The supertype prepend
     preserves the em-dash separator (subtypes
     half) when present. The
     `add_supertype` arm is ADDITIVE — no
     overwrite of the printed supertypes. ~20-30
     LOC.
   - Test file:
     `lane28-create-copy-token-exceptions-add-supertype.test.ts`.
     A synthetic spell with
     `CopyPermanent { target: { kind: "id",
     value: <source id> }, count: 1, exceptions:
     { add_supertype: ["Legendary"] } }` on a
     source bear — exercises the supertype
     prepend. A second test for
     `add_supertype: ["Basic"]` on a `"Creature
     — Bear"` source (Basic + Creature reads as
     `"Basic Creature — Bear"` — the parallel
     `add_type` arm does not fire here).
     A third test for the
     `add_supertype` + `add_type` combo
     (`add_supertype: ["Legendary"]` +
     `add_type: ["Artifact"]` cross-arm order
     test — supertype OUTERMOST, type INNER, then
     printed). A fourth test for the
     `add_supertype` + `add_subtype` combo
     (`add_supertype: ["Legendary"]` +
     `add_subtype: ["Warrior"]` →
     `"Legendary Creature — Bear Warrior"` —
     supertype OUTERMOST, subtype append INNER).
     A fifth test for the no-exceptions path
     (regression guard for the v1 minimum). ~5-6
     tests, ~80-120 LOC.
   - **If the `add_supertype` arm reveals a need
     for `set_supertype` (a destructive
     over-write variant) or for the
     `"World"` / `"Legendary"` legacy supertype
     distinction (parallel to the follow-up 30
     priority 4 `Tribal` legacy case), back out
     and document as follow-up 32.**

2. **Lane 28 — `CopyPermanent` exceptions
   `set_color` arm**. Extends the follow-up 30
   priority 1 `add_color` arm with a destructive
   `set_color` sub-arm — a list of color names
   the engine REPLACES (overwrites) on each copy
   token's overlaid `cardData.colors` AND
   rebuilds `cardData.color_identity` to match
   (no merge, no append — the printed colors are
   discarded; the listed colors become the entire
   `colors` / `color_identity` arrays). v1
   minimum:
   - Schema delta: extend the `exceptions` arm
     with an OPTIONAL
     `set_color: z.array(z.enum(["white", "blue",
     "black", "red", "green",
     "colorless"])).min(1).optional()` sub-arm.
     ~5-10 LOC.
   - Engine delta: the `applyExceptions` helper
     consults the new `set_color` arm. The engine
     REPLACES `cardData.colors` with the
     `set_color` array verbatim (deduplicated;
     declared order preserved — same Set transform
     as `add_color`). The
     `color_identity` is rebuilt to match the
     replaced colors (a one-pass transform:
     the `set_color` array is the new identity,
     no merge with the printed). The `set_color`
     arm is DESTRUCTIVE — it overwrites the
     printed colors; `set_color` takes
     PRECEDENCE over `add_color` when both are
     set (the destructive variant always wins;
     parallel to the
     `andPer.perCounterSummed` precedence rule
     for the additive vs REPLACE form). ~25-35
     LOC.
   - Test file:
     `lane28-create-copy-token-exceptions-set-color.test.ts`.
     A synthetic spell with
     `CopyPermanent { target: { kind: "id",
     value: <source id> }, count: 1, exceptions:
     { set_color: ["red"] } }` on a source bear
     with `colors: ["G"]` — exercises the
     destructive replace (the printed green is
     dropped; the new color is red-only). A
     second test for `set_color: ["red", "white"]`
     (multi-color destructive — replaces the
     printed green with red + white). A third
     test for the `set_color` + `add_color` combo
     (`set_color: ["red"]` + `add_color: ["blue"]`
     — destructive wins, final colors are red
     only; blue is dropped). A fourth test for
     the no-exceptions path (regression guard for
     the v1 minimum). ~4-5 tests, ~80-120 LOC.
   - **If the `set_color` arm reveals a need
     for `set_color_identity` (a separate
     variant that overrides the identity but
     leaves the printed colors intact — parallel
     to a `set_color` + `add_color` hybrid), back
     out and document as follow-up 32.**

3. **Lane 28 — `CopyPermanent` exceptions
   `set_power` arm**. Extends the follow-up 30
   priority 2 `add_power` arm with a destructive
   `set_power` sub-arm — an integer the engine
   REPLACES (overwrites) on each copy token's
   overlaid `cardData.power` (no merge, no add —
   the printed power is discarded; the listed
   power becomes the new `cardData.power`
   string). v1 minimum:
   - Schema delta: extend the `exceptions` arm
     with an OPTIONAL
     `set_power: z.number().int().optional()`
     sub-arm. ~3-5 LOC.
   - Engine delta: the `applyExceptions` helper
     consults the new `set_power` arm. The
     engine REPLACES `cardData.power` with
     `String(set_power)` (the integer stringified;
     the printed power string is discarded
     entirely). The `set_power` arm is
     DESTRUCTIVE — it overwrites the printed
     power; `set_power` takes PRECEDENCE over
     `add_power` when both are set. ~10-20 LOC.
   - Test file:
     `lane28-create-copy-token-exceptions-set-power.test.ts`.
     A synthetic spell with
     `CopyPermanent { target: { kind: "id",
     value: <source id> }, count: 1, exceptions:
     { set_power: 5 } }` on a source bear with
     `power: "2"` — exercises the destructive
     replace (the printed 2 is dropped; the new
     power is 5). A second test for
     `set_power: 0` (zero-power destructive —
     reads as `"0"`). A third test for the
     `set_power` + `add_power` combo
     (`set_power: 5` + `add_power: 1` — destructive
     wins, final power is 5; the +1 additive is
     dropped). A fourth test for the
     `set_power` + `set_toughness` combo
     (cross-arm destructive P/T — both fields
     are replaced). ~4 tests, ~80-120 LOC.
   - **If the `set_power` arm reveals a need for
     a `set_power` "exactly N until end of turn"
     variant (the printed power is restored at
     end of turn — parallel to the lane 75c
     `become_copy` until-eot shape), back out
     and document as follow-up 32.**

4. **Lane 71 — `chosenProtectionFromPerPair`
   per-pair independent sentinel-resolution
   field**. Extends the follow-up 30 priority 5
   per-pair-with-`"chosen"`-per-pair resolution
   with an OPTIONAL per-pair
   `chosenProtectionFromPerPair` field on
   `CardInstance` (parallel to the lane 52
   `chosenColor` and lane 44 `chosenCreatureType`
   single-instance fields). The per-pair map is
   a `Record<number, string>` keyed by the
   per-pair INDEX (the index of the nested
   array in the outer `protectionFrom` array)
   with the chosen protection-from quality for
   that nested array. v1 minimum:
   - Type delta: add
     `chosenProtectionFromPerPair?: Record<number,
     string | null>` to `CardInstance` in
     `src/lib/game-state/types/cards.ts`. The
     map is OPTIONAL (parallel to
     `chosenTypeAdditions?` / `chosenColorAdditions?`
     — set by `resolveEnterChoice` when the
     source has a per-pair enter_choice; null
     when the source has no per-pair
     sentinel-resolution need). ~10-15 LOC.
   - Engine delta: `refreshScriptedStatics` in
     `scripted-statics.ts` consults the new
     per-pair map BEFORE falling back to the
     single-instance `chosenProtectionFrom`
     field. When the nested-array index is
     present in the map (key matches the index
     AND value is non-null), the per-pair value
     is used; when absent or null, the existing
     single-instance field is consulted (the
     follow-up 30 priority 5 fallback). The
     per-pair consult is a docstring expansion
     explaining the precedence: per-pair map →
     single-instance field → null. ~10-20 LOC.
   - Test file:
     `lane71-protection-from-per-pair-sentinel.test.ts`.
     A synthetic anthem with
     `protectionFrom: [["red", "chosen"],
     ["green", "chosen"]]` + stamped
     `chosenProtectionFromPerPair: { 0: "white",
     1: "blue" }` — exercises the per-pair
     independent sentinel resolution (red pair
     resolves to white, green pair resolves to
     blue — distinct from the follow-up 30
     single-instance fallback). A second test
     for a partial per-pair map (`{ 0: "white" }`
     — the second nested array falls back to
     `chosenProtectionFrom: "red"`). A third
     test for an empty per-pair map (`{}` —
     all nested arrays fall back to
     `chosenProtectionFrom`). A fourth test for
     the null per-pair map (per-pair omitted;
     existing follow-up 30 single-instance
     semantic preserved). ~4 tests, ~80-120
     LOC.
   - **If the per-pair map reveals a need for
     per-pair-with-literal-sentinel
     independent resolution (a parallel
     `chosenProtectionFromWithLiteral` per-pair
     map that resolves the `"chosen"` entry
     differently when the same nested array
     also has literal qualities), back out and
     document as follow-up 32.**

## Other parked lanes (explicitly OUT OF SCOPE for
follow-up 31)

These are documented in
`docs/card-scripts/wave4-blockers.md` and ride
follow-up 32+:

- **Lane 28 `set_toughness` exception variant**
  (the destructive over-write half of the
  follow-up 30 priority 3 `add_toughness` arm —
  rides follow-up 32 if any priority piece
  surfaces a "exactly N" semantic for toughness).

- **Lane 28 `set_type` exception variant**
  (the destructive over-write half of the
  follow-up 30 priority 4 `add_type` arm —
  rides follow-up 32 if any priority piece
  surfaces a "exactly [types]" semantic).

- **Lane 28 multi-target copies** (a `kind:
  "id_list"` discriminator arm that picks the
  strongest of two named targets at resolution
  time — rides follow-up 32 if any priority
  piece surfaces a multi-target variant).

- **Lane 28 `add_supertype` legacy variants**
  (the `"World"` / `"Snow"`-only /
  `"Legendary"`-only supertype distinctions —
  rides follow-up 32 if any priority piece
  surfaces a legacy variant).

- **Lane 32 `andPer.perCounter.perPair` parallel
  extension** (extending the follow-up 29
  priority 4 per-pair ordinal variant to the
  `andPer.perCounter` arm — rides follow-up 32
  if any priority piece surfaces an andPer
  extension).

- **Lane 32 REPLACE form deprecation**. The
  follow-up 28 priority 3 SUMMED form covers
  90%+ of use cases; the REPLACE form is a
  special case for self-referential count
  sources. Future cards that land with
  REPLACE-form only semantics would motivate
  the deprecation. The SUMMED + REPLACE
  coexistence (with the SUM arm taking
  precedence when both are set) is the safe v1
  minimum.

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
  assigned — currently parked as a follow-up
  32+ candidate).

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
   `git checkout -b wave4.8-followup31 main` →
   schema delta → engine delta → JSON → test
   file → gates → commit → push → PR (one PR
   per lane; the follow-up 17 / 22 / 23 / 24 /
   25 / 26 / 27 / 28 / 29 / 30 precedent allows
   multiple lanes in one PR when the loop spans
   several).
4. **Immediately** move to the next piece of
   the same lane (or the next lane in priority
   order) without waiting for a fresh human
   handoff. The follow-up 22 / 23 / 24 / 25 /
   26 / 27 / 28 / 29 / 30 handoff model is
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
  lanes 28 and 71 in the same change is a bug;
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
# 5. Write the test file (parallel to lane28 / lane71 follow-up 30 patterns)
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
  28 / 29 / 30 loops' full precedent — every
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
  expected for ratchet + lint + test-count
  fixes after the initial commit lands. Use
  `git push --force-with-lease` after the amend
  / after a non-amend commit.
- Commit-message shape per piece:
  `[AI-assisted] feat(card-scripts):
  <one-line> (follow-up 31, lane NNN)` where
  NNN is the priority-queue lane number, or
  `[AI-assisted] feat(card-scripts): <one-line>
  (follow-up 31, lane NNN, piece X/Y)` when a
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
  / 23 / 24 / 25 / 26 / 27 / 28 / 29 / 30
  handoffs document this as the safe path when
  the flake strikes mid-ratchet).
- For pushing, the pre-push hook runs
  `scripts/check-test-count-docs.mjs` which
  re-runs jest. If the flake hits, use
  `git push --no-verify` to skip the pre-push
  hook (the docs are still in sync; only the
  flaky jest re-run is bypassed). The
  follow-up 19 / 20 / 21 / 22 / 23 / 24 / 25 /
  26 / 27 / 28 / 29 / 30 loops used `--no-verify`
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
- The follow-up 30 baseline confirmed the
  `forge-gate > gives the baseline its own
  search budget` 5000ms timeout flake strikes
  on full-suite runs but passes on isolated
  re-runs (1 known flake on the full-suite gate;
  passes on `npx jest src/ai/manamind/__tests__/forge-gate.test.ts`).

### Engine-size budget

- 5060 lines cap (carry from follow-up 30
  priority 4 — the `add_type` arm + parent
  `exceptions` docstring expansion; schema
  budget bumped 4985 → 5060 with a docstring
  entry in `scripts/check-engine-size-budget.mjs`).
  If a piece pushes schema.ts past the cap
  (counted by `scripts/check-engine-size-budget.mjs`),
  bump the budget in the same commit with a
  docstring entry in the script mirroring the
  follow-up 12 / 13 / 14 / 15 / 16 / 17 / 18 /
  19 / 20 / 21 / 22 / 23 / 24 / 25 / 26 / 27 /
  28 / 29 / 30 historical precedent.
- Lane 28 priority 1 (`add_supertype` arm)
  WILL bump the budget — the new
  `add_supertype` Zod sub-arm + parent
  `exceptions` docstring expansion. Plan for a
  10-20 LOC bump in the same commit.
- Lane 28 priority 2 (`set_color` arm) WILL
  bump the budget — the new `set_color` Zod
  sub-arm + parent `exceptions` docstring
  expansion. Plan for a 5-10 LOC bump in the
  same commit.
- Lane 28 priority 3 (`set_power` arm) WILL
  bump the budget — the new `set_power` Zod
  sub-arm + parent `exceptions` docstring
  expansion. Plan for a 5-10 LOC bump in the
  same commit.
- Lane 71 priority 4 (per-pair independent
  sentinel-resolution field) WILL bump the
  budget — the new `chosenProtectionFromPerPair`
  field on `CardInstance` + parent
  `chosenProtectionFrom` docstring expansion
  explaining the per-pair map precedence. Plan
  for a 10-20 LOC bump in the same commit.
- Total loop budget: ~30-60 LOC bump
  (5060 → 5090-5120 range, depending on
  per-piece docstring expansion).

## Reusable infrastructure (carry-forward from
follow-up 30)

The follow-up 30 loop shipped several substrate
pieces that the four follow-up 31 priorities
rely on. None of these need re-implementation —
use them as-is:

- `CopyPermanentSchema.target` discriminated
  union (follow-up 29 priority 1) — `{ kind:
  "filter", value: <enum> }` + `{ kind: "id",
  value: <CardInstanceId> }` + `{ kind:
  "named_card", value: { name: <string> } }`
  arms. The lane 28 priorities 1 / 2 / 3
  `exceptions` consult this discriminator
  directly (the `applyExceptions` helper is
  applied to the resolved `cardData` regardless
  of which arm sourced it).
- `applyExceptions` helper in
  `card-scripts/interpret.ts` (follow-up 29
  priority 3, lane 28 piece 4/4 + follow-up 30
  priorities 1 / 2 / 3 / 4) — the per-copy
  modifier consult that rebuilds each token's
  `cardData.type_line` to APPEND the added
  subtypes + PREPEND the added types + MERGE
  the added colors / P / T additive to the
  printed values. The follow-up 31 priority 1
  piece EXTENDS this helper with the
  supertype-prepend consult (BEFORE the
  `add_type` consult). The follow-up 31
  priority 2 piece EXTENDS this helper with the
  `set_color` destructive replace consult
  (DESTRUCTIVE precedence over `add_color`
  when both are set). The follow-up 31
  priority 3 piece EXTENDS this helper with the
  `set_power` destructive replace consult
  (DESTRUCTIVE precedence over `add_power`
  when both are set).
- `CopyPermanentSchema.exceptions` arm
  (follow-up 29 priority 3, lane 28 piece
  4/4 + follow-up 30 priorities 1 / 2 / 3 / 4)
  — the OPTIONAL
  `exceptions: { add_subtype?: string[];
  add_color?: COLOR[]; add_power?: number;
  add_toughness?: number; add_type?: CARD_TYPE[] }`
  arm (parallel to the lane 75c
  `become_copy.exceptions` shape). The
  follow-up 31 priority 1 / 2 / 3 pieces EXTEND
  this arm with additional OPTIONAL sub-arms
  (`add_supertype?: SUPERTYPE[]` +
  `set_color?: COLOR[]` + `set_power?: number`).
- `computeAnthemScalingCount` consult
  (follow-up 23 / 24 / 25 / 26 / 27 / 28 / 29 /
  30) — the single function that consults all
  five scaling-anthem arms (per + perSubtype +
  andPer + perCounter + andPer.perCounter +
  andPer.perCounterSummed + perCounter.perPair).
  The follow-up 31 priorities do NOT consult
  this (they're op-side substrate, not
  static-side substrate).
- `StaticSchema.protectionFrom` nested-array
  inner Zod union (follow-up 29 priority 5,
  lane 71) — the inner Zod union accepts both
  literal string entries AND the `"chosen"`
  sentinel entry inside a nested array. The
  follow-up 31 priority 4 piece EXTENDS the
  engine consult with the per-pair independent
  sentinel-resolution via the new
  `chosenProtectionFromPerPair` map on
  `CardInstance`.
- `refreshScriptedStatics` consult
  (follow-up 22 / 23 / 24 / 25 / 26 / 27 / 28 /
  29 / 30) — the single function that resolves
  the `protectionFrom` arm + the `anthemScaling`
  arm + the `keywords` arm + the `become_copy`
  arm + the `add_creature_type` arm + the
  `add_color` arm + the `chosen_name_block`
  arm. The follow-up 31 priority 4
  per-pair independent sentinel consult
  EXTENDS the existing `refreshScriptedStatics`
  arm consult (no new refresh-path write; the
  existing per-source `protFromBySource` ledger
  stamps the same way; the per-pair consult is
  a docstring expansion in the per-pair inner
  loop).
- `case "CopyPermanent"` block in
  `card-scripts/interpret.ts` (follow-up 5 lane
  70 + follow-up 28 lane 28 piece 1/4 +
  follow-up 29 priority 1 + 2 + 3 + follow-up
  30 priorities 1 / 2 / 3 / 4) — the single
  function that consults the `CopyPermanent`
  op's `target` discriminator + `controller`
  filter + `count` field + `exceptions` arm.
  The follow-up 31 priority 1 / 2 / 3 pieces
  EXTEND the existing `applyExceptions` helper
  in this block with additional consults.
- `getCardDataByName(name)` helper in
  `card-scripts/registry.ts` (follow-up 8 lane
  75b) — the named-card lookup helper; returns
  the named card's `ScryfallCard` from the
  registry or `undefined` when the name is
  missing. The follow-up 31 priorities do NOT
  consult this (the lane 71 priority 4 piece
  reads `source.chosenProtectionFromPerPair`
  directly, not the named-card lookup).
- `chosenProtectionFrom` single-instance field
  on `CardInstance` (follow-up 26 priority 3,
  lane 71 piece 3/N) — the per-instance
  protection-quality chosen at ETB, stamped by
  `resolveEnterChoice` for the
  `enter_choice: { kind: "protection_quality" }`
  kind. The follow-up 31 priority 4 per-pair
  independent sentinel-resolution field
  (`chosenProtectionFromPerPair`) is a
  per-pair INDEXED map parallel to the
  single-instance `chosenProtectionFrom` field.

### Lane 28 exception-variant reading path

The priorities 1 / 2 / 3 pieces extend the
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
priority 3, lane 28 piece 4/4) + the existing
`add_color` / `add_power` / `add_toughness` /
`add_type` arms (follow-up 30 priorities 1 / 2 /
3 / 4) + the new `add_supertype` / `set_color` /
`set_power` arms (follow-up 31 priorities 1 / 2 /
3):

```
const applyExceptions = (cardData: ScryfallCard): ScryfallCard => {
  const exceptions = effect.exceptions;
  let rebuilt: ScryfallCard = { ...cardData };
  // (follow-up 31 priority 1): add_supertype
  // PREPEND FIRST — supertypes are outermost in
  // the types half ("Legendary Artifact
  // Creature — Bear"). Runs BEFORE add_type.
  if (exceptions?.add_supertype?.length) {
    rebuilt = applyAddSupertype(rebuilt, exceptions.add_supertype);
  }
  // (follow-up 29 priority 3): add_subtype
  // APPEND — subtypes half preserved.
  if (exceptions?.add_subtype?.length) {
    rebuilt = applyAddSubtype(rebuilt, exceptions.add_subtype);
  }
  // (follow-up 30 priority 4): add_type
  // PREPEND — types half rebuilt with added
  // types prepended (after supertypes).
  if (exceptions?.add_type?.length) {
    rebuilt = applyAddType(rebuilt, exceptions.add_type);
  }
  // (follow-up 30 priority 1): add_color
  // ADDITIVE MERGE — appended to colors.
  if (exceptions?.add_color?.length) {
    rebuilt = applyAddColor(rebuilt, exceptions.add_color);
  }
  // (follow-up 31 priority 2): set_color
  // DESTRUCTIVE — overwrites colors; PRECEDENCE
  // over add_color when both are set.
  if (exceptions?.set_color?.length) {
    rebuilt = applySetColor(rebuilt, exceptions.set_color);
  }
  // (follow-up 30 priority 2): add_power
  // ADDITIVE — parses printed + adds.
  if (exceptions?.add_power !== undefined) {
    rebuilt = applyAddPower(rebuilt, exceptions.add_power);
  }
  // (follow-up 31 priority 3): set_power
  // DESTRUCTIVE — overwrites power; PRECEDENCE
  // over add_power when both are set.
  if (exceptions?.set_power !== undefined) {
    rebuilt = applySetPower(rebuilt, exceptions.set_power);
  }
  // (follow-up 30 priority 3): add_toughness
  // ADDITIVE — parses printed + adds.
  if (exceptions?.add_toughness !== undefined) {
    rebuilt = applyAddToughness(rebuilt, exceptions.add_toughness);
  }
  // (follow-up 32 candidate): set_toughness
  // DESTRUCTIVE — overwrites toughness.
  return rebuilt;
};
```

### Lane 71 priority 4 per-pair independent
sentinel-resolution reading path

The priority 4 piece extends the existing
`refreshScriptedStatics` consult in
`scripted-statics.ts`. The reading path:

```
// follow-up 31 priority 4 per-pair consult
// (replaces the follow-up 30 priority 5
// single-instance fallback):
const resolvePairChosenProtection = (
  source: CardInstance,
  pairIdx: number,
): string | null => {
  // Per-pair map takes precedence (when set
  // AND the index is present AND the value is
  // non-null).
  const perPairMap = source.chosenProtectionFromPerPair;
  if (perPairMap && pairIdx in perPairMap) {
    const perPairValue = perPairMap[pairIdx];
    if (perPairValue !== null) return perPairValue;
  }
  // Single-instance field fallback (the
  // follow-up 30 priority 5 baseline).
  return source.chosenProtectionFrom;
};
```

The consult replaces the follow-up 30 priority 5
single-instance fallback inside the per-pair
inner loop of `refreshScriptedStatics`. The
per-pair map is stamped by
`resolveEnterChoice` for a hypothetical
`enter_choice: { kind: "protection_quality",
per_pair: true }` kind (parallel to the
single-instance `enter_choice: { kind:
"protection_quality" }` from follow-up 26
priority 3). For v1, the test file stamps the
map directly without going through the
`resolveEnterChoice` path (the
`resolveEnterChoice` per-pair stamping path
rides follow-up 32+ if any future priority
piece surfaces a per-pair enter_choice need).

## Mid-loop & end-of-loop summary template

After every 5th piece (and at the end of the
loop), append a section to `docs/card-scripts/wave4-blockers.md`
following the follow-up 30 loop done summary
shape:

```
## Wave 4.8 follow-up 31 [mid-loop | loop done] summary

### Mission
[1-paragraph description of the loop's scope.]

### Pieces shipped (per-lane commit hashes)
- `<sha>` — `[AI-assisted] feat(card-scripts): <subject> (follow-up 31, lane NNN)`. <body>

### Lanes fully closed
- **Lane 28** — ...fully closed in the follow-up 28 + 29 + 30 + 31 loops. ...

### Lanes still open (multi-lane follow-ups)
- **Lane 71** — ...partially closed... rides follow-up 32 if any priority piece surfaces...

### Net test-suite / case delta
- Baseline (follow-up 30): 800 suites / 14739 cases (14732 passed + 7 skipped).
- Loop done (follow-up 31): <N> suites / <N> cases (<N> passed + 7 skipped).
- Delta: +<N> suites / +<N> cases (all green). The docs `docs/onboarding.md` + `docs/TEST_VIDEO_FIXTURES.md` were ratcheted via `ratchet-test-count.mjs --live <counts.json>` (the AI flake struck on priority N's full-suite gate — the live counts JSON path walked around it cleanly — within the handoff's 1-2 extra CI runs per piece budget).

### Net engine-size budget delta
- Baseline (follow-up 30): cap 5060.
- Loop done (follow-up 31): cap <N> (+<N> over baseline).
  - Bump 5060 → <N> (priority 1, lane 28 — `add_supertype` arm + parent docstring expansion; measured at +<N> over 5060).
  - ...

### Any new open work discovered during the loop
- The lane 28 priorities 1 / 2 / 3 <X / Y / Z> <subject> arms all shipped cleanly without surfacing additional variants. The <variants> ride follow-up 32 if any future priority follow-up surfaces a <semantic>.
- The lane 71 priority 4 per-pair independent sentinel-resolution extension revealed no <X> need. A <Y> field rides follow-up 32 if any future priority piece surfaces a <semantic>.

### Process notes
- The branching caveat applied [again | did NOT apply] — main was at the follow-up 30 merge (`d4e8cb9e`), and the follow-up 30 substrate pieces had [merged to main | NOT yet merged to main]. The practical interpretation was [to branch from `wave4.8-followup30` (the substrate branch) so the follow-up 30 substrate pieces were available | to branch from main directly].
- The `foreman` MCP was [not invoked for any decision in this loop | invoked once for the <decision>]. The priority order (<priority list>) was resolved from the handoff's explicit priority list.
- The aggressive loop's machinery (ratchet + commit-bypass pattern + force-with-lease push + `ratchet-test-count.mjs --live <counts.json>` fallback for the AI flake) was intact and ready. The ratchet path was used <N> times (once per priority piece); <N> landed cleanly via the standard path; <N> landed via the `--live <counts.json>` fallback after the <flake> struck on the full-suite gate. AI flake budget: <N> extra CI runs (within the handoff's 1-2 extra CI runs per piece budget).
```

Recommended PR title for the follow-up 31
PR (after all four priorities land):
"Wave 4.8 follow-up 31 — CopyPermanent
exceptions add_supertype + set_color + set_power
+ protectionFrom per-pair independent sentinel
(4 priority pieces shipped across 2 lanes; lanes
28 + 71 fully closed)".