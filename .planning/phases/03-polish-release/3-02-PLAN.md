# Plan 3.2: Tauri Release Builds

## Objective
Create production-ready, signed installers for Windows, macOS, and Linux platforms.

## Why This Matters
- Users need native desktop applications (REQ-T3)
- Signed installers build trust and avoid security warnings
- Auto-updates enable seamless patch delivery
- Cross-platform support expands user base

---

## Tasks

### Task 3.2.1: Audit Current Tauri Configuration
**Type**: research
**Duration**: ~45 min

**Actions**:
1. Read `src-tauri/tauri.conf.json`:
   - Current bundle configuration
   - Identifier and version
   - Build settings

2. Read `src-tauri/Cargo.toml`:
   - Tauri version
   - Dependencies
   - Build features

3. Check current build status:
```bash
cd src-tauri
cargo tauri build
# Document any errors
```

4. Review platform-specific requirements:
   - Windows: Code signing, MSI vs EXE
   - macOS: Code signing, notarization, DMG
   - Linux: AppImage, deb, rpm

**Deliverable**: Configuration audit document showing:
- Current Tauri version
- Missing configurations
- Platform-specific requirements

---

### Task 3.2.2: Configure Production Build Settings
**Type**: auto
**Duration**: ~60 min

**Actions**:
1. Update `src-tauri/tauri.conf.json`:
```json
{
  "identifier": "com.planarnexus.app",
  "version": "1.0.0",
  "bundle": {
    "active": true,
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "windows": {
      "wix": null,
      "nsis": {
        "installMode": "currentUser"
      }
    },
    "macOS": {
      "entitlements": null,
      "exceptionDomain": "",
      "frameworks": [],
      "providerShortName": null,
      "signingIdentity": "Developer ID Application: Your Name"
    },
    "linux": {
      "deb": {
        "depends": []
      },
      "appImage": {
        "bundleMediaFramework": true
      }
    }
  }
}
```

2. Update app version to 1.0.0
3. Configure bundle identifiers
4. Set up platform-specific options

**Verification**:
```bash
cargo tauri build
# Build completes without configuration errors
```

---

### Task 3.2.3: Set Up Code Signing (Windows)
**Type**: checkpoint:human-action
**Duration**: ~30 min (plus certificate procurement time)

**Decision**: Obtain Windows code signing certificate

**Options**:

**Option A: Commercial Certificate (~$100-400/year)**
- Providers: DigiCert, Sectigo, GlobalSign
- Pros: Widely trusted, no SmartCard required
- Cons: Annual cost, identity verification

**Option B: EV Certificate (~$300-600/year)**
- Providers: DigiCert, Sectigo
- Pros: Immediate SmartScreen reputation
- Cons: Higher cost, SmartCard required

**Option C: Skip for initial release**
- Pros: No cost
- Cons: SmartScreen warnings, reduced trust

**Recommendation**: Option A for v1.0, consider EV for v1.1

**Resume Signal**: "Have Windows certificate" / "Skipping for now"

---

### Task 3.2.4: Set Up Code Signing (macOS)
**Type**: checkpoint:human-action
**Duration**: ~60 min (plus Apple Developer enrollment)

**Decision**: Enroll in Apple Developer Program

**Requirements**:
1. Apple Developer account ($99/year)
2. Developer ID Application certificate
3. Notarization credentials

**Steps**:
1. Enroll at https://developer.apple.com
2. Create Developer ID Application certificate:
   - Generate CSR with Keychain Access
   - Upload to Apple Developer portal
   - Download and install certificate
3. Create notary tool credentials:
   - Generate app-specific password
   - Store in keychain

**Resume Signal**: "Have macOS certificates" / "Skipping notarization"

---

### Task 3.2.5: Configure Windows Build
**Type**: auto
**Duration**: ~60 min

**Actions**:
1. Install Windows build tools:
```bash
# On Windows
npm install -g windows-build-tools
```

2. Configure NSIS installer:
```json
"nsis": {
  "installerIcon": "icons/icon.ico",
  "headerImage": "icons/header.bmp",
  "sidebarImage": "icons/sidebar.bmp",
  "license": "LICENSE",
  "oneClick": false,
  "allowToChangeInstallationDirectory": true
}
```

3. Configure code signing (if certificate available):
```json
"sign": {
  "args": ["-fd", "SHA256", "-t", "http://timestamp.digicert.com", "-f", "$env:CERTIFICATE_FILE", "$env:CERTIFICATE_NAME"]
}
```

4. Build Windows installer:
```bash
cargo tauri build --target x86_64-pc-windows-msvc
```

**Verification**:
- `.exe` or `.msi` created in `src-tauri/target/release/bundle/`
- Installer runs without errors
- No SmartScreen warnings (if signed)

---

### Task 3.2.6: Configure macOS Build
**Type**: auto
**Duration**: ~90 min

**Actions**:
1. Install Xcode command line tools:
```bash
xcode-select --install
```

2. Configure macOS signing:
```json
"macOS": {
  "frameworks": [],
  "minimumSystemVersion": "10.13",
  "signingIdentity": "Developer ID Application: Your Name",
  "entitlements": "src-tauri/entitlements.plist",
  "providerShortName": "YOUR_SHORT_NAME"
}
```

3. Create `entitlements.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
</dict>
</plist>
```

4. Build and notarize:
```bash
cargo tauri build --target x86_64-apple-darwin
cargo tauri build --target aarch64-apple-darwin

# Notarize
xcrun notarytool submit src-tauri/target/release/bundle/macos/PlanarNexus.app \
  --apple-id "your@email.com" \
  --password "app-specific-password" \
  --team-id "YOUR_TEAM_ID" \
  --wait
```

**Verification**:
- `.dmg` created in `src-tauri/target/release/bundle/macos/`
- App opens without security warnings
- Notarization successful

---

### Task 3.2.7: Configure Linux Build
**Type**: auto
**Duration**: ~60 min

**Actions**:
1. Install Linux build dependencies:
```bash
# Ubuntu/Debian
sudo apt-get install -y libwebkit2gtk-4.0-dev libappindicator3-dev librsvg2-dev patchelf

# Fedora
sudo dnf install -y webkit2gtk3-devel libappindicator-gtk3-devel librsvg2-devel
```

2. Configure deb package:
```json
"linux": {
  "deb": {
    "depends": ["libwebkit2gtk-4.0-37", "libappindicator3-1"],
    "files": {"/usr/share/applications/com.planarnexus.app.desktop": "planar-nexus.desktop"}
  }
}
```

3. Configure AppImage:
```json
"appImage": {
  "bundleMediaFramework": true,
  "files": {}
}
```

4. Build Linux packages:
```bash
cargo tauri build --target x86_64-unknown-linux-gnu
```

**Verification**:
- `.deb` created in `src-tauri/target/release/bundle/deb/`
- `.AppImage` created in `src-tauri/target/release/bundle/appimage/`
- Packages install and run correctly

---

### Task 3.2.8: Set Up Auto-Update
**Type**: auto
**Duration**: ~60 min

**Actions**:
1. Configure Tauri updater in `tauri.conf.json`:
```json
"updater": {
  "active": true,
  "dialog": true,
  "endpoints": [
    "https://github.com/your-org/planar-nexus/releases/latest/download/latest.json"
  ],
  "pubkey": "YOUR_PUBLIC_KEY"
}
```

2. Generate update signature:
```bash
cargo install cargo-tauri
cargo tauri signer generate
# Save the private key securely
# Add public key to tauri.conf.json
```

3. Create release manifest (`latest.json`):
```json
{
  "version": "1.0.0",
  "notes": "Initial release",
  "pub_date": "2026-03-12T00:00:00Z",
  "platforms": {
    "windows": {
      "url": "https://github.com/your-org/planar-nexus/releases/download/v1.0.0/PlanarNexus_1.0.0_x64.msi",
      "signature": "SIGNATURE"
    },
    "macos": {
      "url": "https://github.com/your-org/planar-nexus/releases/download/v1.0.0/PlanarNexus_1.0.0_x64.dmg",
      "signature": "SIGNATURE"
    },
    "linux": {
      "url": "https://github.com/your-org/planar-nexus/releases/download/v1.0.0/planar-nexus_1.0.0_amd64.deb",
      "signature": "SIGNATURE"
    }
  }
}
```

**Verification**:
- Update check works in app
- Update downloads correctly
- Update installs without errors

---

### Task 3.2.9: Test Installation Flows
**Type**: checkpoint:human-verify
**Duration**: ~60 min

**What Built**: Installers for all platforms

**How to Verify**:

**Windows**:
1. Download `.exe` or `.msi` installer
2. Run installer
3. Verify app installs to Program Files
4. Launch app from Start menu
5. Verify no SmartScreen warnings (if signed)

**macOS**:
1. Download `.dmg`
2. Mount DMG, drag to Applications
3. Launch app
4. Verify no security warnings (if notarized)
5. Check app runs correctly

**Linux**:
1. Download `.deb` or `.AppImage`
2. Install: `sudo dpkg -i planar-nexus_1.0.0_amd64.deb`
3. Launch from applications menu
4. Verify app runs correctly

**Resume Signal**: Paste installation results:
```
Windows: ✓/✗ Issues: ...
macOS: ✓/✗ Issues: ...
Linux: ✓/✗ Issues: ...
```

---

### Task 3.2.10: Create Release Assets
**Type**: auto
**Duration**: ~30 min

**Actions**:
1. Prepare release artifacts:
   - Windows: `.exe` or `.msi`
   - macOS: `.dmg` (Intel + Apple Silicon)
   - Linux: `.deb`, `.AppImage`
   - Checksums file

2. Generate checksums:
```bash
sha256sum PlanarNexus_* > SHA256SUMS.txt
```

3. Create release notes template:
```markdown
## Planar Nexus v1.0.0

### Features
- Deck builder with card search and validation
- AI coach with archetype detection and synergy analysis
- AI opponent with 4 difficulty levels
- Import/export decklists

### Installation
- Windows: Download and run `.msi` installer
- macOS: Download `.dmg`, drag to Applications
- Linux: Download `.deb` or `.AppImage`

### Known Issues
- [List any known issues]
```

**Verification**:
- All artifacts present
- Checksums match
- Release notes complete

---

## Success Criteria

✅ Windows installer builds and runs
✅ macOS installer builds, signs, and notarizes
✅ Linux packages (.deb, .AppImage) build and run
✅ Code signing configured (if certificates available)
✅ Auto-update configured
✅ Release artifacts prepared
✅ Installation tested on all platforms

---

## Dependencies

- Requires: Plan 3.1 (tests passing)
- Requires: Code signing certificates (Windows, macOS)
- Unblocks: Plan 3.4 (Bug Bash uses production builds)

---

## Risks

| Risk | Mitigation |
|------|------------|
| Code signing expensive | Skip for initial release, add later |
| Notarization rejected | Test with test certificate first |
| Linux fragmentation | Focus on deb + AppImage initially |
| Build failures on CI | Build locally first, document requirements |

---

**Created**: 2026-03-12
**Estimated Duration**: 8-10 hours
