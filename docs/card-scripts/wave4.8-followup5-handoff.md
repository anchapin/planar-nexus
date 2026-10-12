# Wave 4.8 follow-up 5 handoff — Next session

## Mission

Drive an aggressive, iterative loop to land the next three
priority lanes from the Wave 4.8 follow-up 4 done summary's
remaining work. Wave 4.8 follow-up 4 shipped lanes 66, 67,
and 68 (PRs #2745, #2746, #2747 — see
`docs/card-scripts/wave4-blockers.md` for the done
summary).

The next three lanes in priority order, per the Wave 4.8
follow-up 4 done summary's "Lane continue rule":

1. **Lane 69 — X-spent-on-other-spells** (e.g. "spend this
   mana only on [X]" — the "mana restriction" family, e.g.
   Force of Will, Cabal Therapy, the Storm-Crow specter
   pattern). A new schema arm on the alternative-cost
   slot (parallel to lane 63's `additionalCosts.pay_life` /
   `additionalCosts.sacrifice`) that records an X-restriction
   on the cast (the player may pay X in any combination of
   the named color(s) and the cost counts as that color
   only). Touches the cast-time cost validation in
   `spell-casting/cast.ts` (the cost must be paid with the
   restricted colors or the cast is illegal) and a
   per-instance stamp on the `StackObject` for the
   resolve-time effects. ~200-400 LOC + tests.

2. **Lane 70 — Copying a permanent** (Clone, Phantasmal
   Image, Vesuvan Doppelganger, the "as this enters the
   battlefield, you may have it enter as a copy of any
   permanent on the battlefield" family). A new schema arm
   on the `CreateToken`-style token-creation path (or a
   parallel `CopyPermanent` op) that lets the entering
   permanent copy the characteristics of an existing
   permanent. Touches the ETB path in
   `effect-resolution.ts#applyCreateToken` (or a parallel
   `applyCopyPermanent` op dispatcher) and the per-instance
   stamping pass in `keyword-actions/scripted-statics.ts`
   (parallel to the lane 66 `embedded_static` pattern). v1
   supports a single target + "all characteristics copied"
   semantics; "may copy a spell on the stack" (Splice) and
   "may become a copy until end of turn" (Sakashima-style)
   are follow-up lanes. ~300-500 LOC + tests.

3. **Lane 71 — Protection-from static** (e.g. "creatures
   you control have protection from [color]", or
   "creatures you control have protection from [quality]").
   A new schema arm on the chosen-X / additional-costs /
   affinity / grants / counter-ledger / cast-from-zone
   family (the schema budget is at 2550 lines for
   `schema.ts` after Wave 4.8 follow-up 4, +19 over the
   bumped budget; the new arm needs ~50-100 lines). The
   engine stamps the protection from the static source on
   each affected permanent's per-instance `protectionFrom:
string[]` field; the existing `canBeTargetedBy` /
   `canBeBlocked` checks (in `evergreen-keywords.ts`)
   consult the field. v1 supports a single color
   ("protection from red") + a single quality
   ("protection from everything"); multi-quality
   protection is a follow-up lane. ~200-350 LOC + tests.

Lane 61 ("replacement effect for death", Whip of Erebos /
False Dawn) stays blocked per the Wave 4.8 follow-up 2
done summary: the engine has no general replacement-effect
layer, so lane 61 is foundational work, not a normal lane.
Open it as a separate multi-lane plan, not as the next lane
in this loop.

Lane 72+ (X-spent-on-creature-spells, copying-spell-on-stack,
multi-quality protection) are explicitly multi-lane and
remain parked until the smaller-scope lanes (69, 70, 71)
are exhausted.

The remaining work is intentionally multi-lane and should
be attacked the same way the previous loops were: one
self-contained lane per PR, immediate next-lane pickup,
no human-in-the-loop. Per the Wave 4.8 follow-up 2
handoff's process rule: "Don't ship multi-lane work in
one PR. If a lane reveals a second pattern that also
needs new schema, split it into a follow-up lane and put
a paragraph in `wave4-blockers.md` documenting why."

## Priority lanes (in order)

The follow-up work, in priority order:

1. **Lane 69 — X-spent-on-other-spells** (Force of Will,
   Cabal Therapy, the "mana restriction" family). The
   smallest scoped piece: a new `mana_restriction: { colors,
generic }` arm on the alternative-cost slot (parallel
   to lane 63's `additionalCosts.pay_life` /
   `additionalCosts.sacrifice`) that records the X
   restriction on the cast. The v1 minimum: the player
   may pay the spell's generic mana cost using only the
   named color(s), and the cost is reduced by the named
   generic amount. The cast-time legality check rejects
   the cast if the player can't pay the cost with the
   restricted colors. The smallest sample card: a
   synthetic instant with `mana_restriction: { colors:
["U"], generic: 1 }` and a printed cost of `{U}{U}`
   (the player may pay `{U}{U}` normally, OR pay the
   generic 1 in blue and the second U in any color — the
   v1 minimum). If the lane grows past a single-color
   restriction, back out and ship the single-color
   variant first, then queue a follow-up lane for
   multi-color.

2. **Lane 70 — Copying a permanent** (Clone, Phantasmal
   Image, Vesuvan Doppelganger). The smallest scoped
   piece: a new `CopyPermanent` op on the engine's
   `applyEffect` switch (parallel to `CreateToken`) that
   creates a new permanent copying the characteristics
   of an existing permanent on the battlefield. v1
   supports a single target + "all characteristics
   copied" semantics (the new permanent has the same
   name, mana cost, type line, P/T, keywords, and
   abilities as the target). The "may become a copy
   until end of turn" pattern (Sakashima-style) and the
   "may copy a spell on the stack" pattern (Splice) are
   follow-up lanes. The smallest sample card: a
   synthetic `CopyPermanent` op (test harness) that
   creates a 1/1 copy of an existing 2/2 creature (the
   new permanent enters as a 2/2 with the same name +
   types as the target). If the lane grows past
   "all-characteristics-copied", back out and ship the
   basic-copy variant first, then queue a follow-up lane
   for the named-copy / until-end-of-turn variants.

3. **Lane 71 — Protection-from static** (e.g. "creatures
   you control have protection from [color]"). The
   smallest scoped piece: a new `protectionFrom: string[]`
   arm on the static slot (parallel to lane 65's
   `grants.triggers`) that stamps the protection on each
   affected permanent's per-instance `protectionFrom:
string[]` field. v1 supports a single color
   (`["red"]`) + a single quality (`["everything"]`).
   Multi-quality protection is a follow-up lane. The
   engine reads the field in the existing
   `canBeTargetedBy` / `canBeBlocked` checks (in
   `evergreen-keywords.ts`) — a creature with
   `protectionFrom: ["red"]` cannot be the target of a
   red spell, cannot be blocked by a red creature, and
   cannot be dealt damage by a red source. The smallest
   sample card: a synthetic static ("Creatures you
   control have protection from red") registered via the
   test harness, with a red creature + a red spell to
   verify the protection is honored. If the lane grows
   past a single protection source, back out and ship the
   self-only variant first, then queue a follow-up lane
   for the cross-permanent anthem variant.

Lanes 69 and 70 are the highest-priority follow-ups; they
unblock a long tail of recent cards (the "mana
restriction" family is the bulk of drafter-list card
scripts in #2614; the "copying a permanent" family is
the second-largest). Lane 71 is the smallest of the
explicitly multi-lane cases but still tractable in one
lane.

## State at session start

- **HEAD**: `5695589d` (Wave 4.8 follow-up 4 loop done
  summary — the handoff doc commit; the
  `wave4.8-followup4-handoff.md` doc itself was committed
  in the previous loop, and the `wave4-blockers.md` done
  summary is the follow-up 5 baseline).
- **722 → ? suites / 14079 → ? cases** (14072 passed +
  7 skipped). The Wave 4.8 follow-up 5 loop adds to these.
- **Lint 0 errors, typecheck clean** (the previous
  baseline).
- **Engine-size budget**: 2550 lines for `schema.ts`
  (bumped 2500 → 2550 in Wave 4.8 follow-up 4 lane 68;
  measured 2519 after lanes 66 + 67 + 68). Lane 69+ may
  need another bump if the new schema fields push past
  2550 — the historical precedent is "bump the budget
  rather than fragmenting the chosen-X / additional-costs
  / affinity / grants / counter-ledger / cast-from-zone
  family."
- **Bundle-size budget**: `config/bundle-budget.json` was
  re-captured in Wave 4.8 follow-up 4 lane 66 (the engine
  additions grew the `/replay` route and a handful of
  other game routes). Lanes 69+ may need another
  re-capture if the engine surface grows further.
- **Working directory**:
  `/home/alex/Projects/planar-nexus` (clean).
- **Open issues relevant to this loop**: #2614 (the full
  drafter-list plan work — covers the mana restriction
  family, the copying a permanent family, and the
  protection-from static family); the lanes above are
  tracked under #2614 or adjacent multi-lane plans.
- **Just-shipped context**: PRs #2745, #2746, and #2747
  are merged on main. Lane 66 added
  `CreateTokenSchema.embedded_static` for token-time
  static bonuses (keywords + P/T). Lane 67 added
  `CardScriptSchema.enters_with_counters: [{ counter,
count }]` for generalized stun / finality / +1/+1 /
  -1/-1 counter stamping (the engine mirrors to both
  `instanceCounters` and `card.counters` ledgers so the
  existing untap-skip path picks up the new stun counter
  on day one). Lane 68 added
  `CardScriptSchema.castable_from: ["exile" | "graveyard"
| "command"]` for generalized cast-from-zone (the
  engine's `canCastSpell`, `castSpell` source-zone
  check, and `validation-service.ts` legality check
  all accept the card from the named zone; the resolve
  path routes the card to the inferred end zone).
  All three are v1 single-piece add-ons; no wider
  refactor landed.

## Process (mandatory, identical to Wave 4 / 4.5 / 4.6 /

4.7 / 4.7 follow-up / 4.7 phase 2 / 4.8 / 4.8 follow-up /
4.8 follow-up 2 / 4.8 follow-up 3 / 4.8 follow-up 4)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
/tmp/opencode/wave413-lane<N>-<slug> -b
<type>/<scope> origin/main` where `<N>` starts at 69
   and `<slug>` is kebab-case, min 10 chars. `ln -s
/home/alex/Projects/planar-nexus/node_modules
/tmp/opencode/wave413-lane<N>-<slug>/node_modules`
   so test/lint/typecheck skip a fresh install. Verify
   with `ls
/tmp/opencode/wave413-lane<N>-<slug>/node_modules/.bin/jest`.
   Note: the symlinked `node_modules` will fail
   `npm run build` (Turbopack errors on the
   `node_modules` symlink pointing outside the worktree
   root). The bundle-size budget re-capture requires a
   real build, so when a lane grows the engine surface
   that the client bundle pulls in (e.g. lane 66 in the
   previous loop), `rm` the symlink and run `npm ci`
   first to do the build.

2. **Scope discipline**: each lane is one self-contained
   change. Schema + engine + sample card + dedicated
   test is fine. **Don't** ship a second sample card for
   a different pattern, **don't** refactor unrelated
   plumbing, **don't** partial-port a multi-card block.
   If the lane grows past one schema arm + one engine
   arm + one card, back out, document the reason in
   `wave4-blockers.md`, and pick a smaller next lane.

3. **Implement**: schema → engine → sample card →
   dedicated test → ratchet.
   - **Schema**:
     `src/lib/game-state/card-scripts/schema.ts` is the
     one place for new fields. For each lane, follow the
     existing allow-list pattern (lane 52 added
     `add_creature_type`; lane 54 added
     `removesAllAbilities`; lane 55 added `add_color`;
     lane 59 added `enters_with_counters_per_match`; lane
     60 added `you_may`; lane 62 added `counter_gate`;
     lane 63 added `additionalCosts.pay_life` /
     `additionalCosts.sacrifice`; lane 64 added
     `affinity.color` + `reduction_per_match`; lane 65
     added `static.grants.triggers`; lane 66 added
     `CreateTokenSchema.embedded_static`; lane 67 added
     `enters_with_counters`; lane 68 added
     `castable_from`). New fields should integrate into
     the chosen-X / additional-costs / affinity / grants
     / counter-ledger / cast-from-zone family when
     possible.
   - **Engine**: the right home depends on the arm.
     For Aura-static arms, update `refreshAuraBonuses`
     (`keyword-actions/aura-bonus.ts`). For general
     static arms, update `refreshScriptedStatics`
     (`keyword-actions/scripted-statics.ts`). For
     token-creation arms (lane 66, lane 70), update
     `effect-resolution.ts#applyCreateToken` (or the
     relevant op dispatcher for `CreateToken` /
     `CreatePredefinedToken` / `CopyPermanent`). For
     counter-ledger arms (lane 67), update
     `keyword-actions/enters.ts` (`resolveEnterChoice`)
     for ETB placement and `turn-phases.ts` for
     stun-counter untap prevention. For cast-from-zone
     arms (lane 68), update `spell-casting/cast.ts#canCastSpell`
     for the legality check and `spell-casting/resolve.ts`
     for the post-resolution zone redirect. For
     mana-restriction arms (lane 69), update
     `spell-casting/cast.ts#castSpell` for the
     cost-payment validation and `mana` for the
     color-restricted mana payment path. For
     protection-from static arms (lane 71), update
     `refreshScriptedStatics`
     (`keyword-actions/scripted-statics.ts`) for the
     stamp and `evergreen-keywords.ts` for the
     `canBeTargetedBy` / `canBeBlocked` checks.
   - **Sample card**: ship one real card JSON per lane
     when the handoff lists one. Otherwise use a
     synthetic registered via the test harness (the
     lane 49/52/55/59/60/62/63/64/65/66/67/68 pattern).
   - **Tests**: dedicated `*.test.ts` file per lane,
     colocated in `src/lib/game-state/__tests__/`.

4. **Run checks (in the worktree)**:
   - `PATH="$PWD/node_modules/.bin:$PATH" npx tsx
scripts/build-card-script-index.ts` (regenerates
     the index — required when adding a new card JSON).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm test
--silent` (full suite — must be all green; the AI
     `forge-gate`/`forge-selfplay`/`expert-agent` "is
     deterministic for a seed" flake is known — re-run
     once if it hits, then move on. The Wave 4.8
     follow-up 4 loop hit this flake once on lane 68's
     full-suite run; the second run passed clean).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
typecheck` (must be clean).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run lint`
     (0 errors; warnings OK).
   - `PATH="$PWD/node_modules/.bin:$PATH" node
scripts/check-engine-size-budget.mjs` (must pass;
     budget currently 2550 lines for `schema.ts`,
     measured 2519 after lanes 66 + 67 + 68). Bump the
     budget rather than fragmenting the chosen-X /
     additional-costs / affinity / grants /
     counter-ledger / cast-from-zone family (Wave 4.8
     follow-up 4 lane 68 bumped 2500 → 2550 to cover
     the lane 68 work).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
ratchet:test-count` (rewrites anchored doc blocks
     when test count changes). The Wave 4.8 follow-up 4
     loop did not hit the AI flake mid-ratchet; if a
     future loop hits it, fall back to manual count
     updates via `node scripts/ratchet-test-count.mjs
--live <counts.json>` with a hand-built JSON.
   - **Bundle-size check (only when the lane grows the
     engine surface that the client bundle pulls in)**:
     `rm node_modules` (the symlink) and `npm ci`, then
     `npm run build`, then `node
scripts/check-bundle-budget.mjs --check`. If the
     lane grew the engine and the bundle check fails,
     re-capture the budget: `node
scripts/check-bundle-budget.mjs --capture` and
     commit the updated `config/bundle-budget.json`
     alongside the lane's other changes. The handoff's
     process rule: "bump the budget rather than
     fragmenting the chosen-X / additional-costs /
     affinity / grants / counter-ledger / cast-from-zone
     family" — the same precedent applies to the
     client bundle budget; the Wave 4.8 follow-up 4
     lane 66 took this route when the engine additions
     grew the `/replay` route by +60.9 kB.

5. **Commit**: `git add -A && GIT_AUTHOR_NAME="Planar
Nexus Agent" GIT_AUTHOR_EMAIL="agent@planar-nexus.local"
GIT_COMMITTER_NAME="Planar Nexus Agent"
GIT_COMMITTER_EMAIL="agent@planar-nexus.local" git
commit -F COMMIT_MSG.txt`. Then `git rm --cached
COMMIT_MSG.txt && GIT_AUTHOR_NAME="Planar Nexus Agent"
GIT_AUTHOR_EMAIL="agent@planar-nexus.local"
GIT_COMMITTER_NAME="Planar Nexus Agent"
GIT_COMMITTER_EMAIL="agent@planar-nexus.local" git
commit --amend --no-edit && rm COMMIT_MSG.txt`. Then
   `git push --force-with-lease origin <branch>`. The
   Wave 4.8 follow-up 4 process learned: `git commit`
   without the env vars picks up the husky global git
   config and the commit shows up under the wrong
   author. Use the env vars explicitly, on every `git
commit` (and on every `git commit --amend`). The
   Wave 4.8 follow-up 4 loop used the env vars
   consistently on every commit + amend; no
   misattributed commits in that loop.

6. **Open PR**: write `PR_BODY.txt` AFTER the commit
   (this is the cleaner pattern — see the Wave 4.8
   follow-up 3 process note). Then `gh pr create
--title "<type>(<scope>): <one-line>" --body-file
PR_BODY.txt --base main --head <branch>`. Then `gh pr
merge <PR> --squash --delete-branch --admin` once
   checks pass. **Do not** `git add PR_BODY.txt` —
   writing the file post-commit avoids the amend
   `git rm --cached` step for that file. Note: the
   commitlint subject is enforced as lower-case (per the
   `header-case` rule in `commitlint.config.js`); the
   commit subject MUST be lower-case. If the body
   contains identifiers like `CreateTokenSchema` or
   `CardScriptSchema`, the `commitlint` hook may complain
   about the body's capital letters — the actual rule
   is on the subject line, so a lower-case subject with
   any body content is fine. The Wave 4.8 follow-up 4
   loop used all lower-case subjects consistently.

7. **Conflict resolution (if main moves during the
   lane)**: `git merge origin/main --no-edit` then
   resolve any conflicts (the most common is the
   test-count doc drift between main and your branch).
   For the test-count block: keep the higher values
   (the lane's contribution adds cases, so main's value
   will be lower or equal). Then `npm run
ratchet:test-count` to confirm. Force-push and
   re-wait CI.

8. **Cleanup**: exit the worktree directory, then `git
worktree remove
/tmp/opencode/wave413-lane<N>-<slug> --force && git
branch -D <branch>`.

## Conventions (carried from prior loops)

- **Branch**: `<type>/<scope>` (lowercase, kebab-case,
  min 10 chars). `<scope>` is the lane's punchy name
  (e.g. `mana-restriction` for lane 69, `copy-permanent`
  for lane 70, `protection-from-static` for lane 71).
- **Commit subject**: lower-case, min 10 chars, type from
  `feat fix docs style refactor test chore revert`. Wave
  4.8 saw `header-case` linting on commitlint —
  lowercase is enforced; write the subject in lowercase
  from the start.
- **Reference #2614 follow-up** in the commit body and
  the PR body so the cross-references stay tight. For
  lane 69 (mana restriction), reference the
  alternative-cost slot + #2614. For lane 70 (copy
  permanent), reference the `CopyPermanent` op + #2614.
  For lane 71 (protection-from static), reference the
  static slot + #2614.
- **Conventional Commits**. Never check in
  `COMMIT_MSG.txt` (amend-rm before pushing) or
  `PR_BODY.txt` (write it AFTER the commit, per the
  Wave 4.8 follow-up 3 process note).
- **Test count**: ratchet in the same commit as any
  test count change, before pushing. `test-count-docs-guard`
  re-measures live Jest and fails on any drift in
  `docs/onboarding.md` or `docs/TEST_VIDEO_FIXTURES.md`.
- **Engine-size budget**: 2550 lines for `schema.ts`
  (the Wave 4.8 follow-up 4 lane 68 bump). Lanes 69 +
  70 + 71 should fit under 2550 (each adds a small
  field — at most one refine); if the schema grows past
  2550, bump the budget in the SAME commit per the
  Wave 4.8 follow-up handoff's process note. Update the
  docstring block in `scripts/check-engine-size-budget.mjs`
  with a one-paragraph history entry (the existing
  entries are a good template).
- **Bundle-size budget**: the Wave 4.8 follow-up 4
  lane 66 re-captured `config/bundle-budget.json`
  after growing the engine surface. Lanes 69 + 70 + 71
  may grow the engine surface further; if a lane's
  changes pull into the client bundle, re-capture the
  budget in the same commit (see Process step 4).
- **Pre-commit hook** runs `eslint --fix` →
  `tsc --noEmit` → `prettier --write` on staged
  *.{ts,tsx,md,json,...}. A failing typecheck blocks
  the commit; run typecheck before staging. If `tsc
--noEmit` passes locally but CI fails with `Cannot
find name`, the husky pre-commit hook's local
  typecheck can pass while CI's typecheck flags a
  missing import — Wave 4.8 lane 55 saw this. Always
  cross-check imports before pushing.
- **Markdown gets prettier'd**; keep diffs small and
  don't fight the formatter. Note: the husky
  pre-commit hook runs prettier on staged `*.{ts,tsx,md,json,...}`
  files; if you write a `COMMIT_MSG.txt` and stage it,
  the prettier pass may delete the file (which the
  hook does in the lane 68 done-summary commit). Write
  the commit message to a file, stage the changes,
  commit using `git commit -F COMMIT_MSG.txt`, then
  `git rm --cached COMMIT_MSG.txt` and amend.

## Aggressive loop rules

- **Don't ask the user between lanes.** Pick the next
  gap autonomously and ship it.
- **Don't ship multi-lane work in one PR.** If a lane
  reveals a second pattern that also needs new schema,
  split it into a follow-up lane and put a paragraph in
  `wave4-blockers.md` documenting why.
- **Lane is "done"** only when: CI green, PR merged,
  worktree removed, branch deleted, local main pulled
  and re-ratcheted.
- **If CI fails on a lane**: don't push; fix the lane.
  If the fix is unclear, document the failure in
  `docs/card-scripts/wave4-blockers.md` and skip to the
  next lane. The AI `forge-gate`/`forge-selfplay`/
  `expert-agent` "is deterministic for a seed" test is
  a known order-dependent flake on main; if a CI run
  shows only that test failing, `gh run rerun --failed`
  is the right move (do NOT amend the lane). The Wave
  4.8 follow-up 4 loop hit this flake once on lane 68's
  local full-suite run; the second local run passed
  clean; the CI run was clean on the first try.
- **Turn budget: 40 turns per lane max** (per
  `AGENTS.md` §Turn Budget). If a single lane exceeds
  this, it's too big — back out, document, and pick a
  smaller one.

## Done definition for the loop

When all of lanes 69, 70, 71 are either shipped or
marked multi-lane blockers (with a paragraph in
`wave4-blockers.md` documenting why), append a Wave
4.8 follow-up 5 loop done summary at the bottom of
`docs/card-scripts/wave4-blockers.md` documenting the
shipped lanes, the blocked gaps with their #2614 plan
work references, and a fresh test-count snapshot. Then
stop.

If even lane 69 (the smallest prerequisite) is blocked,
that means the engine changed since Wave 4.8 follow-up
4 and the loop should be paused for human review before
continuing.

Lane 72+ (X-spent-on-creature-spells, copying-spell-on-
stack, multi-quality protection, etc.) are NOT in this
loop's scope — pick those up in a future Wave 4.8
follow-up 6 (or equivalent) handoff after lanes 69, 70,
71 ship. Lane 61 (replacement effect for death) is also
parked; it requires a foundational replacement-effect
layer that doesn't exist yet.

## Process observations carried from previous loops

- The AI `forge-gate`/`forge-selfplay`/
  `expert-agent` "is deterministic for a seed" test is
  a known order-dependent flake on main. If a CI run
  shows only that test failing, `gh run rerun --failed`
  is the right move — do NOT amend the lane. Wave 4.8
  saw this at lane 54 + 55; Wave 4.8 follow-up saw
  this at lane 56; Wave 4.8 follow-up 2 saw it once
  on the local lane 60 run and once on lane 62's
  `ratchet:test-count` (worked around with the
  `--live` fallback). Wave 4.8 follow-up 3 did NOT
  hit this flake on any lane. Wave 4.8 follow-up 4
  hit this flake ONCE on the local lane 68 full-suite
  run; the second run passed clean; the CI run was
  clean on the first try. Budget for 1-2 extra
  CI runs per lane to absorb the flake.
- `ci-wait` can return `FAILED` on a freshly-opened
  PR with all checks still pending. Wait a second
  call to `ci-wait` to get a real verdict. (`sleep
60 && gh pr checks <PR>` is a good way to seed the
  API.)
- `npm run ratchet:test-count` is reliable; run it
  in the same commit as any test count change. The
  Wave 4.8 follow-up 4 loop did not hit the AI flake
  mid-ratchet on any of the three lanes; the
  `--live` fallback was not needed.
- The handoff's process rule on `git worktree
remove`: the `--delete-branch` flag on
  `gh pr merge` only deletes the remote branch. The
  local worktree directory must be removed manually
  after exiting it (`git worktree remove ... && git
branch -D ...`).
- Wave 4.8 lane 55 process observation: `git commit`
  without `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env
  vars picks up the husky global git config and the
  commit shows up under the wrong author. Use the
  env vars explicitly, on every `git commit` (and on
  every `git commit --amend`). Wave 4.8 follow-up 4
  used the env vars consistently on every commit +
  amend; no misattributed commits in that loop.
- Wave 4.8 lane 55 process observation: the husky
  pre-commit hook's `tsc --noEmit` can pass locally
  while CI's `tsc --noEmit` flags a missing import.
  Always cross-check that every type used in a test
  file is in the file's `import type { ... } from
"../types"` block before pushing. Wave 4.8
  follow-up 2 lane 60 hit this with `CardInstance`
  access for `currentZoneKey` in a test's hand-count
  helper — added a null-guard before pushing.
- Wave 4.8 follow-up 2 process observation: when
  the `npm run ratchet:test-count` script times out
  (or fails because of the AI flake mid-ratchet),
  the `--live <counts.json>` fallback at
  `scripts/ratchet-test-count.mjs` skips the live
  Jest run and uses a hand-built JSON. Fields
  needed: `suites`, `total`, `passed`, `skipped`,
  `todo`, `snapshots`, `listed` (the last is the
  `--listTests` count). Wave 4.8 follow-up 2 lane
  62 built this JSON from the `npm test --silent`
  output it had already captured, plus `npx jest
--listTests 2>&1 | wc -l` for the listed count.
- Wave 4.8 follow-up 2 process observation: the
  engine-size budget re-check is fast (~50ms). Run
  it in the same commit as any `schema.ts` change
  so the budget doesn't drift. The previous loop
  ended with schema.ts at 2519 (under 2550); if a
  single lane pushes past 2550, bump the budget in
  the SAME commit per the Wave 4.8 follow-up
  handoff's process note.
- Wave 4.8 follow-up 3 process observation:
  synthetic card scripts registered via the test
  harness should use `synthetic as never` rather than
  `@ts-expect-error: synthetic` comments. The
  `@ts-expect-error` directives were unused (TypeScript
  doesn't actually error on the inline object literal
  in a strict `CardScript[]` array when the test
  function takes a permissive parameter type) and
  produced three "Unused '@ts-expect-error'
  directive" typecheck errors. The `synthetic as never`
  cast avoids the directive entirely.
- Wave 4.8 follow-up 3 process observation:
  `PR_BODY.txt` should be written AFTER the commit,
  not before. Writing it before risks the file
  getting into the commit and requiring a
  `git rm --cached PR_BODY.txt && git commit
--amend --no-edit` cleanup. Writing it after
  keeps the file out of git entirely until the
  `gh pr create --body-file` call reads it. This
  is the cleaner pattern and is recommended for
  future loops.
- Wave 4.8 follow-up 3 process observation: the
  CardScriptSchema `attachOnEnter` field is on
  `EquipmentSchema`, NOT on `AuraSchema`. Auras
  attach on cast by default (CR 303.4f); the schema
  uses `AuraSchema: { text, target?, static }` with
  no `attachOnEnter` field. Synthetic Aura scripts
  for tests should follow this shape.
- Wave 4.8 follow-up 4 process observation: when
  adding a new schema arm on `CardScriptSchema`,
  the `.refine(...)` step enforces that the script
  declares at least one of `spell, modes, triggers,
activated, statics, rules, equipment, aura,
cycling, enter_choice, enters_with_counters`. A
  new schema arm that should be its own valid "card
  script" form (e.g. lane 67's `enters_with_counters`)
  must be added to the refine list with a one-
  paragraph docstring explaining the new accepted
  form. Synthetic test scripts that use the new arm
  alone (without any other ability) parse only if
  the arm is in the refine list.
- Wave 4.8 follow-up 4 process observation: when
  extending a multi-layer cast path (e.g. lane 68's
  `castable_from`), the `canCastSpell`,
  `castSpell` source-zone check, AND
  `validation-service.ts` legality check all need
  the new arm. Missing one of the three surfaces a
  "Card not in hand" / "Card is not in your hand"
  error from a layer the unit test doesn't directly
  exercise. Always grep for "is not in your hand" /
  "not in hand" in the relevant files when
  extending the cast path.
- Wave 4.8 follow-up 4 process observation: the
  `cardScript` variable is declared multiple times
  in `spell-casting/cast.ts` at different scopes
  (the `canCastSpell` function declares its own
  `cardScript`; the `castSpell` function declares
  another). When extending the cast path with a
  new field that needs the script lookup, declare
  a new local variable (e.g. `cardScriptForSource`)
  rather than reusing the existing `cardScript`
  binding — the existing bindings may be at the
  wrong scope. The Wave 4.8 follow-up 4 lane 68
  hit a `cardScript is not defined` runtime error
  before this discipline was applied.

## Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any leftover from Wave 4.8 follow-up 4)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 722 / 14079 green
# then start lane 69 (mana restriction, #2614 follow-up) per the Process section
# lanes 70 (copying a permanent), 71 (protection-from static) follow in priority order
```

End each lane with: `git log --oneline -1` on main
showing the new lane's commit, and `grep "Test suites"
docs/onboarding.md` showing the bumped numbers. If those
two checks pass, you're ready for the next lane
immediately.

## Notes on the engine surface for lane 69 (X-spent-on-other-spells)

When implementing lane 69, the engine-side changes are
in `spell-casting/cast.ts#castSpell` (the cost-payment
validation; the player may pay the spell's generic mana
cost using only the named color(s)) and `mana` (the
color-restricted mana payment path; the v1 minimum is
"the player may pay {X} in any of the named colors
instead of the printed generic cost"). The new
`mana_restriction: { colors: string[], generic: number }`
arm on the alternative-cost slot (parallel to lane 63's
`additionalCosts.pay_life` / `additionalCosts.sacrifice`)
records the X restriction on the cast. The cast-time
legality check rejects the cast if the player can't
pay the cost with the restricted colors.

The smallest variant set for v1 (per the Wave 4.8
follow-up 3 handoff's "smallest scoped v1" pattern):

- `colors: ["U"]` — the cost may be paid in blue only.
- `generic: 1` — the cost is reduced by 1 generic
  (matching the printed generic cost of the spell).
- The printed cost of the spell is `{U}{U}` (so the
  player may pay `{U}{U}` normally, OR pay the generic
  1 in blue and the second U in any color — the v1
  minimum).

The legality check rejects the cast if the player
can't pay the cost with the restricted colors. The
deduction happens at cast time (the cost is paid from
the player's mana pool, with the restriction enforced
at the color-restricted mana payment step).

Out of scope for lane 69 (these are separate
multi-lanes, each adding a new field):

- Multi-color restrictions (`colors: ["U", "B"]`) —
  a follow-up lane would extend `mana_restriction`
  with multiple colors.
- Per-spell color substitutions ("pay this cost as
  though it were [color] instead of [color]") — a
  follow-up lane would extend `mana_restriction` with
  a `substitute` arm.
- Hybrid mana costs (`{W/U}`) — a follow-up lane
  would extend `mana_restriction` with a hybrid arm.
- Phyrexian mana costs (`{W/P}`) — a follow-up lane
  would extend `mana_restriction` with a Phyrexian
  arm.

The smallest sample card is a synthetic instant
with `mana_restriction: { colors: ["U"], generic: 1 }`
and a printed cost of `{U}{U}`. If the lane grows past
a single-color restriction, back out and ship the
single-color variant first, then queue a follow-up lane
for the multi-color variant.

## Notes on the engine surface for lane 70 (copying a permanent)

When implementing lane 70, the engine-side changes are
in `effect-resolution.ts` (a new `CopyPermanent` op
dispatcher, parallel to the existing `CreateToken` /
`CreatePredefinedToken` paths) and
`keyword-actions/scripted-statics.ts` (the per-instance
stamping pass for the copied characteristics, parallel
to the lane 66 `embedded_static` pattern). The new
`CopyPermanent` op creates a new `CardInstance` with
characteristics copied from an existing permanent on
the battlefield. The v1 minimum: the new permanent has
the same name, mana cost, type line, P/T, keywords, and
abilities as the target.

The smallest variant set for v1 (per the Wave 4.8
follow-up 3 handoff's "smallest scoped v1" pattern):

- `target: CardInstanceId` — the permanent to copy.
- The new permanent inherits the target's `cardData`
  (name, mana cost, type line, P/T, keywords, oracle
  text, colors).

The legality check rejects the copy if the target is
not on the battlefield. The deduction happens at the
copy-creation time (the new permanent enters the
battlefield; the target is unchanged).

Out of scope for lane 70 (these are separate
multi-lanes, each adding a new field):

- "May become a copy until end of turn" (Sakashima-
  style, manifested, etc.) — a follow-up lane would
  extend the engine with a temporary copy arm.
- "May copy a spell on the stack" (Splice) — a
  follow-up lane would extend the engine with a
  stack-copy arm.
- "May copy a card in a graveyard" (reanimation) —
  a follow-up lane would extend the engine with a
  graveyard-copy arm.
- "Copied characteristics except for [X]" (e.g.
  Phyrexian Metamorph's "you may have it enter as a
  copy of any artifact or creature, except it's a
  Phyrexian in addition to its other types") — a
  follow-up lane would extend the schema with an
  `exceptions` arm.

The smallest sample card is **Clone** ("You may have
Clone enter the battlefield as a copy of any creature
on the battlefield.") but this card actually combines
several patterns (the "you may" pattern, the
creature-only filter, the battlefield-only target).
For the v1 minimum, ship a synthetic card registered
via the test harness that just creates a 1/1 copy of
an existing 2/2 creature via the `CopyPermanent` op
(the new permanent enters as a 2/2 with the same
name + types as the target). If the lane grows past
"all-characteristics-copied", back out and ship the
basic-copy variant first, then queue a follow-up lane
for the named-copy / until-end-of-turn variants.

## Notes on the engine surface for lane 71 (protection-from static)

When implementing lane 71, the engine-side changes are
in `keyword-actions/scripted-statics.ts#refreshScriptedStatics`
(the per-instance stamping pass for the protection
from the static source, parallel to the lane 65
`grantedTriggers` pattern) and `evergreen-keywords.ts`
(the `canBeTargetedBy` / `canBeBlocked` checks consult
the new `protectionFrom: string[]` field on the
affected permanent's `CardInstance`).

The new `protectionFrom: string[]` arm on the static
slot (parallel to lane 65's `grants.triggers`) lists
the protection sources the static grants (a single
color like `["red"]`, a single quality like
`["everything"]`, or a list of either). The engine
stamps the protection on each affected permanent's
per-instance `protectionFrom: string[]` field; the
existing `canBeTargetedBy` / `canBeBlocked` checks
(in `evergreen-keywords.ts`) consult the field —
a creature with `protectionFrom: ["red"]` cannot be
the target of a red spell, cannot be blocked by a
red creature, and cannot be dealt damage by a red
source.

The smallest variant set for v1 (per the Wave 4.8
follow-up 3 handoff's "smallest scoped v1" pattern):

- `protectionFrom: ["red"]` — protection from a single
  color.
- `protectionFrom: ["everything"]` — protection from
  everything (the "Glory" / "Niveous Wisps" pattern).
- The static arm can also be a self-only protection
  (e.g. "this creature has protection from red").

The engine reads the field in the existing
`canBeTargetedBy` / `canBeBlocked` checks (a creature
with `protectionFrom: ["red"]` cannot be the target
of a red spell, cannot be blocked by a red creature,
and cannot be dealt damage by a red source). The
damage prevention is the third rule of protection
(CR 702.16c); the engine's existing damage flow (in
`keyword-actions/damage-tap.ts`) consults the new
field via the same `canBeTargetedBy` helper.

Out of scope for lane 71 (these are separate
multi-lanes, each adding a new field):

- Multi-quality protection (`protectionFrom: ["red",
"blue"]`) — a follow-up lane would extend the
  engine's protection check to handle multiple
  qualities (already supported by the v1 array
  shape, but the engine's `canBeTargetedBy` /
  `canBeBlocked` checks need to AND across all
  entries).
- "Protection from [quality] you choose" (Akoum
  Boulderfoot-style) — a follow-up lane would
  extend the engine with a chosen-quality arm.
- "Protection from [color] until end of turn" (a
  temporary protection) — a follow-up lane would
  extend the engine with a temporary arm.

The smallest sample card is a synthetic static
("Creatures you control have protection from red")
registered via the test harness, with a red creature

- a red spell to verify the protection is honored. If
  the lane grows past a single protection source, back
  out and ship the self-only variant first, then queue
  a follow-up lane for the cross-permanent anthem
  variant.
