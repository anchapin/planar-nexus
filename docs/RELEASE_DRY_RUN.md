# Planar Nexus Release Dry-Run Checklist

Validates one cold-start release end-to-end without publishing a real
build. **Use this every time you onboard a new release engineer and
once per quarter as a fire drill.** Companion to
[`/docs/RELEASE_RUNBOOK.md`](./RELEASE_RUNBOOK.md).

> Tag convention: `v0.0.0-rc.<N>`. The release workflow treats any tag
> matching `v*` as a release trigger, so a dry-run tag still exercises
> every job.

## Pre-flight (local, ~10 min)

- [ ] `git checkout main && git pull`
- [ ] `npm ci`
- [ ] `npm run typecheck && npm run lint && npm test`
- [ ] Confirm Node 20+, Rust stable, Tauri CLI 2.x
- [ ] Confirm `src-tauri/tauri.conf.json` `version` matches the rc tag
- [ ] Pull secrets from 1Password vault `Planar Nexus — Release
      Engineering` into a scratch dir (do **not** commit)

## Trigger (remote, ~25 min wall-clock)

- [ ] `git tag -a v0.0.0-rc.1 -m "Dry run rc.1"`
- [ ] `git push origin v0.0.0-rc.1`
- [ ] Open <https://github.com/anchapin/planar-nexus/actions>; pin the
      Release Automation run
- [ ] Confirm `build-windows`, `build-macos`, `build-linux` all `success`
- [ ] Confirm `release` job created a **draft** release (the workflow
      marks `draft: false`; mark it draft manually if you want to keep
      the dry-run off the public release feed)

## Per-platform verification (artifacts tab)

- [ ] **Windows**: download `windows-nsis-installer/*.exe`, run
      `signtool verify /pa Planar-Nexus_*.exe` locally, expect
      `Signed` and a valid timestamp
- [ ] **macOS**: download `macos-app/*.app.zip` (or `.dmg`), mount,
      run `xcrun stapler validate` and `spctl --assess --verbose=4`;
      both must return `accepted`
- [ ] **Linux**: download `linux-deb-package/*.deb`, install in a
      throwaway VM/container, verify `gpg --verify` succeeds against
      `docs/keys/release.pub`

## Failure-recovery drill (5 min)

- [ ] Force a failure: push an empty tag
      `git push origin --delete v0.0.0-rc.1 && git tag v0.0.0-empty && git push origin v0.0.0-empty`
      (expect: workflow runs but `release` job sees no version and
      skips)
- [ ] Confirm `notify-failure` job runs when one platform is broken
      (e.g. delete `package-lock.json` in a fork PR to simulate npm
      failure) — verify the job message contains the runbook URL

## Cleanup

- [ ] Delete the rc tag and any draft release in the GitHub UI
- [ ] `git push origin --delete v0.0.0-rc.1`
- [ ] Wipe scratch secrets dir: `rm -rf ~/.planar-nexus-dryrun/`
- [ ] File a follow-up issue for any step that took longer than the
      budget above

## Sign-off

| Item | Confirmed |
|---|---|
| All build jobs green | ☐ |
| All platform signatures valid | ☐ |
| `notify-failure` job references runbook URL | ☐ |
| Release engineer name + date logged in release NOTES | ☐ |

---

_Last reviewed: 2026-06-30 · Companion to RELEASE_RUNBOOK.md._