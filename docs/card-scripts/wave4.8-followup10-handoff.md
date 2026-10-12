# Wave 4.8 follow-up 10 handoff — Next session

## Mission

Continue the Wave 4.8 follow-up loop from where
Wave 4.8 follow-up 9 left off. The follow-up 9 loop
shipped lane 75e (PR #2762) — see
`docs/card-scripts/wave4-blockers.md` for the
per-lane summaries and
`docs/card-scripts/wave4.8-followup9-handoff.md`
for the prior handoff. **Lane 75 is the only
shipped family lane that landed in the follow-up
9 loop; the until-EOT copy family is complete.**

This loop is different from prior follow-ups: the
#2614 drafter-list loop has reached the point
where every single-lane gap the drafter list
needed has a clean home. The remaining
#2614-adjacent work is either (a) a
multi-lane/blocker (lane 61 — replacement effect
for death) that requires a foundational layer
that doesn't exist yet, or (b) the lane 75e
out-of-scope follow-ups (each tiny, each a
single-lane piece of meta-work on top of the
copy family). Lane 61 is parked per the
follow-up 2 handoff's process note (a separate
multi-lane plan). The lane 75e out-of-scope items
are a few hundred LOC each but each one is a
single-lane meta-rule on top of the copy
infrastructure.

The remaining work, in priority order (each is
a clean single-lane piece that fits the
aggressive loop's per-lane 40-turn budget):

1. **Lane 77 — Copy target with other layers**
   (the "copy a card that has a `become_copy`
   static and other layers" lane — lane 75e
   out-of-scope #4). The current snapshot helper
   consults the leaf's printed `cardData` for
   the overlay, but it does NOT roll the leaf's
   OTHER per-instance fields (e.g. `protectionFrom`,
   `removesAllAbilities`, `chosenTypeAdditions`,
   `chosenColorAdditions`, `scriptStaticPT`,
   `scriptStaticKeywords`) onto the source. A
   target like Akoumep Halberd (a `protectionFrom:
["red"]` static + a `become_copy` arm pointing
   at a Bear) would have its bear-copy
   characteristics overlaid onto the source, but
   the source would NOT pick up the bear's
   `protectionFrom: ["red"]` (the bear's static
   runs on the bear, not on the source). The v1
   minimum is to roll ONLY `protectionFrom` (the
   lane 71/76 substrate) — it's a one-line
   extension to the snapshot's `leafCardData` and
   to the overlay write phase. Other fields are
   each a follow-up lane. ~40-80 LOC + tests.

2. **Lane 78 — Cross-zones copy** (the
   "copy a card that's not in play" lane — lane
   75e out-of-scope #3). A `become_copy` static
   that points at a card in a graveyard (CR
   707.2 "copy a card that's not in play") — the
   target is in a non-battlefield zone, so the
   lane 75 / 75b / 75c / 75d overlay drop-branch
   fires today (the target isn't on the
   battlefield). The v1 minimum is to extend the
   overlay to read the target's `cardData` from
   the registry (`getCardDataByName` is already
   on the lane 75b path; the graveyard card has a
   `cardData` field whose `name` matches a
   registry entry). Cross-zone copy is
   battlefield-zone-only for the SOURCE (the
   source must be on the battlefield for the
   static to apply), but the target can be in any
   zone the engine tracks (graveyard, exile,
   hand, library, command). ~80-120 LOC + tests.

3. **Lane 79 — Mid-life copy chain (4-card
   chain)** (the "multi-card copy chains more
   than 3 cards" lane — lane 75e out-of-scope
   #1). The cycle guard's snapshot helper
   resolves 2- and 3-card chains in a single
   pass; the v1 minimum was bounded to 3 cards
   for risk. The 4+ card case is a recursive
   extension — the snapshot's `resolveCopyChain`
   already recurses, so the extension is
   primarily a test (verifying that 4- and
   5-card chains resolve in a single pass
   without overflow). ~30-60 LOC + tests
   (mostly test work; the recursive helper is
   already there).

4. **Lane 80 — Chosen creature_type
   `enter_choice` arm** (#2705, #2594 follow-up,
   from the "Out of scope (per Wave 4.5)" list
   - the open issues). The `enter_choice` schema
     arm shipped in lane 39 with v1 supporting
     `kind: "color"` only. The `kind:
"creature_type"` arm is the Adaptive Automaton
     enter-choice (and the heraldic pattern that
     rides lane 45's chosen-type anthem). v1
     minimum: a `chosenCreatureType: string | null`
     instance field on `CardInstance` (parallel to
     `chosenColor` from lane 39), a
     `resolveEnterChoice` arm for `kind:
"creature_type"`, and the engine arms that
     read the field (the lane 45 chosen-type
     anthem already reads `source.chosenCreatureType`
     via the `subtype: "chosen"` sentinel — the
     field needs to exist for the sentinel to
     resolve). ~80-120 LOC + tests. This unblocks
     scripting several more drafter-list cards
     (Adaptive Automaton's enter choice half is
     already wired; the chosen-type anthem half
     rides lane 45; the missing piece is the
     `enter_choice` arm + the field).

5. **Lane 81 — Chosen card name `enter_choice`
   arm** (#2708, #2708 phase 2b — Sorcerous
   Spyglass chosen-name gate). The
   `enter_choice: { kind: "chosen_name" }` arm
   that lets a permanent enter with a chosen
   card name (Sorcerous Spyglass, Pithing Needle,
   the lane 50 chosen-name block). v1 minimum:
   a `chosenCardName: string | null` field on
   `CardInstance` (already declared in
   `types/cards.ts` as forward-compatible
   nullable per lane 48 — the v1 default is
   `null`), a `resolveEnterChoice` arm for
   `kind: "chosen_name"`, and the engine arms
   that read the field (the lane 50 chosen-name
   block static reads `source.chosenCardName`
   via the `affects.chosen_name_block` arm — the
   field needs to exist for the static to
   resolve). ~60-100 LOC + tests. This unblocks
   scripting Sorcerous Spyglass and Pithing
   Needle.

6. **Lane 82 — Midnight Snack (FDN 65)** (the
   "Skipped, single-lane, deferred" #1). All
   plumbing shipped (raid + `phaseEnds` +
   `intervening_if` + `CreatePredefinedToken` for
   Food). Single-card sample. No schema change.
   ~40-60 LOC for the card JSON + a small
   test. The smallest possible lane — useful as
   a warmup to confirm the aggressive loop's
   machinery still works after lane 75e's engine
   change.

7. **Lane 83 — Needletooth Pack, Wardens of the
   Cycle (FDN)** (the "Skipped" #2 — end-step +
   morbid `intervening_if` per the lane 28
   Cackling Prowler pattern). Two-card samples.
   All plumbing shipped. ~30-50 LOC per card
   - a small test. Useful as a second warmup.

8. **Lane 84 — Gorehorn Raider, Storm Fleet
   Spy** (the "Skipped" #3 — raid + `ETB`,
   exercises `attackedThisTurn` on ETB). All
   plumbing shipped (raid + ETB triggers are
   well-established). ~30-50 LOC per card +
   test.

9. **Lane 85 — Scrawling Crawler** (the
   "Skipped" #5 — `upkeep` + `each_player`).
   All plumbing shipped in lane 25. Single
   warmup-style card. ~30-50 LOC + test.

10. **Lane 86 — Ajani's Pridemate,
    Twinblade Paladin, Drogskol Reaver** (the
    "Skipped" #4 — life-gain trigger). All
    plumbing is partially supported (Ajani's
    Pridemate has a `lifeGain` test in the
    lane 26 follow-up). Three-card sample.
    ~50-80 LOC + tests.

Lane 61 (replacement effect for death) is
parked per the Wave 4.8 follow-up 2 handoff's
process note. The engine has no general
replacement-effect layer, so lane 61 is
foundational work, not a normal lane. Open it
as a separate multi-lane plan, NOT as the next
lane in this loop. After lane 77 ships, the
aggressive loop continues to pick lanes
autonomously from the priority queue above
(lane 78 → 79 → 80 → ...). Don't ask the user
between lanes.

## State at session start

- **HEAD**: the follow-up 9 lane 75e PR merge
  commit + the loop done summary commit on
  main. The until-EOT copy family (lane 75 /
  75a / 75b / 75c / 75d / 75e) is complete.
- **735 suites / 14167 cases** (14160 passed
  - 7 skipped). The Wave 4.8 follow-up 10
    loop adds to these.
- **Lint 0 errors, typecheck clean** (the
  previous baseline).
- **Engine-size budget**: 3100 lines for
  `schema.ts` (bumped 3000 → 3100 in Wave
  4.8 follow-up 8 lane 75d, holding at 3050
  after lane 75e). Each candidate lane
  estimates its own schema footprint:
  - Lane 77 (copy target with other layers)
    is engine-only on `keyword-actions/` and
    `types/cards.ts`; expected to add a small
    per-instance field for the roll (parallel
    to `protectionFrom: string[]`) — likely
    20-40 LOC of schema. May need a small
    bump.
  - Lane 78 (cross-zones copy) is engine-only
    on `keyword-actions/`; no schema change
    expected.
  - Lane 79 (4-card chain) is test-only; no
    schema change, no engine change beyond
    enabling recursion depth (already
    enabled).
  - Lane 80 (chosen creature_type
    `enter_choice` arm) is the schema-
    additive of the lot — needs a new
    `kind: "creature_type"` arm on
    `enter_choice` + a `chosenCreatureType:
string | null` instance field + a
    `resolveEnterChoice` arm. ~80-120 LOC of
    schema; likely a small bump (3100 →
    3150).
  - Lane 81 (chosen_name `enter_choice`
    arm) is similar — `kind: "chosen_name"`
    arm + the `chosenCardName` field that
    already exists as nullable on
    `CardInstance`. ~60-100 LOC of schema.
    May fit under 3150.
  - Lanes 82-86 (Skipped drafter-list
    items) are card JSON + small tests; no
    schema change, no engine change.
    The historical precedent is "bump the
    budget rather than fragmenting the
    chosen-X / additional-costs / affinity /
    grants / counter-ledger / cast-from-zone
    / mana-restriction / copy-permanent /
    creature-payment / aura-protection /
    until-eot-copy family" — apply the same
    rule to the new lanes (chosen-X
    / `enter_choice` family is on the same
    trajectory).
- **Bundle-size budget**:
  `config/bundle-budget.json` was re-captured
  in earlier Wave 4.8 loops. The new lanes
  are mostly engine-only (lanes 77-81) or
  card-JSON only (lanes 82-86) — if a lane
  grows the engine surface that the client
  bundle pulls in (e.g. lane 80's
  `resolveEnterChoice` arm), re-capture the
  budget in the same commit (the
  `rm node_modules && npm ci && npm run
build` dance from the handoff's process
  section).
- **Working directory**:
  `/home/alex/Projects/planar-nexus` (clean).
- **Open issues relevant to this loop**:
  - #2614 (the full drafter-list plan work
    — covers the Mono-Red Aggro +
    Mono-Green Landfall scripting).
  - #2705 (chosen creature_type
    `enter_choice` arm — lane 80).
  - #2708 (chosen_name `enter_choice` arm
    for Sorcerous Spyglass — lane 81).
  - #2487 (the parent epic for card scripts
    as data).
- **Just-shipped context**: lane 75e
  (PR #2762) is the most recent merge. The
  until-EOT copy family is complete (lane 75
  - 75a + 75b + 75c + 75d + 75e). The
    cycle-guard snapshot helper
    (`buildStaticCopyChainSnapshot` /
    `buildAuraCopyChainSnapshot` in
    `src/lib/game-state/keyword-actions/copy-chain.ts`)
    is the new infrastructure; the lane 77
    roll-other-layers lane is a small
    extension to it.

## Process (mandatory, identical to Wave 4 /

4.5 / 4.6 / 4.7 / 4.7 follow-up / 4.7 phase 2
/ 4.8 / 4.8 follow-up / 4.8 follow-up 2 / 4.8
follow-up 3 / 4.8 follow-up 4 / 4.8 follow-up 5
/ 4.8 follow-up 6 / 4.8 follow-up 7 / 4.8
follow-up 8 / 4.8 follow-up 9)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
/tmp/opencode/wave414-lane<N>-<slug> -b
<type>/<scope> origin/main` where `<N>`
   starts at 87 and `<slug>` is kebab-case,
   min 10 chars. `ln -s
/home/alex/Projects/planar-nexus/node_modules
/tmp/opencode/wave414-lane<N>-<slug>/node_modules`
   so test/lint/typecheck skip a fresh
   install. Verify with `ls
/tmp/opencode/wave414-lane<N>-<slug>/node_modules/.bin/jest`.
   Note: the symlinked `node_modules` will
   fail `npm run build` (Turbopack errors on
   the `node_modules` symlink pointing
   outside the worktree root). The
   bundle-size budget re-capture requires a
   real build, so when a lane grows the
   engine surface that the client bundle
   pulls in (e.g. lane 80's
   `resolveEnterChoice` arm), `rm` the
   symlink and run `npm ci` first to do the
   build.

2. **Scope discipline**: each lane is one
   self-contained change. Schema + engine +
   sample card + dedicated test is fine.
   **Don't** ship a second sample card for a
   different pattern, **don't** refactor
   unrelated plumbing, **don't** partial-port
   a multi-card block. If the lane grows
   past one schema arm + one engine arm + one
   card, back out, document the reason in
   `wave4-blockers.md`, and pick a smaller
   next lane.

3. **Implement**: schema → engine → sample
   card → dedicated test → ratchet.

   - **Schema**:
     `src/lib/game-state/card-scripts/schema.ts`
     is the one place for new fields. For
     each lane, follow the existing allow-list
     pattern. New fields should integrate
     into the chosen-X / additional-costs /
     affinity / grants / counter-ledger /
     cast-from-zone / mana-restriction /
     copy-permanent / creature-payment /
     aura-protection / until-eot-copy /
     `enter_choice` family when possible.
     Lane 77 is engine-only (small per-
     instance field on `types/cards.ts`,
     parallel to `protectionFrom: string[]`);
     lane 78 is engine-only; lane 79 is
     test-only; lane 80 is schema-additive
     (new `kind: "creature_type"` arm + new
     `chosenCreatureType: string | null`
     instance field); lane 81 is
     schema-additive (new `kind:
"chosen_name"` arm + the
     `chosenCardName` field that already
     exists as nullable); lanes 82-86 are
     card-JSON only. Bump the engine-size
     budget rather than fragmenting the
     family.
   - **Engine**: the right home depends on
     the arm. For copy-family arms, update
     `refreshScriptedStatics` (lane 75 +
     75b + 75c + 75e) AND `refreshAuraBonuses`
     (lane 75d) AND `turn-phases.ts` for
     end-of-turn cleanup. For
     `enter_choice` arms, update
     `resolveEnterChoice` and the schema's
     `enter_choice: { kind: "..." }` union.
   - **Sample card**: ship one real card
     JSON per lane when the handoff lists
     one (lanes 77, 78, 79, 80, 81 — the
     schema-additive lanes — need at least
     one card sample per the test harness
     pattern). Lanes 82-86 are the drafter-
     list cards themselves.
   - **Tests**: dedicated `*.test.ts` file
     per lane, colocated in
     `src/lib/game-state/__tests__/`.

4. **Run checks (in the worktree)**:

   - `PATH="$PWD/node_modules/.bin:$PATH" npx
tsx scripts/build-card-script-index.ts`
   - `PATH="$PWD/node_modules/.bin:$PATH" npm
test --silent` (full suite — must be
     all green; the AI `forge-gate`/
     `forge-selfplay` / `expert-agent` "is
     deterministic for a seed" flake is
     known — re-run once if it hits, then
     move on).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm
run typecheck` (must be clean).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm
run lint` (0 errors; warnings OK).
   - `PATH="$PWD/node_modules/.bin:$PATH"
node scripts/check-engine-size-budget.mjs`
     (must pass; budget currently 3100
     lines for `schema.ts`, measured 3050
     after lane 75e). Bump the budget rather
     than fragmenting the family. Update the
     docstring block in
     `scripts/check-engine-size-budget.mjs`
     with a one-paragraph history entry
     (the existing entries are a good
     template).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm
run ratchet:test-count` (rewrites
     anchored doc blocks when test count
     changes).
   - **Bundle-size check (only when the
     lane grows the engine surface that the
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
  `copy-target-other-layers` for lane 77,
  `cross-zones-copy` for lane 78,
  `four-card-chain` for lane 79,
  `creature-type-enter-choice` for lane 80,
  `chosen-name-enter-choice` for lane 81,
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
  tight.** Reference the specific issue
  (#2705, #2708) for lanes 80 + 81
  respectively.
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
  lane 75d bump, holding at 3050 after
  lane 75e). Lanes 77, 78, 79, 82-86
  should fit under 3100 individually.
  Lanes 80 + 81 may push past 3100; bump
  the budget in the SAME commit per the
  Wave 4.8 follow-up handoff's process
  note. Update the docstring block in
  `scripts/check-engine-size-budget.mjs`
  with a one-paragraph history entry
  (the existing entries are a good
  template).
- **Bundle-size budget**: most lanes are
  engine-only or card-JSON only; no
  client-bundle re-capture expected. If a
  lane grows the engine surface, re-capture
  the budget in the same commit (see
  Process step 4).
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
  1. Lane 77 (copy target with other
     layers).
  2. Lane 78 (cross-zones copy).
  3. Lane 79 (4-card chain — quick).
  4. Lane 80 (creature_type
     `enter_choice`).
  5. Lane 81 (chosen_name
     `enter_choice`).
  6. Lane 82 (Midnight Snack — quick
     warmup).
  7. Lane 83 (Needletooth Pack + Wardens
     of the Cycle).
  8. Lane 84 (Gorehorn Raider + Storm
     Fleet Spy).
  9. Lane 85 (Scrawling Crawler).
  10. Lane 86 (Ajani's Pridemate +
      Twinblade Paladin + Drogskol
      Reaver).
      After lane 77 ships, the loop continues
      to pick lanes autonomously from the
      queue. Lane 77 → 78 → 79 → 80 → 81 → 82
      → 83 → 84 → 85 → 86.
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
  run (CI was clean throughout); Wave 4.8
  follow-up 8 hit it locally on lanes
  75b + 75c + 75d but the all-passing CI
  baseline (14153 passed on lane 75d,
  14147 on lane 75c, 14138 on lane 75b,
  14128 on lane 75) is documented in
  `wave4-blockers.md` — use those values
  when the ratchet hits the flake
  mid-run. Wave 4.8 follow-up 9 hit it
  once on the lane 75e full-suite run;
  the second run passed clean. The
  follow-up 10 loop's "all-passing"
  baseline is 14160 passed out of 14167
  total (the lane 75e baseline). Budget
  for 1-2 extra CI runs per lane to
  absorb the flake.
- **Turn budget: 40 turns per lane max**
  (per `AGENTS.md` §Turn Budget). If a
  single lane exceeds this, it's too big
  — back out, document, and pick a
  smaller one. Lane 80 (creature_type
  `enter_choice` arm) is the riskiest
  schema-additive of the lot; consider
  deferring it if a lane exceeds the
  budget.
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
append a Wave 4.8 follow-up 10 loop done
summary at the bottom of
`docs/card-scripts/wave4-blockers.md`
documenting the shipped lanes, the
blocked gaps with their #2614 plan work
references, and a fresh test-count
snapshot. Then stop.

This loop covers lanes 77-86. Lane 61 is
parked; it requires a foundational
replacement-effect layer that doesn't
exist yet. Per the prior handoff's
process note, lane 61 is NOT the next
lane in this loop. Open a separate
multi-lane plan for lane 61 when ready.

If lane 77 (the smallest prerequisite) is
blocked, that means the engine changed
since Wave 4.8 follow-up 9 and the loop
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
  the second run passed clean. The
  follow-up 10 loop's "all-passing"
  baseline is 14160 passed out of 14167
  total (the lane 75e baseline). Budget
  for 1-2 extra CI runs per lane to
  absorb the flake.
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
- Wave 4.8 follow-up 5 process
  observation: when adding a new op on
  `EffectSchema` (e.g. lane 70's
  `CopyPermanent`), the per-op reference
  module under
  `src/lib/game-state/card-scripts/ops/`
  and the entry in
  `src/lib/game-state/card-scripts/ops/registry.ts`
  are required to keep the LLM-drafted
  scripts pipeline in sync. The `covers
every op the schema accepts` test
  enforces parity — without the per-op
  module + registry entry, the test
  fails and the engine doesn't know
  about the new op. Lane 77 doesn't add
  an EffectSchema op, so this doesn't
  apply.
- Wave 4.8 follow-up 6 process
  observation: when adding a new
  meta-static arm on `StaticSchema`
  (e.g. lane 76's
  `AuraStaticSchema.protectionFrom`),
  the refine list at the bottom of
  `AuraStaticSchema` must be extended to
  accept the new arm as a stand-alone
  static. Synthetic test scripts that
  use the new arm alone (without any
  other ability) parse only if the arm
  is in the refine list. Lane 77
  doesn't add a StaticSchema arm, so
  this doesn't apply.
- Wave 4.8 follow-up 7 process
  observation: type-check caught an
  `if (zone)` narrowing guard pattern
  in the test file that the local `tsc
--noEmit` happened to pass on but
  CI's `tsc --noEmit` flagged — the
  test file used
  `movedZones.get(gyKey) ?? { visibility:
... }` as a fallback and the spread
  `{ ...gy }` propagated the union
  type. The fix was to `if (gy) {
movedZones.set(...) }` to narrow the
  type. **Lesson: never fall back to a
  hand-shaped zone literal when
  `state.zones` is well-typed — `if
(zone)` is the safe pattern.** If you
  see a TS2345 type error locally but
  CI passes, run `tsc --noEmit` again
  with `--pretty false` and look for
  the union type propagation.
- Wave 4.8 follow-up 8 process
  observation (lane 75a): a typed
  `animatedUntilEndOfTurn: boolean`
  field signature was added to
  `CardInstance` so the EOT cleanup
  rollback can distinguish "spell-effect-
  set overlay" from "static-driven
  overlay".
- Wave 4.8 follow-up 8 process
  observation (lane 75b): the test file
  used an `animatedUntilEndOfUntil`
  field name with an extra trailing `I`
  (typo). The field on the card is
  `animatedUntilEndOfTurn` (full `n`).
  **Lesson: spell-check field names
  against the type definition in
  `src/lib/game-state/types/cards.ts`
  before writing the assertion.** Wave
  4.8 follow-up 8 lane 75d had the same
  typo and was fixed via bulk `sed -i`
  in
  `src/lib/game-state/keyword-actions/aura-bonus.ts`.
- Wave 4.8 follow-up 8 process
  observation (lane 75d): the engine
  change to `refreshAuraBonuses`
  introduced a new
  `auraCopyOfTargetByEnchantedCard:
Map<enchantedCardId, { kind: "id";
targetId; fromAura }>` map for the
  lane 75d overlay.
- Wave 4.8 follow-up 8 process
  observation (lane 75b / 75c / 75d):
  every time the ratchet hits the
  `forge-gate` mid-run flake, the docs
  were updated by hand to match CI's
  all-passing baseline (`wave4-blockers.md`
  keeps a running tally of the CI
  baselines per lane — use those values
  when the ratchet times out). For
  lane 75d the running baseline is
  14153 passed out of 14160 total; the
  follow-up 10 loop's "all-passing"
  baseline is 14160 passed out of
  14167 total (the lane 75e baseline).
- Wave 4.8 follow-up 9 process
  observation (lane 75e): the
  `setByAura` marker on
  `animatedUntilEndOfTurn` was added
  to fix a pre-existing latent bug —
  `refreshScriptedStatics` was
  dropping Aura overlays on the
  enchanted card because it couldn't
  distinguish them from static-driven
  overlays. The marker is set by
  `refreshAuraBonuses` and read by
  `refreshScriptedStatics`. The Aura
  refresh is the canonical drop site;
  the EOT cleanup
  (`clearUntilEndOfTurnPT`) drops the
  overlay at end-of-turn. **Lesson:
  when a refresh pass encounters a
  card with `animatedUntilEndOfTurn`
  but no static-driven `become_copy`
  arm, check the `setByAura` /
  `setBySpellEffect` markers before
  dropping the overlay.**

## Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any
#  leftover from Wave 4.8 follow-up 9)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 735 / 14167 green
# then start lane 77 (copy target with
# other layers, #2614 follow-up) per the
# Process section
```

End each lane with: `git log --oneline -1`
on main showing the new lane's commit, and
`grep "Test suites" docs/onboarding.md`
showing the bumped numbers. If those two
checks pass, you're ready to pick the next
lane from the priority queue and continue
the loop. After lane 86 ships (or any lane
is marked multi-lane blocker), write the
loop done summary and stop.

## Notes on the engine surface for lane 77

(copy target with other layers)

When implementing lane 77, the engine change
is a small extension to
`buildStaticCopyChainSnapshot` /
`buildAuraCopyChainSnapshot` in
`src/lib/game-state/keyword-actions/copy-chain.ts`.
The current snapshot's
`leafCardDataBySourceId` / `leafCardDataByEnchantedCard`
map is a `ScryfallCard` — the printed
`cardData` from the registry, with no
per-instance fields. Lane 77 extends the
map to a richer shape that ALSO carries the
leaf's per-instance fields, and the overlay
write phase rolls them onto the source.

The v1 minimum is to roll ONLY
`protectionFrom: string[]` (the lane 71/76
substrate). The per-instance field already
exists on `CardInstance` (lane 71). The
extension is:

1. `CopyChainSnapshot.leafPerInstanceBySourceId:
Map<string, { protectionFrom?: string[];
}>` — a parallel map for per-instance
   fields.
2. The snapshot's walk reads the leaf's
   per-instance fields (parallel to how
   it reads the leaf's printed
   `cardData`).
3. The overlay write phase merges the
   leaf's `protectionFrom` onto the
   source's `protectionFrom` (union
   semantics — multiple `become_copy`
   overlays stack their protection, and
   the source's existing protection is
   preserved).

Other fields (e.g. `removesAllAbilities`,
`chosenTypeAdditions`,
`chosenColorAdditions`, `scriptStaticPT`,
`scriptStaticKeywords`) are each a
follow-up lane. Each is a small extension
to the snapshot's per-instance map.

The smallest sample card is a pair of
synthetic statics — one source that copies
a target, and a target whose own static
grants it `protectionFrom: ["red"]`. The
test verifies that the source picks up
the leaf's `protectionFrom: ["red"]` (a
red spell cannot target the source, a red
creature cannot block the source, etc.)
and that the change-detection diff
preserves the protection across refreshes.

Out of scope for lane 77 (each a follow-up
lane): `removesAllAbilities` roll,
`chosenTypeAdditions` roll,
`chosenColorAdditions` roll, P/T and
keyword rolls, multi-source
`protectionFrom` unions (e.g. two
`become_copy` targets with overlapping
protection), Aura-driven `protectionFrom`
roll (the lane 75d → lane 77 cross-site
roll is parallel to the cross-site chain
resolution from lane 75e).

## Notes on the engine surface for lane 78

(cross-zones copy)

When implementing lane 78, the engine
change is in `refreshScriptedStatics` (and
the Aura mirror in `refreshAuraBonuses`).
The current overlay's `kind: "id"` branch
checks `target.currentZoneKey?.endsWith("-battlefield")`
and drops the overlay if the target is
not on the battlefield. Lane 78 removes
the battlefield-only constraint when the
target's zone is tracked (graveyard,
exile, hand, library, command) AND the
target's `cardData` is in the registry
(via `getCardDataByName`). The v1
minimum: replace the `targetOnField` check
with a "target is in a tracked zone"
check (any zone the engine tracks, not
just `-battlefield`). The overlay reads
the target's printed `cardData` from
`target.cardData` directly (the
`cardData` field is preserved across zone
moves; the lane 75 overlay's
`animatedUntilEndOfTurn` snapshot
infrastructure is unaffected — only the
zone-membership check changes).

The smallest sample card is a single
synthetic static that copies a card from
the graveyard (CR 707.2 "copy a card
that's not in play"). The test verifies
that the source overlays the graveyard
card's printed characteristics AND that
the overlay is dropped when the target
moves to an untracked zone (e.g. an
un-implemented zone the engine doesn't
track).

Out of scope for lane 78 (each a follow-up
lane): "copy a card from hand" with
rearrangement (e.g. the player chooses
which card to copy from hand; lane 33
already covers the chosen-target
mechanics for tokens), "copy a card from
library" with a search (the
`SearchLibrary` op is a separate multi-lane
work), "copy a card from command zone"
(requires the command-zone substrate).

## Notes on the engine surface for lane 79

(4-card chain)

When implementing lane 79, the engine
change is in the test file
(`src/lib/game-state/__tests__/lane79-4-card-chain.test.ts`).
The cycle guard's `resolveCopyChain` helper
in
`src/lib/game-state/keyword-actions/copy-chain.ts`
already recurses without a depth bound
(the recursion is bounded by the chain
length, which is bounded by the
battlefield size in practice). The v1
minimum is to add a test that exercises
4- and 5-card chains and verifies the
chain resolves in a single pass. The
engine change is nil (the helper is
already correct); the work is test
coverage. ~30-60 LOC.

The smallest sample card is four
synthetic statics on four distinct cards
named A, B, C, D where each copies the
next. The test verifies that A's overlay
is D's printed characteristics in a
single refresh pass.

Out of scope for lane 79: 6+ card chains
(each is a follow-up lane; the recursion
handles them, the test coverage just
scales).

## Notes on the engine surface for lane 80

(creature_type `enter_choice` arm)

When implementing lane 80, the engine
change is a new arm on the
`enter_choice` schema:

1. New `kind: "creature_type"` arm on
   `enter_choice` (parallel to the
   `kind: "color"` arm from lane 39).
2. New `chosenCreatureType: string |
null` instance field on
   `CardInstance` (parallel to
   `chosenColor` from lane 39; the field
   is forward-compatible nullable so
   cards without the new arm keep
   working).
3. New `resolveEnterChoice` arm for
   `kind: "creature_type"` (parallels
   the `kind: "color"` arm in
   `resolveEnterChoice`).
4. New `waitingChoice` type for
   `kind: "creature_type"` (parallels
   the `kind: "color"` waitingChoice
   type).

The lane 45 chosen-type anthem
(`affects.subtype: "chosen"` sentinel
in `staticAffects`) ALREADY reads
`source.chosenCreatureType` — the
field just needs to exist for the
sentinel to resolve at runtime. The
test verifies that a card with
`enter_choice: { kind: "creature_type"
}` resolves to a `chosenCreatureType`
on entry AND that the lane 45 anthem
reads the field correctly.

The bump to the engine-size budget
(3100 → 3150) is in the SAME commit.

Out of scope for lane 80 (each a
follow-up lane): the
`"color_and_creature_type"` dual
choice (lane 56), the
`kind: "player"` choice (from the
Wave 4.7 handoff's forward-compat
list), the chosen card type
restriction (e.g. "choose a creature
type; creatures of that type get
+1/+1" — that's lane 24's Heraldic
Banner pattern, already shipped in
Wave 4.7 lane 40).

## Notes on the engine surface for lane 81

(chosen_name `enter_choice` arm)

When implementing lane 81, the engine
change is a new arm on the
`enter_choice` schema:

1. New `kind: "chosen_name"` arm on
   `enter_choice` (parallel to lane
   80's `kind: "creature_type"`).
2. The `chosenCardName: string | null`
   field on `CardInstance` is
   forward-compatible nullable per
   lane 48 — it already exists as a
   declared-but-unset field. The lane
   81 change is the `resolveEnterChoice`
   arm that writes the field.
3. New `waitingChoice` type for
   `kind: "chosen_name"`.
4. The lane 50 chosen-name block
   static (`affects.chosen_name_block`
   in `staticAffects`) ALREADY reads
   `source.chosenCardName` — the
   field just needs to be written by
   `resolveEnterChoice` for the
   static to resolve at runtime.

The test verifies that a card with
`enter_choice: { kind: "chosen_name" }`
resolves to a `chosenCardName` on
entry AND that the lane 50 chosen-name
block static blocks the named card's
activated abilities.

The bump to the engine-size budget
(3100 → 3150) is in the SAME commit
(can share the budget with lane 80's
bump; both lanes add the same
`enter_choice` arm shape).

Out of scope for lane 81 (each a
follow-up lane): the
`kind: "card_name_with_options"`
arm (lane 50 phase 2b), the
chosen-artifact / chosen-creature /
chosen-land sub-types (parallel to
lane 56's color-and-creature-type
dual).

## Notes on the engine surface for lanes

82-86 (Skipped drafter-list items)

Lanes 82-86 are the "Skipped, single-lane,
deferred to a future Wave 4.5+ pass" items
from `wave4-blockers.md`. Each is a
single-card or two-card sample. All
plumbing is shipped; the work is the card
JSON + a small test. The engine-size
budget is unaffected (no schema or engine
change).

Each lane's test file should follow the
established pattern (synthetic card
script registered via
`CardScriptSchema.parse +
registerCardScripts`, refresh via the
appropriate engine path, assert the
expected post-condition).

These lanes are warmups — they exercise
the aggressive loop's machinery after
lane 75e's engine change, and they
advance the #2614 drafter-list work
directly. Lane 82 (Midnight Snack) is
the smallest and is a good first
warmup; lanes 83-86 follow.
