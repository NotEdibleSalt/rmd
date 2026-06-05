use serde::{Deserialize, Serialize};
use walkdir::WalkDir;
use std::path::Path;
use regex::Regex;
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceFile {
    pub name: String,
    pub path: String,
    pub full_path: String,
    pub modified: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceIndexData {
    pub root: String,
    pub files: Vec<WorkspaceFile>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BacklinkEntry {
    pub file_path: String,
    pub file_name: String,
    pub line_content: String,
    pub line_number: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub path: String,
    pub link_count: usize,
    pub backlink_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

/// Strip ./ prefix and .md/.markdown extension from a wikilink target.
fn normalize_wikilink_target(raw: &str) -> String {
    let trimmed = raw.trim().trim_start_matches(|c| c == '.' || c == '/' || c == '\\');
    if let Some(stripped) = trimmed
        .strip_suffix(".md")
        .or_else(|| trimmed.strip_suffix(".markdown"))
    {
        stripped.to_string()
    } else {
        trimmed.to_string()
    }
}

fn strip_extension(filename: &str) -> String {
    Path::new(filename)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| filename.to_string())
}

fn scan_workspace_files(root: &str) -> Result<Vec<WorkspaceFile>, String> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root)
        .max_depth(20)
        .into_iter()
        .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'))
    {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.path().is_file() { continue; }
        let ext = entry.path().extension()
            .map(|e| e.to_string_lossy())
            .unwrap_or_default();
        if ext != "md" { continue; }
        let full_path = entry.path().to_string_lossy().to_string();
        let relative = full_path
            .strip_prefix(root)
            .unwrap_or(&full_path)
            .trim_start_matches(|c| c == '/' || c == '\\')
            .to_string();
        let name = strip_extension(&relative);
        let modified = entry.metadata().ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                let secs = d.as_secs() as i64;
                chrono::DateTime::from_timestamp(secs, 0)
                    .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        files.push(WorkspaceFile { name, path: relative, full_path, modified });
    }
    Ok(files)
}

#[tauri::command]
pub fn scan_workspace(path: String) -> Result<WorkspaceIndexData, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() { return Err(format!("Not a directory: {}", path)); }
    let files = scan_workspace_files(&path)?;
    Ok(WorkspaceIndexData { root: path, files })
}

#[tauri::command]
pub fn find_backlinks(workspace_root: String, target_name: String)
    -> Result<Vec<BacklinkEntry>, String>
{
    let mut results = Vec::new();
    let target_stripped = strip_extension(&target_name);
    let pattern = format!(r"\[\[{}(?:\|[^\]]*)?\]\]", regex::escape(&target_stripped));
    let pattern2 = format!(r"\[\[[^\]|]*/?{}[\|/\]]", regex::escape(&target_stripped));
    let wiki_re = Regex::new(&pattern).map_err(|e| e.to_string())?;
    let wiki_re2 = Regex::new(&pattern2).map_err(|e| e.to_string())?;

    for entry in WalkDir::new(&workspace_root)
        .max_depth(20)
        .into_iter()
        .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'))
    {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.path().is_file() { continue; }
        let ext = entry.path().extension()
            .map(|e| e.to_string_lossy())
            .unwrap_or_default();
        if ext != "md" { continue; }
        let file_path = entry.path().to_string_lossy().to_string();
        let file_name = entry.file_name().to_string_lossy().to_string();
        let content = std::fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
        for (i, line) in content.lines().enumerate() {
            if wiki_re.is_match(line) || wiki_re2.is_match(line) {
                results.push(BacklinkEntry {
                    file_path: file_path.clone(),
                    file_name: file_name.clone(),
                    line_content: line.to_string(),
                    line_number: i + 1,
                });
            }
        }
    }
    Ok(results)
}

#[tauri::command]
pub fn get_graph_data(workspace_root: String) -> Result<GraphData, String> {
    let files = scan_workspace_files(&workspace_root)?;
    let wiki_re = Regex::new(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")
        .map_err(|e| e.to_string())?;

    let mut name_to_path: HashMap<String, String> = HashMap::new();
    for f in &files {
        name_to_path.entry(f.name.clone()).or_insert_with(|| f.full_path.clone());
    }

    let mut node_map: HashMap<String, GraphNode> = HashMap::new();
    let mut edges = Vec::new();
    let mut link_counts: HashMap<String, usize> = HashMap::new();
    let mut backlink_counts: HashMap<String, usize> = HashMap::new();

    for f in &files {
        node_map.insert(f.full_path.clone(), GraphNode {
            id: f.full_path.clone(),
            label: f.name.clone(),
            path: f.full_path.clone(),
            link_count: 0,
            backlink_count: 0,
        });
    }

    for f in &files {
        let content = std::fs::read_to_string(&f.full_path).unwrap_or_default();
        let source_id = f.full_path.clone();
        for cap in wiki_re.captures_iter(&content) {
            // Skip matches that start with [[[ — indicates a bracket chain
            // from prior malformed insertion, not a real wikilink.
            let full = cap.get(0).map(|m| m.as_str()).unwrap_or("");
            if full.starts_with("[[[") {
                continue;
            }
            let target_name = normalize_wikilink_target(&cap[1]);
            if let Some(target_path) = name_to_path.get(&target_name) {
                let target_id = target_path.clone();
                edges.push(GraphEdge { source: source_id.clone(), target: target_id.clone() });
                *link_counts.entry(source_id.clone()).or_insert(0) += 1;
                *backlink_counts.entry(target_id.clone()).or_insert(0) += 1;
            }
        }
    }

    for node in node_map.values_mut() {
        node.link_count = *link_counts.get(&node.id).unwrap_or(&0);
        node.backlink_count = *backlink_counts.get(&node.id).unwrap_or(&0);
    }

    Ok(GraphData { nodes: node_map.into_values().collect(), edges })
}
