# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Planar Nexus is a digital Magic: The Gathering tabletop experience built with Next.js, featuring deck building, AI coaching, and multiplayer functionality. The app integrates with the Scryfall API for card data and uses Google's Gemini AI via Genkit for deck analysis and opponent generation.

## Development Commands

```bash
# Install dependencies
npm install

# Development server (runs on port 9002 with Turbopack)
npm run dev

# AI development environment (Genkit dev UI)
npm run genkit:dev

# AI development with hot-reload (restarts on file changes)
npm run genkit:watch

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

The app uses Next.js 15 with the App Router pattern:
- `/src/app/(app)/` - Protected application routes with a shared layout
  - `dashboard/` - Main dashboard with feature cards
  - `deck-builder/` - Card search and deck management interface
  - `deck-coach/` - AI-powered deck review system
  - `single-player/` - Solo game mode
  - `multiplayer/` - Multiplayer game interface

### Server Actions

Server actions in `/src/app/actions.ts` handle:
- Scryfall API integration for card search and legality validation
- AI deck reviews and opponent generation
- Deck persistence (local storage)

All server actions are marked with `"use server"` and can be called directly from client components.

### AI Integration (Genkit)

AI functionality is implemented using Google's Genkit framework:
- Configuration: `/src/ai/genkit.ts` - Initializes Genkit with Google AI plugin
- Flows: `/src/ai/flows/` - AI operations
  - `ai-deck-coach-review.ts` - Analyzes decklists, generates strategic suggestions
  - `ai-opponent-deck-generation.ts` - Creates AI opponent decks

AI flows use:
- Model: `gemini-1.5-flash-latest`
- Zod schemas for input validation and structured output (import from `genkit`, not `zod`)
- Retry logic for handling AI errors
- Server actions (`'use server'`) for client-side invocation

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

## Local Storage Architecture

Planar Nexus uses a local-first architecture with no cloud dependencies:

### User Management (`/src/lib/local-user.ts`)
- User authentication with localStorage
- User preferences management
- Session persistence
- Sign in/sign out functionality

### Game State Storage (`/src/lib/local-game-storage.ts`)
- IndexedDB for game state persistence
- Game session management
- Game code mapping
- Version-controlled state updates
- Host/client role management

### Multiplayer (`/src/lib/webrtc-p2p.ts`)
- Pure WebRTC for P2P connections
- PeerJS for signaling
- No central server required
- Direct player-to-player connections

All data is stored locally, enabling:
- 100% offline functionality
- Zero cloud costs
- Privacy-focused (all data local)
- Faster local operations
- Simplified deployment

## AI Development

The Genkit dev UI provides tools for testing AI flows:
- Run `npm run genkit:dev` to start the dev server
- Access the UI to test prompts and flows interactively
- Use this when modifying AI prompts or flow logic

## Deployment

The project can be deployed as a static site or PWA:
- Static hosting: Netlify, Vercel, GitHub Pages
- PWA: Service worker for offline capability
- Local-only: No external dependencies required

The `apphosting.yaml` file is deprecated (legacy Firebase configuration).

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
