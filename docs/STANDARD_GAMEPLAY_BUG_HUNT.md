# Standard Gameplay Bug Hunt — Master Plan

**Created:** April 25, 2026  
**Goal:** Exhaustively find and fix all gameplay bugs affecting Standard-format cards.  
**Scope:** Game engine (`src/lib/game-state/`), UI (`src/app/(app)/game/`), parser, tests.  
**Estimated Duration:** 6–10 chat sessions  

---

## Context

The Planar Nexus MTG engine is **structurally complete but functionally shallow**:

- **Parser** detects 80+ keywords/mechanics  
- **Engine** enforces only ~10 of them fully  
- **UI** has manual overrides that bypass engine rules  
- **Tests** verify card visibility, not mechanic functionality  

Two critical bugs were recently fixed:
1. ✅ Shockland ETB — paying 2 life still entered tapped
2. ✅ Illegal untap — clicking a tapped land during main phase untapped it

This document describes the systematic process to find and fix the remaining bugs.

---

## Phase Overview

| Phase | Name | Issues | Sessions | Goal |
|-------|------|--------|----------|------|
| 1 | **Discovery** | #616–#617 | 1 | Find all gaps automatically |
| 2 | **Core Rules** | #618–#621 | 2–3 | Fix priority, mana, hexproof, menace, shocklands |
| 3 | **Turn Structure** | #624–#625 | 1 | Fix untap step, legendary rule, cleanup |
| 4 | **Combat** | #626–#627 | 2–3 | First strike, double strike, trample, blocker ordering |
| 5 | **Mechanics** | #623, #628 | 2–3 | E2E tests + stub implementations for Standard mechanics |
| 6 | **Verification** | #622 | 1 | Property-based fuzzing to catch edge cases |

---

## Phase 1: Discovery — Find All Gaps

### 1.1 Static Analysis Script (#616)

Write a Node.js script that scans the codebase and reports:

- Keywords parsed by `oracle-text-parser.ts` that have **no enforcement** in `evergreen-keywords.ts`
- Keywords with enforcement functions that are **stubs/no-ops**
- Hardcoded card names in `spell-casting.ts` / `combat.ts` (indicate missing generic systems)
- Manual `passPriority` auto-calls in `page.tsx` (bypass stack rules)
- Manual `tapCard`/`untapCard` calls outside proper ability resolution
- TODO/FIXME/HACK comments in game-state code

**Output:** `reports/gameplay-gap-analysis.md`

### 1.2 Oracle Text Audit Matrix (#617)

Build a tool that:
1. Queries all Standard-legal cards from the card database
2. Parses each card's oracle text
3. Maps detected keywords to implementation status
4. Outputs a CSV/matrix

**Columns:**
- `card_name` | `detected_mechanics` | `has_enforcement` | `has_unit_test` | `has_e2e_test` | `gap_severity`

**Output:** `reports/standard-card-implementation-matrix.csv`

**Use this to prioritize:** Cards with `gap_severity = High` and no tests.

---

## Phase 2: Core Rules — Fix Priority, Mana, Targeting

### 2.1 Fix Auto-Pass Priority Bypassing Stack (#618)

**Problem:** `page.tsx` auto-passes priority after spell casts, preventing:
- Opponent response windows
- Counterspell opportunities
- Instant-speed interaction

**Locations:** Lines 1617, 1817, 2062, 2410, 2458, 2506, 2580 in `page.tsx`

**Fix:** Replace forced `passPriority` loops with an "Auto-resolve" player toggle. When OFF, the human retains priority and must pass manually. When ON, auto-pass only after both players have had priority.

**Tests:** E2E test casting a spell, verifying opponent gets priority before resolution.

### 2.2 Fix Mana Pool Not Emptying at End of Phase (#619)

**Problem:** Mana pools only empty when `emptyAllManaPools` is explicitly called. Per CR 500.4, mana pools empty at end of each step/phase.

**Fix:** Call `emptyAllManaPools` in `advanceToNextPhase` (already partially there — verify it runs for ALL phase transitions, not just turn endings).

**Tests:** Unit test verifying mana pool is empty after phase advancement.

### 2.3 Enforce Hexproof & Menace in Gameplay (#620)

**Hexproof:**
- Detection exists in `evergreen-keywords.ts`
- No targeting enforcement in UI or stack
- **Fix:** Add check in targeting logic: if target has hexproof and controller is different from spell source controller, reject target

**Menace:**
- `getMenaceMinimumBlockers()` returns 2
- No enforcement in `declareBlockers`
- **Fix:** Validate that menace attackers are blocked by ≥ 2 creatures

**Tests:** Unit tests for each keyword enforcement.

### 2.4 Fix Shockland Life Payment & ETB Cleanup (#621)

**Problem 1:** `handleShocklandPayLife` uses `dealDamageToPlayer` for 2 life loss. This is wrong — shockland payment is life loss, not damage. It should not trigger "when dealt damage" abilities.

**Problem 2:** `playLand` auto-tap detection is heuristic-based. We fixed shocklands, but similar conditional ETB effects (fastlands, checklands) may still have edge cases.

**Fix:**
- Add `loseLife` function (distinct from `dealDamageToPlayer`)
- Use `loseLife` in shockland handler
- Verify fastland/checkland ETB behavior with tests

**Tests:** Unit test that shockland payment does not count as damage.

---

## Phase 3: Turn Structure — Untap, Legendary, Cleanup

### 3.1 Implement Complete Untap Step Engine Logic (#624)

**Problem:** `startNextTurn` sets phase to `UNTAP`, then `advanceToNextPhase` skips to `UPKEEP` because `playersGetPriority(Phase.UNTAP)` returns `false`. The untap happens in `advanceToNextPhase` as part of turn transition, not as a proper untap step.

**Real bug:** If a card says "At the beginning of your untap step", there's no actual untap step phase where triggers can fire.

**Fix:** Make the untap step a real phase where:
1. All permanents untap
2. "At beginning of untap step" triggers go on the stack
3. Then phase advances to upkeep

**Tests:** Unit test verifying untap step exists and permanents untap.

### 3.2 Fix Legendary Rule — Let Player Choose (#625)

**Problem:** `state-based-actions.ts` destroys the first legendary and keeps the rest. Per CR, the player chooses which to keep.

**Fix:** When SBA detects multiple legendary permanents with same name, prompt the player (or active player) to choose one to keep. Others go to graveyard.

**Tests:** Unit test with 3 legendary creatures — verify player choice is respected.

---

## Phase 4: Combat System — First Strike, Trample, Ordering

### 4.1 Implement First Strike / Double Strike Combat Steps (#626)

**Problem:** All combat damage is dealt in a single step. First strike and double strike creatures should deal damage in a separate first-strike damage step.

**Fix:** Split `dealCombatDamage` into two steps:
1. **First strike damage step:** Creatures with first strike or double strike deal damage
2. **State-based actions** check (creatures with lethal damage die)
3. **Regular damage step:** Creatures without first strike (and double strikers again) deal damage

**Tests:**
- First strike attacker vs. non-first-strike blocker → blocker dies before dealing damage
- Double strike attacker → deals damage in both steps

### 4.2 Implement Trample Damage Assignment with Blocker Ordering (#627)

**Problem:** Trample is oversimplified. No player choice in blocker ordering or damage assignment.

**Fix:**
1. After blockers declared, attacking player chooses **blocker order** for each blocked attacker
2. During damage assignment, attacker assigns lethal damage to first blocker, then next, etc.
3. Excess damage goes to defending player/planeswalker
4. Deathtouch changes lethal threshold to 1

**UI:** Add blocker ordering UI (drag to reorder blockers)

**Tests:**
- Trample vs. multiple blockers
- Deathtouch + trample interaction

---

## Phase 5: Mechanics — E2E Tests & Stub Implementations

### 5.1 Create Standard Mechanic E2E Functionality Tests (#623)

**Current state:** `e2e/standard-mechanics.spec.ts` only verifies cards are **visible in hand**.

**Goal:** Create E2E tests that actually **use** each mechanic:

| Mechanic | Test Scenario |
|----------|---------------|
| Cycling | Discard Cycling Drake, draw a card |
| Flashback | Cast Flashback Bolt from graveyard, it gets exiled |
| Convoke | Tap creatures to reduce Convoke Angel's cost |
| Explore | Reveal top card, if land → play, else +1/+1 counter |
| Surveil | Look at top 2, choose mill or bottom for each |
| Investigate | Create Clue token, sacrifice to draw |
| Ward | Target Ward Beetle, pay {2} or spell fizzles |
| Disguise | Cast face-down, flip for cost |
| Plot | Exile card, cast from exile on later turn |
| Offspring | Pay extra, create 1/1 copy token |
| Saddle | Tap creatures to "saddle" mount, enable attack ability |
| Food | Create Food token, sacrifice for life |
| Treasure | Create Treasure token, sacrifice for mana |
| Learn | Choose: draw or fetch Lesson from sideboard |
| Valiant | Trigger when targeted by spell/ability for first time |
| Bargain | Sacrifice artifact/enchantment/ftoken to upgrade spell |
| Backup | ETB distribute +1/+1 counters |
| Incubate | Create Incubator token, transform for {2} |

**Priority:** Test the top 5 mechanics first (Cycling, Flashback, Ward, Explore, Convoke).

### 5.2 Implement Standard Mechanic Gameplay Stubs (#628)

For mechanics that are detected but have **zero gameplay effect**, add minimal stubs:

- Show a toast: `"Cycling not yet fully implemented"`
- Add a no-op function in the engine so the mechanic is "handled" (doesn't crash)
- Mark as `@todo` for future full implementation

This prevents the engine from silently ignoring mechanics — players get feedback.

---

## Phase 6: Verification — Property-Based Fuzzing

### 6.1 Build Property-Based Rules Fuzzing Framework (#622)

Extend the existing `property-based.test.ts` to test game invariants:

```typescript
// Example properties to fuzz
"tapped land cannot be tapped again"
"creature with lethal damage is in graveyard after SBA"
"player with 0 life has hasLost = true"
"mana pool is empty at start of each phase"
"summoning sickness creature cannot attack"
"stack resolves LIFO"
"only active player has priority (except instants/flash)"
"legendary rule destroys all but one"
```

**Tool:** Use `fast-check` or the project's existing property-based framework.

**Process:**
1. Generate random valid game state
2. Generate random valid action
3. Apply action
4. Assert invariants hold
5. If invariant fails → bug report with minimal reproduction

---

## Issue Quick Reference

| Issue | Title | Phase | Effort |
|-------|-------|-------|--------|
| #616 | Build Static Analysis & Gap Detection Tool | 1 | Medium |
| #617 | Oracle Text Audit: Standard Card Implementation Matrix | 1 | Medium |
| #618 | Fix Priority/Stack System: Remove Auto-Pass Behavior | 2 | Large |
| #619 | Fix Mana Pool Emptying at End of Phase/Step | 2 | Small |
| #620 | Enforce Hexproof & Menace in Gameplay | 2 | Medium |
| #621 | Fix Shockland Life Payment & ETB Cleanup | 2 | Small |
| #622 | Build Property-Based Rules Fuzzing Framework | 6 | Large |
| #623 | Create Standard Mechanic E2E Functionality Tests | 5 | X-Large |
| #624 | Implement Complete Untap Step Engine Logic | 3 | Medium |
| #625 | Fix Legendary Rule Player Choice | 3 | Medium |
| #626 | Implement First Strike / Double Strike Combat Steps | 4 | Large |
| #627 | Implement Trample Damage Assignment with Blocker Ordering | 4 | X-Large |
| #628 | Implement Standard Mechanic Gameplay Stubs | 5 | Medium |

---

## Session A Results (Completed)

**Date:** 2026-04-25

### Deliverables

1. **Static Analysis Script:** `scripts/analyze-gameplay-gaps.ts`
2. **Gap Report:** `reports/gameplay-gap-analysis.md`
3. **Oracle Audit Script:** `scripts/audit-standard-cards.ts`
4. **Card Matrix:** `reports/standard-card-implementation-matrix.csv` + `.md`

### Key Findings

#### 1. Keyword Enforcement is Nearly Non-Existent

| Status | Count |
|--------|-------|
| Fully enforced | **3** (flash, haste, vigilance) |
| Partially enforced | **11** (functions exist but not wired to gameplay) |
| Not enforced | **243** |

**Critical architectural finding:** `combat.ts` contains **19 raw `oracle_text.includes()` checks** instead of using the `evergreen-keywords.ts` helper functions. The helper functions are defined and tested but **never called by actual gameplay code**. This means:
- Flying, deathtouch, lifelink, trample, menace, hexproof, ward, etc. are detected but not enforced through the proper abstraction layer
- The engine has two parallel keyword systems: parsed keywords (unused) and raw oracle text scanning (used by combat)

#### 2. Auto-Pass Priority Destroys Stack Interaction

**28 locations** in `page.tsx` force both players to pass priority automatically. This prevents:
- Counterspell windows
- Instant-speed responses
- Any meaningful stack interaction

#### 3. Hardcoded Card Effects

**10 cards** have hardcoded effects in `spell-casting.ts` and `page.tsx`:
- Lightning Bolt (3 damage)
- Goblin Guide (attack trigger — simplified to opponent draws a card, which is wrong)
- Duress / Thoughtseize / Inquisition (hand targeting)

Each hardcoded card represents a missing generic system.

#### 4. Standard Mechanic Cards Are Cosmetic Only

Of the 64 cards analyzed (fixtures + mock tests):
- **3 critical gaps:** Ward Beetle, Cycling Drake, Convoke Angel
- **14 high gaps:** All Standard set mechanics (Surveil, Explore, Investigate, Disguise, Plot, Offspring, Saddle, Food, Treasure, Learn, Valiant, Bargain, Backup, Incubate)
- **2 fully implemented:** Basic lands, simple direct damage spells

None of the Standard set mechanics have any gameplay enforcement.

#### 5. No TODO/FIXME Comments

Surprisingly, **0 TODO/FIXME/HACK/XXX comments** exist in game-state code. This suggests either:
- The code is considered "complete" by its authors (it is not)
- OR gaps were never documented

---

## Session Planning

### Session A (Discovery) ✅ COMPLETE
- #616 — Write static analysis script, run it, review gap report
- #617 — Build Oracle text audit matrix, generate CSV
- **Outcome:** Prioritized list of bugs to fix
- **Actual findings:** 243 unenforced keywords, 28 auto-pass locations, 10 hardcoded cards, 17 unimplemented Standard mechanics

### Session B (Core Rules Part 1)
- #619 — Fix mana pool emptying
- #621 — Fix shockland life payment
- #620 — Enforce hexproof & menace
- **Outcome:** Core targeting and mana rules work correctly

### Session C (Core Rules Part 2)
- #618 — Fix auto-pass priority (largest change)
- **Outcome:** Stack interaction works properly

### Session D (Turn Structure)
- #624 — Implement untap step
- #625 — Fix legendary rule
- **Outcome:** Turn structure is rules-accurate

### Session E (Combat Part 1)
- #626 — First strike / double strike
- **Outcome:** Combat damage steps are separated

### Session F (Combat Part 2)
- #627 — Trample + blocker ordering
- **Outcome:** Complex combat interactions work

### Session G (Mechanics Part 1)
- #628 — Add gameplay stubs for all detected mechanics
- #623 — Write E2E tests for top 5 mechanics
- **Outcome:** Mechanics are visible and testable

### Session H (Mechanics Part 2)
- #623 — Write E2E tests for remaining mechanics
- **Outcome:** All Standard mechanics have functional tests

### Session I (Verification)
- #622 — Build fuzzing framework
- Run fuzzing, fix discovered edge cases
- **Outcome:** Engine is robust against edge cases

---

## How to Use This Document

1. **Before each session:** Check which issues are still open
2. **During each session:** Focus on the issue(s) assigned to that session
3. **After each session:** Update this document with what was completed, add new bugs found
4. **Cross off completed issues** in the Quick Reference table

## Notes

- Issues are designed to be **independent** where possible — some can be done in parallel
- Combat issues (#626, #627) depend on each other — do #626 before #627
- Property-based fuzzing (#622) should be done **after** core fixes — fuzzing a broken engine finds too much noise
- If new bugs are discovered during any phase, add them as new issues and update this document
