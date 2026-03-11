# Parallel Implementation Skill

Automatically implements top 3-5 priority GitHub issues in parallel using git worktrees and subagents, then creates PRs for each.

## Overview

This skill streamlines the process of tackling multiple GitHub issues simultaneously by:
1. Discovering and prioritizing open issues
2. Creating separate git worktrees for each issue
3. Spawning dedicated subagents to work in parallel
4. Monitoring progress and creating PRs automatically

## Quick Start

### Using the Skill Directly

```
/parallel-implementation
```

### Using the Python Script

```bash
python3 .claude/skills/parallel-implementation/scripts/parallel_impl.py
```

### Using the Automation Script

```bash
bash .claude/skills/parallel-implementation/scripts/automate.sh
```

## Features

- **Smart Issue Prioritization**: Scores issues based on priority labels, age, and engagement
- **Git Worktree Isolation**: Each issue gets its own isolated worktree
- **Parallel Execution**: Multiple subagents work simultaneously
- **Automated PR Creation**: Creates PRs linked to issues automatically
- **Progress Monitoring**: Real-time status updates for each issue
- **Safety Features**: Dry-run mode, interactive confirmation, rollback capability

## Usage Examples

### Basic Usage

Implement top 5 priority issues:
```bash
/parallel-implementation
```

### Filter by Priority

Only high-priority issues:
```bash
/parallel-implementation --priority high
```

### Custom Parallel Limit

Work on 3 issues at a time:
```bash
/parallel-implementation --max-parallel 3
```

### Dry Run Preview

See what would be done without executing:
```bash
/parallel-implementation --dry-run
```

### Interactive Mode

Ask for confirmation before executing:
```bash
/parallel-implementation --interactive
```

### Custom Branch Naming

Use custom branch name format:
```bash
/parallel-implementation --branch-name-format "feat/{number}-{slug}"
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--max-parallel N` | Maximum number of parallel worktrees | 5 |
| `--priority P` | Filter by priority label | None |
| `--label L` | Filter by specific label | None |
| `--dry-run` | Preview actions without executing | False |
| `--no-push` | Skip pushing branches to remote | False |
| `--no-pr` | Skip creating PRs | False |
| `--branch-name-format` | Custom branch name format | `issue-{number}-{slug}` |
| `--interactive` | Ask for confirmation | False |

## How It Works

### Phase 1: Issue Discovery

The script uses `gh issue list` to fetch open issues and scores them based on:

- **Priority Labels** (100-25 points): critical, high, medium, low
- **Age** (up to 10 points): Older issues get higher scores
- **Engagement** (up to 5 points): More comments = higher priority
- **Assignment** (+5 points): Assigned issues get a bonus

Issues with exclusion labels (question, duplicate, wontfix) are automatically filtered out.

### Phase 2: Worktree Setup

For each selected issue:

```bash
git worktree add ../issue-123-feature-description -b issue-123-feature-description
```

Worktrees are created in the parent directory to avoid conflicts:
- `../issue-123-feature-description`
- `../issue-456-bug-fix`
- etc.

### Phase 3: Parallel Execution

The skill generates commands to spawn subagents for each worktree:

```bash
# For each worktree
cd ../issue-123-feature-description
# Implement the issue
```

### Phase 4: PR Creation

When implementation is complete:

```bash
cd ../issue-123-feature-description
git push -u origin issue-123-feature-description
gh pr create \
  --title "Fix #123: Issue Title" \
  --body "Closes #123" \
  --base main \
  --label "auto-generated"
git worktree remove ../issue-123-feature-description
```

## Output Example

```
================================================================================
PARALLEL IMPLEMENTATION: EXECUTION PLAN
================================================================================

🔍 Discovering issues...

✅ Found 5 issues to implement:

1. Issue #123: Feature X
   Priority: critical
   Branch: issue-123-feature-x
   Worktree: ../issue-123-feature-x
   Score: 115

2. Issue #456: Bug Y
   Priority: high
   Branch: issue-456-bug-y
   Worktree: ../issue-456-bug-y
   Score: 82

...

================================================================================
SUMMARY
================================================================================

Issues selected: 5
Worktrees created: 5

Next steps:
1. Implement each issue in its worktree
2. Run tests and ensure quality
3. Commit changes in each worktree
4. Push branches and create PRs
5. Remove worktrees after PR creation
```

## Best Practices

1. **Start Small**: Use `--dry-run` or `--max-parallel 2` for your first run
2. **Filter by Priority**: Use `--priority high` to focus on critical issues
3. **Review Issues**: Ensure selected issues are well-defined and implementable
4. **Monitor Progress**: Check subagent output regularly
5. **Clean Up**: Worktrees are removed automatically after PR creation

## Troubleshooting

### Worktree Already Exists

```bash
# Remove existing worktree
git worktree remove ../issue-123-feature-x

# Re-run the skill
```

### Branch Already Exists

```bash
# Delete existing branch
git branch -D issue-123-feature-x

# Re-run the skill
```

### Failed PR Creation

```bash
# Push manually
cd ../issue-123-feature-x
git push -u origin issue-123-feature-x

# Create PR manually
gh pr create --title "..." --body "..."

# Remove worktree
git worktree remove ../issue-123-feature-x
```

## Requirements

- GitHub CLI (`gh`) installed and authenticated
- Git 2.5+ (for worktree support)
- Write access to the repository
- Python 3.6+ (for the script)

## Integration with Other Skills

This skill works well with:
- **pr-automation**: For reviewing and merging created PRs
- **parallel-issues**: For advanced issue planning and analysis
- **simplify**: For code quality review before PR creation

## License

Part of the Planar Nexus project.
