# Wave 4.8 follow-up 7 — Agent prompt

You are continuing the Wave 4.8 card-scripts loop. Read
`docs/card-scripts/wave4.8-followup7-handoff.md` first — it
has the full process, conventions, and state for the next
session. Then read the done summary at the bottom of
`docs/card-scripts/wave4-blockers.md` for the prior loop's
shipped lanes (72, 73, 74, 76) and deferred gaps (75, 61).

## Mission

Drive an aggressive, iterative loop to land the remaining
priority card-script lanes. **Do not stop between lanes**;
pick the next gap autonomously and ship it. No
human-in-the-loop.

The remaining lanes, in priority order:

1. **Lane 75 — "Until end of turn" copy** (Sakashima-style,
   manifested, Akoumep Halberd's "as long as this is in
   play, it's a copy of [chosen permanent]"). A new
   `StaticSchema.become_copy: { target: CardInstanceId,
until: "end_of_turn" }` arm (parallel to lane 71's
   `protectionFrom`). v1 supports a single target + "all
   characteristics copied" semantics with a turn-key
   duration. The engine stamps the characteristics on the
   source's per-instance fields (name, type_line, P/T,
   keywords) via `refreshScriptedStatics`; a
   `turn-phases.ts` cleanup step rolls them back at end of
   turn. ~300-500 LOC + tests. **Deferred from the Wave 4.8
   follow-up 6 loop** as too large for the per-lane 40-turn
   budget — split into sub-pieces if needed; the smallest
   sub-piece is a single-target, "all characteristics
   copied", end-of-turn static with no exceptions.

2. **Lane 61 — Replacement effect for death** (Whip of
   Erebos / False Dawn). Foundational replacement-effect
   layer; **parked** per the Wave 4.8 follow-up 2
   handoff's process note. The engine has no general
   replacement-effect layer, so lane 61 is foundational
   work, not a normal lane. Open it as a separate
   multi-lane plan, not as the next lane in this loop.

## Process (mandatory — read the handoff for full details)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
/tmp/opencode/wave414-lane<N>-<slug> -b <type>/<scope>
origin/main` where `<N>` starts at 77 and `<slug>` is
   kebab-case, min 10 chars. `ln -s
/home/alex/Projects/planar-nexus/node_modules
/tmp/opencode/wave414-lane<N>-<slug>/node_modules` so
   test/lint/typecheck skip a fresh install. **Rebase on
   the latest main** (fetch + `git merge origin/main
--no-edit`) before pushing if the worktree was created
   before prior lanes merged.

2. **Scope discipline**: one schema arm + one engine arm +
   one card per lane. **Don't** ship a second sample card
   for a different pattern, **don't** refactor unrelated
   plumbing, **don't** partial-port a multi-card block.
   If the lane grows past one schema arm + one engine arm
   - one card, back out, document in `wave4-blockers.md`,
     and pick a smaller next lane.

3. **Implement**: schema → engine → sample card →
   dedicated test → ratchet. Read the handoff's "Notes on
   the engine surface for lane 75" section for engine-
   side wiring details.

4. **Run checks (in the worktree)**:
   - `PATH="$PWD/node_modules/.bin:$PATH" npx tsx
scripts/build-card-script-index.ts`
   - `PATH="$PWD/node_modules/.bin:$PATH" npm test
--silent` (must be all green; the AI
     `forge-gate`/`forge-selfplay`/`expert-agent`
     "is deterministic for a seed" flake is known — re-
     run once if it hits, then move on)
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
typecheck` (must be clean)
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run lint`
     (0 errors; warnings OK)
   - `PATH="$PWD/node_modules/.bin:$PATH" node
scripts/check-engine-size-budget.mjs` (must pass;
     budget currently 2750 lines for `schema.ts`,
     measured 2733 after lanes 72 + 73 + 74 + 76). Bump
     the budget in the SAME commit if needed (per the
     Wave 4.8 follow-up handoff's "bump the budget
     rather than fragmenting the family" rule). Update
     the docstring block in
     `scripts/check-engine-size-budget.mjs` with a
     one-paragraph history entry.
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
ratchet:test-count` (rewrites anchored doc blocks
     when test count changes; commit in the same commit)
   - **Bundle-size check (only when the lane grows the
     engine surface that the client bundle pulls in)**:
     `rm node_modules` (the symlink) and `npm ci`, then
     `npm run build`, then `node
scripts/check-bundle-budget.mjs --check`. Re-capture
     with `--capture` and commit the updated
     `config/bundle-budget.json` if it fails.

5. **Commit**: `git add -A && GIT_AUTHOR_NAME="Planar Nexus
Agent" GIT_AUTHOR_EMAIL="agent@planar-nexus.local"
GIT_COMMITTER_NAME="Planar Nexus Agent"
GIT_COMMITTER_EMAIL="agent@planar-nexus.local" git
commit -F COMMIT_MSG.txt`. Then `git rm --cached
COMMIT_MSG.txt && GIT_AUTHOR_NAME=... git commit
--amend --no-edit && rm COMMIT_MSG.txt`. Then `git
push --force-with-lease origin <branch>`. The Wave 4.8
   follow-up 5/6 process learned: `git commit` without
   the env vars picks up the husky global git config and
   the commit shows up under the wrong author — use the
   env vars explicitly on every `git commit` AND on every
   `git commit --amend`.

6. **Open PR**: write `PR_BODY.txt` AFTER the commit
   (the cleaner pattern — see the Wave 4.8 follow-up 3
   process note; writing it after keeps the file out of
   git until the `gh pr create --body-file` call reads
   it). Then `gh pr create --title "<type>(<scope>):
<one-line>" --body-file PR_BODY.txt --base main
--head <branch>`. Then `gh pr merge <PR> --squash
--delete-branch --admin` once checks pass. Commitlint
   subject is enforced as lower-case — write the subject
   in lowercase from the start.

7. **Conflict resolution (if main moves during the
   lane)**: `git merge origin/main --no-edit` then
   resolve any conflicts (the most common is the
   test-count doc drift between main and your branch —
   keep the higher values; the lane's contribution adds
   cases, so main's value will be lower or equal). Then
   `npm run ratchet:test-count` to confirm. Force-push
   and re-wait CI.

8. **Cleanup**: `git worktree remove
/tmp/opencode/wave414-lane<N>-<slug> --force && git
branch -D <branch>`. The `--delete-branch` flag on
   `gh pr merge` only deletes the remote branch.

## Aggressive loop rules

- **Don't ask the user between lanes.** Pick the next gap
  autonomously and ship it.
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
  is the right move (do NOT amend the lane). Wave 4.8
  follow-up 6 hit this flake ONCE on lane 72's local
  full-suite run; the second run passed clean. Budget
  for 1-2 extra CI runs per lane to absorb the flake.
- **Turn budget: 40 turns per lane max** (per
  `AGENTS.md` §Turn Budget). If a single lane exceeds
  this, it's too big — back out, document, and pick a
  smaller one. Lane 75 was deferred from the Wave 4.8
  follow-up 6 loop for this reason; if you can't ship
  it within 40 turns, split into smaller sub-pieces
  (e.g. ship lane 75a = schema + sample card + 1
  engine surface, lane 75b = the second engine surface,
  etc.).

## Done definition for the loop

When lane 75 is either shipped or marked multi-lane
blocker (with a paragraph in `wave4-blockers.md`
documenting why), append a Wave 4.8 follow-up 7 loop
done summary at the bottom of
`docs/card-scripts/wave4-blockers.md` documenting the
shipped lanes, the blocked gaps with their #2614 plan
work references, and a fresh test-count snapshot. Then
stop.

If even the smallest lane-75 sub-piece is blocked, that
means the engine changed since Wave 4.8 follow-up 6
and the loop should be paused for human review before
continuing.

Lane 61 (replacement effect for death) is parked; it
requires a foundational replacement-effect layer that
doesn't exist yet. **Do not** attempt lane 61 in this
loop.

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
