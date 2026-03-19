# Phase 27 Context: Chat Interface Foundation

## Phase Overview
- **Phase**: 27 - Chat Interface Foundation
- **Goal**: Core chat interface for conversational AI coaching - message history, input handling, typing indicators
- **Milestone**: v1.7 Conversational AI Coach

## Dependencies
- Phase 20 (existing deck builder features)
- Genkit AI flows (already configured in `/src/ai/`)
- Existing deck-coach page at `/src/app/(app)/deck-coach/`

## Technical Context

### Existing AI Infrastructure
- Genkit configured at `/src/ai/genkit.ts`
- AI flows in `/src/ai/flows/`:
  - `ai-deck-coach-review.ts` - Deck analysis
  - `ai-opponent-deck-generation.ts` - Opponent deck generation
- Uses `gemini-1.5-flash-latest` model
- Server actions in `/src/app/actions.ts`

### Frontend Stack
- Next.js 15 with App Router
- React 19
- Shadcn/ui components in `/src/components/ui/`
- Tailwind CSS for styling
- Dark mode by default

### Key Components
- Deck coach page: `/src/app/(app)/deck-coach/page.tsx`
- Card display components in `/src/components/`
- Types defined in `/src/app/actions.ts`: `ScryfallCard`, `DeckCard`, `SavedDeck`

## Requirements (CHAT-01 through CHAT-06)
1. Chat interface displays message history with user and AI messages clearly distinguished
2. User can type and send messages via input field
3. Messages are timestamped and displayed in chronological order
4. Typing indicator shows when AI is composing response
5. Chat history persists during session
6. Chat interface is accessible and keyboard-navigable

## Success Criteria
1. Chat interface displays message history with user and AI messages clearly distinguished
2. User can type and send messages via input field
3. Messages are timestamped and displayed in chronological order
4. Typing indicator shows when AI is composing response
5. Chat history persists during session
6. Chat interface is accessible and keyboard-navigable

## Technical Decisions Needed
- Message storage approach (IndexedDB vs React state)
- Chat component architecture (client component boundaries)
- Integration with existing deck-coach page

## Constraints
- Must integrate with existing deck-coach page
- Should leverage existing Shadcn/ui components where possible
- Accessibility is a requirement (keyboard navigation, ARIA)
