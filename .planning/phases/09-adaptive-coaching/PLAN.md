# Phase 9: Adaptive Coaching & Player History - Execution Plan

## Goal
Implement a personalized AI coaching system that tracks player performance over time, provides semantic search over game history, and suggests difficulty adjustments based on improvement.

## Wave 1: Infrastructure & Storage (REQ-12.1)

### 09-01: Game History & IndexedDB Migration
- **Status**: Not Started
- **Objective**: Upgrade the game history infrastructure to handle larger datasets (actions, mistakes) and migrate to IndexedDB.
- **Tasks**:
    1. **Update Types**: Modify `GameRecord` in `src/lib/game-history.ts` to include `actions: GameAction[]`, `mistakes: string[]`, and `summary: string`.
    2. **IndexedDB Update**: Add `game-history` store to `StorageConfig` in `src/lib/indexeddb-storage.ts`.
    3. **Migration Logic**: Implement `migrateGameHistoryToIndexedDB` in `src/lib/indexeddb-storage.ts` to move existing records from `localStorage` to IndexedDB.
    4. **Heuristic Summarizer**: Create `src/lib/game-summarizer.ts` with logic to convert `GameAction[]` into a text summary (e.g., "Win in 12 turns using Aggro vs Control. Used Bolt to clear blockers.").
- **Validation**:
    - Unit tests for `migrateGameHistoryToIndexedDB` verifying data integrity.
    - Unit tests for `GameSummarizer` with mock action sequences.

### 09-02: Gameplay Integration & Persistence
- **Status**: Not Started
- **Objective**: Collect actions and detect mistakes during gameplay.
- **Tasks**:
    1. **Action Tracking**: Update `src/app/(app)/game-board/page.tsx` to collect `GameAction[]` during the game.
    2. **Mistake Detection**: Integrate `evaluateGameState` from `src/ai/game-state-evaluator.ts` to detect significant score drops after player actions.
    3. **Save Enhanced Record**: Update `trackGameResult` to save the extended `GameRecord` to IndexedDB on game end.
- **Validation**:
    - Play a test game and verify the `GameRecord` in IndexedDB contains actions and detected mistakes.

## Wave 2: Semantic Search & AI Coach Tools (REQ-12.1)

### 09-03: Semantic History Search
- **Status**: Not Started
- **Objective**: Enable AI to search and retrieve past game situations.
- **Tasks**:
    1. **Orama Index**: Add `game_history` index to `OramaManager` in `src/lib/search/orama-manager.ts`.
    2. **History Vectorization**: Create a background task to vectorize game summaries using `Transformers.js`.
    3. **AI Tool Update**: Update `playerHistoryTool` in `src/ai/tools/player-history-client.ts` to support semantic search queries using Orama's hybrid search.
- **Validation**:
    - Verify AI coach can answer "When was the last time I played against a control deck and won?" by retrieving the correct game record.

## Wave 2: Reports & Difficulty Adjustment (REQ-12.2)

### 09-04: Coach Reports & UI
- **Status**: Not Started
- **Objective**: Provide personalized feedback and performance trends.
- **Tasks**:
    1. **CoachReportService**: Create a service that analyzes recurring mistakes from `GameRecord`s.
    2. **Dashboard UI**: Build `/coach-report` page displaying win/loss trends and AI-generated advice based on history.
    3. **Adaptive Difficulty**: Implement logic to suggest difficulty changes based on recent performance.
- **Validation**:
    - Verify "Coach Report" displays accurate summaries and difficulty suggestions.

## Success Criteria
1. User can view a "Coach Report" that summarizes their win/loss trends and common mistakes.
2. The AI coach references specific past games or similar situations when giving advice.
3. Opponent difficulty automatically suggests adjustments based on the player's recent performance.
