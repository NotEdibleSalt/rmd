import { invoke } from '@tauri-apps/api/core';

/** Strip ./ prefix and .md/.markdown extension from a wikilink target. */
function normalizeTarget(raw: string): string {
  return raw
    .replace(/^[.\/\\]+/, '')
    .replace(/\.(md|markdown)$/i, '');
}

export interface WorkspaceFile {
  name: string;
  path: string;
  full_path: string;
  modified: string;
}

export interface WorkspaceIndexData {
  root: string;
  files: WorkspaceFile[];
}

export interface BacklinkEntry {
  file_path: string;
  file_name: string;
  line_content: string;
  line_number: number;
}

export interface GraphNode {
  id: string;
  label: string;
  path: string;
  link_count: number;
  backlink_count: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class WorkspaceIndex {
  root: string | null = null;
  files: Map<string, WorkspaceFile> = new Map();
  nameToPath: Map<string, string> = new Map();

  async build(root: string): Promise<void> {
    const data = await invoke<WorkspaceIndexData>('scan_workspace', { path: root });
    this.root = root;
    this.files.clear();
    this.nameToPath.clear();
    for (const f of data.files) {
      this.files.set(f.full_path, f);
      this.nameToPath.set(f.name.toLowerCase(), f.full_path);
    }
  }

  resolve(name: string): WorkspaceFile | null {
    // Direct lookup first
    let path = this.nameToPath.get(name.toLowerCase());
    if (path) return this.files.get(path) ?? null;

    // Try normalized name (strip ./ prefix, .md extension)
    const normalized = normalizeTarget(name).toLowerCase();
    if (normalized !== name.toLowerCase()) {
      path = this.nameToPath.get(normalized);
      if (path) return this.files.get(path) ?? null;
    }

    return null;
  }

  fuzzySearch(query: string, limit = 10): WorkspaceFile[] {
    const q = query.toLowerCase();
    return Array.from(this.files.values())
      .filter(f => f.name.toLowerCase().includes(q))
      .slice(0, limit);
  }

  async autoResolve(currentFilePath: string | null): Promise<void> {
    if (this.root) return;
    if (!currentFilePath) return;
    const dir = currentFilePath.replace(/[\\/][^\\/]+$/, '');
    await this.build(dir);
  }
}
