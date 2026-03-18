# Planar Nexus — v1.3 Requirements (Deck Builder UX Enhancements)

**Milestone:** v1.3  
**Goal**: Improve deck building experience with advanced search, filtering, and deck analysis tools.

---

## SEARCH: Advanced Search

### SEARCH-01: Multi-Attribute Search Filters
- [ ] Filter cards by CMC (converted mana cost) — exact match and ranges
- [ ] Filter by card type (Creature, Instant, Sorcery, Enchantment, Artifact, Planeswalker, Land)
- [ ] Filter by subtype/supertype
- [ ] Filter by rarity (Common, Uncommon, Rare, Mythic)
- [ ] Filter by set ( expansion symbol)

### SEARCH-02: Color and Identity Filters
- [ ] Filter by exact color identity (W, U, B, R, G, multicolor)
- [ ] Filter by color combination (e.g., "at least these colors")
- [ ] Commander color identity filter (respects WUBRG rules)

### SEARCH-03: Power/Toughness Filters
- [ ] Filter creatures by power range
- [ ] Filter creatures by toughness range
- [ ] Combined P/T search (e.g., "power >= 3")

### SEARCH-04: Format Legality Filter
- [ ] Filter by format legality (Standard, Modern, Commander, Legacy, Vintage, Pauper)
- [ ] Show format legality badges on cards

---

## FUZZY: Fuzzy Search

### FUZZY-01: Typo-Tolerant Search
- [ ] Accept minor typos in card names (Levenshtein distance <= 2)
- [ ] Configurable fuzzy threshold in settings

### FUZZY-02: Partial Matching
- [ ] Match partial words in card names ("bolt" finds "Lightning Bolt")
- [ ] Match partial words in card text

### FUZZY-03: Synonym Matching
- [ ] Map common synonyms (e.g., "draw" finds "draw a card" effects)
- [ ] Handle alternate card names and promos

---

## SAVED: Saved Searches

### SAVED-01: Search Presets
- [ ] Save current filter configuration as named preset
- [ ] Load saved presets from dropdown
- [ ] Delete saved presets
- [ ] Presets persist in IndexedDB

### SAVED-02: Quick Access Presets
- [ ] Built-in presets for common searches (e.g., "Creatures under 3 mana")
- [ ] One-click preset application

---

## SORT: Enhanced Sorting

### SORT-01: Multi-Sort Options
- [ ] Sort by CMC (ascending/descending)
- [ ] Sort by color
- [ ] Sort by type
- [ ] Sort by rarity (color-coded)
- [ ] Sort by set (alphabetical or by release date)
- [ ] Sort by name (alphabetical)
- [ ] Sort by power/toughness

### SORT-02: Sort Persistence
- [ ] Remember last used sort preference
- [ ] Sort preference persists across sessions

---

## STATS: Deck Statistics

### STATS-01: Mana Curve Display
- [x] Visual bar chart of mana costs in deck
- [x] Separate curves for lands vs non-lands
- [x] Interactive — click bar to filter

### STATS-02: Card Type Breakdown
- [x] Pie/bar chart showing distribution (Creatures, Instants, Sorceries, etc.)
- [x] Count and percentage for each type
- [x] Legend with click-to-filter

### STATS-03: Color Distribution
- [x] Visual representation of color mana requirements
- [x] Color pie showing mana production vs color costs

---

## QUICK: Quick-Add Features

### QUICK-01: Keyboard Shortcuts
- [ ] Hotkey to add card from search to deck (e.g., Enter key)
- [ ] Hotkey to toggle search results
- [ ] Arrow key navigation in search results

### QUICK-02: One-Click Add
- [ ] Click card in results to add directly to deck
- [ ] Shift+Click to add 4-of (or maximum allowed)
- [ ] Visual feedback on add (flash/highlight)

---

## Technical Requirements

### REQ-T7: Search Performance
- [ ] Search results appear in <100ms for local database
- [ ] Filter application feels instant (<50ms UI update)
- [ ] Smooth scrolling with 100+ results

### REQ-T8: UI Responsiveness
- [ ] No jank during filter changes
- [ ] Virtual scrolling for large result sets
- [ ] Debounced search input (300ms)

---

## Future Requirements

- **REQ-16**: Draft/Sealed Game Mode (v1.4)
- **REQ-17**: Tournament Support (v1.4)
- **REQ-18**: Multiplayer (v2.0)
- **REQ-19**: Social Features (v2.0)

---

## Out of Scope (v1.3)

- Online card trading
- Price/scryfall data integration
- Deck sharing via link
- Export to other formats (beyond current support)

---

## Requirements Traceability

| Requirement | Status | Phase | Plans |
|-------------|--------|-------|-------|
| SEARCH-01: Multi-Attribute Search Filters | ⬜ Pending | Phase 11 | - |
| SEARCH-02: Color and Identity Filters | ⬜ Pending | Phase 11 | - |
| SEARCH-03: Power/Toughness Filters | ⬜ Pending | Phase 11 | - |
| SEARCH-04: Format Legality Filter | ⬜ Pending | Phase 11 | - |
| FUZZY-01: Typo-Tolerant Search | ⬜ Pending | Phase 11 | - |
| FUZZY-02: Partial Matching | ⬜ Pending | Phase 11 | - |
| FUZZY-03: Synonym Matching | ⬜ Pending | Phase 11 | - |
| SORT-01: Multi-Sort Options | ⬜ Pending | Phase 11 | - |
| SORT-02: Sort Persistence | ⬜ Pending | Phase 11 | - |
| SAVED-01: Search Presets | ⬜ Pending | Phase 12 | - |
| SAVED-02: Quick Access Presets | ⬜ Pending | Phase 12 | - |
| STATS-01: Mana Curve Display | ✅ Complete | Phase 12-03 | 2026-03-18 |
| STATS-02: Card Type Breakdown | ✅ Complete | Phase 12-03 | 2026-03-18 |
| STATS-03: Color Distribution | ✅ Complete | Phase 12-03 | 2026-03-18 |
| QUICK-01: Keyboard Shortcuts | ⬜ Pending | Phase 13 | - |
| QUICK-02: One-Click Add | ⬜ Pending | Phase 13 | - |
| REQ-T7: Search Performance | ⬜ Pending | Phase 13 | - |
| REQ-T8: UI Responsiveness | ⬜ Pending | Phase 13 | - |

---

**Last Updated**: 2026-03-17 for v1.3 roadmap initialization
