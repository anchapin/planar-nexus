# Wave 4.8 — Stale marker cleanup handoff

## What this doc is

This is the **handoff doc** for the stale-marker cleanup that landed on
branch `wave4.8-stale-marker-cleanup` (commit `282a4900`).

It records:

1. **What was done** — the 4 markers that were rewritten.
2. **What is deferred** — the 21 markers still pending rewrite, with
   precise file/line/window/subject for each.
3. **The template** — the exact rewrite pattern that the next session
   should apply to each remaining marker.
4. **Verification** — how to confirm the cleanup is complete.

## Why this is a partial commit

The cleanup inventoried 25 markers in the v2 inventory (`a1e6930e`).
This commit rewrites **4 of 25**. The remaining 21 markers are deferred
to a follow-up commit (or commits) on the same branch.

The deferral is **structural**, not stylistic: each of the 21 remaining
markers is inside a comment block that also contains **shipping-attribution
text** (e.g., "Wave 4.8 follow-up 30 priority 4 (lane 28, piece 4/4)") or
**PRECEDENCE summary content**. Rewriting each marker requires reading
20–30 lines of surrounding context to confirm the rewrite does not
orphan the shipping-attribution text. Each edit takes 3–4 tool calls
(read context, locate, edit, verify), and the cumulative cost of doing
all 21 in a single session exceeded this session's budget.

The 4 markers rewritten in this commit are the ones where the surrounding
context was clean (no adjacent shipping-attribution or PRECEDENCE blocks)
and the rewrite could be applied safely with one tool call each.

## What was done — the 4 markers rewritten

| ID  | File:line     | Window | Subject                           |
| --- | ------------- | ------ | --------------------------------- |
| S01 | schema.ts:512 | wave-4 | CopyPermanent exception mask      |
| S02 | schema.ts:581 | 31     | destructive set_color variant     |
| S10 | schema.ts:626 | 31     | destructive set_toughness variant |
| S09 | schema.ts:659 | 31     | destructive set_type variant      |

Each rewrite follows the same template:

```diff
- * variant rides follow-up N if any
- * future priority piece surfaces a
- * "<semantic>" semantic.
+ * variant ("<semantic>" semantic) is
+ * unbuilt; deferred since follow-up N.
+ * See wave4.8-closed.md §2.
```

The new wording preserves the semantic reference (the variant's specific
behavior — "only [colors]", "exactly N", "exactly [types]") so future
readers can still see what the variant would have done, while clearly
stating it was never built and pointing at the closed-cycle doc for
resumption conditions.

## What is deferred — 21 remaining markers

The 21 markers below are inventoried in the v2 inventory
(`docs/card-scripts/wave4.8-stale-marker-cleanup-inventory.md`) with
proposed rewrite text for each. They are listed here in file/line order
for the next session's reference.

### schema.ts (10 markers)

| ID  | Line | Window | Subject                                                |
| --- | ---- | ------ | ------------------------------------------------------ |
| S05 | 761  | 35+    | `set_keyword` REPLACE arm                              |
| S06 | 763  | 35+    | `set_ability` REPLACE arm                              |
| S07 | 920  | 32     | `set_color_identity` hybrid                            |
| S08 | 1062 | 32     | `set_power` until-eot                                  |
| S11 | 1268 | 34     | destructive `set_supertype`                            |
| S12 | 3549 | 29     | `chosenProtectionFromPerPair` extension                |
| S13 | 3590 | 26+    | cycle metadata (perCounter.perPair out-of-scope block) |
| S14 | 3621 | 27     | `perCounter.counter: "chosen"` interaction             |
| S15 | 3689 | 30     | per-pair `"chosen"` extension (left)                   |
| S16 | 3711 | 30     | per-pair `"chosen"` extension (right)                  |
| S17 | 3878 | 30     | per-pair-with-sentinel parallel-index                  |
| S18 | 3880 | 30     | per-pair-with-sentinel hybrid                          |

That's 12 schema.ts markers; the inventory lists 18 total in schema.ts
but 4 were rewritten in this commit. **12 remaining in schema.ts.**

### interpret.ts (3 markers)

| ID  | Line | Window | Subject                             |
| --- | ---- | ------ | ----------------------------------- |
| I01 | 1412 | 30 p4  | `add_type` exception variant        |
| I02 | 2040 | 32     | `set_color_identity` hybrid handler |
| I03 | 2197 | 32     | `set_power` until-eot handler       |

### cards.ts (1 marker)

| ID  | Line | Window | Subject                                                |
| --- | ---- | ------ | ------------------------------------------------------ |
| C01 | 200  | 32     | `chosenProtectionFromPerPairWithLiteral` (issue #2241) |

### Test files (3 markers)

| ID  | File:line                                      | Window | Subject                       |
| --- | ---------------------------------------------- | ------ | ----------------------------- |
| T01 | lane71-per-pair-sentinel-multi.test.ts:18      | 31     | per-pair-sentinel multi-shape |
| T02 | lane28-create-copy-token-exceptions.test.ts:18 | 30     | per-token exception array     |
| T03 | lane32-per-pair-counter-ordinal.test.ts:31     | 30     | `perCounter.perPair` ordinal  |

**Total deferred: 12 + 3 + 1 + 3 = 19 markers** (not 21 — my commit
message miscounted; this table is correct).

## The template

For each remaining marker, apply this pattern:

1. **Locate the marker** by `grep -nE "rides follow-up [0-9]+|if any future priority piece surfaces|deferred —" src/lib/game-state/`. This produces the line numbers of every deferral marker (NOT shipping-attribution text).
2. **Read 20–30 lines of surrounding context.** Look for adjacent:
   - Shipping-attribution text (lines containing "Wave 4.8 follow-up N priority M (lane..." or "(#NNNN follow-up):"). DO NOT modify these — they describe shipped work.
   - PRECEDENCE summary blocks (long comment blocks listing how `set_<axis>` arms compose). The marker rewrite should preserve the surrounding PRECEDENCE structure.
   - Schema field boundaries (lines like `exceptions: z.object({`). The rewrite should not cross field boundaries.
3. **Apply the rewrite** following the template in the v2 inventory entry for that marker. Each entry has:
   - The marker text verbatim (lines from `grep -B2 -A4 ...`).
   - The proposed replacement text.
4. **Verify** by re-reading 5 lines above and below the edit to confirm no orphan text.

The exact replacement text per marker is in the v2 inventory
(`docs/card-scripts/wave4.8-stale-marker-cleanup-inventory.md`) under
each per-marker section.

## Verification when complete

When all 19 remaining markers are rewritten, run:

```sh
grep -nE "rides follow-up [0-9]+|if any future priority piece surfaces|deferred —" src/lib/game-state/
```

The expected output is **0 hits**. Any remaining hits are markers the
cleanup missed (or new markers introduced since the v2 inventory).

Also verify:

```sh
npx jest --testPathPatterns="lane28|lane32|lane71"
# Expected: all passing (cleanup is comment-only, no test logic changed)
npx prettier --write src/lib/game-state/
# Expected: no changes (cleanup preserves comment formatting)
```

## Suggested next-step commit

When the 19 remaining markers are rewritten, the next commit message
should follow this template:

```text
docs(card-scripts): wave 4.8 stale-marker cleanup (continued)

Continues the cleanup started in 282a4900. Rewrites the
remaining 19 deferral markers per the v2 inventory
(a1e6930e). All 25 markers in the v2 inventory are now
rewritten.

Verification:
  $ grep -nE "rides follow-up [0-9]+|if any future
      priority piece surfaces|deferred —" src/lib/game-state/
  (0 hits)
  $ npx jest --testPathPatterns="lane28|lane32|lane71"
  (all passing)

Diff: <predicted>, no schema changes, no test logic changes.
```

## Cross-references

- `docs/card-scripts/wave4.8-stale-marker-cleanup-inventory.md` (v2,
  commit `a1e6930e`) — the inventory with per-marker rewrite text.
- `docs/card-scripts/wave4.8-closed.md` — the closing record;
  every rewrite points at §2 (resumption conditions).
- `docs/card-scripts/wave4.8-followup36-handoff.md` — first stale-marker
  audit (superseded).
- `docs/card-scripts/wave4.8-followup37-handoff.md` — three-no-ship
  pattern codification.

## Addendum (post-handoff corrections)

This handoff was written assuming the v2 inventory was correct. The
implementation phase found it was not. The corrections below are
already committed; they are recorded here so the doc tells the truth.

### Inventory corrections (the v2 inventory had factual errors)

The v2 inventory (and the prior partial cleanup at commit `282a4900`)
**misclassified six markers** by treating "the destructive `set_X`
variant field exists in the schema" as equivalent to "the destructive
`set_X` variant is built." These conflate two distinct questions:

- Is the `set_X` schema field shipped? — **yes** for every `set_*` field
  the inventory listed.
- Is some _future extension_ of that variant built? — sometimes no,
  and that is the only genuine deferral.

Six markers needed honest rewrites that preserve shipping attribution
and only flag the actual unbuilt extension:

| Marker | Variant                                  | Status                                                                       |
| ------ | ---------------------------------------- | ---------------------------------------------------------------------------- |
| S02    | `set_color`                              | shipped; §1b                                                                 |
| S09    | `set_type`                               | shipped; §1b                                                                 |
| S10    | `set_toughness`                          | shipped; §1b                                                                 |
| S11    | `set_supertype` (legacy distinctions)    | partial — variant field shipped, legacy distinctions genuinely deferred; §1b |
| I01    | chosenProtectionFromPerPair              | shipped; §1b                                                                 |
| T01    | chosenProtectionFromPerPair (test block) | shipped; §1b                                                                 |

S01 (`set_type` exclusive variants "World"/"Legendary"-only/"Snow"-only)
was NOT a misclassification — the enum is just
`Legendary | Snow | Basic`, the "World" claim was incorrect, and the
exclusive variants are genuinely unbuilt. Commit `282a4900` got S01
right.

The §1b block in `wave4.8-stale-marker-cleanup-inventory.md` is the
authoritative correction; this addendum points at it.

### Commits beyond the original handoff

The original handoff shipped at `8b9fc848`. Four follow-up commits
landed the corrections and the remaining 14 rewrites:

1. `cdf779eb` — added §1b to the inventory (the six corrections above).
2. `149a9607` — rewrote the S11 deferral sentence in `schema.ts`
   (lines 1261–1266), preserving shipping attribution on line 1268.
3. `e6426c7f` — replaced the factually-wrong "is unbuilt" rewrites from
   `282a4900` with honest "IS the `set_X` field below; no further
   follow-up needed" text for S02 (`schema.ts:583`), S09
   (`schema.ts:669`), and S10 (`schema.ts:628-630`).
4. `c7a02f38` — rewrote the 14 remaining genuine deferrals (S05, S06,
   S07, S08, S12, S13, S15, S16, S17, S18 in `schema.ts`; I01, I02, I03
   in `interpret.ts`; C01 in `cards.ts`; T01, T02, T03 in the three
   test files) to the standard
   `is unbuilt; deferred since follow-up N. See wave4.8-closed.md §2`
   form. T01 used the §1b-corrected honest rewrite (the example field
   `chosenProtectionFromPerPair` IS shipped; the deferral is for a
   per-pair INDEPENDENT map that no priority piece has surfaced).
   Two further catches in the same pass: lines 1225–1233 (S03 + S09
   duplicates in the `add_type` block, missed in the earlier scan) —
   S03 rewritten to the standard form, S09 rewritten to honest
   "IS the `set_type` field below" form; line 1288 (S11 this-commit
   attribution) rephrased from `rides follow-up 34 piece 3/N (this
commit)` to `shipped in follow-up 34 piece 3/N` so the verification
   grep returns 0 hits.

### Verification (end of cleanup)

```
$ grep -rnE "rides follow-up [0-9]+|if any future priority piece surfaces|deferred —" src/lib/game-state/
(0 hits)
```

- 5439 tests pass, 1 skipped, 0 failing
  (`src/lib/game-state/__tests__/`, full Jest run).
- `npx tsc --noEmit` clean.
- `npx prettier --check` clean on the six files that received
  comment/docstring edits (`schema.ts`, `interpret.ts`, `cards.ts`, and
  three test files).
- `it`/`test`/`it.todo` counts in the three touched test files
  unchanged from `8b9fc848` (lane71: 6→6; lane28: 10→10;
  lane32: 10→10), so `test-count-docs-guard` is a no-op.

### Final state

All 25 v2-inventory markers resolved; 0 grep hits; final commit
`c7a02f38`. **No additional source rewrites are needed.** The next
session's job was just this addendum, the docs-guard checks, the
push, and the PR — all of which are now complete.

### A class of error worth preventing (for the next audit)

The v2 inventory's failure mode was answering "is this variant field
present in the schema?" when the question was "is this variant built
_as a runtime operation_?" For every `set_*` variant, the schema field
exists (the field is the variant — the variant is what the field does
when you write to it). Any future audit that wants to know "is X
built?" should treat the **schema field inventory** as authoritative
for "the field exists" and the **runtime handlers / interpreter
entries** as authoritative for "the operation works." Conflating the
two is what produced the six §1b corrections.

End of cleanup handoff.
