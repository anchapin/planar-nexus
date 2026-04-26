# Gameplay Gap Analysis

**Generated:** 2026-04-26T01:37:16.898Z

## Summary

- Total keywords detected: 257
  - Evergreen keywords: 180
  - Ability words: 77
- Keywords fully enforced: 3
- Keywords partially enforced: 11
- Keywords not enforced: 243
- Hardcoded card effects: 10
- Forced auto-pass priority calls: 16
- Manual tap/untap calls: 4
- TODO/FIXME/HACK/XXX comments: 0

## Keyword Enforcement Matrix

### Fully Enforced (3)

| Keyword | Enforced | Used in Gameplay | Tested | Function |
|---------|----------|------------------|--------|----------|
| flash | full | ✅ | ✅ | hasFlash |
| haste | full | ✅ | ✅ | hasHaste |
| vigilance | full | ✅ | ✅ | hasVigilance |

### Partially Enforced (11)

| Keyword | Enforced | Used in Gameplay | Tested | Function |
|---------|----------|------------------|--------|----------|
| deathtouch | partial | ❌ | ✅ | hasDeathtouch |
| defender | partial | ❌ | ✅ | hasDefender |
| flying | partial | ❌ | ✅ | hasFlying |
| hexproof | partial | ❌ | ✅ | hasHexproof, isProtectedByHexproof |
| hexproof from | partial | ❌ | ❌ | hasHexproof, isProtectedByHexproof |
| indestructible | partial | ❌ | ✅ | isIndestructible |
| lifelink | partial | ❌ | ✅ | hasLifelink |
| menace | partial | ❌ | ✅ | hasMenace |
| reach | partial | ❌ | ✅ | hasReach |
| trample | partial | ❌ | ✅ | hasTrample |
| ward | partial | ❌ | ✅ | hasWard, isProtectedByWard |

### Not Enforced — Standard Relevant (178)

| Keyword | Enforced | Used in Gameplay | Tested | Function |
|---------|----------|------------------|--------|----------|
| adventure | none | ❌ | ✅ | — |
| affinity | none | ❌ | ✅ | — |
| affinity for | none | ❌ | ✅ | — |
| annihilator | none | ❌ | ✅ | — |
| assemble | none | ❌ | ✅ | — |
| assemble | none | ❌ | ✅ | — |
| backup | none | ❌ | ✅ | — |
| bargain | none | ❌ | ✅ | — |
| bargain | none | ❌ | ✅ | — |
| battle cry | none | ❌ | ✅ | — |
| battle cry | none | ❌ | ✅ | — |
| blitz | none | ❌ | ✅ | — |
| bloodrush | none | ❌ | ✅ | — |
| bloodrush | none | ❌ | ✅ | — |
| bloodthirst | none | ❌ | ✅ | — |
| cascade | none | ❌ | ✅ | — |
| casualty | none | ❌ | ✅ | — |
| celebration | none | ❌ | ✅ | — |
| celebration | none | ❌ | ✅ | — |
| chroma | none | ❌ | ✅ | — |
| chroma | none | ❌ | ✅ | — |
| cloak | none | ❌ | ✅ | — |
| cohort | none | ❌ | ✅ | — |
| cohort | none | ❌ | ✅ | — |
| compleated | none | ❌ | ✅ | — |
| connive | none | ❌ | ✅ | — |
| connive | none | ❌ | ✅ | — |
| conspire | none | ❌ | ✅ | — |
| convoke | none | ❌ | ✅ | — |
| craft | none | ❌ | ✅ | — |
| cycling | none | ❌ | ✅ | — |
| dash | none | ❌ | ✅ | — |
| decayed | none | ❌ | ✅ | — |
| delirium | none | ❌ | ✅ | — |
| delve | none | ❌ | ✅ | — |
| descend | none | ❌ | ✅ | — |
| descend | none | ❌ | ✅ | — |
| dethrone | none | ❌ | ✅ | — |
| devour | none | ❌ | ✅ | — |
| disguise | none | ❌ | ✅ | — |
| disguised | none | ❌ | ✅ | — |
| double strike | none | ❌ | ✅ | — |
| dungeon | none | ❌ | ✅ | — |
| eerie | none | ❌ | ✅ | — |
| eerie | none | ❌ | ✅ | — |
| eked | none | ❌ | ❌ | — |
| eked | none | ❌ | ❌ | — |
| embalm | none | ❌ | ✅ | — |
| enchant | none | ❌ | ✅ | — |
| endure | none | ❌ | ✅ | — |
| enlist | none | ❌ | ✅ | — |
| entwine | none | ❌ | ✅ | — |
| equip | none | ❌ | ✅ | — |
| escape | none | ❌ | ✅ | — |
| evoke | none | ❌ | ✅ | — |
| exert | none | ❌ | ✅ | — |
| exploit | none | ❌ | ✅ | — |
| explore | none | ❌ | ✅ | — |
| extort | none | ❌ | ✅ | — |
| fateful hour | none | ❌ | ✅ | — |
| fateful hour | none | ❌ | ✅ | — |
| ferocious | none | ❌ | ✅ | — |
| ferocious | none | ❌ | ✅ | — |
| ferocious | none | ❌ | ✅ | — |
| first strike | none | ❌ | ✅ | — |
| flashback | none | ❌ | ✅ | — |
| flurry | none | ❌ | ✅ | — |
| flurry | none | ❌ | ✅ | — |
| food | none | ❌ | ✅ | — |
| forage | none | ❌ | ✅ | — |
| forage | none | ❌ | ✅ | — |
| formidable | none | ❌ | ✅ | — |
| frenzy | none | ❌ | ✅ | — |
| gift | none | ❌ | ✅ | — |
| goad | none | ❌ | ✅ | — |
| graft | none | ❌ | ✅ | — |
| harmonize | none | ❌ | ✅ | — |
| harmonize | none | ❌ | ✅ | — |
| haunt | none | ❌ | ✅ | — |
| hellbent | none | ❌ | ✅ | — |
| hellbent | none | ❌ | ✅ | — |
| hellbent | none | ❌ | ✅ | — |
| heroic | none | ❌ | ✅ | — |
| heroic | none | ❌ | ✅ | — |
| heroic | none | ❌ | ✅ | — |
| hidden agenda | none | ❌ | ✅ | — |
| hideaway | none | ❌ | ✅ | — |
| imprint | none | ❌ | ✅ | — |
| incubate | none | ❌ | ✅ | — |
| inspired | none | ❌ | ✅ | — |
| inspired | none | ❌ | ✅ | — |
| inspired | none | ❌ | ✅ | — |
| investigate | none | ❌ | ✅ | — |
| join forces | none | ❌ | ✅ | — |
| join forces | none | ❌ | ✅ | — |
| join forces | none | ❌ | ✅ | — |
| kicker | none | ❌ | ✅ | — |
| kinfall | none | ❌ | ✅ | — |
| kinfall | none | ❌ | ✅ | — |
| learn | none | ❌ | ✅ | — |
| level up | none | ❌ | ✅ | — |
| lieutenant | none | ❌ | ✅ | — |
| lieutenant | none | ❌ | ✅ | — |
| lieutenant | none | ❌ | ✅ | — |
| living weapon | none | ❌ | ✅ | — |
| magecraft | none | ❌ | ✅ | — |
| manifest dread | none | ❌ | ✅ | — |
| max speed | none | ❌ | ✅ | — |
| meld | none | ❌ | ✅ | — |
| metalcraft | none | ❌ | ✅ | — |
| metalcraft | none | ❌ | ✅ | — |
| might of the nations | none | ❌ | ❌ | — |
| might of the nations | none | ❌ | ❌ | — |
| modular | none | ❌ | ✅ | — |
| myriad | none | ❌ | ✅ | — |
| offering | none | ❌ | ✅ | — |
| offspring | none | ❌ | ✅ | — |
| pack tactics | none | ❌ | ✅ | — |
| pack tactics | none | ❌ | ✅ | — |
| pack tactics | none | ❌ | ✅ | — |
| parley | none | ❌ | ✅ | — |
| parley | none | ❌ | ✅ | — |
| persist | none | ❌ | ✅ | — |
| plot | none | ❌ | ✅ | — |
| populate | none | ❌ | ✅ | — |
| proliferate | none | ❌ | ✅ | — |
| prototype | none | ❌ | ✅ | — |
| radiance | none | ❌ | ✅ | — |
| radiance | none | ❌ | ✅ | — |
| radiance | none | ❌ | ✅ | — |
| read ahead | none | ❌ | ✅ | — |
| rebound | none | ❌ | ✅ | — |
| reconfigure | none | ❌ | ✅ | — |
| room | none | ❌ | ✅ | — |
| saddle | none | ❌ | ✅ | — |
| scavenge | none | ❌ | ✅ | — |
| shield | none | ❌ | ✅ | — |
| shield | none | ❌ | ✅ | — |
| shield | none | ❌ | ✅ | — |
| skulk | none | ❌ | ✅ | — |
| soulbond | none | ❌ | ✅ | — |
| soulbond | none | ❌ | ✅ | — |
| soulbond | none | ❌ | ✅ | — |
| spectacle | none | ❌ | ✅ | — |
| spree | none | ❌ | ✅ | — |
| start your engines! | none | ❌ | ✅ | — |
| strength in numbers | none | ❌ | ✅ | — |
| strength in numbers | none | ❌ | ✅ | — |
| strive | none | ❌ | ✅ | — |
| sunburst | none | ❌ | ✅ | — |
| survival | none | ❌ | ✅ | — |
| suspect | none | ❌ | ✅ | — |
| suspend | none | ❌ | ✅ | — |
| tempting offer | none | ❌ | ✅ | — |
| tempting offer | none | ❌ | ✅ | — |
| tempting offer | none | ❌ | ✅ | — |
| threshold | none | ❌ | ✅ | — |
| threshold | none | ❌ | ✅ | — |
| threshold | none | ❌ | ✅ | — |
| totem armor | none | ❌ | ✅ | — |
| toxic | none | ❌ | ✅ | — |
| training | none | ❌ | ✅ | — |
| transfigure | none | ❌ | ✅ | — |
| transmute | none | ❌ | ✅ | — |
| transmute | none | ❌ | ✅ | — |
| treasure | none | ❌ | ✅ | — |
| underdog | none | ❌ | ✅ | — |
| underdog | none | ❌ | ✅ | — |
| undergrowth | none | ❌ | ✅ | — |
| undergrowth | none | ❌ | ✅ | — |
| undying | none | ❌ | ✅ | — |
| unleash | none | ❌ | ✅ | — |
| valiant | none | ❌ | ✅ | — |
| valiant | none | ❌ | ✅ | — |
| vanishing | none | ❌ | ✅ | — |
| venture | none | ❌ | ✅ | — |
| will of the council | none | ❌ | ✅ | — |
| will of the council | none | ❌ | ✅ | — |

### Not Enforced — Non-Standard / Legacy (65)

| Keyword | Enforced | Used in Gameplay | Tested | Function |
|---------|----------|------------------|--------|----------|
|  phasing | none | ❌ | ❌ | — |
| banding | none | ❌ | ❌ | — |
| bestow | none | ❌ | ❌ | — |
| channel | none | ❌ | ❌ | — |
| converge | none | ❌ | ✅ | — |
| coven | none | ❌ | ✅ | — |
| crew | none | ❌ | ❌ | — |
| crewmate | none | ❌ | ❌ | — |
| domain | none | ❌ | ✅ | — |
| domain | none | ❌ | ✅ | — |
| expend | none | ❌ | ✅ | — |
| fabricate | none | ❌ | ❌ | — |
| fathomless descent | none | ❌ | ✅ | — |
| fear | none | ❌ | ❌ | — |
| fight | none | ❌ | ✅ | — |
| flanking | none | ❌ | ❌ | — |
| for miracle | none | ❌ | ✅ | — |
| grandeur | none | ❌ | ✅ | — |
| grandeur | none | ❌ | ✅ | — |
| improvise | none | ❌ | ❌ | — |
| infect | none | ❌ | ❌ | — |
| intimidate | none | ❌ | ❌ | — |
| kinship | none | ❌ | ✅ | — |
| landfall | none | ❌ | ✅ | — |
| landfall | none | ❌ | ✅ | — |
| landwalk | none | ❌ | ❌ | — |
| lure | none | ❌ | ❌ | — |
| mentor | none | ❌ | ❌ | — |
| miracle | none | ❌ | ✅ | — |
| miracle | none | ❌ | ✅ | — |
| morbid | none | ❌ | ✅ | — |
| morbid | none | ❌ | ✅ | — |
| morph | none | ❌ | ❌ | — |
| mutate | none | ❌ | ❌ | — |
| ninjutsu | none | ❌ | ❌ | — |
| outlast | none | ❌ | ❌ | — |
| overload | none | ❌ | ❌ | — |
| protection | none | ❌ | ✅ | — |
| provoke | none | ❌ | ❌ | — |
| prowess | none | ❌ | ❌ | — |
| raid | none | ❌ | ✅ | — |
| raid | none | ❌ | ✅ | — |
| raid | none | ❌ | ✅ | — |
| raid | none | ❌ | ✅ | — |
| rally | none | ❌ | ✅ | — |
| rally | none | ❌ | ✅ | — |
| rampage | none | ❌ | ❌ | — |
| readiness | none | ❌ | ✅ | — |
| renown | none | ❌ | ❌ | — |
| revolt | none | ❌ | ✅ | — |
| revolt | none | ❌ | ✅ | — |
| revolt | none | ❌ | ✅ | — |
| revolt | none | ❌ | ✅ | — |
| shadow | none | ❌ | ❌ | — |
| slug | none | ❌ | ✅ | — |
| solved | none | ❌ | ✅ | — |
| splice | none | ❌ | ❌ | — |
| storm | none | ❌ | ✅ | — |
| support | none | ❌ | ✅ | — |
| surge | none | ❌ | ❌ | — |
| surveil | none | ❌ | ✅ | — |
| transform | none | ❌ | ✅ | — |
| tribute | none | ❌ | ❌ | — |
| undaunted | none | ❌ | ❌ | — |
| wither | none | ❌ | ❌ | — |

## Hardcoded Card Effects

| Card | Location | Line | Snippet |
|------|----------|------|---------|
| lightning bolt | spell-casting.ts | 347 | `if (spellName === "lightning bolt") {` |
| Plains | page.tsx | 139 | `landName === "Plains"` |
| Island | page.tsx | 141 | `: landName === "Island"` |
| Swamp | page.tsx | 143 | `: landName === "Swamp"` |
| Mountain | page.tsx | 145 | `: landName === "Mountain"` |
| Plains | page.tsx | 150 | `landName === "Plains"` |
| Island | page.tsx | 152 | `: landName === "Island"` |
| Swamp | page.tsx | 154 | `: landName === "Swamp"` |
| Mountain | page.tsx | 156 | `: landName === "Mountain"` |
| Lightning Bolt | page.tsx | 277 | `oracle_text: name === "Lightning Bolt"` |

## Forced Auto-Pass Priority Calls

These bypass the stack interaction model by forcing both players to pass priority without giving them a response window.

| Location | Line | Context |
|----------|------|---------|
| page.tsx | 1339 | `          newState = passPriority(newState, currentAIPlayer.id);` |
| page.tsx | 1368 | `                newState = passPriority(newState, currentAIPlayer.id);` |
| page.tsx | 1370 | `                newState = passPriority(newState, currentAIPlayer.id);` |
| page.tsx | 1373 | `              newState = passPriority(newState, currentAIPlayer.id);` |
| page.tsx | 1376 | `            newState = passPriority(newState, currentAIPlayer.id);` |
| page.tsx | 1413 | `                  newState = passPriority(newState, currentAIPlayer.id);` |
| page.tsx | 1415 | `                  newState = passPriority(newState, currentAIPlayer.id);` |
| page.tsx | 1418 | `                newState = passPriority(newState, currentAIPlayer.id);` |
| page.tsx | 1421 | `              newState = passPriority(newState, currentAIPlayer.id);` |
| page.tsx | 1424 | `            newState = passPriority(newState, currentAIPlayer.id);` |
| page.tsx | 1448 | `          newState = passPriority(newState, currentAIPlayer.id);` |
| page.tsx | 1454 | `          newState = passPriority(newState, currentAIPlayer.id);` |
| page.tsx | 2707 | `      newState = passPriority(newState, priorityPlayer.id);` |
| page.tsx | 2833 | `      newState = passPriority(newState, activeId);` |
| page.tsx | 2835 | `        newState = passPriority(newState, otherPlayer.id);` |
| page.tsx | 2968 | `      newState = passPriority(newState, currentPlayer.id);` |

## Manual Tap/Untap Calls

These bypass proper ability activation validation (summoning sickness, cost payment, etc.).

| Type | Location | Line | Context |
|------|----------|------|---------|
| tapCard | page.tsx | 2031 | `          const result = tapCard(gameState, cardId);` |
| tapCard | page.tsx | 2305 | `      const tapResult = tapCard(newState, shocklandChoice.cardId);` |
| tapCard | page.tsx | 2343 | `      const untapResult = untapCard(newState, shocklandChoice.cardId);` |
| untapCard | page.tsx | 2343 | `      const untapResult = untapCard(newState, shocklandChoice.cardId);` |

## TODO / FIXME / HACK / XXX Comments

*No TODO/FIXME/HACK/XXX comments found in game-state code.*

## Top Priority Gaps

Based on Standard relevance and gameplay impact:

1. **deathtouch** — Partial enforcement — function exists but not wired to gameplay
2. **defender** — Partial enforcement — function exists but not wired to gameplay
3. **flying** — Partial enforcement — function exists but not wired to gameplay
4. **hexproof** — Partial enforcement — function exists but not wired to gameplay
5. **hexproof from** — Partial enforcement — function exists but not wired to gameplay
6. **indestructible** — Partial enforcement — function exists but not wired to gameplay
7. **lifelink** — Partial enforcement — function exists but not wired to gameplay
8. **menace** — Partial enforcement — function exists but not wired to gameplay
9. **reach** — Partial enforcement — function exists but not wired to gameplay
10. **trample** — Partial enforcement — function exists but not wired to gameplay
11. **ward** — Partial enforcement — function exists but not wired to gameplay
12. **adventure** — No enforcement function exists
13. **affinity** — No enforcement function exists
14. **affinity for** — No enforcement function exists
15. **annihilator** — No enforcement function exists
16. **assemble** — No enforcement function exists
17. **assemble** — No enforcement function exists
18. **backup** — No enforcement function exists
19. **bargain** — No enforcement function exists
20. **bargain** — No enforcement function exists
21. **battle cry** — No enforcement function exists
22. **battle cry** — No enforcement function exists
23. **blitz** — No enforcement function exists
24. **bloodrush** — No enforcement function exists
25. **bloodrush** — No enforcement function exists
26. **bloodthirst** — No enforcement function exists
27. **cascade** — No enforcement function exists
28. **casualty** — No enforcement function exists
29. **celebration** — No enforcement function exists
30. **celebration** — No enforcement function exists
31. **chroma** — No enforcement function exists

## Recommendations

### Immediate (This Session)
1. Fix auto-pass priority (#618) — 16 locations bypass stack interaction
2. Add mechanic stubs (#628) — 178 Standard mechanics detected but not enforced
3. Fix mana pool emptying (#619) — missing automatic phase transition cleanup

### Short Term (Next 2–3 Sessions)
4. Enforce hexproof & menace (#620) — partial enforcement exists but not wired to gameplay
5. Fix shockland life payment (#621) — uses damage instead of life loss
6. Implement untap step (#624) — structural phase with no engine logic

### Medium Term (Next 4–6 Sessions)
7. First strike / double strike combat (#626) — single damage step is wrong
8. Trample + blocker ordering (#627) — no player choice in damage assignment
9. Standard mechanic E2E tests (#623) — verify actual gameplay, not just card presence
