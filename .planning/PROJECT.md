# Planar Nexus — Project Vision

## Elevator Pitch
**Free open-source tabletop card game deck builder and tester with AI coaching.** Build decks, get AI-powered meta analysis, and playtest against AI opponents — all in a legal-safe, client-side application distributable as desktop installers for Windows, Mac, and Linux.

## Problem Statement
Card game players need accessible tools to build and test decks without expensive physical cards, get feedback on performance against the meta, and playtest against realistic AI opponents.

## Solution
Planar Nexus provides:
1. **Deck Builder** — Intuitive card browser and deck construction with format validation
2. **AI Coach** — Heuristic and LLM-powered deck analysis with improvement suggestions
3. **AI Opponent** — Playtest decks against configurable AI opponents with multiple difficulty levels
4. **Cross-Platform** — Browser-based and native desktop installers via Tauri

## Target Users
- **Primary**: Tabletop card game players (Commander, Standard, Modern formats)
- **Secondary**: Content creators testing deck ideas

## v1.2 Scope: AI Intelligence & Advanced Coaching (In Progress)

**Goal:** Build a comprehensive AI-powered card game experience with advanced coaching and adaptive opponents.

**Target features:**
- **Advanced LLM Integration**: Multi-provider support (OpenAI, Anthropic, Google) with streaming responses and refined prompts.
- **AI Deck Assistant**: Proactive card suggestions during construction based on archetype and synergy scores.
- **Adaptive Coaching**: AI learns from player games and history to provide more personalized coaching.
- **Improved Opponent AI**: Refined decision-making for expert difficulty and support for complex card interactions.

---

## Validated Milestones

### ✅ v1.1 Polish & Stability Pass — 2026-03-17
- Shipped 1,618 passing unit tests and 180+ E2E tests.
- Optimized bundle size to 102KB.
- Implemented mobile responsiveness and keyboard shortcuts.
- Launched AI spectator mode with commentary.

### ✅ v1.0 MVP — 2026-03-12
- Card database with bulk import.
- Core deck builder with format validation.
- Heuristic AI coach and opponent difficulty levels.
- Tauri desktop installers for all platforms.

---

## Technical Context

### Current Stack
- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **UI**: Shadcn/ui (Radix primitives)
- **Storage**: IndexedDB (offline-first)
- **Desktop**: Tauri 2.x
- **AI**: Custom proxy + heuristic fallbacks

### Current State: v1.1 SHIPPED 🚀
- ✅ Test infrastructure 100% stable
- ✅ Production builds verified for all platforms
- ✅ Full user/dev documentation complete
- ✅ AI spectator mode live

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Next.js App Router | Modern architecture, easy routing | ✓ Good |
| IndexedDB | Offline-first, no server needed | ✓ Good |
| Tauri | Lightweight desktop wrapper | ✓ Good |
| AI Proxy | Secure API key management | ✓ Good |
| Service Worker | Offline support and performance | ✓ Good |

---

## Project Principles
1. **Offline-First** — Everything works without network
2. **Legal-Safe** — Generic terminology, procedural art
3. **Client-Side** — Minimal server infrastructure
4. **Open Source** — MIT licensed
5. **Privacy-First** — No telemetry, no accounts required

---

**Current Milestone**: v1.2 AI Intelligence & Advanced Coaching  
**Version**: 1.2.0  
**Last Updated**: 2026-03-17 after v1.1 milestone completion
