# Planar Nexus — Roadmap

## Milestones

- ✅ **v1.3 Deck Builder UX Enhancements** — Phases 11-13 (shipped 2026-03-18)
- 🚧 **v1.4 Draft/Sealed Limited Modes** — Phases 14-17 (planning)

---

<details>
<summary>✅ v1.0 MVP — SHIPPED 2026-03-12</summary>

- [x] Phase 1: Foundation (Core deck builder, card database)
- [x] Phase 2: AI Coach & Opponent (Heuristic analysis, difficulty levels)
- [x] Phase 3: Import/Export & Tauri (Deck formats, desktop installers)

</details>

<details>
<summary>✅ v1.1 Polish & Stability Pass — SHIPPED 2026-03-17</summary>

- [x] Phase 4-5: Test infrastructure, E2E reliability, bundle optimization
- [x] Mobile support, keyboard shortcuts, AI spectator mode

</details>

<details>
<summary>✅ v1.2 AI Intelligence & Advanced Coaching — SHIPPED 2026-03-17</summary>

- [x] Phase 6: Multi-Provider LLM & Streaming (OpenAI, Anthropic, Google Gemini)
- [x] Phase 7: Local Intelligence Foundation (Orama, Transformers.js)
- [x] Phase 8: AI Deck Assistant UX (Proactive suggestions, streaming explanations)
- [x] Phase 9: Adaptive Coaching & Player History (Personalized reports)
- [x] Phase 10: Expert Opponent AI Refinement (Complex interactions, multi-blocker)

</details>

<details>
<summary>✅ v1.3 Deck Builder UX Enhancements — SHIPPED 2026-03-18</summary>

- [x] Phase 11: Search & Filter Infrastructure (CMC, type, color, fuzzy, sorting)
- [x] Phase 12: Saved Searches & Statistics (Presets, mana curve, charts)
- [x] Phase 13: Quick-Add & Performance (Keyboard nav, virtual scrolling)

</details>

<details>
<summary>🚧 v1.4 Draft/Sealed Limited Modes — PLANNING</summary>

- [ ] **Phase 14: Foundation** — Set selection, sealed core, limited deck builder, pool isolation ✓
- [ ] **Phase 15: Draft Core** — Draft state machine, timer, picker UI, pool display
- [ ] **Phase 16: AI Neighbors** — Bot simulation, passing mechanics
- [ ] **Phase 17: Play Integration** — Launch AI game with limited deck

</details>

---

## Phase Details

### Phase 14: Foundation
**Goal**: User can select a set, open sealed pools, and build limited decks from isolated pools

**Depends on**: Phase 13 (existing deck builder)

**Requirements**: SET-01, SET-02, SET-03, SEAL-01, SEAL-02, SEAL-03, SEAL-04, SEAL-05, LBld-01, LBld-02, LBld-03, LBld-04, LBld-05, LBld-06, ISOL-01, ISOL-02, ISOL-03

**Success Criteria** (what must be TRUE):
1. User can browse MTG sets sorted by release date or name and see card counts
2. User can select a set and start a sealed session that opens 6 packs immediately with all cards visible
3. User can filter sealed pool cards by color, type, and CMC within the deck builder
4. User can build a deck from sealed pool only with 40-card minimum and 4-copy limit enforced
5. Sealed pool persists across page refresh and has unique session ID
6. Limited pool cards are isolated from regular deck collection

**Plans**: 4 plans

Plans:
- [x] 14-01-PLAN.md — Foundation & Set Browser (types, set service, set browser UI) ✅
- [ ] 14-02-PLAN.md — Sealed Core (pool generation, pool storage, isolation)
- [ ] 14-03-PLAN.md — Limited Deck Builder (validator, sealed page, limited deck builder)
- [ ] 14-04-PLAN.md — Verification (human checkpoint)

---

### Phase 15: Draft Core
**Goal**: User can complete a 3-pack draft with timer and manage draft pool

**Depends on**: Phase 14

**Requirements**: DRFT-01, DRFT-02, DRFT-03, DRFT-04, DRFT-05, DRFT-06, DRFT-07, DRFT-08, DRFT-09, DRFT-10, DRFT-11

**Success Criteria** (what must be TRUE):
1. User can start a draft and receive 3 packs of 14 cards each, presented one at a time
2. Pack cards display face-down until user opens the pack to reveal contents
3. User can select one card from pack to add to draft pool, with pool viewable at all times
4. Draft timer counts down per pick with green → yellow → red visual warnings
5. Timer expiration auto-picks last hovered card or prompts user to skip
6. Draft completes after 3 packs and session persists for resumption

**Plans**: TBD

---

### Phase 16: AI Neighbors
**Goal**: User can draft against AI bot neighbors with passing mechanics

**Depends on**: Phase 15

**Requirements**: NEIB-01, NEIB-02, NEIB-03, NEIB-04, NEIB-05

**Success Criteria** (what must be TRUE):
1. User can enable AI neighbors to simulate a 2-player draft table
2. AI neighbors pick cards using heuristic logic (random for Easy, color-focused for Medium)
3. Visual indication shows when AI neighbor is actively picking
4. Pack cards animate to show passing between user and AI neighbor
5. AI neighbor difficulty is configurable before draft starts

**Plans**: TBD

---

### Phase 17: Play Integration
**Goal**: User can launch AI opponent game with completed limited deck

**Depends on**: Phase 16

**Requirements**: LPLY-01, LPLY-02, LPLY-03

**Success Criteria** (what must be TRUE):
1. User can launch AI opponent game directly from draft/sealed session with built deck
2. Limited deck format (40 cards, 4-copy limit) is validated before game starts
3. After game ends, user returns to limited session to continue or rebuild deck

**Plans**: TBD

---

## Progress Table

| Phase | Goal | Requirements | Plans Complete | Status | Completed |
|-------|------|--------------|----------------|--------|-----------|
| 14. Foundation | Set selection, sealed core, limited deck builder | 17 | 4/4 | ✓ Planned | - |
| 15. Draft Core | Draft state machine, timer, picker UI | 11 | 0/6 | Not started | - |
| 16. AI Neighbors | Bot simulation, passing mechanics | 5 | 0/5 | Not started | - |
| 17. Play Integration | Launch AI game with limited deck | 3 | 0/3 | Not started | - |

---

**Current Status**: v1.4 PLANNING 🚧

_For archived milestones, see `.planning/milestones/`_
