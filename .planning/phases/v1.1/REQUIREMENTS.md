# Requirements: v1.1 - Polish & Stability Pass

**Milestone:** v1.1  
**Created:** 2026-03-16  
**Goal:** Fix known issues from v1.0 QA and improve overall quality

---

## REQ-1: Test Infrastructure Fixes

### REQ-1.1: Jest Test Data Seeding
- [ ] Add test data seeding in jest.setup.js
- [ ] Mock IndexedDB for unit tests
- [ ] Ensure 100% unit test pass rate

**Acceptance:** All card database unit tests pass

### REQ-1.2: Serialization Test Fix
- [ ] Use time-insensitive comparison in timestamp tests
- [ ] Mock Date.now() for deterministic tests

**Acceptance:** Serialization tests pass consistently

### REQ-1.3: Jest JSX Configuration
- [ ] Configure Jest transformer for .tsx files
- [ ] Fix coach-components test

**Acceptance:** All Jest tests can parse JSX

---

## REQ-2: E2E Test Stabilization

### REQ-2.1: Import/Export E2E
- [ ] Add waitForSelector for dialogs
- [ ] Add delay for clipboard operations
- [ ] Fix round-trip test timing

**Acceptance:** Import/export E2E tests pass reliably

### REQ-2.2: Multiplayer Lobby Tests
- [ ] Fix page routing in test environment
- [ ] Update selectors to match actual components
- [ ] Add proper navigation waits

**Acceptance:** Multiplayer lobby E2E tests pass

### REQ-2.3: AI Coach E2E Selectors
- [ ] Verify actual component IDs match selectors
- [ ] Update test selectors accordingly
- [ ] Add waits for async data loading

**Acceptance:** AI Coach E2E tests pass reliably

### REQ-2.4: Game Board Selectors
- [ ] Verify life total element IDs
- [ ] Verify turn indicator IDs
- [ ] Verify phase indicator IDs
- [ ] Update tests to match actual implementation

**Acceptance:** Game board E2E selectors work

### REQ-2.5: Cross-Browser Testing
- [ ] Install Firefox browser for Playwright
- [ ] Install WebKit for Playwright
- [ ] Update CI to run all browsers

**Acceptance:** Tests run on Chromium, Firefox, WebKit

---

## REQ-3: Code Quality

### REQ-3.1: ESLint Warning Cleanup
- [ ] Remove unused variables
- [ ] Remove or properly guard console statements
- [ ] Fix any lint errors

**Acceptance:** Zero ESLint errors, minimal warnings

### REQ-3.2: TypeScript Strict Mode
- [ ] Review strict mode opportunities
- [ ] Add noImplicitAny where safe
- [ ] Fix discovered type issues

**Acceptance:** Build passes with stricter checks

---

## REQ-4: Performance Optimization

### REQ-4.1: Bundle Analysis
- [ ] Run bundle analyzer
- [ ] Identify large dependencies
- [ ] Document optimization opportunities

**Acceptance:** Bundle analysis complete

### REQ-4.2: Code Splitting
- [ ] Implement route-based splitting
- [ ] Lazy load non-critical components
- [ ] Optimize dynamic imports

**Acceptance:** Initial bundle < 200KB

### REQ-4.3: Service Worker Caching
- [ ] Add service worker registration
- [ ] Implement cache-first strategy for assets
- [ ] Handle offline scenarios gracefully

**Acceptance:** Subsequent loads < 1s

---

## REQ-5: UX Enhancements

### REQ-5.1: Mobile Responsiveness
- [ ] Test deck builder on mobile viewports
- [ ] Fix layout issues on small screens
- [ ] Ensure touch interactions work

**Acceptance:** Deck builder usable at 375px width

### REQ-5.2: Keyboard Shortcuts
- [ ] Add Ctrl+S for save
- [ ] Add Ctrl+Z for undo (where applicable)
- [ ] Add Ctrl+F for search focus
- [ ] Add Escape to close dialogs

**Acceptance:** Common actions accessible via keyboard

---

## Success Criteria

- ✅ Zero critical or high-priority bugs
- ✅ 95%+ E2E test pass rate
- ✅ 100% unit test pass rate
- ✅ Cold start < 5 seconds
- ✅ Subsequent page loads < 100ms
- ✅ Deck builder works on mobile (375px+)
