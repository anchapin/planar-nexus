#!/bin/bash
# Automation script for parallel implementation
# This script helps automate the process of creating PRs after subagent completion

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
MAX_PARALLEL=5
PRIORITY=""
LABEL=""
DRY_RUN=false
NO_PUSH=false
NO_PR=false
BRANCH_FORMAT="issue-{number}-{slug}"
INTERACTIVE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --max-parallel)
            MAX_PARALLEL="$2"
            shift 2
            ;;
        --priority)
            PRIORITY="$2"
            shift 2
            ;;
        --label)
            LABEL="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --no-push)
            NO_PUSH=true
            shift
            ;;
        --no-pr)
            NO_PR=true
            shift
            ;;
        --branch-name-format)
            BRANCH_FORMAT="$2"
            shift 2
            ;;
        --interactive)
            INTERACTIVE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Build command
CMD="python3 .claude/skills/parallel-implementation/scripts/parallel_impl.py"
CMD+=" --max-parallel $MAX_PARALLEL"

if [ -n "$PRIORITY" ]; then
    CMD+=" --priority $PRIORITY"
fi

if [ -n "$LABEL" ]; then
    CMD+=" --label $LABEL"
fi

if [ "$DRY_RUN" = true ]; then
    CMD+=" --dry-run"
fi

if [ "$NO_PUSH" = true ]; then
    CMD+=" --no-push"
fi

if [ "$NO_PR" = true ]; then
    CMD+=" --no-pr"
fi

if [ "$INTERACTIVE" = true ]; then
    CMD+=" --interactive"
fi

CMD+=" --branch-name-format '$BRANCH_FORMAT'"

echo -e "${BLUE}Running parallel implementation...${NC}"
echo -e "${BLUE}Command: $CMD${NC}"
echo

# Run the command
eval $CMD
