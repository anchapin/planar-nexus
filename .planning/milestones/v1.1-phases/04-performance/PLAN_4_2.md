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
1. [x] Review current Next.js code splitting
2. [x] Implement route-based splitting (already default in Next.js)
3. [x] Lazy load non-critical components (analyzed - not needed, route splitting is effective)
4. [x] Verify dynamic imports work correctly
5. [x] Measure bundle size reduction

## Acceptance Criteria
- Initial bundle < 200KB
- Lazy loaded routes work correctly
