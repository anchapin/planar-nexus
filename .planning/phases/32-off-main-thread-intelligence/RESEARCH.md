# Phase 32: Off-Main-Thread Intelligence - Research

**Researched:** 2026-03-20
**Domain:** Web Workers, Heuristic AI, Performance Optimization
**Confidence:** HIGH

## Summary

Phase 32 focuses on offloading the AI's heuristic engine and complex deck analysis from the main thread to Web Workers. Currently, real-time gameplay assistance (calculating optimal blocks, mana usage, and board evaluation) runs on the main thread, which can cause significant frame drops (jank) during complex game states. By moving these calculations to a dedicated background thread, we can maintain 60 FPS while providing deeper strategic analysis.

**Primary recommendation:** Follow the "Search Worker" pattern established in Phase 31, creating an `AIWorker` that encapsulates the `GameStateEvaluator` and `ai-gameplay-assistance.ts` logic.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Web Worker API | Native | Background execution | Browser standard for off-main-thread work |
| Comlink | 4.4.1 (Rec) | RPC for Workers | Simplifies complex object/function proxying between threads |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|--------------|
| Genkit | 1.30.1 | High-level AI flows | Use for complex strategy guides that require LLM input |
| Zod | 3.24.2 | Schema validation | Validating messages passed to/from worker |

## Architecture Patterns

### Recommended Project Structure
```
src/
├── ai/
│   ├── worker/
│   │   ├── ai-worker.ts       # Worker entry point
│   │   ├── worker-types.ts    # Message/Payload definitions
│   │   └── ai-worker-client.ts # Main-thread bridge
│   ├── game-state-evaluator.ts # Pure logic (movable to worker)
│   └── ai-gameplay-assistance.ts # Heuristic interface
```

### Pattern 1: AI Worker Interface
The worker should expose a "thinking" state that the UI can subscribe to. This allows the UI to show non-blocking indicators (e.g., a "Thinking..." pulse on the AI coach avatar) while calculations are in progress.

### Anti-Patterns to Avoid
- **Frequent State Sync:** Sending the entire `GameState` on every small change. Instead, send deltas or only trigger analysis on significant phase changes/priority shifts.
- **Circular References:** `GameState` objects often contain circular references (e.g., player referring to battlefield, permanent referring to controller). These must be serialized/cleaned before being sent to the worker via `postMessage`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Worker RPC | Custom `onMessage` listeners | Comlink | Reduces boilerplate for complex API calls to the worker |
| Serialization | Custom JSON.stringify/parse | Structured Clone Algorithm | Native browser support for many object types, faster than JSON |

## Common Pitfalls

### Pitfall 1: Serialization Overhead
**What goes wrong:** If the `GameState` is massive (e.g., Commander game with 100+ permanents), the time spent cloning the object for `postMessage` can rival the calculation time.
**How to avoid:** Pass only the "Minimal AI State" (already defined in `AIGameState`) and ensure it's a flat, transferable-friendly object.

### Pitfall 2: Stale State
**What goes wrong:** The AI finishes a long calculation but the game state has already moved on (e.g., a player cast a spell).
**How to avoid:** Each request should include a `stateVersion` or `timestamp`. The UI should discard results that don't match the current `stateVersion`.

## Code Examples

### Worker Bridge (Conceptual)
```typescript
// src/ai/worker/ai-worker.ts
import { expose } from 'comlink';
import { evaluateGameState } from '../game-state-evaluator';

const api = {
  analyze(state: GameState, playerId: string) {
    return evaluateGameState(state, playerId);
  }
};

expose(api);
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | vitest.config.ts |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command |
|--------|----------|-----------|-------------------|
| WORKER-01 | Heuristics run off-main-thread | Integration | `vitest src/ai/worker/` |
| WORKER-02 | UI remains responsive during AI "thinking" | E2E | `playwright test e2e/performance/` |
