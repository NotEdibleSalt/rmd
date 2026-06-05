use serde::{Deserialize, Serialize};
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_file: bool,
    pub modified: String,
    pub size: u64,
    pub extension: String,
}

pub fn read_directory(path: &str) -> Result<Vec<FileEntry>, String> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut entries = Vec::new();

    for entry in WalkDir::new(dir).max_depth(1).sort_by(|a, b| {
        let a_is_dir = a.path().is_dir();
        let b_is_dir = b.path().is_dir();
        if a_is_dir != b_is_dir {
            b_is_dir.cmp(&a_is_dir)
        } else {
            a.file_name().cmp(b.file_name())
        }
    }) {
        let entry = entry.map_err(|e| e.to_string())?;

        if entry.path() == dir {
            continue;
        }

        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let path = entry.path().to_string_lossy().to_string();
        let name = entry.file_name().to_string_lossy().to_string();
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| {
                    let secs = d.as_secs();
                    let dt = chrono::DateTime::from_timestamp(secs as i64, 0)
                        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                        .unwrap_or_default();
                    dt
                })
            })
            .unwrap_or_default();

        // Skip hidden files
        if name.starts_with('.') {
            continue;
        }

        // Only show .md files and directories
        let extension = entry
            .path()
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();

        if !metadata.is_dir() && extension != "md" {
            continue;
        }

        entries.push(FileEntry {
            name,
            path,
            is_dir: metadata.is_dir(),
            is_file: metadata.is_file(),
            modified,
            size: metadata.len(),
            extension,
        });
    }

    Ok(entries)
}

pub fn read_file(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("File not found: {}", path));
    }
    std::fs::read_to_string(p).map_err(|e| e.to_string())
}

pub fn write_file(path: &str, content: &str) -> Result<(), String> {
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, content).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn create_file(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if p.exists() {
        return Err(format!("File already exists: {}", path));
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, "").map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_file(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("Not found: {}", path));
    }
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn rename_file(old_path: &str, new_path: &str) -> Result<(), String> {
    std::fs::rename(old_path, new_path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_image(base64_data: &str, save_dir: &str, filename: &str) -> Result<String, String> {
    use base64::Engine;

    let dir = Path::new(save_dir);
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    let file_path = dir.join(filename);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    std::fs::write(&file_path, bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}
