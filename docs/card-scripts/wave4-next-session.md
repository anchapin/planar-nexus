# Wave 4 Card-Scripts Epic — Next Session Handoff

## Mission

Drive an aggressive, iterative loop: pick the **highest-impact, lowest-blast-radius** remaining lane from the gap list, ship it as a clean PR end-to-end, immediately pick the next one. Repeat until all remaining candidates are either shipped or require multi-lane schema work that needs explicit human scoping. **Don't stop between lanes unless CI fails or a lane needs human input.**

## Process (mandatory, same as Wave 4 handoff)

For each lane, in one uninterrupted flow:

1. **Worktree**: `git worktree add /tmp/opencode/wave4-lane<N>-<slug> -b feat/card-scripts-<slug> origin/main` (use `<N>` starting at 24; slugs kebab-case, min 10 chars).
   `ln -s /home/alex/Projects/planar-nexus/node_modules` into the worktree so test/lint/typecheck skip a fresh install.

2. **Implement**: schema → engine → sample card → dedicated test → ratchet. Keep blast radius small. Prefer one-card sample that exercises only the new schema/engine.

3. **Run checks** (in the worktree):
   - `PATH="$PWD/node_modules/.bin:$PATH" npx tsx scripts/build-card-script-index.ts` (regenerates the index)
   - `PATH="$PWD/node_modules/.bin:$PATH" npm test --silent` (full suite — must be all green)
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run typecheck` (must be clean)
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run lint` (0 errors; warnings OK)
   - `PATH="$PWD/node_modules/.bin:$PATH" npm run ratchet:test-count` (rewrites anchored doc blocks)

4. **Commit**: `git add -A && git -c user.name="Planar Nexus Agent" -c user.email="agent@planar-nexus.local" commit -F COMMIT_MSG.txt`, then `git rm --cached COMMIT_MSG.txt && git commit --amend --no-edit` if it slipped in. Then `git push --force-with-lease origin feat/card-scripts-<slug>`. `rm COMMIT_MSG.txt` after.

5. **Open PR**: write `PR_BODY.txt`, `gh pr create --title "feat(card-scripts): <one-line> (#2594 follow-up)" --body-file PR_BODY.txt --base main --head feat/card-scripts-<slug>`, then `gh pr merge <PR> --squash --delete-branch --admin` once checks pass. Branch deletion happens automatically via PR squash; the local worktree directory must be removed manually after exiting it.

6. **Conflict resolution** (if main moves during the lane): `git merge origin/main --no-edit`, then `git checkout --theirs docs/onboarding.md docs/TEST_VIDEO_FIXTURES.md && npm run ratchet:test-count && git add ... && git commit --no-edit && git push --force-with-lease origin <branch>`.

7. **Cleanup**: exit the worktree directory, then `git worktree remove /tmp/opencode/wave4-lane<N>-<slug> --force && git branch -D feat/card-scripts-<slug>`.

## Conventions

- Branch: `feat/card-scripts-<slug>` (lowercase, kebab-case, min 10 chars).
- Commit subject: lower-case, min 10 chars, type from `feat fix docs style refactor test chore revert`.
- Always reference `#2594` follow-up in body if the lane closes one.
- Conventional Commits. Never check in `COMMIT_MSG.txt` or `PR_BODY.txt`.
- Test count: ratchet in the same commit. The `test-count-docs-guard` CI step re-measures live Jest.

## Aggressive loop rules

- **Don't ask the user between lanes.** Pick the next gap autonomously and ship it.
- **Don't ship multi-lane schema changes** (e.g., granting triggered abilities, replacement effects, copying spells). Those need explicit human scoping and should be skipped with a paragraph-style note in this handoff file documenting why.
- **Lane is "done" only when**: CI green, PR merged, worktree removed, branch deleted, local main pulled and re-ratcheted.
- **If CI fails on a lane**: don't push; fix the lane. If the fix is unclear, document the failure in `docs/card-scripts/wave4-blockers.md` and skip to the next lane.
- **Turn budget**: 40 turns per lane max (per AGENTS.md §Turn Budget). If a single lane exceeds this, it's too big — back out, document, and pick a smaller one.

## Lane priority order (highest-impact, lowest-blast-radius first)

Process in this order unless a lane proves impossible; pick the smallest single-card gap that matches a real card from FDN/FIN:

1. **Lane 24: Add mana of any one color** (harness pattern: `colors: "any"` already exists; gate is "as this enters, choose a color" + static pump on chosen color + activated AddMana on chosen color. Pick the simplest card that uses `colors: "any"` if such a card exists with a single-feature limitation; else skip to 25.)
   - Drafter gap: "add one mana of any one color" (Heraldic Banner, etc.). `colors: "any"` is already supported; the gap is the "choose a color" state for **static** anthems ("creatures you control of the chosen color get +1/+0") and **activated** "Add one mana of the chosen color" — those need a `chosenColor` field. The static pump + dynamic chosen color is multi-lane work. **Skip if scope creeps; otherwise do just the static anthem + chosen-color field on a minimal FDN card.**
   - Real cards: Heraldic Banner (FDN #254), Banners (Hoof, of Kinship, etc.)
   - Approach: small extension `Static.affects: { color: "chosen_color" }` or similar; single card sample.

2. **Lane 25: Discard a variable amount** (Dragon Mage, FDN #621) — needs `Discard.amount` to compute dynamically (e.g., `Discard.amount: { from: "hand_size", offset: N }` or `Discard.amount: "X"`) and `Draw.who: "each_player"` extension.
   - Dragon Mage oracle: "Whenever this creature deals combat damage to a player, each player discards their hand, then draws seven cards."
   - Already-supported: `Discard.all: true` (lane 15) covers "discards their hand". Missing: `Draw.who: "each_player"` (currently `["you", "target_player"]`).
   - Approach: add `amount: z.union([xAmount, z.object({ from: z.literal("hand_size"), offset: z.number().int().optional() })])` to `DiscardSchema`, and extend `Draw.who` with `"each_player"`. Single card sample = Dragon Mage.
   - **Fallback**: if Dragon Mage needs too many `trigger.combat_damage_to_player` plumbing, ship just the `Draw.who: "each_player"` extension with a smaller sample that uses it.

3. **Lane 26: Threshold / morbid / raid conditions** (gap #6, 7 cards) — needs an `if_condition` or `condition` field on `TriggerSchema` and/or `EffectSchema`.
   - Sample card: pick the simplest one. Cackling Prowler (FDN, threshold: 7+ cards in graveyard) or Needletooth Pack (morbid) or Wardens of the Cycle (raid).
   - Approach: `TriggerSchema.if_condition: z.union([z.literal("threshold"), z.literal("morbid"), z.literal("raid")]).optional()` plus an `if_condition` evaluation step in the trigger pipeline that gates the trigger's fire based on the current game state.
   - **Fallback**: ship just `threshold` first; `morbid`/`raid` are follow-ups.

4. **Lane 27: ReturnFromZone with count > 1 on graveyard** (gap #10) — natural extension of lane 20's exile-multi-grave. The handoff says this is "likely small extension on lane 20's `count` field". The schema's `count` already exists; the engine currently reads only `target.targetId`. Add a sweep-style branch when `count > 1`, parallel to lane 20.
   - Sample card: pick a real card that returns multiple creatures from a graveyard to the battlefield. If none of FDN/FIN fit cleanly, ship the schema/engine with a minimal synthetic fixture and document the missing real-card sample.
   - Real candidates: Sanguine Indulgence (FDN, but only single-target), Raise the Past (FDN? not sure if exists), Macabre Waltz (FDN, but to-hand). Most "return all/multiple from graveyard" cards are sweeps already supported via `library_top`/`opponent_graveyard` patterns. **Verify carefully before committing to a sample card.**

5. **Lane 28: Copying a permanent as a token** (gap #2, 3 cards: Self-Reflection, Rite of Replication, Extravagant Replication) — needs `CopyPermanent` op with P/T + keyword snapshot semantics. **Likely too complex for a single lane; consider skipping and moving to 29.**

6. **Lane 29: Copy a spell with new targets** (gap #7, Pyromancer's Goggles, Teach by Example, Ether) — needs `CopySpell` op. Pyromancer's Goggles is a red-only mana rock with copy-spell trigger; the simplest is **Teach by Example** if it exists ("Copy target instant or sorcery spell. You may choose new targets for the copy."). Lane 9's `CopySpell` op exists for `cast` triggers; this lane extends it for activated and triggered abilities, plus new-targets picking.
   - **Likely too complex; consider skipping.**

## Multi-lane blockers (skip and document)

These gaps span multiple lanes or require deep engine work. Don't attempt them in this loop:

- **Replacement effect for death** (gap #3, #8) — "if X would die this turn, instead exile it" — replacement-effect engine. Mark as `#2614 plan work`.
- **Granting a triggered ability** (gap #6, Fake Your Own Death, Undying Malice) — script-triggers-on-other-cards engine. Mark as `#2614 plan work`.
- **Additional costs (sacrifice/pay)** (gap, Louisoix's Sacrifice) — top-level `additionalCosts` extension. Mark as `#2614 plan work`.
- **Copy spell / permanent / counters** (gap #2, #7, #9) — multi-lane script+EP.
- **Affinity / cost reduction** (gap, Claws Out, Dragonlord's Servant) — `kicker`-style cost reduction engine. Mark as `#2614 plan work`.
- **"You may" optional trigger / effect** (gap) — needs optional `effect` semantics.
- **Abilities granting color or type or keyword via static** (gap) — multi-card grant engine.
- **Abilities requiring X spent on other spells** (gap, The Prima Vista) — engine tracks `manaSpentThisTurn`.
- **Casting spells from exile / graveyard** (gap, Muldrotha) — engine zone-transition for cast-from-non-hand.
- **Token-creation with static abilities** (gap, Redcap Gutter-Dweller) — CreateToken with embedded static.
- **Stun counters** (FIN gap) — counter type extension.
- **Finality counters** (FIN gap) — counter type extension.

Document any new blockers discovered mid-loop in `docs/card-scripts/wave4-blockers.md` with: gap, blocker reason, suggested follow-up issue number.

## State at session start

- HEAD: `86939b82` (lane 23, Heroes' Bane / PR #2677).
- 687 suites / 13738 tests passing (target floor after each lane: +N where N = lane test additions + auto-discovery + spillover from concurrent merges).
- Lint 0 errors, typecheck clean.
- Working directory: `/home/alex/Projects/planar-nexus` (clean).
- No active worktrees (none should exist after lane 23 cleanup).

## Quick-start checklist

```bash
cd /home/alex/Projects/planar-nexus
git pull --ff-only
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent  # verify 687 / 13738 green
# then start lane 24 (or whichever gap you picked) per the Process section above
```

End each lane with: `git log --oneline -1` on main showing the new lane's commit, and `grep "TEST_COUNT" docs/onboarding.md` showing the bumped numbers. If those two checks pass, you're ready for the next lane immediately.

## Done definition for the loop

When all priority-order lanes (1–4) are either shipped or marked as multi-lane blockers, write a final summary at the bottom of this file documenting the shipped lanes, the blocked gaps with their `#2614 plan work` references, and a fresh test-count snapshot. Then stop. Do not attempt priority-order lanes 5–6 unless all of 1–4 are shipped/blocked.

---

## Wave 4 Loop Progress

### Shipped

- **Lane 24 — SKIPPED**: Add mana of any one color. Genuinely multi-lane (350-550 LOC: `chosenColor` instance field + `Static.affects.color` schema/engine + `AddMana.chosen` arm + "as this enters, choose a color" plumbing). Per handoff rule: "skip and document". Heraldic Banner ships when the underlying schema work is scheduled as its own lanes.
- **Lane 25 — SHIPPED** (PR #2679, commit `087e1997`): `Draw.who / Discard.who / Mill.who` enums widened with `each_player`, mirroring the existing `each_opponent` precedent. Each dispatch arm iterates `state.players.keys()`. Sample card: Scrawling Crawler (FDN) using existing `upkeep` trigger event. Closes the "at the beginning of your upkeep, each player draws a card" drafter gap. Dragon Mage (FDN #621) remains blocked on a separate `deals_combat_damage_to_player` trigger lane, as flagged in the original handoff.

### Blocked / future lanes

- **Lane 26 — NEXT**: Threshold / morbid / raid conditions. `if_condition` field on `TriggerSchema`. Sample: pick the simplest of Cackling Prowler / Needletooth Pack / Wardens of the Cycle. Fallback: just `threshold`.
- **Lane 27**: `ReturnFromZone` with count > 1 on graveyard. Need to verify a real FDN/FIN card sample first.
- **Lane 28 / 29**: Copying permanent / copying spell — multi-lane, likely skipped.
- **Replacement-effect-for-death, granting triggered abilities, additional costs, casting spells from non-hand zones, stun/finality counters** etc.: all multi-lane script+EP. Mark as `#2614 plan work`.

### Test count snapshot at loop close

- 688 suites / 13746 tests passing (was 687 / 13738 at loop start; +1 suite / +8 tests from lane 25 + concurrent merge #2678).
- Lint 0 errors, typecheck clean, engine-size budget at limit (interpret.ts = 2000/2000).

- **Lane 26 — SHIPPED** (PR #2686, commit `83a5f553`): `intervening_if: z.string().min(1).optional()` added to `TriggerSchema`; plumbed through `scriptedTrigger` (abilities/parse.ts) to the engine's existing `evaluateInterveningIfClause` evaluator. Sample card: **Crypt Feaster** (FDN #59). Single trigger `event: "attacks" subject: "self"` + `intervening_if: "there are seven or more cards in your graveyard"`. Same plumbing unlocks **morbid** (`"a creature died this turn"`) and **raid** (`"you attacked with a creature this turn"`) trigger cards in a follow-up lane — those are now zero-schema-work one-line additions. Remaining gap for those lanes is identifying a real FDN/FIN sample card (Cackling Prowler/Wardens of the Cycle are morbid per the existing engine, but need scripted card coverage; raid cards need a sample).
- **Lane 27 — NEXT**: ReturnFromZone with count > 1 on graveyard (extension of lane 20's `count` field). Verify a real FDN/FIN sample card first; if none, ship schema+engine with a minimal synthetic fixture.
