# Wave 4.8 follow-up 7 handoff — Next session

## Mission

Continue the Wave 4.8 follow-up loop from where Wave 4.8
follow-up 6 left off. The follow-up 6 loop shipped lanes
72, 73, 74, and 76 (PRs #2753, #2754, #2755, #2756 — see
`docs/card-scripts/wave4-blockers.md` for the done
summary and `docs/card-scripts/wave4.8-followup6-handoff.md`
for the prior handoff).

The remaining work, in priority order:

1. **Lane 75 — "Until end of turn" copy**
   (Sakashima-style, manifested, Akoumep Halberd's
   "as long as this is in play, it's a copy of [chosen
   permanent]"). A new `become_copy: { target:
CardInstanceId, until: "end_of_turn" }` arm on
   `StaticSchema` (parallel to lane 71's
   `protectionFrom`). v1 supports a single target +
   "all characteristics copied" semantics with a
   turn-key duration. The engine stamps the
   characteristics on the source's per-instance
   fields (name, type_line, P/T, keywords) via
   `refreshScriptedStatics`; a `turn-phases.ts`
   cleanup step rolls them back at end of turn.
   ~300-500 LOC + tests. **Deferred from the Wave 4.8
   follow-up 6 loop** as a multi-lane blocker per the
   handoff's "Lane is 'done' only when: CI green, PR
   merged, worktree removed, branch deleted, local main
   pulled and re-ratcheted" rule. The handoff
   explicitly warned: "If a lane reveals a second
   pattern that also needs new schema, split it into a
   follow-up lane and put a paragraph in
   `wave4-blockers.md` documenting why."

2. **Lane 61 — Replacement effect for death** (Whip of
   Erebos / False Dawn). Foundational replacement-
   effect layer; parked per the Wave 4.8 follow-up 2
   handoff's process note. The engine has no general
   replacement-effect layer, so lane 61 is foundational
   work, not a normal lane. Open it as a separate
   multi-lane plan, not as the next lane in this loop.

The remaining work is intentionally multi-lane and
should be attacked the same way the previous loops
were: one self-contained lane per PR, immediate
next-lane pickup, no human-in-the-loop. Per the Wave
4.8 follow-up 2 handoff's process rule: "Don't ship
multi-lane work in one PR. If a lane reveals a second
pattern that also needs new schema, split it into a
follow-up lane and put a paragraph in
`wave4-blockers.md` documenting why."

## Priority lanes (in order)

The follow-up work, in priority order:

1. **Lane 75 — "Until end of turn" copy** (Sakashima-
   style / manifested). The smallest scoped piece: a
   new `become_copy: { target: CardInstanceId, until:
"end_of_turn" }` arm on `StaticSchema` (parallel to
   lane 71's `protectionFrom`). v1 supports a single
   target + "all characteristics copied" semantics
   with a turn-key duration. The engine stamps the
   characteristics on the source's per-instance fields
   (name, type_line, P/T, keywords) via
   `refreshScriptedStatics`; a `turn-phases.ts`
   cleanup step rolls them back at end of turn. v1
   single-target, "all characteristics copied"
   semantics. Multi-target copies, "copy of [named
   card]" copies, and "copy with [exception]" copies
   (Phyrexian Metamorph-style) are separate follow-up
   lanes.

2. **Lane 61 — Replacement effect for death** (Whip of
   Erebos, False Dawn). Foundational replacement-
   effect layer; not a normal lane. Open as a
   separate multi-lane plan.

Lane 75 is the only normal-lane in this loop. The
"Until end of turn" copy family is the bulk of the
remaining #2614 drafter-list work.

## State at session start

- **HEAD**: `2e71ad18` (Wave 4.8 follow-up 6 lane 76 —
  the done summary commit; the follow-up 6 loop's
  `wave4-blockers.md` done summary is the follow-up
  7 baseline).
- **729 → ? suites / 14118 → ? cases** (14111 passed
  - 7 skipped). The Wave 4.8 follow-up 7 loop adds
    to these.
- **Lint 0 errors, typecheck clean** (the previous
  baseline).
- **Engine-size budget**: 2750 lines for `schema.ts`
  (bumped 2700 → 2750 in Wave 4.8 follow-up 6 lane
  76). Measured 2733 after lanes 72 + 73 + 74 + 76.
  Lane 75 may need another bump if the new schema
  field pushes past 2750 — the historical precedent
  is "bump the budget rather than fragmenting the
  chosen-X / additional-costs / affinity / grants /
  counter-ledger / cast-from-zone /
  mana-restriction / copy-permanent /
  creature-payment / aura-protection family."
- **Bundle-size budget**:
  `config/bundle-budget.json` was re-captured in
  Wave 4.8 follow-up 4 lane 66 (the engine additions
  grew the `/replay` route and a handful of other
  game routes). Lane 75 may grow the engine surface
  further; if a lane's changes pull into the client
  bundle, re-capture the budget in the same commit.
- **Working directory**:
  `/home/alex/Projects/planar-nexus` (clean).
- **Open issues relevant to this loop**: #2614 (the
  full drafter-list plan work — covers the
  until-EOT-copy family).
- **Just-shipped context**: PRs #2753, #2754, #2755,
  and #2756 are merged on main (lanes 72 / 73 / 74 /
  76). Lane 72 added `additionalCosts.creature_payment`
  for the Llawan / War Tax pattern. Lane 73 added
  `CopySpell` `new_targets: true` wiring for Double
  Vision / Reiterate. Lane 74 added a multi-quality
  test for the lane 71 `StaticSchema.protectionFrom`
  arm. Lane 76 added `AuraStaticSchema.protectionFrom`
  for the Akoumep Halberd / Niveous Wisps pattern.
  All four are v1 single-piece add-ons; no wider
  refactor landed.

## Process (mandatory, identical to Wave 4 / 4.5 / 4.6 /

### 4.7 / 4.7 follow-up / 4.7 phase 2 / 4.8 / 4.8 follow-up /

### 4.8 follow-up 2 / 4.8 follow-up 3 / 4.8 follow-up 4 /

### 4.8 follow-up 5 / 4.8 follow-up 6)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
/tmp/opencode/wave414-lane<N>-<slug> -b
<type>/<scope> origin/main` where `<N>` starts at
   77 and `<slug>` is kebab-case, min 10 chars.
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
     creature-payment / aura-protection family when
     possible.
   - **Engine**: the right home depends on the arm.
     For until-EOT-copy arms (lane 75), update
     `refreshScriptedStatics` for the stamp AND
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
     pass; budget currently 2750 lines for
     `schema.ts`, measured 2733 after lanes 72 + 73
     - 74 + 76). Bump the budget rather than
       fragmenting the chosen-X / additional-costs /
       affinity / grants / counter-ledger /
       cast-from-zone / mana-restriction /
       copy-permanent / creature-payment /
       aura-protection family.
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
  punchy name (e.g. `until-eot-copy` for lane 75).
- **Commit subject**: lower-case, min 10 chars, type
  from `feat fix docs style refactor test chore
revert`. Wave 4.8 saw `header-case` linting on
  commitlint — lowercase is enforced; write the
  subject in lowercase from the start.
- **Reference #2614 follow-up** in the commit body
  and the PR body so the cross-references stay tight.
  For lane 75 (until-EOT copy), reference the
  static slot + #2614.
- **Conventional Commits**. Never check in
  `COMMIT_MSG.txt` (amend-rm before pushing) or
  `PR_BODY.txt` (write it AFTER the commit, per the
  Wave 4.8 follow-up 3 process note).
- **Test count**: ratchet in the same commit as any
  test count change, before pushing.
  `test-count-docs-guard` re-measures live Jest and
  fails on any drift in `docs/onboarding.md` or
  `docs/TEST_VIDEO_FIXTURES.md`.
- **Engine-size budget**: 2750 lines for `schema.ts`
  (the Wave 4.8 follow-up 6 lane 76 bump). Lane 75
  should fit under 2750 (the new field is small); if
  the schema grows past 2750, bump the budget in the
  SAME commit per the Wave 4.8 follow-up handoff's
  process note. Update the docstring block in
  `scripts/check-engine-size-budget.mjs` with a
  one-paragraph history entry (the existing entries
  are a good template).
- **Bundle-size budget**: the Wave 4.8 follow-up 4
  lane 66 re-captured `config/bundle-budget.json`
  after growing the engine surface. Lane 75 may grow
  the engine surface further; if a lane's changes
  pull into the client bundle, re-capture the budget
  in the same commit (see Process step 4).
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
  may delete the file. Write the commit
  message to a file, stage the changes, commit using
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
  the right move (do NOT amend the lane). The Wave
  4.8 follow-up 6 loop hit this flake once on lane
  72's local full-suite run; the second run passed
  clean. Budget for 1-2 extra CI runs per lane to
  absorb the flake.
- **Turn budget: 40 turns per lane max** (per
  `AGENTS.md` §Turn Budget). If a single lane exceeds
  this, it's too big — back out, document, and pick a
  smaller one. Lane 75 was deferred from the Wave 4.8
  follow-up 6 loop for this reason.

## Done definition for the loop

When lane 75 is either shipped or marked multi-lane
blockers (with a paragraph in `wave4-blockers.md`
documenting why), append a Wave 4.8 follow-up 7 loop
done summary at the bottom of
`docs/card-scripts/wave4-blockers.md` documenting the
shipped lanes, the blocked gaps with their #2614 plan
work references, and a fresh test-count snapshot. Then
stop.

If even lane 75 (the smallest prerequisite) is
blocked, that means the engine changed since Wave 4.8
follow-up 6 and the loop should be paused for human
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
  follow-up saw this at lane 56; Wave 4.8 follow-up
  6 hit this flake ONCE on lane 72's local
  full-suite run. Budget for 1-2 extra CI runs per
  lane to absorb the flake.
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
  merged branch. The Wave 4.8 follow-up 6 loop hit
  this on lane 74's merge (kept 14109 from
  origin/main, then post-merge ratchet rewrote both
  files to 14113).
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

## Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any leftover from Wave 4.8 follow-up 6)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 729 / 14118 green
# then start lane 75 (until-EOT copy, #2614 follow-up) per the Process section
```

End each lane with: `git log --oneline -1` on main
showing the new lane's commit, and `grep "Test suites"
docs/onboarding.md` showing the bumped numbers. If
those two checks pass, you're ready for the next lane
immediately.

## Notes on the engine surface for lane 75 (until end of turn copy)

When implementing lane 75, the engine-side changes
are in `keyword-actions/scripted-statics.ts#refreshScriptedStatics`
(the per-instance stamping pass for the copied
characteristics, parallel to lane 71's `protectionFrom`
stamping pattern) AND `turn-phases.ts` (the end-of-turn
cleanup step that rolls back the copied
characteristics). The new
`StaticSchema.become_copy: { target: CardInstanceId,
until: "end_of_turn" }` arm (parallel to lane 71's
`protectionFrom`) declares the copy source and the
turn-key duration.

The smallest variant set for v1 (per the Wave 4.8
follow-up 5 handoff's "smallest scoped v1" pattern):

- `target: CardInstanceId` — the permanent to copy.
- `until: "end_of_turn"` — the duration.
- The new permanent inherits the target's
  characteristics (name, type line, P/T, keywords)
  for the duration of the turn.

The legality check: the target must be on the
battlefield. The deduction happens at the
copy-stamping time (the new permanent's
characteristics are swapped for the target's; the
target is unchanged).

Out of scope for lane 75 (these are separate
multi-lanes, each adding a new field):

- "Becomes a copy of [chosen permanent] until end of
  turn" (a follow-up lane would extend the schema
  with a `chosen_target` arm).
- "Becomes a copy of [named card] until end of turn"
  (a follow-up lane would extend the schema with a
  `named_card` arm).
- "Becomes a copy with [exception]" (Phyrexian
  Metamorph-style — a follow-up lane would extend
  the schema with an `exceptions` arm).

The smallest sample card is a synthetic static
("As long as this is in play, it's a copy of [chosen
creature] until end of turn") registered via the test
harness, with a 2/2 Grizzly Bears on the battlefield
to verify the copy characteristics are honored. If the
lane grows past "copy until end of turn", back out
and ship the basic-copy variant first, then queue a
follow-up lane for the named-copy / chosen-target
variants.
