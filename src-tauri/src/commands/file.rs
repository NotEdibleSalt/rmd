use crate::filesystem;
use crate::filesystem::FileEntry;

#[tauri::command]
pub fn open_file(path: &str) -> Result<String, String> {
    filesystem::read_file(path)
}

#[tauri::command]
pub fn save_file(path: &str, content: &str) -> Result<(), String> {
    filesystem::write_file(path, content)
}

#[tauri::command]
pub fn read_dir(path: &str) -> Result<Vec<FileEntry>, String> {
    filesystem::read_directory(path)
}

#[tauri::command]
pub fn create_file(path: &str) -> Result<(), String> {
    filesystem::create_file(path)
}

#[tauri::command]
pub fn delete_file(path: &str) -> Result<(), String> {
    filesystem::delete_file(path)
}

#[tauri::command]
pub fn rename_file(old_path: &str, new_path: &str) -> Result<(), String> {
    filesystem::rename_file(old_path, new_path)
}
