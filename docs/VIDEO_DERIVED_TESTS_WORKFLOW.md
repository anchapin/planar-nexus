# Video-Derived Tests CI Workflow

This document describes the GitHub Actions workflow for running video-derived game state tests.

## Overview

The video-derived tests workflow automatically validates game state logic using test fixtures derived from actual gameplay videos. This ensures that the game engine correctly handles real-world scenarios captured during testing.

## Workflow File

Location: `.github/workflows/video-derived-tests.yml`

## Trigger Conditions

The workflow runs on:
- Push to `main` or `develop` branches
- Pull requests targeting `main` or `develop`
- Only when changes affect:
  - `src/lib/game-state/**`
  - `src/lib/__fixtures__/**`
  - `scripts/generate-test-fixture.ts`
  - `.github/workflows/video-derived-tests.yml`

## Workflow Steps

### 1. Setup
- Configure git safe directory
- Checkout code with full history
- Setup Node.js 22 with npm caching

### 2. Install Dependencies
- Run `npm ci` for clean, reproducible installs

### 3. Generate Test Fixtures
- Execute `scripts/generate-test-fixture.ts`
- Process JSON files from `src/lib/__fixtures__/video-derived/`
- Generate Jest test files in `src/lib/game-state/__tests__/video-derived/`

### 4. Count Fixtures
- Count generated video-derived test fixtures
- Store count in environment variable

### 5. Run Tests
- Execute Jest tests matching `video-derived` pattern
- Run with CI optimizations (2 workers, memory limits)
- Force exit after completion

### 6. Generate Coverage
- Generate JSON coverage report
- Calculate total lines coverage percentage
- Compute delta from baseline (70%)

### 7. Upload Artifacts
- Upload coverage reports as artifacts
- Retain for 30 days

### 8. PR Comments
- On pull requests, post a comment with:
  - Number of test fixtures
  - Coverage percentage
  - Delta from baseline
  - Test status

### 9. Failure Alerting
- On test failure, automatically create a GitHub issue with:
  - Issue title with reference
  - Test fixture count
  - Link to failed workflow run
  - Branch and commit information
  - Labels: `bug`, `tests`, `video-derived`

### 10. Coverage Threshold Check
- Warn if coverage falls below 70% baseline
- Display coverage delta

### 11. Update README Badge
- On successful runs to `main` branch:
  - Update coverage badge in README.md
  - Commit with `[skip ci]` to avoid triggering other workflows

## Fixture Format

Video-derived fixtures are JSON files in `src/lib/__fixtures__/video-derived/`:

```json
{
  "id": "unique-identifier",
  "name": "Human-readable name",
  "description": "Description of the game state scenario",
  "gameState": {
    "players": [...],
    "turn": {...},
    "stack": [...],
    "zones": {...}
  },
  "expectedBehaviors": [
    "Expected behavior 1",
    "Expected behavior 2"
  ]
}
```

## Generated Test Structure

Each fixture generates a Jest test file with the following tests:

1. **Load Test** - Verifies game state can be loaded
2. **Player Data Test** - Validates player structure
3. **Turn Structure Test** - Validates turn/phase data
4. **Serialization Test** - Tests JSON round-trip
5. **Behavior Tests** - One test per expected behavior

## Running Locally

### Generate Tests
```bash
npx ts-node scripts/generate-test-fixture.ts --fixtures-dir src/lib/__fixtures__/video-derived
```

### Run Tests
```bash
npm test -- --testPathPattern=video-derived
```

### With Coverage
```bash
npm test -- --testPathPattern=video-derived --coverage
```

### Dry Run (Generate without writing)
```bash
npx ts-node scripts/generate-test-fixture.ts --fixtures-dir src/lib/__fixtures__/video-derived --dry-run
```

## Coverage Badge

The README includes a badge showing the number of video-derived test fixtures:

```markdown
[![Video-Derived Tests](https://img.shields.io/badge/video_derived-N_fixtures-blue)](...)
```

This badge is automatically updated on successful runs to `main`.

## Monitoring

- Check the "Actions" tab in GitHub for workflow runs
- Look for the "Video-Derived Tests" workflow
- Review coverage artifacts for detailed reports
- Monitor auto-created issues for failures

## Troubleshooting

### Tests Not Running
- Verify `scripts/generate-test-fixture.ts` exists
- Check that fixture JSON files are valid
- Ensure `src/lib/__fixtures__/video-derived/` directory exists

### Coverage Below Baseline
- Review coverage report in artifacts
- Identify untested code paths
- Add new fixture scenarios to improve coverage

### Auto-Issue Creation
- Check `GITHUB_TOKEN` permissions in workflow
- Verify issue labels exist in repository
- Review issue template in workflow file

## Extending the Workflow

To add custom behavior:

1. Modify `.github/workflows/video-derived-tests.yml`
2. Add new steps after existing workflow steps
3. Use environment variables for configuration
4. Update this documentation with changes

## Related Documentation

- [Game State Module](../src/lib/game-state/README.md)
- [Testing Guide](../TESTING.md)
- [CI/CD Overview](../docs/CICD.md)
