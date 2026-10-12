# Wave 4.8 follow-up 4 handoff — Next session

## Mission

Drive an aggressive, iterative loop to land the next three
priority lanes from the Wave 4.8 follow-up 3 done summary's
remaining work. Wave 4.8 follow-up 3 shipped lanes 63, 64,
and 65 (PRs #2738, #2743, #2744 — see
`docs/card-scripts/wave4-blockers.md` for the done
summary).

The next three lanes in priority order, per the Wave 4.8
follow-up 3 done summary's "Lane continue rule":

1. **Lane 66 — Token creation with embedded static**
   (Adaptive Automaton, Avenger of Zendikar, Hornet Queen,
   Cloudblazer,一大 many token-makers). A new schema arm
   on the existing `CreateTokenSchema` / `CreatePredefinedTokenSchema`
   that lets the created token carry a static bonus
   (`power`, `toughness`, `keywords`, `restrictions`).
   Touches the token-creation path in
   `effect-resolution.ts` and the per-instance stamping
   pass in `keyword-actions/scripted-statics.ts`. ~150-300
   LOC + tests.
2. **Lane 67 — Stun / finality counters** (Magmatic
   Hellkite, Sheoldred's Headcracker, a long tail of
   recent cards). Generalize the existing
   `instanceCounters` ledger (lane 59) to support arbitrary
   counter types (stun: CR 122.1d, finality: CR 122.1d,
   `+1/+1`, `-1/-1`, etc.) with rule-driven ETB placement,
   end-of-turn removal (stun), and death-skipping
   (finality). ~150-300 LOC + tests.
3. **Lane 68 — Cast from exile / graveyard** (Evoke,
   Flashback, Jump-Start, Undergrowth, Escape, As Foretold,
   Yawgmoth's Vile Offer). A general-purpose
   `castable_from: "exile" | "graveyard" | "command"`
   schema arm on `CardScriptSchema` plus a cast-time
   legality check that the card is in the named zone and a
   post-resolution zone redirect (e.g. exile for
   flashback). ~200-400 LOC + tests.

Lane 61 ("replacement effect for death", Whip of Erebos /
False Dawn) stays blocked per the Wave 4.8 follow-up 2
done summary: the engine has no general replacement-effect
layer, so lane 61 is foundational work, not a normal lane.
Open it as a separate multi-lane plan, not as the next lane
in this loop.

Lanes 69–71 (X-spent-on-other-spells, copying a permanent,
protection-from static) are explicitly multi-lane and
remain parked until the smaller-scope lanes (66, 67, 68)
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

1. **Lane 66 — Token creation with embedded static**
   (Adaptive Automaton, Avenger of Zendikar, Hornet Queen,
   Cloudblazer). The smallest scoped piece: extend the
   existing `CreateTokenSchema` with an
   `embedded_static: { power, toughness, keywords,
restrictions? }` field that the engine stamps onto the
   created token's `CardInstance` at creation time. The
   static is read by the same refresh paths that handle
   scripted Auras (lane 65's `grantedTriggers` pattern:
   per-instance + battlefield-zone-only). v1 supports a
   single power/toughness + a list of keywords; restrictions
   (`restrictAttack`, `restrictBlock`, `maxBlockers`) are
   a follow-up lane. The smallest sample card is
   Adaptive Automaton-style "creature tokens get +1/+1
   and have all creature types" (the existing
   `allCreatureTypes` field on `animatedUntilEndOfTurn`
   parallels the lane pattern).

2. **Lane 67 — Stun / finality counters** (Magmatic
   Hellkite, Sheoldred's Headcracker, a long tail of
   recent cards). The smallest scoped piece: generalize
   the existing `instanceCounters?: Record<string, number>`
   ledger (lane 59) to support arbitrary named counter
   types (stun: CR 122.1d, finality: CR 122.1d, +1/+1,
   -1/-1, etc.) with rule-driven ETB placement. The
   engine reads the counter type and applies the matching
   rule (stun counters prevent untap; finality counters
   prevent graveyard recursion). v1 supports a single
   `enters_with_counters: [{ counter, count }]` field on
   the script's `spell` block (parallel to the lane 59
   `enters_with_counters_per_match` pattern); the per-turn
   stun-removal and finality-skipping effects are
   follow-up lanes. The smallest sample card is Magmatic
   Hellkite's stun-counter effect on searched lands (the
   existing `SearchLibrarySchema.stun` field is the
   v0 substrate; lane 67 generalizes it).

3. **Lane 68 — Cast from exile / graveyard** (Evoke,
   Flashback, Jump-Start, Undergrowth, Escape, As Foretold,
   Yawgmoth's Vile Offer). The smallest scoped piece: a
   new `castable_from: ["exile", "graveyard", "command"]`
   array on `CardScriptSchema` plus a cast-time legality
   check that the card is in one of the named zones and a
   post-resolution zone redirect (e.g. exile for
   flashback, graveyard for escape). v1 supports a single
   zone in the array; multi-zone casting is a follow-up.
   The smallest sample card is a flashback spell (CR
   702.143a, "You may cast this card from your graveyard
   for its flashback cost. Then exile it.") — the existing
   `flashback` field is the v0 substrate; lane 68
   generalizes it to a `castable_from` enum.

Lanes 66 and 67 are the highest-priority follow-ups; they
unblock a long tail of recent cards (the "token
embedded static" family is the bulk of drafter-list
card scripts in #2614; the "stun / finality counter"
family is the second-largest). Lane 68 is the smallest
of the explicitly multi-lane cases but still tractable
in one lane.

## State at session start

- **HEAD**: `43161b97` (Wave 4.8 follow-up 3 done summary
  - handoff doc commit; the wave4.8-followup3-handoff.md
    doc itself was committed in the previous loop, and the
    wave4.8-followup3-handoff.md done summary is the
    follow-up 4 baseline).
- **719 → ? suites / 14041 → ? cases** (14034 passed +
  7 skipped). The Wave 4.8 follow-up 4 loop adds to these.
- **Lint 0 errors, typecheck clean** (the previous
  baseline).
- **Engine-size budget**: 2450 lines for `schema.ts`
  (bumped 2400 → 2450 in Wave 4.8 follow-up lane 65;
  measured 2408 after lanes 63 + 64 + 65). Lane 66+ may
  need another bump if the new schema fields push past
  2450 — the historical precedent is "bump the budget
  rather than fragmenting the chosen-X / additional-costs
  / affinity / grants family."
- **Working directory**:
  `/home/alex/Projects/planar-nexus` (clean).
- **Open issues relevant to this loop**: #2614 (the full
  drafter-list plan work — covers the Adaptive Automaton
  type-change full scope, additional costs, affinity,
  etc.); the lanes above are tracked under #2614 or
  adjacent multi-lane plans.
- **Just-shipped context**: PRs #2738, #2743, and #2744
  are merged on main. Lane 63 added `additionalCosts.pay_life`
  - `additionalCosts.sacrifice` arms on the existing
    `CardScriptSchema.additionalCosts` slot. Lane 64 extended
    the `affinity` field with a `color` arm (alongside the
    existing `subtype` arm) and added `reduction_per_match`
    to both arms. Lane 65 added a `static.grants.triggers`
    arm on `AuraStaticSchema` and wired the trigger fire
    pipeline to fire granted triggers on a `dies` event.
    All three are v1 single-piece add-ons; no wider
    refactor landed.

## Process (mandatory, identical to Wave 4 / 4.5 / 4.6 /

4.7 / 4.7 follow-up / 4.7 phase 2 / 4.8 / 4.8 follow-up /
4.8 follow-up 2 / 4.8 follow-up 3)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
/tmp/opencode/wave412-lane<N>-<slug> -b
<type>/<scope> origin/main` where `<N>` starts at 66
   and `<slug>` is kebab-case, min 10 chars. `ln -s
/home/alex/Projects/planar-nexus/node_modules
/tmp/opencode/wave412-lane<N>-<slug>/node_modules`
   so test/lint/typecheck skip a fresh install. Verify
   with `ls
/tmp/opencode/wave412-lane<N>-<slug>/node_modules/.bin/jest`.

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
     added `static.grants.triggers`). New fields should
     integrate into the chosen-X / additional-costs /
     affinity / grants arm family when possible.
   - **Engine**: the right home depends on the arm.
     For Aura-static arms, update `refreshAuraBonuses`
     (`keyword-actions/aura-bonus.ts`). For general
     static arms, update `refreshScriptedStatics`
     (`keyword-actions/scripted-statics.ts`). For
     token-creation arms (lane 66), update
     `effect-resolution.ts#applyCreateToken` (or the
     relevant op dispatcher). For counter-ledger arms
     (lane 67), update `keyword-actions/enters.ts`
     (`resolveEnterChoice`) for ETB placement and
     `turn-phases.ts` for stun-counter untap prevention.
     For cast-from-zone arms (lane 68), update
     `spell-casting/cast.ts#canCastSpell` for the
     legality check and `spell-casting/resolve.ts` for
     the post-resolution zone redirect.
   - **Sample card**: ship one real card JSON per lane
     when the handoff lists one. Otherwise use a
     synthetic registered via the test harness (the
     lane 49/52/55/59/60/62/63/64/65 pattern).
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
     follow-up 3 loop did NOT hit this flake on any
     lane; the documented `--live <counts.json>` fallback
     was not needed).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
typecheck` (must be clean).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run lint`
     (0 errors; warnings OK).
   - `PATH="$PWD/node_modules/.bin:$PATH" node
scripts/check-engine-size-budget.mjs` (must pass;
     budget currently 2450 lines for `schema.ts`,
     measured 2408 after lanes 63 + 64 + 65). Bump the
     budget rather than fragmenting the chosen-X /
     additional-costs / affinity / grants family
     (Wave 4.8 follow-up lane 65 bumped 2400 → 2450 to
     cover the lane 65 work).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
ratchet:test-count` (rewrites anchored doc blocks
     when test count changes). The Wave 4.8 follow-up 3
     loop did not hit the AI flake mid-ratchet; if a
     future loop hits it, fall back to manual count
     updates via `node scripts/ratchet-test-count.mjs
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
   Wave 4.8 follow-up 3 process learned: `git commit`
   without the env vars picks up the husky global git
   config and the commit shows up under the wrong
   author. Use the env vars explicitly.

6. **Open PR**: write `PR_BODY.txt` AFTER the commit
   (this is the cleaner pattern — see the Wave 4.8
   follow-up 3 process note). Then `gh pr create
--title "<type>(<scope>): <one-line>" --body-file
PR_BODY.txt --base main --head <branch>`. Then `gh pr
merge <PR> --squash --delete-branch --admin` once
   checks pass. **Do not** `git add PR_BODY.txt` —
   writing the file post-commit avoids the amend
   `git rm --cached` step for that file.

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
/tmp/opencode/wave412-lane<N>-<slug> --force && git
branch -D <branch>`.

## Conventions (carried from prior loops)

- **Branch**: `<type>/<scope>` (lowercase, kebab-case,
  min 10 chars). `<scope>` is the lane's punchy name
  (e.g. `token-embedded-static` for lane 66,
  `stun-finality-counters` for lane 67,
  `cast-from-exile-graveyard` for lane 68).
- **Commit subject**: lower-case, min 10 chars, type from
  `feat fix docs style refactor test chore revert`. Wave
  4.8 saw `header-case` linting on commitlint —
  lowercase is enforced; write the subject in lowercase
  from the start.
- **Reference #2614 follow-up** in the commit body and
  the PR body so the cross-references stay tight. For
  lane 66 (token embedded static), reference the
  embedded-static arm + #2614. For lane 67 (stun /
  finality counters), reference the counter-ledger
  generalization + #2614. For lane 68 (cast from exile /
  graveyard), reference the `castable_from` enum +
  #2614.
- **Conventional Commits**. Never check in
  `COMMIT_MSG.txt` (amend-rm before pushing) or
  `PR_BODY.txt` (write it AFTER the commit, per the
  Wave 4.8 follow-up 3 process note).
- **Test count**: ratchet in the same commit as any
  test count change, before pushing. `test-count-docs-guard`
  re-measures live Jest and fails on any drift in
  `docs/onboarding.md` or `docs/TEST_VIDEO_FIXTURES.md`.
- **Engine-size budget**: 2450 lines for `schema.ts`
  (the Wave 4.8 follow-up lane 65 bump). Lanes 66 + 67
  - 68 should fit under 2450 (each adds a small field
  - at most one refine); if the schema grows past 2450,
    bump the budget in the SAME commit per the Wave 4.8
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

When all of lanes 66, 67, 68 are either shipped or
marked multi-lane blockers (with a paragraph in
`wave4-blockers.md` documenting why), append a Wave
4.8 follow-up 4 loop done summary at the bottom of
`docs/card-scripts/wave4-blockers.md` documenting the
shipped lanes, the blocked gaps with their #2614 plan
work references, and a fresh test-count snapshot. Then
stop.

If even lane 66 (the smallest prerequisite) is blocked,
that means the engine changed since Wave 4.8 follow-up
3 and the loop should be paused for human review before
continuing.

Lane 69+ (X-spent-on-other-spells, copying a permanent,
protection-from static) are NOT in this loop's scope —
pick those up in a future Wave 4.8 follow-up 5 (or
equivalent) handoff after lanes 66, 67, 68 ship. Lane
61 (replacement effect for death) is also parked; it
requires a foundational replacement-effect layer that
doesn't exist yet.

## Process observations carried from previous loops

- The AI `forge-gate`/`forge-selfplay`/`expert-agent`
  "is deterministic for a seed" test is a known
  order-dependent flake on main. If a CI run shows
  only that test failing, `gh run rerun --failed` is
  the right move — do NOT amend the lane. Wave 4.8
  saw this at lane 54 + 55; Wave 4.8 follow-up saw
  this at lane 56; Wave 4.8 follow-up 2 saw it once
  on the local lane 60 run and once on lane 62's
  `ratchet:test-count` (worked around with the
  `--live` fallback). Wave 4.8 follow-up 3 did NOT
  hit this flake on any lane. Budget for 1-2 extra
  CI runs per lane to absorb the flake.
- `ci-wait` can return `FAILED` on a freshly-opened
  PR with all checks still pending. Wait a second
  call to `ci-wait` to get a real verdict. (`sleep
60 && gh pr checks <PR>` is a good way to seed the
  API.)
- `npm run ratchet:test-count` is reliable; run it
  in the same commit as any test count change. The
  Wave 4.8 follow-up 3 loop did not hit the AI flake
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
  every `git commit --amend`). Wave 4.8 follow-up 3
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
  ended with schema.ts at 2408 (under 2450); if a
  single lane pushes past 2450, bump the budget in
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

## Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any leftover from Wave 4.8 follow-up 3)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 719 / 14041 green
# then start lane 66 (token creation with embedded static, #2614 follow-up) per the Process section
# lanes 67 (stun / finality counters), 68 (cast from exile / graveyard) follow in priority order
```

End each lane with: `git log --oneline -1` on main
showing the new lane's commit, and `grep "Test suites"
docs/onboarding.md` showing the bumped numbers. If those
two checks pass, you're ready for the next lane
immediately.

## Notes on the engine surface for lane 66 (token creation with embedded static)

When implementing lane 66, the engine-side changes are
in `effect-resolution.ts#applyCreateToken` (or the
relevant op dispatcher for `CreateToken` /
`CreatePredefinedToken`). The op creates a new
`CardInstance` with a stamped `embedded_static` field
on the instance, parallel to the lane 65
`grantedTriggers` pattern. The per-instance
`embedded_static` is read by the same refresh paths
that handle scripted Auras
(`refreshAuraBonuses` for keyword / restriction arms;
`refreshScriptedStatics` for P/T arms).

The smallest variant set for v1 (per the Wave 4.8
follow-up 3 handoff's "smallest scoped v1" pattern):

- `power: number` — adds N power to the token's base
  power.
- `toughness: number` — adds N toughness to the token's
  base toughness.
- `keywords: string[]` — adds the named keywords to the
  token (CR 604 — "granting keywords to other cards" is
  a parallel pattern to lane 65).

The legality check rejects the token creation if the
schema validation fails. The deduction happens at
token-creation time (CR 602.2b analog for tokens).

Out of scope for lane 66 (these are separate
multi-lanes, each adding a new field):

- Restrictions on the token (`restrictAttack`,
  `restrictBlock`, `maxBlockers`) — a follow-up lane
  would extend `embedded_static` with these.
- Triggered abilities on the token (parallel to lane
  65's `grantedTriggers`) — a follow-up lane would
  extend the pattern.
- Activated abilities on the token — a follow-up lane
  (the engine's current token creation is
  ability-less).
- Token-copies-permanent (Clone, Phantasmal Image) —
  covered by lane 70.

The smallest sample card is **Adaptive Automaton**
("As Adaptive Automaton enters the battlefield, choose
a creature type. Adaptive Automaton is the chosen type
in addition to its other types. Other creatures you
control of the chosen type get +1/+1 and have all
creature types.") — but this card actually combines
three patterns (chosen-type anthem, all-creature-types
addition, and P/T bonus). For the v1 minimum, ship a
synthetic card registered via the test harness that
just creates a 1/1 Saproling token with "has trample"
via `embedded_static.keywords`. If the lane grows past
a single token-creation arm, back out and ship the
keyword-only variant first, then queue a follow-up lane
for the P/T variant.

## Notes on the engine surface for lane 67 (stun / finality counters)

When implementing lane 67, the engine-side changes
are in `keyword-actions/enters.ts#resolveEnterChoice`
for the ETB placement and `turn-phases.ts` for the
stun-counter untap prevention. The new
`enters_with_counters: [{ counter, count }]` field on
the script's `spell` block generalizes the existing
lane 59 `enters_with_counters_per_match` pattern to
support arbitrary named counter types (stun, finality,
+1/+1, -1/-1, etc.).

The smallest variant set for v1 (per the Wave 4.8
follow-up 3 handoff's "smallest scoped v1" pattern):

- `counter: "stun" | "finality" | "+1/+1" | "-1/-1"`
  — the v1 enum of supported counter types.
- `count: number` — the number of counters of that
  type to place on the entering permanent.

The engine reads the field at ETB time, stamps the
counters on the entering permanent's
`instanceCounters` ledger (lane 59), and applies the
matching rule:

- `stun` (CR 122.1d): the permanent doesn't untap
  during its controller's next untap step. The engine
  stamps `untapSkipUntil: turn + 1` on the instance
  and `processUntapStep` honors it.
- `finality` (CR 122.1d): the permanent and cards
  exiled with it can't be cast from the graveyard.
  The engine stamps `recursionBlocked: true` on the
  instance; the cast-time legality check in
  `spell-casting/cast.ts#canCastSpell` honors it.
- `+1/+1` / `-1/-1`: standard P/T counters, already
  supported by the lane 59 ledger.

Out of scope for lane 67 (these are separate
multi-lanes, each adding a new field):

- Per-turn stun-counter removal (CR 122.1d) — already
  supported by the engine's `untapSkipUntil` mechanism;
  the lane 67 work just exposes the v1 enum.
- Finality-counter recursive effects on exiled cards
  (a complex multi-lane pattern) — a follow-up lane.
- Other counter types (charge, time, lore, etc.) —
  follow-up lanes; v1 supports the four listed above.

The smallest sample card is **Magmatic Hellkite**
("Magmatic Hellkite deals 1 damage to each creature
the controller doesn't control. Clash with an opponent.
If you win, return Magmatic Hellkite to its owner's
hand.") — but this card actually combines several
patterns. For the v1 minimum, ship a synthetic card
registered via the test harness that just creates a
1/1 creature token with one stun counter via
`enters_with_counters: [{ counter: "stun", count: 1 }]`.
If the lane grows past a single counter type, back
out and ship the stun-only variant first, then queue
a follow-up lane for the finality variant.

## Notes on the engine surface for lane 68 (cast from exile / graveyard)

When implementing lane 68, the engine-side changes
are in `spell-casting/cast.ts#canCastSpell` for the
legality check (the card must be in one of the named
zones when cast) and `spell-casting/resolve.ts` for
the post-resolution zone redirect (e.g. exile for
flashback, graveyard for escape).

The new `castable_from: ["exile", "graveyard",
"command"]` array on `CardScriptSchema` generalizes
the existing `flashback` (CR 702.143a) and `escape`
(CR 702.138a) fields. v1 supports a single zone in
the array; multi-zone casting is a follow-up lane.

The smallest variant set for v1 (per the Wave 4.8
follow-up 3 handoff's "smallest scoped v1" pattern):

- `castable_from: ["graveyard"]` — the script can be
  cast from the graveyard (parallel to `flashback`).
- `castable_from: ["exile"]` — the script can be cast
  from exile (parallel to `foretell`).
- `castable_from: ["command"]` — the script can be
  cast from the command zone (parallel to `commander`).

The legality check in `canCastSpell` reads the field
and accepts a cast when the source card is in one of
the named zones. The post-resolution redirect in
`resolve.ts` moves the card to the named end zone
(default: exile for flashback, graveyard for escape).

Where to wire it:

- `spell-casting/cast.ts#canCastSpell` — the cast-time
  legality check. Currently the engine's cast path
  reads `card.currentZoneKey` to find the source zone;
  the v1 arm extends this to also check
  `castable_from` and accept any of the named zones.
- `spell-casting/resolve.ts#resolveTopOfStack` — the
  post-resolution zone redirect. Currently the
  engine's resolve path moves the card from the
  stack to the graveyard; the v1 arm overrides this
  to move the card to the named end zone
  (`flashback` → exile, `escape` → exile,
  `commander` → command).

The smallest sample card is **Flashback**-style
("You may cast this card from your graveyard for its
flashback cost. Then exile it."). v1 ships a
synthetic card registered via the test harness that
just casts from the graveyard and exiles on
resolution via `castable_from: ["graveyard"]`. If
the lane grows past a single zone, back out and ship
the graveyard variant first, then queue a follow-up
lane for the exile variant.
