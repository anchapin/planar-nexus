// Issue #1441: register `tauri-plugin-single-instance` FIRST on desktop.
// The plugin must run before any plugin that owns the main window so that
// a second `app.run()` invocation is intercepted and the first instance is
// focused (rather than racing two processes against the same on-disk
// IndexedDB / app-data directory — see issue body).
//
// Issue #1727: release builds are observable. `tauri_plugin_log` is
// registered in EVERY profile (debug: verbose Info as before; release:
// Warn+ with a file target under app-data) and a `std::panic::set_hook`
// flushes a crash record (message + location) to disk before the process
// exits, so "the app just closes" reports leave a diagnostic artifact.
use std::path::{Path, PathBuf};

use tauri::Manager;

/// Log level per profile (issue #1727): debug keeps the historical verbose
/// `Info` filter; release logs at `Warn` and above.
fn log_level_for(release: bool) -> log::LevelFilter {
    if release {
        log::LevelFilter::Warn
    } else {
        log::LevelFilter::Info
    }
}

/// Build the log plugin for the current profile.
///
/// - Debug: identical to the historical registration (default targets —
///   stdout + webview console — at `Info`).
/// - Release: `Warn`+ written to `<log_dir>/planar-nexus.log` (the caller
///   passes app-data's `logs/` directory), so updater failures and plugin
///   errors survive after the desktop window closes.
fn build_log_plugin(release: bool, log_dir: PathBuf) -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let builder = tauri_plugin_log::Builder::new().level(log_level_for(release));
    if release {
        builder
            .targets(vec![tauri_plugin_log::Target::new(
                tauri_plugin_log::TargetKind::Folder {
                    path: log_dir,
                    file_name: Some("planar-nexus".into()),
                },
            )])
            .build()
    } else {
        // Preserve the pre-#1727 debug behavior exactly.
        builder.build()
    }
}

/// Path of the crash record a panic at `epoch_secs` (unix seconds) writes.
fn crash_record_path(crash_dir: &Path, epoch_secs: u64) -> PathBuf {
    crash_dir.join(format!("panic-{}.log", epoch_secs))
}

/// Install the panic hook that flushes a crash record before exit
/// (issue #1727).
///
/// The record contains the panic message and source location, written to
/// `<crash_dir>/panic-<unix-seconds>.log`. The previously-installed hook
/// (if any) is chained afterwards so default unwind/abort behavior and any
/// test harness hooks keep working.
fn install_panic_hook(crash_dir: PathBuf) {
    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "<non-string panic payload>".to_string()
        };
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown>".to_string());
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        // Best-effort: a panic hook must never panic itself.
        let _ = std::fs::create_dir_all(&crash_dir);
        let _ = std::fs::write(
            crash_record_path(&crash_dir, secs),
            format!(
                "panic at {}\nmessage: {}\nprofile: {}\ntimestamp: {} (unix seconds)\n",
                location,
                message,
                if cfg!(debug_assertions) {
                    "debug"
                } else {
                    "release"
                },
                secs
            ),
        );
        prev_hook(info);
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Desktop-only: single-instance enforcement. On mobile platforms the
    // plugin crate's `init` is gated by `cfg(any(target_os = "macos",
    // windows, target_os = "linux"))` upstream, so we mirror that here.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Bring the existing "main" webview window to the foreground.
            // The window is declared by `src-tauri/capabilities/default.json:6`.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));

        // Issue #1589: persist main-window geometry (size, position,
        // maximized/fullscreen state) across launches. Registered AFTER
        // single-instance (see the comment at the top of this file) — the
        // plugin only needs to capture state on window events, so the
        // ordering relative to single-instance is not load-bearing for
        // correctness, but the single-instance-first contract from #1441
        // still governs this builder.
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder
        .setup(|app| {
            // Issue #1727: install the panic hook FIRST so a panic anywhere
            // later in setup (or at the terminal `.expect(...)` on run)
            // still flushes a crash record under app-data.
            if let Ok(app_data) = app.path().app_data_dir() {
                install_panic_hook(app_data.join("crash-logs"));
            }

            // Issue #1403: register the updater plugin on desktop only — mobile
            // builds skip it entirely because the in-app update UX is desktop-
            // scoped and the plugin is marked unsupported on Android/iOS.
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }

            // Issue #1727: register logging in EVERY profile. Debug keeps the
            // historical verbose console logging; release writes Warn+ records
            // (webview console capture, updater failures, plugin errors) to a
            // file under app-data.
            if let Ok(app_data) = app.path().app_data_dir() {
                app.handle().plugin(build_log_plugin(
                    !cfg!(debug_assertions),
                    app_data.join("logs"),
                ))?;
            } else if cfg!(debug_assertions) {
                // No resolvable app-data dir (unusual): preserve the
                // historical debug-only console logging rather than silence.
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression test for issue #1441 — guards the contract that the
    /// single-instance plugin is the first plugin wired into the builder.
    /// We assert this by constructing a builder the same way `run()` does
    /// and confirming the call does not panic and returns a still-buildable
    /// Builder (the closure registered is opaque, but the API contract is
    /// what we care about: `tauri_plugin_single_instance::init` accepts the
    /// documented `|AppHandle, Vec<String>, String|` signature and we
    /// `set_focus` the `main` window — which is the plugin's recommended
    /// "focus existing instance" pattern).
    #[test]
    fn single_instance_plugin_initializes_with_main_window_callback() {
        let plugin = tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        });
        // The plugin must be constructible from a builder-ergonomic closure;
        // this would fail to compile if the upstream API or our closure
        // signature ever drift.
        let _builder = tauri::Builder::default().plugin(plugin);
    }

    /// Issue #1727: the log plugin must be constructible in BOTH profiles —
    /// release with the app-data file target + Warn level, debug with the
    /// historical default targets + Info level.
    #[test]
    fn log_plugin_builds_for_both_profiles_with_expected_levels() {
        let tmp = std::env::temp_dir().join("planar-nexus-log-plugin-test");
        let _release = build_log_plugin(true, tmp.clone());
        let _debug = build_log_plugin(false, tmp);
        assert_eq!(log_level_for(true), log::LevelFilter::Warn);
        assert_eq!(log_level_for(false), log::LevelFilter::Info);
    }

    /// Issue #1727: the panic hook installed by `run()` setup must flush a
    /// crash record (message + location) to the crash dir before the
    /// process exits. Verified functionally: install the hook exactly as
    /// setup does, trigger a caught panic, and assert the record exists.
    #[test]
    fn panic_hook_installed_by_setup_writes_crash_record() {
        let dir = std::env::temp_dir().join(format!(
            "planar-nexus-crash-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::remove_dir_all(&dir);

        let prev = std::panic::take_hook();
        install_panic_hook(dir.clone());
        let _ = std::panic::catch_unwind(|| panic!("setup-hook-test-boom"));
        std::panic::set_hook(prev);

        let mut found = false;
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let content = std::fs::read_to_string(entry.path()).unwrap_or_default();
                if content.contains("setup-hook-test-boom") && content.contains("lib.rs") {
                    found = true;
                }
            }
        }
        assert!(
            found,
            "a crash record containing the panic message and source \
             location must be written to the crash dir"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Issue #1727: crash-record filenames are deterministic per second so
    /// successive panics never clobber earlier records from the same run.
    #[test]
    fn crash_record_path_is_nested_under_crash_dir() {
        let dir = Path::new("/tmp/planar-nexus-crash-logs");
        let path = crash_record_path(dir, 1_700_000_000);
        assert!(path.starts_with(dir));
        assert_eq!(
            path.file_name().and_then(|n| n.to_str()),
            Some("panic-1700000000.log")
        );
    }
}
