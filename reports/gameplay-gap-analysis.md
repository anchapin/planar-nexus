# Gameplay Gap Analysis

**Generated:** 2026-09-28T21:23:44.269Z

## Summary

- Total keywords detected: 105
  - Evergreen keywords: 64
  - Ability words: 41
- Keywords fully enforced: 6
- Keywords partially enforced: 13
- Keywords not enforced: 86
- Hardcoded card effects: 0
- Forced auto-pass priority calls: 0
- Manual tap/untap calls: 0
- TODO/FIXME/HACK/XXX comments: 0

## Keyword Enforcement Matrix

### Fully Enforced (6)

| Keyword    | Enforced | Used in Gameplay | Tested | Function      |
| ---------- | -------- | ---------------- | ------ | ------------- |
| deathtouch | full     | ✅               | ✅     | hasDeathtouch |
| haste      | full     | ✅               | ✅     | hasHaste      |
| infect     | full     | ✅               | ✅     | hasInfect     |
| lifelink   | full     | ✅               | ✅     | hasLifelink   |
| trample    | full     | ✅               | ✅     | hasTrample    |
| vigilance  | full     | ✅               | ✅     | hasVigilance  |

### Partially Enforced (13)

| Keyword        | Enforced | Used in Gameplay | Tested | Function                           |
| -------------- | -------- | ---------------- | ------ | ---------------------------------- |
| defender       | partial  | ❌               | ✅     | hasDefender                        |
| flash          | partial  | ❌               | ✅     | hasFlash                           |
| flying         | partial  | ❌               | ✅     | hasFlying                          |
| flying         | partial  | ❌               | ✅     | hasFlying                          |
| hexproof       | partial  | ❌               | ✅     | hasHexproof, isProtectedByHexproof |
| hexproof from  | partial  | ❌               | ✅     | hasHexproof, isProtectedByHexproof |
| indestructible | partial  | ❌               | ✅     | isIndestructible                   |
| landwalk       | partial  | ❌               | ✅     | hasLandwalk                        |
| menace         | partial  | ❌               | ✅     | hasMenace                          |
| mutate         | partial  | ❌               | ✅     | hasMutate                          |
| prowess        | partial  | ❌               | ✅     | hasProwess                         |
| reach          | partial  | ❌               | ✅     | hasReach                           |
| ward           | partial  | ❌               | ✅     | hasWard, isProtectedByWard         |

### Not Enforced — Standard Relevant (32)

| Keyword              | Enforced | Used in Gameplay | Tested | Function |
| -------------------- | -------- | ---------------- | ------ | -------- |
| assemble             | none     | ❌               | ✅     | —        |
| battle cry           | none     | ❌               | ✅     | —        |
| bloodrush            | none     | ❌               | ✅     | —        |
| chroma               | none     | ❌               | ✅     | —        |
| cohort               | none     | ❌               | ✅     | —        |
| double strike        | none     | ❌               | ✅     | —        |
| eked                 | none     | ❌               | ❌     | —        |
| enchant              | none     | ❌               | ✅     | —        |
| equip                | none     | ❌               | ✅     | —        |
| fateful hour         | none     | ❌               | ✅     | —        |
| ferocious            | none     | ❌               | ✅     | —        |
| first strike         | none     | ❌               | ✅     | —        |
| hellbent             | none     | ❌               | ✅     | —        |
| heroic               | none     | ❌               | ✅     | —        |
| inspired             | none     | ❌               | ✅     | —        |
| join forces          | none     | ❌               | ✅     | —        |
| join forces          | none     | ❌               | ✅     | —        |
| kinfall              | none     | ❌               | ✅     | —        |
| lieutenant           | none     | ❌               | ✅     | —        |
| metalcraft           | none     | ❌               | ✅     | —        |
| might of the nations | none     | ❌               | ❌     | —        |
| pack tactics         | none     | ❌               | ✅     | —        |
| parley               | none     | ❌               | ✅     | —        |
| radiance             | none     | ❌               | ✅     | —        |
| shield               | none     | ❌               | ✅     | —        |
| soulbond             | none     | ❌               | ✅     | —        |
| strength in numbers  | none     | ❌               | ✅     | —        |
| tempting offer       | none     | ❌               | ✅     | —        |
| threshold            | none     | ❌               | ✅     | —        |
| underdog             | none     | ❌               | ✅     | —        |
| undergrowth          | none     | ❌               | ✅     | —        |
| will of the council  | none     | ❌               | ✅     | —        |

### Not Enforced — Non-Standard / Legacy (54)

| Keyword      | Enforced | Used in Gameplay | Tested | Function |
| ------------ | -------- | ---------------- | ------ | -------- |
| phasing      | none     | ❌               | ✅     | —        |
| banding      | none     | ❌               | ✅     | —        |
| bestow       | none     | ❌               | ✅     | —        |
| channel      | none     | ❌               | ❌     | —        |
| converge     | none     | ❌               | ✅     | —        |
| corpse       | none     | ❌               | ✅     | —        |
| crew         | none     | ❌               | ❌     | —        |
| crewmate     | none     | ❌               | ❌     | —        |
| domain       | none     | ❌               | ✅     | —        |
| fabricate    | none     | ❌               | ❌     | —        |
| fear         | none     | ❌               | ❌     | —        |
| fight        | none     | ❌               | ✅     | —        |
| flanking     | none     | ❌               | ✅     | —        |
| fusillade    | none     | ❌               | ❌     | —        |
| grandeur     | none     | ❌               | ✅     | —        |
| improvise    | none     | ❌               | ❌     | —        |
| intimidate   | none     | ❌               | ❌     | —        |
| landfall     | none     | ❌               | ✅     | —        |
| landfall     | none     | ❌               | ✅     | —        |
| lifeline     | none     | ❌               | ❌     | —        |
| lure         | none     | ❌               | ✅     | —        |
| mentor       | none     | ❌               | ✅     | —        |
| miracle      | none     | ❌               | ✅     | —        |
| miracle      | none     | ❌               | ✅     | —        |
| morbid       | none     | ❌               | ✅     | —        |
| morph        | none     | ❌               | ✅     | —        |
| ninjutsu     | none     | ❌               | ❌     | —        |
| outlast      | none     | ❌               | ❌     | —        |
| overload     | none     | ❌               | ❌     | —        |
| protection   | none     | ❌               | ✅     | —        |
| provoke      | none     | ❌               | ❌     | —        |
| raid         | none     | ❌               | ✅     | —        |
| raid         | none     | ❌               | ✅     | —        |
| raid         | none     | ❌               | ✅     | —        |
| rally        | none     | ❌               | ✅     | —        |
| rampage      | none     | ❌               | ✅     | —        |
| reacher      | none     | ❌               | ❌     | —        |
| renown       | none     | ❌               | ✅     | —        |
| revolt       | none     | ❌               | ✅     | —        |
| revolt       | none     | ❌               | ✅     | —        |
| revolt       | none     | ❌               | ✅     | —        |
| shadow       | none     | ❌               | ✅     | —        |
| splice       | none     | ❌               | ❌     | —        |
| split second | none     | ❌               | ✅     | —        |
| storm        | none     | ❌               | ✅     | —        |
| suffix       | none     | ❌               | ✅     | —        |
| support      | none     | ❌               | ✅     | —        |
| surge        | none     | ❌               | ❌     | —        |
| surveil      | none     | ❌               | ✅     | —        |
| swipe        | none     | ❌               | ❌     | —        |
| transform    | none     | ❌               | ✅     | —        |
| tribute      | none     | ❌               | ✅     | —        |
| undaunted    | none     | ❌               | ❌     | —        |
| wither       | none     | ❌               | ❌     | —        |

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

Based on Standard relevance and gameplay impact:

1. **defender** — Partial enforcement — function exists but not wired to gameplay
2. **flash** — Partial enforcement — function exists but not wired to gameplay
3. **flying** — Partial enforcement — function exists but not wired to gameplay
4. **flying** — Partial enforcement — function exists but not wired to gameplay
5. **hexproof** — Partial enforcement — function exists but not wired to gameplay
6. **hexproof from** — Partial enforcement — function exists but not wired to gameplay
7. **indestructible** — Partial enforcement — function exists but not wired to gameplay
8. **landwalk** — Partial enforcement — function exists but not wired to gameplay
9. **menace** — Partial enforcement — function exists but not wired to gameplay
10. **mutate** — Partial enforcement — function exists but not wired to gameplay
11. **prowess** — Partial enforcement — function exists but not wired to gameplay
12. **reach** — Partial enforcement — function exists but not wired to gameplay
13. **ward** — Partial enforcement — function exists but not wired to gameplay
14. **assemble** — No enforcement function exists
15. **battle cry** — No enforcement function exists
16. **bloodrush** — No enforcement function exists
17. **chroma** — No enforcement function exists
18. **cohort** — No enforcement function exists
19. **double strike** — No enforcement function exists
20. **eked** — No enforcement function exists
21. **enchant** — No enforcement function exists
22. **equip** — No enforcement function exists
23. **fateful hour** — No enforcement function exists
24. **ferocious** — No enforcement function exists
25. **first strike** — No enforcement function exists
26. **hellbent** — No enforcement function exists
27. **heroic** — No enforcement function exists
28. **inspired** — No enforcement function exists
29. **join forces** — No enforcement function exists
30. **join forces** — No enforcement function exists
31. **kinfall** — No enforcement function exists
32. **lieutenant** — No enforcement function exists
33. **metalcraft** — No enforcement function exists

## Recommendations

### Immediate (This Session)

1. Fix auto-pass priority (#618) — 0 locations bypass stack interaction
2. Add mechanic stubs (#628) — 32 Standard mechanics detected but not enforced
3. Fix mana pool emptying (#619) — missing automatic phase transition cleanup

### Short Term (Next 2–3 Sessions)

4. Enforce hexproof & menace (#620) — partial enforcement exists but not wired to gameplay
5. Fix shockland life payment (#621) — uses damage instead of life loss
6. Implement untap step (#624) — structural phase with no engine logic

### Medium Term (Next 4–6 Sessions)

7. First strike / double strike combat (#626) — single damage step is wrong
8. Trample + blocker ordering (#627) — no player choice in damage assignment
9. Standard mechanic E2E tests (#623) — verify actual gameplay, not just card presence
