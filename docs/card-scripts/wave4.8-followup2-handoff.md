# Wave 4.8 follow-up 2 handoff — Next session

## Mission

Drive an aggressive, iterative loop to land the
remaining multi-lane blockers from Wave 4.8 follow-up.
The Wave 4.8 follow-up priority lanes 56, 57, 58, 59
already shipped (PRs #2730, #2731, #2732, #2733 — see
`docs/card-scripts/wave4-blockers.md` for the Wave 4.8
follow-up done summary). This handoff targets the
remaining lanes that ride the Wave 4.8 work — the
multi-lane deferred work plus the #2614 drafter-list
follow-ups that the Wave 4.8 follow-up handoff
explicitly deferred until the Adaptive Automaton /
chosen-X work was done (it is now done).

The remaining work is intentionally multi-lane and
should be attacked the same way: one self-contained lane
per PR, immediate next-lane pickup, no human-in-the-loop.
Per the Wave 4.8 follow-up handoff's process rule:
"Don't ship multi-lane work in one PR. If a lane reveals
a second pattern that also needs new schema, split it
into a follow-up lane and put a paragraph in
`wave4-blockers.md` documenting why."

## Priority lanes (in order)

The follow-up work, in priority order:

1. **Lane 60 — "You may" optional trigger / effect
   semantics** (Perilous Snare, Cackling Counterforce,
   Skyship Buccaneer's later-payment variant). Many cards
   say "you may pay 2 life; if you do, draw a card" — a
   multi-lane that touches every op schema. The smallest
   scoped piece: an optional `"you_may": true` flag on
   the trigger's `effects` array that defers effects
   behind a confirmation prompt at resolution time. The
   current schema's `intervening_if` gate evaluates a
   static condition; a runtime "you may" prompt needs a
   new `waitingChoice` type. ~200-400 LOC + tests.

   Out of scope: dynamic cost reductions ("you may pay 2
   life" combined with another effect's discount), which
   is a separate multi-lane.

2. **Lane 61 — Replacement effect for death** ("if X
   would die this turn, instead exile it", Whip of
   Erebos, False Dawn). Needs the replacement-effect
   engine (CR 614) — the engine today has no general
   replacement-effect layer; the drafter list flags
   "destroy replacement" as a multi-lane. The smallest
   scoped piece: a `replacement_effects` array on
   `CardScriptSchema` (parallel to `triggers`) with a
   `dies / would_be_destroyed` event arm; the engine
   evaluates them at SBA time. ~200-400 LOC + tests.

3. **Lane 62 — Counter-based trigger gate** (Redcap
   Gutter-Dweller's "Goblins have menace when 3+ counters"
   half, deferred from Wave 4.8 follow-up lane 57). New
   `counter_gate: { counter, op, n }` field on
   `TriggerSchema` plus an engine evaluator in
   `trigger-system/`. ~80-150 LOC + tests. After lane 62,
   Redcap Gutter-Dweller's deferred trigger lands.

4. **Lane 63 — Additional costs** (`additionalCosts`
   schema extension for sacrifice/pay costs; Louisoix's
   Sacrifice, Drana's Sacrifice, Painful Truths). A
   general-purpose additional-costs field on
   `ActivatedSchema` and `SpellEffectSchema`:
   `additionalCosts: [{ kind: "sacrifice", target: "self"
| "creature" | ..., amount: N }, { kind: "pay_life",
amount: N }, ...]`. ~100-200 LOC + tests.

5. **Lane 64 — Affinity / cost reduction** (Claws Out,
   Dragonlord's Servant, Archmage of Runes, Mocking
   Sprite, Bolt Bend, Arcane Epiphany). A new
   `cost_reduction: { kind: "affinity", color: "W"|...,
reduction_per_match: N }` schema arm on `spell`/
   `ActivatedSchema` plus a parser that subtracts the
   affinity sum from the printed cost at activation time.
   ~100-200 LOC + tests.

6. **Lane 65 — Granting triggered abilities to other
   cards** (Fake Your Own Death, Undying Malice, Lifelink
   granting via static). A new static arm that adds
   `script.triggers` to the target (or copies a specific
   trigger from the source). Intersects the trigger fire
   pipeline; a multi-lane on its own. ~200-400 LOC + tests.

7. **Lane 66 — Token creation with embedded static**
   (embedded `static: StaticSchema` field on
   `CreateTokenSchema` and `CreatePredefinedTokenSchema`).
   Lets a token enter with P/T buffs, keywords, or
   triggered abilities. ~80-150 LOC + tests.

8. **Lane 67 — Stun / finality counters**. Counter-type
   extension to the `Counter` schema: `stun`, `finality`
   join the existing `+1/+1`. Adds per-counter-type
   behavior (stun counters prevent attack/block,
   finality counters bypass regeneration). ~80-150 LOC +
   tests.

9. **Lane 68 — Casting from exile / graveyard**
   (Muldrotha, Tinybones, Kroxa). A new
   `cast_from_zone: ["exile", "graveyard"]` schema arm on
   `spell`/`ActivatedSchema` plus zone-transition plumbing.
   ~100-200 LOC + tests.

10. **Lane 69 — Abilities requiring X spent on other
    spells** (The Prima Vista). The engine needs a
    `manaSpentThisTurn` tracking ledger per spell type
    that an `intervening_if` clause can read. ~150-300
    LOC + tests.

11. **Lane 70 — Copying a permanent** (Self-Reflection,
    Rite of Replication, Extravagant Replication). New
    `CopyPermanent` op with P/T + keyword + types
    snapshot. Multi-lane — touches layer-system,
    refreshAuraBonuses, and the chosen-X static
    substitution paths. ~400-700 LOC + tests.

12. **Lane 71 — Eaten by Piranhas real "protection from"
    effect** (deferred from Wave 4.8 follow-up lane 56).
    Banner of Kinship-style "enters with chosen X" ships
    the dual-choice arm; the actual "protection from
    [chosen color]" / "protection from [chosen creature
    type]" effect needs a new `protection_from` static
    arm + a keyword in the engine. The smallest scoped
    piece: a `protection_from: { color: "chosen"|"W"|...
|"any", subtype: "chosen"|string|"any" }` arm on
    `StaticSchema.affects` that adds the engine-side
    protection keyword on the source. ~80-150 LOC + tests.

Lanes 60–64 are the highest-priority follow-ups; they
unblock several real cards (Redcap's Goblin-menace
trigger; Painful Truths; Claws Out; Whip of Erebos).
Lanes 65–71 are explicitly multi-lane and should be
picked up only when the smaller-scope lanes are
exhausted.

## State at session start

- **HEAD**: `65de2e7b` (Wave 4.8 follow-up loop done
  summary commit; the Wave 4.8 follow-up handoff doc
  also landed as `7b6a822a` earlier in main).
- **714 → ? suites / 13992 → ? cases** (13985 passed +
  7 skipped). The Wave 4.8 follow-up 2 loop adds to
  these.
- **Lint 0 errors, typecheck clean.**
- **Engine-size budget**: 2300 lines for `schema.ts`
  (bumped 2200 → 2300 in Wave 4.8 follow-up lane 56;
  currently 2237). Lane 60+ may need another bump.
- **Working directory**:
  `/home/alex/Projects/planar-nexus` (clean).
- **Open issues relevant to this loop**: #2614 (the
  full drafter-list plan work — covers the Adaptive
  Automaton type-change full scope, additional costs,
  affinity, etc.); #2708 phase 2 is closed (lanes 49 +
  50 from Wave 4.7 phase 2 fully shipped). The
  lanes above are tracked under #2614 or adjacent
  multi-lane plans.

## Process (mandatory, identical to Wave 4 / 4.5 / 4.6 /

4.7 / 4.7 follow-up / 4.7 phase 2 / 4.8 / 4.8 follow-up)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
/tmp/opencode/wave410-lane<N>-<slug> -b
<type>/<scope> origin/main` where `<N>` starts at 60
   and `<slug>` is kebab-case, min 10 chars. `ln -s
/home/alex/Projects/planar-nexus/node_modules
/tmp/opencode/wave410-lane<N>-<slug>/node_modules`
   so test/lint/typecheck skip a fresh install. Verify
   with `ls
/tmp/opencode/wave410-lane<N>-<slug>/node_modules/.bin/jest`.

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
     lane 59 added `enters_with_counters_per_match`).
     New fields should integrate into the chosen-X arm
     family when possible.
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
     replacement effects, the new path lives in
     `trigger-system/` or `effect-resolution.ts`. For
     cost reductions, the parser is in
     `spell-casting/cast.ts` and `parseManaAbility`.
   - **Sample card**: ship one real card JSON per lane
     when the handoff lists one. Otherwise use a
     synthetic registered via the test harness (the
     lane 49/52/55 pattern).
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
     once if it hits, then move on. Wave 4.8 follow-up
     saw this flake at lane 56 / 59; `gh run rerun
--failed` resolved it both times).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
typecheck` (must be clean).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run lint`
     (0 errors; warnings OK).
   - `PATH="$PWD/node_modules/.bin:$PATH" node
scripts/check-engine-size-budget.mjs` (must pass;
     budget currently 2300 lines for `schema.ts`, measured
     2237). Bump the budget rather than fragmenting the
     chosen-X arm family (Wave 4.8 follow-up lane 56
     bumped 2200 → 2300 to cover lanes 56, 57, 59; lane 60+
     may need a similar bump).
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
/tmp/opencode/wave410-lane<N>-<slug> --force && git
branch -D <branch>`.

## Conventions (carried from prior loops)

- **Branch**: `<type>/<scope>` (lowercase, kebab-case,
  min 10 chars). `<scope>` is the lane's punchy name
  (e.g. `optional-trigger-gate`,
  `replacement-effect-death`,
  `counter-based-trigger-gate`,
  `additional-costs-extension`,
  `affinity-cost-reduction`,
  `granting-triggered-abilities`,
  `token-embedded-static`, `stun-finality-counters`,
  `cast-from-exile-graveyard`,
  `x-spent-on-other-spells`,
  `copying-permanent`, `protect-from-static`).
- **Commit subject**: lower-case, min 10 chars, type from
  `feat fix docs style refactor test chore revert`. Wave
  4.8 saw `header-case` linting on commitlint —
  lowercase is enforced; write the subject in lowercase
  from the start.
- **Reference #2614 follow-up** in the commit body and
  the PR body so the cross-references stay tight. For
  lane 60 (you may), reference the optional-trigger gate
  - #2614. For lane 62 (counter-based trigger), reference
    Redcap Gutter-Dweller (lane 57) + the counter gate +
    #2614. For lane 63 (additional costs), reference the
    sacrifice/pay schema extension + #2614. Etc.
- **Conventional Commits**. Never check in
  `COMMIT_MSG.txt` or `PR_BODY.txt`. The amend flow
  re-fights a phantom index entry if either file slips
  into a commit.
- **Test count**: ratchet in the same commit as any
  test count change, before pushing. `test-count-docs-guard`
  re-measures live Jest and fails on any drift in
  `docs/onboarding.md` or `docs/TEST_VIDEO_FIXTURES.md`.
- **Engine-size budget**: 2300 lines for `schema.ts`
  (the Wave 4.8 follow-up lane 56 bump). Lane 60+
  should bump to ~2350-2400 if they each add a new
  schema arm + the bounded scope. Bump by editing
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

When all of lanes 60–65 are either shipped or marked
multi-lane blockers (with a paragraph in
`wave4-blockers.md` documenting why), append a Wave 4.8
follow-up 2 loop done summary at the bottom of
`docs/card-scripts/wave4-blockers.md` documenting the
shipped lanes, the blocked gaps with their #2614 plan
work references, and a fresh test-count snapshot. Then
stop.

If even lane 60 (the smallest prerequisite) is blocked,
that means the engine changed since Wave 4.8 follow-up
and the loop should be paused for human review before
continuing.

## Process observations carried from previous loops

- The AI `forge-gate`/`forge-selfplay`/`expert-agent`
  "is deterministic for a seed" test is a known
  order-dependent flake on main. If a CI run shows only
  that test failing, `gh run rerun --failed` is the right
  move — do NOT amend the lane. Wave 4.8 saw this at
  lane 54 + 55; Wave 4.8 follow-up saw this at lane 56.
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
  (the `--live` path doesn't run `npm test`).
- The handoff's process rule on `git worktree remove`:
  the `--delete-branch` flag on `gh pr merge` only
  deletes the remote branch. The local worktree
  directory must be removed manually after exiting it
  (`git worktree remove ... && git branch -D ...`).
- Wave 4.8 lane 55 update on the add_color read path:
  `getCardColors(card)` unions `card.cardData.colors`
  with `card.chosenColorAdditions` (parallel to lane
  52's `subtypesOf(card)` union). When porting the
  counter-gate arm for lane 62, the new path must read
  `card.instanceCounters` (lane 59's per-instance ledger)
  to evaluate "this permanent has N+ counters" clauses.
- Wave 4.8 lane 54 update on the aura-bonus path: see
  `keyword-actions/aura-bonus.ts#refreshAuraBonuses`. The
  per-target diff at the bottom of that function now
  compares `nextAdds` (chosenTypeAdditions) AND
  `nextColors` (chosenColorAdditions) AND the existing
  P/T + keywords + RA/RB/RU/MB + losesAbilities diffs.
  When adding a new arm, follow the same pattern:
  compute a per-target `Set`/`Map`, then write the field
  only on the diff path.
- Wave 4.8 lane 55 schema's docstring on
  `add_creature_type` says "chosen-eviction-at-tombstone
  handled by the field being maintained by the refresh
  pass on battlefield cards only". This is the canonical
  pattern for any new "addition" arm: the field is
  per-instance + battlefield-zone-only, dropped when the
  source leaves the battlefield. Apply the same pattern
  to the new arms in lanes 60+ if they add a
  per-instance field.
- Wave 4.8 follow-up lane 56 update on the
  dual enter-choice path: `resolveEnterChoice` now
  handles the `"color_and_creature_type"` compound kind
  by writing BOTH `chosenColor` AND `chosenCreatureType`
  from one resolver call. The post-stamp
  `enters_with_counters_per_match` arm (lane 59) reads
  the JUST-stamped card from `updatedCards`, not the
  pre-stamp `card` binding, because the chosen subtype
  is set in the dispatch above.
- Wave 4.8 follow-up lane 58 update on the trigger
  pipeline: `detectTriggeredAbilities` adds a
  `losesAbilities` gate after the `whileCondition`
  check. The gate runs as a one-time filter so a
  `losesAbilities` permanent that ALSO has an active
  while-condition trigger doesn't burn cycles on the
  condition evaluator. New trigger gates in lane 62
  (counter-based) and lane 65 (granting triggered
  abilities) should follow the same shape: a
  one-time `card.<flag> === true` check after the
  `whileCondition` evaluator and before the
  `interveningIf` evaluator.
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
  imports before pushing.

## Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any leftover from Wave 4.8 follow-up)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 714 / 13992 green
# then start lane 60 (you may trigger gate, #2614 follow-up) per the Process section
# lanes 61 (replacement effect for death), 62 (counter-based trigger gate),
# 63 (additional costs), 64 (affinity / cost reduction), 65 (granting
# triggered abilities) follow in priority order
```

End each lane with: `git log --oneline -1` on main
showing the new lane's commit, and `grep "Test suites"
docs/onboarding.md` showing the bumped numbers. If those
two checks pass, you're ready for the next lane
immediately.
