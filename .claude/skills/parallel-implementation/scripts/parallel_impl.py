#!/usr/bin/env python3
"""
Parallel Implementation Script

Implements top 3-5 priority GitHub issues in parallel using git worktrees and subagents.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple


# ANSI color code regex pattern
ANSI_ESCAPE = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')


def strip_ansi(text: str) -> str:
    """Remove ANSI escape codes from text."""
    return ANSI_ESCAPE.sub('', text)


class ParallelImplementation:
    def __init__(self, args):
        self.args = args
        self.repo_root = Path.cwd()
        self.parent_dir = self.repo_root.parent
        self.issues = []
        self.worktrees = {}
        self.subagent_pids = {}

    def run(self):
        """Main execution flow."""
        print("=" * 80)
        print("PARALLEL IMPLEMENTATION: EXECUTION PLAN")
        print("=" * 80)
        print()

        # Phase 1: Issue Discovery
        if not self.discover_issues():
            print("❌ No suitable issues found.")
            return 1

        # Phase 2: Show plan (interactive)
        if not self.show_plan():
            print("❌ Execution cancelled.")
            return 1

        # Phase 3: Create Worktrees
        if not self.create_worktrees():
            print("❌ Failed to create worktrees.")
            return 1

        # Phase 4: Generate subagent commands
        self.generate_subagent_commands()

        # Phase 5: Summary
        self.print_summary()
        return 0

    def discover_issues(self) -> bool:
        """Discover and prioritize issues."""
        print("🔍 Discovering issues...")
        print()

        # Fetch issues using gh CLI
        try:
            result = subprocess.run(
                [
                    "gh", "issue", "list",
                    "--limit", "50",
                    "--state", "open",
                    "--json", "number,title,body,labels,state,createdAt,author"
                ],
                capture_output=True,
                text=True,
                check=True
            )
            if not result.stdout.strip():
                print("❌ No issues found or gh CLI returned empty result")
                return False

            # Strip ANSI codes from output
            clean_output = strip_ansi(result.stdout)

            issues_data = json.loads(clean_output)
        except subprocess.CalledProcessError as e:
            print(f"❌ Failed to fetch issues: {e.stderr}")
            return False
        except json.JSONDecodeError as e:
            print(f"❌ Failed to parse issue JSON: {e}")
            print(f"   Output length: {len(result.stdout)}")
            print(f"   Output first 300 chars: {result.stdout[:300]}")
            return False

        # Parse and score issues
        scored_issues = []
        for issue in issues_data:
            score, metadata = self.score_issue(issue)
            if score > 0:
                scored_issues.append((score, metadata))

        # Sort by score (highest first)
        scored_issues.sort(key=lambda x: x[0], reverse=True)

        # Filter and select top issues
        self.issues = []
        max_parallel = min(self.args.max_parallel, len(scored_issues))

        for i in range(max_parallel):
            score, issue = scored_issues[i]
            self.issues.append(issue)

        if not self.issues:
            print("❌ No implementable issues found.")
            return False

        print(f"✅ Found {len(self.issues)} issues to implement:")
        print()
        self.print_issues()
        return True

    def score_issue(self, issue: Dict) -> Tuple[int, Dict]:
        """Score an issue based on priority, age, and engagement."""
        labels = [label["name"] for label in issue["labels"]]
        body = issue.get("body", "")

        # Check exclusion labels
        exclusion_labels = ["question", "duplicate", "wontfix", "invalid", "wont-fix"]
        if any(label in exclusion_labels for label in labels):
            return 0, {}

        # Check priority filter
        if self.args.priority:
            if self.args.priority not in labels:
                return 0, {}

        # Check label filter
        if self.args.label:
            if self.args.label not in labels:
                return 0, {}

        # Parse priority from labels
        priority_labels = {
            "critical": 100,
            "high": 75,
            "medium": 50,
            "low": 25
        }

        priority_score = 0
        for label in labels:
            if label.lower() in priority_labels:
                priority_score = priority_labels[label.lower()]
                break

        # If no priority label, use medium as default
        if priority_score == 0:
            priority_score = 30

        # Calculate age score (older = higher, up to 10 points)
        try:
            created_at = datetime.fromisoformat(issue["createdAt"].replace("Z", "+00:00"))
            age_days = (datetime.now(created_at.tzinfo) - created_at).days
            age_score = min(10, age_days // 7)  # 1 point per week, max 10
        except (ValueError, KeyError):
            age_score = 0

        # Calculate engagement score (we can't fetch comments reliably, so use 0)
        engagement_score = 0

        # Assignee bonus (we can't fetch assignees reliably, so use 0)
        assignee_bonus = 0

        # Total score
        total_score = priority_score + age_score + engagement_score + assignee_bonus

        # Create branch name
        slug = self.slugify(issue["title"])
        branch_name = self.args.branch_name_format.format(number=issue["number"], slug=slug)
        worktree_path = self.parent_dir / f"issue-{issue['number']}-{slug}"

        # Extract metadata
        metadata = {
            "number": issue["number"],
            "title": issue["title"],
            "body": body,
            "labels": labels,
            "state": issue["state"],
            "createdAt": issue.get("createdAt", ""),
            "author": issue.get("author", {}).get("login", "unknown"),
            "branch_name": branch_name,
            "worktree_path": worktree_path,
            "priority_label": next((l for l in labels if l.lower() in priority_labels), "medium"),
            "score": total_score
        }

        return total_score, metadata

    def slugify(self, text: str) -> str:
        """Convert text to a URL-friendly slug."""
        # Remove special characters, keep alphanumeric and hyphens
        slug = re.sub(r'[^\w\s-]', '', text.lower())
        # Replace spaces and underscores with hyphens
        slug = re.sub(r'[\s_]+', '-', slug)
        # Remove consecutive hyphens
        slug = re.sub(r'-+', '-', slug)
        # Limit length
        slug = slug[:50]
        # Remove leading/trailing hyphens
        slug = slug.strip('-')
        return slug

    def print_issues(self):
        """Print selected issues."""
        for i, issue in enumerate(self.issues, 1):
            print(f"{i}. Issue #{issue['number']}: {issue['title']}")
            print(f"   Priority: {issue['priority_label']}")
            print(f"   Branch: {issue['branch_name']}")
            print(f"   Worktree: ../{issue['worktree_path'].name}")
            print(f"   Score: {issue['score']}")
            print()

    def show_plan(self) -> bool:
        """Show the execution plan and ask for confirmation."""
        print("=" * 80)
        print("EXECUTION PLAN")
        print("=" * 80)
        print()
        print(f"Issues to implement: {len(self.issues)}")
        print(f"Max parallel worktrees: {self.args.max_parallel}")
        print()

        for i, issue in enumerate(self.issues, 1):
            print(f"Issue #{issue['number']}: {issue['title']}")
            print(f"  Priority: {issue['priority_label']}")
            print(f"  Branch: {issue['branch_name']}")
            print(f"  Worktree: ../{issue['worktree_path'].name}")
            print(f"  Files affected: TBD")
            print()

        if self.args.dry_run:
            print("🔍 DRY RUN MODE - No changes will be made")
            return True

        # Interactive confirmation
        if self.args.interactive:
            response = input("\nProceed with implementation? (y/N): ").strip().lower()
            return response == 'y'

        return True

    def create_worktrees(self) -> bool:
        """Create git worktrees for each issue."""
        if self.args.dry_run:
            print("🔍 DRY RUN: Would create the following worktrees:")
            for issue in self.issues:
                print(f"  - {issue['worktree_path']} (branch: {issue['branch_name']})")
            return True

        print()
        print("=" * 80)
        print("EXECUTING PHASE 1: Creating Worktrees...")
        print("=" * 80)
        print()

        for issue in self.issues:
            worktree_path = issue["worktree_path"]
            branch_name = issue["branch_name"]

            # Check if worktree already exists
            if worktree_path.exists():
                print(f"⚠️  Worktree already exists: {worktree_path}")
                print(f"   Remove it first with: git worktree remove {worktree_path}")
                continue

            # Check if branch already exists
            result = subprocess.run(
                ["git", "branch", "--list", branch_name],
                capture_output=True,
                text=True
            )

            if result.stdout.strip():
                print(f"⚠️  Branch already exists: {branch_name}")
                print(f"   Delete it first with: git branch -D {branch_name}")
                continue

            # Create worktree
            try:
                subprocess.run(
                    ["git", "worktree", "add", str(worktree_path), "-b", branch_name],
                    check=True,
                    capture_output=True
                )
                print(f"✅ Created worktree: {worktree_path}")
                self.worktrees[issue["number"]] = worktree_path
            except subprocess.CalledProcessError as e:
                print(f"❌ Failed to create worktree {worktree_path}: {e.stderr.decode()}")
                return False

        return True

    def generate_subagent_commands(self):
        """Generate subagent commands for manual execution."""
        print()
        print("=" * 80)
        print("EXECUTING PHASE 2: Subagent Commands")
        print("=" * 80)
        print()
        print("Run the following subagent commands to work on issues in parallel:")
        print()

        for issue in self.issues:
            worktree_path = issue["worktree_path"]
            print(f"# Issue #{issue['number']}: {issue['title']}")
            print(f"cd {worktree_path}")
            print(f"# Implement the issue, run tests, and commit changes")
            print()

        print()
        print("After implementation is complete, create PRs:")
        print()

        for issue in self.issues:
            branch_name = issue["branch_name"]
            print(f"# PR for Issue #{issue['number']}")
            if not self.args.no_push:
                print(f"cd {issue['worktree_path']}")
                print(f"git push -u origin {branch_name}")
                if not self.args.no_pr:
                    print(f"gh pr create \\")
                    print(f"  --title \"Fix #{issue['number']}: {issue['title']}\" \\")
                    print(f"  --body \"Closes #{issue['number']}\" \\")
                    print(f"  --base main \\")
                    print(f"  --label \"auto-generated\"")
                    print(f"git worktree remove {issue['worktree_path']}")
            print()

    def print_summary(self):
        """Print execution summary."""
        print()
        print("=" * 80)
        print("SUMMARY")
        print("=" * 80)
        print()
        print(f"Issues selected: {len(self.issues)}")
        print(f"Worktrees created: {len(self.worktrees)}")
        print()

        print("Next steps:")
        print("1. Implement each issue in its worktree")
        print("2. Run tests and ensure quality")
        print("3. Commit changes in each worktree")
        print("4. Push branches and create PRs")
        print("5. Remove worktrees after PR creation")
        print()

        if not self.args.dry_run:
            print(f"To remove all worktrees:")
            print(f"  git worktree remove --force")
            print()


def main():
    parser = argparse.ArgumentParser(
        description="Implement GitHub issues in parallel using git worktrees"
    )
    parser.add_argument(
        "--max-parallel",
        type=int,
        default=5,
        help="Maximum number of parallel worktrees (default: 5)"
    )
    parser.add_argument(
        "--priority",
        choices=["critical", "high", "medium", "low"],
        help="Filter by priority label"
    )
    parser.add_argument(
        "--label",
        help="Filter by specific label"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without actually creating worktrees"
    )
    parser.add_argument(
        "--no-push",
        action="store_true",
        help="Skip pushing branches to remote"
    )
    parser.add_argument(
        "--no-pr",
        action="store_true",
        help="Skip creating PRs"
    )
    parser.add_argument(
        "--branch-name-format",
        default="issue-{number}-{slug}",
        help="Custom branch name format (default: issue-{number}-{slug})"
    )
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="Ask for confirmation before executing"
    )

    args = parser.parse_args()

    impl = ParallelImplementation(args)
    sys.exit(impl.run())


if __name__ == "__main__":
    main()
