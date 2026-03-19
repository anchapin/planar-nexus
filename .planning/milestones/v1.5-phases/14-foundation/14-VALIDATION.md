---
phase: 14
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7 + @testing-library/react 16.3 |
| **Config file** | jest.config.js |
| **Quick run command** | `npm test -- --testPathPattern="limited|sealed|set-browser" --passWithNoTests` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** `npm test -- --testPathPattern="limited|sealed|set-browser" --passWithNoTests`
- **After every plan wave:** `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | SET-01, SET-02, SET-03 | unit | `npm test -- --testPathPattern="set-service"` | ❌ W0 | ⬜ pending |
| 14-01-02 | 01 | 1 | SEAL-01, SEAL-02 | unit | `npm test -- --testPathPattern="sealed-generator"` | ❌ W0 | ⬜ pending |
| 14-02-01 | 02 | 2 | SEAL-03, LBld-02 | unit | `npm test -- --testPathPattern="pool-storage"` | ❌ W0 | ⬜ pending |
| 14-02-02 | 02 | 2 | LBld-01, LBld-03, LBld-04, LBld-05 | unit | `npm test -- --testPathPattern="limited-validator"` | ❌ W0 | ⬜ pending |
| 14-02-03 | 02 | 2 | SEAL-04, SEAL-05, LBld-06, ISOL-01, ISOL-02, ISOL-03 | integration | `npm test -- --testPathPattern="pool-storage"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/limited/__tests__/set-service.test.ts` — stubs for SET-01, SET-02, SET-03
- [ ] `src/lib/limited/__tests__/sealed-generator.test.ts` — stubs for SEAL-01, SEAL-02
- [ ] `src/lib/limited/__tests__/pool-storage.test.ts` — stubs for SEAL-03, SEAL-04, SEAL-05, ISOL-01, ISOL-02, ISOL-03
- [ ] `src/lib/limited/__tests__/limited-validator.test.ts` — stubs for LBld-01, LBld-02, LBld-03, LBld-04, LBld-05, LBld-06
- [ ] `src/lib/limited/__tests__/setup.ts` — Jest setup with fake-indexeddb
- [ ] Framework install: N/A — Jest already configured in project

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| UI: Set browser visual sorting | SET-01 | Visual layout verification | Navigate to /set-browser, verify sets sort correctly |
| UI: Pack opening animation | SEAL-02 | Visual feedback | Click "Open Packs", verify cards reveal with animation |
| UI: Pool filter responsiveness | SEAL-03 | UI responsiveness | Apply color/type/CMC filters, verify instant update |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
