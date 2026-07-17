# Stub / Placeholder Inventory

> Tracked by [Issue #1009](https://github.com/anchapin/planar-nexus/issues/1009)
> (initial creation) and audited by [Issue #1435](https://github.com/anchapin/planar-nexus/issues/1435)
> (post-closure drift cleanup, 2026-07-11).
>
> This document lists every non-functional stub and placeholder surface in the
> codebase, its current behaviour, and what a real implementation requires.
> When a stub is promoted to a working implementation, update its status here
> (or remove the entry and delete the stub) and add a `## Removed / promoted
stubs` row below.

## How stubs present to users

End users should **never** see a raw error or the word "unavailable" when a
backing service is missing. Stub UI surfaces render the shared
[`PlaceholderComponent`](src/components/ui/placeholder.tsx) ("Feature Coming
Soon" panel) and degrade gracefully. A dev-only
[`StubDebugBanner`](src/components/ui/placeholder.tsx) makes stub status
obvious during development and QA without leaking internals to production.

Debug diagnostics are gated by `isDebugStubMode()`:

- `NODE_ENV === 'production'` → always off (production users never see them).
- Otherwise on by default; set `NEXT_PUBLIC_DEBUG_STUBS=false` to silence.

## Active stubs

| Stub ID                   | File                                     | Layer   | Status                    | Verified   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ---------------------------------------- | ------- | ------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-coach-conversational` | `src/components/ai-coach/chat-panel.tsx` | UI      | Stub UI (degradation)     | 2026-07-11 | `AICoachChatPanel` is not imported anywhere in `src/` outside its own definition (orphaned legacy surface from #1009). The panel mounted on `/deck-coach` is `DeckCoachChatPanel` (re-exported from `src/components/chat/index.ts`). The legacy stub-degradation branch (`status === 'error'` → `PlaceholderComponent` + `StubDebugBanner`) is preserved so any future consumer of `AICoachChatPanel` still renders the agreed-upon placeholder. The "To finish" note from #1009 is obsolete: the conversational coach is now backed by the multi-provider LLM factory (issue #1071) and `/api/chat/coach` streams real responses. |
| `genkit-coach-flow`       | `src/ai/flows/genkit-coach-flow.ts`      | Backend | Implemented (issue #1071) | 2026-07-11 | `coachFlow.stream()` now delegates to `streamCoachResponse` (multi-provider LLM factory). The canned `COACH_FLOW_FALLBACK_TEXT` is emitted **only** when no provider is configured; the structured-analysis prompt builder (`buildCoachPromptFromInput`) is preserved for prompt-injection guardrails (#1107). The previous "coming soon" stub behaviour was removed; the `.stream()` interface is preserved for back-compat with `coach-api-route`.                                                                                                                                                                               |
| `coach-api-route`         | `src/app/api/chat/coach/route.ts`        | API     | Implemented (issue #1077) | 2026-07-11 | Streaming POST handler now backed by `streamCoachResponse` + `eventToSse` (multi-provider LLM factory). Performs transparent provider failover, cooperative cancellation, prompt-injection sanitization (`sanitizeUserInput`), and intent classification (`classifyCoachIntent`). No raw "unavailable" text reaches the client — the only fallback is the local-first `COACH_FLOW_FALLBACK_TEXT` emitted when no provider is configured.                                                                                                                                                                                           |
| `search-worker-client`    | `src/lib/search/search-worker-client.ts` | Backend | Implemented (issue #1389) | 2026-07-11 | Real Orama Web Worker ships via `search.worker.ts`; client lazy-spawns the worker and falls back to main-thread `cardSearchIndex` when unavailable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Detail

### 1. `ai-coach-conversational` — `src/components/ai-coach/chat-panel.tsx`

- **What it is:** `AICoachChatPanel`, a conversational chat surface backed by
  `useGameChat` (default `/api/chat` endpoint, AI SDK v6). When the AI backend
  is unreachable (`status === 'error'`), it renders `PlaceholderComponent` with
  a dismiss action and a `StubDebugBanner`.
- **Current state:** `AICoachChatPanel` is **not imported anywhere in `src/`**
  outside its own definition (verified via `grep -rn 'AICoachChatPanel' src/`
  on 2026-07-11 — only the declaration site matches). The conversational
  coach panel actually mounted on `/deck-coach` is `DeckCoachChatPanel` from
  [`src/components/chat/chat-panel.tsx`](src/components/chat/chat-panel.tsx)
  (re-exported from [`src/components/chat/index.ts`](src/components/chat/index.ts)
  and imported by
  [`src/app/(app)/deck-coach/page.tsx`](<src/app/(app)/deck-coach/page.tsx:52>)).
  The in-game chat used by `/game-board` is an unrelated component,
  `GameChat` from
  [`src/components/game-chat.tsx`](src/components/game-chat.tsx), which has
  no stub-degradation branch. So `AICoachChatPanel` is effectively orphaned
  legacy code from Issue #1009 that still ships the friendly degradation
  branch; it is kept in place so any external consumer that imports it
  (e.g. a future `/deck-coach` regression) still gets the agreed-upon
  placeholder surface. Verified 2026-07-11.
- **To finish:** None at the runtime layer — the conversational coach is
  real as of v1.7 (Phases 27-30, shipped 2026-03-20 per
  `.planning/ROADMAP.md:92-99`). The remaining degradation branch is
  intentional and will only be removed when the LLM provider is guaranteed
  at runtime. A separate, follow-up task could delete this orphaned
  component entirely once a broader audit confirms no external consumer
  depends on the `AICoachChatPanel` symbol (out of scope for #1435).

### 2. `genkit-coach-flow` — `src/ai/flows/genkit-coach-flow.ts`

- **What it is:** Conversational coach flow with a preserved
  `.stream()` interface for back-compat.
- **Current state:** **Implemented.** The flow now delegates to
  `streamCoachResponse` (issue #1077) from
  `src/ai/flows/coach-stream.ts`, which uses the multi-provider LLM factory
  with transparent failover, cooperative cancellation, and prompt-injection
  guardrails. The canned "coming soon" stub message was retired; the only
  remaining fallback (`COACH_FLOW_FALLBACK_TEXT`) is emitted when no
  provider is configured, so the coach always answers instead of crashing.
  Verified 2026-07-11.
- **To finish:** None at the flow layer — the `.stream()` interface is
  preserved so the SSE route and any future test surface keep working.

### 3. `coach-api-route` — `src/app/api/chat/coach/route.ts`

- **What it is:** Streaming POST handler for `/api/chat/coach` that emits
  Server-Sent Events.
- **Current state:** **Implemented.** Validates input, prefetches context
  (`prefetchCoachContext`, issue #928), classifies intent
  (`classifyCoachIntent`, issue #1387), sanitizes user input, and streams
  responses via the multi-provider LLM factory with failover and
  cancellation. No raw "unavailable" text reaches the client. Verified
  2026-07-11.
- **To finish:** None at the route layer.

### 4. `search-worker-client` — `src/lib/search/search-worker-client.ts`

- **What it is:** Client for an Orama-powered Web Worker doing background card
  search.
- **Current state:** **Implemented** (issue #1389). The real worker lives in
  `src/lib/search/search.worker.ts` (Comlink-exposed Orama index with
  `init` / `index` / `search` / `clear` / `count`). The client lazy-spawns the
  worker via `import.meta.url`, exposes `getStatus()` returning
  `"ready" | "initializing" | "fallback" | "error"`, and falls back to the
  main-thread `cardSearchIndex.search()` when the worker is unavailable
  (jsdom, SSR, CSP-blocked). `searchCardsOffline` routes through the worker
  when ready; `useSearchWorker` hook + `card-search.tsx` call site wired.

## Removed / promoted stubs

| Date       | Stub ID                                      | Original file                            | Disposition                                                                                                                                                                                                                                                                    |
| ---------- | -------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-11 | `genkit-ai`                                  | `src/ai/genkit.ts`                       | **File deleted.** The Genkit Google AI plugin surface (`ai: GenkitAI \| null` + no-op `googleAiPlugin`) was removed when the Genkit dependency was purged (#446 / #1139 / #1142). Consumers now use the multi-provider LLM factory directly via `src/ai/providers/factory.ts`. |
| 2026-07-11 | `genkit-coach-flow` (stub)                   | `src/ai/flows/genkit-coach-flow.ts`      | **Promoted to real implementation.** Now delegates to `streamCoachResponse` (issue #1071). See Detail §2.                                                                                                                                                                      |
| 2026-07-11 | `coach-api-route` (stub)                     | `src/app/api/chat/coach/route.ts`        | **Promoted to real implementation.** Now backed by `streamCoachResponse` + `eventToSse` (issue #1077). See Detail §3.                                                                                                                                                          |
| 2026-03-20 | `ai-coach-conversational` ("To finish" note) | `src/components/ai-coach/chat-panel.tsx` | **Mounted on `/deck-coach`.** Conversational AI Coach shipped in v1.7 (Phases 27-30). The mounted panel is `DeckCoachChatPanel` (`src/components/chat/chat-panel.tsx`). See Detail §1.                                                                                         |
| 2024-XX-XX | `search-worker-client` (stub)                | `src/lib/search/search-worker-client.ts` | **Promoted to real implementation.** Real Orama Web Worker ships via `src/lib/search/search.worker.ts` (issue #1389). See Detail §4.                                                                                                                                           |

## Decision: stubs remain in place (not moved to `src/stubs/`)

Issue #1009 proposed moving stubs to `src/stubs/`. This was **not** done because
the stubs are tightly coupled to real type contracts and import sites (e.g. the
coach route imports `coachFlow`; `use-search-worker.ts` imports
`searchWorkerClient`). Relocating them would require updating every consumer
and risks churn across the build for no behavioural gain. Keeping them in place
with clear `@fileOverview` stub headers + this inventory achieves the same
discoverability with far less risk.

## Promoting a stub

1. Implement the real behaviour.
2. Remove the `Stub` / `@fileOverview` stub header note.
3. Move the entry from the `Active stubs` table to the `Removed / promoted
stubs` table with the promotion date and a one-line redirect (see the
   "How to add a new stub" section below for the row contract).
4. If the stub had a `PlaceholderComponent` / `StubDebugBanner` UI, remove that
   degradation branch once the feature is fully wired and verified.
5. Bump the `Verified` column on every remaining row with today's date so the
   next audit has a baseline.

## How to add a new stub

When you need to ship a non-functional or partially-implemented surface, add
a row to the **Active stubs** table at the top of this file. The contract is:

- **Stub ID** — stable kebab-case identifier. Used as the `stubId` prop on
  `PlaceholderComponent` so dev-only debug banners can attribute the surface.
- **File** — absolute path from the repo root. The CI inventory check
  (`.github/workflows/stubs-inventory.yml`) verifies this path exists in the
  source tree at HEAD; a missing file fails the build.
- **Layer** — one of `UI`, `Backend`, `API`, `Hook`, `Worker`.
- **Status** — `Stub`, `Stub UI`, `Stub UI (degradation)`, or `Implemented`.
  Anything that is `Implemented` should be moved to the `Removed / promoted
stubs` table.
- **Verified** — `YYYY-MM-DD` of the last audit. The CI inventory check
  warns (does not fail) if every row does not share the same date.
- **Notes** — one sentence describing the current behaviour. Keep it terse;
  move deeper reasoning to the Detail block below.

After adding the row, add a Detail block (`### N. <stub-id> — <file>`) with
"What it is", "Current state", and (if applicable) "To finish" sub-sections,
following the pattern of the existing entries.

The CI job `.github/workflows/stubs-inventory.yml` enforces this contract:

1. Every `File` column in `Active stubs` resolves to a path under `src/` at
   HEAD. Missing paths fail the build.
2. Any file under `src/` matching `*stub*` or `*placeholder*` that is **not**
   referenced by `STUBS.md` is reported as an untracked stub and fails the
   build.
3. Any source file (excluding `__tests__/`) that calls
   `PlaceholderComponent` or `StubDebugBanner` without an `Active stubs` row
   in `STUBS.md` fails the build. This catches regressions where someone
   adds a new stub surface but forgets to register it.
4. The `Verified` column on every row is checked: a row whose date is older
   than 30 days produces a warning (not a failure) so audits are not
   silently skipped.

Run the check locally with:

```bash
node scripts/stubs-inventory.js
```
