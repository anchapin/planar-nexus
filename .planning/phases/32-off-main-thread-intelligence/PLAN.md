# Phase 32: Off-Main-Thread Intelligence

**Goal**: Move heuristic AI and deck analysis to Web Workers to ensure a responsive UI during complex calculations.

## Milestone: v1.8 Performance & Scale

### Status
🏗️ In Progress

### Requirements
- **WORKER-01**: Heuristic gameplay engine runs in a dedicated Web Worker
- **WORKER-02**: AI "thinking" does not block UI interactions (60fps maintained)
- **WORKER-03**: Genkit flow latency optimized via selective pre-fetching
- **WORKER-04**: Non-blocking AI status indicators implemented

---

## Execution Plan

This phase is divided into three waves of implementation:

### Wave 1: AI Worker Infrastructure
Offload heuristic gameplay calculations from the main thread to a dedicated background thread.
- **Plan**: [32-01-PLAN.md](./32-01-PLAN.md)
- **Focus**: Worker entry point, RPC bridge, and serialization optimization.
- **Status**: ⏳ Planned

### Wave 2: React Integration & UI Indicators
Connect the AI Worker to the UI layer and provide user feedback during calculations.
- **Plan**: [32-02-PLAN.md](./32-02-PLAN.md)
- **Focus**: `useAIWorker` hook, `AIThinkingIndicator` component, and Game Board integration.
- **Status**: ⏳ Planned

### Wave 3: Genkit Optimization & Pre-fetching
Reduce latency for LLM-based coaching flows through smarter context management.
- **Plan**: [32-03-PLAN.md](./32-03-PLAN.md)
- **Focus**: Selective pre-fetching of deck/board context and payload reduction.
- **Status**: ⏳ Planned

---

## Verification Strategy

### Automated Tests
- **Integration**: Verify worker communication and result accuracy via Vitest.
- **E2E**: Use Playwright to confirm 60fps responsiveness during active AI analysis.

### Success Criteria
1. No long tasks (>16ms) attributed to AI heuristics during gameplay.
2. AI "thinking" state is correctly reflected in the UI.
3. LLM response latency reduced by at least 25% via pre-fetching.

---

## Next Steps
1. Execute Wave 1: `/gsd:execute-plan 32-01`
2. Execute Wave 2: `/gsd:execute-plan 32-02`
3. Execute Wave 3: `/gsd:execute-plan 32-03`
