"use client";

import React, { createContext, useContext, useEffect, useState, useMemo, useRef } from "react";
import { type DeckCard, type ScryfallCard } from "@/app/actions";
import { type WorkerMessage, type WorkerResponse } from "@/lib/ai/embedding-worker";
import { oramaManager } from "@/lib/search/orama-manager";
import { getCardById } from "@/lib/card-database";

// Synergy data structure
export interface SynergyResult {
  score: number;
  confidence: "high" | "medium" | "low";
}

interface SynergyContextValue {
  synergyData: Map<string, SynergyResult>;
  topSuggestions: ScryfallCard[];
  isCalculating: boolean;
  error: string | null;
}

const SynergyContext = createContext<SynergyContextValue | undefined>(undefined);

/**
 * SynergyProvider manages the deck's synergy state by:
 * 1. Tracking deck changes.
 * 2. Generating a composite deck vector via a Web Worker.
 * 3. Querying the Orama vector search engine for synergistic candidates.
 */
export function SynergyProvider({ 
  children, 
  deck 
}: { 
  children: React.ReactNode; 
  deck: DeckCard[]; 
}) {
  const [synergyData, setSynergyData] = useState<Map<string, SynergyResult>>(new Map());
  const [topSuggestions, setTopSuggestions] = useState<ScryfallCard[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const workerRef = useRef<Worker | null>(null);

  // Initialize worker once
  useEffect(() => {
    // In Next.js, we use the URL constructor for web workers
    const worker = new Worker(new URL("../../../../lib/ai/embedding-worker.ts", import.meta.url));
    workerRef.current = worker;
    
    worker.postMessage({ type: "LOAD_MODEL" });

    return () => {
      worker.terminate();
    };
  }, []);

  // Debounced deck update to prevent excessive computation while typing/editing
  useEffect(() => {
    if (!workerRef.current) return;
    
    if (deck.length === 0) {
      setSynergyData(new Map());
      setTopSuggestions([]);
      return;
    }

    const timer = setTimeout(() => {
      setIsCalculating(true);
      setError(null);
      
      // Request embeddings for the current deck
      // The worker will return individual embeddings which we'll average
      workerRef.current?.postMessage({
        type: "GENERATE_EMBEDDINGS",
        cards: deck.map(({ count, ...card }) => card), // Strip count for embedding logic
      } as WorkerMessage);
    }, 500);

    return () => clearTimeout(timer);
  }, [deck]);

  // Handle worker responses
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;

    const handleMessage = async (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;

      if (response.type === "EMBEDDINGS_GENERATED") {
        try {
          // 1. Calculate composite deck vector (mean of all card embeddings)
          const embeddings = response.results.map(r => r.embedding);
          if (embeddings.length === 0) {
            setIsCalculating(false);
            return;
          }
          
          const vectorDim = embeddings[0].length;
          const deckVector = new Array(vectorDim).fill(0);
          
          for (const emb of embeddings) {
            for (let i = 0; i < vectorDim; i++) {
              deckVector[i] += emb[i];
            }
          }
          
          for (let i = 0; i < vectorDim; i++) {
            deckVector[i] /= embeddings.length;
          }

          // 2. Query Orama for synergistic cards using the deck vector
          // Note: searchByVector will be implemented in OramaManager
          const searchResults = await oramaManager.search({
            vector: deckVector,
            limit: 40, // Get a surplus to account for filtering existing cards
            similarity: 0.5,
          });

          // 3. Process results: map scores and fetch full card data for suggestions
          const deckCardIds = new Set(deck.map(c => c.id));
          const newSynergyData = new Map<string, SynergyResult>();
          const suggestionIds: string[] = [];

          searchResults.hits.forEach((hit) => {
            const cardId = hit.id;
            // Orama score for vector search is usually the similarity
            const score = hit.score; 
            
            let confidence: "high" | "medium" | "low" = "low";
            if (score > 0.8) confidence = "high";
            else if (score > 0.6) confidence = "medium";

            newSynergyData.set(cardId, { score: score * 100, confidence });

            if (!deckCardIds.has(cardId) && suggestionIds.length < 20) {
              suggestionIds.push(cardId);
            }
          });

          // Fetch full card objects for suggestions
          const fullSuggestions = await Promise.all(
            suggestionIds.map(id => getCardById(id))
          );

          setSynergyData(newSynergyData);
          setTopSuggestions(fullSuggestions.filter(Boolean) as ScryfallCard[]);
          setIsCalculating(false);
        } catch (err) {
          console.error("Synergy calculation error:", err);
          setError(err instanceof Error ? err.message : "Failed to calculate synergy");
          setIsCalculating(false);
        }
      } else if (response.type === "ERROR") {
        setError(response.error);
        setIsCalculating(false);
      }
    };

    worker.addEventListener("message", handleMessage);
    return () => worker.removeEventListener("message", handleMessage);
  }, [deck]);

  const value = useMemo(() => ({
    synergyData,
    topSuggestions,
    isCalculating,
    error
  }), [synergyData, topSuggestions, isCalculating, error]);

  return (
    <SynergyContext.Provider value={value}>
      {children}
    </SynergyContext.Provider>
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
