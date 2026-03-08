# Windows Build Guide for Planar Nexus

This guide provides detailed instructions for building Planar Nexus on Windows, including local development builds and production installer creation.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setting Up the Build Environment](#setting-up-the-build-environment)
- [Building the Application](#building-the-application)
- [Testing the Build](#testing-the-build)
- [Creating the NSIS Installer](#creating-the-nsis-installer)
- [Code Signing](#code-signing)
- [Troubleshooting](#troubleshooting)
- [Distribution](#distribution)

## Prerequisites

### System Requirements

- **Operating System**: Windows 10 or later (64-bit)
- **RAM**: Minimum 8GB (16GB recommended)
- **Disk Space**: 10GB for build artifacts
- **Processor**: x64 architecture

### Required Software

1. **Node.js 20+**
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify installation: `node --version` (should be v20.x.x or higher)
   - Verify npm: `npm --version` (should be 9.x.x or higher)

2. **Rust Toolchain**
   - Install via rustup:
     ```cmd
     curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
     ```
   - Or download from [rust-lang.org](https://www.rust-lang.org/tools/install)
   - Verify installation: `rustc --version` (should be 1.77.2 or higher)
   - Verify cargo: `cargo --version`

3. **Visual Studio Build Tools**
   - Download from [visualstudio.microsoft.com](https://visualstudio.microsoft.com/downloads/)
   - During installation, select "Desktop development with C++"
   - Required components:
     - MSVC v143 - VS 2022 C++ x64/x86 build tools
     - Windows 10 SDK (or latest)

4. **Git**
   - Download from [git-scm.com](https://git-scm.com/downloads)
   - Verify installation: `git --version`

5. **Additional Windows Dependencies**
   - Webview2 Runtime (usually pre-installed on Windows 10+)
   - If needed: Download from [Microsoft WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

## Setting Up the Build Environment

### 1. Clone the Repository

```cmd
git clone https://github.com/anchapin/planar-nexus.git
cd planar-nexus
```

### 2. Install Node.js Dependencies

```cmd
npm install
```

This will install:
- Next.js and React dependencies
- Tauri CLI (`@tauri-apps/cli`)
- Development dependencies

### 3. Verify Tauri Installation

```cmd
npm run dev:tauri -- --help
```

You should see Tauri CLI help output.

### 4. Configure Build Environment (Optional)

If you need to customize build behavior, you can set environment variables:

```cmd
# Set Node environment
set NODE_ENV=production

# Set Rust target (optional, defaults to x86_64-pc-windows-msvc)
set CARGO_BUILD_TARGET=x86_64-pc-windows-msvc
```

## Building the Application

### Development Build

For local development with hot-reload:

```cmd
npm run dev:tauri
```

This will:
1. Start the Next.js development server (http://localhost:9002)
2. Launch a Tauri development window
3. Enable hot-reload for code changes

### Production Build

To create a production-ready build:

```cmd
# Step 1: Build the Next.js frontend
set NODE_ENV=production
npm run build

# Step 2: Build the Tauri application
npm run build:tauri
```

Or combine into a single command:

```cmd
set NODE_ENV=production && npm run build && npm run build:tauri
```

### Build Output Locations

After a successful build, you'll find:

```
src-tauri/target/release/planar-nexus.exe              # Executable
src-tauri/target/release/bundle/nsis/*.exe             # NSIS Installer
src-tauri/target/release/bundle/msi/*.msi              # MSI Installer (if configured)
src-tauri/target/release/bundle/updater/               # Update packages
```

## Testing the Build

### 1. Run the Executable Directly

```cmd
cd src-tauri\target\release
.\planar-nexus.exe
```

### 2. Test the Installer

```cmd
cd src-tauri\target\release\bundle\nsis
.\Planar-Nexus-setup.exe
```

Follow the installation wizard and verify:
- Installation directory selection works
- Desktop shortcut is created
- Start menu shortcut is created
- Application launches after installation
- Uninstaller works correctly

### 3. Verify Application Functionality

After installation, test:
- Application launches successfully
- All features work as expected
- Settings persist
- No console errors or crashes

## Creating the NSIS Installer

### NSIS Configuration

The NSIS installer is configured in `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "windows": {
      "nsis": {
        "installMode": "perMachine",
        "license": "../LICENSE",
        "installerIcon": "icons/icon.ico",
        "headerImage": null,
        "sidebarImage": null,
        "languages": ["English"],
        "displayLanguageSelector": false,
        "createDesktopShortcut": true,
        "createStartMenuShortcut": true,
        "allowToChangeInstallationDirectory": true,
        "oneClick": false,
        "perMachine": true,
        "runAfterFinish": true
      }
    }
  }
}
```

### Installer Features

- **Installation Mode**: Per-machine (requires admin privileges)
- **License Display**: Shows LICENSE file during installation
- **Custom Icons**: Uses branding icon.ico
- **Shortcuts**: Creates desktop and Start menu shortcuts
- **Custom Installation**: Allows users to choose installation directory
- **Auto-launch**: Runs application after installation completes

### Customizing Installer Branding

To add custom branding images to the NSIS installer:

1. **Create Installer Images**:
   - Header image: 150x57 pixels (BMP format)
   - Sidebar image: 164x314 pixels (BMP format)

2. **Place Images**:
   ```cmd
   copy installer-header.bmp src-tauri\icons\
   copy installer-sidebar.bmp src-tauri\icons\
   ```

3. **Update Configuration**:
   ```json
   {
     "nsis": {
       "headerImage": "icons/installer-header.bmp",
       "sidebarImage": "icons/installer-sidebar.bmp"
     }
   }
   ```

4. **Rebuild**:
   ```cmd
   npm run build:tauri
   ```

## Code Signing

### Why Sign Your Application?

Code signing provides several benefits:
- Prevents Windows SmartScreen warnings
- Builds user trust
- Required for enterprise distribution
- Enables automatic updates

### Obtaining a Code Signing Certificate

1. **Choose a Certificate Authority**:
   - DigiCert
   - Sectigo
   - GlobalSign
   - SSL.com

2. **Purchase Certificate**:
   - Typical cost: $200-500/year
   - Type: Code Signing Certificate for Windows

3. **Receive Certificate**:
   - Download as .pfx or .p12 file
   - Note your certificate password

### Installing the Certificate

1. **Double-click the certificate file**
2. **Enter the password**
3. **Select certificate store**: "Personal"
4. **Complete the import wizard**

### Finding Your Certificate Thumbprint

```cmd
certutil -store MY
```

Copy the thumbprint (e.g., `A1B2C3D4E5F6...`) from your certificate.

### Configuring Code Signing in Tauri

Update `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": "A1B2C3D4E5F6...",
      "digestAlgorithm": "sha256",
      "timestampUrl": "http://timestamp.digicert.com"
    }
  }
}
```

### Building with Code Signing

```cmd
npm run build:tauri
```

Tauri will automatically sign the installer using your certificate.

### Verifying the Signature

```cmd
signtool verify /pa /v src-tauri\target\release\bundle\nsis\Planar-Nexus-setup.exe
```

You should see "Successfully verified" message.

### Alternative: Sign Without Certificate (Testing)

For testing purposes, you can use a self-signed certificate:

```cmd
# Create self-signed certificate
makecert -r -pe -n "CN=Planar Nexus" -ss PrivateCertStore -sr LocalMachine planarnexus.cer
```

**Note**: Self-signed certificates will still trigger SmartScreen warnings and are not suitable for distribution.

## Troubleshooting

### Common Build Errors

#### Error: "MSVC linker not found"

**Solution**: Install Visual Studio Build Tools
```cmd
# Download from https://visualstudio.microsoft.com/downloads/
# Install "Desktop development with C++"
```

#### Error: "Node.js version too old"

**Solution**: Upgrade Node.js
```cmd
# Download latest LTS from https://nodejs.org/
node --version  # Should be 20.x.x or higher
```

#### Error: "Cargo not found"

**Solution**: Install Rust toolchain
```cmd
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Or download from https://www.rust-lang.org/tools/install
```

#### Error: "Build failed: frontendDist does not exist"

**Solution**: Build Next.js first
```cmd
set NODE_ENV=production
npm run build
npm run build:tauri
```

#### Error: "Out of memory during build"

**Solution**: Increase memory limit
```cmd
set NODE_OPTIONS=--max-old-space-size=4096
npm run build:tauri
```

### Runtime Issues

#### Application won't launch

**Check**:
1. Open Command Prompt
2. Navigate to installation directory
3. Run `planar-nexus.exe`
4. Check for error messages

**Common causes**:
- Missing Visual C++ Redistributable
- WebView2 not installed
- Antivirus blocking execution

#### White screen on launch

**Solution**: Check browser console
1. Press F12 to open DevTools
2. Check Console tab for JavaScript errors
3. Verify Next.js build completed successfully

#### SmartScreen warning on installer

**Solution**: Code sign the installer (see [Code Signing](#code-signing) section)

### Performance Issues

#### Build takes too long

**Optimizations**:
```cmd
# Use parallel builds
set CARGO_BUILD_JOBS=8

# Disable incremental compilation for release
set CARGO_INCREMENTAL=0

# Use LTO for release builds
set CARGO_PROFILE_RELEASE_LTO=true
```

## Distribution

### Local Distribution

1. **Package the installer**:
   ```cmd
   copy src-tauri\target\release\bundle\nsis\Planar-Nexus-setup.exe .\dist\
   ```

2. **Create checksum**:
   ```cmd
   certutil -hashfile Planar-Nexus-setup.exe SHA256 > Planar-Nexus-setup.exe.sha256
   ```

3. **Create version.txt**:
   ```cmd
   echo Planar Nexus v0.1.0 > version.txt
   date /t >> version.txt
   ```

### GitHub Releases

1. **Tag the release**:
   ```cmd
   git tag v0.1.0
   git push origin v0.1.0
   ```

2. **Create GitHub Release**:
   ```cmd
   gh release create v0.1.0 \
     --title "Planar Nexus v0.1.0" \
     --notes "Release notes here..." \
     src-tauri/target/release/bundle/nsis/Planar-Nexus-setup.exe
   ```

### CI/CD Builds

The project includes GitHub Actions workflows for automated builds:

**Manual Trigger**:
1. Go to repository on GitHub
2. Navigate to "Actions" tab
3. Select "Desktop Builds"
4. Click "Run workflow"
5. Select platform: "windows"
6. Click "Run workflow"

**On Release**:
- Create a new release on GitHub
- Builds run automatically
- Artifacts are uploaded to the release

### Distribution Checklist

Before distributing:
- [ ] Build and test the installer locally
- [ ] Test installation on clean Windows machine
- [ ] Verify all features work
- [ ] Code sign the installer (recommended)
- [ ] Create checksums
- [ ] Write release notes
- [ ] Update documentation
- [ ] Test uninstaller
- [ ] Verify shortcuts work

## Additional Resources

- [Tauri Windows Bundling Guide](https://tauri.app/v1/guides/distribution/)
- [NSIS Documentation](https://nsis.sourceforge.io/Docs/)
- [Windows Code Signing Best Practices](https://docs.microsoft.com/en-us/windows/win32/seccrypto/cryptography-portal)
- [Tauri Discord](https://discord.gg/tauri)
- [Tauri GitHub](https://github.com/tauri-apps/tauri)

## Support

If you encounter issues:
1. Check the [Troubleshooting](#troubleshooting) section
2. Search [Tauri GitHub Issues](https://github.com/tauri-apps/tauri/issues)
3. Ask in the [Tauri Discord](https://discord.gg/tauri)
4. Open an issue on the [Planar Nexus repository](https://github.com/anchapin/planar-nexus/issues)

---

**Last Updated**: 2026-03-07
**Version**: 0.1.0
