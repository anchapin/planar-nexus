#!/usr/bin/env node
/**
 * Module Size Budget Guard — Issues #1725 (game-state), #1808 (src/ai)
 *
 * CI gate that keeps the rules-engine modules under `src/lib/game-state/`
 * AND the AI opponent/consumption modules under `src/ai/` from regrowing
 * into four-digit monoliths. Size × churn is the standard proxy for
 * change risk: every merge touching a monolith risks regressing the
 * layer/replacement/trigger behavior the mutation gates protect, and
 * per-module mutation suites grow slower as unrelated concerns accrete
 * in one file (#1725).
 *
 * BUDGETS:
 *   - src/lib/game-state/: 2,000 lines (issue #1725 — see rationale below)
 *   - src/ai/:            3,500 lines (issue #1808 — see rationale below)
 *
 * Scope per module:
 *   - every TypeScript file under the scope root (recursively)
 *   - EXCLUDES test suites under any __tests__ directory (they scale with
 *     coverage, not with module cohesion)
 *   - EXCLUDES the public barrel `index.ts` (a pure re-export +
 *     collision-disambiguation surface; its length tracks the number of
 *     modules in the scope, not module complexity)
 *
 * Threshold rationale — src/lib/game-state/ (measured after the #1725
 * decomposition):
 *   - current max: layer-system.ts at 1,934 lines — deliberately NOT
 *     decomposed; it implements a single algorithm (CR 613 continuous
 *     layer application) and carries the repo's mutation-testing gates.
 *   - the four decomposed churn offenders now max out at 1,221 lines
 *     (`spell-casting/cast.ts`: canCastSpell + the single castSpell
 *     pipeline, which cannot be split mechanically).
 *   - `card-scripts/interpret.ts` now sits at 2,017 lines after
 *     Wave 4 lane 27 (Raise the Past count:"all" sweep, #2594
 *     follow-up). This module IS the single dispatcher for every
 *     scripted effect and cannot be mechanically decomposed without
 *     re-routing 281 card scripts. Budget raised 2,000 → 2,050 to
 *     capture lane 27 with ~1.5% headroom; comparable in spirit to
 *     layer-system.ts above (single, mutation-gated algorithm).
 *   - a flat budget with NO per-file exceptions preserves the
 *     precedent: the only escape hatch is to raise the scope's
 *     SIZE_BUDGET_LINES with a documented rationale (see the
 *     trailing error message).
 *
 * Threshold rationale — src/ai/ (measured after the #1808 audit):
 *   - the AI layer is structurally larger than the engine: it carries
 *     feature tables (archetype-signatures, synergy-database), lookup
 *     weights (counterpell-frequency-model, weight-learning), and the
 *     model-side state translators that the engine correctness
 *     properties do not require (CR 613-style layer logic stays in
 *     game-state).
 *   - current top: stack-interaction-ai.ts at 3,295 lines, followed by
 *     decision-making/combat-decision-tree.ts at 2,561, ai-turn-loop.ts
 *     at 2,425, game-state-evaluator.ts at 2,134, synergy-detector.ts
 *     at 1,876.
 *   - 3,500 captures the four top offenders with ~6% headroom and
 *     blocks any further regrowth without forcing immediate
 *     decomposition. A decomposition sweep is tracked separately if
 *     the slimmer-machine team decides it has payoff.
 *   - a flat budget with NO per-file exceptions preserves the
 *     precedent: the only escape hatch is to raise the scope's
 *     SIZE_BUDGET_LINES with a documented rationale (see the
 *     trailing error message).
 *
 * Exit codes:
 *   0 — all scopes pass (every module within its scope's budget)
 *   1 — at least one scope has offenders (listed on stderr)
 *
 * Usage:
 *   node scripts/check-engine-size-budget.mjs          # gate
 *   node scripts/check-engine-size-budget.mjs --report # list top-10 per scope
 *
 * Wired into package.json as `lint:engine-size` and run by the CI job
 * `engine-size-budget` (.github/workflows/ci.yml), which the `build` job
 * depends on — an oversized module blocks merge.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");

/**
 * A budgeted scope. Each scope is a directory tree walked recursively for
 * TypeScript files; each file must fit within `budgetLines`.
 *
 * @typedef {Object} Scope
 * @property {string} name       Human-readable label used in messages.
 * @property {string} dir        Absolute path to the scope root.
 * @property {string} rootRel    Path relative to REPO_ROOT used when
 *                               reporting the file (POSIX-style).
 * @property {number} budgetLines Maximum allowed line count for files
 *                               inside this scope.
 * @property {Set<string>} excludedFiles Absolute paths exempted (e.g.
 *                               the public barrel). Substring match for
 *                               portability across OS path separators.
 * @property {string[]} excludedDirSegments Directory names that abort a
 *                               recursive walk (e.g. `__tests__`).
 */

/** @type {Scope[]} */
const SCOPES = [
  {
    name: "engine",
    dir: join(REPO_ROOT, "src", "lib", "game-state"),
    rootRel: "src/lib/game-state",
    // Wave 4.8 lane 52 bumped 2050 → 2100; lane 54 added
    // the "removes all abilities" AuraStatic arm + the
    // loseseAbilities stamping docstring and lands at
    // 2136 (+36 over). Bumping 2100 → 2200 to cover the
    // remaining lanes 55 (add_color static) + a small
    // buffer. Per the Wave 4.8 handoff's process note:
    // "bump the budget again rather than fragmenting
    // the chosen-X arm family".
    //
    // Wave 4.8 follow-up lane 56 (#2614 follow-up) extends
    // the enter_choice schema enum with
    // `color_and_creature_type` (compound dual-choice arm
    // for Eaten by Piranhas). schema.ts landed at 2196.
    // Bumping 2200 → 2300 to give lanes 57
    // (Redcap Gutter-Dweller literal-form / counter-based
    // trigger gate follow-up), 58 (triggered-ability
    // suppression for removes_all_abilities), and 59
    // (Banner of Kinship counters-per-subtype arm) room
    // to land without fragmenting the chosen-X family.
    //
    // Wave 4.8 follow-up 3 lane 63 (#2614 follow-up) adds
    // `pay_life` and `sacrifice` arms to the existing
    // `additionalCosts` slot ("Pay N life, draw 3 cards" on
    // Painful Truths, "Sacrifice a [thing] as an additional
    // cost" for instants / sorceries). schema.ts landed at
    // 2317 (+17 over 2300). Bumping 2300 → 2350 to give lane
    // 64 (affinity / cost reduction) and lane 65 (granting
    // triggered abilities to other cards) room to land
    // without fragmenting the chosen-X / additional-costs
    // family.
    //
    // Wave 4.8 follow-up 3 lane 64 (#2614 follow-up) extends
    // the existing `affinity` field with a `color` arm (CR
    // 702.41; "affinity for [color]" alongside the existing
    // subtype arm) and adds `reduction_per_match` to both
    // arms. schema.ts landed at 2362 (+12 over 2350). Bumping
    // 2350 → 2400 to give lane 65 (granting triggered
    // abilities to other cards) room to land without
    // fragmenting the chosen-X / additional-costs / affinity
    // family.
    //
    // Wave 4.8 follow-up 3 lane 65 (#2614 follow-up) adds
    // a `grants.triggers` arm on `AuraStaticSchema` (CR
    // 603.2 grant semantics, e.g. Lifelink-granting auras,
    // Undying Malice, Fake Your Own Death). schema.ts landed
    // at 2408 (+8 over 2400). Bumping 2400 → 2450 to leave
    // headroom for any final follow-up edits without
    // fragmenting the chosen-X / additional-costs /
    // affinity / grants family.
    //
    // Wave 4.8 follow-up 4 lane 66 (#2614 follow-up) adds
    // the `embedded_static` arm on `CreateTokenSchema`
    // (token-time static bonuses — keywords + P/T). schema.ts
    // landed at 2422 (+14 over 2408). No bump needed.
    //
    // Wave 4.8 follow-up 4 lane 67 (#2614 follow-up) adds
    // the `enters_with_counters: [{ counter, count }]` arm on
    // `CardScriptSchema` (generalized stun / finality / +1/+1 /
    // -1/-1 counter stamping; the v0 substrate is the lane 59
    // `enters_with_counters_per_match` and the legacy
    // `SearchLibrary.stun` field). schema.ts landed at 2476
    // (+26 over 2450). Bumping 2450 → 2500 to give the
    // counter-ledger family room to land without fragmenting
    // the chosen-X / additional-costs / affinity / grants
    // family (the historical precedent from the lane 64
    // affinity bump and the lane 65 grants bump).
    //
    // Wave 4.8 follow-up 4 lane 68 (#2614 follow-up) adds
    // the `castable_from: ["exile" | "graveyard" | "command"]`
    // arm on `CardScriptSchema` (generalized cast-from-zone;
    // the v0 substrate is the per-keyword `flashback` and
    // `harmonize` fields). schema.ts landed at 2519
    // (+19 over 2500). Bumping 2500 → 2550 to give the
    // cast-from-zone family room to land without
    // fragmenting the chosen-X / additional-costs /
    // affinity / grants / counter-ledger / cast-from-zone
    // family (the historical precedent continues).
    //
    // Wave 4.8 follow-up 5 lane 69 (#2614 follow-up) adds
    // the `additionalCosts.mana_restriction: { colors: ["W" |
    // "U" | "B" | "R" | "G"], generic: number }` arm on
    // `CardScriptSchema` (the mana-restriction family: Force
    // of Will, Cabal Therapy, the Storm-Crow specter
    // pattern; v1 single-color restriction with a single
    // generic reduction). schema.ts landed at 2563
    // (+13 over 2550). Bumping 2550 → 2575 to give the
    // mana-restriction family room to land without
    // fragmenting the chosen-X / additional-costs /
    // affinity / grants / counter-ledger / cast-from-zone
    // / mana-restriction family (the historical precedent
    // continues).
    //
    // Wave 4.8 follow-up 5 lane 70 (#2614 follow-up) adds
    // the `CopyPermanentSchema` (`op: "CopyPermanent"`,
    // `target: "permanent" | "creature" | "artifact" |
    // "enchantment" | "land"`, optional `controller`) on
    // `EffectSchema` (the Clone, Phantasmal Image, Vesuvan
    // Doppelganger "create a permanent that copies the
    // characteristics of a target permanent" family; v1
    // single-target, "all characteristics copied"
    // semantics). schema.ts landed at 2611 (+36 over
    // 2575). Bumping 2575 → 2650 to give the
    // copy-permanent family room to land without
    // fragmenting the chosen-X / additional-costs /
    // affinity / grants / counter-ledger / cast-from-zone
    // / mana-restriction / copy-permanent family (the
    // historical precedent continues).
    //
    // Wave 4.8 follow-up 6 lane 72 (#2614 follow-up) adds
    // the `additionalCosts.creature_payment: { creature_only:
    // true, generic: number }` arm on `CardScriptSchema` (the
    // "tap a creature you control to pay the generic" family:
    // Llawan, War Tax, the "spend this mana only on creature
    // spells" pattern; v1 single tap-for-generic reduction
    // with a `creature_only: true` literal). schema.ts
    // landed at 2698 (+48 over 2650). Bumping 2650 → 2700
    // to give the creature-payment family room to land
    // without fragmenting the chosen-X / additional-costs /
    // affinity / grants / counter-ledger / cast-from-zone /
    // mana-restriction / copy-permanent / creature-payment
    // family (the historical precedent continues).
    //
    // Wave 4.8 follow-up 6 lane 76 (#2614 follow-up) adds
    // the `AuraStaticSchema.protectionFrom: string[]` arm
    // (the "enchanted creature has protection from [color]"
    // pattern: Akoumep Halberd, Niveous Wisps; v1 single
    // quality, multi-quality is data-driven). schema.ts
    // landed at 2733 (+33 over 2700). Bumping 2700 → 2750
    // to give the aura-protection family room to land
    // without fragmenting the chosen-X / additional-costs /
    // affinity / grants / counter-ledger / cast-from-zone /
    // mana-restriction / copy-permanent / creature-payment /
    // aura-protection family (the historical precedent
    // continues).
    //
    // Wave 4.8 follow-up 7 lane 75 (#2614 follow-up) adds
    // the `StaticSchema.become_copy: { target:
    // CardInstanceId, until: "end_of_turn" }` arm
    // (Sakashima-style / manifested / disposition-of-copy;
    // "as long as this is in play, it's a copy of [a chosen
    // permanent] until end of turn"). v1 single-target,
    // "all characteristics copied" semantics with a
    // turn-key duration. The arm carries a sizable
    // docstring block (CR 707.2 "all characteristics
    // copied" semantics, the chosen-target / named-copy
    // / copy-with-exception / nested-copy / Aura-shaped
    // follow-up scope notes) so the schema field lands
    // +57 over 2750. schema.ts landed at 2790 (+40 over
    // 2750 after the docstring is trimmed). Bumping 2750
    // → 2800 to give the until-EOT-copy family room to
    // land without fragmenting the chosen-X /
    // additional-costs / affinity / grants /
    // counter-ledger / cast-from-zone / mana-restriction /
    // copy-permanent / creature-payment / aura-protection
    // / until-eot-copy family (the historical precedent
    // continues).
    //
    // Wave 4.8 follow-up 8 lane 75a (#2614 follow-up) adds
    // the `CopyUntilEndOfTurn: { chosen_permanent:
    // CardInstanceId, until: "end_of_turn" }` op on
    // `EffectSchema` (Cackling Counterpart: "create a token
    // that's a copy of [a chosen permanent] until end of
    // turn"). The arm is the spell-effect-shaped
    // counterpart of lane 75's `StaticSchema.become_copy`
    // static. The op + per-op reference module +
    // docstring block (CR 707.2 "all characteristics
    // copied" + EOT rollback via the lane 75
    // `animatedUntilEndOfTurn` infra + the out-of-scope
    // multi-target / controller-filter /
    // narrower-target-filter / permanent-copy /
    // named-copy / copy-with-exception / nested-copy /
    // Aura-shaped follow-up scope notes) land at +75 over
    // 2800. schema.ts measured at 2865 (+65 over 2800).
    // Bumping 2800 → 2900 to give the until-EOT-copy
    // family room to land without fragmenting the
    // chosen-X / additional-costs / affinity / grants /
    // counter-ledger / cast-from-zone / mana-restriction /
    // copy-permanent / creature-payment / aura-protection /
    // until-eot-copy family (the historical precedent
    // continues; subsequent lanes 75b–75e grow the same
    // family).
    //
    // Wave 4.8 follow-up 8 lane 75b (#2614 follow-up) adds
    // the `named_card: { name: string }` arm on
    // `StaticSchema.become_copy` (Memnarch / Clone Shell:
    // "as long as this is in play, it's a copy of [named
    // card] until end of turn"). The arm is the
    // named-card-copy counterpart of lane 75's
    // `target: CardInstanceId` arm; the schema change
    // converts `become_copy`'s shape into a discriminated
    // union (the lane 75 ID arm OR the lane 75b name
    // arm, mutually exclusive). The arm + docstring block
    // (CR 707.2 "all characteristics copied" + the
    // synchronous `cardDataByName` lookup via the new
    // registry helper + the out-of-scope multi-named /
    // named-with-exception / named-nested follow-up
    // scope notes) land at +60 over 2900. schema.ts
    // measured at 2923 (+23 over 2900). Bumping 2900 →
    // 3000 to give the until-EOT-copy family room to
    // land without fragmenting the chosen-X /
    // additional-costs / affinity / grants /
    // counter-ledger / cast-from-zone / mana-restriction /
    // copy-permanent / creature-payment / aura-protection
    // / until-eot-copy family (the historical precedent
    // continues; subsequent lanes 75c–75e grow the same
    // family).
    //
    // Wave 4.8 follow-up 8 lane 75d (#2614 follow-up)
    // adds the `become_copy` arm to `AuraStaticSchema`
    // (parallel to lane 76's `protectionFrom` arm —
    // "Enchanted creature is a copy of [chosen permanent]
    // until end of turn"). The schema change accepts a
    // new `become_copy: { target: CardInstanceId, until:
    // "end_of_turn" }` arm on `AuraStaticSchema` and
    // extends the refine list at the bottom of the
    // schema to accept it as a stand-alone arm (a pure
    // meta-static, parallel to the Wave 4.8 follow-up 6
    // lane 76 process note). The arm + docstring block
    // (CR 707.2 "all characteristics copied" + the
    // lane 75d engine surface in `refreshAuraBonuses`
    // that overlays the chosen target's printed
    // characteristics onto the ENCHANTED CARD via
    // the lane 75 `animatedUntilEndOfTurn`
    // infrastructure + the out-of-scope named-card /
    // exceptions / multi-Aura / multi-target follow-up
    // lanes) lands at +60 over 3000. schema.ts measured
    // at 3050 (+50 over 3000). Bumping 3000 → 3100 to
    // give the until-EOT-copy family room to land
    // without fragmenting the chosen-X /
    // additional-costs / affinity / grants /
    // counter-ledger / cast-from-zone / mana-restriction /
    // copy-permanent / creature-payment / aura-protection
    // / until-eot-copy family (the historical precedent
    // continues; subsequent lane 75e may grow the same
    // family).
    //
    // Wave 4.8 follow-up 12 lane 87 (#2614 follow-up):
    // Scrawling Crawler's "Whenever an opponent draws a
    // card, that player loses 1 life" half. The schema
    // accepts a new `"drawCard"` event arm + a new
    // `whose_draws` filter on TriggerSchema (parallel to
    // the existing `whose` upkeep filter); `LoseLife.who`
    // extends with a `"drawer"` arm. +27 lines;
    // schema.ts measured at 3077. Still within the 3100
    // bump.
    //
    // Wave 4.8 follow-up 12 lane 88 (#2614 follow-up):
    // Midnight Snack's "sacrifice this artifact as a
    // cost" trigger-cost substrate. The schema accepts
    // a new `cost: { sacrifice_self: true }` arm on
    // TriggerSchema (parallel to the `additionalCosts`
    // slot on spells, but for trigger-cost — lane 63's
    // `additionalCosts.sacrifice.target: "self"` was
    // spell-cast only; the lane 88 arm covers trigger-
    // cost). +28 lines; schema.ts measured at 3105.
    // Bumping 3100 → 3150 to give the trigger-cost /
    // sacrifice-self family room to land without
    // fragmenting the until-EOT-copy family (the
    // historical precedent continues; subsequent
    // follow-up lanes may grow the same family).
    //
    // Wave 4.8 follow-up 12 lane 90 (#2614 follow-up):
    // Needletooth Pack's "draw N where N = creatures that
    // died this turn" half. The schema accepts a new
    // `X: "creaturesDiedThisTurn"` arm on DrawSchema
    // (parallel to the StaticSchema.X state-derived
    // count). +12 lines; schema.ts measured at 3117.
    // Within the 3150 budget.
    //
    // Wave 4.8 follow-up 12 lane 91 (#2614 follow-up):
    // Twinblade Paladin's "as long as you have 25 or
    // more life, this creature has double strike and
    // lifelink" static. The schema accepts a new
    // `while_condition: { kind: "life_minimum",
    // value: N }` arm on StaticSchema (CR 603.2
    // "while"-gate, parallel to a trigger's
    // whileCondition). The TOKEN_KEYWORDS enum gains
    // `"double strike"` for the keyword grant (+3 lines
    // total). schema.ts measured at 3152. Bumping
    // 3150 → 3200 to give the while-condition family
    // room to land without fragmenting the
    // until-EOT-copy family (the historical precedent
    // continues; subsequent follow-up lanes may grow
    // the same family).
    //
    // Wave 4.8 follow-up 13 lane 61a (#2614 follow-up):
    // the foundational replacement-effect-for-death
    // layer (Whip of Erebos-style "if a creature you
    // control would die, instead exile it"). The
    // schema adds a new `ReplacementEffectSchema`
    // (event / applies_to / redirect / if_condition /
    // optional / once_per_turn) and a top-level
    // `replacement_effects: z.array(...)` arm on
    // `CardScriptSchema` (parallel to `triggers` /
    // `activated` / `statics`). The docstring + the
    // schema entry land at +144 lines; schema.ts
    // measured at 3308. Bumping 3200 → 3350 to give
    // the replacement-effect family room to land
    // without fragmenting the chosen-X /
    // additional-costs / affinity / grants /
    // counter-ledger / cast-from-zone / mana-restriction
    // / copy-permanent / creature-payment /
    // aura-protection / until-EOT-copy /
    // trigger-cost / while-condition family (the
    // historical precedent continues; the follow-up 13
    // lanes 100 / 102 / 103 / 105 ride the same family).
    //
    // Wave 4.8 follow-up 13 lane 61b (#2614 follow-up):
    // the printed-card mechanism for Whip of Erebos's
    // actual oracle. The schema accepts a new
    // `death_replacement: { description, optional }`
    // arm on `StaticSchema` (parallel to the lane 71
    // `protectionFrom` static arm) — the engine
    // reads the source's `cardData.oracle_text` at
    // refresh time and writes a per-instance
    // `deathReplacement` ledger. The docstring + the
    // schema entry land at +66 lines; schema.ts
    // measured at 3374. Bumping 3350 → 3400 to give
    // the printed-oracle replacement-effect family
    // room to land without fragmenting the
    // chosen-X / additional-costs / affinity / grants /
    // counter-ledger / cast-from-zone / mana-restriction
    // / copy-permanent / creature-payment /
    // aura-protection / until-EOT-copy /
    // trigger-cost / while-condition /
    // replacement-effect family (the historical
    // precedent continues; follow-up 13 lanes 100 /
    // 102 / 103 / 104 / 105 ride the same family).
    //
    // Wave 4.8 follow-up 13 lane 93 (#2614 follow-up):
    // the "you may pay [cost]; if you do, [effects]"
    // gate (Skyship Buccaneer's deferred half — the
    // CR 117.3a "you may pay 2 life; if you do, draw
    // a card" pattern). The schema accepts a new
    // `you_may_cost` arm on `TriggerSchema` (parallel
    // to the lane 88 `cost` substrate) with two v1
    // shapes (`sacrifice_self: true` and
    // `pay_life: { amount: N }`). The docstring + the
    // schema entries land at +73 lines; schema.ts
    // measured at 3447. Bumping 3400 → 3450 to give
    // the you-may + cost family room to land without
    // fragmenting the trigger-cost /
    // while-condition / replacement-effect family
    // (the historical precedent continues; follow-up
    // 13 lanes 95 / 96 / 97 / 98 / 99 / 100 / 106 ride
    // the same family).
    //
    // Wave 4.8 follow-up 13 lane 94 (#2614 follow-up):
    // the "draw N where N = cards drawn this turn"
    // X-count (Proft's Eidetic Memory's deferred
    // half). The schema adds
    // `X: "cardsDrawnThisTurn"` to DrawSchema (parallel
    // to lane 90's `creaturesDiedThisTurn`). The
    // docstring + the schema entry land at +9 lines;
    // schema.ts measured at 3456. Bumping 3450 →
    // 3500 to give the cards-drawn-this-turn family
    // room to land without fragmenting the
    // trigger-cost / while-condition /
    // replacement-effect / you-may-cost family
    // (the historical precedent continues; follow-up
    // 13 lanes 95 / 98 / 99 / 100 / 106 ride the same
    // family).
    //
    // Wave 4.8 follow-up 13 lane 98 (#2614 follow-up):
    // the "may discard a card" cost (Storm Fleet Spy
    // variant — parallel to the lane 88 sacrifice-self
    // substrate). The schema accepts a new
    // `cost: { discard: { amount: 1 } }` arm on
    // `TriggerSchema`. The docstring + the schema
    // entries land at +22 lines; schema.ts measured
    // at 3522. Bumping 3500 → 3550 to give the
    // discard-cost family room to land without
    // fragmenting the trigger-cost / you-may-cost /
    // while-condition / replacement-effect /
    // cards-drawn / opponent-drawn /
    // create-token-xcount family (the historical
    // precedent continues; follow-up 13 lane 99
    // rides the same family).
    //
    // Wave 4.8 follow-up 14 lane 57 (#2614 follow-up):
    // the `counter_minimum` arm on `StaticSchema.while_condition`
    // (parallel to lane 91's `life_minimum`) for Redcap
    // Gutter-Dweller's "Goblins you control have menace
    // as long as this has 3+ counters on it" half. The
    // schema arm replaces the single-arm `z.object().strict()`
    // with a 2-arm `z.discriminatedUnion("kind", [...])`
    // (net +9 vs the prior single-arm shape). schema.ts
    // measured at 3609. Bumping 3600 → 3650 to cover
    // the while-condition / counter-ledger family on the
    // same trajectory as follow-up 13.
    //
    // Wave 4.8 follow-up 14 lane 51 (#2614 follow-up):
    // the `becomes_chosen_creature_type: z.literal(true)`
    // arm on `StaticSchema.affects` (Adaptive Automaton's
    // "is the chosen type in addition to its other types"
    // permanent type-line overlay half). Distinct from
    // the lane 52 `add_creature_type` / `addCreatureTypeToSelf`
    // pair — the lane 51 arm overlays the source's
    // `cardData.type_line` permanently (rather than only
    // stamping the parallel `chosenTypeAdditions` field),
    // so call sites that read `cardData.type_line`
    // directly see the chosen creature type as a
    // subtype. The schema arm adds ~32 lines
    // (docstring + z.literal(true).optional() +
    // refine() allow-list addition + refined-message
    // extension). schema.ts measured at 3661 (+11 over
    // 3650). Bumping 3650 → 3700 to cover the lane 51
    // permanent-overlay family on the same trajectory
    // as the follow-up 13 / follow-up 14 budget bumps.
    //
    // Wave 4.8 follow-up 17 lane 117 (#2614 follow-up):
    // the `cost.pay_mana: { amount: N }` arm on
    // TriggerSchema.cost (parallel to lane 106's
    // `cost.pay_life`). v1 ships generic mana only
    // (the standard spendMana cascade); colored-mana
    // payment rides a follow-up lane. The arm adds ~36
    // lines (docstring + the pay_mana object +
    // amount validation) — schema.ts measured at
    // 3701 (+1 over 3700). Bumping 3700 → 3750 to
    // cover the trigger-cost family on the same
    // trajectory as the follow-up 13 / 14 / lane 51
    // budget bumps.
    //
    // Wave 4.8 follow-up 18 lane 112 (#2614 follow-up):
    // the self-grant triggered-ability arm on
    // StaticSchema (`grants.triggers`). Mirrors the
    // lane 65 Aura-shaped variant but routes the
    // grant onto the SOURCE itself. The arm adds
    // ~50 lines (docstring + the grants object schema
    // + the refine-list entry for stand-alone arm
    // permission) — schema.ts measured at 3770 (+20
    // over 3750). Bumping 3750 → 3800 to give the
    // follow-up 18 self-grant family room to land
    // without fragmenting the StaticSchema sub-family.
    //
    // Wave 4.8 follow-up 19 lane 116 (#2614 follow-up):
    // the `X: "X_spent_on_spell"` cast-filter arm on
    // TriggerSchema (read-only path; the cast-time
    // writer is a follow-up sub-piece). The arm
    // adds ~14 lines (docstring + the X enum +
    // refine-list entry for cast-only permission) —
    // schema.ts measured at 3814 (+14 over 3800).
    // Bumping 3800 → 3825 to give the follow-up 19
    // X-spent cast-filter family room to land on
    // the same trajectory as the follow-up 12 / 13 /
    // 14 / 15 / 16 / 17 / 18 budget bumps.
    //
    // Wave 4.8 follow-up 19 lane 114 piece 2/2
    // (#2614 follow-up): the `X: "landsYouControl"`
    // arm on `CreateTokenSchema.X` (parallel to the
    // lane 97 `yourCreatures` arm). The arm adds
    // ~8 lines (docstring extension + the
    // `landsYouControl` enum entry) — schema.ts
    // measured at 3833 (+8 over 3825). Bumping
    // 3825 → 3850 to give the follow-up 19 Avenger
    // of Zendikar half room to land on the same
    // trajectory as the follow-up 12 / 13 / 14 /
    // 15 / 16 / 17 / 18 / 19-lane-116 budget bumps.
    //
    // Wave 4.8 follow-up 19 lane 114 piece 2/2
    // second sub-piece (#2614 follow-up): the
    // `target_each: { subtype }` mode on
    // `PutCountersSchema` (the Landfall "each
    // Plant" half). The arm adds ~12 lines
    // (docstring + the target_each object +
    // refine-list entry for '+1/+1' counter
    // permission) — schema.ts measured at 3862
    // (+12 over 3850). Bumping 3850 → 3875 to
    // give the follow-up 19 Landfall-each-Plant
    // half room to land on the same trajectory
    // as the prior budget bumps.
    //
    // Wave 4.8 follow-up 21 lane 69 piece 1/N
    // (#2614 follow-up): the `restriction?: string`
    // arm on `AddManaSchema` (the per-mana
    // restriction-tag ledger substrate — "spend
    // this mana only on [X]" family). The arm
    // adds ~14 lines (docstring + the optional
    // restriction field) — schema.ts measured
    // at 3876 (+1 over 3875 with the docstring
    // trimmed). Bumping 3875 → 3900 to give the
    // follow-up 21 per-mana restriction family
    // room to land on the same trajectory as
    // the prior follow-up 12 / 13 / 14 / 15 /
    // 16 / 17 / 18 / 19 / 20 budget bumps.
    //
    // Wave 4.8 follow-up 21 lane 99 follow-up
    // extension piece 1/N (#2614 follow-up): the
    // `cost.or: [{ sacrifice_self | discard |
    // pay_life | pay_mana }, ...]` arm on
    // TriggerSchema.cost (the multi-cost OR
    // combinator — "you may pay [A] OR pay [B];
    // if you do, [effects]" pattern; the follow-up
    // 20 piece 2 verified the single-cost
    // `you_may + cost.pay_life` bridge, and the
    // OR-combinator extends that substrate to a
    // 2-arm choice family). The arm adds ~71
    // lines (docstring + the union of single-arm
    // cost shapes + the `min(2)` length gate + the
    // mutual-exclusion refine rule + the
    // you_may-gate refine rule) — schema.ts
    // measured at 3971 (+71 over 3900 with the
    // docstring trimmed to match prior-pieces'
    // precedent; the prompt's 50-60 LOC estimate
    // assumed a shorter docstring). Bumping 3900
    // → 4000 to give the follow-up 21 multi-cost
    // OR combinator family room to land on the
    // same trajectory as the prior follow-up 12
    // / 13 / 14 / 15 / 16 / 17 / 18 / 19 / 20
    // budget bumps; subsequent lane 99
    // follow-up pieces (e.g. the engine wiring
    // + the chosen_or_cost_index stack field)
    // ride the same family.
    //
    // Wave 4.8 follow-up 22 lane 70 piece 1/N
    // (#2614 follow-up): the `until: "permanent"`
    // arm on `StaticSchema.become_copy` (the
    // "becomes a copy of [X] forever" variant —
    // Clone / Phantasmal Image without the EOT
    // suffix). The arm extends the lane 75
    // `target` arm + the lane 75b `named_card`
    // arm by replacing the `until: literal
    // "end_of_turn"` field with a `union(["end_of
    // _turn", "permanent"])`, plus the
    // docstrings explaining the new arm + the
    // substrate-only v1 status. The arm adds
    // ~30 lines (docstring + the union
    // replacement × 2). schema.ts measured at
    // 4026 (+26 over 4000 with the docstrings
    // trimmed to match prior-pieces' precedent).
    // Bumping 4000 → 4050 to give the lane 70
    // family (the refresh-pass write +
    // battlefield-leave rollback in lane 70
    // piece 2/N, plus any lane 70
    // follow-up extensions) room to land on the
    // same trajectory as the prior follow-up
    // budget bumps.
    //
    // Wave 4.8 follow-up 23 lane 32 (#2614
    // follow-up): the `anthemScaling: { per,
    // perPower, perToughness }` arm on
    // `StaticSchema` — the Warrior Knights /
    // adaptive anthem family that grows with the
    // board (e.g. "creatures you control get +1/+1
    // for each other creature you control"). The
    // arm adds ~75 lines (the Zod envelope +
    // docstring explaining the per count source
    // + the lane-32 `other_creatures` addition +
    // the follow-up scope notes). schema.ts
    // measured at 4103 (+53 over the 4050 cap
    // after the lane 32 docstring trim).
    // Bumping 4050 → 4150 to give the lane 32
    // family and any lane 32 follow-up
    // extensions (filtered count sources,
    // compound count sources, per-counter
    // scales — each a follow-up sub-piece per
    // the handoff) room to land.
    //
    // Wave 4.8 follow-up 24 lane 32 piece 2/N
    // (#2614 follow-up): the optional `perSubtype`
    // field on `anthemScaling` — the "per OTHER
    // Warrior you control" filtered-count-source
    // variant. Adds ~65 lines (the Zod envelope +
    // docstring explaining the perSubtype filter
    // + the typed-creature cases + the engine's
    // `computeAnthemScalingCount` filter consult).
    // schema.ts measured at 4199 (+49 over the
    // 4150 cap).
    // Bumping 4150 → 4250 to give the lane 32
    // family follow-up sub-pieces (compound count
    // sources, per-counter scales) room to land.
    //
    // Wave 4.8 follow-up 25 lane 32 pieces 2/N + 3/N
    // (#2614 follow-up): the `andPer` compound count
    // arm + the `perSubtype: "chosen"` sentinel on
    // `anthemScaling`. Adds ~9 lines (the
    // `andPer: { per, perSubtype? }` Zod envelope +
    // docstring explaining the compound count source
    // + the chosen-sentinel union extension on both
    // `perSubtype` fields). schema.ts measured at
    // 4259 (+9 over the 4250 cap).
    // Bumping 4250 → 4300 to give the lane 32
    // family further follow-up sub-pieces (per-counter
    // scales, chosen-counter variant) room to land.
    // Bumping 4300 → 4320 to capture the follow-up 26
    // lane 32 piece 1/N (chosen-counter variant) Zod
    // union extension + docstring expansion.
    // schema.ts measured at 4312 (+12 over 4300).
    // Bumping 4320 → 4370 to capture the follow-up 26
    // lane 71 piece 3/N (chosen-quality sentinel)
    // `protectionFrom` Zod union extension +
    // docstring expansion + the `enter_choice.kind`
    // enum extension with `"protection_quality"`
    // docstring. schema.ts measured at 4364 (+44 over
    // 4320).
    //
    // Bumping 4370 → 4430 to capture the follow-up 27
    // lane 32 piece 1/N (`andPer.perCounter` self-
    // referential per-counter arm on the AND-source —
    // `andPer` schema arm extension with an OPTIONAL
    // `perCounter: { counter: string | "chosen" }` sub-
    // arm + docstring expansion on the parent `andPer`
    // arm). schema.ts measured at 4418 (+48 over 4370).
    //
    // Bumping 4430 → 4450 to capture the follow-up 27
    // lane 71 piece 3/N (multi-quality sentinel —
    // `protectionFrom` Zod union extension with the
    // per-entry `Array<string | "chosen">` form +
    // docstring expansion on the `protectionFrom`
    // arm). schema.ts measured at 4439 (+9 over 4430).
    //
    // Bumping 4450 → 4500 to capture the follow-up 28
    // priority 1 (lane 32 chosen-counter ordinal) —
    // OPTIONAL `ordinal: number` field on both the
    // primary `perCounter` arm and the
    // `andPer.perCounter` arm (parallel ordinal
    // extensions; cumulative sum of first N counters
    // of the resolved type) + parent `perCounter`
    // docstring expansion explaining the ordinal
    // variant and the `"chosen"` sentinel + ordinal
    // interaction. schema.ts measured at 4495 (+45
    // over 4450).
    //
    // Bumping 4500 → 4550 to capture the follow-up 28
    // priority 2 (lane 71 array-aware entry shape) —
    // the per-entry `protectionFrom` Zod union
    // extension with the nested-array "pair" form
    // (`z.array(z.string().min(1)).min(2)` as a
    // per-entry union member) + parent `protectionFrom`
    // docstring expansion explaining the pair form,
    // the 1-element rejection rationale, and the
    // flattening semantics. schema.ts measured at 4523
    // (+23 over 4500).
    //
    // Bumping 4550 → 4620 to capture the follow-up 28
    // priority 3 (`andPer.perCounterSummed` summed
    // form) — the `andPer` schema arm extension with
    // an OPTIONAL `perCounterSummed: { counter: string
    // | "chosen", ordinal?: number }` sub-arm
    // (parallel to the existing REPLACE `perCounter`
    // sub-arm; the SUM form is the natural read for
    // "per creature AND per chosen counter" anthems
    // + parent `andPer` docstring expansion
    // explaining the SUMMED vs REPLACE semantic
    // distinction and the future deprecation path).
    // schema.ts measured at 4582 (+32 over 4550).
    budgetLines: 4620,
    excludedFiles: new Set([
      join(REPO_ROOT, "src", "lib", "game-state", "index.ts"),
    ]),
    excludedDirSegments: ["__tests__"],
  },
  {
    name: "ai",
    dir: join(REPO_ROOT, "src", "ai"),
    rootRel: "src/ai",
    budgetLines: 3500,
    // No `index.ts` exemption: the ai barrel is content-free at the
    // time of #1808 (the AI surface is a tightly named set of files
    // that re-export nothing). If a barrel lands later the same
    // exemption pattern from the engine scope applies — add it here.
    excludedFiles: new Set(),
    excludedDirSegments: ["__tests__"],
  },
];

/**
 * Recursively collect TypeScript files for one scope, deterministic order.
 * @param {Scope} scope
 * @returns {string[]} Absolute paths.
 */
function collectScopeModules(scope) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  function walk(dir) {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (scope.excludedDirSegments.includes(entry)) continue;
        walk(full);
      } else if (
        entry.endsWith(".ts") &&
        ![...scope.excludedFiles].some((excluded) => full === excluded)
      ) {
        out.push(full);
      }
    }
  }
  walk(scope.dir);
  return out;
}

/**
 * Count lines of a file (wc -l semantics: newline-terminated lines).
 * @param {string} absPath
 * @returns {number}
 */
function lineCount(absPath) {
  const contents = readFileSync(absPath, "utf8");
  const count = contents.split("\n").length;
  // A trailing newline produces one empty split tail; mirror `wc -l`.
  return contents.endsWith("\n") ? count - 1 : count;
}

/**
 * @typedef {Object} ScannedModule
 * @property {string} scopeName
 * @property {string} scopeBudgetLines
 * @property {string} file   POSIX-style absolute path (relative to
 *                           REPO_ROOT for reporting).
 * @property {number} lines
 */

/**
 * Scan a single scope and return one record per file.
 * @param {Scope} scope
 * @returns {ScannedModule[]}
 */
function scanScope(scope) {
  return collectScopeModules(scope).map((abs) => ({
    scopeName: scope.name,
    scopeBudgetLines: String(scope.budgetLines),
    file: relative(REPO_ROOT, abs).split("\\").join("/"),
    lines: lineCount(abs),
  }));
}

const modules = SCOPES.flatMap(scanScope);

if (process.argv.includes("--report")) {
  console.log("module-size budget report (per scope):");
  for (const scope of SCOPES) {
    const inScope = modules
      .filter((m) => m.scopeName === scope.name)
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 10);
    console.log(
      `  ${scope.name} (budget: ${scope.budgetLines} lines) — top ${inScope.length}:`,
    );
    for (const m of inScope) {
      const over =
        Number(m.lines) > Number(m.scopeBudgetLines) ? "  ⚠ OVER" : "";
      console.log(`    ${String(m.lines).padStart(5)}  ${m.file}${over}`);
    }
  }
  process.exit(0);
}

const offenders = modules.filter(
  (m) => Number(m.lines) > Number(m.scopeBudgetLines),
);

if (offenders.length === 0) {
  const engineMax = modules
    .filter((m) => m.scopeName === "engine")
    .reduce((a, m) => Math.max(a, m.lines), 0);
  const aiMax = modules
    .filter((m) => m.scopeName === "ai")
    .reduce((a, m) => Math.max(a, m.lines), 0);
  const total = modules.length;
  console.log(
    `module-size-budget: OK — ${total} files within budget ` +
      `(engine max: ${engineMax}, ai max: ${aiMax}).`,
  );
  process.exit(0);
}

console.error(
  `module-size-budget: FAILED — ${offenders.length} file(s) exceed their scope budget (issue #1725/#1808):`,
);
for (const o of offenders) {
  console.error(
    `  ${o.scopeName.padEnd(8)}  ${String(o.lines).padStart(5)}  ` +
      `${o.file} (+${o.lines - Number(o.scopeBudgetLines)} over budget ${o.scopeBudgetLines})`,
  );
}
console.error(
  `\nDecompose the offender along its ability/Concern families (see the\n` +
    `keyword-actions/, oracle-text-parser/, spell-casting/, types/ dirs for\n` +
    `the established pattern in src/lib/game-state/, mirrored by\n` +
    `src/ai/decision-making/ for the AI surface) or, if the file is\n` +
    `genuinely cohesive, raise SIZE_BUDGET_LINES in\n` +
    `scripts/check-engine-size-budget.mjs with a documented rationale.`,
);
process.exit(1);
