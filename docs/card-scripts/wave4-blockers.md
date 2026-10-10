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
- **Suggested follow-up**: open an issue for `enterChoice` engine
  arm + chosen-color anthem + chosen-color mana. The chosen-color
  schema/parsing pieces (#2693 + the engine's `staticAffects`
  color substitution) are small; the multi-lane piece is the
  ETB choice flow.

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
  chosen-color activated `AddMana`): both need a general-purpose
  "as this enters, choose a [thing]" mechanism. The current engine
  has only the shockland-specific "as this enters, pay 2 life"
  pattern. Shipping either lane properly requires a new
  `enterChoice` engine arm + a `waitingChoice` flow + a
  `chosenColor` instance field — multi-lane work. See the
  "Wave 4.6 follow-up" note in the Lane 24 entry above.

### Still tracked (not attempted in Wave 4.6)

The "Out of scope" list above remains — those need dedicated
human scoping before they become shippable lanes.
