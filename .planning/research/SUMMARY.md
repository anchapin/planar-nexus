# Project Research Summary

**Project:** Planar Nexus v1.4 — Draft/Sealed Limited Modes
**Domain:** Magic: The Gathering Digital Draft/Sealed Simulator
**Researched:** 2026-03-18
**Confidence:** HIGH

## Executive Summary

Planar Nexus v1.4 introduces Draft/Sealed Limited modes — asynchronous card selection formats that differ fundamentally from constructed play. Draft requires pack-by-pack card selection with passing mechanics, while Sealed is a simpler pool-building experience. Both formats need new state management that operates orthogonally to the existing deck builder, with different persistence requirements and UI flows.

Research confirms **minimal stack additions** are needed. The existing infrastructure (Next.js 15, React 19, TypeScript, Dexie.js, Scryfall API) handles most requirements. The single new dependency is **Zustand ^5.0.0** for draft/sealed state management. Pack generation uses server-side logic with existing Scryfall integration, AI neighbor simulation extends current heuristics, and persistence extends the existing Dexie.js layer.

**Key risks identified:** Draft pool corruption on interruption (must use server-authoritative state), timer auto-picking worst cards (must track best card seen), and pool mixing with regular collection (must use pool isolation with poolId/expiration). These risks are addressable with proper architecture choices and are flagged for Foundation phase.

## Key Findings

### Recommended Stack

**Core finding:** One new dependency — Zustand ^5.0.0. All other functionality extends existing infrastructure.

**Core technologies:**
- **Zustand ^5.0.0** — Draft/sealed state management with modular slices pattern, persistence middleware, React 19 compatible (~1KB bundle)
- **Custom React Hook** — Draft timer (no external library, <30 lines, full control)
- **Server-side Pack Generator** — Cryptographically seeded random using existing Scryfall integration
- **Heuristic AI Bots** — Extend existing `ai-draft-assistant.ts` for neighbor simulation (not ML)
- **Dexie.js** — Extend existing IndexedDB storage for draft sessions, sealed pools

**Installation:** `npm install zustand@^5.0.0` only.

### Expected Features

**Must have (table stakes):**
- **Set Selection** — Choose which MTG set for Limited; show set images, release dates, popularity
- **Pack Opening (Draft)** — 14-card packs, show face-down until revealed
- **Draft Pick Interface** — Card-by-card selection with visual feedback (15 picks per pack)
- **Draft Pool Management** — Sortable/filterable list of drafted cards
- **Sealed Pool Opening** — Open 6 packs at once, immediate access to all cards
- **Sealed Deck Builder** — Build 40-card deck from pool, constrained to pool cards
- **Play with Limited Deck** — Launch AI game with drafted/sealed deck
- **Limited Format Validation** — 40-card minimum, 4-copy limit, no sideboard

**Should have (competitive differentiators):**
- **AI Bot Drafting** — Practice unlimited times against heuristic AI "neighbors"
- **Draft Timer with Urgency** — Creates real pressure (40-60s per pick); make optional for casual
- **Pick-by-Pick Hints** — AI coach integrated into draft; leverage existing AI deck coach
- **Pool Color Analysis** — Help choose which colors to play; show card counts by color
- **Pool Stats Panel** — Mana curve, creature count, removal count

**Defer (v2+):**
- Real-time Multiplayer Pod Draft — Complex matchmaking, infrastructure-heavy
- Cube Draft — Requires content management system
- Draft Tournament Mode — Swiss brackets, prizes, significant backend
- Raredraft Mode — Conflicts with core experience

### Architecture Approach

**Layered architecture:** UI Components → State Management (Context/Zustand) → Business Logic Engines → Persistence (IndexedDB)

**Project structure:** `src/lib/limited/` for pure business logic (types.ts, pack-generator.ts, draft-engine.ts, sealed-engine.ts, limited-rules.ts, limited-storage.ts), `src/hooks/` for React lifecycle bridging, `src/contexts/limited-session-context.tsx` for state provider, `src/components/limited/` for UI components.

**Major components:**
1. **DraftPickerModal / PackDisplay** — Pack display, card selection, passing animation
2. **SealedPoolViewer** — Pool cards grid, color filtering, deck preview
3. **DraftTimerDisplay** — Extend existing `use-turn-timer.ts` with countdown, pause/resume, warnings
4. **LimitedDeckBuilder** — Pool-aware deck building; extend existing deck-builder with format filter
5. **PackGenerator** — Seeded random pack creation from Scryfall card set
6. **DraftEngine** — State machine: idle → pack_opening → awaiting_pick → pack_passed → pack_complete → completed
7. **SealedEngine** — Pool generation, deck optimization
8. **LimitedStorage** — IndexedDB operations extending existing `indexeddb-storage.ts`

### Critical Pitfalls

1. **Draft Pool Corruption on Interruption** — Browser crash mid-draft loses progress. **Fix:** Server-authoritative state, atomic writes, draft resumption tokens, localStorage backup fallback.

2. **Timer Expiration = Auto-Pick Worst Card** — Naive "pick index 0" feels punishing. **Fix:** Track best card hovered, auto-pick that on timeout, explicit "Skip this pick?" modal.

3. **Pack Distribution "Unfair" (Perceived)** — Client-side generation is manipulable and breeds suspicion. **Fix:** Server-side generation with CSPRNG, collation simulation, duplicate card prevention.

4. **Pool Mixing with Regular Collection** — Draft cards appear in deck builder alongside owned cards. **Fix:** Separate storage schemas with `poolId`/`eventId`/`expiration`, pool-scoped deck builder, no export for pool cards.

5. **Pack "Not Arriving" (Network/State Desync)** — Silent failures, no timeout handling, perceived hang. **Fix:** Explicit state machine with confirmation, timeout with retry, error display, heartbeat protocol.

6. **Sealed Pool Count Wrong** — Hard-coded pack counts break for different sets. **Fix:** Set-specific configs from Scryfall, verification step after generation, preview + confirm flow.

7. **Deck Builder "Looks Done But Isn't"** — Missing limited-specific validations. **Fix:** Apply `DEFAULT_RULES.limited` (40 min, 4 max copies, no sideboard), mana curve display, color identity warnings.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation — Types, Pack Generation, Sealed Core
**Rationale:** Establishes the data model and core infrastructure before building interactive flows. Dependencies resolved here enable everything else.

**Delivers:**
- `lib/limited/types.ts` — DraftCard, DraftSession, SealedPool, LimitedSession types
- `lib/limited/pack-generator.ts` — Server-side pack creation with seeded randomness
- `lib/limited/limited-storage.ts` — IndexedDB persistence for drafts and pools
- `lib/limited/limited-rules.ts` — Format validation (40-card min, 4-copy limit, no sideboard)
- Basic sealed UI: Pool viewer with virtual scrolling, deck builder with pool filter
- Set selection screen using existing Scryfall data

**Addresses:** Pitfalls 3 (pack distribution), 4 (pool isolation), 6 (sealed count), 7 (limited validation)
**Uses:** Zustand store, existing Scryfall integration, existing Dexie.js patterns

### Phase 2: Draft Core — State Machine, Timer, Draft UI
**Rationale:** Sequential dependency on Foundation. Can't build draft UI without pack generation and types.

**Delivers:**
- `lib/limited/draft-engine.ts` — Complete state machine implementation
- `hooks/use-draft-timer.ts` — Timer hook with warning states (green→yellow→red)
- `contexts/limited-session-context.tsx` — State provider with auto-save
- Draft picker modal with card display and selection
- Draft pool display (sortable, filterable, virtualized)
- Draft flow: Start → Open Pack → Make Pick → Next Pack → Complete

**Addresses:** Pitfalls 1 (state persistence), 2 (timer auto-pick), 5 (pack not arriving)
**Uses:** Foundation types and storage, Zustand slices

### Phase 3: AI Neighbors — Bot Simulation, Passing Mechanics
**Rationale:** Makes draft playable solo. Depends on Phase 2 state machine being stable.

**Delivers:**
- AI neighbor state tracking (colors, archetypes, power level)
- Heuristic bot pick logic (extend existing `ai-draft-assistant.ts`)
- Pack passing simulation (left/right rotation)
- Bot difficulty levels (Easy: random, Medium: color-focused, Hard: archetype optimization)
- Visual indication of bot picking ("Seat 2 (Bot) is picking...")

**Addresses:** Core differentiator — AI bot drafting vs. real players
**Uses:** Existing AI heuristics, Phase 2 state machine

### Phase 4: Polish — Timer UX, Stats, Integration
**Rationale:** Enhances experience once core flow works. Lower risk, higher delight.

**Delivers:**
- Draft timer with warnings and audio cues
- Undo functionality within time limit
- Pool color analysis and mana curve display
- Draft summary screen (picks by color, notable cards, deck strength rating)
- Play with limited deck integration (launch AI game from pool)
- Multiple pool saves

**Addresses:** P2 features from FEATURES.md, UX pitfalls
**Uses:** Phase 2 timer hook, Phase 3 AI, existing single-player system

### Phase Ordering Rationale

- **Foundation first:** Types and pack generation are prerequisites for everything. Pool isolation must be baked in from start, not retrofitted.
- **Draft core follows foundation:** State machine depends on types; UI depends on state machine.
- **AI neighbors after core:** The state machine must be stable before adding bot simulation complexity.
- **Polish last:** Timer UX and stats are enhancements, not blockers. They're iterative improvements.
- **Avoids pitfalls:** Each phase explicitly addresses identified risks through design patterns.

### Research Flags

**Needs research during planning:**
- **Phase 1:** Set-specific pack configuration data — Modern MTG sets have variable card counts per pack. Need to compile Scryfall data or find existing dataset.
- **Phase 3:** Bot difficulty calibration — Heuristic weights need tuning against real draft data.

**Standard patterns (skip phase research):**
- **Phase 2:** Zustand state management — Well-documented, established patterns from existing codebase.
- **Phase 4:** Timer implementation — Extend existing `use-turn-timer.ts`, standard patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zustand v5 docs verified; existing Scryfall/Dexie patterns confirmed in codebase |
| Features | HIGH | Based on MTG Arena, Draftsim, official Wizards sources; clear MVP scope |
| Architecture | MEDIUM-HIGH | Strong integration points with existing code; state machine patterns well-established; some variation possible in component boundaries |
| Pitfalls | HIGH | Based on MTG Arena bug reports, Draftsim analysis, mtgjson data structures |

**Overall confidence:** HIGH

### Gaps to Address

- **Set-specific pack configs:** Need to determine if using Scryfall's sealed content data or compiling per-set configurations manually.
- **Integration with existing deck builder:** Extent of modifications needed to add pool-scoped filtering — requires detailed code analysis during planning.
- **AI neighbor pass timing:** In 2-player draft, bots need time to "think." Visual feedback duration needs UX testing.

## Sources

### Primary (HIGH confidence)
- [Zustand v5 Documentation](https://zustand.docs.pmnd.rs) — Game state patterns, persistence middleware
- [MTG Arena Draft Guide](https://magic.wizards.com/en/mtgarena/draft) — Official draft format documentation
- [Wizards Sealed Deck Rules](https://magic.wizards.com/en/formats/sealed-deck) — Official sealed format
- Existing `src/lib/game-rules.ts` — Format definitions including `limited`
- Existing `src/lib/indexeddb-storage.ts` — IndexedDB patterns
- Existing `src/hooks/use-turn-timer.ts` — Timer implementation

### Secondary (MEDIUM confidence)
- [Draftsim MTG Arena Limited Guide](https://draftsim.com/mtg-arena-limited/) — Comprehensive Arena analysis
- [Draftsim Bot Battle Analysis](https://draftsim.com/draftsim-bot-drafting-paper/) — Bot drafting algorithms
- [MTG Arena Known Issues List](https://mtgarena-support.wizards.com/hc/en-us/articles/360000091646-Known-Issues-List) — Real bug reports informing pitfalls
- [taw/magic-sealed-data](https://github.com/taw/magic-sealed-data) — Pack generation specs

### Tertiary (LOW confidence)
- [MTG Draft Bot Research (IEEE)](https://ieee-cog.org/2021/assets/papers/paper_27.pdf) — Academic paper, may need validation against practical implementation

---

*Research completed: 2026-03-18*
*Ready for roadmap: yes*
