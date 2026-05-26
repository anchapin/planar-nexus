# Next Wave of GitHub Issues - Implementation Plan

## Executive Summary

This plan covers 4 GitHub issues for the next development wave. Based on codebase analysis, we have a clear picture of what each issue requires.

## Issue Analysis

### Issue #858 (HIGH) - Planeswalker Damage Handling

**Files identified:**

- `src/lib/game-state/combat.ts` (lines 474-486) - TODO comment confirms implementation needed
- `src/lib/game-state/keyword-actions.ts` (line 796) - dealDamageToCard exists
- `src/lib/game-state/types.ts` - isAttackingPlaneswalker field exists

**Current state:** isAttackingPlaneswalker is set but damage handling is incomplete. CR 306.5 requires:

1. Damage redirects to planeswalker (already being tracked)
2. Loyalty counters reduced by damage
3. SBA 704.5i: loyalty <= 0 → exile

**Work tree:** `feature/issue-858-planeswalker-damage` exists, branched from `main`

### Issue #842 (QUICK WIN) - P2P Error Handling

**Files identified:**

- `src/lib/webrtc-p2p.ts` - needs try/catch in initialize(), createOffer(), handleOffer(), addIceCandidate()
- `src/lib/p2p-signaling-client.ts` - same pattern
- `src/lib/p2p-game-connection.ts` - data channel handlers
- `src/hooks/use-p2p-connection.ts` - hook methods

**Current state:** Methods throw but callers get no error feedback. Error handling pattern needed.

**Work tree:** No existing branch - should create one.

### Issue #860 (MEDIUM) - X-Cost Spell Handling

**Files identified:**

- `src/lib/game-state/oracle-text-parser.ts` (line 1433) - parseXCost exists
- `src/app/(app)/game/[id]/page.tsx` (line 97, 1686) - UI uses parseXCost

**Current state:** parseXCost is implemented but:

1. UI needs to prompt for X value before casting
2. Value needs validation against maximum allowed
3. Effects need to use stored X value during resolution

**Work tree:** `feature/issue-860-x-cost-spells` exists

### Issue #866 (MEDIUM) - Event Sourcing Single Source of Truth

**Files identified:**

- `src/lib/game-state/event-sourcing.ts` - EventSourcingGameState class
- `src/lib/game-state/event-sourced-game-state.ts`
- `src/lib/game-state/state-hash.ts`

**Current state:** Event sourcing infrastructure exists but state mutations bypass event log.

**Work tree:** `feature/issue-866-event-sourcing` exists

---

## Implementation Order (By Priority)

### Wave 1: High Priority & Quick Wins

1. **Issue #842 (Quick Win)** - P2P Error Handling - Fast, self-contained
2. **Issue #858 (High)** - Planeswalker Damage - Core combat fix

### Wave 2: Medium Priority

3. **Issue #860 (Medium)** - X-Cost Spells - More complex, UI involved
4. **Issue #866 (Medium)** - Event Sourcing - Architectural, requires design

---

## Technical Notes

### Issue #858 - Planeswalker Damage

- dealDamageToCard already exists in keyword-actions.ts
- Need to add loyalty reduction logic when damage target is a planeswalker
- Need SBA 704.5i check for planeswalker loyalty <= 0

### Issue #842 - P2P Error Handling

- Wrap async methods in try/catch
- Surface errors via existing error state/callbacks
- Use existing error handling patterns in codebase

### Issue #860 - X-Cost Spells

- UI needs modal/prompt for X value input
- Validate X against maximum (usually mana available)
- Store X value for use during resolution

### Issue #866 - Event Sourcing

- Need to audit all state mutation points
- Ensure all mutations flow through event log
- May need state hash verification at checkpoints

---

## Quality Requirements

- All changes must include tests
- Follow existing code patterns
- Update relevant documentation
- Create PR with clear description referencing issue

## Timeline Estimate

- Issue #842: 1-2 hours (quick win)
- Issue #858: 4-6 hours
- Issue #860: 6-8 hours
- Issue #866: 8-12 hours (architectural)
