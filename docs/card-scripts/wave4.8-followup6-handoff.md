# Wave 4.8 follow-up 6 handoff — Next session

## Mission

Drive an aggressive, iterative loop to land the next
priority card-script lanes from the Wave 4.8 follow-up 5
done summary's remaining work. Wave 4.8 follow-up 5
shipped lanes 69, 70, and 71 (PRs #2749, #2750, #2751 —
see `docs/card-scripts/wave4-blockers.md` for the done
summary and `docs/card-scripts/wave4.8-followup5-handoff.md`
for the prior handoff).

The next priority lanes, per the Wave 4.8 follow-up 5
done summary's "Lane continue rule" and the blocked-work
paragraphs:

1. **Lane 72 — X-spent-on-creature-spells** (e.g.
   Llawan, War Tax — "spend this mana only on creature
   spells" / "creature spells cost {1} more to cast").
   A new schema arm on the alternative-cost slot
   (parallel to lane 69's `mana_restriction`) that
   records a creature-only payment restriction. The
   cast-time legality check rejects the cast if the
   player can't pay the cost with the restricted
   pool. ~200-350 LOC + tests.

2. **Lane 73 — Copying a spell on the stack** (Splice,
   copy-with-new-targets — e.g. Double Vision,
   Reiterate). An extension to `CopySpell` to (a) let
   the trigger source a target the original spell
   targeted, and (b) let the script accept a
   `new_targets` field that flows into
   `copySpellOnStack(state, sourceId, newTargets)`.
   The underlying `copySpellOnStack` already accepts
   `newTargets` (CR 707.10d); only the schema +
   dispatch need wiring. ~200-350 LOC + tests.

3. **Lane 74 — Multi-quality protection**
   (`protectionFrom: ["red", "blue"]`). The v1 lane 71
   schema accepts any `string[]` length; the engine's
   `hasProtectionFrom` consults the per-instance
   `protectionFrom` ledger. Multi-quality is mostly a
   schema + test addition; the engine already loops
   over the array. ~50-100 LOC + tests.

4. **Lane 75 — "Until end of turn" copy**
   (Sakashima-style, manifested, Akoumep Halberd — "as
   long as this is in play, it's a copy of [chosen
   permanent]"). A new schema arm that lets a
   permanent become a copy until end of turn. Touches
   the per-instance stamping pass in
   `keyword-actions/scripted-statics.ts` (parallel to
   the lane 66 `embedded_static` pattern). v1
   supports a single target + "all characteristics
   copied" semantics with a turn-key duration. ~300-
   500 LOC + tests.

5. **Lane 76 — Aura-shaped protection-from static**
   (`AuraStaticSchema.protectionFrom` — "enchanted
   creature has protection from [quality]"). A
   parallel `protectionFrom: string[]` arm on the
   `AuraStaticSchema` (parallel to lane 71's
   `StaticSchema.protectionFrom`). The
   `refreshAuraBonuses` path in
   `keyword-actions/aura-bonus.ts` stamps the
   per-instance field on the enchanted card. v1
   supports a single quality. ~100-200 LOC + tests.

Lane 61 ("replacement effect for death", Whip of
Erebos / False Dawn) stays blocked per the Wave 4.8
follow-up 2 done summary: the engine has no general
replacement-effect layer, so lane 61 is foundational
work, not a normal lane. Open it as a separate
multi-lane plan, not as the next lane in this loop.

The remaining work is intentionally multi-lane and
should be attacked the same way the previous loops
were: one self-contained lane per PR, immediate
next-lane pickup, no human-in-the-loop. Per the Wave
4.8 follow-up 2 handoff's process rule: "Don't ship
multi-lane work in one PR. If a lane reveals a second
pattern that also needs new schema, split it into a
follow-up lane and put a paragraph in
`wave4-blockers.md` documenting why."

## Priority lanes (in order)

The follow-up work, in priority order:

1. **Lane 72 — X-spent-on-creature-spells** (Llawan,
   War Tax). The smallest scoped piece: a new
   `mana_restriction_creatures: { creature_only:
true, generic: number }` arm on the
   alternative-cost slot (parallel to lane 69's
   `mana_restriction`) that records a creature-only
   payment restriction. The v1 minimum: the cost
   may be paid only by creatures the controller
   controls (Llawan → taxes the opponent's
   creature spells; War Tax → tax the controller's
   own creature spells to discourage opponent
   attacks). If the lane grows past
   "creature-only-with-generic-reduction", back out
   and ship the single-color variant first, then
   queue a follow-up lane for the
   controller-narrow variant.

2. **Lane 73 — Copying a spell on the stack** (Splice,
   Double Vision). The smallest scoped piece: a new
   `new_targets: true` field on `CopySpellSchema` (a
   boolean flag) that flows into
   `copySpellOnStack(state, sourceId, newTargets)`.
   v1 supports "you may choose new targets for the
   copy" semantics; the engine routes through
   `copySpellOnStack` which already accepts the
   `newTargets` argument (CR 707.10d). v1 minimum:
   the controller MAY retarget the copy; the v1 UI
   just inherits the original's targets (a
   forward-compatible signal that the engine
   acknowledged the "you may choose new targets"
   clause). ~200-350 LOC + tests.

3. **Lane 74 — Multi-quality protection**
   (`protectionFrom: ["red", "blue"]`). The smallest
   scoped piece: extend the v1 lane 71 test suite
   with a multi-quality case (`protectionFrom:
["red", "blue"]`) and verify that
   `hasProtectionFrom` correctly blocks targeting
   from both red and blue sources. The schema is
   already permissive (`string[]`); only the engine
   needs verification that the loop correctly
   ANDs across the array. ~50-100 LOC + tests.

4. **Lane 75 — "Until end of turn" copy**
   (Sakashima-style / manifested). The smallest
   scoped piece: a new `become_copy: { target:
CardInstanceId, until: "end_of_turn" }` arm on
   `StaticSchema` (parallel to lane 71's
   `protectionFrom`). v1 supports a single target +
   "all characteristics copied" semantics with a
   turn-key duration. The engine stamps the
   characteristics on the source's per-instance
   fields (name, type_line, P/T, keywords) via
   `refreshScriptedStatics`; a `turn-phases.ts`
   cleanup step rolls them back at end of turn.
   ~300-500 LOC + tests.

5. **Lane 76 — Aura-shaped protection-from static**
   (`AuraStaticSchema.protectionFrom`). The smallest
   scoped piece: a parallel `protectionFrom:
string[]` arm on `AuraStaticSchema` (parallel to
   lane 71's `StaticSchema.protectionFrom`). The
   `refreshAuraBonuses` path in
   `keyword-actions/aura-bonus.ts` stamps the
   per-instance field on the enchanted card via the
   same `auraStaticAffected` pattern that
   `refreshScriptedStatics` uses. v1 supports a
   single quality. ~100-200 LOC + tests.

Lanes 72 and 73 are the highest-priority follow-ups;
they unblock a long tail of recent cards (the
"creature-spell payment restriction" family is the
bulk of drafter-list card scripts in #2614; the
"copying a spell on the stack" family is the
third-largest after the drafter-list lanes 69 / 70).
Lane 74 is the smallest of the explicitly multi-lane
cases and is mostly a test-suite addition.

## State at session start

- **HEAD**: `b2338cf5` (Wave 4.8 follow-up 5 loop
  done summary — the done summary commit; the
  `wave4.8-followup5-handoff.md` doc itself was
  committed in the prior loop, and the
  `wave4-blockers.md` done summary is the follow-up
  6 baseline).
- **725 → ? suites / 14094 → ? cases** (14087 passed
  - 7 skipped). The Wave 4.8 follow-up 6 loop adds
    to these.
- **Lint 0 errors, typecheck clean** (the previous
  baseline).
- **Engine-size budget**: 2650 lines for `schema.ts`
  (bumped 2550 → 2575 in Wave 4.8 follow-up 5 lane
  69; bumped 2575 → 2650 in lane 70). Measured 2644
  after lanes 69 + 70 + 71. Lane 72+ may need another
  bump if the new schema fields push past 2650 —
  the historical precedent is "bump the budget
  rather than fragmenting the chosen-X /
  additional-costs / affinity / grants /
  counter-ledger / cast-from-zone /
  mana-restriction / copy-permanent family."
- **Bundle-size budget**:
  `config/bundle-budget.json` was re-captured in
  Wave 4.8 follow-up 4 lane 66 (the engine additions
  grew the `/replay` route and a handful of other
  game routes). Lane 72+ may grow the engine surface
  further; if a lane's changes pull into the client
  bundle, re-capture the budget in the same commit.
- **Working directory**:
  `/home/alex/Projects/planar-nexus` (clean).
- **Open issues relevant to this loop**: #2614 (the
  full drafter-list plan work — covers the
  mana-restriction family, the copy-permanent family,
  the protection-from static family, and the
  creature-spell payment restriction family); the
  lanes above are tracked under #2614 or adjacent
  multi-lane plans.
- **Just-shipped context**: PRs #2749, #2750, and
  #2751 are merged on main (lanes 69 / 70 / 71).
  Lane 69 added `additionalCosts.mana_restriction`
  for the Force-of-Will / Cabal-Therapy pattern.
  Lane 70 added `op: "CopyPermanent"` on
  `EffectSchema` for the Clone / Phantasmal-Image
  pattern. Lane 71 added `protectionFrom: string[]`
  on `StaticSchema` for the Light-of-Day /
  Crimson-Acolyte pattern. All three are v1
  single-piece add-ons; no wider refactor landed.

## Process (mandatory, identical to Wave 4 / 4.5 / 4.6 /

### 4.7 / 4.7 follow-up / 4.7 phase 2 / 4.8 / 4.8 follow-up /

### 4.8 follow-up 2 / 4.8 follow-up 3 / 4.8 follow-up 4 /

### 4.8 follow-up 5)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
/tmp/opencode/wave414-lane<N>-<slug> -b
<type>/<scope> origin/main` where `<N>` starts at
   72 and `<slug>` is kebab-case, min 10 chars.
   `ln -s /home/alex/Projects/planar-nexus/node_modules
/tmp/opencode/wave414-lane<N>-<slug>/node_modules`
   so test/lint/typecheck skip a fresh install.
   Verify with `ls
/tmp/opencode/wave414-lane<N>-<slug>/node_modules/.bin/jest`.
   Note: the symlinked `node_modules` will fail
   `npm run build` (Turbopack errors on the
   `node_modules` symlink pointing outside the
   worktree root). The bundle-size budget re-capture
   requires a real build, so when a lane grows the
   engine surface that the client bundle pulls in
   (e.g. lane 66 in the Wave 4.8 follow-up 4 loop),
   `rm` the symlink and run `npm ci` first to do the
   build.

2. **Scope discipline**: each lane is one
   self-contained change. Schema + engine + sample
   card + dedicated test is fine. **Don't** ship a
   second sample card for a different pattern,
   **don't** refactor unrelated plumbing, **don't**
   partial-port a multi-card block. If the lane
   grows past one schema arm + one engine arm + one
   card, back out, document the reason in
   `wave4-blockers.md`, and pick a smaller next lane.

3. **Implement**: schema → engine → sample card →
   dedicated test → ratchet.
   - **Schema**:
     `src/lib/game-state/card-scripts/schema.ts` is
     the one place for new fields. For each lane,
     follow the existing allow-list pattern (lane 52
     added `add_creature_type`; lane 54 added
     `removesAllAbilities`; lane 55 added
     `add_color`; lane 59 added
     `enters_with_counters_per_match`; lane 60
     added `you_may`; lane 62 added `counter_gate`;
     lane 63 added `additionalCosts.pay_life` /
     `additionalCosts.sacrifice`; lane 64 added
     `affinity.color` + `reduction_per_match`; lane
     65 added `static.grants.triggers`; lane 66
     added `CreateTokenSchema.embedded_static`; lane
     67 added `enters_with_counters`; lane 68 added
     `castable_from`; lane 69 added
     `additionalCosts.mana_restriction`; lane 70
     added `CopyPermanentSchema`; lane 71 added
     `StaticSchema.protectionFrom`). New fields
     should integrate into the chosen-X /
     additional-costs / affinity / grants /
     counter-ledger / cast-from-zone /
     mana-restriction / copy-permanent family when
     possible.
   - **Engine**: the right home depends on the arm.
     For Aura-static arms, update
     `refreshAuraBonuses`
     (`keyword-actions/aura-bonus.ts`). For general
     static arms, update `refreshScriptedStatics`
     (`keyword-actions/scripted-statics.ts`). For
     token-creation arms (lane 66, lane 70), update
     `effect-resolution.ts#applyCreateToken` (or
     the relevant op dispatcher for `CreateToken` /
     `CreatePredefinedToken` / `CopyPermanent`).
     For counter-ledger arms (lane 67), update
     `keyword-actions/enters.ts`
     (`resolveEnterChoice`) for ETB placement and
     `turn-phases.ts` for stun-counter untap
     prevention. For cast-from-zone arms (lane 68),
     update
     `spell-casting/cast.ts#canCastSpell` for the
     legality check and
     `spell-casting/resolve.ts` for the
     post-resolution zone redirect. For
     mana-restriction arms (lane 69), update
     `spell-casting/cast.ts#castSpell` for the
     cost-payment validation AND
     `validation-service.ts#validateManaCost` for
     the pre-cast legality check (per the lane 68
     process note — multi-layer cast paths require
     updating both surfaces). For copy-permanent
     arms (lane 70), update
     `card-scripts/interpret.ts#applyEffect` (new
     `case "CopyPermanent":` branch) AND add a
     `src/lib/game-state/card-scripts/ops/<op>.ts`
     module registered in
     `src/lib/game-state/card-scripts/ops/registry.ts`
     (the `covers every op the schema accepts` test
     enforces parity). For protection-from static
     arms (lane 71), update
     `refreshScriptedStatics`
     (`keyword-actions/scripted-statics.ts`) for the
     stamp AND `evergreen-keywords.ts` for the
     `canBeTargetedBy` / `canBeBlocked` checks. For
     creature-spell payment restriction arms (lane
     72), update `spell-casting/cast.ts#castSpell`
     for the cost-payment validation AND
     `validation-service.ts#validateManaCost` for
     the pre-cast legality check. For copy-spell
     arms (lane 73), update
     `card-scripts/interpret.ts#applyEffect` (the
     existing `case "CopySpell":` branch) AND
     `spell-casting/resolve.ts#copySpellOnStack`
     (which already accepts `newTargets` — the v0
     substrate is the lane 33 Double Vision arm).
     For until-end-of-turn copy arms (lane 75),
     update `refreshScriptedStatics` for the stamp
     AND `turn-phases.ts` for the end-of-turn
     cleanup. For Aura-shaped protection-from arms
     (lane 76), update `refreshAuraBonuses` in
     `keyword-actions/aura-bonus.ts` for the stamp
     on the enchanted card.
   - **Sample card**: ship one real card JSON per
     lane when the handoff lists one. Otherwise use
     a synthetic registered via the test harness
     (the lane 49/52/55/59/60/62/63/64/65/66/67/68/
     69/70/71 pattern).
   - **Tests**: dedicated `*.test.ts` file per lane,
     colocated in `src/lib/game-state/__tests__/`.

4. **Run checks (in the worktree)**:
   - `PATH="$PWD/node_modules/.bin:$PATH" npx tsx
scripts/build-card-script-index.ts`
     (regenerates the index — required when adding a
     new card JSON).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm test
--silent` (full suite — must be all green; the
     AI `forge-gate`/`forge-selfplay`/`expert-agent`
     "is deterministic for a seed" flake is known —
     re-run once if it hits, then move on. The Wave
     4.8 follow-up 5 loop hit this flake once on
     lane 71's full-suite run; the second run passed
     clean).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
typecheck` (must be clean).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
lint` (0 errors; warnings OK).
   - `PATH="$PWD/node_modules/.bin:$PATH" node
scripts/check-engine-size-budget.mjs` (must
     pass; budget currently 2650 lines for
     `schema.ts`, measured 2644 after lanes 69 + 70
     - 71). Bump the budget rather than fragmenting
       the chosen-X / additional-costs / affinity /
       grants / counter-ledger / cast-from-zone /
       mana-restriction / copy-permanent family
       (Wave 4.8 follow-up 5 lane 70 bumped 2575 →
       2650 to cover the lane 70 work; Wave 4.8
       follow-up 5 lane 69 bumped 2550 → 2575 to
       cover the lane 69 work).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
ratchet:test-count` (rewrites anchored doc
     blocks when test count changes). The Wave 4.8
     follow-up 5 loop did not hit the AI flake
     mid-ratchet on any of the three lanes; the
     `--live` fallback was not needed.
   - **Bundle-size check (only when the lane grows
     the engine surface that the client bundle
     pulls in)**: `rm node_modules` (the symlink)
     and `npm ci`, then `npm run build`, then `node
scripts/check-bundle-budget.mjs --check`. If
     the lane grew the engine and the bundle check
     fails, re-capture the budget: `node
scripts/check-bundle-budget.mjs --capture` and
     commit the updated `config/bundle-budget.json`
     alongside the lane's other changes. The
     handoff's process rule: "bump the budget
     rather than fragmenting the chosen-X /
     additional-costs / affinity / grants family" —
     the same precedent applies to the client
     bundle budget; the Wave 4.8 follow-up 4 lane
     66 took this route when the engine additions
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
commit --amend --no-edit && rm COMMIT_MSG.txt`.
   Then `git push --force-with-lease origin <branch>`.
   The Wave 4.8 follow-up 5 process learned: `git
commit` without the env vars picks up the husky
   global git config and the commit shows up under the
   wrong author. Use the env vars explicitly, on every
   `git commit` (and on every `git commit --amend`).
   The Wave 4.8 follow-up 5 loop used the env vars
   consistently on every commit + amend; no
   misattributed commits in that loop.

6. **Open PR**: write `PR_BODY.txt` AFTER the commit
   (this is the cleaner pattern — see the Wave 4.8
   follow-up 3 process note). Then `gh pr create
--title "<type>(<scope>): <one-line>" --body-file
PR_BODY.txt --base main --head <branch>`. Then
   `gh pr merge <PR> --squash --delete-branch --admin`
   once checks pass. **Do not** `git add PR_BODY.txt` —
   writing the file post-commit avoids the amend
   `git rm --cached` step for that file. Note: the
   commitlint subject is enforced as lower-case (per
   the `header-case` rule in `commitlint.config.js`);
   the commit subject MUST be lower-case. If the body
   contains identifiers like `CreateTokenSchema` or
   `CardScriptSchema`, the `commitlint` hook may
   complain about the body's capital letters — the
   actual rule is on the subject line, so a lower-case
   subject with any body content is fine. The Wave 4.8
   follow-up 5 loop used all lower-case subjects
   consistently.

7. **Conflict resolution (if main moves during the
   lane)**: `git merge origin/main --no-edit` then
   resolve any conflicts (the most common is the
   test-count doc drift between main and your
   branch). For the test-count block: keep the higher
   values (the lane's contribution adds cases, so
   main's value will be lower or equal). Then `npm
run ratchet:test-count` to confirm. Force-push and
   re-wait CI.

8. **Cleanup**: exit the worktree directory, then
   `git worktree remove
/tmp/opencode/wave414-lane<N>-<slug> --force && git
branch -D <branch>`.

## Conventions (carried from prior loops)

- **Branch**: `<type>/<scope>` (lowercase,
  kebab-case, min 10 chars). `<scope>` is the lane's
  punchy name (e.g. `creature-spell-payment` for lane
  72, `copy-spell-on-stack` for lane 73,
  `multi-quality-protection` for lane 74,
  `until-eot-copy` for lane 75, `aura-protection` for
  lane 76).
- **Commit subject**: lower-case, min 10 chars, type
  from `feat fix docs style refactor test chore
revert`. Wave 4.8 saw `header-case` linting on
  commitlint — lowercase is enforced; write the
  subject in lowercase from the start.
- **Reference #2614 follow-up** in the commit body
  and the PR body so the cross-references stay tight.
  For lane 72 (creature-spell payment restriction),
  reference the alternative-cost slot + #2614. For
  lane 73 (copy spell on stack), reference
  `CopySpellSchema` + #2614. For lane 74
  (multi-quality protection), reference
  `StaticSchema.protectionFrom` + #2614. For lane 75
  (until-EOT copy), reference the static slot +
  #2614. For lane 76 (aura-shaped protection-from),
  reference `AuraStaticSchema` + #2614.
- **Conventional Commits**. Never check in
  `COMMIT_MSG.txt` (amend-rm before pushing) or
  `PR_BODY.txt` (write it AFTER the commit, per the
  Wave 4.8 follow-up 3 process note).
- **Test count**: ratchet in the same commit as any
  test count change, before pushing.
  `test-count-docs-guard` re-measures live Jest and
  fails on any drift in `docs/onboarding.md` or
  `docs/TEST_VIDEO_FIXTURES.md`.
- **Engine-size budget**: 2650 lines for `schema.ts`
  (the Wave 4.8 follow-up 5 lane 70 bump). Lanes 72
  - 73 + 74 + 75 + 76 should fit under 2650 (each
    adds a small field — at most one refine); if the
    schema grows past 2650, bump the budget in the
    SAME commit per the Wave 4.8 follow-up handoff's
    process note. Update the docstring block in
    `scripts/check-engine-size-budget.mjs` with a
    one-paragraph history entry (the existing entries
    are a good template).
- **Bundle-size budget**: the Wave 4.8 follow-up 4
  lane 66 re-captured `config/bundle-budget.json`
  after growing the engine surface. Lanes 72 + 73 +
  74 + 75 + 76 may grow the engine surface further;
  if a lane's changes pull into the client bundle,
  re-capture the budget in the same commit (see
  Process step 4).
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
  pre-commit hook runs prettier on staged
  `*.{ts,tsx,md,json,...}` files; if you write a
  `COMMIT_MSG.txt` and stage it, the prettier pass
  may delete the file (which the hook does in the
  lane 68 done-summary commit). Write the commit
  message to a file, stage the changes, commit using
  `git commit -F COMMIT_MSG.txt`, then `git rm
--cached COMMIT_MSG.txt` and amend.

## Aggressive loop rules

- **Don't ask the user between lanes.** Pick the
  next gap autonomously and ship it.
- **Don't ship multi-lane work in one PR.** If a
  lane reveals a second pattern that also needs
  new schema, split it into a follow-up lane and
  put a paragraph in `wave4-blockers.md` documenting
  why.
- **Lane is "done"** only when: CI green, PR merged,
  worktree removed, branch deleted, local main
  pulled and re-ratcheted.
- **If CI fails on a lane**: don't push; fix the
  lane. If the fix is unclear, document the failure
  in `docs/card-scripts/wave4-blockers.md` and skip
  to the next lane. The AI
  `forge-gate`/`forge-selfplay`/`expert-agent` "is
  deterministic for a seed" test is a known
  order-dependent flake on main; if a CI run shows
  only that test failing, `gh run rerun --failed` is
  the right move (do NOT amend the lane). The Wave
  4.8 follow-up 5 loop hit this flake once on lane
  71's local full-suite run; the second run passed
  clean; the CI run was clean on the first try.
  Budget for 1-2 extra CI runs per lane to absorb
  the flake.
- **Turn budget: 40 turns per lane max** (per
  `AGENTS.md` §Turn Budget). If a single lane exceeds
  this, it's too big — back out, document, and pick a
  smaller one.

## Done definition for the loop

When all of lanes 72, 73, 74, 75, 76 are either
shipped or marked multi-lane blockers (with a
paragraph in `wave4-blockers.md` documenting why),
append a Wave 4.8 follow-up 6 loop done summary at
the bottom of `docs/card-scripts/wave4-blockers.md`
documenting the shipped lanes, the blocked gaps with
their #2614 plan work references, and a fresh
test-count snapshot. Then stop.

If even lane 72 (the smallest prerequisite) is
blocked, that means the engine changed since Wave
4.8 follow-up 5 and the loop should be paused for
human review before continuing.

Lane 61 (replacement effect for death) is parked; it
requires a foundational replacement-effect layer that
doesn't exist yet.

## Process observations carried from previous loops

- The AI `forge-gate`/`forge-selfplay`/
  `expert-agent` "is deterministic for a seed" test
  is a known order-dependent flake on main. If a CI
  run shows only that test failing, `gh run rerun
--failed` is the right move — do NOT amend the
  lane. Wave 4.8 saw this at lane 54 + 55; Wave 4.8
  follow-up saw this at lane 56; Wave 4.8 follow-up
  2 saw it once on the local lane 60 run and once on
  lane 62's `ratchet:test-count` (worked around with
  the `--live` fallback). Wave 4.8 follow-up 3 did
  NOT hit this flake on any lane. Wave 4.8 follow-up
  4 hit this flake ONCE on the local lane 68
  full-suite run; the second run passed clean; the
  CI run was clean on the first try. Wave 4.8
  follow-up 5 hit this flake ONCE on the local lane
  71 full-suite run; the second run passed clean.
  Budget for 1-2 extra CI runs per lane to absorb
  the flake.
- `ci-wait` can return `FAILED` on a freshly-opened
  PR with all checks still pending. Wait a second
  call to `ci-wait` to get a real verdict. (`sleep
60 && gh pr checks <PR>` is a good way to seed the
  API.)
- `npm run ratchet:test-count` is reliable; run it
  in the same commit as any test count change. The
  Wave 4.8 follow-up 5 loop did not hit the AI flake
  mid-ratchet on any of the three lanes; the
  `--live` fallback was not needed.
- The handoff's process rule on `git worktree
remove`: the `--delete-branch` flag on `gh pr
merge` only deletes the remote branch. The local
  worktree directory must be removed manually after
  exiting it (`git worktree remove ... && git branch
-D ...`).
- Wave 4.8 lane 55 process observation: `git commit`
  without `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env
  vars picks up the husky global git config and the
  commit shows up under the wrong author. Use the
  env vars explicitly, on every `git commit` (and on
  every `git commit --amend`). Wave 4.8 follow-up 5
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
  so the budget doesn't drift. The Wave 4.8
  follow-up 5 loop ended with schema.ts at 2644
  (under 2650); if a single lane pushes past 2650,
  bump the budget in the SAME commit per the Wave
  4.8 follow-up handoff's process note.
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
  script" form (e.g. lane 67's
  `enters_with_counters`) must be added to the
  refine list with a one-paragraph docstring
  explaining the new accepted form. Synthetic test
  scripts that use the new arm alone (without any
  other ability) parse only if the arm is in the
  refine list.
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
- Wave 4.8 follow-up 5 process observation: the
  `createCardInstance(cardData, ownerId,
controllerId, options)` signature was easy to
  swap on a synthetic test fixture (passing the
  whole object as `options` instead of the four
  positional arguments). The bug surface: a test
  created a card with `cardData: undefined` and the
  card was missing its `mana_cost` field, which
  made `getSpellManaCost` return `{...}` (all zeros)
  and the cost-validation check pass with 0 total
  mana to spend. Caught on the second local run;
  typecheck + lint + budget + ratchet all passed
  clean on the same commit. The fix: always pass
  the four positional arguments to
  `createCardInstance` (or destructure the test
  fixture into a `cardDef` variable first, then
  pass `cardDef, ownerId, controllerId, { id,
currentZoneKey }`).
- Wave 4.8 follow-up 5 process observation: when
  adding a new op on `EffectSchema` (e.g. lane 70's
  `CopyPermanent`), the per-op reference module
  under `src/lib/game-state/card-scripts/ops/` and
  the entry in `src/lib/game-state/card-scripts/ops/registry.ts`
  are required to keep the LLM-drafted scripts
  pipeline in sync. The `covers every op the schema
accepts` test enforces parity — without the
  per-op module + registry entry, the test fails
  and the engine doesn't know about the new op.
- Wave 4.8 follow-up 5 process observation: when
  extending `StaticSchema` with a new meta-static
  arm (e.g. lane 71's `protectionFrom`), the refine
  list at the bottom of `StaticSchema` must be
  extended to accept the new arm as a stand-alone
  static (parallel to `chosen_name_block`,
  `add_creature_type`, `add_color`). Synthetic test
  scripts that use the new arm alone (without any
  other ability) parse only if the arm is in the
  refine list.
- Wave 4.8 follow-up 5 process observation: when
  extending the cast path with a new field that
  affects mana validation (e.g. lane 69's
  `mana_restriction`), the `castSpell` cost-payment
  logic AND the `validation-service.ts#validateManaCost`
  legality check both need updating. Missing one
  of the two surfaces a "Not enough colored mana"
  error from the pre-cast legality check. Always
  grep for "Not enough" / "validation" in the
  relevant files when extending the cast path with
  a new cost-restriction arm.

## Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any leftover from Wave 4.8 follow-up 5)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 725 / 14094 green
# then start lane 72 (creature-spell payment restriction, #2614 follow-up) per the Process section
# lanes 73 (copy-spell on stack), 74 (multi-quality protection), 75 (until-EOT copy), 76 (aura-shaped protection-from) follow in priority order
```

End each lane with: `git log --oneline -1` on main
showing the new lane's commit, and `grep "Test suites"
docs/onboarding.md` showing the bumped numbers. If
those two checks pass, you're ready for the next lane
immediately.

## Notes on the engine surface for lane 72 (creature-spell payment restriction)

When implementing lane 72, the engine-side changes
are in `spell-casting/cast.ts#castSpell` (the
cost-payment validation; the player may pay the
spell's cost by tapping only creatures the controller
controls, or by paying the reduced generic cost via the
standard mana pool) AND `validation-service.ts#validateManaCost`
(the pre-cast legality check; the cast is legal when
the player can pay either path). The new
`additionalCosts.creature_payment: { creature_only:
true, generic: number }` arm on the
`additionalCosts` slot (parallel to lane 69's
`mana_restriction`) records the creature-only
restriction on the cast.

The smallest variant set for v1 (per the Wave 4.8
follow-up 5 handoff's "smallest scoped v1" pattern):

- `creature_only: true` — the cost may be paid only by
  tapping creatures the controller controls.
- `generic: 1` — the cost is reduced by 1 generic
  (matching the printed generic cost of the spell).
- The printed cost of the spell is `{1}{B}` (so the
  player may pay `{1}{B}` normally, OR pay the
  generic 1 by tapping a creature — the v1 minimum).

The legality check rejects the cast if the player
can't pay the cost under either path. The deduction
happens at cast time (the cost is paid from the
player's creature pool + mana pool, with the
restriction enforced at the cost-validation step).

Out of scope for lane 72 (these are separate
multi-lanes, each adding a new field):

- Multi-color creature pools (Llawan-style "only
  blue creatures may pay" — a follow-up lane would
  extend `creature_payment` with a `colors` arm).
- Per-creature-type pools ("only Goblins may pay" —
  a follow-up lane would extend `creature_payment`
  with a `subtype` arm).
- Opponent-only creature pools (War Tax-style "your
  opponents' creatures may pay" — a follow-up lane
  would extend `creature_payment` with a `controller`
  arm).

The smallest sample card is a synthetic instant with
`creature_payment: { creature_only: true, generic: 1 }`
and a printed cost of `{1}{B}`. If the lane grows
past "creature-only-with-generic-reduction", back out
and ship the single-shape variant first, then queue a
follow-up lane for the multi-shape variant.

## Notes on the engine surface for lane 73 (copy spell on stack)

When implementing lane 73, the engine-side changes
are in `card-scripts/interpret.ts#applyEffect` (the
existing `case "CopySpell":` branch — extend with a
`new_targets` arm) AND `spell-casting/resolve.ts#copySpellOnStack`
(which already accepts `newTargets` — the v0 substrate
is the lane 33 Double Vision arm). The new
`CopySpellSchema.new_targets: true` boolean field
flows into `copySpellOnStack(state, sourceId,
newTargets)`.

The smallest variant set for v1 (per the Wave 4.8
follow-up 5 handoff's "smallest scoped v1" pattern):

- `new_targets: true` — the controller MAY retarget
  the copy (CR 707.10d).
- The v1 minimum: the copy inherits the original's
  targets (a forward-compatible signal that the
  engine acknowledged the "you may choose new
  targets" clause). The v1 UI has no
  retarget interface; a follow-up lane would wire
  the player-facing retarget prompt.

The legality check: the copy is always legal (the
underlying `copySpellOnStack` already validates the
new targets against the copy's requirements). The
deduction happens at copy-creation time (the copy is
added to the stack; the original is unchanged).

Out of scope for lane 73 (these are separate
multi-lanes, each adding a new field):

- "May copy a spell with X=0" (some spells can't be
  copied with X=0 — a follow-up lane would extend
  `CopySpellSchema` with an `x_restriction` arm).
- "Copy a non-instant spell" (CR 707.10a: "an object
  copies the spell or characteristics of an
  instant or sorcery spell" — the v0 substrate is
  instant/sorcery only; a follow-up lane would extend
  the engine to allow copying a permanent spell).
- "Choose the copy's modes" (modal spells — a
  follow-up lane would extend `CopySpellSchema` with
  a `chosen_modes` arm).

The smallest sample card is a synthetic
triggered-ability source with `op: "CopySpell",
new_targets: true` and a chosen target (the engine
inherits the original's targets). If the lane grows
past "you may choose new targets", back out and ship
the basic-copy variant first, then queue a follow-up
lane for the retarget-UI variant.

## Notes on the engine surface for lane 74 (multi-quality protection)

Lane 74 is the smallest of the explicitly multi-lane
cases. The schema is already permissive (lane 71's
`StaticSchema.protectionFrom: string[]`); only the
test suite needs verification that the loop correctly
ANDs across the array. The engine's
`hasProtectionFrom` consults the per-instance
`protectionFrom` ledger; a creature with
`protectionFrom: ["red", "blue"]` is protected from
both red and blue sources.

The smallest variant set for v1 (per the Wave 4.8
follow-up 5 handoff's "smallest scoped v1" pattern):

- `protectionFrom: ["red", "blue"]` — protection from
  two colors.
- `protectionFrom: ["red", "everything"]` —
  protection from a color and the "everything"
  quality (Niveous Wisps-style).

The engine's `hasProtectionFrom` already loops over
the array (the v1 lane 71 implementation); no engine
changes needed for lane 74. The lane is mostly a
test-suite addition with multi-quality cases.

Out of scope for lane 74 (these are separate
multi-lanes, each adding a new field):

- "Protection from [quality] you choose" (Akoum
  Boulderfoot-style — a follow-up lane would extend
  the schema with a `chosen_quality` arm).
- "Protection from [color] until end of turn"
  (temporary protection — a follow-up lane would
  extend the engine with a `temporary` boolean).
- "Protection from [creature type]" (e.g. "protection
  from Goblins" — a follow-up lane would extend the
  schema with a `creature_type` arm).

The smallest sample card is a synthetic static
("Creatures you control have protection from red
and from blue") registered via the test harness, with
a red creature + a blue creature + a green creature
to verify the protection is honored for both red and
blue but not green. If the lane grows past
"multi-quality protection", back out and ship the
multi-color variant first, then queue a follow-up
lane for the chosen-quality / temporary variants.

## Notes on the engine surface for lane 75 (until-end-of-turn copy)

When implementing lane 75, the engine-side changes
are in `keyword-actions/scripted-statics.ts#refreshScriptedStatics`
(the per-instance stamping pass for the copied
characteristics, parallel to lane 71's `protectionFrom`
stamping pattern) AND `turn-phases.ts` (the end-of-turn
cleanup step that rolls back the copied
characteristics). The new
`StaticSchema.become_copy: { target: CardInstanceId,
until: "end_of_turn" }` arm (parallel to lane 71's
`protectionFrom`) declares the copy source and the
turn-key duration.

The smallest variant set for v1 (per the Wave 4.8
follow-up 5 handoff's "smallest scoped v1" pattern):

- `target: CardInstanceId` — the permanent to copy.
- `until: "end_of_turn"` — the duration.
- The new permanent inherits the target's
  characteristics (name, type line, P/T, keywords)
  for the duration of the turn.

The legality check: the target must be on the
battlefield. The deduction happens at the
copy-stamping time (the new permanent's
characteristics are swapped for the target's; the
target is unchanged).

Out of scope for lane 75 (these are separate
multi-lanes, each adding a new field):

- "Becomes a copy of [chosen permanent] until end of
  turn" (a follow-up lane would extend the schema
  with a `chosen_target` arm).
- "Becomes a copy of [named card] until end of turn"
  (a follow-up lane would extend the schema with a
  `named_card` arm).
- "Becomes a copy with [exception]" (Phyrexian
  Metamorph-style — a follow-up lane would extend
  the schema with an `exceptions` arm).

The smallest sample card is a synthetic static
("As long as this is in play, it's a copy of [chosen
creature] until end of turn") registered via the test
harness, with a 2/2 Grizzly Bears on the battlefield
to verify the copy characteristics are honored. If the
lane grows past "copy until end of turn", back out
and ship the basic-copy variant first, then queue a
follow-up lane for the named-copy / chosen-target
variants.

## Notes on the engine surface for lane 76 (aura-shaped protection-from)

Lane 76 is a parallel implementation of lane 71 on
`AuraStaticSchema`. The engine-side changes are in
`keyword-actions/aura-bonus.ts#refreshAuraBonuses`
(the per-instance stamping pass for the protection
on the enchanted card, parallel to lane 71's
`refreshScriptedStatics`). The new
`AuraStaticSchema.protectionFrom: string[]` arm
(parallel to lane 71's `StaticSchema.protectionFrom`)
declares the protection on the enchanted card.

The smallest variant set for v1 (per the Wave 4.8
follow-up 5 handoff's "smallest scoped v1" pattern):

- `protectionFrom: ["red"]` — protection from a single
  color.
- The Aura must enchant a creature (the v1 minimum;
  Auras enchant a permanent by default — CR 303.4f).

The engine reads the field in the existing
`hasProtectionFrom` check (a creature with
`protectionFrom: ["red"]` cannot be the target of a
red spell, cannot be blocked by a red creature, and
cannot be dealt damage by a red source — same
semantics as lane 71). The Aura-shaped protection is
cleared when the Aura leaves the battlefield
(battlefield-zone-only semantics — same as lane 71).

Out of scope for lane 76 (these are separate
multi-lanes, each adding a new field):

- Multi-quality protection on Auras
  (`AuraStaticSchema.protectionFrom: ["red",
"blue"]` — already supported by the v1 lane 71
  schema; a follow-up lane would extend the engine
  with the same `hasProtectionFrom` AND pattern).
- "Enchanted creature has protection from [quality]
  you choose" (a follow-up lane would extend the
  schema with a `chosen_quality` arm).
- "Enchanted creature has protection from [color]
  until end of turn" (a follow-up lane would extend
  the schema with a `temporary` boolean).

The smallest sample card is a synthetic Aura
("Enchanted creature has protection from red")
registered via the test harness, with a red creature +
a red spell to verify the protection is honored. If
the lane grows past "single protection source on a
creature-Aura", back out and ship the single-shape
variant first, then queue a follow-up lane for the
multi-shape variants.
