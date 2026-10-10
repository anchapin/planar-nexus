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
  + `{T}: Add {C}.` AddMana (uses the existing literal
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
