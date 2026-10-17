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

## 1b. Corrections to v2 inventory (committed 2026-10-17)

The v2 inventory misclassified six markers that describe work already shipped. The "destructive set_* variant" markers all conflate the variant itself (which IS the schema field, and IS shipped) with a future extension of the variant (which is genuinely unbuilt). Six markers need honest rewrites that preserve shipping attribution and only flag the actual unbuilt extensions:

- **S02** (schema.ts:583): "destructive `set_color` variant ('only [colors]' semantic)". `set_color` IS the destructive "only [colors]" semantic (schema.ts:960). Commit 282a4900 rewrote this as "is unbuilt; deferred since follow-up 31", which is factually wrong — the field has been in the schema since wave 4.
- **S09** (schema.ts:660): "destructive `set_type` variant ('exactly [types]' semantic)". `set_type` IS the "exactly [types]" semantic (schema.ts:880). Same misclassification as S02.
- **S10** (schema.ts:627): "destructive `set_toughness` variant ('exactly N' semantic)". `set_toughness` IS the "exactly N" semantic (schema.ts:1135). Same misclassification as S02.
- **S11** (schema.ts:1268): "destructive `set_supertype` variant". `set_supertype` IS the destructive variant (schema.ts:1331, shipped in c32b9a13). Line 1268 is shipping attribution and stays as-is. The genuine deferral in this block is the **legacy supertype distinctions** sentence at lines 1261–1266 (which the v2 inventory already identified as the real unbuilt extension).
- **I01** (interpret.ts:1412): "`add_type` exception variant". `add_type` IS implemented (used throughout interpret.ts: lines 1418, 1432, 1741, 1755, 1921). Line 1412 is shipping attribution for follow-up 30 priority 4 and stays as-is (with a tense adjustment to make the past-tense explicit).
- **T01** (lane71-per-pair-sentinel-multi.test.ts:18): the docstring gives `source.chosenProtectionFromPerPair` as the hypothetical future field, but that field IS shipped (cards.ts:204, with the `chosenProtectionFromPerPair` type). The marker reads as a deferral for a field that exists. The genuine deferral in this docstring is the **per-pair INDEPENDENT sentinel-resolution map** — a separate field per pair (one field per pair, not the shared map that ships). No priority piece has surfaced such an independent map; deferred since follow-up 31.

Honest rewrite text for each misclassified marker is added inline to its entry below. The other 13 markers (S05, S06, S07, S08, S12, S13, S14, S15, S16, S17, S18, I02, I03, C01, T02, T03) are correctly classified as genuine deferrals; their v2 proposed-rewrite text applies as-is.

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
- **Proposed rewrite** (corrected; see §1b):
  ```text
  * a destructive
  * `set_color` variant ("only [colors]"
  * semantic) IS the `set_color` field
  * below; no further follow-up needed.
  * (Original marker promised a future
  * follow-up 31; the field has shipped in
  * the schema since wave 4.)
  ```
- **Notes**: `set_color` (schema.ts:960) IS the destructive "only [colors]" semantic — a `z.array(z.enum(COLORS)).min(1).optional()` field that replaces both `color` and `color_identity`. Commit 282a4900 incorrectly rewrote this marker as "is unbuilt"; that rewrite is factually wrong and is corrected by the honest text above.

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

### S09 — schema.ts:1213 (originally inventoryed at 1099)

- **Window**: 32
- **Subject**: Destructive `set_type` variant
- **Marker text** (current file lines 1213–1218):
  ```text
  * printed types); a destructive
  * `set_type` variant rides
  * follow-up 32 if any future
  * priority piece surfaces a need.
  ```
- **Proposed rewrite** (corrected; see §1b):
  ```text
  * printed types); a destructive
  * `set_type` variant ("exactly
  * [types]" semantic) IS the
  * `set_type` field below; no
  * further follow-up needed.
  * (Original marker promised a
  * future follow-up 32; the field
  * has shipped in the schema since
  * wave 4.)
  ```
- **Notes**: `set_type` (schema.ts:880) IS the destructive "exactly [types]" semantic — a `z.array(z.string().min(1)).min(1).optional()` field that replaces the printed types. Commit 282a4900 rewrote this as "is unbuilt"; that rewrite is factually wrong and is corrected by the honest text above. The inventory's line number (1099) is stale — the file has shifted since v2 was committed; the actual current location is 1213–1218.

### S10 — schema.ts:624 (originally inventoryed at 1214)

- **Window**: 32
- **Subject**: Destructive `set_toughness` variant
- **Marker text** (current file lines 624–629):
  ```text
  * printed toughnesses (`*` /
  * `1+*`) yield 0. A destructive
  * `set_toughness` variant rides
  * follow-up 31 if any future
  * priority piece surfaces an
  * "exactly N" semantic.
  ```
- **Proposed rewrite** (corrected; see §1b):
  ```text
  * printed toughnesses (`*` /
  * `1+*`) yield 0. A destructive
  * `set_toughness` variant
  * ("exactly N" semantic) IS the
  * `set_toughness` field below;
  * no further follow-up needed.
  * (Original marker promised a
  * future follow-up 31; the field
  * has shipped in the schema since
  * wave 4. The non-integer `*` /
  * `1+*` printed-toughness case
  * is a separate limitation, not
  * addressed here.)
  ```
- **Notes**: `set_toughness` (schema.ts:1135) IS the destructive "exactly N" semantic — a `z.number().int().optional()` field. Commit 282a4900 rewrote this as "is unbuilt"; that rewrite is factually wrong and is corrected by the honest text above. The non-integer `*` / `1+*` printed-toughness case is a separate question (those cards have no integer to set; the engine yields 0 + additive) and is not a follow-up to schedule — it's a structural limitation of how MTG prints variable P/T. The inventory's line number (1214) is stale; the actual current location is 624–629.

### S11 — schema.ts:1261 (line numbers shifted; see §1b)

- **Window**: 34 (this commit) for the destructive variant; 32 for the legacy supertype distinctions.
- **Subject**: Destructive `set_supertype` variant (line 1268, KEEP) + Legacy supertype distinctions (lines 1261–1266, REWRITE)
- **Marker text** (current file lines 1261–1270, two markers in one block):
  ```text
  * then printed types). Legacy
  * supertype distinctions
  * (`"World"` / `"Legendary"`-only
  * / `"Snow"`-only) ride follow-up
  * 32 if any future priority piece
  * surfaces a legacy variant.
  * Printed supertypes are
  * accepted verbatim; a destructive
  * `set_supertype` variant rides
  * follow-up 34 piece 3/N (this
  * commit).
  ```
- **Proposed rewrite** (corrected; see §1b):
  - Lines 1261–1266 (legacy supertype distinctions — genuine deferral): REPLACE with the standard "is unbuilt; deferred since follow-up N" form.
    ```text
    * then printed types). Legacy
    * supertype distinctions
    * (`"World"` / `"Legendary"`-only
    * / `"Snow"`-only) are unbuilt;
    * deferred since follow-up 32.
    * See wave4.8-closed.md §2.
    ```
  - Lines 1266–1270 (destructive `set_supertype` variant — shipping attribution): KEEP unchanged. `set_supertype` IS the destructive variant (schema.ts:1331, shipped in c32b9a13).
- **Notes**: The v2 inventory proposed rewriting line 1268 to claim the destructive `set_supertype` variant is unbuilt — that rewrite is factually wrong (the variant is the schema field). The genuine unbuilt extension in this block is the legacy supertype distinctions sentence at lines 1261–1266, which the v2 inventory already correctly identified. The correction: keep line 1268 as shipping attribution; rewrite only the legacy supertype sentence. Paired with S03/S04 (exclusive supertype variants, also unbuilt — those are a separate follow-up).

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

- **Window**: 30 priority 4 (this commit)
- **Subject**: `add_type` exception variant for parallel additive merges
- **Marker text** (lines 1408–1412):
  ```text
  // `add_power` for parallel P/T
  // additive merges.
  //
  // `add_type` except
  // rides follow-up 30 priority 4.
  ```
- **Proposed rewrite** (corrected; see §1b):
  ```text
  // `add_power` for parallel P/T
  // additive merges.
  //
  // `add_type` exception variant
  // (shipped in follow-up 30
  // priority 4 — see the
  // `add_type` consult below).
  ```
- **Notes**: `add_type` is implemented and used throughout interpret.ts (lines 1418, 1432, 1741, 1755, 1921). The v2 inventory's proposed rewrite ("unbuilt; deferred") is factually wrong — the variant IS shipped. The corrected rewrite preserves the line as shipping attribution for follow-up 30 priority 4 with an explicit tense adjustment.

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
- **Subject**: Test docstring about per-pair-INDEPENDENT sentinel-resolution map
- **Marker text** (lines 14–21):
  ```text
   * dedupes at write time. v1 minimum: the
   * single-instance-field model (parallel to the
   * lane 52 `chosenColor` instance field); a
   * per-pair independent sentinel-resolution
   * map rides follow-up 31 if any future
   * priority piece surfaces a per-pair sentinel
   * field (e.g. `source.chosenProtectionFromPerPair`).
  ```
- **Proposed rewrite** (corrected; see §1b):
  ```text
   * dedupes at write time. v1 minimum: the
   * single-instance-field model (parallel to the
   * lane 52 `chosenColor` instance field). A
   * per-pair INDEPENDENT sentinel-resolution
   * map (a separate field per pair, distinct
   * from the shared per-pair map at
   * `source.chosenProtectionFromPerPair`)
   * is unbuilt; deferred since follow-up 31.
   * See wave4.8-closed.md §2. (The shared
   * per-pair map itself — the
   * `source.chosenProtectionFromPerPair`
   * field — IS shipped, at cards.ts:204;
   * this deferral is for an independent
   * map that no priority piece has
   * surfaced.)
  ```
- **Notes**: `chosenProtectionFromPerPair` (cards.ts:204) IS shipped as a shared per-pair map. The v2 inventory proposed rewriting this docstring to claim the map is unbuilt — that's factually wrong. The genuine unbuilt extension is a **per-pair INDEPENDENT** map (one field per pair), which no priority piece has surfaced. The corrected rewrite distinguishes the two.

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
| S02 | schema.ts:583                                  | 31     | destructive set_color *(corrected; see §1b)* | cycle-doc §2 |
| S03 | schema.ts:625                                  | 34     | set_supertype exclusive "World"        | cycle-doc §2         |
| S04 | schema.ts:658                                  | 34     | set_supertype exclusive (paired)       | cycle-doc §2         |
| S05 | schema.ts:761                                  | 35+    | set_keyword                            | cycle-doc §2         |
| S06 | schema.ts:763                                  | 35+    | set_ability                            | cycle-doc §2         |
| S07 | schema.ts:919                                  | 32     | set_color_identity hybrid              | cycle-doc §2         |
| S08 | schema.ts:1061                                 | 32     | set_power until-eot                    | cycle-doc §2         |
| S09 | schema.ts:1213                                 | 32     | destructive set_type *(corrected; see §1b)* | cycle-doc §2 |
| S10 | schema.ts:624                                  | 32     | destructive set_toughness *(corrected; see §1b)* | cycle-doc §2 |
| S11 | schema.ts:1261                                 | 34     | legacy supertype distinctions *(corrected; see §1b)* | cycle-doc §2 |
| S12 | schema.ts:3548                                 | 29     | chosenProtectionFromPerPair            | cycle-doc §2         |
| S13 | schema.ts:3589                                 | 26+    | cycle metadata                         | cycle-doc §2         |
| S14 | schema.ts:3620                                 | 27     | perCounter.counter "chosen"            | cycle-doc §2         |
| S15 | schema.ts:3688                                 | 30     | per-pair "chosen" extension (left)     | cycle-doc §2         |
| S16 | schema.ts:3710                                 | 30     | per-pair "chosen" extension (right)    | cycle-doc §2         |
| S17 | schema.ts:3877                                 | 30     | per-pair-with-sentinel parallel-index  | cycle-doc §2         |
| S18 | schema.ts:3879                                 | 30     | per-pair-with-sentinel hybrid          | cycle-doc §2         |
| I01 | interpret.ts:1412                              | 30 p4  | add_type exception variant *(corrected; see §1b)* | cycle-doc §2 |
| I02 | interpret.ts:2040                              | 32     | set_color_identity hybrid handler      | cycle-doc §2         |
| I03 | interpret.ts:2197                              | 32     | set_power until-eot handler            | cycle-doc §2         |
| C01 | cards.ts:200                                   | 32     | chosenProtectionFromPerPairWithLiteral | cycle-doc §2 + #2241 |
| T01 | lane71-per-pair-sentinel-multi.test.ts:18      | 31     | per-pair INDEPENDENT sentinel map *(corrected; see §1b)* | cycle-doc §2 |
| T02 | lane28-create-copy-token-exceptions.test.ts:18 | 30     | per-token exception array              | cycle-doc §2         |
| T03 | lane32-per-pair-counter-ordinal.test.ts:31     | 30     | perCounter.perPair ordinal             | cycle-doc §2         |

---

## 6. Diff stat for the next commit (predicted)

After the §1b corrections, the rewrites split across four commits:

1. **Inventory correction** (this commit — docs only): edits §1b,
   updates S02, S09, S10, S11, I01, T01 entries with honest rewrite
   text, marks the corresponding table rows. Zero source changes.
2. **S11 fix** (1 source change in schema.ts): rewrites the legacy
   supertype distinctions sentence at lines 1261–1266 (1 sentence,
   ~6 lines). Line 1268 stays as shipping attribution. ~+6 −6 lines.
3. **S02/S09/S10 fix** (3 source changes in schema.ts): replaces the
   factually-wrong "is unbuilt" rewrites from commit 282a4900 with
   the honest "IS the set_X field below; no further follow-up needed"
   text. ~+9 −9 lines (each rewrite is the same length).
4. **Apply remaining 13 markers** (12 source changes + 3 test-file
   docstring changes): S05, S06, S07, S08, S12, S13, S14, S15, S16,
   S17, S18 in schema.ts; I02, I03 in interpret.ts; I01 (tense
   adjustment only, preserves shipping attribution); C01 in cards.ts;
   T01, T02, T03 in test files. ~+13 −13 lines (mostly comment
   blocks; some markers expand to multiple lines).

Total source changes across commits 2–4: ~+28 −28 lines, all
comment-only. No schema fields added/renamed; no test logic changes;
no engine-size-budget change.

---

## 7. Verification after applying

1. `grep -n "rides follow-up" src/lib/game-state/` returns 0 hits
   (with `| head` excluded — past-tense references in shipped code
   may legitimately remain).
2. `grep -nE "if any future priority piece surfaces|deferred —"`
   returns 0 hits.
3. `npx jest --testPathPatterns="lane28|lane32|lane71"` returns all
   passing (no test logic changed; only docstrings).
4. `git diff --stat` matches the predicted diff from §6.
5. The final handoff doc (`wave4.8-stale-marker-cleanup.md`) records
   the cleanup and points to the v2 inventory (with §1b corrections)
   as the audit record.

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
