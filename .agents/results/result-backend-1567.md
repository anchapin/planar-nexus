# Backend Result — Issue #1567: Host-attested join sequence

## Status

**DONE** — committed & pushed. No PR created (per instructions).

## Summary

Replaced the peer-self-reported `joinedAt` wall-clock field in `PeerRosterEntry` with a host-attested monotonic `joinSeq` integer. The host mints the next sequence on every `assignNextJoinSeq` call and broadcasts the assignment under the existing HMAC envelope (#1252), so a malicious peer can no longer lie about its arrival time to win `selectHostSuccessor`. Both the `selectHostSuccessor` comparator and `HostMigrationManager.peersList` now read `joinSeq` exclusively; `joinedAt` is retained on the entry for display/debugging only.

## Files changed

- `src/lib/p2p-host-migration.ts` — **modified**:
  - `PeerRosterEntry` adds required `joinSeq: number`; `joinedAt` docstring updated to mark it non-authoritative.
  - `selectHostSuccessor` sort comparator changed from `(joinedAt asc, playerId asc)` → `(joinSeq asc, playerId asc)`; never reads `joinedAt`.
  - `HostMigrationManager` adds internal `nextJoinSeq` counter (initialised from `initialPeers` so it is monotonic across handovers).
  - `HostMigrationManager.upsertPeer` now also advances the counter past the inserted entry's `joinSeq`.
  - New methods: `assignNextJoinSeq(playerId, playerName)` (host-only, mints next seq + records via `upsertPeer`), `recordHostJoinSeq(playerId, joinSeq)` (followers apply host-attested value), `seedHostJoinSeq(playerName)` (host self-seed with `joinSeq: 0`, idempotent), `peekNextJoinSeq()` (tests).
  - Private `peersList()` sort comparator changed to `(joinSeq, playerId)`.
- `src/lib/__tests__/p2p-host-migration.test.ts` — **modified**: every `PeerRosterEntry` literal gets `joinSeq`; new `describe('HostMigrationManager — host-attested join sequence (issue #1567)')` block covers the security properties.
- `src/hooks/use-p2p-connection.ts` — **modified**:
  - Manager init now calls `seedHostJoinSeq(playerName)` when `role === "host"`.
  - `registerPeerForMigration` now branches: host → `assignNextJoinSeq` + `sendGameAction("roster-assignment", { playerId, playerName, joinSeq })`; follower → `upsertPeer` with `joinSeq = Number.MAX_SAFE_INTEGER` (sentinel; the host's real broadcast will overwrite).
  - New `handleRosterAssignment` callback (with type guard for `{playerId: string, joinSeq: number}` and defensive `Number.isInteger`/`>= 0` check) wired into `handleMigrationGameAction`.

## Sequence enforcement design

1. **Single writer.** `nextJoinSeq` lives inside `HostMigrationManager` and is private. Only the host calls `assignNextJoinSeq`. A peer cannot influence the counter directly — `recordHostJoinSeq` only ADOPTS host-attested values.
2. **Monotonic across handovers.** The counter is initialised from `initialPeers`' max, so when a follower is promoted to host via `initiateMigration`, the new host picks up the existing roster's max instead of resetting to 0. Both `assignNextJoinSeq` and `upsertPeer` advance `nextJoinSeq` past any higher seq they observe.
3. **Wire attestation.** The host broadcasts the assigned `joinSeq` via `sendGameAction("roster-assignment", …)`. Because game actions ride under the per-session HMAC envelope (#1252), a follower cannot forge a low sequence for itself — the transport rejects any envelope whose HMAC doesn't match the host's key.
4. **Defensive validation at the receiver.** `handleRosterAssignment` validates the payload shape and rejects non-integer / negative / non-finite values, even though the transport envelope is the primary defence.
5. **Follower sentinel.** When a follower's `onPlayerJoined` fires before the host's roster-assignment arrives, the peer is recorded with `joinSeq = Number.MAX_SAFE_INTEGER`. The sentinel can never win succession — it loses to every real sequence. The host's broadcast overwrites it with the authoritative value.

## Security analysis

| Attack                                                                        | Defence                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Peer sets `joinedAt: 0` on its own roster entry to win succession             | `joinedAt` no longer read by `selectHostSuccessor` / `peersList`. The peer's forged value is ignored — verified by `'selects the peer with the lower joinSeq even when joinedAt claims otherwise'` and `'honest peers use joinSeq; lying peers are ignored (4-player mesh)'` tests.                                                                               |
| Peer broadcasts `joinSeq: 0` for itself in a roster update                    | Followers trust only `assignNextJoinSeq` (host-side) or `recordHostJoinSeq` (after a host-attested envelope). A peer's self-broadcast `joinedAt`/`joinSeq` is never read from the wire for succession ordering.                                                                                                                                                   |
| Peer spoofs a `roster-assignment` game-action with a low seq                  | The `sendGameAction` channel is HMAC-signed (#1252) with the host's session key; any envelope that doesn't match is dropped at the transport boundary before `handleRosterAssignment` runs.                                                                                                                                                                       |
| Peer replays an old `roster-assignment`                                       | The transport's per-message `seq` anti-replay (#1091) drops duplicates. Even if it slipped through, `handleRosterAssignment` requires `Number.isInteger(joinSeq) && joinSeq >= 0`; the host's monotonic counter means a valid broadcast always has the highest seq seen so far, so old values lose to fresh ones.                                                 |
| Non-integer / `Infinity` / `NaN` injection                                    | `handleRosterAssignment` filters with `Number.isFinite` / `Number.isInteger` / `>= 0`; `recordHostJoinSeq` stores only the sanitised value.                                                                                                                                                                                                                       |
| Peer overrides the host's roster by calling `upsertPeer` with a low `joinSeq` | `upsertPeer` stores whatever the caller passes, but `selectHostSuccessor` runs over the WHOLE roster — and the host's broadcast of the authoritative seq wins because it is the lowest value. A peer's local self-`upsertPeer` cannot reduce the host-attested value (it would only affect the local copy, which is then overridden when the assignment arrives). |

## Acceptance criteria checklist

- [x] Peer A broadcasts `joinedAt: 0` → still loses to peers with lower `joinSeq`. (Test: `'honest peers use joinSeq; lying peers are ignored (4-player mesh)'`.)
- [x] Host's `HostMigrationManager.upsertPeer` records a host-issued `joinSeq` (via `assignNextJoinSeq` → `upsertPeer` internal call). (Test: `'assignNextJoinSeq records the entry in the roster'`.)
- [x] Original host seeds with `joinSeq: 0`. (Test: `'seedHostJoinSeq assigns joinSeq 0 to the original host'`.)
- [x] `selectHostSuccessor` ties broken by `(joinSeq asc, playerId asc)`; `joinedAt` is no longer read. (Tests: `'breaks ties on joinSeq by lexicographic playerId'`, `'uses joinSeq and never reads joinedAt for ordering'`.)
- [x] A reports `joinedAt: 0` / `joinSeq: 5`; B reports `joinedAt: 9999999999999` / `joinSeq: 2` → B is selected. (Test: `'selects the peer with the lower joinSeq even when joinedAt claims otherwise'`.)
- [x] All previously-green assertions in `p2p-host-migration.test.ts` still pass (every `PeerRosterEntry` literal updated with `joinSeq`; the deterministic tie-break semantics preserved).

## Verification evidence

- `npm run typecheck` → exit 0.
- `npm run lint` → 0 errors (616 pre-existing warnings, non-gating; no new warnings from the diff).
- `npx jest src/lib/__tests__/p2p-host-migration.test.ts` → **38 passed** (was 22; 16 new tests added).
- `npx jest --testPathPatterns="multiplayer|host-migration|p2p"` → **773 passed** (up from 757 — delta = 16 new `joinSeq` tests).
- `npx jest` → 9941 passed, 11 skipped, 1 failed (`coach-conversation-storage` — pre-existing tolerated failure, issue #1634, not touched by this diff).
- Pre-handover checks: `git status --porcelain | grep -v '.agents/results'` empty; last commit subject references #1567.

## Out-of-scope observations (documented, not changed)

- The `joinedAt` field on `Player` (multiplayer-types.ts) and on `Spectator`/`SocialProfile` (lobby-manager.ts, social.ts, spectator.ts) is unrelated — those are lobby/social types, not P2P-peer roster entries. They are not used for host succession. No changes required.
- `tests/capability-audit.test.ts` already passes; no `window-state:default` permission is granted in `src-tauri/capabilities/default.json`, so the conditional `BACKEND_ONLY_PLUGINS` addition noted in the task brief does not apply. No changes required.

## Blockers

None.

## Git

- Branch: `fix/issue-1567-host-succession`
- Commit: see `git log -1` (header: `fix: resolve #1567 — replace peer-self-reported joinedat with host-attested join sequence`)
- Pushed to `origin` with `--force-with-lease`. No PR (per instructions).
