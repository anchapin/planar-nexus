# GitHub Issues Directory

This directory contains issue templates and batch files for GitHub issues created from the deep code review.

---

## Directory Structure

```
.github/
├── issue-templates/          # Templates for creating new issues
│   ├── critical-security.md
│   ├── critical-bug.md
│   ├── high-priority.md
│   ├── medium-priority.md
│   └── low-priority.md
│
├── issues-batch-1/           # CRITICAL priority issues (ready to create)
│   ├── 601-security-client-api-calls.md
│   ├── 602-game-engine-ui-integration.md
│   ├── 603-api-key-validation.md
│   ├── 604-unify-gamestate-types.md
│   ├── 605-server-side-api-endpoints.md
│   ├── 606-claude-provider.md
│   └── 607-ai-turn-race-condition.md
│
├── issues-batch-2/           # HIGH priority issues (ready to create)
│   ├── 608-remove-console-logs.md
│   ├── 609-error-handling.md
│   ├── 610-remove-any-types.md
│   ├── 611-integration-tests.md
│   ├── 612-memory-leak-autosave.md
│   ├── 613-dead-code-cleanup.md
│   ├── 614-complete-combat-system.md
│   └── 615-accessibility-support.md
│
└── README.md                 # This file
```

---

## Quick Start

### Creating Issues with GitHub CLI

```bash
# Install GitHub CLI if not already installed
# https://cli.github.com/

# Create all CRITICAL issues
for file in .github/issues-batch-1/*.md; do
  TITLE=$(head -1 "$file" | sed 's/^# //')
  gh issue create --title "$TITLE" --body-file "$file"
  echo "✓ Created: $TITLE"
done

# Create all HIGH issues
for file in .github/issues-batch-2/*.md; do
  TITLE=$(head -1 "$file" | sed 's/^# //')
  gh issue create --title "$TITLE" --body-file "$file"
  echo "✓ Created: $TITLE"
done
```

### Creating Issues Manually

1. Open the issue file (e.g., `issues-batch-1/601-security-client-api-calls.md`)
2. Copy the entire content
3. Go to https://github.com/anchapin/planar-nexus/issues/new
4. Paste the content
5. Add appropriate labels and milestone
6. Click "Submit new issue"

---

## Issue Priority Levels

### 🔴 CRITICAL
- Blocks core functionality
- Security vulnerabilities
- Must fix before production
- Estimated effort: 1-7 days each

### 🟠 HIGH
- Significantly impacts UX
- Code quality issues
- Should fix soon
- Estimated effort: 1-7 days each

### 🟡 MEDIUM
- Should be fixed but not blocking
- Technical debt
- Fix when capacity allows
- Estimated effort: 1-3 days each

### 🟢 LOW
- Minor improvements
- Nice to have
- Fix as time permits
- Estimated effort: < 2 days each

---

## Issue Metadata

Each issue file contains metadata at the top:

```markdown
# Issue Title

**Priority:** 🔴 CRITICAL  
**Labels:** `critical`, `security`, `ai`  
**Milestone:** v0.2.0 Security  
**Estimated Effort:** 2-3 days
```

### Fields Explained

- **Priority:** CRITICAL, HIGH, MEDIUM, or LOW
- **Labels:** GitHub labels to apply
- **Milestone:** Target milestone
- **Estimated Effort:** Time to complete

---

## Source Documents

These issues were created from:

1. **DEEP_CODE_REVIEW_REPORT.md** - Full code review with 47 issues identified
2. **GITHUB_ISSUES_CREATED.md** - Detailed descriptions of all 47 issues
3. **GITHUB_ISSUES_SUMMARY.md** - Summary and work order recommendations

---

## Work Order

### Phase 1: Security & Stability (Week 1-2)
Issues: #601, #603, #605, #607

### Phase 2: Core Functionality (Week 2-4)
Issues: #602, #604, #606

### Phase 3: Code Quality (Week 4-6)
Issues: #608, #609, #610, #612, #613

### Phase 4: Testing & Completeness (Week 6-8)
Issues: #611, #614, #615

---

## Tracking Progress

### GitHub Project Board

Create a project board to track these issues:

1. Go to https://github.com/anchapin/planar-nexus/projects
2. Click "New project"
3. Choose "Board" template
4. Add columns: Backlog, In Progress, In Review, Done
5. Add issues to Backlog
6. Prioritize and assign

### GitHub Milestones

Create milestones for tracking:

1. Go to https://github.com/anchapin/planar-nexus/milestones
2. Create milestones:
   - v0.2.0 Security (Issues #601, #603, #605, #607)
   - v0.2.0 Core Gameplay (Issues #602, #604, #606)
   - v0.2.0 Quality (Issues #608, #609, #610, #612, #613)
   - v0.2.0 Testing (Issues #611, #614, #615)

---

## Updating Issues

When working on an issue:

1. **Assign** to yourself
2. **Move** to "In Progress" column
3. **Add** work-in-progress comments
4. **Link** pull requests when ready
5. **Close** when complete and merged

---

## Related Files

- `/CLAUDE.md` - Development commands and architecture
- `/README.md` - Project overview
- `/DEEP_CODE_REVIEW_REPORT.md` - Full code review
- `/GITHUB_ISSUES_SUMMARY.md` - Issue summary

---

## Questions?

- Check the issue file for detailed implementation guidance
- Refer to `DEEP_CODE_REVIEW_REPORT.md` for context
- Ask in GitHub issue comments for clarification

---

**Last Updated:** March 11, 2026  
**Total Issues:** 15 ready to create  
**Batches:** 2 (CRITICAL, HIGH)
