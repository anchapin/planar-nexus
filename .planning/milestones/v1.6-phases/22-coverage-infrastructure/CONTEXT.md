# Phase 22: Coverage Infrastructure - Context

## Locked Decisions

From v1.6-REQUIREMENTS.md (REQ-002):
- **Coverage thresholds**: Lines 70%, Branches 60%, Functions 70%, Statements 70%
- **CI enforcement**: Must fail if below threshold
- **Report formats**: lcov and html required
- **Badge support**: Required for README

## Technical Constraints

- Uses Jest for testing (existing in project)
- CI pipeline already exists (likely GitHub Actions)
- Project uses TypeScript/Next.js
- Coverage tool: Jest's built-in coverage with --coverage flag

## Dependencies

- Phase 21: Pre-commit Hooks Setup (must complete first or run in parallel)
- Existing jest.config.js in project root

## Implementation Notes

- Jest configuration in jest.config.js needs `coverageThreshold` section
- GitHub Actions workflow needs to be updated to include coverage check
- Coverage reports need to be generated and stored as artifacts
- Coverage badge typically uses service like Codecov, Coveralls, or shields.io
