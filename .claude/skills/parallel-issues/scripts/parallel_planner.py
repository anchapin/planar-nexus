#!/usr/bin/env python3
"""Parallel Issues Planner - Analyzes GitHub issues and creates parallel work plans."""

import json
import re
import subprocess
import sys
from pathlib import Path
from collections import defaultdict
from dataclasses import dataclass, field
from typing import List, Dict, Set, Optional


@dataclass
class Issue:
    """Represents a GitHub issue."""
    number: int
    title: str
    body: str
    labels: List[str]
    phase: Optional[int] = None
    priority: Optional[str] = None
    component: Optional[str] = None
    dependencies: List[int] = field(default_factory=list)
    effort: Optional[str] = None

    @property
    def priority_score(self) -> int:
        """Calculate priority score (higher = more important)."""
        phase_scores = {1: 100, 2: 80, 3: 80, 4: 60, 5: 20}
        priority_scores = {"critical": 50, "high": 40, "medium": 20, "low": 10}

        score = phase_scores.get(self.phase or 5, 0)
        score += priority_scores.get(self.priority or "low", 0)
        return score

    @property
    def key_area(self) -> str:
        """Determine the key area for parallel work."""
        if self.component:
            return self.component

        # Extract from title/body
        text = (self.title + " " + self.body).lower()

        area_keywords = {
            "game-engine": ["game state", "combat", "stack", "turn", "mana", "spell", "rules engine"],
            "ui": ["ui", "layout", "rendering", "display", "visual", "animation", "card art"],
            "ai": ["ai", "opponent", "coach", "suggestion", "provider", "gemini", "claude"],
            "networking": ["webrtc", "p2p", "signaling", "connection", "multiplayer", "network"],
            "multiplayer": ["lobby", "chat", "spectator", "1v1", "4-player", "teams"],
            "testing": ["test", "e2e", "unit", "coverage"],
            "performance": ["performance", "optimization", "cache", "lazy"],
            "accessibility": ["accessibility", "aria", "keyboard", "screen reader"],
            "mobile": ["mobile", "responsive", "touch"],
            "pwa": ["pwa", "service worker", "offline", "manifest"],
        }

        for area, keywords in area_keywords.items():
            if any(kw in text for kw in keywords):
                return area
        return "other"


def parse_issue_labels(body: str) -> tuple:
    """Parse phase, priority, and component from issue body."""
    phase = None
    priority = None
    component = None

    # Look for phase reference
    phase_match = re.search(r'phase[:\s]+(\d+)', body, re.IGNORECASE)
    if phase_match:
        phase = int(phase_match.group(1))

    # Look for priority
    priority_match = re.search(r'priority[:\s]+(\w+)', body, re.IGNORECASE)
    if priority_match:
        priority = priority_match.group(1).lower()

    # Look for component
    component_match = re.search(r'component[:\s]+(\w+)', body, re.IGNORECASE)
    if component_match:
        component = component_match.group(1).lower()

    return phase, priority, component


def fetch_issues(limit: int = 500) -> List[Issue]:
    """Fetch open issues from GitHub."""
    print("Fetching open issues from GitHub...")
    result = subprocess.run(
        ["gh", "issue", "list", "--limit", str(limit), "--state", "open",
         "--json", "number,title,body,labels"],
        capture_output=True,
        text=True,
        check=True
    )

    issues = []
    for item in json.loads(result.stdout):
        body = item.get("body", "")
        phase, priority, component = parse_issue_labels(body)

        issues.append(Issue(
            number=item["number"],
            title=item["title"],
            body=body,
            labels=[label["name"] for label in item.get("labels", [])],
            phase=phase,
            priority=priority,
            component=component
        ))

    print(f"Fetched {len(issues)} issues")
    return issues


def group_by_parallel_workability(issues: List[Issue], max_tracks: int = 4) -> Dict[str, List[Issue]]:
    """Group issues that can be worked on in parallel."""

    # Group by key area
    area_groups = defaultdict(list)
    for issue in issues:
        area = issue.key_area
        area_groups[area].append(issue)

    # Sort each group by priority
    for area in area_groups:
        area_groups[area].sort(key=lambda i: (-i.priority_score, i.number))

    # Select top tracks
    sorted_areas = sorted(
        area_groups.items(),
        key=lambda x: sum(i.priority_score for i in x[1]),
        reverse=True
    )

    tracks = {}
    for area, area_issues in sorted_areas[:max_tracks]:
        tracks[area] = area_issues

    return tracks


def generate_worktree_name(issue: Issue) -> str:
    """Generate a worktree directory name for an issue."""
    # Clean the title for use as directory name
    clean_title = re.sub(r'[^\w\s-]', '', issue.title)
    clean_title = re.sub(r'[-\s]+', '-', clean_title)
    clean_title = clean_title.strip('-').lower()[:50]
    return f"../feature-issue-{issue.number}-{clean_title}"


def generate_branch_name(issue: Issue) -> str:
    """Generate a branch name for an issue."""
    return f"feature/issue-{issue.number}"


def print_plan(tracks: Dict[str, List[Issue]], max_issues_per_track: int = 3):
    """Print the parallel work plan."""

    print("\n" + "=" * 80)
    print("PARALLEL ISSUES EXECUTION PLAN")
    print("=" * 80)

    total_issues = sum(len(issues) for issues in tracks.values())
    print(f"\nTotal tracks: {len(tracks)}")
    print(f"Total issues to work: {total_issues}\n")

    for i, (area, issues) in enumerate(tracks.items(), 1):
        print(f"\n{'─' * 80}")
        print(f"TRACK {i}: {area.upper()}")
        print(f"{'─' * 80}")

        for issue in issues[:max_issues_per_track]:
            phase_str = f"Phase {issue.phase}" if issue.phase else "No phase"
            prio_str = issue.priority.upper() if issue.priority else "UNSET"
            worktree = generate_worktree_name(issue)
            branch = generate_branch_name(issue)

            print(f"\n  Issue #{issue.number}: {issue.title}")
            print(f"  └─ Priority: {prio_str} | {phase_str} | Score: {issue.priority_score}")
            print(f"  └─ Worktree: {worktree}")
            print(f"  └─ Branch: {branch}")

    print("\n" + "=" * 80)


def print_git_commands(tracks: Dict[str, List[Issue]], max_issues_per_track: int = 1):
    """Print git commands to set up worktrees."""

    print("\n" + "=" * 80)
    print("GIT WORKTREE SETUP COMMANDS")
    print("=" * 80 + "\n")

    all_commands = []

    for area, issues in tracks.items():
        for issue in issues[:max_issues_per_track]:
            worktree = generate_worktree_name(issue)
            branch = generate_branch_name(issue)
            cmd = f"git worktree add {worktree} -b {branch}"
            all_commands.append((issue.number, issue.title[:40], cmd))

    for num, title, cmd in all_commands:
        print(f"# Issue #{num}: {title}")
        print(cmd)
        print()


def print_agent_commands(tracks: Dict[str, List[Issue]], max_issues_per_track: int = 1):
    """Print commands to launch parallel agents."""

    print("\n" + "=" * 80)
    print("SUB-AGENT LAUNCH COMMANDS (for Claude Code)")
    print("=" * 80 + "\n")

    print("# Run these commands in parallel to work on issues simultaneously\n")

    for area, issues in tracks.items():
        for issue in issues[:max_issues_per_track]:
            worktree = generate_worktree_name(issue)
            branch = generate_branch_name(issue)

            print(f"# Track: {area} | Issue #{issue.number}: {issue.title[:50]}")
            print(f"# cd {worktree} && # Work in this directory")
            print(f"# Read the issue and implement the feature")


def print_summary(tracks: Dict[str, List[Issue]], issues: List[Issue]):
    """Print execution summary."""

    print("\n" + "=" * 80)
    print("EXECUTION SUMMARY")
    print("=" * 80)

    # Count by phase
    phase_counts = defaultdict(int)
    for issue in issues:
        if issue.phase:
            phase_counts[issue.phase] += 1

    print(f"\nAll open issues by phase:")
    for phase in sorted(phase_counts.keys()):
        print(f"  Phase {phase}: {phase_counts[phase]} issues")

    # Track summary
    print(f"\nParallel tracks ({len(tracks)}):")
    for area, area_issues in tracks.items():
        total_score = sum(i.priority_score for i in area_issues)
        print(f"  {area}: {len(area_issues)} issues (total priority score: {total_score})")

    print("\n" + "=" * 80)


def main():
    args = sys.argv[1:] if len(sys.argv) > 1 else []

    # Parse arguments
    max_parallel = 4
    filter_phase = None
    filter_priority = None

    i = 0
    while i < len(args):
        if args[i] == "--max-parallel" and i + 1 < len(args):
            max_parallel = int(args[i + 1])
            i += 2
        elif args[i] == "--phase" and i + 1 < len(args):
            filter_phase = int(args[i + 1])
            i += 2
        elif args[i] == "--priority" and i + 1 < len(args):
            filter_priority = args[i + 1].lower()
            i += 2
        else:
            i += 1

    # Fetch issues
    issues = fetch_issues()

    # Filter if needed
    if filter_phase:
        issues = [i for i in issues if i.phase == filter_phase]
        print(f"Filtered to Phase {filter_phase}: {len(issues)} issues")

    if filter_priority:
        issues = [i for i in issues if i.priority == filter_priority]
        print(f"Filtered to {filter_priority.upper()} priority: {len(issues)} issues")

    if not issues:
        print("No issues match the filters.")
        return

    # Sort all issues by priority
    issues.sort(key=lambda i: (-i.priority_score, i.number))

    # Create parallel work plan
    tracks = group_by_parallel_workability(issues, max_tracks=max_parallel)

    # Print the plan
    print_plan(tracks, max_issues_per_track=3)
    print_git_commands(tracks, max_issues_per_track=1)
    print_agent_commands(tracks, max_issues_per_track=1)
    print_summary(tracks, issues)

    print("\nNext steps:")
    print("1. Create worktrees using the commands above")
    print("2. For each worktree, launch a sub-agent or work on the issue")
    print("3. When complete, push and create PR with: gh pr create --body 'Closes #<issue>'")
    print()


if __name__ == "__main__":
    main()
