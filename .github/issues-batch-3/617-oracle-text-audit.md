# Oracle Text Audit: Standard Card Implementation Matrix

**Priority:** 🟠 HIGH  
**Labels:** `high`, `tooling`, `standard`, `data`  
**Milestone:** v0.2.0 Game Rules  
**Estimated Effort:** 1–2 days  

---

## Description

We need to know which Standard-legal cards are actually playable vs. "cosmetic only" (visible but mechanics don't work). This issue builds an audit tool that maps every Standard card to its implementation status.

---

## Affected Files

- `src/lib/game-state/oracle-text-parser.ts`
- `e2e/fixtures/test-cards.json`
- Database/card collection (source of truth for Standard cards)
- New file: `scripts/audit-standard-cards.ts`

---

## Required Tool: `scripts/audit-standard-cards.ts`

### Step 1: Ingest Standard Cards

Query the card database for all cards where:
- `legalities.standard = "legal"`
- Not banned in Standard

### Step 2: Parse Oracle Text

For each card, call the existing `parseCardText` function to detect keywords.

### Step 3: Check Implementation Status

For each detected keyword on each card:
1. Does the engine have an enforcement function?
2. Does the engine have a test for that enforcement?
3. Does an E2E test use this card?

### Step 4: Output Matrix

Generate `reports/standard-card-implementation-matrix.csv` with columns:

| Column | Description |
|--------|-------------|
| `card_name` | Card name |
| `oracle_text` | Full oracle text |
| `detected_keywords` | Comma-separated list |
| `has_enforcement` | `full` / `partial` / `none` |
| `has_unit_test` | `yes` / `no` |
| `has_e2e_test` | `yes` / `no` |
| `gap_severity` | `critical` / `high` / `medium` / `low` |
| `notes` | Freeform notes |

**Severity rules:**
- `critical`: Core mechanic (combat, mana, targeting) with no enforcement
- `high`: Frequently played Standard mechanic with no enforcement
- `medium`: Niche mechanic with no enforcement
- `low`: Cosmetic or rarely relevant mechanic

---

## Acceptance Criteria

- [ ] Script runs with `npx tsx scripts/audit-standard-cards.ts`
- [ ] Outputs CSV with all Standard-legal cards
- [ ] Each card has complete implementation status
- [ ] Summary statistics at top of report
- [ ] Script can be filtered by keyword (e.g., `--keyword ward`)
- [ ] Report includes top 20 cards with `gap_severity = critical`

---

## Example Output

```csv
# Standard Card Implementation Matrix
# Generated: 2026-04-25
# Total Standard cards: 1,847
# Fully implemented: 23 (1.2%)
# Partially implemented: 89 (4.8%)
# Not implemented: 1,735 (94.0%)

card_name,oracle_text,detected_keywords,has_enforcement,has_unit_test,has_e2e_test,gap_severity,notes
Overgrown Tomb,"As ... enters ... pay 2 life ...",shockland,full,yes,no,low,Recently fixed
Ward Beetle,"Ward {2}...",ward,partial,yes,yes,medium,Cost parsed but not enforced
Cycling Drake,"Cycling {2}...",cycling,none,no,yes,high,No gameplay effect
Lightning Bolt,"...3 damage...",direct_damage,full,yes,yes,low,Hardcoded but works
```

---

## Related Issues

- #616 (Static analysis gap detection)
- #623 (Standard mechanic E2E tests)
- #628 (Standard mechanic stubs)
