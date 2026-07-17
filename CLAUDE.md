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

### Server Actions

`/src/app/actions.ts` is named "actions" but is **not** a Next.js server actions file — it exports client-side wrappers around the AI flows (no `"use server"` directive). It handles:
- Scryfall API integration for card search and legality validation
- AI deck reviews and opponent generation
- Deck persistence (IndexedDB via Dexie; tests use `fake-indexeddb`)

These wrappers are called directly from client components.

### AI Integration (Multi-Provider)

AI functionality is multi-provider via the Vercel AI SDK (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/react`):
- Unified proxy route: `/src/app/api/ai-proxy/` — all provider calls go through this server-side route so API keys are never exposed to the client
- Provider factory: `/src/ai/providers/` — selects the active provider/model from env config (defaults per provider in `factory.ts`)
- Flows: `/src/ai/flows/` — AI operations
  - `ai-deck-coach-review.ts` - Analyzes decklists, generates strategic suggestions
  - `ai-opponent-deck-generation.ts` - Creates AI opponent decks

AI flows use:
- Zod schemas for input validation and structured output
- Retry logic for handling AI errors
- Client-side wrappers in `actions.ts` for invocation

Provider keys are optional — deck coaching has a heuristic fallback that needs no API key. Configure providers in `.env` (`OPENAI_* / ANTHROPIC_* / GOOGLE_* / ZAI_*`); see `docs/API.md` for details.

### UI Components

The app uses Shadcn/ui (Radix UI primitives) with Tailwind CSS:
- Components in `/src/components/ui/` are auto-generated from Shadcn
- Use `npx shadcn@latest add <component>` to add new components
- Custom components include `app-sidebar.tsx` for navigation

### TypeScript Path Aliases

Configured in `tsconfig.json`:
- `@/` maps to `/src/`
- Use these imports consistently: `@/app/actions`, `@/ai/flows/...`

### Key Data Types

Important types defined in `/src/app/actions.ts`:
- `ScryfallCard` - Card data from Scryfall API
- `DeckCard` - Card with quantity for decklists
- `SavedDeck` - Persisted deck structure

When adding card-related functionality, ensure types align with Scryfall's API response structure.

## Game Rules

Magic: The Gathering rules are defined in `/src/lib/game-rules.ts`. This includes format definitions, deck construction rules, and legality checks. When modifying game behavior, update this file accordingly.

Note: The MTG rules engine is a large, live module at `/src/lib/game-state/` (layer-system, trigger-system, state-based-actions, spell-casting, combat, mana, …). It is the correctness-critical core and the only place mutation testing runs. `game-rules.ts` imports its `GameState` type from there.

## AI Development

AI flows live in `/src/ai/flows/` (deck-coach review, opponent generation, draft assistant, and others), backed by the multi-provider Vercel AI SDK and the unified proxy at `/src/app/api/ai-proxy/`:
- Run `npm run simulate` to execute the AI simulation suite (`src/ai/__tests__/simulation/`)
- Each flow has co-located tests under `/src/ai/flows/__tests__/`
- Provider keys are optional — deck coaching falls back to a heuristic that needs no API key

## Deployment

The project is configured for Firebase App Hosting via `apphosting.yaml`. No additional build configuration is required beyond the standard Next.js build process.

## Common Patterns

### Class Name Merging
Use the `cn()` utility function from `@/lib/utils` to merge Tailwind CSS classes. This is the standard pattern from Shadcn/ui:
```ts
import { cn } from '@/lib/utils';
const className = cn('base-class', conditional && 'conditional-class');
```

### Dark Mode
The app uses dark mode by default (see `src/app/layout.tsx`). Avoid adding dark mode toggles unless explicitly requested.

### Dependency Patches
The project uses `patch-package` for applying fixes to dependencies. Patches are stored in `patches/` directory.
