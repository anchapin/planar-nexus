# Planar Nexus Release Runbook

Operational runbook for cutting a Tauri desktop release. Companion to
[`TAURI_BUILDS.md`](../../TAURI_BUILDS.md) (build mechanics) and
[`/docs/RELEASE_DRY_RUN.md`](./RELEASE_DRY_RUN.md) (cold-start checklist).
The release workflow lives at `.github/workflows/release.yml`.

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Secrets Inventory](#2-secrets-inventory)
3. [GitHub `Releases` Environment Checklist](#3-github-releases-environment-checklist)
4. [Windows Code-Signing Flow](#4-windows-code-signing-flow)
5. [macOS Code-Signing & Notarization Flow](#5-macos-code-signing--notarization-flow)
6. [Linux Packaging & GPG Signing](#6-linux-packaging--gpg-signing)
7. [Tauri Updater Endpoint & Pubkey Rotation](#7-tauri-updater-endpoint--pubkey-rotation)
8. [Troubleshooting](#8-troubleshooting)
9. [Rollback Procedure](#9-rollback-procedure)
10. [Signing-Key Rotation Policy](#10-signing-key-rotation-policy)

---

## 1. Prerequisites

- Maintainer role on `anchapin/planar-nexus` (push to `main`, tag push).
- 1Password access to the `Planar Nexus — Release Engineering` vault.
- Local: Node 20+, Rust stable, Tauri CLI 2.x, platform toolchain (see
  [`TAURI_BUILDS.md`](../../TAURI_BUILDS.md) §Prerequisites).
- Read [`/docs/RELEASE_DRY_RUN.md`](./RELEASE_DRY_RUN.md) end-to-end once
  before your first release.

## 2. Secrets Inventory

All secrets live under **Settings → Secrets and variables → Actions** on
the `Releases` GitHub Environment (never repository-wide).

| Secret | Owner | Scope | Notes |
|---|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Release lead | All | base64 of `.key` from `tauri signer generate -p "$PW"`. Rotated yearly. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Release lead | All | Password used above. Stored in 1Password. |
| `WINDOWS_CERTIFICATE` | Release lead | Win | base64 of `.pfx`. Use EV or Azure Trusted Signing — see §4. |
| `WINDOWS_CERTIFICATE_PASSWORD` | Release lead | Win | `.pfx` export password. |
| `APPLE_SIGNING_IDENTITY` | Release lead | macOS | `Developer ID Application: Planar Nexus (TEAMID)`. |
| `APPLE_ID` | Release lead | macOS | Apple ID email for notarytool. |
| `APPLE_PASSWORD` | Release lead | macOS | App-specific password (NOT the Apple ID password). |
| `APPLE_TEAM_ID` | Release lead | macOS | 10-char team identifier. |
| `GPG_SIGNING_KEY_FINGERPRINT` | Release lead | Linux | 40-char subkey fingerprint for `.deb`/`.rpm` signing. |
| `GPG_SIGNING_KEY_PASSPHRASE` | Release lead | Linux | Passphrase for the above key. |

Secrets are **never** echoed in logs. The `notify-failure` job posts the
runbook URL so on-call can recover without reading secrets.

## 3. GitHub `Releases` Environment Checklist

A new release engineer must complete every row before their first tag
push.

| Step | Action | Verified |
|---|---|---|
| 1 | Added as environment reviewer on `Releases` | ☐ |
| 2 | Added to `@anchapin/planar-nexus` team with `Maintain` role | ☐ |
| 3 | Received 1Password vault invite; downloaded Tauri `.key` and `.pfx` locally for dry-run | ☐ |
| 4 | Created an Apple Developer app-specific password at <https://appleid.apple.com> | ☐ |
| 5 | Ran `docs/RELEASE_DRY_RUN.md` end-to-end on a throwaway `v0.0.0-rc.X` tag | ☐ |
| 6 | Confirmed GitHub notification routing for `release.yml` failures | ☐ |
| 7 | Read this runbook end-to-end | ☐ |

## 4. Windows Code-Signing Flow

Tauri 2 invokes `signtool.exe` via the Windows SDK; the certificate is
fed in as a base64 secret and rehydrated at build time.

1. Acquire a code-signing cert. **Preferred**: Azure Trusted Signing
   (cloud, no hardware). **Alternative**: Sectigo / DigiCert EV
   certificate on a hardware token (e.g. YubiKey 5).
2. Export as `.pfx` (`Export-PfxCertificate` on Windows or `openssl`).
3. Encode: `base64 -i cert.pfx | tr -d '\n' > cert.b64`. Save into
   `WINDOWS_CERTIFICATE`; the export password into
   `WINDOWS_CERTIFICATE_PASSWORD`.
4. In `release.yml::build-windows` add steps:
   ```yaml
   - uses: azure/login@v1
     with: { creds: '{"clientId":"${{ secrets.AZURE_CLIENT_ID }}", ...}' }
   - run: |
       echo "${{ secrets.WINDOWS_CERTIFICATE }}" | base64 -d > cert.pfx
       # for Azure Trusted Signing use azure-signtool; for .pfx use signtool below
   ```
5. Tauri reads `bundle.windows.certificateThumbprint` +
   `timestampUrl` from `src-tauri/tauri.conf.json` — keep `http://
   timestamp.digicert.com` or move to `http://timestamp.sectigo.com`.
6. EV certs on a USB token cannot leave the host; rotate the matrix to
   `windows-2019` self-hosted runner with the token attached.

## 5. macOS Code-Signing & Notarization Flow

`tauri build --target universal-apple-darwin` calls `codesign` then
`notarytool`. Entitlements live in
[`/src-tauri/entitlements.plist`](../../src-tauri/entitlements.plist).

1. Generate a `Developer ID Application` cert in App Store Connect.
2. Save the identity name (e.g. `Developer ID Application: Planar Nexus
   (TEAMID)`) into `APPLE_SIGNING_IDENTITY`.
3. Create an app-specific password and store in `APPLE_PASSWORD`.
4. In `release.yml::build-macos` add, *after* `tauri build`:
   ```bash
   APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/Planar-Nexus.app"
   xcrun notarytool submit "$APP" --apple-id "$APPLE_ID" \
     --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
   xcrun stapler staple "$APP"
   ```
5. Verify: `xcrun stapler validate "$APP"` and
   `spctl --assess --verbose=4 "$APP"` — both must return `accepted`.
6. Zip the app *after* stapling: `ditto -c -k --sequesterRsrc --keepParent
   "$APP" Planar-Nexus.zip` for direct download alongside the DMG.

## 6. Linux Packaging & GPG Signing

The `.deb` and `.rpm` bundles are produced unsigned. To add GPG
signing:

1. Generate a maintainer key: `gpg --full-generate-key` (RSA 4096,
   `Sign` capability only).
2. Export the signing subkey:
   ```bash
   gpg --export-secret-keys --armor <FPR> > release.key
   gpg --export                --armor <FPR> > release.pub
   ```
3. Store `release.key` as `GPG_SIGNING_KEY_FINGERPRINT` +
   `GPG_SIGNING_KEY_PASSPHRASE` as repo secrets. Publish `release.pub`
   in `docs/keys/release.pub` so users can verify.
4. Post-process in `release.yml::build-linux`:
   ```bash
   echo "$GPG_SIGNING_KEY" | gpg --batch --import
   for f in src-tauri/target/release/bundle/{deb,appimage,rpm}/*; do
     gpg --batch --yes --local-user "$GPG_SIGNING_KEY_FINGERPRINT" \
       --detach-sign --armor "$f"
   done
   ```
5. AppImage is currently built without internal signing. Acceptable for
   the current threat model; revisit if distributing via apt/deb repos.

## 7. Tauri Updater Endpoint & Pubkey Rotation

The updater is enabled but `pubkey: ""` and `endpoints: []` in
[`/src-tauri/tauri.conf.json`](../../src-tauri/tauri.conf.json) lines
81–85 are empty — auto-update will **not fire** until they are filled
in.

1. Generate the signing keypair locally:
   ```bash
   tauri signer generate -w ~/.tauri/planar-nexus.key -p "$PW"
   ```
   Save the **public key** into `tauri.conf.json` → `plugins.updater.pubkey`.
2. Host the manifest at e.g.
   `https://github.com/anchapin/planar-nexus/releases/latest/download/
   update.json`. List it under `plugins.updater.endpoints`.
3. To rotate: generate a new keypair, update `pubkey`, ship a release
   signed by **both** the old and new keys (Tauri supports multiple
   pubkeys during overlap), then drop the old one after 90 days.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `signtool` `0x800B0100` | Cert expired or wrong chain | Re-export `.pfx` with full chain, re-upload secret |
| `notarytool` `Package Invalid` | Entitlements misaligned | Diff `entitlements.plist` against last green build |
| `gpg: signing failed: No passphrase` | Secret missing in `Releases` env | Re-add `GPG_SIGNING_KEY_PASSPHRASE` |
| Build green but Gatekeeper rejects | Staple step skipped | Re-run stapling, rebuild DMG |
| Updater never fires | Empty `pubkey`/`endpoints` | Complete §7 before tagging |

## 9. Rollback Procedure

1. Identify the last green tag: `git tag --sort=-v:refname | head -5`.
2. Delete the bad release assets: GitHub UI → Releases → edit → delete
   binaries (keep the tag and notes for forensics).
3. If the **updater** shipped a broken manifest, publish a new tag
   immediately with the previous `update.json` and bump `version` only.
4. For a hard revert (e.g. signing key compromise): see §10, then
   delete the tag, yank the release, and re-cut from the prior green tag.

## 10. Signing-Key Rotation Policy

| Key | Max age | Trigger |
|---|---|---|
| Tauri updater key | 2 years | Planned; on key-compromise escalate to immediate |
| Windows code-signing cert | 1 year (EV hardware) / 3 years (Azure TS) | Vendor expiry; immediate on tamper |
| Apple Developer ID | 5 years | Apple expiry; immediate on tamper |
| GPG maintainer key | 2 years | Planned; immediate on tamper |

**Compromise playbook** (any key): (a) revoke the key with the vendor;
(b) publish a `SECURITY.md` advisory; (c) re-cut all three platforms
with new keys within 24 h; (d) keep the old key in `keys/archive/` for
forensic verification of past releases only.

---

_Last reviewed: 2026-06-30 · Owner: Release Engineering · Cross-refs:
Phase 26 (closed), issue #1112, #582, #451–#454._