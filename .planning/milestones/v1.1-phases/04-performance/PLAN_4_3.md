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
1. [x] Create service worker file
2. [x] Register service worker in app
3. [x] Implement cache-first strategy
4. [x] Handle offline scenarios gracefully
5. [x] Verify subsequent loads are faster

## Acceptance Criteria
- Subsequent loads < 1 second
- Offline mode works for cached content
