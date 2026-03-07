# Platform Build Configuration

This document outlines the build configuration for Planar Nexus desktop and mobile applications.

## Desktop Builds (Tauri)

### Windows
- **Installer**: NSIS (.exe)
- **Signing**: Optional (code signing recommended)
- **Requirements**: Windows 10+, Rust toolchain

```bash
# Build locally
npm run tauri build -- --target x86_64-pc-windows-msvc
```

### macOS
- **Installer**: DMG (.dmg) and App bundle (.app)
- **Signing**: Apple Developer ID required for distribution
- **Requirements**: macOS 10.15+, Xcode, Rust toolchain

```bash
# Build locally
npm run tauri build -- --target x86_64-apple-darwin
npm run tauri build -- --target aarch64-apple-darwin
```

### Linux
- **Installers**: AppImage (.AppImage), DEB (.deb), RPM (.rpm)
- **Signing**: Optional
- **Requirements**: Ubuntu 22.04+, Rust toolchain

```bash
# Build locally
npm run tauri build -- --target x86_64-unknown-linux-gnu
```

## Mobile Builds (Tauri)

### iOS
- **Requirements**: macOS with Xcode, Apple Developer account
- **Signing**: Apple Developer certificates required
- **Build targets**: iPhone, iPad

### Android
- **APK/AAB**: Debug and release builds
- **Signing**: Google Play signing required for release
- **Requirements**: Android SDK, Java JDK 17+

## CI/CD Configuration

GitHub Actions workflows are configured in `.github/workflows/`:

- `desktop-build.yml`: Builds desktop installers for all platforms
  - Triggered on release publication or manual dispatch
  - Automatically creates GitHub Releases with artifacts

### Setting Up Code Signing

#### Windows
1. Obtain a code signing certificate
2. Add certificate to GitHub secrets
3. Update `tauri.conf.json` with certificate thumbprint

#### macOS
1. Create Apple Developer account
2. Generate signing certificates
3. Add to GitHub secrets:
   - `APPLE_SIGNING_IDENTITY`
   - `APPLE_PROVIDER_SHORT_NAME`
4. Update `tauri.conf.json` with signing identity

#### Google Play
1. Create Google Play Developer account
2. Generate signing key
3. Add to GitHub secrets:
   - `ANDROID_KEYSTORE`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`
4. Configure in Google Play Console

## Environment Variables

Required for builds:
- `NODE_ENV=production` - For production Next.js builds

Optional for code signing:
- Platform-specific signing credentials

## Distribution

### GitHub Releases
Desktop builds are automatically published to GitHub Releases when a new release is created.

### App Stores
- **macOS App Store**: Requires additional App Store specific configuration
- **Google Play**: Requires Play App Signing configuration
