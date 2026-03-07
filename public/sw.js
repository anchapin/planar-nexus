// Planar Nexus Service Worker for PWA/Offline Support - Enhanced Version 3.0
// Implements comprehensive offline capability with card database caching

const CACHE_VERSION = 'planar-nexus-v3';
const STATIC_CACHE = 'planar-nexus-static-v3';
const DYNAMIC_CACHE = 'planar-nexus-dynamic-v3';
const CARD_CACHE = 'planar-nexus-cards-v3';
const IMAGE_CACHE = 'planar-nexus-images-v3';
const API_CACHE = 'planar-nexus-api-v3';

// Maximum cache sizes (in bytes)
const MAX_CACHE_SIZES = {
  static: 5 * 1024 * 1024,      // 5MB
  dynamic: 10 * 1024 * 1024,    // 10MB
  cards: 30 * 1024 * 1024,      // 30MB (card database)
  images: 20 * 1024 * 1024,     // 20MB (card images)
  api: 5 * 1024 * 1024,         // 5MB (API responses)
};

// Static assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/offline.html',
  '/icon-192.svg',
  '/icon-512.svg',
  '/card-back.svg',
  // App routes
  '/dashboard',
  '/deck-builder',
  '/deck-coach',
  '/single-player',
  '/multiplayer',
  '/multiplayer/browse',
  '/multiplayer/join',
  '/multiplayer/host',
  '/saved-games',
  '/collection',
  '/achievements',
  '/settings',
  '/game-board',
  '/trade',
  '/draft-assistant',
  '/replay',
  '/hand-display-demo',
  '/card-interactions-demo',
  '/game-analysis',
];

// API patterns to cache
const API_PATTERNS = [
  /\/api\//,
  /https:\/\/api\.scryfall\.com\//,
];

// Image patterns to cache
const IMAGE_PATTERNS = [
  /https:\/\/cards\.scryfall\.io\//,
  /https:\/\/img\.scryfall\.com\//,
  /https:\/\/images\.unsplash\.com\//,
  /https:\/\/picsum\.photos\//,
];

// Cache TTL configuration (in milliseconds)
const CACHE_TTL = {
  static: 7 * 24 * 60 * 60 * 1000,      // 7 days
  dynamic: 24 * 60 * 60 * 1000,         // 1 day
  cards: 30 * 24 * 60 * 60 * 1000,      // 30 days
  images: 7 * 24 * 60 * 60 * 1000,      // 7 days
  api: 1 * 60 * 60 * 1000,              // 1 hour
};

// Install event - cache static assets and prepare caches
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker version:', CACHE_VERSION);
  event.waitUntil(
    Promise.all([
      // Cache static assets
      caches.open(STATIC_CACHE).then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      }),
      // Pre-cache essential card images
      preCacheEssentialImages(),
      // Pre-cache common API responses
      preCacheCommonAPIResponses(),
    ])
  );
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// Pre-cache essential card images
async function preCacheEssentialImages() {
  try {
    const cache = await caches.open(IMAGE_CACHE);
    console.log('[SW] Pre-caching essential card images');
    // Essential commander cards images will be cached on-demand
    // This prevents large initial cache size
  } catch (error) {
    console.error('[SW] Error pre-caching images:', error);
  }
}

// Pre-cache common API responses
async function preCacheCommonAPIResponses() {
  try {
    const cache = await caches.open(API_CACHE);
    console.log('[SW] Pre-caching common API responses');
    // API responses will be cached on-demand
  } catch (error) {
    console.error('[SW] Error pre-caching API responses:', error);
  }
}

// Activate event - clean up old caches and claim clients
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker version:', CACHE_VERSION);
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              const isPlanarNexus = name.startsWith('planar-nexus-');
              const isCurrentVersion = [
                STATIC_CACHE,
                DYNAMIC_CACHE,
                CARD_CACHE,
                IMAGE_CACHE,
                API_CACHE,
              ].includes(name);
              return isPlanarNexus && !isCurrentVersion;
            })
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      }),
      // Clean up expired cache entries
      cleanExpiredCaches(),
    ])
  );
  // Take control of all pages immediately
  event.waitUntil(self.clients.claim());
});

// Clean up expired cache entries
async function cleanExpiredCaches() {
  const cachesToClean = [
    { name: STATIC_CACHE, maxAge: CACHE_TTL.static },
    { name: DYNAMIC_CACHE, maxAge: CACHE_TTL.dynamic },
    { name: CARD_CACHE, maxAge: CACHE_TTL.cards },
    { name: IMAGE_CACHE, maxAge: CACHE_TTL.images },
    { name: API_CACHE, maxAge: CACHE_TTL.api },
  ];

  for (const { name, maxAge } of cachesToClean) {
    try {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      const now = Date.now();

      for (const request of requests) {
        const response = await cache.match(request);
        if (response) {
          const cacheDate = response.headers.get('date');
          if (cacheDate) {
            const age = now - new Date(cacheDate).getTime();
            if (age > maxAge) {
              await cache.delete(request);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[SW] Error cleaning cache ${name}:`, error);
    }
  }
}

// Determine caching strategy based on request type
function getCacheStrategy(request) {
  const url = new URL(request.url);

  // Image requests - cache first for card images
  if (IMAGE_PATTERNS.some(pattern => pattern.test(url.href))) {
    return 'cache-first';
  }

  // Static assets (CSS, JS, fonts) - cache first
  if (request.destination === 'style' ||
      request.destination === 'script' ||
      request.destination === 'font') {
    return 'cache-first';
  }

  // API requests - network first with cache fallback
  if (API_PATTERNS.some(pattern => pattern.test(url.href))) {
    return 'network-first';
  }

  // Navigation requests (HTML pages) - network first
  if (request.mode === 'navigate') {
    return 'network-first';
  }

  // Default: network first
  return 'network-first';
}

// Cache-first strategy
async function cacheFirst(event) {
  const cacheName = determineCacheName(event.request);
  const cachedResponse = await caches.match(event.request);

  if (cachedResponse) {
    // Serve from cache and update in background
    updateCacheInBackground(event.request, cacheName);
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(event.request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      await manageCacheSize(cacheName);
      cache.put(event.request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.error('[SW] Cache-first failed:', error);
    return caches.match('/offline.html');
  }
}

// Network-first strategy
async function networkFirst(event) {
  const cacheName = determineCacheName(event.request);

  try {
    const networkResponse = await fetch(event.request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      await manageCacheSize(cacheName);
      cache.put(event.request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', error);
    const cachedResponse = await caches.match(event.request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // For navigation requests, return offline page
    if (event.request.mode === 'navigate') {
      return caches.match('/offline.html');
    }

    return new Response('Offline', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({ 'Content-Type': 'text/plain' })
    });
  }
}

// Stale-while-revalidate strategy
async function staleWhileRevalidate(event) {
  const cacheName = determineCacheName(event.request);
  const cachedResponse = await caches.match(event.request);

  // Always update in background
  const fetchPromise = fetch(event.request).then(async (networkResponse) => {
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      manageCacheSize(cacheName);
      cache.put(event.request, networkResponse.clone());
    }
    return networkResponse;
  });

  // Return cached version immediately if available
  if (cachedResponse) {
    return cachedResponse;
  }

  // Otherwise wait for network
  return fetchPromise;
}

// Determine which cache to use for a request
function determineCacheName(request) {
  const url = new URL(request.url);

  // Images
  if (IMAGE_PATTERNS.some(pattern => pattern.test(url.href))) {
    return IMAGE_CACHE;
  }

  // API requests
  if (API_PATTERNS.some(pattern => pattern.test(url.href))) {
    return API_CACHE;
  }

  // Static assets
  if (request.destination === 'style' ||
      request.destination === 'script' ||
      request.destination === 'font') {
    return STATIC_CACHE;
  }

  // Navigation and other dynamic content
  return DYNAMIC_CACHE;
}

// Manage cache size to prevent exceeding limits
async function manageCacheSize(cacheName) {
  const maxSize = MAX_CACHE_SIZES[cacheName.split('-')[2]?.split('-')[0] || 'dynamic'];

  try {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    let totalSize = 0;

    // Calculate current cache size
    for (const request of requests) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        totalSize += blob.size;
      }
    }

    // If cache is too large, remove oldest entries
    if (totalSize > maxSize) {
      console.log(`[SW] Cache ${cacheName} exceeds limit (${totalSize} bytes), cleaning up`);
      const entriesToRemove = requests.slice(0, Math.ceil(requests.length * 0.2));
      for (const entry of entriesToRemove) {
        await cache.delete(entry);
      }
    }
  } catch (error) {
    console.error('[SW] Error managing cache size:', error);
  }
}

// Update cache in background
async function updateCacheInBackground(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      await manageCacheSize(cacheName);
      cache.put(request, networkResponse.clone());
    }
  } catch (error) {
    console.log('[SW] Background update failed:', error);
  }
}

// Fetch event - route to appropriate strategy
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip cross-origin requests except for Scryfall API and images
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isScryfall = url.hostname === 'api.scryfall.com';
  const isImageHost = IMAGE_PATTERNS.some(pattern => pattern.test(url.href));

  if (!isSameOrigin && !isScryfall && !isImageHost) {
    return;
  }

  const strategy = getCacheStrategy(event.request);

  if (strategy === 'cache-first') {
    event.respondWith(cacheFirst(event));
  } else if (strategy === 'stale-while-revalidate') {
    event.respondWith(staleWhileRevalidate(event));
  } else {
    event.respondWith(networkFirst(event));
  }
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }

  // Handle cache management requests
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    clearCache(event.data.cacheName);
  }

  if (event.data && event.data.type === 'GET_CACHE_INFO') {
    getCacheInfo().then(info => {
      event.ports[0].postMessage(info);
    });
  }

  if (event.data && event.data.type === 'CLEAR_ALL_CACHES') {
    clearAllCaches();
  }

  // Handle offline status check
  if (event.data && event.data.type === 'CHECK_OFFLINE_STATUS') {
    event.ports[0].postMessage({
      offline: !navigator.onLine
    });
  }

  // Handle card database caching
  if (event.data && event.data.type === 'CACHE_CARD_DATA') {
    cacheCardData(event.data.cards);
  }
});

// Clear specific cache
async function clearCache(cacheName) {
  try {
    await caches.delete(cacheName);
    console.log(`[SW] Cleared cache: ${cacheName}`);
  } catch (error) {
    console.error(`[SW] Error clearing cache ${cacheName}:`, error);
  }
}

// Get cache information
async function getCacheInfo() {
  const cacheNames = await caches.keys();
  const info = {
    caches: [],
    totalSize: 0,
  };

  for (const cacheName of cacheNames) {
    if (cacheName.startsWith('planar-nexus-')) {
      try {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        let size = 0;

        for (const key of keys) {
          const response = await cache.match(key);
          if (response) {
            const blob = await response.blob();
            size += blob.size;
          }
        }

        info.caches.push({
          name: cacheName,
          entries: keys.length,
          size: size,
        });
        info.totalSize += size;
      } catch (error) {
        console.error(`[SW] Error getting cache info for ${cacheName}:`, error);
      }
    }
  }

  return info;
}

// Clear all caches
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  for (const cacheName of cacheNames) {
    if (cacheName.startsWith('planar-nexus-')) {
      await caches.delete(cacheName);
    }
  }
  console.log('[SW] Cleared all caches');
}

// Cache card database data
async function cacheCardData(cards) {
  try {
    const cache = await caches.open(CARD_CACHE);
    await manageCacheSize(CARD_CACHE);

    for (const card of cards) {
      const cardUrl = `/api/cards/${card.id}`;
      const response = new Response(JSON.stringify(card), {
        headers: { 'Content-Type': 'application/json' }
      });
      await cache.put(cardUrl, response);
    }

    console.log(`[SW] Cached ${cards.length} cards`);
  } catch (error) {
    console.error('[SW] Error caching card data:', error);
  }
}

// Background sync for when connection is restored
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-game-state') {
    console.log('[SW] Background sync triggered');
    syncOfflineData();
  }
});

// Sync offline data when connection is restored
async function syncOfflineData() {
  try {
    // Get all pending changes from IndexedDB and sync with server
    console.log('[SW] Syncing offline data');

    // In a real implementation, this would send data to the server
    // For now, we just log that sync occurred
  } catch (error) {
    console.error('[SW] Sync failed:', error);
  }
}

// Handle push notifications (for future use)
self.addEventListener('push', (event) => {
  if (event.data) {
    const options = {
      body: event.data.text(),
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: 1,
      },
    };

    event.waitUntil(
      self.registration.showNotification('Planar Nexus', options)
    );
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});

// Log service worker lifecycle
console.log('[SW] Service worker loaded, version:', CACHE_VERSION);
