---
phase: 15
slug: draft-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 15 — Draft Core - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.x + @testing-library/react 16.x |
| **Config file** | jest.config.js (existing) |
| **Quick run command** | `npm test -- --testPathPattern="draft"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern="draft" --passWithNoTests`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 15-01-00 | 01 | 1 | DRFT-01-02 | unit | `npm test -- --testPathPattern="draft-generator"` | ❌ W0 | ⬜ pending |
| 15-01-01 | 01 | 1 | DRFT-01-02 | unit | `npm test -- --testPathPattern="draft-generator" --testNamePattern="3 packs"` | ❌ W0 | ⬜ pending |
| 15-01-02 | 01 | 1 | DRFT-03 | unit | `npm test -- --testPathPattern="draft-generator" --testNamePattern="isOpened"` | ❌ W0 | ⬜ pending |
| 15-02-00 | 02 | 2 | DRFT-04-05 | unit | `npm test -- --testPathPattern="draft-generator" --testNamePattern="pick"` | ❌ W0 | ⬜ pending |
| 15-02-01 | 02 | 2 | DRFT-04 | unit | `npm test -- --testPathPattern="draft-generator" --testNamePattern="select.*card"` | ❌ W0 | ⬜ pending |
| 15-02-02 | 02 | 2 | DRFT-05 | unit | `npm test -- --testPathPattern="draft-generator" --testNamePattern="pool"` | ❌ W0 | ⬜ pending |
| 15-03-00 | 03 | 2 | DRFT-06-08 | unit | `npm test -- --testPathPattern="draft-timer"` | ❌ W0 | ⬜ pending |
| 15-03-01 | 03 | 2 | DRFT-06 | unit | `npm test -- --testPathPattern="draft-timer" --testNamePattern="countdown"` | ❌ W0 | ⬜ pending |
| 15-03-02 | 03 | 2 | DRFT-07 | unit | `npm test -- --testPathPattern="draft-timer" --testNamePattern="color"` | ❌ W0 | ⬜ pending |
| 15-03-03 | 03 | 2 | DRFT-08 | unit | `npm test -- --testPathPattern="draft-timer" --testNamePattern="auto-pick"` | ❌ W0 | ⬜ pending |
| 15-04-00 | 04 | 3 | DRFT-09-11 | integration | `npm test -- --testPathPattern="draft-storage"` | ❌ W0 | ⬜ pending |
| 15-04-01 | 04 | 3 | DRFT-09 | unit | `npm test -- --testPathPattern="draft-generator" --testNamePattern="complete"` | ❌ W0 | ⬜ pending |
| 15-04-02 | 04 | 3 | DRFT-10 | integration | `npm test -- --testPathPattern="draft-storage" --testNamePattern="persist"` | ❌ W0 | ⬜ pending |
| 15-04-03 | 04 | 3 | DRFT-11 | integration | `npm test -- --testPathPattern="draft-storage" --testNamePattern="resume"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/limited/__tests__/draft-generator.test.ts` — covers DRFT-01, DRFT-02, DRFT-03, DRFT-04, DRFT-05, DRFT-09
- [ ] `src/hooks/__tests__/use-draft-timer.test.ts` — covers DRFT-06, DRFT-07, DRFT-08
- [ ] `src/lib/limited/__tests__/draft-storage.test.ts` — covers DRFT-10, DRFT-11
- [ ] `src/lib/limited/__tests__/setup.ts` — Jest setup (can extend existing from Phase 14)
- [ ] Framework install: N/A — Jest already configured in project

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Card back visual design | DRFT-03 | Visual only, needs human eyes | Visit /draft page, verify face-down cards show placeholder |
| Timer color transitions | DRFT-07 | Exact color values need visual verification | Wait for timer to reach each threshold |
| Pool sidebar always visible | DRFT-05 | Layout verification | Resize window, verify sidebar stays visible |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

