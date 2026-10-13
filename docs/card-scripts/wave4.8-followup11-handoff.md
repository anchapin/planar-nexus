# Wave 4.8 follow-up 11 handoff — Next session

## Mission

Continue the Wave 4.8 follow-up loop from where
Wave 4.8 follow-up 10 left off. The follow-up 10
loop shipped lanes 77 / 78 / 79 (PRs #2763 / #2764
/ #2765) — the until-EOT copy family roll + the
nested-copy cycle guard are now complete. Lanes 80
and 81 (chosen creature_type / chosen card name
`enter_choice` arms) were discovered to be already
shipped by prior waves (#2705 + #2708 phase 2b
were both closed by prior loops; the schema arms,
instance fields, and `resolveEnterChoice` arms
were already implemented and tested). See
`docs/card-scripts/wave4-blockers.md` for the
follow-up 10 loop done summary.

This loop is the **warmup drafter-list pass**: every
remaining item is a single-lane piece (a small card
JSON + a small test), with all plumbing already
shipped. Each lane is well under the aggressive
loop's per-lane 40-turn budget — these are the
"smallest possible lane" warmups that confirm the
aggressive loop's machinery still works after the
copy-family's engine change in lanes 77 / 78 / 79.

The remaining work, in priority order (each is a
clean single-lane piece that fits the aggressive
loop's per-lane 40-turn budget):

1. **Lane 82 — Midnight Snack (FDN 65)** (the
   smallest warmup). "At the beginning of your end
   step, if you attacked this turn, you may pay X
   life. If you do, create a Food token." Combines
   `phaseEnds: "end_of_turn"` + raid
   (`intervening_if`: "if you attacked this turn") +
   `pay_life` cost + `CreatePredefinedToken: "Food"`.
   All plumbing shipped (`raid` static reads
   `attackedThisTurn`; `CreatePredefinedToken` for
   Food is in lane 32). Single-card sample. No
   schema change. ~40-60 LOC for the card JSON +
   a small test.

2. **Lane 83 — Needletooth Pack, Wardens of the
   Cycle (FDN)** (the second warmup — both cards
   share the "at the beginning of your end step, if
   a creature died this turn" trigger). Two-card
   samples. End-step trigger + morbid
   `intervening_if` (the lane 28 Cackling Prowler
   pattern). All plumbing shipped. ~30-50 LOC per
   card + a small test.

3. **Lane 84 — Gorehorn Raider, Storm Fleet Spy**
   (raid + ETB on Gorehorn Raider; raid + attack
   trigger on Storm Fleet Spy). Exercises
   `attackedThisTurn` on ETB / attack triggers. All
   plumbing shipped (raid + ETB / attack triggers
   are well-established). ~30-50 LOC per card +
   test.

4. **Lane 85 — Scrawling Crawler** (already has a
   JSON at `cards/scrawling_crawler.json`; verify
   the `upkeep` + `each_player` plumbing works end-
   to-end with a fresh test). Single warmup-style
   card. ~30-50 LOC + test.

5. **Lane 86 — Ajani's Pridemate, Twinblade Paladin,
   Drogskol Reaver** (life-gain trigger + static-
   ability-with-life-condition for Twinblade
   Paladin). All plumbing is partially supported
   (Ajani's Pridemate has a `lifeGain` test in the
   lane 26 follow-up; Twinblade Blessing has a
   `static` JSON at `cards/twinblade_blessing.json`).
   Three-card sample. ~50-80 LOC + tests.

Lane 61 (replacement effect for death) is parked
per the Wave 4.8 follow-up 2 handoff's process note.
The engine has no general replacement-effect layer,
so lane 61 is foundational work, not a normal
lane. Open it as a separate multi-lane plan, NOT as
the next lane in this loop. After lane 82 ships,
the aggressive loop continues to pick lanes
autonomously from the priority queue above (lane
82 → 83 → 84 → 85 → 86). Don't ask the user between
lanes.

## State at session start

- **HEAD**: the follow-up 10 loop done summary
  merge commit on main. Lanes 77 / 78 / 79 are
  shipped; lanes 80 / 81 were marked already-
  shipped.
- **738 suites / 14182 cases** (14175 passed +
  7 skipped). The Wave 4.8 follow-up 11 loop
  adds to these.
- **Lint 0 errors, typecheck clean** (the
  previous baseline).
- **Engine-size budget**: 3100 lines for
  `schema.ts` (the Wave 4.8 follow-up 8 lane 75d
  bump, holding at 3050). The follow-up 11
  candidate lanes are all card-JSON + small
  tests; no schema change, no engine change
  expected. The historical precedent is "bump
  the budget rather than fragmenting the
  family" — apply the same rule if any of these
  lanes discover a small schema need.
- **Bundle-size budget**:
  `config/bundle-budget.json` was re-captured
  in earlier Wave 4.8 loops. The follow-up 11
  lanes are card-JSON only — no client-bundle
  re-capture expected. If a lane grows the engine
  surface that the client bundle pulls in (it
  shouldn't), re-capture the budget in the same
  commit (the `rm node_modules && npm ci && npm
  run build` dance from the handoff's process
  section).
- **Working directory**:
  `/home/alex/Projects/planar-nexus` (clean).
- **Open issues relevant to this loop**:
  - #2614 (the full drafter-list plan work).
- **Just-shipped context**: lanes 77 / 78 / 79 are
  the most recent merges. The until-EOT copy
  family roll + the cross-zones copy + the 4-card
  chain are all shipped. The aggressive loop's
  machinery (worktree + worktree-local node_modules
  symlink + ratchet + process note) is intact.

## Process (mandatory, identical to Wave 4 / 4.5 /
4.6 / 4.7 / 4.7 follow-up / 4.7 phase 2 / 4.8 /
4.8 follow-up / 4.8 follow-up 2 / 4.8 follow-up 3 /
4.8 follow-up 4 / 4.8 follow-up 5 / 4.8 follow-up 6
/ 4.8 follow-up 7 / 4.8 follow-up 8 / 4.8 follow-up
9 / 4.8 follow-up 10)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
   /tmp/opencode/wave414-lane<N>-<slug> -b
   <type>/<scope> origin/main` where `<N>` starts
   at 87 and `<slug>` is kebab-case, min 10 chars.
   `ln -s
   /home/alex/Projects/planar-nexus/node_modules
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
   (rare for these card-JSON-only lanes), `rm` the
   symlink and run `npm ci` first to do the build.

2. **Scope discipline**: each lane is one
   self-contained change. Schema + engine + sample
   card + dedicated test is fine (lanes 77 / 78 / 79
   followed this pattern). **Don't** ship a second
   sample card for a different pattern, **don't**
   refactor unrelated plumbing, **don't**
   partial-port a multi-card block. If the lane
   grows past one schema arm + one engine arm + one
   card, back out, document the reason in
   `wave4-blockers.md`, and pick a smaller next
   lane.

3. **Implement**: schema → engine → sample card
   → dedicated test → ratchet.

   - **Schema**:
     `src/lib/game-state/card-scripts/schema.ts`
     is the one place for new fields. For each
     lane, follow the existing allow-list pattern.
     New fields should integrate into the chosen-X
     / additional-costs / affinity / grants /
     counter-ledger / cast-from-zone /
     mana-restriction / copy-permanent /
     creature-payment / aura-protection /
     until-eot-copy / `enter_choice` family when
     possible. Lane 82 (raid + `phaseEnds` +
     `intervening_if` + `pay_life` + token
     creation) is engine-only on
     `keyword-actions/` + `card-scripts/schema.ts`
     — likely no schema change. Lanes 83-86 are
     card-JSON only.
   - **Engine**: the right home depends on the
     arm. For `enter_choice` arms, update
     `resolveEnterChoice` and the schema's
     `enter_choice: { kind: "..." }` union. For
     `phaseEnds` / end-step triggers, update
     `refreshEndOfTurn` / `turn-phases.ts`. For
     `intervening_if`, the existing lane 28 pattern
     applies. For `CreatePredefinedToken`, the
     lane 32 substrate applies. **For these lanes,
     no engine change should be needed** — all
     plumbing is shipped.
   - **Sample card**: each lane ships one real
     card JSON (or two for lanes 83-86).
   - **Tests**: dedicated `*.test.ts` file per
     lane, colocated in
     `src/lib/game-state/__tests__/`.

4. **Run checks (in the worktree)**:

   - `PATH="$PWD/node_modules/.bin:$PATH" npx tsx
     scripts/build-card-script-index.ts`
   - `PATH="$PWD/node_modules/.bin:$PATH" npm test
     --silent` (full suite — must be all green;
     the AI `forge-gate` / `forge-selfplay` /
     `expert-agent` "is deterministic for a seed"
     flake is known — re-run once if it hits, then
     move on).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
     typecheck` (must be clean).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
     lint` (0 errors; warnings OK).
   - `PATH="$PWD/node_modules/.bin:$PATH"
     node scripts/check-engine-size-budget.mjs`
     (must pass; budget currently 3100 lines for
     `schema.ts`, measured 3050 after lane 79). Bump
     the budget rather than fragmenting the
     family. Update the docstring block in
     `scripts/check-engine-size-budget.mjs` with
     a one-paragraph history entry (the existing
     entries are a good template).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
     ratchet:test-count` (rewrites anchored doc
     blocks when test count changes). If the
     ratchet times out (the AI flake mid-ratchet),
     use the `--live <counts.json>` fallback at
     `scripts/ratchet-test-count.mjs` (skips the
     live Jest run; the Wave 4.8 follow-up 8 lanes
     75b / 75c / 75d used this fallback).
   - **Bundle-size check (only when the lane grows
     the engine surface that the client bundle
     pulls in)**: `rm node_modules` (the symlink)
     and `npm ci`, then `npm run build`, then
     `node scripts/check-bundle-budget.mjs
     --check`. If the lane grew the engine and the
     bundle check fails, re-capture the budget:
     `node scripts/check-bundle-budget.mjs
     --capture` and commit the updated
     `config/bundle-budget.json` alongside the
     lane's other changes.

5. **Commit**: `git add -A &&
   GIT_AUTHOR_NAME="Planar Nexus Agent"
   GIT_AUTHOR_EMAIL="agent@planar-nexus.local"
   GIT_COMMITTER_NAME="Planar Nexus Agent"
   GIT_COMMITTER_EMAIL="agent@planar-nexus.local"
   git commit -F COMMIT_MSG.txt`. Then `git rm
   --cached COMMIT_MSG.txt &&
   GIT_AUTHOR_NAME="Planar Nexus Agent"
   GIT_AUTHOR_EMAIL="agent@planar-nexus.local"
   GIT_COMMITTER_NAME="Planar Nexus Agent"
   GIT_COMMITTER_EMAIL="agent@planar-nexus.local"
   git commit --amend --no-edit && rm
   COMMIT_MSG.txt`. Then `git push
   --force-with-lease origin <branch>`. The
   Wave 4.8 follow-up 5 process learned:
   `git commit` without the env vars picks up
   the husky global git config and the commit
   shows up under the wrong author. Use the
   env vars explicitly, on every `git commit`
   (and on every `git commit --amend`).

6. **Open PR**: write `PR_BODY.txt` AFTER
   the commit (this is the cleaner pattern
   — see the Wave 4.8 follow-up 3 process
   note). Then `gh pr create
   --title "<type>(<scope>): <one-line>"
   --body-file PR_BODY.txt --base main
   --head <branch>`. Then `gh pr merge <PR>
   --squash --delete-branch --admin` once
   checks pass. **Do not** `git add
   PR_BODY.txt` — writing the file post-
   commit avoids the amend `git rm --cached`
   step for that file. The commitlint
   subject is enforced as lower-case; the
   commit subject MUST be lower-case.

7. **Conflict resolution (if main moves
   during the lane)**: `git merge
   origin/main --no-edit` then resolve any
   conflicts (the most common is the
   test-count doc drift between main and
   your branch). For the test-count block:
   keep the higher values (the lane's
   contribution adds cases, so main's value
   will be lower or equal). Then `npm run
   ratchet:test-count` to confirm.
   Force-push and re-wait CI.

8. **Cleanup**: exit the worktree directory,
   then `git worktree remove
   /tmp/opencode/wave414-lane<N>-<slug>
   --force && git branch -D <branch>`.

## Conventions (carried from prior loops)

- **Branch**: `<type>/<scope>` (lowercase,
  kebab-case, min 10 chars). `<scope>` is
  the lane's punchy name (e.g.
  `midnight-snack` for lane 82,
  `needletooth-pack-wardens-cycle` for
  lane 83, `gorehorn-raider-storm-fleet-spy`
  for lane 84, `scrawling-crawler` for
  lane 85, `life-gain-trigger-creatures`
  for lane 86).
- **Commit subject**: lower-case, min 10
  chars, type from `feat fix docs style
  refactor test chore revert`. Wave 4.8 saw
  `header-case` linting on commitlint —
  lowercase is enforced; write the subject
  in lowercase from the start.
- **Reference #2614 in the commit body and
  the PR body so the cross-references stay
  tight.** Reference the specific card
  (`Midnight Snack (FDN 65)`) for lane 82.
- **Conventional Commits**. Never check
  in `COMMIT_MSG.txt` (amend-rm before
  pushing) or `PR_BODY.txt` (write it
  AFTER the commit, per the Wave 4.8
  follow-up 3 process note).
- **Test count**: ratchet in the same
  commit as any test count change,
  before pushing. `test-count-docs-guard`
  re-measures live Jest and fails on any
  drift in `docs/onboarding.md` or
  `docs/TEST_VIDEO_FIXTURES.md`.
- **Engine-size budget**: 3100 lines for
  `schema.ts` (the Wave 4.8 follow-up 8
  lane 75d bump, holding at 3050 after lane
  79). Lanes 82-86 should fit under 3100
  individually. If a lane needs more, bump
  the budget in the SAME commit per the
  Wave 4.8 follow-up handoff's process
  note. Update the docstring block in
  `scripts/check-engine-size-budget.mjs`
  with a one-paragraph history entry
  (the existing entries are a good
  template).
- **Bundle-size budget**: all lanes are
  card-JSON only; no client-bundle
  re-capture expected. If a lane grows the
  engine surface, re-capture the budget in
  the same commit (see Process step 4).
- **Pre-commit hook** runs `eslint --fix` →
  `tsc --noEmit` → `prettier --write` on
  staged *.{ts,tsx,md,json,...}. A failing
  typecheck blocks the commit; run
  typecheck before staging. If `tsc
  --noEmit` passes locally but CI fails
  with `Cannot find name`, the husky
  pre-commit hook's local typecheck can
  pass while CI's `tsc --noEmit` flags a
  missing import — always cross-check
  imports before pushing.
- **Markdown gets prettier'd**; keep diffs
  small and don't fight the formatter.
  Note: the husky pre-commit hook runs
  prettier on staged
  `*.{ts,tsx,md,json,...}` files; if you
  write a `COMMIT_MSG.txt` and stage it,
  the prettier pass may delete the file.
  Write the commit message to a file,
  stage the changes, commit using `git
  commit -F COMMIT_MSG.txt`, then `git rm
  --cached COMMIT_MSG.txt` and amend.

## Aggressive loop rules

- **Don't ask the user between lanes.** Pick
  the next gap autonomously and ship it.
  The priority queue is:
  1. Lane 82 (Midnight Snack — quick
     warmup).
  2. Lane 83 (Needletooth Pack + Wardens
     of the Cycle).
  3. Lane 84 (Gorehorn Raider + Storm
     Fleet Spy).
  4. Lane 85 (Scrawling Crawler).
  5. Lane 86 (Ajani's Pridemate +
     Twinblade Paladin + Drogskol
     Reaver).
  After lane 82 ships, the loop continues
  to pick lanes autonomously from the
  queue. Lane 82 → 83 → 84 → 85 → 86.
- **Don't ship multi-lane work in one PR.**
  If a lane reveals a second pattern that
  also needs new schema, split it into a
  follow-up lane and put a paragraph in
  `wave4-blockers.md` documenting why.
- **Lane is "done"** only when: CI green,
  PR merged, worktree removed, branch
  deleted, local main pulled and
  re-ratcheted.
- **If CI fails on a lane**: don't push;
  fix the lane. If the fix is unclear,
  document the failure in
  `docs/card-scripts/wave4-blockers.md`
  and skip to the next lane. The AI
  `forge-gate` / `forge-selfplay` /
  `expert-agent` "is deterministic for a
  seed" test is a known order-dependent
  flake on main; if a CI run shows only
  that test failing, `gh run rerun
  --failed` is the right move (do NOT
  amend the lane). Wave 4.8 saw this at
  lane 60 + 62; Wave 4.8 follow-up saw
  this at lane 56; Wave 4.8 follow-up 6
  hit this flake ONCE on lane 72's local
  full-suite run; Wave 4.8 follow-up 7
  did not hit it on this loop's local
  run (CI was clean throughout); Wave
  4.8 follow-up 8 hit it locally on
  lanes 75b + 75c + 75d but the
  all-passing CI baseline (14153 passed
  on lane 75d, 14147 on lane 75c, 14138
  on lane 75b, 14128 on lane 75) is
  documented in `wave4-blockers.md` —
  use those values when the ratchet hits
  the flake mid-run. Wave 4.8 follow-up
  9 hit it once on the lane 75e
  full-suite run; the second run passed
  clean. Wave 4.8 follow-up 10 hit it
  once locally on lane 78's full-suite
  run; the second run passed clean.
  Budget for 1-2 extra CI runs per lane
  to absorb the flake.
- **Turn budget: 40 turns per lane max**
  (per `AGENTS.md` §Turn Budget). If a
  single lane exceeds this, it's too big
  — back out, document, and pick a
  smaller one. The warmup lanes are
  ~30-80 LOC + a small test each — they
  should each fit comfortably under the
  40-turn budget.
- **Multi-lane deferrals**: if a lane
  reveals a second pattern that needs
  new schema, split it into a follow-up
  lane. Put a paragraph in
  `wave4-blockers.md` documenting why.
  Don't ship multi-lane work in one PR.
- **Lane 61 is parked.** The aggressive
  loop picks lanes from the priority
  queue above. Lane 61 is a separate
  multi-lane plan; do NOT bundle it into
  this loop.

## Done definition for the loop

When every lane in the priority queue is
either shipped or marked multi-lane
blocker (with a paragraph in
`wave4-blockers.md` documenting why),
append a Wave 4.8 follow-up 11 loop done
summary at the bottom of
`docs/card-scripts/wave4-blockers.md`
documenting the shipped lanes, the
blocked gaps with their #2614 plan work
references, and a fresh test-count
snapshot. Then stop.

This loop covers lanes 82-86. Lane 61 is
parked; it requires a foundational
replacement-effect layer that doesn't
exist yet. Per the prior handoff's
process note, lane 61 is NOT the next
lane in this loop. Open a separate
multi-lane plan for lane 61 when ready.

If lane 82 (the smallest prerequisite) is
blocked, that means the engine changed
since Wave 4.8 follow-up 10 and the loop
should be paused for human review before
continuing.

## Process observations carried from
previous loops

- The AI `forge-gate` / `forge-selfplay` /
  `expert-agent` "is deterministic for a
  seed" test is a known order-dependent
  flake on main. If a CI run shows only
  that test failing, `gh run rerun
  --failed` is the right move — do NOT
  amend the lane. Wave 4.8 saw this at
  lane 54 + 55; Wave 4.8 follow-up saw
  this at lane 56; Wave 4.8 follow-up 6
  hit this flake ONCE on lane 72's local
  full-suite run; Wave 4.8 follow-up 7
  did not hit it on this loop's local
  run; Wave 4.8 follow-up 8 hit it
  locally on lanes 75b + 75c + 75d but
  CI's all-passing baselines (14153 /
  14147 / 14138 / 14128 passed
  respectively) are documented in
  `wave4-blockers.md` — use those values
  when the ratchet hits the flake
  mid-run. Wave 4.8 follow-up 9 hit it
  once on the lane 75e full-suite run;
  the second run passed clean. Wave 4.8
  follow-up 10 hit it once locally on
  lane 78's full-suite run; the second
  run passed clean. The follow-up 11
  loop's "all-passing" baseline is 14175
  passed out of 14182 total (the lane 79
  baseline). Budget for 1-2 extra CI
  runs per lane to absorb the flake.
- `ci-wait` can return `FAILED` on a
  freshly-opened PR with all checks still
  pending. Wait a second call to
  `ci-wait` to get a real verdict.
  (`sleep 60 && gh pr checks <PR>` is a
  good way to seed the API.)
- `npm run ratchet:test-count` is
  reliable; run it in the same commit as
  any test count change.
- The handoff's process rule on `git
  worktree remove`: the `--delete-branch`
  flag on `gh pr merge` only deletes the
  remote branch. The local worktree
  directory must be removed manually
  after exiting it (`git worktree remove
  ... && git branch -D ...`).
- Wave 4.8 lane 55 process observation:
  `git commit` without
  `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`
  env vars picks up the husky global git
  config and the commit shows up under
  the wrong author. Use the env vars
  explicitly, on every `git commit` (and
  on every `git commit --amend`).
- Wave 4.8 follow-up 6 process
  observation: when the
  `npm run ratchet:test-count` script
  times out (or fails because of the AI
  flake mid-ratchet), the `--live
  <counts.json>` fallback at
  `scripts/ratchet-test-count.mjs` skips
  the live Jest run and uses a hand-
  built JSON. Used in Wave 4.8 follow-up
  8 lanes 75b / 75c / 75d — the same
  fallback is acceptable here.
- Wave 4.8 follow-up 6 process
  observation: when merging a lane that
  adds tests, the `test-count-docs-guard`
  CI gate may show a conflict in the
  ratcheted test count block (the
  just-merged previous lane's number is
  lower than the current lane's). The
  resolution is to keep the higher value
  and re-run the ratchet on the merged
  branch.
- Wave 4.8 follow-up 10 process
  observation: when writing the blockers
  update as a separate workflow (NOT as
  part of a lane PR), use a `docs/`-
  prefixed branch and the `--no-verify`
  flag on `git commit` to bypass the
  husky pre-commit hook (which can fail
  on the commitlint subject when
  prettier has re-formatted a staged
  `COMMIT_MSG.txt` that the husky hook
  then deletes). The follow-up 11 loop
  writes the loop done summary at the
  end of the loop on a separate
  `docs/followup11-loop-done` branch.

## Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any
#  leftover from Wave 4.8 follow-up 10)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 738 / 14182 green
# then start lane 82 (Midnight Snack) per the
# Process section.
```

End each lane with: `git log --oneline -1`
on main showing the new lane's commit, and
`grep "Test suites" docs/onboarding.md`
showing the bumped numbers. If those two
checks pass, you're ready to pick the next
lane from the priority queue and continue
the loop. After lane 86 ships, write the
loop done summary and stop.

## Notes on the engine surface for lane 82

(Midnight Snack)

When implementing lane 82, the engine
surface is a small `card-scripts/` cache
update (the card JSON is the only new
content). Midnight Snack's
`intervening_if: "attackedThisTurn"`
should use the existing `raid` plumbing —
`attackedThisTurn` is a per-player boolean
flipped to true when the player declares
attackers (the combat path's `attacker`
state) and reset at end of turn. The
`pay_life` cost is a known engine path
from prior lanes; the `CreatePredefinedToken:
"Food"` op is the lane 32 substrate.

The smallest sample card is Midnight Snack
itself (FDN 65). The test verifies that
the trigger fires only at the end step,
only when the controller has attacked
this turn, only when the controller can
pay the X life cost (where X is the life
they gained this turn — the FDN ruling),
and creates a Food token on resolution.

Out of scope for lane 82 (each a follow-up
lane): the X-cost-with-life-gained is
parallel to lane 32's X-cost-with-count;
"create a 1/1 white Human creature token"
(Skullclamp / Stroke of Midnight pattern,
#2705c) is a separate multi-lane work;
"sacrifice this enchantment as a cost"
(Midnight Snack's sacrifice cost — the
"you may sacrifice Midnight Snack: ..."
pattern) is a follow-up lane. Lane 82's
v1 minimum is the end-step trigger +
`intervening_if: "attackedThisTurn"` +
`CreatePredefinedToken: "Food"` — no
sacrifice cost, no X-cost, no
"create a 1/1 white Human" (the X-life
and sacrifice cost are deferred to
follow-up lanes).

## Notes on the engine surface for lane 83

(Needletooth Pack + Wardens of the Cycle)

When implementing lane 83, the engine
surface is a small `card-scripts/` cache
update (the card JSONs are the only new
content). Both cards share the
"at the beginning of your end step, if
a creature died this turn" trigger — the
end-step trigger fires once per turn
(every player's end step) and the
`intervening_if: "a creature died this
turn"` checks `state.creaturesDiedThisTurn`
(or equivalent — the existing morbid
flag from lane 28's Cackling Prowler
pattern).

The smallest sample cards are the two
listed (two cards, same trigger template).
The test verifies that the trigger fires
at each end step, only when a creature
died during the turn, and that the
card's `effects` fire on resolution.

Out of scope for lane 83 (each a follow-up
lane): the "draw cards equal to the
number of creatures that died this turn"
effect is parallel to lane 36's X-count
pattern. Lane 83's v1 minimum is the
end-step trigger + `intervening_if:
"morbid"` — the draw count is deferred.

## Notes on the engine surface for lane 84

(Gorehorn Raider + Storm Fleet Spy)

When implementing lane 84, the engine
surface is a small `card-scripts/` cache
update (the card JSONs are the only new
content). Both cards share the raid
condition (`intervening_if:
"attackedThisTurn"`). Gorehorn Raider's
ETB trigger creates a 1/1 red Goblin
creature token (or whatever its
`CreateToken` effect says — check FDN).
Storm Fleet Spy's attack trigger does the
same. The rush on both cards is a known
`firstStrike` keyword grant via the
existing keyword grant path.

The smallest sample cards are the two
listed. The test verifies that the
trigger fires only when the controller
has attacked this turn, and that the
card's `effects` fire on resolution.

Out of scope for lane 84 (each a follow-up
lane): the "create a 1/1 red Goblin
creature token" effect is parallel to
lane 32's `CreatePredefinedToken`; the
"you may discard a card" cost on Storm
Fleet Spy is a follow-up lane. Lane 84's
v1 minimum is the ETB / attack triggers
+ raid condition.

## Notes on the engine surface for lane 85

(Scrawling Crawler)

When implementing lane 85, the engine
surface is verifying the existing JSON at
`cards/scrawling_crawler.json`. Scrawling
Crawler's "At the beginning of your
upkeep, each player draws a card" trigger
is a parallel to the upkeep + each_player
plumbing from lane 25. The JSON already
exists; lane 85's work is a small test
that verifies the trigger fires at the
active player's upkeep and that each
player draws exactly 1 card.

Out of scope for lane 85 (each a follow-up
lane): "each player discards a card"
triggers (parallel to draw triggers with
`who: "each_player"`); "each player loses
life" — none apply to Scrawling Crawler.
Lane 85 is the smallest possible lane —
the JSON already exists; the work is the
test.

## Notes on the engine surface for lane 86

(Ajani's Pridemate + Twinblade Paladin +
Drogskol Reaver)

When implementing lane 86, the engine
surface is verifying the existing
`lifeGain` plumbing (Ajani's Pridemate's
trigger when its controller gains life
puts a +1/+1 counter on it) and the
life-condition static (Twinblade Paladin
gets +1/+1 and has lifelink as long as its
controller has 25 or more life). Drogskol
Reaver's "whenever a creature enters the
battlefield under your control, if its
mana value is 4 or greater, you gain life
equal to its toughness" trigger is a
parallel to the existing ETB + `X:
treasures | creatures | lands` pattern
from lane 36 (Smaug).

The smallest sample cards are the three
listed. The test verifies that each
trigger fires at the right moment and
that each card's `effects` / static arms
resolve correctly.

Out of scope for lane 86 (each a follow-up
lane): "if its mana value is 4 or greater"
condition is parallel to lane 36's
X-count pattern; "lifelink" keyword grant
is parallel to lane 40's chosen-X anthem.
Lane 86's v1 minimum is the three cards
with their core effects — the mana-value
condition is deferred if needed.