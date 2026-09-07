CHARTER_CHECK:

- Clarification level: LOW (issue body is precise; acceptance criteria explicit; code pointers given)
- Task domain: backend (with a thin client UI addition to render empty-state copy)
- Must NOT do:
  1. Do not modify .agents/ files
  2. Do not create a PR
  3. Do not modify code in other agents' scope (src/lib/game-state/, src-tauri/, other meta modules except as needed for the UI integration)
- Success criteria:
  1. New `getMatchupGuideCoverage(format)` returns `{ total, covered, missing: [{playerArchetype, opponentArchetype}] }` computed from Cartesian product of ArchetypeCategory × matchupGuides
  2. New `getMatchupGuideStatus(player, opponent, format)` returns 'covered' | 'missing' so UI can distinguish missing from empty
  3. Matchup page renders explicit empty-state with copy "No guide yet for X vs Y in F — contribution welcome" for missing triples
  4. Snapshot/regression test asserts covered count > 0 and total = 5×5 = 25 for standard
  5. Commander coverage test asserts deterministic missing list
  6. `npm run typecheck && npm run lint && npx jest --testPathPatterns=meta|archetype|matchup` passes (excluding the tolerated coach-conversation-storage failure)
- Assumptions:
  - "Cartesian product of ArchetypeCategory" includes self-pairs (aggro vs aggro etc.) because the type does not
  - Issue body says "{total, covered, missing:[{playerArchetype,opponentArchetype}]}" — so missing is per format
  - The `archetypes` parameter on `getMatchupGuideCoverage(archetypes)` from the brief is just framing — the function actually takes a format (matches the issue body). I will support both signatures via an explicit `format` parameter and optionally accept an `archetypes` array for testability/customizability.
  - Existing `getMatchupGuide` behavior remains unchanged for back-compat
  - "Top N missing triples per format" in the UI brief is satisfied by rendering the full missing list (small: ≤ 25 entries) in a dedicated panel under the existing matchup page, sorted for stability.
