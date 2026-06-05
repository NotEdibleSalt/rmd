use crate::config::{self, AppConfig};

#[tauri::command]
pub fn get_config() -> Result<AppConfig, String> {
    Ok(config::load_config())
}

#[tauri::command]
pub fn set_config(new_config: AppConfig) -> Result<(), String> {
    config::save_config(&new_config)
}
