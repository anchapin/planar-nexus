import * as Comlink from 'comlink';
import type { AIWorkerAPI } from './worker-types';

/**
 * Main Thread Client for AI Web Worker
 * 
 * Provides a clean RPC bridge for components to interact
 * with off-main-thread AI heuristics.
 */
class AIWorkerClient {
  private static instance: AIWorkerClient | null = null;
  private worker: Worker | null = null;
  private proxy: Comlink.Remote<AIWorkerAPI> | null = null;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  /**
   * Returns the singleton instance of the AI Worker Client.
   */
  public static getInstance(): AIWorkerClient {
    if (!AIWorkerClient.instance) {
      AIWorkerClient.instance = new AIWorkerClient();
    }
    return AIWorkerClient.instance;
  }

  /**
   * Initializes the Web Worker and Comlink proxy.
   */
  private init() {
    try {
      // Note: We use a workaround for import.meta.url which can cause issues in Jest/CommonJS
      // In the browser, we use the URL constructor for Vite/Webpack/Next.js compatibility
      // In tests, we use a simple path or mock.
      let workerUrl: string | URL;
      
      if (typeof window !== 'undefined' && (window as any).location) {
        try {
          // Use a dynamic property access to avoid static analysis syntax errors in Jest
          const meta = (import.meta as any);
          workerUrl = new URL('./ai-worker.ts', meta.url);
        } catch (e) {
          // Fallback if import.meta.url is not available
          workerUrl = './ai-worker.ts';
        }
      } else {
        workerUrl = './ai-worker.ts';
      }

      this.worker = new Worker(workerUrl, {
        type: 'module',
      });
      this.proxy = Comlink.wrap<AIWorkerAPI>(this.worker);
    } catch (error) {
      console.error('Failed to initialize AI Worker:', error);
    }
  }

  /**
   * Access the AI Worker proxy directly.
   */
  public get api(): Comlink.Remote<AIWorkerAPI> | null {
    return this.proxy;
  }

  /**
   * Terminates the worker.
   */
  public terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.proxy = null;
    }
  }
}

export const aiWorkerClient = AIWorkerClient.getInstance();
