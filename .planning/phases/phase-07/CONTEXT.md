# Phase 7: Local Intelligence Foundation - Context

## Objective
Implement a local search and embedding engine for Planar Nexus that allows for fast, offline-capable hybrid search (text + vector) and card synergy discovery.

## Requirements
- **Orama v3+**: Fast, in-memory hybrid search with vector support.
- **Transformers.js v3+**: Local embedding generation (text-to-vector) using models like `all-MiniLM-L6-v2`.
- **Dexie.js**: IndexedDB wrapper for persisting embeddings and Orama snapshots.
- **Web Workers**: Must run embedding generation in a background worker to avoid blocking the main UI thread.
- **WebGPU Support**: Prefer WebGPU for embedding generation with a WASM/CPU fallback.
- **Latency**: Search results must be returned in < 50ms.
- **CPU Usage**: Background indexing must consume < 20% average CPU.

## Constraints
- **Next.js Integration**: Must work within the Next.js client-side environment.
- **Tauri Compatibility**: The solution must be compatible with Tauri's WebView (macOS, Windows, Linux).
- **Offline-First**: Must be functional without an internet connection once models are cached.

## Key Files
- `src/lib/db/local-intelligence-db.ts`: persistence schema.
- `src/lib/ai/embedding-worker.ts`: background worker for inference.
- `src/lib/search/orama-manager.ts`: search engine logic.
- `src/lib/search/background-indexing.ts`: orchestration layer.
