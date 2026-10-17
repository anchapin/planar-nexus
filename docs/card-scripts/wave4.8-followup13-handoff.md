# Wave 4.8 follow-up 13 handoff — Next session

## Mission

Continue the aggressive, single-lane-at-a-time loop that
follow-ups 7–12 have run. This follow-up is the "deferred
work" loop: every per-card out-of-scope item the follow-up 12
handoff listed (and the cross-cutting parking items the
follow-ups 2 / 8 / 9 / 11 left open) is fair game. The single
hard constraint is **lane 61 (replacement effect for death)
must be the FIRST lane**, because it requires a foundational
replacement-effect layer that's a separate multi-lane plan
itself; once that's in place, the smaller per-card out-of-scope
lanes from follow-up 12 can ride on top of it.

The aggressive loop picks one lane at a time and ships it
end-to-end before moving to the next. Don't ask the user
between lanes. If a lane reveals it needs more than the
40-turn budget, back out, document in `wave4-blockers.md`,
and pick a smaller lane.

## Priority queue (pick strictly in this order)

1. **Lane 61 — Replacement effect for death**
   (Whip of Erebos, False Dawn, etc. — "if X would die this
   turn, instead exile it / [do something else]"). This is a
   **multi-lane**, not a single lane, but follow-up 13's first
   concrete deliverable is **lane 61a: the foundational
   replacement-effect layer + a single sample card**. After
   61a lands, treat follow-up 13 like a normal single-lane
   loop.

   - **Gap**: the engine today has a `ReplacementEffectManager`
     with arms for `damage_prevention`, `damage_replacement`,
     `life_gain_replacement`, `life_loss_replacement`,
     `draw_replacement`, `land_enter_replacement`, etc.
     (see `src/lib/game-state/replacement-effects/manager.ts`
     and `types.ts`). It lacks a `death_replacement` arm:
     the engine moves creatures to the graveyard via
     `moveCardToZone(state, dyingCreature, "graveyard")` but
     does not consult `state.replacementEffectManager` for a
     "would die" event. Whip of Erebos's
     `static: { removesAllAbilities: false; ... }` deferred
     "if creature would die, exile instead" pattern, and any
     "instead exile" / "instead return to library" / "if [thing]
     would die, instead sacrifice" / "when [thing] would be
     put into a graveyard, instead return it to its owner's
     hand" pattern, all need the foundational layer.

   - **v1 minimum**:
     1. Schema: add a new `replacement_effects` array on
        `CardScript` (parallel to `triggers` /
        `activated` / `statics`). Each entry:
        ```ts
        {
          event: "would_die" | "would_be_destroyed" | ...;
          affects?: { card?: "self" | "any" | "your [type]"; ... };
          applies_to: { type: "self" | "creature" | "artifact"
                            | "enchantment" | "planeswalker" | "any";
                        controller?: "you" | "opponent" | "any" };
          redirect: { to: "exile" | "library_top" | "library_bottom"
                          | "hand" | "battlefield_tapped"
                          | "battlefield_untapped" | "sacrifice"
                          | "any_zone" };
          optional?: boolean;
          once_per_turn?: boolean;
          if_condition?: string;  // CR 603.4 intervening-if
        }
        ```
        The v1 minimum supports the single-shape
        `event: "would_die"` with `redirect.to: "exile"` for
        self-replacement (Whip of Erebos); other shapes ride
        follow-up lanes.

     2. Engine: when a creature is about to die
        (`moveCardToZone(state, dyingCreature, "graveyard")`
        from `keyword-actions/removal.ts` `destroyCard`,
        `sacrificeCard`, `exileCard`, or `markCreatureDiedThisTurn`'s
        callers), consult
        `state.replacementEffectManager.processEvent({ type:
        "would_die", sourceCardId: dyingCreature,
        controllerId: dyingCreature.controllerId })` and route
        the death through the replacement manager's standard
        APNAP ordering. The replacement result's
        `modifiedEvent.destination` (or a new
        `redirectToZone` field on the result) overrides the
        default graveyard destination.

     3. Card-script: add a `replacement_effects[]` arm to
        `cards/whip_of_erebos.json` (if it exists in the
        drafter list) or to a synthetic card (Lane 61a is the
        minimal scaffold; the real Whip of Erebos picks up
        in a later lane). The synthetic card's JSON: a
        vanilla 4/4 creature with `static` removed and the
        `replacement_effects` arm carrying
        `"if a creature you control would die, instead exile it"`.

     4. Tests: dedicated `replacement-effect-death.test.ts`
        covering:
        - the synthetic source's replacement fires when a
          creature would die
        - the replacement routes the death to exile (not
          graveyard) and the exiled creature is on the
          battlefield owner's exile zone with all state
          preserved
        - APNAP ordering: when both players have the effect,
          the active player's applies first
        - the replacement doesn't fire for non-creature
          permanent deaths (artifacts / enchantments /
          planeswalkers) — only `applies_to.type === "creature"`
          matches
        - the `optional?: true` arm surfaces a yes/no
          waitingChoice
        - the CR 614.4 loop guard (the existing
          `wouldCreateLoop` infrastructure on
          `ReplacementEffectManager`) handles a self-replacement
          that would re-trigger itself (e.g. "if exiled
          creature would die, instead exile it again" — this
          is contrived; the guard test ensures the engine
          breaks the loop without hanging)
        - the foundational event type `"would_die"` shows up
          in `processEvent`'s `currentEvent` and produces the
          expected `redirectToZone` field on the result

   - **Estimated LOC**: ~200-350 LOC (schema arm +
     `replacement_effects` plumbing in
     `replacement-effects/types.ts` + `manager.ts` +
     `moveCardToZone` consult + the new
     `death_replacement` event handler + tests). The
     `processEvent` method on `ReplacementEffectManager`
     already handles the APNAP ordering, loop detection,
     and effect-application loop — the lane is about
     adding the event type + the redirect-to-zone wiring +
     the schema/card-script glue.

   - **Docstring budget for schema.ts**: bump 3200 →
     3250 (the lane adds ~50-80 lines for the
     `replacement_effects` schema arm; the other lanes
     stay under the existing 3200 budget).

   - **If the foundational layer reveals more than this**:
     split into lane 61a (foundation + a single
     self-replacement card) and lane 61b (the cross-ref
     engine arm — `moveCardToZone` consult). Don't bundle
     into one lane.

2. **Lane 61b — Cross-ref engine arm** (only after 61a
   ships). Add `moveCardToZone`'s death-replacement consult
   for ALL creatures, not just scripted ones. The synthetic
   card in 61a is a scripted source; 61b extends the
   engine so non-scripted "if would die, instead exile"
   sources (Whip of Erebos's actual oracle) work via the
   printed `static` mechanism. Docstring bump: 3250 →
   3300 (estimated +30 lines for the printed-card
   mechanism). ~80-120 LOC + tests.

3. **Out-of-scope lanes from follow-up 12** (after
   lane 61a/61b land). Each fits cleanly under the
   aggressive loop's 40-turn budget:

   - **Lane 93 — "you may" prompt on a draw**
     (Skyship Buccaneer's deferred half; lane 87's "Out of
     scope" item). Sample card: a Skyship-Buccaneer-style
     "you may pay 2 life; if you do, draw a card" trigger.
     Schema: extend the lane 60 `you_may` pattern to also
     accept a cost-arm (parallel to lane 88's
     `cost.sacrifice_self` — the trigger has a yes/no
     gate AND a cost; on yes, pay the cost then run the
     effects; on no, skip). Engine: extend
     `resolveScriptedAbility` to chain the cost after the
     yes/no gate. ~60-100 LOC + small test.

   - **Lane 94 — "where X is the number of cards drawn
     this turn" X-count** (Proft's Eidetic Memory's
     deferred half). The X-count substrate
     (`X: "treasures" | "creatures" | "lands"` from lane
     36) doesn't cover "draw N" out of the box for the
     *count* (only the boolean read from lane 90 covers
     "did anything die this turn"). Add
     `X: "cardsDrawnThisTurn"` to DrawSchema and the
     integer read to `resolveDrawAmount`. Sample card:
     Proft's Eidetic Memory or a synthetic. ~40-60 LOC +
     test.

   - **Lane 95 — "cards drawn by all opponents" aggregation
     (Rhystic Study's deferred half). Add
     `X: "cardsDrawnThisTurn_byOpponents"` (parallel to
     lane 90's `creaturesDiedThisTurn` but with an
     opponent-filter). Sample card: Rhystic Study or a
     synthetic. ~40-60 LOC + test.

   - **Lane 96 — "create a 1/1 red Goblin creature token
     with menace"** (Redcap Gutter-Dweller's deferred
     half — keywords-on-token). The lane 66 `CreateToken`
     substrate's `keywords` arm already supports
     `"menace"`; this lane is JSON-only: chain a
     `CreateToken` effect with `keywords: ["menace"]`
     onto Redcap Gutter-Dweller's existing trigger.
     ~10 LOC + test.

   - **Lane 97 — "create X 1/1 red Goblin creature
     tokens"** (Redcap-style counters with an X-count
     arm). Extend `CreateTokenSchema`'s `count` to
     accept an X-on-amount variant (parallel to
     `GainLifeSchema.X: "toughness"` from lane 92 and
     `DrawSchema.X: "creaturesDiedThisTurn"` from lane
     90). Sample card: Redcap Gutter-Dweller's deferred
     X-count. ~30-50 LOC + test.

   - **Lane 98 — Storm Fleet Spy variant "may discard a
     card" cost** (parallel pattern to Storm Fleet Spy,
     a separate card). The lane 88 `cost.sacrifice_self`
     substrate covers sacrifice-cost; "may discard a
     card" is the mirror. Add
     `cost: { discard: { amount: 1 } }` to TriggerSchema.
     ~30-50 LOC + test.

   - **Lane 99 — "you may" + sacrifice-cost** ("if you
     do, sacrifice" alternates like the lane 88 v1 minimum
     but with a sacrifice cost instead of an
     auto-sacrifice). Already partially supported by the
     lane 88 + lane 60 substrate; this lane wires the
     two together and adds a sample card (a Skyship-
     Buccaneer-alike with `you_may: true` AND
     `cost.sacrifice_self: true`). ~30-50 LOC + test.

   - **Lane 100 — "if [thing] would die, instead return
     it to its owner's hand"** (Whip of Erebos's
     deferred hand-redirect). Add
     `redirect.to: "hand"` to the lane 61a
     `replacement_effects` schema. JSON-only (the engine
     arm from 61a covers it via the existing
     `redirectToZone` field). ~10-20 LOC + test.

   - **Lane 101 — "if [thing] would die, instead
     sacrifice it"** (False Dawn's deferred
     sacrifice-redirect). Add `redirect.to: "sacrifice"`
     and a special-case handler in `moveCardToZone`'s
     consult. ~30-50 LOC + test.

   - **Lane 102 — Midrange extension: target not self**
     ("if ANOTHER creature you control would die,
     instead ..."). Extend the lane 61a `applies_to`
     schema arm with a `notSelf: true` field (parallel
     to the lane 36 `affects.other: true` shape). Sample
     card: a defender-of-the-faith-style anthem. ~20-30
     LOC + test.

   - **Lane 103 — Conditional replacement-effect** ("if
     [thing] would die and you control [X], instead ...").
     Extend the lane 61a `if_condition: string` arm with
     a single-shape pattern (parallel to the lane 91
     `while_condition` pattern but at replacement time,
     not static-refresh time). The evaluator reads the
     replacement-event context (dying card id, etc.) and
     compares against the named condition. Sample card:
     a Karmic Guide-style "if [thing] would die and it's
     a creature, instead exile it". ~30-50 LOC + test.

   - **Lane 104 — Periodic self-replacement** ("if this
     creature would die, instead tap it"). Same substrate
     as 61a/100/101 but with `redirect.to:
     "battlefield_tapped"` (or
     `"battlefield_untapped"`) and a new destination
     handler. Sample card: a Cyclops-style "instead
     lose 1 life" (with `"life_loss"` redirect — new
     destination type). ~30-50 LOC + test.

   - **Lane 105 — Tokens-deferred half** (Hedron
     Crawler's deferred "if [token] would die this turn,
     instead exile it"). Same substrate as 61a but with
     the `applies_to.isToken: true` filter (new arm).
     ~30-50 LOC + test.

   - **Lane 106 — "you may pay [life]; if you do, [X]"
     alternate** ("you may pay 5 life; if you do, draw a
     card", part of an existing trigger or standalone).
     Extend the lane 88 cost substrate with
     `cost.pay_life: { amount: N }` (parallel to
     `cost.sacrifice_self: true`). The
     `additionalCosts.pay_life` arm on `CardScript` (from
     lane 63) is spell-cast only; the trigger-cost arm
     is the lane 106 substrate. ~30-50 LOC + test.

4. **End-of-loop summary** (per the follow-up 12 handoff's
   process rule): when every queue item above is either
   shipped or marked multi-lane blocker (with a paragraph
   in `wave4-blockers.md` documenting why), append a
   follow-up 13 loop done summary at the bottom of
   `docs/card-scripts/wave4-blockers.md` documenting the
   shipped lanes, the blocked gaps with their #2614 plan
   work references, and a fresh test-count snapshot.

If lane 61a is blocked on the foundational layer (the
substrate reveals multi-lane implications that don't fit
under 40 turns), document in `wave4-blockers.md` and
move to a smaller out-of-scope lane. The aggressive loop
adapts.

## State at session start

- **HEAD**: the follow-up 12 loop done summary merge
  commit on main (`b729408b` per the most recent merge).
  Lanes 87 / 88 / 89 / 90 / 91 / 92 are shipped (PRs
  #2775 / #2777 / #2778 / #2779 / #2780 / #2781); the
  loop done summary is PR #2782.
- **749 suites / 14259 cases** (14252 passed + 7
  skipped). The Wave 4.8 follow-up 13 loop adds to
  these.
- **Lint 0 errors, typecheck clean** (the previous
  baseline).
- **Engine-size budget**: 3200 lines for `schema.ts`
  (the follow-up 12 lane 91 bump; holding at 3164 after
  lane 92). The follow-up 13 lanes are mostly engine /
  schema extensions; the 3200 budget gives ~36 lines of
  headroom. If any follow-up 13 lane needs more, bump
  the budget in the SAME commit per the historical
  precedent ("bump the budget rather than fragmenting
  the family"). Update the docstring block in
  `scripts/check-engine-size-budget.mjs` with a
  one-paragraph history entry (the existing entries are
  a good template).
- **Bundle-size budget**:
  `config/bundle-budget.json` was re-captured in
  earlier Wave 4.8 loops. The follow-up 13 lanes grow
  the engine surface (schema + engine arms), so any
  lane that adds a new op / static arm may grow the
  client bundle. Re-capture the budget in the same
  commit per the handoff's process section if the lane
  grew the engine surface the client pulls in.
- **Working directory**:
  `/home/alex/Projects/planar-nexus` (clean).
- **Open issues relevant to this loop**:
  - #2487 (the card-scripts epic).
  - #2614 (the original drafter-list plan work — closed
    but follow-up issues open under it; the new lanes
    61a/61b/93–106 should reference the relevant
    follow-up issue numbers).
- **Just-shipped context**: lanes 87 / 88 / 89 / 90
  / 91 / 92 are the most recent merges (PRs #2775 →
  #2782). The aggressive loop's machinery (worktree +
  worktree-local `node_modules` symlink + ratchet +
  process note) is intact.

## Process (mandatory, identical to Wave 4 / 4.5 / 4.6
/ 4.7 / 4.7 follow-up / 4.7 phase 2 / 4.8 / 4.8
follow-up / 4.8 follow-up 2 / 4.8 follow-up 3 /
4.8 follow-up 4 / 4.8 follow-up 5 / 4.8 follow-up 6 /
4.8 follow-up 7 / 4.8 follow-up 8 / 4.8 follow-up 9 /
4.8 follow-up 10 / 4.8 follow-up 11 / 4.8 follow-up
12)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
   /tmp/opencode/wave414-lane<N>-<slug> -b
   <type>/<scope> origin/main` where `<N>` starts at
   `93` (or `61a` for the foundational lane) and
   `<slug>` is kebab-case, min 10 chars. `ln -s
   /home/alex/Projects/planar-nexus/node_modules
   /tmp/opencode/wave414-lane<N>-<slug>/node_modules`
   so test/lint/typecheck skip a fresh install.
   Verify with `ls
   /tmp/opencode/wave414-lane<N>-<slug>/node_modules/.bin/jest`.
   Note: the symlinked `node_modules` will fail `npm run
   build` (Turbopack errors on the `node_modules` symlink
   pointing outside the worktree root). The bundle-size
   budget re-capture requires a real build, so when a
   lane grows the engine surface that the client bundle
   pulls in, `rm` the symlink and run `npm ci` first
   to do the build.

2. **Scope discipline**: each lane is one self-contained
   change. Schema + engine + sample card + dedicated
   test is fine (lanes 82 / 83 / 84 / 86 followed this
   pattern; lane 85 was test-only). **Don't** ship a
   second sample card for a different pattern, **don't**
   refactor unrelated plumbing, **don't** partial-port
   a multi-card block. If the lane grows past one
   schema arm + one engine arm + one card, back out,
   document the reason in `wave4-blockers.md`, and pick
   a smaller next lane.

3. **Implement**: schema → engine → sample card →
   dedicated test → ratchet.

   - **Schema**:
     `src/lib/game-state/card-scripts/schema.ts` is the
     one place for new fields. For each lane, follow the
     existing allow-list pattern. New fields should
     integrate into the chosen-X / additional-costs /
     affinity / grants / counter-ledger / cast-from-zone
     / mana-restriction / copy-permanent /
     creature-payment / aura-protection / until-eot-copy
     / `cost` / `replacement_effects` (lane 61a) /
     `enter_choice` family when possible. Lanes 61a,
     93–106 are extensions on existing arms; the
     `replacement_effects` schema (lane 61a) is
     foundational.

   - **Engine**: the right home depends on the arm.
     - `replacement_effects` (lane 61a) →
       `src/lib/game-state/replacement-effects/`
       (manager.ts + types.ts) — extend the existing
       `ReplacementEvent` / `ReplacementEffectType`
       substrate.
     - `cost.sacrifice_self` (lane 99, parallel to
       lane 88) → `card-scripts/interpret.ts` (extends
       the existing lane 88 substrate).
     - `cost.pay_life` (lane 106, parallel to lane 88)
       → `card-scripts/interpret.ts` + `keyword-actions/`
       (the existing lane 63 `additionalCosts.pay_life`
       arm is spell-cast only; the trigger-cost arm
       extends the lane 88 cost shape).
     - All other arms → extend the existing lane 87 /
       88 / 90 / 91 / 92 substrates (`drawCards`,
       `interpret.ts`, `scripted-statics.ts`,
       `evaluate.ts`).

5. **Sample card**: each lane updates one existing
   card JSON (Whip of Erebos, Skyship Buccaneer,
   Proft's Eidetic Memory, Rhystic Study, Redcap
   Gutter-Dweller, Storm Fleet Spy, Karmic Guide,
   Cyclops, Hedron Crawler, etc.) OR adds a synthetic
   card if the named card doesn't exist in the
   drafter list.

6. **Tests**: dedicated `*.test.ts` file per lane,
   colocated in `src/lib/game-state/card-scripts/__tests__/`.

7. **Run checks (in the worktree)**:

   - `PATH="$PWD/node_modules/.bin:$PATH" npx tsx
     scripts/build-card-script-index.ts`
   - `PATH="$PWD/node_modules/.bin:$PATH" npm test
     --silent` (full suite — must be all green; the
     AI `forge-gate` / `forge-selfplay` /
     `expert-agent` "is deterministic for a seed"
     flake is known — re-run once if it hits, then
     move on).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
     typecheck` (must be clean).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
     lint` (0 errors; warnings OK).
   - `PATH="$PWD/node_modules/.bin:$PATH" node
     scripts/check-engine-size-budget.mjs`
     (must pass; budget currently 3200 lines for
     `schema.ts`, measured 3164 after lane 92). Bump
     the budget rather than fragmenting the family.
     Update the docstring block in
     `scripts/check-engine-size-budget.mjs` with a
     one-paragraph history entry (the existing
     entries are a good template).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
     ratchet:test-count` (rewrites anchored doc
     blocks when test count changes). If the ratchet
     times out (the AI flake mid-ratchet), use the
     `--live <counts.json>` fallback at
     `scripts/ratchet-test-count.mjs` (skips the
     live Jest run; the Wave 4.8 follow-up 8 lanes
     75b / 75c / 75d used this fallback, as did
     follow-up 11 every lane and follow-up 12 lanes
     87 / 88).
   - **Bundle-size check (only when the lane grows
     the engine surface that the client bundle pulls
     in)**: `rm node_modules` (the symlink) and `npm
     ci`, then `npm run build`, then `node
     scripts/check-bundle-budget.mjs --check`. If the
     lane grew the engine and the bundle check fails,
     re-capture the budget: `node
     scripts/check-bundle-budget.mjs --capture` and
     commit the updated `config/bundle-budget.json`
     alongside the lane's other changes.

8. **Commit**: `git add -A &&
   GIT_AUTHOR_NAME="Planar Nexus Agent"
   GIT_AUTHOR_EMAIL="agent@planar-nexus.local"
   GIT_COMMITTER_NAME="Planar Nexus Agent"
   GIT_COMMITTER_EMAIL="agent@planar-nexus.local"
   git commit -F COMMIT_MSG.txt`. Then `git rm
   --cached COMMIT_MSG.txt &&
   GIT_AUTHOR_NAME="Planar Nexus Agent"
   GIT_AUTHOR_EMAIL="agent@planar-nexus.local"
   GIT_COMMITTER_NAME="Planar Nexus Agent"
   GIT_COMMITTER_EMAIL="agent@planar-nexus.local"
   git commit --amend --no-edit && rm COMMIT_MSG.txt`.
   Then `git push --force-with-lease origin <branch>`.
   The Wave 4.8 follow-up 5 process learned: `git
   commit` without the env vars picks up the husky
   global git config and the commit shows up under the
   wrong author. Use the env vars explicitly, on every
   `git commit` (and on every `git commit --amend`).

9. **Open PR**: write `PR_BODY.txt` AFTER the commit
   (this is the cleaner pattern — see the Wave 4.8
   follow-up 3 process note). Then `gh pr create
   --title "<type>(<scope>): <one-line>"
   --body-file PR_BODY.txt --base main
   --head <branch>`. Then `gh pr merge <PR>
   --squash --delete-branch --admin` once checks
   pass. **Do not** `git add PR_BODY.txt` — writing
   the file post-commit avoids the amend `git rm
   --cached` step for that file. The commitlint
   subject is enforced as lower-case; the commit
   subject MUST be lower-case.

10. **Conflict resolution (if main moves during the
    lane)**: `git merge origin/main --no-edit` then
    resolve any conflicts (the most common is the
    test-count doc drift between main and your
    branch). For the test-count block: keep the higher
    values (the lane's contribution adds cases, so
    main's value will be lower or equal). Then `npm
    run ratchet:test-count` to confirm. Force-push
    and re-wait CI.

11. **Cleanup**: exit the worktree directory, then
    `git worktree remove
    /tmp/opencode/wave414-lane<N>-<slug> --force &&
    git branch -D <branch>`.

## Conventions (carried from prior loops)

- **Branch**: `<type>/<scope>` (lowercase, kebab-case,
  min 10 chars). `<scope>` is the lane's punchy name
  (e.g. `whip-of-erebos-replacement-death` for lane
  61a, `skyship-buccaneer-pay-life-cost` for lane 93).
- **Commit subject**: lower-case, min 10 chars, type
  from `feat fix docs style refactor test chore revert`.
  Wave 4.8 saw `header-case` linting on commitlint —
  lowercase is enforced; write the subject in
  lowercase from the start.
- **Reference #2487 / #2614** in the commit body
  and the PR body so the cross-references stay tight.
  Reference the specific card (e.g. `Whip of Erebos
  (THB 99)` for lane 61a, `Skyship Buccaneer (FDN 76)`
  for lane 93) when applicable.
- **Conventional Commits**. Never check in
  `COMMIT_MSG.txt` (amend-rm before pushing) or
  `PR_BODY.txt` (write it AFTER the commit, per the
  Wave 4.8 follow-up 3 process note).
- **Test count**: ratchet in the same commit as any
  test count change, before pushing.
  `test-count-docs-guard` re-measures live Jest and
  fails on any drift in `docs/onboarding.md` or
  `docs/TEST_VIDEO_FIXTURES.md`.
- **Engine-size budget**: 3200 lines for `schema.ts`
  (the Wave 4.8 follow-up 12 lane 91 bump; holding
  at 3164 after lane 92). Lanes 93–106 may push the
  schema beyond 3164; if a lane needs more, bump
  the budget in the SAME commit per the follow-up 8
  process note (the bump-then-add pattern). Update
  the docstring block in
  `scripts/check-engine-size-budget.mjs` with a
  one-paragraph history entry.
- **Bundle-size budget**: lanes that grow the
  engine surface (likely all of these — most add a
  new op / static / replacement arm) need the bundle
  re-captured. Follow the Process step 7 above.
- **Pre-commit hook** runs `eslint --fix` →
  `tsc --noEmit` → `prettier --write` on staged
  *.{ts,tsx,md,json,...}. A failing typecheck
  blocks the commit; run typecheck before staging.
  If `tsc --noEmit` passes locally but CI fails
  with `Cannot find name`, the husky pre-commit
  hook's local typecheck can pass while CI's `tsc
  --noEmit` flags a missing import — always
  cross-check imports before pushing.
- **Markdown gets prettier'd**; keep diffs small
  and don't fight the formatter. Note: the husky
  pre-commit hook runs prettier on staged
  `*.{ts,tsx,md,json,...}` files; if you write a
  `COMMIT_MSG.txt` and stage it, the prettier pass
  may delete the file. Write the commit message to
  a file, stage the changes, commit using `git
  commit -F COMMIT_MSG.txt`, then `git rm --cached
  COMMIT_MSG.txt` and amend.

## Aggressive loop rules

- **Don't ask the user between lanes.** Pick the
  next gap autonomously and ship it. The priority
  queue is:
  1. Lane 61a (Whip of Erebos replacement-effect
     foundation — first lane in this loop).
  2. Lane 61b (cross-ref engine arm — only after 61a
     ships).
  3. Lanes 93–106 (out-of-scope lanes from
     follow-up 12), in the order listed above.
  4. Loop done summary.
  After lane 61a ships, the loop continues to pick
  lanes autonomously from the queue.

- **Don't ship multi-lane work in one PR.** If a
  lane reveals a second pattern that also needs new
  schema, split it into a follow-up lane and put a
  paragraph in `wave4-blockers.md` documenting why.

- **Lane is "done"** only when: CI green, PR merged,
  worktree removed, branch deleted, local main pulled
  and re-ratcheted.

- **If CI fails on a lane**: don't push; fix the lane.
  If the fix is unclear, document the failure in
  `docs/card-scripts/wave4-blockers.md` and skip to
  the next lane. The AI `forge-gate` / `forge-selfplay` /
  `expert-agent` "is deterministic for a seed" test is
  a known order-dependent flake on main; if a CI run
  shows only that test failing, `gh run rerun
  --failed` is the right move (do NOT amend the
  lane). Budget for 1–2 extra CI runs per lane to
  absorb the flake.

- **Turn budget: 40 turns per lane max** (per
  `AGENTS.md` §Turn Budget). If a single lane
  exceeds this, it's too big — back out, document, and
  pick a smaller one. Lane 61a is a foundational
  substrate, so it may run close to 40 turns; if it
  exceeds, split into 61a (schema + minimum engine)
  and 61b (cross-ref consult + sample card).

- **Multi-lane deferrals**: if a lane reveals a
  second pattern that needs new schema, split it
  into a follow-up lane. Put a paragraph in
  `wave4-blockers.md` documenting why. Don't ship
  multi-lane work in one PR.

- **Lane 61 is now a multi-lane plan** (61a + 61b
  + the out-of-scope lanes 100 / 101 / 105 / etc.).
  The aggressive loop picks the foundational lane
  61a first; once it ships, the loop treats the
  remaining 61b and the out-of-scope lanes as
  normal lanes.

## Done definition for the loop

When every queue item above is either shipped or
marked multi-lane blocker (with a paragraph in
`wave4-blockers.md` documenting why), append a Wave
4.8 follow-up 13 loop done summary at the bottom of
`docs/card-scripts/wave4-blockers.md` documenting the
shipped lanes, the blocked gaps with their #2614 plan
work references, and a fresh test-count snapshot.
Then stop.

This loop covers the foundational replacement-effect
layer (lanes 61a + 61b) plus the follow-up 12
out-of-scope queue (lanes 93–106). Lane 61a's
foundational substrate is the load-bearing piece;
everything else rides on top of it.

If lane 61a is blocked on the foundational layer (the
substrate reveals multi-lane implications that don't
fit under 40 turns), document in `wave4-blockers.md`
and move to a smaller out-of-scope lane. The
aggressive loop adapts.

## Process observations carried from previous loops

- The AI `forge-gate` / `forge-selfplay` /
  `expert-agent` "is deterministic for a seed" test
  is a known order-dependent flake on main. If a CI
  run shows only that test failing, `gh run rerun
  --failed` is the right move — do NOT amend the
  lane. Wave 4.8 follow-up 11 absorbed 1–2 extra CI
  runs per lane on the local full-suite run; the
  second / fourth local run absorbed it cleanly each
  time. Wave 4.8 follow-up 12 followed the same
  pattern. Budget for 1–2 extra CI runs per lane to
  absorb the flake.

- `ci-wait` can return `FAILED` on a freshly-opened
  PR with all checks still pending. Wait a second
  call to `ci-wait` to get a real verdict. (`sleep 60
  && gh pr checks <PR>` is a good way to seed the
  API.)

- `npm run ratchet:test-count` is reliable; run it
  in the same commit as any test count change. If
  it hits the AI flake, use the `--live
  <counts.json>` fallback.

- The handoff's process rule on `git worktree
  remove`: the `--delete-branch` flag on `gh pr
  merge` only deletes the remote branch. The local
  worktree directory must be removed manually after
  exiting it (`git worktree remove ... && git branch
  -D ...`).

- `git commit` without `GIT_AUTHOR_NAME` /
  `GIT_AUTHOR_EMAIL` env vars picks up the husky
  global git config and the commit shows up under
  the wrong author. Use the env vars explicitly, on
  every `git commit` (and on every `git commit
  --amend`).

- When the ratchet's `--live <counts.json>` fallback
  is used (skips the live Jest run; uses a hand-built
  JSON), document the rationale in the lane's commit
  body — the CI guard may catch a stale count if the
  fallback's hand-built JSON drifts from the live
  Jest summary.

- Wave 4.8 follow-up 10 process observation: when
  writing the blockers update as a separate workflow
  (NOT as part of a lane PR), use a `docs/`-prefixed
  branch and the `--no-verify` flag on `git commit`
  to bypass the husky pre-commit hook (which can fail
  on the commitlint subject when prettier has
  re-formatted a staged `COMMIT_MSG.txt` that the
  husky hook then deletes). The follow-up 13 loop
  writes the loop done summary at the end of the
  loop on a separate `docs/followup13-loop-done`
  branch.

- Wave 4.8 follow-up 8 lane 75 process observation:
  the `until-EOT copy` family grew the schema by
  +60 lines in one shot and required bumping the
  budget. Lane 61a's `replacement_effects` arm may
  similarly grow by ~50-80 lines. Bump-then-add in
  the same commit per the historical precedent.

- Wave 4.8 follow-up 11 process observation: the
  lane 86 test exercises `gainLife` →
  `detectTriggeredAbilities("lifeGain")` →
  `putTriggersOnStack` → `resolveScriptedAbility`
  end-to-end. The follow-up 13 lanes should follow
  the same end-to-end shape (detect → put → resolve
  → assert) for the new op / replacement arms.

- Wave 4.8 follow-up 12 process observations
  (relevant to lane 61a):

  - The lane 87 work required propagating the
    trigger's `drawingPlayerId` from
    `detectTriggeredAbilities` all the way through
    `checkTriggeredAbilities` → StackObject →
    `resolveScriptedAbility` → `EffectContext` →
    `applyEffect`. The propagation pattern is the
    template for any future "context-bound" effect.
    Lane 61a's "would_die" event context (the dying
    card id, the dying card's controller, etc.)
    follows the same shape — the propagation lives
    in `moveCardToZone`'s consult path.
  - The lane 88 work exposed a pre-existing bug in
    the `you_may_prompt` flow under `resolveTopOfStack`
    that the existing tests bypass by calling
    `resolveScriptedAbility` directly. Lane 61a's
    replacement-effect consult runs in a different
    code path (`moveCardToZone` is called by
    `destroyCard` / `sacrificeCard` / `exileCard` /
    `markCreatureDiedThisTurn`'s callers), so the
    bug doesn't apply.
  - The lane 90 work exposed a JSON-key / CR 107.3-X
    ambiguity in the existing "only cards with X in
    their text use X" test guard. The guard was
    updated to strip the lane 90 JSON-key usage
    before the CR 107.3-X check. Lane 61a has no
    analogous ambiguity (the `replacement_effects`
    schema is JSON-object-valued, not JSON-key-
    valued).
  - The lane 92 work required defensive
    `evaluateStaticWhileCondition` + `enteringCardId`
    threading through the resolution path. The test
    pattern uses `detectTriggeredAbilities(state,
    "entersBattlefield", { enteringCardId })` to
    surface the intervening_if gate against the
    named creature's cmc. Lane 61a's
    `replacement_effects` consult follows the same
    pattern — the test pattern is
    `processEvent(state.replacementEffectManager,
    { type: "would_die", sourceCardId: dyingCardId,
    ... })` and asserts the redirect on the result.

## Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any leftover from Wave 4.8 follow-up 12)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 749 / 14259 green
# then start lane 61a (replacement effect for death — foundational)
# per the Process section above.
```

End each lane with: `git log --oneline -1` on main
showing the new lane's commit, and `grep "Test suites"
docs/onboarding.md` showing the bumped numbers. If
those two checks pass, you're ready to pick the next
lane from the priority queue and continue the loop.
After lane 61a ships, pick lane 61b. After lane 61b
ships, pick the smallest out-of-scope lane (93).
After every queue item ships or is marked multi-lane
blocker, write the loop done summary and stop.

## Notes on the engine surface for lane 61a

(Whip of Erebos / False Dawn replacement effect for
death)

When implementing lane 61a, the engine surface is:

1. **Schema** (`src/lib/game-state/card-scripts/schema.ts`):
   add a new top-level `replacement_effects` array on
   `CardScript`. Each entry:

   ```ts
   {
     event: "would_die" | "would_be_destroyed";
     applies_to: {
       type: "self" | "creature" | "artifact" | "enchantment"
             | "planeswalker" | "any";
       controller?: "you" | "opponent" | "any";
       isToken?: boolean;
     };
     redirect: {
       to: "exile" | "library_top" | "library_bottom"
           | "hand" | "battlefield_tapped"
           | "battlefield_untapped" | "sacrifice"
           | "life_loss" | "any_zone";
       amount?: number;  // for `life_loss` redirect
     };
     optional?: boolean;  // surfaces a yes/no waitingChoice
     once_per_turn?: boolean;
     if_condition?: string;  // CR 603.4 intervening-if
   }
   ```

   v1 minimum supports a single shape:
   `event: "would_die"` + `applies_to.type: "creature"`
   + `applies_to.controller: "you"` +
   `redirect.to: "exile"`. Other shapes ride follow-up
   lanes (lanes 100–106 cover the rest).

2. **Engine** (`src/lib/game-state/replacement-effects/`):
   extend `ReplacementEffectType` with `"death_replacement"`
   (or similar — see existing enum). Add a new
   `ReplacementEventType` arm: `"would_die"` (with
   `sourceCardId` = the dying card, `controllerId` = the
   dying card's controller). Extend `ReplacementAbility`
   to carry a `redirectToZone` field on the result. The
   existing `processEvent` method on
   `ReplacementEffectManager` already handles APNAP
   ordering and loop detection; the lane is about
   adding the event type + the redirect field + the
   wiring in `moveCardToZone`.

3. **Engine** (`src/lib/game-state/keyword-actions/removal.ts`):
   in `moveCardToZone`, when `fromZone === "battlefield"`
   and `toZone === "graveyard"`, consult
   `state.replacementEffectManager.processEvent({
   type: "would_die", sourceCardId: cardId, controllerId:
   card.controllerId })` BEFORE the move. If the result
   has a `redirectToZone` field, route the move to that
   zone instead of graveyard. The
   `effect-resolution.ts`'s death-replacement consult
   follows the same shape.

4. **Sample card**: `cards/whip_of_erebos.json` (if it
   exists in the drafter list) or a synthetic card.
   The synthetic card's JSON: a vanilla 4/4 creature
   with the `replacement_effects` arm carrying
   `"if a creature you control would die, instead exile it"`.

5. **Test**: `replacement-effect-death.test.ts`
   covers:
   - the synthetic source's replacement fires when a
     creature would die
   - the replacement routes the death to exile (not
     graveyard) and the exiled creature is on the
     battlefield owner's exile zone with all state
     preserved
   - APNAP ordering: when both players have the effect,
     the active player's applies first
   - the replacement doesn't fire for non-creature
     permanent deaths (artifacts / enchantments /
     planeswalkers) — only
     `applies_to.type === "creature"` matches
   - the `optional?: true` arm surfaces a yes/no
     waitingChoice
   - the CR 614.4 loop guard handles a self-replacement
     that would re-trigger itself without hanging
   - the foundational event type `"would_die"` shows
     up in `processEvent`'s `currentEvent` and produces
     the expected `redirectToZone` field on the result

Out of scope for lane 61a (each a follow-up lane):
- the cross-ref engine arm so non-scripted "if would
  die, instead exile" sources (Whip of Erebos's
  actual oracle) work via the printed `static`
  mechanism — that's lane 61b
- the `redirect.to: "hand"` / `"library_top"` /
  `"library_bottom"` / `"sacrifice"` /
  `"battlefield_tapped"` / `"battlefield_untapped"`
  / `"life_loss"` / `"any_zone"` extensions — those
  are lanes 100 / 101 / 104
- the `if_condition` / `optional` / `once_per_turn`
  / `notSelf` / `isToken` / `applies_to.isToken`
  extensions — those are lanes 102–106
- the trigger-cost variants (lanes 93 / 95–99 / 106)

## Notes on the engine surface for lane 61b

(Cross-ref engine arm — Whip of Erebos's printed
mechanism)

When implementing lane 61b, the engine surface is:

1. **Schema** (no change — lane 61a's
   `replacement_effects` arm is sufficient). Add
   `cards/whip_of_erebos.json` to the drafter list
   with the printed `static` mechanism:
   `static: { "if a creature you control would die,
   instead exile it" }`. The `static` arm reads from
   the source's printed `cardData.oracle_text` and
   builds a `replacement_effects` entry at refresh
   time (similar to how `refreshScriptedStatics`
   builds `scriptStaticPT` for `X: "treasures"`).

2. **Engine** (`src/lib/game-state/keyword-actions/scripted-statics.ts`):
   extend `refreshScriptedStatics` with a
   "death_replacement" arm that parses the source's
   printed oracle text and writes a
   `replacement_effects` entry onto the source's
   per-instance `deathReplacement` ledger (parallel
   to `scriptStaticKeywords` for keyword grants).
   The replacement consult in
   `keyword-actions/removal.ts`'s `moveCardToZone`
   reads this ledger (in addition to the lane 61a
   `replacement_effects` schema arm).

3. **Test**: extend `replacement-effect-death.test.ts`
   with a Whip-of-Erebos variant (synthetic card with
   the printed `static` mechanism): the test parses
   the printed oracle text, builds the
   `deathReplacement` ledger at refresh time, then
   asserts the replacement fires when a creature would
   die.

Out of scope for lane 61b (each a follow-up lane):
- the lane 61a out-of-scope extensions (lanes
  100–106)
- the trigger-cost variants (lanes 93 / 95–99 / 106)

## Notes on the engine surface for lane 93

("you may" prompt on a draw — Skyship Buccaneer)

When implementing lane 93, the engine surface is:

1. **Schema** (`src/lib/game-state/card-scripts/schema.ts`):
   extend the lane 60 `you_may: z.boolean().optional()`
   arm on `TriggerSchema` to also accept a cost arm.
   Pattern: `you_may_cost: { sacrifice_self: true } |
   { pay_life: { amount: N } }`. v1 supports
   `sacrifice_self` and `pay_life`; other costs ride
   follow-up lanes. Mutual exclusion with `cost` (the
   lane 88 substrate): a trigger is either
   `cost.sacrifice_self: true` OR
   `you_may_cost.sacrifice_self: true`, not both.

2. **Engine** (`src/lib/game-state/card-scripts/interpret.ts`):
   extend `resolveScriptedAbility`'s `you_may` gate to
   also chain a cost after the yes/no gate. On yes,
   pay the cost; on no, skip the trigger. The cost
   substrate extends the lane 88 `cost` mechanism.

3. **Sample card**: `cards/skyship_buccaneer.json`
   (if it exists in the drafter list) or a synthetic
   card. The synthetic card's JSON: a vanilla 3/3
   creature with the trigger carrying
   `you_may_cost: { pay_life: { amount: 2 } }` and
   `effects: [{ op: "Draw", amount: 1, who: "you" }]`.

4. **Test**: extend the existing `you_may` test file
   or create a new `skyship-buccaneer-you-may-cost.test.ts`.
   Covers: yes pays cost and runs effects; no skips
   without paying cost.

Out of scope for lane 93 (each a follow-up lane):
- the `you_may_cost.pay_life` arm (parallel to the
  lane 88 `cost.sacrifice_self` shape) is part of
  lane 106
- the `you_may_cost.discard` arm is part of lane 98
- the "instead" / "may put into graveyard" alternate
  is part of lane 99

## Notes on the engine surface for lane 94

("where X is the number of cards drawn this turn" —
Proft's Eidetic Memory)

When implementing lane 94, the engine surface is:

1. **Schema** (`src/lib/game-state/card-scripts/schema.ts`):
   extend `DrawSchema.X` (currently
   `z.enum(["creaturesDiedThisTurn"])`) with the new
   arm `"cardsDrawnThisTurn"`. The engine reads
   `state.players[controllerId].cardsDrawnThisTurn`
   (an integer counter — verify it exists on the
   `Player` type; if not, add it; see
   `recordCardsDrawn` in
   `keyword-actions/cards-drawn.ts`).

2. **Engine** (`src/lib/game-state/card-scripts/interpret.ts`):
   extend `resolveDrawAmount` (lane 90's helper) to
   handle the new arm:
   `case "cardsDrawnThisTurn": return state.players[controllerId]?.cardsDrawnThisTurn ?? 0`.

3. **Sample card**: `cards/profts_eidetic_memory.json`
   (if it exists) or a synthetic card. The synthetic
   card's JSON: a vanilla 3/3 creature with the
   trigger carrying
   `effects: [{ op: "PutCounters", counter: "+1/+1",
   amount: 1, target: "self", X: "cardsDrawnThisTurn" }]`
   (or the analogous `Draw` / `GainLife` op).

4. **Test**: `profts-eidetic-memory-draw-count.test.ts`
   covers the registry shape, the integer read (not
   just the boolean read from lane 90), and the
   end-to-end "draw 3 cards → gain 3 life" path.

Out of scope for lane 94 (each a follow-up lane):
- the "where X is the number of cards drawn this
  turn by opponents" extension is lane 98

## Notes on the engine surface for lane 95

("cards drawn by all opponents" — Rhystic Study)

When implementing lane 95, the engine surface is:

1. **Schema** (`src/lib/game-state/card-scripts/schema.ts`):
   extend `DrawSchema.X` with the new arm
   `"cardsDrawnThisTurnByOpponents"`. The engine
   reads the sum of `state.players[opponentId].cardsDrawnThisTurn`
   for each opponent of the controller.

2. **Engine**: extend `resolveDrawAmount` to handle
   the new arm:
   `case "cardsDrawnThisTurnByOpponents": { let sum = 0; for (const [pid, p] of state.players) if (pid !== controllerId) sum += p.cardsDrawnThisTurn; return sum; }`.

3. **Sample card**: `cards/rhystic_study.json` (if
   it exists) or a synthetic card.

4. **Test**: `rhystic-study-opponents-draw.test.ts`
   covers the opponent-only aggregation, the
   multi-opponent case (3-player game), and the
   exclusion of the controller's own draws.

Out of scope for lane 95 (each a follow-up lane):
- the "may pay [cost]; if you do, [X]" pattern (lane
  93 / 106)

## Notes on the engine surface for lane 96

("create a 1/1 red Goblin creature token with menace"
— Redcap Gutter-Dweller)

This lane is JSON-only. The lane 66 `CreateTokenSchema`'s
`keywords: ["menace"]` field already exists; this lane
chains a `CreateToken` effect with `keywords: ["menace"]`
onto Redcap Gutter-Dweller's existing trigger. ~10 LOC +
test.

Out of scope for lane 96 (each a follow-up lane):
- the "create X 1/1 red Goblin creature tokens" X-count
  variant is lane 97
- the "create a 1/1 red Goblin creature token AND exile
  it" multi-effect is a future lane

## Notes on the engine surface for lane 97

("create X 1/1 red Goblin creature tokens" — Redcap
Gutter-Dweller)

When implementing lane 97, the engine surface is:

1. **Schema** (`src/lib/game-state/card-scripts/schema.ts`):
   extend `CreateTokenSchema.count` to accept an
   X-on-amount variant (parallel to
   `GainLifeSchema.X: "toughness"` from lane 92 and
   `DrawSchema.X: "creaturesDiedThisTurn"` from lane
   90). Pattern:
   `X: z.enum(["cardsDrawnThisTurn", "creaturesDiedThisTurn", "yourCreatures"]).optional()`.

2. **Engine**: extend `case "CreateToken"` in
   `card-scripts/interpret.ts` to handle the X arms
   (resolve the count from state).

3. **Sample card**: extend Redcap Gutter-Dweller's
   existing JSON.

4. **Test**: extend `gorehorn-raider-goblin-token.test.ts`
   or create a new `redcap-gutter-dweller-x-count.test.ts`.

Out of scope for lane 97 (each a follow-up lane):
- the "create X tokens AND deal X damage" chained
  variant

## Notes on the engine surface for lane 98

(Storm Fleet Spy variant "may discard a card" cost)

When implementing lane 98, the engine surface is:

1. **Schema** (`src/lib/game-state/card-scripts/schema.ts`):
   extend the lane 88 `cost: { sacrifice_self: true }`
   arm to also accept
   `cost: { discard: { amount: 1 } }` (parallel to
   the lane 88 substrate).

2. **Engine**: extend the lane 88 cost dispatch in
   `resolveScriptedAbility` to handle the discard
   arm.

3. **Sample card**: extend Storm Fleet Spy's JSON.

4. **Test**: extend `gorehorn-raider-storm-fleet-spy.test.ts`.

Out of scope for lane 98 (each a follow-up lane):
- the "discard 2 cards" variant

## Notes on the engine surface for lane 99

("you may" + sacrifice-cost)

When implementing lane 99, the engine surface is:

1. **Schema** (`src/lib/game-state/card-scripts/schema.ts`):
   extend the lane 88 `cost: { sacrifice_self: true }`
   arm to also accept `you_may: true` (the existing
   lane 60 substrate). Pattern:
   `you_may: z.boolean().optional()` and
   `cost: { sacrifice_self: true }` on the same
   trigger — the lane 88 cost chain runs AFTER the
   yes/no gate.

2. **Engine**: extend `resolveScriptedAbility`'s
   yes/no gate to also chain the lane 88 cost.

3. **Sample card**: a Skyship-Buccaneer-alike with
   `you_may: true` AND `cost.sacrifice_self: true`.

4. **Test**: extend `midnight-snack-sacrifice-cost.test.ts`.

Out of scope for lane 99 (each a follow-up lane):
- the "you may" + pay_life alternate is lane 106

## Notes on the engine surface for lane 100

("if [thing] would die, instead return it to its
owner's hand")

JSON-only after lane 61a ships. The lane 61a
`replacement_effects` arm's `redirect.to` enum gains
`"hand"` as a new destination. The
`moveCardToZone`'s consult routes the dying card to
the owner's hand. Sample card: any "instead return
to hand" pattern (Whip of Erebos has it, but only as
the EX variant). ~10-20 LOC + test.

Out of scope for lane 100 (each a follow-up lane):
- the "return to top of library" / "return to bottom
  of library" variants
- the "return to library and shuffle" variant

## Notes on the engine surface for lane 101

("if [thing] would die, instead sacrifice it")

When implementing lane 101, the engine surface is:

1. **Schema**: extend `redirect.to` enum with
   `"sacrifice"`.

2. **Engine**: extend `moveCardToZone`'s consult to
   handle the sacrifice redirect (route to
   battlefield owner's graveyard via the sacrifice
   path — `sacrificeCard(state, dyingCreature)`, then
   mark `dyingCreature` as sacrificed).

3. **Sample card**: any "instead sacrifice" pattern
   (False Dawn has it).

4. **Test**: extend `replacement-effect-death.test.ts`.

Out of scope for lane 101 (each a follow-up lane):
- the "instead sacrifice at end of turn" delay

## Notes on the engine surface for lane 102

(Conditional target not self)

When implementing lane 102, the engine surface is:

1. **Schema**: extend `applies_to` with
   `notSelf: z.literal(true).optional()`.

2. **Engine**: extend the consult's "self" check.

3. **Sample card**: a defender-of-the-faith-style
   anthem ("if another creature you control would
   die...").

4. **Test**: extend `replacement-effect-death.test.ts`.

Out of scope for lane 102 (each a follow-up lane):
- the "if creature you don't control" variant
- the "if creature an opponent controls" variant

## Notes on the engine surface for lane 103

(Conditional replacement-effect)

When implementing lane 103, the engine surface is:

1. **Schema**: extend the lane 61a
   `if_condition: string` arm with a single-shape
   pattern (parallel to the lane 91 `while_condition`
   pattern but at replacement time, not static-
   refresh time). The evaluator reads the
   replacement-event context (dying card id, etc.)
   and compares against the named condition.

2. **Engine**: extend `processEvent`'s
   `wouldCreateLoop` infrastructure with a
   conditional-replacement consult.

3. **Sample card**: a Karmic Guide-style "if [thing]
   would die and it's a creature, instead exile it".

4. **Test**: extend `replacement-effect-death.test.ts`.

Out of scope for lane 103 (each a follow-up lane):
- the "if [thing] would die and you control [X],
  instead exile it" conditional
- the "if [thing] would die and it's a [type],
  instead exile it" subtype-conditional

## Notes on the engine surface for lane 104

(Periodic self-replacement — "instead tap it" /
"instead lose 1 life")

When implementing lane 104, the engine surface is:

1. **Schema**: extend `redirect.to` enum with
   `"battlefield_tapped"`, `"battlefield_untapped"`,
   `"life_loss"` (with `amount: number`).

2. **Engine**: extend `moveCardToZone`'s consult to
   handle the new redirect destinations:
   - `"battlefield_tapped"` — re-tap the source (the
     replacement routes the death to "stay on the
     battlefield but tapped" via `tapCardAction`).
   - `"battlefield_untapped"` — re-untap.
   - `"life_loss"` — apply `loseLife(state,
     sourceCardId, redirect.amount, sourceCardId)`.

3. **Sample card**: a Cyclops-style "instead lose 1
   life".

4. **Test**: extend `replacement-effect-death.test.ts`.

Out of scope for lane 104 (each a follow-up lane):
- the "instead gain 1 life" variant
- the "instead draw a card" variant

## Notes on the engine surface for lane 105

(Tokens-deferred half — "if [token] would die, instead
exile it")

When implementing lane 105, the engine surface is:

1. **Schema**: extend `applies_to` with
   `isToken: z.literal(true).optional()`.

2. **Engine**: extend the consult's `isToken` check
   (read from `state.cards[dyingCardId].isToken`).

3. **Sample card**: a Hedron Crawler-style "if a
   creature you control that's a token would die,
   instead exile it".

4. **Test**: extend `replacement-effect-death.test.ts`.

Out of scope for lane 105 (each a follow-up lane):
- the "if a nontoken creature would die" inverse

## Notes on the engine surface for lane 106

("you may pay [life]; if you do, [X]" alternate)

When implementing lane 106, the engine surface is:

1. **Schema** (`src/lib/game-state/card-scripts/schema.ts`):
   extend the lane 88 `cost: { sacrifice_self: true }`
   arm to also accept `cost: { pay_life: { amount: N } }`
   (parallel to the existing lane 63
   `additionalCosts.pay_life` arm, but for trigger-
   cost). The `additionalCosts.pay_life` arm is
   spell-cast only; the trigger-cost arm is the lane
   106 substrate.

2. **Engine**: extend the lane 88 cost dispatch in
   `resolveScriptedAbility` to handle the pay_life
   arm. The existing `resolveLifeLossEffect`
   (`effect-resolution.ts`) is reused.

3. **Sample card**: any "you may pay 5 life; if you
   do, draw a card" pattern.

4. **Test**: extend `midnight-snack-sacrifice-cost.test.ts`.

Out of scope for lane 106 (each a follow-up lane):
- the "you may pay [mana]; if you do, [X]" alternate
- the "you may discard [cards]; if you do, [X]"
  alternate (parallel to lane 98)

## Notes on the engine surface for the loop done
summary

When the loop concludes, the engine surface is:
- the foundational replacement-effect layer (lane
  61a)
- the cross-ref engine arm (lane 61b)
- the trigger-cost variants (lanes 93 / 95–99 /
  106)
- the redirect-to-zone extensions (lanes 100 / 101
  / 104)
- the conditional / target-not-self / token-only
  filters (lanes 102 / 103 / 105)

The aggregate engine surface is ~500-800 LOC across
schema + engine + tests. The total test count
should grow by ~50-70 tests (5–10 per lane, on
average).

The loop done summary at the bottom of
`docs/card-scripts/wave4-blockers.md` documents the
shipped lanes, the blocked gaps with their #2614 plan
work references, and a fresh test-count snapshot. See
the follow-up 12 loop done summary (PR #2782) for the
format template.