# Plan 2.1: Import/Export E2E Fixes

**Phase:** 2 - E2E Test Stabilization  
**Priority:** Medium  
**Estimate:** 1-2 hours

## Goal
Fix failing import/export E2E tests by adding proper wait conditions

## Background
Import/export round-trip E2E tests fail due to timing issues - tests don't wait for async operations to complete.

## Deliverables
1. Fixed E2E tests with proper waits
2. Reliable import/export test coverage

## Tasks
1. [ ] Run import/export E2E tests and observe failures
2. [ ] Add waitForSelector for dialogs
3. [ ] Add delay/wait for clipboard operations
4. [ ] Fix round-trip test timing
5. [ ] Verify tests pass consistently

## Acceptance Criteria
- Import/export E2E tests pass reliably
- No timing-related flakiness
