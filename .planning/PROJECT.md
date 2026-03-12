# Planar Nexus — Project Vision

## Elevator Pitch
**Free open-source tabletop card game deck builder and tester with AI coaching.** Build decks, get AI-powered meta analysis, and playtest against AI opponents — all in a legal-safe, client-side application distributable as desktop installers for Windows, Mac, and Linux.

## Problem Statement
Card game players need accessible tools to:
- Build and test decks without expensive physical cards
- Get feedback on deck performance against current meta
- Playtest against realistic AI opponents before playing with humans
- Import/export decks across platforms

## Solution
Planar Nexus provides:
1. **Deck Builder** — Intuitive card browser and deck construction with format validation
2. **AI Coach** — Heuristic and LLM-powered deck analysis with improvement suggestions
3. **AI Opponent** — Playtest decks against configurable AI opponents with multiple difficulty levels
4. **Cross-Platform** — Browser-based and native desktop installers via Tauri

## Target Users
- **Primary**: Tabletop card game players (Commander, Standard, Modern formats)
- **Secondary**: Content creators testing deck ideas
- **Tertiary**: New players learning game mechanics

## v1.0 Scope

### Must-Have Features (REQ)
| ID | Feature | Priority |
|----|---------|----------|
| REQ-1 | Upload card metadata, images, and rules | P0 |
| REQ-2 | Import/export decks (text, JSON, clipboard) | P0 |
| REQ-3 | Create and save decks with format validation | P0 |
| REQ-4 | AI coach feedback on deck meta performance | P1 |
| REQ-5 | AI opponent playtesting | P0 |

### Success Criteria
✅ **User can go from install to testing deck against AI opponent within 5-10 minutes**

Measurable outcomes:
- Fresh install → deck testing in ≤10 minutes
- Card database contains 100+ cards minimum
- AI opponent plays full game loops (not prototype)
- Deck coach provides actionable recommendations
- Import works from standard text decklists

### Out of Scope (v1.0)
- Multiplayer (P2P already exists, not v1.0 focus)
- Custom card creation UI
- Cloud sync / account system
- Achievement system
- Trading system
- Admin card management UI

## Technical Context

### Current Stack (Keep)
- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **UI**: Shadcn/ui (Radix primitives)
- **Storage**: IndexedDB (offline-first)
- **Desktop**: Tauri 2.x
- **AI**: Custom proxy + heuristic fallbacks

### Current State: ~85% Complete
- ✅ Deck builder fully functional
- ✅ Import/export working (95%)
- ✅ AI coach heuristic system working
- ✅ AI opponent deck generation working
- ⚠️ Game engine not connected to UI
- ⚠️ Card database only has 20 cards (needs 100+)
- ⚠️ Single-player mode shows "Prototype"

### Critical Gaps to Close
1. **Game Engine ↔ UI Integration** — Connect GameState to game-board and single-player UIs
2. **Card Database Expansion** — Bulk import 500+ cards
3. **AI Gameplay Loop** — AI decision engine must actually play cards
4. **Build Pipeline** — Fix TypeScript errors, enable strict checks

## Non-Goals
- Competing with official game tools
- Supporting every possible format
- Perfect AI (heuristic + optional LLM is acceptable)
- Mobile apps (desktop + web only for v1.0)

## Project Principles
1. **Offline-First** — Everything works without network
2. **Legal-Safe** — Generic terminology, procedural art, no copyrighted assets
3. **Client-Side** — Minimal server infrastructure
4. **Open Source** — MIT licensed, community-driven
5. **Privacy-First** — No telemetry, no accounts required

---

**Created**: 2026-03-12  
**Last Updated**: 2026-03-12  
**Version**: 1.0.0
