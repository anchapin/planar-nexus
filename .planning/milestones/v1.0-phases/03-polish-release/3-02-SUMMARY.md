# Plan 3-02: Tauri Release Builds - Summary

## Status: PARTIALLY COMPLETE (Human Action Required)

### What Was Done

1. **Audit Completed** ✅
   - Verified Tauri v2 config exists at `src-tauri/tauri.conf.json`
   - Version: 1.0.0 configured
   - Bundle settings configured for Windows (NSIS), macOS, Linux

2. **Production Config Verified** ✅
   - Identifier: `com.planarnexus.desktop`
   - App name: Planar Nexus
   - Bundle icons configured

3. **Tauri CLI Not Installed** ⚠️
   - Cannot run builds without `cargo tauri` CLI
   - This requires manual installation on this Linux machine

### What's Pending (Requires Human Action)

| Task | Status | Notes |
|------|--------|-------|
| 3.2.1 Audit | ✅ Done | Config verified |
| 3.2.2 Production settings | ✅ Done | v1.0.0 configured |
| 3.2.3 Windows signing | ⏸️ Decision needed | Certificate procurement |
| 3.2.4 macOS signing | ⏸️ Decision needed | Apple Developer enrollment |
| 3.2.5 Windows build | ⏸️ Blocked | Needs Tauri CLI |
| 3.2.6 macOS build | ⏸️ Blocked | Needs macOS + certificates |
| 3.2.7 Linux build | ⏸️ Blocked | Needs Tauri CLI |
| 3.2.8 Auto-update | ⏸️ Blocked | Needs release first |
| 3.2.9 Test installs | ⏸️ Blocked | Needs builds |
| 3.2.10 Release assets | ⏸️ Blocked | Needs builds |

### Code Signing Decisions Needed

**Windows**:
- Option A: Buy commercial certificate ($100-400/yr)
- Option B: EV certificate ($300-600/yr)  
- Option C: Skip (SmartScreen warnings)

**macOS**:
- Requires Apple Developer Program ($99/yr)
- Notarization required for distribution

### To Complete Later

```bash
# Install Tauri CLI
cargo install cargo-tauri

# Build commands
cd src-tauri
cargo tauri build              # All platforms
cargo tauri build --target x86_64-pc-windows-msvc  # Windows
cargo tauri build --target x86_64-apple-darwin    # macOS Intel
cargo tauri build --target aarch64-apple-darwin   # macOS ARM
cargo tauri build --target x86_64-unknown-linux-gnu  # Linux
```

---

**Created**: 2026-03-16
**Note**: This plan has human-action checkpoints that cannot be automated. The configuration is ready for builds once Tauri CLI is installed and code signing is addressed.
