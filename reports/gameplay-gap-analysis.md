# Gameplay Gap Analysis

**Generated:** 2026-10-02T01:58:00.511Z

## Summary

- Standard scope: 5164 Standard-legal cards (Scryfall snapshot 2026-10-01)
- **In scope (on a Standard-legal card): 38**
  - Enforced: 22
  - Partially enforced: 0
  - Not enforced: 16
  - **Remainder (not fully enforced): 16**
- Accepted gaps (not on any Standard-legal card): 59
- On Standard cards but not declared by the parser: 230
- Unique keywords declared by the parser: 97 (105 entries, 8 declared in both arrays)
  - Evergreen keywords: 64
  - Ability words: 41
- Keywords fully enforced: 24
- Keywords partially enforced: 1
- Keywords not enforced: 72
- Hardcoded card effects: 0
- Forced auto-pass priority calls: 0
- Manual tap/untap calls: 0
- TODO/FIXME/HACK/XXX comments: 0

## Keyword Enforcement Matrix

## In Scope: Standard

Keywords that appear on at least one Standard-legal card. These are the epic #2300 denominator. Sorted by how many Standard cards carry them.

### Enforced (22)

| Keyword        | Standard cards | Enforced | Used in Gameplay | Tested | Function                                                                               |
| -------------- | -------------- | -------- | ---------------- | ------ | -------------------------------------------------------------------------------------- |
| flying         | 530            | full     | ✅               | ✅     | hasFlying, hasFlyingStrict                                                             |
| vigilance      | 197            | full     | ✅               | ✅     | hasVigilance, hasVigilanceStrict                                                       |
| trample        | 195            | full     | ✅               | ✅     | hasTrample, hasTrampleStrict                                                           |
| surveil        | 177            | full     | ✅               | ✅     | performSurveil                                                                         |
| flash          | 164            | full     | ✅               | ✅     | hasFlash, canCastAtInstantSpeed                                                        |
| reach          | 142            | full     | ✅               | ✅     | hasReach, hasReachStrict                                                               |
| equip          | 132            | full     | ✅               | ✅     | canEquip, resolveEquip                                                                 |
| menace         | 113            | full     | ✅               | ✅     | hasMenace, hasMenaceStrict                                                             |
| haste          | 111            | full     | ✅               | ✅     | hasHaste, hasHasteStrict                                                               |
| enchant        | 100            | full     | ✅               | ✅     | canEnchantTarget, isAuraIllegallyAttached                                              |
| lifelink       | 97             | full     | ✅               | ✅     | hasLifelink, hasLifelinkStrict                                                         |
| deathtouch     | 93             | full     | ✅               | ✅     | hasDeathtouch, hasDeathtouchStrict                                                     |
| ward           | 92             | full     | ✅               | ✅     | hasWard, hasWardStrict, isProtectedByWard, isProtectedByWardStrict                     |
| transform      | 88             | full     | ✅               | ✅     | canTransform, transformPermanent                                                       |
| first strike   | 39             | full     | ✅               | ✅     | hasFirstStrike, hasFirstStrikeStrict, dealsFirstStrikeDamage                           |
| prowess        | 37             | full     | ✅               | ✅     | hasProwess, hasProwessStrict                                                           |
| double strike  | 29             | full     | ✅               | ✅     | hasDoubleStrike, hasDoubleStrikeStrict                                                 |
| defender       | 26             | full     | ✅               | ✅     | hasDefender, hasDefenderStrict                                                         |
| indestructible | 20             | full     | ✅               | ✅     | hasIndestructible, hasIndestructibleStrict, hasIndestructibleKeyword, isIndestructible |
| hexproof       | 11             | full     | ✅               | ✅     | hasHexproof, hasHexproofStrict, isProtectedByHexproof, isProtectedByHexproofStrict     |
| hexproof from  | 4              | full     | ✅               | ✅     | hasHexproof, hasHexproofStrict, isProtectedByHexproof, isProtectedByHexproofStrict     |
| protection     | 3              | full     | ✅               | ✅     | hasProtectionFrom                                                                      |

### Not Enforced (16)

| Keyword    | Standard cards | Enforced | Used in Gameplay | Tested | Function |
| ---------- | -------------- | -------- | ---------------- | ------ | -------- |
| crew       | 76             | none     | ❌               | ❌     | —        |
| landfall   | 54             | none     | ❌               | ✅     | —        |
| fight      | 31             | none     | ❌               | ✅     | —        |
| threshold  | 18             | none     | ❌               | ✅     | —        |
| raid       | 13             | none     | ❌               | ✅     | —        |
| converge   | 9              | none     | ❌               | ✅     | —        |
| ferocious  | 7              | none     | ❌               | ✅     | —        |
| morbid     | 5              | none     | ❌               | ✅     | —        |
| improvise  | 2              | none     | ❌               | ❌     | —        |
| battle cry | 1              | none     | ❌               | ✅     | —        |
| channel    | 1              | none     | ❌               | ❌     | —        |
| domain     | 1              | none     | ❌               | ✅     | —        |
| grandeur   | 1              | none     | ❌               | ✅     | —        |
| ninjutsu   | 1              | none     | ❌               | ❌     | —        |
| storm      | 1              | none     | ❌               | ✅     | —        |
| wither     | 1              | none     | ❌               | ❌     | —        |

## Accepted Gaps (59)

Declared by the parser but not on any Standard-legal card as of 2026-10-01. Not counted against epic #2300.

| Keyword              | Enforced | Reason                                      |
| -------------------- | -------- | ------------------------------------------- |
| assemble             | none     | not on any Standard-legal card (2026-10-01) |
| banding              | none     | not on any Standard-legal card (2026-10-01) |
| bestow               | none     | not on any Standard-legal card (2026-10-01) |
| bloodrush            | none     | not on any Standard-legal card (2026-10-01) |
| chroma               | none     | not on any Standard-legal card (2026-10-01) |
| cohort               | none     | not on any Standard-legal card (2026-10-01) |
| corpse               | none     | not on any Standard-legal card (2026-10-01) |
| crewmate             | none     | not on any Standard-legal card (2026-10-01) |
| eked                 | none     | not on any Standard-legal card (2026-10-01) |
| fabricate            | none     | not on any Standard-legal card (2026-10-01) |
| fateful hour         | none     | not on any Standard-legal card (2026-10-01) |
| fear                 | none     | not on any Standard-legal card (2026-10-01) |
| flanking             | none     | not on any Standard-legal card (2026-10-01) |
| fusillade            | none     | not on any Standard-legal card (2026-10-01) |
| hellbent             | none     | not on any Standard-legal card (2026-10-01) |
| heroic               | none     | not on any Standard-legal card (2026-10-01) |
| infect               | full     | not on any Standard-legal card (2026-10-01) |
| inspired             | none     | not on any Standard-legal card (2026-10-01) |
| intimidate           | none     | not on any Standard-legal card (2026-10-01) |
| join forces          | none     | not on any Standard-legal card (2026-10-01) |
| kinfall              | none     | not on any Standard-legal card (2026-10-01) |
| landwalk             | partial  | not on any Standard-legal card (2026-10-01) |
| lieutenant           | none     | not on any Standard-legal card (2026-10-01) |
| lifeline             | none     | not on any Standard-legal card (2026-10-01) |
| lure                 | none     | not on any Standard-legal card (2026-10-01) |
| mentor               | none     | not on any Standard-legal card (2026-10-01) |
| metalcraft           | none     | not on any Standard-legal card (2026-10-01) |
| might of the nations | none     | not on any Standard-legal card (2026-10-01) |
| miracle              | none     | not on any Standard-legal card (2026-10-01) |
| morph                | none     | not on any Standard-legal card (2026-10-01) |
| mutate               | full     | not on any Standard-legal card (2026-10-01) |
| outlast              | none     | not on any Standard-legal card (2026-10-01) |
| overload             | none     | not on any Standard-legal card (2026-10-01) |
| pack tactics         | none     | not on any Standard-legal card (2026-10-01) |
| parley               | none     | not on any Standard-legal card (2026-10-01) |
| phasing              | none     | not on any Standard-legal card (2026-10-01) |
| provoke              | none     | not on any Standard-legal card (2026-10-01) |
| radiance             | none     | not on any Standard-legal card (2026-10-01) |
| rally                | none     | not on any Standard-legal card (2026-10-01) |
| rampage              | none     | not on any Standard-legal card (2026-10-01) |
| reacher              | none     | not on any Standard-legal card (2026-10-01) |
| renown               | none     | not on any Standard-legal card (2026-10-01) |
| revolt               | none     | not on any Standard-legal card (2026-10-01) |
| shadow               | none     | not on any Standard-legal card (2026-10-01) |
| shield               | none     | not on any Standard-legal card (2026-10-01) |
| soulbond             | none     | not on any Standard-legal card (2026-10-01) |
| splice               | none     | not on any Standard-legal card (2026-10-01) |
| split second         | none     | not on any Standard-legal card (2026-10-01) |
| strength in numbers  | none     | not on any Standard-legal card (2026-10-01) |
| suffix               | none     | not on any Standard-legal card (2026-10-01) |
| support              | none     | not on any Standard-legal card (2026-10-01) |
| surge                | none     | not on any Standard-legal card (2026-10-01) |
| swipe                | none     | not on any Standard-legal card (2026-10-01) |
| tempting offer       | none     | not on any Standard-legal card (2026-10-01) |
| tribute              | none     | not on any Standard-legal card (2026-10-01) |
| undaunted            | none     | not on any Standard-legal card (2026-10-01) |
| underdog             | none     | not on any Standard-legal card (2026-10-01) |
| undergrowth          | none     | not on any Standard-legal card (2026-10-01) |
| will of the council  | none     | not on any Standard-legal card (2026-10-01) |

## On Standard Cards, Not Declared by the Parser

230 keywords carried by Standard-legal cards that the oracle-text parser never declares, so the engine can't detect them. Needs triage: some are keyword actions (mill, scry) handled by effect resolution rather than a gate. Top 40 by card count:

| Keyword            | Standard cards |
| ------------------ | -------------- |
| mill               | 127            |
| treasure           | 99             |
| scry               | 88             |
| cycling            | 73             |
| prepared           | 62             |
| food               | 57             |
| flashback          | 45             |
| investigate        | 42             |
| start your engines | 40             |
| landcycling        | 39             |
| typecycling        | 39             |
| plot               | 37             |
| disguise           | 36             |
| exhaust            | 35             |
| empower jace       | 34             |
| max speed          | 34             |
| role token         | 34             |
| warp               | 32             |
| double             | 31             |
| saddle             | 30             |
| sneak              | 27             |
| station            | 27             |
| earthbend          | 26             |
| explore            | 26             |
| manifest           | 25             |
| manifest dread     | 25             |
| blight             | 24             |
| power-up           | 24             |
| waterbend          | 24             |
| gift               | 23             |
| discover           | 22             |
| behold             | 21             |
| firebending        | 21             |
| spree              | 21             |
| affinity           | 20             |
| bargain            | 20             |
| collect evidence   | 20             |
| delirium           | 20             |
| changeling         | 19             |
| convoke            | 19             |

## Hardcoded Card Effects

| Card | Location | Line | Snippet |
| ---- | -------- | ---- | ------- |

## Forced Auto-Pass Priority Calls

These bypass the stack interaction model by forcing both players to pass priority without giving them a response window.

| Location | Line | Context |
| -------- | ---- | ------- |

## Manual Tap/Untap Calls

These bypass proper ability activation validation (summoning sickness, cost payment, etc.).

| Type | Location | Line | Context |
| ---- | -------- | ---- | ------- |

## TODO / FIXME / HACK / XXX Comments

_No TODO/FIXME/HACK/XXX comments found in game-state code._

## Top Priority Gaps

In-scope keywords not fully enforced, ranked by how many Standard-legal cards carry them:

1. **crew** (76 Standard cards) — No enforcement function found
2. **landfall** (54 Standard cards) — No enforcement function found
3. **fight** (31 Standard cards) — No enforcement function found
4. **threshold** (18 Standard cards) — No enforcement function found
5. **raid** (13 Standard cards) — No enforcement function found
6. **converge** (9 Standard cards) — No enforcement function found
7. **ferocious** (7 Standard cards) — No enforcement function found
8. **morbid** (5 Standard cards) — No enforcement function found
9. **improvise** (2 Standard cards) — No enforcement function found
10. **battle cry** (1 Standard cards) — No enforcement function found
11. **channel** (1 Standard cards) — No enforcement function found
12. **domain** (1 Standard cards) — No enforcement function found
13. **grandeur** (1 Standard cards) — No enforcement function found
14. **ninjutsu** (1 Standard cards) — No enforcement function found
15. **storm** (1 Standard cards) — No enforcement function found
16. **wither** (1 Standard cards) — No enforcement function found

## Recommendations

### Immediate (This Session)

1. Fix auto-pass priority (#618) — 0 locations bypass stack interaction
2. Add mechanic stubs (#628) — 16 in-scope Standard mechanics detected but not enforced
3. Fix mana pool emptying (#619) — missing automatic phase transition cleanup

### Short Term (Next 2–3 Sessions)

4. Enforce hexproof & menace (#620) — partial enforcement exists but not wired to gameplay
5. Fix shockland life payment (#621) — uses damage instead of life loss
6. Implement untap step (#624) — structural phase with no engine logic

### Medium Term (Next 4–6 Sessions)

7. First strike / double strike combat (#626) — single damage step is wrong
8. Trample + blocker ordering (#627) — no player choice in damage assignment
9. Standard mechanic E2E tests (#623) — verify actual gameplay, not just card presence
