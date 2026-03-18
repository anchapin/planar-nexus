# Phase 9 Research: Adaptive Coaching & Player History

## Objective
Implement a personalized AI coaching system that tracks player performance over time, provides semantic search over game history, and suggests difficulty adjustments based on improvement.

## 1. Semantic History Retrieval (REQ-12.1)

### Current State
- `GameRecord` in `src/lib/game-history.ts` is basic (date, result, deck, turns).
- `playerHistoryTool` in `src/ai/tools/player-history-client.ts` retrieves recent games for the AI.
- `OramaManager` exists for card search but not for game history.
- `Transformers.js` is integrated for card embeddings.

### Proposed Changes
- **Extend `GameRecord`**: Add `actions: GameAction[]` and `summary: string`.
- **Game Summarization**: Create a heuristic summarizer that converts `GameAction[]` into a concise text summary (e.g., "Win on turn 15 using Aggro vs Control. Used Bolt to clear blockers. Final life: 2").
- **History Vectorization**: Use `Transformers.js` (`all-MiniLM-L6-v2`) to vectorize game summaries on game end.
- **Orama Index**: Create a `game_history` index in `OramaManager` to store these summaries and vectors.
- **AI Tool**: Update `playerHistoryTool` to support `searchRecentGames(query: string)` using Orama's hybrid search.

## 2. Personalized Coach Reports (REQ-12.2)

### Mistake Detection
- Use `evaluateGameState` from `src/ai/game-state-evaluator.ts` with `expert` weights.
- Before and after each player action, calculate the state score.
- If the score drops significantly (e.g., > 2.0 points), flag it as a "Mistake".
- Store these mistakes in the `GameRecord`.

### Coach Report Logic
- Create a new service `CoachReportService` that analyzes the last N `GameRecord`s.
- Identify recurring mistake types (e.g., "Frequent over-extension", "Poor mana efficiency").
- Aggregate win rates by archetype and difficulty.

### UI
- Create `/coach-report` page with:
    - Performance charts (win rate over time).
    - "Top Mistakes" list with AI-generated advice.
    - "Historical Comparisons": "This game reminds me of your victory against the Hard AI last week..."

## 3. Adaptive Difficulty

### Strategy
- Track "Performance Score" (recent win/loss streak + ELO-like adjustment).
- If win rate at current difficulty > 75% over last 5 games, suggest increasing difficulty.
- If win rate < 25%, suggest decreasing.
- Store `suggestedDifficulty` in `PlayerStats`.

## Risks & Considerations
- **Storage Limit**: `GameAction[]` can be large. Use IndexedDB via `src/lib/indexeddb-storage.ts` instead of `localStorage` for history.
- **Performance**: Vectorizing every game might add a slight delay at the end of the game. Run it in a web worker.
- **Token Limits**: Game summaries must be < 512 tokens for `all-MiniLM-L6-v2`.

## Verification Plan
- Unit tests for `GameSummarizer`.
- E2E test for "Coach Report" generation.
- Mock game history to verify difficulty suggestion logic.
