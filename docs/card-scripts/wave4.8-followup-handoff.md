# Wave 4.8 follow-up handoff — Next session

## Mission

Drive an aggressive, iterative loop to land the remaining
multi-lane blockers from Wave 4.8 in priority order. The
Wave 4.8 priority lanes 52, 53, 54, 55 already shipped
(PRs #2723, #2725, #2726, #2729 — see
`docs/card-scripts/wave4-blockers.md` for the Wave 4.8
done summary). This handoff targets the deferred
multi-lane work that rides the Wave 4.8 follow-up.

The remaining work is intentionally multi-lane and
should be attacked the same way: one self-contained lane
per PR, immediate next-lane pickup, no human-in-the-loop.
Per the Wave 4.8 handoff's process rule: "Don't ship
multi-lane work in one PR. If a lane reveals a second
pattern that also needs new schema, split it into a
follow-up lane and put a paragraph in `wave4-blockers.md`
documenting why."

## Priority lanes (in order)

The follow-up work, in priority order:

1. **Lane 56 — Eaten by Piranhas full script** (chosen
   color + chosen creature type + remove all abilities).
   Depends on lane 54 (already shipped) for
   `removes_all_abilities`, lane 52/45 for chosen-type
   anthem/addition, lane 40 for chosen-color anthem.
   Missing piece is the **multiple `enter_choice` per
   card** schema arm (the current `enter_choice.kind`
   enum allows only one choice). Two paths:
   - **(a)** Add a second `enter_choice` schema field
     (e.g. `enter_choices: EnterChoiceSchema[]` array on
     CardScriptSchema) — the engine resolver iterates and
     surfaces both, each resolving independently.
   - **(b)** Add a "compound kind" enum member
     (e.g. `enter_choice.kind: "color_and_creature_type"`)
     that splits into two internal choices.
     Per the handoff: "Path (b) is the smaller-scope change
     (~30-50 LOC vs ~150-200 LOC for path (a))". Pick (b).
     Update `resolveEnterChoice` to write BOTH `chosenColor`
     and `chosenCreatureType` from one resolver call, and
     surface the dual picker as two `enter_choice`
     waitingChoices on a single entering permanent.

   The bounded scope (~30-50 LOC + tests):
   - Schema: add `"color_and_creature_type"` to
     `enter_choice.kind` enum; document the dual-resolver
     contract.
   - Engine: `resolveEnterChoice` dispatches on the new
     kind, writes both chosen fields, and returns a
     single success descriptor.
   - JSON: ship `eaten_by_piranhas.json` with the dual
     choice + chosen-color anthem + chosen-creature-type
     anthem + `removesAllAbilities` arm. End-to-end
     covered by the JSON.

   Out of scope: simultaneous multi-choice cards with
   more than two choices (a separate multi-lane deferred).

2. **Lane 57 — Redcap Gutter-Dweller full JSON** (counter-
   based trigger gate + chosen-color addition + token
   create). Lane 55 shipped `add_color: "R"` engine
   arm; this lane ships the JSON. The handoff says:
   "Redcap Gutter-Dweller's `add_color` literal-form,
   which is the cleanest sample card. Its 'create a red
   Treasure token' can ride `CreatePredefinedToken`
   (shipped lane 2544); the 'Goblins you control have
   menace when this permanent has 3+ counters' trigger
   requires a counter-based trigger gate (also deferred).
   Lane 55 ships ONLY the `add_color` static arm + a
   sample card (synthetic or Diamond Mare variant) +
   tests. Redcap Gutter-Dweller JSON is deferred."
   - **First, ship the static arm + the literal-form
     `add_color` path** (already done in lane 55).
   - **Then, ship Redcap Gutter-Dweller JSON** with:
     - `add_color: "R"` + `addColorToSelf: true` static
       (literal form).
     - `CreatePredefinedToken` `op: "CreatePredefinedToken"`
       with `subtype: "Treasure"` (or whatever the
       `Treasure` factory key is — verify with
       `RAW_CARD_SCRIPTS`).
     - **The "Goblins have menace when 3+ counters"
       trigger needs a counter-based trigger gate** which
       is a separate multi-lane (it's effectively a new
       `trigger.event`-style condition: "and this permanent
       has 3+ counters"). If that gate can't be done
       small, ship the JSON WITHOUT that trigger and
       document the deferral in `wave4-blockers.md`. The
       card's other two halves (chosen-color addition +
       Treasure token) are independently testable.
   - The handoff's bounded scope is ~30-50 LOC. The
     counter-gate expansion (if pursued) is the multi-lane
     follow-up.

3. **Lane 58 — Triggered-ability suppression for
   `removes_all_abilities`** (lane 54 follow-up). Lane 54
   shipped the activated-ability gate (`canActivateAbility`
   denies scripted activated abilities when
   `losesAbilities` is true). The triggered-ability gate
   is parallel: when an enchanted card's
   `script.triggers` list includes a triggered ability,
   the engine's trigger fire pipeline should skip
   firing on that card while `losesAbilities` is true.
   The work is:
   - **Find the trigger fire pipeline** (likely
     `keyword-actions/targeted.ts` and/or
     `trigger-system/trigger-fire.ts` or similar — grep for
     `getCardScript(card.cardData.name)?.triggers`).
   - **Add a `losesAbilities` check** before firing
     scripted triggers on a card.
   - **Add test coverage** for the suppression path.

4. **Lane 59 — Banner of Kinship full JSON**
   (`enters_with_counters_per_match: chosen_subtype` arm).
   Schema field for "enters with N counters, one for each
   creature you control of chosen subtype X" — parallel to
   lane 52's chosen-sentinel pattern. Banner of Kinship's
   "choose a creature type" is already supported via
   `enter_choice: { kind: "creature_type" }` (lane 44). The
   counter-per-subtype arm rides `enter_choice.kind`
   with a new value like `"creature_type_with_counters"`
   plus a `counters_per_match: chosen_subtype` schema
   field on the card. Sample card: Banner of Kinship.
   ~50-100 LOC + tests.

5. **Lane 60 — Optional / "you may" trigger / effect**
   semantics. Many cards say "you may pay 2 life; if you
   do, draw a card" — a multi-lane that touches every op
   schema. Deferred per the Wave 4.8 handoff's
   multi-lane blocker list.

6. **Lane 61 — Affinity / cost reduction** (Claws Out,
   Dragonlord's Servant, Archmage of Runes, Mocking
   Sprite, Bolt Bend, Arcane Epiphany). Needs a new
   `additionalCosts` schema arm with `affinityColor: "W"|"U"|"B"|"R"|"G"` and a parser that subtracts the affinity sum from the printed
   cost. ~100-200 LOC + tests.

7. **Lane 62 — Replacement effect for death** ("if X
   would die this turn, instead exile it"). Needs the
   replacement-effect engine (CR 614). Multi-lane. ~200-400
   LOC.

8. **Lane 63 — Casting from exile / graveyard**
   (Muldrotha, Tinybones). Needs zone-transition for
   cast-from-non-hand. ~100-200 LOC.

9. **Lane 64 — Additional costs** (`additionalCosts` schema
   extension for sacrifice/pay costs). Multi-lane.
   ~100-200 LOC.

10. **Lane 65 — Granting triggered abilities to other
    cards** (Fake Your Own Death, Undying Malice). Needs a
    static that adds `script.triggers` to the target.
    Multi-lane — intersects the trigger fire pipeline.

11. **Lane 66 — Token creation with embedded static**
    (embedded `static: StaticSchema` field on
    `CreateTokenSchema`). ~80-150 LOC.

12. **Lane 67 — Copying a permanent** (Self-Reflection,
    Rite of Replication, Extravagant Replication). New
    `CopyPermanent` op with P/T + keyword snapshot.
    Multi-lane. ~400-700 LOC.

13. **Lane 68 — Abilities requiring X spent on other
    spells** (The Prima Vista). Engine needs
    `manaSpentThisTurn` tracking per spell type.
    Multi-lane.

14. **Lane 69 — Stun / finality counters**. Counter-type
    extension to the `Counter` schema. ~80-150 LOC.

The lanes above 60 are all explicitly "explicitly deferred
per the Wave 4.8 handoff's 'Don't ship multi-lane schema
changes' rule until the Adaptive Automaton / chosen-X
work is done" — and that work is now done. Pick them up
only when the smaller-scope lanes 56–59 are exhausted.

## State at session start

- **HEAD**: `44279dcb` (Wave 4.8 loop done summary doc
  commit, including the `wave4.7-phase2-handoff.md` and
  `wave4.8-handoff.md` files that were originally in the
  workspace as untracked).
- **707 → 710 suites / 13907 → 13959 cases** (13952
  passed + 7 skipped). The Wave 4.8 follow-up loop
  adds to these.
- **Lint 0 errors, typecheck clean.**
- **Engine-size budget**: 2200 lines for `schema.ts`
  (currently 2174, lane 55 final). Lane 56/57 may add
  ~10-30 lines (the dual-choice arm and the literal-color
  ship); follow-up lanes should bump the budget if needed.
- **Working directory**:
  `/home/alex/Projects/planar-nexus` (clean).
- **Open issues relevant to this loop**: #2614 (drafter
  list plan work — covers the Adaptive Automaton type-
  change full scope, multiple enter choices, etc.); the
  Adaptive Automaton type-change half was Wave 4.8
  lane 51 (backed out) → Wave 4.8 lane 52 (shipped).
  Eaten by Piranhas and Banner of Kinship are still
  partially-blocked on #2614.

## Process (mandatory, identical to Wave 4 / 4.5 / 4.6 /

4.7 / 4.7 follow-up / 4.7 phase 2 / 4.8)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
/tmp/opencode/wave49-lane<N>-<slug> -b
<type>/<scope> origin/main` where `<N>` starts at 56 and
   `<slug>` is kebab-case, min 10 chars. `ln -s
/home/alex/Projects/planar-nexus/node_modules
/tmp/opencode/wave49-lane<N>-<slug>/node_modules` so
   test/lint/typecheck skip a fresh install. Verify with
   `ls /tmp/opencode/wave49-lane<N>-<slug>/node_modules/.bin/jest`.

2. **Scope discipline**: each lane is one self-contained
   change. Schema + engine + sample card + dedicated test
   is fine. **Don't** ship a second sample card for a
   different pattern, **don't** refactor unrelated
   plumbing, **don't** partial-port a multi-card block.
   If the lane grows past one schema arm + one engine arm
   - one card, back out, document the reason in
     `wave4-blockers.md`, and pick a smaller next lane.

3. **Implement**: schema → engine → sample card → dedicated
   test → ratchet.
   - **Schema**:
     `src/lib/game-state/card-scripts/schema.ts` is the
     one place for new fields. For each lane, follow
     the existing allow-list pattern (lane 52 added
     `add_creature_type`; lane 54 added `removesAllAbilities`;
     lane 55 added `add_color`). New fields should
     integrate into the chosen-X arm family when possible.
   - **Engine**: the right home depends on the arm. For
     Aura-static arms, update `refreshAuraBonuses`
     (`keyword-actions/aura-bonus.ts`). For general static
     arms, update `refreshScriptedStatics`
     (`keyword-actions/scripted-statics.ts`). For ability
     gates, update `abilities/activated.ts` (and possibly
     `abilities/parse.ts`).
   - **Sample card**: ship one real card JSON per lane
     when the handoff lists one. Otherwise use a
     synthetic registered via the test harness (the lane
     49/52/55 pattern).
   - **Tests**: dedicated `*.test.ts` file per lane,
     colocated in `src/lib/game-state/__tests__/`.

4. **Run checks (in the worktree)**:
   - `PATH="$PWD/node_modules/.bin:$PATH" npx tsx
scripts/build-card-script-index.ts` (regenerates the
     index — required when adding a new card JSON, like
     `eaten_by_piranhas.json` in lane 56 and
     `banner_of_kinship.json` in lane 59).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm test --silent`
     (full suite — must be all green; the AI
     `forge-gate`/`forge-selfplay`/`expert-agent` "is
     deterministic for a seed" flake is known — re-run
     once if it hits, then move on. Wave 4.8 saw this flake
     at lane 54 + 55; `gh run rerun --failed` resolved it
     both times).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
typecheck` (must be clean).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run lint`
     (0 errors; warnings OK).
   - `PATH="$PWD/node_modules/.bin:$PATH" node
scripts/check-engine-size-budget.mjs` (must pass;
     budget currently 2200 lines for `schema.ts` after the
     lane 54 bump, measured 2174). The Wave 4.8 handoff's
     process note: "bump the budget again rather than
     fragmenting the chosen-X arm family". Lane 56/57
     land at ~2180-2200; bump the budget as needed.
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
ratchet:test-count` (rewrites anchored doc blocks
     when test count changes). If this hits the AI flake
     mid-ratchet and never completes, fall back to manual
     count updates via `node scripts/ratchet-test-count.mjs
--live <counts.json>` with a hand-built JSON.

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
PR_BODY.txt --base main --head <branch>`. **Watch out:**
   the commit may accidentally include `PR_BODY.txt`. After
   the commit, `git rm --cached PR_BODY.txt && git commit
--amend --no-edit && rm PR_BODY.txt` to remove it before
   pushing. Then `gh pr create ...` followed by `gh pr
merge <PR> --squash --delete-branch --admin` once checks
   pass.

7. **Conflict resolution (if main moves during the lane)**:
   `git merge origin/main --no-edit` then resolve any
   conflicts (the most common is the test-count doc drift
   between main and your branch). For the test-count
   block: keep the higher values (the lane's contribution
   adds cases, so main's value will be lower or equal).
   Then `npm run ratchet:test-count` to confirm.
   Force-push and re-wait CI.

8. **Cleanup**: exit the worktree directory, then `git
worktree remove /tmp/opencode/wave49-lane<N>-<slug>
--force && git branch -D <branch>`.

## Conventions (carried from prior loops)

- **Branch**: `<type>/<scope>` (lowercase, kebab-case,
  min 10 chars). `<scope>` is the lane's punchy name
  (e.g. `dual-enter-choice`, `redcap-gutter-dweller-full`,
  `loses-abilities-trigger-gate`,
  `banner-of-kinship-counters`).
- **Commit subject**: lower-case, min 10 chars, type from
  `feat fix docs style refactor test chore revert`.
  Wave 4.8 saw `header-case` linting on commitlint —
  lowercase is enforced; write the subject in lowercase
  from the start.
- **Reference #2614 follow-up** in the commit body and
  the PR body so the cross-references stay tight. For
  lane 56 (Eaten by Piranhas), reference the dual enter
  choice arm + #2614. For lane 57 (Redcap), reference
  #2614 + the trigger-gate deferral. For lane 58,
  reference the lane 54 closure + the trigger pipeline.
- **Conventional Commits**. Never check in `COMMIT_MSG.txt`
  or `PR_BODY.txt`. The amend flow re-fights a phantom
  index entry if either file slips into a commit.
- **Test count**: ratchet in the same commit as any test
  count change, before pushing. `test-count-docs-guard`
  re-measures live Jest and fails on any drift in
  `docs/onboarding.md` or `docs/TEST_VIDEO_FIXTURES.md`.
- **Engine-size budget**: 2200 lines for `schema.ts` (the
  lane 54 bump). Lane 56/57 should bump to ~2250-2300 if
  they each add the dual-choice arm + Banner of Kinship's
  per-match counter arm. Bump by editing
  `scripts/check-engine-size-budget.mjs` and commit the
  bump + the lane work in one PR per the Wave 4.8
  handoff's process note.
- **Pre-commit hook** runs `eslint --fix` → `tsc
--noEmit` → `prettier --write` on staged
  *.{ts,tsx,md,json,...}. A failing typecheck blocks
  the commit; run typecheck before staging. If `tsc
--noEmit` passes locally but CI fails with
  `Cannot find name`, the husky pre-commit hook's local
  typecheck can pass while CI's typecheck flags a missing
  import — Wave 4.8 lane 55 saw this with the
  `CardInstance` import. Always check the import list
  against typecheck's actual usage before pushing.
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
  `expert-agent` "is deterministic for a seed" test is a
  known order-dependent flake on main; if a CI run shows
  only that test failing, `gh run rerun --failed` is the
  right move (do NOT amend the lane).
- **Turn budget: 40 turns per lane max** (per
  `AGENTS.md` §Turn Budget). If a single lane exceeds
  this, it's too big — back out, document, and pick a
  smaller one.

## Done definition for the loop

When all of lanes 56–59 are either shipped or marked
multi-lane blockers (with a paragraph in
`wave4-blockers.md` documenting why), append a Wave 4.8
follow-up loop done summary at the bottom of
`docs/card-scripts/wave4-blockers.md` documenting the
shipped lanes, the blocked gaps with their #2614 plan
work references, and a fresh test-count snapshot. Then
stop.

If even lane 56 (the smallest prerequisite) is blocked,
that means the engine changed since Wave 4.8 and the
loop should be paused for human review before continuing.

## Process observations carried from previous loops

- The AI `forge-gate`/`forge-selfplay`/`expert-agent`
  "is deterministic for a seed" test is a known
  order-dependent flake on main. If a CI run shows only
  that test failing, `gh run rerun --failed` is the right
  move — do NOT amend the lane. Wave 4.8 saw this at
  lane 54 (`gh run rerun --failed` resolved it) and lane
  55 (`gh run rerun --failed` resolved it). Budget for 1-2
  extra CI runs per lane to absorb the flake.
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
- Wave 4.8 lane 53 update on the chosen-name engine
  flow: see `bridge_state_to_chosen_name` and
  `resolveEnterChoice` (lane 44, #2705a). The chosen
  resolution writes to `card.chosenColor` /
  `card.chosenCreatureType` and stamps the source.
  Multiple `enter_choice` per card requires either a
  second `enter_choice` schema field (path (a)) or a
  compound kind enum member (path (b)). The Wave 4.8
  handoff recommends path (b) for its smaller scope.
- Wave 4.8 lane 55 update on the add_color read path:
  `getCardColors(card)` unions `card.cardData.colors`
  with `card.chosenColorAdditions` (parallel to lane 52's
  `subtypesOf(card)` union). When porting the dual-choice
  arm for lane 56, the new path must write to BOTH
  `card.chosenColor` and `card.chosenCreatureType` from
  the single resolver call so downstream unions pick up
  both.
- Wave 4.8 lane 54 update on the aura-bonus path: see
  `keyword-actions/aura-bonus.ts#refreshAuraBonuses`. The
  per-target diff at the bottom of that function now
  compares `nextAdds` (chosenTypeAdditions) AND
  `nextColors` (chosenColorAdditions) AND the existing
  P/T + keywords + RA/RB/RU/MB diffs. When adding a new
  arm, follow the same pattern: compute a per-target
  `Set`/`Map`, then write the field only on the diff
  path.
- Wave 4.8 lane 55 schema's docstring on
  `add_creature_type` says "chosen-eviction-at-tombstone
  handled by the field being maintained by the refresh
  pass on battlefield cards only". This is the canonical
  pattern for any new "addition" arm: the field is
  per-instance + battlefield-zone-only, dropped when the
  source leaves the battlefield. Apply the same pattern
  to the dual-choice arm if it adds a per-instance field.
- Wave 4.7 phase 2 lane 49 update on the chosen-name
  engine flow: `resolveChosenName` writes
  `card.chosenCardName` from a `choose_cards`
  waitingChoice. Use the same dispatch pattern for any
  new kind in lane 56's `resolveEnterChoice`.
- The Wave 4.8 process saw the lane 52 commit-message
  docstring (~70 lines) blow the schema budget to 2136
  (over the 2100 lane-50 ceiling). The lane 54 budget
  bump (2100 → 2200) covered that + the lane 54 work
  (~36 lines). Future lanes should keep docstrings lean —
  the engine behavior is documented in the engine file,
  not the schema. The schema docstring should describe the
  FIELD, not the WHOLE path.
- Wave 4.8 lane 55 process observation: `git commit`
  without `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env vars
  picks up the husky global git config and the commit
  shows up under the wrong author. Use the env vars
  explicitly, on every `git commit` (and on every
  `git commit --amend`).
- Wave 4.8 lane 55 process observation: `git rm --cached
PR_BODY.txt && git commit --amend --no-edit && rm
PR_BODY.txt` is required after `git add -A && git
commit -F COMMIT_MSG.txt` — the amend flow without
  this leaves `PR_BODY.txt` in the commit. Always do the
  amend-and-rm before pushing.
- Wave 4.8 lane 55 process observation: the husky
  pre-commit hook's `tsc --noEmit` can pass locally while
  CI's `tsc --noEmit` flags a missing import. Always
  cross-check that every type used in a test file is in
  the file's `import type { ... } from "../types"` block
  before pushing. The lane 55 fix was adding
  `CardInstance` to the type imports after a test used
  `as CardInstance` cast.

## Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any leftover from Wave 4.8)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 710 / 13959 green
# then start lane 56 (Eaten by Piranhas dual enter choice, #2614 follow-up) per the Process section
# lanes 57 (Redcap Gutter-Dweller full), 58 (losesAbilities trigger gate), 59 (Banner of Kinship) follow in priority order
```

End each lane with: `git log --oneline -1` on main
showing the new lane's commit, and `grep "Test suites"
docs/onboarding.md` showing the bumped numbers. If those
two checks pass, you're ready for the next lane
immediately.
