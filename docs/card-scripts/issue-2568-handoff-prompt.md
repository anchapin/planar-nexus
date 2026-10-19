# Handoff prompt — issue #2568 (Aura follow-up)

> **Final entry in the loop order from the #2487 handoff (issue #2487 →
> #2559 → #2565 → #2562 → #2560 → #2568).** The next iteration depends
> on what the user schedules; the original loop is now closed.

## State at handoff

- Branch: `feat/issue-2568-aura-fdn-cards`
- Base: `main @ 2464050d`
- Work shipped in this PR:
  - 3 cards added as JSON:
    - `src/lib/game-state/card-scripts/cards/untamed_hunger.json`
      (FDN #529) — `{2}{B}` Aura. Static: 'Enchanted creature gets
      +2/+1 and has menace.' PT {power:2, toughness:1}, keywords
      ['menace'].
    - `src/lib/game-state/card-scripts/cards/unflinching_courage.json`
      (FDN #722) — `{1}{G}{W}` Aura. Static: 'Enchanted creature
      gets +2/+2 and has trample and lifelink.' PT {power:2,
      toughness:2}, keywords ['trample', 'lifelink'].
    - `src/lib/game-state/card-scripts/cards/feather_of_flight.json`
      (BLB) — `{U}` Aura + ETB draw trigger. Static: 'Enchanted
      creature gets +1/+0 and has flying.' PT {power:1, toughness:0},
      keywords ['flying']; plus triggers [{event: 'etb', subject:
      'self', effects: [Draw]}] mirroring Meltstrider's Resolve.
  - 1 test file:
    `src/lib/game-state/__tests__/issue-2568-aura-fdn-cards.test.ts`
    (3 it() blocks: registers+validates the Aura static shape
    [power/toughness/keywords] for each card, and the ETB trigger
    for Feather of Flight.)
  - Doc ratchet: 810 → 812 suites, 14830 → 14842 tests (14823 →
    14835 passed + 7 skipped). Net +6 tests = +3 it.each for the 3
    new cards (card-scripts.test.ts:176) + 3 dedicated tests.

- `src/lib/game-state/card-scripts/cards/index.generated.ts` is
  **gitignored** — never commit it. `npx tsx scripts/build-card-script-index.ts`
  regenerates it. (Now writing 342 scripts.)

## Aura op gotchas (re-learned this session)

1. **No `count_source` for PT modifiers.** `aura.static.power` and
   `.toughness` are **integer literals only**. Blanchwood Armor
   ("+1/+1 for each Forest you control") and similar count-driven
   PT Auras cannot be scripted. Needs a follow-up schema arm
   (`power_per_*`, `toughness_per_*`, or a generic `count_source`).
2. **No type-change arm.** "Is an Angel in addition to its other
   types" (Angelic Destiny) is not scriptable — schema has no
   `add_type` / `becomes_type` field.
3. **No control-change.** "You control enchanted permanent"
   (Confiscate) is not scriptable — schema has no `controller`
   modifier.
4. **`losesAbilities` exists** but it's _loss of all abilities_,
   not selective. Eaten by Piranhas also needs type rewrite +
   base P/T override (not separately supported).
5. **`restricts** (Attack / Block / Untap)** exist as booleans,
and `maxBlockers` exists as integer (e.g., "can't be blocked by
   more than one creature").
6. **Keywords must come from `EQUIPMENT_KEYWORDS`** enum at
   `schema.ts:246`. Adding a new keyword is a schema change; the
   next agent should expand the enum (existing keywords:
   `["flying", "first strike", "double strike", "trample",
   "lifelink", "menace", "hexproof", "reach", "shadow", etc.).
7. **Aura can coexist with triggers**: `Meltstrider's Resolve` is
   the existing pattern. Aura + `triggers: [etben draw]` is fine; one
   it() blocks for each.

## Out-of-scope FDN/FIN/MKM Auras (deliberately deferred)

These remain in the 15-card pile but are not scriptable:

- **Blanchwood Armor** (FDN) — PT = count of Forests you control
  (count-source arm gap)
- **Angelic Destiny** (M12) — type-change arm gap
- **Confiscate** (8ED) — control-change arm gap
- **Eaten by Piranhas** (FDN #507) — `losesAbilities` + type-rewrite
  - base P/T override (only `losesAbilities` is supported)
- **Due Diligence** (MKM) — ETB on another creature ('other than
  enchanted creature' target filter gap)
- **Stuck in Summoner's Sanctum** (FIN) — 'Enchanted creature can't
  untap' + damage trigger (separate arms: `restrictUntap` exists
  but the damage trigger on the aura itself needs the trigger
  engine wiring to know the enchanted creature took damage)

## Pitfalls (carry from #2565/#2562/#2560)

- `write` tool path resolution doesn't track shell cwd. If you
  `cd` into a worktree via `cd` and then use `write`, the file
  lands in the process cwd, not the worktree.
- `CardScriptSchema` is strict — only script-shape fields. **No
  `mana_cost`, `type_line`, `power`, `toughness` at the top level**
  of cards/*.json.
- `cards/index.generated.ts` is gitignored — regenerate via
  `npx tsx scripts/build-card-script-index.ts`, don't commit.
- **Test-count ratchet flakes on this machine.** Use the small-
  machine fallback: `npx jest --listTests | wc -l` for suites +
  measured `it()` deltas. Per #2822's lesson, **adding N card
  scripts auto-adds N it() blocks via
  `card-scripts.test.ts:176 it.each(files)`**.
- **CI's flake profile is stable**: ~14836 (1 forge-gate flake) is
  the typical CI baseline. For docs ratchet, capture the
  post-flake stable count.
- **Two commits per PR:** code+ratchet together; handoff doc as
  separate commit.
- Commit format: `feat|fix|docs(scope): subject (issue NNNN)`. No
  `[AI-assisted]` prefix — commitlint rejects it.

## Suggested scope for whatever is next

The handoff prompt's loop order ends at #2568. Beyond that, follow
the standard card-scripts cadence:

1. File follow-up issues for the four new schema gaps surfaced:
   - `count_source` for PT modifier (Blanchwood Armor family)
   - `add_type` / type-change arm (Angelic Destiny)
   - `control_change` (Confiscate)
   - `lose_all_abilities` + `base_pt` + `becomes_type` (Eaten by
     Piranhas)
2. For each new schema arm, ship 1-2 cards that exercise it.
3. Use the same two-commit pattern: code+ratchet, then handoff.

The pattern: do **not** try to ship all four schema arms in one
PR. Each arm needs its own schema PR + dedicated card scripts +
tests, then a follow-up handoff.

## Loop order status

Original loop from issue #2565-handoff-prompt.md:

- #2559 done
- #2565 done (PR #2818)
- #2562 done (PR #2819)
- #2560 done (PR #2822)
- #2568 done (this PR)

Open card-scripts ops remaining in issue #2487 (next agent's pick):

- Continue down #2487's full lane list (see `reports/op-frontier.md`)
- File follow-ups for the four schema gaps surfaced above
- Address the wider 38-issue list (FDN/BLB/FIN/MKM) for non-Aura
  card-scripts ops

## Known gaps (surfacing per handoff rules)

The four schema arms above are the highest-value next-lane work.
Each unblocks 1-3 cards from the deferred pile. Filing them as
separate issues with concrete FDN card targets makes them
atomically shippable.
