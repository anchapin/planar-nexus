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

  // Other images - stale while revalidate
  if (request.destination === 'image') {
    return 'stale-while-revalidate';
  }

  // Default: network first
  return 'network-first';
}

// Determine which cache to use
function getCacheName(request) {
  const url = new URL(request.url);

  if (IMAGE_PATTERNS.some(pattern => pattern.test(url.href))) {
    return IMAGE_CACHE;
  }

  if (API_PATTERNS.some(pattern => pattern.test(url.href))) {
    return API_CACHE;
  }

  if (request.destination === 'image') {
    return IMAGE_CACHE;
  }

  if (request.destination === 'style' ||
      request.destination === 'script' ||
      request.destination === 'font') {
    return STATIC_CACHE;
  }

  return DYNAMIC_CACHE;
}

// Cache-first strategy
async function cacheFirst(event) {
  const cacheName = getCacheName(event.request);
  const cachedResponse = await caches.match(event.request);

  if (cachedResponse) {
    // Update in background for next time
    fetchAndCache(event.request, cacheName);
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(event.request);
    if (networkResponse.ok) {
      await addToCache(cacheName, event.request, networkResponse);
    }
    return networkResponse;
  } catch (error) {
    console.error('[SW] Cache-first strategy failed:', error);
    // For images, return placeholder
    if (event.request.destination === 'image') {
      return caches.match('/card-back.svg');
    }
    // For navigation, return offline page
    if (event.request.mode === 'navigate') {
      return caches.match('/offline.html');
    }
    // Return error response
    return new Response('Offline - resource not available', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({ 'Content-Type': 'text/plain' })
    });
  }
}

// Network-first strategy
async function networkFirst(event) {
  const cacheName = getCacheName(event.request);

  try {
    const networkResponse = await fetch(event.request);
    if (networkResponse.ok) {
      await addToCache(cacheName, event.request, networkResponse);
    }
    return networkResponse;
  } catch (error) {
    console.error('[SW] Network-first strategy failed, falling back to cache:', error);
    const cachedResponse = await caches.match(event.request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // For navigation requests, return offline page
    if (event.request.mode === 'navigate') {
      const offlinePage = await caches.match('/offline.html');
      if (offlinePage) {
        return offlinePage;
      }
      // Generate offline page response
      return generateOfflinePage();
    }

    // For API requests, return offline mock data if available
    if (API_PATTERNS.some(pattern => pattern.test(event.request.url))) {
      return generateOfflineAPIResponse(event.request);
    }

    // Return error response
    return new Response('Offline - resource not available', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({ 'Content-Type': 'text/plain' })
    });
  }
}

// Stale-while-revalidate strategy
async function staleWhileRevalidate(event) {
  const cacheName = getCacheName(event.request);
  const cachedResponse = await caches.match(event.request);

  // Fetch in background
  const fetchPromise = fetchAndCache(event.request, cacheName);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    return await fetchPromise;
  } catch (error) {
    console.error('[SW] Stale-while-revalidate failed:', error);
    return caches.match('/card-back.svg');
  }
}

// Fetch and cache in background
async function fetchAndCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      await addToCache(cacheName, request, response);
    }
    return response;
  } catch (error) {
    console.error('[SW] Background fetch failed:', error);
    throw error;
  }
}

// Add response to cache with size management
async function addToCache(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    const clone = response.clone();

    // Check cache size before adding
    await checkCacheSize(cacheName);

    await cache.put(request, clone);
  } catch (error) {
    console.error('[SW] Error adding to cache:', error);
  }
}

// Check and manage cache size
async function checkCacheSize(cacheName) {
  const maxSize = MAX_CACHE_SIZES[cacheName.replace('planar-nexus-', '').replace('-v3', '')];
  if (!maxSize) return;

  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    let totalSize = 0;

    // Calculate current cache size
    for (const request of keys) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        totalSize += blob.size;
      }
    }

    // If over limit, remove oldest entries
    if (totalSize > maxSize) {
      console.log(`[SW] Cache ${cacheName} over limit (${totalSize} bytes), cleaning up`);
      await cleanupCache(cacheName, maxSize);
    }
  } catch (error) {
    console.error('[SW] Error checking cache size:', error);
  }
}

// Cleanup cache to fit within size limit
async function cleanupCache(cacheName, targetSize) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    let totalSize = 0;

    // Calculate total size and sort by date
    const entries = [];
    for (const request of keys) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        const date = response.headers.get('date') || '0';
        entries.push({
          request,
          size: blob.size,
          date: new Date(date).getTime(),
        });
        totalSize += blob.size;
      }
    }

    // Sort by date (oldest first)
    entries.sort((a, b) => a.date - b.date);

    // Remove oldest entries until under limit
    for (const entry of entries) {
      if (totalSize <= targetSize) break;
      await cache.delete(entry.request);
      totalSize -= entry.size;
    }
  } catch (error) {
    console.error('[SW] Error cleaning up cache:', error);
  }
}

// Generate offline page
function generateOfflinePage() {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Offline - Planar Nexus</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%);
          color: #f0f0f0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container {
          text-align: center;
          max-width: 400px;
        }
        .icon {
          font-size: 64px;
          margin-bottom: 24px;
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        h1 {
          font-size: 28px;
          margin-bottom: 16px;
          font-weight: 600;
        }
        p {
          font-size: 16px;
          color: #a0a0a0;
          margin-bottom: 24px;
          line-height: 1.6;
        }
        .button {
          display: inline-block;
          padding: 12px 24px;
          background: #6366f1;
          color: white;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 500;
          border: none;
          cursor: pointer;
          font-size: 16px;
        }
        .button:hover {
          background: #4f46e5;
        }
        .status {
          margin-top: 24px;
          padding: 12px;
          background: #1a1a2e;
          border-radius: 8px;
          font-size: 14px;
        }
        .status-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ef4444;
          margin-right: 8px;
          animation: blink 1s ease-in-out infinite;
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon" role="img" aria-label="Offline icon">📡</div>
        <h1>You're Offline</h1>
        <p>Some features may not be available until you're back online. Cached content is still accessible.</p>
        <button class="button" onclick="window.location.reload()">
          Try Again
        </button>
        <div class="status" role="status" aria-live="polite">
          <span class="status-dot" aria-hidden="true"></span>
          <span>Offline mode active</span>
        </div>
      </div>
      <script>
        window.addEventListener('online', () => window.location.reload());
      </script>
    </body>
    </html>
  `;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

// Generate offline API response
function generateOfflineAPIResponse(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Mock responses for common API endpoints
  if (path.includes('/api/cards/search')) {
    return new Response(JSON.stringify({
      data: [],
      object: 'list',
      has_more: false,
      total_cards: 0,
      warning: 'Offline - card search unavailable. Please connect to the internet.',
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (path.includes('/api/cards/')) {
    return new Response(JSON.stringify({
      object: 'error',
      code: 'not_found',
      status: 404,
      details: 'Offline - card data unavailable. Please connect to the internet.',
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({
    error: 'Offline - API unavailable',
    message: 'Please connect to the internet to use this feature.',
  }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Fetch event - route to appropriate strategy
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Handle cross-origin requests
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isAllowedCrossOrigin = IMAGE_PATTERNS.some(pattern => pattern.test(url.href)) ||
                                API_PATTERNS.some(pattern => pattern.test(url.href));

  if (!isSameOrigin && !isAllowedCrossOrigin) {
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

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    clearAllCaches().then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }

  if (event.data && event.data.type === 'GET_CACHE_INFO') {
    getCacheInfo().then((info) => {
      event.ports[0].postMessage(info);
    });
  }

  if (event.data && event.data.type === 'CACHE_CARDS') {
    cacheCards(event.data.cards).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }

  if (event.data && event.data.type === 'PRECACHE_IMAGES') {
    precacheImages(event.data.images).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }
});

// Clear all caches
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map(name => caches.delete(name)));
  console.log('[SW] All caches cleared');
}

// Get cache information
async function getCacheInfo() {
  const cacheNames = await caches.keys();
  const info = {};

  for (const name of cacheNames) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    let totalSize = 0;

    for (const request of keys) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        totalSize += blob.size;
      }
    }

    info[name] = {
      entries: keys.length,
      size: totalSize,
      sizeMB: (totalSize / (1024 * 1024)).toFixed(2),
    };
  }

  return {
    version: CACHE_VERSION,
    caches: info,
  };
}

// Cache cards in card database
async function cacheCards(cards) {
  const cache = await caches.open(CARD_CACHE);
  console.log('[SW] Caching', cards.length, 'cards');

  for (const card of cards) {
    if (card.image_uris) {
      const imageUrl = card.image_uris.normal || card.image_uris.small;
      try {
        const response = await fetch(imageUrl);
        if (response.ok) {
          await cache.put(imageUrl, response);
        }
      } catch (error) {
        console.error('[SW] Error caching card image:', card.name, error);
      }
    }
  }

  console.log('[SW] Card caching complete');
}

// Precache images
async function precacheImages(imageUrls) {
  const cache = await caches.open(IMAGE_CACHE);
  console.log('[SW] Precaching', imageUrls.length, 'images');

  const results = await Promise.allSettled(
    imageUrls.map(url =>
      fetch(url).then(response => {
        if (response.ok) {
          return cache.put(url, response);
        }
      })
    )
  );

  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length > 0) {
    console.warn('[SW] Failed to cache', failed.length, 'images');
  }

  console.log('[SW] Image precaching complete');
}

// Background sync for when connection is restored
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync triggered:', event.tag);

  if (event.tag === 'sync-game-state') {
    event.waitUntil(syncGameState());
  }

  if (event.tag === 'sync-decks') {
    event.waitUntil(syncDecks());
  }

  if (event.tag === 'sync-user-data') {
    event.waitUntil(syncUserData());
  }
});

// Sync game state when back online
async function syncGameState() {
  try {
    // Get pending game states from IndexedDB
    const pendingStates = await getPendingSyncItems('game-states');

    for (const state of pendingStates) {
      // Send to server
      await fetch('/api/games/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
      // Remove from pending sync
      await removePendingSyncItem(state.id);
    }

    console.log('[SW] Game state sync complete');
  } catch (error) {
    console.error('[SW] Game state sync failed:', error);
  }
}

// Sync decks when back online
async function syncDecks() {
  try {
    const pendingDecks = await getPendingSyncItems('decks');

    for (const deck of pendingDecks) {
      await fetch('/api/decks/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deck),
      });
      await removePendingSyncItem(deck.id);
    }

    console.log('[SW] Deck sync complete');
  } catch (error) {
    console.error('[SW] Deck sync failed:', error);
  }
}

// Sync user data when back online
async function syncUserData() {
  try {
    const pendingData = await getPendingSyncItems('user-data');

    for (const data of pendingData) {
      await fetch('/api/user/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      await removePendingSyncItem(data.id);
    }

    console.log('[SW] User data sync complete');
  } catch (error) {
    console.error('[SW] User data sync failed:', error);
  }
}

// IndexedDB helpers for offline sync
async function getPendingSyncItems(type) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('PlanarNexusSync', 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(type)) {
        db.createObjectStore(type, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction([type], 'readonly');
      const store = transaction.objectStore(type);
      const getRequest = store.getAll();

      getRequest.onsuccess = () => resolve(getRequest.result || []);
      getRequest.onerror = () => reject(getRequest.error);
    };

    request.onerror = () => reject(request.error);
  });
}

async function removePendingSyncItem(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('PlanarNexusSync', 1);

    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['game-states', 'decks', 'user-data'], 'readwrite');

      // Try to delete from all stores
      const stores = ['game-states', 'decks', 'user-data'];
      const deletePromises = stores
        .filter(storeName => transaction.objectStoreNames.contains(storeName))
        .map(storeName => {
          return new Promise((resolveDelete, rejectDelete) => {
            const store = transaction.objectStore(storeName);
            const deleteRequest = store.delete(id);
            deleteRequest.onsuccess = () => resolveDelete();
            deleteRequest.onerror = () => rejectDelete(deleteRequest.error);
          });
        });

      Promise.all(deletePromises).then(() => resolve()).catch(reject);
    };

    request.onerror = () => reject(request.error);
  });
}

// Push notification handler (for future use)
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');

  const options = {
    body: event.data ? event.data.text() : 'New notification from Planar Nexus',
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
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');

  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
