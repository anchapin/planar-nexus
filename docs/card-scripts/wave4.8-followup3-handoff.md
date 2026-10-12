# Wave 4.8 follow-up 3 handoff — Next session

## Mission

Drive an aggressive, iterative loop to land the next three
priority lanes from the Wave 4.8 follow-up 2 handoff's
remaining work. Wave 4.8 follow-up 2 shipped lanes 60 and 62
(PRs #2736, #2737 — see `docs/card-scripts/wave4-blockers.md`
for the done summary).

The next three lanes in priority order, per the Wave 4.8
follow-up 2 handoff and the Wave 4.8 follow-up 2 done
summary's "Lane continue rule":

1. **Lane 63 — Additional costs** (`additionalCosts`
   schema extension for sacrifice/pay costs; Louisoix's
   Sacrifice, Drana's Sacrifice, Painful Truths). A
   general-purpose additional-costs field on
   `ActivatedSchema` and `SpellEffectSchema`:
   `additionalCosts: [{ kind: "sacrifice", target: "self"
| "creature" | ..., amount: N }, { kind: "pay_life",
amount: N }, ...]`. ~100-200 LOC + tests.
2. **Lane 64 — Affinity / cost reduction** (Claws Out,
   Dragonlord's Servant, Archmage of Runes, Mocking
   Sprite, Bolt Bend, Arcane Epiphany). A new
   `cost_reduction: { kind: "affinity", color: "W"|...,
reduction_per_match: N }` schema arm on `spell`/
   `ActivatedSchema` plus a parser that subtracts the
   affinity sum from the printed cost at activation time.
   ~100-200 LOC + tests.
3. **Lane 65 — Granting triggered abilities to other
   cards** (Fake Your Own Death, Undying Malice, Lifelink
   granting via static). A new static arm that adds
   `script.triggers` to the target (or copies a specific
   trigger from the source). Intersects the trigger fire
   pipeline; a multi-lane on its own. ~200-400 LOC + tests.

Lane 61 ("replacement effect for death", Whip of Erebos /
False Dawn) stays blocked per the Wave 4.8 follow-up 2
done summary: the engine has no general replacement-effect
layer, so lane 61 is foundational work, not a normal lane.
Open it as a separate multi-lane plan, not as the next lane
in this loop.

Lanes 66–71 (token embedded static, stun/finality
counters, cast from exile/graveyard, X-spent-on-other-
spells, copying permanent, protection-from static) are
explicitly multi-lane and remain parked until the
smaller-scope lanes (63, 64, 65) are exhausted.

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

1. **Lane 63 — Additional costs** (Louisoix's Sacrifice,
   Drana's Sacrifice, Painful Truths). The smallest scoped
   piece: an `additionalCosts: [{ kind, ... }]` array on
   `ActivatedSchema` and `SpellEffectSchema`; the engine
   validates + deducts each cost in the activation/cast
   pipeline. The smallest variant set for v1:
   `{ kind: "sacrifice", target: "self"|"creature"|"artifact"|"enchantment"|"permanent", amount: N }` and
   `{ kind: "pay_life", amount: N }`. Real cards
   flagged: Louisoix's Sacrifice ("Sacrifice a creature:
   Draw two cards"), Drana's Sacrifice variants, Painful
   Truths ("pay 1 life, draw 3"). Out of scope: mana
   discounts, kicker-like conditional costs, modal
   additional costs (these are separate multi-lanes).

2. **Lane 64 — Affinity / cost reduction** (Claws Out,
   Dragonlord's Servant, Archmage of Runes, Mocking
   Sprite, Bolt Bend, Arcane Epiphany). The smallest
   scoped piece: a `cost_reduction: { kind:
"affinity", color: "W"|"U"|"B"|"R"|"G"|"any",
reduction_per_match: N }` arm on `spell` and
   `ActivatedSchema` plus a parser hook in
   `spell-casting/cast.ts` and `parseManaAbility` that
   subtracts the affinity sum from the printed cost at
   cast/activation time. v1 supports a single affinity
   color or "any"; cards with multi-color affinity
   discounts are a follow-up.

3. **Lane 65 — Granting triggered abilities to other
   cards** (Fake Your Own Death, Undying Malice, Lifelink
   granting via static). A new static arm `grants:
{ triggers: [...] }` on `AuraStaticSchema` (and
   eventually `StaticSchema`) that copies specific
   scripted triggers from the source onto the target. The
   engine fires those granted triggers alongside the
   target's own. The smallest scoped piece: a `granted
triggers: [{ from: "self", trigger_text: "..." }]`
   array on `AuraStaticSchema.affects` or alongside the
   existing P/T / keywords / RA / RB / RU / MB /
   removesAllAbilities / chosen-X arms. Multi-lane —
   touches the trigger fire pipeline directly, parallel
   to the Wave 4.8 follow-up 2 lane 62 counter-gate and
   lane 58 losesAbilities gate. Refactor-target: the
   per-target diff at the bottom of `refreshAuraBonuses`
   in `keyword-actions/aura-bonus.ts` (where lanes 52,
   54, 55, 56 each added a new arm). Add one more arm
   there: granted triggers from the source.

Lanes 63 and 64 are the highest-priority follow-ups; they
unblock several real cards (Painful Truths / Louisoix's
Sacrifice / Claws Out / Dragonlord's Servant / Arcane
Epiphany). Lane 65 is the smallest of the explicitly
multi-lane cases but still tractable in one lane.

## State at session start

- **HEAD**: `e899b01e` (Wave 4.8 follow-up 2 done summary
  - handoff doc commit; the wave4.8-followup2-handoff.md
    doc itself was first committed in the previous loop).
- **716 → ? suites / 14011 → ? cases** (14004 passed +
  7 skipped). The Wave 4.8 follow-up 3 loop adds to these.
- **Lint 0 errors, typecheck clean** (the previous
  baseline).
- **Engine-size budget**: 2300 lines for `schema.ts`
  (bumped 2200 → 2300 in Wave 4.8 follow-up lane 56;
  measured 2286 after lanes 60 + 62). Lane 63+ may need
  another bump if the new schema fields push past
  2300 — the historical precedent is "bump the budget
  rather than fragmenting the chosen-X arm family."
- **Working directory**:
  `/home/alex/Projects/planar-nexus` (clean).
- **Open issues relevant to this loop**: #2614 (the full
  drafter-list plan work — covers the Adaptive Automaton
  type-change full scope, additional costs, affinity,
  etc.); the lanes above are tracked under #2614 or
  adjacent multi-lane plans.
- **Just-shipped context**: PRs #2736 + #2737 are merged
  on main. Lane 60 added `you_may` field, `you_may_prompt`
  waitingChoice, and `StackObject.you_may_resolved?`. Lane
  62 added `counter_gate` field and the third CR 603.2
  "while"-gate in `detectTriggeredAbilities`. Both are
  v1 single-piece add-ons; no wider refactor landed.

## Process (mandatory, identical to Wave 4 / 4.5 / 4.6 /

4.7 / 4.7 follow-up / 4.7 phase 2 / 4.8 / 4.8 follow-up /
4.8 follow-up 2)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
/tmp/opencode/wave411-lane<N>-<slug> -b
<type>/<scope> origin/main` where `<N>` starts at 63
   and `<slug>` is kebab-case, min 10 chars. `ln -s
/home/alex/Projects/planar-nexus/node_modules
/tmp/opencode/wave411-lane<N>-<slug>/node_modules`
   so test/lint/typecheck skip a fresh install. Verify
   with `ls
/tmp/opencode/wave411-lane<N>-<slug>/node_modules/.bin/jest`.

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
     60 added `you_may`; lane 62 added `counter_gate`).
     New fields should integrate into the chosen-X arm
     family when possible (lane 65).
   - **Engine**: the right home depends on the arm.
     For Aura-static arms, update `refreshAuraBonuses`
     (`keyword-actions/aura-bonus.ts`). For general
     static arms, update `refreshScriptedStatics`
     (`keyword-actions/scripted-statics.ts`). For
     ability gates, update `abilities/activated.ts`
     (and possibly `abilities/parse.ts`). For trigger
     fire, update `detectTriggeredAbilities`
     (`abilities/triggered.ts`) and `enter-choice.ts`'s
     `resolveEnterChoice` for ETB-time effects. For
     additional costs (lane 63), the parser is in
     `abilities/activated.ts#canActivateAbility` /
     `activateAbility` and the cast path in
     `spell-casting/cast.ts`. For cost reductions (lane
     64), the parser is in `spell-casting/cast.ts` and
     `parseManaAbility`. For granting triggered abilities
     (lane 65), the per-target diff at the bottom of
     `refreshAuraBonuses` and the trigger fire pipeline
     (`detectTriggeredAbilities`).
   - **Sample card**: ship one real card JSON per lane
     when the handoff lists one. Otherwise use a
     synthetic registered via the test harness (the
     lane 49/52/55/59/60/62 pattern).
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
     follow-up 2 loop saw this flake at lane 62's
     `ratchet:test-count`; the documented `--live
<counts.json>` fallback was used).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
typecheck` (must be clean).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run lint`
     (0 errors; warnings OK).
   - `PATH="$PWD/node_modules/.bin:$PATH" node
scripts/check-engine-size-budget.mjs` (must pass;
     budget currently 2300 lines for `schema.ts`, measured
     2286 after lanes 60 + 62). Bump the budget rather
     than fragmenting the chosen-X arm family (Wave 4.8
     follow-up lane 56 bumped 2200 → 2300 to cover lanes
     56, 57, 59; lane 65 may need a similar bump if it
     adds another arm).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
ratchet:test-count` (rewrites anchored doc blocks
     when test count changes). If this hits the AI flake
     mid-ratchet and never completes, fall back to
     manual count updates via `node
scripts/ratchet-test-count.mjs --live
<counts.json>` with a hand-built JSON.

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
   Wave 4.8 process learned: `git commit` without the env
   vars picks up the husky global git config and the
   commit shows up under the wrong author. Use the env
   vars explicitly.

6. **Open PR**: write `PR_BODY.txt`, `gh pr create
--title "<type>(<scope>): <one-line>" --body-file
PR_BODY.txt --base main --head <branch>`. **Watch
   out:** the commit may accidentally include
   `PR_BODY.txt`. After the commit, `git rm --cached
PR_BODY.txt && git commit --amend --no-edit && rm
PR_BODY.txt` to remove it before pushing. Then `gh pr
create ...` followed by `gh pr merge <PR> --squash
--delete-branch --admin` once checks pass.

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
/tmp/opencode/wave411-lane<N>-<slug> --force && git
branch -D <branch>`.

## Conventions (carried from prior loops)

- **Branch**: `<type>/<scope>` (lowercase, kebab-case,
  min 10 chars). `<scope>` is the lane's punchy name
  (e.g. `additional-costs-extension` for lane 63,
  `affinity-cost-reduction` for lane 64,
  `granting-triggered-abilities` for lane 65).
- **Commit subject**: lower-case, min 10 chars, type from
  `feat fix docs style refactor test chore revert`. Wave
  4.8 saw `header-case` linting on commitlint —
  lowercase is enforced; write the subject in lowercase
  from the start.
- **Reference #2614 follow-up** in the commit body and
  the PR body so the cross-references stay tight. For
  lane 63 (additional costs), reference the
  sacrifice/pay schema extension + #2614. For lane 64
  (affinity), reference the cost-reduction parse arm
  - #2614. For lane 65 (granting triggered abilities),
    reference the granted-triggers static arm + #2614.
- **Conventional Commits**. Never check in
  `COMMIT_MSG.txt` or `PR_BODY.txt`. The amend flow
  re-fights a phantom index entry if either file slips
  into a commit.
- **Test count**: ratchet in the same commit as any
  test count change, before pushing. `test-count-docs-guard`
  re-measures live Jest and fails on any drift in
  `docs/onboarding.md` or `docs/TEST_VIDEO_FIXTURES.md`.
- **Engine-size budget**: 2300 lines for `schema.ts`
  (the Wave 4.8 follow-up lane 56 bump). Lanes 63 + 64
  should fit under 2300 (each adds a small field + at
  most one refine); lane 65 may need a bump to ~2350 if
  it adds an arm. Bump by editing
  `scripts/check-engine-size-budget.mjs` and commit the
  bump + the lane work in one PR per the Wave 4.8
  follow-up handoff's process note.
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
  don't fight the formatter.

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
  is the right move (do NOT amend the lane).
- **Turn budget: 40 turns per lane max** (per
  `AGENTS.md` §Turn Budget). If a single lane exceeds
  this, it's too big — back out, document, and pick a
  smaller one.

## Done definition for the loop

When all of lanes 63, 64, 65 are either shipped or marked
multi-lane blockers (with a paragraph in
`wave4-blockers.md` documenting why), append a Wave 4.8
follow-up 3 loop done summary at the bottom of
`docs/card-scripts/wave4-blockers.md` documenting the
shipped lanes, the blocked gaps with their #2614 plan
work references, and a fresh test-count snapshot. Then
stop.

If even lane 63 (the smallest prerequisite) is blocked,
that means the engine changed since Wave 4.8 follow-up
2 and the loop should be paused for human review before
continuing.

Lane 66+ (token creation with embedded static, stun /
finality counters, casting from exile / graveyard, X
spent on other spells, copying a permanent, protection-
from static) are NOT in this loop's scope — pick those
up in a future Wave 4.8 follow-up 4 (or equivalent) handoff
after lanes 63, 64, 65 ship. Lane 61 (replacement effect
for death) is also parked; it requires a foundational
replacement-effect layer that doesn't exist yet.

## Process observations carried from previous loops

- The AI `forge-gate`/`forge-selfplay`/`expert-agent`
  "is deterministic for a seed" test is a known
  order-dependent flake on main. If a CI run shows only
  that test failing, `gh run rerun --failed` is the right
  move — do NOT amend the lane. Wave 4.8 saw this at
  lane 54 + 55; Wave 4.8 follow-up saw this at lane 56;
  Wave 4.8 follow-up 2 saw it once on the local lane
  60 run and once on lane 62's `ratchet:test-count`
  (worked around with the `--live` fallback).
  Budget for 1-2 extra CI runs per lane to absorb the
  flake.
- `ci-wait` can return `FAILED` on a freshly-opened PR
  with all checks still pending. Wait a second call to
  `ci-wait` to get a real verdict. (`sleep 60 && gh pr
checks <PR>` is a good way to seed the API.)
- `npm run ratchet:test-count` is reliable; run it in
  the same commit as any test count change. **If it
  hits the AI flake mid-ratchet**, fall back to manual
  count updates via `node scripts/ratchet-test-count.mjs
--live <counts.json> --doc docs/onboarding.md --doc
docs/TEST_VIDEO_FIXTURES.md` with a hand-built JSON
  (the `--live` path doesn't run `npm test`). Wave 4.8
  follow-up 2 lane 62 used this fallback successfully;
  the ratchet rewrote both anchored blocks.
- The handoff's process rule on `git worktree remove`:
  the `--delete-branch` flag on `gh pr merge` only
  deletes the remote branch. The local worktree
  directory must be removed manually after exiting it
  (`git worktree remove ... && git branch -D ...`).
- Wave 4.8 lane 55 update on the add_color read path:
  `getCardColors(card)` unions `card.cardData.colors`
  with `card.chosenColorAdditions` (parallel to lane
  52's `subtypesOf(card)` union). When porting the
  cost-reduction arm for lane 64, the new path must
  read `card.instanceCounters` (lane 59's per-instance
  ledger) and the gateway counters (chosen color +
  chosen creature type, etc.) to compute the affinity
  deduction.
- Wave 4.8 lane 54 update on the aura-bonus path: see
  `keyword-actions/aura-bonus.ts#refreshAuraBonuses`. The
  per-target diff at the bottom of that function now
  compares `nextAdds` (chosenTypeAdditions) AND
  `nextColors` (chosenColorAdditions) AND the existing
  P/T + keywords + RA/RB/RU/MB + losesAbilities diffs.
  When adding a new arm (e.g. lane 65's
  `grantedTriggers`), follow the same pattern: compute a
  per-target `Set`/`Map`, then write the field only on
  the diff path. The granted-trigger arm should diff a
  per-target list of trigger texts against the source's
  granting list, and write the granted-triggers list
  onto the target when the source is on the battlefield
  and the choice resolves.
- Wave 4.8 lane 55 schema's docstring on
  `add_creature_type` says "chosen-eviction-at-tombstone
  handled by the field being maintained by the refresh
  pass on battlefield cards only". This is the canonical
  pattern for any new "addition" arm: the field is
  per-instance + battlefield-zone-only, dropped when the
  source leaves the battlefield. Apply the same pattern
  to lane 65's `grantedTriggers` (drop the granted list
  when the source leaves the battlefield).
- Wave 4.8 follow-up lane 56 update on the
  dual enter-choice path: `resolveEnterChoice` now
  handles the `"color_and_creature_type"` compound kind
  by writing BOTH `chosenColor` AND `chosenCreatureType`
  from one resolver call. For lane 64's affinity arm,
  remember that affinity applies at CAST time (or
  activation time), not at ETB time — but the chosen
  color from `enter_choice` IS already on the card by
  then, so the affine subtractor can read
  `card.chosenColor` (or `card.chosenCreatureType` for
  type-based affinity).
- Wave 4.8 follow-up lane 58 update on the trigger
  pipeline: `detectTriggeredAbilities` adds a
  `losesAbilities` gate after the `whileCondition`
  check. The lane 62 gate (counter-based) and lane 60
  gate (`you_may`) follow the same one-time-filter
  shape. For lane 65, the `grantedTriggers` from the
  source should be DISPATCHED — they ride on the
  target but the trigger's `subject` and
  `interveningIf` refer to the target's game state, not
  the source's.
- Wave 4.8 follow-up lane 59 update on the counter
  ledger: `CardInstance.instanceCounters?: Record<string,
number>` is the per-instance counter ledger stamped at
  ETB by `resolveEnterChoice`. The counter-gate arm for
  lane 62 reads `card.instanceCounters?.[counter.type] ?? 0`
  and compares against the gate's `n`. Lane 67 (stun /
  finality counters) generalizes the ledger to multiple
  counter types — same shape, more `counter` strings.
- Wave 4.8 process saw the lane 13 commit-message
  docstring (~70 lines) blow the schema budget to 2136
  (over the 2100 lane-50 ceiling). The lane 54 budget
  bump (2100 → 2200) covered that + the lane 54 work
  (~36 lines). Wave 4.8 follow-up lane 56 bumped to 2300. Future lanes should keep docstrings lean — the
  engine behavior is documented in the engine file, not
  the schema. The schema docstring should describe the
  FIELD, not the WHOLE path.
- Wave 4.8 lane 55 process observation: `git commit`
  without `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env vars
  picks up the husky global git config and the commit
  shows up under the wrong author. Use the env vars
  explicitly, on every `git commit` (and on every `git
commit --amend`).
- Wave 4.8 lane 55 process observation: `git rm --cached
PR_BODY.txt && git commit --amend --no-edit && rm
PR_BODY.txt` is required after `git add -A && git
commit -F COMMIT_MSG.txt` — the amend flow without
  this leaves `PR_BODY.txt` in the commit. Always do
  the amend-and-rm before pushing.
- Wave 4.8 lane 55 process observation: the husky
  pre-commit hook's `tsc --noEmit` can pass locally while
  CI's `tsc --noEmit` flags a missing import. Always
  cross-check that every type used in a test file is in
  the file's `import type { ... } from "../types"` block
  before pushing. The lane 55 fix was adding
  `CardInstance` to the type imports after a test used
  `as CardInstance` cast. Wave 4.8 follow-up lane 56
  hit the same issue with `CardInstance` in the
  drafted-scripts guard branch — added it to the type
  imports before pushing. Wave 4.8 follow-up 2 lane 60
  hit the same issue with `CardInstance` access for
  `currentZoneKey` in the test's hand-count helper —
  added a null-guard before pushing.
- Wave 4.8 follow-up 2 process observation: when the
  `npm run ratchet:test-count` script times out (or
  fails because of the AI flake mid-ratchet), the
  `--live <counts.json>` fallback at
  `scripts/ratchet-test-count.mjs` skips the live Jest
  run and uses a hand-built JSON. Fields needed:
  `suites`, `total`, `passed`, `skipped`, `todo`,
  `snapshots`, `listed` (the last is the `--listTests`
  count). Wave 4.8 follow-up 2 lane 62 built this JSON
  from the `npm test --silent` output it had already
  captured, plus `npx jest --listTests 2>&1 | wc -l`
  for the listed count.
- Wave 4.8 follow-up 2 process observation: the
  engine-size budget re-check is fast (~50ms). Run it
  in the same commit as any `schema.ts` change so the
  budget doesn't drift. The previous loop ended with
  schema.ts at 2286 (under 2300); if a single lane
  pushes past 2300, bump the budget in the SAME commit
  per the Wave 4.8 follow-up handoff's process note.

## Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any leftover from Wave 4.8 follow-up 2)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 716 / 14011 green
# then start lane 63 (additional costs extension, #2614 follow-up) per the Process section
# lanes 64 (affinity / cost reduction), 65 (granting
# triggered abilities) follow in priority order
```

End each lane with: `git log --oneline -1` on main
showing the new lane's commit, and `grep "Test suites"
docs/onboarding.md` showing the bumped numbers. If those
two checks pass, you're ready for the next lane
immediately.

## Notes on the engine surface for lane 63 (additional costs)

When implementing lane 63, the engine-side changes are
in `abilities/activated.ts#activateAbility` (and
`canActivateAbility` for the legality check) and in
`spell-casting/cast.ts#castSpell` (for spell additional
costs — Painful Truths is a sorcery spell, not an
activated ability). Both paths flow through the
`CardScript.triggers` / `CardScript.activated` /
`CardScript.spell` schema; the additional-costs field
should live on `ActivatedSchema` and `SpellEffectSchema`.

The smallest variant set for v1 (per the Wave 4.8
follow-up 2 handoff):

- `{ kind: "sacrifice", target: "self" | "creature" |
"artifact" | "enchantment" | "permanent", amount: N }`
  — sacrifice N matching permanents the controller
  controls.
- `{ kind: "pay_life", amount: N }` — pay N life; the
  controller must have at least N life remaining.

The legality check rejects the activation / cast when
the player can't pay (the engine already handles a
similar "insufficient life to pay" check for cards like
Drana). The deduction happens on resolution (CR 602.2b —
costs are paid on activation, not resolution).

Out of scope for lane 63 (these are separate multi-lanes,
each adding a new `kind`):

- discard (already partially supported via existing
  discard keyword paths; a general additional-cost
  arm is a follow-up)
- exile_self
- mill_self
- tap_self
- mana discounts combined with additional costs (lane
  64 / 65 work)
- tap X creatures, sacrifice X creatures, etc. (covered
  by the existing sacrifice variant with amount > 1)

The smallest sample card is **Painful Truths** (sorcery,
"pay 1 life, draw 3 cards") which exercises only one
v1 variant. If the lane grows past one cost kind,
back out and ship Painful Truths alone, then queue a
follow-up lane for the sacrifice variant.

## Notes on the engine surface for lane 64 (affinity)

The smallest v1 variant for lane 64:
`{ kind: "affinity", color: "W"|"U"|"B"|"R"|"G"|"any",
reduction_per_match: N }`.

The engine reads the field on `SpellSchema` /
`ActivatedSchema`, counts the number of matching cards
the controller controls on the battlefield at cast /
activation time, multiplies by `reduction_per_match`,
and subtracts the result from the printed mana cost.
The minimum cost is `0` (the rest of the cost is
generic, and the affinity discount can drive the total
to 0 — Claws Out (`{3}{R}{R}` with affinity for artifacts
prints `{R}` reduced typically). Going below `0` is
illegal per CR 601.2f.

Where to wire it:

- `spell-casting/cast.ts#castSpell` — the printed cost
  is parsed and discounted before the can-cast
  legality check.
- `abilities/activated.ts#activateAbility` — same shape
  for activated abilities.
- `parseManaAbility` is unrelated (it's for mana
  abilities like "{T}: Add {G}", which don't have a
  cost to reduce).

The smallest sample card is **Dragonlord's Servant**
("Dragonlord's Servant costs {1} less to cast for each
Dragon you control.") — a single-color ("any" Dragon)
affinity. If the lane grows past single-color
affinity, back out and ship the affinity-for-color
variant first.

## Notes on the engine surface for lane 65 (granting triggered abilities)

The smallest v1 variant for lane 65:
`grantedTriggers: [{ from: "self", trigger_text: "..." }]`
on `AuraStaticSchema` (the Aura's static arm). The Aura
copies a specific scripted trigger from itself to each
enchanted target.

The engine reads the field in `refreshAuraBonuses`,
computes a per-target list of granted trigger texts,
and writes the list onto the enchanted card. The
trigger fire pipeline (`detectTriggeredAbilities`)
reads the list and fires alongside the card's own
scripted triggers.

Where to wire it:

- `keyword-actions/aura-bonus.ts#refreshAuraBonuses` —
  the per-target diff at the bottom of the function
  computes a `Set`/`Map` of granted trigger texts
  for each affected card; the granted list is part of
  the diff path. (Follow the pattern from lanes 52,
  54, 55, 56, 60, 62 each added a new arm here.)
- `abilities/triggered.ts#detectTriggeredAbilities` —
  when iterating scripted triggers for a card, also
  iterate `card.grantedTriggers` (the per-instance
  ledger that the Aura stamps). Each granted trigger
  fires the source's `card-id` event and uses the
  target's `controllerId` for the trigger's effects.
- `types/cards.ts#CardInstance` — add
  `grantedTriggers?: { trigger_text: string; from:
CardInstanceId }[]` (parallel to lane 59's
  `instanceCounters`).

The smallest sample card is **Lifelink-granting**:
find a single Aura that grants a triggered ability to
its enchanted creature. CR 702.15-style static
abundance. The sample card is a synthetic registered
via the test harness (the lane 49/52/55/59/60/62
pattern). If the lane grows past a single Aura arm,
back out and ship that arm alone, then queue a
follow-up lane for non-Aura static granting.
