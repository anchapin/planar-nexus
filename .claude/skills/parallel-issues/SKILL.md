---
name: parallel-issues
description: Analyzes open GitHub issues, prioritizes them by roadmap impact, determines parallel workability with git worktrees, and creates a plan to work on multiple issues simultaneously using sub-agents. Use when planning parallel development work.
disable-model-invocation: true
argument-hint: [--max-parallel N] [--phase N] [--priority P]
allowed-tools: Bash(gh *), Bash(git *), Bash(python3 *), Task, TaskCreate, TaskUpdate, TaskList, TaskGet, Read, Write, Edit, Glob, Grep
---

# Parallel Issues Planner

Analyzes all open GitHub issues for the repository, prioritizes them based on roadmap goals, and creates an execution plan for parallel development using git worktrees and sub-agents.

## Quick Start

```bash
# Run the planner script
python3 .claude/skills/parallel-issues/scripts/parallel_planner.py [OPTIONS]
```

**Options:**
- `--max-parallel N`: Maximum number of parallel worktrees (default: 4)
- `--phase N`: Filter by roadmap phase (1-5)
- `--priority P`: Filter by priority (critical, high, medium, low)

## How It Works

The bundled `parallel_planner.py` script:

1. **Fetches Issues**: Uses `gh` CLI to get all open issues with metadata
2. **Parses Priority**: Extracts phase, priority, and component from issue bodies
3. **Groups by Area**: Clusters issues into parallelizable tracks (AI, UI, Game Engine, Multiplayer, etc.)
4. **Calculates Priority Score**: Phase × Priority matrix to rank issues
5. **Generates Plan**: Outputs worktree commands and execution plan

## Execution Workflow

### Step 1: Run the Planner

```bash
python3 .claude/skills/parallel-issues/scripts/parallel_planner.py --max-parallel 4
```

The script outputs:
- Parallel tracks grouped by code area
- Priority score for each issue
- Git worktree setup commands
- Agent launch instructions

### Step 2: Create Git Worktrees

Copy and run the worktree commands from the output:

```bash
# Example output from planner
git worktree add ../feature-issue-1-phase-11-implement-game-state-data-structures -b feature/issue-1
git worktree add ../feature-issue-17-phase-21-design-and-implement-game-board-layout -b feature/issue-17
git worktree add ../feature-issue-35-phase-31-implement-ai-game-state-evaluation -b feature/issue-35
git worktree add ../feature-issue-66-phase-43-implement-host-game-functionality -b feature/issue-66
```

### Step 3: Launch Parallel Agents

For each worktree, use the Task tool to launch background agents:

```
# Each agent works independently in its own worktree
# Monitor progress with TaskOutput
```

### Step 4: Monitor and Create PRs

When an agent completes work:

```bash
# Navigate to the worktree
cd ../feature-issue-123

# Push the branch
git push origin feature/issue-123

# Create PR linked to issue
gh pr create --title "Fix #123: Issue Title" --body "Closes #123" --base main

# Remove worktree after PR creation
cd ../studio
git worktree remove ../feature-issue-123
```

## Priority Matrix

Issues are prioritized based on:

1. **Critical Path**: Issues that block other work (Phase 1: Game Engine)
2. **User Value**: Features that directly enable gameplay
3. **Dependencies**: Issues that unblock other issues
4. **Effort**: Quick wins vs large features

**Priority Scores:**
- **CRITICAL** (150 pts): Phase 1 (Game Engine) - Blocks all gameplay
- **HIGH** (120 pts): Phase 2 (UI) and Phase 3 (AI Gameplay)
- **MEDIUM** (80 pts): Phase 4 (Multiplayer)
- **LOW** (20 pts): Phase 5 (Polish) and technical debt

## Parallel Workability

**Issues CAN be worked in parallel when:**
- Different code areas (different directories)
- No shared files being modified
- Independent features
- Different components (UI vs networking vs AI)
- No database conflicts

**Issues CANNOT be worked in parallel when:**
- Modify the same files
- Have dependency relationships
- Require coordinated API changes
- Share state management
- Need synchronous integration

## Roadmap Phase Reference

From README.md:

- **Phase 1**: Core Game Engine (CRITICAL - 60-80% of effort)
  - Game state management
  - Card mechanics
  - Rules engine

- **Phase 2**: Single Player Gameplay (HIGH)
  - Game board UI
  - Interaction system
  - Save/load system

- **Phase 3**: AI Opponent & Gameplay (HIGH)
  - AI decision engine
  - Multi-provider integration
  - BYO key system

- **Phase 4**: Multiplayer Infrastructure (MEDIUM - Can parallelize with 2-3)
  - P2P networking
  - State synchronization
  - Lobby system

- **Phase 5**: Polish & Enhancement (LOW)
  - Visual effects
  - Tournament features
  - Advanced features

## Example Output

```
================================================================================
PARALLEL ISSUES EXECUTION PLAN
================================================================================

Total tracks: 4
Total issues to work: 74

────────────────────────────────────────────────────────────────────────────────
TRACK 1: AI
────────────────────────────────────────────────────────────────────────────────

  Issue #35: Phase 3.1: Implement AI game state evaluation
  └─ Priority: HIGH | Phase 3 | Score: 120
  └─ Worktree: ../feature-issue-35-phase-31-implement-ai-game-state-evaluation
  └─ Branch: feature/issue-35

[... more issues ...]

================================================================================
GIT WORKTREE SETUP COMMANDS
================================================================================

git worktree add ../feature-issue-35-phase-31-implement-ai-game-state-evaluation -b feature/issue-35
git worktree add ../feature-issue-17-phase-21-design-and-implement-game-board-layout -b feature/issue-17
[... more commands ...]

================================================================================
EXECUTION SUMMARY
================================================================================

All open issues by phase:
  Phase 1: 16 issues
  Phase 2: 18 issues
  Phase 3: 22 issues
  Phase 4: 25 issues
  Phase 5: 15 issues
```

## Technical Debt Items

Technical debt issues should be addressed incrementally:
- Priority HIGH: Add tests for new features
- Priority MEDIUM: Performance, accessibility
- Priority LOW: PWA, mobile responsiveness
