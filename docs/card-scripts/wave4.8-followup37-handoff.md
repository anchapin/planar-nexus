# Wave 4.8 follow-up 37 — Handoff

## Session metadata

- Branch: `wave4.8-followup37` (worktree `/home/alex/Projects/planar-nexus-wave4.8-followup37`).
- Parent: `wave4.8-followup36` (`9aaa2655`).
- Grandparent: `wave4.8-followup34c` (`86c57145`).
- Main tip: `6a4d33bd` (deps bump #2776, unrelated to wave 4.8).
- Engine-size-budget cap: **5585** (unchanged; no code shipped).
- Test-count docs: unchanged. Test suites **807**, `--listTests` files **334**,
  Test cases total **6074**, passed **5876** (no test files added or removed).

## Outcome — no-ship (Option A, no fresh substrate)

Followup37 is the **third consecutive no-ship** in the wave 4.8 follow-up
series. The user selected **Option A** ("Resume the cycle, but only if new
substrate has appeared between session boundaries") at the start of this
session. Pre-flight #2 ran fresh and confirmed: **no new substrate**.

- `git diff 86c57145..HEAD --name-only -- 'src/'` returns empty.
- Only commit since followup34c is followup36's own handoff doc
  (`9aaa2655`).
- Re-verification of every "rides follow-up N" marker in the engine
  produces the same results as the followup36 audit. Zero new callers.

Per the wave 4.8 cycle fallback ("if it's another no-ship, repeat the
handoff doc as the template"), followup37 writes a no-ship handoff. This
doc is intentionally **shorter** than followup36 (which performed the
stale-marker audit for the first time) because the substrate is unchanged
— duplicating the full audit would be noise. The followup36 doc remains the
canonical record of the stale-marker enumeration.

---

## 1. Pre-flight #2 — literal-need scan, fresh

### Candidate 1 — Lane 28 piece 5/N: `set_keyword` / `set_ability` REPLACE arms

**Verdict: no caller.**

`set_keyword` and `set_ability` exist only as docstring markers in the
schema. Verification — `grep -rn "set_keyword" src/` returns exactly one
line, `grep -rn "set_ability" src/` returns exactly one line, both in
`src/lib/game-state/card-scripts/schema.ts`. Read at offset 758–765:

```text
src/lib/game-state/card-scripts/schema.ts
760:         *   - `set_keyword` (deferred —
761:         *     rides follow-up 35+)
762:         *   - `set_ability` (deferred —
763:         *     rides follow-up 35+)
```

**Correction vs followup36 doc:** the followup36 handoff cited lines **761
and 763** for these markers. Fresh verification shows the markers are at
lines **760 and 762**. One-line drift, no impact on the verdict (still no
callers, still docstring-only).

**Decision: defer to follow-up 38+ if a fixture surfaces a need.**

### Candidate 2 — Lane 71 piece 6/N: `chosenProtectionFromPerPairWithLiteral`

**Verdict: no caller.**

`chosenProtectionFromPerPairWithLiteral` exists as a type-only mention in
`src/lib/game-state/types/cards.ts:195`. Read at offset 193–200:

```text
src/lib/game-state/types/cards.ts
195:   * `chosenProtectionFromPerPairWithLiteral`
196:   * extension of the per-pair-with
197:   * literal independent sentinel-
198:   * resolution field on `CardInstance`
199:   * (issue #2241 follow-up).
200:   * Defined as: [...]
```

Verification — `grep -rn "chosenProtectionFromPerPairWithLiteral" src/`
returns exactly one line. No card fixture imports the field. No schema
entry references it. No test exists.

**Decision: defer to follow-up 38+ if a fixture surfaces a need.**

### Cross-check — Lane 27 piece 5/N remains shipped

Lane 27 piece 5/N (`andPer.perCounterSummed`) remains shipped from
follow-up 28 priority 3:

- Production code: `src/lib/game-state/keyword-actions/scripted-statics.ts:311`.
- Schema: `src/lib/game-state/card-scripts/schema.ts:924`.
- Tests: `src/lib/game-state/__tests__/lane32-andper-percounter-summed.test.ts`
  runs **8/8 passed** (re-verified via
  `npx jest --testPathPatterns="lane32-andper-percounter-summed"`).

**Decision: nothing to do. Lane 27 piece 5/N is closed.**

---

## 2. Stale-marker audit (re-run, fresh)

The followup36 doc performed the first stale-marker audit. Re-running for
followup37 confirms all 16 markers are still stale. **Zero live arms.**

No new "rides follow-up N" markers were introduced since followup36 (no
engine code changed). No existing marker was removed (no cleanup was
shipped). The audit table from followup36 §2 holds unchanged:

| Window    | Markers | Stale  | Live  |
| --------- | ------- | ------ | ----- |
| 26+       | 1       | 1      | 0     |
| 29        | 1       | 1      | 0     |
| 30        | 4       | 4      | 0     |
| 31        | 2       | 2      | 0     |
| 32        | 5       | 5      | 0     |
| 34        | 1       | 1      | 0     |
| 35+       | 2       | 2      | 0     |
| **Total** | **16**  | **16** | **0** |

**Live deferred arms: zero.** Same result as followup36.

---

## 3. Pattern observation — three no-ships in a row

This is the **first time** in the wave 4.8 follow-up series that three
consecutive no-ships have been produced. The pattern is now visible:

| Followup | No-ship reason                                           | New substrate since previous? |
| -------- | -------------------------------------------------------- | ----------------------------- |
| 35       | No callers for lane 28 piece 5/N or lane 71 piece 6/N    | (baseline)                    |
| 36       | Same; stale-marker audit confirms zero live arms         | None                          |
| 37       | Same; fresh pre-flight #2 + audit confirm zero live arms | None                          |

The cycle is **procedurally producing no-ships** because **the substrate is
fixture-driven and no fixture work has surfaced in any of the three
sessions**. This is not a bug — the cycle's hard rule ("don't ship without
a real caller") is enforcing itself. But it means the cycle's exit
condition is "a fixture surfaces" or "a human scopes the work", not
"another follow-up cycle resolves it".

The followup36 loop-done summary recommended Options B (close the wave) or
C (human-scoped speculative ship). The user selected Option A
(resume the cycle) for followup37, knowing the substrate was unchanged.
That decision is the user's prerogative; this doc codifies it but does
**not** recommend repeating it indefinitely.

---

## 4. Recommended PR title

> Wave 4.8 follow-up 37 — No-ship handoff: pre-flight #2 literal-need scan
> re-run with no fresh substrate; three consecutive no-ships (35, 36, 37)
> confirm wave 4.8 follow-up cycle is stalled on fixture-side absence.

---

## 5. Diff summary

| File                                              | Change                | Notes                       |
| ------------------------------------------------- | --------------------- | --------------------------- |
| `docs/card-scripts/wave4.8-followup37-handoff.md` | +180 lines, 0 removed | New handoff doc, this file. |

No code changed. No tests added. No fixtures added. No engine-size-budget
change. No schema change.

---

## 6. Cross-references

- `docs/card-scripts/wave4.8-followup36-handoff.md` — the immediate prior
  no-ship. First to perform the stale-marker audit and include a
  loop-done summary. Substrate analysis duplicated here in summary form;
  the canonical record lives in the followup36 doc.
- `docs/card-scripts/wave4.8-followup35-handoff.md` — the first no-ship.
  Omitted the stale-marker audit and loop-done summary.
- `docs/card-scripts/wave4.8-followup34c-handoff.md` (or the corresponding
  branch state) — last successful lane-close.
- `docs/card-scripts/wave45-next-session.md` — canonical cycle protocol.

---

# Wave 4.8 follow-up 37 loop done summary

(Required by the cycle protocol.)

## Cycle state at session start

- Branch: `wave4.8-followup37` off `wave4.8-followup36` (`9aaa2655`).
- Previous no-ships in series: **2** (followup35, followup36).
- Total wave 4.8 follow-ups: 1 through 37.
- Open lane pieces on the priority list at session start:
  - Lane 28 piece 5/N (`set_keyword` / `set_ability` REPLACE arms)
  - Lane 71 piece 6/N (`chosenProtectionFromPerPairWithLiteral`)
- Total "rides follow-up N" markers in engine at session start: 16 (across
  windows 26+, 29, 30, 31, 32, 34, 35+).
- Substrate change vs followup36 session start: **none**.

## What followup37 did

1. **Confirmed Option A's precondition** — checked for fresh substrate.
   `git diff 86c57145..HEAD --name-only -- 'src/'` returned empty. Only
   commit since followup34c is followup36's own handoff doc.
2. **Ran pre-flight #2 fresh** — same verdict as followup36. Both
   candidates confirmed: no caller.
3. **Re-verified stale-marker audit** — same result as followup36.
   Sixteen markers, sixteen stale, zero live.
4. **Codified the three-no-ship pattern** — this is the first time the
   series has produced three consecutive no-ships. The pattern signals the
   cycle is procedurally stalled.

## What followup37 did not do

- Did not ship any code, schema, or fixtures.
- Did not remove any stale markers (still a separate cleanup task).
- Did not bump the engine-size-budget cap.
- Did not bump any test counts.
- Did not modify `package.json` or any build config.

## Final decision — loop-done (third no-ship in series)

Three no-ships in a row is a strong enough signal that **the cycle should
pause unless new substrate surfaces**. The followup36 loop-done summary
recommended Options B or C at that point. The user selected Option A for
followup37 anyway, exercising the override the protocol explicitly
preserves ("the cycle's exit condition is _not_ mandatory").

**The wave 4.8 follow-up cycle should pause until one of the following
surfaces:**

- **A card fixture** whose text pulls lane 28 piece 5/N or lane 71 piece 6/N
  forward. If a fixture ships, the next follow-up can resume the cycle.
- **A human-scoping decision** to either build the extensions speculatively
  (with proper TDD scaffolding and a TODO for the first real fixture) or
  remove the stale markers entirely.
- **A meta-decision** to formally close wave 4.8's follow-up phase, archive
  the deferred-work candidates to an `archive/` doc, and resume the cycle
  only if new card-script work surfaces a need.

## What the next session should do

The next session is **strongly recommended** to **not** run followup38
against the same priority list. The three-no-ship pattern is the protocol's
own signal that the substrate has run dry. Instead:

1. Read this loop-done summary.
2. Read `docs/card-scripts/wave4.8-followup37-handoff.md` and
   `docs/card-scripts/wave4.8-followup36-handoff.md` in full.
3. **Decide**:
   - **Option A — Resume the cycle** (continue followup38). Justified only
     if the next session has _new substrate work_ (a fixture, a schema
     change, or a freshly-staged card-script commit) that was not present
     at the start of followup37. Verify with
     `git diff 86c57145..HEAD --name-only -- 'src/'` first; if non-empty,
     proceed; if empty, **stop and pick a different option**.
   - **Option B — Close the wave's follow-up phase**. Write a one-time
     "wave 4.8 closed" archive doc, mark the deferred arms as archived in
     the stale-marker audit table, and stop issuing followups until a
     fixture surfaces. **This is the recommended path** given three
     no-ships in a row with no substrate change.
   - **Option C — Speculatively ship the extensions**. Build
     `set_keyword` / `set_ability` REPLACE arms and
     `chosenProtectionFromPerPairWithLiteral` with proper TDD scaffolding
     and a TODO for the first real fixture. **Requires human scoping
     approval** — the cycle protocol explicitly does not allow this without
     explicit human sign-off.

## File-recap

- **Committed (this PR):** `docs/card-scripts/wave4.8-followup37-handoff.md`.
- **Unchanged:** every other file in the engine.

End of followup37 handoff + loop-done summary.
