# Deep QA/QC Review Report

**Date:** 2026-04-24
**Scope:** Full codebase (`src/`, `e2e/`)
**Method:** Parallel expert review across 4 domains (Game State, AI/P2P, React UI, Data Layer)

---

## Overall Health

| Check | Status |
|-------|--------|
| Unit Tests (Jest) | 94 suites, 1956 passed, 0 failed |
| TypeCheck (`tsc --noEmit`) | Clean |
| Lint (`eslint`) | 0 errors, 640 warnings |

**Verdict:** Tests and types pass, but significant correctness bugs exist in production code that are NOT caught by the current test suite.

---

## Critical Issues (12)

### Game State (6 Critical)

| # | File | Line | Issue | Fix |
|---|------|------|-------|-----|
| GS-C1 | `state-based-actions.ts` | 50, 273 | **State mutation bug**: Shallow copy `{ ...state }` then mutates original `state.cards` Map | `let updatedState = { ...state, cards: new Map(state.cards) };` |
| GS-C2 | `combat.ts` | 462-475 | **Deathtouch logic inverted**: Checks `blockerHasDeathtouch` instead of `attackerHasDeathtouch` for lethal assignment | Replace with `attackerHasDeathtouch` |
| GS-C3 | `combat.ts` | 385-386, 411-442 | **Double-strike damage miscalculated**: Lifelink & commander damage use `attackerPower` instead of `totalDamage` (power * 2) | Use `totalDamage` variable |
| GS-C4 | `spell-casting.ts` | 326-328 | **Countered spells orphaned**: Countered spell removed from stack but never moved out of stack zone | Move card to graveyard before `removeFromStack` |
| GS-C5 | `state-based-actions.ts` | 304-341, 390-429 | **Legendary/Planeswalker rules global not per-player**: Destroys duplicates across ALL players | Group by `(controllerId, name)` |
| GS-C6 | `game-state.ts` | 428-456 | **Stub `checkStateBasedActions` never destroys creatures**: Sets flag but never moves cards | Remove stub or implement destroy logic |

### AI & P2P (2 Critical)

| # | File | Line | Issue | Fix |
|---|------|------|-------|-----|
| AI-C1 | `ai/game-state-evaluator.ts` | 324-331, 346-360, etc. | **Division by zero**: 10+ methods divide by `opponents.length` without zero guard | Add `if (opponents.length === 0) return 0;` |
| P2P-C1 | `hooks/use-p2p-connection.ts` | 431-443 | **Checksum algorithm mismatch**: Hook uses DJB2, `p2p-handshake.ts` uses CRC32 — handshake always fails | Use shared `verifyChecksum` from `p2p-handshake.ts` |

### Data Layer (3 Critical)

| # | File | Line | Issue | Fix |
|---|------|------|-------|-----|
| DL-C1 | `lib/indexeddb-storage.ts` | 352 | **`setAll` doesn't abort on failure**: Partial writes on individual `put` failure | Abort transaction on error |
| DL-C2 | `lib/indexeddb-storage.ts` | 640 | **`importBackup` non-atomic**: Clears stores then repopulates; mid-failure = data loss | Wrap in single transaction |
| DL-C3 | `lib/indexeddb-storage.ts` | 803 | **Migration writes unvalidated data**: Parses localStorage JSON without schema validation | Add Zod/runtime validation before write |

### React UI (1 Critical)

| # | File | Line | Issue | Fix |
|---|------|------|-------|-----|
| UI-C1 | `components/game-board.tsx` | 394 | **Nested component remount**: `ZoneDisplayLocal` defined INSIDE `PlayerArea` — full remount on every render | Move outside component or inline JSX |

---

## High Priority Issues (41)

### Game State (10 High)

| # | File | Line | Issue |
|---|------|------|-------|
| GS-H1 | `game-state.ts` | 273-277 | `passPriority` crashes on null `priorityPlayerId` |
| GS-H2 | `player-actions.ts` | 104-141 | Empty library draw is silent (no player loss) |
| GS-H3 | `combat.ts` | 143-159 | `declareAttackers` wrongly accepts `begin_combat` phase |
| GS-H4 | `state-based-actions.ts` | 167-181 | 0-loyalty planeswalkers exiled instead of destroyed |
| GS-H5 | `keyword-actions.ts` | 125-217 | Exile doesn't detach equipment/auras |
| GS-H6 | `keyword-actions.ts` | 76-119 | Regeneration shields ignored by `destroyCard` |
| GS-H7 | `abilities.ts` | 359-377 | 0-cost loyalty abilities not parsed (`0:`) |
| GS-H8 | `validation-service.ts` | 395-401 | Summoning sickness blocks ALL tapping (should only block `{T}` cost) |
| GS-H9 | `combat.ts` | 388-392 | Planeswalker combat damage not applied (loyalty not reduced) |
| GS-H10 | `game-state.ts` | 237-283 | Dead players still receive priority |

### AI & P2P (10 High)

| # | File | Line | Issue |
|---|------|------|-------|
| AI-H1 | `ai/decision-making/combat-decision-tree.ts` | 1488 | Keyword typo: `.double_strike` (leading dot) |
| AI-H2 | `ai/ai-action-executor.ts` | 280-329 | Block action is no-op (returns unmodified state) |
| AI-H3 | `ai/worker/ai-worker-client.ts` | 10-79 | Worker singleton leak (`instance` never reset) |
| AI-H4 | `ai/stack-interaction-ai.ts` | 1334-1362 | Incorrect target scoring (accesses non-existent `.battlefield`) |
| P2P-H1 | `lib/p2p-conflict-resolution.ts` | 110-202 | Unbounded `processedActions` Map (memory leak) |
| P2P-H2 | `lib/p2p-direct-connection.ts` | 153-158 | Uncleaned global interval (leaks for page lifetime) |
| P2P-H3 | `lib/webrtc-p2p.ts` | 441-448 | Pending ICE candidates never processed |
| P2P-H4 | `lib/connection-fallback.ts` | 195-199 | Race: premature `activeConnection = 'webrtc'` assignment |
| P2P-H5 | `lib/webrtc-p2p.ts` | 332-342, 714-723 | Fire-and-forget async handlers (state machine races) |
| P2P-H6 | `lib/p2p-handshake.ts` | 162-171, 214-225 | Weak hash: `hash = hash & hash` is a no-op |

### React UI (5 High)

| # | File | Line | Issue |
|---|------|------|-------|
| UI-H1 | `app/(app)/game/[id]/page.tsx` | 1319-1642 | Stale closure in AI turn effect |
| UI-H2 | `app/(app)/game/[id]/page.tsx` | 1644-1698 | Auto-pass effect fires on every state change |
| UI-H3 | `app/(app)/game/[id]/page.tsx` | 3334-3387 | Expensive UI conversions recomputed every render |
| UI-H4 | `hooks/use-p2p-connection.ts` | 125 | Connection health interval recreated constantly |
| UI-H5 | `hooks/use-p2p-connection.ts` | 166-179 | Stale closure in P2P event handlers |

### Data Layer (16 High)

| # | File | Line | Issue |
|---|------|------|-------|
| DL-H1 | `lib/state-based-actions.ts` | 273 | Mutates nested Maps inside shallow copies |
| DL-H2 | `lib/replacement-effects.ts` | — | Global singleton leaks state across game instances |
| DL-H3 | `lib/deck-storage.ts` | — | Boolean `initialized` flag without promise dedup (race) |
| DL-H4 | `lib/saved-games.ts` | — | Boolean `initialized` flag without promise dedup (race) |
| DL-H5 | `lib/client-card-operations.ts` | — | Unsafe `as` assertions mask runtime failures |
| DL-H6 | `lib/ai-proxy-client.ts` | — | Unsafe `as` assertions |
| DL-H7 | `lib/p2p-direct-connection.ts` | — | Unsafe `as` assertions |
| DL-H8 | `lib/deterministic-sync.ts` | — | Unsafe `as` assertions |
| DL-H9 | `app/api/chat/route.ts` | — | No runtime payload validation |
| DL-H10 | `app/api/signaling/route.ts` | — | No runtime payload validation |
| DL-H11 | `app/api/ai-proxy/route.ts` | — | No runtime payload validation |
| DL-H12 | `lib/deck-storage.ts` | — | `JSON.parse` + `as Type` without schema check |
| DL-H13 | `lib/saved-games.ts` | — | `JSON.parse` + `as Type` without schema check |
| DL-H14 | `lib/custom-card-storage.ts` | — | `JSON.parse` + `as Type` without schema check |
| DL-H15 | `lib/card-database.ts` | — | `JSON.parse` + `as Type` without schema check |
| DL-H16 | `app/api/deck-import/route.ts` | — | Parses external HTML/JSON with `any` and no sanitization |

---

## Medium Priority Issues (38)

### Game State (10 Medium)

| # | File | Line | Issue |
|---|------|------|-------|
| GS-M1 | `mana.ts` | 33-64, 74-203 | Negative mana values accepted |
| GS-M2 | `game-state.ts` | 307-308 | Fragile turn-wrap detection (reference equality) |
| GS-M3 | `card-instance.ts` | 11-13, 34-36 | Non-deterministic IDs (`Date.now()` + `Math.random()`) |
| GS-M4 | `turn-phases.ts` | 134-146 | `advancePhase` returns same object at cleanup (obscure contract) |
| GS-M5 | `oracle-text-parser.ts` | 449-451, 457-478 | False-positive keywords (`lifeline`, `reacher`, etc.) |
| GS-M6 | `validation-service.ts` | 185-240 | X and kicker costs ignored during validation |
| GS-M7 | `combat.ts` | 520-548 | Blocker first strike ignored |
| GS-M8 | `game-state.ts` | 141-148 | Format hardcoded to `"standard"` |
| GS-M9 | `zones.ts` | 125-147 | Unchecked numeric position in `addCardToZone` |
| GS-M10 | `mana.ts` | 298-304 | Mana empties at phase start, not end |

### AI & P2P (10 Medium)

| # | File | Line | Issue |
|---|------|------|-------|
| AI-M1 | `ai/ai-gameplay-assistance.ts` | 362-373 | Metrics mapped from normalized scores, not actual counts |
| AI-M2 | `ai/ai-gameplay-assistance.ts` | 369-370 | Hardcoded opponent stats (`5`, `5`) |
| AI-M3 | `ai/game-state-evaluator.ts` | 365-381 | Hand quality divide-by-zero (race condition) |
| AI-M4 | `ai/flows/ai-deck-coach-review.ts` | 137 | `crypto.randomUUID()` crashes in non-secure contexts |
| AI-M5 | `ai/stack-interaction-ai.ts` | 1404-1411 | Mana calc reads non-existent `.manaAvailable` |
| AI-M6 | `ai/decision-making/combat-decision-tree.ts` | 1451 | Potential null access in multi-block |
| P2P-M1 | `lib/p2p-handshake.ts` | 230-234 | `crypto.getRandomValues()` crashes in non-secure HTTP |
| P2P-M2 | `lib/p2p-game-connection.ts` | 429-466 | Message double-dispatch (fires both specific and catch-all) |
| P2P-M3 | `lib/connection-fallback.ts` | 186-187 | Promise resolution race in fallback |
| P2P-M4 | `lib/p2p-conflict-resolution.ts` | 454-475 | Merge action ID collision |
| P2P-M5 | `lib/webrtc-p2p.ts` | 802-809 | Silent message drop (no queue/retry) |
| P2P-M6 | `lib/p2p-signaling-client.ts` | 113-125 | Client generates wrong game code (ignores host's) |
| P2P-M7 | `lib/websocket-connection.ts` | 395-402 | Unbounded message queue |
| P2P-M8 | `hooks/use-p2p-connection.ts` | 95-107, 189-195 | Handshake session race condition |

### React UI (7 Medium)

| # | File | Line | Issue |
|---|------|------|-------|
| UI-M1 | `app/(app)/game/[id]/page.tsx` | 1302-1316 | Auto-save interval recreated on every state change |
| UI-M2 | `app/(app)/game/[id]/page.tsx` | 1109-1299 | Game init won't re-init on param changes |
| UI-M3 | `app/(app)/game/[id]/page.tsx` | 2485, 2529 | Uncleared timeouts in async handlers |
| UI-M4 | `hooks/use-game-sounds.ts` | 192 | AudioContext never closed on unmount |
| UI-M5 | `hooks/use-turn-timer.ts` | 61 | Timer interval recreated every tick |
| UI-M6 | `hooks/use-draft-timer.ts` | 139 | Timer interval recreated every tick |
| UI-M7 | `hooks/use-draft-timer.ts` | 142-147 | Draft timer expire callback can fire multiple times |

### Data Layer (11 Medium)

*(Covered in High section as part of broader patterns)*

---

## Low Priority Issues (24)

### Game State (7 Low)

| # | File | Line | Issue |
|---|------|------|-------|
| GS-L1 | `game-state.test.ts` | 36 | `createMockCard` returns `any` |
| GS-L2 | `card-instance.ts` | 423-426 | Unsafe CMC type assertion |
| GS-L3 | `combat.ts` | 77-79 | No defender validation for planeswalkers |
| GS-L4 | `mana.ts` | 282-372 | `playLand` doesn't reset `consecutivePasses` |
| GS-L5 | `card-instance.ts` | 36-50 | Summoning sickness on non-permanents |
| GS-L6 | `combat.ts` | 183-202 | Missing `canAttack` result for invalid attackers |
| GS-L7 | `deterministic-sync.ts` | 391-395 | Empty `lastKnownStateHash` masks desync |

### AI & P2P (7 Low)

| # | File | Line | Issue |
|---|------|------|-------|
| AI-L1 | `ai/stack-interaction-ai.ts` | 1452 | Duplicate condition `includes('life')` |
| AI-L2 | `ai/ai-turn-loop.ts` | 639-641 | Missing delay cleanup |
| AI-L3 | `ai/game-state-evaluator.ts` | 93-178 | `DefaultWeights` uses `Record<string, ...>` |
| P2P-L1 | `lib/p2p-game-connection.ts` | 481-507 | `createBaseEngineState` returns `any` |
| P2P-L2 | `lib/p2p-direct-connection.ts` | 279-289 | Monkey-patching connection handler |
| P2P-L3 | `lib/local-signaling-client.ts` | 220-224 | Sequential ICE candidate adding |
| P2P-L4 | `lib/p2p-game-connection.ts` | 371-378 | Ping without channel check |
| P2P-L5 | `lib/connection-fallback.ts` | 86 | `process.env` access at runtime |

### React UI (5 Low)

| # | File | Line | Issue |
|---|------|------|-------|
| UI-L1 | `app/(app)/single-player/page.tsx` | 79 | Unnecessary `useMemo` for empty array |
| UI-L2 | `components/combat-declaration.tsx` | 186-312 | Render helper functions recreated every render |
| UI-L3 | `app/(app)/game/[id]/page.tsx` | 1072-1096 | Hand sync effect runs on every state change |
| UI-L4 | `app/(app)/game/[id]/page.tsx` | 3531-3595 | Mana pool IIFE recomputed every render |
| UI-L5 | `components/game-board.tsx` | 598 | Internal damage hook called unnecessarily |

---

## Test Coverage Holes

| Missing Test | Why It Matters |
|--------------|----------------|
| State mutation idempotency | `checkStateBasedActions` mutates input; no immutability test |
| Empty library during `startGame` | Deck < 7 cards = silent failure |
| Countered spell zone cleanup | Card stays in stack zone forever |
| Deathtouch attacker + trample | Inversion bug completely hidden |
| Double-strike + lifelink/commander | Only player life tested, not lifelink gain |
| Legendary rule with multiple controllers | Global vs per-player bug undetected |
| Planeswalker uniqueness with multiple controllers | Same as above |
| `passPriority` with dead players | 3+ player games untested |
| `advancePhase` edge cases | Cleanup→new turn with extra turns untested |
| Regeneration shield consumption | Never invoked by `destroyCard` |
| Negative mana inputs | `addMana`/`spendMana` untested for negatives |
| 0-cost loyalty abilities | No test for `0:` abilities |
| `drawWithSBAChecking` integration | Never wired into actual draw pipeline |

---

## Top 10 Quick Wins (Highest Impact / Lowest Effort)

1. **Fix state mutation** (`state-based-actions.ts:50`) — 1 line
2. **Fix deathtouch inversion** (`combat.ts:473`) — 1 word
3. **Fix double-strike lifelink/commander** (`combat.ts:411-442`) — use existing var
4. **Fix countered spell cleanup** (`spell-casting.ts:326-328`) — move to graveyard
5. **Fix legendary/planeswalker per-player scope** (`state-based-actions.ts`) — group by controller
6. **Fix empty-library draw** (`player-actions.ts:104-141`) — return loss state
7. **Fix AI division by zero** (`game-state-evaluator.ts`) — add length guard
8. **Fix P2P checksum mismatch** (`use-p2p-connection.ts`) — import shared function
9. **Fix nested component remount** (`game-board.tsx:394`) — move outside
10. **Fix 0-cost loyalty regex** (`abilities.ts:359-377`) — make sign optional

---

## Error Boundary Gaps

18 routes lack dedicated error boundaries (relying only on root fallback):
- `/single-player`, `/multiplayer/*`, `/draft/*`, `/deck-builder`, `/collection`, `/dashboard`, `/settings`, `/card-studio`, `/saved-games`, `/spectator`, `/trade`, `/matchup`, `/strategy`, `/sideboards`, `/sealed`, `/game-board`

**Root boundary cannot catch:** event handler errors, async callback errors, `setTimeout`/`setInterval` errors.
