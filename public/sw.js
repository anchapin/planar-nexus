// Planar Nexus Service Worker for PWA/Offline Support
const CACHE_NAME = 'planar-nexus-v2';
const STATIC_CACHE = 'planar-nexus-static-v2';
const DYNAMIC_CACHE = 'planar-nexus-dynamic-v2';

// Static assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/offline.html',
  '/icon-192.svg',
  '/icon-512.svg',
];

// API endpoints to cache with network-first strategy
const API_PATTERNS = [
  /\/api\//,
  /https:\/\/api\.scryfall\.com\//,
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            return name.startsWith('planar-nexus-') && 
                   name !== STATIC_CACHE && 
                   name !== DYNAMIC_CACHE;
          })
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  // Take control of all pages immediately
  event.waitUntil(self.clients.claim());
});

// Determine caching strategy based on request type
function getCacheStrategy(request) {
  const url = new URL(request.url);

  // API requests - network first, fallback to cache
  if (API_PATTERNS.some(pattern => pattern.test(url.href))) {
    return 'network-first';
  }

  // Navigation requests (HTML pages) - network first
  if (request.mode === 'navigate') {
    return 'network-first';
  }

  // Static assets - cache first
  if (request.destination === 'style' || 
      request.destination === 'script' || 
      request.destination === 'image' ||
      request.destination === 'font') {
    return 'cache-first';
  }

  // Default: network first
  return 'network-first';
}

// Cache-first strategy
async function cacheFirst(event) {
  const cachedResponse = await caches.match(event.request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(event.request);
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(event.request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    return caches.match('/offline.html');
  }
}

// Network-first strategy
async function networkFirst(event) {
  try {
    const networkResponse = await fetch(event.request);
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(event.request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
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

// Fetch event - route to appropriate strategy
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip cross-origin requests except for Scryfall API
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isScryfall = url.hostname === 'api.scryfall.com';
  
  if (!isSameOrigin && !isScryfall) {
    return;
  }

  const strategy = getCacheStrategy(event.request);
  
  if (strategy === 'cache-first') {
    event.respondWith(cacheFirst(event));
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
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

// Background sync for when connection is restored
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-game-state') {
    console.log('[SW] Background sync triggered');
  }
});
