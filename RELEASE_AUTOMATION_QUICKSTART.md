# 🚀 Planar Nexus - Release Automation Quick Start

**Created**: March 12, 2026  
**Workflow Version**: 2.0.0

---

## Quick Start: Create a Release

### Option 1: Push a Tag (Recommended)

```bash
# 1. Update version in package.json and tauri.conf.json
# 2. Commit your changes
git add package.json src-tauri/tauri.conf.json
git commit -m "Bump version to 1.0.1"

# 3. Create an annotated tag
git tag -a v1.0.1 -m "Release v1.0.1 - Bug fix patch"

# 4. Push the tag to trigger automated release
git push origin v1.0.1
```

**What happens next**:
1. ✅ GitHub Actions starts building installers
2. ✅ Windows, macOS, and Linux builds run in parallel
3. ✅ After ~15-20 minutes, installers are uploaded to GitHub Releases
4. ✅ Release is automatically published

**Monitor progress**: https://github.com/anchapin/planar-nexus/actions

---

### Option 2: Use GitHub Actions UI

1. Go to **Actions** tab
2. Click **Release Automation** workflow
3. Click **Run workflow**
4. Select options:
   - Platform: `all` (or specific platform)
   - Create release: `true`
5. Click **Run workflow**

---

### Option 3: Publish a GitHub Release

1. Go to **Releases** → **Draft a new release**
2. Create a new tag (e.g., `v1.0.1`)
3. Add release title and notes
4. Click **Publish release**
5. Workflow automatically builds and uploads installers

---

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Release Triggered                         │
│            (Tag Push / Release / Manual)                     │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
  │   Windows    │    │    macOS     │    │    Linux     │
  │   Build      │    │    Build     │    │    Build     │
  │              │    │              │    │              │
  │  • .exe      │    │  • .dmg      │    │  • .deb      │
  │  • .msi      │    │  • .app      │    │  • .AppImage │
  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                              ▼
                   ┌──────────────────┐
                   │  Create Release  │
                   │                  │
                   │  • Upload .exe   │
                   │  • Upload .dmg   │
                   │  • Upload .deb   │
                   │  • Upload others │
                   └──────────────────┘
                              │
                              ▼
                   ┌──────────────────┐
                   │  Release Live!   │
                   │  Ready to download│
                   └──────────────────┘
```

---

## Build Times (Estimated)

| Platform | Build Time |
|----------|-----------|
| Windows | ~10-15 min |
| macOS | ~12-18 min |
| Linux | ~8-12 min |
| **Total** | **~15-20 min** (parallel) |

---

## Required Secrets (Optional)

The workflow works without any secrets for basic builds. For code signing:

### Windows Code Signing
```bash
# In GitHub Settings → Secrets → Actions
TAURI_SIGNING_PRIVATE_KEY=<your key>
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<password>
```

### macOS Code Signing
```bash
# In GitHub Settings → Secrets → Actions
APPLE_ID=<your Apple ID>
APPLE_PASSWORD=<app-specific password>
APPLE_TEAM_ID=<your Team ID>
TAURI_SIGNING_PRIVATE_KEY=<your key>
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<password>
```

---

## Downloading Installers

### From GitHub Releases

1. Go to https://github.com/anchapin/planar-nexus/releases
2. Find the latest release
3. Download installer for your platform:
   - **Windows**: `Planar-Nexus_1.0.1_x64-setup.exe`
   - **macOS**: `Planar-Nexus_1.0.1_x64.dmg`
   - **Linux**: `planar-nexus_1.0.1_amd64.deb` or `.AppImage`

### From Workflow Artifacts (Before Release)

1. Go to the workflow run in Actions
2. Scroll to **Artifacts** section
3. Download desired artifact
4. Extract and install

**Note**: Artifacts expire after 30 days.

---

## Troubleshooting

### Build Fails on Linux

**Error**: Missing dependencies

**Solution**: The workflow installs all required dependencies automatically. If it still fails, check the workflow logs for specific errors.

### macOS Build Fails with Signing Error

**Error**: Code signing failed

**Solution**:
- For testing: Remove signing secrets, build will be unsigned
- For production: Verify Apple Developer credentials are correct

### Release Already Exists

**Error**: Asset already exists

**Solution**:
1. Go to the release
2. Delete existing assets
3. Re-run the workflow

Or create a new tag/version.

### Workflow Doesn't Trigger

**Check**:
- Tag format is correct (`v1.0.1` not `1.0.1`)
- Tag was pushed (not just created locally)
- Workflow is not disabled

---

## Manual Build (Local Alternative)

If you prefer to build locally:

```bash
# Install dependencies
npm install

# Build frontend
npm run build

# Build Tauri (current platform only)
npm run build:tauri

# Or platform-specific
npm run build:win      # Windows
npm run build:mac      # macOS
npm run build:linux    # Linux
```

Installers will be in: `src-tauri/target/release/bundle/`

---

## Version Numbering

Follow [Semantic Versioning](https://semver.org/):

```
v1.0.0  → Initial release
v1.0.1  → Bug fix patch
v1.1.0  → New features
v2.0.0  → Breaking changes
```

Update version in:
- `package.json`
- `src-tauri/tauri.conf.json`
- Git tag

---

## Release Checklist

### Before Release
- [ ] All tests passing (`npm test`, `npm run test:e2e`)
- [ ] No TypeScript errors (`npm run typecheck`)
- [ ] No ESLint errors (`npm run lint`)
- [ ] Version bumped in `package.json`
- [ ] Version bumped in `tauri.conf.json`
- [ ] CHANGELOG.md updated
- [ ] Git tag created

### After Release
- [ ] Verify all installers uploaded
- [ ] Test download links
- [ ] Test installers on clean systems
- [ ] Announce release (Discord, Twitter, etc.)
- [ ] Update website download links
- [ ] Close associated GitHub issues

---

## Monitoring Builds

### GitHub Actions Dashboard
https://github.com/anchapin/planar-nexus/actions

### Enable Notifications
1. Go to repository **Settings**
2. Click **Notifications**
3. Enable **Actions** notifications
4. Choose email or web notifications

### Build Logs
- Click on workflow run
- Expand job to see steps
- Click on step to see detailed logs

---

## Advanced Usage

### Skip CI
Add `[skip ci]` to commit message to skip workflows:
```bash
git commit -m "Update docs [skip ci]"
```

### Build Specific Platform Only
Use workflow dispatch and select platform:
- `windows` - Only Windows build
- `macos` - Only macOS build
- `linux` - Only Linux build
- `all` - All platforms (default)

### Draft Release
To create a draft release for review:
1. Run workflow with `create_release: true`
2. Workflow creates published release
3. Manually convert to draft if needed

Or set `draft: true` in workflow (requires editing).

---

## Support

**Documentation**:
- [RELEASE_AUTOMATION.md](.github/RELEASE_AUTOMATION.md) - Full documentation
- [BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md) - Local build guide

**Issues**:
- [GitHub Issues](https://github.com/anchapin/planar-nexus/issues)

**Discussions**:
- [GitHub Discussions](https://github.com/anchapin/planar-nexus/discussions)

---

## Example Release Session

```bash
# 1. Make your changes
git add src/some-fix.ts
git commit -m "Fix critical bug #123"

# 2. Bump version
npm version patch  # Updates package.json, creates git tag

# 3. Update tauri.conf.json manually
# Change "version": "1.0.1"

# 4. Commit version bump
git add src-tauri/tauri.conf.json
git commit -m "Bump Tauri version to 1.0.1"

# 5. Push tag to trigger release
git push origin v1.0.1

# 6. Watch the magic happen! 🎉
# Open: https://github.com/anchapin/planar-nexus/actions
```

---

**Happy Releasing! 🚀**
