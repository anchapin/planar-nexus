---
name: pr-automation
description: Automated PR review, fixing, CI monitoring, and merging with hybrid batch/individual strategy
disable-model-invocation: false
argument-hint: "[--max-parallel N] [--dry-run] [--interactive] [--pr-filter LABEL] [--ci-timeout DURATION] [--confirm-merges] [--no-auto-merge] [--require-approval]"
allowed-tools: Bash(gh *), Bash(git *), Skill(simplify), Task, TaskCreate, TaskUpdate, TaskList, TaskGet, Read, Write, Edit, Glob, Grep
---

# PR Automation Skill

Automates the process of reviewing, fixing, CI monitoring, and merging pull requests in the Planar Nexus repository.

## Features

- **Hybrid Strategy**: Attempts batch PR first for efficiency, falls back to individual processing
- **Automated Review**: Uses simplify skill + custom PR-specific checks
- **CI Monitoring**: Tracks lint, typecheck, and build job completion
- **Merge Conflict Handling**: Intelligent conflict detection and resolution
- **Squash Merges**: Clean history with single commits per PR
- **Safety Features**: Dry-run mode, confirmation prompts, rollback capability

## Usage

### Basic Usage
Process all open PRs:
```bash
/pr-automation
```

### With Options
```bash
/pr-automation --max-parallel 5 --dry-run --interactive
```

### PR Filtering
```bash
/pr-automation --pr-filter "ready-for-merge" --max-age 7d
```

### CI Configuration
```bash
/pr-automation --ci-timeout 45m --ci-poll-interval 1m
```

### Safety Mode
```bash
/pr-automation --confirm-merges --no-auto-merge --require-approval
```

## Options

### PR Selection
- `--pr-filter LABEL`: Only process PRs with specific labels
- `--max-age DURATION`: Maximum age of PRs to process (e.g., 7d, 24h)
- `--min-age DURATION`: Minimum age of PRs to process
- `--exclude-prs NUM1,NUM2`: Comma-separated PR numbers to exclude

### Processing Strategy
- `--max-parallel N`: Maximum number of PRs to process in parallel (default: 3)
- `--batch-size N`: Number of PRs per batch when splitting (default: 10)
- `--no-batch`: Skip batch processing, go directly to individual processing
- `--fallback-threshold N`: Number of batch failures before falling back (default: 3)

### Review Options
- `--no-review`: Skip code review step
- `--no-simplify`: Skip simplify skill, use only custom checks
- `--review-depth LEVEL`: Review depth (basic, standard, thorough)

### CI Configuration
- `--ci-timeout DURATION`: Maximum time to wait for CI (default: 30m)
- `--ci-poll-interval DURATION`: Polling interval for CI status (default: 30s)
- `--required-jobs JOBS`: Comma-separated CI job names to monitor (default: lint,typecheck,build)

### Merge Options
- `--no-auto-merge`: Don't auto-merge, only prepare PRs
- `--confirm-merges`: Require confirmation before each merge
- `--merge-method METHOD`: Merge method (squash, merge, rebase - default: squash)
- `--require-approval`: Require PR approval before merging

### Automation and Safety
- `--dry-run`: Simulate operations without making changes
- `--interactive`: Interactive mode with prompts
- `--verbose`: Verbose output
- `--no-rollback`: Disable rollback capability
- `--force`: Force operations despite warnings

## Workflow

### 1. Discovery
- Finds all open PRs using `gh pr list`
- Filters based on options (labels, age, etc.)
- Sorts PRs by priority/age

### 2. Pre-flight Checks
- Verifies repository access and permissions
- Checks main branch cleanliness
- Validates CI workflow availability

### 3. Hybrid Strategy
- **Batch PR Attempt**: Creates single batch PR with all changes
  - Creates temporary batch branch
  - Cherry-picks commits from all PRs
  - Creates batch PR
  - Runs review and fixes
  - Monitors CI checks
  - If successful → merges all source PRs
  - If failed → falls back to individual processing

- **Individual Processing** (fallback)
  - For each PR:
    - Runs code review (simplify + custom checks)
    - Applies automated fixes
    - Pushes fixes and updates PR
    - Monitors CI checks
    - Handles merge conflicts
    - Squash merges if all checks pass

### 4. Cleanup
- Removes temporary branches
- Cleans up worktrees
- Generates summary report

## CI Monitoring

Monitors the following jobs from `.github/workflows/ci.yml`:
- `lint`: ESLint code quality checks
- `typecheck`: TypeScript type checking
- `build`: Next.js build verification

Polls for completion with configurable intervals and timeouts.

## Merge Conflict Handling

Uses `git merge --no-commit --no-ff` to simulate merges and detect conflicts:
- **Low severity**: Attempts automatic resolution using heuristics
- **Medium severity**: Splits batch PR into smaller batches
- **High severity**: Falls back to individual PR processing

## Integration

### Simplify Skill
Uses the existing `/simplify` skill for code quality review:
- Analyzes code for reuse, quality, and efficiency
- Fixes any issues found
- Reports changes made

### GitHub CLI
Leverages `gh` command for all GitHub operations:
- PR discovery and management
- Workflow status monitoring
- Merge operations

## Error Handling

Implements four levels of error recovery:
1. **Level 1**: Retry the operation
2. **Level 2**: Try alternative approach (e.g., batch → individual)
3. **Level 3**: Skip problematic item and continue
4. **Level 4**: Abort with detailed error report

## Safety Features

- **Dry-run mode**: Simulates operations without making changes
- **Confirmation prompts**: Requires user confirmation for destructive operations
- **Pre-flight checks**: Validates environment before starting
- **Rollback capability**: Ability to undo changes
- **Detailed logging**: Tracks all operations for audit

## Output

The skill provides:
- Real-time progress updates
- Detailed logs of all operations
- Summary report with statistics
- Error details if failures occur
- Recommendations for failed PRs

## Examples

### Quick Test (Dry Run)
```bash
/pr-automation --dry-run --verbose
```

### Process PRs with "automerge" label
```bash
/pr-automation --pr-filter "automerge" --confirm-merges
```

### Full automation with safety
```bash
/pr-automation --interactive --require-approval --ci-timeout 45m
```

### Batch processing only
```bash
/pr-automation --max-parallel 5 --batch-size 8 --verbose
```

## Troubleshooting

### CI Timeout
Increase CI timeout if checks take longer than expected:
```bash
/pr-automation --ci-timeout 60m
```

### Merge Conflicts
If conflicts persist, use individual processing:
```bash
/pr-automation --no-batch --verbose
```

### Review Failures
Skip simplify skill if it's causing issues:
```bash
/pr-automation --no-simplify
```

### Permission Issues
Ensure you have proper GitHub permissions and gh CLI is authenticated.