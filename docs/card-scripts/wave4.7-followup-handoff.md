# Wave 4.7 Follow-up Handoff — Next Session

## Mission

Drive an aggressive, iterative loop on the multi-lane blockers left
over from Wave 4.7. Each remaining issue is a single self-contained
lane that owns one full schema + engine + sample card + tests change
end-to-end. Ship each one as a clean PR, immediately pick the next.
Don't stop between lanes unless CI fails, the lane needs human input,
or the lane grows past a single self-contained unit.

Wave 4.7 shipped lanes 39–41 (the `enter_choice` engine arm, the
Heraldic Banner chosen-color anthem, and the chosen-color AddMana
half) and the lane 42 done summary (#2699, #2701, #2702, #2703).
The current wave picks up the **follow-up issues that the Wave
4.7 handoff identified but did not ship**, plus a small cleanup
lane and a data-driven test guard. The follow-up issue numbers
are stable: read `gh issue view 2704..2708` for the full text.

## Source of truth

- `docs/card-scripts/wave4-blockers.md` is the canonical
  blockers + done-summary doc. The "Wave 4.7 done summary"
  section names every shipped lane, every skipped lane, and
  every still-tracked follow-up. The "Blocked (multi-lane,
  still tracked)" section now points at the follow-up issue
  numbers.
- Issues #2704–#2708 are the canonical list of work this loop
  should attack. Each issue has a Proposal and Acceptance
  criteria section.
- `docs/card-scripts/drafts/fdn.md` is the unshipped-cards
  index. Cross-reference each follow-up with the drafter list
  to choose a one-card sample (Diamond Mare is the
  one-card sample for #2704; Banner of Kinship or Adaptive
  Automaton for #2705; Sorcerous Spyglass for #2708).
- `src/lib/game-state/card-scripts/schema.ts` is the one
  place for new fields. Use the `enter_choice` / `affects`
  shape that's already in place; do not invent a parallel
  schema for the same concept.
- `src/lib/game-state/keyword-actions/enter-choice.ts` and
  `src/lib/game-state/keyword-actions/scripted-statics.ts`
  are the right homes for the new arms. Avoid touching
  `card-scripts/interpret.ts` unless the new op dispatch
  genuinely needs a new case (and the Wave 4.7 lane 41 spell
  path is the model for that — `enter_choice` scripts only
  add a "chosen" sentinel guard there, no new dispatch).

## Priority order (highest-impact, lowest-blast-radius first)

Process in this order. **#2704 first** — it's the smallest,
most clearly scoped, and exercises already-shipped plumbing
with zero engine change. **#2705 second** — mirror the
Wave 4.7 lanes 39 + 40 split for the new `creature_type`
kind. **#2706 third** — data-driven guard, low-risk test
change. **#2707 fourth** — cleanup, depends on whether
Diamond Mare (#2704) shipped first. **#2708 last** — the
multi-lane `chosen_name` arm, the highest-blast-radius piece.

If a lane proves impossible, skip to the next and document
why in `docs/card-scripts/wave4-blockers.md`. The five
follow-ups are listed below; lane numbers reuse 43+.

1. **Lane 43 (easiest, ship first):** #2704 — Diamond Mare
   chosen-color anthem on a creature. **No engine change.**
   One card JSON + one test file + ratchet. Exercises the
   already-shipped `enter_choice: { kind: "color" }` and
   `affects.color: "chosen"` engine arms on a creature
   permanent instead of an artifact. This is the same
   one-card-sample shape as Wave 4.6 lane 36 (Smaug).

2. **Lane 44 (engine arm):** #2705a — `creature_type`
   enter_choice arm. Drop the early-return on
   non-`"color"` kinds in `hasEnterChoice`, add a
   `chosenCreatureType: string | null` field on
   `CardInstance` (mirror the `chosenColor` field),
   update `createEnterChoiceWaitingChoice` and
   `resolveEnterChoice` to accept a curated list of
   creature types (Human, Soldier, Wizard, Goblin, Elf,
   Vampire, Dragon, Merfolk, Zombie, Treefolk) for v1.
   Freeform types are a UI follow-up.

3. **Lane 45 (anthem):** #2705b — chosen creature type
   anthem. Extend `StaticSchema.affects.subtype` to
   accept the `"chosen"` sentinel (it's currently
   `z.string().min(1).optional()`). Read
   `source.chosenCreatureType` in `staticAffects` when
   `subtype === "chosen"`. Sample card: **Banner of
   Kinship** (artifact) or **Adaptive Automaton**
   (creature). Mirror the lane 40 heraldic-banner-anthem
   pattern.

4. **Lane 46 (test guard):** #2706 — data-driven guard
   in `src/lib/game-state/card-scripts/__tests__/drafted-scripts.test.ts`
   that asserts a script's `enter_choice.kind` agrees
   with its `oracle` field's wording. For `kind: "color"`
   the oracle must contain "choose a color" (or
   "choose a [white/blue/black/red/green]"). Other kinds
   are guarded `describe.skip` blocks with TODOs
   pointing at #2705 / #2708. Mirrors the existing
   text-vs-numbers guard.

5. **Lane 47 (cleanup):** #2707 — remove the Test Goggles
   synthetic card now that Heraldic Banner exercises the
   same `enter_choice` path. The plan in the issue
   proposes deleting `test_goggles_enter_choice.json`
   and porting the engine-arm-specific assertions from
   `enter-choice.test.ts` into a new fixture-driven
   `enter-choice-engine.test.ts` that doesn't need a
   real card JSON. **Skip this lane** if you instead
   ship Diamond Mare first and rename Test Goggles to
   "Diamond Mare" (the synthetic has the same shape as
   a real card; the only thing it gets wrong is the
   name and the missing P/T — which the engine reads
   from `cardData`, not the script).

6. **Lane 48 (multi-lane, ship last):** #2708 —
   Sorcerous Spyglass `chosen_name` arm. Two-lane pass:
   engine arm (`enter_choice: { kind: "chosen_name" }`,
   `chosenCardName` instance field) + "cards named X"
   lookup (a new `StaticSchema.chosen_name_block` or
   equivalent). Out of scope for the `creature_type` and
   `player` lanes (#2705). If lane 48 reveals more
   multi-lane work, back out and document why in
   `docs/card-scripts/wave4-blockers.md` like the
   Wave 4.6 handoff did for Sorcerous Spyglass.

## Process (mandatory, identical to Waves 4 / 4.5 / 4.6 / 4.7)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
/tmp/opencode/wave47followup-lane<N>-<slug> -b
feat/card-scripts-<slug> origin/main` (use `<N>`
   starting at 43; slugs kebab-case, min 10 chars).
   `ln -s /home/alex/Projects/planar-nexus/node_modules`
   into the worktree so test/lint/typecheck skip a fresh
   install. The `node_modules/.bin/` is the symlink target
   the existing lanes use; verify with `ls
/tmp/opencode/.../node_modules/.bin/`.

2. **Scope discipline**: a Wave 4.7 follow-up lane is one
   self-contained change. It can include a new schema
   field, the applicator wiring, one sample card, and
   its dedicated test. It must NOT include a second
   sample card for a different pattern, a refactor of
   unrelated plumbing, or a partial port of a
   multi-card block. If the lane needs to grow past one
   schema arm + one op + one card, back out, document
   the reason in `wave4-blockers.md`, and pick a
   smaller lane.

3. **Implement**: schema → engine → sample card →
   dedicated test → ratchet.
   - **Schema**: `src/lib/game-state/card-scripts/schema.ts`
     is the one place for new fields. Use the existing
     `enter_choice` / `affects` shape; do not invent a
     parallel schema for the same concept.
   - **Engine**: `src/lib/game-state/keyword-actions/enter-choice.ts`
     and `src/lib/game-state/keyword-actions/scripted-statics.ts`
     are the right homes for applicator changes. Avoid
     touching `card-scripts/interpret.ts` unless the
     new op dispatch genuinely needs a new case.
   - **Sample card**: one card, one new JSON under
     `src/lib/game-state/card-scripts/cards/`. Pick
     the simplest real card from the drafter list
     that exercises only the new schema+engine. For
     #2704 that's Diamond Mare (FDN). For #2705 it's
     Banner of Kinship or Adaptive Automaton. For
     #2708 it's Sorcerous Spyglass.

4. **Run checks (in the worktree)**:
   - `PATH="$PWD/node_modules/.bin:$PATH" npx tsx
scripts/build-card-script-index.ts` (regenerates
     the index — required when adding a new card JSON)
   - `PATH="$PWD/node_modules/.bin:$PATH" npm test --silent`
     (full suite — must be all green; the AI
     `forge-gate`/`forge-selfplay`/`expert-agent`
     "is deterministic for a seed" flake is known —
     re-run once if it hits, then move on)
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run typecheck`
     (must be clean)
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run lint`
     (0 errors; warnings OK)
   - `PATH="$PWD/node_modules/.bin:$PATH" node
scripts/check-engine-size-budget.mjs` (must pass;
     budget is currently 2050 lines for `interpret.ts`,
     measured 2041 — well under)
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
ratchet:test-count` (rewrites anchored doc blocks
     when test count changes)

5. **Commit**: `git add -A && GIT_AUTHOR_NAME="Planar
Nexus Agent" GIT_AUTHOR_EMAIL="agent@planar-nexus.local"
GIT_COMMITTER_NAME="Planar Nexus Agent"
GIT_COMMITTER_EMAIL="agent@planar-nexus.local" git
commit -F COMMIT_MSG.txt`. The user.name / user.email
   `-c` flags from earlier lanes also work; either
   pattern. Then `git rm --cached COMMIT_MSG.txt && git
commit --amend --no-edit` if it slipped in. Then `git
push --force-with-lease origin feat/card-scripts-<slug>`.
   `rm COMMIT_MSG.txt` after. **The Wave 4.7 loop learned
   the hard way**: if you `git commit` without
   `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` the husky
   pre-commit hook uses the global git config and the
   commit shows up under the wrong author. Use the env
   vars explicitly.

6. **Open PR**: write `PR_BODY.txt`, `gh pr create
--title "feat(card-scripts): <one-line> (#2594
follow-up)" --body-file PR_BODY.txt --base main
--head feat/card-scripts-<slug>`, then `gh pr merge
<PR> --squash --delete-branch --admin` once checks
   pass. The `--delete-branch` flag deletes the remote
   branch; the local worktree directory must be removed
   manually after exiting it (`git worktree remove ... &&
git branch -D ...`).

7. **Conflict resolution (if main moves during the
   lane)**: `git merge origin/main --no-edit`, then `git
checkout --theirs docs/onboarding.md
docs/TEST_VIDEO_FIXTURES.md && npm run ratchet:test-count
&& git add ... && git commit --no-edit && git push
--force-with-lease origin <branch>`. Resolve the
   ratchet numbers with `npm run ratchet:test-count` after
   the merge, not from the incoming snapshot. If
   `ratchet:test-count` hits the AI test flake
   (mid-ratchet) and never completes, fall back to
   `npx jest --listTests | wc -l` for the suite count and
   a before/after `jest <affected paths>` delta on `main`
   vs your branch for the test case count. The handoff
   from Wave 4.6 calls this out explicitly.

8. **Cleanup**: exit the worktree directory, then `git
worktree remove /tmp/opencode/wave47followup-lane<N>-<slug>
--force && git branch -D feat/card-scripts-<slug>`.

## Conventions (carried from Wave 4 / 4.5 / 4.6 / 4.7)

- **Branch**: `feat/card-scripts-<slug>` (lowercase,
  kebab-case, min 10 chars). `<slug>` is the lane's
  punchy name (e.g. `diamond-mare-anthem`, `enter-choice-creature-type-arm`,
  `enter-choice-text-guard`, `remove-test-goggles`,
  `sorcerous-spyglass-chosen-name`).
- **Commit subject**: lower-case, min 10 chars, type from
  `feat fix docs style refactor test chore revert`.
- **Reference #2594 follow-up** in the commit body and
  the PR body so the cross-references stay tight.
- **Conventional Commits**. Never check in
  `COMMIT_MSG.txt` or `PR_BODY.txt`. The Wave 4.7 lane
  40 squash hit a related quirk: if `COMMIT_MSG.txt`
  ends up in the squash, the post-merge `git rm --cached
  - amend`flow re-fights a phantom index entry. The
safer pattern is`git commit -F COMMIT_MSG.txt`and
*immediately*`git rm --cached COMMIT_MSG.txt && git
    commit --amend --no-edit && rm COMMIT_MSG.txt` all
    before pushing.
- **Test count**: ratchet in the same commit. The
  `test-count-docs-guard` CI step re-measures live Jest
  and fails on any drift in `docs/onboarding.md` or
  `docs/TEST_VIDEO_FIXTURES.md`.
- **Engine-size budget**: 2050 lines for `interpret.ts`
  (currently 2041). Going over 2050 again requires
  another budget bump — prefer reusing existing
  scaffolding or splitting the new arms into a tiny
  helper to stay under 2050.
- **Pre-commit hook** runs `eslint --fix` → `tsc
--noEmit` → `prettier --write` on staged
  *.{ts,tsx,md,json,...}. A failing typecheck blocks
  the commit; run typecheck before staging.
- **Markdown gets prettier'd**; keep diffs small and
  don't fight the formatter.

## Aggressive loop rules

- **Don't ask the user between lanes.** Pick the next
  gap autonomously and ship it.
- **Don't ship multi-lane work in one PR.** If a lane
  reveals a second pattern that also needs new schema,
  split it into a follow-up lane and put a paragraph
  in `wave4-blockers.md` documenting why.
- **Lane is "done"** only when: CI green, PR merged,
  worktree removed, branch deleted, local main pulled
  and re-ratcheted.
- **If CI fails on a lane**: don't push; fix the lane.
  If the fix is unclear, document the failure in
  `docs/card-scripts/wave4-blockers.md` and skip to the
  next lane. The AI `forge-gate`/`forge-selfplay`/`expert-agent`
  "is deterministic for a seed" test is a known
  order-dependent flake on main — if a CI run shows
  only that test failing, `gh run rerun --failed` is
  the right move (do NOT amend the lane).
- **Turn budget: 40 turns per lane max** (per
  `AGENTS.md` §Turn Budget). If a single lane exceeds
  this, it's too big — back out, document, and pick a
  smaller one.

## Multi-lane blockers (skip and document if you can't ship them)

These are explicitly out of scope for this wave per
the Wave 4.5 handoff's "Don't ship multi-lane schema
changes" rule. Each is larger than one self-contained
lane:

- **Copying a permanent** (Self-Reflection, Rite of
  Replication, Extravagant Replication): needs a new
  `CopyPermanent` op with P/T + keyword snapshot.
  ~400-700 LOC.
- **Granting triggered abilities to other cards** (Fake
  Your Own Death, Undying Malice): multi-lane because
  it intersects the layer system and the trigger
  pipeline.
- **Replacement effect for death** ("if X would die this
  turn, instead exile it"): needs the
  replacement-effect engine (CR 614). Multi-lane.
- **Additional costs (sacrifice/pay)** (Louisoix's
  Sacrifice): needs a top-level `additionalCosts`
  schema extension. Multi-lane.
- **Affinity / cost reduction** (Claws Out, Dragonlord's
  Servant): kicker-style cost reduction engine.
  Multi-lane.
- **"You may" optional trigger / effect**: needs
  optional effect semantics across many ops.
  Multi-lane.
- **Abilities granting color or type or keyword via
  static** (Redcap Gutter-Dweller): multi-lane static
  extension.
- **Abilities requiring X spent on other spells** (The
  Prima Vista): engine needs `manaSpentThisTurn`
  tracking per spell type.
- **Casting spells from exile / graveyard** (Muldrotha):
  engine needs zone-transition for cast-from-non-hand.
- **Token creation with embedded static**: needs an
  embedded `static: StaticSchema` field on
  `CreateTokenSchema` (parallel to the Aura schema).
- **Stun / finality counters**: needs a counter-type
  extension to the Counter schema.

Document any new blockers discovered mid-loop in
`docs/card-scripts/wave4-blockers.md` with: gap, blocker
reason, suggested follow-up issue number.

## State at session start

- **HEAD**: `31aed3ba` (Wave 4.7 done summary squash
  from PR #2703).
- **700 suites / 13852 cases** (13845 passed + 7
  skipped) — +27 vs Wave 4.6, +4 vs the original
  Wave 4.6 start.
- **Lint 0 errors, typecheck clean.**
- **Engine-size budget**: 2050 lines for
  `interpret.ts` (2041 used). Lane 43 (Diamond Mare)
  adds zero engine lines. Lanes 44 + 45 add a few
  lines each. Lane 48 (Sorcerous Spyglass) is the
  only one that risks a bump; prefer reusing the
  existing `substituteChosenColorInEffect` pattern
  from lane 41 to keep the engine arm tiny.
- **Working directory**: `/home/alex/Projects/planar-nexus`
  (clean).
- **No active worktrees** (none should exist after
  Wave 4.7 cleanup).

## Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 700 / 13852 green
# then start lane 43 (Diamond Mare, #2704) per the Process section above
# lanes 44, 45, 46, 47, 48 follow without stopping
```

End each lane with: `git log --oneline -1` on main
showing the new lane's commit, and `grep "Test suites"
docs/onboarding.md` showing the bumped numbers. If
those two checks pass, you're ready for the next lane
immediately.

## Done definition for the loop

When all five follow-up issues (#2704–#2708) are
either shipped or marked as multi-lane blockers (with
a paragraph in `wave4-blockers.md` documenting why),
write a final summary at the bottom of that file
documenting the shipped lanes, the blocked gaps with
their #2614 plan work references, and a fresh
test-count snapshot. Then stop.

If even #2704 (the smallest prerequisite) is blocked,
that means the engine changed since Wave 4.7 and the
loop should be paused for human review before
continuing.

## Process observations carried from Wave 4.5 / 4.6 / 4.7 (read these first)

- The AI `forge-gate`/`forge-selfplay`/`expert-agent`
  "is deterministic for a seed" test is a known
  order-dependent flake on main. If a CI run shows
  only that test failing, `gh run rerun --failed` is
  the right move — do NOT amend the lane.
- `ci-wait` can return `FAILED` on a freshly-opened PR
  with all checks still pending. Wait a second call
  to `ci-wait` to get a real verdict.
- `npm run ratchet:test-count` is reliable; run it
  in the same commit as any test count change. **If
  it hits the AI flake mid-ratchet**, fall back to
  manual count updates (see step 7 above).
- The handoff's process rule on `git worktree remove`:
  the `--delete-branch` flag on `gh pr merge` only
  deletes the remote branch. The local worktree
  directory must be removed manually after exiting it
  (`git worktree remove ... && git branch -D ...`).
- **Wave 4.7 new note**: the `gh pr merge` calls
  occasionally returned empty output even though the
  PR was merged seconds later. If `gh pr view <PR>
--json state` says `MERGED` after a moment, treat
  the merge as successful and move on. Don't re-run
  `gh pr merge` blindly.
- **Wave 4.7 new note**: `GIT_AUTHOR_NAME` /
  `GIT_AUTHOR_EMAIL` env vars on the commit command
  prevent the husky pre-commit hook from picking up
  the wrong author. The `-c user.name=...` form also
  works but the env-var form is more reliable when
  the commit is being re-amended (the env vars
  re-apply on the amend; the `-c` form does not).
- **Wave 4.7 new note**: the `enter_choice` engine
  arm in `keyword-actions/enter-choice.ts` has a
  `resolveCardIdForChoice` fallback that scans the
  battlefield for an unchosen card if the choice's
  `stackObjectId` isn't set. The current engine
  surfaces the choice with `stackObjectId` set to the
  entering card's id, so the fallback is defensive
  only. A follow-up could be to remove the fallback
  once the engine path is fully covered. Not a
  blocker for any of the follow-up lanes.
- **Wave 4.7 new note**: a card with only
  `enter_choice: { kind: "color" }` (Test Goggles) is
  legal under the schema refine clause but doesn't
  trigger any trigger / activated / spell path. The
  `drafted-scripts.test.ts` smoke test handles this
  case correctly (it skips such cards), but a drafter
  writing such a card would see no ETB effects
  beyond the enter choice. If the drafter wanted ETB
  triggers or activated abilities they'd have to add
  them explicitly. This is by design — the schema
  allows the bare-arm card for testing the engine
  arm in isolation (Test Goggles, the lane 39
  synthetic).
