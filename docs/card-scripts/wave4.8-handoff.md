# Wave 4.8 handoff — Next session

## Mission

Drive an aggressive, iterative loop on the remaining open lanes
left after the Wave 4.7 phase 2 loop closed. The previous loop
shipped `#2708` phase 2 in two PRs (#2719 + #2721) and landed at
**706 suites / 13907 cases (13900 passed + 7 skipped)** with
the loop done summary committed in `docs/card-scripts/wave4-blockers.md`.
The remaining work is intentionally multi-lane and should be
attacked the same way: one self-contained lane per PR, immediate
next-lane pickup, no human-in-the-loop.

The remaining lanes are:

1. **Lane 52 — Adaptive Automaton type-change half (chosen-creature-type
   addition — narrow lane)**: `StaticSchema.affects.add_creature_type`
   arm, parallel to the chosen-color / chosen-subtype anthems but
   adding the type to the source itself. Adaptive Automaton's full
   oracle works once this lands. The Adaptive Automaton JSON
   already carries the anthem half (lane 45, PR #2715); lane 52
   adds the type-change half. **Scope-wise, the static arm must
   support both the `"chosen"` sentinel (for `enter_choice: { kind:
"creature_type" }` sources — Adaptive Automaton) AND literal
   creature-type strings (Eaten by Piranhas / Infernal Vessel
   family, moved from "out of scope" to "covered by lane 52"
   since the same arm handles both).** Issue: open a fresh
   `#2614` follow-up if none exists yet (the drafter list flags
   "change creature types" — Eaten by Piranhas, Infernal Vessel —
   as multi-lane work; the new arm covers the static half).
2. **Lane 53 — Adaptive Automaton full script + Eaten by Piranhas
   script**: now that the `add_creature_type` arm ships, drop the
   "anthem only" JSON limitation comment on Adaptive Automaton
   (PR #2715) and update its script to a full-oracle JSON (no
   new schema, no engine change). Add Eaten by Piranhas JSON
   (chosen-color + chosen-creature-type + remove all abilities —
   "remove all abilities" is the **next** multi-lane, deferred
   to lane 54). The chosen-color and chosen-creature-type parts
   ride lane 52; "remove all abilities" requires a schema arm
   for `loses_all_abilities: true` or equivalent and is the next
   multi-lane blocker.
3. **Lane 54 — "remove all abilities" static + Eaten by Piranhas
   completion**: static that strips the enchanted / enchanted-self
   card's abilities. This is `Witness Protection` style (`effect
that changes name, colors, and creature types` + `remove all
abilities` + `mana value 1`). Lane 54 ships the schema arm +
   engine arm + the chosen-creature-type-then-loses-abilities
   pattern + Eaten by Piranhas full script.
4. **Lane 55 — add color via static (Redcap Gutter-Dweller)**:
   `StaticSchema.affects.add_color: "W" | "U" | "B" | "R" | "G"`
   or `"chosen"`. Redcap Gutter-Dweller-style grants on chosen-color
   filtering. Knocks `affects.add_color` / `affects.add_subtype`
   / `affects.add_keyword` (parallel family) off the "Out of scope"
   list — see lanes 56 + 57 for the keyword and selected-subtype
   halves (these can ship together or in order).

   **Out of scope, but tracked** (these are explicitly deferred per
   the handoff's "Don't ship multi-lane schema changes" rule until
   the Adaptive Automaton type-change work is done):

5. **Lane 56 (optional)** — additional costs (sacrifice/pay)
   (`additionalCosts` schema extension; tracks Louisoix's Sacrifice,
   Claws Out, etc.).
6. **Lane 57 (optional)** — affinity / cost reduction (kicker-style
   cost reduction engine; tracks Claws Out, Dragonlord's Servant,
   Archmage of Runes, Mocking Sprite, Bolt Bend, Arcane Epiphany).
7. **Lane 58 (optional)** — granting triggered abilities to other
   cards (Fake Your Own Death, Undying Malice; intersects the
   layer system and the trigger pipeline).
8. **Lane 59 (optional)** — replacement effect for death
   (`if X would die this turn, instead exile it`; needs the
   replacement-effect engine from CR 614).
9. **Lane 60 (optional)** — "you may" optional trigger / effect
   (optional effect semantics across many ops).
10. **Lane 61 (optional)** — `casting spells from exile / graveyard`
    (zone-transition for cast-from-non-hand; tracks Muldrotha,
    Tinybones).
11. **Lane 62 (optional)** — `stun / finality counters` (counter-type
    extension to the `Counter` schema).
12. **Lane 63 (optional)** — token creation with embedded static
    (an `embedded static: StaticSchema` field on
    `CreateTokenSchema`, parallel to the Aura schema).
13. **Lane 64 (optional)** — copying a permanent (`Self-Reflection`,
    Rite of Replication, Extravagant Replication; new
    `CopyPermanent` op with P/T + keyword snapshot).
14. **Lane 65 (optional)** — abilities requiring `X spent on other
spells` (`The Prima Vista`; engine needs `manaSpentThisTurn`
    tracking per spell type).

The loop is **done** when all of lanes 52–55 are either shipped
or marked multi-lane blockers with a paragraph in
`docs/card-scripts/wave4-blockers.md` documenting why. After
those four ship, lanes 56+ are independent and can be attacked
in priority order in a follow-up Wave.

## Source of truth

- `docs/card-scripts/wave4-blockers.md` is the canonical blocker
  list. Read it for the **process** and the previous loop's
  structural patterns; this prompt is for the **next** loop,
  not a do-over.

- `docs/card-scripts/drafts/fdn.md` is the unshipped-cards
  index. The drafter list confirms which cards ride each lane:

  - Adaptive Automaton → lane 52 (anthem half already shipped
    in lane 45 PR #2715; lane 52 adds the type-change half).
  - Banner of Kinship → already shipped partially (anthem half
    in Wave 4.7 lane 45 PR #2715; the fellowship-counter entrance
    ("enters with a fellowship counter for each creature you
    control of the chosen type") is a separate multi-lane
    blocker — `enters_with_counters_per_match: chosen_subtype`,
    deferred).
  - Eaten by Piranhas → lane 53/54 (chosen-color + chosen-creature-type
    - remove all abilities).
  - Infernal Vessel → future lane (chosen creature type + color
    / keyword transforms; rides the same family as lane 52).
  - Redcap Gutter-Dweller → lane 55 (add color via static; "cannot
    block" is the trigger condition, "add static to other cards"
    is the wider lane).

  - Issues `#2614` (drafter list plan work) and `#2708` (chosen-
    name work, fully shipped in lanes 49 + 50) are the prior
    related threads.

- `src/lib/game-state/card-scripts/schema.ts` is the one place
  for new schema fields. The chosen-color / chosen-subtype /
  chosen-name sentinels live in their respective `affects.*`
  arms; lane 52 adds `affects.add_creature_type` in the same
  shape (string literal or `"chosen"` sentinel).

- `src/lib/game-state/keyword-actions/scripted-statics.ts` is
  the home for the `staticAffects` predicates. The chosen-color
  anthem (lane 40), chosen-subtype anthem (lane 45), and
  chosen-name block (lane 50) are the three closest precedents
  for how lane 52's "I am the chosen type in addition to my
  other types" should compose.

- `src/lib/game-state/layer-system/index.ts` is the engine that
  actually computes layered P/T and type-line overlays. The
  chosen-type anthem reads `subtypesOf(target)` to decide
  whether the anthem applies; the chosen-type addition
  (`add_creature_type` static) needs to ADD the new subtype
  to the source's `subtypes` field at refresh time so that
  OTHER statics reading `subtypesOf(source)` (e.g., the
  chosen-subtype anthem matching the source against itself)
  see the addition. The chosen-eviction-at-tombstone problem
  (when the source leaves the battlefield, the chosen-name
  reference is unreferenced — that's fine; when the source
  changes zones mid-game, the temporary addition is dropped
  — that's also fine; the trickier edge case is when the
  "chosen type" itself becomes invalid in some way) is **not**
  block for the v1 single-lane piece: the chosenCreatureType
  is stamped on `resolveEnterChoice` and lives on the source's
  `CardInstance` for the rest of the game. The chosen-eviction
  is needed only for Eaten-by-Piranhas-style "remove all
  abilities" effects (lane 54) and is deferred there.

- `src/lib/game-state/types/cards.ts` already carries
  `chosenCreatureType: string | null` (lane 44 PR #2714). The
  Adaptive Automaton's anthem half already reads this; lane 52
  adds an engine path that GROWS `subtypes` with this value.

- `docs/onboarding.md` test-count block: `706 / 13907
(13900 passed + 7 skipped)` is the Phase 2 final state going
  forward.

## Priority order

Process in this order. **Lane 52 first** — Adaptive Automaton's
type-change half is the smallest self-contained piece and
multiple follow-up lanes (53, 54, 55) depend on its schema
arm and engine arm. **Lane 53 second** — completes Adaptive
Automaton's full oracle AND ships a partial Eaten by Piranhas
JSON (without remove-all-abilities) so the chosen-color and
chosen-creature-type plumbing lands in one reviewable chunk.
**Lane 54 third** — the only remaining multi-lane piece on
the "change creature types" blocker. **Lane 55 fourth** — the
related `add_color` family for Redcap Gutter-Dweller.

If a lane proves impossible, skip to the next and document
why in `docs/card-scripts/wave4-blockers.md`. The handoff
says: "If even the smallest prerequisite is blocked, that
means the engine changed and the loop should be paused for
human review before continuing."

The four priority lanes reuse **52+** numbering so they don't
collide with the closed-out lanes 43–51.

1. **Lane 52 — `add_creature_type` static arm + Adaptive
   Automaton engine piece**: New
   `StaticSchema.affects.add_creature_type` arm: literal
   creature-type string OR the `"chosen"` sentinel
   (parallel to `affects.color: "W"|"U"|"B"|"R"|"G"|"chosen"`
   and `affects.subtype: "chosen"`). Schema refine must allow
   either the new field OR `chosen_name_block` (lane 50) AS a
   stand-alone arm (no P/T, no keywords — the static might be
   a pure type-changer). The engine arm in
   `keyword-actions/scripted-statics.ts`:
   - When `source === target` (the chosen-type adds-to-self
     case for Adaptive Automaton), the static returns true if
     `source.chosenCreatureType` is non-null.
   - When `source !== target` (the Eaten by Piranhas /
     Infernal Vessel case is rarer — those typically use
     `target: "self"` semantics or an Aura-style wrapper),
     the static returns false in v1; lane 54 picks up the
     Aura-style generalization.

     The "self-only target" v1 is bounded and ~40-60 LOC: the
     schema arm, the refine update, a `staticAffects`
     branch, and a new test.

     `refreshScriptedStatics` must then commit the new
     subtype into the source's effective subtype read at the
     next layer pass. Two approaches (pick the cleaner one,
     no second lane needed):

     - **(a)** Stamp a `chosenTypeAdditions: string[]` field on
       `CardInstance` that the engine adds to `subtypesOf(source)`
       in the `subtypesOf` helper or a
       `getEffectiveSubtypes(card)` wrapper. Cleanest for
       cross-static reads; smallest diff at ~20 LOC.
     - **(b)** Mutate `source.cardData.type_line` in place at
       refresh time. Brittle — the `cardData` field is the
       "printed" type line and many call sites cache it.
       **Avoid.**

     Choose (a). The chosen-eviction-at-tombstone problem
     (when the source leaves the battlefield while the
     addition is still active — should the temporary addition
     drop or persist into the graveyard? Answer: drop, since
     `subtypes` is irrelevant in non-battlefield zones) is
     naturally handled by `chosenTypeAdditions` being a
     battlefield-zone-only field.

     Sample card: this lane does **not** ship Adaptive Automaton's
     JSON update (lane 53 does that). Lane 52's sample is a
     synthetic `Test Adaptive Automaton Engine (lane 52)` in
     the test harness, mirroring the lane 49 test pattern.
     The schema's `add_creature_type` field accepts
     `string | "chosen" | undefined`; a test exercising both
     shapes validates the field and the engine arm.

2. **Lane 53 — Adaptive Automaton full script + Eaten by
   Piranhas partial script**: drop the "anthem only" JSON
   limitation comment on Adaptive Automaton's
   `adaptive_automaton.json`. Update the JSON to include
   the type-change static alongside the anthem. Add an
   `eaten_by_piranhas.json` with `enter_choice: { kind:
"color" }` + `enter_choice: { kind: "creature_type" }`
   — wait, the schema allows only one `enter_choice.kind`
   per script. The Eaten by Piranhas oracle is "as this
   enters, choose a color and a creature type" — that's
   **two enter choices on the same ETB**, which is a
   separate multi-lane (`multiple enter_choices`) not in
   the Wave 4.8 priority. Lane 53 therefore:

   - Updates `adaptive_automaton.json` (chosen-creature-type
     anthem + chosen-creature-type addition, full oracle).
   - Adds the **Aura-style** "enchanted creature is the
     chosen type" wrapper only IF lane 52's `add_creature_type`
     arm extends to `target: "self" and source: "self"` for
     auras. v1 (lane 52) does NOT do that. Lane 53 does NOT
     ship Eaten by Piranhas (deferred to lane 54).
   - Does NOT open a "multiple enter_choices" lane (deferred
     indefinitely; no real sample card can ride that until
     the schema arm exists).

     **Net scope:** Adaptive Automaton full oracle JSON +
     dedicated test. Bounded and ~30 LOC.

3. **Lane 54 — "remove all abilities" static (Witness Protection
   / Eaten by Piranhas)**: New schema arm
   `StaticSchema.affects.removes_all_abilities: true` (parallel
   to the lane 50 chosen_name_block). When true on a static,
   `staticAffects` returns true for the source's current or
   a chosen target; the engine stamps a `losesAbilities: true`
   flag (or removes the keywords/activated/triggered ops) on
   the affected card. The Aura-style wrapper lets Witness
   Protection ("enchanted creature loses all other abilities")
   and Eaten by Piranhas' "enchanted creature has no abilities"
   ride the same path. Lane 54 ships:

   - Schema: `affects.removes_all_abilities` arm.
   - Engine arm in `scripted-statics.ts` (predicate pass-through).
   - Engine arm in some new helper or extension of
     `refreshScriptedStatics` that mutates the target's
     effective abilities based on `losesAbilities` flags.
   - `eaten_by_piranhas.json` with `aura:` + `enters_with_aura`
     — wait, auras require `target: "creature"`. The chosen-color
     - chosen-creature-type + remove-all-abilities pattern
       requires `multiple enter_choices` OR a single enter_choice
       that names a "color, creature type" pair (a new arm) OR a
       lane 54 implementation that takes the chosen-color and
       chosen-creature-type from a different source. Given the
       schema doesn't currently support either, lane 54 ships
       only Witness Protection (single-target loses-all-abilities,
       no chosen-type addition) — a one-card sample to anchor
       the schema arm. Eaten by Piranhas full script needs the
       "multiple enter_choices" or "enters with chosen color +
       chosen creature type" arm (separate multi-lane, deferred).

   Net scope: ~80-150 LOC for `removes_all_abilities` + Witness
   Protection + tests.

4. **Lane 55 — `add_color` static (Redcap Gutter-Dweller)**:
   New `StaticSchema.affects.add_color` arm: `"W"|"U"|"B"|"R"|"G"|"chosen"`.
   `staticAffects` reads `source.chosenColor` for the `"chosen"`
   sentinel and stamps `colors: [...printedColor, chosenColor]`
   on the target. Side concern (does this change the target's
   `cardData.colors` or a separate `effectiveColors` field?) —
   pick the `effectiveColors` field (`chosenColorAdditions: ColorLetter[]`),
   matching lane 52's `chosenTypeAdditions` pattern.

   Redcap Gutter-Dweller's "create a red Treasure token" can
   ride `CreatePredefinedToken` (shipped lane 2544); the
   "Goblins you control have menace when this permanent has
   3+ counters" trigger requires a counter-based trigger gate
   (also deferred). Lane 55 ships ONLY the `add_color` static
   arm + a sample card (synthetic or Diamond Mare variant)
   - tests. Redcap Gutter-Dweller JSON is deferred.

   Net scope: ~30-50 LOC. The chosen-eviction-at-tombstone
   problem is the same shape as lane 52's and is naturally
   handled by `chosenColorAdditions` being battlefield-only.

If a lane proves bigger than its bounded scope, back out and
document in `wave4-blockers.md` per the handoff's process
rule. None of the four priority lanes is expected to span
this; if any one does, that's a process flag and the
follow-up issue should be opened immediately.

## Process (mandatory, identical to Wave 4 / 4.5 / 4.6 /

4.7 / 4.7 follow-up / 4.7 phase 2)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add
/tmp/opencode/wave48-lane<N>-<slug> -b
<type>/<scope> origin/main` where `<N>` starts at 52 and
   `<slug>` is kebab-case, min 10 chars. `ln -s
/home/alex/Projects/planar-nexus/node_modules
/tmp/opencode/wave48-lane<N>-<slug>/node_modules` so
   test/lint/typecheck skip a fresh install. Verify with
   `ls /tmp/opencode/wave48-lane<N>-<slug>/node_modules/.bin/jest`.

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
     one place for new fields. Lane 52 adds
     `affects.add_creature_type` (string | "chosen"); the
     schema refine needs the same `losesAbilities-like`
     allow-list that lane 50 introduced for `chosen_name_block`
     (no power/toughness/keywords/X required when the arm is
     `add_creature_type` AND the source adds the type to
     itself via `addCreatureTypeToSelf: true` — a field
     flag that mirrors the chosen-name-block's
     "meta-static" pattern). See lane 50's
     `chosen_name_block` for the existing pattern.
   - **Engine**: For lane 52,
     `src/lib/game-state/keyword-actions/scripted-statics.ts`
     needs a new branch in `staticAffects` for
     `affects.add_creature_type === "chosen"` with
     `source === target` semantics; a new engine arm in
     `refreshScriptedStatics` (or a new helper called from
     it) reads `source.chosenCreatureType` and writes to
     `CardInstance.chosenTypeAdditions: string[]`. **Do
     not mutate `cardData.type_line` in place** — see
     priority note above for why.
   - **Sample card**: lane 52 ships **no JSON** (per the
     handoff: the Adaptive Automaton JSON update rides
     lane 53). Lane 52 uses a synthetic
     `Test Adaptive Automaton Engine (lane 52)` script
     registered in the test harness. Lane 53 ships the
     real `adaptive_automaton.json` update. Lane 54
     ships `witness_protection.json`. Lane 55 ships no
     JSON (uses synthetic script) — the
     `Redcap Gutter-Dweller.json` rides a follow-up that
     also has the counter-based trigger gate.

4. **Run checks (in the worktree)**:
   - `PATH="$PWD/node_modules/.bin:$PATH" npx tsx
scripts/build-card-script-index.ts` (regenerates the
     index — required when adding a new card JSON, like
     witness_protection.json in lane 54 and
     adaptive_automaton.json update in lane 53).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm test --silent`
     (full suite — must be all green; the AI
     `forge-gate`/`forge-selfplay`/`expert-agent` "is
     deterministic for a seed" flake is known — re-run
     once if it hits, then move on).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
typecheck` (must be clean).
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run lint`
     (0 errors; warnings OK).
   - `PATH="$PWD/node_modules/.bin:$PATH" node
scripts/check-engine-size-budget.mjs` (must pass;
     budget currently 2100 lines for schema.ts after the
     lane 50 chosen_name_block bump, measured 2066).
     The Wave 4.7 phase 2 loop noted 2050 → 2100 was a
     one-time bump; if any Wave 4.8 lane adds more than
     ~50 lines to schema.ts we may need another bump.
     Prefer reusing existing scaffolding (the chosen-X
     sentinel pattern is the precedent for sharing an
     allow-list arm across lanes). Lane 52 adds the
     smallest single-line schema field; lane 53 changes
     only the JSON; lane 54 adds a single boolean arm;
     lane 55 adds a single enum arm. None of these
     individually is large.
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run
ratchet:test-count` (rewrites anchored doc blocks
     when test count changes).

5. **Commit**: `git add -A && GIT_AUTHOR_NAME="Planar
Nexus Agent" GIT_AUTHOR_EMAIL="agent@planar-nexus.local"
GIT_COMMITTER_NAME="Planar Nexus Agent"
GIT_COMMITTER_EMAIL="agent@planar-nexus.local" git
commit -F COMMIT_MSG.txt`. Then `git rm --cached
COMMIT_MSG.txt && git commit --amend --no-edit && rm
COMMIT_MSG.txt`. Then `git push --force-with-lease
origin <branch>`. The Wave 4.7 phase 2 loop learned
   the hard way: if you `git commit` without
   `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` the husky
   pre-commit hook uses the global git config and the
   commit shows up under the wrong author. Use the env
   vars explicitly.

6. **Open PR**: write `PR_BODY.txt`, `gh pr create
--title "<type>(<scope>): <one-line>" --body-file
PR_BODY.txt --base main --head <branch>`, then `gh pr
merge <PR> --squash --delete-branch --admin` once checks
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
   (mid-ratchet) and never completes, fall back to `npx
jest --listTests | wc -l` for the suite count and a
   before/after `jest <affected paths>` delta on `main`
   vs your branch for the test case count.

8. **Cleanup**: exit the worktree directory, then `git
worktree remove /tmp/opencode/... --force && git branch
-D <branch>`.

## Conventions (carried from prior loops)

- **Branch**: `<type>/<scope>` (lowercase, kebab-case,
  min 10 chars). `<scope>` is the lane's punchy name
  (e.g. `add-creature-type-static`,
  `adaptive-automaton-full-oracle`,
  `remove-all-abilities-static`,
  `add-color-via-static`).
- **Commit subject**: lower-case, min 10 chars, type from
  `feat fix docs style refactor test chore revert`.
- **Reference #2594 follow-up** in the commit body and
  the PR body so the cross-references stay tight. For
  lane 52, also reference `#2708 phase 2` (closes one
  of the remaining items in the multi-lane done
  summary); for lane 53, reference `#2614 plan work`;
  for lane 54, reference `#2614 plan work`; for lane 55,
  reference `#2614 plan work`.
- **Conventional Commits**. Never check in `COMMIT_MSG.txt`
  or `PR_BODY.txt`. The amend flow re-fights a phantom
  index entry if either file slips into a commit; use the
  `git commit -F COMMIT_MSG.txt` + immediate
  `git rm --cached COMMIT_MSG.txt && git commit --amend
--no-edit && rm COMMIT_MSG.txt` pattern before pushing.
- **Test count**: ratchet in the same commit.
  `test-count-docs-guard` re-measures live Jest and fails
  on any drift in `docs/onboarding.md` or
  `docs/TEST_VIDEO_FIXTURES.md`.
- **Engine-size budget**: 2100 lines for `interpret.ts`
  (not relevant here — schema.ts is the file that grew
  in lane 50; current measured 2066). Going over 2100
  again requires another budget bump — prefer reusing
  existing scaffolding. The chosen-X arm family
  (`color`, `subtype`, `name`, `add_creature_type`,
  `add_color`) all share the same refine shape and can
  grow the file linearly if too many fields land; budget
  accordingly.
- **Pre-commit hook** runs `eslint --fix` → `tsc
--noEmit` → `prettier --write` on staged
  *.{ts,tsx,md,json,...}. A failing typecheck blocks the
  commit; run typecheck before staging.
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
  known order-dependent flake on `main`; if a CI run
  shows only that test failing, `gh run rerun --failed`
  is the right move (do NOT amend the lane).
- **Turn budget: 40 turns per lane max** (per
  `AGENTS.md` §Turn Budget). If a single lane exceeds
  this, it's too big — back out, document, and pick a
  smaller one.

## Multi-lane blockers (skip and document if you can't ship them)

These are explicitly out of scope for this wave per the
Wave 4.5 handoff's "Don't ship multi-lane schema changes"
rule and the Wave 4.7 follow-up loop's "no more than one
schema arm + one op + one card per lane" principle. The
Wave 4.8 lanes 52–55 chip away at the "change creature
types" / "ability granting color or type or keyword via
static" multi-lane blockers. The remaining items below
are explicitly preserved for a future Wave:

- **Copying a permanent** (Self-Reflection, Rite of
  Replication, Extravagant Replication) — needs a new
  `CopyPermanent` op with P/T + keyword snapshot.
  ~400–700 LOC.
- **Granting triggered abilities to other cards** (Fake
  Your Own Death, Undying Malice) — multi-lane because
  it intersects the layer system and the trigger
  pipeline.
- **Replacement effect for death** ("if X would die this
  turn, instead exile it") — needs the
  replacement-effect engine (CR 614). Multi-lane.
- **Multiple enter choices on a single ETB** — needed for
  Eaten by Piranhas' "choose a color and a creature type".
  Schema requires a second `enter_choice` arm or a
  "compound kind" pattern. Multi-lane.
- **Affinity / cost reduction** (Claws Out, Dragonlord's
  Servant) — kicker-style cost reduction engine.
  Multi-lane.
- **"You may" optional trigger / effect** — needs
  optional effect semantics across many ops.
  Multi-lane.
- **Abilities granting KEYWORD via static** — parallel
  to `add_color` (lane 55). Add `add_keyword: string`
  arm. Single-lane piece; could ship as lane 56 (post-
  Wave 4.8 follow-up if desired).
- **Abilities requiring X spent on other spells** (The
  Prima Vista) — engine needs `manaSpentThisTurn`
  tracking per spell type.
- **Casting spells from exile / graveyard** (Muldrotha,
  Tinybones) — engine needs zone-transition for
  cast-from-non-hand.
- **Token creation with embedded static** — needs an
  embedded `static: StaticSchema` field on
  `CreateTokenSchema` (parallel to the Aura schema).
- **Stun / finality counters** — needs a counter-type
  extension to the Counter schema.
- **Additional costs (sacrifice/pay)** (Louisoix's
  Sacrifice) — needs a top-level `additionalCosts`
  schema extension. Multi-lane.

Document any new blockers discovered mid-loop in
`docs/card-scripts/wave4-blockers.md` with: gap, blocker
reason, suggested follow-up issue number.

## State at session start

- **HEAD**: `76df5b1c` (Wave 4.7 phase 2 loop done summary
  squash, PR #2722-style direct commit).
- **706 suites / 13907 cases (13900 passed + 7
  skipped)**. This is the Wave 4.7 phase 2 final
  state; lanes 52–55 add to it, they don't restart from
  Wave 4.7 follow-up.
- **Lint 0 errors, typecheck clean.**
- **Engine-size budget**: 2100 lines for schema.ts
  (currently 2066). Lane 52 adds the smallest single-
  line schema field; lane 53 changes only the JSON
  (no schema change); lane 54 adds a single boolean
  arm; lane 55 adds a single enum arm. None of these
  individually is large.
- **Working directory**:
  `/home/alex/Projects/planar-nexus` (clean).
- **No active worktrees** (Wave 4.7 phase 2 cleanup
  removed all four).
- **Open issues relevant to this loop**: #2614 (drafter
  list plan work — covers Adaptive Automaton type-change
  full scope, multiple enter choices, etc.); #2708 phase
  2 fully closed (lanes 49 + 50 shipped in PRs #2719 +
  #2721); #2614 follow-ups may need fresh issues for
  lane 52's chosen-creature-type addition alone vs the
  Adaptive Automaton full oracle.

## Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 706 / 13907 green
# then start lane 52 (chosen-creature-type addition, #2614 follow-up) per the Process section
# lanes 53 (Adaptive Automaton full oracle), 54 (remove all abilities), 55 (add_color static) follow without stopping
```

End each lane with: `git log --oneline -1` on main
showing the new lane's commit, and `grep "Test suites"
docs/onboarding.md` showing the bumped numbers. If
those two checks pass, you're ready for the next lane
immediately.

## Done definition for the loop

When all four priority lanes (52, 53, 54, 55) are
either shipped or marked multi-lane blockers (with a
paragraph in `wave4-blockers.md` documenting why),
append a Wave 4.8 loop done summary at the bottom of
`docs/card-scripts/wave4-blockers.md` documenting the
shipped lanes, the blocked gaps with their #2614 plan
work references, and a fresh test-count snapshot.
Then stop.

If even lane 52 (the smallest prerequisite) is blocked,
that means the engine changed since Wave 4.7 phase 2
loop and the loop should be paused for human review
before continuing.

## Process observations carried from previous loops (read these first)

- The AI `forge-gate`/`forge-selfplay`/`expert-agent`
  "is deterministic for a seed" test is a known
  order-dependent flake on main. If a CI run shows only
  that test failing, `gh run rerun --failed` is the
  right move — do NOT amend the lane.
- `ci-wait` can return `FAILED` on a freshly-opened PR
  with all checks still pending. Wait a second call to
  `ci-wait` to get a real verdict.
- `npm run ratchet:test-count` is reliable; run it in
  the same commit as any test count change. **If it
  hits the AI flake mid-ratchet**, fall back to manual
  count updates (see step 7 above).
- The handoff's process rule on `git worktree remove`:
  the `--delete-branch` flag on `gh pr merge` only
  deletes the remote branch. The local worktree
  directory must be removed manually after exiting it
  (`git worktree remove ... && git branch -D ...`).
- Wave 4.7 phase 2 loop new note: the
  `enter_choice` engine arm in
  `keyword-actions/enter-choice.ts` has a
  `resolveCardIdForChoice` fallback that scans the
  battlefield for an unchosen card if the choice's
  `stackObjectId` isn't set. The chosen_name flow
  writes `stackObjectId: cardId` directly so the
  fallback is defensive only. Lane 52's
  chosen-creature-type addition flows through the
  same `enter_choice` resolver (already shipped in
  lane 44 PR #2714); nothing to add to it.
- Wave 4.7 phase 2 loop new note:
  `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` env vars on the
  commit command prevent the husky pre-commit hook from
  picking up the wrong author. The `-c user.name=...`
  form also works but the env-var form is more reliable
  when the commit is being re-amended (the env vars
  re-apply on the amend; the `-c` form does not).
- Wave 4.7 phase 2 loop new note: a partial Adaptive
  Automaton script (anthem half only, no type-change)
  is shipped today with a JSON-level comment
  documenting the limitation. Lane 53 drops that
  comment when the type-change half lands. Until
  then, the JSON itself is the canonical record of
  the partial-script pattern.
- Wave 4.7 phase 2 loop new note: the
  `chosen_color` / `chosen_creature_type` /
  `chosen_name` / `chosen_name_block` sentinels all
  follow the same scaffolding shape. **Lane 52's
  `add_creature_type` arm should reuse the same allow-
  list refinement path** that lane 50 introduced for
  `chosen_name_block` — both are "meta-statics" that
  have no P/T or keywords, so the existing refine that
  requires `power`/`toughness`/`keywords`/`X` must be
  extended to also accept `add_creature_type: true` as
  a stand-alone arm. **Do not** introduce a separate
  refinement path — copy the lane 50 pattern verbatim.
- Wave 4.7 phase 2 loop new note: the
  `keyword-actions/scripted-statics.ts` file grew by
  14 lines for lane 50's `chosen_name_block` arm.
  Lane 52's `add_creature_type` arm should land at a
  similar size (~15-25 LOC including the docstring).
  Lane 54's `removes_all_abilities` arm lands at
  roughly the same size. Lane 55's `add_color` arm
  parallels lane 40's chosen-color sentinel, ~10-20
  LOC.
- Wave 4.7 phase 2 loop new note: schema.ts went from
  2041 to 2066 lines (+25) after lane 50. The 2050 →
  2100 budget bump covers that. Lane 52–55 add their
  own arm fields (~5–10 lines each including JSDoc),
  keeping the file well under the new 2100 ceiling by
  the end of Wave 4.8. Even with all four shipping,
  the file lands at ~2110 — still under budget. **If
  the schema's growth accelerates, the handoff's
  process note applies: bump the budget again rather
  than fragmenting the chosen-X arm family.**
