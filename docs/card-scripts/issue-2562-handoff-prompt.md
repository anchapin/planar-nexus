# Handoff prompt — issue #2562 (SearchLibrary)

> **For the next session (issue #2560 ReturnFromZone).** Paste the system
> prompt first; this section gives the working state and pitfalls.

## State at handoff

- Branch: `feat/issue-2562-search-library-fdn-cards`
- Base: `main @ 2464050d`
- Work shipped in this PR (the one to push from this branch):
  - 2 FDN search-library cards added as JSON:
    - `src/lib/game-state/card-scripts/cards/expedition_map.json`
      (`{2}, {T}, Sacrifice this artifact: Search your library for a
land card, put it into your hand, then shuffle.` — activated,
      `cost.tap + cost.sacrifice`, `SearchLibrary` with
      `filter: { land: true }`, `destination: "hand"`, `count: 1`.)
    - `src/lib/game-state/card-scripts/cards/rune_scarred_demon.json`
      (Flying ETB → search library for any card, put into hand, shuffle.
      `SearchLibrary` with `filter.or: [basic_land, land, creature,
artifact, enchantment]` — five one-key sub-filters, OR-armed.)
  - 1 dedicated test file:
    `src/lib/game-state/__tests__/issue-2562-search-library-fdn-cards.test.ts`
    (3 it() blocks: registers+validates the activated Expedition Map,
    registers+validates the ETB Rune-Scarred Demon with the OR filter.)
  - 2 doc bumps (anchored blocks in `docs/onboarding.md` and
    `docs/TEST_VIDEO_FIXTURES.md`): 811→812 suites, 14836→14841 tests,
    14829→14834 passed.

- The PR also touches `src/lib/game-state/card-scripts/cards/index.generated.ts`,
  which is **gitignored** — never commit it. `npx tsx scripts/build-card-script-index.ts`
  regenerates it. (Now writing 339 scripts.)

## CardScriptSchema gotchas (re-learned this session)

1. **No `reveal` field on the SearchLibrary effect.** The engine reference
   (`ops/search-library.ts`) explicitly notes reveal is "not modeled" —
   don't add it. There is a separate `reveal: true` on top-level cast
   spells but not on the search effect.
2. **`filter` must have ≥1 key or an `or` arm.** Even for an empty filter,
   the schema rejects `{}` alone — `or: [...]` is the workaround for
   "any card" (see Rune-Scarred Demon).
3. **Trigger shape:** `event: "etb"` (not `kind: "etb"`),
   `subject: "self"` for self-trigger, with `text` field. Activated shape:
   array key `activated` (not `triggers` for activated abilities), `cost.tap`
   and `cost.sacrifice` are top-level booleans — `cost.sacrifice_permanents`
   is only for sacrificing OTHER permanents.
4. **Mana activation costs** like `{2}, {T}` are NOT modeled in the
   `cost` object — `additional: "{2}"` is not a schema key. The engine
   expects them in the activation `text` field only. (X-cost handling is
   a separate schema arm from #2559.)

## Out-of-scope FDN searchers (deliberately deferred)

These were considered and **deferred** to other lanes. Don't try to
script them in #2560 — they need their own follow-up.

- **Fierce Empath** — `mv_ge: 6` not in `SearchLibraryFilter` (#2587 added
  `mv_le`; the `mv_ge` arm is future-lane).
- **Circuitous Route** — `gate` subtype not in `SearchLibraryFilter`
  (would need a basic-land+gate OR; gates have no current subtype key).
- **Wishclaw Talisman** — multi-player search (`opponent gains control`
  - their own search); needs `who: "opponent"` semantics.
- **Hoarding Dragon** — compound: search library for an artifact, exile
  face-down, then put that card into owner's hand when Hoarding Dragon
  leaves the battlefield. Needs `SearchLibrary + ExileCard` plus a
  "tillLeaves" / "onLeavesBattlefield" trigger arm (owned by #2560's
  ReturnFromZone lane — see next handoff).
- **Grow from the Ashes** — kicker (CR 702.32); `if_kicked` schema arm
  ships in #2564.
- **Springbloom Druid** — `if you do` after sacrificing a land — needs
  conditional cost payment semantics; follow-up lane.

## Pitfalls (carry from #2565)

- `write` tool path resolution doesn't track shell cwd. Don't `cd` into
  a worktree via `cd` and then use `write` — the file lands in the
  process cwd, not the worktree.
- `CardScriptSchema` is strict — only script-shape fields. **No
  `mana_cost`, `type_line`, `power`, `toughness` at the top level** of
  cards/*.json. Strip them before save.
- `cards/index.generated.ts` is gitignored — regenerate via
  `npx tsx scripts/build-card-script-index.ts`, don't commit.
- Test-count ratchet: `npm run ratchet:test-count` flakes on this
  machine (forge-gate / forge-selfplay). Use the small-machine fallback
  documented in AGENTS.md: `npx jest --listTests | wc -l` for suites
  plus measured delta for cases.
- Commit format: `feat|fix|docs(scope): subject (issue NNNN)`. No
  `[AI-assisted]` prefix — commitlint rejects it. **Two commits per
  PR:** one for code + ratchet, one for the handoff doc.

## Suggested scope for #2560 (ReturnFromZone)

Read `docs/card-scripts/issue-2565-handoff-prompt.md` and
`docs/card-scripts/wave4.8-closed.md` (esp. §1 lane 71) to understand
the ReturnFromZone shape. Likely candidates (FND-bounded, simple
ReturnFromZone usage only):

1. **Whisk Away** (MKM, sorcery) — return target creature to its owner's
   hand. Bounce single.
2. **Man-o'-War** (MKM, ETB → return target creature). Bounce single ETB.
3. **Kor Skyglider** / **Adaptive Shimmerer** (FDN, ETB → return an
   artifact/enchantment).
4. **Displacer Beast** / **Wingmantle Chaplain** (FDN, ETB → return).

Verify with `docs/card-scripts/drafts/*.md` first. Avoid any card whose
trigger condition involves "if you control X" or "when X enters"
chained effects — they need the schema arms #2560 doesn't include.

## Known gaps (surfacing per handoff rules)

- **Hoarding Dragon's `whenLeaves` arm** is the single largest blocker
  for issue #2562's final FDN closure — it's a compound of
  SearchLibrary + ExileCard + ReturnFromZone, plus a
  `trigger_event: "leavesBattlefield"` on the exiled card. If the
  #2560 session ships that arm, file a follow-up issue to ship Hoarding
  Dragon in a single SearchLibrary+Exile+Leave script.

- **`gate` filter key** for SearchLibrary is a clean addition — schema
  only, no engine work. Consider filing a one-line follow-up.

- **`mv_ge` filter key** for SearchLibrary: needs follow-up similar
  to #2587's `mv_le` arm.
