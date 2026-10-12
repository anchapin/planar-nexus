# Wave 4 card-scripts blockers

Discovered during Wave 4 and Wave 4.5. Each entry: gap, blocker reason,
suggested follow-up issue number. Entries marked **(W4.5)** were
identified during the Wave 4.5 loop (lanes 31/32).

## Multi-lane work (do not bundle into a single lane)

### Lane 24 carried over from Wave 4 (Heraldic Banner)

- **Gap**: "as this enters, choose a color; creatures of that color
  get +1/+1" (Heraldic Banner) and a chosen-color activated
  `AddMana` ability.
- **Blocker**: needs a `chosenColor` instance field on the
  permanent, a chosen-color Static anthem arm, a chosen-color
  activated `AddMana` arm, and "as this enters, choose a color"
  schema. ~350-550 LOC across schema + engine + tests.
- **Sub-piece already shipped**: Wave 4.5 lane 30 shipped the
  literal-color anthem (`affects.color: "W" | "U" | "B" | "R" | "G"`),
  which is the smallest unit of this gap (#2693).
- **Wave 4.6 follow-up (lanes 37 + 38)**: both lanes were
  attempted in the Wave 4.6 loop. Lane 37 (chosen-color anthem
  - "as this enters, choose a color") and lane 38 (chosen-color
    activated `AddMana` on top) are **both blocked** on a
    general-purpose "as this enters, choose a [thing]" mechanism
    in the ETB trigger pipeline. The current engine has only the
    shockland-specific "as this enters, pay 2 life" pattern, which
    hard-codes the choice type. A new `enterChoice` schema arm +
    a `waitingChoice` flow + a parallel `chosenColor` instance
    field are all required before either lane can ship. The handoff
    explicitly warned: "Skip lane 37 if the ETB choice flow forces
    a sweeping refactor of the ETB trigger pipeline." That case
    applies here — shipping lane 37 properly would require a new
    `enterChoice` engine arm, which is multi-lane work in itself.
- **Wave 4.7 follow-up**: lanes 39 (the prerequisite `enterChoice`
  engine arm), 40 (chosen-color anthem), and 41 (chosen-color
  AddMana) all shipped. See the "Wave 4.7 done summary" at the
  bottom of this file. **Heraldic Banner (FDN #532) is fully
  scripted** with all three pieces wired.

### Lane 28 from Wave 4 (Copying a permanent)

- **Gap**: Self-Reflection, Rite of Replication, Extravagant
  Replication. "Create a token that's a copy of [a permanent]."
- **Blocker**: needs a new `CopyPermanent` op that snapshots P/T,
  keywords, types, and (optionally) other static abilities. CR 707.2
  is the rules reference.
- **Suggested follow-up**: `#2614 plan work`.

### Lane 29 from Wave 4 (Copy a spell with new targets)

- **Gap**: Teach by Example. "Copy target instant or sorcery spell;
  you may choose new targets for the copy."
- **Blocker**: needs an extension to `CopySpell` to (a) let the
  trigger source a target the original spell targeted, and (b) let
  the script accept a `new_targets` field that flows into
  `copySpellOnStack(state, sourceId, newTargets)`. The underlying
  `copySpellOnStack` already accepts `newTargets` (CR 707.10d);
  only the schema + dispatch need wiring.
- **Suggested follow-up**: `#2614 plan work`.

### Lane 31 from Wave 4.5 (Pyromancer's Goggles) **(W4.5)**

- **Gap**: Pyromancer's Goggles. "Whenever you cast a red spell,
  copy it. You may choose new targets for the copy."
- **Blocker** is two-fold:
  1. No color filter on `cast` triggers. The current `TriggerSchema`
     `spell` enum has `any | creature | noncreature | instant_or_sorcery
| artifact | enchantment | multicolored` but no per-color entry.
     Adding a `cast_color` (or `colors: ["W", "U", ...]`) arm is a
     schema addition.
  2. The "you may choose new targets" path is a copy-with-retarget
     flow (different from lane 29 above — this one fires on a cast
     trigger, not a target trigger). Needs a `newTargets` field on
     `CopySpellSchema` that the dispatch in `copyTriggeringSpell`
     forwards into `copySpellOnStack`.
- **Suggested follow-up**: `#2614 plan work` (cast-color filter +
  retarget-copy extension). Two related lanes; can ship
  independently but each is more than a single-card sample.

### Lane 32 from Wave 4.5 (Scaling P/T anthems) **(W4.5)**

- **Gap**: Smaug, Blanchwood Armor, Tempest Djinn,
  "Creatures you control get +X/+X where X = number of Treasures
  you control."
- **Blocker**: the `Static` schema's `power`/`toughness` are
  integers; a scaling anthem needs a function of state. Either
  introduce an `X: "treasures"` / `X: "creatures"` field that the
  refresh pass computes, or push the scaling into a one-off engine
  helper. Either way it's new schema + new engine arms.
- **Suggested follow-up**: `#2614 plan work`.

## Skipped, single-lane, deferred to a future Wave 4.5+ pass

These are not blockers — they're cards that ride on already-shipped
plumbing but weren't in the Wave 4.5 priority order. Reasonable
follow-up lanes if a future agent wants to keep going:

- **Midnight Snack (FDN 65)**: raid + `phaseEnds` + `intervening_if`
  - `CreatePredefinedToken` (Food). All plumbing is shipped (lanes
    29 + 2544). One-card sample, no schema change.
- **Needletooth Pack, Wardens of the Cycle**: end-step + morbid
  `intervening_if` (same as Cackling Prowler, lane 28). One-card
  samples each.
- **Gorehorn Raider, Storm Fleet Spy**: raid + `ETB` (different
  from Skyship Buccaneer's `phaseEnds`). Would also exercise
  `attackedThisTurn` on ETB.
- **Ajani's Pridemate, Twinblade Paladin, Drogskol Reaver**: life
  gain trigger, already partially supported (Ajanis Pridemate has
  a `lifeGain` test in the lane 26 follow-up).
- **Scrawling Crawler**: `upkeep` + `each_player` (already shipped
  in lane 25).

## Out of scope (per Wave 4.5 handoff)

These need dedicated human scoping per the handoff's "Don't ship
multi-lane schema changes" rule:

- Copying permanent/spell with new targets
- Granting triggered abilities to other cards
- Replacement effect for death
- Additional costs (sacrifice/pay)
- Affinity / cost reduction
- "You may" optional trigger / effect
- Abilities granting color or type or keyword via static
- Abilities requiring X spent on other spells
- Casting spells from exile / graveyard
- Token creation with embedded static
- Stun / finality counters

## Wave 4.6 done summary

The Wave 4.6 loop shipped four priority-order lanes and marked two
more as multi-lane blockers. Test count: 697 suites / 13825 cases
(13818 passed + 7 skipped) — +20 tests over Wave 4.5.

### Shipped

- **Lane 33 — Double Vision** (#2695): `CopySpell.new_targets: true`
  flag on the existing `CopySpell` op. v1 records the engine's
  intent to retarget (CR 707.10d); the copy still inherits the
  original's targets. A real retarget UI is a follow-up.
- **Lane 34 — Cinder Pyromancer** (#2696): `TriggerSchema.cast_color`
  single-color filter on cast triggers (CR 601.2i / 603.2). The
  engine reads the cast spell's `colors` and fires only when the
  named color is present.
- **Lane 35 — Pyromancer's Goggles** (#2697): combines lane 33 +
  lane 34 on a single cast trigger. Sample uses a cast-trigger
  shape (real Pyromancer's Goggles is a mana-spending delayed
  trigger, which the v1 pipeline doesn't model — same gap as
  Teach by Example from lane 33).
- **Lane 36 — Smaug** (#2698): `StaticSchema.X` (treasures /
  creatures / lands) and `affects.self: true` so a self-stating
  scaling anthem can read the named count at refresh time. Smaug's
  cost-reduction half is a separate follow-up.

### Blocked (multi-lane)

- **Lanes 37 + 38 — Heraldic Banner** (chosen-color anthem +
  chosen-color activated `AddMana`): both needed a general-purpose
  "as this enters, choose a [thing]" mechanism. The current engine
  had only the shockland-specific "as this enters, pay 2 life"
  pattern. **Shipped in Wave 4.7 lanes 40 + 41** (after the
  prerequisite `enter_choice` engine arm in lane 39). See the
  "Wave 4.7 done summary" below.

### Still tracked (not attempted in Wave 4.6)

The "Out of scope" list above remains — those need dedicated
human scoping before they become shippable lanes.

## Wave 4.7 done summary

The Wave 4.7 loop unblocked the Heraldic Banner multi-lane work
(#2701 + #2702 + #2699). The general-purpose "as this enters,
choose a [thing]" mechanism is now in place via the `enter_choice`
schema arm, a `chosenColor` instance field, and a new
`enter_choice` `waitingChoice` flow. v1 ships only `kind: "color"`
(W | U | B | R | G); the engine arms for `creature_type` and
`player` remain documented but unsupported.

Test count: 700 suites / 13852 cases (13845 passed + 7 skipped) —
+27 tests over Wave 4.6.

### Shipped

- **Lane 39 — `enter_choice` engine arm** (#2699): the prerequisite
  for the two Banner halves. New schema field
  `enter_choice: { kind, text }`, new `chosenColor` instance
  field, new `enter_choice` waitingChoice type, and a
  `resolveEnterChoice` resolver. Sample card: `Test Goggles`
  exercises ONLY the new arm.
- **Lane 40 — Heraldic Banner chosen-color anthem** (#2701):
  `StaticSchema.affects.color` enum gains a `"chosen"` sentinel;
  `staticAffects` substitutes `source.chosenColor` at refresh
  time. Anthem is inert until the player answers the enter
  choice. The Heraldic Banner JSON now carries `enter_choice` +
  the anthem half.
- **Lane 41 — Heraldic Banner chosen-color AddMana** (#2702):
  `AddManaSchema.colors` accepts the `"chosen"` sentinel (single
  element only). A new `substituteChosenColorInEffect` helper
  rewrites "the chosen color" to `{W}`-style at activation time
  so the existing `parseManaFromEffect` reads it. The
  script-level AddMana case (`card-scripts/interpret.ts`) gets a
  matching guard rejecting `"chosen"` since it has no source.
  The Heraldic Banner JSON now carries the activated
  `{T}: Add one mana of the chosen color.` ability — the real
  card is complete.

### Skipped

- **Lane 42 — cleanup pass**: the handoff listed it as "skip if
  `npm test --silent` already covers the new paths via the
  existing tests." After lanes 39 + 40 + 41, the existing
  `drafted-scripts.test.ts` smoke test loops over every scripted
  card (including the new Test Goggles and Heraldic Banner); the
  `card-scripts.test.ts` "every AddMana script's ability text
  agrees with its op" data-driven test was extended for the
  `"chosen"` sentinel in lane 41. No additional data-driven
  coverage was needed.

### Blocked (multi-lane, still tracked)

The "Out of scope" list above remains — those need dedicated
human scoping before they become shippable lanes. In particular:

- **Banner of Kinship / Adaptive Automaton** (chosen creature
  type anthem) — tracked as #2705. Two-lane pass (engine arm +
  chosen-type anthem substitution), parallel to lanes 39 + 40.
- **Diamond Mare** (chosen color anthem on a creature) — tracked
  as #2704. **Diamond Mare is NOT blocked** by any of the Wave
  4.7 follow-ups; the `enter_choice: { kind: "color" }` and
  `affects.color: "chosen"` engine arms already support it on
  a creature. The lane is a one-card JSON + one test file.
- **Sorcerous Spyglass** (choose a card name on ETB) — tracked
  as #2708. Needs an entirely different `chosen_name` arm that
  affects the engine's "cards named X" lookups. Multi-lane.
- **Data-driven `enter_choice` text-vs-script guard** — tracked
  as #2706. Mirrors the existing text-vs-numbers guard; flags a
  drafter who writes `kind: "color"` for a card whose oracle
  says "choose a creature type."
- **Remove Test Goggles synthetic card** — tracked as #2707.
  Heraldic Banner now exercises the same `enter_choice` path,
  so the synthetic no longer adds unique coverage. Cleanup.
- **Heraldic Banner cost reduction** (not a real Banner ability,
  the drafter list entry was a conflation) — n/a.

Closes #2594 follow-up lanes 39–41 of the Wave 4.7 loop.

## Wave 4.7 follow-up loop done summary

Lanes 43–48 of the Wave 4.7 follow-up loop (#2704–#2708) shipped
in a single uninterrupted run on 2026-10-10. All five follow-up
issues plus the multi-lane baseline are closed or partially
closed.

### Shipped

- **Lane 43 — Diamond Mare (#2704)** — PR #2712.
  `src/lib/game-state/card-scripts/cards/diamond_mare.json` +
  `src/lib/game-state/__tests__/diamond-mare-chosen-color.test.ts`.
  No engine change. Exercises the Wave 4.7 lane 40
  `affects.color: "chosen"` anthem on a creature permanent
  instead of an artifact.

- **Lane 44 — `creature_type` enter_choice engine arm (#2705a)**
  — PR #2714. `chosenCreatureType: string | null` on
  `CardInstance`; `enterChoiceOptionsForKind` dispatches on
  kind (curated 10-type list); `resolveEnterChoice` stamps the
  field; the `resolveCardIdForChoice` fallback accepts both
  `chosenColor === null` and `chosenCreatureType === null`.
  3 test factories updated with the new default.

- **Lane 45 — chosen creature-type anthem (#2705b)** — PR
  #2715. `affects.subtype` accepts the `"chosen"` sentinel;
  `staticAffects` reads `source.chosenCreatureType` when
  `subtype === "chosen"`. Sample card: **Adaptive Automaton**
  (anthem half only — the "is the chosen type in addition to
  its other types" half rides a separate follow-up).

- **Lane 46 — `enter_choice` text-vs-script guard (#2706)** —
  PR #2716. Data-driven guard in `drafted-scripts.test.ts`
  that asserts every script's `enter_choice.kind` agrees with
  its `oracle` text. Two negative fixtures exercise the
  matcher.

- **Lane 47 — Remove Test Goggles synthetic (#2707)** — PR
  #2717. Deleted `test_goggles_enter_choice.json` and the
  historic `enter-choice.test.ts` (10 cases); added
  `enter-choice-engine.test.ts` with 4 fixture-driven cases
  porting the engine-arm-specific assertions the real cards
  don't cover (predicate truthy/falsy + ETB-pipeline check).

- **Lane 48 phase 1 — chosen_name schema baseline
  (multi-lane, #2708 phase 1)** — PR #2718. Forward-compatible
  schema extension: `enter_choice.kind` enum gains
  `"chosen_name"`; `CardInstance.chosenCardName: string | null`
  defaulted to `null`. The engine arm + chosen-name static
  block track under #2708 as further multi-lane work.

### Blocked (multi-lane, still tracked)

- **Adaptive Automaton type-change half (Wave 4.7 phase 2
  lane 51)** — Adaptive Automaton reads "is the chosen type
  in addition to its other types" — a permanent (not
  until-end-of-turn) creature-type-changing static on the
  source. The engine today has no concept of a permanent
  type-change: `AddSubtype` is end-of-turn-only
  (`untilEndOfTurnSubtypes`, cleared at end-of-turn), and the
  layer-system's type-line overrides are animated-only.
  Adding the chosen-type-changes-me static would need a new
  schema arm (e.g. `becomes_chosen_creature_type: true`),
  a new engine path for "the source's permanent `subtypes`
  field grows by `chosenCreatureType`", and an answer for
  which layer renders the new types into the type-line used
  by anthem targets. The chosen-type anthem (lane 45, PR
  #2715) already reads `source.chosenCreatureType` against
  `target.subtypesOf(target)` — adding the type-change half
  could be done by `staticAffects` returning a synthetic
  "matches itself via chosenCreatureType" predicate; the
  rename + layered type-line work + chosen-card-name
  eviction at the chosen-creature-type's tombstone is the
  second half of the work.

  The drafter list (`docs/card-scripts/drafts/fdn.md`)
  flags "change creature types" as a multi-lane blocker
  for Eaten by Piranhas (chosen color + chosen creature
  type + remove all abilities), Infernal Vessel (chosen
  creature type + color/keyword transforms), and a wider
  "charms that become a chosen type in addition to their
  other types" family. The handoff's "If this lane grows
  past one self-contained change, back out and document
  why in `wave4-blockers.md`" rule was triggered: the
  smallest Adaptive Automaton-only change would still need
  three concerns (schema + engine arm + chosen-eviction),
  and any general-purpose `change creature types` op
  needs cross-zone refactoring (the engine's type-line
  reads flow through `cardData.type_line` from many
  call sites — animated-only is the safe boundary today).

  Per the handoff, lane 51 was explored and backed out
  before commit. **No PR for the type-change half ships
  in this loop.** Adaptive Automaton JSON continues to
  carry the anthem half only; the script-level comment
  documenting the "anthem only" limitation stays in
  place (added in lane 45, PR #2715). The full oracle
  becomes a fresh follow-up: open issue `/planar-nexus #2614`
  for the Adaptive Automaton type-change half, and
  separately for the Eaten-by-Piranhas / Infernal-Vessel
  multi-lane work.

### Wave 4.7 phase 2 loop done summary

Wave 4.7 phase 2 lanes 49–51 closed in a single
uninterrupted run on 2026-10-10. Two lanes shipped (#2708
phase 2 in two PRs, lanes 49 + 50); one lane blocked (lane
51, per the handoff's "back out and document" rule).

#### Shipped

- **Lane 49 — Sorcerous Spyglass chosen_name engine arm
  (#2708 phase 2a)** — PR #2719. New schema field
  `enter_choice.kind` already covers `"chosen_name"` (lane
  48 baseline); the engine arm surfaces a `choose_cards`
  waitingChoice pointing at one opponent's hand and a
  `resolveChosenName` resolver stamps the entering card's
  `chosenCardName`. The chosen card stays in the
  opponent's hand (Spyglass is NOT Duress). Synthetic
  chosen_name script registered via the test harness mirrors
  the historic Test Goggles pattern from lane 39 / lane 47
  cleanup.

- **Lane 50 — Chosen-name static block + Sorcerous
  Spyglass script (#2708 phase 2b)** — PR #2721.
  `affects.chosen_name_block: true` meta-static on
  `StaticSchema` (parallel to the existing
  `affects.color: "chosen"` and `affects.subtype: "chosen"`
  sentinels). `staticAffects` returns true iff the target
  card's name matches the source's `chosenCardName`. The
  activated-ability gate in `canActivateAbility` denies any
  on-battlefield source's non-mana activated ability that
  matches a Spyglass-named source; mana abilities (CR 605)
  are explicitly exempted per the Spyglass oracle text.
  Real `sorcerous_spyglass.json` with the chosen-name block
  - `{T}: Add {C}.` AddMana (uses the existing literal
    colorless path, no new schema). Engine-size budget
    bumped 2050 → 2100 (schema.ts grew from 2041 to 2066, +25
    lines, all of them the new chosen-name block
    docstring + arm + the refine's chained `||
s.affects.chosen_name_block === true` clause).

#### Blocked (multi-lane, still tracked)

See "Blocked" section above for the Adaptive Automaton
type-change analysis. No follow-up PR for lane 51 in this
loop.

#### Test count snapshot

- Wave 4.7 follow-up loop done summary (this loop's start):
  704 / 13882 (per the wave 4.7 follow-up handoff).
- After lane 49 (Spyglass chosen_name engine arm): 705 / 13892.
- After lane 50 (Spyglass static block + script): 706 / 13905.

Net delta from Wave 4.7 follow-up loop: **+2 suites, +23
cases** in the Wave 4.7 phase 2 loop.

#### Done

This closes the Wave 4.7 phase 2 loop. The loop ran
without human input on lanes 49 and 50; lane 51 was
explicitly backed out per the handoff's "back out and
document" rule because the smallest single-lane piece
~400–700 LOC and crosses into the broader "change
creature types" multi-lane blocker. Lane 50's PR #2721
closed #2708 phase 2 fully (lanes 49 + 50 ship the entire
chosen-name → chosen-name-block → activated-ability-gate
pipeline; Sorcerous Spyglass is fully scripted end-to-end
for the first time in Planar Nexus).

Net delta from Wave 4.6 start: **+4 suites, +30 cases** in the
Wave 4.7 follow-up loop. The phase 2 follow-up (lanes 49–51,
`#2708` phase 2 + Adaptive Automaton type-change half) closed
in the Wave 4.7 phase 2 done summary just below; the
`#2708` phase 2 work is fully shipped (Sorcerous Spyglass is
end-to-end scripted for the first time).

## Wave 4.8 in-progress summary (lanes 52, 53)

Wave 4.8 lanes 52 + 53 closed in a single uninterrupted run
on 2026-10-10/11. Lane 54 (this lane) closed immediately
after. Lanes 55–56 (or as many as ship before the loop's
hard deadline) follow in priority order.

### Shipped

- **Lane 52 — `add_creature_type` static arm (PR #2723)**.
  New `StaticSchema.affects.add_creature_type: string |
"chosen"` arm + companion `addCreatureTypeToSelf: true`
  opt-in flag (v1 self-only). New
  `CardInstance.chosenTypeAdditions?: string[]` field
  stamped by `refreshScriptedStatics`. Local `subtypesOf`
  helper unions `chosenTypeAdditions` with the printed
  type line so other statics (the lane 45 chosen-type
  anthem) can see the addition on the source itself.
  Engine-size budget bumped 2050 → 2100 in lane 50
  and lands exactly at the ceiling after lane 52.

- **Lane 53 — Adaptive Automaton full-oracle JSON (PR
  #2725)**. `adaptive_automaton.json` updated to carry
  both halves — the chosen-type anthem (lane 45) AND
  the chosen-type addition (lane 52). No engine change;
  no new schema field. The lane 45 "registers enter_choice
  - chosen-type anthem on the script" test was updated
    to read index 1 (anthem) instead of index 0 (the new
    type-change static).

### Deferrals (still tracked)

The triggered-ability suppression piece of
`removesAllAbilities` (lane 54, Witness Protection) is a
follow-up: when the enchanted card's `script.triggers`
list includes a triggered ability, the engine should
suppress the trigger from firing while the enchanted
card carries `losesAbilities: true`. Lane 54's v1 gate
covers the activated-ability path (the `canActivateAbility`
deny, which is the testable, in-scope path). Trigger
fire suppression requires a broader engine change to
the trigger pipeline — documented in the Wave 4.8
follow-up loop's done summary as a future lane.

Engine-size budget: lane 54 bumped 2100 → 2200 (covers
the remaining Wave 4.8 lanes 55 + small headroom).

- **Lane 55 — `add_color` static arm (PR forthcoming)**.
  New `StaticSchema.affects.add_color:
"W"|"U"|"B"|"R"|"G"|"chosen"` arm + companion
  `addColorToSelf: true` opt-in flag (mirror of
  `addCreatureTypeToSelf` from lane 52). New
  `CardInstance.chosenColorAdditions?: ColorLetter[]`
  field stamped by `refreshScriptedStatics`. The local
  `getCardColors` helper unions `chosenColorAdditions` with
  the printed colors so the chosen-color anthem (lane 40,
  Heraldic Banner / Diamond Mare) can see the addition on
  the source itself. Lane 55 ships NO real card JSON update
  (the handoff's chosen-eviction-at-tombstone handle is the
  same shape as lane 52's, naturally handled by the
  refresh pass maintaining the field on battlefield cards
  only). Schema at 2174 (well under the 2200 budget bumped
  in lane 54).

### Multi-lane still tracked (Wave 4.8 follow-up)

The full Wave 4.8 priority lanes 52–55 are shipped.
Deferred per the handoff:

- Banner of Kinship fellowship-counter entrance
  (`enters_with_counters_per_match: chosen_subtype`).
- Eaten by Piranhas full script (`multiple enter_choices`
  or "enters with chosen color + chosen creature type" arm
  separate multi-lane).
- Redcap Gutter-Dweller full JSON (the "Goblin menace
  when 3+ counters" trigger half is a counter-based
  trigger gate — the chosen-color addition + Treasure
  token halves are now unblocked).
- Triggered-ability suppression for `removes_all_abilities`
  (lane 54 follow-up).
- Affinity / cost reduction (lane 57, Claws Out, etc.).
- Lanes 56–65 (additional costs, granting triggered
  abilities, replacement effect for death, "you may"
  optional trigger, casting from exile/graveyard, stun/
  finality counters, token creation with embedded static,
  copying a permanent, X-spent-on-other-spells).

## Wave 4.8 loop done summary (lanes 52, 53, 54, 55)

Wave 4.8 closed in a single uninterrupted run on
2026-10-10/11. All four priority lanes shipped as
self-contained PRs with one test-count drift each (per
the handoff's "AI `forge-gate`/`forge-selfplay`/`expert-agent`
is deterministic for a seed" pre-existing flake) and
forced pushes resolved via `gh run rerun --failed` (lanes
54, 55) or fresh `ratchet:test-count` re-writes (lane 53,
54). The loop ran without human input; the AI flake cost
~2 extra CI runs total across the four lanes.

### Shipped (all four priority lanes)

- **Lane 52 — `add_creature_type` static arm (PR #2723)**.
  `StaticSchema.affects.add_creature_type: string |
"chosen"` arm + companion `addCreatureTypeToSelf:
true` opt-in flag (v1 self-only). New
  `CardInstance.chosenTypeAdditions?: string[]` field
  stamped by `refreshScriptedStatics`. Local `subtypesOf`
  helper unions `chosenTypeAdditions` with the printed
  type line so other statics (the chosen-type anthem in
  lane 45) can see the addition on the source itself.
  15 new tests; chosen-eviction-at-tombstone naturally
  handled by `chosenTypeAdditions` being
  battlefield-zone-only.

- **Lane 53 — Adaptive Automaton full-oracle JSON (PR
  #2725)**. `adaptive_automaton.json` updated to carry
  both halves — the chosen-type anthem (lane 45) AND
  the chosen-type addition (lane 52). No engine change;
  no new schema field. The lane 45 "registers enter_choice
  - chosen-type anthem on the script" test was updated
    to read index 1 (anthem) instead of index 0 (the new
    type-change static). 5 new tests added (nested
    describe block).

- **Lane 54 — `removes_all_abilities` aura static (PR
  #2726)**. `AuraStaticSchema.removesAllAbilities:
z.literal(true)` arm + allow-list extension. New
  `CardInstance.losesAbilities?: true` field stamped by
  `refreshAuraBonuses`. `canActivateAbility` gates the
  card's scripted activated abilities when `losesAbilities`
  is set (no mana-ability carve-out per the strict card
  text interpretation). Aura's own static bonuses (P/T,
  restrictions, keywords granted by the Aura) STAY —
  the source's continuous effect is separate from the
  enchanted card's native characteristics (CR 613.1b).
  Witness Protection JSON updated with the new arm.
  12 new tests; engine-size budget bumped 2100 → 2200.

- **Lane 55 — `add_color` static arm (PR #2729)**.
  `StaticSchema.affects.add_color: "W"|"U"|"B"|"R"|"G"|
"chosen"` arm + companion `addColorToSelf: true`
  opt-in flag (mirror of `addCreatureTypeToSelf`). New
  `CardInstance.chosenColorAdditions?: ColorLetter[]`
  field stamped by `refreshScriptedStatics`. Local
  `getCardColors` helper unions `chosenColorAdditions`
  with the printed colors so the chosen-color anthem
  (lane 40, Heraldic Banner / Diamond Mare) can see the
  addition on the source itself. Mirrors lane 52's
  `subtypesOf` union shape but for colors.
  15 new tests; no real card JSON update (Redcap
  Gutter-Dweller's full JSON ships when the
  counter-based trigger gate lands).

### Net delta from Wave 4.7 phase 2 final

- Test suites: 706 → 710 (+4, including +1 from a
  concurrent manamind PR that landed during the Wave 4.8
  loop's lane 54 work).
- Test cases: 13907 → 13959 (+52 from Wave 4.8 lanes 52–55
  net of the +5 cases the manamind PR added).
- Engine-size budget: schema.ts 2066 (lane 50 baseline)
  → 2174 (+108 lines incl. docstrings across lanes 52 +
  54 + 55). Lane 54 bumped the budget 2100 → 2200 to
  cover the remaining Wave 4.8 lanes; final 2174 sits
  well under the 2200 ceiling.

### Multi-lane deferrals still open (Wave 4.8 follow-up loop)

These need fresh dedicated lanes per the handoff:

- Eaten by Piranhas full script (`multiple enter_choices`
  separate multi-lane — needs either a second
  `enter_choice` per card or "enters with chosen color +
  chosen creature type" arm).
- Banner of Kinship fellowship-counter entrance
  (`enters_with_counters_per_match: chosen_subtype` arm).
- Redcap Gutter-Dweller full JSON (the
  `chosen_color + addColorToSelf` half lands in lane 55;
  the "create a red Treasure token" rides
  `CreatePredefinedToken`; the "Goblins have menace when
  3+ counters" trigger needs a counter-based trigger
  gate).
- Triggered-ability suppression for `removes_all_abilities`
  (lane 54 follow-up; the trigger fire pipeline needs a
  broader engine change to suppress scripted triggers).
- Affinity / cost reduction (lane 57, Claws Out, etc.).
- Additional costs (lane 58, Louisoix's Sacrifice,
  Claws Out, etc.).
- Lanes 60, 62, 63, 64, 65 (granting triggered abilities,
  replacement effect for death, "you may" optional
  trigger, casting from exile/graveyard, stun/finality
  counters, token creation with embedded static,
  copying a permanent, X-spent-on-other-spells).

Per the handoff's "Done definition for the loop": when all
four priority lanes (52, 53, 54, 55) are either shipped or
marked multi-lane blockers, append this summary. All four
shipped. Multi-lane deferrals above are tracked for the
Wave 4.8 follow-up loop. The Wave 4.8 loop is complete.

## Wave 4.8 follow-up loop deferrals (lane-by-lane)

### Lane 57 (Redcap Gutter-Dweller full JSON, #2614)

- **Gap**: "Goblins you control have menace as long as this
  permanent has 3+ counters" — a counter-based trigger gate.
- **Blocker**: the engine has no general-purpose "this
  permanent has N+ counters" trigger gate today; the new
  gate would be a multi-lane addition (#2614 follow-up).
  Effective schema extension would be a `counter_gate:
{counter, op, n}` field on `TriggerSchema` plus an
  engine evaluator in `trigger-system/`.
- **Shipped**: Redcap Gutter-Dweller's chosen-color
  `enter_choice`, chosen-color `add_color: "chosen"`
  static (lane 55 arm), and attacks → Treasure-token
  trigger (shipped Wave 2 lane 2544).
- **Deferred**: the Goblin-menace-when-3+-counters trigger.
  The JSON ships WITHOUT that trigger; the gate is a
  follow-up lane.

## Wave 4.8 follow-up loop done summary (lanes 56–59)

All four priority lanes shipped:

- **Lane 56 — `enter_choice.kind: "color_and_creature_type"`
  dual compound arm (PR #2730)**. Schema enum extension +
  `resolveEnterChoice` dispatch + Eaten by Piranhas JSON
  - 11-case dedicated test.
- **Lane 57 — Redcap Gutter-Dweller full JSON (PR #2731)**.
  Chosen-color `enter_choice` + `add_color: "chosen"`
  static (lane 55 arm) + attacks Treasure-token trigger.
  Goblin-menace-when-3+-counters deferred (#2614).
- **Lane 58 — `losesAbilities` triggered-ability gate (PR
  #2732)**. `detectTriggeredAbilities` skips firing scripted
  triggers on a card whose `losesAbilities` is true.
  Mirrors CR 603.2 / 602.2d's "loses all other abilities"
  removal of triggered abilities. 6-case dedicated test.
- **Lane 59 — `enters_with_counters_per_match` arm (this
  lane, #2614)**. New schema field on `CardScriptSchema`;
  `resolveEnterChoice` reads the field after stamping
  `chosenCreatureType` and stamps N `+1/+1` counters on the
  source where N is the count of chosen-subtype creatures
  the entering card's controller controls. Banner of Kinship
  JSON ships the chosen-subtype anthem (lane 45) +
  counter-stamping dual. 9-case dedicated test.

### Net delta from Wave 4.8 follow-up loop

- Test suites: 710 → 714 (+4 — one per shipped lane).
- Test cases: 13959 → 13992 (+33: lane 56 +12, lane 57 +4,
  lane 58 +6, lane 59 +9; net of a 2-case net loss from
  the lane 56 drafted-scripts oracle guard extension).
- Engine-size budget: schema.ts 2174 (lane 55 baseline) →
  2237 (+63 lines incl. docstrings across lanes 56, 57
  schema field, 59 schema field). Under the 2300 ceiling
  bumped in lane 56.
- Multi-lane follow-ups still open (Banner of Kinship's
  real "protection from" effect, Redcap Gutter-Dweller's
  Goblin-menace-when-3+-counters, "you may" optional
  trigger, replacement effect for death, casting from
  exile/graveyard, additional costs, granting triggered
  abilities, copying a permanent, X-spent-on-other-spells,
  stun/finality counters, embedded statics on tokens,
  affinity/cost reduction). All tracked under #2614 or
  adjacent multi-lane plans.

Wave 4.8 follow-up loop is complete.

## Wave 4.8 follow-up 2 loop done summary (lanes 60, 62)

Two lanes shipped in the Wave 4.8 follow-up 2 loop. Both targeted
the "you may / counter-gate trigger" half of the drafter-list
#2614 plan work the Wave 4.8 follow-up handoff explicitly
deferred until the Adaptive Automaton / chosen-X work landed.

### Lanes shipped

- **Lane 60 — "you may" optional trigger gate (#2736, PR #2614)**.
  Schema: `TriggerSchema.you_may: z.boolean().optional()` —
  trigger-level "you may" (CR 117.3a) gate that defers the
  entire effects array behind a yes/no confirmation prompt
  offered to the controller at resolution time. Mutually
  exclusive with `modes` (the schema rejects the combo).
  Engine: `resolveScriptedAbility` consults a new
  `stackObject.you_may_resolved?: boolean`; when undefined it
  surfaces a new `you_may_prompt` `waitingChoice` (factory
  `createYouMayPromptWaitingChoice`), when `false` it skips
  the effects entirely, when `true` it runs them.
  `resolveWaitingChoice` arms the new prompt type, stamping
  the controller's yes/no answer onto the flag and clearing
  the choice. 9-case dedicated test.

- **Lane 62 — Counter-based trigger gate (#2737, PR #2614)**.
  Schema: `TriggerSchema.counter_gate: { counter: string,
op: "gte"|"eq", n: int >= 0 }` — a CR 603.2 "while"-gate
  parallel to `whileCondition` and `losesAbilities`. Wires
  the engine arm Redcap Gutter-Dweller's deferred
  "Goblins you control have menace when 3+ +1/+1 counters"
  half carried in the lane 57 (#2731) JSON. Engine:
  `detectTriggeredAbilities` consults the new gate after
  `losesAbilities` and before `interveningIf`; reads
  `card.instanceCounters[gate.counter]` from the lane 59
  per-instance counter ledger; the `op` comparator picks
  between threshold (`gte`) and exact (`eq`). 10-case
  dedicated test.

### Net delta from Wave 4.8 follow-up 2 loop

- Test suites: 714 → 716 (+2 — one per shipped lane).
- Test cases: 13992 → 14011 (+19: lane 60 +9, lane 62 +10).
- Engine-size budget: schema.ts 2237 (lane 59 measurement) →
  2286 (+49 lines incl. docstrings across lanes 60
  trigger-level flag + gate, 62 counter_gate field). Under
  the 2300 ceiling bumped in lane 56.
- Both lanes ship doc-ratchets in the same commit as the
  test changes (lane 62 used the `--live` fallback that
  the Wave 4.8 handoff documents as the safe path when the
  AI `forge-gate` flake hits `npm test --silent` mid-
  ratchet).
- Both PRs landed with full CI (41 SUCCESS / 5 SKIPPED,
  0 FAILED): Type Check, Lint, Test, Mutation (8 modules),
  Security Audit (npm + Rust), Tauri Updater, Turn
  Credentials, Test Count Docs Guard, Engine Size Budget,
  Workflow Lint. Lane 60 saw the `forge-gate` flake on
  one local run before the push; CI was clean.

### Still open (multi-lane, tracked under #2614 or adjacent plans)

The lanes that ride Wave 4.8 follow-up 2 and were NOT
attempted in this session:

- **Lane 61 — Replacement effect for death** (Whip of Erebos,
  False Dawn). Handoff explicitly notes the engine has no
  general replacement-effect layer; this is foundational
  work, ~200-400 LOC + tests. Per the Wave 4.8 follow-up
  handoff's process rule ("if a lane reveals a second
  pattern, split it into a follow-up lane"), this lane is
  bigger than the standard lane envelope and should be
  picked up only when a replacement-effect layer lands
  upstream.
- **Lane 63 — Additional costs** (Louisoix's Sacrifice,
  Drana's Sacrifice, Painful Truths). `additionalCosts`
  array on `ActivatedSchema` / `SpellEffectSchema` for
  sacrifice / pay_life costs. ~100-200 LOC + tests.
- **Lane 64 — Affinity / cost reduction** (Claws Out,
  Dragonlord's Servant, Archmage of Runes, Mocking
  Sprite, Bolt Bend, Arcane Epiphany). `cost_reduction`
  schema arm + parser that subtracts the affinity sum
  from the printed cost at activation time.
  ~100-200 LOC + tests.
- **Lane 65 — Granting triggered abilities to other cards**
  (Fake Your Own Death, Undying Malice, Lifelink granting
  via static). Static arm that adds `script.triggers` to
  the target. Multi-lane — touches the trigger fire
  pipeline directly. ~200-400 LOC + tests.
- **Lanes 66–71** — Token creation with embedded static,
  stun/finality counters, casting from exile/graveyard,
  X-spent-on-other-spells, copying a permanent,
  protection-from static.

Wave 4.8 follow-up 2 loop is complete (modulo lanes 63, 64,
and 65 that the handoff flagged as immediate follow-ups).

### Lane continue rule for the next session

If continuing this loop, start at **Lane 63** (additional
costs, smallest scope left) per the handoff's priority order.
Lane 61 stays blocked on the foundational replacement-
effect layer — pick that up only as a separate
multi-lane plan, not as the next lane in this loop.

## Wave 4.8 follow-up 3 done summary

Shipped lanes 63, 64, and 65 from the Wave 4.8 follow-up 2
handoff. All three landed as one-lane-per-PR, all CI
green, all merged on main. Per the Wave 4.8 follow-up 2
done summary's "Lane continue rule" the next session
should start at lane 66 (token creation with embedded
static) — but that's a multi-lane piece too.

### Lane 63 — Additional costs (PR #2738)

`additionalCosts.pay_life: { amount }` and
`additionalCosts.sacrifice: { amount, target }` arms on the
existing `CardScriptSchema.additionalCosts` slot. The engine
deducts these at cast time, after mana is verified and
spent, in `spell-casting/cast.ts`. Sample card: Painful
Truths ("Pay 1 life, draw 3 cards."). Test count delta:
716 → 717 suites, 14011 → 14019 cases.

### Lane 64 — Affinity / cost reduction (PR #2743)

Discriminated union on the existing `CardScriptSchema.affinity`
field:

- `{ subtype, reduction_per_match? }` — the lane 22 /
  Sapling Nursery shape, with `reduction_per_match` added
  (default 1).
- `{ color, reduction_per_match? }` — the new color arm
  (W | U | B | R | G | any).

The engine's `affinityReduction` in
`spell-casting/affinity.ts` handles both arms. Sample card:
Dragonlord's Servant (subtype arm with explicit
`reduction_per_match: 1`). Test count delta: 717 → 718
suites, 14019 → 14033 cases.

### Lane 65 — Granting triggered abilities to other cards (PR #2744)

A new `static.grants.triggers: [{ event: "dies", effects:
[...] }]` arm on `AuraStaticSchema`. The engine stamps the
granted list on the enchanted card via `refreshAuraBonuses`
(parallels the lane 52 `add_creature_type` pattern:
per-instance + battlefield-zone-only, dropped when the
source leaves the battlefield). The trigger fire path
(`detectTriggeredAbilities`) iterates the granted list and
fires each granted trigger alongside the card's own scripted
triggers. v1 supports a single `event: "dies"` arm; the
sample card is a synthetic Aura registered via the test
harness. Test count delta: 718 → 719 suites, 14033 → 14041
cases.

### Test count snapshot

- **Suites:** 716 → 717 → 718 → 719
- **Cases:** 14011 → 14019 → 14033 → 14041
- **All passing** (14034 passed + 7 skipped at the end of
  the loop, no flakes, no skipped suites)

### Process notes carried forward to the next loop

- `git commit` without the `GIT_AUTHOR_NAME` /
  `GIT_AUTHOR_EMAIL` env vars picks up the husky global
  git config and the commit shows up under the wrong
  author. Wave 4.8 follow-up 3 used the env vars
  consistently on every commit + amend; no misattributed
  commits in this loop.
- The `git rm --cached COMMIT_MSG.txt && git commit
--amend --no-edit && rm COMMIT_MSG.txt` flow is required
  to keep the commit message file out of the commit. The
  same flow is required for `PR_BODY.txt` (Wave 4.8
  follow-up 3 wrote the file AFTER the commit so it
  didn't need to be removed; this is the cleaner pattern
  and is the recommended one going forward).
- The husky pre-commit hook's `tsc --noEmit` can pass
  locally while CI's `tsc --noEmit` flags a missing
  import. Wave 4.8 follow-up 3 hit this once in lane 64
  with three unused `@ts-expect-error` directives in the
  test file (the test pattern for synthetic scripts uses
  inline object literals, which TypeScript doesn't
  normally accept in a strict `CardScript[]` array). The
  fix was to cast `synthetic as never` instead of using
  `@ts-expect-error`; the directives were unnecessary
  because the test harness doesn't actually need to
  suppress the error.
- The `npm run ratchet:test-count` script is reliable; the
  Wave 4.8 follow-up 3 loop did not hit the AI flake
  mid-ratchet (the lane 62 workaround from the previous
  loop was not needed). All three ratchets in this loop
  ran clean on the first try.
- `tsc --noEmit` is fast (~5s in this repo); run it
  before pushing to avoid the husky pre-commit hook
  blocking the commit on a local typecheck pass while CI
  fails on a missing import.
- The `check-engine-size-budget.mjs` script is fast
  (~50ms); run it in the same commit as any `schema.ts`
  change so the budget doesn't drift. Wave 4.8 follow-up
  3 bumped the budget 2300 → 2350 → 2400 → 2450 across
  the three lanes. The chosen-X / additional-costs /
  affinity / grants family is intentionally kept cohesive;
  the next lane that needs a bump should follow the same
  precedent.

### Still open (multi-lane, tracked under #2614 or adjacent plans)

The lanes that ride Wave 4.8 follow-up 3 and were NOT
attempted in this session:

- **Lane 61 — Replacement effect for death** (Whip of
  Erebos, False Dawn). Foundational replacement-effect
  layer; tracked separately per the Wave 4.8 follow-up 2
  handoff's process note.
- **Lanes 66–71** — Token creation with embedded static,
  stun/finality counters, casting from exile/graveyard,
  X-spent-on-other-spells, copying a permanent,
  protection-from static. All multi-lane; pick up in a
  future Wave 4.8 follow-up 4 (or equivalent) handoff.

### Lane continue rule for the next session

If continuing this loop, start at **Lane 66** (token
creation with embedded static) per the Wave 4.8 follow-up
3 handoff's priority order. Lane 61 stays blocked on the
foundational replacement-effect layer — pick that up only
as a separate multi-lane plan, not as the next lane in
this loop.

## Wave 4.8 follow-up 4 loop done summary

Lanes 66, 67, and 68 all shipped in the Wave 4.8 follow-up
4 loop (PRs #2745, #2746, #2747 — see
`docs/card-scripts/wave4.8-followup4-handoff.md` for the
handoff and `docs/card-scripts/wave4-blockers.md` for
the prior loop's done summary).

### Shipped

- **Lane 66 — Token creation with embedded static**
  (PR #2745, #2614 follow-up). Adaptive Automaton,
  Avenger of Zendikar, Hornet Queen, Cloudblazer — the
  "creature token has keyword / gets +X/+X" family. The
  v1 minimum ships the keywords + P/T arm on
  `CreateTokenSchema.embedded_static`; the engine folds
  P/T additively into the base P/T and stamps keywords
  on the per-instance `embeddedStaticKeywords` field,
  read by `hasKeyword` alongside `cardData.keywords` /
  `auraKeywords` / `equipmentKeywords` /
  `scriptStaticKeywords`. Restrictions
  (`restrictAttack`, `restrictBlock`, `maxBlockers`) and
  granted triggered abilities on the token are
  follow-up lanes.
- **Lane 67 — Stun / finality counters** (PR #2746,
  #2614 follow-up). Magmatic Hellkite, Sheoldred's
  Headcracker, the +1/+1 / -1/-1 family. The v1
  minimum generalizes the `instanceCounters` ledger
  (lane 59 substrate) to support arbitrary named
  counter types at ETB via the new
  `CardScriptSchema.enters_with_counters: [{ counter,
count }]` arm. v1 supports the four counter types
  `"+1/+1"`, `"-1/-1"`, `"stun"`, and `"finality"`.
  The engine stamps both the `instanceCounters` ledger
  AND mirrors to the legacy `card.counters` list so
  the existing untap-skip + P/T paths pick up the
  counter immediately. The per-turn stun-removal (the
  active decrement of a stun counter during the untap
  step) and the finality-skipping effect (blocking
  graveyard recursion) are follow-up lanes.
- **Lane 68 — Cast from exile / graveyard / command**
  (PR #2747, #2614 follow-up). Evoke, Flashback,
  Jump-Start, Undergrowth, Escape, As Foretold,
  Yawgmoth's Vile Offer, commander cast. The v1
  minimum adds `CardScriptSchema.castable_from:
["exile" | "graveyard" | "command"]` — a
  single-element array. The engine's `canCastSpell`
  accepts the cast when the card is in the named zone
  (instead of requiring the hand); the cast path
  pushes `"castable_from"` to `alternativeCostsUsed`
  and stamps `castableFromZone` on the StackObject;
  the resolve path routes the card to the inferred
  end zone (exile for `castable_from: ["graveyard"]`
  and `castable_from: ["exile"]` instants/sorceries,
  parallel to flashback / foretell; commander
  return-to-command is a follow-up lane). Multi-zone
  `castable_from` is a follow-up lane.

### Blocked (multi-lane, tracked under #2614)

- **Lane 61 — Replacement effect for death** (Whip of
  Erebos, False Dawn). Foundational replacement-effect
  layer; tracked separately per the Wave 4.8
  follow-up 2 handoff's process note. Not attempted in
  this loop.
- **Lane 69 — X-spent-on-other-spells** (the
  "spend this mana only on [X]" family). Multi-lane;
  not attempted in this loop.
- **Lane 70 — Copying a permanent** (Clone,
  Phantasmal Image). Multi-lane; not attempted in
  this loop.
- **Lane 71 — Protection-from static** (e.g. "creatures
  you control have protection from [color]"). Multi-lane;
  not attempted in this loop.

### Test count snapshot

At the close of the Wave 4.8 follow-up 4 loop:

- **Test suites:** 722 (was 719 at the start of the loop;
  +3 for lanes 66 / 67 / 68)
- **Test cases:** 14079 (was 14041 at the start of the
  loop; +38 across the three lanes — 12 for lane 66,
  11 for lane 67, 15 for lane 68)
- **Engine-size budget:** 2550 / 2550 lines for
  `schema.ts` (was 2408 at the start of the loop;
  +111 across the three lanes — +14 for lane 66, +54
  for lane 67, +43 for lane 68). Bumped 2400 → 2450
  (lane 66 inherited lane 65's bump) → 2500 (lane 67)
  → 2550 (lane 68), tracking the chosen-X /
  additional-costs / affinity / grants / counter-ledger
  / cast-from-zone family on the same trajectory.

### Process notes carried from the Wave 4.8 follow-up 4 loop

- Lane 66 (token embedded static) was a clean
  one-piece add-on — schema arm + engine fold + one
  test, no engine wiring refactor. The lane bumped
  the **client bundle** budget (`config/bundle-budget.json`)
  rather than the engine-size budget: the
  `keyword-actions/tokens.ts` and `effect-resolution.ts`
  changes pulled into the `/replay` route (and a
  handful of other game routes) via the
  `@/lib/game-state` barrel re-export, growing
  `/replay` by +60.9 kB. The re-capture bumped the
  budget in the same commit (the handoff's process
  rule: "bump the budget rather than fragmenting the
  chosen-X / additional-costs / affinity / grants
  family" — the same precedent applies to the
  client bundle budget; the previous wave 2 engine
  additions took the same route in commit `c8e8f9a3`).
- Lane 67 (stun / finality counters) was a clean
  one-piece add-on — schema arm + engine helper
  (`applyScriptEntersWithCounters`) + calls from
  `fireEntersTriggers` and `spell-casting/resolve.ts`
  - one test. The bump to the engine-size budget
    (2450 → 2500) was in the same commit (the
    handoff's process rule). The
    `CardScriptSchema` refinement was extended to
    accept `enters_with_counters` as a valid "card
    script" form (a card with only `enters_with_counters`
    is legal — the v0 substrate is the lane 59
    `enters_with_counters_per_match` which is similarly
    accepted). The mirror-to-`card.counters` was
    deliberate so the existing untap-skip path picks
    up the new stun counter on day one; the
    follow-up lane can move the untap path to read
    from `instanceCounters` once the legacy
    `SearchLibrary.stun` substrate is retired.
- Lane 68 (cast from exile / graveyard / command)
  was a more invasive one-piece add-on — the cast
  path runs through three layers (`canCastSpell`,
  `castSpell` source-zone check, `validation-service.ts`
  legality check) and the resolve path runs through
  `resolveTopOfStack`. All three layers were extended
  with a matching `castable_from` arm. The
  `StackObject` type gained a new optional
  `castableFromZone` field; the engine uses it at
  resolve time to route the card to the inferred end
  zone. The bump to the engine-size budget
  (2500 → 2550) was in the same commit.
- The AI `forge-gate` / `forge-selfplay` /
  `expert-agent` "is deterministic for a seed" test
  is a known order-dependent flake on main. The
  Wave 4.8 follow-up 4 loop hit this once on lane 68's
  full-suite run; the second run passed clean. The
  documented `gh run rerun --failed` fallback was
  not needed (the local re-run cleared it). Budget
  for 1-2 extra CI runs per lane to absorb the flake.
- Lane continue rule for the next session: lane 61
  (replacement effect for death) remains parked
  pending the foundational replacement-effect layer;
  lane 69 (X-spent-on-other-spells), lane 70
  (copying a permanent), and lane 71 (protection-from
  static) are NOT in this loop's scope — pick those
  up in a future Wave 4.8 follow-up 5 (or
  equivalent) handoff.

## Wave 4.8 follow-up 5 loop done summary

Lanes 69, 70, and 71 all shipped in the Wave 4.8
follow-up 5 loop (PRs #2749, #2750, #2751 — see
`docs/card-scripts/wave4.8-followup5-handoff.md` for
the handoff and this file for the prior loop's done
summary).

### Shipped

- **Lane 69 — X-spent-on-other-spells (mana
  restriction family)** (PR #2749, #2614 follow-up).
  Force of Will, Cabal Therapy, the Storm-Crow
  specter pattern. The v1 minimum adds a
  `mana_restriction: { colors: ["W" | "U" | "B" | "R"
| "G"][length 1], generic: number }` arm on
  `additionalCosts` (parallel to lane 63's `pay_life`
  / `sacrifice`). The engine auto-applies the
  restriction when the printed cost isn't payable but
  the adjusted cost is (parallel to affinity's
  auto-reduction). The cast path stamps
  `manaRestriction` on the `StackObject`. The
  validation service opens the gate when the player
  can pay either path. The bump to the engine-size
  budget (2550 → 2575) was in the same commit (per
  the handoff's process note).

- **Lane 70 — Copying a permanent (Clone,
  Phantasmal Image, Vesuvan Doppelganger)** (PR
  #2750, #2614 follow-up). The v1 minimum adds a
  new `CopyPermanent` op on `EffectSchema` (parallel
  to `CreateToken`) that creates a new permanent
  whose `cardData` is shallow-copied from a target
  on the battlefield (CR 707.2 "all characteristics
  copied" semantics). The new permanent enters the
  battlefield under the spell's controller; the
  target is unchanged. v1 supports
  `target: "permanent" | "creature" | "artifact" |
"enchantment" | "land"` and
  `controller?: "you" | "opponent" | "any"`. The
  engine auto-picks the first matching permanent
  (APNAP-ordered) when no explicit target is chosen
  — the simplest v1 minimum. The per-op reference
  module (`ops/copy-permanent.ts` + `ops/registry.ts`)
  keeps the LLM-drafted scripts pipeline in sync.
  The bump to the engine-size budget (2575 → 2650)
  was in the same commit.

- **Lane 71 — Protection-from static** (PR #2751,
  #2614 follow-up). Light of Day, Crimson Acolyte,
  the "creatures you control have protection from
  [color/quality]" family. The v1 minimum adds a
  `protectionFrom: string[]` arm on `StaticSchema`.
  The engine stamps the values on each affected
  permanent's per-instance `protectionFrom: string[]`
  field (parallel to the lane 65 `grantedTriggers` /
  lane 52 `chosenTypeAdditions` pattern); the
  existing `hasProtectionFrom` /
  `canBeTargetedBy` / `canBeBlocked` checks in
  `evergreen-keywords.ts` consult the field. A
  creature with `protectionFrom: ["red"]` cannot
  be the target of a red spell (CR 702.16a),
  cannot be blocked by a red creature (CR
  702.16d), and cannot be dealt damage by a red
  source (CR 702.16c). Battlefield-zone-only
  semantics (cleared when the source leaves the
  battlefield). Engine-size budget unchanged
  (schema landed at 2644, under the 2650 bumped in
  lane 70).

### Blocked (multi-lane, tracked under #2614)

- **Lane 61 — Replacement effect for death** (Whip of
  Erebos, False Dawn). Foundational replacement-effect
  layer; tracked separately per the Wave 4.8
  follow-up 2 handoff's process note. Not attempted
  in this loop.
- **Lane 72 — X-spent-on-creature-spells** (the
  "spend this mana only on creature spells" pattern,
  e.g. Llawan). Multi-lane; not attempted in this
  loop.
- **Lane 73 — Copying a spell on the stack** (Splice,
  copy-with-new-targets). Multi-lane; not attempted
  in this loop.
- **Lane 74 — Multi-quality protection**
  (`protectionFrom: ["red", "blue"]`). Multi-lane;
  not attempted in this loop.
- **Lane 75 — "Until end of turn" copy**
  (Sakashima-style / manifested). Multi-lane; not
  attempted in this loop.
- **Lane 76 — Aura-shaped protection-from static**
  (`AuraStaticSchema.protectionFrom`). Multi-lane;
  not attempted in this loop.

### Test count snapshot

At the close of the Wave 4.8 follow-up 5 loop:

- **Test suites:** 725 (was 722 at the start of the
  loop; +3 for lanes 69 / 70 / 71 — 1 each)
- **Test cases:** 14094 (was 14079 at the start of
  the loop; +15 across the three lanes — 7 for
  lane 69, 4 for lane 70, 4 for lane 71)
- **Engine-size budget:** 2650 / 2650 lines for
  `schema.ts` (was 2550 at the start of the loop;
  +94 across the three lanes — +13 for lane 69,
  +48 for lane 70, +33 for lane 71). Bumped 2550 →
  2575 (lane 69) → 2650 (lane 70), tracking the
  chosen-X / additional-costs / affinity / grants /
  counter-ledger / cast-from-zone /
  mana-restriction / copy-permanent family on the
  same trajectory.

### Process notes carried from the Wave 4.8 follow-up 5 loop

- **Lane 69 (mana restriction)** was the most
  invasive of the three lanes — the cast path runs
  through three layers (`canCastSpell`,
  `validationService.validateManaCost`,
  `castSpell` affordability + deduction) and the
  StackObject type gained a new optional
  `manaRestriction` field. The validation-service
  pre-check was the second surface that needed
  updating — exactly the lane 68 process note
  about "extending a multi-layer cast path requires
  updating both surfaces." The bug-debug journey:
  the lane 69 test initially called
  `createCardInstance` with positional arguments
  swapped (object as options, options as cardData),
  which silently dropped `mana_cost` and made the
  cost-validation check pass with 0 total mana to
  spend — a great object lesson in why the lane 68
  process note about cross-checking imports / arg
  shapes matters. Caught it on the second local
  run; typecheck + lint + budget + ratchet all
  passed clean on the same commit.

- **Lane 70 (copy permanent)** is a new op on
  `EffectSchema`. The `case "CopyPermanent":` branch
  in `interpret.ts#applyEffect` auto-picks the
  first matching permanent (APNAP-ordered) when no
  explicit target is chosen. The per-op reference
  module (`ops/copy-permanent.ts` + registry entry)
  is required to keep the LLM-drafted scripts
  pipeline in sync — the `covers every op the schema
accepts` test enforces parity. The bump to the
  engine-size budget (2575 → 2650) was in the same
  commit.

- **Lane 71 (protection-from static)** is a
  per-instance ledger stamped by
  `refreshScriptedStatics` (parallel to lane 52
  `chosenTypeAdditions` / lane 55
  `chosenColorAdditions` / lane 65
  `grantedTriggers`). The change-detection diff
  compares sorted arrays element-by-element so the
  refresh pass only re-stamps when the protection
  actually changed. The `hasProtectionFrom` helper
  in `evergreen-keywords.ts` consults the field
  alongside the strict parsed-keyword check and the
  regex fallback — a creature with
  `protectionFrom: ["red"]` picks up the protection
  immediately. Engine-size budget unchanged.

- The AI `forge-gate` / `forge-selfplay` /
  `expert-agent` "is deterministic for a seed" test
  is a known order-dependent flake on main. The
  Wave 4.8 follow-up 5 loop hit this flake ONCE on
  lane 71's full-suite run; the second run passed
  clean. The `gh run rerun --failed` fallback was
  not needed (the local re-run cleared it). Budget
  for 1-2 extra CI runs per lane to absorb the
  flake.

- Lane continue rule for the next session: lane 61
  (replacement effect for death) remains parked
  pending the foundational replacement-effect layer;
  lanes 72-76 (X-spent-on-creature-spells, copying
  a spell on the stack, multi-quality protection,
  until-end-of-turn copy, Aura-shaped
  protection-from) are NOT in scope — pick those up
  in a future Wave 4.8 follow-up 6 (or equivalent)
  handoff.

## Wave 4.8 follow-up 6 loop done summary

Lanes 72, 73, 74, and 76 shipped in the Wave 4.8
follow-up 6 loop (PRs #2753, #2754, #2755, #2756 — see
`docs/card-scripts/wave4.8-followup6-handoff.md` for
the handoff and this file for the prior loop's done
summary). Lane 75 ("until end of turn" copy) was
deferred as a multi-lane blocker per the handoff's
process note.

### Shipped

- **Lane 72 — X-spent-on-creature-spells
  (creature-payment family)** (PR #2753, #2614
  follow-up). Llawan, War Tax, the "tap an untapped
  creature you control rather than pay that cost"
  pattern. The v1 minimum adds a
  `creature_payment: { creature_only: true, generic:
number }` arm on `additionalCosts` (parallel to
  lane 69's `mana_restriction`). The engine
  auto-applies the creature payment when the printed
  cost isn't payable but the player CAN tap
  `generic` untapped creatures they control. The
  `castSpell` cost-payment validation AND the
  `validation-service.ts#validateManaCost` legality
  check both consume the new field (per the lane 68
  process note — multi-layer cast paths require
  updating both surfaces). The StackObject gained a
  new optional `creaturePayment?: { generic: number,
tappedCreatures: CardInstanceId[] }` field. The
  actual tap happens in the post-spend step
  (parallel to convoke/improvise). The bump to the
  engine-size budget (2650 → 2700) was in the same
  commit.

- **Lane 73 — Copying a spell on the stack
  (Splice, copy-with-new-targets)** (PR #2754, #2614
  follow-up). Double Vision, Reiterate, Pyromancer's
  Goggles, the "you may choose new targets for the
  copy" family. The v1 minimum is a wiring-cleanup
  - dedicated-test lane: the
    `CopySpellSchema.new_targets: true` field already
    exists (the substrate is the lane 33 Double Vision
    arm, CR 707.10d), the `copyTriggeringSpell`
    dispatch reads the flag and passes it to
    `copySpellOnStack`, and the underlying
    `copySpellOnStack` already accepts an optional
    `newTargets: Target[]` argument. v1 doesn't supply
    chosen targets (no player-facing retarget UI), so
    the copy inherits the original's targets — a
    forward-compatible signal that the engine
    acknowledged the "you may choose new targets"
    clause. A future lane can supply a `Target[]` list
    and `copySpellOnStack(state, sourceId, newTargets)`
    will pick it up. Sample cards
    (`cards/double_vision.json` and
    `cards/pyromancers_goggles.json`) already use the
    arm. Engine-size budget unchanged (the schema arm
    was already shipped with lane 33).

- **Lane 74 — Multi-quality protection** (PR #2755,
  #2614 follow-up). Akoumep Halberd, Niveous Wisps,
  the "creatures you control have protection from
  [color A] and from [color B]" family. The v1
  minimum is a test-suite addition: the schema
  (`StaticSchema.protectionFrom: string[]`) is
  already permissive (lane 71 substrate), and the
  engine's `hasProtectionFrom` in
  `evergreen-keywords.ts` already loops over the
  per-instance `protectionFrom: string[]` ledger via
  `perInstance.some((q) => q === color)`. Multi-
  quality protection is data-driven — no engine
  change is needed. Engine-size budget unchanged.

- **Lane 76 — Aura-shaped protection-from static**
  (PR #2756, #2614 follow-up). The "enchanted
  creature has protection from [quality]" pattern
  (Akoumep Halberd, Niveous Wisps). The v1 minimum
  adds a `protectionFrom: string[]` arm on
  `AuraStaticSchema` (parallel to lane 71's
  `StaticSchema.protectionFrom`). The engine
  (`refreshAuraBonuses` in
  `keyword-actions/aura-bonus.ts`) collects the
  qualities from each attached Aura's scripted
  static and stamps them on the enchanted card's
  per-instance `protectionFrom: string[]` ledger
  (parallel to the lane 65 `grantedTriggers` /
  lane 71 `protectionFrom` per-Aura pattern). The
  field is read by `hasProtectionFrom` via the
  existing `perInstance.some(...)` loop (no new
  engine code is needed for the per-instance check).
  Battlefield-zone-only semantics (cleared when the
  source Aura leaves the battlefield). The bump to
  the engine-size budget (2700 → 2750) was in the
  same commit.

### Blocked (multi-lane, tracked under #2614)

- **Lane 75 — "Until end of turn" copy**
  (Sakashima-style / manifested, Akoumep Halberd's
  "as long as this is in play, it's a copy of
  [chosen permanent]"). Foundational work for the
  until-EOT-copy family: requires a new
  `StaticSchema.become_copy: { target:
CardInstanceId, until: "end_of_turn" }` arm
  (parallel to lane 71's `protectionFrom`) AND
  per-instance stamping in
  `refreshScriptedStatics` (parallel to lane 66's
  `embedded_static` pattern) AND end-of-turn cleanup
  in `turn-phases.ts` (parallel to the
  `clearUntilEndOfTurnPT` /
  `clearUntilEndOfTurnKeywords` patterns in
  `pt-until-end-of-turn.ts`). Estimated 300-500 LOC
  - tests. Too large for the per-lane 40-turn
    budget; deferred to a future multi-lane plan.

  The handoff's "Lane is 'done' only when: CI green,
  PR merged, worktree removed, branch deleted, local
  main pulled and re-ratcheted" rule applies, so lane
  75 was held back rather than half-shipped.

- **Lane 61 — Replacement effect for death** (Whip of
  Erebos, False Dawn). Foundational replacement-
  effect layer; tracked separately per the Wave 4.8
  follow-up 2 handoff's process note. Not attempted
  in this loop.

### Test count snapshot

At the close of the Wave 4.8 follow-up 6 loop:

- **Test suites:** 729 (was 725 at the start of the
  loop; +4 for lanes 72 / 73 / 74 / 76 — 1 each)
- **Test cases:** 14118 (was 14094 at the start of
  the loop; +24 across the four lanes — 10 for lane
  72, 5 for lane 73, 4 for lane 74, 5 for lane 76)
- **Engine-size budget:** 2750 / 2750 lines for
  `schema.ts` (was 2650 at the start of the loop;
  +100 across the four shipped lanes — +48 for lane
  72, +0 for lane 73 (no schema change), +0 for lane
  74 (no schema change), +33 for lane 76, +0 for
  lane 75 (deferred)). Bumped 2650 → 2700 (lane 72)
  → 2750 (lane 76), tracking the chosen-X /
  additional-costs / affinity / grants /
  counter-ledger / cast-from-zone /
  mana-restriction / copy-permanent /
  creature-payment / aura-protection family on the
  same trajectory.

### Process notes carried from the Wave 4.8 follow-up 6 loop

- **Lane 72 (creature payment)** is the most
  invasive of the shipped lanes — the cast path
  runs through three layers (`canCastSpell`,
  `validationService.validateManaCost`,
  `castSpell` affordability + deduction) and the
  StackObject type gained a new optional
  `creaturePayment` field. The validation-service
  pre-check was the second surface that needed
  updating (per the lane 68 / lane 69 process note:
  multi-layer cast paths require updating both
  surfaces). The actual tap happens in the
  post-spend step (parallel to convoke/improvise),
  with a new `creaturePaymentTappedCreatures`
  collection array to track the tapped creature
  IDs. Bumped the engine-size budget in the same
  commit (per the handoff's process note).

- **Lane 73 (copy-spell on stack)** is a
  wiring-cleanup + dedicated-test lane. The
  schema arm and dispatch already exist (lane 33
  substrate, CR 707.10d); the only changes were
  making the existing `void newTargets;` no-op
  explicit (so a future lane can supply a `Target[]`
  list without re-touching the call site) and
  adding a dedicated test file
  (`lane73-copy-spell-on-stack.test.ts`, 5 cases).
  The v1 minimum is "the copy inherits the
  original's targets" — the player-facing retarget
  UI is a follow-up lane.

- **Lane 74 (multi-quality protection)** is the
  smallest of the explicitly multi-lane cases. The
  schema is already permissive
  (`StaticSchema.protectionFrom: string[]`); the
  per-instance check is data-driven via
  `perInstance.some((q) => q === color)`. No engine
  changes needed; just a test-suite addition
  (4 cases). Engine-size budget unchanged.

- **Lane 76 (aura protection)** is a parallel
  implementation of lane 71 on `AuraStaticSchema`.
  The engine reads the new `protectionFrom` arm
  from each attached Aura's scripted static, collects
  the qualities onto the enchanted card's
  per-instance `protectionFrom: string[]` ledger,
  and stamps the field (parallel to the lane 65
  `grantedTriggers` per-Aura pattern). The diff at
  the bottom of `refreshAuraBonuses` compares sorted
  arrays element-by-element; the field is dropped
  when the source Aura leaves the battlefield.
  Bumped the engine-size budget in the same
  commit (per the handoff's process note).

- The AI `forge-gate` / `forge-selfplay` /
  `expert-agent` "is deterministic for a seed" test
  is a known order-dependent flake on main. The
  Wave 4.8 follow-up 6 loop hit this flake ONCE on
  lane 72's full-suite run; the second run passed
  clean. The `gh run rerun --failed` fallback was
  not needed (the local re-run cleared it). Budget
  for 1-2 extra CI runs per lane to absorb the
  flake.

- Lane continue rule for the next session: lane 75
  ("until end of turn" copy) is deferred as a
  multi-lane blocker per the handoff's "Lane is
  'done' only when: CI green, PR merged, worktree
  removed, branch deleted, local main pulled and
  re-ratcheted" rule. Lane 61 (replacement effect
  for death) remains parked pending the
  foundational replacement-effect layer. Both
  blocks are NOT in scope for a follow-up session
  — they require their own multi-lane plans.

- Test-count-ratchet: the `test-count-docs-guard`
  CI gate re-measures live Jest and fails on any
  drift in `docs/onboarding.md` or
  `docs/TEST_VIDEO_FIXTURES.md`. The ratchet was
  applied in the same commit as each lane's test
  count change (per the handoff's process note).
  When the lane 74 PR (PR #2755) was merged, the
  doc block had a conflict with the just-merged
  lane 73 baseline; the resolution kept the higher
  value (14109) and the post-merge ratchet rewrote
  both files to 14113 (post-lane-74).

## Wave 4.8 follow-up 7 loop done summary (lane 75)

Lane 75 ("until end of turn" copy) shipped in the Wave 4.8
follow-up 7 loop (PR #2757, #2614 follow-up — see
`docs/card-scripts/wave4.8-followup7-handoff.md` for the
handoff). Lane 61 (replacement effect for death) remains
parked pending the foundational replacement-effect layer
(per the Wave 4.8 follow-up 2 handoff's process note) and
was NOT attempted in this loop — it requires its own
multi-lane plan, not a follow-up lane.

### Shipped

- **Lane 75 — "Until end of turn" copy**
  (Sakashima-style / manifested, disposition-of-copy)
  (PR #2757, #2614 follow-up). The v1 minimum adds a
  `become_copy: { target: CardInstanceId, until:
"end_of_turn" }` arm on `StaticSchema` (parallel to
  lane 71's `protectionFrom`). The engine stamps the
  target's printed characteristics (name, type_line,
  power, toughness, colors, keywords) onto the source's
  `cardData` via the existing `animatedUntilEndOfTurn`
  infrastructure (the
  `clearUntilEndOfTurnPT` /
  `restoreAnimatedOffBattlefield` rollback paths handle
  the EOT cleanup automatically). The overlay is
  self-correcting: if the named target leaves the
  battlefield, the source restores its printed
  `cardData` from `animatedUntilEndOfTurn`. The new
  `CardInstance.copyOfTargetId?: string` ledger
  records which target the source is currently copying.
  v1 is self-only (`source === target` for the static
  to apply, parallel to lane 52's `add_creature_type`
  self-only semantics). 9-case dedicated test
  (`lane75-until-eot-copy.test.ts`) covers schema
  rejection (empty target, non-end_of_turn duration),
  schema acceptance, characteristic overlay (Grizzly
  Bears copy), keyword copy (Serra Angel flying /
  vigilance), missing-target no-op, target-leaves-
  battlefield rollback, EOT cleanup rollback, and
  self-only semantics (no copy onto other permanents).
  Engine-size budget bumped 2750 → 2800 (schema.ts
  landed at 2790, +40 over 2750).

### Net delta from Wave 4.8 follow-up 6 loop

- Test suites: 729 → 730 (+1 for lane 75).
- Test cases: 14118 → 14127 (+9 for lane 75).
- Engine-size budget: schema.ts 2733 (lane 76
  baseline) → 2790 (+57 across lane 75 incl. the
  docstring block for the new arm). Under the 2800
  ceiling bumped in lane 75.

### Multi-lane follow-ups still open (tracked under #2614)

The handoff explicitly enumerated these as out-of-scope
for lane 75 (each is a separate multi-lane piece):
chosen-target copies (Cackling Counterpart), named-card
copies ("becomes a copy of [card name]"), copy-with-
exception copies (Phyrexian Metamorph-style "in addition
to its other types"), nested copies (a target that
itself has a `become_copy` static — needs cycle
detection), and Aura-shaped copies ("enchanted creature
is a copy of [target] until end of turn" — a per-target
instead of self-only shape).

Wave 4.8 follow-up 7 loop is complete. Lane 61 (replacement
effect for death) is parked; it requires its own
multi-lane plan with a foundational replacement-effect
layer (#2614 plan).
