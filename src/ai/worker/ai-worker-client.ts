import * as Comlink from "comlink";
import type {
  AIWorkerAPI,
  EvaluateTriggerChainPayload,
  DetectSynergiesPayload,
} from "./worker-types";
import type {
  CascadeContext,
  BoardPermanent,
  TriggerChain,
} from "../trigger-chain-evaluator";
import type { SynergyResult } from "../synergy-detector";
import type { DeckCard } from "@/app/actions";

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
   * Offloads trigger-chain evaluation to the AI Web Worker (#1080).
   *
   * Returns the worker-computed `TriggerChain[]`, or `null` when the worker is
   * unavailable (no proxy / not a browser). Callers MUST treat `null` or a
   * thrown error as "compute on the main thread" — the trigger-chain worker
   * bridge (`trigger-chain-worker-bridge.ts`) centralizes that fallback so the
   * AI never breaks if the worker fails to initialize or errors mid-call.
   */
  public async evaluateTriggerChain(
    stackItem: CascadeContext["stackItem"],
    battlefield: BoardPermanent[],
    maxDepth?: number,
  ): Promise<TriggerChain[] | null> {
    if (!this.proxy) {
      return null;
    }
    const payload: EvaluateTriggerChainPayload = {
      stackItem,
      battlefield,
      maxDepth,
    };
    return this.proxy.evaluateTriggerChain(payload);
  }

  /**
   * Offloads deck synergy detection to the AI Web Worker (#1079).
   *
   * Returns the worker-computed `SynergyResult[]`, or `null` when the worker is
   * unavailable (no proxy / not a browser). Callers MUST treat `null` or a
   * thrown error as "compute on the main thread" — the synergy worker bridge
   * (`synergy-worker-bridge.ts`) centralizes that fallback so the coach never
   * breaks if the worker fails to initialize or errors mid-call.
   */
  public async detectSynergies(
    deck: DeckCard[],
    minScore?: number,
    maxResults?: number,
  ): Promise<SynergyResult[] | null> {
    if (!this.proxy) {
      return null;
    }
    const payload: DetectSynergiesPayload = { deck, minScore, maxResults };
    return this.proxy.detectSynergies(payload);
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
