"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type DeckCard, type ScryfallCard } from "@/lib/card-database";
import {
  embeddingWorkerManager,
  type EmbeddingWorkerLoadState,
} from "@/lib/synergy/embedding-manager";
import { getCardById } from "@/lib/card-database";

export interface SynergyResult {
  score: number;
  confidence: "high" | "medium" | "low";
}

/**
 * The UI-facing model lifecycle. The manager exposes four states
 * ("not-started" | "loading" | "ready" | "error"); we map "not-started"
 * to "idle" for the public API so consumers see a stable, friendlier
 * vocabulary.
 */
export type ModelState = "idle" | "loading" | "ready" | "error";

interface SynergyContextValue {
  synergyData: Map<string, SynergyResult>;
  topSuggestions: ScryfallCard[];
  isCalculating: boolean;
  /** Per-query error string (separate from model lifecycle). */
  error: string | null;
  modelState: ModelState;
  /** Opt-in trigger: call this when the user wants to enable AI
   *  synergy suggestions. Idempotent. Until called the provider
   *  stays inert — no worker, no LOAD_MODEL (issue #1813). */
  enableSynergy: () => void;
}

const SynergyContext = createContext<SynergyContextValue | undefined>(
  undefined,
);

function mapLoadState(s: EmbeddingWorkerLoadState): ModelState {
  return s === "not-started" ? "idle" : s;
}

/**
 * SynergyProvider manages the deck's synergy state by:
 * 1. Lazily subscribing to the module-level EmbeddingWorkerManager only
 *    after the user opts in via `enableSynergy()`.
 * 2. Dynamically importing the Orama vector search engine the first
 *    time a query resolves — the deck-builder route no longer
 *    statically includes the vector-index stack in its initial chunk.
 * 3. Computing a composite deck vector and querying Orama for
 *    synergistic candidates after the debounce settles.
 */
export function SynergyProvider({
  children,
  deck,
}: {
  children: React.ReactNode;
  deck: DeckCard[];
}) {
  const [synergyData, setSynergyData] = useState<Map<string, SynergyResult>>(
    new Map(),
  );
  const [topSuggestions, setTopSuggestions] = useState<ScryfallCard[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelState, setModelState] = useState<ModelState>("idle");
  const [enabled, setEnabled] = useState(false);

  const requestSeqRef = useRef(0);

  const enableSynergy = useCallback(() => {
    setEnabled(true);
  }, []);

  // Lazily subscribe + start the manager when the user opts in.
  useEffect(() => {
    if (!enabled) return;
    // Optimistic UI: the user has opted in, so show the loading
    // affordance immediately. The manager flips to "ready" on
    // MODEL_LOADED (or "error" on ERROR) via subscribe; in degraded
    // environments where no worker factory is registered (jsdom /
    // SSR), the manager stays "not-started" but the context holds the
    // optimistic "loading" so the user sees feedback rather than a
    // silent failure.
    setModelState("loading");
    // If the singleton is already warm (a previous mount loaded the
    // model), mirror "ready" straight away — avoids a loading flash.
    if (embeddingWorkerManager.getLoadState() === "ready") {
      setModelState("ready");
    }
    void embeddingWorkerManager.ensureStarted();
    const unsub = embeddingWorkerManager.subscribe((response) => {
      if (response.type === "MODEL_LOADED") {
        setModelState("ready");
      } else if (response.type === "ERROR") {
        setError(response.error);
        setModelState("error");
      } else if (response.type === "EMBEDDINGS_GENERATED") {
        // No-op here: the deck-effect handles embeddings via
        // requestEmbeddings' promise. The broadcast exists so tests
        // (and other subscribers) can observe the wire.
      }
    });
    return unsub;
  }, [enabled]);

  // Debounced deck update to recompute synergies once the model is
  // ready. Skipped while disabled or before the model is ready.
  useEffect(() => {
    if (!enabled) return;
    if (deck.length === 0) {
      setSynergyData(new Map());
      setTopSuggestions([]);
      return;
    }
    const mySeq = ++requestSeqRef.current;
    const timer = setTimeout(async () => {
      setIsCalculating(true);
      setError(null);
      try {
        if (embeddingWorkerManager.getLoadState() !== "ready") {
          await embeddingWorkerManager.ensureStarted();
        }
        if (mySeq !== requestSeqRef.current) return; // stale

        const embeddings = await embeddingWorkerManager.requestEmbeddings(
          deck.map(({ count, ...card }) => card),
        );
        if (mySeq !== requestSeqRef.current) return;

        if (embeddings.length === 0) {
          setIsCalculating(false);
          return;
        }

        // 1. Composite deck vector (mean of all card embeddings).
        const vectorDim = embeddings[0].embedding.length;
        const deckVector = new Array(vectorDim).fill(0);
        for (const emb of embeddings) {
          for (let i = 0; i < vectorDim; i++) {
            deckVector[i] += emb.embedding[i];
          }
        }
        for (let i = 0; i < vectorDim; i++) {
          deckVector[i] /= embeddings.length;
        }

        // 2. Dynamic import the vector-index stack on first use so the
        //    deck-builder route's initial chunk does NOT include it.
        const { oramaManager } = await import("@/lib/search/orama-manager");
        if (mySeq !== requestSeqRef.current) return;

        const searchResults = await oramaManager.searchByVector(deckVector, 40);
        if (mySeq !== requestSeqRef.current) return;

        // 3. Process results: map scores and fetch full card data.
        const deckCardIds = new Set(deck.map((c) => c.id));
        const newSynergyData = new Map<string, SynergyResult>();
        const suggestionIds: string[] = [];

        searchResults.hits.forEach((hit) => {
          const cardId = hit.id;
          const score = hit.score;

          let confidence: "high" | "medium" | "low" = "low";
          if (score > 0.8) confidence = "high";
          else if (score > 0.6) confidence = "medium";

          newSynergyData.set(cardId, { score: score * 100, confidence });

          if (!deckCardIds.has(cardId) && suggestionIds.length < 20) {
            suggestionIds.push(cardId);
          }
        });

        const fullSuggestions = await Promise.all(
          suggestionIds.map((id) => getCardById(id)),
        );
        if (mySeq !== requestSeqRef.current) return;

        setSynergyData(newSynergyData);
        setTopSuggestions(fullSuggestions.filter(Boolean) as ScryfallCard[]);
        setIsCalculating(false);
      } catch (err) {
        if (mySeq !== requestSeqRef.current) return;
        console.error("Synergy calculation error:", err);
        setError(err instanceof Error ? err.message : String(err));
        setIsCalculating(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [deck, enabled]);

  const value = useMemo(
    () => ({
      synergyData,
      topSuggestions,
      isCalculating,
      error,
      modelState,
      enableSynergy,
    }),
    [
      synergyData,
      topSuggestions,
      isCalculating,
      error,
      modelState,
      enableSynergy,
    ],
  );

  return (
    <SynergyContext.Provider value={value}>{children}</SynergyContext.Provider>
  );
}

/**
 * Hook to consume synergy data from the SynergyProvider.
 */
export function useSynergy() {
  const context = useContext(SynergyContext);
  if (context === undefined) {
    throw new Error("useSynergy must be used within a SynergyProvider");
  }
  return context;
}
