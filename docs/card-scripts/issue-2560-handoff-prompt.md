# Handoff prompt — issue #2560 (ReturnFromZone follow-up)

> **For the next session (issue #2568 Enchant/Aura).** Paste the system
> prompt first; this section gives the working state and pitfalls.

## State at handoff

- Branch: `feat/issue-2560-return-from-zone-fdn-cards`
- Base: `main @ 2464050d` (independent of PR #2819 — its doc bump is +1/+2)
- Work shipped in this PR:
  - 3 cards added as JSON:
    - `src/lib/game-state/card-scripts/cards/zombify.json` — sorcery,
      `ReturnFromZone` filter `{creature: true, controller: "you"}`,
      count 1.
    - `src/lib/game-state/card-scripts/cards/driver_of_the_dead.json`
      (FDN #605) — `{3}{B}` Creature Vampire 3/2, dies trigger on self,
      `ReturnFromZone` filter `{creature: true, mv_le: 2, controller:
"you"}`.
    - `src/lib/game-state/card-scripts/cards/call_a_surprise_witness.json`
      (MKM #6) — sorcery, `ReturnFromZone` filter `{creature: true,
mv_le: 3, controller: "you"}`. Note: oracle also adds a flying
      counter + Spirit type-change — both out of scope.
  - 1 test file:
    `src/lib/game-state/__tests__/issue-2560-return-from-zone-fdn-cards.test.ts`
    (3 it() blocks: spell shape for Driver of the Dead `event: "dies"`,
    Zombify, Call a Surprise Witness.)
  - Doc ratchet: 810 → 811 suites, 14830 → 14833 tests (14823 → 14826
    passed + 7 skipped). **Independent of PR #2819's doc bump** — this
    branch doesn't carry PR #2819's +1 suite / +2 test commit.

- `src/lib/game-state/card-scripts/cards/index.generated.ts` is **gitignored**
  — never commit it. `npx tsx scripts/build-card-script-index.ts`
  regenerates it. (Now writing 341 scripts: 338 baseline + 3 new.)

## ReturnFromZone schema gotchas (re-learned this session)

1. **`mv_le` only** — no `mv_lt`, no `mv_ge`. The schema is single-sided
   ≤. "Greater than", "less than", or "equal to N" all need to use
   `mv_le` with a different bound (the engine can do `mv_le: 2` for "≤2"
   but "≥6" needs `mv_ge` which is future-lane).
2. **No `tapped`** — the schema doesn't accept a `tapped: true` field
   on `ReturnFromZone`. Dead-page Deadly Plot (returns tapped Zombie)
   and similar cards cannot express this.
3. **No counters** — `ReturnFromZone` is plain reanimate. No way to
   script "+1/+1 counter" or "flying counter" add-on.
4. **No type-change** — Call a Surprise Witness's "It's a Spirit in
   addition to its other types" cannot be scripted.
5. **`from: "graveyard"`, `to: "battlefield"`** — only tested for
   graveyard→battlefield. Other zones need separate verification.

## Out-of-scope graveyard-returners (deferred)

These remain in the 46-card pool but are blocked:

- **Yuma** (FIN) — mana-payment counts (X-cost per card usage)
- **Yuna, Hope of Spira** — multitrigger + finality counter
- **Deadly Plot** — Zombie subtype + tapped destination
- **Evil Reawakened** — +1/+1 counters
- **Nullpriest of Oblivion** — kicker (CR 702.32; #2564 lane)
- **Forum Necroscribe / Moment of Reckoning** — subtype/nonland filter
- **Jackdaw Savior** (BLB) — `mv_lt: <dynamic>` + "another target"
  target-filter — both future-lane schema arms
- **Dawn's Truce** (BLB) — **misclassified** in the issue body; this
  is a hexproof/indestructible instant, not a graveyard-returner. The
  closest ScriptableEngines mechanic is `AddKeywords` or
  `GainAbility` — needs to be filed as a new issue.

## Pitfalls (carry from #2565, #2562)

- `write` tool path resolution doesn't track shell cwd. If you `cd`
  into a worktree via `cd` and then use `write`, the file lands in
  the process cwd, not the worktree.
- `CardScriptSchema` is strict — only script-shape fields. **No
  `mana_cost`, `type_line`, `power`, `toughness` at the top level**
  of cards/*.json.
- `cards/index.generated.ts` is gitignored — regenerate via
  `npx tsx scripts/build-card-script-index.ts`, don't commit.
- **Test-count ratchet flakes on this machine.** `npm run ratchet:test-count`
  reads `npm test --silent` and on this host that command reports a
  different count each run (forge-gate / forge-selfplay flakes drop
  tests). Per AGENTS.md small-machine rule, use `--listTests | wc -l`
  for suites + measured `it()` deltas for cases. **Important: don't
  trust a single `npm test --silent` snapshot** — re-run 2-3 times.
- **Test Count Docs Guard is flake-sensitive on CI.** PR #2819 had a
  docs drift that turned out to be a CI-flake variance (the
  `live=811/14835/14828` it captured vs my docs `812/14841/14834`).
  CI has a stable flake profile; for the most predictable docs,
  re-run `npm test --silent` locally a few times and pick the
  **lowest** total (treats flakes as consistent).
- **Two commits per PR:** code+ratchet together; handoff doc as
  separate commit. The handoff commit is for the _next_ issue, so
  each session's branch carries its own handoff doc.
- Commit format: `feat|fix|docs(scope): subject (issue NNNN)`. No
  `[AI-assisted]` prefix — commitlint rejects it.

## Suggested scope for #2568 (Enchant/Aura)

This is the **largest** remaining card-scripts op per the loop order.
The scope is the **Attach** op family: Enchant/Aura attachment to a
target with continuous stat buffs (e.g., `+1/+1`), keyword grants
(e.g., hexproof), and conditional trigger declarations.

Reference: `docs/card-scripts/issue-2565-handoff-prompt.md` lists the
typical Enchant/Aura blockers (`add_keywords` is a separate op arm,
`modify_stats` is yet another, conditional triggers via `static_text`
or `trigger_event` differ). Realistic first-batch candidates:

1. **Pacifism** (FDN) — Aura that says "Enchanted creature can't
   attack or block, and its activated abilities can't be activated."
   Needs `cant_attack`, `cant_block`, `cant_activate` — likely
   three separate schema arms.
2. **Blanchwood Armor** (FDN) — Aura that says "Enchanted creature
   gets +1/+1 for each Forest you control." Needs `modify_stats`
   - a count source (your-permanent count).
3. **Twinblade Blessing** (FDN) — Aura that says "Enchanted creature
   gets +1/+1, has menace, and attacks each combat if able."
   Combines `modify_stats` + `add_keywords` + `attack_req`.
4. **Witness Protection** (FDN) — Aura that gives -1/-1 and the
   owner discards if they change.
5. **Eaten by Piranhas** (FDN) — Aura with Defender + sacrifice on
   attack.
6. **Starlit Sanctum** / **Starlit Mantle** — Aura-equipment hyphens
   (multiple aura-grant each other) — likely out of scope.

The PR should focus on **1–2 cards** for the smallest atomic op
shipment (probably Pacifism or a "Enchanted creature can't attack"
narrow). The Enchant/Aura lane is the **largest** op family; better
to ship a thin PR than over-reach.

## Known gaps (surfacing per handoff rules)

- `AddKeywords` op needed for Aura keyword grants (hexproof,
  menace, lifelink, etc.). Currently no such op — would be a new
  schema + engine arm.
- `ModifyStats` op needed for numeric stat grants (+1/+1, -1/-1,
  with or without "for each N"). Future-lane.
- `StaticText` op needed for fully text-defined Auras (the
  "Enchanted creature can't..." family). Future-lane.
- `ConditionalTrigger` op needed for Auras whose granted ability
  fires on a state change.

All four should ideally land together before any Aura can be
fully scripted. Suggest scoping #2568 to ship **one** of those arms
(Pacifism is the smallest — pure suppression, no keywords/stats) and
follow up with the others in lane-2.
