use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub theme: String,
    pub font_size: u32,
    pub font_family: String,
    pub auto_save: bool,
    pub line_numbers: bool,
    pub word_wrap: bool,
    pub default_view: String,
    pub editor_font_size: u32,
    pub preview_font_size: u32,
    pub line_height: f32,
    pub auto_format: bool,
    pub spell_check: bool,
    pub syntax_hint: bool,
    #[serde(default)]
    pub last_file: String,
    #[serde(default)]
    pub recent_files: Vec<String>,
    #[serde(default)]
    pub image_save_dir: String,
    #[serde(default)]
    pub external_theme_path: String,
    #[serde(default)]
    pub external_theme_dir: String,
    #[serde(default)]
    pub workspace_root: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "light".to_string(),
            font_size: 16,
            font_family: "system-ui".to_string(),
            auto_save: true,
            line_numbers: true,
            word_wrap: true,
            default_view: "rich".to_string(),
            editor_font_size: 15,
            preview_font_size: 16,
            line_height: 1.7,
            auto_format: true,
            spell_check: false,
            syntax_hint: true,
            last_file: String::new(),
            recent_files: Vec::new(),
            image_save_dir: String::new(),
            external_theme_path: String::new(),
            external_theme_dir: String::new(),
            workspace_root: String::new(),
        }
    }
}

fn config_path() -> Option<PathBuf> {
    let base = dirs_next::config_dir()?;
    Some(base.join("rmd").join("config.json"))
}

pub fn load_config() -> AppConfig {
    let path = config_path();
    match path {
        Some(p) => std::fs::read_to_string(p)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default(),
        None => AppConfig::default(),
    }
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path().ok_or("Cannot find config directory")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}
