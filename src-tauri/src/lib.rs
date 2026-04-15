use tauri::Manager;

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSFloatingWindowLevel, NSWindow};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(err) = window.set_visible_on_all_workspaces(true) {
                        eprintln!("failed to enable visible on all workspaces: {err}");
                    }
                    apply_macos_floating_level(&window);
                }
            }

            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(err) = window.set_always_on_top(true) {
                        eprintln!("failed to enable always on top on Windows: {err}");
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
fn apply_macos_floating_level(window: &tauri::WebviewWindow) {
    let ns_window = match window.ns_window() {
        Ok(ns_window) => ns_window,
        Err(err) => {
            eprintln!("failed to get NSWindow handle: {err}");
            return;
        }
    };

    unsafe {
        let ns_window: &NSWindow = &*ns_window.cast();
        // Keep Tomo as a normal NSWindow while explicitly using the floating
        // level that sits above app windows on macOS.
        ns_window.setLevel(NSFloatingWindowLevel);
    }
}
