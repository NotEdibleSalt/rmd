mod commands;
mod config;
mod export;
mod docx;
mod filesystem;
mod markdown;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AtomicBool::new(false))
        .setup(|app| {
            let app_dir = app.path().app_data_dir().ok();
            if let Some(dir) = &app_dir {
                std::fs::create_dir_all(dir).ok();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let flag = window.state::<AtomicBool>();
                // If close was already allowed by the user (via app_allow_close), let it through
                if flag.load(Ordering::Relaxed) {
                    flag.store(false, Ordering::Relaxed);
                    return;
                }
                // Prevent the close and notify the webview to show the save prompt
                api.prevent_close();
                let _ = window.emit("app://close-requested", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::markdown::parse_markdown,
            commands::file::open_file,
            commands::file::save_file,
            commands::file::read_dir,
            commands::file::create_file,
            commands::file::delete_file,
            commands::file::rename_file,
            commands::export::export_html,
            commands::export::export_pdf,
            commands::export::export_docx,
            commands::config::get_config,
            commands::config::set_config,
            commands::search::search_files,
            commands::image::save_image,
            commands::image::read_image_base64,
            commands::theme::set_external_theme_dir,
            commands::theme::upload_external_theme,
            commands::theme::list_external_themes,
            commands::theme::delete_external_theme,
            commands::close::app_allow_close,
            commands::workspace::scan_workspace,
            commands::workspace::find_backlinks,
            commands::workspace::get_graph_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod inspect;
