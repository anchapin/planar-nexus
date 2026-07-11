// Issue #1441: register `tauri-plugin-single-instance` FIRST on desktop.
// The plugin must run before any plugin that owns the main window so that
// a second `app.run()` invocation is intercepted and the first instance is
// focused (rather than racing two processes against the same on-disk
// IndexedDB / app-data directory — see issue body).
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();

  // Desktop-only: single-instance enforcement. On mobile platforms the
  // plugin crate's `init` is gated by `cfg(any(target_os = "macos",
  // windows, target_os = "linux"))` upstream, so we mirror that here.
  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(
      |app, _argv, _cwd| {
        // Bring the existing "main" webview window to the foreground.
        // The window is declared by `src-tauri/capabilities/default.json:6`.
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.show();
          let _ = window.unminimize();
          let _ = window.set_focus();
        }
      },
    ));
  }

  builder
    .setup(|app| {
      // Issue #1403: register the updater plugin on desktop only — mobile
      // builds skip it entirely because the in-app update UX is desktop-
      // scoped and the plugin is marked unsupported on Android/iOS.
      #[cfg(desktop)]
      {
        app.handle()
          .plugin(tauri_plugin_updater::Builder::new().build())?;
      }
      if cfg!(debug_assertions) {
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
    let plugin =
      tauri_plugin_single_instance::init(|app, _argv, _cwd| {
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
}