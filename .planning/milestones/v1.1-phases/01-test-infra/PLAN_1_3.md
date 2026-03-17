# Plan 1.3: Jest JSX Configuration

**Phase:** 1 - Test Infrastructure  
**Priority:** Low  
**Estimate:** 1 hour

## Goal
Fix Jest configuration to properly parse .tsx files

## Background
Jest cannot parse JSX in coach-components.test.tsx - test configuration issue.

## Deliverables
1. Updated Jest transformer configuration
2. All .tsx tests parse correctly

## Tasks
1. [ ] Verify Jest config has proper transformer for TSX
2. [ ] Update jest.config.js if needed
3. [ ] Run coach-components test and verify

## Acceptance Criteria
- All Jest tests parse JSX correctly
- No JSX parsing errors
