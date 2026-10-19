# Planar Nexus — #2353: Verify post-fix CI, decide on closure, triage #2365

## Goal

Three small observational tasks that the previous followups handoff
(`planar-nexus-issue-2353-docs-guard-decouple-followups.md`) deliberately
left to a fresh session, plus a closure decision.

1. Confirm the post-fix CI is genuinely green on the commits that closed
   the #2353 cascade.
2. Decide whether to close #2353 and what to do with the still-open
   informational #2365.
3. (Optional) run the local flake detectors once to ground the closure
   decision in fresh data rather than relying on the CI signal alone.

## Context — what just happened

The "decouple followups" session landed two commits on `main`:

- **`b4aa7a23` — `fix(test-count-docs-guard): decouple passed/skipped/todo drift (#2353)`**
  PR #2362. Re-implements `scripts/check-test-count-docs.mjs` to parse the
  Jest summary independently of the exit code and report non-anchored
  drift as `WARN` while still failing the gate on anchored drift
  (`Test Suites`, `Test cases total`, `Snapshots`, `--listTests` files).
  This closes **root cause 2** of #2353.
- **`ee4a34a0` — `docs(onboarding): refresh test-count gate prose for issue #2353 decoupling`**
  One-line prose edit to `docs/onboarding.md` so the "Source of truth"
  paragraph under `## Current test count` matches the new gate semantics
  (fails on anchored drift, warns on `passed/skipped/todo` drift). No
  test files touched.

A closing-comment was also posted to #2353 (`issuecomment-6274703581`)
recommending that the issue be closed, since all three "Suggested work"
items are now landed or tracked elsewhere:

- **rc1** (ai-proxy flake isolation) — closed by #2363 + #2364.
- **rc2** (docs guard cascade) — closed by #2362 / `b4aa7a23`.
- **rc3** (push-vs-PR E2E asymmetry) — split into #2365 (informational,
  OPEN) and #2367 (the real bug, CLOSED).

The cascade that motivated #2353 — a single ai-proxy flake cascading
into the Test Count Docs Guard — is **structurally broken**: even if a
new flake re-appears, the guard will report it as `WARN` and let the
merge through, exactly as the issue requested.

## State at the start of this handoff

- `main` is at commit `ee4a34a0`. Latest commit before that is `b4aa7a23`.
- CI on `b4aa7a23` is green: run `39298050224` (CI) and `39298050153`
  (Coverage Ratchet) both `success`.
- Pre-push hook ran `scripts/check-test-count-docs.mjs` on `ee4a34a0`
  and reported `PASS` for both `docs/TEST_VIDEO_FIXTURES.md` and
  `docs/onboarding.md`.
- Three CI runs for `ee4a34a0` were **in progress** at handoff time:
  - `39305523832` — `CI`
  - `39305523874` — `Coverage Ratchet`
  - `39305523829` — `Stub Inventory`

Per AGENTS.md §CI & Process Polling, the previous session deliberately
**did not poll** for those runs to complete. This handoff picks them up.

## Tasks

### Task 1 — Confirm the full CI matrix is green on `ee4a34a0`

A single deterministic check, not a loop. AGENTS.md forbids polling, but
one `ci-wait` (or `gh pr checks ee4a34a0 --watch` equivalent) on a
already-completed run is fine and returns a compact 3-line result.

```
ci-wait ee4a34a0
```

The previous-session runs (`39305523832`, `39305523874`, `39305523829`)
should all be `success` by now. **If red, stop and diagnose that run**
before doing anything else — the docs-only commit `ee4a34a0` is the
canary for "did the decoupling behave correctly under live conditions".

Sanity check: `git log -1 --format='%H %s' origin/main` should still
print `ee4a34a0 docs(onboarding): refresh test-count gate prose for issue #2353 decoupling`.
If `origin/main` has moved on, the new HEAD is the gate of record and
this handoff's CI check needs to run against the new HEAD.

### Task 2 — Decide whether to close #2353

The previous session posted `issuecomment-6274703581` recommending
closure. The decision belongs to the human reviewing this handoff.

**Path A (close now):**

- All three "Suggested work" items landed or are tracked in linked
  issues.
- `build` was green on both `b4aa7a23` and `ee4a34a0`.
- The cascade that motivated #2353 is structurally broken — a flake
  now produces `WARN`, not `FAIL`.

```
gh issue close 2353 --comment "Closing: rc1 closed by #2363+#2364; rc2 closed by #2362 (commit b4aa7a23); rc3 split into #2365 (informational, open) and #2367 (closed). Cascade no longer reddens main."
```

**Path B (defer close until 1–2 more merges land green):**

- Defensive option if you want one more signal before closing.
- Run Task 1, then wait for the next 1–2 PRs on `main` to merge green,
  then close #2353.

**Path C (leave open and treat as a tracking issue):**

- Only if the rc3 work in #2365 is genuinely unblocked and being
  actively worked on. Otherwise #2353 will rot.

### Task 3 — Triage #2365 ("cross-browser and flake-detector jobs collect their first signal on main")

Issue #2365 is the **informational** half of rc3. The body explicitly
says _"this is the part that turned out not to be a bug at all, but
[rather] an asymmetry in how the workflows are gated"_. The other half
of rc3 — the real push-vs-PR diff — is #2367 (closed).

Two reasonable dispositions:

- **Leave #2365 open** as a permanent document of the asymmetry, so the
  next person who sees a flake-detector failure on `main` push knows
  why it landed post-merge.
- **Close #2365** as `not-a-bug` after one more cycle of
  `Flake Detector (Jest)` and the cross-browser jobs landing green on
  `main` push. The asymmetry itself is by design (those tests are
  designed to flake-detect, not pre-merge-gate).

The decision should align with how the team wants post-merge failures
to be communicated. There is no urgency; this can be a one-line triage
when convenient.

### Task 4 — (Optional) Run the local flake detectors

If you want **proactive** confirmation that the rc1 / rc3 flake classes
are gone before #2353 is closed, run the flake detectors locally:

```
npm run test:flake         # 5 randomized Jest runs, no --forceExit
npm run test:e2e:flake     # 5 Playwright runs, threshold 4 flaky
```

Both are non-blocking and slow (~10–15 min each on a developer laptop,
longer in CI). The CI signal from Task 1 is sufficient on its own to
make the closure decision — this task is purely for tightening the
margin.

If `test:flake` reports new flakes that are not in the
`forge-gate.test.ts` family, those are **new** flakes, not leftover
#2353 ones. They should be filed as separate issues; do **not** reopen
#2353 on the basis of a fresh flake (its cascade is already broken).

## Constraints (carried over from project AGENTS.md)

- `npm` only (no `pnpm` / `yarn` lockfiles; CI uses `npm ci`).
- No `--forceExit` on any Jest command — see `scripts/jest-flake-detector.ts`.
- For any `codebase-memory-mcp` call, verify the project is indexed
  first via `list_projects`.
- Prefix shell commands with `rtk` — the rtk plugin auto-rewrites.
- One `ci-wait` per session for any given SHA; **never loop**.
- Commit subjects: `[AI-assisted] (<tool>)` prefix, lower-case,
  ≥10 chars, conventional types only (`feat fix docs style refactor test
chore revert`).
- Coverage thresholds auto-ratchet on merge to `main`. The docs-only
  commit `ee4a34a0` did **not** require a manual ratchet because no
  test files changed.

## Files in this handoff

- `.planning/handoffs/planar-nexus-issue-2353-verify-and-close.md` —
  this file.
- `.planning/handoffs/planar-nexus-issue-2353-docs-guard-decouple-followups.md` —
  the previous session's handoff; read for the rc2 / Option C rationale.
- `.planning/handoffs/planar-nexus-issue-2353-docs-guard-decouple.md` —
  the original handoff that landed `b4aa7a23`.

## What this handoff deliberately does **not** do

- Does not re-edit `docs/onboarding.md` or `docs/TEST_VIDEO_FIXTURES.md`
  — that was Task 2 of the previous handoff, committed as `ee4a34a0`.
- Does not touch the engine (`src/lib/game-state/`).
- Does not modify `scripts/check-test-count-docs.mjs` — that landed in
  `b4aa7a23`.
- Does not open duplicate follow-up issues for rc1 / rc3 — #2363,
  #2364, #2365, and #2367 already cover the work.
- Does not poll CI. Task 1 is a single deterministic check.
