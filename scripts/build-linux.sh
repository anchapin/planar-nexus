#!/bin/bash

# Linux Build Helper Script for Planar Nexus
# This script automates the Linux build process

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="planar-nexus"
VERSION="0.1.0"
BUILD_DIR="src-tauri/target/release/bundle"

# Functions
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_dependencies() {
    print_info "Checking dependencies..."

    # Check for required commands
    for cmd in node npm cargo rustc; do
        if ! command -v $cmd &> /dev/null; then
            print_error "$cmd is not installed"
            exit 1
        fi
    done

    # Check for WebKitGTK
    if ! dpkg -l | grep -q libwebkit2gtk-4.1-dev; then
        print_warn "libwebkit2gtk-4.1-dev not found"
        print_info "Install with: sudo apt-get install libwebkit2gtk-4.1-dev"
        exit 1
    fi

    print_info "All dependencies are installed"
}

install_dependencies() {
    print_info "Installing Node.js dependencies..."
    npm install

    print_info "Building Next.js frontend..."
    NODE_ENV=production npm run build
}

build_appimage() {
    print_info "Building AppImage..."
    npx tauri build --target x86_64-unknown-linux-gnu

    if [ -f "${BUILD_DIR}/appimage/${PROJECT_NAME}_${VERSION}_amd64.AppImage" ]; then
        print_info "AppImage built successfully!"
        ls -lh "${BUILD_DIR}/appimage/${PROJECT_NAME}_${VERSION}_amd64.AppImage"
    else
        print_error "AppImage build failed"
        exit 1
    fi
}

build_deb() {
    print_info "Building DEB package..."
    npx tauri build --target x86_64-unknown-linux-gnu

    if [ -f "${BUILD_DIR}/deb/${PROJECT_NAME}_${VERSION}_amd64.deb" ]; then
        print_info "DEB package built successfully!"
        ls -lh "${BUILD_DIR}/deb/${PROJECT_NAME}_${VERSION}_amd64.deb"
    else
        print_error "DEB package build failed"
        exit 1
    fi
}

build_rpm() {
    print_info "Building RPM package..."
    npx tauri build --target x86_64-unknown-linux-gnu

    if [ -f "${BUILD_DIR}/rpm/${PROJECT_NAME}-${VERSION}-1.x86_64.rpm" ]; then
        print_info "RPM package built successfully!"
        ls -lh "${BUILD_DIR}/rpm/${PROJECT_NAME}-${VERSION}-1.x86_64.rpm"
    else
        print_error "RPM package build failed"
        exit 1
    fi
}

build_all() {
    print_info "Building all Linux packages..."
    npx tauri build --target x86_64-unknown-linux-gnu

    print_info "Build artifacts:"
    find "${BUILD_DIR}" -type f \( -name "*.AppImage" -o -name "*.deb" -o -name "*.rpm" \) -exec ls -lh {} \;
}

test_appimage() {
    local appimage="${BUILD_DIR}/appimage/${PROJECT_NAME}_${VERSION}_amd64.AppImage"

    if [ ! -f "$appimage" ]; then
        print_error "AppImage not found. Build it first with: $0 appimage"
        exit 1
    fi

    print_info "Testing AppImage..."
    chmod +x "$appimage"

    # Extract and verify
    "$appimage" --appimage-extract > /dev/null 2>&1

    if [ -d "squashfs-root" ]; then
        print_info "AppImage extraction successful"

        # Check for executable
        if [ -f "squashfs-root/AppRun" ]; then
            print_info "AppRun executable found"
        else
            print_error "AppRun executable not found"
            exit 1
        fi

        # Clean up
        rm -rf squashfs-root
    else
        print_error "AppImage extraction failed"
        exit 1
    fi

    print_info "AppImage test passed!"
}

test_deb() {
    local deb="${BUILD_DIR}/deb/${PROJECT_NAME}_${VERSION}_amd64.deb"

    if [ ! -f "$deb" ]; then
        print_error "DEB package not found. Build it first with: $0 deb"
        exit 1
    fi

    print_info "Testing DEB package..."

    # Check package info
    print_info "Package information:"
    dpkg -I "$deb"

    # Check package contents
    print_info "Package contents:"
    dpkg -c "$deb" | head -20

    # Check dependencies
    print_info "Dependencies:"
    dpkg -I "$deb" | grep Depends

    print_info "DEB package test passed!"
}

test_rpm() {
    local rpm="${BUILD_DIR}/rpm/${PROJECT_NAME}-${VERSION}-1.x86_64.rpm"

    if [ ! -f "$rpm" ]; then
        print_error "RPM package not found. Build it first with: $0 rpm"
        exit 1
    fi

    print_info "Testing RPM package..."

    # Check package info
    print_info "Package information:"
    rpm -qip "$rpm"

    # Check package contents
    print_info "Package contents:"
    rpm -qlp "$rpm" | head -20

    # Check dependencies
    print_info "Dependencies:"
    rpm -qp --requires "$rpm"

    print_info "RPM package test passed!"
}

show_help() {
    cat << EOF
Linux Build Helper Script for Planar Nexus

Usage: $0 [COMMAND] [OPTIONS]

Commands:
    check           Check build dependencies
    install         Install dependencies and build frontend
    appimage        Build AppImage package
    deb             Build DEB package
    rpm             Build RPM package
    all             Build all packages
    test-appimage   Test AppImage package
    test-deb        Test DEB package
    test-rpm        Test RPM package
    clean           Clean build artifacts
    help            Show this help message

Examples:
    $0 check                    # Check dependencies
    $0 all                      # Build all packages
    $0 appimage                 # Build AppImage only
    $0 test-appimage            # Test AppImage

Environment Variables:
    NODE_ENV                    Node environment (default: production)
    CARGO_BUILD_JOBS            Number of parallel jobs (default: auto)

For more information, see docs/LINUX_BUILD_GUIDE.md
EOF
}

clean_build() {
    print_info "Cleaning build artifacts..."
    cargo clean
    rm -rf "${BUILD_DIR}"
    print_info "Build artifacts cleaned"
}

# Main script logic
main() {
    local command="${1:-help}"

    case $command in
        check)
            check_dependencies
            ;;
        install)
            install_dependencies
            ;;
        appimage)
            check_dependencies
            install_dependencies
            build_appimage
            ;;
        deb)
            check_dependencies
            install_dependencies
            build_deb
            ;;
        rpm)
            check_dependencies
            install_dependencies
            build_rpm
            ;;
        all)
            check_dependencies
            install_dependencies
            build_all
            ;;
        test-appimage)
            test_appimage
            ;;
        test-deb)
            test_deb
            ;;
        test-rpm)
            test_rpm
            ;;
        clean)
            clean_build
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            print_error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

# Run main function
main "$@"
