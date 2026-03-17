# Roadmap: v1.1 - Polish & Stability Pass

**Milestone:** v1.1  
**Started:** 2026-03-16  
**Goal:** Fix known issues from v1.0 QA and improve overall quality

---

## Phase 1: Test Infrastructure (Priority: High)

### Goal
Fix test infrastructure issues that block reliable CI/CD

### Plans

| # | Title | Priority | Description |
|---|-------|----------|-------------|
| 1.1 | Jest Test Data Seeding | Medium | Seed test data in jest.setup.js for card database tests |
| 1.2 | Fix Serialization Timestamp | Medium | Fix timestamp comparison flakiness in serialization tests |
| 1.3 | Jest JSX Configuration | Low | Fix Jest configuration for .tsx file parsing |

**Dependencies:** None  
**Estimated:** 3-4 hours

---

## Phase 2: E2E Test Stabilization (Priority: High)

### Goal
Fix failing E2E tests and improve selector reliability

### Plans

| # | Title | Priority | Description |
|---|-------|----------|-------------|
| 2.1 | Import/Export E2E Fixes | Medium | Add proper wait conditions for import/export tests |
| 2.2 | Multiplayer Lobby Tests | Medium | Fix test environment routing and selectors |
| 2.3 | AI Coach Selectors | Medium | Match actual component IDs in coach E2E tests |
| 2.4 | Game Board Selectors | Low | Fix life totals, turn/phase indicator selectors |
| 2.5 | Cross-Browser Setup | Low | Install Firefox/WebKit for CI pipeline |

**Dependencies:** Phase 1  
**Estimated:** 5-6 hours

---

## Phase 3: Code Quality (Priority: Medium)

### Goal
Clean up ESLint warnings and improve code quality

### Plans

| # | Title | Priority | Description |
|---|-------|----------|-------------|
| 3.1 | ESLint Warning Cleanup | Low | Address ~100 ESLint warnings (unused vars, console) |
| 3.2 | TypeScript Strict Mode | Low | Enable stricter type checking where appropriate |

**Dependencies:** None (can run parallel)  
**Estimated:** 2-3 hours

---

## Phase 4: Performance Optimization (Priority: Medium)

### Goal
Improve cold start performance and overall responsiveness

### Plans

| # | Title | Priority | Description |
|---|-------|----------|-------------|
| 4.1 | Bundle Analysis | Medium | Analyze bundle size and identify optimization opportunities |
| 4.2 | Code Splitting | Medium | Implement better code splitting for routes |
| 4.3 | Service Worker Caching | Low | Add service worker for offline caching |

**Dependencies:** None  
**Estimated:** 3-4 hours

---

## Phase 5: UX Enhancements (Priority: Medium)

### Goal
Improve user experience with mobile support and keyboard shortcuts

### Plans

| # | Title | Priority | Description |
|---|-------|----------|-------------|
| 5.1 | Mobile Responsiveness | Medium | Ensure deck builder works on smaller screens |
| 5.2 | Keyboard Shortcuts | Low | Add common actions (save, undo, search) |

**Dependencies:** None (can run parallel)  
**Estimated:** 2-3 hours

---

## Summary

| Phase | Plans | Estimated |
|-------|-------|-----------|
| Phase 1: Test Infrastructure | 3 | 3-4h |
| Phase 2: E2E Test Stabilization | 5 | 5-6h |
| Phase 3: Code Quality | 2 | 2-3h |
| Phase 4: Performance Optimization | 3 | 3-4h |
| Phase 5: UX Enhancements | 2 | 2-3h |
| **Total** | **15** | **15-20 hours** |

---

## Execution Order

**Wave 1 (Parallel):** Phase 1, Phase 3, Phase 5  
**Wave 2 (After Phase 1):** Phase 2  
**Wave 3 (After Phase 2):** Phase 4
