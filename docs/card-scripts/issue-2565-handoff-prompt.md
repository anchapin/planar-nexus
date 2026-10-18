# Handoff prompt — next chat session

> **What to paste into the next chat** (verbatim, after the system prompt).
> This continues the "loop through priority:high card-scripts ops" work
> the previous session established. The session before that one had
> verified lanes 31/32 from the wave45 doc were already shipped; the
> session that wrote this prompt completed issue-2565 partial work
> (PR #2818). The next session's first job is issue #2562 (SearchLibrary).

---

## System prompt addendum

You are continuing a multi-session loop through the open `priority:high`
card-scripts ops under issue #2487. Each iteration ships **one op** (or
the partial card work for an op whose engine already shipped). Each PR
ships off `main` from a topic branch, includes:

- card JSONs in `src/lib/game-state/card-scripts/cards/`
- tests in `src/lib/game-state/__tests__/`
- test-count ratchet (`docs/onboarding.md` + `docs/TEST_VIDEO_FIXTURES.md`)
- closing handoff doc (`docs/card-scripts/issue-NNNN-<slug>-handoff.md`)

Two commits per PR: code+ratchet, then handoff doc. `commit-msg` and
`pre-commit` are enforced by husky — no `[AI-assisted]` prefix on
commit subjects (commitlint rejects it).

## State at session start

Branch: `main` @ `2464050d` (current origin/main HEAD; may have moved).
Last merged work: wave 4.8 cleanup cycle (PRs #2814, #2816, #2817).
Most recent open PR: **#2818 — feat(card-scripts): addmana op fdn cards
(issue 2565)** — pushed from branch
`feat/issue-2565-addmana-fdn-druid-and-mascot`, 2 commits
(`aa0dfb8c`, `bc8495de`). CI in progress; check `gh pr checks 2818`
for current state.

## Loop cadence (per previous session)

1. **Verify the issue's engine plumbing is on main BEFORE doing any work.**
   Many of these issues were already shipped in earlier waves (issue
   #2559 was a partial-shipping case — engine shipped, only card
   scripts remained). Each issue's first action is `gh issue view NNNN`
   - `gh pr list --search "issue NNNN"` to find prior PRs.

2. **For "engine + cards" issues:** verify engine is shipped; if so,
   only ship the missing card scripts. For "engine not shipped" issues:
   full lane work (schema → ops → engine → cards → tests).

3. **Cadence per lane:**
   - worktree at `~/.local/share/opencode/worktree/<id>/<slug>` (or
     just use a topic branch on main if worktree operations get
     confusing — the previous session found `write` tool path resolution
     doesn't track shell cwd, so writes to the worktree path may
     actually land in the main repo path).
   - `npx tsx scripts/build-card-script-index.ts` to regenerate
     `cards/index.generated.ts` (gitignored) after adding JSONs.
   - `npx jest --no-coverage` to run tests.
   - `npm run ratchet:test-count` is preferred, but flaky on this
     machine due to a pre-existing flake in
     `src/ai/manamind/__tests__/forge-gate.test.ts`. Fall back to
     `npx jest --listTests | wc -l` for suite count + delta for test
     cases (per AGENTS.md small-machine rule).
   - commit message format: `feat|fix|docs(scope): subject (issue NNNN)`
   - two commits: code+ratchet first, handoff doc second.

4. **Loop order (priority:high, smallest first):**
   - ~~#2559 X-cost in triggered/activated~~ — DONE (engine shipped, no
     remaining card scripts whose real blocker is x-cost).
   - ~~#2565 AddMana~~ — DONE (PR #2818; 2 cards shipped, 2 deferred
     for other blockers; engine already shipped).
   - **#2562 SearchLibrary (filter, destination, shuffle)** — NEXT.
   - #2560 ReturnFromZone (graveyard → battlefield).
   - #2568 Enchant/Aura op (largest; layered work).

## What's tricky about #2562 (next iteration)

Likely schema + ops work. The issue title hints at three sub-features:

- **filter** — predicate on what can be searched (e.g. "creature card",
  "artifact card", "basic land").
- **destination** — where the searched card goes (hand, battlefield,
  graveyard, library itself, exile, etc.).
- **shuffle** — CR 701.20: "If a library is searched, shuffle it."
  This is its own operation that fires as a side effect.

The 27+ FDN cards needing this are typically tutor effects:
"Mana Drain"-style "search your library for an X, put it into your
hand, then shuffle." Some go further (put into battlefield tapped,
reveal, etc.).

Suggested scoping: ship **one** tutor (e.g. "Mystical Tutor" — search
your library for an instant or sorcery, put it into your hand, then
shuffle your library") as the canonical card. Use the standard FDN
draft to find which one is simplest. Other tutors may need additional
filter/destination combinations — defer them as the once-per-turn
limit and Cultivator's Caravan crew issue were.

## Pitfalls to avoid (from previous session)

- **`write` tool path resolution** doesn't track shell cwd. If you
  `cd` into a worktree via `cd` and then use `write`, the file may
  land in the main repo, not the worktree. Either:
  - Use a topic branch on main directly (drop the separate worktree).
  - Use absolute paths starting with `/home/alex/.local/share/...`
    for the worktree path (the previous session found `write` may
    still resolve relative to the original repo).
    Recommendation from prior: **skip worktrees**, use topic branches on
    main directly. This is what PR #2818 ended up shipping on.

- **`cards/*.json` strict schema**: `CardScriptSchema` is strict — it
  rejects `mana_cost`, `type_line`, `power`, `toughness` at the top
  level. Only include the script-shape fields (`name`, `oracle`,
  `activated`, `triggered`, etc.). Card metadata lives in the
  card-database path, not the JSON.

- **`cards/index.generated.ts`** is gitignored — don't commit it. It's
  a build artifact. `npx tsx scripts/build-card-script-index.ts`
  regenerates it from the JSONs.

- **Mana abilities** must use `activateManaAbility`, NOT `activateAbility`.
  `activateAbility` (generic path) refuses "any color" mana abilities
  with the error `"Choose a color: activate it as a mana ability"`. For
  multi-option abilities (e.g. Three Tree Mascot, Gilded Lotus), the
  call pattern is two-step:
  1. `activateManaAbility(state, playerId, cardId, idx)` →
     returns `{ success: true, options: ManaAbilityOption[] }`.
  2. Pick one option, call
     `activateManaAbility(state, playerId, cardId, idx, chosenOption)`.

- **`once_per_turn` on mana abilities** is declared in the JSON schema
  but **not enforced** by `activateManaAbility`. The schema comments
  at `schema.ts` mark this as a future-lane item. Don't write tests
  that depend on the limit being honored via the mana path; use
  `activateAbility` to test it (or drop the test).

- **Test-count ratchet** at `docs/onboarding.md` and
  `docs/TEST_VIDEO_FIXTURES.md`. The `<!-- TEST_COUNT:START -->` /
  `<!-- TEST_COUNT:END -->` anchored blocks are checked by
  `test-count-docs-guard` CI job. Update them in the same commit as
  any test change.

- **Coverage ratchet** (`scripts/ratchet-coverage.js`) — the
  threshold auto-bumps. Don't hand-raise it. The `npm run
test:coverage` command may fail on this machine (the same flake
  hits during the long full-Jest run); if it does, the GitHub Actions
  CI handles it after merge.

- **`mutation-smoke`** is fast (50ms). Full Stryker runs nightly in
  CI; locally prefer `npm run mutate:<module>` per AGENTS.md.
  Modules: layer-system, replacement-effects, spell-casting,
  trigger-system, state-based-actions, combat, mana. Skip the full
  `npm run test:mutation` (~40 min).

## How to start

```bash
cd /home/alex/Projects/planar-nexus
git status  # expect clean on main
git fetch origin
git log --oneline origin/main -1
gh pr checks 2818  # verify PR #2818 status before starting #2562
gh issue view 2562 --json title,body  # read the SearchLibrary issue
gh pr list --search "2562" --json number,title,state,mergeCommit  # any prior PRs?
git branch -a | grep -i "search.*library\|searchlibrary"  # any prior branches?
```

Then proceed with #2562's investigation: is the SearchLibrary op
already shipped? If yes, only card scripts remain. If no, full lane
work.

## Session-end convention

When done with an iteration, **stop and report** rather than auto-start
the next. Per the loop cadence, each iteration is its own PR. Don't
stack multiple ops in one PR unless explicitly told to. The handoff
prompt for the next session should:

- Summarize what shipped (PR #, branch, commit hashes).
- Note what's deferred and why (multi-blocker cards, etc.).
- Re-state the open issues that remain in the loop order.
- Highlight any CI issues, flakes, or known gaps.
- Surface any agent-environment quirks (path resolution, etc.).
