use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

/// Called by the webview after the user has handled the save prompt.
/// Sets the close-allowed flag and requests the window to close.
/// The on_window_event handler checks the flag and allows the close
/// instead of preventing it.
#[tauri::command]
pub fn app_allow_close(window: tauri::Window) {
    if let Some(flag) = window.try_state::<AtomicBool>() {
        flag.store(true, Ordering::Relaxed);
    }
    if let Err(e) = window.close() {
        eprintln!("app_allow_close: window.close() failed: {e}");
    }
}
