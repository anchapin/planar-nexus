# Quick Start Guide: Parallel Implementation Skill

## 5-Minute Tutorial

### Step 1: Discover Issues

```bash
# See what issues would be selected
python3 .claude/skills/parallel-implementation/scripts/parallel_impl.py --dry-run
```

### Step 2: Execute

```bash
# Create worktrees for top 5 issues
python3 .claude/skills/parallel-implementation/scripts/parallel_impl.py --max-parallel 5
```

### Step 3: Work in Parallel

```bash
# For each worktree:
cd ../issue-123-feature-description

# Implement the issue
# Run tests
# Commit changes
git add .
git commit -m "Fix #123: Feature description"
```

### Step 4: Create PRs

```bash
# Push and create PR
git push -u origin issue-123-feature-description
gh pr create \
  --title "Fix #123: Feature description" \
  --body "Closes #123" \
  --base main

# Cleanup
cd ../planar-nexus
git worktree remove ../issue-123-feature-description
```

## Common Commands

### Basic
```bash
# Top 5 issues
/parallel-implementation

# Top 3 issues
python3 .claude/skills/parallel-implementation/scripts/parallel_impl.py --max-parallel 3
```

### Filtered
```bash
# Only critical issues
/parallel-implementation --priority critical

# Specific label
/parallel-implementation --label bug
```

### Safe Mode
```bash
# Preview without changes
/parallel-implementation --dry-run

# Interactive confirmation
/parallel-implementation --interactive
```

## Typical Workflow

1. **Morning**: Run dry-run to see what issues are available
2. **Start**: Create worktrees for selected issues
3. **Work**: Implement issues in parallel worktrees
4. **Mid-day**: Push and create PRs as they complete
5. **End**: Remove worktrees and review PRs

## Tips

- Start with `--max-parallel 2` for your first run
- Use `--dry-run` to preview before committing
- Check `gh issue list` to verify issues exist first
- Worktrees are in parent directory (`../issue-*`)
- PRs auto-link to issues using `Closes #N` format

## Getting Help

```bash
# Show all options
python3 .claude/skills/parallel-implementation/scripts/parallel_impl.py --help

# View skill documentation
cat .claude/skills/parallel-implementation/SKILL.md

# View detailed README
cat .claude/skills/parallel-implementation/README.md
```
