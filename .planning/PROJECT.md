# Planar Nexus — Project Vision

## Elevator Pitch
**Free open-source tabletop card game deck builder and tester with AI coaching.** Build decks, get AI-powered meta analysis, and playtest against AI opponents — all in a legal-safe, client-side application distributable as desktop installers for Windows, Mac, and Linux.

## Problem Statement
Card game players need accessible tools to build and test decks without expensive physical cards, get feedback on performance against the meta, and playtest against realistic AI opponents.

## Solution
Planar Nexus provides:
1. **Deck Builder** — Intuitive card browser with advanced search, filtering, and deck analytics
2. **AI Coach** — Heuristic and LLM-powered deck analysis with improvement suggestions
3. **AI Opponent** — Playtest decks against configurable AI opponents with multiple difficulty levels
4. **Cross-Platform** — Browser-based and native desktop installers via Tauri

## Target Users
- **Primary**: Tabletop card game players (Commander, Standard, Modern formats)
- **Secondary**: Content creators testing deck ideas

---

## v1.5 Scope: Meta & Strategy AI (Planning) ✅ SHIPPED 2026-03-19

**Goal:** Add meta analysis and strategic AI features to help players understand the competitive landscape and improve their game strategy.

**Target features:**
- **Meta Deck Analysis**: Analyze top decks in selected format, identify dominant strategies
- **Anti-Meta Recommendations**: Suggest counters to popular deck types based on meta share
- **Format Health Score**: Calculate and display format diversity metrics
- **Meta Trend Tracking**: Show rising/falling deck archetypes over time
- **Matchup Guides**: Pre-game strategic advice vs. specific opponent archetypes
- **Sideboard Plans**: Detailed sideboard recommendations per matchup
- **Mana Curve Optimization**: Suggest optimal land counts based on deck strategy
- **Game Phase Strategy**: Strategic advice for each game phase (opening, mid, late)

---

## Current Milestone: v1.6 QA/QC Infrastructure

**Goal:** Establish comprehensive quality engineering infrastructure with pre-commit hooks, test strategies, and coverage reporting.

**Target features:**
- **Pre-commit Hooks**: Linting, type checking, formatting enforcement
- **Test Infrastructure**: Unit, integration, and E2E test setup
- **Test Coverage Goals**: Coverage thresholds and reporting
- **CI/CD Quality Gates**: Automated quality checks in pipeline
- **Code Quality Checks**: Static analysis and linting rules

---

## v1.4 Scope: Draft/Sealed Limited Modes (Planning)

**Goal:** Add Draft and Sealed game modes for variety gameplay.

**Target features:**
- **Draft Mode**: 3-pack simulation with AI neighbors, timer per pick, AI opponent battle
- **Sealed Mode**: 6-pack pool opening, AI opponent battle
- **Shared**: Set selection, reuse deck builder with "Limited" pool filter

**Out of Scope:**
- Sideboarding (v1.5+)
- Multiplayer Draft/Sealed (AI only in v1.4)

---

## v1.3 Scope: Deck Builder UX Enhancements ✅ SHIPPED 2026-03-18

**Goal:** Improve deck building experience with advanced search, filtering, and deck analysis tools.

**Delivered:**
- **Advanced Search Filters**: Filter by CMC, color, type, rarity, power/toughness, format legality
- **Fuzzy Search**: Typo-tolerant search with Levenshtein distance and partial matching
- **Saved Searches**: Store and recall custom filter presets (IndexedDB persistence)
- **Enhanced Sorting**: Sort by CMC, color, type, rarity, set, name, power/toughness
- **Color Identity Filter**: Commander color identity with subset checking
- **Deck Statistics**: Mana curve, card type breakdown, color distribution (Recharts)
- **Quick-Add**: Enter key, arrow navigation, Shift+Click, virtual scrolling (<100ms)

---

## Validated Milestones

### ✅ v1.5 Meta & Strategy AI — 2026-03-19
- **Status:** Complete ✅
- Meta deck analysis (archetypes, win rates, inclusion rates)
- Format health score (diversity 0-100, color distribution)
- Meta trend tracking (rising/declining archetypes)
- Anti-meta recommendations and matchup guides
- Game phase strategy (opening, mid-game, late-game)
- Sideboard plans with in/out recommendations
- Mana curve optimization and color mana analysis

### ✅ v1.4 Draft/Sealed Limited Modes — 2026-03-19
- **Status:** Complete ✅
- Set selection browser with card counts and release dates
- 3-pack draft with AI neighbors, timer per pick
- 6-pack sealed pool opening
- Limited deck builder with pool isolation
- Launch AI opponent from limited session

### ✅ v1.3 Deck Builder UX Enhancements — 2026-03-18
- Advanced multi-attribute card filters (CMC, type, color, rarity, P/T, format)
- Fuzzy search with Levenshtein distance <= 2 and partial matching
- Search presets with IndexedDB persistence (save/load/delete)
- Deck statistics visualizations (mana curve, type breakdown, color distribution)
- Keyboard shortcuts (Enter, arrow keys) and virtual scrolling for performance

### ✅ v1.2 AI Intelligence & Advanced Coaching — 2026-03-17
- Multi-provider LLM integration (OpenAI, Anthropic, Google Gemini).
- Local intelligence foundation with Orama and Transformers.js.
- AI Deck Assistant with proactive suggestions and streaming explanations.
- Adaptive coaching with player history and personalized reports.
- Expert opponent AI with stack interaction and multi-blocker handling.

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
- **UI**: Shadcn/ui (Radix primitives), Recharts
- **Storage**: IndexedDB (offline-first)
- **Desktop**: Tauri 2.x
- **AI**: Custom proxy + heuristic fallbacks
- **Search**: Orama (full-text), Fuse.js (fuzzy), Levenshtein (typo-tolerance)
- **Performance**: @tanstack/react-virtual for virtual scrolling

### Current State: v1.3 SHIPPED 🚀
- ✅ Advanced deck builder with fuzzy search and filters
- ✅ Deck statistics (mana curve, type breakdown, color distribution)
- ✅ Search presets with persistence
- ✅ Keyboard navigation and virtual scrolling
- ✅ Virtualized card display for smooth scrolling

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Next.js App Router | Modern architecture, easy routing | ✓ Good |
| IndexedDB | Offline-first, no server needed | ✓ Good |
| Tauri | Lightweight desktop wrapper | ✓ Good |
| AI Proxy | Secure API key management | ✓ Good |
| Service Worker | Offline support and performance | ✓ Good |
| Orama + Fuse.js | Fast local search with fuzzy matching | ✓ Good |
| Recharts | Interactive data visualization | ✓ Good |
| @tanstack/react-virtual | Smooth scrolling with large datasets | ✓ Good |

---

## Project Principles
1. **Offline-First** — Everything works without network
2. **Legal-Safe** — Generic terminology, procedural art
3. **Client-Side** — Minimal server infrastructure
4. **Open Source** — MIT licensed
5. **Privacy-First** — No telemetry, no accounts required

---

**Current Milestone**: v1.6 (QA/QC Infrastructure)
**Version**: 1.6.0
**Last Updated**: 2026-03-19 after v1.6 milestone initiation
