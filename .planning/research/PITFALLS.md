# Pitfalls Research: Draft/Sealed Limited Modes

**Domain:** MTG-like Deck Builder — Limited Formats
**Researched:** 2026-03-18
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Draft Pool Corruption on Interruption

**What goes wrong:**
Mid-draft connection loss, browser crash, or tab close results in partial/unrecoverable draft state. Player loses all progress through no fault of their own, with no way to resume.

**Why it happens:**
Draft state is stored only in memory or sessionStorage without server-side persistence. MTG Arena famously had this issue where "Draft completed but trying to queue me" errors left players unable to continue drafts they'd paid for.

**How to avoid:**
1. **Server-authoritative state**: Draft state MUST be persisted to server on every pick. The client is display-only.
2. **Atomic state updates**: Use transactional writes so partial failures don't corrupt state.
3. **Draft resumption tokens**: Generate a resume ID on draft start, store server-side. Allow clients to reconnect with this token.
4. **Client-side backup**: Periodically snapshot state to localStorage as emergency fallback (even if server persistence is primary).

**Warning signs:**
- Draft session IDs not being generated
- State updates not triggering async server calls
- localStorage being used as primary storage instead of fallback
- No "resume draft" flow visible in UI

**Phase to address:** Foundation Phase (v1.4) — State management architecture

---

### Pitfall 2: Timer Expiration = Auto-Pick Worst Card

**What goes wrong:**
Timer runs out during pack viewing, and system auto-selects a card (often the worst in the pack) without clear indication to the player. This feels punishing and unfair.

**Why it happens:**
Naive implementation: "if pick === null when timer expires, pick index 0" or "pick last card viewed". Timer UI shows expiration but doesn't explain the auto-pick behavior.

**How to avoid:**
1. **Last-good-state pick**: Track the "best" card the player hovered over during this pack. Auto-pick that if timer expires.
2. **Worst-case protection**: If truly no interaction, skip the pick OR randomly select from pack (better than picking the worst card by default).
3. **Clear visual warning**: At 10 seconds remaining, show prominent "PICK NOW OR SKIP" banner with the best current pick highlighted.
4. **Explicit consent**: Never auto-pick silently. Show confirmation modal if timer expires: "Skip this pick? (Timer expired)"

**Warning signs:**
- No timer warning UI below 15 seconds
- Auto-pick logic not documented in code comments
- No "skip pick" alternative exposed to player
- Player testing reports "random card was picked when I wasn't looking"

**Phase to address:** Feature Phase (v1.4) — Draft UX/Timer

---

### Pitfall 3: Pack Distribution Being "Unfair" (Perceived or Actual)

**What goes wrong:**
Players perceive that they consistently get worse packs than others, or that mythic/rare distribution is skewed. This erodes trust in the system.

**Why it happens:**
1. **Client-side generation**: If pack generation happens on client, it can be manipulated (and suspicion of manipulation breeds resentment).
2. **Poor randomization**: Using `Math.random()` without proper seed management or using predictable seeds.
3. **Non-simulated collation**: Not modeling actual MTG pack distribution (rarity slots, color distribution, mythic sheet patterns).
4. **Singleton card conflicts**: Multiple copies of cards that should be unique appearing across packs.

**How to avoid:**
1. **Server-side generation**: Pack generation MUST happen server-side with cryptographically secure randomness.
2. **Simulate collation**: Model actual MTG pack structure (e.g., 1 rare/mythic, 3 uncommons, 10 commons, 1 land/特殊slot).
3. **Card pooling**: Track which cards have been "assigned" to players in this draft to prevent duplicates.
4. **Deterministic seeding with secret**: If reproducibility is needed, use server-side seed + hidden salt.
5. **Publish distribution statistics**: In dev mode, log pack composition for testing. In production, audit that distribution matches expected rates.

**Warning signs:**
- Pack generation code running in browser
- `crypto.getRandomValues` not being used
- No collation/duplicate checking in pack generation
- Players on forums claiming "my drafts always have bad cards"

**Phase to address:** Foundation Phase (v1.4) — Pack Generation Infrastructure

---

### Pitfall 4: Pool Mixing with Regular Collection

**What goes wrong:**
Draft/Sealed pool cards get added to the player's regular collection or appear in the deck builder alongside constructed cards. Players can't tell which cards are "from limited" vs. "owned".

**Why it happens:**
1. **Shared card database**: Limited pools stored in same tables/structures as permanent collection.
2. **No pool isolation**: Deck builder doesn't filter by pool context.
3. **Persistence confusion**: Pool cards not clearly marked with expiration/event ID.
4. **Import/export leakage**: Pool cards can be exported, effectively "stealing" them from limited format.

**How to avoid:**
1. **Separate storage schemas**: Limited pools stored with explicit `poolId`, `eventId`, `expiration` fields.
2. **Pool-scoped deck builder**: When editing a limited deck, only show cards from that pool. Visual indicator "Draft Pool: Bloomburrow #1234".
3. **Time-boxed access**: Pool cards automatically become "expired" after event conclusion (with grace period).
4. **No export for pool cards**: Pool cards filtered from any export/print functionality.
5. **Visual differentiation**: Pool cards show special badge/icon in all contexts.

**Warning signs:**
- Pool cards appearing in "All Cards" filter
- No `poolId` field on stored card objects
- Export functionality doesn't check card source
- Deck builder doesn't distinguish between constructed/limited context

**Phase to address:** Foundation Phase (v1.4) — Data Model + Feature Phase (v1.4) — UI Isolation

---

### Pitfall 5: Pack "Not Arriving" (Network/State Desync)

**What goes wrong:**
Player clicks "Done" on pack but next pack never appears. UI shows spinner or blank screen. Draft appears frozen. This commonly happens with poor network conditions.

**Why it happens:**
1. **No optimistic UI with confirmation**: Client sends pick, immediately shows "waiting" but has no timeout/error handling.
2. **Silent failures**: Server rejects pick (duplicate, invalid) but client shows no error.
3. **Race conditions**: Multiple picks submitted simultaneously, server processes wrong order.
4. **AI neighbor delays**: If simulating bot picks, bot "thinking" causes perceived hang.

**How to avoid:**
1. **Explicit state machine**: Client sends pick → server confirms → server sends next pack. Show explicit "Pack 3, Pick 7" state at all times.
2. **Timeout with retry**: After 5 seconds without next pack, auto-retry with exponential backoff. Show "Checking for pack..." after 3s.
3. **Error display**: If server rejects pick, show immediate toast: "Pick failed: [reason]. Retrying..."
4. **Bot simulation isolation**: AI picks happen server-side and don't block player pack delivery.
5. **Heartbeat protocol**: Client sends heartbeat every 5s during draft. Server responds with current draft state.

**Warning signs:**
- No explicit state tracking in draft flow
- Missing error handling on server action responses
- Pack display relies solely on client-side timer
- No retry logic for failed picks

**Phase to address:** Feature Phase (v1.4) — Draft Flow State Management

---

### Pitfall 6: Sealed Pool Too Small/Too Large

**What goes wrong:**
Player opens sealed boosters but gets 5 cards instead of 6, or 50 cards instead of 6 boosters (12 packs × ~90 cards = 540). Pool is unusable for building a legal deck.

**Why it happens:**
1. **Wrong pack count config**: Default set to wrong number of boosters per sealed event.
2. **Missing slot handling**: Each "booster" actually has variable card count depending on set. Modern sets vary.
3. **Foil slot bugs**: Some sets have foil slots that double-count.
4. **Client-side rendering issues**: Preview shows correct count but actual pool is wrong after code execution.

**How to avoid:**
1. **Set-specific configs**: Store per-set pack counts, card counts, slot configurations. Use Scryfall's set data as source of truth.
2. **Verification step**: After pool generation, verify count. If unexpected, regenerate with error logging.
3. **Preview + confirm**: Show "You're about to open 6 boosters" before player clicks "Open". Player confirms before actual generation.
4. **Server-side generation**: All sealed pool generation happens server-side with explicit config validation.

**Warning signs:**
- Hard-coded booster counts in sealed logic
- No per-set configuration data
- Client-side sealed pool generation
- No verification step after pool creation

**Phase to address:** Foundation Phase (v1.4) — Sealed Infrastructure

---

### Pitfall 7: Deck Builder "Looks Done But Isn't" — Limited Mode

**What goes wrong:**
Deck builder appears functional but missing critical limited-specific features:
- No deck count validation (40 cards minimum)
- No card quantity limits visible (4 copies max)
- No mana curve display for limited
- Sideboard not properly handled (limited typically has NO sideboard)

**Why it happens:**
Reusing constructed deck builder without adapting for limited rules. Limited has different constraints than constructed.

**How to avoid:**
1. **Dedicated limited deck validator**: Apply `DEFAULT_RULES.limited` validation rules:
   - Minimum 40 cards
   - Maximum 4 copies per card (except basic lands)
   - No sideboard (or sideboard = 0)
   - Exactly 1 commander not applicable
2. **Visual feedback**: Show "40/40 cards" prominently. Red warning if below minimum.
3. **Mana curve chart**: Limited is curve-dependent. Show mana curve histogram.
4. **Pool completion**: Show "14 cards remaining in pool" so player knows they're not missing cards.
5. **Color identity warning**: If pool only has blue cards but deck has red mana symbols, show warning.

**Warning signs:**
- Deck builder shares 100% code with constructed mode
- No `validateDeckForFormat()` function accepting limited
- Sideboard UI present in sealed mode
- No mana curve visualization

**Phase to address:** Feature Phase (v1.4) — Limited Deck Builder

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Client-side pack generation | Faster dev, no server needed | Manipulable, perceived unfairness | Never in production |
| localStorage for draft state | Simple persistence | 5MB limit, vulnerable to clear, no server sync | Only as emergency fallback |
| Single shared card pool table | Simpler schema | Pool isolation bugs, export leakage | Only with explicit `poolId` + `isLimited` flags |
| Reuse constructed deck builder | Code reuse | Missing limited validations | Only with format-aware wrapper |
| Timer client-side only | No server sync needed | Desync with server state | Never — use server as source of truth |
| Hard-coded pack counts | Quick to implement | Breaks on new sets | Never — use Scryfall config |
| AI picks instant | No delay UX | AI doesn't feel "real" | Only with visual "thinking" animation |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| **Scryfall API** | Querying all cards per pack without caching | Cache set data; query only unique card IDs |
| **AI (existing)** | AI draft assistant suggests cards player doesn't have | AI suggestions filtered to current pool only |
| **Deck storage** | Saving pool cards as "owned" collection | Save pool with `eventId` + `expiresAt` |
| **P2P signaling** | Draft requires server coordination, not P2P | Dedicated server-side draft coordinator; P2P only for games |
| **Game engine** | Game state initialized without format context | Pass `gameMode: 'limited'` to game initialization |
| **Achievement tracking** | Counting pool cards toward "collection complete" | Filter achievements by `isLimited: false` |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| **Pack preview rendering** | 15 cards × 6 packs × 3 views = 270 card renders | Virtual scrolling; render only visible cards | On mid-range devices |
| **Pool card search** | Pool search slow when 300+ cards | Index pool cards in-memory; use Web Worker for search | Sealed with 500+ cards |
| **Real-time draft sync** | Multiple players' picks causing UI flicker | Optimistic updates; reconcile on server confirmation | 4+ player drafts |
| **State serialization** | Large draft state exceeds localStorage | Use IndexedDB; compress state if needed | Long drafts (8+ players) |
| **AI pick calculation** | AI analysis of 300-card pool is slow | Async AI calls; timeout after 2s with default pick | Complex AI heuristics |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| **Client-controllable packs** | Player manipulates client to get better packs | Server-side generation only; verify client has no influence |
| **Draft state injection** | Malicious client sends invalid pick data | Validate pick at server: card exists, player has slot, not already picked |
| **Pool expiration bypass** | Client modifies expiration to keep pool cards | Server enforces expiration; client is read-only |
| **Pack seeding attack** | Predictable RNG seed lets player pre-compute packs | Use CSPRNG; server-side seed with hidden salt |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|------------------|
| **No "back" navigation** | Player can't review previous picks | Swipe/scroll through past packs with "Pack 1 Pick 7: Lightning Bolt" history |
| **Timer pressure without feedback** | Stressful, panicky feeling | Visual countdown, color shift (green→yellow→red), pulse animation at 10s |
| **AI neighbors invisible** | Draft feels like single-player | Show "Seat 2 (Bot) is picking..." with bot name/avatar |
| **Pool cards not highlighted** | Can't tell which cards are from draft | All pool cards have colored border/badge matching draft event |
| **Confusing "Add to Deck" vs "Keep"** | Player doesn't know what button does | Explicit "Keep this card" vs "Add to Deck" in separate pool view |
| **No draft summary at end** | Player can't review how draft went | Show summary: "Picks by color", "Notable cards passed", "Your deck's strength rating" |
| **Sealed "Open All" traps** | Player opens all packs, forgets to track | Sequential pack opening with "Lock Pool" confirmation between packs |

---

## "Looks Done But Isn't" Checklist

- [ ] **Draft Timer:** Timer visible, has warning states (10s, 5s), shows what happens on expiration
- [ ] **Pack Navigation:** Can scroll back to see previous packs/picks easily
- [ ] **Pool Display:** Pool cards visually distinguished from collection cards
- [ ] **Deck Validation:** 40-card minimum enforced, <40 shows warning
- [ ] **Card Quantities:** Shows "4/4" for copies, warns at limit
- [ ] **Mana Curve:** Limited deck builder shows mana curve chart
- [ ] **No Sideboard:** Limited mode hides sideboard UI (or shows 0)
- [ ] **Draft Resume:** Can reconnect to interrupted draft
- [ ] **AI Visualization:** Bot picks visible, not invisible black box
- [ ] **Pack Count:** Clear "Pack 2 of 3" indicator
- [ ] **Pool Expiration:** Clear indication that pool is temporary
- [ ] **Summary Screen:** Post-draft shows pick breakdown, deck rating

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Pool corruption | HIGH | Server-side state prevents; if client-only: show "Restore from backup?" using localStorage snapshot |
| Timer auto-pick wrong card | MEDIUM | Allow "Undo Last Pick" within 10s of auto-pick if draft still in progress |
| Pack never arrives | LOW | Client auto-retries; shows "Waiting..." then timeout error with manual retry button |
| Deck invalid on submit | LOW | Show specific validation errors; auto-suggest fixes ("Remove 3 cards to reach 40") |
| Network disconnect mid-draft | MEDIUM | Draft pauses server-side; reconnect shows "Rejoin Draft" with current state |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Pool corruption on interruption | Foundation: Draft State Architecture | Test by killing browser mid-draft, reconnecting should restore state |
| Timer auto-pick worst card | Feature: Draft UX/Timer | UX testing with timeouts; verify auto-pick is not worst card |
| Pack distribution unfair | Foundation: Pack Generation | Log pack composition; verify rarity distribution matches Scryfall rates |
| Pool mixing with collection | Foundation: Data Model | Query pool cards should not appear in collection filters |
| Pack not arriving | Foundation: Draft State Machine | Network throttling test; verify timeout + retry works |
| Sealed pool count wrong | Foundation: Sealed Infrastructure | Test with multiple sets; verify card count matches expected |
| Deck builder limited mode | Feature: Limited Deck Builder | Build sealed deck <40 cards, should show warning |
| Card quantity warnings | Feature: Limited Deck Builder | Add 5th copy of card, should show error |
| Sideboard in limited | Feature: Limited Deck Builder | Sealed mode should not show sideboard UI |
| Mana curve for limited | Feature: Limited Deck Builder | Limited deck should show mana curve chart |

---

## Sources

- [MTG Arena Known Issues List](https://mtgarena-support.wizards.com/hc/en-us/articles/360000091646-Known-Issues-List) (HIGH)
- [MTG Arena Draft Disabled Due to Server Issues](https://gamerant.com/mtg-arena-down-server-status-december-2025/) (MEDIUM)
- [Draftsim — Arena's New Pick-Two Format Fumbles](https://draftsim.com/pick-two-draft-problems/) (MEDIUM)
- [MTG Arena Limited Championship Qualifier Flaws](https://draftsim.com/arena-limited-championship-flaws/) (MEDIUM)
- [MTG Sealed Deck Tips](https://draftsim.com/mtg-sealed-rules-tips/) (MEDIUM)
- [MTG Arena Draft Guide](https://draftsim.com/mtg-arena-draft-guide/) (MEDIUM)
- [mtgjson/mtg-sealed-content](https://github.com/mtgjson/mtg-sealed-content) (HIGH — data structure reference)
- [taw/magic-sealed-data](https://github.com/taw/magic-sealed-data) (HIGH — pack generation specs)
- [MTG Arena Community Feedback Forum](https://feedback.wizards.com/forums/918667-mtg-arena-bugs-product-suggestions/) (MEDIUM — real bug reports)

---

## Existing Project Context

From existing codebase analysis:

| File | Relevant Findings |
|------|-------------------|
| `src/ai/flows/ai-draft-assistant.ts` | Already has heuristic-based draft picks, sealed building, pool analysis. These are CLIENT-SIDE only — needs server-side verification for multiplayer. |
| `src/lib/game-rules.ts` | Has `DEFAULT_RULES.limited` defined: 40 min cards, 4 max copies, no sideboard. Already wired for limited format. |
| `src/lib/tournament-events.ts` | Has `EventFormat` type with 'draft' | 'sealed' options. Display names and colors defined. |
| `src/lib/indexeddb-storage.ts` | Strong IndexedDB foundation for persistence. Should be used for draft state, not localStorage. |
| `src/hooks/use-auto-save.ts` | Auto-save infrastructure exists — can be leveraged for draft state snapshots. |

### Key Gap Identified

**The existing `ai-draft-assistant.ts` runs CLIENT-SIDE heuristics.** For multiplayer draft, this must be supplemented with:
1. Server-authoritative pack generation
2. Server-side state machine for draft progression
3. AI pick integration that simulates bot neighbors (existing heuristics can power this)

---

*Pitfalls research for: Draft/Sealed Limited Modes v1.4*
*Researched: 2026-03-18*
