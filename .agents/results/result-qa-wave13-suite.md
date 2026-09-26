# QA Review — origin/main..HEAD (10-commit wave13 suite)

**Session scope:** All 10 commits between `origin/main` (e33b1014) and `HEAD` (c0f72571).
**Charter:** QA Specialist (security, performance, accessibility, code quality).
**Mode:** Review only — no source modification.

> Note: This supplements `.agents/results/result-qa.md` (which covers c0f72571 only).
> Do not treat it as a replacement — the earlier PASS for the test-fix commit stands.

---

## Status: **WARNING**

### CRITICAL

_(none)_

### HIGH

_(none)_

### MEDIUM

- **`src/lib/sync/delta-sync.ts:428`** — Empty-string checksum now bypasses integrity validation.
  The validation guard changed from `if (delta.checksum !== undefined)` to
  `if (delta.checksum !== undefined && delta.checksum !== "")`. Any sender that sets
  `checksum: ""` (intentionally or via serialization collapse) now skips the
  `computeChecksum(newState)` comparison and proceeds unchecked. Intent was to
  support test placeholders, but empty-string is not a safe sentinel — the prior
  behavior (validate when defined, even if empty) was strictly more defensive.

  ```diff
  - if (delta.checksum !== undefined) {
  + if (delta.checksum !== undefined && delta.checksum !== "") {
      const computed = computeChecksum(newState);
      if (computed !== delta.checksum) {
        console.warn(
          `[delta-sync] Checksum mismatch: ... Rejecting delta.`,
  ```

  **Remediation** — use an explicit sentinel (e.g. treat `null` as "skipped",
  treat `""` as "expected empty" → reject, or revert the `!== ""` clause and
  update the test placeholder to omit the field rather than empty-string it):

  ```ts
  // Option A: explicit null sentinel (preferred — preserves integrity check)
  if (delta.checksum != null) {
    const computed = computeChecksum(newState);
    if (computed !== delta.checksum) {
      console.warn(`[delta-sync] Checksum mismatch: ... Rejecting delta.`);
      return {
        state: currentState,
        applied: false,
        reason: "checksum_mismatch",
      };
    }
  }
  // Option B: keep current behavior in prod, but in the test omit the field
  ```

### LOW

- **`src/components/storage-backup-manager.tsx:90-93`** — `handleBackup` branch is
  functionally redundant with the hook's own dispatch.

  ```ts
  if (backupMode === "incremental") {
    await exportIncrementalData();
  } else {
    await exportData();
  }
  ```

  `use-storage-backup.ts:284-287` already routes `exportData(filename)` to
  `exportIncrementalData(filename)` when `backupMode === "incremental"`. The new
  conditional is defensive but creates two code paths for the same intent.

  **Remediation** — either keep `await exportData()` unconditionally (and let
  the hook dispatch), or add a comment documenting why the branch is intentional
  (e.g. "avoid passing `filename` arg through `exportData` here"). If the
  branch stays, add a unit test covering both paths explicitly.

- **Pre-existing lint warnings** — 10 warnings on touched files, all pre-existing
  in HEAD (no new ones introduced by the 10-commit diff):
  - `storage-backup-manager.tsx:63` — `quota` unused (pre-existing)
  - `delta-sync.ts:22` — `aiToEngineState` unused (pre-existing)
  - `delta-sync.ts:204` — `lastPlayer` unused (pre-existing)
  - `webrtc-p2p.ts` — 7 warnings (`P2P_UNCOMPRESSED_PREFIX`, `state`, `candidate`,
    `any`, `message` x2, `peerInfo` — all pre-existing)

  **Remediation** — not in scope for this wave. Track as cleanup in a future PR.

---

## Production Code Diff Summary (12 files, +915 / -103)

### Files reviewed (production + config)

| File                                        | Lines    | Verdict                                  |
| ------------------------------------------- | -------- | ---------------------------------------- |
| `src/lib/sync/delta-sync.ts`                | +1 / -1  | MEDIUM — empty-checksum weakening        |
| `src/components/storage-backup-manager.tsx` | +53 / 0  | LOW — redundant branch                   |
| `src/lib/webrtc-p2p.ts`                     | +12 / -X | PASS — sound error-handling fixes        |
| `config/bundle-budget.json`                 | +33 / 0  | PASS — re-capture with `/register` added |

### Files reviewed (tests)

| File                                                                             | Lines     | Verdict                             |
| -------------------------------------------------------------------------------- | --------- | ----------------------------------- |
| `src/components/__tests__/signaling-exchange.test.tsx` (new)                     | +553      | PASS — matches signaling PR #2139   |
| `src/components/__tests__/storage-backup-manager.test.tsx`                       | +220 / -X | PASS — uses new `data-testid` attrs |
| `src/lib/__tests__/webrtc-p2p.test.ts`                                           | +5 / 0    | PASS — covers new error path        |
| `src/lib/sync/__tests__/delta-sync.test.ts`                                      | +20 / 0   | PASS — covers empty-checksum branch |
| `src/lib/__tests__/mutation/keyword-actions.mutation.test.ts` (new)              | +53       | PASS — Stryker coverage             |
| `src/lib/__tests__/mutation/oracle-text-parser-abilities.mutation.test.ts` (new) | +41       | PASS — Stryker coverage             |
| `tests/mutation-docs-guard.test.ts`                                              | +22 / 0   | PASS — ratchet docs infrastructure  |
| `tests/mutation-floor.test.ts`                                                   | +4 / 0    | PASS — ratchet coverage floor       |

---

## Automated Tool Results

| Tool                                         | Result                                   |
| -------------------------------------------- | ---------------------------------------- |
| `tsc --noEmit`                               | clean (0 errors)                         |
| `eslint --max-warnings 1000 <touched files>` | 0 errors, 10 warnings (all pre-existing) |
| `npm audit --omit=dev --audit-level=high`    | clean (no high/critical)                 |

---

## Verification Notes

- **`loadStorageQuota` memoization** — `use-storage-backup.ts:180` wraps it in
  `useCallback`. The new `useEffect` dependency `[isInitialized, loadStorageQuota]`
  in `storage-backup-manager.tsx:142` is therefore stable — no infinite re-fetch risk.
- **`/register` route exists** — `src/app/register/page.tsx` verified.
- **`attemptReconnection` change** — `throw` → `return` is correct: every call site
  invokes it as `void attemptReconnection(...)`, so rethrow would surface as an
  uncaught promise rejection (which breaks Jest's unhandled-rejection detection).
- **`restartIce` change** — `.catch` forwards errors to `this.events.onError`
  channel with empty `kind` argument. Worth noting that `kind=""` may need a
  sentinel like `"ice-restart"` for downstream filtering (informational only).

---

## Acceptance Criteria Checklist

- [x] Charter check emitted at session start
- [x] Automated tools run first (typecheck, lint, audit)
- [x] Every finding has `file:line` reference + remediation
- [x] Severity levels enforced (CRITICAL / HIGH / MEDIUM / LOW)
- [x] No source code modified
- [x] No `.agents/` harness files modified (result written to supplementary file)
- [x] Findings verified (no false positives):
  - `loadStorageQuota` memoization confirmed via `useCallback`
  - `/register` route existence confirmed via `ls`
  - pre-existing lint baseline confirmed by stashing local state and re-linting HEAD
- [x] Existing `result-qa.md` (c0f72571 PASS) preserved untouched

## Verdict: **WARNING**

Zero CRITICAL / HIGH. One MEDIUM (delta-sync empty-checksum weakening) and one
LOW (export dispatch redundancy) block a clean PASS. The MEDIUM finding should
be addressed before the next push — the `!== ""` clause is a security regression
in the integrity-validation path. Once remediated, the wave can be promoted to
PASS.
