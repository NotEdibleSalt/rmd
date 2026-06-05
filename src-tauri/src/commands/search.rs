use serde::{Deserialize, Serialize};
use regex::Regex;
use walkdir::WalkDir;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub file_path: String,
    pub file_name: String,
    pub line: usize,
    pub content: String,
    pub match_start: usize,
    pub match_end: usize,
}

#[tauri::command]
pub fn search_files(query: &str, dir: &str) -> Result<Vec<SearchResult>, String> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    let search_re = Regex::new(&regex::escape(query)).map_err(|e| e.to_string())?;
    let path = Path::new(dir);

    if !path.exists() || !path.is_dir() {
        return Ok(results);
    }

    for entry in WalkDir::new(dir)
        .max_depth(5)
        .into_iter()
        .filter_entry(|e| {
            !e.file_name()
                .to_string_lossy()
                .starts_with('.')
        })
    {
        let entry = entry.map_err(|e| e.to_string())?;

        if !entry.path().is_file() {
            continue;
        }

        let ext = entry.path().extension().map(|e| e.to_string_lossy()).unwrap_or_default();
        if ext != "md" && ext != "markdown" && ext != "txt" {
            continue;
        }

        if entry.path().starts_with(".") {
            continue;
        }

        let content = std::fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        let file_path = entry.path().to_string_lossy().to_string();

        for (i, line) in content.lines().enumerate() {
            for match_found in search_re.find_iter(line) {
                results.push(SearchResult {
                    file_path: file_path.clone(),
                    file_name: file_name.clone(),
                    line: i + 1,
                    content: line.to_string(),
                    match_start: match_found.start(),
                    match_end: match_found.end(),
                });
            }
        }
    }

    Ok(results)
}
