# Requirements: Planar Nexus v1.4 — Draft/Sealed Limited Modes

**Defined:** 2026-03-18
**Core Value:** Free open-source tabletop card game deck builder and tester with AI coaching.
**Research:** `.planning/research/SUMMARY.md` (completed 2026-03-18)

---

## v1.4 Requirements

### Set Selection

- [ ] **SET-01**: User can browse available MTG sets by name, release date, and popularity
- [ ] **SET-02**: User can select a set for Draft or Sealed from the set browser
- [ ] **SET-03**: Set selection shows card count and set details before confirming

### Draft Mode

- [ ] **DRFT-01**: User can start a new Draft session with selected set
- [ ] **DRFT-02**: Draft opens 3 packs of 14 cards each, presented one at a time
- [ ] **DRFT-03**: Pack cards display face-down until user opens the pack
- [x] **DRFT-04**: User can select one card from pack to add to draft pool
- [x] **DRFT-05**: User can view current draft pool (all picked cards)
- [ ] **DRFT-06**: Draft timer counts down per pick (configurable, default 45 seconds)
- [ ] **DRFT-07**: Timer shows visual warning states (green → yellow → red)
- [ ] **DRFT-08**: Timer expiration auto-picks last hovered card or prompts skip
- [ ] **DRFT-09**: Draft completes after 3 packs (42 cards picked)
- [ ] **DRFT-10**: Draft pool persists across page refresh
- [ ] **DRFT-11**: Draft session can be resumed if interrupted

### AI Draft Neighbors

- [ ] **NEIB-01**: User can draft against AI bot "neighbors" (simulated 2-player table)
- [ ] **NEIB-02**: AI neighbors pick cards using heuristic logic (color preference, archetype)
- [ ] **NEIB-03**: AI neighbors have difficulty levels (Easy: random, Medium: color-focused)
- [ ] **NEIB-04**: Visual indication shows when AI neighbor is "picking"
- [ ] **NEIB-05**: Pack cards visually "pass" between user and AI neighbor

### Sealed Mode

- [ ] **SEAL-01**: User can start a new Sealed session with selected set
- [ ] **SEAL-02**: Sealed opens 6 packs immediately, all cards revealed in pool
- [ ] **SEAL-03**: User can browse and filter sealed pool cards (by color, type, CMC)
- [ ] **SEAL-04**: Sealed pool persists across page refresh
- [ ] **SEAL-05**: Sealed pool can be saved and resumed

### Limited Deck Building

- [ ] **LBld-01**: User can build a deck from draft/sealed pool cards only
- [ ] **LBld-02**: Deck builder shows "Limited" filter restricting to current pool
- [ ] **LBld-03**: Deck validates 40-card minimum requirement
- [ ] **LBld-04**: Deck validates 4-copy limit per card
- [ ] **LBld-05**: Deck validates no sideboard (40-card main deck only)
- [ ] **LBld-06**: Deck can be saved and loaded for limited session

### Limited Play Integration

- [ ] **LPLY-01**: User can launch AI opponent game with built limited deck
- [ ] **LPLY-02**: Limited deck format validated before AI game starts
- [ ] **LPLY-03**: Post-game returns user to limited session

### Pool Isolation

- [ ] **ISOL-01**: Limited pool cards do not appear in regular deck collection
- [ ] **ISOL-02**: Limited pool is scoped to specific draft/sealed session
- [ ] **ISOL-03**: Limited pool has session ID and cannot be merged

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Sideboarding | Complex UX, defer to v1.5+ |
| Multiplayer Draft | Infrastructure-heavy, AI-only in v1.4 |
| Real-time multiplayer | WebSocket complexity, out of scope |
| Cube Draft | Requires content management system |
| Draft Tournament Mode | Swiss brackets, significant backend |
| Pick-by-pick AI hints | Nice-to-have, defer to v1.5 |
| Undo functionality | UX complexity, defer to v1.5 |
| Draft summary statistics | Polish, defer to v1.5 |
| Pool analysis charts | Polish, defer to v1.5 |
| Raredraft mode | Conflicts with core experience |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SET-01 | Phase 14 | Pending |
| SET-02 | Phase 14 | Pending |
| SET-03 | Phase 14 | Pending |
| DRFT-01 | Phase 15 | Pending |
| DRFT-02 | Phase 15 | Pending |
| DRFT-03 | Phase 15 | Pending |
| DRFT-04 | Phase 15 | Complete |
| DRFT-05 | Phase 15 | Complete |
| DRFT-06 | Phase 15 | Pending |
| DRFT-07 | Phase 15 | Pending |
| DRFT-08 | Phase 15 | Pending |
| DRFT-09 | Phase 15 | Pending |
| DRFT-10 | Phase 15 | Pending |
| DRFT-11 | Phase 15 | Pending |
| NEIB-01 | Phase 16 | Pending |
| NEIB-02 | Phase 16 | Pending |
| NEIB-03 | Phase 16 | Pending |
| NEIB-04 | Phase 16 | Pending |
| NEIB-05 | Phase 16 | Pending |
| SEAL-01 | Phase 14 | Pending |
| SEAL-02 | Phase 14 | Pending |
| SEAL-03 | Phase 14 | Pending |
| SEAL-04 | Phase 14 | Pending |
| SEAL-05 | Phase 14 | Pending |
| LBld-01 | Phase 14 | Pending |
| LBld-02 | Phase 14 | Pending |
| LBld-03 | Phase 14 | Pending |
| LBld-04 | Phase 14 | Pending |
| LBld-05 | Phase 14 | Pending |
| LBld-06 | Phase 14 | Pending |
| LPLY-01 | Phase 17 | Pending |
| LPLY-02 | Phase 17 | Pending |
| LPLY-03 | Phase 17 | Pending |
| ISOL-01 | Phase 14 | Pending |
| ISOL-02 | Phase 14 | Pending |
| ISOL-03 | Phase 14 | Pending |

**Coverage:**
- v1.4 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0 ✓

---

## Research Dependencies

From SUMMARY.md, flagged items to address during planning:

1. **Set-specific pack configs** — Modern MTG sets have variable card counts per pack. Need Scryfall sealed content data or manual configuration.
2. **Bot difficulty calibration** — Heuristic weights need tuning against real draft data.

---

*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 after requirements gathering*
