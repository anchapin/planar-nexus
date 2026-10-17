# Wave 4.8 — Closed

## What this doc is

This is the **closing record** for the Wave 4.8 card-script follow-up cycle.
It is not a follow-up handoff. There is no follow-up number attached.

The wave 4.8 follow-up cycle ran from followup1 through followup37
(2024–2026) and produced 33 handoff docs across four unmerged branches
(`wave4.8-followup34a/b/c`, `wave4.8-followup35`, `wave4.8-followup36`,
`wave4.8-followup37`) plus the closed-out followups 1–33 in the main
working tree. The cycle was productive for followups 1–34 (it shipped
lane 28 pieces 1–4, lane 71 piece 5/N, lane 27 piece 5/N, plus the
priority work for several other lanes), then stalled.

This doc codifies:

1. **Why** the cycle stalled — the structural finding.
2. **What** would unblock it — concrete resumption conditions.
3. **What to do with the 16 stale markers** in the engine — the cleanup
   task that has been deferred behind no-ships.
4. **Index of the wave** — a reading order for future readers, since
   there isn't one.

This doc is the formal close. The cycle does not produce a followup38.

---

## 1. Why the cycle stalled

The cycle was designed around a **fixture-driven priority queue**:

- Card fixtures are added regularly to the engine.
- Each fixture potentially pulls forward a new schema, REPLACE shape, or
  keyword axis.
- The follow-up cycle ships those extensions one at a time, prioritizing
  by literal-need (pre-flight #2: does any fixture actually call this
  shape?).

That substrate state held for followups 1–34. From followup35 onward, the
queue ran dry. Three cycles of pre-flight #2 on the same priority list
returned zero callers:

| Followup | Result                                                   | New substrate since previous |
| -------- | -------------------------------------------------------- | ---------------------------- |
| 35       | No callers for lane 28 piece 5/N or lane 71 piece 6/N    | (baseline)                   |
| 36       | Same; stale-marker audit confirms zero live arms         | None                         |
| 37       | Same; fresh pre-flight #2 + audit confirm zero live arms | None                         |

The cycle was producing no-ship follow-ups in series because **no card-script
work was pulling the priority queue forward**. This is not a bug in the
cycle; the cycle's hard rule ("don't ship without a real caller") enforced
itself correctly. But the rule was designed to filter premature work, not
to absorb an empty input queue indefinitely. When the queue is empty, the
correct response is to close the cycle, not to keep issuing follow-ups
that say "still nothing."

The decision to close was made at the start of followup38. The user (the
human in the loop) reviewed the three-no-ship pattern, agreed the cycle's
premise no longer held, and instructed the agent to write this closing
doc rather than continue the loop.

---

## 2. What unblocks resumption

The wave 4.8 follow-up cycle can resume when **at least one** of the
following holds:

### 2a. A new card fixture surfaces a need

The cycle was fixture-driven. If a fixture is added whose text requires
an extension or REPLACE shape that is **not yet in the schema** — for
example, a card that says "this creature gains hexproof until end of
turn" with a REPLACE shape that doesn't yet exist — then the next
follow-up cycle has a real candidate.

**Verification before resuming:**

```sh
git diff main..HEAD --name-only -- 'src/'
# (should be non-empty: at least one card fixture or script changed)
```

If `git diff main..HEAD -- 'src/'` is empty, the substrate has not
changed and a new follow-up would be the same no-ship pattern.

### 2b. A human-scoping decision to speculatively ship

If a human (project maintainer, not an agent) decides that the deferred
arms are worth building speculatively, the cycle can resume under a
**modified protocol**: "build with TDD scaffolding and a TODO for the
first real fixture." This violates the cycle's original hard rule but
makes sense if a human has accepted the cost of building unused code.

**Verification before resuming:**

- A maintainer has explicitly signed off on speculative ship.
- The decision is recorded in `docs/card-scripts/wave4.8-closed.md` as
  an amendment (see §5 below).
- The first follow-up writes tests that describe the shape being built
  and marks them `it.todo` or similar until a fixture exists.

### 2c. A meta-decision to formally close (already taken)

This is the path this doc takes. The cycle is closed. Reopening it
requires one of 2a or 2b above, OR a new meta-decision recorded as an
amendment to this doc.

### 2d. A new priority list entirely

If a future card-script initiative surfaces work that is **not on the
followup35/36/37 priority list**, the cycle may resume against that new
list rather than the closed-out one. The closed-out priority list
(lane 28 piece 5/N, lane 71 piece 6/N) does not get reopened under this
trigger — those arms are archived per §3.

---

## 3. What to do with the 16 stale markers

The followup36 handoff enumerated the markers; the followup36 stale-marker
audit classified each. All 16 are stale. None represent work that's
waiting on a fixture; all are either cycle metadata or leftover comments
from arms that were shipped, abandoned, or never picked up.

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

**Recommendation: a single dedicated follow-up to clean up the stale
markers, distinct from the cycle.** This follow-up is **not** part of
the wave 4.8 follow-up series. It is a cleanup task that should be
scoped as a one-time PR.

For each marker, the cleanup follow-up decides one of:

- **Remove the marker comment** if the underlying feature shipped and
  the comment is a leftover artifact. (Most markers fall here.)
- **Convert the marker to a `// TODO(fixture-needed):` comment** if the
  marker documents an arm that was deliberately deferred. This keeps the
  signal alive in the codebase but removes the false promise of an
  upcoming follow-up.
- **Convert the marker to a JIRA/issue reference** if the underlying arm
  is being tracked elsewhere. (None currently qualify.)

**Important: the cleanup follow-up is NOT in scope for this doc.** This
doc records the audit results and the recommendation. A separate
follow-up, scoped by a human, should land the cleanup. Until that
follow-up lands, the stale markers remain in the codebase as historical
artifacts.

---

## 4. Index of the wave

For future readers who need to trace the wave 4.8 series, this is a
reading order.

### Landed work (shipped)

| Followup      | Doc                                       | What shipped                                                                                               |
| ------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1–14          | (batched in early commits)                | Initial wave setup, schema foundations, base card-script infrastructure                                    |
| 15–24         | (batched)                                 | First lanes: layer-system, replacement-effects, trigger-system, state-based-actions scaffolding            |
| 25–31         | (batched in `0a4f54cf`)                   | Lane expansion; per-pair-with extensions; priority-axis work                                               |
| 28 priority 3 | (subset of `0a4f54cf`)                    | Lane 27 piece 5/N (`andPer.perCounterSummed`)                                                              |
| 32            | `wave4.8-followup32-handoff.md`           | Handoff doc only; tests for lane32-andper-percounter-summed pass 8/8                                       |
| 33            | `wave4.8-followup33-handoff.md`           | Lane 71 piece 5/N (`chosenProtectionFromPerPair`) shipped                                                  |
| 34a           | branch `wave4.8-followup34a`              | (not merged to main; lane 28 piece 1/N: `set_subtype`)                                                     |
| 34b           | branch `wave4.8-followup34b`              | (not merged to main; lane 28 piece 2/N: `set_type`)                                                        |
| 34c           | branch `wave4.8-followup34c` (`86c57145`) | Lane 28 piece 3/N (`set_color_identity`) + piece 4/N (`set_color`) + cross-axis tests — **LANE 28 CLOSED** |

### No-ships (deferred, doc-only)

| Followup | Doc                                                                      | Why no-ship                                                                       |
| -------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 35       | `wave4.8-followup35-handoff.md` (branch `wave4.8-followup35` `3205af99`) | No callers for lane 28 piece 5/N or lane 71 piece 6/N. Omitted loop-done summary. |
| 36       | `wave4.8-followup36-handoff.md` (branch `wave4.8-followup36` `9aaa2655`) | Same. First stale-marker audit. First loop-done summary.                          |
| 37       | `wave4.8-followup37-handoff.md` (branch `wave4.8-followup37` `04adde90`) | Same. Three-no-ship pattern codified. Recommended Option B (close the wave).      |

### Closed-out

The wave is closed as of this doc. There is no followup38.

---

## 5. Amendments

This section is for future amendments to the closing decision. To
reopen the cycle, add an entry here describing the trigger (§2a, §2b,
or §2d) and a follow-up number if a new cycle is being launched.

_Empty as of this doc's commit. No amendments._

---

## 6. Cross-references

- `docs/card-scripts/wave45-next-session.md` — canonical cycle protocol.
- `docs/card-scripts/wave4.8-followup36-handoff.md` — first stale-marker
  audit and first loop-done summary.
- `docs/card-scripts/wave4.8-followup37-handoff.md` — three-no-ship
  pattern codification; recommended Option B.
- `docs/card-scripts/wave4.8-followup35-handoff.md` — first no-ship.
- `.foreman/state/wave4.8-followup36.md` — runtime-only prompt file
  for followup36 (not tracked).
- `.foreman/state/wave4.8-followup37.md` — runtime-only prompt file
  for followup37 (not tracked).

---

## 7. File-recap

This doc is committed as the final record of the wave 4.8 follow-up
cycle. It is not a follow-up handoff; it does not introduce a
followup38. Its purpose is to close the cycle cleanly, codify the
stall diagnosis, and provide a reading index for the wave.

No code changed. No tests added. No fixtures added. No engine-size-budget
change. No schema change. No stale markers removed (cleanup is a
separate, future follow-up — see §3).

End of wave 4.8 closing doc.
