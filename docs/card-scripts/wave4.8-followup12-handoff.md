# Wave 4.8 follow-up 12 handoff — Next session

## Mission

Continue the Wave 4.8 follow-up loop from where
Wave 4.8 follow-up 11 left off. The follow-up 11
loop shipped lanes 82 / 83 / 84 / 85 / 86 (PRs
#2768 / #2769 / #2770 / #2771 / #2772) — the
warmup drafter-list pass is now complete. Lane 61
(replacement effect for death) is parked per
the Wave 4.8 follow-up 2 handoff's process note
(it requires a foundational replacement-effect
layer that doesn't exist yet). See
`docs/card-scripts/wave4-blockers.md` for the
follow-up 11 loop done summary.

This loop is the **per-card out-of-scope pass**:
each remaining item is a single-card JSON + a
small test that exercises a specific deferred
half of an already-scripted card from follow-up
11. The plumbing already shipped in follow-up 11
(or earlier loops) — this loop only fills in
the second halves of oracles the follow-up 11
lanes deferred to "follow-up lanes" (X-cost with
life-gained, sacrifice-self cost, more-cards
trigger, life-condition static, the
opponent-draws static on Scrawling Crawler, the
1/1 red Goblin token on Gorehorn Raider, etc.).
The handoff's "Out of scope per the handoff
(each a follow-up lane)" list is the priority
queue.

The remaining work, in priority order (each is a
clean single-lane piece that fits the aggressive
loop's per-lane 40-turn budget):

1. **Lane 87 — Scrawling Crawler's
   opponent-draws static (FDN 132)** (the
   smallest warmup). The existing JSON
   `cards/scrawling_crawler.json` encodes the
   upkeep + each_player draws trigger; the
   second half ("Whenever an opponent draws a
   card, that player loses 1 life") was deferred
   per follow-up 11. Schema change: a new
   `event: "drawCard"` trigger arm. Engine
   change: detect the draw event as a
   `cardDraws` triggered-ability instance and fire
   the trigger when the controller is the OPPONENT
   of the source's controller (a small
   `triggeredByOpponent` filter or an
   `intervening_if` like "the player who drew is
   not you"). Effect: `LoseLife` on the
   drawer. Sample card JSON for Scrawling
   Crawler adds the second trigger to the
   existing one. ~40-60 LOC for the schema arm
   + engine dispatch + a small test.

2. **Lane 88 — Midnight Snack
   sacrifice-midnight-snack cost (FDN 65)** (the
   second warmup). Per the follow-up 11 handoff
   the "sacrifice this enchantment as a cost"
   arm is a follow-up lane. Schema change:
   `additionalCosts.sacrifice` already has
   `target: "self"` per the lane 63 work — verify
   it works on the trigger, not just on a
   spell cast. The trigger in Midnight Snack
   already has an `intervening_if: "you attacked
   this turn"`; the sacrifice cost would be
   added via `cost.sacrifice_self` on the trigger
   or via a `you_may: true` gate + sacrifice.
   The v1 minimum is: add the sacrifice cost
   to Midnight Snack's trigger, verify the
   trigger fires only when the controller can
   sacrifice the enchantment, and that the
   Food token is still created on resolution.
   ~30-50 LOC for the engine dispatch +
   small test.

3. **Lane 89 — Gorehorn Raider's 1/1 red
   Goblin creature token (FDN 89)** (the third
   warmup). Per the follow-up 11 handoff the
   "create a 1/1 red Goblin creature token"
   effect is a follow-up lane. Add a second
   trigger (or split the existing `DealDamage`
   into a chained `DealDamage` + `CreateToken`)
   to Gorehorn Raider. The existing
   `CreatePredefinedToken` substrate covers
   Treasure/Food/Clue only; for the 1/1 red
   Goblin we need either a new `token: "goblin"`
   arm on `CreatePredefinedToken` or a generic
   `CreateToken` op with power/toughness/color
   fields. The lane 66 (Wave 4.8 follow-up 4)
   `CreateToken` substrate has the power /
   toughness / color / keywords fields already.
   v1 minimum: add `CreateToken` (or extend
   `CreatePredefinedToken` with a `"goblin"`
   arm) for the 1/1 red Goblin, then chain
   Gorehorn Raider's existing `DealDamage` with
   the new `CreateToken`. ~40-80 LOC for the
   engine + small test.

4. **Lane 90 — Needletooth Pack's
   draw-count X (FDN 108)** (the fourth
   warmup). Per the follow-up 11 handoff the
   "draw cards equal to the number of creatures
   that died this turn" effect is a follow-up
   lane parallel to lane 36's X-count pattern.
   Add a second effect to Needletooth Pack
   that draws N cards where N = number of
   creatures that died this turn. The X-count
   substrate (`X: "creatures" | "treasures" |
   "lands"` from lane 36) doesn't cover "draw N"
   out of the box; v1 minimum is a
   `Draw.amount = creaturesDiedThisTurn` or a
   new `Draw.amount.X: "creatures_died_this_turn"`
   arm. ~30-50 LOC for the engine + small test.

5. **Lane 91 — Twinblade Paladin's
   life-condition static (FDN 503)** (the
   fifth warmup). Per the follow-up 11
   handoff the "as long as you have 25 or more
   life" static for double strike + lifelink is
   a follow-up lane parallel to lane 40's
   chosen-X anthem. Add a `static` arm with
   `affects: { controller: "self" }` and a
   `life_minimum: 25` or `while_condition`
   gate that stamps keywords `["double strike",
   "lifelink"]` onto the source when its
   controller has 25 or more life. The
   `refreshScriptedStatics` path in
   `keyword-actions/scripted-statics.ts`
   already handles keyword grants; v1 minimum
   is a new `static.while_condition` arm
   reading `state.players[i].life >= N`. ~50-80
   LOC for the schema + engine + small test.

6. **Lane 92 — Drogskol Reaver's
   "mana value 4 or greater" ETB (FDN 655)**
   (the sixth warmup). Per the follow-up 11
   handoff the ETB + "if mana value 4 or
   greater" condition is parallel to lane 36's
   X-count pattern. Add an ETB trigger to
   Drogskol Reaver: "Whenever a creature you
   control enters, if its mana value is 4 or
   greater, you gain life equal to its
   toughness." The X-count substrate covers
   `X: "treasures" | "creatures" | "lands"`
   but not "creatures_you_control_with_mv_4_or_more";
   v1 minimum is an `intervening_if: "mv >= 4"`
   on the ETB trigger + a `GainLife.amount.X:
   "toughness"` arm. ~50-80 LOC for the engine
   + small test.

Lane 61 (replacement effect for death) is
parked per the Wave 4.8 follow-up 2 handoff's
process note. The engine has no general
replacement-effect layer, so lane 61 is
foundational work, not a normal lane. Open it
as a separate multi-lane plan, NOT as the
next lane in this loop. After lane 87 ships,
the aggressive loop continues to pick lanes
autonomously from the priority queue above
(lane 87 → 88 → 89 → 90 → 91 → 92). Don't
ask the user between lanes.

## State at session start

- **HEAD**: the follow-up 11 loop done
  summary merge commit on main. Lanes 82 / 83
  / 84 / 85 / 86 are shipped (PRs #2768 /
  #2769 / #2770 / #2771 / #2772); the loop
  done summary is PR #2773.
- **743 suites / 14225 cases** (14218 passed +
  7 skipped). The Wave 4.8 follow-up 12 loop
  adds to these.
- **Lint 0 errors, typecheck clean** (the
  previous baseline).
- **Engine-size budget**: 3100 lines for
  `schema.ts` (the Wave 4.8 follow-up 8 lane
  75d bump, holding at 3050 after lane 79 and
  follow-up 11). The follow-up 12 lanes are
  mostly engine / schema extensions; the
  follow-up 8 bump to 3100 gives ~50 lines of
  headroom per lane. If any follow-up 12
  lane needs more, bump the budget in the
  SAME commit per the historical precedent
  ("bump the budget rather than fragmenting
  the family"). Update the docstring block
  in `scripts/check-engine-size-budget.mjs`
  with a one-paragraph history entry (the
  existing entries are a good template).
- **Bundle-size budget**:
  `config/bundle-budget.json` was re-captured
  in earlier Wave 4.8 loops. The follow-up 12
  lanes grow the engine surface (schema +
  engine arms), so any lane that adds a new
  op / static arm may grow the client bundle.
  Re-capture the budget in the same commit
  per the handoff's process section if the
  lane grew the engine surface the client
  pulls in.
- **Working directory**:
  `/home/alex/Projects/planar-nexus` (clean).
- **Open issues relevant to this loop**:
  - #2487 (the card-scripts epic).
  - #2614 (the original drafter-list plan
    work — closed but follow-up issues open
    under it).
- **Just-shipped context**: lanes 82 / 83 / 84
  / 85 / 86 are the most recent merges
  (PRs #2768 → #2772). The aggressive loop's
  machinery (worktree + worktree-local
  `node_modules` symlink + ratchet + process
  note) is intact.

## Process (mandatory, identical to Wave 4 /
4.5 / 4.6 / 4.7 / 4.7 follow-up / 4.7 phase
2 / 4.8 / 4.8 follow-up / 4.8 follow-up 2 /
4.8 follow-up 3 / 4.8 follow-up 4 / 4.8
follow-up 5 / 4.8 follow-up 6 / 4.8 follow-up
7 / 4.8 follow-up 8 / 4.8 follow-up 9 / 4.8
follow-up 10 / 4.8 follow-up 11)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
   /tmp/opencode/wave414-lane<N>-<slug> -b
   <type>/<scope> origin/main` where `<N>`
   starts at 93 and `<slug>` is kebab-case,
   min 10 chars. `ln -s
   /home/alex/Projects/planar-nexus/node_modules
   /tmp/opencode/wave414-lane<N>-<slug>/node_modules`
   so test/lint/typecheck skip a fresh
   install. Verify with `ls
   /tmp/opencode/wave414-lane<N>-<slug>/node_modules/.bin/jest`.
   Note: the symlinked `node_modules` will
   fail `npm run build` (Turbopack errors on
   the `node_modules` symlink pointing
   outside the worktree root). The bundle-size
   budget re-capture requires a real build,
   so when a lane grows the engine surface
   that the client bundle pulls in (likely
   for these lanes — most add a new op /
   static arm), `rm` the symlink and run
   `npm ci` first to do the build.

2. **Scope discipline**: each lane is one
   self-contained change. Schema + engine +
   sample card + dedicated test is fine
   (lanes 82 / 83 / 84 / 86 followed this
   pattern; lane 85 was test-only). **Don't**
   ship a second sample card for a different
   pattern, **don't** refactor unrelated
   plumbing, **don't** partial-port a
   multi-card block. If the lane grows past
   one schema arm + one engine arm + one
   card, back out, document the reason in
   `wave4-blockers.md`, and pick a smaller
   next lane.

3. **Implement**: schema → engine → sample
   card → dedicated test → ratchet.

   - **Schema**:
     `src/lib/game-state/card-scripts/schema.ts`
     is the one place for new fields. For
     each lane, follow the existing allow-list
     pattern. New fields should integrate into
     the chosen-X / additional-costs /
     affinity / grants / counter-ledger /
     cast-from-zone / mana-restriction /
     copy-permanent / creature-payment /
     aura-protection / until-eot-copy /
     `enter_choice` family when possible.
     Lanes 87 / 88 / 89 / 90 / 91 / 92 are
     engine-extensions on existing arms; the
     schema changes are likely small (a new
     `event` value, a new `static.while_condition`
     field, a new `X` kind on `amount`, or a
     new `cost.sacrifice_self` arm).
   - **Engine**: the right home depends on
     the arm. For a new `event: "drawCard"`
     trigger (lane 87), update
     `detectTriggeredAbilities` in
     `abilities/triggered.ts` + the
     `evaluate.ts` evaluator's opponent-draw
     filter. For `cost.sacrifice_self` (lane
     88), extend the lane 63 sacrifice
     substrate in
     `additional-costs/` (the engine dispatch
     for `additionalCosts.sacrifice.target:
     "self"` already exists; verify it works
     on triggers, not just on cast). For a new
     `CreateToken` token kind (lane 89), extend
     the lane 66 substrate. For an X-count
     "creatures that died this turn" arm
     (lane 90), extend the lane 36 X-count
     reader in `keyword-actions/x-count.ts`.
     For `static.while_condition` (lane 91),
     add the gate in `refreshScriptedStatics`
     (the keyword-grant path is shipped). For
     an ETB "mv >= 4" intervening_if (lane
     92), extend `evaluateInterveningIfClause`
     to recognize the new clause shape.
   - **Sample card**: each lane updates one
     existing card JSON (Midnight Snack /
     Needletooth Pack / Gorehorn Raider /
     Scrawling Crawler / Twinblade Paladin /
     Drogskol Reaver) to add the deferred
     second half of its oracle.
   - **Tests**: dedicated `*.test.ts` file
     per lane, colocated in
     `src/lib/game-state/__tests__/`.

4. **Run checks (in the worktree)**:

   - `PATH="$PWD/node_modules/.bin:$PATH"
     npx tsx
     scripts/build-card-script-index.ts`
   - `PATH="$PWD/node_modules/.bin:$PATH"
     npm test --silent` (full suite — must
     be all green; the AI `forge-gate` /
     `forge-selfplay` / `expert-agent` "is
     deterministic for a seed" flake is
     known — re-run once if it hits, then
     move on).
   - `PATH="$PWD/node_modules/.bin:$PATH"
     npm run typecheck` (must be clean).
   - `PATH="$PWD/node_modules/.bin:$PATH"
     npm run lint` (0 errors; warnings OK).
   - `PATH="$PWD/node_modules/.bin:$PATH"
     node
     scripts/check-engine-size-budget.mjs`
     (must pass; budget currently 3100 lines
     for `schema.ts`, measured 3050 after
     lane 79). Bump the budget rather than
     fragmenting the family. Update the
     docstring block in
     `scripts/check-engine-size-budget.mjs`
     with a one-paragraph history entry (the
     existing entries are a good template).
   - `PATH="$PWD/node_modules/.bin:$PATH"
     npm run ratchet:test-count` (rewrites
     anchored doc blocks when test count
     changes). If the ratchet times out (the
     AI flake mid-ratchet), use the `--live
     <counts.json>` fallback at
     `scripts/ratchet-test-count.mjs` (skips
     the live Jest run; the Wave 4.8
     follow-up 8 lanes 75b / 75c / 75d used
     this fallback, as did follow-up 11
     lanes 82 / 83 / 84 / 85 / 86).
   - **Bundle-size check (only when the lane
     grows the engine surface that the
     client bundle pulls in)**: `rm
     node_modules` (the symlink) and `npm
     ci`, then `npm run build`, then `node
     scripts/check-bundle-budget.mjs
     --check`. If the lane grew the engine
     and the bundle check fails, re-capture
     the budget: `node
     scripts/check-bundle-budget.mjs
     --capture` and commit the updated
     `config/bundle-budget.json` alongside
     the lane's other changes.

5. **Commit**: `git add -A &&
   GIT_AUTHOR_NAME="Planar Nexus Agent"
   GIT_AUTHOR_EMAIL="agent@planar-nexus.local"
   GIT_COMMITTER_NAME="Planar Nexus Agent"
   GIT_COMMITTER_EMAIL="agent@planar-nexus.local"
   git commit -F COMMIT_MSG.txt`. Then `git
   rm --cached COMMIT_MSG.txt &&
   GIT_AUTHOR_NAME="Planar Nexus Agent"
   GIT_AUTHOR_EMAIL="agent@planar-nexus.local"
   GIT_COMMITTER_NAME="Planar Nexus Agent"
   GIT_COMMITTER_EMAIL="agent@planar-nexus.local"
   git commit --amend --no-edit && rm
   COMMIT_MSG.txt`. Then `git push
   --force-with-lease origin <branch>`. The
   Wave 4.8 follow-up 5 process learned:
   `git commit` without the env vars picks
   up the husky global git config and the
   commit shows up under the wrong author.
   Use the env vars explicitly, on every
   `git commit` (and on every `git commit
   --amend`).

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
  `scrawling-crawler-draws-life` for lane 87,
  `midnight-snack-sacrifice-cost` for lane 88,
  `gorehorn-raider-goblin-token` for lane 89,
  `needletooth-pack-draw-count` for lane 90,
  `twinblade-paladin-life-static` for lane 91,
  `drogskol-reaver-mv-4-etb` for lane 92).
- **Commit subject**: lower-case, min 10
  chars, type from `feat fix docs style
  refactor test chore revert`. Wave 4.8 saw
  `header-case` linting on commitlint —
  lowercase is enforced; write the subject
  in lowercase from the start.
- **Reference #2487 / #2614 in the commit
  body and the PR body so the
  cross-references stay tight.** Reference
  the specific card (e.g. `Scrawling
  Crawler (FDN 132)`) for lane 87.
- **Conventional Commits**. Never check
  in `COMMIT_MSG.txt` (amend-rm before
  pushing) or `PR_BODY.txt` (write it
  AFTER the commit, per the Wave 4.8
  follow-up 3 process note).
- **Test count**: ratchet in the same
  commit as any test count change, before
  pushing. `test-count-docs-guard`
  re-measures live Jest and fails on any
  drift in `docs/onboarding.md` or
  `docs/TEST_VIDEO_FIXTURES.md`.
- **Engine-size budget**: 3100 lines for
  `schema.ts` (the Wave 4.8 follow-up 8
  lane 75d bump, holding at 3050 after
  lane 79 and follow-up 11). Lanes 87-92
  may push the schema beyond 3050; if a
  lane needs more, bump the budget in the
  SAME commit per the Wave 4.8 follow-up
  handoff's process note. Update the
  docstring block in
  `scripts/check-engine-size-budget.mjs`
  with a one-paragraph history entry (the
  existing entries are a good template).
- **Bundle-size budget**: lanes that grow
  the engine surface (likely all of these
  — most add a new op / static arm) need
  the bundle re-captured. Follow the
  Process step 4 above.
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

- **Don't ask the user between lanes.**
  Pick the next gap autonomously and ship
  it. The priority queue is:
  1. Lane 87 (Scrawling Crawler's
     opponent-draws static — quick warmup).
  2. Lane 88 (Midnight Snack's
     sacrifice-self cost).
  3. Lane 89 (Gorehorn Raider's 1/1 red
     Goblin token).
  4. Lane 90 (Needletooth Pack's draw-count
     X).
  5. Lane 91 (Twinblade Paladin's
     life-condition static).
  6. Lane 92 (Drogskol Reaver's
     "mv >= 4" ETB).
  After lane 87 ships, the loop continues
  to pick lanes autonomously from the
  queue. Lane 87 → 88 → 89 → 90 → 91 → 92.
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
  Wave 4.8 follow-up 11 hit it on every
  lane's first local run; the second /
  fourth local run absorbed it cleanly each
  time. Budget for 1-2 extra CI runs per
  lane to absorb the flake.
- **Turn budget: 40 turns per lane max**
  (per `AGENTS.md` §Turn Budget). If a
  single lane exceeds this, it's too big
  — back out, document, and pick a
  smaller one. The follow-up 12 lanes
  are larger than the follow-up 11 lanes
  (they extend schema + engine rather
  than just adding JSON) — they should
  each still fit under the 40-turn budget.
  If a lane discovers it needs more (e.g.
  lane 91's `static.while_condition`
  requires a new evaluator clause AND a
  new refresh pass hook), split it into
  two lanes and document.
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
either shipped or marked multi-lane blocker
(with a paragraph in `wave4-blockers.md`
documenting why), append a Wave 4.8
follow-up 12 loop done summary at the bottom
of `docs/card-scripts/wave4-blockers.md`
documenting the shipped lanes, the blocked
gaps with their #2614 plan work references,
and a fresh test-count snapshot. Then stop.

This loop covers lanes 87-92. Lane 61 is
parked; it requires a foundational
replacement-effect layer that doesn't exist
yet. Per the prior handoff's process note,
lane 61 is NOT the next lane in this loop.
Open a separate multi-lane plan for lane 61
when ready.

If lane 87 (the smallest prerequisite) is
blocked, that means the engine changed since
Wave 4.8 follow-up 11 and the loop should be
paused for human review before continuing.

## Process observations carried from previous loops

- The AI `forge-gate` / `forge-selfplay` /
  `expert-agent` "is deterministic for a seed"
  test is a known order-dependent flake on
  main. If a CI run shows only that test
  failing, `gh run rerun --failed` is the
  right move — do NOT amend the lane. Wave
  4.8 saw this at lane 54 + 55; Wave 4.8
  follow-up saw this at lane 56; Wave 4.8
  follow-up 6 hit this flake ONCE on lane
  72's local full-suite run; Wave 4.8
  follow-up 7 did not hit it on this loop's
  local run; Wave 4.8 follow-up 8 hit it
  locally on lanes 75b + 75c + 75d but
  CI's all-passing baselines (14153 /
  14147 / 14138 / 14128 passed respectively)
  are documented in `wave4-blockers.md` —
  use those values when the ratchet hits
  the flake mid-run. Wave 4.8 follow-up 9
  hit it once on the lane 75e full-suite
  run; the second run passed clean. Wave
  4.8 follow-up 10 hit it once locally on
  lane 78's full-suite run; the second run
  passed clean. Wave 4.8 follow-up 11 hit
  it on every lane's first local run; the
  second / fourth run passed clean each
  time. The follow-up 12 loop's
  "all-passing" baseline is 14218 passed
  out of 14225 total (the lane 86
  baseline). Budget for 1-2 extra CI runs
  per lane to absorb the flake.
- `ci-wait` can return `FAILED` on a
  freshly-opened PR with all checks still
  pending. Wait a second call to `ci-wait`
  to get a real verdict. (`sleep 60 && gh pr
  checks <PR>` is a good way to seed the
  API.)
- `npm run ratchet:test-count` is reliable;
  run it in the same commit as any test
  count change. If it hits the AI flake,
  use the `--live <counts.json>` fallback.
- The handoff's process rule on `git
  worktree remove`: the `--delete-branch`
  flag on `gh pr merge` only deletes the
  remote branch. The local worktree
  directory must be removed manually
  after exiting it (`git worktree remove
  ... && git branch -D ...`).
- Wave 4.8 lane 55 process observation:
  `git commit` without
  `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env
  vars picks up the husky global git config
  and the commit shows up under the wrong
  author. Use the env vars explicitly, on
  every `git commit` (and on every `git
  commit --amend`).
- Wave 4.8 follow-up 6 process observation:
  when the `npm run ratchet:test-count`
  script times out (or fails because of the
  AI flake mid-ratchet), the `--live
  <counts.json>` fallback at
  `scripts/ratchet-test-count.mjs` skips the
  live Jest run and uses a hand-built JSON.
  Used in Wave 4.8 follow-up 8 lanes 75b /
  75c / 75d and Wave 4.8 follow-up 11 every
  lane — the same fallback is acceptable
  here.
- Wave 4.8 follow-up 6 process observation:
  when merging a lane that adds tests, the
  `test-count-docs-guard` CI gate may show
  a conflict in the ratcheted test count
  block (the just-merged previous lane's
  number is lower than the current lane's).
  The resolution is to keep the higher value
  and re-run the ratchet on the merged
  branch.
- Wave 4.8 follow-up 10 process observation:
  when writing the blockers update as a
  separate workflow (NOT as part of a lane
  PR), use a `docs/`-prefixed branch and the
  `--no-verify` flag on `git commit` to
  bypass the husky pre-commit hook (which
  can fail on the commitlint subject when
  prettier has re-formatted a staged
  `COMMIT_MSG.txt` that the husky hook then
  deletes). The follow-up 12 loop writes the
  loop done summary at the end of the loop
  on a separate `docs/followup12-loop-done`
  branch.
- Wave 4.8 follow-up 11 process observation:
  the lane 86 test exercises `gainLife` →
  `detectTriggeredAbilities("lifeGain")` →
  `putTriggersOnStack` →
  `resolveScriptedAbility` end-to-end. The
  `lifeGain` triggers ride the same
  resolution path as the existing
  `phaseEnds` and `etb` triggers — no
  special handling needed.

## Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any
#  leftover from Wave 4.8 follow-up 11)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 743 / 14225 green
# then start lane 87 (Scrawling Crawler
# opponent-draws static) per the Process
# section.
```

End each lane with: `git log --oneline -1`
on main showing the new lane's commit, and
`grep "Test suites" docs/onboarding.md`
showing the bumped numbers. If those two
checks pass, you're ready to pick the next
lane from the priority queue and continue
the loop. After lane 92 ships, write the
loop done summary and stop.

## Notes on the engine surface for lane 87

(Scrawling Crawler opponent-draws static)

When implementing lane 87, the engine
surface is:

1. **Schema** (`schema.ts`): the existing
   `event: "drawCard"` arm already exists in
   the union — verify the trigger fires when
   the drawer is the OPPONENT of the source's
   controller. If not, add an `opponent_only`
   flag or extend `intervening_if` to match
   "whenever an opponent draws a card". Look
   at the existing `cardDraws` /
   `drawCard` event handling in
   `abilities/triggered.ts` +
   `evaluate.ts` to see if the
   opponent-filter is already there.

2. **Engine** (`interpret.ts` +
   `applyEffect`): the existing
   `LoseLife` op already handles
   `target: "player"` (most "lose 1 life"
   effects use it). Verify it routes to
   the drawer when the trigger is
   opponent-only. If the drawer is stored
   on the trigger context, use that; if
   not, add a `triggeringPlayer` read path.

3. **Sample card**:
   `cards/scrawling_crawler.json` — add
   a second trigger to the existing array:
   ```json
   {
     "text": "Whenever an opponent draws a card, that player loses 1 life.",
     "event": "drawCard",
     "subject": "self",
     "opponent_only": true,
     "effects": [
       {
         "op": "LoseLife",
         "amount": 1,
         "who": "opponent_who_drew"
       }
     ]
   }
   ```
   The exact `opponent_only` /
   `who: "opponent_who_drew"` shape
   depends on the existing schema — read
   the closest precedent and follow it.

4. **Test**: verify the trigger fires
   only when an OPPONENT draws (not when
   the controller draws), and that the
   loss-of-life resolution hits the
   opponent's life total, not the
   controller's.

Out of scope for lane 87 (each a follow-up
lane): the "you may" prompt for "you may
draw a card" (Skyship Buccaneer-style
later-payment); the "cards drawn by all
opponents" aggregation; the "draw N cards
where N = something" X-count path. Lane 87's
v1 minimum is the static + the
opponent-only filter.

## Notes on the engine surface for lane 88

(Midnight Snack sacrifice-self cost)

When implementing lane 88, the engine
surface is:

1. **Schema** (`schema.ts`): the existing
   `additionalCosts.sacrifice` arm
   (lane 63) already has
   `target: "self"` — but it lives on the
   SPELL's `additionalCosts`, not on the
   TRIGGER's effects. Verify whether the
   trigger's effect path can read
   `additionalCosts` (likely not; the
   trigger has its own `cost` slot in
   the schema, or the sacrifice cost is
   expressed as a `cost.sacrifice_self`
   arm on the trigger). The v1 minimum
   is: add `cost.sacrifice_self` to the
   trigger schema as an optional
   boolean; the engine dispatch in
   `putTriggersOnStack` / resolve-time
   prompts a yes/no sacrifice
   confirmation before the trigger's
   effects resolve; on decline, the
   trigger does nothing.

2. **Engine** (`trigger-system/stack-ops.ts`
   + `interpret.ts`): the
   `sacrifice_self` cost path mirrors
   the lane 60 `you_may` gate — at
   trigger resolution time, the engine
   produces a yes/no `waitingChoice`
   of type `sacrifice_self_prompt`. The
   player picks yes / no; if yes, the
   controller sacrifices Midnight Snack
   and the trigger resolves the Food
   token effect; if no, the trigger
   does nothing.

3. **Sample card**:
   `cards/midnight_snack.json` — add
   `cost.sacrifice_self: true` to the
   existing trigger.

4. **Test**: verify the trigger fires
   only when the controller can
   sacrifice Midnight Snack (the
   enchantment is on the battlefield
   under the controller's control), the
   trigger declines cleanly (no
   Food token created), the trigger
   accepts the sacrifice and creates
   the Food token, and the sacrificed
   Midnight Snack goes to the graveyard.

Out of scope for lane 88 (each a follow-up
lane): the X-cost-with-life-gained cost
(parallel to lane 32's X-cost-with-count);
the "you may pay X life; if you do, create
a Food token" path that uses BOTH a pay_life
cost AND a sacrifice cost. Lane 88's v1
minimum is the sacrifice-self cost alone.

## Notes on the engine surface for lane 89

(Gorehorn Raider 1/1 red Goblin token)

When implementing lane 89, the engine
surface is:

1. **Schema** (`schema.ts`): the existing
   `CreatePredefinedToken` substrate
   (lane 32) covers Treasure / Food / Clue
   only. Add either a generic `CreateToken`
   op (lane 66 has `embedded_static`,
   `power`, `toughness`, `color`,
   `keywords`) OR a new `token: "goblin"`
   arm on `CreatePredefinedToken` that
   uses the lane 32 substrate with a
   hard-coded `{"color": "R", "power":
   1, "toughness": 1, "subtype":
   "Goblin"}` shape. The v1 minimum is
   the new `token: "goblin"` arm.

2. **Engine** (`card-scripts/ops/create-token.ts` +
   `effect-resolution.ts`): extend the
   `CreatePredefinedToken` case in
   `interpret.ts` (currently handles
   `"treasure" | "food" | "clue"`) to
   handle `"goblin"` (or whatever the
   schema arm is named). The token
   substrate in `effect-resolution.ts`
   (`resolveTokenCreationEffect`) already
   accepts the `power` / `toughness` /
   `color` / `keywords` shape; the
   `"goblin"` arm passes those.

3. **Sample card**:
   `cards/gorehorn_raider.json` — chain
   the existing `DealDamage` effect with
   a new `CreatePredefinedToken` effect
   (same `intervening_if: "you attacked
   this turn"`, same `event: "etb"`,
   same `subject: "self"`).

4. **Test**: verify the trigger fires
   only when the controller has attacked
   this turn, that the trigger deals 2
   damage to the chosen target AND that
   the controller's battlefield has a
   new 1/1 red Goblin creature token.

Out of scope for lane 89 (each a follow-up
lane): the "may discard a card" cost on
Storm Fleet Spy (the handoff explicitly
defers this); the "create a 1/1 red Goblin
creature token with menace" (Redcap
Gutter-Dweller-style keywords-on-token);
the Storm Fleet Spy variant of the
Gorehorn Raider "discard-a-card" cost
(parallel pattern, separate card). Lane
89's v1 minimum is the 1/1 red Goblin
token chained after the existing
DealDamage.

## Notes on the engine surface for lane 90

(Needletooth Pack draw-count X)

When implementing lane 90, the engine
surface is:

1. **Schema** (`schema.ts`): the existing
   `X: "treasures" | "creatures" | "lands"`
   arm on `amount` (lane 36) covers the
   X-count pattern, but not "creatures that
   died this turn". Add a new
   `X: "creatures_died_this_turn"` arm.
   This reads `state.turn.creatureDiedThisTurn`
   (the boolean) but NOT the COUNT — for
   a count we need a separate counter
   ledger (`creaturesDiedThisTurnCount`).
   The v1 minimum is the boolean read; the
   count ledger is a follow-up lane.

2. **Engine** (`keyword-actions/x-count.ts` +
   `interpret.ts`): the X-count reader
   already returns the named count; add
   a `"creatures_died_this_turn"` arm that
   returns 1 if any creature died this turn
   (the boolean) or 0 otherwise. The lane
   90 v1 minimum is the boolean (draw 0 or
   1, depending on whether any creature
   died this turn). The lane 90 follow-up
   is the count ledger (draw N where N =
   number of creatures that died this
   turn).

3. **Sample card**:
   `cards/needletooth_pack.json` — add a
   second effect to the existing trigger:
   ```json
   {
     "op": "Draw",
     "amount": 1,
     "amount.X": "creatures_died_this_turn",
     "who": "you"
   }
   ```
   (The exact shape depends on the
   schema's existing `amount.X` arm; read
   the closest precedent — lane 36's
   "Smaug gets +X/+X where X is the number
   of Treasures you control" — and follow
   it.)

4. **Test**: verify the trigger fires
   only when a creature died this turn (the
   morbid `intervening_if`), and that the
   `PutCounters` +1/+1 effect (existing)
   AND the new `Draw` effect both
   resolve on the same trigger resolution
   when the morbid gate passes.

Out of scope for lane 90 (each a follow-up
lane): the count ledger (draw N where N =
the actual count of creatures that died);
the "this turn" → "this game" scope
extension (creatures that died this game
would need a separate counter); the
"until end of turn" variant (draw N cards
where N = creatures that died THIS turn is
already the v1 minimum). Lane 90's v1
minimum is the boolean draw-0-or-1.

## Notes on the engine surface for lane 91

(Twinblade Paladin life-condition static)

When implementing lane 91, the engine
surface is:

1. **Schema** (`schema.ts`): the existing
   `StaticSchema` (lane 40 forward) has
   `affects` / `power` / `toughness` /
   `keywords` / `X` but NO
   `while_condition` gate. Add a new
   `while_condition` field on
   `StaticSchema` that reads a string
   clause (parallel to the existing
   `intervening_if` on `TriggerSchema`).
   The v1 minimum is a single shape:
   `{ clause: "life >= N" }` (or
   `{ kind: "life_minimum", value: N }`).

2. **Engine** (`keyword-actions/scripted-statics.ts` +
   `refreshScriptedStatics` +
   `abilities/evaluate.ts`): the
   `refreshScriptedStatics` path
   already handles keyword grants on
   the source; the gate is evaluated
   in `evaluateWhileCondition` (new
   function, parallel to
   `evaluateInterveningIfClause`). The
   while-condition is checked when the
   static refreshes, NOT when the
   trigger resolves — a static's
   while-condition is a CR 603.2
   while-gate (parallel to
   `whileCondition` on
   `ParsedTriggeredAbility`).

3. **Sample card**:
   `cards/twinblade_paladin.json` — add a
   `statics` array (parallel to
   `aura.static` for enchantments) with:
   ```json
   {
     "text": "As long as you have 25 or more life, this creature has double strike and lifelink.",
     "affects": { "controller": "you", "self": true },
     "keywords": ["double strike", "lifelink"],
     "while_condition": { "kind": "life_minimum", "value": 25 }
   }
   ```
   The exact `affects.controller` /
   `affects.self` / `while_condition`
   shape depends on the schema extension
   chosen in step 1.

4. **Test**: verify the static is INERT
   when the controller has less than 25
   life (no double strike, no lifelink on
   Twinblade Paladin), the static
   ACTIVATES when the controller has 25+
   life (both keywords are present on the
   source), and the static DEACTIVATES
   again when the controller's life drops
   below 25 (the keywords are stripped).

Out of scope for lane 91 (each a follow-up
lane): the "as long as an opponent has
less than X life" variant (the
opponent-filter is a parallel schema arm);
the "this creature gets +1/+1 instead" /
"this creature gets +X/+X where X = your
life total" anthem variants (a separate
`power` / `toughness` while-condition);
the "you can't lose the game while you
control this creature" replacement-effect
layer (lane 61's territory). Lane 91's v1
minimum is the keyword-only
while-condition.

## Notes on the engine surface for lane 92

(Drogskol Reaver "mv >= 4" ETB)

When implementing lane 92, the engine
surface is:

1. **Schema** (`schema.ts`): the existing
   `intervening_if` arm on `TriggerSchema`
   already accepts arbitrary strings
   ("you attacked this turn", "a creature
   died this turn", etc.). The
   `evaluateInterveningIfClause` evaluator
   in `abilities/evaluate.ts` recognizes
   the existing patterns via regex
   (`RAID_CONDITION` /
   `MORBID_CONDITION`). Add a new
   pattern for "if its mana value is 4 or
   greater" / "if [target]'s mana value is
   N or greater". The v1 minimum is a
   single shape: `{ op: "gte", value: N }`
   for the mana-value comparison.

2. **Engine** (`abilities/evaluate.ts`):
   the evaluator reads the source's
   `cardData.cmc` (the printed mana value)
   and compares it to the gate's `value`
   using the gate's `op`. The
   `intervening_if` clause is parsed at
   trigger detection; the source's CMC is
   read from `state.cards[sourceId].cardData.cmc`.

3. **Sample card**:
   `cards/drogskol_reaver.json` — add a
   second trigger (or replace the
   existing `lifeGain` trigger with the
   full oracle — see step 4):
   ```json
   {
     "text": "Whenever a creature you control enters, if its mana value is 4 or greater, you gain life equal to its toughness.",
     "event": "etb",
     "subject": "any_creature",
     "controller": "you",
     "intervening_if": "mana value >= 4",
     "effects": [
       {
         "op": "GainLife",
         "amount.X": "toughness",
         "who": "you"
       }
     ]
   }
   ```
   The exact `subject` / `controller` /
   `intervening_if` / `amount.X` shape
   depends on the schema's existing
   ETB + intervening_if + X-on-amount
   arms; read the closest precedents
   (lane 36's Smaug + lane 28's Cackling
   Prowler) and follow them.

4. **Note**: Drogskol Reaver's full
   oracle is "Flying, Lifelink, Whenever
   you gain life, draw a card." (already
   scripted) + "Whenever a creature you
   control enters, if its mana value is 4
   or greater, you gain life equal to its
   toughness" (the lane 92 second
   trigger). The Flying / Lifelink
   keywords are typically handled by the
   ScryfallCard's `keywords` array; the
   FDN Scrawling rarity Drogskol Reaver
   JSON does NOT need a `keywords` field
   if the ScryfallCard mock carries them
   (see the existing Midnight Snack
   pattern — no `keywords` field, but the
   `cardData.keywords` carries the printed
   keywords).

5. **Test**: verify the trigger fires
   only when the entering creature has
   `cardData.cmc >= 4`, that the
   `GainLife` amount is the entering
   creature's `cardData.toughness`, and
   that the trigger is INERT for entering
   creatures with `cmc < 4`.

Out of scope for lane 92 (each a follow-up
lane): the "mana value 7 or greater"
arbitrary-threshold extension (the v1
minimum is `gte 4`); the "where X is the
mana value" X-on-amount variant (draw N
cards where N = the entering creature's
mana value, parallel to lane 36); the
Flying / Lifelink keyword grant via a
static (parallel to lane 40's chosen-X
anthem — Drogskol Reaver's printed
keywords already cover Flying / Lifelink
on the ScryfallCard mock). Lane 92's v1
minimum is the ETB + intervening_if
"mana value >= 4" + GainLife.toughness.