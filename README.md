# Planar Nexus

**Disclaimer**: Planar Nexus is not affiliated with, endorsed by, or connected to Wizards of the Coast, Magic: The Gathering, or any of their affiliates. All Magic: The Gathering content is trademarked and copyrighted by Wizards of the Coast. This project is provided for educational and entertainment purposes only.

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
| Single Player | ✅ Complete | UI screens exist, game engine fully complete |
| Multiplayer | ✅ Complete | P2P WebRTC, lobby system, 1v1, 4-player Commander, 2v2 teams |
| Game Engine | ✅ Complete | Core mechanics implemented (state, combat, layers, SBAs, replacement effects) |
| AI Providers | ✅ Complete | Multi-provider support (Gemini, Claude, OpenAI, Z.ai) with subscription linking |
| Visual Effects | ✅ Complete | Card art, attack/block animations, spell effects, sound system, card sleeves |
| Social Features | ✅ Complete | Friends list, match history, trading system, replay sharing |
| Tournament | ✅ Complete | Bracket system, Swiss pairing, round timer, judge tools |

---

### Phase 1: Core Game Engine (Required for Single & Multiplayer)

**Priority: CRITICAL** - Blocks all gameplay features

#### 1.1 Game State Management
- [x] Implement game state data structures (players, battlefield, hands, graveyards, exile, stack, command zones)
- [x] Create card state tracking (tapped, flipped, counters, attachments, auras/equipment)
- [x] Implement turn phases (beginning, precombat main, combat, postcombat main, end)
- [x] Create priority pass system for stack resolution
- [x] Implement turn/round tracking for multiplayer

#### 1.2 Card Mechanics
- [x] Land playing and mana pool system
- [x] Spell casting (paying costs, putting on stack)
- [x] Stack resolution (responding, priority passing, resolution order)
- [x] Combat system (attackers, blockers, damage assignment, first/double strike)
- [x] Activated abilities and triggered abilities
- [x] Keyword action handling (destroy, exile, sacrifice, draw, discard, etc.)

#### 1.3 Card Rules Engine
- [x] Parse and interpret Oracle text for common abilities
- [x] Handle evergreen keywords (flying, trample, haste, deathtouch, etc.)
- [x] Implement replacement effects and prevention effects
- [x] Handle state-based actions (creature death, planeswalker rules, etc.)
- [x] Implement layer system for continuous effects

---

### Phase 2: Single Player Gameplay

**Priority: HIGH**

#### 2.1 Game Board UI
- [x] Design and implement game board layout
- [x] Card rendering (face-up, face-down, token representation)
- [x] Hand display and card selection
- [x] Battlefield visualization with card positioning
- [x] Graveyard/exile/command zone viewers
- [x] Stack display and priority indicators
- [x] Life total and poison counter tracking
- [x] Commander damage tracking (for Commander format)

#### 2.2 Game Interaction System
- [x] Click-to-act interface for cards
- [x] Menu system for activated abilities
- [x] Targeting system for spells/abilities
- [x] Attack/block declaration UI
- [x] Mana payment interface
- [x] Optional "yes/no" dialogs for triggers

#### 2.3 Save/Load System
- [x] Game state serialization
- [x] In-memory game replay system
- [x] Saved games browser
- [x] Auto-save functionality

---

### Phase 3: AI Opponent & Gameplay

**Priority: HIGH**

#### 3.1 AI Decision Engine
- [x] AI game state evaluation (heuristic scoring)
- [x] Decision trees for main phase actions
- [x] Combat AI (attacking, blocking decisions)
- [x] Stack interaction AI (when to respond, with what)
- [x] Mulligan decision logic
- [x] Difficulty tuning (randomness, lookahead depth, evaluation accuracy)

#### 3.2 AI Integration with Providers
- [x] Abstract AI provider interface
- [x] Gemini integration
- [x] Claude API integration via Anthropic SDK
- [x] OpenAI/Copilot integration
- [x] Z.ai integration
- [x] Fallback and error handling for provider failures

#### 3.3 Bring Your Own Key System
- [x] User settings page for API key management
- [x] Secure local storage for API keys
- [x] Provider selection interface
- [x] API key validation on save
- [x] Usage tracking per provider (if available)
- [x] Subscription plan linking (if applicable)

#### 3.4 Enhanced AI Features
- [x] AI deck building suggestions based on meta analysis
- [x] Real-time gameplay assistance (hints, suggest plays)
- [x] Post-game analysis and improvement suggestions
- [x] Draft/sealed deck AI assistance

---

### Phase 4: Multiplayer Infrastructure

**Priority: MEDIUM** (Can be developed in parallel with Phase 2-3)

#### 4.1 Peer-to-Peer Networking
- [x] WebRTC implementation for direct player connections
- [x] Signaling server for WebRTC handshake (lightweight, minimal state)
- [x] Connection management (reconnection, handling disconnects)
- [x] NAT traversal and STUN/TURN servers

#### 4.2 Game State Synchronization
- [x] Deterministic game state engine
- [x] Action broadcasting system (player actions sent to all peers)
- [ ] State hash verification for sync detection
- [ ] Conflict resolution for desync
- [x] Replay buffering for late joins

#### 4.3 Lobby System
- [x] Host game functionality (generate game code)
- [x] Join game by code
- [x] Public game browser (with signaling server discovery)
- [x] Player ready system
- [x] Deck selection per player
- [x] Format enforcement

#### 4.4 Multiplayer Features
- [x] 1v1 mode implementation
- [x] 4-player free-for-all (Commander style)
- [x] 2v2 teams mode
- [x] Spectator mode
- [x] Chat system
- [x] Emote/timer system
- [x] Concede and draw options

#### 4.5 Alternative: Serverless Architecture Options
- [ ] Evaluate Firebase Realtime Database for signaling/state
- [ ] Consider WebSocket fallback for non-P2P scenarios
- [ ] Hybrid approach: P2P gameplay with lightweight signaling

---

### Phase 5: Polish & Enhancement

**Priority: LOW**

#### 5.1 Visual Effects
- [x] Card art display and high-res rendering
- [x] Attack/block animations
- [x] Spell casting effects
- [ ] Damage indicators and floating combat text
- [x] Sound effects and music
- [x] Card sleeves and playmats customization

#### 5.2 Tournament Features
- [x] Bracket system for tournaments
- [x] Swiss pairing support
- [x] Round timer with clock extensions
- [x] Judge tools (for local events)

#### 5.3 Advanced Features
- [x] Replay system with shareable links
- [x] Deck statistics and analytics
- [x] Collection tracker
- [x] Trading system (if applicable)
- [x] Achievement/badge system

---

## Technical Debt & Improvements

- [x] Migrate from hardcoded Gemini-only AI to provider-agnostic architecture
- [x] Add comprehensive unit tests for game rules
- [x] Add E2E tests for game scenarios
- [x] Performance optimization for large board states
- [x] Accessibility improvements (screen reader support, keyboard navigation)
- [x] Mobile responsiveness improvements
- [x] Offline mode (PWA with local caching)

---

---

## Legal Notices

**Trademark Notice**: Magic: The Gathering, Magic, MTG, and all related characters and elements are trademarks of Wizards of the Coast, LLC.

**Copyright Notice**: All card images, text, and game rules are property of Wizards of the Coast. This project uses the Scryfall API for card data but does not host any copyrighted materials.

**No Affiliation**: This project is not affiliated with, endorsed by, or connected to Wizards of the Coast. It is an independent, non-commercial project created for educational and entertainment purposes.

---

## Development Notes

The codebase is well-structured with Next.js 15, TypeScript, and Genkit AI flows. The deck builder, AI coach, and game engine features are production-ready. The game engine includes comprehensive implementations of:
- Game state management with full zone tracking
- Combat system with first/double strike, trample, deathtouch
- Layer system for continuous effects (CR 613)
- State-based actions (CR 704)
- Replacement and prevention effects (CR 614-616)
- AI difficulty tuning with multiple levels
- Full multiplayer support with P2P WebRTC
- Visual effects including animations, sounds, and card art
- Social features including friends, trading, and replays

Remaining work focuses on:
- Damage indicators and floating combat text
- State hash verification for multiplayer sync
- Conflict resolution for multiplayer desync
- Firebase Realtime Database evaluation
- WebSocket fallback for non-P2P scenarios

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
