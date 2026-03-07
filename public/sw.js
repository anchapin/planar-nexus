// Planar Nexus Service Worker for PWA/Offline Support
const CACHE_NAME = 'planar-nexus-v2';
const STATIC_CACHE = 'planar-nexus-static-v2';
const DYNAMIC_CACHE = 'planar-nexus-dynamic-v2';
const INDEXEDDB_NAME = 'PlanarNexusStorage';
const INDEXEDDB_VERSION = 1;

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

// IndexedDB for offline data storage
let db = null;

// Open IndexedDB connection
async function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(INDEXEDDB_NAME, INDEXEDDB_VERSION);

    request.onerror = () => {
      console.error('[SW] Failed to open IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log('[SW] IndexedDB opened successfully');
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains('decks')) {
        database.createObjectStore('decks', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('saved-games')) {
        database.createObjectStore('saved-games', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('preferences')) {
        database.createObjectStore('preferences', { keyPath: 'id' });
      }
    };
  });
}

// Ensure IndexedDB is initialized
async function ensureIndexedDB() {
  if (!db) {
    await openIndexedDB();
  }
  return db;
}

// Get data from IndexedDB
async function getData(storeName, key) {
  const database = await ensureIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Set data in IndexedDB
async function setData(storeName, data) {
  const database = await ensureIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(data);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Get all data from a store
async function getAllData(storeName) {
  const database = await ensureIndexedDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

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

  // Handle data API requests with IndexedDB fallback
  if (isSameOrigin && url.pathname.startsWith('/api/data/')) {
    event.respondWith(handleDataAPI(event));
    return;
  }

  const strategy = getCacheStrategy(event.request);

  if (strategy === 'cache-first') {
    event.respondWith(cacheFirst(event));
  } else {
    event.respondWith(networkFirst(event));
  }
});

// Handle data API requests with IndexedDB integration
async function handleDataAPI(event) {
  const url = new URL(event.request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);

  // Parse request: /api/data/{store}/{id}
  if (pathParts.length >= 3 && pathParts[0] === 'api' && pathParts[1] === 'data') {
    const storeName = pathParts[2];
    const id = pathParts[3];

    try {
      if (id) {
        // Get specific item
        const data = await getData(storeName, id);
        if (data) {
          return new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not found', { status: 404 });
      } else {
        // Get all items in store
        const data = await getAllData(storeName);
        return new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (error) {
      console.error('[SW] Error accessing IndexedDB:', error);
      return new Response('Internal error', { status: 500 });
    }
  }

  return new Response('Bad request', { status: 400 });
}

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }

  // Handle IndexedDB operations from clients
  if (event.data && event.data.type === 'INDEXEDDB_OPERATION') {
    handleIndexedDBOperation(event);
  }

  // Handle offline status check
  if (event.data && event.data.type === 'CHECK_OFFLINE_STATUS') {
    event.ports[0].postMessage({
      offline: !navigator.onLine
    });
  }
});

// Handle IndexedDB operations from client
async function handleIndexedDBOperation(event) {
  const { action, storeName, data, key } = event.data;

  try {
    await ensureIndexedDB();

    switch (action) {
      case 'GET':
        const result = await getData(storeName, key);
        event.ports[0].postMessage({ success: true, data: result });
        break;

      case 'GET_ALL':
        const all = await getAllData(storeName);
        event.ports[0].postMessage({ success: true, data: all });
        break;

      case 'SET':
        await setData(storeName, data);
        event.ports[0].postMessage({ success: true });
        break;

      default:
        event.ports[0].postMessage({
          success: false,
          error: 'Unknown action'
        });
    }
  } catch (error) {
    console.error('[SW] IndexedDB operation failed:', error);
    event.ports[0].postMessage({
      success: false,
      error: error.message
    });
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
    const decks = await getAllData('decks');
    const savedGames = await getAllData('saved-games');

    console.log('[SW] Syncing offline data:', {
      decksCount: decks.length,
      savedGamesCount: savedGames.length
    });

    // In a real implementation, this would send data to the server
    // For now, we just log that sync occurred
  } catch (error) {
    console.error('[SW] Sync failed:', error);
  }
}
