# Deployment Guide for Planar Nexus

This guide covers all aspects of deploying Planar Nexus to various platforms including desktop, mobile, and web.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Web Deployment](#web-deployment)
- [Desktop Deployment](#desktop-deployment)
- [Mobile Deployment](#mobile-deployment)
- [CI/CD Pipeline](#cicd-pipeline)
- [Release Process](#release-process)
- [Version Management](#version-management)
- [Troubleshooting](#troubleshooting)

## Overview

Planar Nexus is built with Next.js (web) and Tauri (desktop/mobile). The application uses:

- **Next.js 15** for the web application
- **Tauri 2** for cross-platform desktop applications
- **Tauri Mobile** for iOS and Android applications
- **GitHub Actions** for automated CI/CD

### Deployment Targets

| Platform | Build System | Distribution |
|----------|-------------|--------------|
| Web | Next.js | Static hosting (Vercel, Netlify, etc.) |
| Windows | Tauri | NSIS installer (.exe) |
| macOS | Tauri | DMG (.dmg) and App bundle (.app) |
| Linux | Tauri | AppImage (.AppImage), DEB (.deb), RPM (.rpm) |
| iOS | Tauri Mobile | IPA file, App Store |
| Android | Tauri Mobile | APK file, Google Play Store |

## Prerequisites

### Common Requirements

- Node.js 20 or higher
- npm or yarn package manager
- Git

### Platform-Specific Requirements

#### Desktop Builds
- **Windows**: Windows 10+, Visual Studio Build Tools, Rust toolchain
- **macOS**: macOS 10.15+, Xcode, Rust toolchain
- **Linux**: Ubuntu 22.04+ or equivalent, Rust toolchain, webkit2gtk

#### Mobile Builds
- **iOS**: macOS with Xcode 15+, Apple Developer account, CocoaPods
- **Android**: Android SDK, Java JDK 17+, Android Studio

## Web Deployment

Planar Nexus can be deployed as a static web application. The app is designed to work entirely in the browser with no server-side dependencies.

### Building for Production

```bash
# Install dependencies
npm install

# Build the Next.js application
NODE_ENV=production npm run build

# Start the production server (optional)
npm start
```

### Static Export

The application uses dynamic Next.js output mode to support local storage and WebRTC. For static hosting:

```bash
# Build the application
NODE_ENV=production npm run build

# The build output is in .next/
# Deploy the .next directory or use Next.js hosting
```

### Deployment Options

#### 1. Vercel (Recommended)

Vercel provides the best integration with Next.js:

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel
```

#### 2. Netlify

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Build and deploy
netlify deploy --prod
```

#### 3. Static Hosting (GitHub Pages, Cloudflare Pages, etc.)

For static hosting services, configure build settings:

- **Build command**: `npm run build`
- **Publish directory**: `.next` (or configure for static export)
- **Node version**: `20`

### Environment Variables

No required environment variables for web deployment. The app is fully client-side.

### Post-Deployment Checklist

- [ ] Test application loads correctly
- [ ] Verify deck builder functionality
- [ ] Test AI features (requires user API keys)
- [ ] Test multiplayer signaling
- [ ] Verify PWA/service worker functionality

## Desktop Deployment

Desktop applications are built using Tauri, which wraps the Next.js application in a native window.

### Building Locally

#### Windows

```bash
# Install dependencies
npm install

# Build Windows installer
npm run build:tauri

# Output: src-tauri/target/release/bundle/nsis/Planar-Nexus-setup.exe
```

#### macOS

```bash
# Install dependencies
npm install

# Build macOS app
npm run build:tauri

# Output: src-tauri/target/release/bundle/macos/Planar Nexus.app
# Also creates: src-tauri/target/release/bundle/macos/Planar Nexus.dmg
```

#### Linux

```bash
# Install dependencies
npm install

# Install required system packages
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

# Build Linux packages
npm run build:tauri

# Output:
# - src-tauri/target/release/bundle/appimage/Planar-Nexus_0.1.0_amd64.AppImage
# - src-tauri/target/release/bundle/deb/planar-nexus_0.1.0_amd64.deb
# - src-tauri/target/release/bundle/rpm/planar-nexus-0.1.0.x86_64.rpm
```

### Code Signing

#### Windows Code Signing

1. Obtain a code signing certificate from a certificate authority
2. Add certificate thumbprint to `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": "YOUR_CERTIFICATE_THUMBPRINT"
    }
  }
}
```

3. Install the certificate in your Windows certificate store
4. Build as usual - Tauri will automatically sign the installer

#### macOS Code Signing

1. Create an Apple Developer account
2. Generate signing certificates in Xcode
3. Update `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: Your Name (TEAM_ID)",
      "providerShortName": "YOUR_PROVIDER_SHORT_NAME"
    }
  }
}
```

4. Build - Tauri will sign the application automatically

### Distribution

#### Direct Distribution

- Upload installers to your website or GitHub Releases
- Share download links with users
- Users can install directly without app stores

#### App Stores (Optional)

**macOS App Store**:
- Requires additional configuration in `tauri.conf.json`
- Must follow Apple's App Store guidelines
- Requires paid Apple Developer Program membership

**Microsoft Store**:
- Requires MSIX packaging configuration
- Microsoft Developer account required
- Additional submission process

## Mobile Deployment

Mobile applications are built using Tauri Mobile, which wraps the Next.js application in native iOS and Android containers.

### Building Locally

#### iOS

```bash
# Install dependencies
npm install

# Install CocoaPods (macOS only)
brew install cocoapods

# Build iOS app (debug)
npm run build:tauri -- --target aarch64-apple-ios --debug --bundles ios

# Build iOS app (release, requires signing)
npm run build:tauri -- --target aarch64-apple-ios --bundles ios

# Output: src-tauri/target/aarch64-apple-ios/release/bundle/ios/*.ipa
```

#### Android

```bash
# Install dependencies
npm install

# Build Android APK (debug)
npm run build:tauri -- --target aarch64-linux-android --debug --bundles apk

# Build Android APK (release, requires signing)
npm run build:tauri -- --target aarch64-linux-android --bundles apk,aab

# Output:
# - src-tauri/target/aarch64-linux-android/release/bundle/android/*.apk
# - src-tauri/target/aarch64-linux-android/release/bundle/android/*.aab
```

### Code Signing

#### iOS Code Signing

1. Create an Apple Developer account (paid)
2. Generate signing certificates in Xcode
3. Create provisioning profiles for your app
4. Configure in `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "ios": {
      "signingIdentity": "iPhone Distribution: Your Name (TEAM_ID)",
      "provisioningProfiles": {
        "com.planarnexus.app": "Provisioning Profile Name"
      }
    }
  }
}
```

5. Build - Tauri will sign the app automatically

#### Android Code Signing

1. Create a keystore file:

```bash
keytool -genkey -v -keystore android.keystore -alias planar-nexus -keyalg RSA -keysize 2048 -validity 10000
```

2. Configure in `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "android": {
      "keyAlias": "planar-nexus",
      "keyStore": "android.keystore",
      "signingKeystore": "android.keystore"
    }
  }
}
```

3. Build with keystore password provided as environment variable:

```bash
ANDROID_KEYSTORE_PASSWORD="your_password" \
ANDROID_KEY_PASSWORD="your_password" \
npm run build:tauri -- --target aarch64-linux-android --bundles apk,aab
```

### App Store Distribution

#### Apple App Store

1. **Requirements**:
   - Paid Apple Developer Program membership ($99/year)
   - Valid signing certificates
   - App Store Connect account

2. **Submission Process**:
   - Build the IPA file with release configuration
   - Upload to App Store Connect using Xcode or Transporter
   - Complete app metadata (screenshots, descriptions, etc.)
   - Submit for review
   - Wait for Apple approval (typically 1-2 weeks)

3. **Command Line Upload**:

```bash
# Install Transporter
brew install --cask transporter

# Upload IPA
Transporter -i <path-to-ipa>
```

#### Google Play Store

1. **Requirements**:
   - Google Play Developer account ($25 one-time fee)
   - Valid signing keystore
   - Google Play Console account

2. **Submission Process**:
   - Build the AAB file (Android App Bundle)
   - Upload to Google Play Console
   - Complete store listing
   - Submit for review
   - Wait for approval (typically 1-3 days)

3. **Command Line Upload** (using Google Play CLI):

```bash
# Install Google Play CLI
npm install -g google-play-cli

# Upload AAB
google-play upload --aab <path-to-aab> --track internal
```

## CI/CD Pipeline

Planar Nexus uses GitHub Actions for automated builds and deployments.

### Workflow Files

- `.github/workflows/ci.yml` - Continuous integration (lint, typecheck, build)
- `.github/workflows/desktop-build.yml` - Desktop application builds
- `.github/workflows/mobile-build.yml` - Mobile application builds

### CI Workflow

Runs on every push to main/develop branches and on pull requests:

```yaml
Jobs:
  - Lint (ESLint)
  - Type Check (TypeScript)
  - Build (Next.js production build)
  - Upload build artifacts
```

### Desktop Build Workflow

Triggered on:
- Release publication
- Manual workflow dispatch

Builds:
- Windows (NSIS installer)
- macOS (DMG and App bundle)
- Linux (AppImage, DEB, RPM)

Artifacts:
- Uploaded as GitHub Actions artifacts
- Attached to GitHub Releases on release publication

### Mobile Build Workflow

Triggered on:
- Release publication
- Manual workflow dispatch

Builds:
- iOS (IPA)
- Android (APK and AAB)

Artifacts:
- Uploaded as GitHub Actions artifacts
- Attached to GitHub Releases on release publication

### Setting Up GitHub Secrets

For code signing in CI/CD, configure these secrets in your GitHub repository:

#### Desktop Builds

**Windows**:
- `WINDOWS_CERTIFICATE` - Base64-encoded code signing certificate
- `WINDOWS_CERTIFICATE_PASSWORD` - Certificate password

**macOS**:
- `APPLE_CERTIFICATE` - Base64-encoded signing certificate
- `APPLE_CERTIFICATE_PASSWORD` - Certificate password
- `APPLE_SIGNING_IDENTITY` - Signing identity (e.g., "Developer ID Application: Your Name (TEAM_ID)")
- `KEYCHAIN_PASSWORD` - Temporary keychain password

#### Mobile Builds

**iOS**:
- `APPLE_CERTIFICATE` - Base64-encoded signing certificate
- `APPLE_CERTIFICATE_PASSWORD` - Certificate password
- `APPLE_SIGNING_IDENTITY` - Signing identity
- `KEYCHAIN_PASSWORD` - Temporary keychain password

**Android**:
- `ANDROID_KEYSTORE` - Base64-encoded keystore file
- `ANDROID_KEYSTORE_PASSWORD` - Keystore password
- `ANDROID_KEY_ALIAS` - Key alias
- `ANDROID_KEY_PASSWORD` - Key password

### Manual Workflow Dispatch

To trigger builds manually:

1. Go to your repository on GitHub
2. Navigate to "Actions" tab
3. Select the desired workflow (Desktop Builds or Mobile Builds)
4. Click "Run workflow"
5. Select platform and build type (debug/release)
6. Click "Run workflow"

## Release Process

### Version Management

Version is managed in `src-tauri/tauri.conf.json`:

```json
{
  "version": "0.1.0"
}
```

Also update `package.json` to match:

```json
{
  "version": "0.1.0"
}
```

### Creating a Release

1. **Update version numbers** in both `tauri.conf.json` and `package.json`

2. **Commit the version bump**:

```bash
git add src-tauri/tauri.conf.json package.json
git commit -m "Bump version to 0.1.0"
git push
```

3. **Create a tag**:

```bash
git tag v0.1.0
git push origin v0.1.0
```

4. **Create a GitHub Release**:

```bash
gh release create v0.1.0 \
  --title "Planar Nexus v0.1.0" \
  --notes "Release notes here..."
```

5. **Wait for CI/CD** to build all platforms

6. **Verify artifacts** are attached to the release

### Release Notes Template

```markdown
## Planar Nexus v0.1.0

### New Features
- Feature 1
- Feature 2

### Improvements
- Improvement 1
- Improvement 2

### Bug Fixes
- Bug fix 1
- Bug fix 2

### Platform-Specific Notes
#### Windows
- Windows-specific notes

#### macOS
- macOS-specific notes

#### Linux
- Linux-specific notes

#### iOS
- iOS-specific notes

#### Android
- Android-specific notes

### Known Issues
- Issue 1
- Issue 2

### Installation
See [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) for installation instructions.
```

## Version Management

### Semantic Versioning

Planar Nexus follows semantic versioning (MAJOR.MINOR.PATCH):

- **MAJOR**: Incompatible API changes
- **MINOR**: New functionality (backwards compatible)
- **PATCH**: Bug fixes (backwards compatible)

Examples:
- `0.1.0` → `0.1.1` (patch release)
- `0.1.0` → `0.2.0` (minor release)
- `0.1.0` → `1.0.0` (major release)

### Pre-Release Versions

For pre-release builds, use semantic versioning pre-release identifiers:

- `0.1.0-alpha.1`
- `0.1.0-beta.1`
- `0.1.0-rc.1`

### Build Metadata

Build metadata can be added for CI/CD builds:

- `0.1.0+build.123`
- `0.1.0-beta.1+build.456`

## Troubleshooting

### Common Build Issues

#### Windows

**Issue**: MSVC compiler not found
```bash
# Install Visual Studio Build Tools
# Download from: https://visualstudio.microsoft.com/downloads/
# Select "Desktop development with C++"
```

**Issue**: Code signing fails
```bash
# Verify certificate is installed
certutil -store MY

# Check certificate thumbprint matches tauri.conf.json
```

#### macOS

**Issue**: Xcode command line tools not found
```bash
xcode-select --install
```

**Issue**: Code signing identity not found
```bash
# List available signing identities
security find-identity -v -p codesigning
```

#### Linux

**Issue**: webkit2gtk not found
```bash
# Ubuntu/Debian
sudo apt-get install libwebkit2gtk-4.1-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel
```

#### iOS

**Issue**: CocoaPods dependencies not installed
```bash
cd src-tauri/gen/apple
pod install
```

**Issue**: Signing identity not found
```bash
# List available signing identities
security find-identity -v -p codesigning
```

#### Android

**Issue**: Android SDK not found
```bash
# Set ANDROID_HOME environment variable
export ANDROID_HOME=$HOME/Android/Sdk
```

**Issue**: Java version mismatch
```bash
# Install Java 17
# Ubuntu/Debian
sudo apt-get install openjdk-17-jdk

# macOS
brew install openjdk@17
```

### CI/CD Issues

**Issue**: Build fails in CI but works locally
- Check Node.js version matches (Node 20)
- Verify all dependencies are in package.json
- Check for platform-specific dependencies

**Issue**: Code signing fails in CI
- Verify GitHub secrets are configured correctly
- Check that certificates are base64-encoded properly
- Ensure signing identity matches exactly

**Issue**: Artifacts not uploaded
- Check artifact upload path patterns
- Verify build completed successfully
- Check for file permissions issues

### Deployment Issues

**Issue**: Web deployment shows blank page
- Verify build completed successfully
- Check for runtime errors in browser console
- Ensure all static assets are deployed

**Issue**: Desktop app won't open
- Verify the build completed successfully
- Check system logs for crash reports
- Test on clean machine

**Issue**: Mobile app crashes on launch
- Check device logs (adb logcat for Android, Xcode for iOS)
- Verify provisioning profiles are valid
- Test on multiple devices

## Additional Resources

- [Tauri Documentation](https://tauri.app/v1/guides/)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Apple Developer Documentation](https://developer.apple.com/documentation/)
- [Google Play Console](https://play.google.com/console)

## Support

For deployment issues:
1. Check this guide's troubleshooting section
2. Search existing GitHub issues
3. Create a new issue with:
   - Platform and version
   - Error messages
   - Steps to reproduce
   - Expected vs actual behavior

---

**Last Updated**: 2026-03-07
**Version**: 0.1.0
