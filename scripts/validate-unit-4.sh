#!/bin/bash

# Validation script for Unit 4: Original Artwork Generation System

echo "=========================================="
echo "Unit 4 Validation Script"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track results
PASSED=0
FAILED=0

# Function to check file existence
check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1 exists"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} $1 missing"
        ((FAILED++))
    fi
}

# Function to check if file contains text
check_content() {
    if grep -q "$2" "$1" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} $1 contains '$2'"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} $1 missing '$2'"
        ((FAILED++))
    fi
}

echo "1. Checking required files..."
echo "----------------------------------------"
check_file "src/lib/procedural-art-generator.ts"
check_file "src/lib/artwork-cache.ts"
check_file "src/components/card-art.tsx"
check_file "src/app/(app)/artwork-demo/page.tsx"
check_file "ARTWORK_GENERATION_README.md"
check_file "UNIT_4_IMPLEMENTATION_SUMMARY.md"
echo ""

echo "2. Checking implementation completeness..."
echo "----------------------------------------"
check_content "src/lib/procedural-art-generator.ts" "SeededRandom"
check_content "src/lib/procedural-art-generator.ts" "generateProceduralArtwork"
check_content "src/lib/procedural-art-generator.ts" "COLOR_PALETTES"
check_content "src/lib/artwork-cache.ts" "getOrGenerateArtwork"
check_content "src/lib/artwork-cache.ts" "clearArtworkCache"
check_content "src/components/card-art.tsx" "useProceduralArt"
check_content "src/components/card-art.tsx" "artworkCache"
echo ""

echo "3. Checking documentation..."
echo "----------------------------------------"
check_content "ARTWORK_GENERATION_README.md" "Procedural Artwork Generation System"
check_content "ARTWORK_GENERATION_README.md" "Usage"
check_content "ARTWORK_GENERATION_README.md" "API"
check_content "UNIT_4_IMPLEMENTATION_SUMMARY.md" "Implementation Summary"
echo ""

echo "4. Checking build status..."
echo "----------------------------------------"
if [ -d ".next" ] && [ -f ".next/BUILD_ID" ]; then
    echo -e "${GREEN}✓${NC} Build directory exists"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠${NC} Build directory not found (run 'npm run build')"
    ((FAILED++))
fi
echo ""

echo "5. Summary"
echo "=========================================="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo "Total:  $((PASSED + FAILED))"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Run: npm run dev"
    echo "  2. Navigate to: http://localhost:9002/artwork-demo"
    echo "  3. Test artwork generation"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Some checks failed${NC}"
    echo ""
    echo "Please review the failed checks above."
    echo ""
    exit 1
fi
