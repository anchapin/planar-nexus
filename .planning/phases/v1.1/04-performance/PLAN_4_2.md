# Plan 4.2: Code Splitting

**Phase:** 4 - Performance Optimization  
**Priority:** Medium  
**Estimate:** 1-2 hours

## Goal
Implement better code splitting to reduce initial bundle size

## Background
Current bundle may be loading too much code on initial load.

## Deliverables
1. Route-based code splitting implemented
2. Lazy loading for non-critical components
3. Optimized dynamic imports

## Tasks
1. [ ] Review current Next.js code splitting
2. [ ] Implement route-based splitting
3. [ ] Lazy load non-critical components
4. [ ] Verify dynamic imports work correctly
5. [ ] Measure bundle size reduction

## Acceptance Criteria
- Initial bundle < 200KB
- Lazy loaded routes work correctly
