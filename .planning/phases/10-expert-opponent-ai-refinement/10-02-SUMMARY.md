---
phase: 10-expert-opponent-ai-refinement
plan: 02
subsystem: AI - Multi-target & Variable Cost
tags: [ai, multi-target, variable-cost, modal-spells]
dependency_graph:
  requires: [10-01]
  provides:
    - Multi-target spell evaluation
    - Variable cost evaluation (X spells, kicker)
    - Modal spell choice evaluation
  affects: [StackInteractionAI, ai-action-executor]
tech_stack:
  added: []
  patterns: [multi-target-evaluation, variable-cost-decisions]
key_files:
  created: []
  modified:
    - src/ai/stack-interaction-ai.ts
    - src/ai/ai-action-executor.ts
decisions: []
metrics:
  duration: null
  completed_date: 2026-03-17
---

# Phase 10 Plan 2: Multi-Target & Variable Cost Support Summary

## One-Liner

Added multi-target spell support, variable cost evaluation (X spells, kicker), and modal spell choice handling.

## Completed Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Extend StackAction and AvailableResponse types | 1e42e37 |
| 2 | Implement multi-target evaluation logic | 1e42e37 |
| 3 | Update action executor for complex spell targets | 1e42e37 |

## Changes Made

### Task 1: Type Extensions
Extended StackAction interface:
- `targetCount?: number` - number of targets for multi-target spells
- `isMultiTarget?: boolean` - flag for multi-target spells
- `hasXCost?: boolean` - for X-cost spells
- `kickerCost?: number` - additional cost for kicker
- `modalChoices?: string[]` - for "choose one" spells

Extended AvailableResponse interface:
- `targetCount?: number` - max targets we can select
- `canTargetMultiple?: boolean` - ability to target multiple
- `variableCost?: boolean` - has X or kicker
- `hasXCost?: boolean` - has X-cost ability
- `hasKicker?: boolean` - has kicker ability
- `modalOptions?: string[]` - available modes for modal spells

### Task 2: Evaluation Methods
Added three new evaluation methods:
- `evaluateMultiTargetResponse()` - evaluates optimal target selection for multi-target spells
- `evaluateVariableCost()` - determines optimal X value or whether to kick
- `evaluateModalChoice()` - evaluates which mode of a modal spell is best

### Task 3: Action Executor Updates
Extended AIAction interface:
- `targetIds?: string[]` - array of target IDs for multi-target
- `xValue?: number` - X value for X-cost spells
- `kicked?: boolean` - whether kicker was paid
- `mode?: string` - selected mode for modal spells

Updated `executeCastSpell` to handle:
- Multiple targets (array of targetIds)
- X-cost spells (xValue parameter)
- Kicker (passed as part of cost calculation)
- Modal spells (chosenModes parameter)

## Verification

- StackAction/AvailableResponse support multi-target and variable cost (grep verified)
- Multi-target evaluation methods exist (grep verified)
- Action executor supports complex spell targeting (grep verified)

## Deviations

None - plan executed exactly as written.

## Self-Check: PASSED

- Files created/modified exist: ✅
- Commits verified: ✅
