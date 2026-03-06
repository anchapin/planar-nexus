# Service Worker Enhancement Guide

## Overview

This document describes the enhanced service worker implementation for Planar Nexus, providing comprehensive offline capability with intelligent caching strategies.

## Version Information

- **Current Version**: v3.0
- **Cache Version**: `planar-nexus-v3`
- **Last Updated**: March 2026

## Cache Architecture

### Cache Names

The service worker uses multiple caches with different purposes:

1. **planar-nexus-static-v3** (5MB max)
   - Static assets (CSS, JS, fonts)
   - Application routes
   - Core UI components
   - Cache strategy: Cache-first

2. **planar-nexus-dynamic-v3** (10MB max)
   - Dynamic content
   - User-specific data
   - Navigation responses
   - Cache strategy: Network-first

3. **planar-nexus-cards-v3** (30MB max)
   - Card database
   - Card search results
   - Card metadata
   - Cache strategy: Network-first

4. **planar-nexus-images-v3** (20MB max)
   - Card images from Scryfall
   - Static images
   - User uploads
   - Cache strategy: Cache-first

5. **planar-nexus-api-v3** (5MB max)
   - API responses
   - Server action results
   - External API data
   - Cache strategy: Network-first

### Total Cache Limit: 70MB

## Caching Strategies

### Cache-First
- **Use Case**: Static assets, card images
- **Behavior**: Serve from cache immediately, update in background
- **Fallback**: Return offline placeholder if not cached
- **Examples**: CSS files, JavaScript bundles, card images

### Network-First
- **Use Case**: Dynamic content, API calls
- **Behavior**: Try network first, fallback to cache
- **Fallback**: Return cached version or offline response
- **Examples**: API endpoints, navigation requests

### Stale-While-Revalidate
- **Use Case**: Images that may update
- **Behavior**: Serve cached version, update in background
- **Fallback**: Serve cached version
- **Examples**: Dynamic images, avatars

## Features

### 1. Offline Navigation
- All application routes work offline
- Cached pages load instantly
- Offline fallback page for unvisited routes

### 2. Card Database Caching
- Cards viewed are cached for offline access
- Essential cards pre-cached during installation
- Card images cached with intelligent size management

### 3. API Response Caching
- API responses cached with 1-hour TTL
- Network-first strategy ensures fresh data
- Graceful fallback to cached data when offline

### 4. Image Caching
- Card images from Scryfall automatically cached
- 20MB limit ensures reasonable storage usage
- Oldest images removed when limit reached

### 5. Cache Management
- Automatic cache cleanup on update
- Manual cache clearing via Settings
- Cache size tracking and monitoring
- Expired cache entry removal

### 6. Background Sync
- Automatic sync when connection restored
- Pending game states synced to server
- Deck changes synchronized
- User data synced when back online

### 7. Network Status Detection
- Real-time online/offline detection
- Offline indicator in UI
- Connection quality monitoring
- Automatic retry when connection restored

## API Communication

### Message Channels

The service worker supports bi-directional communication via message channels:

#### GET_VERSION
```javascript
navigator.serviceWorker.controller.postMessage(
  { type: 'GET_VERSION' },
  [messageChannel.port2]
);
```

#### CLEAR_CACHE
```javascript
navigator.serviceWorker.controller.postMessage(
  { type: 'CLEAR_CACHE' },
  [messageChannel.port2]
);
```

#### GET_CACHE_INFO
```javascript
navigator.serviceWorker.controller.postMessage(
  { type: 'GET_CACHE_INFO' },
  [messageChannel.port2]
);
```

#### CACHE_CARDS
```javascript
navigator.serviceWorker.controller.postMessage(
  {
    type: 'CACHE_CARDS',
    cards: [/* card objects */]
  },
  [messageChannel.port2]
);
```

#### PRECACHE_IMAGES
```javascript
navigator.serviceWorker.controller.postMessage(
  {
    type: 'PRECACHE_IMAGES',
    images: [/* image URLs */]
  },
  [messageChannel.port2]
);
```

#### SKIP_WAITING
```javascript
navigator.serviceWorker.controller.postMessage({
  type: 'SKIP_WAITING'
});
```

## React Hooks

### useNetworkStatus
Monitors network status and connection quality.

```typescript
import { useNetworkStatus } from '@/lib/use-network-status';

function MyComponent() {
  const { isOnline, effectiveType, downlink, rtt, checkConnection } = useNetworkStatus();

  if (!isOnline) {
    return <div>You're offline</div>;
  }

  return <div>Connected ({downlink} Mbps)</div>;
}
```

### useServiceWorkerCache
Manages service worker cache information.

```typescript
import { useServiceWorkerCache } from '@/lib/use-service-worker-cache';

function CacheSettings() {
  const { cacheInfo, isLoading, clearCache, refreshCacheInfo } = useServiceWorkerCache();

  return (
    <div>
      <button onClick={clearCache}>Clear Cache</button>
      <pre>{JSON.stringify(cacheInfo, null, 2)}</pre>
    </div>
  );
}
```

## Offline Functionality

### What Works Offline

✅ **Fully Functional**
- Browse cached cards
- Edit saved decks
- View game history
- Navigate between cached pages
- View saved games
- Access settings
- View achievements

⚠️ **Partially Functional**
- Card search (limited to cached cards)
- Deck building (existing cards only)
- Game analysis (cached games only)

❌ **Requires Online**
- Card search (new cards)
- Multiplayer games
- AI features
- Card image loading (uncached)
- Server actions

### Offline Fallbacks

When offline, the service worker provides intelligent fallbacks:

1. **Card Images**: Returns card-back.svg
2. **API Calls**: Returns mock responses with offline messages
3. **Navigation**: Returns offline.html with helpful information
4. **Images**: Returns placeholder or cached version

## Cache Lifecycle

### Installation
1. Service worker installs
2. Static assets cached immediately
3. Essential images pre-cached
4. Common API responses cached
5. Service worker activates

### Updates
1. New service worker detected
2. Update available indicator shown
3. User can update immediately or wait
4. On update: old caches cleaned, new caches created
5. Optional: skip waiting for immediate update

### Cleanup
1. Old caches deleted on activation
2. Expired entries removed periodically
3. Cache size enforced (oldest removed when over limit)
4. Manual clear via Settings

## Performance Optimization

### Cache Size Management
- Automatic cleanup when limits reached
- Oldest entries removed first (LRU)
- Per-cache limits prevent any single cache from dominating
- Total 70MB limit ensures reasonable storage usage

### Network Optimization
- Cache-first for static assets (no network requests)
- Network-first for dynamic content (fresh data)
- Background updates for cached content
- Intelligent retry on network errors

### Storage Optimization
- Compressed responses where possible
- Efficient cache key management
- Automatic expiration of old content
- User-controlled cache clearing

## Testing Offline Functionality

### Manual Testing

1. **Open DevTools**
   - F12 or Cmd+Option+I
   - Go to Application tab
   - Service Workers section

2. **Go Offline**
   - DevTools > Network > Offline
   - Or disconnect network adapter

3. **Test Features**
   - Navigate between pages
   - Search for cards
   - Edit decks
   - View saved games

4. **Go Online**
   - DevTools > Network > No throttling
   - Or reconnect network adapter
   - Verify data syncs

### Automated Testing

```javascript
// Test offline card search
describe('Offline Card Search', () => {
  it('should return cached cards when offline', async () => {
    // Cache a card
    await cacheCard(testCard);

    // Go offline
    await mockOfflineMode();

    // Search for card
    const results = await searchCardsOffline('Sol Ring');

    // Verify results
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Sol Ring');
  });
});
```

## Troubleshooting

### Service Worker Not Installing

**Symptoms**: Service worker doesn't register, errors in console

**Solutions**:
1. Check service worker is served from HTTPS or localhost
2. Verify service worker file exists at `/sw.js`
3. Check browser console for errors
4. Ensure no other service workers conflict

### Cache Not Working

**Symptoms**: Resources not cached, offline pages don't load

**Solutions**:
1. Clear all caches in DevTools
2. Unregister service worker and reload
3. Check cache limits not exceeded
4. Verify caching strategy is appropriate

### Offline Page Not Showing

**Symptoms**: Browser default offline page instead of custom one

**Solutions**:
1. Verify `/offline.html` is cached
2. Check network-first strategy is working
3. Ensure service worker is activated
4. Check console for errors

### Cache Size Issues

**Symptoms**: "Quota exceeded" errors, caching stops working

**Solutions**:
1. Clear caches in Settings
2. Increase cache limits if needed
3. Check for large assets being cached
4. Verify cache cleanup is working

## Best Practices

### Development
1. Always test offline functionality
2. Use service worker hooks for cache management
3. Implement proper error handling
4. Monitor cache size in production

### Deployment
1. Use HTTPS in production
2. Update cache version when breaking changes
3. Test service worker updates thoroughly
4. Provide clear user communication for updates

### User Experience
1. Show offline indicators prominently
2. Provide helpful offline messages
3. Cache critical content during onboarding
4. Allow users to manage cache size

## Future Enhancements

Potential improvements for future versions:

1. **Advanced Caching**
   - Predictive pre-fetching
   - Smart cache warming
   - Adaptive cache limits

2. **Enhanced Sync**
   - Conflict resolution for concurrent edits
   - Delta sync for large datasets
   - Prioritized sync queue

3. **Analytics**
   - Cache hit/miss metrics
   - Offline usage tracking
   - Performance monitoring

4. **User Controls**
   - Per-feature cache toggles
   - Custom cache limits
   - Selective cache clearing

## References

- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache)
- [PWA Best Practices](https://web.dev/progressive-web-apps/)
- [Workbox](https://developers.google.com/web/tools/workbox)

## Support

For issues or questions about the service worker:

1. Check browser console for errors
2. Review Service Worker section in DevTools
3. Clear caches and try again
4. Check this documentation for common issues
5. File an issue on GitHub with details
