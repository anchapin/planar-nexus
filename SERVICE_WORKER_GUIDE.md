# Service Worker Guide - Planar Nexus PWA

## Overview

This guide explains the comprehensive service worker implementation for Planar Nexus, enabling full offline capability with intelligent caching strategies.

## Version

Current Service Worker Version: `planar-nexus-v3`

## Architecture

### Multi-Cache System

The service worker uses five separate caches, each with specific purposes and size limits:

1. **Static Cache** (`planar-nexus-static-v3`) - 5MB
   - CSS, JavaScript, fonts
   - Application routes
   - Core UI components
   - Cache strategy: Cache-first

2. **Dynamic Cache** (`planar-nexus-dynamic-v3`) - 10MB
   - Navigation responses
   - User-specific data
   - Dynamic content
   - Cache strategy: Network-first

3. **Card Cache** (`planar-nexus-cards-v3`) - 30MB
   - Card database
   - Search results
   - Card metadata
   - Cache strategy: Cache-first

4. **Image Cache** (`planar-nexus-images-v3`) - 20MB
   - Card images from Scryfall
   - Static images
   - User uploads
   - Cache strategy: Cache-first

5. **API Cache** (`planar-nexus-api-v3`) - 5MB
   - API responses
   - Server action results
   - External API data
   - Cache strategy: Network-first

### Caching Strategies

#### Cache-First
**Use Cases:** Static assets, images, card data

```javascript
1. Check cache
2. If cache hit → return cached response immediately
3. Update cache in background
4. If cache miss → fetch from network, cache response
```

**Benefits:**
- Fastest response time
- Works offline
- Reduces bandwidth usage

#### Network-First
**Use Cases:** API calls, dynamic content

```javascript
1. Try network
2. If network succeeds → cache response, return it
3. If network fails → return cached version
4. If no cache → return offline fallback
```

**Benefits:**
- Always returns fresh data
- Fallback to cached version
- Ensures offline functionality

#### Stale-While-Revalidate
**Use Cases:** Dynamic images, frequently updated content

```javascript
1. Check cache
2. If cache hit → return cached immediately
3. Update cache in background
4. If cache miss → wait for network
```

**Benefits:**
- Fast initial response
- Updates in background
- Good balance of speed and freshness

## Cache Management

### Automatic Cache Size Management

The service worker automatically manages cache size to prevent exceeding limits:

```javascript
// When cache exceeds limit, remove oldest 20% of entries
if (totalSize > maxSize) {
  const entriesToRemove = requests.slice(0, Math.ceil(requests.length * 0.2));
  for (const entry of entriesToRemove) {
    await cache.delete(entry);
  }
}
```

### Cache TTL (Time-To-Live)

Each cache has a TTL for automatic cleanup:

- Static Cache: 7 days
- Dynamic Cache: 1 day
- Card Cache: 30 days
- Image Cache: 7 days
- API Cache: 1 hour

Expired entries are automatically removed during service worker activation.

### Manual Cache Management

#### Clear Specific Cache
```javascript
const registration = await navigator.serviceWorker.getRegistration();
registration.active.postMessage({
  type: 'CLEAR_CACHE',
  cacheName: 'planar-nexus-images-v3'
});
```

#### Clear All Caches
```javascript
const registration = await navigator.serviceWorker.getRegistration();
registration.active.postMessage({
  type: 'CLEAR_ALL_CACHES'
});
```

#### Get Cache Information
```javascript
const registration = await navigator.serviceWorker.getRegistration();
const messageChannel = new MessageChannel();

registration.active.postMessage(
  { type: 'GET_CACHE_INFO' },
  [messageChannel.port2]
);

messageChannel.port1.onmessage = (event) => {
  console.log('Cache info:', event.data);
  // Returns: { caches: [...], totalSize: number }
};
```

## Offline Functionality

### Offline Page

The `/offline.html` page is automatically served when:
- Network requests fail
- Navigation requests can't be served
- No cached version is available

The offline page:
- Shows connection status
- Provides helpful information
- Auto-reloads when connection is restored

### IndexedDB Integration

The service worker integrates with IndexedDB for offline data storage:

**Stores:**
- `decks` - User's saved decks
- `saved-games` - Game state saves
- `preferences` - User preferences

**API:**
```javascript
// GET /api/data/{store}/{id}
// GET /api/data/{store}
// POST /api/data/{store}
// PUT /api/data/{store}/{id}
// DELETE /api/data/{store}/{id}
```

### Background Sync

When the connection is restored, the service worker syncs offline data:

```javascript
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-game-state') {
    syncOfflineData();
  }
});
```

## React Hooks

### useServiceWorkerCache

Provides cache management functionality:

```typescript
import { useServiceWorkerCache } from '@/lib/use-service-worker-cache';

function MyComponent() {
  const {
    cacheInfo,
    isLoading,
    clearCache,
    clearAllCaches,
    formatBytes,
    getCacheSize,
    getTotalCacheSize,
    getTotalEntries,
    refreshCacheInfo,
  } = useServiceWorkerCache();

  return (
    <div>
      <div>Total Cache: {formatBytes(getTotalCacheSize())}</div>
      <div>Total Entries: {getTotalEntries()}</div>
      <button onClick={() => clearCache('planar-nexus-images-v3')}>
        Clear Images
      </button>
    </div>
  );
}
```

### useNetworkStatus

Monitors network status and connection quality:

```typescript
import { useNetworkStatus } from '@/lib/use-network-status';

function MyComponent() {
  const {
    isOnline,
    isSlow,
    effectiveType,
    downlink,
    rtt,
    saveData,
    connectionDescription,
    canStreamMedia,
    canLoadImages,
    canUseAI,
    canPlayMultiplayer,
  } = useNetworkStatus();

  return (
    <div>
      <div>Status: {isOnline ? 'Online' : 'Offline'}</div>
      <div>Connection: {connectionDescription}</div>
      {canUseAI && <button>Use AI Features</button>}
    </div>
  );
}
```

### OfflineIndicator Component

Displays network status and offline capabilities:

```typescript
import { OfflineIndicator } from '@/components/offline-indicator';

function MyApp() {
  return (
    <div>
      <OfflineIndicator />
      {/* Rest of your app */}
    </div>
  );
}
```

## Service Worker Lifecycle

### Install

```javascript
self.addEventListener('install', (event) => {
  // Cache static assets
  // Pre-cache essential images
  // Pre-cache common API responses
  // Skip waiting to activate immediately
});
```

### Activate

```javascript
self.addEventListener('activate', (event) => {
  // Clean up old caches
  // Remove expired cache entries
  // Claim all clients
});
```

### Fetch

```javascript
self.addEventListener('fetch', (event) => {
  // Determine cache strategy
  // Apply appropriate caching strategy
  // Handle offline fallbacks
});
```

### Message

```javascript
self.addEventListener('message', (event) => {
  // Handle SKIP_WAITING
  // Handle GET_VERSION
  // Handle cache management requests
  // Handle offline status checks
  // Handle card database caching
});
```

## Testing Offline Functionality

### Manual Testing

1. **Test Service Worker Registration**
   ```javascript
   if ('serviceWorker' in navigator) {
     navigator.serviceWorker.register('/sw.js')
       .then(reg => console.log('SW registered:', reg))
       .catch(err => console.error('SW registration failed:', err));
   }
   ```

2. **Test Cache Functionality**
   - Open DevTools → Application → Service Workers
   - Check service worker status
   - Inspect cached resources
   - Clear caches and re-test

3. **Test Offline Mode**
   - Open DevTools → Network
   - Select "Offline" throttling
   - Navigate through the app
   - Verify offline features work
   - Check that offline page shows when needed

4. **Test Cache Management**
   - Open DevTools → Application → Cache Storage
   - Inspect cache contents
   - Manually clear caches
   - Verify automatic cleanup

### Automated Testing

See `/src/lib/__tests__/service-worker.test.ts` for comprehensive test coverage.

## Performance Considerations

### Cache Size Management

The service worker automatically manages cache sizes to prevent storage quota issues:

- Static Cache: 5MB maximum
- Dynamic Cache: 10MB maximum
- Card Cache: 30MB maximum
- Image Cache: 20MB maximum
- API Cache: 5MB maximum

Total maximum: ~70MB

### Cache Eviction Strategy

When a cache exceeds its limit:
1. Calculate total cache size
2. If exceeded, remove oldest 20% of entries
3. Recalculate size
4. Repeat if still over limit

### Network Performance

The service worker optimizes network usage by:

- Serving static assets from cache
- Caching API responses
- Using stale-while-revalidate for images
- Only fetching when necessary

## Troubleshooting

### Service Worker Not Registering

**Symptom:** Service worker doesn't appear in DevTools

**Solutions:**
1. Check browser console for errors
2. Verify `/public/sw.js` exists
3. Ensure serving over HTTPS (or localhost)
4. Check Content-Type header for service worker

### Cache Not Updating

**Symptom:** Old content continues to appear

**Solutions:**
1. Update `CACHE_VERSION` constant
2. Trigger service worker update
3. Clear specific cache
4. Force reload (Ctrl+Shift+R)

### Offline Page Not Showing

**Symptom:** Browser shows default offline page

**Solutions:**
1. Ensure `/public/offline.html` exists
2. Verify offline.html is cached
3. Check cache strategy for navigation requests
4. Verify fallback logic in network-first strategy

### Cache Size Issues

**Symptom:** Cache quota exceeded errors

**Solutions:**
1. Check cache information in DevTools
2. Manually clear oversized caches
3. Reduce cache size limits if needed
4. Review cache eviction logs

### IndexedDB Errors

**Symptom:** Data not persisting offline

**Solutions:**
1. Check browser permissions
2. Verify IndexedDB is enabled
3. Clear IndexedDB and reinitialize
4. Check storage quota limits

## Browser Compatibility

### Service Worker Support

- Chrome 40+
- Firefox 44+
- Safari 11.1+
- Edge 17+

### IndexedDB Support

- Chrome 24+
- Firefox 16+
- Safari 10+
- Edge 12+

### Cache API Support

- Chrome 40+
- Firefox 39+
- Safari 11.1+
- Edge 17+

## Best Practices

1. **Version Your Caches**
   - Always update `CACHE_VERSION` when changing service worker
   - Old caches will be automatically cleaned up

2. **Monitor Cache Sizes**
   - Use `useServiceWorkerCache` hook to monitor usage
   - Set appropriate cache size limits
   - Handle quota exceeded errors gracefully

3. **Test Offline Regularly**
   - Use DevTools Network throttling
   - Test all critical user flows
   - Verify fallback behavior

4. **Provide Feedback**
   - Show offline status indicator
   - Inform users about offline capabilities
   - Display sync status when connection restored

5. **Graceful Degradation**
   - Always have offline fallbacks
   - Don't break when features are unavailable
   - Provide helpful error messages

## Future Enhancements

1. **Push Notifications**
   - Game invites
   - Turn reminders
   - Achievement notifications

2. **Periodic Sync**
   - Auto-sync game state
   - Background updates
   - Keep data fresh

3. **Advanced Caching**
   - Predictive caching
   - Prefetching strategies
   - Machine learning-based cache decisions

4. **Offline Analytics**
   - Track offline usage
   - Monitor cache hit rates
   - Optimize based on usage patterns

## Support

For issues or questions:
- GitHub Issues: https://github.com/anchapin/planar-nexus/issues
- Issue #449: PWA Service Worker Enhancement

## License

This implementation is part of Planar Nexus and follows the project's MIT license.
