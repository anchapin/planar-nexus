import * as Comlink from "comlink";
import type {
  AIWorkerAPI,
  AnalyzeStatePayload,
  DetailedEvaluation,
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
import type { AIGameState as GameState } from "@/lib/game-state/types";
import type { DeckArchetype } from "../game-state-evaluator";

/**
 * Main Thread Client for AI Web Worker
 *
 * Provides a clean RPC bridge for components to interact
 * with off-main-thread AI heuristics.
 *
 * Issue #1244: the worker is now lazily initialized on first use (rather than
 * eagerly in the constructor). This keeps SSR / Node / Jest paths free of the
 * `Worker` global entirely until a real browser-side caller actually needs it.
 */
class AIWorkerClient {
  private static instance: AIWorkerClient | null = null;
  private worker: Worker | null = null;
  private proxy: Comlink.Remote<AIWorkerAPI> | null = null;
  private initAttempted = false;

  // Private so callers must use {@link getInstance}. Worker init is deferred
  // to the first public call so SSR / Node / Jest paths never touch the
  // `Worker` global (#1244).
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

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
   * Initializes the Web Worker and Comlink proxy. Lazy + idempotent — safe to
   * call from any context. After a failed attempt (e.g. SSR, no `Worker`
   * global), subsequent calls are no-ops so we don't spam errors.
   */
  private init() {
    if (this.initAttempted) {
      return;
    }
    this.initAttempted = true;

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
   * Access the AI Worker proxy directly. Lazily initializes the worker on
   * first access in browser environments.
   */
  public get api(): Comlink.Remote<AIWorkerAPI> | null {
    if (!this.proxy && !this.initAttempted) {
      this.init();
    }
    return this.proxy;
  }

  /**
   * Offloads game-state evaluation to the AI Web Worker (#1244).
   *
   * Returns the worker-computed `DetailedEvaluation`, or `null` when the
   * worker is unavailable (no proxy / not a browser / init failed). Callers
   * MUST treat `null` or a thrown error as "compute on the main thread" — the
   * game-state-evaluator worker bridge
   * (`game-state-evaluator-worker-bridge.ts`) centralizes that fallback so
   * the AI never breaks if the worker fails to initialize or errors mid-call.
   */
  public async analyzeGameState(
    gameState: GameState,
    playerId: string,
    difficulty?: AnalyzeStatePayload["difficulty"],
    archetype?: DeckArchetype,
  ): Promise<DetailedEvaluation | null> {
    if (!this.proxy) {
      this.init();
    }
    const proxy = this.proxy;
    if (!proxy) {
      return null;
    }
    const payload: AnalyzeStatePayload = {
      gameState,
      playerId,
      difficulty,
      archetype,
    };
    return proxy.analyzeGameState(payload);
  }

  /**
   * Offloads quick game-state scoring to the AI Web Worker (#1244).
   *
   * Returns the worker-computed scalar, or `null` when the worker is
   * unavailable. See {@link analyzeGameState} for the fallback contract.
   */
  public async quickScore(
    gameState: GameState,
    playerId: string,
    difficulty?: AnalyzeStatePayload["difficulty"],
    archetype?: DeckArchetype,
  ): Promise<number | null> {
    if (!this.proxy) {
      this.init();
    }
    const proxy = this.proxy;
    if (!proxy) {
      return null;
    }
    const payload: AnalyzeStatePayload = {
      gameState,
      playerId,
      difficulty,
      archetype,
    };
    return proxy.quickScore(payload);
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
      this.init();
    }
    const proxy = this.proxy;
    if (!proxy) {
      return null;
    }
    const payload: EvaluateTriggerChainPayload = {
      stackItem,
      battlefield,
      maxDepth,
    };
    return proxy.evaluateTriggerChain(payload);
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
      this.init();
    }
    const proxy = this.proxy;
    if (!proxy) {
      return null;
    }
    const payload: DetectSynergiesPayload = { deck, minScore, maxResults };
    return proxy.detectSynergies(payload);
  }

  /**
   * Terminates the worker.
   */
  public terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.proxy = null;
      this.initAttempted = false;
    }
  }
}

export const aiWorkerClient = AIWorkerClient.getInstance();
