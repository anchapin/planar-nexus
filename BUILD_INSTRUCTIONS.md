# Planar Nexus v1.0.0 - Production Build Instructions

**Created**: March 12, 2026  
**Version**: 1.0.0

---

## ⚠️ Build Status

**Frontend Build**: ✅ Complete  
**Tauri Desktop Builds**: Requires manual execution with sudo privileges

---

## Prerequisites

### System Requirements

**For Linux Builds**:
```bash
# Required packages (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install -y \
  libgtk-3-dev \
  libwebkit2gtk-4.0-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libglib2.0-dev \
  libjavascriptcoregtk-4.0-dev \
  libsoup-3.0-dev \
  libxdo-dev \
  libssl-dev \
  pkg-config
```

**For Windows Builds**:
- Windows 10/11 (64-bit)
- Visual Studio 2022 with C++ workload
- WebView2 (included in Windows 11, install separately for Windows 10)

**For macOS Builds**:
- macOS 10.15+ (Catalina or later)
- Xcode 14+ with command line tools
- Apple Developer ID (for code signing, optional)

### Install Rust (if not already installed)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
rustup default stable
```

### Install Node.js Dependencies

```bash
cd /home/alex/Projects/planar-nexus
npm install
```

---

## Build Instructions

### Step 1: Build Frontend (All Platforms)

```bash
npm run build
```

**Expected Output**:
- Compiled Next.js application in `.next/` directory
- Build completes in ~5-10 seconds
- No TypeScript errors

---

### Step 2: Build Desktop Installers

#### Option A: Build All Installers (Current Platform)

```bash
npm run build:tauri
```

This will create installers for your current platform in:
- `src-tauri/target/release/bundle/`

#### Option B: Platform-Specific Builds

**Windows**:
```bash
npm run build:win        # Build Windows installer (NSIS)
npm run build:win:nsis   # Explicit NSIS bundle
```

**macOS**:
```bash
npm run build:mac        # Build macOS universal binary
npm run build:mac:dmg    # DMG installer
npm run build:mac:app    # App bundle
```

**Linux**:
```bash
npm run build:linux          # Build all Linux packages
npm run build:linux:appimage # AppImage only
npm run build:linux:deb      # Debian package only
npm run build:linux:rpm      # RPM package only
```

---

## Build Output

After successful build, installers will be located in:

```
src-tauri/target/release/bundle/
├── deb/
│   └── planar-nexus_1.0.0_amd64.deb
├── appimage/
│   └── planar-nexus_1.0.0_amd64.AppImage
├── msi/ (Windows only)
│   └── Planar-Nexus_1.0.0_x64_en-US.msi
├── nsis/ (Windows only)
│   └── Planar-Nexus_1.0.0_x64-setup.exe
├── app/ (macOS only)
│   └── Planar-Nexus.app/
└── dmg/ (macOS only)
    └── Planar-Nexus_1.0.0_x64.dmg
```

---

## Known Build Issues

### Issue: Bundle Identifier Warning

```
Warn The bundle identifier "com.planarnexus.app" ends with `.app`.
This is not recommended because it conflicts with the application bundle extension on macOS.
```

**Impact**: Minor - only affects macOS bundle naming  
**Fix**: Update `src-tauri/tauri.conf.json`:

```json
{
  "identifier": "com.planarnexus.desktop"
}
```

**Priority**: Low - Scheduled for v1.0.1 patch

---

### Issue: Missing Linux Dependencies

**Error**:
```
The system library `glib-2.0` required by crate `glib-sys` was not found.
```

**Solution**:
```bash
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.0-dev libayatana-appindicator3-dev librsvg2-dev
```

---

### Issue: Code Signing (Windows/macOS)

**Windows SmartScreen Warning**:
- Unsigned Windows executables trigger SmartScreen warnings
- Users must click "More info" → "Run anyway"

**Solution**: Purchase EV code signing certificate (~$400/year)

**macOS Gatekeeper**:
- Unsigned apps may be blocked
- Right-click → Open to bypass

**Solution**: Apple Developer ID (~$100/year)

**Priority**: Low - Scheduled for v1.1

---

## Distribution Checklist

### Pre-Distribution

- [ ] Build completed successfully
- [ ] All installers generated
- [ ] Tested installers on clean VMs
- [ ] Verified app launches without errors
- [ ] Checked file sizes (should be ~15-20 MB)
- [ ] Verified icons display correctly

### GitHub Release

- [ ] Create release on GitHub
- [ ] Upload all installer files
- [ ] Add release notes
- [ ] Tag release (v1.0.0)
- [ ] Mark as latest release

### Other Distribution Channels

- [ ] Upload to website
- [ ] Submit to itch.io
- [ ] Announce on Discord/community forums
- [ ] Update README with download links

---

## Build Time Estimates

| Component | Time |
|-----------|------|
| Frontend (Next.js) | 1-2 min |
| Rust compilation | 5-10 min |
| Package bundling | 1-2 min |
| **Total** | **7-14 min** |

---

## Troubleshooting

### Build Fails with Rust Errors

```bash
# Clean build artifacts
cd src-tauri
cargo clean
cd ..

# Rebuild
npm run build:tauri
```

### Out of Disk Space

```bash
# Clean npm cache
npm cache clean --force

# Clean Rust build
cd src-tauri && cargo clean

# Remove old node_modules
rm -rf node_modules
npm install
```

### Build Succeeds but App Crashes

1. Check logs in:
   - Linux: `~/.config/planar-nexus/logs/`
   - macOS: `~/Library/Logs/Planar-Nexus/`
   - Windows: `%APPDATA%\planar-nexus\logs\`

2. Run with verbose logging:
   ```bash
   ./planar-nexus --verbose
   ```

---

## Post-Build Verification

### Test Each Installer

**Windows**:
```powershell
# Install
.\Planar-Nexus-setup.exe

# Verify installation
Test-Path "C:\Program Files\Planar Nexus\Planar-Nexus.exe"
```

**macOS**:
```bash
# Install
hdiutil attach Planar-Nexus.dmg
cp -R /Volumes/Planar-Nexus/Planar-Nexus.app /Applications/

# Verify
ls -la /Applications/Planar-Nexus.app
```

**Linux (deb)**:
```bash
# Install
sudo dpkg -i planar-nexus_1.0.0_amd64.deb

# Verify
which planar-nexus
dpkg -l | grep planar-nexus
```

### Smoke Test

1. Launch application
2. Navigate to Deck Builder
3. Search for a card
4. Add card to deck
5. Save deck
6. Navigate to Single Player
7. Launch AI opponent
8. Verify game starts

---

## Build Script (Automated)

Create `scripts/build-release.sh`:

```bash
#!/bin/bash
set -e

echo "🔨 Building Planar Nexus v1.0.0..."

# Clean previous builds
echo "Cleaning..."
rm -rf .next
cd src-tauri && cargo clean && cd ..

# Install dependencies
echo "Installing dependencies..."
npm install

# Build frontend
echo "Building frontend..."
npm run build

# Build Tauri
echo "Building Tauri installers..."
npm run build:tauri

# Verify builds
echo "Verifying builds..."
ls -lh src-tauri/target/release/bundle/*/planar-nexus*

echo "✅ Build complete!"
echo "Installers located in: src-tauri/target/release/bundle/"
```

Make executable:
```bash
chmod +x scripts/build-release.sh
```

Run:
```bash
./scripts/build-release.sh
```

---

## Release Assets Summary

| File | Platform | Size | Type |
|------|----------|------|------|
| `Planar-Nexus-setup.exe` | Windows | ~15 MB | NSIS Installer |
| `Planar-Nexus.dmg` | macOS | ~18 MB | DMG Installer |
| `planar-nexus_1.0.0_amd64.deb` | Linux | ~12 MB | Debian Package |
| `planar-nexus_1.0.0.AppImage` | Linux | ~14 MB | AppImage |

---

## Next Steps

1. ✅ Build frontend (complete)
2. ⏳ Build Tauri installers (requires sudo)
3. ⏳ Test installers on clean systems
4. ⏳ Upload to GitHub Releases
5. ⏳ Announce release

---

**Build Configuration**:
- **Version**: 1.0.0
- **Tag**: v1.0.0
- **Commit**: ee2ba15 (Add release summary)
- **Date**: March 12, 2026

---

**Note**: Full production build requires sudo privileges for Linux package installation. Please run `npm run build:tauri` manually with appropriate permissions.
