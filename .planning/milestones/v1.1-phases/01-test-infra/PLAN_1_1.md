# Plan 1.1: Jest Test Data Seeding

**Phase:** 1 - Test Infrastructure  
**Priority:** Medium  
**Estimate:** 1-2 hours

## Goal
Seed test data in jest.setup.js so card database unit tests pass reliably

## Background
Card database tests fail because the test environment has no seeded data. Tests expect cards to exist but the database is empty.

## Deliverables
1. jest.setup.js with test data seeding
2. Mock IndexedDB implementation for Node environment
3. All card database unit tests passing

## Tasks
1. [ ] Create/verify jest.setup.js exists
2. [ ] Add mock card data (20+ cards covering various types)
3. [ ] Mock IndexedDB using idb or similar
4. [ ] Run tests and verify pass rate

## Acceptance Criteria
- All card database unit tests pass
- No test infrastructure errors
