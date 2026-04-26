import { MinimalCard } from "../card-database";
import type { WorkerMessage, WorkerResponse } from "./embedding-worker";

/**
 * Client for communicating with the embedding worker.
 * Manages worker lifecycle and provides a simple interface for generating embeddings.
 */
export class EmbeddingClient {
  private static instance: EmbeddingClient | null = null;
  private worker: Worker | null = null;
  private initializationPromise: Promise<void> | null = null;
  private progressCallback:
    | ((message: string, progress?: number) => void)
    | null = null;

  private constructor() {
    // Only initialize on client side with browser environment
    if (typeof window !== "undefined" && typeof Worker !== "undefined") {
      try {
        // Use dynamic import to avoid issues with import.meta during bundling
        // The URL is resolved relative to this file's location
        const workerPath =
          typeof import.meta !== "undefined" && import.meta.url
            ? new URL("./embedding-worker.ts", import.meta.url).href
            : "./embedding-worker.ts";

        this.worker = new Worker(workerPath, {
          type: "module",
        });
      } catch (error) {
        console.error("Failed to initialize Embedding Worker:", error);
      }
    }
  }

  /**
   * Returns the singleton instance of the EmbeddingClient.
   */
  static getInstance(): EmbeddingClient {
    if (!this.instance) {
      this.instance = new EmbeddingClient();
    }
    return this.instance;
  }

  /**
   * Sets a callback for receiving progress updates from the worker.
   */
  setProgressCallback(callback: (message: string, progress?: number) => void) {
    this.progressCallback = callback;
  }

  /**
   * Ensures the model is loaded in the worker.
   */
  async ensureModelLoaded(): Promise<void> {
    if (this.initializationPromise) return this.initializationPromise;
    if (!this.worker)
      throw new Error(
        "Worker not available (likely server-side or failed initialization)",
      );

    this.initializationPromise = new Promise((resolve, reject) => {
      const handler = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        if (response.type === "MODEL_LOADED") {
          this.worker?.removeEventListener("message", handler);
          resolve();
        } else if (response.type === "PROGRESS") {
          this.progressCallback?.(response.message, response.progress);
        } else if (response.type === "ERROR") {
          this.worker?.removeEventListener("message", handler);
          this.initializationPromise = null; // Allow retry on error
          reject(new Error(response.error));
        }
      };

      this.worker!.addEventListener("message", handler);
      this.worker!.postMessage({ type: "LOAD_MODEL" });
    });

    return this.initializationPromise;
  }

  /**
   * Generates embeddings for a batch of cards.
   * Automatically ensures the model is loaded first.
   */
  async generateEmbeddings(
    cards: MinimalCard[],
  ): Promise<Array<{ id: string; embedding: number[] }>> {
    await this.ensureModelLoaded();
    if (!this.worker) throw new Error("Worker not available");

    return new Promise((resolve, reject) => {
      const handler = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        if (response.type === "EMBEDDINGS_GENERATED") {
          this.worker?.removeEventListener("message", handler);
          resolve(response.results);
        } else if (response.type === "PROGRESS") {
          this.progressCallback?.(response.message, response.progress);
        } else if (response.type === "ERROR") {
          this.worker?.removeEventListener("message", handler);
          reject(new Error(response.error));
        }
      };

      this.worker!.addEventListener("message", handler);
      this.worker!.postMessage({ type: "GENERATE_EMBEDDINGS", cards });
    });
  }
}
