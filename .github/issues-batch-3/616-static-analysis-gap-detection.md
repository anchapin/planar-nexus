# Build Static Analysis & Gap Detection Tool

**Priority:** 🟠 HIGH  
**Labels:** `high`, `tooling`, `gameplay`, `engine`  
**Milestone:** v0.2.0 Game Rules  
**Estimated Effort:** 1–2 days  

---

## Description

The engine detects 80+ keywords via `oracle-text-parser.ts` but only enforces ~10 of them. We need an automated tool to find every gap between "detected" and "enforced" so we can fix them systematically.

This is a **foundational issue** — the output of this tool will drive prioritization for all other gameplay bug fixes.

---

## Affected Files

- `src/lib/game-state/oracle-text-parser.ts`
- `src/lib/game-state/evergreen-keywords.ts`
- `src/lib/game-state/keyword-actions.ts`
- `src/lib/game-state/combat.ts`
- `src/lib/game-state/spell-casting.ts`
- `src/app/(app)/game/[id]/page.tsx`

---

## Required Tool: `scripts/analyze-gameplay-gaps.ts`

### Feature 1: Keyword Gap Analysis

Scan `oracle-text-parser.ts` for all detected keywords. For each keyword, check:
1. Does `evergreen-keywords.ts` have an enforcement function?
2. Is that function a stub/no-op?
3. Is there a unit test for the enforcement?

**Output format:**
```
Keyword: menace
  Detected: ✅
  Enforced: ⚠️ partial (getMenaceMinimumBlockers exists, no declareBlockers enforcement)
  Tested: ❌ no unit test
  Severity: High

Keyword: cycling
  Detected: ✅
  Enforced: ❌ none
  Tested: ❌ no unit test
  Severity: High
```

### Feature 2: Hardcoded Card Detection

Scan `spell-casting.ts`, `combat.ts`, and `page.tsx` for hardcoded card names:
```typescript
// Bad patterns to detect:
if (card.name === "Lightning Bolt") { ... }
switch (cardName) {
  case "Goblin Guide": ...
}
```

Each hardcoded card = a missing generic system.

### Feature 3: Manual Override Detection

Scan `page.tsx` for:
- Auto `passPriority` calls (bypass stack interaction)
- Manual `tapCard`/`untapCard` calls outside ability resolution
- Direct state mutations that bypass engine validation

### Feature 4: TODO/FIXME Comment Map

Extract all TODO/FIXME/HACK/XXX comments from `src/lib/game-state/` and map them to files/lines.

---

## Acceptance Criteria

- [ ] Script runs with `npx tsx scripts/analyze-gameplay-gaps.ts`
- [ ] Outputs `reports/gameplay-gap-analysis.md` with all findings
- [ ] Keyword gap table covers all detected keywords
- [ ] Hardcoded card list is complete
- [ ] Manual override list is complete
- [ ] Script exits with non-zero code if critical gaps found (for CI)
- [ ] Script is idempotent (re-runnable)

---

## Output Format

The report should be a Markdown file with these sections:

```markdown
# Gameplay Gap Analysis

## Summary
- Total keywords detected: 85
- Keywords fully enforced: 12
- Keywords partially enforced: 8
- Keywords not enforced: 65
- Hardcoded card effects: 7
- Manual UI overrides: 12
- TODO/FIXME comments: 34

## Keyword Gaps (High Severity)
| Keyword | Detected | Enforced | Tested | Location |
|---------|----------|----------|--------|----------|
| menace | ✅ | ⚠️ partial | ❌ | combat.ts:245 |
| hexproof | ✅ | ❌ | ❌ | — |
| cycling | ✅ | ❌ | ❌ | — |

## Hardcoded Cards
| Card | Effect | Location |
|------|--------|----------|
| Lightning Bolt | 3 damage | spell-casting.ts:89 |

## Manual Overrides
| Description | Location | Risk |
|-------------|----------|------|
| Auto-passes priority after cast | page.tsx:1617 | Critical |
```

---

## Related Issues

- #617 (Oracle text audit)
- #620 (Hexproof & Menace enforcement)
- #618 (Priority system fix)
