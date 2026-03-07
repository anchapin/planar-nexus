# Planar Nexus

A digital Magic: The Gathering tabletop experience with deck building, AI coaching, and multiplayer functionality.

## Project Overview

Planar Nexus aims to be a comprehensive MTG video game featuring:
- **Deck Builder** - Import, export, save, and create custom decks for all MTG formats
- **AI Deck Coach** - Get intelligent feedback on your decks with legal card suggestions
- **Single Player Mode** - Play solo or against AI opponents with adjustable difficulty
- **Multiplayer Mode** - 1v1 and 4-player PVP without a central game server
- **Bring Your Own AI Key** - Use your own API keys from Claude, Copilot, Gemini, Z.ai, and more

## Getting Started

To start development, take a look at `src/app/page.tsx` and `CLAUDE.md` for development commands and architecture details.

---

## Roadmap

### Current Status (v0.1)

| Feature | Status | Notes |
|---------|--------|-------|
| Deck Builder | ✅ Complete | Full import/export, save/load, format validation, Scryfall integration |
| AI Deck Coach | ✅ Complete | Strategic analysis, legal suggestions, multiple optimization paths |
| Single Player | ⚠️ UI Only | Configuration screens exist, no gameplay implementation |
| Multiplayer | ⚠️ UI Only | Lobby browser exists, no networking or gameplay |
| Game Engine | ⚠️ Minimal | Format rules defined, no actual game mechanics |
| AI Providers | ⚠️ Gemini Only | No BYO key system, no multi-provider support |

---

### Phase 1: Core Game Engine (Required for Single & Multiplayer)

**Priority: CRITICAL** - Blocks all gameplay features

#### 1.1 Game State Management
- [ ] Implement game state data structures (players, battlefield, hands, graveyards, exile, stack, command zones)
- [ ] Create card state tracking (tapped, flipped, counters, attachments, auras/equipment)
- [ ] Implement turn phases (beginning, precombat main, combat, postcombat main, end)
- [ ] Create priority pass system for stack resolution
- [ ] Implement turn/round tracking for multiplayer

#### 1.2 Card Mechanics
- [ ] Land playing and mana pool system
- [ ] Spell casting (paying costs, putting on stack)
- [ ] Stack resolution (responding, priority passing, resolution order)
- [ ] Combat system (attackers, blockers, damage assignment, first/double strike)
- [ ] Activated abilities and triggered abilities
- [ ] Keyword action handling (destroy, exile, sacrifice, draw, discard, etc.)

#### 1.3 Card Rules Engine
- [ ] Parse and interpret Oracle text for common abilities
- [ ] Handle evergreen keywords (flying, trample, haste, deathtouch, etc.)
- [ ] Implement replacement effects and prevention effects
- [ ] Handle state-based actions (creature death, planeswalker rules, etc.)
- [ ] Implement layer system for continuous effects

---

### Phase 2: Single Player Gameplay

**Priority: HIGH**

#### 2.1 Game Board UI
- [ ] Design and implement game board layout
- [ ] Card rendering (face-up, face-down, token representation)
- [ ] Hand display and card selection
- [ ] Battlefield visualization with card positioning
- [ ] Graveyard/exile/command zone viewers
- [ ] Stack display and priority indicators
- [ ] Life total and poison counter tracking
- [ ] Commander damage tracking (for Commander format)

#### 2.2 Game Interaction System
- [ ] Click-to-act interface for cards
- [ ] Menu system for activated abilities
- [ ] Targeting system for spells/abilities
- [ ] Attack/block declaration UI
- [ ] Mana payment interface
- [ ] Optional "yes/no" dialogs for triggers

#### 2.3 Save/Load System
- [ ] Game state serialization
- [ ] In-memory game replay system
- [ ] Saved games browser
- [ ] Auto-save functionality

---

### Phase 3: AI Opponent & Gameplay

**Priority: HIGH**

#### 3.1 AI Decision Engine
- [ ] AI game state evaluation (heuristic scoring)
- [ ] Decision trees for main phase actions
- [ ] Combat AI (attacking, blocking decisions)
- [ ] Stack interaction AI (when to respond, with what)
- [ ] Mulligan decision logic
- [ ] Difficulty tuning (randomness, lookahead depth, evaluation accuracy)

#### 3.2 AI Integration with Providers
- [ ] Abstract AI provider interface
- [ ] Gemini integration (already done, needs refactoring)
- [ ] Claude API integration via Anthropic SDK
- [ ] OpenAI/Copilot integration
- [ ] Z.ai integration
- [ ] Fallback and error handling for provider failures

#### 3.3 Bring Your Own Key System
- [ ] User settings page for API key management
- [ ] Secure local storage for API keys
- [ ] Provider selection interface
- [ ] API key validation on save
- [ ] Usage tracking per provider (if available)
- [ ] Subscription plan linking (if applicable)

#### 3.4 Enhanced AI Features
- [ ] AI deck building suggestions based on meta analysis
- [ ] Real-time gameplay assistance (hints, suggest plays)
- [ ] Post-game analysis and improvement suggestions
- [ ] Draft/sealed deck AI assistance

---

### Phase 4: Multiplayer Infrastructure

**Priority: MEDIUM** (Can be developed in parallel with Phase 2-3)

#### 4.1 Peer-to-Peer Networking
- [ ] WebRTC implementation for direct player connections
- [ ] Signaling server for WebRTC handshake (lightweight, minimal state)
- [ ] Connection management (reconnection, handling disconnects)
- [ ] NAT traversal and STUN/TURN servers

#### 4.2 Game State Synchronization
- [ ] Deterministic game state engine
- [ ] Action broadcasting system (player actions sent to all peers)
- [ ] State hash verification for sync detection
- [ ] Conflict resolution for desync
- [ ] Replay buffering for late joins

#### 4.3 Lobby System
- [ ] Host game functionality (generate game code)
- [ ] Join game by code
- [ ] Public game browser (with signaling server discovery)
- [ ] Player ready system
- [ ] Deck selection per player
- [ ] Format enforcement

#### 4.4 Multiplayer Features
- [ ] 1v1 mode implementation
- [ ] 4-player free-for-all (Commander style)
- [ ] 2v2 teams mode
- [ ] Spectator mode
- [ ] Chat system
- [ ] Emote/timer system
- [ ] Concede and draw options

#### 4.5 Alternative: Serverless Architecture Options
- [ ] Evaluate Firebase Realtime Database for signaling/state
- [ ] Consider WebSocket fallback for non-P2P scenarios
- [ ] Hybrid approach: P2P gameplay with lightweight signaling

---

### Phase 5: Polish & Enhancement

**Priority: LOW**

#### 5.1 Visual Effects
- [ ] Card art display and high-res rendering
- [ ] Attack/block animations
- [ ] Spell casting effects
- [ ] Damage indicators and floating combat text
- [ ] Sound effects and music
- [ ] Card sleeves and playmats customization

#### 5.2 Tournament Features
- [ ] Bracket system for tournaments
- [ ] Swiss pairing support
- [ ] Round timer with clock extensions
- [ ] Judge tools (for local events)

#### 5.3 Advanced Features
- [ ] Replay system with shareable links
- [ ] Deck statistics and analytics
- [ ] Collection tracker
- [ ] Trading system (if applicable)
- [ ] Achievement/badge system

---

## Technical Debt & Improvements

- [ ] Migrate from hardcoded Gemini-only AI to provider-agnostic architecture
- [ ] Add comprehensive unit tests for game rules
- [ ] Add E2E tests for game scenarios
- [ ] Performance optimization for large board states
- [ ] Accessibility improvements (screen reader support, keyboard navigation)
- [ ] Mobile responsiveness improvements
- [ ] Offline mode (PWA with local caching)

---

## Development Notes

The codebase is well-structured with Next.js 15, TypeScript, and Genkit AI flows. The deck builder and AI coach features are production-ready. The main gap is the complete absence of a game rules engine, which is foundational for both single-player and multiplayer gameplay.

**Estimated Effort:**
- Phase 1 (Game Engine): 60-80% of total effort
- Phase 2 (UI): 10-15% of total effort
- Phase 3 (AI Gameplay): 10-15% of total effort
- Phase 4 (Multiplayer): 15-20% of total effort
- Phase 5 (Polish): 5-10% of total effort

**Parallelization Opportunities:**
- Phase 4 (Multiplayer networking) can be developed alongside Phases 2-3 by using mock game states
- AI provider abstraction can be refactored while using existing Gemini flows
- UI components can be built with mock data before game engine is complete
