# Phase 8 Research: AI Deck Assistant UX

## Proactive Card Suggestions
To implement real-time card suggestions, we will:
1.  **Monitor Deck Changes:** Hook into the `deck` state in `DeckBuilderPage`.
2.  **Generate Deck Embedding:**
    *   Instead of just averaging, we can use the most recent 3-5 cards or the "commander" (if format is commander) to find related cards.
    *   Use `EmbeddingClient.getInstance().generateEmbeddings(deckCards)` to get vectors.
    *   Average the vectors to get a "deck vector".
3.  **Vector Search via Orama:**
    *   Use `oramaManager.search({ vector: deckVector, mode: 'vector', limit: 10 })`.
    *   Exclude cards already in the deck.
4.  **Real-time Updates:** Use a debounced `useEffect` to avoid excessive embedding generation during rapid deck editing.

## "Why this card?" Explication
1.  **UI Component:** Add a "Why?" button to each suggested card.
2.  **API Call:** Use `/api/chat` with a specific prompt:
    *   "Explain the synergy between [Card Name] and the current deck: [Deck List]. Keep it brief (1-2 sentences)."
3.  **Streaming:** Use `useChat` from Vercel AI SDK or a custom `fetch` with SSE to display the explanation as it's generated.

## Visual Highlighting in Card Browser
1.  **State Management:** Maintain a `Set<string>` of synergistic card IDs in `DeckBuilderPage`.
2.  **Prop Drilling:** Pass `synergisticCardIds` to `CardSearch`.
3.  **Rendering:** In `CardSearch`, if a card's ID is in the set, apply a visual treatment (e.g., a glowing border or a synergy badge).

## Technical Considerations
*   **Performance:** Generating embeddings is CPU-intensive. Use the `embedding-worker.ts` as implemented in Phase 7.
*   **Rate Limiting:** AI explanations should be rate-limited via the existing `AI_PROXY`.
*   **Offline Mode:** If the user is offline, we can still show suggested cards (via Orama), but "Why this card?" will require a local LLM or a fallback message. Phase 10 might address local LLM more deeply.
