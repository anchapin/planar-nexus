# Plan 4.3: Service Worker Caching

**Phase:** 4 - Performance Optimization  
**Priority:** Low  
**Estimate:** 1-2 hours

## Goal
Add service worker for offline caching and faster subsequent loads

## Background
Users experience slow cold start - service worker can cache assets for faster subsequent loads.

## Deliverables
1. Service worker registration
2. Cache-first strategy for static assets
3. Offline capability

## Tasks
1. [ ] Create service worker file
2. [ ] Register service worker in app
3. [ ] Implement cache-first strategy
4. [ ] Handle offline scenarios gracefully
5. [ ] Verify subsequent loads are faster

## Acceptance Criteria
- Subsequent loads < 1 second
- Offline mode works for cached content
