# Branch Protection Recommendations

This document provides recommendations for configuring GitHub branch protection rules to maintain code quality and prevent regressions in the Planar Nexus project.

## Overview

Branch protection rules are essential for maintaining code quality, enforcing review processes, and preventing unauthorized changes from being merged into protected branches. This document outlines the recommended configuration for the `main` and `develop` branches.

## Recommended Branch Protection Rules

### For `main` Branch (Production)

The `main` branch should have the strictest protection rules:

1. **Require Pull Request Reviews**
   - Require at least 1 reviewer approval before merging
   - Require review from code owners for sensitive changes
   - Dismiss stale reviews when new commits are pushed

2. **Require Status Checks to Pass**
   - Required checks:
     - `test` - Unit tests with coverage gate
     - `lint` - ESLint code quality
     - `typecheck` - TypeScript type checking
     - `build` - Production build
     - `commitlint` - Commit message validation
     - `security` - npm audit security scan
   - Require branches to be up to date before merging

3. **Additional Protections**
   - Require conversation resolution before merging
   - Require administrators to follow the same rules
   - Prevent force pushes
   - Prevent branch deletion

### For `develop` Branch (Development)

The `develop` branch can have slightly relaxed rules but should still maintain quality gates:

1. **Require Pull Request Reviews**
   - Require at least 1 reviewer approval before merging

2. **Require Status Checks to Pass**
   - Required checks (same as main):
     - `test`
     - `lint`
     - `typecheck`
     - `commitlint`
     - `security`

3. **Additional Protections**
   - Prevent force pushes
   - Allow deletion by administrators only

## CI Jobs Requiring Status Checks

The following CI jobs must pass before merging:

| Job          | Purpose                       | Failure Impact                                                                             |
| ------------ | ----------------------------- | ------------------------------------------------------------------------------------------ |
| `test`       | Unit tests with coverage gate | Coverage below threshold (70% lines, 60% branches, 70% functions, 70% statements) fails CI |
| `lint`       | ESLint code quality           | Code style violations fail CI                                                              |
| `typecheck`  | TypeScript type checking      | Type errors fail CI                                                                        |
| `build`      | Production build              | Build failures prevent deployment                                                          |
| `commitlint` | Commit message validation     | Invalid commit messages fail CI                                                            |
| `security`   | npm audit security scan       | High/critical vulnerabilities fail CI                                                      |

## GitHub UI Configuration

To configure branch protection rules in GitHub:

1. Navigate to **Settings** → **Branches** → **Branch protection rules**
2. Click **Add rule**
3. Enter branch name pattern (e.g., `main` or `develop`)
4. Configure the following settings:

### Main Branch Rule

```
Branch name pattern: main
✓ Require pull request reviews before merging
  - Required approving reviewers: 1
✓ Require status checks to pass before merging
  - Select required checks: test, lint, typecheck, build, commitlint, security
  - Require branches to be up to date before merging: checked
✓ Require conversation resolution before merging
✓ Include administrators: checked
✓ Prevent force pushes
✓ Prevent branch deletion
```

### Develop Branch Rule

```
Branch name pattern: develop
✓ Require pull request reviews before merging
  - Required approving reviewers: 1
✓ Require status checks to pass before merging
  - Select required checks: test, lint, typecheck, commitlint, security
  - Require branches to be up to date before merging: checked
✓ Prevent force pushes
```

## Admin Exemptions

By default, administrators should follow the same rules. However, in emergency situations, administrators can:

1. Bypass branch protection rules (not recommended for regular use)
2. Override required reviews
3. Force push (temporarily disable protection)

**Note:** All bypasses should be documented and reviewed in subsequent PRs.

## Enforcement Timeline

- New rules can be deployed immediately for `main` branch
- `develop` branch rules can be relaxed initially and tightened as the team adapts

## Related Documentation

- [GitHub Branch Protection Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/about-protected-branches)
- [GitHub Actions Workflows](../.github/workflows/ci.yml)
- [CI Quality Gates Phase](./CI_QUALITY_GATES.md)
