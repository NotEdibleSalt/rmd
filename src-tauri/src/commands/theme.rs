use crate::config;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeEntry {
    pub name: String,
    pub path: String,
    pub dir_name: String,
}

/// Resolve the theme storage directory.
/// Returns the configured dir, or a default under app config dir.
fn resolve_theme_dir() -> Result<PathBuf, String> {
    let cfg = config::load_config();
    if !cfg.external_theme_dir.is_empty() {
        return Ok(PathBuf::from(&cfg.external_theme_dir));
    }
    let base = dirs_next::config_dir().ok_or("Cannot find config directory")?;
    Ok(base.join("rmd").join("themes"))
}

/// Scan a directory recursively for CSS files (max depth 2).
fn scan_css_files(dir: &Path) -> Vec<ThemeEntry> {
    let mut themes = Vec::new();
    if !dir.exists() {
        return themes;
    }
    for entry in WalkDir::new(dir).max_depth(2).sort_by(|a, b| {
        a.file_name().cmp(b.file_name())
    }) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().map(|e| e == "css").unwrap_or(false) {
            let dir_name = path
                .parent()
                .and_then(|p| p.file_name())
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            themes.push(ThemeEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                path: path.to_string_lossy().to_string(),
                dir_name,
            });
        }
    }
    themes
}

/// Set the external theme storage directory.
#[tauri::command]
pub fn set_external_theme_dir(path: String) -> Result<(), String> {
    let mut cfg = config::load_config();
    cfg.external_theme_dir = path;
    config::save_config(&cfg)
}

/// Upload a zip file containing CSS themes, extract it to the theme
/// storage directory, and return the list of available themes.
#[tauri::command]
pub fn upload_external_theme(zip_path: String) -> Result<Vec<ThemeEntry>, String> {
    let theme_dir = resolve_theme_dir()?;
    std::fs::create_dir_all(&theme_dir).map_err(|e| e.to_string())?;

    let zip_path = Path::new(&zip_path);
    let zip_stem = zip_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("theme");
    let extract_dir = theme_dir.join(zip_stem);
    std::fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;

    // Open and extract zip
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        // Sanitize: strip any leading separators to prevent path traversal
        let entry_name = entry.name().trim_start_matches(['/', '\\']);
        let out_path = extract_dir.join(entry_name);

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut outfile =
                std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            outfile.write_all(&buf).map_err(|e| e.to_string())?;
        }
    }

    // Persist theme dir if it was using the default
    let cfg = config::load_config();
    if cfg.external_theme_dir.is_empty() {
        let mut new_cfg = cfg;
        new_cfg.external_theme_dir = theme_dir.to_string_lossy().to_string();
        config::save_config(&new_cfg)?;
    }

    Ok(scan_css_files(&theme_dir))
}

/// List all available external CSS themes in the storage directory.
#[tauri::command]
pub fn list_external_themes() -> Result<Vec<ThemeEntry>, String> {
    let theme_dir = resolve_theme_dir()?;
    if !theme_dir.exists() {
        return Ok(Vec::new());
    }
    Ok(scan_css_files(&theme_dir))
}

/// Delete an external theme by its file path.
#[tauri::command]
pub fn delete_external_theme(theme_path: String) -> Result<(), String> {
    let path = Path::new(&theme_path);
    if !path.exists() {
        return Err("Theme file not found".to_string());
    }
    std::fs::remove_file(path).map_err(|e| e.to_string())
}
