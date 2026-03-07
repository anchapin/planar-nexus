# Installer Building Guide

This guide provides detailed instructions for building installers for Planar Nexus on all platforms.

## Table of Contents

- [Overview](#overview)
- [Build Prerequisites](#build-prerequisites)
- [Windows Installer Build](#windows-installer-build)
- [macOS Installer Build](#macos-installer-build)
- [Linux Package Build](#linux-package-build)
- [iOS Build](#ios-build)
- [Android Build](#android-build)
- [Automated CI/CD Builds](#automated-cicd-builds)
- [Testing Installers](#testing-installers)
- [Troubleshooting](#troubleshooting)

## Overview

Planar Nexus uses Tauri for cross-platform desktop and mobile applications. This guide covers:

- Building Windows NSIS installers
- Building macOS DMG and App bundles
- Building Linux packages (AppImage, DEB, RPM)
- Building iOS IPA files
- Building Android APK and AAB files

## Build Prerequisites

### Common Requirements

```bash
# Node.js 20+
node --version  # Should be v20.x.x

# npm
npm --version   # Should be 9.x.x or higher

# Rust
rustc --version  # Should be 1.70+ for Tauri 2
cargo --version  # Should be 1.70+ for Tauri 2
```

### Installing Rust

```bash
# Install Rust using rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Reload shell
source $HOME/.cargo/env

# Verify installation
rustc --version
cargo --version
```

### Installing Dependencies

```bash
# Navigate to project directory
cd /path/to/planar-nexus

# Install Node.js dependencies
npm install

# Install Tauri CLI globally (optional)
npm install -g @tauri-apps/cli@latest
```

## Windows Installer Build

### System Requirements

- Windows 10 or later (64-bit)
- Visual Studio Build Tools 2019 or later
- Rust toolchain
- Node.js 20+

### Installing Build Tools

1. **Install Visual Studio Build Tools**:
   - Download from [visualstudio.microsoft.com](https://visualstudio.microsoft.com/downloads/)
   - Run the installer
   - Select "Desktop development with C++"
   - Install required components:
     - MSVC v143 - VS 2022 C++ x64/x86 build tools
     - Windows 10 SDK (or latest)

2. **Install Rust** (if not already installed):
   ```cmd
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. **Install Node.js 20+**:
   - Download from [nodejs.org](https://nodejs.org/)
   - Run the installer

### Building the Installer

```cmd
# Navigate to project directory
cd C:\path\to\planar-nexus

# Install dependencies
npm install

# Build Next.js application (required for Tauri build)
set NODE_ENV=production
npm run build

# Build Tauri application with NSIS installer
npm run build:tauri

# Or use Tauri CLI directly
tauri build --target x86_64-pc-windows-msvc
```

### Output Location

The installer will be created at:

```
src-tauri\target\release\bundle\nsis\Planar-Nexus-setup.exe
```

### Building Different Architectures

```cmd
# 64-bit (default)
tauri build --target x86_64-pc-windows-msvc

# 32-bit (if needed for older systems)
tauri build --target i686-pc-windows-msvc
```

### Code Signing the Installer

#### 1. Obtain a Code Signing Certificate

- Purchase from a certificate authority (DigiCert, Sectigo, etc.)
- Typical cost: $200-500/year

#### 2. Install the Certificate

```cmd
# Double-click the .pfx file
# Enter password
# Install to "Personal" certificate store
```

#### 3. Update Tauri Configuration

Edit `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": "YOUR_CERTIFICATE_THUMBPRINT",
      "digestAlgorithm": "sha256",
      "timestampUrl": "http://timestamp.digicert.com"
    }
  }
}
```

#### 4. Get Certificate Thumbprint

```cmd
certutil -store MY
```

Copy the thumbprint from your certificate.

#### 5. Build with Signing

```cmd
# Build as usual - Tauri will automatically sign
tauri build
```

#### 6. Verify Signature

```cmd
signtool verify /pa /v src-tauri\target\release\bundle\nsis\Planar-Nexus-setup.exe
```

### Customizing NSIS Installer

Edit `src-tauri/tauri.conf.json` to customize the installer:

```json
{
  "bundle": {
    "windows": {
      "nsis": {
        "installMode": "perMachine",
        "displayLanguageSelector": true,
        "languages": ["English"],
        "installerIcon": "icons/icon.ico",
        "headerImage": "installer-header.bmp",
        "sidebarImage": "installer-sidebar.bmp"
      }
    }
  }
}
```

### Creating Installer Images

Create bitmap images for NSIS installer branding:

- **installer-icon.ico**: 256x256 icon file
- **installer-header.bmp**: 150x57 header image
- **installer-sidebar.bmp**: 164x314 sidebar image

Place these in the `src-tauri/icons/` directory.

### Silent Installation

For automated deployment:

```cmd
# Silent install
Planar-Nexus-setup.exe /S

# Silent install with custom directory
Planar-Nexus-setup.exe /S /D=C:\Custom\Path\Planar Nexus
```

## macOS Installer Build

### System Requirements

- macOS 10.15 (Catalina) or later
- Xcode 14 or later
- Command Line Tools for Xcode
- Rust toolchain
- Node.js 20+

### Installing Build Tools

1. **Install Xcode**:
   ```bash
   # Install from App Store
   # Or download from developer.apple.com
   xcode-select --install
   ```

2. **Install Rust** (if not already installed):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. **Install Node.js 20+**:
   ```bash
   # Using Homebrew
   brew install node

   # Or download from nodejs.org
   ```

### Building the Application

```bash
# Navigate to project directory
cd /path/to/planar-nexus

# Install dependencies
npm install

# Build Next.js application
NODE_ENV=production npm run build

# Build Tauri application (creates .app and .dmg)
npm run build:tauri

# Or use Tauri CLI directly
tauri build
```

### Output Location

```
src-tauri/target/release/bundle/macos/Planar Nexus.app      # App bundle
src-tauri/target/release/bundle/macos/Planar Nexus.dmg      # DMG installer
```

### Building for Different Architectures

```bash
# Intel (x86_64)
tauri build --target x86_64-apple-darwin

# Apple Silicon (ARM64)
tauri build --target aarch64-apple-darwin

# Universal (both architectures)
tauri build --target universal-apple-darwin
```

### Code Signing the Application

#### 1. Apple Developer Account

- Create an Apple Developer account ($99/year)
- Enroll in the Apple Developer Program

#### 2. Generate Signing Certificate

```bash
# Open Xcode
# Xcode > Preferences > Accounts
# Select your Apple ID > Manage Certificates
# Click "+" > "Developer ID Application"
```

#### 3. Update Tauri Configuration

Edit `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: Your Name (TEAM_ID)",
      "providerShortName": "YOUR_PROVIDER_SHORT_NAME",
      "entitlements": "src-tauri/entitlements.plist",
      "minimumSystemVersion": "10.15"
    }
  }
}
```

#### 4. Find Signing Identity

```bash
security find-identity -v -p codesigning
```

Copy the identity string (e.g., "Developer ID Application: Your Name (TEAM_ID)").

#### 5. Build with Signing

```bash
# Build as usual - Tauri will automatically sign
tauri build
```

#### 6. Verify Signature

```bash
codesign -dvvv "src-tauri/target/release/bundle/macos/Planar Nexus.app"
```

#### 7. Notarize for Distribution

For distribution outside the App Store:

```bash
# Notarize the app (requires Apple ID and app-specific password)
xcrun notarytool submit "src-tauri/target/release/bundle/macos/Planar Nexus.dmg" \
  --apple-id "your@email.com" \
  --password "app-specific-password" \
  --team-id "TEAM_ID" \
  --wait

# Staple the notarization ticket to the app
xcrun stapler staple "src-tauri/target/release/bundle/macos/Planar Nexus.dmg"
```

### Creating a DMG

The default DMG is created automatically. To customize:

```bash
# Install create-dmg (optional, for custom DMG layouts)
brew install create-dmg

# Create custom DMG
create-dmg \
  --volname "Planar Nexus" \
  --volicon "src-tauri/icons/icon.icns" \
  --window-pos 200 120 \
  --window-size 600 400 \
  --icon-size 100 \
  --icon "Planar Nexus.app" 175 120 \
  --hide-extension "Planar Nexus.app" \
  --app-drop-link 425 120 \
  "Planar-Nexus-0.1.0.dmg" \
  "src-tauri/target/release/bundle/macos/Planar Nexus.app"
```

### Customizing App Icon

1. Create icons in various sizes:
   - 16x16, 32x32, 64x64, 128x128, 256x256, 512x512, 1024x1024

2. Convert to `.icns` format:

```bash
# Using iconutil (built into macOS)
mkdir -p PlanarNexus.iconset
sips -z 16 16     icon.png --out PlanarNexus.iconset/icon_16x16.png
sips -z 32 32     icon.png --out PlanarNexus.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out PlanarNexus.iconset/icon_32x32.png
sips -z 64 64     icon.png --out PlanarNexus.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out PlanarNexus.iconset/icon_128x128.png
sips -z 256 256   icon.png --out PlanarNexus.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out PlanarNexus.iconset/icon_256x256.png
sips -z 512 512   icon.png --out PlanarNexus.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out PlanarNexus.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out PlanarNexus.iconset/icon_512x512@2x.png
iconutil -c icns PlanarNexus.iconset

# Move to Tauri icons directory
mv PlanarNexus.icns src-tauri/icons/icon.icns
```

## Linux Package Build

### System Requirements

- Ubuntu 22.04+ or equivalent Linux distribution
- Rust toolchain
- Node.js 20+
- webkit2gtk development libraries

### Installing Build Tools

#### Ubuntu/Debian

```bash
# Update package list
sudo apt-get update

# Install required dependencies
sudo apt-get install -y \
  build-essential \
  curl \
  wget \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev
```

#### Fedora

```bash
# Install required dependencies
sudo dnf install -y \
  gcc \
  gcc-c++ \
  make \
  openssl-devel \
  webkit2gtk4.1-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  openssl-devel \
  gtk3-devel \
  libayatana-appindicator-gtk3-devel
```

#### Arch Linux

```bash
# Install required dependencies
sudo pacman -S --needed \
  base-devel \
  webkit2gtk-4.1 \
  libappindicator-gtk3 \
  librsvg \
  openssl \
  gtk3 \
  libayatana-appindicator
```

### Building the Packages

```bash
# Navigate to project directory
cd /path/to/planar-nexus

# Install dependencies
npm install

# Build Next.js application
NODE_ENV=production npm run build

# Build Tauri application (creates all Linux packages)
npm run build:tauri

# Or use Tauri CLI directly
tauri build
```

### Output Location

```
src-tauri/target/release/bundle/appimage/Planar-Nexus_0.1.0_amd64.AppImage
src-tauri/target/release/bundle/deb/planar-nexus_0.1.0_amd64.deb
src-tauri/target/release/bundle/rpm/planar-nexus-0.1.0.x86_64.rpm
```

### Building Specific Packages

```bash
# Only build AppImage
tauri build --bundles appimage

# Only build DEB
tauri build --bundles deb

# Only build RPM
tauri build --bundles rpm
```

### Making AppImage Executable

```bash
chmod +x src-tauri/target/release/bundle/appimage/Planar-Nexus_0.1.0_amd64.AppImage
```

### Running AppImage

```bash
./Planar-Nexus_0.1.0_amd64.AppImage
```

### Installing DEB Package

```bash
# Install
sudo dpkg -i planar-nexus_0.1.0_amd64.deb

# Fix missing dependencies (if any)
sudo apt-get install -f
```

### Installing RPM Package

```bash
# Install
sudo rpm -i planar-nexus-0.1.0.x86_64.rpm

# Or using dnf
sudo dnf install planar-nexus-0.1.0.x86_64.rpm
```

### Code Signing for Linux

Linux packages can be signed using GPG:

```bash
# Generate GPG key (if you don't have one)
gpg --gen-key

# Sign DEB
dpkg-sig --sign builder planar-nexus_0.1.0_amd64.deb

# Sign RPM
rpmsign --addsign planar-nexus-0.1.0.x86_64.rpm
```

### Customizing Package Metadata

Edit `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "linux": {
      "appimage": {
        "bundleMediaFramework": true
      },
      "deb": {
        "depends": [
          "libwebkit2gtk-4.1-0",
          "libappindicator3-1"
        ],
        "files": {
          "/usr/share/doc/planar-nexus/copyright": "LICENSE"
        }
      },
      "rpm": {
        "depends": [
          "webkit2gtk4.1",
          "libappindicator-gtk3"
        ]
      }
    }
  }
}
```

## iOS Build

### System Requirements

- macOS 12 (Monterey) or later
- Xcode 14 or later
- Xcode Command Line Tools
- CocoaPods
- Rust toolchain
- Node.js 20+
- Apple Developer account (for release builds)

### Installing Build Tools

```bash
# Install Xcode Command Line Tools
xcode-select --install

# Install CocoaPods
sudo gem install cocoapods

# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Node.js (if not already installed)
brew install node
```

### Building the App

#### Debug Build (No Code Signing)

```bash
# Navigate to project directory
cd /path/to/planar-nexus

# Install dependencies
npm install

# Build Next.js application
NODE_ENV=production npm run build

# Install CocoaPods dependencies
cd src-tauri/gen/apple
pod install
cd ../../

# Build iOS app (debug)
tauri build --target aarch64-apple-ios --debug --bundles ios
```

#### Release Build (Code Signing Required)

```bash
# Build iOS app (release)
tauri build --target aarch64-apple-ios --bundles ios
```

### Output Location

```
src-tauri/target/aarch64-apple-ios/release/bundle/ios/Planar-Nexus.ipa
```

### Installing on Device

#### Using Xcode

```bash
# Open the Xcode project
open src-tauri/gen/apple/Planar\ Nexus.xcodeproj

# Select your device or simulator
# Click "Run" button
```

#### Using iOS Deploy (Command Line)

```bash
# Install ios-deploy
npm install -g ios-deploy

# Connect iOS device via USB
# Install app
ios-deploy --bundle src-tauri/target/aarch64-apple-ios/release/bundle/ios/Planar-Nexus.ipa
```

### Code Signing

#### 1. Apple Developer Account

Create an Apple Developer account ($99/year) and enroll in the Apple Developer Program.

#### 2. Generate Signing Certificate

```bash
# Open Xcode
# Xcode > Preferences > Accounts
# Select your Apple ID > Manage Certificates
# Click "+" > "iOS Distribution" (for App Store)
# Click "+" > "iOS Development" (for testing)
```

#### 3. Create Provisioning Profile

```bash
# Open Xcode
# File > New > Target
# Select "App" template
# Configure bundle identifier: com.planarnexus.app
# Go to Apple Developer Portal
# Create provisioning profile for your app
# Download and install in Xcode
```

#### 4. Update Tauri Configuration

Edit `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "ios": {
      "minimumOSVersion": "14.0",
      "devices": ["iphone", "ipad"],
      "signingIdentity": "iPhone Distribution: Your Name (TEAM_ID)",
      "provisioningProfiles": {
        "com.planarnexus.app": "Provisioning Profile Name"
      }
    }
  }
}
```

#### 5. Build with Signing

```bash
# Build - Tauri will use the configured signing identity
tauri build --target aarch64-apple-ios --bundles ios
```

### Testing on Simulator

```bash
# Build for simulator
tauri build --target aarch64-apple-ios-sim --debug --bundles ios

# Or run on simulator directly
tauri ios dev
```

### App Store Submission

1. **Prepare Metadata**:
   - App screenshots (various device sizes)
   - App description
   - Keywords
   - Privacy policy URL
   - Support URL

2. **Upload to App Store Connect**:

```bash
# Use Xcode or Transporter
open -a "Transporter" src-tauri/target/aarch64-apple-ios/release/bundle/ios/Planar-Nexus.ipa
```

3. **Submit for Review**:
   - Complete App Store Connect listing
   - Submit for review
   - Wait for Apple approval

## Android Build

### System Requirements

- macOS, Linux, or Windows
- Android SDK
- Java JDK 17
- Rust toolchain
- Node.js 20+
- Android Studio (optional, for debugging)

### Installing Build Tools

#### macOS/Linux

```bash
# Install Java JDK 17
# macOS
brew install openjdk@17
sudo ln -sfn /usr/local/opt/openjdk@17/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-17.jdk

# Linux (Ubuntu/Debian)
sudo apt-get install openjdk-17-jdk

# Install Android SDK command line tools
wget https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip
unzip commandlinetools-linux-9477386_latest.zip
mkdir -p ~/Android/sdk/cmdline-tools/latest
mv cmdline-tools/* ~/Android/sdk/cmdline-tools/latest/

# Set environment variables
export ANDROID_HOME=$HOME/Android/sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin
export PATH=$PATH:$ANDROID_HOME/platform-tools

# Install required SDK packages
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

#### Windows

```bash
# Install Android Studio from https://developer.android.com/studio
# During installation, accept SDK installation
# Add Android SDK to PATH:
# C:\Users\YourName\AppData\Local\Android\Sdk\platform-tools
# C:\Users\YourName\AppData\Local\Android\Sdk\cmdline-tools\latest\bin
```

### Building the App

#### Debug Build (No Code Signing)

```bash
# Navigate to project directory
cd /path/to/planar-nexus

# Install dependencies
npm install

# Build Next.js application
NODE_ENV=production npm run build

# Build Android APK (debug)
tauri build --target aarch64-linux-android --debug --bundles apk
```

#### Release Build (Code Signing Required)

```bash
# Build Android APK and AAB (release)
tauri build --target aarch64-linux-android --bundles apk,aab
```

### Output Location

```
src-tauri/target/aarch64-linux-android/release/bundle/android/Planar-Nexus-release.apk
src-tauri/target/aarch64-linux-android/release/bundle/android/Planar-Nexus-release.aab
```

### Installing on Device

#### Using ADB

```bash
# Enable USB debugging on Android device
# Connect device via USB

# Install APK
adb install src-tauri/target/aarch64-linux-android/release/bundle/android/Planar-Nexus-release.apk

# Launch app
adb shell am start -n com.planarnexus.app/.MainActivity
```

### Code Signing

#### 1. Generate Keystore

```bash
# Create keystore file
keytool -genkey -v -keystore android.keystore \
  -alias planar-nexus \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

# You'll be prompted for:
# - Keystore password (remember this!)
# - Key password (remember this!)
# - Your name, organization, etc.
```

#### 2. Update Tauri Configuration

Edit `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "android": {
      "minSdkVersion": 24,
      "targetSdkVersion": 34,
      "keyAlias": "planar-nexus",
      "keyStore": "android.keystore",
      "signingKeystore": "android.keystore"
    }
  }
}
```

#### 3. Build with Signing

```bash
# Build with keystore passwords
ANDROID_KEYSTORE_PASSWORD="your_keystore_password" \
ANDROID_KEY_PASSWORD="your_key_password" \
tauri build --target aarch64-linux-android --bundles apk,aab
```

#### 4. Verify Signature

```bash
# Verify APK signature
apksigner verify src-tauri/target/aarch64-linux-android/release/bundle/android/Planar-Nexus-release.apk

# Print certificate information
keytool -printcert -jarfile src-tauri/target/aarch64-linux-android/release/bundle/android/Planar-Nexus-release.apk
```

### Google Play Store Submission

1. **Prepare Metadata**:
   - App screenshots (phone and tablet)
   - App description
   - Short description
   - Icon (512x512)
   - Feature graphic (1024x500)
   - Privacy policy URL
   - Content rating questionnaire

2. **Upload AAB to Google Play Console**:

```bash
# Upload using Google Play CLI
npm install -g google-play-cli

google-play upload \
  --aab src-tauri/target/aarch64-linux-android/release/bundle/android/Planar-Nexus-release.aab \
  --track internal
```

3. **Submit for Review**:
   - Complete Play Store listing
   - Submit for review
   - Wait for Google approval

## Automated CI/CD Builds

### GitHub Actions Workflows

The project includes automated CI/CD workflows:

- `.github/workflows/desktop-build.yml` - Desktop builds
- `.github/workflows/mobile-build.yml` - Mobile builds

### Triggering Builds

#### On Release

```bash
# Create and push a tag
git tag v0.1.0
git push origin v0.1.0

# Create a GitHub Release
gh release create v0.1.0
```

#### Manual Trigger

1. Go to repository on GitHub
2. Navigate to "Actions" tab
3. Select desired workflow
4. Click "Run workflow"
5. Select platform and options
6. Click "Run workflow"

### CI/CD Secrets

Configure these secrets in your GitHub repository settings:

**Windows**:
- `WINDOWS_CERTIFICATE` - Base64-encoded code signing certificate
- `WINDOWS_CERTIFICATE_PASSWORD` - Certificate password

**macOS**:
- `APPLE_CERTIFICATE` - Base64-encoded signing certificate
- `APPLE_CERTIFICATE_PASSWORD` - Certificate password
- `APPLE_SIGNING_IDENTITY` - Signing identity string
- `KEYCHAIN_PASSWORD` - Temporary keychain password

**iOS**:
- `APPLE_CERTIFICATE` - Base64-encoded signing certificate
- `APPLE_CERTIFICATE_PASSWORD` - Certificate password
- `APPLE_SIGNING_IDENTITY` - Signing identity string
- `KEYCHAIN_PASSWORD` - Temporary keychain password

**Android**:
- `ANDROID_KEYSTORE` - Base64-encoded keystore file
- `ANDROID_KEYSTORE_PASSWORD` - Keystore password
- `ANDROID_KEY_ALIAS` - Key alias
- `ANDROID_KEY_PASSWORD` - Key password

### Base64 Encoding Files

```bash
# Base64 encode a file (for GitHub secrets)
base64 -i android.keystore | pbcopy  # macOS
base64 -w 0 android.keystore          # Linux
```

## Testing Installers

### Windows

```cmd
# Test installer
Planar-Nexus-setup.exe

# Verify installation
dir "C:\Users\YourName\AppData\Local\Programs\planar-nexus"

# Test uninstall
"C:\Users\YourName\AppData\Local\Programs\planar-nexus\unins000.exe"
```

### macOS

```bash
# Test DMG
open "Planar Nexus.dmg"
# Drag app to Applications folder

# Launch app
open "/Applications/Planar Nexus.app"

# Test uninstall (delete app)
rm -rf "/Applications/Planar Nexus.app"
```

### Linux

```bash
# Test AppImage
chmod +x Planar-Nexus_0.1.0_amd64.AppImage
./Planar-Nexus_0.1.0_amd64.AppImage

# Test DEB
sudo dpkg -i planar-nexus_0.1.0_amd64.deb
planar-nexus
sudo apt-get remove planar-nexus

# Test RPM
sudo rpm -i planar-nexus-0.1.0.x86_64.rpm
planar-nexus
sudo rpm -e planar-nexus
```

### iOS

```bash
# Install on device
ios-deploy --bundle Planar-Nexus.ipa

# Launch app and test functionality
# Check for crashes in Xcode console
```

### Android

```bash
# Install on device
adb install Planar-Nexus-release.apk

# Launch app
adb shell am start -n com.planarnexus.app/.MainActivity

# Check for crashes
adb logcat | grep planarnexus
```

## Troubleshooting

### Build Errors

**Tauri build fails**:
```bash
# Clear cache
cargo clean
rm -rf .next

# Rebuild
npm run build
npm run build:tauri
```

**Missing dependencies**:
```bash
# Install all required dependencies
# See platform-specific sections above
```

**Node.js version mismatch**:
```bash
# Ensure Node.js 20+
nvm use 20  # If using nvm
```

### Code Signing Errors

**Certificate not found**:
```bash
# Windows: Check certificate store
certutil -store MY

# macOS: Check available identities
security find-identity -v -p codesigning

# Android: Check keystore
keytool -list -v -keystore android.keystore
```

**Invalid password**:
```bash
# Verify keystore password
keytool -list -v -keystore android.keystore
```

### Runtime Errors

**App won't launch**:
```bash
# Check for missing dependencies
# Windows: Run in command prompt to see errors
# macOS: Check Console.app
# Linux: Run from terminal to see errors
```

**White screen on launch**:
```bash
# Check browser console for JavaScript errors
# Verify Next.js build completed successfully
```

### CI/CD Errors

**Build fails in CI but works locally**:
```bash
# Check Node.js version in CI
# Verify all dependencies are in package.json
# Check for platform-specific dependencies
```

**Code signing fails in CI**:
```bash
# Verify GitHub secrets are set correctly
# Check that certificates are base64-encoded properly
# Ensure signing identity matches exactly
```

## Additional Resources

- [Tauri Bundling Guide](https://tauri.app/v1/guides/distribution/)
- [iOS Code Signing](https://developer.apple.com/support/code-signing/)
- [Android App Signing](https://developer.android.com/studio/publish/app-signing)
- [Linux Packaging](https://tauri.app/v1/guides/distribution/linux)

---

**Last Updated**: 2026-03-07
**Version**: 0.1.0
