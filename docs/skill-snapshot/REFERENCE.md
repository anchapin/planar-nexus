# Reference — GitHub Wave Orchestrator

## Resume and Recovery

If a wave run is interrupted (Ctrl+C, network loss, CI timeout), the orchestrator state is persisted to the namespaced state file (`../worktrees/wave-state.<repo-slug>.json`). To resume:

1. Verify the state file belongs to this repo:

   ```bash
   source scripts/wave-state-helpers.sh
   STATE_FILE=$(get_state_file)
   check_state_collision "$STATE_FILE"
   ```

2. Re-run with the same `--state-file` path (or default path):

   ```bash
   node ~/.agents/skills/github-wave-orchestrator/index.mjs --state-file "$STATE_FILE"
   ```

3. The orchestrator will skip completed waves and resume from the first incomplete wave.

**Stale state detection:** If the state file was written by a different repo (detected via `repoSlug` mismatch), the orchestrator refuses to overwrite it. Archive the stale file and start fresh:

```bash
mv ../worktrees/wave-state.<repo-slug>.json ../worktrees/wave-state.<repo-slug>.stale.json
```

**Forced resume:** Use `--force` to bypass the collision check when you intentionally want to restart from a known state.

## Merge Ordering Strategy

Merge PRs in ascending issue-number order within a wave to minimize conflict surface. After each merge, check remaining PRs for conflicts.

## Implementation Sub-agent Template

When spawning an implementation sub-agent for a single issue, use this prompt template:

```
## Task: Implement GitHub Issue #<ISSUE_NUMBER>

### Issue Title
<ISSUE_TITLE>

### Issue Body
<ISSUE_BODY>

### Acceptance Criteria
- The fix resolves the issue described above
- All existing tests pass (`npm run test`)
- TypeScript compiles without errors (`npm run typecheck`)
- No new lint warnings introduced

### Implementation Guidelines
- Follow the codebase conventions (see CONTRIBUTING.md)
- Write tests for any new behavior
- Keep changes focused and minimal — only what's needed to fix the issue

### Deliverables
1. Implementation in the appropriate source files
2. Tests covering the fix
3. A single commit with message: `fix: resolve #<ISSUE_NUMBER> — <short description>`

### Notes
- Work in the assigned worktree: `<WORKTREE_PATH>`
- Branch name: `<BRANCH_NAME>`
- When complete, push the branch and open a PR referencing the issue
```
