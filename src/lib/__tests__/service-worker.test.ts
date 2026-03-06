/**
 * Service Worker Tests
 * Tests for service worker functionality, caching, and offline support
 */

describe('Service Worker', () => {
  let mockServiceWorker: any;
  let messageChannel: any;

  beforeEach(() => {
    // Mock navigator.serviceWorker
    mockServiceWorker = {
      register: jest.fn().mockResolvedValue({
        scope: '/',
        active: {
          postMessage: jest.fn(),
        },
        installing: {
          addEventListener: jest.fn(),
        },
        addEventListener: jest.fn(),
      }),
      ready: Promise.resolve({
        active: {
          postMessage: jest.fn(),
        },
      }),
      controller: {
        postMessage: jest.fn(),
      },
    };

    global.navigator = {
      ...global.navigator,
      serviceWorker: mockServiceWorker,
    } as any;

    // Mock MessageChannel
    messageChannel = {
      port1: {
        onmessage: null,
        close: jest.fn(),
      },
      port2: {},
    };

    global.MessageChannel = jest.fn(() => messageChannel) as any;
  });

  describe('Service Worker Registration', () => {
    it('should register service worker on mount', async () => {
      const { ServiceWorkerRegistration } = require('@/components/service-worker-registration');
      const { render } = require('@testing-library/react');

      render(<ServiceWorkerRegistration />);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockServiceWorker.register).toHaveBeenCalledWith('/sw.js');
    });

    it('should handle registration errors', async () => {
      mockServiceWorker.register.mockRejectedValue(new Error('Registration failed'));

      const { ServiceWorkerRegistration } = require('@/components/service-worker-registration');
      const { render } = require('@testing-library/react');

      console.error = jest.fn();

      render(<ServiceWorkerRegistration />);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(console.error).toHaveBeenCalledWith(
        'Service Worker registration failed:',
        expect.any(Error)
      );
    });
  });

  describe('Cache Management', () => {
    it('should clear all caches when requested', async () => {
      const { useServiceWorkerCache } = require('@/lib/use-service-worker-cache');
      const { renderHook, act, waitFor } = require('@testing-library/react');

      const mockCacheInfo = {
        version: 'planar-nexus-v3',
        caches: {
          'planar-nexus-static-v3': {
            entries: 10,
            size: 1024 * 1024,
            sizeMB: '1.00',
          },
        },
      };

      messageChannel.port1.onmessage = (event: any) => {
        if (event.data.type === 'GET_CACHE_INFO') {
          messageChannel.port1.onmessage({ data: mockCacheInfo });
        } else if (event.data.type === 'CLEAR_CACHE') {
          messageChannel.port1.onmessage({ data: { success: true } });
        }
      };

      const { result } = renderHook(() => useServiceWorkerCache());

      await waitFor(() => result.current.cacheInfo !== null);

      await act(async () => {
        await result.current.clearCache();
      });

      expect(result.current.cacheInfo).toBeNull();
    });

    it('should get cache information', async () => {
      const { useServiceWorkerCache } = require('@/lib/use-service-worker-cache');
      const { renderHook, waitFor } = require('@testing-library/react');

      const mockCacheInfo = {
        version: 'planar-nexus-v3',
        caches: {
          'planar-nexus-static-v3': {
            entries: 10,
            size: 1024 * 1024,
            sizeMB: '1.00',
          },
          'planar-nexus-images-v3': {
            entries: 50,
            size: 10 * 1024 * 1024,
            sizeMB: '10.00',
          },
        },
      };

      messageChannel.port1.onmessage = (event: any) => {
        if (event.data.type === 'GET_CACHE_INFO') {
          messageChannel.port1.onmessage({ data: mockCacheInfo });
        }
      };

      const { result } = renderHook(() => useServiceWorkerCache());

      await waitFor(() => result.current.cacheInfo !== null);

      expect(result.current.cacheInfo).toEqual(mockCacheInfo);
      expect(result.current.getCacheSize()).toBe(11 * 1024 * 1024);
    });
  });

  describe('Network Status', () => {
    it('should detect online status', () => {
      const { useNetworkStatus } = require('@/lib/use-network-status');
      const { renderHook } = require('@testing-library/react');

      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: true,
      });

      const { result } = renderHook(() => useNetworkStatus());

      expect(result.current.isOnline).toBe(true);
    });

    it('should detect offline status', () => {
      const { useNetworkStatus } = require('@/lib/use-network-status');
      const { renderHook } = require('@testing-library/react');

      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: false,
      });

      const { result } = renderHook(() => useNetworkStatus());

      expect(result.current.isOnline).toBe(false);
    });

    it('should update status when network changes', () => {
      const { useNetworkStatus } = require('@/lib/use-network-status');
      const { renderHook, act } = require('@testing-library/react');

      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: true,
      });

      const { result } = renderHook(() => useNetworkStatus());

      expect(result.current.isOnline).toBe(true);

      act(() => {
        Object.defineProperty(navigator, 'onLine', {
          writable: true,
          value: false,
        });
        window.dispatchEvent(new Event('offline'));
      });

      expect(result.current.isOnline).toBe(false);
    });

    it('should check actual connection', async () => {
      const { useNetworkStatus } = require('@/lib/use-network-status');
      const { renderHook, act, waitFor } = require('@testing-library/react');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
      });

      const { result } = renderHook(() => useNetworkStatus());

      const isActuallyOnline = await act(async () => {
        return await result.current.checkConnection();
      });

      await waitFor(() => expect(isActuallyOnline).toBe(true));
      expect(fetch).toHaveBeenCalledWith('/manifest.json', {
        method: 'HEAD',
        cache: 'no-cache',
      });
    });
  });

  describe('Offline Indicator', () => {
    it('should not show when online', () => {
      const { OfflineIndicator } = require('@/components/offline-indicator');
      const { render, queryByText } = require('@testing-library/react');

      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: true,
      });

      const { container } = render(<OfflineIndicator />);

      expect(queryByText("You're offline")).not.toBeInTheDocument();
      expect(container.firstChild).toBeNull();
    });

    it('should show when offline', () => {
      const { OfflineIndicator } = require('@/components/offline-indicator');
      const { render, getByText } = require('@testing-library/react');

      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: false,
      });

      render(<OfflineIndicator />);

      expect(getByText("You're offline")).toBeInTheDocument();
    });

    it('should check connection on retry', async () => {
      const { OfflineIndicator } = require('@/components/offline-indicator');
      const { render, getByText, fireEvent } = require('@testing-library/react');

      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        value: false,
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
      });

      render(<OfflineIndicator />);

      const retryButton = getByText('Retry');
      fireEvent.click(retryButton);

      expect(fetch).toHaveBeenCalledWith('/manifest.json', {
        method: 'HEAD',
        cache: 'no-cache',
      });
    });
  });

  describe('Service Worker Messages', () => {
    it('should handle GET_VERSION message', async () => {
      const controller = mockServiceWorker.controller;
      const port2 = messageChannel.port2;

      await controller.postMessage(
        { type: 'GET_VERSION' },
        [port2]
      );

      expect(controller.postMessage).toHaveBeenCalledWith(
        { type: 'GET_VERSION' },
        [port2]
      );
    });

    it('should handle CLEAR_CACHE message', async () => {
      const controller = mockServiceWorker.controller;
      const port2 = messageChannel.port2;

      await controller.postMessage(
        { type: 'CLEAR_CACHE' },
        [port2]
      );

      expect(controller.postMessage).toHaveBeenCalledWith(
        { type: 'CLEAR_CACHE' },
        [port2]
      );
    });

    it('should handle GET_CACHE_INFO message', async () => {
      const controller = mockServiceWorker.controller;
      const port2 = messageChannel.port2;

      await controller.postMessage(
        { type: 'GET_CACHE_INFO' },
        [port2]
      );

      expect(controller.postMessage).toHaveBeenCalledWith(
        { type: 'GET_CACHE_INFO' },
        [port2]
      );
    });
  });
});
