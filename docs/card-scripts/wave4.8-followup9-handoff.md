# Wave 4.8 follow-up 9 handoff — Next session

## Mission

Continue the Wave 4.8 follow-up loop from where
Wave 4.8 follow-up 8 left off. The follow-up 8 loop
shipped lane 75a (PR #2758), lane 75b (PR #2759),
lane 75c (PR #2760), and lane 75d (PR #2761) — see
`docs/card-scripts/wave4-blockers.md` for the
per-lane summaries and `docs/card-scripts/wave4.8-followup8-handoff.md`
for the prior handoff.

The remaining work, in priority order:

1. **Lane 75e — Nested-copy cycle guard** (the
   meta-rule for the until-EOT copy family). The
   lane 75 v1 explicitly assumes the named target's
   printed `cardData` is the source-of-truth for the
   overlay; nested copies (a target that itself has a
   `become_copy` static) would loop or produce
   inconsistent results. Adds a top-of-pass snapshot
   that captures each card's "effective copy target"
   (the leaf of the copy chain) before any overlay
   runs; overlays consult the snapshot. The
   change-detection diff and the per-card overlay
   read from the snapshot's `cardData`, not from
   in-flight overlays. The cycle guard detects
   cycles in the copy chain (a card whose copy
   chain includes itself) and breaks the cycle by
   treating the cyclic card as if it had no
   `become_copy` arm. ~80-150 LOC + tests. Higher
   risk than the other lanes — touches the order of
   writes in `refreshScriptedStatics` AND
   `refreshAuraBonuses` (lane 75d's overlay
   participates in the same family; the cycle guard
   must cover both refresh sites).

2. **Lane 61 — Replacement effect for death** (Whip of
   Erebos, False Dawn). Foundational replacement-
   effect layer; parked per the Wave 4.8 follow-up 2
   handoff's process note. The engine has no general
   replacement-effect layer, so lane 61 is
   foundational work, not a normal lane. Open it as a
   separate multi-lane plan, NOT as the next lane in
   this loop. The handoff's process rule: the
   aggressive loop picks lanes one at a time, but
   lane 61 is parked because it requires a
   foundational layer that's a separate multi-lane
   plan. After lane 75e ships, this loop is done.

Lane 75e is the only normal-lane in this loop. Lane
61 is parked. Pick the next lane autonomously per
the "Aggressive loop rules" below — don't ask the
user between lanes.

## State at session start

- **HEAD**: this handoff's "pre-loop done summary"
  commit + the lane 75a/75b/75c/75d PR merge commits
  on main (4 squashed PRs across the follow-up 8
  loop).
- **734 → ? suites / 14160 → ? cases** (14153 passed
  - 7 skipped). The Wave 4.8 follow-up 9 loop adds
    to these.
- **Lint 0 errors, typecheck clean** (the previous
  baseline).
- **Engine-size budget**: 3100 lines for `schema.ts`
  (bumped 3000 → 3100 in Wave 4.8 follow-up 8 lane
  75d). Measured 3050 after lane 75d. Lane 75e may
  need another bump if the new schema field pushes
  past 3100 — the historical precedent is "bump the
  budget rather than fragmenting the
  chosen-X / additional-costs / affinity / grants /
  counter-ledger / cast-from-zone / mana-restriction
  / copy-permanent / creature-payment / aura-
  protection / until-eot-copy family." If lane 75e
  is engine-only (no schema change), no bump needed.
- **Bundle-size budget**:
  `config/bundle-budget.json` was re-captured in
  earlier Wave 4.8 loops. Lane 75e is engine-only;
  if the engine surface shrinks (a refresh-write-
  order fix), it doesn't pull into the client
  bundle; if the engine surface grows, re-capture
  the budget in the same commit.
- **Working directory**:
  `/home/alex/Projects/planar-nexus` (clean).
- **Open issues relevant to this loop**: #2614 (the
  full drafter-list plan work — covers the until-EOT-
  copy family + replacement-effect-for-death).
- **Just-shipped context**: lanes 75a/75b/75c/75d
  are merged on main. Lane 75a added a
  `copyUntilEndOfTurn` EffectSchema op +
  `setBySpellEffect` marker (spell-effect-set
  overlays survive every refresh pass; only the
  EOT cleanup drops them). Lane 75b added a
  `named_card` arm on `StaticSchema.become_copy`
  - the `cardDataByName` sync registry helper.
    Lane 75c added an `exceptions.add_subtype` arm
    on both arms + the
    `rebuildTypeLineWithAddedSubtypes` helper.
    Lane 75d added a `become_copy` arm on
    `AuraStaticSchema` + the per-enchanted-card
    `auraCopyOfTargetByEnchantedCard` map in
    `refreshAuraBonuses`. All four lanes share the
    lane 75 `animatedUntilEndOfTurn` +
    `copyOfTargetId` infrastructure for EOT rollback.
    Lane 75e's cycle guard covers all four overlay
    paths (StaticSchema lane 75 + 75b + 75c +
    AuraStaticSchema lane 75d).

## Process (mandatory, identical to Wave 4 / 4.5 / 4.6 /

### 4.7 / 4.7 follow-up / 4.7 phase 2 / 4.8 / 4.8 follow-up /

### 4.8 follow-up 2 / 4.8 follow-up 3 / 4.8 follow-up 4 /

### 4.8 follow-up 5 / 4.8 follow-up 6 / 4.8 follow-up 7 /

### 4.8 follow-up 8)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
/tmp/opencode/wave414-lane<N>-<slug> -b
<type>/<scope> origin/main` where `<N>` starts at
   82 and `<slug>` is kebab-case, min 10 chars.
   `ln -s /home/alex/Projects/planar-nexus/node_modules
/tmp/opencode/wave414-lane<N>-<slug>/node_modules`
   so test/lint/typecheck skip a fresh install.
   Verify with `ls
/tmp/opencode/wave414-lane<N>-<slug>/node_modules/.bin/jest`.
   Note: the symlinked `node_modules` will fail
   `npm run build` (Turbopack errors on the
   `node_modules` symlink pointing outside the
   worktree root). The bundle-size budget re-capture
   requires a real build, so when a lane grows the
   engine surface that the client bundle pulls in
   (e.g. lane 66 in the Wave 4.8 follow-up 4 loop),
   `rm` the symlink and run `npm ci` first to do the
   build.

2. **Scope discipline**: each lane is one
   self-contained change. Schema + engine + sample
   card + dedicated test is fine. **Don't** ship a
   second sample card for a different pattern,
   **don't** refactor unrelated plumbing, **don't**
   partial-port a multi-card block. If the lane
   grows past one schema arm + one engine arm + one
   card, back out, document the reason in
   `wave4-blockers.md`, and pick a smaller next lane.

3. **Implement**: schema → engine → sample card →
   dedicated test → ratchet.

   - **Schema**:
     `src/lib/game-state/card-scripts/schema.ts` is
     the one place for new fields. For each lane,
     follow the existing allow-list pattern. New
     fields should integrate into the chosen-X /
     additional-costs / affinity / grants /
     counter-ledger / cast-from-zone /
     mana-restriction / copy-permanent /
     creature-payment / aura-protection /
     until-eot-copy family when possible.
     Lane 75e's schema surface is small: the
     cycle-guard logic lives mostly in
     `refreshScriptedStatics` (and lane 75d's
     mirror path in `refreshAuraBonuses`); a
     schema change is only needed if the lane
     introduces a new field, which is unlikely.
     If no schema change, skip the
     `schema.ts` arm of this step.
   - **Engine**: the right home depends on the
     arm. For until-EOT-copy arms, update
     `refreshScriptedStatics` (lane 75 + 75b +
     75c) AND `refreshAuraBonuses` (lane 75d)
     AND `turn-phases.ts` for the end-of-turn
     cleanup. Lane 75e's snapshot lives at the
     top of `refreshScriptedStatics` AND at the
     top of the `refreshAuraBonuses` write phase
     (the cycle guard must cover both refresh
     sites; a copy chain can traverse both
     static-driven and aura-driven overlays).
   - **Sample card**: ship one real card JSON per
     lane when the handoff lists one. Otherwise use
     a synthetic registered via the test harness.
   - **Tests**: dedicated `*.test.ts` file per
     lane, colocated in `src/lib/game-state/__tests__/`.

4. **Run checks (in the worktree)**:

   - `PATH="$PWD/node_modules/.bin:$PATH" npx tsx
 scripts/build-card-script-index.ts`
   - `PATH="$PWD/node_modules/.bin:$PATH" npm test
 --silent` (full suite — must be all green; the
     AI `forge-gate`/`forge-selfplay`/
     `expert-agent` "is deterministic for a seed"
     flake is known — re-run once if it hits, then
     move on).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
 typecheck` (must be clean).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
 lint` (0 errors; warnings OK).
   - `PATH="$PWD/node_modules/.bin:$PATH" node
 scripts/check-engine-size-budget.mjs` (must
     pass; budget currently 3100 lines for
     `schema.ts`, measured 3050 after lane 75d).
     Bump the budget rather than fragmenting the
     chosen-X / additional-costs / affinity / grants
     / counter-ledger / cast-from-zone /
     mana-restriction / copy-permanent /
     creature-payment / aura-protection /
     until-eot-copy family.
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
 ratchet:test-count` (rewrites anchored doc
     blocks when test count changes).
   - **Bundle-size check (only when the lane grows
     the engine surface that the client bundle
     pulls in)**: `rm node_modules` (the symlink)
     and `npm ci`, then `npm run build`, then `node
 scripts/check-bundle-budget.mjs --check`. If
     the lane grew the engine and the bundle check
     fails, re-capture the budget: `node
 scripts/check-bundle-budget.mjs --capture` and
     commit the updated `config/bundle-budget.json`
     alongside the lane's other changes.

5. **Commit**: `git add -A && GIT_AUTHOR_NAME="Planar
Nexus Agent" GIT_AUTHOR_EMAIL="agent@planar-nexus.local"
GIT_COMMITTER_NAME="Planar Nexus Agent"
GIT_COMMITTER_EMAIL="agent@planar-nexus.local" git
commit -F COMMIT_MSG.txt`. Then `git rm --cached
COMMIT_MSG.txt && GIT_AUTHOR_NAME="Planar Nexus Agent"
GIT_AUTHOR_EMAIL="agent@planar-nexus.local"
GIT_COMMITTER_NAME="Planar Nexus Agent"
GIT_COMMITTER_EMAIL="agent@planar-nexus.local" git
commit --amend --no-edit && rm COMMIT_MSG.txt`.
   Then `git push --force-with-lease origin <branch>`.
   The Wave 4.8 follow-up 5 process learned: `git
commit` without the env vars picks up the husky
   global git config and the commit shows up under the
   wrong author. Use the env vars explicitly, on every
   `git commit` (and on every `git commit --amend`).

6. **Open PR**: write `PR_BODY.txt` AFTER the commit
   (this is the cleaner pattern — see the Wave 4.8
   follow-up 3 process note). Then `gh pr create
--title "<type>(<scope>): <one-line>" --body-file
PR_BODY.txt --base main --head <branch>`. Then
   `gh pr merge <PR> --squash --delete-branch --admin`
   once checks pass. **Do not** `git add PR_BODY.txt` —
   writing the file post-commit avoids the amend
   `git rm --cached` step for that file. The
   commitlint subject is enforced as lower-case; the
   commit subject MUST be lower-case.

7. **Conflict resolution (if main moves during the
   lane)**: `git merge origin/main --no-edit` then
   resolve any conflicts (the most common is the
   test-count doc drift between main and your
   branch). For the test-count block: keep the higher
   values (the lane's contribution adds cases, so
   main's value will be lower or equal). Then `npm
run ratchet:test-count` to confirm. Force-push and
   re-wait CI.

8. **Cleanup**: exit the worktree directory, then
   `git worktree remove
/tmp/opencode/wave414-lane<N>-<slug> --force && git
branch -D <branch>`.

## Conventions (carried from prior loops)

- **Branch**: `<type>/<scope>` (lowercase,
  kebab-case, min 10 chars). `<scope>` is the lane's
  punchy name (e.g. `nested-copy-cycle-guard` for
  lane 75e).
- **Commit subject**: lower-case, min 10 chars, type
  from `feat fix docs style refactor test chore
 revert`. Wave 4.8 saw `header-case` linting on
  commitlint — lowercase is enforced; write the
  subject in lowercase from the start.
- **Reference #2614 follow-up** in the commit body
  and the PR body so the cross-references stay tight.
  For lane 75e, reference the until-eot-copy
  family + #2614.
- **Conventional Commits**. Never check in
  `COMMIT_MSG.txt` (amend-rm before pushing) or
  `PR_BODY.txt` (write it AFTER the commit, per the
  Wave 4.8 follow-up 3 process note).
- **Test count**: ratchet in the same commit as any
  test count change, before pushing.
  `test-count-docs-guard` re-measures live Jest and
  fails on any drift in `docs/onboarding.md` or
  `docs/TEST_VIDEO_FIXTURES.md`.
- **Engine-size budget**: 3100 lines for `schema.ts`
  (the Wave 4.8 follow-up 8 lane 75d bump). Lane
  75e should fit under 3100 individually (lane
  75e is engine-only; no schema change expected).
  If the schema grows past 3100, bump the budget
  in the SAME commit per the Wave 4.8 follow-up
  handoff's process note. Update the docstring
  block in `scripts/check-engine-size-budget.mjs`
  with a one-paragraph history entry (the existing
  entries are a good template).
- **Bundle-size budget**: lane 75e is engine-only;
  no client-bundle re-capture expected. If the
  lane does grow the engine surface, re-capture
  the budget in the same commit (see Process
  step 4).
- **Pre-commit hook** runs `eslint --fix` →
  `tsc --noEmit` → `prettier --write` on staged
  *.{ts,tsx,md,json,...}. A failing typecheck blocks
  the commit; run typecheck before staging. If `tsc
 --noEmit` passes locally but CI fails with `Cannot
 find name`, the husky pre-commit hook's local
  typecheck can pass while CI's `tsc --noEmit` flags a
  missing import — always cross-check imports before
  pushing.
- **Markdown gets prettier'd**; keep diffs small and
  don't fight the formatter. Note: the husky
  pre-commit hook runs prettier on staged
  `*.{ts,tsx,md,json,...}` files; if you write a
  `COMMIT_MSG.txt` and stage it, the prettier pass
  may delete the file. Write the commit message
  to a file, stage the changes, commit using
  `git commit -F COMMIT_MSG.txt`, then `git rm
 --cached COMMIT_MSG.txt` and amend.

## Aggressive loop rules

- **Don't ask the user between lanes.** Pick the
  next gap autonomously and ship it. The two-lane
  agenda (75e alone) is small: ship lane 75e as
  one well-scoped PR, write the loop done summary,
  then this loop is done.
- **Don't ship multi-lane work in one PR.** If a
  lane reveals a second pattern that also needs
  new schema, split it into a follow-up lane and
  put a paragraph in `wave4-blockers.md` documenting
  why.
- **Lane is "done"** only when: CI green, PR merged,
  worktree removed, branch deleted, local main
  pulled and re-ratcheted.
- **If CI fails on a lane**: don't push; fix the
  lane. If the fix is unclear, document the failure
  in `docs/card-scripts/wave4-blockers.md` and skip
  to the next lane. The AI
  `forge-gate`/`forge-selfplay`/`expert-agent` "is
  deterministic for a seed" test is a known
  order-dependent flake on main; if a CI run shows
  only that test failing, `gh run rerun --failed` is
  the right move (do NOT amend the lane). Wave 4.8
  saw this at lane 60 + 62; Wave 4.8 follow-up saw
  this at lane 56; Wave 4.8 follow-up 6 hit this
  flake ONCE on lane 72's local full-suite run;
  Wave 4.8 follow-up 7 did not hit it on this loop's
  local run (CI was clean throughout); Wave 4.8
  follow-up 8 hit it locally on lanes 75b + 75c + 75d
  but the all-passing CI baseline (14153 passed on
  lane 75d, 14147 on lane 75c, 14138 on lane 75b,
  14128 on lane 75) is documented in `wave4-blockers.md`
  — use those values when the ratchet hits the
  flake mid-run. Budget for 1-2 extra CI runs per
  lane to absorb the flake.
- **Turn budget: 40 turns per lane max** (per
  `AGENTS.md` §Turn Budget). If a single lane exceeds
  this, it's too big — back out, document, and pick a
  smaller one. Lane 75e is the riskiest of the
  follow-up lanes because it touches the order of
  writes in `refreshScriptedStatics` AND
  `refreshAuraBonuses`; consider deferring it if a
  lane exceeds the budget.
- **Multi-lane deferrals**: if a lane reveals a
  second pattern that needs new schema, split it
  into a follow-up lane. Put a paragraph in
  `wave4-blockers.md` documenting why. Don't ship
  multi-lane work in one PR.

## Done definition for the loop

When lane 75e is either shipped or marked
multi-lane blocker (with a paragraph in
`wave4-blockers.md` documenting why), append a Wave
4.8 follow-up 9 loop done summary at the bottom of
`docs/card-scripts/wave4-blockers.md` documenting the
shipped lanes, the blocked gaps with their #2614 plan
work references, and a fresh test-count snapshot.
Then stop.

This loop covers lane 75e alone (lane 61 is parked;
it requires a foundational replacement-effect layer
that doesn't exist yet).

If lane 75e (the smallest prerequisite) is blocked,
that means the engine changed since Wave 4.8 follow-
up 8 and the loop should be paused for human review
before continuing.

Lane 61 (replacement effect for death) is parked;
it requires a foundational replacement-effect layer
that doesn't exist yet. Per the prior handoff's
process note, lane 61 is NOT the next lane in this
loop. Open a separate multi-lane plan for lane 61
when ready.

## Process observations carried from previous loops

- The AI `forge-gate`/`forge-selfplay`/
  `expert-agent` "is deterministic for a seed" test
  is a known order-dependent flake on main. If a CI
  run shows only that test failing, `gh run rerun
--failed` is the right move — do NOT amend the
  lane. Wave 4.8 saw this at lane 54 + 55; Wave 4.8
  follow-up saw this at lane 56; Wave 4.8
  follow-up 6 hit this flake ONCE on lane 72's
  local full-suite run; Wave 4.8 follow-up 7 did not
  hit it on this loop's local run; Wave 4.8 follow-
  up 8 hit it locally on lanes 75b + 75c + 75d but
  CI's all-passing baselines (14153/14147/14138/
  14128 passed respectively) are documented in
  `wave4-blockers.md` — use those values when the
  ratchet hits the flake mid-run. Budget for 1-2
  extra CI runs per lane to absorb the flake.
- `ci-wait` can return `FAILED` on a freshly-opened
  PR with all checks still pending. Wait a second
  call to `ci-wait` to get a real verdict. (`sleep
60 && gh pr checks <PR>` is a good way to seed the
  API.)
- `npm run ratchet:test-count` is reliable; run it
  in the same commit as any test count change.
- The handoff's process rule on `git worktree
remove`: the `--delete-branch` flag on `gh pr
merge` only deletes the remote branch. The local
  worktree directory must be removed manually after
  exiting it (`git worktree remove ... && git branch
-D ...`).
- Wave 4.8 lane 55 process observation: `git commit`
  without `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env
  vars picks up the husky global git config and the
  commit shows up under the wrong author. Use the
  env vars explicitly, on every `git commit` (and on
  every `git commit --amend`).
- Wave 4.8 follow-up 6 process observation: when
  the `npm run ratchet:test-count` script times out
  (or fails because of the AI flake mid-ratchet),
  the `--live <counts.json>` fallback at
  `scripts/ratchet-test-count.mjs` skips the live
  Jest run and uses a hand-built JSON. Used in
  Wave 4.8 follow-up 8 lanes 75b/75c/75d — the
  same fallback is acceptable here.
- Wave 4.8 follow-up 6 process observation: when
  merging a lane that adds tests, the
  `test-count-docs-guard` CI gate may show a
  conflict in the ratcheted test count block (the
  just-merged previous lane's number is lower than
  the current lane's). The resolution is to keep
  the higher value and re-run the ratchet on the
  merged branch.
- Wave 4.8 follow-up 5 process observation: when
  adding a new op on `EffectSchema` (e.g. lane 70's
  `CopyPermanent`), the per-op reference module
  under `src/lib/game-state/card-scripts/ops/` and
  the entry in `src/lib/game-state/card-scripts/ops/registry.ts`
  are required to keep the LLM-drafted scripts
  pipeline in sync. The `covers every op the schema
accepts` test enforces parity — without the
  per-op module + registry entry, the test fails
  and the engine doesn't know about the new op.
  Lane 75e doesn't add an EffectSchema op, so this
  doesn't apply.
- Wave 4.8 follow-up 6 process observation: when
  adding a new meta-static arm on `StaticSchema`
  (e.g. lane 76's `AuraStaticSchema.protectionFrom`),
  the refine list at the bottom of `AuraStaticSchema`
  must be extended to accept the new arm as a
  stand-alone static. Synthetic test scripts that
  use the new arm alone (without any other ability)
  parse only if the arm is in the refine list. Lane
  75d added `become_copy` to `AuraStaticSchema`'s
  refine list — lane 75e's cycle guard does NOT
  modify the refine list (it's engine-only).
- **Wave 4.8 follow-up 7 process observation
  (lane 75)**: type-check caught an `if (zone)`
  narrowing guard pattern in the test file that
  the local `tsc --noEmit` happened to pass on but
  CI's `tsc --noEmit` flagged — the test file used
  `movedZones.get(gyKey) ?? { visibility: ... }` as
  a fallback and the spread `{ ...gy }` propagated
  the union type. The fix was to `if (gy) {
movedZones.set(...) }` to narrow the type. **Lesson:
  never fall back to a hand-shaped zone literal when
  `state.zones` is well-typed — `if (zone)` is the
  safe pattern.** If you see a TS2345 type error
  locally but CI passes, run `tsc --noEmit` again
  with `--pretty false` and look for the union type
  propagation.
- **Wave 4.8 follow-up 8 process observation
  (lane 75a)**: a typed `animatedUntilEndOfTurn:
boolean` field signature was added to
  `CardInstance` so the EOT cleanup rollback can
  distinguish "spell-effect-set overlay" (set via
  `CopyUntilEndOfTurn`'s `become_copy` op) from
  "static-driven overlay" (set via lane 75's
  `StaticSchema.become_copy` static). The refresh
  pass preserves spell-effect-set overlays across
  passes; only the EOT cleanup drops them.
  Lane 75e's cycle guard inherits this distinction
  — the snapshot must capture both the static-
  driven overlay (`copyOfTargetBySourceId` + the
  per-arm `become_copy`) AND the spell-effect-set
  overlay (the `setBySpellEffect` marker on
  `animatedUntilEndOfUntil`).
- **Wave 4.8 follow-up 8 process observation
  (lane 75b)**: the test file used an
  `animatedUntilEndOfUntil` field name with an extra
  trailing `I` (typo). The field on the card is
  `animatedUntilEndOfTurn` (full `n`). **Lesson:
  spell-check field names against the type
  definition in `src/lib/game-state/types/cards.ts`
  before writing the assertion.** Wave 4.8 follow-
  up 8 lane 75d had the same typo and was fixed via
  bulk `sed -i` in
  `src/lib/game-state/keyword-actions/aura-bonus.ts`.
- **Wave 4.8 follow-up 8 process observation
  (lane 75d)**: the engine change to
  `refreshAuraBonuses` introduced a new
  `auraCopyOfTargetByEnchantedCard: Map<enchantedCardId,
{ kind: "id"; targetId; fromAura }>` map for
  the lane 75d overlay. Lane 75e's cycle guard
  must traverse this map alongside the
  `refreshScriptedStatics`'s `copyOfTargetBySourceId`
  map so that a copy chain that crosses both
  static-driven and aura-driven overlays is
  resolved consistently (no infinite loop, no
  inconsistent overlay).
- **Wave 4.8 follow-up 8 process observation
  (lane 75b/75c/75d)**: every time the ratchet
  hits the `forge-gate` mid-run flake, the docs
  were updated by hand to match CI's all-passing
  baseline (`wave4-blockers.md` keeps a running
  tally of the CI baselines per lane — use those
  values when the ratchet times out). For lane 75d
  the running baseline is 14153 passed out of
  14160 total; the loop's "all-passing" baseline
  for lane 75e will be one more case higher.

## Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any leftover from Wave 4.8 follow-up 8)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 734 / 14160 green
# then start lane 75e (nested-copy cycle guard, #2614 follow-up) per the Process section
```

End each lane with: `git log --oneline -1` on main
showing the new lane's commit, and `grep "Test suites"
docs/onboarding.md` showing the bumped numbers. If
those two checks pass, you're ready to write the
loop done summary (no further lane to ship) and stop.

## Notes on the engine surface for lane 75e (nested-copy cycle guard)

When implementing lane 75e, the engine change is in
`refreshScriptedStatics`: at the top of the pass, take
a snapshot of each card's "effective copy target" (the
leaf of the copy chain — recursively walking each
card's `become_copy.target` until a card with no
`become_copy` arm is reached). The overlays and the
change-detection diff consult the snapshot's
`cardData`, not from in-flight overlays. The
change-detection diff and the per-card overlay
read from the snapshot's `cardData`, not from
in-flight overlays. The cycle guard detects
cycles in the copy chain (a card whose copy chain
includes itself) and breaks the cycle by
treating the cyclic card as if it had no
`become_copy` arm.

The cycle guard must also cover the lane 75d
Aura-shaped path (`refreshAuraBonuses`'s
`auraCopyOfTargetByEnchantedCard` map) — a copy
chain can traverse both static-driven and
aura-driven overlays (e.g. a `become_copy` static
on a permanent whose chosen target is itself
enchanted by an Aura with a `become_copy` arm;
Memnarch naming a card that's not in play is the
named-card variant, but the chosen-target variant
on a chosen Aura-enchanted target exercises the
cross-refresh-site copy chain).

Lane 75e's snapshot+cycle-guard logic lives in TWO
places: at the top of `refreshScriptedStatics`'s
write phase and at the top of
`refreshAuraBonuses`'s write phase. The simpler v1:
factor out a helper `resolveCopyChain(id, state,
visited?: Set<string>): { leafId, cycle }` that
resolves the leaf of the copy chain, returning
the cyclic-id-set for cycle detection. The helper
walks: `state.cards.get(id).copyOfTargetId` (or
the per-arm registry equivalent) → the next
target's `copyOfTargetId` → ... → leaf (no
`become_copy` arm) or cycle (a node revisited).
The helper consults the PRINTED `cardData` (the
original `cardData`, not the in-flight overlay),
which is what the handoff's "consults the
snapshot's `cardData`, not from in-flight
overlays" point guarantees.

The smallest sample card is a pair of synthetic
statics — one source that copies a target, and a
target that itself has a `become_copy` arm pointing
at a third card. The test verifies that the chain
resolves consistently (no infinite loop, no
inconsistent overlay) and that a cyclic copy
chain (a card whose copy chain includes itself) is
broken at the cycle (the cyclic card is treated as
if it had no `become_copy` arm).

Out of scope for lane 75e (each a follow-up lane):
multi-card copy chains (more than 3 cards), cycles
in `refreshAuraBonuses`'s `become_copy` arm
(parallel to the static arm), cross-zones copy
chains (e.g. a `become_copy` static that points at
a card in a graveyard — CR 707.2's "copy a card
that's not in play" — also called "outside-the-
battlefield" copies), and "copy a card that has a
`become_copy` static and other layers" (e.g. a
copy target with `protectionFrom` or
`removesAllAbilities`).
