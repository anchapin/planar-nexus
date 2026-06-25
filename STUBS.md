# Stub / Placeholder Inventory

> Tracked by [Issue #1009](https://github.com/anchapin/planar-nexus/issues/1009).
>
> This document lists every non-functional stub and placeholder surface in the
> codebase, its current behaviour, and what a real implementation requires.
> When a stub is promoted to a working implementation, update its status here
> (or remove the entry and delete the stub).

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

| Stub ID                          | File                                             | Layer   | Status         | Notes                                                                                                       |
| -------------------------------- | ------------------------------------------------ | ------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| `ai-coach-conversational`        | `src/components/ai-coach/chat-panel.tsx`         | UI      | Stub UI        | Renders `PlaceholderComponent` on backend failure; `StubDebugBanner` in debug mode. Not yet wired to a page. |
| `genkit-ai`                      | `src/ai/genkit.ts`                               | Backend | Stub           | `ai` is `null`; `googleAiPlugin` is a no-op configure. Genkit dependency removed in #446.                   |
| `genkit-coach-flow`              | `src/ai/flows/genkit-coach-flow.ts`              | Backend | Stub           | `coachFlow.stream()` yields a friendly "coming soon" message. Structured-analysis prompt is still built for forward-compat/tests. |
| `coach-api-route`                | `src/app/api/chat/coach/route.ts`                | API     | Stub           | Validates input + builds structured analysis, then streams the stub flow message. Will work as-is once Genkit is restored. |
| `search-worker-client`           | `src/lib/search/search-worker-client.ts`         | Backend | Stub           | Orama-powered background search not implemented. Returns empty results (no-op `indexCards`/`search`/`clear`). |

## Detail

### 1. `ai-coach-conversational` — `src/components/ai-coach/chat-panel.tsx`

- **What it is:** `AICoachChatPanel`, a conversational chat surface backed by
  `useGameChat` (default `/api/chat` endpoint, AI SDK v6).
- **Current state:** Not yet mounted on any route. When the AI backend is
  unreachable (`status === 'error'`), it renders `PlaceholderComponent` with a
  dismiss action and a `StubDebugBanner`. Functional chat path is preserved for
  when a provider is configured.
- **To finish:** Mount on a coach page, wire a configured provider, and remove
  the degradation branch.

### 2. `genkit-ai` — `src/ai/genkit.ts`

- **What it is:** Type surface + null `ai` instance for the Genkit Google AI
  plugin.
- **Current state:** `export const ai: GenkitAI | null = null`. Importers must
  null-check before use.
- **To finish:** Re-add the `genkit` + `@genkit-ai/googleai` dependencies
  (removed in #446), instantiate `ai`, and replace the stub exports. No import
  sites need to change as long as the typed exports stay compatible.

### 3. `genkit-coach-flow` — `src/ai/flows/genkit-coach-flow.ts`

- **What it is:** Stub of the Genkit conversational coach flow.
- **Current state:** `coachFlow.stream()` yields a single friendly "coming
  soon" chunk. `buildCoachPromptFromInput()` is still exercised so the
  structured-analysis → prompt path (issue #923) stays covered by tests and
  ready for Genkit.
- **To finish:** Replace `generateComingSoonResponse` with a real Genkit
  `defineStreamingFlow` call that streams `buildCoachPromptFromInput(input)`
  to the model.

### 4. `coach-api-route` — `src/app/api/chat/coach/route.ts`

- **What it is:** Streaming POST handler for `/api/chat/coach`.
- **Current state:** Fully validates input and builds structured deck analysis;
  only the final generation is stubbed via `coachFlow`. No raw "unavailable"
  text reaches the client.
- **To finish:** None at the route layer — it forwards to `coachFlow`, so it
  becomes real automatically once the flow is implemented.

### 5. `search-worker-client` — `src/lib/search/search-worker-client.ts`

- **What it is:** Client for an Orama-powered Web Worker doing background card
  search.
- **Current state:** All methods are no-ops returning empty results. Satisfies
  type-checking for `use-search-worker.ts`.
- **To finish:** Implement the Orama index + worker, then replace the no-op
  methods. No consumer changes required while the empty-result contract holds.

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
3. Update or delete the entry in this table.
4. If the stub had a `PlaceholderComponent` / `StubDebugBanner` UI, remove that
   degradation branch once the feature is fully wired and verified.
