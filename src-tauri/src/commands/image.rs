use crate::filesystem;
use base64::Engine;
use uuid::Uuid;

#[tauri::command]
pub fn save_image(base64_data: &str, save_dir: &str, filename: Option<&str>) -> Result<String, String> {
    let (clean_data, ext): (&str, &str) = if let Some(pos) = base64_data.find(',') {
        let prefix = &base64_data[..pos];
        let ext = if prefix.contains("png") {
            "png"
        } else if prefix.contains("jpeg") || prefix.contains("jpg") {
            "jpg"
        } else if prefix.contains("gif") {
            "gif"
        } else if prefix.contains("svg") {
            "svg"
        } else if prefix.contains("webp") {
            "webp"
        } else {
            "png"
        };
        (&base64_data[pos + 1..], ext)
    } else {
        // No prefix — assume raw base64, default to png
        (base64_data, "png")
    };

    let filename = match filename {
        Some(name) if !name.is_empty() => name.to_string(),
        _ => format!("img_{}.{}", Uuid::new_v4(), ext),
    };

    filesystem::save_image(clean_data, save_dir, &filename)
}

#[tauri::command]
pub fn read_image_base64(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read image: {}", e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}
