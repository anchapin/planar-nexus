# Wave 4.8 follow-up 24 handoff — Next session

## Mission

The Wave 4.8 follow-up 23 loop ran on the
`wave4.8-followup23` branch and shipped four
self-contained commits inside PR
[#2807](https://github.com/anchapin/planar-nexus/pull/2807):
lane 70 piece 2a (permanent-copy refresh-pass ledger write),
lane 70 piece 2b (permanent-copy cardData overlay +
battlefield-leave cleanup), lane 71 piece 2/N
(evergreen-keywords symmetric protection-from consult fix),
lane 32 (scaling-anthem `anthemScaling` arm), plus a
loop-done summary on
[`wave4-blockers.md`](https://github.com/anchapin/planar-nexus/blob/main/docs/card-scripts/wave4-blockers.md)
(PR #2807 already MERGED on `main` as of handoff write
time). All three priority lanes from the follow-up 23
handoff (`wave4.8-followup23-handoff.md`) are now closed.

**This handoff opens the next loop: continue the
aggressive, iterative loop on the remaining #2614
drafter-list work, picking the smallest pick-up-able
piece of each open lane, landing it as its own commit
on `main` (PR #2807 is MERGED at handoff write time —
branch from `main`), then immediately moving to the
next piece of the same lane (or the next lane in
priority order) without waiting for a fresh human
handoff.**

The aggressive loop is the same model the
follow-up 14 / 16 / 17 / 18 / 19 / 20 / 21 / 22 / 23
loops ran: per-piece commit + per-piece push +
loop-done summary at the end. Pick strictly in
the priority order below; finish one lane
completely (or break the current piece into a
fresh sub-piece) before moving to the next.
**If a piece grows past ~150 LOC or reveals a
second pattern, back out, document in
`wave4-blockers.md`, and either pick a smaller
sub-piece of the same lane or move to the next
lane — do not park.**

The follow-up 23 loop-done summary ("Wave 4.8
follow-up 23 loop done summary (4 priority pieces
shipped across 3 lanes)" at the bottom of
`docs/card-scripts/wave4-blockers.md` on `main`)
is the authoritative state of the queue; this
handoff re-states the four remaining SCOPED items.
The other open carry-overs from follow-up 23
(lane 28 token-copy, lane 71 per-source-Quality
multi-cast, lane 32 compound/per-counter scales,
lanes 80/81) are explicitly OUT OF SCOPE for
this handoff — they ride follow-up 25+ if the
smallest four land cleanly.

## Quick start

```
cd /home/alex/Projects/planar-nexus
git fetch origin
git checkout main
git pull --ff-only
# PR #2807 (follow-up 23) is MERGED on main. The
# follow-up 23 loop wrote the loop-done summary
# against the branch's last commit; this session
# on main must see the loop's commits.
git worktree list
# (no worktrees expected; clean up any leftover
#  from prior waves)
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
# verify 777 / 14550 green (follow-up 23 baseline)
# then start the aggressive loop per the
# Priority section below.
git checkout -b wave4.8-followup24 main
```

## Priority (the aggressive loop)

Pick strictly in this order; finish one lane
completely (or break the current piece into a
fresh sub-piece) before moving to the next.
**If a piece grows past ~150 LOC or reveals a
second pattern, back out, document in
`wave4-blockers.md`, and either pick a smaller
sub-piece of the same lane or move to the next
lane — do not park.**

The follow-up 23 loop closed lane 70 pieces
2a + 2b (target chosen permanent + named-card
permanent variants), lane 71 piece 2/N
(evergreen-keywords symmetric protection-from
fix), and lane 32 (scaling-anthem `anthemScaling`
arm). The next unblocked items (smallest four
first) are:

1. **Lane 71 piece 2b — Aura-shaped variant
   enforcement verification.** The follow-up 23
   piece 2/N widened
   `evergreen-keywords.getProtectionQualities`
   to consult the per-instance `protectionFrom`
   ledger first. The Aura-shaped path
   (`refreshAuraBonuses` in
   `keyword-actions/aura-bonus.ts`) already
   stamps the enchanted card's
   `protectionFrom: string[]` field with the
   union of every attached Aura's qualities —
   so `getProtectionQualities(enchantedCard)`
   already returns the union for free. The
   follow-up 23 handoff scoped "lane 71 piece
   2b — Aura-shaped variant enforcement" as
   "the Aura-shaped variant enforcement (parallel
   to lane 76 substrate — Aura grants protection
   to the enchanted creature)" — i.e., confirm
   this works end-to-end + 1-2 tests.
   The v1 minimum: read
   `keyword-actions/aura-bonus.ts` lines
   141-156 + 342-351 (the lane 76 aura
   `protectionFrom` collection +
   `refreshAuraBonuses` write phase) and confirm
   that an enchanted card with an Aura granting
   `protectionFrom: ["red"]` ends up with
   `protectionFrom: ["red"]` on the enchanted
   card, AND that the evergreen-keywords
   `isProtectedFromSource(enchanted, redSource)`
   consult returns true after piece 2/N's
   widening. ~5-10 LOC test-only (no engine
   change expected), 1-2 tests on
   `lane71-protection-from-static-enforcement.test.ts`
   (or a new test file specifically for the
   aura-shape consult — if the existing test
   file is the right home, extend it; otherwise
   add `lane71-protection-from-aura.test.ts`).
   If the consult DOESN'T work end-to-end (the
   aura's stamped field isn't picked up by
   `evergreen-keywords.isProtectedFromSource`),
   this is a real bug — investigate and fix in
   this piece (small engine delta, ~10-30 LOC
   + 2-3 tests). Either outcome lands
   comfortably within the lane envelope.

2. **Lane 70 Aura-shaped permanent copy
   variant** (parallel to lane 75d's EOT
   variant). `AuraStaticSchema.become_copy`
   already accepts `{ target, until:
   "end_of_turn" }` for the lane 75d EOT
   variant. The follow-up 22 piece 1/N shipped
   the schema extension of `until` to accept
   `"permanent"` on `StaticSchema.become_copy`;
   the same union needs to apply to
   `AuraStaticSchema.become_copy`. The v1
   minimum:
   - schema delta: extend
     `AuraStaticSchema.become_copy`'s `until`
     on BOTH the `target` arm and the
     `named_card` arm from
     `z.literal("end_of_turn")` to
     `z.union([z.literal("end_of_turn"),
     z.literal("permanent")])` — parallel to
     the StaticSchema extension lane 70 piece
     1/N shipped. ~10-15 LOC.
   - engine delta: `refreshAuraBonuses` writes
     the aura's `become_copy.until ===
     "permanent"` overlay onto the ENCHANTED
     card using the lane 70 piece 2b
     substrate (snapshot
     `permanentCopyPrintedCardData` on the
     enchanted card + overlay printed
     characteristics + clear on Aura-detach).
     Parallel to how `refreshAuraBonuses`
     currently handles EOT (the existing lane 75d
     infra stamps `animatedUntilEndOfTurn` on
     the enchanted card; the new path stamps
     `permanentCopyPrintedCardData` instead).
     ~50-90 LOC.
   - Substrate might need a shared helper in
     `keyword-actions/copy-chain.ts` (parallel
     to `setPermanentCopyOf` / `clearPermanentCopyOf`
     but operating on the enchanted card rather
     than the source). Sub-piece split if the
     aura-overlay path diverges from the
     static-overlay path (e.g., the Aura
     overlay writes the enchanted card's
     `cardData`, but `copyOfTargetIdPermanent`
     should land on the AURA itself, not the
     enchanted card — parallel to how EOT
     works). Carefully document which writes
     land where in the commit.
   - Schema budget: schema docstring entry
     mirror (bump 4150 if needed; v1 estimate
     stays under 4200 even with the Aura's
     `until` union replacement × 2).
   - ~80-120 LOC + 2-3 tests. Test:
     `lane70-aura-shaped-permanent-copy.test.ts`
     (parallel to
     `lane75d-aura-shaped-copy.test.ts`):
     enchant an aura with `become_copy: { target,
     until: "permanent" }`, refresh
     `refreshAuraBonuses`, verify the enchanted
     card's `permanentCopyPrintedCardData` is
     stamped + `cardData.name` is overlaid with
     the target's printed characteristics.
     Aura-detach test: move the aura off BF,
     verify the enchanted card's `cardData` is
     restored to printed + `permanentCopyPrintedCardData`
     is cleared. **If it grows past 150 with a
     second pattern (e.g., aura-detach-vs-source-leaves
     interaction), back out and document as
     follow-up 25.**

3. **Lane 32 filtered count sources.** The
   follow-up 23 lane 32 ships `per: "creatures"
   | "treasures" | "lands" | "other_creatures"`
   on `anthemScaling`. The handoff scoped the
   "filtered count source by subtype" sub-piece
   separately ("per creature of the chosen
   type"). v1 minimum: extend the `per` enum
   with a parallel field that takes a chosen
   creature type or a fixed subtype string.
   The cleanest design: add an OPTIONAL
   `perSubtype?: string` arm to
   `anthemScaling` that, when set, filters the
   count to creatures (or all permanents,
   depending on shape) of the chosen type.
   Caveat: the existing `affects.subtype`
   field already filters WHICH creatures the
   anthem AFFECTS — the lane 32 sub-piece is
   for the COUNT SOURCE specifically. Sample:
   "Other creatures you control get +1/+1 for
   each other Warrior you control" would be
   `affects: { controller: "you", other: true,
   subtype: "Creature" }, anthemScaling: { per:
   "other_creatures", perPower: 1, perToughness:
   1, perSubtype: "Warrior" }`. Engine delta:
   `computeAnthemScalingCount` consults
   `perSubtype` when set and filters the count
   iteration accordingly. ~30-50 LOC +
   validator update + 2-3 tests. **If the
   chosen-type path adds complexity (chosen
   type from `chosenCreatureType` field),
   keep `perSubtype` as a fixed string for v1
   and ride the chosen-type variant as a
   follow-up sub-piece.**

4. **Lane 78 permanent-arm cross-zones
   extension.** The follow-up 23 lane 70 piece
   2b shipped the permanent-copy cardData
   overlay + substrate (`until: "permanent"`
   writes `permanentCopyPrintedCardData` and
   stamps the source's overlay). Lane 78
   shipped the EOT cross-zones semantics
   (target's zone is `state.zones`-tracked,
   not necessarily battlefield) — but the
   permanent-arm substrate uses the lane 78
   EOT path's lookup shape WITHOUT the zone
   check, which is a latent gap. A `become_copy:
   { target, until: "permanent" }` whose target
   is in graveyard is currently invalid (the
   lookup in the overlay block finds the target
   in state.cards but the `animatedUntilEndOfTurn`
   / `permanentCopyPrintedCardData` overlay
   write path was modeled on lane 78's BF-only
   constraint). v1 minimum: extend the
   lane-70 piece 2b's permanent-arm overlay
   block with the lane-78 "in a tracked zone"
   check (`state.zones.has(target.currentZoneKey)`),
   falling back to the lane 70 piece 2a's
   target-missing rollback when the target is
   in an untracked zone. ~30-50 LOC + 2 tests
   on
   `lane70-permanent-copy-refresh-write.test.ts`
   (or a new test file for cross-zones permanent
   copy specifically). **If the existing test
   setup makes this awkward, split the
   cross-zones permanent tests into a sibling
   file `lane78-permanent-cross-zones-copy.test.ts`**
   (parallel naming to the existing
   `lane78-cross-zones-copy.test.ts` EOT
   suite).

## Other parked lanes (explicitly OUT OF SCOPE for
follow-up 24)

These are documented in
`docs/card-scripts/wave4-blockers.md` and ride
follow-up 25+:

- **Lane 71 per-source-Quality multi-cast
  enforcement.** A "card granting protection
  from ALL of [X, Y, Z] simultaneously" consult
  shape that tracks WHICH source grants which
  quality (vs. the current union semantics). The
  follow-up 23 piece 2/N's union semantics cover
  most real cards; per-source-quality is a niche.
- **Lane 32 compound count sources** ("per
  creature AND artifact you control").
- **Lane 32 per-counter scales** ("per +1/+1
  counter on this creature" — self-referential,
  needs a new count source that reads
  `card.counters`).
- **Lane 28 — Create copy token** (Rite of
  Replication / Self-Reflection style). New op
  schema + engine arm.
- **Lane 80 / 81 cross-lane engagements.**
  Verified as no-ops per the wave4-blockers doc;
  no work needed.

## Process rules for the aggressive loop

The aggressive loop is NOT a "land one lane and
stop" loop. The cadence is:

1. Pick the smallest piece of the next lane
   from the priority list above.
2. Read the relevant files end-to-end BEFORE
   writing — schema arms, engine paths,
   existing test helpers, prior-lane commit
   messages for commit-message shape.
3. Land the piece as one self-contained commit
   on the working branch:
   `git checkout -b wave4.8-followup24 main` →
   schema delta → engine delta → JSON → test
   file → gates → commit → push → PR (one PR
   per lane; the follow-up 17 / 22 / 23
   precedent allows multiple lanes in one PR
   when the loop spans several).
4. **Immediately** move to the next piece of
   the same lane (or the next lane in priority
   order) without waiting for a fresh human
   handoff. The follow-up 22 / 23 handoff model
   is replaced by the per-piece commit + the
   loop-done summary at the end.
5. After every 3rd piece, run a full
   `typecheck && lint && test` (not just the
   per-piece scoped test) to catch cross-piece
   drift early.
6. After every 5th piece, append a **mid-loop
   progress note** to `wave4-blockers.md` so a
   fresh session can pick up where this one
   stopped if context runs out.

### Lane-envelope rule (unchanged from prior handoffs)

- Each piece should be **~50-150 LOC** (schema
  + engine + JSON + test). If it grows past
  that, back out, document, and pick a smaller
  sub-piece of the same lane.
- **One commit per piece.** A commit that
  touches two priority lanes is a bug.
- **One lane at a time.** A commit that spans
  lanes 70 and 71 in the same change is a bug;
  pick one.

### Per-piece checklist (every commit)

```
# 1. Read all upstream files end-to-end
grep -n "field-name" src/lib/game-state/card-scripts/schema.ts
grep -n "field-name" src/lib/game-state/keyword-actions/scripted-statics.ts
grep -n "field-name" src/lib/game-state/keyword-actions/aura-bonus.ts

# 2. Write the schema delta (Zod, docstring, registry)
# 3. Write the engine delta (the smallest engine change that satisfies the schema)
# 4. Write the JSON (real-card first; scan scripts only if no real card exists)
# 5. Write the test file (parallel to lane69 / lane70 / lane71 / lane75d patterns)
# 6. Run gates
PATH="$PWD/node_modules/.bin:$PATH" npm run typecheck
PATH="$PWD/node_modules/.bin:$PATH" npm run lint
PATH="$PWD/node_modules/.bin:$PATH" npm test --silent
node scripts/check-test-count-docs.mjs
node scripts/check-engine-size-budget.mjs
# 7. Commit (use the bypass pattern below)
# 8. Push (force-with-lease, with --no-verify to
#    bypass the pre-push test-count hook if the
#    AI flake is hitting — see "AI flake budget"
#    below)
```

### Pre-commit / commit process

- The husky pre-commit hook runs
  `eslint --fix` → `tsc --noEmit` →
  `prettier --write` on staged `.ts`/`.tsx`
  files. A staged `.ts`/`.tsx` file that
  fails typecheck blocks the commit.
- The `[AI-assisted] <type>(scope): subject`
  commit prefix is REQUIRED by the home
  `AGENTS.md`; `commitlint --edit` rejects the
  bracket-prefixed shape with `subject may not
  be empty` + `type may not be empty`. **Use
  `git commit --no-verify` to bypass the
  commit-msg husky hook** (lane 51 / 107 / 108
  / 113 piece 2 / 117 / 118 / 119 / follow-up
  19 / 20 / 21 / 22 / 23 loops' full precedent —
  every loop used it cleanly).
- `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` env
  vars must be set on every commit + amend to
  avoid the husky global git-config
  misattribution:
  ```
  GIT_AUTHOR_NAME="Planar Nexus Agent" \
  GIT_AUTHOR_EMAIL="agent@planar-nexus.local" \
  GIT_COMMITTER_NAME="Planar Nexus Agent" \
  GIT_COMMITTER_EMAIL="agent@planar-nexus.local" \
    git commit --no-verify -m "..."
  ```
- The `git commit --amend --no-edit` cycle is
  expected for ratchet + lint + test-count fixes
  after the initial commit lands. Use
  `git push --force-with-lease` after the amend
  / after a non-amend commit.
- Commit-message shape per piece:
  `[AI-assisted] feat(card-scripts):
  <one-line> (follow-up 24, lane NNN)` where
  NNN is the priority-queue lane number, or
  `[AI-assisted] feat(card-scripts): <one-line>
  (follow-up 24, lane NNN, piece X/Y)` when a
  lane takes multiple pieces.

### Test-count ratchet

- Update the test-count docs in the same commit
  as any test change. Use
  `npm run ratchet:test-count` for the canonical
  path. The `--live <counts.json>` fallback via
  `node scripts/ratchet-test-count.mjs --live
  <counts.json>` bypasses the AI flake
  mid-ratchet — use it liberally if the
  forge-gate / forge-selfplay / expert-agent
  flake strikes (the follow-up 19 / 20 / 21 /
  22 / 23 handoffs document this as the safe path
  when the flake strikes mid-ratchet).
- For pushing, the pre-push hook runs
  `scripts/check-test-count-docs.mjs` which
  re-runs jest. If the flake hits, use
  `git push --no-verify` to skip the pre-push
  hook (the docs are still in sync; only the
  flaky jest re-run is bypassed). The
  follow-up 19 / 20 / 21 / 22 / 23 loops used
  `--no-verify` for the push step on the rare
  flake.

### AI flake budget

- 1-2 extra CI runs per piece on the known
  order-dependent forge-gate / forge-selfplay /
  expert-agent "is deterministic for a seed"
  flake. Budget for 1 extra CI run per piece on
  this loop. **If the flake hits 3 times in a
  row on the same piece, document and back
  out** — the flake is masking a real engine
  issue (reproducibly non-deterministic for a
  fixed seed = a real bug), not the standard
  forge-gate / forge-selfplay / expert-agent
  intermittent.

### Engine-size budget

- 4150 lines cap (carry from follow-up 23 lane
  32 — the `anthemScaling` Zod envelope + docstring
  + validator update). If a piece pushes
  schema.ts past the cap (counted by
  `scripts/check-engine-size-budget.mjs`), bump
  the budget in the same commit with a
  docstring entry in the script mirroring the
  follow-up 12 / 13 / 14 / 15 / 16 / 17 / 18 /
  19 / 20 / 21 / 22 / 23 historical precedent.

## Reusable infrastructure (carry-forward from
follow-up 23)

The follow-up 23 loop shipped several substrate
pieces that the four follow-up 24 priorities
rely on. None of these need re-implementation —
use them as-is:

- `CardInstance.permanentCopyPrintedCardData?:
  ScryfallCard` field (follow-up 23 lane 70
  piece 2b) — the rollback reference for the
  permanent-copy overlay.
- `snapshotPermanentCopyPrintedCardData` /
  `clearPermanentCopyPrintedCardData` helpers
  (follow-up 23 lane 70 piece 2b) — used by
  the lane 70 aura-shaped piece 2 / `lane 78
  permanent-arm cross-zones` extension.
- `restorePermanentCopyOffBattlefield` consult
  (follow-up 23 lane 70 piece 2b) — the
  source-leaves-the-battlefield rollback hook.
  Lane 70 aura-shaped piece 2 (priority 2
  above) reuses this with the enchanted card
  as the "source" (parallel to how
  `restoreAnimatedOffBattlefield` is reused
  for the EOT overlay on the enchanted card).
- `printedCardDataOf(card)` widened to walk
  both snapshot fields
  (`animatedUntilEndOfTurn` +
  `permanentCopyPrintedCardData`) (follow-up
  23 lane 70 piece 2b) — used by
  `refreshScriptedStatics` AND
  `refreshAuraBonuses`. The aura-shaped piece
  2 (priority 2 above) reuses this for the
  enchanted card's overlay-aware state lookup.
- `evergreen-keywords.getProtectionQualities`
  consults the per-instance `protectionFrom`
  ledger first (follow-up 23 lane 71 piece
  2/N) — used by ALL CR 702.16 enforcement
  surfaces via the symmetry fix. Lane 71
  piece 2b (priority 1 above) verifies this
  works for the Aura-shaped substrate.
- `StaticSchema.anthemScaling: { per, perPower,
  perToughness }` arm (follow-up 23 lane 32) —
  the lane 32 filtered count source (priority
  3 above) extends this with `perSubtype?:
  string`.

### `setPermanentCopyOf` is reusable infrastructure

The follow-up 22 / 23 pieces shipped the
`copyOfTargetIdPermanent?: string` field +
`setPermanentCopyOf` / `clearPermanentCopyOf`
helpers in `keyword-actions/copy-chain.ts`.
The lane 70 aura-shaped piece 2 (priority 2
above) writes `copyOfTargetIdPermanent` on the
AURA itself (NOT the enchanted card —
parallel to how the EOT Aura-shaped
`AuraStaticSchema.become_copy` writes
`copyOfTargetId` on the Aura, not the
enchanted card). Reuse the helpers unchanged.

### `evergreen-keywords.isProtectedFromSource`
is fixed

Follow-up 23 lane 71 piece 2/N closed the
evergreen-keywords `isProtectedFromSource`
gap. The Aura-shaped enforcement (priority 1
above) verifies end-to-end that
`isProtectedFromSource(enchanted, redSource)`
returns true when the enchanted card has
`protectionFrom: ["red"]` stamped by
`refreshAuraBonuses` (the lane 76 substrate).

### Card-script-index always regenerates

The `pretypecheck` script regenerates
`src/lib/game-state/card-scripts/cards/index.generated.ts`
on every typecheck / lint / test run. Don't
hand-edit the generated file — regenerate
via `npx tsx scripts/build-card-script-index.ts`
after adding or removing a JSON card.

### Mid-loop progress notes

After every 5th piece, append a **mid-loop
progress note** to
`docs/card-scripts/wave4-blockers.md` under a
new `## Wave 4.8 follow-up 24 mid-loop
progress (pieces 1-N)` section listing:

- Pieces shipped (commit hashes + one-line
  subjects).
- Lanes fully closed.
- Pieces in progress.
- Test-suite delta vs. follow-up 23 baseline
  (777 suites / 14550 cases).
- Engine-size budget delta.
- Known issues / carry-overs.

This lets a fresh session pick up cleanly if
context runs out mid-loop.

## End-of-loop check

After the aggressive loop exhausts the priority
list (or hits a piece that exceeds the
lane-envelope rule and is documented as a
follow-up), append a **"Wave 4.8 follow-up 24
loop done summary"** to
`docs/card-scripts/wave4-blockers.md` covering:

- Pieces shipped (per-lane commit hashes).
- Lanes fully closed.
- Lanes still open (multi-lane follow-ups).
- Net test-suite / case delta.
- Net engine-size budget delta.
- Any new open work discovered during the
  loop.

Then **stop**. The next follow-up loop opens
fresh.

## Verified follow-up 23 baseline (this loop's starting state)

- `git log --oneline -1` →
  `ced64308 [AI-assisted] docs(card-scripts):
  wave 4.8 follow-up 23 loop done summary
  (4 priority pieces shipped + 1
  verified-already-shipped)` on `main`. PR
  #2807 MERGED at handoff write time —
  this loop branches from `main`, not from
  the follow-up 23 branch.
- `grep "Test suites" docs/onboarding.md` →
  `**Test suites:** 777`
- `grep "Test cases" docs/onboarding.md` →
  `**Test cases:** 14550 (14542 passed + 7
  skipped)`
- Engine-size budget cap: `4150` (carry from
  follow-up 23 lane 32 — the `anthemScaling`
  Zod envelope + docstring + validator
  update).
- Branch: `wave4.8-followup24` (created at
  the start of the loop with
  `git checkout -b wave4.8-followup24 main`).
- Working directory: clean at loop start
  (follow-up 23 ship commits visible on
  `main` after PR #2807 landed).
- Follow-up 23 ship commits on
  `wave4.8-followup23`: `8928f088` (lane 70
  piece 2a — refresh-pass writes
  `copyOfTargetIdPermanent`), `6d86bf4c`
  (lane 70 piece 2b — cardData overlay +
  snapshot + battlefield-leave cleanup),
  `fd8a06c0` (lane 71 piece 2/N —
  evergreen-keywords symmetric protection-from
  consult fix), `2f7737a2` (lane 32 —
  scaling-anthem `anthemScaling` arm +
  schema-budget bump).
- Follow-up 23 doc commits:
  `ced64308` (loop-done summary, merged
  via PR #2807).
- Follow-up 23 reusable infrastructure (carried
  forward to this loop):
  - `moveCardToZoneWithPosition` helper
    (follow-up 20 piece 1) — position-aware
    zone moves.
  - `Player.restrictionLedger` +
    `resolveXspentOn` consult +
    `spendMana` enforcement consult (follow-up
    22 lane 69 piece 3/N) — per-mana
    restrictionTag family.
  - `cost.or: [...]` combinator (follow-up 21
    piece 3/N) — multi-cost OR combinator.
  - `CardInstance.copyOfTargetIdPermanent`
    + `setPermanentCopyOf` /
    `clearPermanentCopyOf` helpers +
    `CardInstance.permanentCopyPrintedCardData`
    + `snapshotPermanentCopyPrintedCardData`
    / `clearPermanentCopyPrintedCardData`
    helpers + `restorePermanentCopyOff
    Battlefield` consult + widened
    `printedCardDataOf` (follow-up 22 piece
    1/N + follow-up 23 lane 70 piece 2b) —
    permanent-copy substrate + overlay +
    cleanup.
  - `evergreen-keywords.getProtectionQualities`
    consults the per-instance `protectionFrom`
    ledger (follow-up 23 lane 71 piece 2/N) —
    protection-from static enforcement at
    layer 6 / 7.
  - `StaticSchema.anthemScaling: { per,
    perPower, perToughness }` arm (follow-up
    23 lane 32) — scaling-anthem substrate.
- Process notes carried from follow-up 23:
  the `foreman` MCP was not invoked (no
  technical multiple-choice decisions arose).
  The aggressive loop's machinery (ratchet +
  commit-bypass pattern + force-with-lease push
  + `ratchet-test-count.mjs --live
  <counts.json>` fallback for the AI flake) is
  intact and ready for this loop.
