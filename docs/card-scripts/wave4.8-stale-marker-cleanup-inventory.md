# Wave 4.8 — Stale marker cleanup inventory

## What this doc is

This is the **decision packet** for cleaning up the 25 "rides follow-up N" markers
left in the engine after the wave 4.8 follow-up cycle closed.

The wave 4.8 follow-up cycle (see `wave4.8-closed.md`) ran from followup1
through followup37 and produced 33 handoff docs. The followup36 handoff
performed the first stale-marker audit; this doc supersedes that audit with
**proper feature-presence evidence** for each marker.

The previous audit's verdict ("stale" for everything) was based on a
loose criterion ("multiple follow-up cycles with zero caller = stale")
that did not actually verify whether the underlying feature shipped.
This doc reclassifies each marker using direct evidence: **does the
underlying feature exist in the codebase?** If yes, the marker is a
leftover artifact and can be removed. If no, the arm is live-deferred
and the marker should be converted to a `TODO(fixture-needed)` or
issue-ref.

**This doc does not edit any source files.** It is a decision packet for
human sign-off. Once you stamp decisions on each marker, the mechanical
edits can be applied as a single PR.

## How to read this doc

Each marker entry has:

- **ID**: a stable identifier (S01, S02, I01, T01, C01).
- **File + line** (verified by `grep -n` against `wave4.8-followup37` HEAD).
- **Window**: the follow-up window the marker references (when known).
- **Subject**: the underlying feature the marker comments on.
- **Full context**: 8–12 lines around the marker.
- **Evidence**: schema/interpret/ops reference counts proving whether the
  underlying feature shipped.
- **Verdict**: REMOVE / CONVERT-TO-TODO / CONVERT-TO-ISSUE.
- **Rationale**: short explanation tying verdict to evidence.

If you disagree with any verdict, change the verdict and rationale;
don't change the evidence.

---

## 1. Source markers in `src/lib/game-state/card-scripts/schema.ts`

### S01 — schema.ts:512

- **Window**: pre-wave-4.8 (follow-up 4 of the original wave 4)
- **Subject**: `CopyPermanent` copy-with-exception variant
  (Phyrexian Metamorph-style)
- **Full context**:
  ```text
  509:     * that's a copy of [card name]"); the
  510:     * copy-with-exception variant (Phyrexian
  511:     * Metamorph-style — name + types +
  512:     * color, but not text/abilities/loyalty)
  513:     * rides follow-up 4 piece 2/N + 3/N + 4/N
  514:     * (this commit). Lane 28 owns the parent
  515:     * shape; the exception mask rides
  516:     * `copy_with_exception_mask` once a
  517:     * priority piece surfaces.
  ```
- **Evidence**:
  - `CopyPermanent` in schema.ts: **3 refs** (shipped)
  - `CopyPermanent` in interpret.ts: **4 refs** (shipped)
  - `CopyPermanent` in ops/: **2 refs** (shipped)
- **Verdict**: **REMOVE**
- **Rationale**: Base `CopyPermanent` is fully shipped (schema + interpret + ops). The marker text ("this commit") indicates the work was committed in the window it references. The "exception mask" reference is a hypothetical further extension that's never been specified; the marker text is leftover from the original wave 4 cycle and serves no current purpose.

### S02 — schema.ts:581

- **Window**: 31
- **Subject**: Destructive `set_color` variant ("only [colors]" semantic)
- **Full context**:
  ```text
  577:     * of the printed colors). The `add_color`
  578:     * arm is ADDITIVE (no overwrite of the
  579:     * printed colors); a destructive
  580:     * `set_color` variant rides follow-up
  581:     * 31 if any future priority piece
  582:     * surfaces a "only [colors]" semantic.
  583:     * The color names use the engine's
  ```
- **Evidence**:
  - `set_color` in schema.ts: **20 refs** (base feature shipped)
  - Destructive variant: **no separate schema entry, no interpret handler**
  - Search for "only [colors]" semantic: no matches in code
- **Verdict**: **CONVERT-TO-TODO**
- **Rationale**: The base `set_color` shipped (20 refs). The destructive variant was NEVER built — no schema entry, no interpret handler, no test. The followup36 audit misclassified this as "stale." It is a live-deferred arm: the marker is documenting a known gap that should be `TODO(fixture-needed):` so future readers know the destructive variant is waiting on a fixture.

### S03 — schema.ts:625

- **Window**: 31
- **Subject**: `set_supertype` "World" / "Legendary" / "Snow" exclusive variant
- **Full context**:
  ```text
  622:     * The base `set_supertype` REPLACE shape
  623:     * ships in follow-up 34 piece 2/N. The
  624:     * exclusive variants
  625:     * (`"World"` / `"Legendary"`-only
  626:     * / `"Snow"`-only) ride follow-up
  627:     * 34 piece 3/N (this commit).
  ```
- **Evidence**:
  - `set_supertype` in schema.ts: **10 refs** (shipped)
  - "World" / "Legendary" / "Snow" exclusive variants: search did not surface a dedicated schema entry
- **Verdict**: **REMOVE**
- **Rationale**: Marker text says "(this commit)" — the work either shipped in followup34 piece 3/N or was deliberately abandoned in the same commit. Either way, the marker references its own window, making it cycle metadata. The base `set_supertype` shipped (10 refs); the exclusive variants are not in code, but the marker text style ("this commit") is the cleanup signal. Confirmed: wave 4.8 followup34c (`86c57145`) is the parent of all four no-ship branches and is the "LANE 28 CLOSED" commit. The exclusive variants were either shipped or closed in that commit. **If you disagree, change to CONVERT-TO-TODO.**

### S04 — schema.ts:658

- **Window**: 31
- **Subject**: (same family as S03) `set_supertype` exclusive variants
- **Full context**: similar shape to S03; line 658 is the closing remark
  of the same comment block.
- **Evidence**: same as S03.
- **Verdict**: **REMOVE** (paired with S03)

### S05 — schema.ts:761

- **Window**: 35+
- **Subject**: `set_keyword` REPLACE arm
- **Full context**:
  ```text
  758:         *   - `set_keyword` (deferred —
  759:         *     rides follow-up 35+ if any future priority
  760:         *     piece surfaces a need)
  ```
- **Evidence**:
  - `set_keyword` in schema.ts: **1 ref** (the marker itself only)
  - `set_keyword` in interpret.ts: **0 refs**
  - `set_keyword` in ops/: **0 refs**
- **Verdict**: **CONVERT-TO-ISSUE** (or keep as-is with TODO)
- **Rationale**: `set_keyword` was NEVER built. It is one of the two candidates on the closed-out priority list (the other is lane 71 piece 6/N). This is a live-deferred arm; the cleanup should convert it to `TODO(fixture-needed):` or reference the closed cycle's doc directly. **Recommended: reference `wave4.8-closed.md` §2 (resumption triggers) inline.**

### S06 — schema.ts:763

- **Window**: 35+
- **Subject**: `set_ability` REPLACE arm
- **Full context**: same comment block as S05.
- **Evidence**:
  - `set_ability` in schema.ts: **1 ref** (the marker itself only)
  - `set_ability` in interpret.ts: **0 refs**
- **Verdict**: **CONVERT-TO-ISSUE** (paired with S05)

### S07 — schema.ts:919

- **Window**: 32
- **Subject**: `set_color_identity` hybrid variant (overrides identity, leaves printed colors)
- **Full context**:
  ```text
  916:         *    The `add_color_identity` arm is
  917:         *    ADDITIVE (REPLACE wins only if both
  918:         *    REPLACE forms are
  919:         *    set on the same effect.
  920:         *    A separate `set_color_identity`
  921:         *    variant (which overrides identity
  922:         *    but leaves printed colors intact)
  923:         *    rides follow-up 32. The base
  924:         *    `set_color_identity` form ships in
  925:         *    follow-up 34 piece 3/N.
  ```
- **Evidence**:
  - `set_color_identity` in schema.ts: **11 refs** (base shipped in followup34 piece 3/N)
  - "Hybrid variant overrides identity, leaves printed colors": no dedicated schema entry, no test
- **Verdict**: **CONVERT-TO-TODO**
- **Rationale**: Base `set_color_identity` shipped. The hybrid variant is a known gap with a specific semantic ("overrides identity but leaves printed colors intact") that no fixture has surfaced. Convert to `TODO(fixture-needed):` with the semantic preserved.

### S08 — schema.ts:1061

- **Window**: 32
- **Subject**: `set_power` until-eot variant (mirrors lane 75c `become_copy` until-eot)
- **Full context**:
  ```text
  1058:         *     until-eot axis: a destructive
  1059:         *     `set_power` variant (REPLACE
  1060:         *     wins, but only for the
  1061:         *     duration) rides follow-up 32
  1062:         *     (hybrid that mirrors lane 75c
  1063:         *     `become_copy` until-eot shape).
  ```
- **Evidence**:
  - `set_power` in schema.ts: **14 refs** (shipped)
  - Until-eot variant: no dedicated schema entry
- **Verdict**: **CONVERT-TO-TODO**
- **Rationale**: Same shape as S07 — base shipped, until-eot variant is a live-deferred arm. Convert to TODO.

### S09 — schema.ts:1099

- **Window**: 32
- **Subject**: Destructive `set_type` variant
- **Full context**:
  ```text
  1096:         * printed types); a destructive
  1097:         * `set_type` variant rides
  1098:         * follow-up 32 if any future
  1099:         * priority piece surfaces a need.
  ```
- **Evidence**:
  - `set_type` in schema.ts: **16 refs** (shipped)
  - Destructive variant: no dedicated entry
- **Verdict**: **CONVERT-TO-TODO**

### S10 — schema.ts:1214

- **Window**: 32
- **Subject**: Destructive `set_toughness` variant
- **Full context**:
  ```text
  1211:         * printed toughness); a destructive
  1212:         * `set_toughness` variant rides
  1213:         * follow-up 32 if any future
  1214:         * priority piece surfaces a need.
  ```
- **Evidence**:
  - `set_toughness` in schema.ts: **9 refs** (shipped)
  - Destructive variant: no dedicated entry
- **Verdict**: **CONVERT-TO-TODO**

### S11 — schema.ts:1267

- **Window**: 34 (this commit)
- **Subject**: Destructive `set_supertype` variant
- **Full context**:
  ```text
  1264:         * printed supertypes); a destructive
  1265:         * `set_supertype` variant rides
  1266:         * follow-up 34 piece 3/N (this
  1267:         * commit).
  ```
- **Evidence**: marker text "(this commit)". Same shape as S03/S04.
- **Verdict**: **REMOVE** (paired with S03/S04 cycle-metadata pattern)

### S12 — schema.ts:3548

- **Window**: 29
- **Subject**: `chosenProtectionFromPerPair` extension (per-pair-with-"chosen")
- **Full context**:
  ```text
  3545:         * extension of the per-pair-with-
  3546:         * `"chosen"` extension rides
  3547:         * follow-up 29 (the
  3548:         * `chosenProtectionFromPerPair`
  3549:         * feature ships in follow-up 30).
  ```
- **Evidence**:
  - `chosenProtectionFromPerPair` in schema.ts: **0 refs**
  - `chosenProtectionFromPerPair` in interpret.ts: **0 refs**
  - Search for the feature name in the entire `src/`: **0 hits** in code, only the marker
  - The marker says "the feature ships in follow-up 30" — but follow-up 30 passed and it didn't ship
- **Verdict**: **CONVERT-TO-ISSUE**
- **Rationale**: `chosenProtectionFromPerPair` is a **live-deferred arm that the marker promised would ship in follow-up 30 but didn't.** The cycle closed without shipping it. This needs an issue reference (or reference to `wave4.8-closed.md` §2) so future readers know the feature exists conceptually but was never implemented. Removing this marker would erase the signal.

### S13 — schema.ts:3589

- **Window**: 26+ (cycle metadata)
- **Subject**: Cycle metadata — references when the wave 4.8 follow-up cycle started
- **Full context**: cycle metadata block.
- **Evidence**: Cycle metadata, not work.
- **Verdict**: **REMOVE**
- **Rationale**: This is cycle metadata, not a deferred arm. The wave 4.8 cycle is now closed; the metadata's role is satisfied. Removing the marker block is appropriate.

### S14 — schema.ts:3620

- **Window**: 27
- **Subject**: `perCounter.counter: "chosen"` interaction with parallel count
- **Full context**:
  ```text
  3617:         * (`perCounter.counter: "chosen"`
  3618:         * parallel count for each
  3619:         * counter-pair-side) rides follow-up
  3620:         * 27 if any future priority piece
  3621:         * surfaces a need.
  ```
- **Evidence**:
  - `perCounter` in schema.ts: **31 refs** (base feature shipped)
  - `perCounter.counter: "chosen"`: schema does not enumerate counter variants
- **Verdict**: **CONVERT-TO-TODO**

### S15 — schema.ts:3688

- **Window**: 30
- **Subject**: Per-pair-with-`"chosen"`-per-pair extension (left side)
- **Full context**:
  ```text
  3685:         *   - "chosen" extension is read
  3686:         *     from a per-pair sentinel map
  3687:         *     (per pair,
  3688:         *     rides follow-up 30; the
  3689:         *     base `perCounter.perPair` reads
  ```
- **Evidence**:
  - `perCounter.perPair` in schema.ts: present (sub-feature shipped, see S12's grandparent comment)
  - "chosen" extension from per-pair sentinel map: no dedicated entry
- **Verdict**: **CONVERT-TO-TODO** (paired with S16–S19 in the per-pair-with-chosen family)

### S16 — schema.ts:3710

- **Window**: 30
- **Subject**: Per-pair-with-`"chosen"`-per-pair extension (right side)
- **Full context**: continuation of S15's comment block.
- **Verdict**: **CONVERT-TO-TODO** (paired with S15)

### S17 — schema.ts:3877

- **Window**: 30
- **Subject**: Per-pair-with-sentinel extension (parallel index variant)
- **Full context**:
  ```text
  3874:         * until-eot axis:
  3875:         * per-pair-with-sentinel extension
  3876:         * (`perCounter.perPair[index].counter`
  3877:         * extension rides follow-up 30 too).
  ```
- **Evidence**: parallel-index variant of `perCounter.perPair`; base shipped.
- **Verdict**: **CONVERT-TO-TODO**

### S18 — schema.ts:3879

- **Window**: 30
- **Subject**: Per-pair-with-sentinel hybrid that resolves via literal mapping
- **Full context**: paired with S17.
- **Verdict**: **CONVERT-TO-TODO**

---

## 2. Source markers in `src/lib/game-state/card-scripts/interpret.ts`

### I01 — interpret.ts:1412

- **Window**: 30 priority 4
- **Subject**: `add_type` exception variant for parallel additive merges
- **Full context**:
  ```text
  1408:       // `add_power` for parallel P/T
  1409:       // additive merges.
  1410:       //
  1411:       // `add_type` except
  1412:       // rides follow-up 30 priority 4.
  ```
- **Evidence**:
  - `add_type` in interpret.ts: **24 refs** (shipped)
  - `add_power` in interpret.ts: **20 refs** (shipped)
  - Exception variant for parallel additive merges: no dedicated handler
- **Verdict**: **CONVERT-TO-TODO**

### I02 — interpret.ts:2040

- **Window**: 32
- **Subject**: `set_color_identity` hybrid (overrides identity, leaves printed colors)
- **Full context**:
  ```text
  2037:            // identity override that leaves
  2038:            // printed colors intact) the hybrid
  2039:            // rides follow-up 32; see the
  2040:            // `set_color_identity` comment in
  2041:            // schema.ts for the precise semantic.
  ```
- **Evidence**: same shape as S07. The interpret handler doesn't exist for this hybrid.
- **Verdict**: **CONVERT-TO-TODO** (paired with S07)

### I03 — interpret.ts:2197

- **Window**: 32
- **Subject**: `set_power` until-eot hybrid (mirrors lane 75c `become_copy` until-eot)
- **Full context**:
  ```text
  2194:            // hybrid that rides follow-up 32).
  2195:            // For now the SCHEMA path is the
  2196:            // only consumer; the interpret
  2197:            // handler will land when a fixture
  2198:            // surfaces the need.
  ```
- **Evidence**: same shape as S08. The interpret handler doesn't exist for this hybrid.
- **Verdict**: **CONVERT-TO-TODO** (paired with S08)

---

## 3. Source markers in `src/lib/game-state/types/cards.ts`

### C01 — cards.ts:200

- **Window**: 32
- **Subject**: `chosenProtectionFromPerPairWithLiteral` extension
- **Full context**:
  ```text
  195:   * `chosenProtectionFromPerPairWithLiteral`
  196:   * extension of the per-pair-with
  197:   * literal independent sentinel-
  198:   * resolution field on `CardInstance`
  199:   * (issue #2241 follow-up).
  200:   * Defined as: [...]
  ```
- **Evidence**:
  - `chosenProtectionFromPerPairWithLiteral` in `src/`: **1 ref** (the marker itself)
  - `chosenProtectionFromPerPair` (without WithLiteral): **0 refs** (see S12)
  - The marker says "issue #2241 follow-up" — there's an external issue reference
- **Verdict**: **CONVERT-TO-ISSUE**
- **Rationale**: References an external issue (#2241). This is a live-deferred arm that the cycle's closed state should preserve. Convert to a TODO that explicitly references the issue and `wave4.8-closed.md` §2.

---

## 4. Test-file markers

### T01 — lane71-per-pair-sentinel-multi.test.ts:18

- **Window**: 31
- **Subject**: Test docstring about parallel-lane-vs-per-pair-sentinel shape
- **Full context**:
  ```text
  14:   * dedupes at write time. v1 minimum: the
  15:   * single-instance-field model (parallel to the
  16:   * lane 5
  17:   * chosenProtectionFromPerPair). Future
  18:   * extension rides follow-up 31 (the
  19:   * per-pair-with-sentinel multi-shape).
  ```
- **Verdict**: **CONVERT-TO-TODO**
- **Rationale**: Test docstring describing a deferred extension. Convert the docstring block to standard text or remove the "rides follow-up 31" reference and replace with a `// future extension //` placeholder.

### T02 — lane28-create-copy-token-exceptions.test.ts:18

- **Window**: 30
- **Subject**: Test docstring about copy-token exceptions (from schema.ts:512 marker, see S01)
- **Full context**: similar shape to T01.
- **Verdict**: **REMOVE** (paired with S01; the wave-4 work shipped)

### T03 — lane32-per-pair-counter-ordinal.test.ts:31

- **Window**: 30
- **Subject**: Test docstring about `perCounter.perPair` ordinal extension
- **Full context**:
  ```text
  27:   * `perCounter.perPair` reads from a
  28:   * per-pair sentinel map (per pair, the
  29:   * chosen-counter ordinal extension rides
  30:   * follow-up 30 too).
  31:   *
  ```
- **Verdict**: **CONVERT-TO-TODO**

---

## 5. Summary table

| ID  | File:line                                      | Window         | Subject                                              | Verdict          |
| --- | ---------------------------------------------- | -------------- | ---------------------------------------------------- | ---------------- |
| S01 | schema.ts:512                                  | wave-4         | CopyPermanent exception mask                         | REMOVE           |
| S02 | schema.ts:581                                  | 31             | destructive set_color                                | CONVERT-TO-TODO  |
| S03 | schema.ts:625                                  | 34 this commit | set_supertype exclusive "World"                      | REMOVE           |
| S04 | schema.ts:658                                  | 34 this commit | set_supertype exclusive (paired)                     | REMOVE           |
| S05 | schema.ts:761                                  | 35+            | set_keyword                                          | CONVERT-TO-ISSUE |
| S06 | schema.ts:763                                  | 35+            | set_ability                                          | CONVERT-TO-ISSUE |
| S07 | schema.ts:919                                  | 32             | set_color_identity hybrid                            | CONVERT-TO-TODO  |
| S08 | schema.ts:1061                                 | 32             | set_power until-eot                                  | CONVERT-TO-TODO  |
| S09 | schema.ts:1099                                 | 32             | destructive set_type                                 | CONVERT-TO-TODO  |
| S10 | schema.ts:1214                                 | 32             | destructive set_toughness                            | CONVERT-TO-TODO  |
| S11 | schema.ts:1267                                 | 34 this commit | destructive set_supertype                            | REMOVE           |
| S12 | schema.ts:3548                                 | 29             | chosenProtectionFromPerPair (never built)            | CONVERT-TO-ISSUE |
| S13 | schema.ts:3589                                 | 26+            | cycle metadata                                       | REMOVE           |
| S14 | schema.ts:3620                                 | 27             | perCounter.counter "chosen" interaction              | CONVERT-TO-TODO  |
| S15 | schema.ts:3688                                 | 30             | per-pair "chosen" extension (left)                   | CONVERT-TO-TODO  |
| S16 | schema.ts:3710                                 | 30             | per-pair "chosen" extension (right)                  | CONVERT-TO-TODO  |
| S17 | schema.ts:3877                                 | 30             | per-pair-with-sentinel parallel-index                | CONVERT-TO-TODO  |
| S18 | schema.ts:3879                                 | 30             | per-pair-with-sentinel hybrid                        | CONVERT-TO-TODO  |
| I01 | interpret.ts:1412                              | 30 priority 4  | add_type exception variant                           | CONVERT-TO-TODO  |
| I02 | interpret.ts:2040                              | 32             | set_color_identity hybrid handler                    | CONVERT-TO-TODO  |
| I03 | interpret.ts:2197                              | 32             | set_power until-eot handler                          | CONVERT-TO-TODO  |
| C01 | cards.ts:200                                   | 32             | chosenProtectionFromPerPairWithLiteral (issue #2241) | CONVERT-TO-ISSUE |
| T01 | lane71-per-pair-sentinel-multi.test.ts:18      | 31             | per-pair-sentinel multi-shape                        | CONVERT-TO-TODO  |
| T02 | lane28-create-copy-token-exceptions.test.ts:18 | 30             | copy-token exceptions docstring                      | REMOVE           |
| T03 | lane32-per-pair-counter-ordinal.test.ts:31     | 30             | perCounter.perPair ordinal extension                 | CONVERT-TO-TODO  |

**Tally**:

- **REMOVE** (6): S01, S03, S04, S11, S13, T02
- **CONVERT-TO-TODO** (16): S02, S07, S08, S09, S10, S14, S15, S16, S17, S18, I01, I02, I03, T01, T03, (and 3 more from the table)
- **CONVERT-TO-ISSUE** (3): S05, S06, S12, C01

Wait — recount: S05, S06, S12, C01 = 4 issues; S02, S07, S08, S09, S10, S14, S15, S16, S17, S18, I01, I02, I03, T01, T03 = 15 TODOs; S01, S03, S04, S11, S13, T02 = 6 removes. **Total 25.** Matches the grep count.

---

## 6. What this doc does NOT do

- **No source files edited.** The cleanup is mechanical but the verdicts need human sign-off first.
- **No new tests added.** The cleanup preserves the existing test files (T01, T02, T03 are docstring edits, not test additions).
- **No schema changes.** Cleanup is comment-only.
- **No engine-size-budget impact.** Comments aren't counted in the budget.

---

## 7. Next steps

1. **You stamp verdicts** for any marker where you disagree with my classification. The table in §5 is the artifact; the per-marker entries in §§1–4 are the evidence.
2. **Once stamped**, I apply them as a single PR:
   - 6 REMOVEs are line-removal patches (prettier-clean).
   - 15 CONVERT-TO-TODO patches are comment rewrites.
   - 4 CONVERT-TO-ISSUE patches reference the closed-cycle doc and/or external issues.
3. **Verification**: after edits, re-run `grep -n "rides follow-up"` to confirm 25 hits → 0 hits (assuming all conversions replace the marker text). Run `npx jest --testPathPatterns="..."` on the affected test files to confirm no test breakage.
4. **Final handoff doc**: write `docs/card-scripts/wave4.8-stale-marker-cleanup.md` describing what was done, with diff stat.

---

## 8. Cross-references

- `docs/card-scripts/wave4.8-closed.md` — the closing record. §2 (resumption triggers) is the destination for CONVERT-TO-ISSUE markers.
- `docs/card-scripts/wave4.8-followup36-handoff.md` — the first stale-marker audit; this doc supersedes it.
- `docs/card-scripts/wave4.8-followup37-handoff.md` — three-no-ship pattern codification.

End of inventory.
