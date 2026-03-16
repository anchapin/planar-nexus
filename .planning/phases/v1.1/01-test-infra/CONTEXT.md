# Context: Phase 1 - Test Infrastructure

**Phase:** 01-test-infra  
**Milestone:** v1.1 - Polish & Stability Pass  
**Goal:** Fix test infrastructure issues that block reliable CI/CD

---

## Locked Decisions

_(None - all decisions open to AI discretion)_

---

## Claude's Discretion

All technical decisions are open:

- **Execution Approach**: May run all 3 plans in parallel or sequentially based on dependencies discovered
- **Implementation Details**: Full discretion on how to fix:
  - Jest test data seeding
  - Serialization timestamp flakiness
  - Jest JSX configuration for .tsx files
- **Testing Strategy**: How to verify fixes work correctly
- **Code Patterns**: Follow existing codebase patterns where applicable

---

## Technical Notes

### Plans in This Phase

| # | Title | Priority | Description |
|---|-------|----------|-------------|
| 1.1 | Jest Test Data Seeding | Medium | Seed test data in jest.setup.js for card database tests |
| 1.2 | Fix Serialization Timestamp | Medium | Fix timestamp comparison flakiness in serialization tests |
| 1.3 | Jest JSX Configuration | Low | Fix Jest configuration for .tsx file parsing |

### Phase Dependencies

- None - all plans can run independently

### Estimated Duration

3-4 hours

---

**Created:** 2026-03-16  
**Status:** Ready for planning
