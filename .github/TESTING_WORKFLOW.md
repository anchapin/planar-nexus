# Testing the Release Workflow

**Updated**: March 12, 2026

---

## ✅ What Was Fixed

The workflow was skipping jobs due to:
1. **Duplicate workflow files** - `desktop-build.yml` and `release.yml` had conflicting triggers
2. **Complex `if` conditions** - Inline boolean expressions were not evaluating correctly
3. **Input type issues** - `create_release` was string, now boolean

**Fixes applied**:
- Removed `desktop-build.yml`
- Simplified `if` conditions using multiline YAML syntax
- Fixed input types in `workflow_dispatch`

---

## How to Test the Workflow

### Option 1: Manual Dispatch (Recommended for Testing)

1. **Go to Actions tab**
   - https://github.com/anchapin/planar-nexus/actions

2. **Select "Release Automation" workflow**
   - Click on the workflow name in the left sidebar

3. **Click "Run workflow" button**
   - Blue button on the right side

4. **Configure the run**:
   ```
   Platform: linux (fastest for testing)
   Create GitHub release: true (or false for test run)
   ```

5. **Click "Run workflow"**

6. **Watch the build progress**
   - Should take ~10-15 minutes for Linux
   - All jobs should run (not skip)

---

### Option 2: Push a Test Tag

```bash
# Create a test tag
git tag -a v1.0.1-test -m "Test release v1.0.1-test"

# Push tag to trigger workflow
git push origin v1.0.1-test

# Monitor: https://github.com/anchapin/planar-nexus/actions
```

**After testing, delete the tag**:
```bash
# Delete local tag
git tag -d v1.0.1-test

# Delete remote tag
git push origin :refs/tags/v1.0.1-test

# Delete release if created
# Go to Releases → v1.0.1-test → Delete
```

---

## Expected Behavior

### ✅ Workflow Runs Successfully

**Jobs should execute in this order**:

1. `build-linux` (ubuntu-22.04) - ~8-12 min
2. `build-macos` (macos-latest) - ~12-18 min
3. `build-windows` (windows-latest) - ~10-15 min
4. `release` (ubuntu-latest) - ~1-2 min

**All jobs should show**:
- ✅ Green checkmark when complete
- "Upload artifact" steps should succeed
- Release job should upload installers

---

### ❌ Jobs Are Skipped

**If you see "Job skipped"**:

1. **Check workflow trigger**:
   - Manual dispatch: Ensure you clicked "Run workflow"
   - Tag push: Verify tag format is `v*` (e.g., `v1.0.1`)

2. **Check job `if` conditions**:
   - Click on skipped job
   - Look at "Setup job" step
   - Verify `if` expression evaluated to `true`

3. **Check workflow file**:
   - Ensure latest version is pushed
   - Check for YAML syntax errors

---

## Troubleshooting

### All Jobs Skipped

**Cause**: Workflow trigger not recognized

**Solution**:
1. Go to Actions → Release Automation
2. Click "Run workflow" manually
3. If still skipped, check workflow file syntax

### Single Job Skipped

**Cause**: Platform filter in `if` condition

**Solution**:
- For manual dispatch, select `all` or specific platform
- Check `inputs.platform` value in workflow run

### Build Fails

**Common issues**:

**Linux**: Missing dependencies
```
Solution: Workflow installs all required packages automatically
Check: "Install Linux system dependencies" step logs
```

**macOS**: Code signing errors
```
Solution: Build without signing secrets for testing
Secrets are optional - unsigned builds work fine
```

**Windows**: Rust toolchain issues
```
Solution: Workflow sets up Rust automatically
Check: "Setup Rust toolchain" step completed
```

### Release Job Fails

**Asset already exists**:
```
Solution: Delete existing release and assets
Then re-run workflow
```

**No artifacts found**:
```
Solution: Check build jobs completed successfully
Verify artifact names match in release job
```

---

## Quick Test Checklist

- [ ] Go to Actions tab
- [ ] Click "Release Automation" workflow
- [ ] Click "Run workflow" button
- [ ] Select `linux` platform (fastest)
- [ ] Set `create_release: true`
- [ ] Click "Run workflow"
- [ ] Verify all jobs start running (not skipped)
- [ ] Wait for build to complete (~15 min)
- [ ] Check artifacts uploaded
- [ ] Verify release created (if enabled)

---

## After Successful Test

### Clean Up Test Release

```bash
# Delete test tag locally
git tag -d v1.0.1-test

# Delete test tag from remote
git push origin :refs/tags/v1.0.1-test

# Delete release on GitHub
# Go to Releases → Delete test release
```

### Ready for Production

Once test passes, you're ready to release:

```bash
# Create real release tag
git tag -a v1.0.1 -m "Release v1.0.1"

# Push to trigger release
git push origin v1.0.1

# Monitor: https://github.com/anchapin/planar-nexus/actions
```

---

## Workflow Status Indicators

| Icon | Status | Meaning |
|------|--------|---------|
| ⏱️ | Queued | Waiting for runner |
| 🔄 | In Progress | Currently running |
| ✅ | Success | Completed successfully |
| ❌ | Failed | Error occurred |
| ⏭️ | Skipped | Job was skipped |

---

## Monitor Build Progress

**Real-time logs**:
1. Click on workflow run
2. Click on individual job
3. Expand steps to see detailed logs

**Build artifacts**:
1. Scroll to bottom of workflow run
2. Look for "Artifacts" section
3. Download to inspect (available 30 days)

**Release assets**:
1. Go to Releases tab
2. Find latest release
3. Download installers

---

## Need Help?

**Check workflow logs**:
- https://github.com/anchapin/planar-nexus/actions

**Review workflow file**:
- `.github/workflows/release.yml`

**Documentation**:
- `RELEASE_AUTOMATION_QUICKSTART.md`
- `.github/RELEASE_AUTOMATION.md`

**Create an issue**:
- https://github.com/anchapin/planar-nexus/issues

---

**Last Updated**: March 12, 2026  
**Workflow Version**: 2.0.1 (fixed skipping issues)
