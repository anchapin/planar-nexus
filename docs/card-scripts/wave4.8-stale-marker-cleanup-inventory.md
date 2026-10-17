# Wave 4.8 — Stale marker cleanup inventory (v2)

## What this doc is

This is the **decision packet** for cleaning up the 25 "rides follow-up N"
markers left in the engine after the wave 4.8 follow-up cycle closed.

This doc is the **v2 revision** of the original inventory
(commit `9a9575ff`). The original inventory had six REMOVE verdicts
(S01, S03, S04, S11, S13, T02) that were wrong: each marker was inside a
larger documentation/PRECEDENCE block, and removing the marker would
orphan the surrounding sentences. The v2 inventory collapses the
REMOVE/CONVERT-TO-TODO/CONVERT-TO-ISSUE distinction into a single
treatment: **KEEP-AND-REVISE every marker, rewriting the "rides follow-up N"
sentence to point to the closed-cycle doc while preserving the surrounding
documentation.**

## Why the verdicts collapsed

The original audit's three-way classification assumed:

- REMOVE = marker text is a leftover artifact, safe to delete.
- CONVERT-TO-TODO = live-deferred arm, convert to `TODO(fixture-needed):`.
- CONVERT-TO-ISSUE = live-deferred arm with external issue reference.

But in practice, **every marker is part of a larger comment block** (PRECEDENCE
summary, test docstring, or schema description). The marker text is one
sentence in a multi-sentence description of what the surrounding code does
and doesn't support. Removing the marker — or replacing it with a TODO —
breaks the surrounding documentation's logic flow: it leaves sentences
referring to a "follow-up N" that no longer exists, or referring to a
feature that no longer has documentation.

The right edit is **rewrite the marker sentence in place** to point at
`wave4.8-closed.md §2` (the cycle's resumption conditions) while preserving
the rest of the comment block. This keeps the documentation coherent and
gives future readers a single destination to learn why the arm is deferred
and what would unblock it.

## What this doc does

For each of the 25 markers, this v2 inventory records:

- **File + line + window** (where the marker is).
- **The marker sentence verbatim** (the line(s) that say "rides follow-up N").
- **The proposed replacement sentence** (a rewrite that points at the
  closed-cycle doc and preserves the surrounding semantic).
- **The replacement's destination** (issue-ref vs cycle-doc-ref vs plain
  cycle-doc-ref).

## What this doc does NOT do

- **No source files are edited by this commit.** The doc is the decision
  packet. Edits land in the next commit.
- **No new tests added.** Test-file marker rewrites are docstring edits.
- **No schema changes.** All edits are comment-only.

---

## 1. Source markers in `src/lib/game-state/card-scripts/schema.ts`

### S01 — schema.ts:512

- **Window**: pre-wave-4.8 (follow-up 4 of the original wave 4)
- **Subject**: `CopyPermanent` copy-with-exception variant (Phyrexian
  Metamorph-style)
- **Marker text** (lines 511–517):
  ```text
  * copy-with-exception variant (Phyrexian
  * Metamorph-style — name + types +
  * color, but not text/abilities/loyalty)
  * rides follow-up 4 piece 2/N + 3/N + 4/N
  * (this commit). Lane 28 owns the parent
  * shape; the exception mask rides
  * `copy_with_exception_mask` once a
  * priority piece surfaces.
  ```
- **Proposed rewrite**:
  ```text
  * copy-with-exception variant (Phyrexian
  * Metamorph-style — name + types +
  * color, but not text/abilities/loyalty)
  * is unbuilt. Lane 28 owns the parent shape;
  * the exception mask rides
  * `copy_with_exception_mask` if a future
  * fixture surfaces a need. See
  * docs/card-scripts/wave4.8-closed.md
  * §2 (resumption conditions).
  ```
- **Notes**: This marker is the closing sentence of a 30-line "Out of
  scope (each a follow-up lane)" comment block listing deferred lanes.
  The new wording preserves the listing semantics without claiming a
  follow-up that will happen.

### S02 — schema.ts:581

- **Window**: 31
- **Subject**: Destructive `set_color` variant ("only [colors]" semantic)
- **Marker text** (lines 579–582):
  ```text
  * a destructive
  * `set_color` variant rides follow-up
  * 31 if any future priority piece
  * surfaces a "only [colors]" semantic.
  ```
- **Proposed rewrite**:
  ```text
  * a destructive
  * `set_color` variant ("only [colors]"
  * semantic) is unbuilt; deferred since
  * follow-up 31. See wave4.8-closed.md
  * §2.
  ```
- **Notes**: Base `set_color` shipped (20 refs in schema.ts); the
  destructive variant never built.

### S03 — schema.ts:625

- **Window**: 34 (this commit)
- **Subject**: `set_supertype` exclusive "World" / "Legendary" / "Snow" variants
- **Marker text** (lines 623–627):
  ```text
  * ships in follow-up 34 piece 2/N. The
  * exclusive variants
  * (`"World"` / `"Legendary"`-only
  * / `"Snow"`-only) ride follow-up
  * 34 piece 3/N (this commit).
  ```
- **Proposed rewrite**:
  ```text
  * ships in follow-up 34 piece 2/N. The
  * exclusive variants
  * (`"World"` / `"Legendary"`-only
  * / `"Snow"`-only) are unbuilt; deferred
  * since follow-up 34. See
  * wave4.8-closed.md §2.
  ```
- **Notes**: This marker is the closing sentence of a 60-line PRECEDENCE
  summary for `CopyPermanentSchema.exceptions`. The "this commit" tag in
  the original marker was misleading: the work did not ship with
  followup34 piece 3/N. The new wording reflects that.

### S04 — schema.ts:658

- **Window**: 34 (this commit)
- **Subject**: `set_supertype` exclusive variants (paired closing remark)
- **Marker text**: closing remark of the same comment block as S03.
- **Proposed rewrite**: paired with S03.
- **Notes**: Lines 658 onward are a continuation of the same PRECEDENCE
  block; the marker line 658 is one sentence in the closing remarks.

### S05 — schema.ts:761

- **Window**: 35+
- **Subject**: `set_keyword` REPLACE arm
- **Marker text** (lines 758–760):
  ```text
  *   - `set_keyword` (deferred —
  *     rides follow-up 35+ if any future priority
  *     piece surfaces a need)
  ```
- **Proposed rewrite**:
  ```text
  *   - `set_keyword` (deferred —
  *     unbuilt; cycle closed without
  *     a fixture surfacing this need.
  *     See wave4.8-closed.md §2)
  ```
- **Notes**: This was the closed-out priority list's top item. Base
  `set_keyword` was never built (1 ref = the marker itself only).

### S06 — schema.ts:763

- **Window**: 35+
- **Subject**: `set_ability` REPLACE arm
- **Marker text**: paired with S05.
- **Proposed rewrite**: paired with S05.
- **Notes**: Same shape; same evidence (1 ref = marker only).

### S07 — schema.ts:919

- **Window**: 32
- **Subject**: `set_color_identity` hybrid variant
- **Marker text** (lines 919–925):
  ```text
  *    set on the same effect.
  *    A separate `set_color_identity`
  *    variant (which overrides identity
  *    but leaves printed colors intact)
  *    rides follow-up 32. The base
  *    `set_color_identity` form ships in
  *    follow-up 34 piece 3/N.
  ```
- **Proposed rewrite**:
  ```text
  *    set on the same effect.
  *    A separate `set_color_identity`
  *    variant (which overrides identity
  *    but leaves printed colors intact)
  *    is unbuilt; deferred since follow-up 32.
  *    The base `set_color_identity` form
  *    ships in follow-up 34 piece 3/N.
  *    See wave4.8-closed.md §2.
  ```

### S08 — schema.ts:1061

- **Window**: 32
- **Subject**: `set_power` until-eot variant
- **Marker text** (lines 1058–1063):
  ```text
  *     until-eot axis: a destructive
  *     `set_power` variant (REPLACE
  *     wins, but only for the
  *     duration) rides follow-up 32
  *     (hybrid that mirrors lane 75c
  *     `become_copy` until-eot shape).
  ```
- **Proposed rewrite**:
  ```text
  *     until-eot axis: a destructive
  *     `set_power` variant (REPLACE
  *     wins, but only for the
  *     duration) is unbuilt; deferred since
  *     follow-up 32. Hybrid mirrors lane 75c
  *     `become_copy` until-eot shape.
  *     See wave4.8-closed.md §2.
  ```

### S09 — schema.ts:1099

- **Window**: 32
- **Subject**: Destructive `set_type` variant
- **Marker text** (lines 1096–1099):
  ```text
  * printed types); a destructive
  * `set_type` variant rides
  * follow-up 32 if any future
  * priority piece surfaces a need.
  ```
- **Proposed rewrite**:
  ```text
  * printed types); a destructive
  * `set_type` variant is unbuilt;
  * deferred since follow-up 32.
  * See wave4.8-closed.md §2.
  ```

### S10 — schema.ts:1214

- **Window**: 32
- **Subject**: Destructive `set_toughness` variant
- **Marker text**: same shape as S09.
- **Proposed rewrite**: same shape as S09, with `set_toughness`.

### S11 — schema.ts:1267

- **Window**: 34 (this commit)
- **Subject**: Destructive `set_supertype` variant
- **Marker text** (lines 1264–1267):
  ```text
  * printed supertypes); a destructive
  * `set_supertype` variant rides
  * follow-up 34 piece 3/N (this
  * commit).
  ```
- **Proposed rewrite**:
  ```text
  * printed supertypes); a destructive
  * `set_supertype` variant is unbuilt;
  * deferred since follow-up 34.
  * See wave4.8-closed.md §2.
  ```
- **Notes**: Paired with S03/S04. Same "this commit" marker style.

### S12 — schema.ts:3548

- **Window**: 29
- **Subject**: `chosenProtectionFromPerPair` extension
- **Marker text** (lines 3545–3549):
  ```text
  * extension of the per-pair-with-
  * `"chosen"` extension rides
  * follow-up 29 (the
  * `chosenProtectionFromPerPair`
  * feature ships in follow-up 30).
  ```
- **Proposed rewrite**:
  ```text
  * extension of the per-pair-with-
  * `"chosen"` extension is unbuilt;
  * deferred since follow-up 29 (the
  * `chosenProtectionFromPerPair`
  * feature never shipped; cycle
  * closed). See wave4.8-closed.md §2.
  ```
- **Notes**: **Important:** the original marker said the feature ships
  in follow-up 30, but it never shipped and the cycle closed without
  delivering it. The new wording is honest about that.

### S13 — schema.ts:3589

- **Window**: 26+ (cycle metadata)
- **Subject**: Cycle metadata referencing wave 4.8 follow-up cycle start
- **Marker text** (lines 3583–3591):
  ```text
  * Out of scope (each a follow-up lane):
  * explicit `target: CardInstanceId`
  * arg, multi-target replacement, and
  * the `chosen`-per-pair extension of
  * `perCounter.perPair` (the wave 4.8
  * follow-up cycle's v1 priority 2+;
  * this comment is the v1 minimum
  * marker; the follow-up cycle owns
  * the extension once a priority
  ```
- **Proposed rewrite**:
  ```text
  * Out of scope (each a follow-up lane):
  * explicit `target: CardInstanceId`
  * arg, multi-target replacement, and
  * the `chosen`-per-pair extension of
  * `perCounter.perPair`. The wave 4.8
  * follow-up cycle closed without
  * a fixture surfacing this need;
  * see wave4.8-closed.md §2.
  ```

### S14 — schema.ts:3620

- **Window**: 27
- **Subject**: `perCounter.counter: "chosen"` parallel count
- **Marker text** (lines 3617–3621):
  ```text
  * (`perCounter.counter: "chosen"`
  * parallel count for each
  * counter-pair-side) rides follow-up
  * 27 if any future priority piece
  * surfaces a need.
  ```
- **Proposed rewrite**:
  ```text
  * (`perCounter.counter: "chosen"`
  * parallel count for each
  * counter-pair-side) is unbuilt;
  * deferred since follow-up 27.
  * See wave4.8-closed.md §2.
  ```

### S15 — schema.ts:3688

- **Window**: 30
- **Subject**: Per-pair-with-`"chosen"`-per-pair extension (left side)
- **Marker text** (lines 3685–3689):
  ```text
  *   - "chosen" extension is read
  *     from a per-pair sentinel map
  *     (per pair,
  *     rides follow-up 30; the
  *     base `perCounter.perPair` reads
  ```
- **Proposed rewrite**:
  ```text
  *   - "chosen" extension is read
  *     from a per-pair sentinel map
  *     (per pair, unbuilt; deferred
  *     since follow-up 30; the base
  *     `perCounter.perPair` reads
  ```
- **Notes**: Multi-line marker; needs careful line-by-line replacement
  to keep the comment block's continuation coherent.

### S16 — schema.ts:3710

- **Window**: 30
- **Subject**: Per-pair-with-`"chosen"`-per-pair extension (right side)
- **Marker text**: continuation of S15's block.
- **Proposed rewrite**: continuation of S15's rewrite.

### S17 — schema.ts:3877

- **Window**: 30
- **Subject**: Per-pair-with-sentinel extension (parallel index variant)
- **Marker text** (lines 3874–3877):
  ```text
  * until-eot axis:
  * per-pair-with-sentinel extension
  * (`perCounter.perPair[index].counter`
  * extension rides follow-up 30 too).
  ```
- **Proposed rewrite**:
  ```text
  * until-eot axis:
  * per-pair-with-sentinel extension
  * (`perCounter.perPair[index].counter`
  * extension is unbuilt; deferred since
  * follow-up 30).
  ```

### S18 — schema.ts:3879

- **Window**: 30
- **Subject**: Per-pair-with-sentinel hybrid (literal mapping)
- **Marker text**: paired continuation of S17's block.
- **Proposed rewrite**: paired with S17.

---

## 2. Source markers in `src/lib/game-state/card-scripts/interpret.ts`

### I01 — interpret.ts:1412

- **Window**: 30 priority 4
- **Subject**: `add_type` exception variant for parallel additive merges
- **Marker text** (lines 1408–1412):
  ```text
  // `add_power` for parallel P/T
  // additive merges.
  //
  // `add_type` except
  // rides follow-up 30 priority 4.
  ```
- **Proposed rewrite**:
  ```text
  // `add_power` for parallel P/T
  // additive merges.
  //
  // `add_type` exception variant is
  // unbuilt; deferred since follow-up 30
  // priority 4. See wave4.8-closed.md §2.
  ```

### I02 — interpret.ts:2040

- **Window**: 32
- **Subject**: `set_color_identity` hybrid handler
- **Marker text** (lines 2037–2041):
  ```text
  // identity override that leaves
  // printed colors intact) the hybrid
  // rides follow-up 32; see the
  // `set_color_identity` comment in
  // schema.ts for the precise semantic.
  ```
- **Proposed rewrite**:
  ```text
  // identity override that leaves
  // printed colors intact) the hybrid
  // is unbuilt; deferred since follow-up
  // 32; see the `set_color_identity`
  // comment in schema.ts for the
  // precise semantic. See
  // wave4.8-closed.md §2.
  ```

### I03 — interpret.ts:2197

- **Window**: 32
- **Subject**: `set_power` until-eot handler
- **Marker text** (lines 2194–2198):
  ```text
  // hybrid that rides follow-up 32).
  // For now the SCHEMA path is the
  // only consumer; the interpret
  // handler will land when a fixture
  // surfaces the need.
  ```
- **Proposed rewrite**:
  ```text
  // hybrid is unbuilt; deferred since
  // follow-up 32). For now the SCHEMA
  // path is the only consumer; the
  // interpret handler will land when
  // a fixture surfaces the need.
  // See wave4.8-closed.md §2.
  ```

---

## 3. Source markers in `src/lib/game-state/types/cards.ts`

### C01 — cards.ts:200

- **Window**: 32
- **Subject**: `chosenProtectionFromPerPairWithLiteral` (issue #2241)
- **Marker text** (lines 195–199):
  ```text
   * `chosenProtectionFromPerPairWithLiteral`
   * extension of the per-pair-with
   * literal independent sentinel-
   * resolution field on `CardInstance`
   * (issue #2241 follow-up).
  ```
- **Proposed rewrite**:
  ```text
   * `chosenProtectionFromPerPairWithLiteral`
   * extension of the per-pair-with
   * literal independent sentinel-
   * resolution field on `CardInstance`
   * is unbuilt (was the closed-out
   * priority list's second item; see
   * wave4.8-closed.md §2; original
   * issue #2241).
  ```

---

## 4. Test-file markers

### T01 — lane71-per-pair-sentinel-multi.test.ts:18

- **Window**: 31
- **Subject**: Test docstring about per-pair-sentinel multi-shape
- **Marker text** (lines 14–19):
  ```text
   * dedupes at write time. v1 minimum: the
   * single-instance-field model (parallel to the
   * lane 5
   * chosenProtectionFromPerPair). Future
   * extension rides follow-up 31 (the
   * per-pair-with-sentinel multi-shape).
  ```
- **Proposed rewrite**:
  ```text
   * dedupes at write time. v1 minimum: the
   * single-instance-field model (parallel to the
   * lane 5 chosenProtectionFromPerPair; that
   * feature is unbuilt — see
   * wave4.8-closed.md §2). Future extension
   * would be the per-pair-with-sentinel
   * multi-shape.
  ```

### T02 — lane28-create-copy-token-exceptions.test.ts:18

- **Window**: 30
- **Subject**: Test docstring about per-token exception array
- **Marker text** (lines 16–18):
  ```text
   * per-token exception array
   * rides follow-up 30).
  ```
- **Proposed rewrite**:
  ```text
   * per-token exception array
   * is unbuilt; deferred since
   * follow-up 30. See
   * wave4.8-closed.md §2).
  ```
- **Notes**: This is a single-sentence marker inside a longer test
  docstring describing what the test does. The new wording preserves
  the test description while removing the false follow-up promise.

### T03 — lane32-per-pair-counter-ordinal.test.ts:31

- **Window**: 30
- **Subject**: Test docstring about `perCounter.perPair` ordinal extension
- **Marker text** (lines 27–31):
  ```text
   * `perCounter.perPair` reads from a
   * per-pair sentinel map (per pair, the
   * chosen-counter ordinal extension rides
   * follow-up 30 too).
  ```
- **Proposed rewrite**:
  ```text
   * `perCounter.perPair` reads from a
   * per-pair sentinel map (per pair, the
   * chosen-counter ordinal extension
   * is unbuilt; deferred since follow-up
   * 30). See wave4.8-closed.md §2.
  ```

---

## 5. Summary

All 25 markers get the same treatment: **rewrite the "rides follow-up N"
sentence to point at `wave4.8-closed.md §2`** with semantic preservation
of the surrounding documentation block.

| ID  | File:line                                      | Window | Subject                                | Destination          |
| --- | ---------------------------------------------- | ------ | -------------------------------------- | -------------------- |
| S01 | schema.ts:512                                  | wave-4 | CopyPermanent exception mask           | cycle-doc §2         |
| S02 | schema.ts:581                                  | 31     | destructive set_color                  | cycle-doc §2         |
| S03 | schema.ts:625                                  | 34     | set_supertype exclusive "World"        | cycle-doc §2         |
| S04 | schema.ts:658                                  | 34     | set_supertype exclusive (paired)       | cycle-doc §2         |
| S05 | schema.ts:761                                  | 35+    | set_keyword                            | cycle-doc §2         |
| S06 | schema.ts:763                                  | 35+    | set_ability                            | cycle-doc §2         |
| S07 | schema.ts:919                                  | 32     | set_color_identity hybrid              | cycle-doc §2         |
| S08 | schema.ts:1061                                 | 32     | set_power until-eot                    | cycle-doc §2         |
| S09 | schema.ts:1099                                 | 32     | destructive set_type                   | cycle-doc §2         |
| S10 | schema.ts:1214                                 | 32     | destructive set_toughness              | cycle-doc §2         |
| S11 | schema.ts:1267                                 | 34     | destructive set_supertype              | cycle-doc §2         |
| S12 | schema.ts:3548                                 | 29     | chosenProtectionFromPerPair            | cycle-doc §2         |
| S13 | schema.ts:3589                                 | 26+    | cycle metadata                         | cycle-doc §2         |
| S14 | schema.ts:3620                                 | 27     | perCounter.counter "chosen"            | cycle-doc §2         |
| S15 | schema.ts:3688                                 | 30     | per-pair "chosen" extension (left)     | cycle-doc §2         |
| S16 | schema.ts:3710                                 | 30     | per-pair "chosen" extension (right)    | cycle-doc §2         |
| S17 | schema.ts:3877                                 | 30     | per-pair-with-sentinel parallel-index  | cycle-doc §2         |
| S18 | schema.ts:3879                                 | 30     | per-pair-with-sentinel hybrid          | cycle-doc §2         |
| I01 | interpret.ts:1412                              | 30 p4  | add_type exception variant             | cycle-doc §2         |
| I02 | interpret.ts:2040                              | 32     | set_color_identity hybrid handler      | cycle-doc §2         |
| I03 | interpret.ts:2197                              | 32     | set_power until-eot handler            | cycle-doc §2         |
| C01 | cards.ts:200                                   | 32     | chosenProtectionFromPerPairWithLiteral | cycle-doc §2 + #2241 |
| T01 | lane71-per-pair-sentinel-multi.test.ts:18      | 31     | per-pair-sentinel multi-shape          | cycle-doc §2         |
| T02 | lane28-create-copy-token-exceptions.test.ts:18 | 30     | per-token exception array              | cycle-doc §2         |
| T03 | lane32-per-pair-counter-ordinal.test.ts:31     | 30     | perCounter.perPair ordinal             | cycle-doc §2         |

---

## 6. Diff stat for the next commit (predicted)

| File                                                                       | Lines changed | Notes                                |
| -------------------------------------------------------------------------- | ------------- | ------------------------------------ |
| `src/lib/game-state/card-scripts/schema.ts`                                | +18 −18 ish   | 18 marker rewrites                   |
| `src/lib/game-state/card-scripts/interpret.ts`                             | +3 −3         | 3 marker rewrites                    |
| `src/lib/game-state/types/cards.ts`                                        | +1 −1         | 1 marker rewrite                     |
| `src/lib/game-state/__tests__/lane71-per-pair-sentinel-multi.test.ts`      | +1 −1         | 1 docstring rewrite                  |
| `src/lib/game-state/__tests__/lane28-create-copy-token-exceptions.test.ts` | +1 −1         | 1 docstring rewrite                  |
| `src/lib/game-state/__tests__/lane32-per-pair-counter-ordinal.test.ts`     | +1 −1         | 1 docstring rewrite                  |
| `docs/card-scripts/wave4.8-stale-marker-cleanup.md`                        | new           | handoff doc describing what was done |

Plus the v2 inventory doc (this file) and the v1 cleanup commit
(`9a9575ff`).

## 7. Verification after applying

1. `grep -n "rides follow-up" src/lib/game-state/` returns 0 hits.
2. `npx jest --testPathPatterns="lane28|lane32|lane71"` returns all
   passing (no test logic changed; only docstrings).
3. `git diff --stat` shows the predicted diff stat from §6.
4. The final handoff doc (`wave4.8-stale-marker-cleanup.md`) records
   the cleanup and points to the v2 inventory as the audit record.

---

## 8. Cross-references

- `docs/card-scripts/wave4.8-closed.md` — the closing record. §2 is
  the destination referenced by every rewrite.
- `docs/card-scripts/wave4.8-stale-marker-cleanup-inventory.md` (v1,
  commit `9a9575ff`) — the original inventory with the wrong REMOVE
  verdicts; this v2 supersedes it.
- `docs/card-scripts/wave4.8-followup36-handoff.md` — first stale-marker
  audit; superseded by the v1 inventory and now by v2.
- `docs/card-scripts/wave4.8-followup37-handoff.md` — three-no-ship
  pattern codification.

End of v2 inventory.
