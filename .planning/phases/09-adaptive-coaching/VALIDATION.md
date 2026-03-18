# Phase 9 Validation: Adaptive Coaching & Player History

## Automated Testing Strategy

### Unit Tests
- `src/lib/__tests__/indexeddb-migration-game-history.test.ts`: Verifies migration from `localStorage` to IndexedDB and ensures no data is lost.
- `src/lib/__tests__/game-summarizer.test.ts`: Verifies that different sequences of `GameAction`s result in readable and accurate summaries.
- `src/lib/__tests__/coach-report.test.ts`: Verifies that the `CoachReportService` correctly aggregates mistakes and calculates statistics.
- `src/lib/__tests__/adaptive-difficulty.test.ts`: Verifies that difficulty suggestions are correct based on mock win/loss history.
- `src/lib/search/__tests__/orama-history.test.ts`: Verifies that games can be indexed and retrieved semantically.
- `src/ai/tools/__tests__/player-history-client-semantic.test.ts`: Verifies that the `playerHistoryTool` correctly interfaces with the Orama index.

### Integration Tests
- `src/app/(app)/game-board/__tests__/action-tracking.test.tsx`: Verifies that the `GameBoard` correctly captures actions and detects mistakes during a simulated game.

### E2E Tests
- `e2e/game-history-persistence.spec.ts`: Plays a full game against AI, completes it, and verifies that the `GameRecord` appears in IndexedDB with actions and summary.
- `e2e/coach-report.spec.ts`: Verifies that the `/coach-report` page renders correctly and displays history from the database.

## Manual Verification
- Verify that AI coach in chat can successfully answer questions about past games.
- Verify that difficulty suggestions appear in the UI after a streak of wins/losses.
