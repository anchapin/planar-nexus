# Linux Build Instructions

## Quick Start

```bash
# Install build dependencies
sudo apt-get update
sudo apt-get install -y build-essential curl wget git \
    libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Build the application
./scripts/build-linux.sh all
```

## Build Formats

Planar Nexus supports three Linux package formats:

### 1. AppImage (Recommended)
- **Universal**: Works on most Linux distributions
- **Portable**: No installation required
- **Size**: ~70-100 MB

```bash
# Build
./scripts/build-linux.sh appimage

# Run
chmod +x src-tauri/target/release/bundle/appimage/*.AppImage
./planar-nexus_0.1.0_amd64.AppImage
```

### 2. DEB Package
- **Distribution**: Debian, Ubuntu, Linux Mint
- **Installation**: System-wide via package manager
- **Size**: ~60-80 MB

```bash
# Build
./scripts/build-linux.sh deb

# Install
sudo dpkg -i src-tauri/target/release/bundle/deb/*.deb

# Uninstall
sudo apt-get remove planarnexus
```

### 3. RPM Package
- **Distribution**: Fedora, RHEL, CentOS, openSUSE
- **Installation**: System-wide via package manager
- **Size**: ~60-80 MB

```bash
# Build
./scripts/build-linux.sh rpm

# Install
sudo dnf install src-tauri/target/release/bundle/rpm/*.rpm

# Uninstall
sudo dnf remove planarnexus
```

## Build Script Usage

The `scripts/build-linux.sh` script automates the build process:

```bash
# Check dependencies
./scripts/build-linux.sh check

# Build specific format
./scripts/build-linux.sh appimage
./scripts/build-linux.sh deb
./scripts/build-linux.sh rpm

# Build all formats
./scripts/build-linux.sh all

# Test packages
./scripts/build-linux.sh test-appimage
./scripts/build-linux.sh test-deb
./scripts/build-linux.sh test-rpm

# Clean build artifacts
./scripts/build-linux.sh clean
```

## Manual Build

If you prefer to build manually:

```bash
# Install Node.js dependencies
npm install

# Build Next.js frontend
NODE_ENV=production npm run build

# Build Tauri application
npx tauri build --target x86_64-unknown-linux-gnu
```

## Dependencies

### Required System Libraries

**Ubuntu/Debian:**
```bash
sudo apt-get install -y \
    libwebkit2gtk-4.1-0 \
    libgtk-3-0 \
    libappindicator3-1
```

**Fedora/RHEL:**
```bash
sudo dnf install -y \
    webkit2gtk4.1 \
    gtk3 \
    libappindicator-gtk3
```

### Development Build Dependencies

**Ubuntu/Debian:**
```bash
sudo apt-get install -y \
    libwebkit2gtk-4.1-dev \
    libappindicator3-dev \
    librsvg2-dev \
    patchelf \
    libssl-dev \
    libgtk-3-dev
```

**Fedora/RHEL:**
```bash
sudo dnf install -y \
    webkit2gtk4.1-devel \
    libappindicator-gtk3-devel \
    librsvg2-devel \
    openssl-devel \
    gtk3-devel
```

## Cross-Compilation

### ARM64 (aarch64)

```bash
# Add Rust target
rustup target add aarch64-unknown-linux-gnu

# Install cross-compiler
sudo apt-get install gcc-aarch64-linux-gnu

# Configure cargo
echo '[target.aarch64-unknown-linux-gnu]
linker = "aarch64-linux-gnu-gcc"' >> ~/.cargo/config.toml

# Add architecture
sudo dpkg --add-architecture arm64

# Install ARM64 dependencies
sudo apt-get install libwebkit2gtk-4.1-dev:arm64

# Build
cargo tauri build --target aarch64-unknown-linux-gnu
```

### ARMv7 (32-bit)

```bash
# Add Rust target
rustup target add armv7-unknown-linux-gnueabihf

# Install cross-compiler
sudo apt-get install gcc-arm-linux-gnueabihf

# Configure cargo
echo '[target.armv7-unknown-linux-gnueabihf]
linker = "arm-linux-gnueabihf-gcc"' >> ~/.cargo/config.toml

# Add architecture
sudo dpkg --add-architecture armhf

# Install ARMv7 dependencies
sudo apt-get install libwebkit2gtk-4.1-dev:armhf

# Build
cargo tauri build --target armv7-unknown-linux-gnueabihf
```

## Troubleshooting

### GLIBC Version Error

```
Error: /usr/lib/libc.so.6: version 'GLIBC_2.33' not found
```

**Solution:** Build on an older system (Ubuntu 18.04) or use Docker container.

### Missing WebKitGTK

```
Error: Package 'webkit2gtk-4.1-dev' not found
```

**Solution:**
```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev
```

### AppImage Won't Execute

**Solution:**
```bash
# Make executable
chmod +x planar-nexus_0.1.0_amd64.AppImage

# Run with FUSE
./planar-nexus_0.1.0_amd64.AppImage

# If FUSE issues, extract and run
./planar-nexus_0.1.0_amd64.AppImage --appimage-extract
./squashfs-root/AppRun
```

### Build Fails with OpenSSL Error

**Solution 1:** Install OpenSSL headers
```bash
sudo apt-get install libssl-dev
```

**Solution 2:** Use vendored OpenSSL
```toml
# In src-tauri/Cargo.toml
[dependencies]
openssl-sys = { version = "0.9", features = ["vendored"] }
```

## Package Signing

### GPG Signing for RPM

```bash
# Generate GPG key
gpg --full-generate-key

# Export public key
gpg --export -a 'Planar Nexus' > RPM-GPG-KEY-PlanarNexus

# Import to RPM database
sudo rpm --import RPM-GPG-KEY-PlanarNexus

# Set environment variables
export TAURI_SIGNING_RPM_KEY=$(cat /path/to/private.key)
export TAURI_SIGNING_RPM_KEY_PASSPHRASE=your_passphrase

# Build signed package
cargo tauri build

# Verify signature
rpm -v --checksig planar-nexus-0.1.0-1.x86_64.rpm
```

## Build Artifacts

After successful build, artifacts are located in:

```
src-tauri/target/release/bundle/
├── appimage/
│   └── planar-nexus_0.1.0_amd64.AppImage
├── deb/
│   └── planar-nexus_0.1.0_amd64.deb
└── rpm/
    └── planar-nexus-0.1.0-1.x86_64.rpm
```

## Configuration

Linux-specific settings in `tauri.conf.json`:

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
          "libgtk-3-0"
        ]
      },
      "rpm": {
        "depends": [
          "webkit2gtk4.1",
          "gtk3"
        ],
        "epoch": 0,
        "release": "1"
      }
    }
  }
}
```

## Additional Resources

- **Comprehensive Guide**: See `docs/LINUX_BUILD_GUIDE.md` for detailed instructions
- **Tauri Documentation**: https://v2.tauri.app/
- **AppImage Documentation**: https://docs.appimage.org/
- **Debian Packaging**: https://www.debian.org/doc/manuals/debmake-doc/
- **RPM Packaging**: https://rpm-packaging-guide.github.io/

## Support

For issues specific to Linux builds:
1. Check this README first
2. Refer to `docs/LINUX_BUILD_GUIDE.md`
3. Search existing GitHub issues
4. Create a new issue with your system information:
   - Linux distribution and version
   - Error messages
   - Build log (if applicable)
   - System information (`uname -a`)
