# Planar Nexus — v1.2 Requirements (Custom Card Creation Studio)

**Milestone:** v1.2  
**Goal**: Enable users to create, save, and playtest custom cards with a full WYSIWYG editor.

---

## REQ-6: Card Studio Foundation

### REQ-6.1: Custom Card Schema
- [ ] Define `CustomCard` interface extending `MinimalCard`
- [ ] Support custom artwork uploads/blob storage
- [ ] Store editor-specific metadata (layout, font choices)

### REQ-6.2: Asset Management
- [ ] Implement local storage for custom card images
- [ ] Handle asset cleanup for deleted cards
- [ ] Support export/import of custom card packages

---

## REQ-7: WYSIWYG Editor

### REQ-7.1: Interactive Card Preview
- [ ] Real-time rendering of card data on template
- [ ] Support multiple layouts (Standard, Saga, Planeswalker)
- [ ] Text overflow handling and auto-scaling

### REQ-7.2: Editor Controls
- [ ] Field-by-field editing (Name, Mana, Type, Text, P/T)
- [ ] Image cropping and scaling tools
- [ ] Frame color and mana symbol picker

---

## REQ-8: Custom Card Integration

### REQ-8.1: Deck Builder Support
- [ ] Filter by "Custom" source in card browser
- [ ] Add custom cards to decks with validation
- [ ] Warning for decks containing un-validated custom cards

### REQ-8.2: Game Engine Support
- [ ] Load custom card data into GameState
- [ ] Simple keyword parsing for custom text
- [ ] Support custom cards in AI playtesting

---

## Technical Requirements

### REQ-T5: Editor Performance
- [ ] Render updates in <50ms
- [ ] Image processing done on-client via Canvas/WebAssembly

---

## Requirements Traceability

| Requirement | Status | Phase | Plans |
|-------------|--------|-------|-------|
| REQ-6: Foundation | ⚪ 0% | Phase 6 | - |
| REQ-7: Editor UI | ⚪ 0% | Phase 7 | - |
| REQ-8: Integration | ⚪ 0% | Phase 8 | - |

---

**Last Updated**: 2026-03-17 after v1.1 milestone completion
