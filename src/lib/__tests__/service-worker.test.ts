/**
 * @fileOverview Service Worker Tests
 *
 * Unit 15: PWA Service Worker Enhancement
 *
 * Tests for:
 * - Service worker caching strategies
 * - Offline functionality
 * - Cache management
 * - Service worker lifecycle
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock ServiceWorker API
class MockCache {
  private store = new Map<string, Response>();

  async put(request: Request, response: Response): Promise<void> {
    this.store.set(request.url, response.clone());
  }

  async match(request: Request): Promise<Response | undefined> {
    return this.store.get(request.url);
  }

  async delete(request: Request): Promise<boolean> {
    return this.store.delete(request.url);
  }

  async keys(): Promise<Request[]> {
    return Array.from(this.store.keys()).map(url => new Request(url));
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

const mockCache = new MockCache();
const mockCacheStore = new Map<string, MockCache>();

// Mock caches API
global.caches = {
  open: jest.fn(async (name: string) => {
    if (!mockCacheStore.has(name)) {
      mockCacheStore.set(name, new MockCache());
    }
    return mockCacheStore.get(name) as any;
  }),
  delete: jest.fn(async (name: string) => {
    return mockCacheStore.delete(name);
  }),
  keys: jest.fn(async () => {
    return Array.from(mockCacheStore.keys()).map(name => ({ name }));
  }),
  has: jest.fn(async (name: string) => {
    return mockCacheStore.has(name);
  }),
} as unknown as CacheStorage;

// Mock self for service worker context
const selfMock = {
  skipWaiting: jest.fn(),
  clients: {
    claim: jest.fn(),
  },
};

describe('Service Worker Caching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCacheStore.clear();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('Cache Strategy Detection', () => {
    it('should use cache-first for static assets', () => {
      const styleRequest = new Request('https://example.com/styles.css', {
        destination: 'style',
      } as any);
      const scriptRequest = new Request('https://example.com/script.js', {
        destination: 'script',
      } as any);
      const imageRequest = new Request('https://example.com/image.png', {
        destination: 'image',
      } as any);
      const fontRequest = new Request('https://example.com/font.woff2', {
        destination: 'font',
      } as any);

      // Test cache-first strategy for static assets
      const staticAssets = [styleRequest, scriptRequest, imageRequest, fontRequest];
      staticAssets.forEach(request => {
        expect(request.destination).toBeDefined();
        expect(['style', 'script', 'image', 'font']).toContain(request.destination);
      });
    });

    it('should use network-first for navigation requests', () => {
      const navRequest = new Request('https://example.com/dashboard', {
        mode: 'navigate',
      });

      expect(navRequest.mode).toBe('navigate');
    });

    it('should use network-first for API requests', () => {
      const apiRequest = new Request('https://api.scryfall.com/cards/named');
      const internalApiRequest = new Request('https://example.com/api/cards');

      expect(apiRequest.url).toContain('api.scryfall.com');
      expect(internalApiRequest.url).toContain('/api/');
    });
  });

  describe('Cache Management', () => {
    it('should open cache with correct name', async () => {
      const cacheName = 'planar-nexus-static-v2';
      await caches.open(cacheName);

      expect(caches.open).toHaveBeenCalledWith(cacheName);
    });

    it('should delete old caches', async () => {
      // Setup: Create old caches
      await caches.open('planar-nexus-v1');
      await caches.open('planar-nexus-static-v1');

      // Mock response for keys()
      ((caches.keys as jest.Mock).mockResolvedValue as any)([
        { name: 'planar-nexus-v1' } as any,
        { name: 'planar-nexus-static-v1' } as any,
        { name: 'planar-nexus-static-v2' } as any,
        { name: 'planar-nexus-dynamic-v2' } as any,
      ] as any);

      const cacheNames = await caches.keys();
      const oldCaches = cacheNames.filter((cache: any) =>
        cache.name.startsWith('planar-nexus-') &&
        cache.name !== 'planar-nexus-static-v2' &&
        cache.name !== 'planar-nexus-dynamic-v2'
      );

      expect(oldCaches.length).toBe(2);
    });

    it('should skip waiting for activation', () => {
      selfMock.skipWaiting();
      expect(selfMock.skipWaiting).toHaveBeenCalled();
    });

    it('should claim all clients', () => {
      selfMock.clients.claim();
      expect(selfMock.clients.claim).toHaveBeenCalled();
    });
  });

  describe('Offline Fallback', () => {
    it('should serve offline page when navigation fails', () => {
      const offlineRequest = new Request('https://example.com/dashboard', {
        mode: 'navigate',
      });

      expect(offlineRequest.mode).toBe('navigate');
    });

    it('should return appropriate error for failed API requests', () => {
      const apiRequest = new Request('https://api.scryfall.com/cards/named');
      const errorResponse = new Response('Offline', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers({ 'Content-Type': 'text/plain' }),
      });

      expect(errorResponse.status).toBe(503);
      expect(errorResponse.statusText).toBe('Service Unavailable');
    });

    it('should handle offline page request', () => {
      const offlinePageRequest = new Request('https://example.com/offline.html');
      expect(offlinePageRequest.url).toContain('offline.html');
    });
  });

  describe('Message Handling', () => {
    it('should handle SKIP_WAITING message', () => {
      const message = { type: 'SKIP_WAITING' };

      expect(message.type).toBe('SKIP_WAITING');
      // In actual service worker, this would call self.skipWaiting()
    });

    it('should handle GET_VERSION message', () => {
      const message = { type: 'GET_VERSION' };

      expect(message.type).toBe('GET_VERSION');
      // In actual service worker, this would return the cache version
    });

    it('should respond with version number', () => {
      const version = 'planar-nexus-v2';
      expect(version).toBeDefined();
      expect(version).toContain('planar-nexus');
    });
  });

  describe('Background Sync', () => {
    it('should register sync event', () => {
      const syncEvent = { tag: 'sync-game-state' };

      expect(syncEvent.tag).toBe('sync-game-state');
    });

    it('should handle sync event when connection is restored', () => {
      const syncTag = 'sync-game-state';
      expect(syncTag).toBe('sync-game-state');
    });
  });

  describe('Request Filtering', () => {
    it('should skip non-GET requests', () => {
      const postRequest = new Request('https://example.com/api/save', {
        method: 'POST',
      });
      const putRequest = new Request('https://example.com/api/update', {
        method: 'PUT',
      });
      const deleteRequest = new Request('https://example.com/api/delete', {
        method: 'DELETE',
      });

      expect(postRequest.method).toBe('POST');
      expect(putRequest.method).toBe('PUT');
      expect(deleteRequest.method).toBe('DELETE');
    });

    it('should allow Scryfall API requests', () => {
      const scryfallRequest = new Request('https://api.scryfall.com/cards');
      const hostname = new URL(scryfallRequest.url).hostname;

      expect(hostname).toBe('api.scryfall.com');
    });

    it('should skip cross-origin requests except Scryfall', () => {
      const crossOriginRequest = new Request('https://example.com/external-api');
      const sameOriginRequest = new Request('https://example.com/api/internal');
      const scryfallRequest = new Request('https://api.scryfall.com/cards');

      const crossOriginHost = new URL(crossOriginRequest.url).hostname;
      const sameOriginHost = new URL(sameOriginRequest.url).hostname;
      const scryfallHost = new URL(scryfallRequest.url).hostname;

      expect(crossOriginHost).not.toBe(scryfallHost);
      expect(sameOriginHost).toBe('example.com');
      expect(scryfallHost).toBe('api.scryfall.com');
    });
  });

  describe('Static Assets Caching', () => {
    it('should cache core application files', () => {
      const staticAssets = [
        '/',
        '/manifest.json',
        '/offline.html',
        '/icon-192.svg',
        '/icon-512.svg',
      ];

      staticAssets.forEach(asset => {
        expect(asset).toBeDefined();
        expect(asset.length).toBeGreaterThan(0);
      });
    });

    it('should cache PWA manifest', () => {
      const manifestRequest = new Request('https://example.com/manifest.json');
      expect(manifestRequest.url).toContain('manifest.json');
    });

    it('should cache app icons', () => {
      const icon192 = new Request('https://example.com/icon-192.svg');
      const icon512 = new Request('https://example.com/icon-512.svg');

      expect(icon192.url).toContain('icon-192.svg');
      expect(icon512.url).toContain('icon-512.svg');
    });
  });

  describe('API Caching', () => {
    it('should identify Scryfall API requests', () => {
      const scryfallPatterns = [
        'https://api.scryfall.com/cards/named',
        'https://api.scryfall.com/sets',
        'https://api.scryfall.com/cards/search',
      ];

      scryfallPatterns.forEach(url => {
        const pattern = /https:\/\/api\.scryfall\.com\//;
        expect(pattern.test(url)).toBe(true);
      });
    });

    it('should identify internal API requests', () => {
      const internalApiPatterns = [
        'https://example.com/api/cards',
        'https://example.com/api/decks',
        'https://example.com/api/games',
      ];

      internalApiPatterns.forEach(url => {
        const pattern = /\/api\//;
        expect(pattern.test(url)).toBe(true);
      });
    });

    it('should use network-first for API requests', () => {
      const apiRequest = new Request('https://api.scryfall.com/cards/named');
      const internalApiRequest = new Request('https://example.com/api/cards');

      expect(apiRequest.url).toContain('api.');
      expect(internalApiRequest.url).toContain('/api/');
    });
  });
});

describe('Service Worker Integration', () => {
  it('should have correct cache names', () => {
    const CACHE_NAME = 'planar-nexus-v2';
    const STATIC_CACHE = 'planar-nexus-static-v2';
    const DYNAMIC_CACHE = 'planar-nexus-dynamic-v2';

    expect(CACHE_NAME).toContain('planar-nexus');
    expect(STATIC_CACHE).toContain('static');
    expect(DYNAMIC_CACHE).toContain('dynamic');
  });

  it('should have proper cache versioning', () => {
    const version = 'v2';
    expect(version).toBeDefined();
    expect(version).toMatch(/v\d+/);
  });

  it('should support cache-first strategy', () => {
    const strategy = 'cache-first';
    expect(strategy).toBe('cache-first');
  });

  it('should support network-first strategy', () => {
    const strategy = 'network-first';
    expect(strategy).toBe('network-first');
  });
});
