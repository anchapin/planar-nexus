/**
 * Next.js Router Mock
 * 
 * Provides mock implementations for Next.js useRouter hook
 * to enable testing navigation without actual routing.
 */

import React from 'react';

// Mock router interface for testing
export interface MockRouterInstance {
  pathname: string;
  query: Record<string, string>;
  asPath: string;
  basePath: string;
  locale: string;
  locales: string[];
  isReady: boolean;
  isPreview: boolean;
  isFallback: boolean;
  push: jest.Mock<Promise<boolean>, [string, any?]>;
  replace: jest.Mock<Promise<boolean>, [string, any?]>;
  back: jest.Mock<Promise<void>, []>;
  forward: jest.Mock<Promise<void>, []>;
  refresh: jest.Mock<Promise<void>, []>;
  preflight: jest.Mock<Promise<void>, []>;
  getPushCalls: () => Array<{ url: string }>;
  getReplaceCalls: () => Array<{ url: string }>;
  reset: () => void;
}

/**
 * Mock router options
 */
export interface MockRouterOptions {
  pathname?: string;
  query?: Record<string, string>;
  asPath?: string;
  basePath?: string;
  locale?: string;
  locales?: string[];
  isReady?: boolean;
  isPreview?: boolean;
  isFallback?: boolean;
  push?: jest.Mock<Promise<boolean>, [string, any?]>;
  replace?: jest.Mock<Promise<boolean>, [string, any?]>;
}

/**
 * Default mock router options
 */
const DEFAULT_OPTIONS: Required<MockRouterOptions> = {
  pathname: '/',
  query: {},
  asPath: '/',
  basePath: '',
  locale: 'en',
  locales: ['en'],
  isReady: true,
  isPreview: false,
  isFallback: false,
  push: jest.fn(),
  replace: jest.fn(),
};

/**
 * Router history for tracking navigation
 */
export const routerHistory: string[] = [];

/**
 * Create a mock router instance
 */
export function createMockRouter(options: MockRouterOptions = {}): MockRouterInstance {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Track push calls
  const pushCalls: Array<{ url: string; options?: { scroll?: boolean } }> = [];
  const replaceCalls: Array<{ url: string; options?: { scroll?: boolean } }> = [];
  
  return {
    // Current state
    pathname: opts.pathname,
    query: opts.query,
    asPath: opts.asPath,
    basePath: opts.basePath,
    locale: opts.locale,
    locales: opts.locales,
    isReady: opts.isReady,
    isPreview: opts.isPreview,
    isFallback: opts.isFallback,
    
    // Navigation methods
    push: jest.fn().mockImplementation(async (url: string, options?: { scroll?: boolean }) => {
      pushCalls.push({ url, options });
      routerHistory.push(url);
      
      // Update internal state
      const urlObj = new URL(url, 'http://localhost');
      opts.pathname = urlObj.pathname;
      opts.query = Object.fromEntries(urlObj.searchParams);
      opts.asPath = urlObj.pathname;
      
      return true;
    }),
    
    replace: jest.fn().mockImplementation(async (url: string, options?: { scroll?: boolean }) => {
      replaceCalls.push({ url, options });
      
      // For replace, don't add to history
      const urlObj = new URL(url, 'http://localhost');
      opts.pathname = urlObj.pathname;
      opts.query = Object.fromEntries(urlObj.searchParams);
      opts.asPath = urlObj.pathname;
      
      return true;
    }),
    
    back: jest.fn().mockImplementation(async () => {
      if (routerHistory.length > 0) {
        routerHistory.pop();
      }
      return true;
    }),
    
    forward: jest.fn().mockImplementation(async () => {
      return true;
    }),
    
    refresh: jest.fn().mockImplementation(async () => {
      return;
    }),
    
    preflight: jest.fn().mockImplementation(async () => {
      return;
    }),
    
    // Helper to get push calls
    getPushCalls: () => pushCalls,
    
    // Helper to get replace calls
    getReplaceCalls: () => replaceCalls,
    
    // Helper to reset
    reset: () => {
      pushCalls.length = 0;
      replaceCalls.length = 0;
      routerHistory.length = 0;
    },
  };
}

/**
 * Default mock router instance
 */
let defaultRouter: MockRouterInstance | null = null;

/**
 * Get or create the default mock router
 */
export function getMockRouter(options?: MockRouterOptions): MockRouterInstance {
  if (!defaultRouter) {
    defaultRouter = createMockRouter(options);
  }
  return defaultRouter;
}

/**
 * Reset the default mock router
 */
export function resetMockRouter(): void {
  if (defaultRouter) {
    defaultRouter.reset?.();
  }
  defaultRouter = null;
}

/**
 * Mock useRouter hook for component tests
 * 
 * @example
 * import { mockUseRouter } from '@/test-utils';
 * 
 * // In your test:
 * mockUseRouter({ pathname: '/deck-builder' });
 * 
 * // Or with custom push:
 * mockUseRouter({
 *   pathname: '/game',
 *   push: jest.fn().mockResolvedValue(true)
 * });
 */
export function mockUseRouter(options: MockRouterOptions = {}): void {
  const router = createMockRouter(options);
  
  // Mock the module
  jest.mock('next/navigation', () => ({
    useRouter: () => router,
    usePathname: () => options.pathname || '/',
    useSearchParams: () => new URLSearchParams(options.query || {}),
    useParams: () => options.query || {},
    useParamsAsync: async () => options.query || {},
    useSelectedLayoutSegment: () => null,
    useSelectedLayoutSegments: () => [],
    Router: {
      events: {
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
      },
    },
  }));
}

/**
 * Wrapper component for testing components that use useRouter
 */
interface RouterMockProps {
  children: React.ReactNode;
  options?: MockRouterOptions;
}

/**
 * Create a router mock context provider
 */
export function RouterMock({ 
  children, 
  options = {} 
}: RouterMockProps): React.ReactElement {
  const _router = createMockRouter(options);
  
  // This component doesn't render anything; it's used with jest.mock
  // See mockUseRouter for actual usage
  return <>{children}</>;
}

/**
 * Helper to check if push was called with specific URL
 */
export function assertRouterPushCalledWith(router: MockRouterInstance, url: string): boolean {
  const calls = router.getPushCalls();
  return calls.some((call: { url: string }) => call.url === url);
}

/**
 * Helper to check if replace was called with specific URL
 */
export function assertRouterReplaceCalledWith(router: MockRouterInstance, url: string): boolean {
  const calls = router.getReplaceCalls();
  return calls.some((call: { url: string }) => call.url === url);
}

export default {
  createMockRouter,
  mockUseRouter,
  getMockRouter,
  resetMockRouter,
  routerHistory,
};
