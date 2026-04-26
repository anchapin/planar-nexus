import * as Comlink from "comlink";
import type { AIWorkerAPI } from "./worker-types";

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
    if (typeof window !== "undefined") {
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
      // Only initialize on client side with browser environment
      if (typeof window === "undefined" || typeof Worker === "undefined") {
        return;
      }

      let workerUrl: string | URL;

      // Use dynamic import to avoid issues with import.meta during bundling/SSR
      // In browser, use URL constructor for proper path resolution
      // In tests/SSR, use a simple path string
      if (typeof import.meta !== "undefined" && import.meta.url) {
        workerUrl = new URL("./ai-worker.ts", import.meta.url).href;
      } else {
        // Fallback for non-ESM environments
        workerUrl = "./ai-worker.ts";
      }

      this.worker = new Worker(workerUrl, {
        type: "module",
      });
      this.proxy = Comlink.wrap<AIWorkerAPI>(this.worker);
    } catch (error) {
      console.error("Failed to initialize AI Worker:", error);
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
