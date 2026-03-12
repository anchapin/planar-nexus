# Planar Nexus Release Automation Guide

**Created**: March 12, 2026  
**Version**: 1.0.0

---

## Overview

Planar Nexus uses GitHub Actions to automate the build and release process. This guide explains how to trigger releases and what the automation does.

---

## Automated Release Workflow

### Triggering a Release

#### Option 1: Create a Git Tag (Recommended)

```bash
# Create and push a tag
git tag -a v1.0.1 -m "Release v1.0.1 - Patch release"
git push origin v1.0.1
```

This triggers the automated release workflow which will:
1. Build installers for Windows, macOS, and Linux
2. Create a GitHub release
3. Upload all installers as release assets

#### Option 2: Use GitHub UI Workflow Dispatch

1. Go to **Actions** → **Release Automation**
2. Click **Run workflow**
3. Select the platform (all, windows, macos, linux)
4. Click **Run workflow**

#### Option 3: Publish a Release

1. Go to **Releases** → **Draft a new release**
2. Create a tag (e.g., v1.0.1)
3. Add release title and notes
4. Click **Publish release**

This triggers the full build and upload pipeline.

---

## Workflow Details

### Build Matrix

| Platform | Runner | Installers Generated |
|----------|--------|---------------------|
| Windows | `windows-latest` | `.exe` (NSIS) |
| macOS | `macos-latest` | `.dmg`, `.app` |
| Linux | `ubuntu-22.04` | `.deb`, `.AppImage` |

### Build Steps

Each platform build includes:
1. Checkout code
2. Setup Node.js 20
3. Install npm dependencies
4. Build Next.js frontend
5. Setup Rust toolchain
6. Install Tauri CLI
7. Install platform-specific dependencies
8. Build Tauri desktop app
9. Upload artifacts

### Release Steps

After all builds complete:
1. Download all artifacts
2. Create/update GitHub release
3. Upload all installers as assets
4. Generate release notes (if not provided)

---

## Required Secrets

### For Automated Releases

| Secret | Description | Required |
|--------|-------------|----------|
| `GITHUB_TOKEN` | Auto-provided by GitHub | ✅ Yes |

### For Code Signing (Optional)

| Secret | Description | Platform |
|--------|-------------|----------|
| `WINDOWS_CERTIFICATE` | Base64-encoded code signing cert | Windows |
| `WINDOWS_CERTIFICATE_PASSWORD` | Certificate password | Windows |
| `APPLE_ID` | Apple Developer ID | macOS |
| `APPLE_PASSWORD` | Apple app-specific password | macOS |
| `APPLE_TEAM_ID` | Apple Team ID | macOS |

---

## Workflow Files

### Main Release Workflow

**File**: `.github/workflows/release.yml`

**Triggers**:
- Tag push (v*)
- Release published
- Manual workflow dispatch

**Jobs**:
- `build-windows` - Windows installer
- `build-macos` - macOS app and DMG
- `build-linux` - Debian and AppImage
- `release` - Create release and upload assets

### CI Workflow

**File**: `.github/workflows/ci.yml`

**Triggers**:
- Push to main/develop
- Pull requests

**Jobs**:
- `test` - Unit tests with coverage
- `e2e` - Playwright E2E tests
- `lint` - ESLint
- `typecheck` - TypeScript validation
- `build` - Frontend build verification

---

## Release Versioning

### Semantic Versioning

Planar Nexus uses [Semantic Versioning](https://semver.org/):

```
MAJOR.MINOR.PATCH
  │     │     │
  │     │     └─ Bug fixes, test improvements
  │     └─────── New features, backward compatible
  └───────────── Breaking changes
```

### Version Examples

- `v1.0.0` - Initial release
- `v1.0.1` - Bug fix patch
- `v1.1.0` - New features (custom cards, cloud sync)
- `v2.0.0` - Breaking changes

### Tag Naming

**Format**: `v{MAJOR}.{MINOR}.{PATCH}`

**Examples**:
```bash
git tag -a v1.0.1 -m "Release v1.0.1"
git tag -a v1.1.0 -m "Release v1.1.0 - Custom cards and cloud sync"
git tag -a v2.0.0 -m "Release v2.0.0"
```

---

## Manual Build (Local)

If you prefer to build locally:

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Tauri CLI
npm install -g @tauri-apps/cli

# Install Linux dependencies (Ubuntu/Debian)
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev
```

### Build Commands

```bash
# Build all platforms (current OS only)
npm run build:tauri

# Platform-specific builds
npm run build:win      # Windows
npm run build:mac      # macOS
npm run build:linux    # Linux
```

### Output Location

```
src-tauri/target/release/bundle/
├── nsis/          # Windows installer
├── dmg/           # macOS DMG
├── app/           # macOS app bundle
├── deb/           # Linux Debian package
└── appimage/      # Linux AppImage
```

---

## Troubleshooting

### Build Fails on Linux

**Error**: Missing dependencies

**Solution**:
```bash
sudo apt-get update
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev
```

### macOS Build Fails

**Error**: Code signing issues

**Solution**:
- For development: Disable signing in `tauri.conf.json`
- For distribution: Set up Apple Developer ID secrets

### Windows Build Fails

**Error**: Rust toolchain issues

**Solution**:
```bash
rustup update stable
rustup default stable
```

### Release Upload Fails

**Error**: Asset already exists

**Solution**:
- Delete existing assets from the release
- Or create a new tag/version

---

## Release Checklist

### Pre-Release

- [ ] All tests passing
- [ ] CHANGELOG.md updated
- [ ] Version bumped in `package.json`
- [ ] Version bumped in `src-tauri/tauri.conf.json`
- [ ] Git tag created and pushed

### Post-Release

- [ ] Verify all installers uploaded
- [ ] Test download links
- [ ] Announce release (Discord, Twitter, etc.)
- [ ] Update website download links
- [ ] Close associated GitHub issues

---

## Example Release Commands

### Full Release Process

```bash
# 1. Update version in package.json
npm version patch  # or minor, or major

# 2. Create annotated tag
git tag -a v1.0.1 -m "Release v1.0.1 - Bug fix patch"

# 3. Push tag to trigger release workflow
git push origin v1.0.1

# 4. Monitor GitHub Actions
# Go to: https://github.com/anchapin/planar-nexus/actions
```

### Manual Workflow Dispatch

```bash
# Just push your changes
git push origin main

# Then trigger workflow from GitHub UI
```

---

## Monitoring Builds

### GitHub Actions

View build progress: https://github.com/anchapin/planar-nexus/actions

### Build Notifications

Enable notifications:
1. Go to repository **Settings**
2. Click **Notifications**
3. Enable **Actions** notifications

### Build Artifacts

After successful build:
- Artifacts available for 30 days
- Download from workflow run page
- Release assets available permanently

---

## Advanced Configuration

### Custom Build Matrix

To add new platforms, edit `.github/workflows/release.yml`:

```yaml
build-new-platform:
  name: Build New Platform
  runs-on: [self-hosted, linux]
  steps:
    # ... your build steps
```

### Custom Release Notes

Add `RELEASE_NOTES.md` to repository root for automatic inclusion.

### Skip CI

Add `[skip ci]` to commit message to skip workflows:

```bash
git commit -m "Update docs [skip ci]"
```

---

## Support

For issues with the release workflow:
1. Check [GitHub Actions logs](https://github.com/anchapin/planar-nexus/actions)
2. Review [Tauri documentation](https://tauri.app/)
3. Open an issue on GitHub

---

**Last Updated**: March 12, 2026  
**Workflow Version**: 2.0.0
