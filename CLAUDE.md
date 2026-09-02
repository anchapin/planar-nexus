# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Planar Nexus is a digital Magic: The Gathering tabletop experience built with Next.js, featuring deck building, AI coaching, and multiplayer functionality. The app integrates with the Scryfall API for card data and uses a multi-provider AI layer (OpenAI, Anthropic, and Google via the Vercel AI SDK) for deck analysis and opponent generation.

## Development Commands

```bash
# Install dependencies
npm install

# Development server (runs on port 9002 with Turbopack)
npm run dev

# AI simulation suite (src/ai/__tests__/simulation/)
npm run simulate

# Build for production
NODE_ENV=production npm run build

# Start production server
npm start

# Lint code
npm run lint

# Type check
npm run typecheck
```

## Architecture

### Next.js App Router Structure

The app uses Next.js 16 (with React 19) and the App Router pattern:

- `/src/app/(app)/` - Protected application routes with a shared layout
  - `dashboard/` - Main dashboard with feature cards
  - `deck-builder/` - Card search and deck management interface
  - `deck-coach/` - AI-powered deck review system
  - `single-player/` - Solo game mode
  - `multiplayer/` - Multiplayer game interface

### AI Client Wrappers

`/src/lib/ai-client.ts` holds the client-side wrappers around the AI flows (no `"use server"` directive — they are not Next.js server actions). It handles:

- AI deck reviews and opponent generation
- Card/deck data types live elsewhere: `ScryfallCard`/`DeckCard`/`SavedDeck` are canonical in `/src/lib/card-database.ts`
- Deck persistence (IndexedDB via Dexie; tests use `fake-indexeddb`) lives in `/src/lib/deck-storage.ts`

(Renamed from the misnamed `src/app/actions.ts` in issue #1592.) These wrappers are called directly from client components.

### AI Integration (Multi-Provider)

AI functionality is multi-provider via the Vercel AI SDK (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/react`):

- Unified proxy route: `/src/app/api/ai-proxy/` — all provider calls go through this server-side route so API keys are never exposed to the client
- Provider factory: `/src/ai/providers/` — selects the active provider/model from env config (defaults per provider in `factory.ts`)
- Flows: `/src/ai/flows/` — AI operations, in three families:
  - Conversational coach (v1.7) — streaming SSE coach served by `POST /api/chat/coach` (deck-grounded coaching) and `POST /api/chat` (hardened general chat, #1534); both routes share the same stream layer:
    - `coach-stream.ts` - Streaming orchestration (async generator over Vercel AI SDK `streamText`) adding transparent provider failover with cooldown backoff (#1077, #1418), cooperative cancellation, and structured stream events
    - `coach-context-prefetch.ts` - Parallel, cached pre-fetch of coach context (archetype, deck stats, synergies, gaps) instead of serial per-request rebuilds (#928)
    - `coach-deck-analysis.ts` - Structured deck analysis (archetype, synergy clusters, mana curve, role distribution, key cards, strengths/gaps) the coach prompt reasons about (#923)
    - `coach-evidence-ledger.ts` - Deterministic grounding layer for non-card claims (curve, role mix, win conditions, matchup profile, synergy gaps) (#1419)
    - `coach-grounding-guard.ts` - Post-generation guard on the completed assistant message before it is persisted — regex/numeric checks against the evidence ledger, never an LLM call (#1419)
    - `coach-memory-summary.ts` - Durable summary of pruned conversation history, preserving user goals, constraints, and prior card decisions across turns (#1417)
    - `context-builder.ts` - Converts deck data and metadata into LLM-friendly formats; owns the coach system prompt and token-aware conversation-history preparation
    - `genkit-coach-flow.ts` - Conversational coach flow facade that delegates to `streamCoachResponse` (Genkit dependency removed in #446)
  - Local-first / heuristic (no LLM call, works offline): `ai-deck-coach-review.ts` (rule-based deck reviews), `ai-opponent-deck-generation.ts` (heuristic opponent decks), `ai-draft-assistant.ts` (draft & sealed assistant), `ai-gameplay-assistance.ts` (real-time play assistance), `ai-post-game-analysis.ts` (post-game + cross-game replay diffing), `sideboard-plan.ts` (per-matchup boarding plans), `compare-decks.ts` (multi-deck comparison & meta-positioning), `verify-citations.ts` (local card-citation verifier, #1072)
  - LLM-routed with local-first fallback: `ai-meta-analysis.ts` (#1073)

Conversational-coach request composition (`/src/app/api/chat/coach/route.ts`): prefetch context (cached, parallel) → validate inbound memory summary → build evidence ledger → assemble system prompt + token-pruned history with summary, under prompt-injection guardrails (#1107: `SECURITY_PREAMBLE`, `sanitizeUserInput`, system prompt always built server-side) → `streamCoachResponse` (provider failover + cooldown backoff) → grounding guard on the completed message → emit the updated summary as a `summary` SSE event. The wire contract is documented in `docs/API.md` §2.5 (POST /api/chat/coach).

AI flows use:

- Zod schemas for input validation and structured output
- Retry logic for handling AI errors
- Client-side wrappers in `src/lib/ai-client.ts` for invocation

Provider keys are optional — deck coaching has a heuristic fallback that needs no API key. Configure providers in `.env` (`OPENAI_* / ANTHROPIC_* / GOOGLE_* / ZAI_*`); see `docs/API.md` for details.

### UI Components

The app uses Shadcn/ui (Radix UI primitives) with Tailwind CSS:

- Components in `/src/components/ui/` are auto-generated from Shadcn
- Use `npx shadcn@latest add <component>` to add new components
- Custom components include `app-sidebar.tsx` for navigation

### TypeScript Path Aliases

Configured in `tsconfig.json`:

- `@/` maps to `/src/`
- Use these imports consistently: `@/lib/ai-client`, `@/lib/card-database`, `@/ai/flows/...`

### Key Data Types

Important types defined in `/src/lib/card-database.ts`:

- `ScryfallCard` - Card data from Scryfall API
- `DeckCard` - Card with quantity for decklists
- `SavedDeck` - Persisted deck structure

When adding card-related functionality, ensure types align with Scryfall's API response structure.

## Game Rules

Magic: The Gathering rules are defined in `/src/lib/game-rules.ts`. This includes format definitions, deck construction rules, and legality checks. When modifying game behavior, update this file accordingly.

Note: The MTG rules engine is a large, live module at `/src/lib/game-state/` (layer-system, trigger-system, state-based-actions, spell-casting, combat, mana, …). It is the correctness-critical core and the only place mutation testing runs. `game-rules.ts` imports its `GameState` type from there.

## AI Development

AI flows live in `/src/ai/flows/` — see the flow-family inventory under [AI Integration](#ai-integration-multi-provider): the v1.7 conversational coach family (streaming SSE; wire contract in `docs/API.md` §2.5) and the local-first heuristic family (deck-coach review, opponent generation, draft assistant, gameplay assistance, post-game analysis, sideboard plans, deck comparison, citation verification), plus the LLM-routed meta-analysis — backed by the multi-provider Vercel AI SDK and the unified proxy at `/src/app/api/ai-proxy/`:

- Run `npm run simulate` to execute the AI simulation suite (`src/ai/__tests__/simulation/`)
- Each flow has co-located tests under `/src/ai/flows/__tests__/`
- Provider keys are optional — deck coaching falls back to a heuristic that needs no API key

## Deployment

The project is configured for Firebase App Hosting via `apphosting.yaml`. No additional build configuration is required beyond the standard Next.js build process.

## Common Patterns

### Class Name Merging

Use the `cn()` utility function from `@/lib/utils` to merge Tailwind CSS classes. This is the standard pattern from Shadcn/ui:

```ts
import { cn } from "@/lib/utils";
const className = cn("base-class", conditional && "conditional-class");
```

### Dark Mode

The app uses dark mode by default (see `src/app/layout.tsx`). Avoid adding dark mode toggles unless explicitly requested.

### Dependency Patches

The project uses `patch-package` for applying fixes to dependencies. Patches are stored in `patches/` directory.
