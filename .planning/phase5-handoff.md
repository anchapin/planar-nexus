# Phase 5 handoff — epic #2487 (card scripts as data)

## Status: ready to start Wave 1

PRs #2555 (scaffold) and #2556 (FDN batch) are merged into `main` at
`def4337e`. Phase 4 (frontier analysis) is committed (`80a5cc16`,
`5e34fdae`). All 10 op-issues are filed (#2559 through #2568). Five Wave 1
branches are created off `def4337e`.

## Wave 1 plan (5 lanes)

Per user direction: Wave 1 = 5 lanes (largest-unlock ops), Wave 2 starts
after Wave 1 lands. Each lane is "schema + 1–3 hand-checked cards" (user
amended Lane 1 to "schema + engine change + 3 hand-checked cards" once we
discovered the engine gap).

| Lane | Issue                                               | Branch                                     | Scope            |
| ---- | --------------------------------------------------- | ------------------------------------------ | ---------------- |
| 1    | #2559 (X-cost in triggers/activations)              | `feat/issue-2559-x-cost-triggered-effects` | engine + scripts |
| 2    | #2560 (ReturnFromZone graveyard→battlefield)        | `feat/issue-2560-return-from-graveyard`    | schema + scripts |
| 3    | #2561 (Equipment: attach, equip, equipped static)   | `feat/issue-2561-equipment`                | schema + scripts |
| 4    | #2562 (SearchLibrary: filter, destination, shuffle) | `feat/issue-2562-search-library`           | schema + scripts |
| 5    | #2563 (Flashback cost)                              | `feat/issue-2563-flashback`                | schema + scripts |

Wave 2 (#2564, #2565, #2566, #2567, #2568) starts after Wave 1 lands.

## Lane 1 implementation analysis (X-cost)

### What's already done (no PR needed for these)

- `xAmount = z.union([amount, X])`, `xCount`, `xPump` already in
  `src/lib/game-state/card-scripts/schema.ts` (PR #2553). Schema arms
  accept `"X"` in `DealDamage.amount`, `Draw.amount`, `GainLife.amount`,
  `LoseLife.amount`, `PutCounters.amount`, `Mill.amount`, `Pump.power` /
  `toughness`, `CreateToken.count`.
- `TriggerSchema.effects` and `ActivatedSchema.effects` reuse the same
  `effects = z.array(EffectSchema).min(1)`, so the schema already accepts
  `xAmount` / `xCount` / `xPump` on triggered and activated effects. No
  schema change needed.
- `resolveScriptedEffects` (in `src/lib/game-state/card-scripts/interpret.ts`)
  already reads `stackObject.variableValues?.get("X")` and passes it as
  `x` through to `applyEffect`. No interpreter change needed.
- The blocker is purely **engine-side**: the X value lives only on the
  StackObject while the spell is on the stack; it is dropped when the
  spell resolves and the card becomes a permanent. When a trigger later
  fires, `putTriggersOnStack` (and `activated.ts` for activated
  abilities) creates a fresh stack object with `variableValues: new Map()`,
  so the trigger's effects see X as 0.

### What Lane 1 needs to ship

1. **`src/lib/game-state/types/cards.ts`** — add `xValue?: number` to
   `CardInstance` (CR 107.3: X chosen at cast is preserved for the life of
   the spell; for a permanent, it lives on the permanent). Add a doc
   comment explaining why (X-cost triggers/activations need to look it up
   when the trigger goes on the stack).

2. **`src/lib/game-state/spell-casting/resolve.ts`** — at the spot where
   the spell becomes a permanent (currently also patches `CardInstance` for
   planeswalker loyalty init, around line 547–557), read
   `stackObject.variableValues?.get("X")` and stamp `xValue` onto the
   CardInstance. (Don't touch the stack zone change itself; only the
   `updatedCards.set(...)` block.)

3. **`src/lib/game-state/trigger-system/stack-ops.ts`** — when building
   the trigger stack object (line 17–32), look up the source card's
   `xValue` and seed `variableValues` with `new Map([["X", source.xValue]])`
   when the source has an `xValue` (X-cost permanent). Otherwise leave
   the empty Map.

4. **`src/lib/game-state/abilities/activated.ts`** — same fix at line 508
   for activated abilities.

5. **Three new `src/lib/game-state/card-scripts/cards/<card>.json` files**
   for FDN cards from the top-5 unlocked list:
   - `ashroot_animist.json` — `Landfall — ETB trigger; choose one of three X-cost modes`.
   - `krenko_mob_boss.json` — `Whenever another Goblin ETBs, create X 1/1 red Goblin creature tokens.` X reads from cast.
   - `ovika_enigma_goliath.json` — `Whenever you cast a creature spell, create X tokens equal to the mana value.` (Actually, Ovika reads from **the cast spell's** MV, not from its own X — so Ovika is a `cast`-trigger variant that needs `spell.mv` as the amount, not the source's X. Better pick **Wildwood Scourge** instead, which has `Whenever this creature ETBs, draw X cards.` where X is from itself.)

   Use `Wildwood Scourge` (clean X-pumped #2563 fits this too) or
   `Primal Might` for the third. Suggested picks:
   - Ashroot Animist (ETB trigger with X in modes)
   - Krenko, Mob Boss (X-cost trigger with token creation)
   - Wildwood Scourge (X-cost ETB trigger with X-amount draw)

6. **Tests** in
   `src/lib/game-state/card-scripts/__tests__/card-scripts.test.ts`:
   - Schema: trigger effects accept `"X"` in any op (extend the existing
     "validates X amounts" test).
   - Engine: end-to-end — cast a permanent with X=3, fire its X-cost
     trigger, assert the effect resolves with the right amount. Mirror
     the structure of the existing "Mind Spring draws X cards" test.
   - Hand-check the 3 scripted cards with realistic game states.

### Risk + scope notes

- The schema-side work in #2553 makes the existing schema test pass for
  trigger effects already; the new test should be explicit rather than
  required for green CI.
- The engine change touches the cast/resolve path (one read) and the
  trigger-stack path (one read on activation, one on trigger fire). Net
  ~6 LOC plus comments. Existing X-spell tests must keep passing.
- "Ovika" does **not** fit Lane 1's "X from cast" pattern (it uses the
  cast spell's MV). It is a separate spec (mana-value-based amount,
  related but different). If Land 1 needs a third card, prefer
  `Wildwood Scourge` (X-cost ETB) over Ovika.

### Lane 1 acceptance

- All three new scripted cards resolve with the correct X amount when
  the trigger fires.
- The existing X-spell tests (Mind Spring, Traumatic Critique) still
  pass.
- Test count ratcheted and committed in the same PR.
- `reports/op-frontier.md` updated (no new capabilities unlocked yet —
  this is plumbing; the frontier shifts after Wave 1 lands and the
  drafter re-runs).

## Pre-flight for the next session

1. `git checkout feat/issue-2559-x-cost-triggered-effects` (already exists).
2. Read this handoff, then read the five file regions flagged above.
3. Implement the four engine changes, the three card JSONs, the tests,
   then commit + push + open PR.
4. Land Lane 1 to `main`, then come back for Lane 2 (#2560).

## Phase 4 (already done, for context)

- `scripts/build-op-frontier.ts` and `reports/op-frontier.md`:
  - Capability grouping of every `docs/card-scripts/drafts/*.md`
  - Top 10 unlocked by card count, with CR + first-5-cards + design sketch
  - Re-runs idempotently.
- 10 GitHub issues opened on epic #2487:
  #2559–#2568, all labeled `enhancement, priority:high, rules-engine`.
- `.planning/standard-coverage-progress.md` Phase 4 section added.
