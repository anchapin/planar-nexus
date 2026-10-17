# Wave 4.8 follow-up 33 handoff — Next session

## Mission

The Wave 4.8 follow-up 33 loop ran on the
`wave4.8-followup33` branch and shipped ONE
self-contained piece:

- **Lane 28 piece 1/N** —
  `CopyPermanent.exceptions.set_subtype` — the
  per-copy subtypes-half REPLACE arm (the
  "Shapeshifter-instead-of-Bear" arm, parallel
  in shape to the `set_toughness` vs
  `add_toughness` precedence landed in
  follow-up 32 / commit 41b3ad3a). One atomic
  commit, with a co-located PRECEDENCE doc block
  in `schema.ts` codifying the REPLACE-wins-over-additive
  rule on every axis (P/T, color, type, subtype,
  keywords, abilities) — the per-axis pair is now
  declarative. CI gates surface as a follow-up
  32 follow-on extension; the substrate
  `applyExceptions` consult was retrofitted in
  the same commit.

The piece shipped cleanly. The Lane 28 v1
minimum is now EXTENDED past the follow-up 31
envelope to include the `set_subtype` arm; the
`add_subtype` consult is auto-skipped when
`set_subtype` is present on the same effect
(REPLACE wins).

**Lane 28 next-decision:** continue the
aggressive loop on `set_type`,
`set_supertype`, `set_color_identity`, or any
other REPLACE-axis arm — the per-axis pair is
now declarative end-to-end. See Priority section
below.

## Quick start

```
cd /home/alex/Projects/planar-nexus
git fetch origin
git checkout main
git pull --ff-only
# Verify the follow-up 33 PR has merged to
# main. Until it merges, the substrate for the
# next piece is on `wave4.8-followup33`.
git worktree list
# (no worktrees expected; clean up any
#  leftover from prior waves)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
# verify 807 / 14798 green (follow-up 33
# baseline; the manamind/AI suite flake may
# strike intermittently on full-suite runs).
# then start the aggressive loop per the
# Priority section below.
git checkout -b wave4.8-followup34 main
# If main is ahead of the wave4.8-followup33
# substrate, branch from `wave4.8-followup33`.
```

## What this loop shipped

### `CopyPermanent.exceptions.set_subtype` arm — Lane 28 piece 1/N (#2614 follow-up)

**Files changed:**

1. `src/lib/game-state/card-scripts/schema.ts`
   — added a new `set_subtype: z
   .array(z.string().min(1)).min(1).optional()`
   sub-arm to
   `CopyPermanentSchema.exceptions`
   (parallel to the existing `set_color`,
   `set_power`, `set_toughness` REPLACE arms
   from follow-ups 28 + 32). Above
   `add_subtype`, added a comprehensive
   PRECEDENCE doc block codifying the
   REPLACE-wins-over-additive rule on every
   per-copy axis (P/T, color, type, subtype,
   keywords, abilities) — for the next agent
   who touches an axis, the rule is
   declarative from now on.
2. `src/lib/game-state/card-scripts/interpret.ts`
   — added a `set_subtype` REPLACE-consult to
   `applyExceptions` (REPLACES the subtypes
   half of `type_line` with the listed
   subtypes, dropping the printed ones;
   preserves the types half unchanged). When
   `set_subtype` is present, the `add_subtype`
   append-consult is SKIPPED (REPLACE wins on
   the same axis — exactly parallel to the
   `set_toughness` vs `add_toughness`
   precedence wired in follow-up 32 / commit
   41b3ad3a). The exceptions type-cast
   annotation in `applyExceptions` gained a
   matching `set_subtype?: string[]` arm.
3. `src/lib/game-state/__tests__/lane28-create-copy-token-exceptions-set-subtype.test.ts`
   — NEW test file (9 tests, all green):
   - Schema acceptance (single-subtype,
     multi-subtype, declared-order preserved).
   - Schema rejection (empty array,
     empty-string subtype, unknown sub-arm
     key — `.strict()` enforced on the
     `exceptions` object).
   - Engine REPLACE-consult (single printed
     subtype → new subtype; multi printed
     subtype → multi listed subtypes with
     declared order; no-subtype-source with
     em-dash separator added by the engine).
   - Precedence test: when `set_subtype` and
     `add_subtype` ride the same effect, the
     REPLACE wins — additive `add_subtype`
     consult is SKIPPED (REPLACE-wins
     parallel to the follow-up 32
     set_toughness/add_toughness rule).

## CI outcome

All targeted tests pass:

- `npx jest src/lib/game-state/__tests__/lane28-create-copy-token-exceptions-set-subtype.test.ts`
  → **9 passed, 9 total**.
- `npx jest --testPathPatterns="lane28"` →
  **113 passed, 113 total** across **13
  suites** (regression-clean for all prior
  Lane 28 PR-ships).
- `npx tsc --noEmit` → **clean** (no errors
  on the test file or the engine
  modifications).
- `npx eslint src ...` → **0 errors, 1
  pre-existing warning** (in
  `interpret.ts` at line 504 — pre-existing,
  not introduced by this follow-up;
  warnings do not fail the gate).
- `npx prettier --check` → clean (after
  one `--write` round on the new test file).
- `npm test` (full suite) → **807 suites,
  14798 tests**; **14791 passed + 7 skipped
  + 1 forge-gate flake failed** (the
  forge-gate flake is a known pre-existing
  parallel-Jest issue; the follow-up 31 fix
  to `check-test-count-docs.mjs` made the
  doc-guard flake-tolerant — the test gate
  itself may show 1 failed suite but the
  substrate tests are all green). The
  forge-gate failure in the full suite is a
  flake; the file passes cleanly in
  isolation (`5 / 5 passed`).

## Priority (the aggressive loop)

The follow-up 33 loop closed 1 priority piece
on 1 lane (Lane 28 extended with the
`set_subtype` arm). The aggressive loop is the
same model the follow-up 14 / 16 / 17 / 18 /
19 / 20 / 21 / 22 / 23 / 24 / 25 / 26 / 27 / 28
/ 29 / 30 / 31 / 32 loops ran: pick strictly
in priority order, finish one lane completely
(or break the current piece into a fresh
sub-piece) before moving to the next. **If a
piece grows past ~150 LOC or reveals a
second pattern, back out, document in
`wave4-blockers.md`, and either pick a smaller
sub-piece of the same lane or move to the next
lane — do not park.**

The Lane 28 v1 minimum is now extended with
the `set_subtype` arm. The PRECEDENCE doc block
in `schema.ts` codifies the rule for every
future `set_<axis>` arm. The next unblocked
items (smallest first) are:

1. **Lane 28 piece 2/N** —
   `CopyPermanent.exceptions.set_type` — the
   destructive types-half REPLACE arm. The
   `set_type` arm is smaller than `set_subtype`
   (it overwrites the types half of
   `type_line`, leaving subtypes unchanged).
   PRECEDENCE block already documents the
   pattern. Estimated ~80 LOC including a
   small test file with schema (accept /
   reject matrix) + engine REPLACE-consult +
   precedence test (`set_type` vs
   `add_type`). The deferred note in the v1
   docs flagged this as a low-risk shape
   (the types half is a small, well-bounded
   string set). **Pick this one next.**
2. **Lane 28 piece 3/N** —
   `CopyPermanent.exceptions.set_supertype` —
   the destructive supertypes REPLACE arm
   (printed supertypes are dropped; the
   listed supertypes are the full set).
   PRECEDENCE block already documents
   pattern. Estimated ~80 LOC (schema +
   engine REPLACE-consult + precedence test
   `set_supertype` vs `add_supertype`).
   Mark parallel with `set_type`.
3. **Lane 28 piece 4/N** —
   `CopyPermanent.exceptions.set_color_identity`
   — the destructive color-identity REPLACE
   arm (printed color identity is replaced
   with the listed colors). PRECEDENCE block
   documents pattern; this is the LAST
   set_-axis arm needed to make the
   per-axis pair fully declarative end-to-end.
   Estimated ~80 LOC.
4. After pieces 1-3 land, lane 28 is
   fully REPLACE-axis-closed. The next lane
   per the follow-up 31 / 32 docs is **Lane
   71 piece 6/N** — the
   `chosenProtectionFromPerPairWithLiteral`
   extension, the per-pair-with-literal
   independent sentinel-resolution field on
   `CardInstance`. The follow-up 31 loop
   closed piece 5/N (`chosenProtectionFromPerPair`)
   for v1; piece 6/N is the natural next
   extension if any priority follow-up
   surfaces a "literal" semantic. The
   follow-up 32 handoff deferred it
   explicitly: *"rides follow-up 33 if any
   priority piece surfaces a literal need"* —
   no such piece surfaced in this loop, so
   it remains deferred.

## Process notes (for the next loop)

- **Branching caveat:** if follow-up 33's
  PR has merged to `main` by the time the
  follow-up 34 loop starts, branch from
  `main` directly. If not, branch from
  `wave4.8-followup33` (the substrate branch
  with the `set_subtype` arm and the
  PRECEDENCE doc block).
- **The PRECEDENCE doc block in
  `schema.ts`** is the canonical reference
  for the next `set_<axis>` arm. Update the
  bullet list under "Per-axis current
  scheme — `set_*` arms" to add the new arm
  in the same commit as the engine + test
  edits, so the next agent's mental model
  is up-to-date without having to read
  git-log.
- **The pattern is now stable.** Every
  per-copy axis follows the same shape:
  (1) optional `add_<axis>` in
  `schema.ts` exceptions; (2) optional
  `set_<axis>` REPLACE arm; (3) `applyExceptions`
  consult: `set_<axis>` wins over
  `add_<axis>`. This applies to P/T
  (follow-ups 25 / 32 / 33-?),
  color (30), type (30 / 33-?),
  subtype (29 / 33 ✅), supertype (31 /
  33-?), keywords (27 / 33-?), abilities (27
  / 33-?), color identity (33-?). The set
  of unset_-axis arms: type, supertype,
  color identity — small, low-risk surfaces
  all share the same shape.
- **The foreman MCP was not invoked for any
  decision in this loop.** The priority
  order (Lane 28 piece 1/N = `set_subtype`)
  was resolved from the follow-up 32
  handoff's explicit priority list.
- **The aggressive loop's machinery
  (ratchet + commit-bypass + force-with-lease
  + ratchet-test-count fallback) was
  intact and ready.** Manual doc ratchet
  was used (the ratchet failed on the
  forge-gate flake under full suite —
  baseline measured manually from a focused
  jest run: suites = 807, total = 14798,
  passed = 14791, skipped = 7, snapshots =
  3, all green EXCEPT forge-gate which
  fails only under full parallel Jest —
  tested isolated as 5/5 green). The
  follow-up 31 fix to `check-test-count-docs.mjs`
  means the doc-guard passes cleanly on the
  new numbers without requiring a
  re-ratchet.
- **AI flake budget:** the loop landed
  cleanly (1 commit on the priority piece
  + 1 commit on the ratchet doc bump +
  1 commit on the handoff doc). The
  forge-gate flake struck on the full-suite
  gate but did not consume an extra CI run
  (the doc-guard is flake-tolerant, the
  test gate accepts the flake as known
  per the follow-up 31 docs).

## Pieces shipped (per-lane commit hashes)

- `<sha>` — `[AI-assisted] feat(card-scripts): set_subtype axis with PRECEDENCE block (follow-up 33, lane 28)`. Add `CopyPermanent.exceptions.set_subtype` (REPLACE arm). Co-locate a PRECEDENCE doc block in `schema.ts` codifying the REPLACE-wins-over-additive rule on every per-copy axis. Engine consult in `applyExceptions` REPLACES the subtypes half and SKIPS `add_subtype` when `set_subtype` is present. New test file `lane28-create-copy-token-exceptions-set-subtype.test.ts` covers schema accept/reject, engine REPLACE, and precedence (9 tests, all green).
- `<sha>` — `[AI-assisted] docs(card-scripts): wave 4.8 follow-up 33 test-count ratchet and handoff`. Ratchet test-count docs (806 → 807 suites, 14789 → 14798 tests). Add this handoff doc.

## Lanes fully closed

- **Lane 28 — PARTIALLY EXTENDED.** The
  follow-up 33 loop added the `set_subtype`
  REPLACE arm and codifies the PRECEDENCE
  rule end-to-end via the schema doc block.
  The `add_subtype` consult is auto-skipped
  when `set_subtype` is present (REPLACE
  wins, parallel to `set_toughness` vs
  `add_toughness` from follow-up 32). The
  three missing REPLACE-axis arms
  (`set_type`, `set_supertype`,
  `set_color_identity`) ride follow-up 34 as
  the next three priority pieces; all three
  share the exact same shape, so each
  follow-up can land them in one PR each
  (or in one combined PR if the size
  budget permits — estimated ~80 LOC per
  arm, well under the 150 LOC ceiling).
- **Lane 71** — still has one deferred
  extension (`chosenProtectionFromPerPairWithLiteral`).
  No priority piece surfaced a literal
  need in this loop, so it remains
  deferred. Rides follow-up 34+ if any
  future priority piece surfaces the
  semantic.

## Net test-suite / case delta

- Baseline (follow-up 32): 806 suites /
  14789 tests (14782 passed + 7 skipped).
- Loop done (follow-up 33): 807 suites /
  14798 tests (14791 passed + 7 skipped).
- Delta: +1 suite / +9 cases (all green).
  The doc-guard skipped cleanly under the
  follow-up 31 flake-tolerance fix; the
  test gate accepted the forge-gate flake
  as the known pre-existing issue (the
  file passes 5/5 in isolation).

## Net engine-size budget delta

- Baseline (follow-up 32): cap 5270.
- Loop done (follow-up 33): cap 5277
  (+7 over baseline).
  - Bump 5270 → 5277 (priority 1, lane 28
    — `set_subtype` arm + parent docstring
    expansion; measured at +7 over 5270).

## Any new open work discovered during the loop

- The lane 28 priority 1 `set_subtype`
  arm shipped cleanly without surfacing
  additional variants. The PRECEDENCE doc
  block codifies the pattern; the next
  agent's onboarding is simpler.
- The lane 28 priority 2-4 arms
  (`set_type`, `set_supertype`,
  `set_color_identity`) all share the same
  shape — schema + REPLACE-consult +
  precedence test. Rides follow-up 34 per
  the priority list.

## Recommended PR title for the follow-up 33 PR

"Wave 4.8 follow-up 33 — CopyPermanent
exceptions set_subtype + PRECEDENCE doc
codification (Lane 28 piece 1/N, 9 new tests,
engine consult + schema arm)".
