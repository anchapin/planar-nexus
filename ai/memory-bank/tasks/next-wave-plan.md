# Planar Nexus - Next Wave Development Plan

**Date:** May 22, 2026
**Author:** SeniorProjectManager

## Issue Analysis Summary

This wave focuses on **5 High Priority rules engine issues** that are foundational to Magic game play. These issues have interdependencies and should be worked in parallel where possible.

### High Priority Issues (5)

| Issue | Title | Dependencies |
|-------|-------|--------------|
| #855 | Complete stack resolution for all spell effect types | None - but feeds into #856 |
| #856 | Triggered ability system (CR 603) | None - feeds into #859 |
| #857 | Protection/hexproof targeting validation (CR 702.16) | None |
| #858 | Planeswalker damage handling (CR 306.5) | None |
| #859 | Priority pass system with APNAP ordering | Depends on #856 trigger system |

### Medium Priority Issues (4) - Next Wave

| Issue | Title |
|-------|-------|
| #860 | X-cost spell handling |
| #863 | Phasing implementation (CR 702.19) |
| #867 | Layer 1-6 continuous effect application |
| #868 | Deterministic RNG for multiplayer sync |

### Quick Win (1)

| Issue | Title |
|-------|-------|
| #842 | Add try/catch error handling to P2P async methods |

---

## High Priority Wave - Technical Breakdown

### Issue #855: Complete Stack Resolution
**Problem:** Only handles board sweepers and simple damage to creatures. Missing card draw, life gain/loss, counters, tokens, etc.

**Key Files:**
- `src/lib/game-state/spell-casting.ts` - resolveTopOfStack function
- `src/lib/game-state/oracle-text-parser.ts` - parseKicker, parseAlternativeCost, modes
- `src/lib/game-state/types.ts` - StackObject, effect types

**Implementation Approach:**
1. Extend StackObject to include structured effect types
2. Parse spell effects into structured data (not just oracle text matching)
3. Implement effect resolution handlers for each type:
   - Card draw effects
   - Life gain/loss effects
   - Token creation
   - Counter spells
   - Damage redirection

### Issue #856: Triggered Ability System
**Problem:** Trigger detection incomplete. Only ETB triggers are handled via checkTriggeredAbilities.

**Key Files:**
- `src/lib/game-state/abilities.ts` - detectTriggeredAbilities, TriggerEvent types
- `src/lib/game-state/state-based-actions.ts` - SBA checking point
- `src/lib/game-state/turn-phases.ts` - phase advancement

**Implementation Approach:**
1. Add trigger event types: phaseChange, damageDealt, lifeLost, dies, attacked, cast
2. Implement detectTriggeredAbilities function with comprehensive event checking
3. Wire trigger detection into SBA checking at appropriate points (CR 704.5j)

### Issue #857: Protection/Hexproof Targeting Validation
**Problem:** Protection, hexproof, and shroud don't prevent invalid targeting.

**Key Files:**
- `src/lib/game-state/validation-service.ts` - target validation
- `src/lib/game-state/evergreen-keywords.ts` - protection, hexproof, shroud
- `src/lib/game-state/spell-casting.ts` - casting validation

**Implementation Approach:**
1. Create targeting validation function that checks keyword abilities
2. Add protection.fromColor, hexproof (boolean), shroud (boolean) to CardInstance
3. Check targeting validity before casting/spell resolution

### Issue #858: Planeswalker Damage Handling
**Problem:** Combat damage to planeswalkers not implemented - damage should redirect to loyalty counters.

**Key Files:**
- `src/lib/game-state/combat.ts` - dealCombatDamage
- `src/lib/game-state/card-instance.ts` - planeswalker loyalty tracking
- `src/lib/game-state/state-based-actions.ts` - SBA 704.5i (planeswalker destruction)

**Implementation Approach:**
1. In combat.ts, redirect damage when attacking planeswalker
2. Reduce planeswalker loyalty counters equal to damage
3. Add SBA check: loyalty <= 0 → exile planeswalker

### Issue #859: Priority Pass System with APNAP
**Problem:** Priority system incomplete. Players have passed flags but actual pass mechanic not implemented.

**Key Files:**
- `src/lib/game-state/types.ts` - priorityPlayerId, consecutivePasses in GameState
- `src/lib/game-state/turn-phases.ts` - phase advancement logic
- `src/lib/game-state/game-state.ts` - priority handling

**Implementation Approach:**
1. Implement passPriority function that handles APNAP ordering
2. When all players pass consecutively on empty stack → advance phase
3. Implement APNAP ordering: active player first, then non-active in turn order

---

## Task Assignment (5 Parallel Agents)

Each agent will:
1. Create a branch named `feature/issue-XXX-brief-description`
2. Implement the feature with tests
3. Create a PR with reference to the issue

| Agent | Issue | Branch Name |
|-------|-------|-------------|
| backend-engineer-1 | #855 | feature/855-complete-stack-resolution |
| backend-engineer-2 | #856 | feature/856-triggered-ability-system |
| backend-engineer-3 | #857 | feature/857-protection-hexproof-targeting |
| backend-engineer-4 | #858 | feature/858-planeswalker-damage |
| backend-engineer-5 | #859 | feature/859-priority-pass-apnap |

---

## Quality Requirements

- All implementations must have Jest tests
- Tests should cover edge cases (protection from multiple colors, APNAP with >2 players, etc.)
- No breaking changes to existing working functionality
- Follow existing code patterns in the codebase
- CR (Comprehensive Rules) references must be documented in code comments