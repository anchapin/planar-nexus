# Linux Build Configuration Guide

This document provides detailed instructions for building Planar Nexus on Linux systems.

## Prerequisites

### System Requirements

- Ubuntu 20.04+ or other Debian-based distributions
- Fedora 35+ or other RPM-based distributions
- 4GB RAM minimum (8GB recommended)
- 2GB disk space for build artifacts

### Required Software

#### Base Development Tools

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y \
    build-essential \
    curl \
    wget \
    git

# Fedora/RHEL
sudo dnf install -y \
    gcc \
    gcc-c++ \
    make \
    curl \
    wget \
    git
```

#### Rust Toolchain

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Verify installation
rustc --version
cargo --version
```

#### Node.js

```bash
# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

#### WebKitGTK and Dependencies

```bash
# Ubuntu/Debian
sudo apt-get install -y \
    libwebkit2gtk-4.1-dev \
    libappindicator3-dev \
    librsvg2-dev \
    patchelf \
    libssl-dev \
    libgtk-3-dev

# Fedora/RHEL
sudo dnf install -y \
    webkit2gtk4.1-devel \
    libappindicator-gtk3-devel \
    librsvg2-devel \
    openssl-devel \
    gtk3-devel
```

## Building Locally

### 1. Install Dependencies

```bash
# Clone repository
git clone https://github.com/anchapin/planar-nexus.git
cd planar-nexus

# Install Node.js dependencies
npm install
```

### 2. Build Next.js Frontend

```bash
# Production build
NODE_ENV=production npm run build
```

### 3. Build Tauri Application

```bash
# Build all formats (AppImage, DEB, RPM)
npm run build:tauri

# Build specific target
npx tauri build --target x86_64-unknown-linux-gnu
```

### 4. Locate Build Artifacts

After successful build, installers will be in:

```
src-tauri/target/release/bundle/
├── appimage/          # AppImage files (*.AppImage)
├── deb/               # Debian packages (*.deb)
└── rpm/               # RPM packages (*.rpm)
```

## Package Formats

### AppImage

**Advantages:**
- Works on most Linux distributions
- No installation required
- Self-contained with all dependencies

**Usage:**
```bash
# Make executable
chmod +x planar-nexus_0.1.0_amd64.AppImage

# Run
./planar-nexus_0.1.0_amd64.AppImage
```

**Size:** ~70-100 MB (includes media framework)

### DEB Package

**Advantages:**
- Native integration with Debian/Ubuntu
- Automatic dependency resolution
- System-wide installation

**Usage:**
```bash
# Install
sudo dpkg -i planar-nexus_0.1.0_amd64.deb

# If dependencies are missing
sudo apt-get install -f

# Uninstall
sudo apt-get remove planarnexus
```

**Dependencies:**
- `libwebkit2gtk-4.1-0`
- `libgtk-3-0`

**Size:** ~60-80 MB

### RPM Package

**Advantages:**
- Native integration with Fedora/RHEL
- Automatic dependency resolution
- System-wide installation

**Usage:**
```bash
# Install
sudo dnf install planar-nexus-0.1.0-1.x86_64.rpm

# Uninstall
sudo dnf remove planarnexus
```

**Dependencies:**
- `webkit2gtk4.1`
- `gtk3`

**Size:** ~60-80 MB

## Configuration

### Tauri Configuration

Linux-specific settings in `src-tauri/tauri.conf.json`:

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

### Custom Files

To include additional files in packages:

```json
{
  "bundle": {
    "linux": {
      "appimage": {
        "files": {
          "/usr/share/planarnexus/README.md": "../README.md"
        }
      }
    }
  }
}
```

## Cross-Compilation

### ARMv7 (32-bit)

```bash
# Add target
rustup target add armv7-unknown-linux-gnueabihf

# Install cross-compiler
sudo apt-get install gcc-arm-linux-gnueabihf

# Configure cargo
cat >> ~/.cargo/config.toml << EOF
[target.armv7-unknown-linux-gnueabihf]
linker = "arm-linux-gnueabihf-gcc"
EOF

# Add architecture
sudo dpkg --add-architecture armhf

# Install dependencies
sudo apt-get install libwebkit2gtk-4.1-dev:armhf

# Build
cargo tauri build --target armv7-unknown-linux-gnueabihf
```

### ARM64 (64-bit)

```bash
# Add target
rustup target add aarch64-unknown-linux-gnu

# Install cross-compiler
sudo apt-get install gcc-aarch64-linux-gnu

# Configure cargo
cat >> ~/.cargo/config.toml << EOF
[target.aarch64-unknown-linux-gnu]
linker = "aarch64-linux-gnu-gcc"
EOF

# Add architecture
sudo dpkg --add-architecture arm64

# Install dependencies
sudo apt-get install libwebkit2gtk-4.1-dev:arm64

# Build
cargo tauri build --target aarch64-unknown-linux-gnu
```

## Signing

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

## Debugging

### Check Package Contents

```bash
# DEB
dpkg -c planar-nexus_0.1.0_amd64.deb

# RPM
rpm -qlp planar-nexus-0.1.0-1.x86_64.rpm
```

### Check Dependencies

```bash
# DEB
dpkg -I planar-nexus_0.1.0_amd64.deb | grep Depends

# RPM
rpm -qp --requires planar-nexus-0.1.0-1.x86_64.rpm
```

### View Package Information

```bash
# DEB
dpkg -I planar-nexus_0.1.0_amd64.deb

# RPM
rpm -qip planar-nexus-0.1.0-1.x86_64.rpm
```

### Installation Issues

```bash
# Verbose DEB installation
sudo dpkg -Dhv -i planar-nexus_0.1.0_amd64.deb

# Verbose RPM installation
sudo rpm -ivvh planar-nexus-0.1.0-1.x86_64.rpm
```

## CI/CD

### GitHub Actions

The `.github/workflows/desktop-build.yml` workflow builds Linux packages on Ubuntu 22.04.

**Manual Trigger:**
1. Go to Actions tab in GitHub
2. Select "Desktop Builds"
3. Click "Run workflow"
4. Select "linux" for platform

**Automatic Trigger:**
- Runs on GitHub release publication

### Docker Build

```dockerfile
FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    libwebkit2gtk-4.1-dev \
    libappindicator3-dev \
    librsvg2-dev \
    patchelf

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Build application
WORKDIR /app
COPY . .
RUN npm install && \
    NODE_ENV=production npm run build && \
    npm run build:tauri
```

## Troubleshooting

### Common Issues

#### GLIBC Version Error

```
Error: /usr/lib/libc.so.6: version 'GLIBC_2.33' not found
```

**Solution:** Build on older system (Ubuntu 18.04) or use containerized build.

#### Missing WebKitGTK

```
Error: Package 'webkit2gtk-4.1-dev' not found
```

**Solution:**
```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev
```

#### AppImage Won't Execute

```bash
# Make executable
chmod +x planar-nexus_0.1.0_amd64.AppImage

# Run with FUSE
./planar-nexus_0.1.0_amd64.AppImage

# If FUSE issues, extract and run
./planar-nexus_0.1.0_amd64.AppImage --appimage-extract
./squashfs-root/AppRun
```

#### Build Fails with OpenSSL Error

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

## Performance Optimization

### Build Time Reduction

```bash
# Use Rust cache
export CARGO_HOME="$HOME/.cargo"
export PATH="$CARGO_HOME/bin:$PATH"

# Use sccache for incremental builds
cargo install sccache
export RUSTC_WRAPPER=sccache

# Parallel builds
export CARGO_BUILD_JOBS=8
```

### Reduce Package Size

```json
{
  "bundle": {
    "linux": {
      "appimage": {
        "bundleMediaFramework": false  // Reduces size by ~30MB
      }
    }
  }
}
```

## Distribution

### GitHub Releases

1. Create a new release on GitHub
2. CI/CD automatically builds and uploads artifacts
3. Download appropriate package for your distribution

### AUR (Arch Linux)

Create a PKGBUILD file:

```bash
# Maintainer: Your Name <email@example.com>
pkgname=planar-nexus
pkgver=0.1.0
pkgrel=1
pkgdesc="A digital Magic: The Gathering tabletop experience"
arch=('x86_64')
url="https://github.com/anchapin/planar-nexus"
license=('MIT')
depends=('webkit2gtk-4.1' 'gtk3')
source=("$pkgname-$pkgver.tar.gz::https://github.com/anchapin/planar-nexus/archive/v$pkgver.tar.gz")
sha256sums=('SKIP')

build() {
  cd "$pkgname-$pkgver"
  npm install
  NODE_ENV=production npm run build
  npm run build:tauri
}

package() {
  cd "$pkgname-$pkgver"
  install -Dm755 src-tauri/target/release/planar-nexus "$pkgdir/usr/bin/planar-nexus"
}
```

## Resources

- [Tauri Documentation](https://v2.tauri.app/)
- [AppImage Documentation](https://docs.appimage.org/)
- [Debian Packaging Guide](https://www.debian.org/doc/manuals/debmake-doc/ch.en.html)
- [RPM Packaging Guide](https://rpm-packaging-guide.github.io/)

## Support

For issues specific to Linux builds:
1. Check this guide first
2. Search existing GitHub issues
3. Create a new issue with:
   - Linux distribution and version
   - Error messages
   - Build log (if applicable)
   - System information (`uname -a`)
