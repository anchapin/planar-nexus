# Feature Research: Draft/Sealed Limited Modes

**Domain:** Card Game Limited Formats
**Researched:** March 18, 2026
**Confidence:** HIGH (based on MTG Arena patterns, Draftsim documentation, official Wizards sources)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels broken.

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **Set Selection** | Users want to choose which set to draft/seal from | LOW | Scryfall API set data | Must show set images, release dates, popularity |
| **Pack Opening** | Core ritual of Limited play | LOW | Scryfall API | 14-card packs, show cards face-down until revealed |
| **Draft Pick Interface** | Picking cards one at a time | MEDIUM | Pack generation, card display | 15 picks per pack, visual indicator of pick number |
| **Draft Pool Management** | Track cards picked during draft | LOW | Card collection storage | Sortable, filterable list of drafted cards |
| **Sealed Pool Opening** | Open all packs at once | LOW | Scryfall API | 6 packs typical, immediate access to all cards |
| **Sealed Deck Builder** | Build deck from opened pool | MEDIUM | Existing deck builder | Constrained to pool cards, 40-card minimum |
| **Play with Drafted Deck** | Use the deck you built | MEDIUM | Existing single-player | Must persist limited deck, integrate with AI opponent |
| **Basic Land Auto-add** | Can't find enough basics in pool | LOW | None | Allow adding unlimited basics to sealed deck |
| **Limited Format Validation** | Ensure legal 40-card deck | LOW | Existing format validation | Limited rules (no 4x copy limit, no sideboard) |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **AI Bot Drafting (vs. Real)** | Practice unlimited times | MEDIUM | Bot algorithm can use existing AI deck generation; simulate "passing" |
| **Draft Timer with Urgency** | Creates real pressure, skill testing | MEDIUM | 40-60 seconds per pick typical; optional for casual |
| **Pick-by-Pick Hints** | AI coach integrated into draft | MEDIUM | Leverage existing AI deck coach |
| **Pool Color Analysis** | Help choose which colors to play | LOW | Show card counts by color, power level |
| **Card Pool Stats** | Visual feedback on pool strength | LOW | Mana curve, creature count, removal count |
| **Pack Probability Display** | Help understand card rarity odds | LOW | Show probability of opening specific rarities |
| **Multiple Pool Saves** | Try different deck builds | LOW | Save multiple pools, switch between them |
| **Match Record for Pool** | Track performance with specific pool | MEDIUM | Win/loss tracking tied to specific pool |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Real-time Multiplayer Draft** | Authentic experience | Complex matchmaking, must wait for 7-8 players, network sync issues | Bot draft first, add async "pod" draft later |
| **Raredraft Mode** | Maximize collection value | Ruins draft experience, conflicts with "build best deck" skill | Make separate "collection draft" mode if desired |
| **Sideboard in Sealed** | Real tournament rules | 15-card sideboard from pool clutters UI, rarely used meaningfully | Defer sideboard, or show pool-but-don't-use in separate tab |
| **True "Pack 1 Pick 1" Timer** | Real pressure | Too stressful for casual players who just want to test | Make timer optional, default to relaxed mode |
| **Set Synergy Analysis** | Help with archetype decisions | Adds complexity, can feel like hand-holding | Offer as opt-in "coach hints" feature |

## Feature Dependencies

```
Set Selection
    └──requires──> Scryfall Set Data (existing)
    └──requires──> Pack Generation Logic (new)

Pack Opening (Draft)
    └──requires──> Set Selection
    └──requires──> Card Pool Storage (new)

Draft Pick Interface
    └──requires──> Pack Opening
    └──requires──> Draft Pool (accumulating)

Sealed Pool Opening
    └──requires──> Set Selection
    └──requires──> Card Pool Storage (new)

Sealed Deck Builder
    └──requires──> Sealed Pool Opening
    └──requires──> Existing Deck Builder (modified)

Play with Limited Deck
    └──requires──> Draft Pool OR Sealed Pool
    └──requires──> Single Player (existing)

Draft Pool Stats/Coach
    └──enhances──> Draft Pick Interface
    └──enhances──> Sealed Deck Builder
```

### Dependency Notes

- **Set Selection requires Scryfall set data:** Already available via existing search; need to expose set-specific pack generation
- **Draft Pick Interface requires Pack Opening:** Sequential flow—must generate packs before allowing picks
- **Sealed Deck Builder modifies existing deck builder:** Can reuse UI components but must constrain to pool cards
- **Play with Limited Deck builds on Single Player:** Can reuse existing AI opponent system; just need to load from limited pool

## MVP Definition

### Launch With (v1.4)

Minimum viable Limited—enough to validate the feature works and is fun.

- [ ] **Set Selection Screen** — Choose which set for Limited (LOW complexity, essential UX)
- [ ] **Draft Mode with Bot "Neighbors"** — Simulate 7 AI bots passing cards (MEDIUM complexity, core draft mechanic)
- [ ] **Draft Pick Interface** — Card-by-card selection with visual feedback (MEDIUM complexity)
- [ ] **Draft Pool Display** — Show picked cards, sortable/filterable (LOW complexity)
- [ ] **Sealed Mode** — Open 6 packs, immediate pool access (LOW complexity)
- [ ] **Sealed Deck Builder** — Build 40-card deck from pool (MEDIUM complexity, reuses existing)
- [ ] **Play with Limited Deck** — Launch AI game with drafted/sealed deck (MEDIUM complexity)

### Add After Validation (v1.5+)

Features to add once core is working and user feedback is gathered.

- [ ] **Draft Timer** — Add time pressure to picks (trigger: users want more challenge)
- [ ] **Pool Coach** — AI analysis of pool during/after draft (trigger: integrate existing AI coach)
- [ ] **Pool Stats Panel** — Color distribution, mana curve, creature/ratio (trigger: users ask for deck feedback)
- [ ] **Multiple Pool Saves** — Save draft pools for later play (trigger: users want to try different builds)
- [ ] **Quick Match** — Auto-match against AI after draft (trigger: streamline play flow)

### Future Consideration (v2+)

Features to defer until PMF is established.

- [ ] **Real-time Multiplayer Pod Draft** — Live drafting with other humans (complex, infrastructure-heavy)
- [ ] **Cube Draft** — Curated card list for custom limited formats (requires content management system)
- [ ] **Draft Tournament Mode** — Swiss brackets, prizes (requires significant backend)
- [ ] **Raredraft Mode** — Collection-building priority (conflicts with core experience)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Rationale |
|---------|------------|---------------------|----------|-----------|
| Set Selection | HIGH | LOW | P1 | Entry point; must exist to do anything |
| Draft Pick Interface | HIGH | MEDIUM | P1 | Core mechanic; no draft without it |
| Draft Pool Management | MEDIUM | LOW | P1 | Essential feedback during draft |
| Sealed Pool Opening | HIGH | LOW | P1 | Simple variant of set selection + pack generation |
| Sealed Deck Builder | HIGH | MEDIUM | P1 | Core use case; reuses existing deck builder |
| Play with Limited Deck | HIGH | MEDIUM | P1 | Users expect to use what they built |
| Bot Neighbor Simulation | HIGH | MEDIUM | P1 | Makes draft possible solo; existing AI deck gen |
| Draft Timer | MEDIUM | MEDIUM | P2 | Adds tension; make optional |
| Pool Coach Integration | MEDIUM | MEDIUM | P2 | Leverage existing AI; adds value |
| Pool Stats Panel | MEDIUM | LOW | P2 | Nice feedback; low implementation cost |
| Multiple Pool Saves | LOW | MEDIUM | P3 | Nice convenience; not essential |
| Real-time Multiplayer | HIGH | HIGH | P3 | Complex; defer to v2+ |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | MTG Arena | Draftsim | Our Approach |
|---------|-----------|----------|--------------|
| **Draft Format** | Quick Draft (bots), Premier Draft (ranked), Traditional Draft (Bo3) | Bot draft, manual simulation | Bot draft for v1.4; human pods later |
| **Sealed** | Sealed events with entry fee | Free practice pools | Free sealed for all users |
| **Pack Generation** | Simulated, weighted by rarity | Real set data | Use Scryfall for accurate packs |
| **Timer** | 40s per pick, speeds up | No timer | Optional timer, default off |
| **Deck Builder UI** | Separate limited builder | Integrated with draft | Modify existing deck builder |
| **AI Coach** | Tiered subscription for advice | Free tier, AI Pro subscription | Free AI hints (leverages existing) |
| **Pool Stats** | Basic color indicator | Detailed analytics | Basic stats panel |
| **Replay/Deck Save** | Saves to collection | Saves draft pools | Save limited pools separately |

## Technical Implementation Notes

### Scryfall Integration
- Use `GET /cards/search?q=set:SET+rarity:common` to get set contents
- Pack generation: randomly sample from set (14 cards, weighted by rarity)
- Typical pack: 10 commons, 3 uncommons, 1 rare/mythic (sometimes duplicate uncommon)

### Bot Draft Simulation
- Create 7 AI "neighbors" using existing AI deck generation
- Track passed packs to simulate "left" and "right" passing
- Each bot has personality (aggressive, controlling, etc.) affecting picks
- Use existing `ai-opponent-deck-generation.ts` as foundation

### Data Model Extensions
```typescript
interface LimitedPool {
  id: string;
  type: 'draft' | 'sealed';
  setCode: string;
  cards: ScryfallCard[];  // All cards opened/picked
  createdAt: Date;
}

interface DraftState {
  pool: LimitedPool;
  currentPack: number;  // 1, 2, or 3
  currentPick: number;  // 1-15
  packsPassed: ScryfallCard[][];  // History
}
```

### Existing Code Leverage
- **Deck Builder Components:** Reuse `DeckList`, `DeckStatsPanel` with pool context
- **AI Coach:** Extend existing `AIDeckAssistant` for pool analysis
- **Single Player:** Reuse existing game flow, just load from limited pool
- **Format Validation:** Already have `limited` rules in `game-rules.ts`

## Sources

- [MTG Arena Draft Guide](https://magic.wizards.com/en/mtgarena/draft) — Official draft format documentation
- [Draftsim MTG Arena Limited Guide](https://draftsim.com/mtg-arena-limited/) — Comprehensive Arena analysis
- [Draftsim Sealed Deck Rules](https://draftsim.com/mtg-sealed-rules-tips/) — Sealed format mechanics
- [MTG Wiki Limited Formats](https://mtg.fandom.com/wiki/Limited) — Tournament rules for Limited
- [Wizards Sealed Deck Rules](https://magic.wizards.com/en/formats/sealed-deck) — Official sealed format
- [MTG Draft Bot Research (IEEE)](https://ieee-cog.org/2021/assets/papers/paper_27.pdf) — Academic paper on draft AI
- [Draftsim Bot Battle Analysis](https://draftsim.com/draftsim-bot-drafting-paper/) — Bot drafting algorithms

---
*Feature research for: Draft/Sealed Limited Modes (v1.4)*
*Researched: March 18, 2026*
