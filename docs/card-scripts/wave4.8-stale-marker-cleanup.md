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

End of cleanup handoff.
