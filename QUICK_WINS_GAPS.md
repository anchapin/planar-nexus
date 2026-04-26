# Quick-Win Gaps & Future To-Dos

**Generated:** 2026-04-24
**Scope:** `/home/alex/Projects/planar-nexus/src/`

---

## 🔥 Highest Priority Quick Wins

### 1. Strip 90+ `console.log` Statements from Production Code
**Effort:** Tiny | **Impact:** High

Files with the most noise:
- `src/lib/webrtc-p2p.ts` — 25 logs (ICE/connection state)
- `src/lib/p2p-signaling-client.ts` — 11 logs (handshake steps)
- `src/lib/p2p-game-connection.ts` — 9 logs (peer events)
- `src/lib/search/background-indexing.ts` — 10 logs (indexing progress)
- `src/lib/p2p-direct-connection.ts` — 5 logs (session IDs/game codes — **security concern**)
- `src/app/(app)/multiplayer/*` — 8 logs across host/join pages

**Fix:** Replace `console.log` with `console.info`/`console.warn` where useful, or delete entirely. The P2P logs exposing session IDs and game codes are a minor info-leak risk.

---

### 2. Add Error Handling to P2P/WebRTC Async Methods
**Effort:** Small | **Impact:** High

| File | Gap |
|------|-----|
| `src/lib/webrtc-p2p.ts` | `initialize()`, `createOffer()`, `handleOffer()`, `addIceCandidate()` lack `try/catch` — uncaught exceptions crash the connection state machine |
| `src/lib/p2p-signaling-client.ts` | Same pattern: signaling methods throw but callers get no error feedback |
| `src/lib/p2p-game-connection.ts` | Data channel handlers log failures but never surface them to UI |
| `src/hooks/use-p2p-connection.ts` | Hook methods wrap P2P calls without `try/catch` before React state updates |

**Fix:** Wrap each async P2P call in `try/catch`, surface errors via the existing `error` state/callbacks.

---

### 3. Fix `DEFAULT_TURN_SERVERS` — Empty Array Breaks NAT Traversal
**Effort:** Small | **Impact:** High

**File:** `src/lib/ice-config.ts:67-78`

`DEFAULT_TURN_SERVERS` is an empty array with only a commented example. Users behind symmetric NATs will experience **100% connection failure** because there's no relay fallback.

**Fix:** Read TURN credentials from env vars (`NEXT_PUBLIC_TURN_URL`, `NEXT_PUBLIC_TURN_USER`, `NEXT_PUBLIC_TURN_PASS`) and only populate the array when present.

---

### 4. Implement Commander Damage Tracking (Stubbed)
**Effort:** Small | **Impact:** Medium

**File:** `src/lib/game-state/commander-damage.ts:273-281, 384-389`

`getTotalCommanderDamage()` returns `0` as a placeholder. Per-opponent commander damage breakdown is also stubbed. This breaks Commander format games — a core game mode.

**Fix:** Sum commander damage from the `commanderDamage` Map already present on player state.

---

### 5. Replace `alert("P2P networking is not implemented")` with Proper UI
**Effort:** Small | **Impact:** High

**File:** `src/app/(app)/multiplayer/join/page.tsx:177`

User-facing `alert()` is a jarring experience. The page should show a proper placeholder UI or disable the join button instead.

---

### 6. Add Creature Damage Resolution in Spell Casting
**Effort:** Small | **Impact:** Medium

**File:** `src/lib/game-state/spell-casting.ts:353`

```ts
// Deal damage to creature (not implemented yet, but could be)
```

Spells like Lightning Bolt that target creatures currently do nothing. The `dealDamageToCard` helper already exists in `combat.ts` — just import and call it.

---

### 7. Expose Key Timeouts to Environment Variables
**Effort:** Tiny | **Impact:** Medium

| File | Hardcoded Value | Suggested Env Var |
|------|-----------------|-------------------|
| `src/lib/websocket-connection.ts` | `reconnectInterval: 3000` | `WEBSOCKET_RECONNECT_MS` |
| `src/lib/websocket-connection.ts` | `connectionTimeout: 10000` | `WEBSOCKET_TIMEOUT_MS` |
| `src/lib/connection-fallback.ts` | `fallbackTimeout: 15000` | `P2P_FALLBACK_TIMEOUT_MS` |
| `src/lib/p2p-handshake.ts` | `HANDSHAKE_TIMEOUT = 10000` | `P2P_HANDSHAKE_TIMEOUT_MS` |
| `src/lib/public-lobby-browser.ts` | `REFRESH_INTERVAL = 10000` | `LOBBY_REFRESH_MS` |

---

### 8. Remove/Archive Dead Stubs
**Effort:** Tiny | **Impact:** Low

These files are pure placeholders and clutter the codebase:
- `src/ai/genkit.ts` — non-functional Google AI stub
- `src/ai/flows/genkit-coach-flow.ts` — entire file is a stub
- `src/lib/search/search-worker-client.ts` — explicitly labeled as a stub
- `src/app/api/chat/coach/route.ts` — streams "unavailable" message

**Fix:** Either delete them or move to an `archive/` folder.

---

## 📋 Stubbed Game Mechanics (Medium Effort)

| Feature | File | Status |
|---------|------|--------|
| Team elimination | `src/lib/lobby-manager.ts:614-620` | `isTeamEliminated()` always returns `false` |
| Team win detection | `src/lib/lobby-manager.ts:625-631` | `getWinningTeam()` always returns `undefined` |
| Ranked matchmaking | `src/hooks/use-ranked-mode.ts:181` | Placeholder — no actual matchmaking |
| Game board client | `src/app/(app)/game/[id]/game-board-client.tsx` | 4 placeholder handlers (play card, combat, priority, etc.) |

---

## 🧹 Code Hygiene (Tiny Effort)

- **Unused exports:** ~40 high-confidence dead exports (e.g., `AutoSaveIcon`, `AutoSaveBadge`, card-sleeve sub-components)
- **Demo component logs:** `hand-display-demo.tsx`, `card-interactions-demo/page.tsx` have `console.log` in user-facing demo pages
- **False-positive keywords:** `oracle-text-parser.ts` treats words like `lifeline`, `shield`, `underdog` as MTG keywords

---

## 🎯 Recommended Execution Order

1. **Strip `console.log` from P2P/WebRTC** (highest noise, minor security fix)
2. **Add `try/catch` to P2P async methods** (prevents silent crashes)
3. **Fix `DEFAULT_TURN_SERVERS`** (unblocks users behind NAT)
4. **Implement commander damage** (fixes Commander format)
5. **Replace P2P `alert()` with UI** (polish)
6. **Add creature damage from spells** (completes a core mechanic)
7. **Expose timeouts via env vars** (ops flexibility)
8. **Archive dead stubs** (cleanliness)
