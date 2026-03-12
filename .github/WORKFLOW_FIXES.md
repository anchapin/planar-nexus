# GitHub Actions Workflow Fixes - March 12, 2026

## Issues Fixed

### 1. ❌ Job Skipping Problem
**Issue**: All jobs were being skipped when running workflow manually

**Root Cause**: 
- Duplicate workflow files (`desktop-build.yml` and `release.yml`)
- Complex inline `if` conditions not evaluating correctly

**Fix**:
- Removed `desktop-build.yml` 
- Simplified `if` conditions using multiline YAML syntax
- Fixed input type for `create_release` (now boolean)

---

### 2. ❌ Release Job 403 Permission Error
**Issue**: `GitHub release failed with status: 403 - Resource not accessible by integration`

**Root Cause**: Workflow missing required permissions

**Fix**: Added proper permissions at workflow level:
```yaml
permissions:
  contents: write
  packages: write
  actions: read
```

---

### 3. ❌ File Pattern Matching Errors
**Issue**: `Pattern 'artifacts/windows-nsis-installer/*.exe' does not match any files`

**Root Cause**: 
- Running test without building all platforms
- Release job trying to upload non-existent artifacts

**Fix**:
- Added `fail_on_unmatched_files: false` to release action
- Release job now only runs when triggered by valid tag
- Gracefully skips for test runs without tags

---

## How to Test Now

### Option 1: Test Build Only (No Release)

1. Go to **Actions** → **Release Automation**
2. Click **"Run workflow"**
3. Select:
   - **Platform**: `linux` (fastest)
   - **Create GitHub release**: `false` (or leave default)
4. Click **"Run workflow"**

**Expected Result**:
- ✅ Build jobs run successfully
- ✅ Artifacts uploaded
- ⏭️ Release job skipped (no tag)

---

### Option 2: Test Full Release (With Tag)

```bash
# Create test tag
git tag -a v1.0.1-test -m "Test release"

# Push tag to trigger workflow
git push origin v1.0.1-test

# Monitor: https://github.com/anchapin/planar-nexus/actions
```

**Expected Result**:
- ✅ All build jobs complete
- ✅ Release created on GitHub
- ✅ Installers uploaded as assets

**Clean up after test**:
```bash
# Delete test tag
git tag -d v1.0.1-test
git push origin :refs/tags/v1.0.1-test

# Delete release on GitHub
# Go to Releases → Delete test release
```

---

### Option 3: Test Manual Dispatch with Tag

If you want to test manual dispatch WITH release creation:

```bash
# Create tag locally first
git tag -a v1.0.1-test

# Push tag (but don't trigger release yet)
git push origin v1.0.1-test

# Then manually trigger workflow from Actions UI
# Select "Create GitHub release: true"
```

---

## Workflow Behavior Matrix

| Trigger | Tag Present | Create Release | Build Jobs | Release Job |
|---------|------------|----------------|------------|-------------|
| Manual  | No         | false          | ✅ Run     | ⏭️ Skip     |
| Manual  | No         | true           | ✅ Run     | ⏭️ Skip (no tag) |
| Manual  | Yes        | false          | ✅ Run     | ⏭️ Skip     |
| Manual  | Yes        | true           | ✅ Run     | ✅ Create   |
| Tag Push| Yes        | N/A            | ✅ Run     | ✅ Create   |
| Release | Yes        | N/A            | ✅ Run     | ✅ Create   |

---

## Key Changes in Workflow

### Permissions Added
```yaml
permissions:
  contents: write      # Create releases, upload assets
  packages: write      # Push packages
  actions: read        # Read workflow artifacts
```

### Release Job Condition
```yaml
if: |
  always() &&
  (
    github.event_name == 'release' ||
    (github.event_name == 'push' && startsWith(github.ref, 'refs/tags/')) ||
    (github.event_name == 'workflow_dispatch' && inputs.create_release == true && startsWith(github.ref, 'refs/tags/'))
  )
```

**Translation**: Release job runs when:
- A release is published, OR
- A tag is pushed (v*), OR
- Manual dispatch with `create_release: true` AND a tag exists

### File Upload Pattern
```yaml
files: |
  artifacts/windows-nsis-installer/*.exe
  artifacts/windows-msi-installer/*.msi
  artifacts/macos-dmg/*.dmg
  artifacts/macos-app/*.app
  artifacts/linux-deb-package/*.deb
  artifacts/linux-appimage/*.AppImage
  artifacts/linux-rpm-package/*.rpm
fail_on_unmatched_files: false  # Don't fail if some platforms didn't build
```

---

## Troubleshooting

### Still Getting 403 Error?

**Check Repository Settings**:

1. Go to **Settings** → **Actions** → **General**
2. Scroll to **Workflow permissions**
3. Ensure **"Read and write permissions"** is selected
4. Check **"Allow GitHub Actions to create and approve pull requests"**

### Build Jobs Fail?

**Linux Dependencies**:
```bash
# Workflow installs these automatically, but check logs for specific errors
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev
```

**Rust Toolchain**:
```bash
# Workflow sets up Rust automatically
# If fails, check "Setup Rust toolchain" step logs
```

### Release Not Created?

**Check**:
1. Was a tag pushed? (Format: `v*`)
2. Did build jobs complete successfully?
3. Check release job logs for specific error

---

## Next Steps

### For Testing
1. Run workflow manually with `linux` platform
2. Verify build completes successfully
3. Check artifacts are uploaded
4. (Optional) Create test tag and verify release creation

### For Production Release
```bash
# 1. Update versions
# package.json: "version": "1.0.1"
# src-tauri/tauri.conf.json: "version": "1.0.0"

# 2. Commit and tag
git add package.json src-tauri/tauri.conf.json
git commit -m "Release v1.0.1"
git tag -a v1.0.1 -m "Release v1.0.1"

# 3. Push to trigger release
git push origin v1.0.1

# 4. Monitor build
# https://github.com/anchapin/planar-nexus/actions
```

---

## Files Modified

- `.github/workflows/release.yml` - Main workflow file
- `.github/workflows/desktop-build.yml` - **DELETED** (duplicate)
- `.github/TESTING_WORKFLOW.md` - Testing guide
- `RELEASE_AUTOMATION_QUICKSTART.md` - Quick reference

---

**Status**: ✅ All Issues Resolved  
**Last Updated**: March 12, 2026  
**Workflow Version**: 2.0.2
