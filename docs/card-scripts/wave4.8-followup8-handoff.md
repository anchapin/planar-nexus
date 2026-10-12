# Wave 4.8 follow-up 8 handoff — Next session

## Mission

Continue the Wave 4.8 follow-up loop from where Wave 4.8
follow-up 7 left off. The follow-up 7 loop shipped lane 75
(PR #2757 — see `docs/card-scripts/wave4-blockers.md` for
the done summary and `docs/card-scripts/wave4.8-followup7-handoff.md`
for the prior handoff).

The remaining work, in priority order:

1. **Lane 75a — Chosen-target copy** (Cackling
   Counterpart). "Create a token that's a copy of [a
   chosen permanent] until end of turn" — a
   `chosen_permanent` field the engine resolves at
   resolution time. v1 supports a single chosen target
   - "all characteristics copied" semantics with a
     turn-key duration. The engine flow:
     `resolveWaitingChoice` arms a new
     `choose_permanent` waitingChoice; the player picks
     a permanent on the battlefield; `resolveChosenCopy`
     stamps the chosen target's `CardInstanceId` on the
     token (or source); `refreshScriptedStatics` does the
     overlay. ~150-250 LOC + tests. The smallest scoped
     piece of the chosen-X / copy family — picks the
     chosen target up at resolution time and reuses the
     lane 75 `animatedUntilEndOfTurn` overlay path.

2. **Lane 75b — Named-card copy** ("Becomes a copy of
   [card name]"). Adds a `named_card: { name: string }`
   arm to the `become_copy` schema; the engine reads
   the named card's `cardData` from the registry (a
   Scryfall-shape lookup) and overlays the same
   characteristics lane 75 already supports. v1 single
   named card (no `card_name_2` riders); multi-named
   copies (e.g. "becomes a copy of [card name] or
   [other card name]") are a follow-up lane. ~100-200
   LOC + tests. The engine change is mostly on the
   schema's `named_card` arm + the registry lookup in
   `refreshScriptedStatics`; the overlay + cleanup
   path reuses lane 75's.

3. **Lane 75c — Copy with exception** (Phyrexian
   Metamorph). "Becomes a copy of [chosen permanent]
   except it's a [named card] in addition to its
   other types" or "[chosen permanent] except for its
   [X]." Adds an `exceptions: { add_type?:
string[], add_subtype?: string[], ... }` arm to the
   `become_copy` schema. v1 supports a single
   `add_subtype` (the Phyrexian Metamorph pattern);
   multi-exception copies are a follow-up lane.
   ~100-200 LOC + tests. The engine change is in
   `refreshScriptedStatics`: after the overlay, merge
   the exception list onto the source's
   `cardData.subtypes` (or other fields).

4. **Lane 75d — Aura-shaped copy** ("Enchanted
   creature is a copy of [a chosen permanent] until
   end of turn"). The per-target variant of lane 75.
   Adds a `become_copy` arm to `AuraStaticSchema`
   (parallel to lane 76's `protectionFrom` /
   AuraStaticSchema pattern). The engine stamps the
   chosen target's characteristics on the enchanted
   card via `refreshAuraBonuses` (parallel to the lane
   65 `grantedTriggers` / lane 71 per-instance pattern).
   ~100-200 LOC + tests. Same overlay + cleanup
   pattern as lane 75.

5. **Lane 75e — Nested-copy cycle guard** (the
   meta-rule for the until-EOT copy family). The lane
   75 v1 explicitly assumes the named target's
   printed `cardData` is the source-of-truth for the
   overlay; nested copies (a target that itself has a
   `become_copy` static) would loop or produce
   inconsistent results. Adds a top-of-pass snapshot
   that captures each card's "effective copy target"
   (the leaf of the copy chain) before any overlay
   runs; overlays consult the snapshot. The
   change-detection diff and the per-card overlay
   read from the snapshot's `cardData`, not from
   in-flight overlays. ~80-150 LOC + tests. Higher
   risk than the other lanes — touches the order of
   writes in `refreshScriptedStatics`.

6. **Lane 61 — Replacement effect for death** (Whip of
   Erebos, False Dawn). Foundational replacement-
   effect layer; parked per the Wave 4.8 follow-up 2
   handoff's process note. The engine has no general
   replacement-effect layer, so lane 61 is
   foundational work, not a normal lane. Open it as a
   separate multi-lane plan, not as the next lane in
   this loop.

Lanes 75a / 75b / 75c / 75d / 75e are independent
multi-lane pieces, each shipping its own v1 minimum.
Lane 61 is parked. Pick the next lane autonomously per
the "Aggressive loop rules" below — don't ask the user
between lanes.

## Priority lanes (in order)

The follow-up work, in priority order:

1. **Lane 75a — Chosen-target copy** (Cackling
   Counterpart). The smallest scoped piece after lane
   75 itself: a new `chosen_permanent: CardInstanceId`
   arm on a new `SpellEffectSchema.copyUntilEndOfTurn`
   op (parallel to lane 70's `CopyPermanent`). The
   op arms a `choose_permanent` waitingChoice pointing
   at any permanent on the battlefield; the resolver
   stamps the chosen target on the new permanent (the
   cast creates a token that's a copy, OR an existing
   permanent becomes a copy — both shapes are
   supported; v1 minimum is the cast-a-creates-a-copy
   shape, parallel to lane 70). The new permanent's
   `cardData` is overlaid with the chosen target's via
   the lane 75 `animatedUntilEndOfTurn` infrastructure;
   the cleanup is the same EOT path. v1 single chosen
   target, "all characteristics copied" semantics
   with a turn-key duration. Multi-target copies are a
   separate follow-up lane.
2. **Lane 75b — Named-card copy** ("Becomes a copy of
   [card name]"). Adds a `named_card: { name: string }`
   arm to `StaticSchema.become_copy`; the engine reads
   the named card's `cardData` from the card-scripts
   registry (or a Scryfall lookup) and applies the
   same overlay path lane 75 already supports.
3. **Lane 75c — Copy with exception** (Phyrexian
   Metamorph). Adds an `exceptions` arm to
   `StaticSchema.become_copy`; the engine merges the
   exception list onto the overlaid `cardData`
   (subtypes, colors, etc.) after the lane 75 overlay.
4. **Lane 75d — Aura-shaped copy**. Adds a
   `become_copy` arm to `AuraStaticSchema`; the engine
   stamps the overlay on the enchanted card via
   `refreshAuraBonuses` (parallel to lane 76).
5. **Lane 75e — Nested-copy cycle guard**. Top-of-pass
   snapshot of each card's effective copy target so
   nested copies don't loop.
6. **Lane 61 — Replacement effect for death**. Parked;
   requires foundational replacement-effect layer.

Lanes 75a–75e are the only normal-lanes in this loop.
The until-EOT copy family is the bulk of the remaining
#2614 drafter-list work.

## State at session start

- **HEAD**: `12b3d7e0` (Wave 4.8 follow-up 7 done
  summary + the lane 75 squash-merge commit).
- **730 → ? suites / 14127 → ? cases** (14120 passed
  - 7 skipped). The Wave 4.8 follow-up 8 loop adds
    to these.
- **Lint 0 errors, typecheck clean** (the previous
  baseline).
- **Engine-size budget**: 2800 lines for `schema.ts`
  (bumped 2750 → 2800 in Wave 4.8 follow-up 7 lane
  75). Measured 2790 after lane 75. Lanes 75a–75e
  may each need another bump if the new schema field
  pushes past 2800 — the historical precedent is
  "bump the budget rather than fragmenting the
  chosen-X / additional-costs / affinity / grants /
  counter-ledger / cast-from-zone / mana-restriction
  / copy-permanent / creature-payment / aura-
  protection / until-eot-copy family."
- **Bundle-size budget**:
  `config/bundle-budget.json` was re-captured in
  Wave 4.8 follow-up 4 lane 66 (the engine additions
  grew the `/replay` route and a handful of other
  game routes). Lanes 75a–75e may grow the engine
  surface further; if a lane's changes pull into
  the client bundle, re-capture the budget in the
  same commit.
- **Working directory**:
  `/home/alex/Projects/planar-nexus` (clean).
- **Open issues relevant to this loop**: #2614 (the
  full drafter-list plan work — covers the until-EOT-
  copy family + replacement-effect-for-death).
- **Just-shipped context**: PR #2757 is merged on
  main (lane 75 — the basic until-EOT copy schema +
  engine arm). Lane 75 added a
  `StaticSchema.become_copy: { target: CardInstanceId,
until: "end_of_turn" }` arm and a per-instance
  `CardInstance.copyOfTargetId?: string` ledger. The
  engine overlay lives in `refreshScriptedStatics`
  and reuses the existing `animatedUntilEndOfTurn`
  infrastructure (parallel to lane 66's
  `embedded_static` token stamping). The
  `clearUntilEndOfTurnPT` /
  `restoreAnimatedOffBattlefield` rollback path
  handles EOT cleanup automatically. The static is
  self-only (parallel to lane 52's
  `add_creature_type` self-only semantics). 9-case
  dedicated test (`lane75-until-eot-copy.test.ts`)
  covers schema rejection, schema acceptance,
  characteristic overlay (Grizzly Bears copy),
  keyword copy (Serra Angel flying / vigilance),
  missing-target no-op, target-leaves-battlefield
  rollback, EOT cleanup rollback, and self-only
  semantics.

## Process (mandatory, identical to Wave 4 / 4.5 / 4.6 /

### 4.7 / 4.7 follow-up / 4.7 phase 2 / 4.8 / 4.8 follow-up /

### 4.8 follow-up 2 / 4.8 follow-up 3 / 4.8 follow-up 4 /

### 4.8 follow-up 5 / 4.8 follow-up 6 / 4.8 follow-up 7)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
 /tmp/opencode/wave414-lane<N>-<slug> -b
 <type>/<scope> origin/main` where `<N>` starts at
   78 and `<slug>` is kebab-case, min 10 chars.
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
- **Engine**: the right home depends on the arm.
  For until-EOT-copy arms (lanes 75a–75e), update
  `refreshScriptedStatics` for the stamp AND
  `refreshAuraBonuses` for the aura variant AND
  `turn-phases.ts` for the end-of-turn cleanup.
- **Sample card**: ship one real card JSON per
  lane when the handoff lists one. Otherwise use
  a synthetic registered via the test harness.
- **Tests**: dedicated `*.test.ts` file per lane,
  colocated in `src/lib/game-state/__tests__/`.

4. **Run checks (in the worktree)**:

- `PATH="$PWD/node_modules/.bin:$PATH" npx tsx
 scripts/build-card-script-index.ts`
- `PATH="$PWD/node_modules/.bin:$PATH" npm test
 --silent` (full suite — must be all green; the
  AI `forge-gate`/`forge-selfplay`/`expert-agent`
  "is deterministic for a seed" flake is known —
  re-run once if it hits, then move on).
- `PATH="$PWD/node_modules/.bin:$PATH" npm run
 typecheck` (must be clean).
- `PATH="$PWD/node_modules/.bin:$PATH" npm run
 lint` (0 errors; warnings OK).
- `PATH="$PWD/node_modules/.bin:$PATH" node
 scripts/check-engine-size-budget.mjs` (must
  pass; budget currently 2800 lines for
  `schema.ts`, measured 2790 after lane 75). Bump
  the budget rather than fragmenting the
  chosen-X / additional-costs / affinity / grants /
  counter-ledger / cast-from-zone /
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
  punchy name (e.g. `until-eot-chosen-target` for
  lane 75a).
- **Commit subject**: lower-case, min 10 chars, type
  from `feat fix docs style refactor test chore
 revert`. Wave 4.8 saw `header-case` linting on
  commitlint — lowercase is enforced; write the
  subject in lowercase from the start.
- **Reference #2614 follow-up** in the commit body
  and the PR body so the cross-references stay tight.
  For lanes 75a–75e, reference the until-eot-copy
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
- **Engine-size budget**: 2800 lines for `schema.ts`
  (the Wave 4.8 follow-up 7 lane 75 bump). Lanes
  75a–75e should fit under 2800 individually
  (each new field is small); if the schema grows
  past 2800, bump the budget in the SAME commit per
  the Wave 4.8 follow-up handoff's process note.
  Update the docstring block in
  `scripts/check-engine-size-budget.mjs` with a
  one-paragraph history entry (the existing entries
  are a good template).
- **Bundle-size budget**: the Wave 4.8 follow-up 4
  lane 66 re-captured `config/bundle-budget.json`
  after growing the engine surface. Lanes 75a–75e
  may grow the engine surface further; if a lane's
  changes pull into the client bundle, re-capture
  the budget in the same commit (see Process
  step 4).
- **Pre-commit hook** runs `eslint --fix` →
  `tsc --noEmit` → `prettier --write` on staged
  *.{ts,tsx,md,json,...}. A failing typecheck blocks
  the commit; run typecheck before staging. If `tsc
 --noEmit` passes locally but CI fails with `Cannot
 find name`, the husky pre-commit hook's local
  typecheck can pass while CI's typecheck flags a
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
  next gap autonomously and ship it.
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
  local run (CI was clean throughout). Budget for
  1-2 extra CI runs per lane to absorb the flake.
- **Turn budget: 40 turns per lane max** (per
  `AGENTS.md` §Turn Budget). If a single lane exceeds
  this, it's too big — back out, document, and pick a
  smaller one. Lane 75e (nested-copy cycle guard) is
  the riskiest of the five follow-up lanes because it
  touches the order of writes in
  `refreshScriptedStatics`; consider deferring it
  if a lane exceeds the budget.
- **Multi-lane deferrals**: if a lane reveals a
  second pattern that needs new schema, split it
  into a follow-up lane. Put a paragraph in
  `wave4-blockers.md` documenting why. Don't ship
  multi-lane work in one PR.

## Done definition for the loop

When all five priority lanes (75a, 75b, 75c, 75d, 75e)
are either shipped or marked multi-lane blockers
(with a paragraph in `wave4-blockers.md` documenting
why), append a Wave 4.8 follow-up 8 loop done summary
at the bottom of `docs/card-scripts/wave4-blockers.md`
documenting the shipped lanes, the blocked gaps with
their #2614 plan work references, and a fresh test-
count snapshot. Then stop.

If even lane 75a (the smallest prerequisite) is
blocked, that means the engine changed since Wave 4.8
follow-up 7 and the loop should be paused for human
review before continuing.

Lane 61 (replacement effect for death) is parked; it
requires a foundational replacement-effect layer that
doesn't exist yet.

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
  hit it on this loop's local run. Budget for 1-2
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
  Jest run and uses a hand-built JSON.
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
- Wave 4.8 follow-up 6 process observation: when
  adding a new meta-static arm on `StaticSchema`
  (e.g. lane 76's `AuraStaticSchema.protectionFrom`),
  the refine list at the bottom of `AuraStaticSchema`
  must be extended to accept the new arm as a
  stand-alone static. Synthetic test scripts that
  use the new arm alone (without any other ability)
  parse only if the arm is in the refine list.
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

## Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any leftover from Wave 4.8 follow-up 7)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 730 / 14127 green
# then start lane 75a (chosen-target copy, #2614 follow-up) per the Process section
```

End each lane with: `git log --oneline -1` on main
showing the new lane's commit, and `grep "Test suites"
docs/onboarding.md` showing the bumped numbers. If
those two checks pass, you're ready for the next lane
immediately.

## Notes on the engine surface for lane 75a (chosen-target copy)

When implementing lane 75a, the engine-side changes
are in `effect-resolution.ts` (a new `resolveScriptedAbility`
arm for the new op) and `refreshScriptedStatics` (a new
`copyOfTargetBySourceId` collection arm that resolves the
chosen target at refresh time, parallel to lane 75's
collection). The new
`SpellEffectSchema.copyUntilEndOfTurn: { chosen_permanent:
CardInstanceId, until: "end_of_turn" }` arm (parallel to
lane 70's `CopyPermanent` op) arms a `choose_permanent`
waitingChoice pointing at any permanent on the
battlefield. The chosen target's `CardInstanceId` is
stamped on the new permanent's `copyOfTargetId` ledger
(parallel to lane 75); the refresh pass overlays the
chosen target's `cardData` via the lane 75
`animatedUntilEndOfTurn` infrastructure.

The smallest variant set for v1 (per the Wave 4.8
follow-up 7 handoff's "smallest scoped v1" pattern):

- `chosen_permanent: CardInstanceId` — the permanent
  to copy (resolved at resolution time).
- `until: "end_of_turn"` — the duration.
- The new permanent inherits the target's
  characteristics (name, type line, P/T, keywords,
  colors) for the duration of the turn.

The legality check: the chosen target must be on the
battlefield (the player picks from a list of battlefield
permanents in `choose_permanent`). The deduction
happens at the copy-stamping time (the new permanent's
characteristics are swapped for the chosen target's;
the target is unchanged).

Out of scope for lane 75a (these are separate
multi-lanes, each adding a new field):

- Multi-target copies (a copy that picks the strongest
  of two chosen targets at resolution time).
- "Create a token that's a copy of [a chosen permanent]"
  as a static on an existing permanent (vs. as a spell
  effect).
- Permanent copies (no duration) — v1 only does
  until-EOT copies.

The smallest sample card is a synthetic spell registered
via the test harness ("Create a token that's a copy of
[chosen creature] until end of turn") with a 2/2 Grizzly
Bears on the battlefield to verify the copy
characteristics are honored. If the lane grows past
"chosen-target copy until end of turn", back out and
ship the basic-chosen-target variant first, then queue
a follow-up lane for the multi-target / permanent-copy
variants.

## Notes on the engine surface for lane 75b (named-card copy)

When implementing lane 75b, the schema change is a
new `named_card: { name: string }` arm on
`StaticSchema.become_copy` (parallel to lane 75's
`target: CardInstanceId` arm). The engine reads the
named card's `cardData` from the card-scripts registry
(parallel to how `refreshScriptedStatics` reads
scripted statics) or a Scryfall lookup if the named
card isn't a scripted card. The overlay + cleanup path
reuses lane 75's `animatedUntilEndOfTurn`
infrastructure.

The smallest variant set for v1:

- `named_card: { name: string }` — the card name to
  copy (e.g. "Grizzly Bears").
- `until: "end_of_turn"` — the duration.

Out of scope for lane 75b:

- Multi-named copies ("becomes a copy of [card name]
  or [other card name]").
- Named-card copies with an exception ("becomes a copy
  of [card name] except for [X]" — that's lane 75c).
- Named-card copies of cards with complex layers
  (e.g. a named copy of a card that has its own
  `becomes_a_copy_of` static — that's lane 75e).

The smallest sample card is a synthetic static
registered via the test harness ("As long as this is
in play, it's a copy of Grizzly Bears until end of
turn").

## Notes on the engine surface for lane 75c (copy with exception)

When implementing lane 75c, the schema change is a
new `exceptions: { add_subtype?: string[] }` arm on
`StaticSchema.become_copy`. The engine change is in
`refreshScriptedStatics`: after the lane 75 overlay
runs, the engine merges the `add_subtype` list onto
the source's overlaid `cardData.subtypes` (the
`type_line` field is re-built to include the added
subtypes — parallel to lane 66's
`embedded_static.subtype` arm). v1 supports a single
`add_subtype` arm (Phyrexian Metamorph's "Phyrexian
in addition to its other types" pattern); multi-
exception copies are a follow-up lane.

The smallest sample card is a synthetic static
("As long as this is in play, it's a copy of [chosen
creature] until end of turn. It's also a Phyrexian
in addition to its other types.") registered via the
test harness.

## Notes on the engine surface for lane 75d (Aura-shaped copy)

When implementing lane 75d, the schema change is a
new `become_copy` arm on `AuraStaticSchema` (parallel
to lane 76's `protectionFrom` /
`AuraStaticSchema.protectionFrom` arm). The engine
change is in `refreshAuraBonuses`: when an Aura has
a `become_copy` arm and the chosen target is on the
battlefield, the enchanted card's `cardData` is
overlaid with the chosen target's via the lane 75
`animatedUntilEndOfTurn` infrastructure. The
refine list at the bottom of `AuraStaticSchema` must
be extended to accept `become_copy` as a stand-alone
arm (parallel to the Wave 4.8 follow-up 6 lane 76
process note).

The smallest sample card is a synthetic Aura
("Enchanted creature is a copy of [chosen creature]
until end of turn.") registered via the test harness.

## Notes on the engine surface for lane 75e (nested-copy cycle guard)

When implementing lane 75e, the engine change is in
`refreshScriptedStatics`: at the top of the pass, take
a snapshot of each card's "effective copy target" (the
leaf of the copy chain — recursively walking each
card's `become_copy.target` until a card with no
`become_copy` arm is reached). The overlays and the
change-detection diff consult the snapshot's
`cardData`, not from in-flight overlays. The cycle
guard detects cycles in the copy chain (a card whose
copy chain includes itself) and breaks the cycle by
treating the cyclic card as if it had no `become_copy`
arm.

The smallest sample card is a pair of synthetic
statics — one source that copies a target, and a
target that itself has a `become_copy` arm pointing
at a third card. The test verifies that the chain
resolves consistently (no infinite loop, no
inconsistent overlay).
