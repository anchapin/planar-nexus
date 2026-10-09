# Wave 4.5 Card-Scripts Epic — Next Session Handoff

## Mission

Drive the same aggressive, iterative loop Wave 4 used: pick the **highest-impact, lowest-blast-radius** remaining lane, ship it as a clean PR end-to-end, immediately pick the next. Repeat until all remaining candidates are either shipped or require multi-lane schema work that needs explicit human scoping. **Don't stop between lanes unless CI fails or a lane needs human input.**

Wave 4 shipped lanes 25 (each_player), 26 (intervening_if), 27 (count:"all"). Wave 4.5 is a follow-up because **lane 26's plumbing still has unused capacity** — the `intervening_if` field can already gate morbid ("a creature died this turn") and raid ("you attacked with a creature this turn") triggers today with **zero new schema work**; only a real sample card is missing. A small additional lane (Static `affects.color`) opens up many anthems too.

## Process (mandatory, identical to Wave 4)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add /tmp/opencode/wave45-lane<N>-<slug> -b feat/card-scripts-<slug> origin/main` (use `<N>` starting at 28; slugs kebab-case, min 10 chars).
   `ln -s /home/alex/Projects/planar-nexus/node_modules` into the worktree so test/lint/typecheck skip a fresh install.

2. **Implement**: schema → engine → sample card → dedicated test → ratchet. Keep blast radius small. Prefer one-card sample that exercises only the new schema/engine.

3. **Run checks** (in the worktree):
   - `PATH="$PWD/node_modules/.bin:$PATH" npx tsx scripts/build-card-script-index.ts` (regenerates the index)
   - `PATH="$PWD/node_modules/.bin:$PATH" npm test --silent` (full suite — must be all green)
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run typecheck` (must be clean)
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run lint` (0 errors; warnings OK)
   - `PATH="$PWD/node_modules/.bin:$PATH" node scripts/check-engine-size-budget.mjs` (must pass; budget is currently **2050** lines for `interpret.ts`)
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run ratchet:test-count` (rewrites anchored doc blocks)

4. **Commit**: `git add -A && git -c user.name="Planar Nexus Agent" -c user.email="agent@planar-nexus.local" commit -F COMMIT_MSG.txt`, then `git rm --cached COMMIT_MSG.txt && git commit --amend --no-edit` if it slipped in. Then `git push --force-with-lease origin feat/card-scripts-<slug>`. `rm COMMIT_MSG.txt` after.

5. **Open PR**: write `PR_BODY.txt`, `gh pr create --title "feat(card-scripts): <one-line> (#2594 follow-up)" --body-file PR_BODY.txt --base main --head feat/card-scripts-<slug>`, then `gh pr merge <PR> --squash --delete-branch --admin` once checks pass. Branch deletion happens automatically via PR squash; the local worktree directory must be removed manually after exiting it.

6. **Conflict resolution** (if main moves during the lane): `git merge origin/main --no-edit`, then `git checkout --theirs docs/onboarding.md docs/TEST_VIDEO_FIXTURES.md && npm run ratchet:test-count && git add ... && git commit --no-edit && git push --force-with-lease origin <branch>`. Resolve the ratchet numbers with `npm run ratchet:test-count` after the merge, not from the incoming snapshot.

7. **Cleanup**: exit the worktree directory, then `git worktree remove /tmp/opencode/wave45-lane<N>-<slug> --force && git branch -D feat/card-scripts-<slug>`.

## Conventions (carried from Wave 4)

- Branch: `feat/card-scripts-<slug>` (lowercase, kebab-case, min 10 chars).
- Commit subject: lower-case, min 10 chars, type from `feat fix docs style refactor test chore revert`.
- Always reference `#2594` follow-up in body if the lane closes one.
- Conventional Commits. Never check in `COMMIT_MSG.txt` or `PR_BODY.txt`.
- Test count: ratchet in the same commit. The `test-count-docs-guard` CI step re-measures live Jest.
- **Engine-size budget is currently 2050 lines for `interpret.ts`** (raised 2000→2050 in Wave 4 lane 27 with a documented rationale in `scripts/check-engine-size-budget.mjs` lines 25-35). Going over 2050 again requires another budget bump — prefer reusing existing scaffolding or splitting the new arms into a tiny helper to stay under 2050.
- **Pre-commit hook** runs eslint --fix → tsc --noEmit → prettier --write on staged `*.{ts,tsx,md,json,...}`. A failing typecheck blocks the commit; run typecheck before staging.
- **`PRE_COMMIT_HOOK` formatting:** markdown gets prettier'd; keep diffs small and don't fight the formatter.

## Aggressive loop rules (same as Wave 4)

- **Don't ask the user between lanes.** Pick the next gap autonomously and ship it.
- **Don't ship multi-lane schema changes** (Copying permanent/spell, granting triggered abilities to other cards, replacement effects for death, additional costs, casting spells from exile/graveyard, stun/finality counters, Muldrotha "cast from graveyard", Phlage/Prima Vista "X spent on other spells", token creation with embedded static, "you may" optional triggers). Those need explicit human scoping and should be skipped with a paragraph-style note in this handoff file documenting why.
- **Lane is "done" only when**: CI green, PR merged, worktree removed, branch deleted, local main pulled and re-ratcheted.
- **If CI fails on a lane**: don't push; fix the lane. If the fix is unclear, document the failure in `docs/card-scripts/wave4-blockers.md` and skip to the next lane.
- **Turn budget**: 40 turns per lane max (per AGENTS.md §Turn Budget). If a single lane exceeds this, it's too big — back out, document, and pick a smaller one.

## Lane priority order (highest-impact, lowest-blast-radius first)

Process in this order unless a lane proves impossible; pick the smallest single-card gap that uses only what's already plumbed or a one-line schema extension.

1. **Lane 28: Morbid scripted trigger (Cackling Prowler — FDN)**
   - Drafter gap: "morbid condition (if a creature died this turn) (3): Cackling Prowler, Needletooth Pack, Wardens of the Cycle."
   - **Lane 26 plumbing already covers this — zero schema changes needed.** Just need a sample card using `intervening_if: "a creature died this turn"`.
   - **Sample card**: Cackling Prowler. Oracle (CR text): "At the beginning of your end step, if a creature died this turn, put a +1/+1 counter on this creature." That's a single `event: "phaseEnds"` + single `PutCounters` effect with optional `intervening_if: "a creature died this turn"`.
   - Verify: `evaluateInterveningIfClause` already handles "a creature died this turn" (regex in `src/lib/game-state/abilities/evaluate.ts`). The `abilities/morbid.ts` module already tracks the per-player `creatureDiedThisTurn` flag.
   - Approach: add `cards/cackling_prowler.json` with one trigger; the existing `PutCounters` op already supports `target: "self"`. Test: fill controller's graveyard with 1+ creatures that "died", fire phaseEnds, assert a counter is added.

2. **Lane 29: Raid scripted trigger (Skyship Buccaneer — FDN)**
   - Drafter gap: "conditions ('if you attacked this turn') (3): Skyship Buccaneer, Gorehorn Raider, Storm Fleet Spy" + "raid condition (if you attacked this turn) (3): Midnight Snack, Alesha, Who Laughs at Fate, Perforating Artist".
   - **Lane 26 plumbing also covers this — zero schema changes needed.** `intervening_if: "you attacked this turn"` (or the more specific raid regex).
   - **Sample card**: Skyship Buccaneer. Oracle: "Raid — At the beginning of your end step, if you attacked this turn, put a +1/+1 counter on this creature." Single trigger, single `PutCounters` effect.
   - Verify: `evaluateInterveningIfClause` already handles "you attacked this turn" or "if you attacked" patterns (regex in `src/lib/game-state/abilities/evaluate.ts`).
   - Approach: same as lane 28 — add `cards/skyship_buccaneer.json` with a single trigger.

3. **Lane 30: Static literal color anthem (sub-piece of Lane 24)**
   - The full Lane 24 (Heraldic Banner) is multi-lane work — see Skipped below. **BUT** the smallest piece — `Static.affects.color: z.enum(["W","U","B","R","G"]).optional()` with literal color (no choice) — is a single-lane extension. ~30-60 LOC schema + ~10-20 LOC applicator.
   - **Sample card**: pick the simplest static-only color anthem from the drafter list — `Knight of Grace`, `Ghitu Lavarunner`, or `Kitesail Corsair`. These are "as long as" patterns (per the drafter list: "conditions (as long as) (3): Knight of Grace, Ghitu Lavarunner, Kitesail Corsair"). Knight of Grace is "First strike. White creatures you control get +1/+1." — that's a static P/T bump filtered by color literal. Perfect single-card sample.
   - Approach: extend `StaticSchema.affects` with `color: z.enum(["W","U","B","R","G"]).optional()`, then update `staticAffects` (`src/lib/game-state/keyword-actions/scripted-statics.ts`) to honor it. Cackling Prowler-style schedule.

4. **Lane 31: CopySpell on cast trigger (Pyromancer's Goggles — FDN)**
   - Drafter gap: "Pyromancer's Goggles" / "copy a spell" pattern. The engine already has `CopySpell` op (`src/lib/game-state/card-scripts/ops/copy-spell.ts` per lane 9). Pyromancer's Goggles is "Whenever you cast a red spell, copy it, you may choose new targets for the copy."
   - **Skip if the CopySpell op needs too much new plumbing** (original spec from Wave 4 listed this as a possibly-skip lane). Verify the current `CopySpell` op supports `cast` triggers with new-target re-selection.

5. **Lane 32: Static anthem with P/T + power-toughness scaling (Smaug-style)**
   - Drafter gap: many FDN/standard cards have "Creatures you control get +1/+1" patterns, often already-supported via existing static P/T without color filter. Verify against `docs/card-scripts/drafts/fdn.md` for any un-shipped anthems.

## Multi-lane blockers (skip and document)

Don't attempt these in this loop — each needs its own dedicated lane session:

- **Lane 24 (carried over from Wave 4)** — Heraldic Banner: needs `chosenColor` instance field + chosen-color Static anthem + chosen-color activated AddMana + "as this enters, choose a color" schema. ~350-550 LOC. Sub-piece (Lane 30 above) can ship the literal-color anthem independently.
- **Lane 28 from Wave 4 (Copying a permanent, lanes 28/29 in original numbering)** — Self-Reflection, Rite of Replication, Extravagant Replication. `CopyPermanent` op with P/T + keyword snapshot.
- **Lane 29 from Wave 4 (Copy a spell with new targets)** — Teach by Example. `CopySpell` op extension for activated/triggered abilities.
- **Replacement effect for death** — "if X would die this turn, instead exile it" — replacement-effect engine (CR 614). Mark as `#2614 plan work`.
- **Granting a triggered ability to other cards** — Fake Your Own Death, Undying Malice. Multi-lane script+EP.
- **Additional costs (sacrifice/pay)** — Louisoix's Sacrifice. Top-level `additionalCosts` extension.
- **Affinity / cost reduction** — Claws Out, Dragonlord's Servant. `kicker`-style cost reduction engine.
- **"You may" optional trigger / effect** — needs optional `effect` semantics across many ops.
- **Abilities granting color or type or keyword via static** — Redcap Gutter-Dweller style.
- **Abilities requiring X spent on other spells** — The Prima Vista (engine tracks `manaSpentThisTurn`).
- **Casting spells from exile / graveyard** — Muldrotha; engine zone-transition for cast-from-non-hand.
- **Token creation with static abilities** — embedded static on `CreateToken`.
- **Stun / finality counters** — counter type extension.

Document any new blockers discovered mid-loop in `docs/card-scripts/wave4-blockers.md` with: gap, blocker reason, suggested follow-up issue number.

## State at session start

- HEAD: `b2e47f1c` (Wave 4 done summary doc).
- 693 suites / 13778 tests passing (target floor after each lane: +N where N = lane test additions + auto-discovery + spillover from concurrent merges).
- Lint 0 errors, typecheck clean.
- Engine-size budget raised to 2050 (Wave 4 lane 27). Bump again ONLY when needed and document.
- Working directory: `/home/alex/Projects/planar-nexus` (clean).
- No active worktrees (none should exist after Wave 4 cleanup).

## Quick-start checklist

```bash
cd /home/alex/Projects/planar-nexus
git pull --ff-only
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 693 / 13778 green
# then start lane 28 (Morbid — Cackling Prowler) per the Process section above
# if lane 28 ships, immediately start lane 29 (Raid) without stopping
```

End each lane with: `git log --oneline -1` on main showing the new lane's commit, and `grep "TEST_COUNT" docs/onboarding.md` showing the bumped numbers. If those two checks pass, you're ready for the next lane immediately.

## Done definition for the loop

When all priority-order lanes (1–4) are either shipped or marked as multi-lane blockers, write a final summary at the bottom of this file documenting the shipped lanes, the blocked gaps with their `#2614 plan work` references, and a fresh test-count snapshot. Then stop. Do not attempt priority-order lanes 5+ unless all of 1–4 are shipped/blocked.

If even lane 1 (the no-schema-work morbid sample) is blocked, that means the engine changed since Wave 4 and the loop should be paused for human review before continuing.
