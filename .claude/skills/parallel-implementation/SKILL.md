---
name: parallel-implementation
description: Implements top 3-5 priority GitHub issues in parallel using git worktrees and separate subagents, then creates PRs for each. Use when you want to tackle multiple issues simultaneously.
disable-model-invocation: true
argument-hint: "[--max-parallel N] [--priority P] [--label L] [--dry-run] [--no-push] [--no-pr]"
allowed-tools: Bash(gh *), Bash(git *), Subagent, Task, TaskWrite, TaskCheck, AskUser, Read, Write, View, FindFiles, SearchContent, StringReplaceLsp, ExecuteCommand, SubmitPlan
---

# Parallel Implementation Skill

Implements the top 3-5 priority GitHub issues in parallel by creating separate git worktrees for each issue, spawning dedicated subagents to work on them simultaneously, and creating PRs for each completed implementation.

## Quick Start

```bash
/parallel-implementation
```

This will:
1. Identify the top 3-5 priority issues
2. Create git worktrees for each issue
3. Spawn subagents to implement each issue in parallel
4. Monitor progress and create PRs as they complete

## Options

- `--max-parallel N`: Maximum number of issues to work in parallel (default: 5)
- `--priority P`: Filter by priority label (e.g., critical, high, medium, low)
- `--label L`: Filter by specific label
- `--dry-run`: Show what would be done without actually creating worktrees
- `--no-push`: Skip pushing branches to remote
- `--no-pr`: Skip creating PRs
- `--branch-name-format FORMAT`: Custom branch name format (default: `issue-{number}-{slug}`)

## How It Works

### Phase 1: Issue Discovery

1. Uses `gh issue list` to fetch open issues
2. Prioritizes issues based on:
   - Priority labels (critical > high > medium > low)
   - Creation date (older issues first)
   - Comment count (more discussion = higher priority)
3. Filters for implementable issues (excludes questions, duplicates, etc.)
4. Selects top 3-5 issues based on priority score

### Phase 2: Worktree Setup

For each selected issue:

```bash
# Create a feature branch
git checkout -b issue-{number}-{slug}

# Create a worktree in a sibling directory
git worktree add ../issue-{number}-{slug} -b issue-{number}-{slug}
```

Worktrees are created in the parent directory to avoid conflicts:
- `../issue-123-feature-description`
- `../issue-456-bug-fix`
- etc.

### Phase 3: Parallel Execution

Spawns separate subagents for each worktree:

```
Subagent 1: ../issue-123-feature-description
Subagent 2: ../issue-456-bug-fix
Subagent 3: ../issue-789-performance
```

Each subagent:
- Analyzes the issue requirements
- Implements the solution
- Runs tests and linting
- Ensures code quality

### Phase 4: PR Creation

When a subagent completes successfully:

```bash
# Navigate to worktree
cd ../issue-123-feature-description

# Push branch to remote
git push -u origin issue-123-feature-description

# Create PR linked to issue
gh pr create \
  --title "Fix #123: Issue Title" \
  --body "Closes #123" \
  --base main \
  --label "auto-generated"
```

### Phase 5: Cleanup

After PR creation:
- Removes the worktree to free up space
- Switches back to original branch
- Updates the main worktree to stay in sync

## Issue Prioritization

Issues are scored using a priority matrix:

- **Priority Label**: 100 (critical), 75 (high), 50 (medium), 25 (low)
- **Age**: Up to 10 points (older = higher)
- **Comments**: Up to 5 points (more discussion = higher)
- **Assignee**: +5 points if assigned

**Excluded issues:**
- Issues with "question", "duplicate", or "wontfix" labels
- Issues without a clear implementation path
- Issues requiring coordination with other issues

## Parallel Execution Strategy

The skill ensures parallel workability by:

1. **File Isolation**: Each subagent works in a separate worktree with its own working directory
2. **Branch Isolation**: Each issue gets its own git branch
3. **Conflict Prevention**: Issues that modify the same files are not selected for parallel execution
4. **Independent Execution**: Subagents run completely independently

## Subagent Capabilities

Each subagent has access to:
- All file operations (read, write, edit)
- Search and code analysis
- Test execution
- Git operations within their worktree
- Ability to spawn additional subagents if needed

Subagents are configured with:
- Clear issue context (title, description, labels, comments)
- Repository conventions and patterns
- Quality standards (lint, test, typecheck)

## Monitoring and Progress

The skill monitors:
- Subagent status (running, completed, failed)
- File changes in each worktree
- Test results
- Git status (committed changes, uncommitted changes)

Progress is reported in real-time:
```
[1/5] Issue #123: Feature X
  Status: In Progress
  Subagent: Running
  Files modified: 5
  Last activity: 2m ago

[2/5] Issue #456: Bug Y
  Status: Completed
  Subagent: Finished
  PR created: https://github.com/user/repo/pull/123
```

## Error Handling

If a subagent fails:
1. Logs the error with context
2. Offers to retry with different approach
3. Continues with other subagents
4. Collects failed issues for manual review

## Safety Features

- **Dry Run Mode**: Preview actions without executing
- **Interactive Confirmation**: Confirm before creating worktrees
- **Backup Check**: Ensures main branch is clean
- **Worktree Cleanup**: Automatic cleanup of completed worktrees
- **Rollback**: Ability to delete branches and worktrees if needed

## Example Usage

### Basic Implementation

```bash
# Implement top 5 priority issues
/parallel-implementation
```

### With Filtering

```bash
# Only high-priority issues, max 3 in parallel
/parallel-implementation --priority high --max-parallel 3
```

### Dry Run

```bash
# Preview what would be done
/parallel-implementation --dry-run
```

### Custom Branch Naming

```bash
# Custom branch name format
/parallel-implementation --branch-name-format "feat/{number}-{slug}"
```

## Output Format

The skill provides structured output:

```
================================================================================
PARALLEL IMPLEMENTATION: EXECUTION PLAN
================================================================================

Selected Issues (3 total):

1. Issue #123: Feature X
   Priority: critical
   Branch: issue-123-feature-x
   Worktree: ../issue-123-feature-x
   Estimated effort: 2-3 hours

2. Issue #456: Bug Y
   Priority: high
   Branch: issue-456-bug-y
   Worktree: ../issue-456-bug-y
   Estimated effort: 1-2 hours

3. Issue #789: Performance Z
   Priority: medium
   Branch: issue-789-performance-z
   Worktree: ../issue-789-performance-z
   Estimated effort: 3-4 hours

────────────────────────────────────────────────────────────────────────────────
EXECUTING PHASE 1: Creating Worktrees...
────────────────────────────────────────────────────────────────────────────────

Created worktree: ../issue-123-feature-x
Created worktree: ../issue-456-bug-y
Created worktree: ../issue-789-performance-z

────────────────────────────────────────────────────────────────────────────────
EXECUTING PHASE 2: Spawning Subagents...
────────────────────────────────────────────────────────────────────────────────

Spawned subagent for Issue #123 (PID: 12345)
Spawned subagent for Issue #456 (PID: 12346)
Spawned subagent for Issue #789 (PID: 12347)

────────────────────────────────────────────────────────────────────────────────
EXECUTING PHASE 3: Monitoring Progress...
────────────────────────────────────────────────────────────────────────────────

[1/3] Issue #123: Feature X
  Status: ✅ Completed
  PR: https://github.com/user/repo/pull/456
  Worktree removed: ../issue-123-feature-x

[2/3] Issue #456: Bug Y
  Status: ✅ Completed
  PR: https://github.com/user/repo/pull/457
  Worktree removed: ../issue-456-bug-y

[3/3] Issue #789: Performance Z
  Status: ⏳ In Progress
  Subagent: Running (45m elapsed)
  Files modified: 12

================================================================================
SUMMARY
================================================================================

Completed: 2/3
In Progress: 1/3
Failed: 0/3

PRs Created:
- #456: Fix #123 - Feature X
- #457: Fix #456 - Bug Y

Next Steps:
- Wait for Issue #789 completion
- Review and merge completed PRs
```

## Integration with Other Skills

This skill works well with:
- **pr-automation**: For reviewing and merging the created PRs
- **parallel-issues**: For more advanced issue planning and analysis
- **simplify**: For code quality review before PR creation

## Troubleshooting

### Worktree Already Exists

If a worktree with the same path exists:
```bash
# Remove existing worktree
git worktree remove ../issue-123-feature-x

# Re-run the skill
```

### Subagent Fails

If a subagent fails:
1. Check the worktree manually: `cd ../issue-123-feature-x`
2. Review the error logs
3. Run `/parallel-implementation` again to retry
4. The skill will skip completed issues

### PR Creation Fails

If PR creation fails:
1. Push the branch manually: `cd ../issue-123-feature-x && git push`
2. Create PR manually: `gh pr create --title "..." --body "..."`
3. Remove worktree: `git worktree remove ../issue-123-feature-x`

## Best Practices

1. **Start Small**: Use `--max-parallel 2` or `--dry-run` first
2. **Filter by Priority**: Use `--priority high` for critical issues only
3. **Review Issues**: Ensure selected issues are well-defined and implementable
4. **Monitor Progress**: Watch the real-time output to catch issues early
5. **Clean Up**: Worktrees are removed automatically after PR creation

## Requirements

- GitHub CLI (`gh`) installed and authenticated
- Git worktrees supported (Git 2.5+)
- Write access to the repository
- At least 3-5 issues available to implement
