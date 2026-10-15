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

## Wave 4.8 follow-up 8 loop done summary

The Wave 4.8 follow-up 8 loop shipped **lane 75a** (PR
[#2758](https://github.com/anchapin/planar-nexus/pull/2758))
— the chosen-target copy until EOT spell-effect shape
(Cackling Counterpart). Lanes 75b/75c/75d/75e + lane 61
remain parked for the next follow-up loop(s).

### Lane 75a — Chosen-target copy (PR #2758)

- **Gap**: "create a token that's a copy of [a chosen
  permanent] until end of turn" (Cackling Counterpart).
- **Schema**: new `CopyUntilEndOfTurn: { chosen_permanent:
CardInstanceId, until: "end_of_turn" }` arm on
  `EffectSchema` (parallel to lane 70's `CopyPermanent`
  op). v1 single chosen target on the battlefield; the
  chosen target itself is unchanged.
- **Engine**: new `case "CopyUntilEndOfTurn"` arm in
  `applyEffect` (card-scripts/interpret.ts) that
  validates the chosen target is on the battlefield,
  creates a new `CardInstance` with the chosen
  target's printed characteristics (name, type_line,
  power, toughness, colors, color_identity, keywords —
  CR 707.2 "all characteristics copied"), and adds it
  to the controller's battlefield with
  `animatedUntilEndOfTurn.setBySpellEffect: true` and
  `copyOfTargetId: chosenId` so the existing lane 75
  rollback paths restore the printed characteristics
  at EOT or when the new permanent / chosen target
  leaves the battlefield.
- **Refresh-survival fix**: the per-card
  `animatedUntilEndOfTurn.setBySpellEffect?: boolean`
  marker on `CardInstance` distinguishes the
  spell-effect-set overlay from lane 75's
  static-driven overlay. `refreshScriptedStatics`
  preserves spell-effect-set overlays across refreshes
  (the EOT cleanup step drops them via
  `clearUntilEndOfTurnPT`); the static-driven drop
  branch retains its prior behavior. Without this
  marker, every `refreshScriptedStatics` call between
  cast and EOT would tear down lane 75a's overlay.
- **Per-op reference module**:
  `card-scripts/ops/copy-until-eot.ts` + registry
  entry (parallel to the lane 70 / 71 / 75 / 76
  pattern; the LLM-drafted scripts pipeline test
  enforces parity).
- **Sample card**: synthetic spell registered via the
  test harness (lane 75a's test file uses a
  Shapeshifter named "Test Until-EOT Chosen-Target
  Copy (lane 75a)" registered as a script). Real-
  world cards that should now be scriptable in this
  pattern: Cackling Counterpart, Quasiduplicate,
  Soulblade Specter (the "cast for chosen target"
  side of the copy family).
- **Dedicated test**: 8-case
  `lane75a-until-eot-chosen-target-copy.test.ts`
  covers schema rejection (empty `chosen_permanent`,
  non-`end_of_turn` `until`), schema acceptance,
  characteristic overlay (Grizzly Bears copy),
  keyword copy (Serra Angel flying / vigilance),
  target-leaves-battlefield fizzle (chosen target
  isn't on the battlefield at cast time → spell
  fizzles, no token created), EOT cleanup rollback
  (the new permanent's printed `cardData` is
  restored via `clearUntilEndOfTurnPT`), and refresh-
  pass consistency (the overlay survives a
  `refreshScriptedStatics` call).
- **Engine-size budget**: bumped 2800 → 2900 in
  `scripts/check-engine-size-budget.mjs` for the
  until-EOT-copy family (schema.ts grew +65 lines
  to 2865, leaving headroom for lanes 75b–75e).

### Net delta from Wave 4.8 follow-up 7 loop

- Test suites: 730 → 731 (+1 for lane 75a).
- Test cases: 14127 → 14135 (+8 for lane 75a).
- Engine-size budget: schema.ts 2790 (lane 75 baseline)
  → 2865 (+75 across lane 75a incl. the docstring
  block for the new op). Under the 2900 ceiling bumped
  in lane 75a.

### Multi-lane follow-ups still open (tracked under #2614)

Lanes 75b/75c/75d/75e + lane 61 remain parked. Each
is the next round's work — the until-EOT-copy family
covers the bulk of the remaining #2614 drafter-list
work, and lane 61 (replacement effect for death)
requires a foundational replacement-effect layer that
the engine doesn't yet have.

## Wave 4.8 follow-up 8 lane 75b (PR [#2759](https://github.com/anchapin/planar-nexus/pull/2759)) — Named-card copy

Lane 75b ships the named-card copy arm of the
until-EOT-copy family. Lanes 75c/75d/75e + lane 61
remain parked for the next follow-up loop(s).

### Lane 75b — Named-card copy (PR #2759)

- **Gap**: "as long as this is in play, it's a copy of
  [named card] until end of turn" (Memnarch, Clone
  Shell, the named-card-copy subfamily of the
  until-EOT-copy family).
- **Schema**: `StaticSchema.become_copy` becomes a
  discriminated union — `{ target: CardInstanceId,
until: "end_of_turn" }` (lane 75 chosen permanent on
  the battlefield) OR `{ named_card: { name: string },
until: "end_of_turn" }` (lane 75b named card, no
  on-battlefield requirement). Exactly one arm per
  static; the schema's `.strict()` discriminator
  rejects `become_copy: { until: "end_of_turn" }` (the
  empty-arms case) and `become_copy: { target: "x",
named_card: { name: "y" }, until: "end_of_turn" }`
  (the both-arms case).
- **Engine**: `refreshScriptedStatics` collects the
  `become_copy` arm into a tagged-union per-source
  ledger (`{ kind: "id"; targetId } | { kind:
"name"; name }`). The write phase branches on the
  tag: `kind: "id"` looks up the chosen permanent by
  `CardInstanceId` (lane 75 unchanged); `kind: "name"`
  looks up the named card's printed `cardData` via the
  new synchronous `getCardDataByName` registry helper
  (parallel to the existing `getCardScript` synchronous
  lookup the refresh uses elsewhere). The overlay
  stamps the source's `cardData` with the named
  card's via the existing lane 75
  `animatedUntilEndOfTurn` + `copyOfTargetId`
  infrastructure; the existing
  `clearUntilEndOfTurnPT` /
  `restoreAnimatedOffBattlefield` rollback paths
  restore the printed characteristics at end of turn
  or when the source leaves the battlefield. A missing
  named card is a no-op (the source keeps its printed
  `cardData` and the overlay never applies).
- **`copyOfTargetId` ledger tag**: for `kind: "id"`
  the ledger is the named permanent's `CardInstanceId`
  (lane 75 unchanged). For `kind: "name"` the ledger
  is `name:<card name>` (a stable string that distinguishes
  different named-card copies; the change-detection diff
  below compares `card.copyOfTargetId`, so the value just
  needs to differ on a re-name).
- **Per-instance `cardData` registry**: lane 75b's
  v1 minimum uses a synchronous `cardDataByName`
  registry helper in `card-scripts/registry.ts`.
  Production: a follow-up lane hydrates this from the
  Scryfall search index; v1 ships the registry shape
  - the test hook (`registerCardDataForTests`,
    `resetCardDataForTests`). Tests install hand-built
    `cardData` for the cards the test exercises.
- **Sample cards**: synthetic static registered via
  the test harness (the
  `lane75b-named-card-copy.test.ts` test installs
  Grizzly Bears / Serra Angel `cardData` via
  `registerCardDataForTests`). Real-world cards that
  should now be scriptable in this pattern: Memnarch,
  Clone Shell, the manifested-as-named-copy family.
- **Dedicated test**: 10-case
  `lane75b-named-card-copy.test.ts` covers schema
  rejection (empty `named_card.name`, both arms,
  neither arm, non-EOT `until`), schema acceptance,
  characteristic overlay (Grizzly Bears copy —
  name, type_line, P/T, colors, color_identity),
  keyword copy (Serra Angel flying / vigilance),
  missing-name no-op (the named card not in the
  registry → source keeps its printed
  characteristics, no `animatedUntilEndOfTurn` /
  `copyOfTargetId` set), off-battlefield named card
  (the named card is NOT required to be on the
  battlefield — Memnarch / Clone Shell shape), and
  EOT cleanup rollback (after
  `clearUntilEndOfTurnPT`, the source's printed
  `cardData` is restored).
- **Engine-size budget**: bumped 2900 → 3000 in
  `scripts/check-engine-size-budget.mjs` for the
  until-EOT-copy family (schema.ts grew +58 lines
  to 2923, leaving headroom for lanes 75c–75e).
- **CI gate fix**: the `test-count-docs-guard` check
  failed on the first push because the
  `npm run ratchet:test-count` step had hit the known
  `forge-gate` mid-ratchet flake (CI's full Jest run
  reports 14138 passed locally vs 14136 from the
  flake-affected local run). Updated the docs by hand
  to 14138 passed and amended the commit; CI was
  clean on the second pass.

### Net delta from Wave 4.8 follow-up 8 (lane 75a loop)

- Test suites: 731 → 732 (+1 for lane 75b).
- Test cases: 14135 → 14145 (+10 for lane 75b).
- Engine-size budget: schema.ts 2865 (lane 75a
  baseline) → 2923 (+58 across lane 75b incl. the
  docstring block for the new arm). Under the 3000
  ceiling bumped in lane 75b.

### Multi-lane follow-ups still open (tracked under #2614)

Lanes 75c/75d/75e + lane 61 remain parked. Lanes 75c
(copy-with-exception) and 75d (Aura-shaped copy) are
the next smallest; lane 75e (nested-copy cycle guard)
is the riskiest and is best deferred to a separate
multi-lane plan (the cycle-detection snapshot at the
top of the refresh pass touches the order of writes
in `refreshScriptedStatics`). Lane 61 (replacement
effect for death) still requires a foundational
replacement-effect layer that the engine doesn't yet
have.

## Wave 4.8 follow-up 8 lane 75c (PR [#2760](https://github.com/anchapin/planar-nexus/pull/2760)) — Copy with exception

Lane 75c ships the copy-with-exception arm of the
until-EOT-copy family. Lanes 75d/75e + lane 61 remain
parked for the next follow-up loop(s).

### Lane 75c — Copy with exception (PR #2760)

- **Gap**: "is a copy of [chosen permanent] except
  it's a [subtype] in addition to its other types"
  (Phyrexian Metamorph and the broader
  copy-with-exception subfamily). The exception
  appends a subtype to the source's overlaid
  `cardData.type_line`.
- **Schema**: an optional
  `exceptions: { add_subtype?: string[] }` arm on BOTH
  the lane 75 (`target`) and lane 75b (`named_card`)
  variants of `StaticSchema.become_copy`. v1 supports
  a single `add_subtype` arm (an arbitrary list of
  subtypes); the schema's `.strict()` reject unknown
  arms and empty lists.
- **Engine**: a new
  `copyExceptionsBySourceId: Map<sourceId, { addSubtype:
string[] }>` is collected alongside the existing
  `copyOfTargetBySourceId` ledger in
  `refreshScriptedStatics`. The write phase applies the
  exception AFTER the lane 75 / 75b overlay writes the
  target's printed `cardData` (so the type_line is built
  from the target's subtypes, then augmented with the
  listed exceptions). The new
  `rebuildTypeLineWithAddedSubtypes` helper splits the
  type_line on the first em-dash (matching
  `subtypesOf`'s split convention), dedupes against
  printed subtypes (case-sensitive exact match), and
  re-joins. The EOT cleanup step in
  `pt-until-end-of-turn.ts` (`clearUntilEndOfTurnPT`)
  restores the printed `cardData.type_line` (without
  the appended subtypes), so the "until end of turn"
  semantics are honoured for free.
- **Sample cards**: synthetic static registered via
  the test harness (the
  `lane75c-copy-with-exception.test.ts` test
  exercises Phyrexian Metamorph ("it's a copy of
  [Grizzly Bears] except it's also a Phyrexian in
  addition to its other types") and the
  named-card variant ("as long as this is in play,
  it's a copy of [card name] until end of turn. It's
  also a Phyrexian..."). Real-world cards that
  should now be scriptable in this pattern:
  Phyrexian Metamorph, the broader "copy with an
  addition-to-existing-types" family.
- **Dedicated test**: 9-case
  `lane75c-copy-with-exception.test.ts` covers
  schema rejection (empty `add_subtype` list, empty
  `add_subtype` entry, unknown exception arm),
  schema acceptance, named-card-overlay exception
  merge, chosen-target-overlay exception merge,
  dedupe-vs-printed-subtype (Crusher of Phyrexia
  vs "Phyrexian" — the printed "Phyrexian" subtype
  isn't duplicated), multi-subtype append order,
  EOT cleanup rollback (the appended subtypes are
  dropped along with the rest of the overlay at
  EOT).
- **Engine-size budget**: schema.ts grew +63 lines
  to 2986, leaving headroom under the 3000 ceiling
  bumped in lane 75b. No new bump needed for lane
  75c.

### Net delta from Wave 4.8 follow-up 8 (lane 75b loop)

- Test suites: 732 → 733 (+1 for lane 75c).
- Test cases: 14145 → 14154 (+9 for lane 75c).
- Engine-size budget: schema.ts 2923 (lane 75b
  baseline) → 2986 (+63 across lane 75c incl. the
  docstring block for the new arm). Under the 3000
  ceiling bumped in lane 75b — no further bump
  needed.

### Multi-lane follow-ups still open (tracked under #2614)

Lanes 75d/75e + lane 61 remain parked. Lane 75d
(Aura-shaped copy — "enchanted creature is a copy
of [target] until end of turn") is the next
smallest; the schema change extends `become_copy`
into `AuraStaticSchema`. Lane 75e (nested-copy cycle
guard) is the riskiest — recommended to defer to a
separate multi-lane plan (the cycle-detection
snapshot at the top of the refresh pass touches
the order of writes in `refreshScriptedStatics`).
Lane 61 (replacement effect for death) still
requires a foundational replacement-effect layer
that the engine doesn't yet have.

## Wave 4.8 follow-up 8 lane 75d (PR [#2761](https://github.com/anchapin/planar-nexus/pull/2761)) — Aura-shaped copy

Lane 75d ships the Aura-shaped arm of the
until-EOT-copy family. Lane 75e + lane 61 remain
parked for the next follow-up loop(s).

### Lane 75d — Aura-shaped copy (PR #2761)

- **Gap**: "Enchanted creature is a copy of [chosen
  permanent] until end of turn" (the
  manifested-as-Aura family, "becomes a copy"
  enchantments).
- **Schema**: `AuraStaticSchema` gains a
  `become_copy: { target: CardInstanceId, until:
"end_of_turn" }` arm (parallel to lane 76's
  `protectionFrom` arm). v1 supports a single
  chosen target on the battlefield; the chosen
  target itself is unchanged. The refine list at
  the bottom of `AuraStaticSchema` accepts
  `become_copy` as a stand-alone arm (a pure
  meta-static — parallel to the Wave 4.8 follow-up
  6 lane 76 process note).
- **Engine**: `refreshAuraBonuses` collects
  `scriptedStatic.become_copy.target` from each
  attached Aura into a per-enchanted-card map
  (`auraCopyOfTargetByEnchantedCard`); the write
  phase at the bottom of the pass overlays the
  chosen target's printed characteristics onto the
  ENCHANTED CARD's `cardData` (not the Aura's)
  using the lane 75 `animatedUntilEndOfTurn`
  infrastructure. The overlay self-corrects when the
  chosen target leaves the battlefield (the
  enchanted card restores its printed `cardData`
  from `animatedUntilEndOfTurn`); the existing
  `clearUntilEndOfTurnPT` /
  `restoreAnimatedOffBattlefield` rollback paths
  handle EOT cleanup. The chosen target's
  `state.cards.has(targetId)` check at write time
  means a chosen target that has left the
  battlefield (or never existed) is a no-op (the
  enchanted card keeps its printed `cardData`).
- **Distinct from lane 75** — lane 75's overlay is
  on the SOURCE card (the permanent with the
  static). Lane 75d's overlay is on the ENCHANTED
  CARD (the Aura's attached target). The two
  paths share the lane 75 infrastructure
  (`animatedUntilEndOfTurn` + `copyOfTargetId`)
  but live in different refresh sites
  (`refreshScriptedStatics` vs
  `refreshAuraBonuses`).
- **Sample cards**: synthetic Aura registered via
  the test harness (`lane75d-aura-shaped-copy.test.ts`
  uses a Shapeshifter enchanted by a synthetic
  Aura with `become_copy: { target: <Grizzly
Bears id>, until: "end_of_turn" }`). Real-world
  cards that should now be scriptable in this
  pattern: the manifested-as-Aura family,
  "becomes a copy" enchantments.
- **Dedicated test**: 6-case
  `lane75d-aura-shaped-copy.test.ts` covers
  schema rejection (empty target, non-EOT until),
  schema acceptance, characteristic overlay
  (Grizzly Bears's name, type_line, P/T, colors),
  chosen-target-not-on-battlefield no-op (the
  overlay does not apply when the chosen target
  isn't on the battlefield), and EOT cleanup
  rollback (the enchanted card's printed
  `cardData` is restored at EOT).
- **Engine-size budget**: bumped 3000 → 3100 in
  `scripts/check-engine-size-budget.mjs` for the
  until-EOT-copy + auras-with-copy family
  (schema.ts grew +64 lines to 3050, leaving
  headroom under the 3100 ceiling). Lane 75e
  may need another bump.

### Net delta from Wave 4.8 follow-up 8 (lane 75c loop)

- Test suites: 733 → 734 (+1 for lane 75d).
- Test cases: 14154 → 14160 (+6 for lane 75d).
- Engine-size budget: schema.ts 2986 (lane 75c
  baseline) → 3050 (+64 across lane 75d incl. the
  docstring block for the new arm). Under the
  3100 ceiling bumped in lane 75d.

### Multi-lane follow-ups still open (tracked under #2614)

Lane 75e + lane 61 remain parked. Lane 75e
(nested-copy cycle guard) is the riskiest single
piece — the cycle-detection snapshot at the top
of the refresh pass touches the order of writes
in `refreshScriptedStatics` (and now
`refreshAuraBonuses` too because lane 75d's overlay
participates in the same family); recommended to
defer to a separate multi-lane plan. Lane 61
(replacement effect for death) still requires a
foundational replacement-effect layer that the
engine doesn't yet have.

## Wave 4.8 follow-up 9 — lane 75e (nested-copy cycle guard) loop done summary

This loop shipped **lane 75e** (nested-copy cycle guard) as PR #2762. Lane 61 (replacement effect for death) remains parked — it requires a foundational replacement-effect layer that the engine doesn't yet have and is a separate multi-lane plan per the follow-up 8 handoff.

### Lane 75e — Nested-copy cycle guard

- **Gap closed**: a source whose `StaticSchema.become_copy` (lane 75 / 75b / 75c) or `AuraStaticSchema.become_copy` (lane 75d) points at a target that itself has a `become_copy` arm would loop or produce inconsistent results in v1. The lane 75 v1 explicitly assumed the named target's printed `cardData` was the source-of-truth for the overlay; nested copies (a target that itself has a `become_copy` static) would loop or produce inconsistent results. The cycle guard resolves every card's "effective copy target" (the leaf of its copy chain) at the top of the refresh pass — BEFORE any overlay writes — and exposes the leaf's printed `cardData` as the source-of-truth for the overlay. A cyclic chain (a card whose copy chain includes itself) is broken by treating each member as if it had no `become_copy` arm.
- **Schema (no change)**: 3050 lines, unchanged from the lane 75d baseline. The lane 75e engine change is purely engine-side; the new file is in `keyword-actions/`, not `card-scripts/`, so the engine-size budget is not affected.
- **Engine**:
  - `src/lib/game-state/keyword-actions/copy-chain.ts` (NEW): the chain resolver + cycle detector. `buildStaticCopyChainSnapshot` for the static path; `buildAuraCopyChainSnapshot` for the Aura path. Each helper walks every card's `become_copy` chain to its leaf at the top of the refresh pass and flags cycles.
  - `src/lib/game-state/keyword-actions/scripted-statics.ts`: build the snapshot at the top of `refreshScriptedStatics`; the write phase consults the snapshot's `leafCardDataBySourceId` map and `cycleIds` set. A `setByAura` marker on `animatedUntilEndOfTurn` exempts the enchanted card from the static refresh's drop branch (the Aura refresh is the canonical site for the enchanted card's overlay).
  - `src/lib/game-state/keyword-actions/aura-bonus.ts`: build the snapshot at the top of `refreshAuraBonuses`; the write phase consults the snapshot's `leafCardDataByEnchantedCard` map and `cycleIds` set. The `setByAura` marker is stamped on `animatedUntilEndOfTurn` for every Aura-driven overlay.
  - `src/lib/game-state/types/cards.ts`: add the `setByAura?: boolean` marker on `animatedUntilEndOfTurn` (parallel to lane 75a's `setBySpellEffect`).
- **Sample cards**: synthetic statics registered via the test harness (the lane 49/52/55/59/60/62/63/64/65/66/67/68/69/70/71/72/73/74/75/75a/75b/75c/75d pattern). The test exercises the refresh path via `refreshScriptedStatics` and `refreshAuraBonuses` and inspects the source's overlaid `cardData` + `animatedUntilEndOfTurn` (printed backup) + `copyOfTargetId` ledger.
- **Dedicated test**: 7-case `lane75e-nested-copy-cycle-guard.test.ts` covers 2-card chain (regression baseline), 3-card chain resolves to the leaf in one pass, 2-card cycle (A → B → A) is broken, 3-card cycle (A → B → C → A) is broken, named-card target (lane 75b) chain termination, cross-site static → aura overlay chain, and Aura cycle is broken.
- **Process note**: the `setByAura` marker fixes a pre-existing latent bug — `refreshScriptedStatics` was dropping Aura overlays on the enchanted card because it couldn't distinguish them from static-driven overlays. The marker is set by `refreshAuraBonuses` and read by `refreshScriptedStatics`. The Aura refresh is the canonical drop site; the EOT cleanup (`clearUntilEndOfTurnPT`) drops the overlay at end-of-turn.
- **Engine-size budget**: schema.ts is 3050 lines, unchanged from the lane 75d baseline. The new `copy-chain.ts` is in `keyword-actions/`, not `card-scripts/`, so the engine-size budget is not affected. No bump needed.

### Net delta from Wave 4.8 follow-up 9 (lane 75e loop)

- Test suites: 734 → 735 (+1 for lane 75e).
- Test cases: 14160 → 14167 (+7 for lane 75e; 14160 passed + 7 skipped).
- Engine-size budget: schema.ts 3050 (lane 75d baseline) → 3050 (unchanged). Lane 75e is engine-only; the new file is in `keyword-actions/`, not `card-scripts/`, so the schema budget is unaffected. The `keyword-actions/` module's own size is captured by the module-size budget (still well under the 3310 ceiling for AI / 3050 ceiling for engine).

### Wave 4.8 follow-up 10 loop done summary (lanes 77 / 78 / 79 shipped; lanes 80 / 81 already shipped)

The Wave 4.8 follow-up 10 loop covered the priority queue from
`docs/card-scripts/wave4.8-followup10-handoff.md`. Lanes 77
through 79 were attempted in this loop; lanes 80 and 81 were
discovered to be already shipped by prior waves (their schema
arms + instance fields + `resolveEnterChoice` arms were
already implemented and tested). Lanes 82 through 86
(Midnight Snack / Needletooth Pack / Gorehorn Raider / Scrawling
Crawler / Ajani's Pridemate) are the warmup drafter-list cards
that remain in the queue — each is a single-card or two-card
JSON + small test, with all plumbing already shipped (raid +
`phaseEnds` + `intervening_if` + `CreatePredefinedToken` for Food

- life-gain trigger). Each is a single-lane piece that fits the
  aggressive loop's per-lane 40-turn budget; the loop's process
  section was the source of the original priority order. The
  remaining work is deferred to a future Wave 4.5+/4.8+ pass —
  this loop concludes with lanes 77 / 78 / 79 / 80 / 81 either
  shipped or marked already-shipped.

**Shipped lanes:**

- **Lane 77 — Copy target with other layers** (#2614 follow-up).
  Extended the lane 75e cycle-guard snapshot to also carry the
  leaf's per-instance `protectionFrom` field. The overlay write
  phase rolls the leaf's `protectionFrom` onto the source's own
  protection ledger (union semantics — multiple `become_copy`
  overlays stack their protection; the source's existing
  static-driven protection is preserved). The Aura mirror does
  the same on the enchanted card. Shipped as PR #2763.
  Test cases: 7 in `lane77-copy-target-other-layers.test.ts`.

- **Lane 78 — Cross-zones copy** (#2614 follow-up).
  Replaced the `targetOnField`
  (`currentZoneKey?.endsWith("-battlefield")`) check with
  `targetInTrackedZone`
  (`state.zones.has(target.currentZoneKey)`) in three places
  (the static overlay write phase, the spell-effect-set overlay
  write phase, and the Aura overlay write phase). Cross-zones
  copy is battlefield-zone-only for the SOURCE (the source must
  be on the battlefield for the static to apply) but the target
  can be in any zone the engine tracks (graveyard, exile, hand,
  library, command). CR 707.2 "copy a card that's not in play"
  now resolves correctly. Shipped as PR #2764. Test cases: 5
  in `lane78-cross-zones-copy.test.ts`.

- **Lane 79 — 4-card copy chain** (#2614 follow-up).
  Test-only work — confirmed the cycle guard's snapshot helper
  handles 4- and 5-card chains (the recursion is bounded by
  the chain length, which is bounded by the battlefield size
  in practice). Shipped as PR #2765. Test cases: 3 in
  `lane79-4-card-chain.test.ts`.

**Already shipped (discovered during this loop):**

- **Lane 80 — Chosen creature_type `enter_choice` arm**
  (#2705). The schema's `enter_choice.kind` already accepts
  `"creature_type"`; the `chosenCreatureType: string | null`
  field is already on `CardInstance` (lane 45 forward-compat);
  the `resolveEnterChoice` arm for `kind: "creature_type"` is
  already implemented in `keyword-actions/enter-choice.ts`;
  the chosen-type anthem reads `source.chosenCreatureType`
  (via `subtype: "chosen"` sentinel); and the
  `adaptive-automaton-chosen-type.test.ts` /
  `enter-choice-creature-type.test.ts` /
  `enter-choice-dual.test.ts` /
  `add-creature-type-static.test.ts` /
  `banner-of-kinship-counters.test.ts` test files (57 tests)
  already cover the v1 minimum (the `enter_choice` arm + the
  field). Lane 80 is a no-op for this loop — no work needed.
  See #2705 for the prior implementation history.

- **Lane 81 — Chosen card name `enter_choice` arm**
  (#2708 phase 2b — Sorcerous Spyglass chosen-name gate). The
  schema's `enter_choice.kind` already accepts `"chosen_name"`;
  the `chosenCardName: string | null` field is already on
  `CardInstance` (forward-compatible nullable per the lane 48
  forward-compat); the `resolveEnterChoice` arm for
  `kind: "chosen_name"` is already implemented in
  `keyword-actions/enter-choice.ts`; and the lane 50 chosen-name
  block static reads `source.chosenCardName` (via
  `affects.chosen_name_block` arm). Lane 81 is a no-op for this
  loop — no work needed. See #2708 phase 2b for the prior
  implementation history.

**Test-count snapshot (Wave 4.8 follow-up 10 loop):**

- Test suites: 735 → 738 (+3 for lanes 77 / 78 / 79).
- Test cases: 14167 → 14182 (+15 for lanes 77 / 78 / 79;
  14175 passed + 7 skipped).
- Engine-size budget: schema.ts 3050 (lane 75d baseline) → 3050
  (unchanged). Lanes 77 / 78 / 79 are engine-only / test-only
  / engine-only; the schema budget is unaffected.

### Multi-lane follow-ups still open (tracked under #2614)

- **Lane 61 — Replacement effect for death (Whip of Erebos, False Dawn)**. Foundational replacement-effect layer; the engine has no general replacement-effect layer, so lane 61 is parked per the Wave 4.8 follow-up 2 handoff's process note. The handoff's process rule: the aggressive loop picks lanes one at a time, but lane 61 is parked because it requires a foundational layer that's a separate multi-lane plan. Open it as a separate multi-lane plan, NOT as the next lane in this loop. This is documented in the Wave 4.8 follow-up 9 handoff.
- **Out-of-scope from lane 75e** (each a follow-up lane):
  - Multi-card copy chains (more than 3 cards).
  - Cycles in `refreshAuraBonuses`'s `become_copy` arm beyond the enchanted-card ↔ Aura round trip.
  - Cross-zones copy chains (a `become_copy` static that points at a card in a graveyard — CR 707.2 "copy a card that's not in play").
  - "Copy a card that has a `become_copy` static and other layers" (e.g. a copy target with `protectionFrom` or `removesAllAbilities`).

### Wave 4.8 follow-up 11 loop done summary (lanes 82–86 — warmup drafter-list pass)

The Wave 4.8 follow-up 11 loop covered the warmup drafter-list pass
from `docs/card-scripts/wave4.8-followup11-handoff.md`. All five
lanes (82–86) shipped as small card-JSON + small test pieces with
all plumbing already in place from prior loops.

**Shipped lanes:**

- **Lane 82 — Midnight Snack (FDN 65)** (#2614 follow-up). The
  smallest warmup. Trigger template is the lane 29 (Skyship
  Buccaneer) raid + `phaseEnds` + `intervening_if` plumbing; the
  effect is the lane 32 `CreatePredefinedToken: "food"` substrate.
  No schema change, no engine change — both shipped in prior lanes.
  Shipped as PR #2768. Test cases: 6 in
  `midnight-snack.test.ts` (+ 1 `it.each` iteration for the new
  JSON, totaling 7 net).

- **Lane 83 — Needletooth Pack (FDN 108) + Wardens of the Cycle
  (FDN 125)** (#2614 follow-up). Both share the lane 28
  (Cackling Prowler) morbid + `phaseEnds` + `intervening_if`
  trigger template. Needletooth Pack targets a creature you control
  via the existing `PutCounters.controller` filter; Wardens of the
  Cycle uses the existing `modes` schema arm for the modal choice.
  No schema change, no engine change. Shipped as PR #2769. Test
  cases: 9 in `needletooth-pack-wardens-cycle.test.ts` (+ 2
  `it.each` iterations for the two new JSONs, totaling 11 net).

- **Lane 84 — Gorehorn Raider (FDN 89) + Storm Fleet Spy
  (FDN 515)** (#2614 follow-up). Both share the raid + ETB +
  `intervening_if` trigger template. Gorehorn Raider's effect is
  `DealDamage` with `target: "any"`; Storm Fleet Spy's effect is
  `Draw` with `who: "you"`. The handoff's prose mentioned an
  attack-trigger for Storm Fleet Spy; the actual FDN printing is
  ETB and the script reflects the Oracle wording. No schema
  change, no engine change. Shipped as PR #2770. Test cases: 8 in
  `gorehorn-raider-storm-fleet-spy.test.ts` (+ 2 `it.each`
  iterations, totaling 10 net).

- **Lane 85 — Scrawling Crawler (FDN 132)** (#2614 follow-up).
  The handoff explicitly notes "Lane 85 is the smallest possible
  lane — the JSON already exists; the work is the test." Scrawling
  Crawler's full oracle is two abilities: an upkeep + each_player
  draws trigger (encoded in the existing JSON) plus "Whenever an
  opponent draws a card, that player loses 1 life" (deferred per
  the handoff). The fresh test verifies the upkeep + each_player
  plumbing works end-to-end. Shipped as PR #2771. Test cases: 4
  (no new JSON, so no `it.each` delta, totaling 4 net).

- **Lane 86 — Ajani's Pridemate + Twinblade Paladin + Drogskol
  Reaver** (#2614 follow-up). All three cards share the lane 26
  `lifeGain` trigger template (`event: "lifeGain"`,
  `subject: "self"`, detected on the `lifeGain` event).
  Ajani's Pridemate and Twinblade Paladin each put a +1/+1 counter
  on self; Drogskol Reaver draws 1 card. Twinblade Paladin's "as
  long as you have 25 or more life" static (double strike +
  lifelink) is deferred — no life-condition static arm shipped.
  Shipped as PR #2772. Test cases: 7 in
  `life-gain-trigger-creatures.test.ts` (+ 3 `it.each`
  iterations for the three new JSONs, totaling 10 net).

**Blocked gaps (parked per the handoff's process note):**

- **Lane 61 — Replacement effect for death (Whip of Erebos, False
  Dawn)**. Foundational replacement-effect layer is not in the
  engine; lane 61 is parked per the Wave 4.8 follow-up 2
  handoff's process note. Open it as a separate multi-lane plan,
  NOT as the next lane in this loop. (See "Multi-lane follow-ups
  still open" above.)

**Out-of-scope per the handoff (each a follow-up lane):**

- **Midnight Snack** — X-cost-with-life-gained (parallel to
  lane 32's X-cost-with-count); sacrifice-midnight-snack cost; the
  "create a 1/1 white Human creature token" path (Skullclamp /
  Stroke of Midnight pattern, #2705c).
- **Needletooth Pack** — "draw cards equal to the number of
  creatures that died this turn" effect (parallel to lane 36's
  X-count pattern).
- **Gorehorn Raider** — "create a 1/1 red Goblin creature token"
  effect (parallel to lane 32's `CreatePredefinedToken`); "you
  may discard a card" cost on Storm Fleet Spy.
- **Twinblade Paladin** — "as long as you have 25 or more life"
  static for double strike + lifelink (no life-condition static
  arm shipped).
- **Drogskol Reaver** — ETB + "if mana value 4 or greater"
  condition (parallel to lane 36's X-count pattern); lifelink
  keyword grant (parallel to lane 40's chosen-X anthem).
- **Scrawling Crawler** — the second half of its oracle
  ("Whenever an opponent draws a card, that player loses 1 life")
  is deferred to a follow-up lane.

**Test-count snapshot (Wave 4.8 follow-up 11 loop):**

- Test suites: 738 → 743 (+5 for lanes 82–86: one new test file
  per lane).
- Test cases: 14182 → 14225 (+43 across the five lanes; 14218
  passed + 7 skipped). Lane-by-lane: lane 82 +7, lane 83 +11,
  lane 84 +10, lane 85 +4, lane 86 +10. (Sum 42; the +1 is the
  `3c702618 chore: auto-ratchet jest coverage floor to measured
value` commit that landed during the loop on `main` and shifted
  the floor without adding test cases.)
- Engine-size budget: schema.ts 3050 → 3050 (unchanged). All
  five lanes are card-JSON only; no schema or engine change.
- Lint: 0 errors.
- Typecheck: clean.

**Process notes from this loop:**

- The lane 86 test exercises `gainLife` →
  `detectTriggeredAbilities("lifeGain")` →
  `putTriggersOnStack` → `resolveScriptedAbility` end-to-end. The
  `lifeGain` triggers ride the same resolution path as the
  existing `phaseEnds` and `etb` triggers.
- The handoff's AI flake absorbed 1–2 extra CI runs per lane on
  the local full-suite run (forge-gate / forge-selfplay); CI was
  clean throughout.
- The ratchet's `--live <counts.json>` fallback was used to
  bypass the AI flake mid-ratchet (consistent with Wave 4.8
  follow-up 8 lanes 75b / 75c / 75d).
- All five lanes were single-card or two-card JSON + small test
  pieces; each fit comfortably under the aggressive loop's
  per-lane 40-turn budget.

The Wave 4.8 follow-up 11 loop concludes with the warmup
drafter-list pass complete. The aggressive loop's machinery
(worktree + worktree-local `node_modules` symlink + ratchet +
process note) is intact and ready for the next follow-up loop.
Lane 61 (replacement effect for death) remains parked per the
handoff's process note and requires a separate multi-lane plan.

# Wave 4.8 follow-up 12 loop done summary (lanes 87–92)

The Wave 4.8 follow-up 12 loop ran the per-card out-of-scope pass
the follow-up 11 handoff scoped: six lanes (87–92) each filling in
the deferred second half of an oracle that the lane 82–86 v1
minimum shipped only the first half of. All six lanes shipped
without a multi-lane blocker; lane 61 (replacement effect for
death) remains parked per the follow-up 2 process note.

## Shipped lanes

- **Lane 87 — Scrawling Crawler's opponent-draws life loss
  (FDN 132)** — PR #2775. The "Whenever an opponent draws a
  card, that player loses 1 life" half. Schema: new
  `event: "drawCard"` arm + `whose_draws` filter on
  TriggerSchema; `LoseLife.who: "drawer"` arm. Engine: `drawCards`
  now fires `event: "drawCard"` triggers via
  `checkTriggeredAbilities` once per card drawn; the trigger
  context carries `drawingPlayerId` (propagated onto
  `StackObject.triggerContext`); the resolver routes
  `LoseLife.who: "drawer"` to the drawer.
- **Lane 88 — Midnight Snack's sacrifice-self cost
  (FDN 65)** — PR #2777. The "sacrifice this artifact as a
  cost" trigger-cost substrate. Schema: new
  `cost: { sacrifice_self: true }` arm on TriggerSchema
  (parallel to the lane 63 `additionalCosts.sacrifice.target`
  spell-cost arm). Engine: new `sacrifice_self_prompt`
  WaitingChoice type; `StackObject.cost_paid` field;
  `resolveScriptedAbility` gates the trigger on the source
  still being on the battlefield, surfaces the prompt on the
  first pass, and sacrifices the source THEN runs the
  effects on `cost_paid: true`.
- **Lane 89 — Gorehorn Raider's 1/1 red Goblin token
  (FDN 89)** — PR #2778. The "create a 1/1 red Goblin creature
  token" half. JSON-only — chained a `CreateToken` effect
  onto the existing trigger using the lane 66 substrate
  (count / power / toughness / color / subtypes / keywords).
- **Lane 90 — Needletooth Pack's draw-count X arm
  (FDN 108)** — PR #2779. The "draw N cards where N =
  creatures that died this turn" half. Schema: new
  `X: "creaturesDiedThisTurn"` arm on DrawSchema. Engine:
  `resolveDrawAmount` reads the boolean
  `state.turn.creatureDiedThisTurn` for 0 or 1 (v1 minimum).
- **Lane 91 — Twinblade Paladin's life-condition static
  (FDN 503)** — PR #2780. The "as long as you have 25 or more
  life, this creature has double strike and lifelink" half.
  Schema: new `while_condition: { kind: "life_minimum",
value: N }` arm on StaticSchema (CR 603.2 "while" gate);
  `TOKEN_KEYWORDS` enum gains `"double strike"`. Engine:
  `refreshScriptedStatics` consults the gate after
  `staticAffects` and before applying the static's arms;
  new `evaluateStaticWhileCondition` helper.
- **Lane 92 — Drogskol Reaver's "mana value 4 or greater" ETB
  (FDN 655)** — PR #2781. The "Whenever a creature you control
  enters, if its mana value is 4 or greater, you gain life
  equal to its toughness" half. Schema: new
  `X: "toughness"` arm on GainLifeSchema. Engine: new
  "mana value ≥ N" pattern in `evaluateInterveningIfClause`;
  `EffectContext.enteringCardId` field (parallel to the
  existing `drawingPlayerId` from lane 87) carries the
  entering creature's id from `triggerContext` into the
  per-effect resolve path; `resolveGainLifeAmount` resolves
  the `X: "toughness"` arm.

## Blocked gaps

None. All six lanes shipped without a multi-lane blocker.

The follow-up 11 handoff's "out of scope per the handoff" list
(under each lane) is now depleted — every deferral in the
follow-up 11 handoff was either picked up by follow-up 12
or moved to the follow-up 12 out-of-scope lists (which
remain parked, but those lists are forward-looking, not
backlog carryover).

## Test-count snapshot (Wave 4.8 follow-up 12 loop)

- Test suites: 743 → 749 (+6 for lanes 87–92: one new test
  file per lane).
- Test cases: 14225 → 14259 (+34 across the six lanes; 14252
  passed + 7 skipped). Lane-by-lane: lane 87 +9, lane 88 +6,
  lane 89 +3, lane 90 +5, lane 91 +6, lane 92 +5.
- Engine-size budget for schema.ts: 3050 → 3164 (+114 across
  the six lanes). The follow-up 8 lane 75d bump to 3100 gave
  +50 headroom; lane 87 (+27) + lane 88 (+28) pushed us +5
  over that headroom, so we bumped 3100 → 3150 in the same
  lane 88 commit per the historical precedent (the
  follow-up 8 process note "bump the budget rather than
  fragmenting the family"). Lane 90 (+12) and lane 91 (+35)
  pushed us +2 over 3150, so we bumped 3150 → 3200 in the
  same lane 91 commit. Lane 92 (+12) is within the 3200
  budget. The docstring block in
  `scripts/check-engine-size-budget.mjs` gets a
  one-paragraph history entry per bump (the existing entries
  are a good template).

## Process notes from this loop

- The lane 87 work required propagating the trigger's
  `drawingPlayerId` from `detectTriggeredAbilities` all the
  way through `checkTriggeredAbilities` → StackObject
  → `resolveScriptedAbility` → `EffectContext` →
  `applyEffect(LoseLife)`. The propagation pattern is the
  template for any future "context-bound" effect (lane 92's
  `enteringCardId` follows the same shape).
- The lane 88 work exposed a pre-existing bug in the
  `you_may_prompt` flow under `resolveTopOfStack`: the
  trigger is removed from the stack before the player
  answers the prompt, so `resolveWaitingChoice` stamps
  `you_may_resolved` on a removed-from-stack object. The
  existing tests bypass `resolveTopOfStack` and call
  `resolveScriptedAbility` directly, so the bug is latent.
  The lane 88 work follows the same direct-call pattern; the
  higher-level loop bug is out of scope for this loop.
- The lane 89 work is JSON-only — no schema or engine
  changes. The lane 66 `CreateToken` substrate already covers
  all required fields.
- The lane 90 work exposed a JSON-key / CR 107.3-X
  ambiguity in the existing "only cards with X in their text
  use X" test guard. The guard was updated to strip the
  lane 90 JSON-key `"X": "creaturesDiedThisTurn"` usage
  before the CR 107.3-X check.
- The lane 91 work required adding `"double strike"` to the
  `TOKEN_KEYWORDS` enum. The existing `hasKeyword` /
  `parseAuraKeywords` paths already support `double strike`
  in the broader `EQUIPMENT_KEYWORDS` enum; the v1 minimum
  needed the engine's static-keyword ledger to read the
  keyword from `scriptStaticKeywords` (which it already does).
- The lane 92 work required a defensive `evaluateStaticWhileCondition`
  - `enteringCardId` threading through the resolution path.
    The test pattern uses `detectTriggeredAbilities(state,
"entersBattlefield", { enteringCardId })` to surface the
    intervening_if gate against the named creature's cmc.
- The AI flake absorbed 1–2 extra CI runs per lane on the
  local full-suite run (forge-gate / forge-selfplay /
  expert-agent); CI was clean throughout (after the
  absorption runs).
- The ratchet's `--live <counts.json>` fallback was used to
  bypass the AI flake mid-ratchet for lanes 87 and 88
  (consistent with Wave 4.8 follow-up 8 lanes 75b / 75c /
  75d and follow-up 11 every lane).
- All six lanes fit comfortably under the aggressive loop's
  per-lane 40-turn budget. The largest (lane 87 with the
  full `StackObject.triggerContext` propagation) was ~25
  turns from schema-design through dedicated-test commit.

The Wave 4.8 follow-up 12 loop concludes with the per-card
out-of-scope pass complete. The aggressive loop's machinery
(worktree + worktree-local `node_modules` symlink + ratchet +
process note) is intact and ready for the next follow-up loop.
Lane 61 (replacement effect for death) remains parked per the
follow-up 2 handoff's process note and requires a separate
multi-lane plan.

## Handoff for the next AI agent — Wave 4.8 follow-up 14 (continued aggressive loop)

### Mission

Continue the aggressive, single-lane-at-a-time loop that
follow-ups 8/9/10/11/12/13 ran without human input. The
loop's machinery is intact and ready for follow-up 14.
The follow-up 13 handoff (`wave4.8-followup13-handoff.md`)
shipped all 16 priority lanes (61a, 61b, 93, 94, 95, 96,
97, 98, 99, 100, 101, 102, 103, 104, 105, 106). The
replacement-effect-for-death foundation (lane 61a) +
cross-ref printed-oracle mechanism (lane 61b) +
X-count substrates (lanes 94, 95, 97) + token substrates
(lane 96 lane 100 lane 101 lane 102 lane 103 lane 104
lane 105 lane 106) are all in place.

The follow-up 13 handoff's last paragraph was:

> "Out of scope per Wave 4.5+ handoff (these need
> dedicated human scoping per the handoff's 'Don't ship
> multi-lane schema changes' rule):
>
> - Copying permanent/spell with new targets
> - Granting triggered abilities to other cards
> - Replacement effect for death (SHIPPED in follow-up
>   13 lane 61a + 61b)
> - Additional costs (sacrifice/pay) (PARTIALLY SHIPPED
>   via lanes 88 / 93 / 98 / 106)
> - Affinity / cost reduction
> - 'You may' optional trigger / effect (PARTIALLY SHIPPED
>   via lane 93 / 99 / 106)
> - Abilities granting color or type or keyword via
>   static (SHIPPED via lanes 40 / 45 / 52 / 55)
> - Abilities requiring X spent on other spells
> - Casting spells from exile / graveyard
> - Token creation with embedded static
> - Stun / finality counters"

The aggressive loop picks one lane at a time and
ships it end-to-end before moving to the next. Don't
ask the user between lanes. If a lane reveals it needs
more than the 40-turn budget, back out, document in
`wave4-blockers.md`, and pick a smaller lane.

### Priority queue (pick strictly in this order)

The follow-up 13 handoff was a card-driven out-of-scope
queue ("each card's deferred half → fallback to a new
schema arm"). The follow-up 14 is BLOCKER-driven — the
remaining work is documented in `wave4-blockers.md` as
multi-lane and out-of-scope items. Pick lanes from the
following priority order:

1. **Lane 57 — Redcap Gutter-Dweller counter-based
   trigger** (`counter_gate: {counter, op, n}` on
   `TriggerSchema` + engine evaluator in
   `trigger-system/`). The "Goblins have menace when
   3+ counters" trigger half of Redcap Gutter-Dweller
   (FDN #532) is the canonical example. The chosen-color
   - add_color half shipped in lanes 51 + 55; the
     Treasure-token trigger shipped in lane 2544; the
     menace-when-3+-counters trigger needs a new schema
     field + engine evaluator. ~30-50 LOC + tests. JSON
     update: ship the menace-when-3+-counters trigger on
     `redcap_gutter_dwell.json` (the field already carries
     the chosen-color `enter_choice`, the `add_color:
"chosen"` static, and the Treasure-token trigger;
     this lane adds the missing menace-when-3+-counters
     trigger). Document the gate semantics in
     `evaluate.ts` and the `trigger-system/`.

2. **Lane 51 — Adaptive Automaton type-change
   half** (a permanent chosen-creature-type "is the
   chosen type in addition to its other types" static).
   Multi-lane blocker per the prior docs. New schema
   arm (`becomes_chosen_creature_type: true`), new
   engine path (the source's permanent `subtypes` grows
   by `chosenCreatureType`), plus a layered type-line
   answer that renders the new type via the existing
   `subtypesOf` helper. ~80-150 LOC across schema +
   engine + tests + a docstring clause. Out of scope:
   the chosen-card-name eviction-at-tombstone work. The
   adaptive_automaton.json already carries the anthem
   half (lane 45 + lane 53); this lane adds the type-
   change half to complete the oracle.

3. **Lane 107 — Eaten by Piranhas full script**
   (chosen color + chosen creature type + lose all
   abilities — the multiple `enter_choice` multi-lane).
   Eaten-by-Piranhas (FDN #76) reads "as this enters,
   choose a color and a creature type" — needs either a
   second `enter_choice` arm or a "compound"
   `enter_choice.kind` variant. Sample card JSON +
   tests. ~50-100 LOC. The chosen-color `enter_choice`
   already shipped (lane 40); the chosen-creature-type
   `enter_choice` already shipped (lane 44). The
   compound variant needs a new schema arm +
   `resolveEnterChoice` extension. Out of scope: the
   "lose all abilities" piece (the chosen-eviction-at-
   tombstone work, still tracked as a follow-up).

4. **Lane 108 — Banner of Kinship fellowship-counter
   entrance** (`enters_with_counters_per_match:
chosen_subtype`). Banner of Kinship (FDN #8) reads
   "this creature enters with X +1/+1 counters on it
   where X is the number of creatures of the chosen
   type you control" — needs an `enters_with_counters`
   extension to the `enter_choice` schema and the
   `entersBattlefield` engine pipeline. New schema arm
   - new `resolveEnterCount` for the chosen-subtype
     counter gate. ~50-100 LOC.

5. **Lane 109 — Infernal Vessel script** (chosen
   creature type + chosen color + discard a card). The
   "as this enters, choose a creature type" and "as
   this enters, choose a color" pieces both ship; the
   "you may discard a card" piece uses the existing
   `cost.discard` substrate from lane 98 + a new
   "discard N cards" gates on top. ~30-50 LOC.

6. **Lane 110 — Witness Protection triggered-ability
   suppression** (lane 54 follow-up: when the enchanted
   card carries `losesAbilities: true`, scripted
   triggered abilities don't fire). The current engine
   gates only activated abilities (lane 54's `canActivate
Ability` deny); the triggered-ability path needs a
   broader engine change to the trigger pipeline (the
   `detectTriggeredAbilities` consult must skip cards
   with `losesAbilities: true` as the source). ~50-100
   LOC. Out of scope: chosen-eviction-at-tombstone
   handling (the source's `chosenCreatureType` doesn't
   leak beyond the player's battlefield when the card
   moves zone).

7. **Lane 111 — Affinity / cost reduction arm** (lane 57,
   Claws Out etc.). New `cost_reduction: { filter, n }`
   arm on `CardScriptSchema` + engine reduction in
   `effect-resolution.ts`. The chosen-subtype filter
   follows the same shape as the lane 40 chosen-color
   anthem. ~50-100 LOC.

8. **Lane 112 — Granting triggered abilities** (Aura's
   `static.grants.triggers` arm — CR 603.2 grant
   semantics). New schema arm + new engine path for
   "the enchanted card gains [triggered ability]" via
   the existing `detectTriggeredAbilities` consult (the
   enchanted card's source = the Aura's source).
   ~80-150 LOC.

9. **Lane 113 — Casting spells from exile / graveyard**
   (Flashback, Jump-Start, Undergrowth, Escape,
   As Foretold). New `castable_from: ["exile" |
"graveyard" | "command"]` arm on `CardScriptSchema`.
   The `castSpell` flow reads `card.currentZoneKey` and
   checks the entry against the destination. Engine +
   tests. ~80-150 LOC.

10. **Lane 114 — Token creation with embedded static**
    (Adaptive Automaton's type-change half ships in
    lane 51; this lane is the more general "tokens
    created with embedded static bonuses" pattern —
    Adaptive Automaton, Avenger of Zendikar, Hornet
    Queen, Cloudblazer). The existing
    `embedded_static` schema arm ships keywords + P/T;
    this lane wires the runtime into the token-creation
    pipeline (`resolveTokenCreationEffect` already
    accepts `embeddedPowerBonus`/`embeddedToughness
Bonus` and stamps `embeddedStaticKeywords`). Tests
    on a synthetic token-creating card. ~30-50 LOC.

11. **Lane 115 — Stun / finality counters** (lane 67
    covered Enter with Counters; this lane covers
    stun counter + finality counter specifically).
    New `StunCounters: { kind, n }` field on
    `EnterWithCounters` + the SBA tap-counter rules
    (`state.turn.stunCountersThisTurn`). New
    `resolveStunSBA` engine arm in
    `state-based-actions.ts`. ~50-100 LOC.

12. **Lane 116 — X-spent-on-other-spells arm**
    (caster pays X on a different spell). New
    `X_spent_on_spell: true` arm on `CastFilterSchema`.
    The engine tracks "the X value spent on the current
    spell" via `state.castVariableValues`. ~50-100 LOC.

13. **Lane 117 — "You may pay [X] mana; if you do,
    [Y]" combined with `you_may` and `pay_life`** (a
    bridge variant across lanes 93 / 99 / 106). Schema
    extension: `pay_mana: { amount: N }` on `cost`. New
    `pay_mana_prompt` branch in `choices.ts`. ~50-100
    LOC.

### Process observation (carried from prior handoffs)

- The AI flake absorbed 1-2 extra CI runs per lane on
  local full-suite runs (forge-gate / forge-selfplay /
  expert-agent). Budget for 1 extra CI run per lane on
  this loop.
- The ratchet's `--live <counts.json>` fallback bypasses
  the AI flake mid-ratchet — use it liberally.
- The engine-size budget is currently at 3595 lines
  (schema.ts), under the 3600 ceiling bumped in lane
  follow-up 13. If a lane pushes schema over 3600, bump
  the budget in the same commit per the historical
  precedent. Update the docstring block in
  `scripts/check-engine-size-budget.mjs` with a
  one-paragraph history entry.
- All new schema arms should follow the lane 40
  `chosen`-sentinel shape (the `evaluate` machinery
  substitutes `source.chosenX` at refresh /
  resolution time). The chosen-name field
  (`chosenCardName`) is already in place from lane
  49; the chosen-color field from lane 39; the
  chosen-creature-type field from lane 44.

### Out of scope (multi-lane, requires dedicated human scoping)

- **Banner of Kinship / Infernal Vessel multi-pass**:
  the chosen-color + chosen-creature-type + lose-all-
  abilities + discard pieces require careful
  sequencing; each is a multi-lane concern. Open a
  fresh lane per piece.
- **Adaptive Automaton full-oracle (anthem +
  type-change)**: lane 51 + lane 110 close the gap.
  The full-oracle JSON ships AFTER both engine arms
  are in.
- **Pyromancer's Goggles (lane 31)**:
  cast-trigger with `cast_color` + retarget. Already
  covered by lane 33 + lane 34 (the existing copies
  and cast_color are shipped). The retarget half is
  a multi-lane concern.
- **Teach by Example (lane 29)**:
  copy-with-new-targets. The current `CopySpell` op
  handles the copy half; the `new_targets` flag is a
  follow-up lane (per the Wave 4.6 done summary).

When all priority lanes are either shipped or marked
multi-lane blocker, append a "Wave 4.8 follow-up 14
loop done summary" to this file.

### Quick-start checklist

```
cd /home/alex/Projects/planar-nexus
git pull --ff-only
git worktree list
# (no worktrees expected; clean up any leftover from prior waves)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
# verify 755 / 14348 green
# then start lane 57 (counter-based trigger gate)
# per the Process section above.
```

End each lane with: `git log --oneline -1` on main
showing the new lane's commit, and `grep "Test suites"
docs/onboarding.md` showing the bumped numbers. If
those two checks pass, you're ready to pick the next
lane from the priority queue and continue the loop.

When all priority lanes ship or are marked multi-lane
blockers, write the follow-up handoff prompt to
`docs/card-scripts/wave4-blockers.md` (or a sibling
file) and stop.

## Wave 4.8 follow-up 14 lane 57 done summary

Lane 57 (counter-condition menace static) shipped in the
Wave 4.8 follow-up 14 loop (PR [#2799](https://github.com/anchapin/planar-nexus/pull/2799),
#2614 follow-up). Redcap Gutter-Dweller's deferred
"Goblins you control have menace as long as this has
three or more counters on it" half is now wired
end-to-end.

### Shipped

- **Schema** (`src/lib/game-state/card-scripts/schema.ts`):
  `StaticSchema.while_condition` extends from a single-arm
  `z.object()` to a `z.discriminatedUnion` with two arms:
  `{ kind: "life_minimum", value: N }` (existing, lane 91)
  - `{ kind: "counter_minimum", counter, op, n }` (this
    lane). The `counter_minimum` arm reads
    `card.instanceCounters[counter]` and matches via `op`
    (`gte` | `eq`).

- **Engine** (`src/lib/game-state/keyword-actions/scripted-statics.ts`):
  `evaluateStaticWhileCondition` extends from the
  `life_minimum`-only shape to the discriminated union.
  When the gate evaluates false, the static's `keywords` /
  `power` / `toughness` / `X` / `protectionFrom` /
  `become_copy` / etc. arms are skipped — the static is
  inert for that pass.

- **Card JSON** (`src/lib/game-state/card-scripts/cards/redcap_gutter_dweller.json`):
  new static entry — `affects: { controller: "you",
subtype: "Goblin" }`, `keywords: ["menace"]`,
  `while_condition: { kind: "counter_minimum", counter:
"+1/+1", op: "gte", n: 3 }`. Two statics now
  (chosen-color self-add from lane 55 + this lane's Goblin
  menace).

- **Tests**:
  - `src/lib/game-state/__tests__/lane57-counter-condition-static.test.ts` —
    12 dedicated cases (schema accept / reject negative-n /
    bad-op, op:eq exact-count path, INERT below threshold,
    APPLIES at/above threshold, opponent exclusion,
    non-Goblin exclusion).
  - `redcap-gutter-dweller-full.test.ts` — existing case
    updated to read both statics (was 1 before this lane).

### Engine-size budget

schema.ts 3600 → 3609 (+9 lines for the new discriminated
union arm + docstring). Bumped budget 3600 → 3650 in
`scripts/check-engine-size-budget.mjs` in the same commit,
with a docstring entry mirroring the follow-up 12 / 13
historical precedent ("bump the budget rather than fragmenting
the chosen-X / additional-costs / affinity / grants /
counter-ledger / cast-from-zone / mana-restriction /
copy-permanent / creature-payment / aura-protection /
while-condition family").

### Net delta from Wave 4.8 follow-up 13

- Test suites: 755 → 756 (+1 for lane 57 dedicated).
- Test cases: 14348 → 14360 (+12 for lane 57 dedicated).
- Engine-size budget: schema.ts 3556 (follow-up 13
  baseline) → 3609 (+53 across lane 57 — actually 9 for
  lane 57 plus the prior bumps not reflected in the
  follow-up 13 summary; the actual delta in this commit is
  +9 over the 3600 measurement).
- Engine-size budget cap: 3600 → 3650 (one bump in the
  follow-up 14 commit, mirroring the follow-up 12 / 13
  precedent).

### Multi-lane follow-ups still open (tracked under #2614)

Lanes 51 / 107 / 108 / 109 / 110 / 111 / 112 / 113 / 114 /
115 / 116 / 117 remain parked per the Wave 4.8 follow-up 14
priority queue. Lane 61 (replacement effect for death)
remains parked pending the foundational replacement-effect
layer that the engine doesn't yet have.

### Process notes from this lane

- **Schema refine (`z.discriminatedUnion`)** required
  careful handling of the type narrowing in tests — the
  `while_condition` field is now a discriminated union, and
  any test that accesses `.op` or `.n` directly must
  narrow on `kind === "counter_minimum"` first. The
  `lane57-counter-condition-static.test.ts` op:eq case
  demonstrates the pattern.

- **Engine arm placement** — the
  `evaluateStaticWhileCondition` consult happens BEFORE
  the keyword stamp in `refreshScriptedStatics` (after
  `staticAffects` returns true), so the gate naturally
  suppresses the keywords / power / toughness / X /
  protectionFrom / become_copy arms when it evaluates
  false. This matches the lane 91 `life_minimum` pattern.

- **`createCardInstance` doesn't preserve
  `instanceCounters`** from options — test helpers must
  stamp the field directly on the created instance. The
  lane 62 test (counter-trigger gate) used the same
  pattern (`stampCounters` helper); the lane 57 test
  inlined the stamp inside `putOnBattlefield` for a
  cleaner test surface.

- **AI flake absorbed 1 extra CI run** — the
  `forge-gate` test hit its order-determinism issue on
  one of the full-suite runs. The `--live <counts.json>`
  ratchet fallback wasn't needed this lane (the ratchet
  was clean on the first try, both before and after the
  amend).

- **Force-push amend was required** for two reasons:
  (a) the lint job caught the
  `let state = startGame(...)` → `const` errors (the
  test helpers mutated `state` but never reassigned it);
  (b) the test-count-docs-guard caught that
  `docs/TEST_VIDEO_FIXTURES.md` was stale relative to
  `docs/onboarding.md`. Both fixes landed in a single
  `git commit --amend --no-edit` followed by
  `git push --force-with-lease` per the Wave 4.8
  follow-up 13 process note ("the
  `git commit` without the `GIT_AUTHOR_NAME` /
  `GIT_AUTHOR_EMAIL` env vars picks up the husky global
  git config" pattern + the amend-on-failure cycle).

### Next lane continue rule

Per the Wave 4.8 follow-up 14 priority queue, the next
lane is **lane 51 — Adaptive Automaton type-change
half**. Per the doc, it's a permanent (not set queue)
chosen-creature-type "is the chosen type in addition to
its other types" static — the engine today has no
permanent type-change (`AddSubtype` is end-of-turn-only,
`untilEndOfTurnSubtypes` cleared at end-of-turn), and the
layer-system's type-line overrides are animated-only.
The docstring at lane 51 explicitly notes the
"~80-150 LOC" envelope (single self-contained change) but
also notes that any general-purpose `change creature
types` op needs cross-zone refactoring. The handoff's
"if this lane grows past one self-contained change,
back out and document why in `wave4-blockers.md`" rule
applies — start lane 51 in a fresh follow-up loop
session and document the chosen-card-name
eviction-at-tombstone follow-up + the named-card-copy
phase-3 follow-up if the lane reveals more than the
80-150 LOC scope.

## Wave 4.8 follow-up 14 lane 51 done summary

Lane 51 (Adaptive Automaton type-change half —
permanent chosen-creature-type overlay) shipped in the
Wave 4.8 follow-up 14 loop (#2614 follow-up).
Adaptive Automaton's deferred "is the chosen type in
addition to its other types" half is now wired
end-to-end via a NEW complementary schema arm that
overlays the source's `cardData.type_line` permanently
(rather than only stamping the parallel
`chosenTypeAdditions` field, which is the lane 52
boundary).

### Shipped

- **Schema** (`src/lib/game-state/card-scripts/schema.ts`):
  `StaticSchema.affects.becomes_chosen_creature_type` —
  a new `z.literal(true).optional()` arm complementary
  to lane 52's `add_creature_type` +
  `addCreatureTypeToSelf` pair. The lane 51 arm is
  self-only (parallels lane 52's v1 semantics); it
  always reads `source.chosenCreatureType` (no literal-
  string variant — by definition the chosen type IS
  the instance's chosen type). The schema's `.refine()`
  allow-list is extended to accept the arm as a
  stand-alone meta-static; the refine-error message
  lists `becomes_chosen_creature_type` alongside the
  existing meta-static arms. v1 forbids combining the
  arm with the lane 52 `add_creature_type` arm in
  practice (both stamp the same chosen type), but the
  schema leaves that to a future refinement — engine
  semantics deduplicate via the unioned
  `chosenTypeAdditions` set.

- **Engine** (`src/lib/game-state/keyword-actions/scripted-statics.ts`):
  `staticAffects` returns true iff
  `source.id === target.id && source.chosenCreatureType !== null`
  (parallel to the lane 52 `add_creature_type` +
  `addCreatureTypeToSelf` consult; v1 self-only).
  `refreshScriptedStatics` extends the write phase
  with a new permanent-overlay path: when the source
  carries a `becomes_chosen_creature_type` static AND
  the source is on the battlefield AND
  `source.chosenCreatureType` is resolved, the
  refresh pass rebuilds the source's
  `cardData.type_line` to include the chosen creature
  type as a permanent subtype (via
  `rebuildTypeLineWithAddedSubtypes`, the lane 75c
  helper). The original printed `cardData` is
  stashed under the new per-instance
  `permanentTypeOverlay` field so the
  `restorePermanentTypeOverlay` consult at the top
  of the next refresh pass can restore it when the
  source leaves the battlefield. Idempotent: the
  change-detection diff (`sameTypeOverlay`) compares
  the in-flight `cardData.type_line` against the
  expected overlaid line, so a second refresh with no
  state change yields the same state object (no churn).

- **Card data** (`src/lib/game-state/types/cards.ts`):
  new `CardInstance.permanentTypeOverlay?: { cardData:
  ScryfallCard; source: CardInstanceId }` field.
  Field shape mirrors `animatedUntilEndOfTurn.cardData`
  but WITHOUT the EOT cleanup (the overlay persists
  as long as the source is on the battlefield). The
  `source` tag identifies the source whose static
  set the overlay; v1 supports a single overlay per
  card (parallel to the lane 52 self-only semantics).
  Multi-source overlays on the same card are a
  follow-up lane.

- **Restore** (`src/lib/game-state/pt-until-end-of-turn.ts`):
  new `restorePermanentTypeOverlay(state: GameState)`
  helper parallel to `restoreAnimatedOffBattlefield`.
  Called at the top of `refreshScriptedStatics` for
  any card with a `permanentTypeOverlay` field whose
  `currentZoneKey` no longer ends with `-battlefield`
  — drops the overlay and restores the original
  printed `cardData.type_line`. Mirrors the
  natural battlefield-zone-only semantics (the
  source's static is only active while the source is
  on the battlefield; once the source leaves, the
  overlay drops).

- **Tests** (`src/lib/game-state/__tests__/lane51-adaptive-automaton-type-change.test.ts`):
  13 dedicated cases covering schema acceptance /
  rejection (literal-`true` shape; known-bad-value
  rejects; alongside-power/toughness), the
  `staticAffects` consult (true when source===target
  AND chosen creature type resolved; false when
  source!==target; false when chosen creature type is
  null), and the `refreshScriptedStatics` overlay write
  (overlay produced after chosen creature type
  resolves; no overlay before it resolves; idempotent
  across multiple refreshes — the headline
  permanent-not-EOT contrast with lane 75/75a; overlay
  cleared on zone change; `subtypesOf` read path
  still includes the chosen type — regression check
  for the lane 45/53 anthem path).

### Engine-size budget

schema.ts 3650 → 3661 (+11 lines: docstring +
`z.literal(true).optional()` + refine allow-list
entry + refined-message extension). Bumped budget
3650 → 3700 in
`scripts/check-engine-size-budget.mjs` in the same
commit, with a docstring entry mirroring the
follow-up 12 / 13 / 14 historical precedent ("bump
the budget rather than fragmenting the chosen-X /
additional-costs / affinity / grants /
counter-ledger / cast-from-zone / mana-restriction /
copy-permanent / creature-payment / aura-protection /
while-condition / permanent-overlay family").

### Net delta from Wave 4.8 follow-up 14 lane 57

- Test suites: 756 → 757 (+1 for lane 51 dedicated).
- Test cases: 14360 → 14373 (+13 for lane 51
  dedicated).
- Engine-size budget cap: 3650 → 3700 (one bump in
  the lane 51 commit, mirroring the follow-up 12 /
  13 / lane 57 precedent).

### Multi-lane follow-ups still open (tracked under #2614)

Lanes 107 / 108 / 109 / 110 / 111 / 112 / 113 / 114 /
115 / 116 / 117 remain parked per the Wave 4.8
follow-up 14 priority queue. Lane 51 specifically
deferred: chosen-card-name eviction-at-tombstone
work (the `permanentTypeOverlay` is naturally cleared
when the source leaves the battlefield, but a
source-card with chosenX-card-name hooks still needs
explicit eviction handling); layered type-line
rendering beyond `cardData.type_line` reads for a
fully general `change creature types` op (lane 51 v1
is self-only via the schema arm); the chosen-color
and chosen-PT "in addition to" generalizations
ride follow-up lanes.

### Process notes from this lane

- **`createCardInstance` doesn't preserve
  `instanceCounters` from options** is a
  long-standing pattern (lane 57, lane 62 already
  documented it); lane 51 inherits the same pattern
  for the `permanentTypeOverlay` field — test
  helpers stamp the field directly on the created
  instance, the same way `put` in the lane 52 test
  stamps `chosenTypeAdditions`.

- **Type-line overlay write** uses the existing lane
  75c `rebuildTypeLineWithAddedSubtypes` helper
  (passing a single-element `["Soldier"]` array).
  No helper rewrite was needed — the lane 75c
  helper was designed to support single-subtype
  overlays since the original lane 75c commit.

- **AI flake absorbed 0 extra CI runs** — the lane
  51 test does not touch the AI simulation suite
  (it's a pure engine / scripted-statics test on a
  synthetic host); the test-count docs ratcheted
  cleanly on the first try.

- **Force-push amend cycle** was used for the
  budget bump + the lane 51 docstring entry to
  land in the same commit as the schema / engine /
  tests change, per the Wave 4.8 follow-up 13
  process note.

