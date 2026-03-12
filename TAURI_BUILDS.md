# Planar Nexus Desktop Builds

This document provides instructions for building Planar Nexus desktop applications for Windows, macOS, and Linux using Tauri.

## Prerequisites

### All Platforms
- Node.js 18+ and npm
- Rust and Cargo (latest stable)
- Tauri CLI: `npm install -g @tauri-apps/cli`

### Windows
- Windows 10 SDK or later
- Visual Studio 2022 with "Desktop development with C++" workload
- WebView2 (automatically installed by installer)

### macOS
- Xcode 12+ and Command Line Tools
- macOS 10.15 (Catalina) or later
- For universal binaries: Rust targets for both x86_64 and aarch64

### Linux
- Build essentials: `sudo apt install build-essential libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`
- For RPM builds: `rpm-build`

## Build Commands

### Windows

```bash
# Build Windows installer (NSIS)
npm run build:win

# Build NSIS installer only
npm run build:win:nsis
```

**Output:** `src-tauri/target/release/bundle/nsis/Planar-Nexus_*.exe`

**Features:**
- Per-machine installation
- Desktop and Start Menu shortcuts
- Uninstaller included
- Automatic WebView2 installation

### macOS

```bash
# Build universal binary (Intel + Apple Silicon)
npm run build:mac

# Build DMG installer
npm run build:mac:dmg

# Build .app bundle
npm run build:mac:app
```

**Output:**
- DMG: `src-tauri/target/universal-apple-darwin/release/bundle/dmg/Planar-Nexus_*.dmg`
- App: `src-tauri/target/universal-apple-darwin/release/bundle/macos/Planar-Nexus.app`

**Features:**
- Universal binary (Intel + Apple Silicon)
- macOS 10.15+ compatibility
- Hardened runtime enabled
- Entitlements for network access

### Linux

```bash
# Build all Linux formats
npm run build:linux

# Build AppImage only
npm run build:linux:appimage

# Build DEB package (Debian/Ubuntu)
npm run build:linux:deb

# Build RPM package (Fedora/RHEL)
npm run build:linux:rpm
```

**Output:**
- AppImage: `src-tauri/target/release/bundle/appimage/Planar-Nexus_*.AppImage`
- DEB: `src-tauri/target/release/bundle/deb/planar-nexus_*.deb`
- RPM: `src-tauri/target/release/bundle/rpm/planar-nexus-*.rpm`

## Development Mode

To run the app in development mode with hot reload:

```bash
npm run dev:tauri
```

## Code Signing (Production)

### Windows

To enable code signing, update `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": "YOUR_THUMBPRINT",
      "timestampUrl": "http://timestamp.digicert.com"
    }
  }
}
```

### macOS

For distribution outside the App Store:

1. Get an Apple Developer Certificate
2. Update `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: Your Name",
      "hardenedRuntime": true,
      "entitlements": "entitlements.plist"
    }
  }
}
```

3. Notarize the app after building:

```bash
xcrun notarytool submit src-tauri/target/release/bundle/macos/Planar-Nexus.app \
  --apple-id "your@email.com" \
  --password "app-specific-password" \
  --team-id "YOUR_TEAM_ID"
```

## Troubleshooting

### Build fails with "WebView2 not found"

Install WebView2 from: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

### macOS build fails with "codesign failed"

Ensure Xcode command line tools are installed:
```bash
xcode-select --install
```

### Linux build fails with missing dependencies

Install required packages:
```bash
# Debian/Ubuntu
sudo apt install build-essential libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora/RHEL
sudo dnf install webkit2gtk4.1-devel openssl-devel gtk3-devel libappindicator3-devel librsvg2-devel
```

## File Sizes

Expected bundle sizes (may vary):

- **Windows:** ~15-20 MB (installer)
- **macOS:** ~25-30 MB (universal binary)
- **Linux AppImage:** ~20-25 MB
- **Linux DEB/RPM:** ~18-22 MB

## Distribution

### Windows
Distribute the `.exe` installer from `src-tauri/target/release/bundle/nsis/`

### macOS
Distribute the `.dmg` file from `src-tauri/target/universal-apple-darwin/release/bundle/dmg/`

### Linux
- **AppImage:** Works on most modern Linux distributions
- **DEB:** For Debian, Ubuntu, and derivatives
- **RPM:** For Fedora, RHEL, CentOS, and derivatives

## Version Updates

The app version is defined in `src-tauri/tauri.conf.json`:

```json
{
  "version": "0.1.0"
}
```

Update this before each release build.
