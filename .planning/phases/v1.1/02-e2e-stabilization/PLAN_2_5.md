# Plan 2.5: Cross-Browser Setup

**Phase:** 2 - E2E Test Stabilization  
**Priority:** Low  
**Estimate:** 1-2 hours

## Goal
Install Firefox and WebKit browsers for Playwright cross-browser testing

## Background
Firefox and WebKit browsers not installed - cannot verify cross-browser compatibility.

## Deliverables
1. Firefox browser installed for Playwright
2. WebKit browser installed for Playwright
3. CI pipeline updated to run all browsers

## Tasks
1. [ ] Install Firefox browser: `playwright install firefox`
2. [ ] Install WebKit browser: `playwright install webkit`
3. [ ] Update CI configuration for all browsers
4. [ ] Verify tests run on all browsers

## Acceptance Criteria
- Tests pass on Chromium, Firefox, and WebKit
- Cross-browser coverage achieved
