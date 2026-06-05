import { useState } from 'react';
import { useEditorStore, selectSource, selectCurrentFile } from './store';
import { resolveAbsolutePath } from './utils/image';

const exportFormats = [
  { id: 'html', name: 'HTML', icon: '🌐', desc: '标准网页格式' },
  { id: 'pdf', name: 'PDF', icon: '📕', desc: '便携式文档格式' },
  { id: 'docx', name: 'DOCX', icon: '📘', desc: 'Word 文档格式' },
];

/** MIME type from file extension */
function mimeFromExt(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/svg+xml';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    default: return 'image/png';
  }
}

/**
 * Embed local images in markdown source as base64 data URIs.
 * Handles both markdown syntax `![alt](path)` and raw HTML `<img src="path">`.
 *
 * Uses `replaceAll` so duplicate image references in the same document are all embedded.
 */
async function embedImagesInSource(source: string, currentDir: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');

  // Resolve a local path to an absolute filesystem path; returns null if it's not a local file.
  const resolveLocal = (rawPath: string): string | null => {
    // Tauri asset protocol URL — URL-decode to get the real filesystem path
    if (rawPath.startsWith('http://asset.localhost/')) {
      try {
        return decodeURIComponent(rawPath.slice('http://asset.localhost/'.length));
      } catch {
        return null;
      }
    }
    // Remote / data URLs — skip
    if (rawPath.startsWith('data:') || rawPath.startsWith('http://') || rawPath.startsWith('https://')) return null;
    const abs = resolveAbsolutePath(rawPath, currentDir);
    // resolveAbsolutePath returns the input unchanged for already-absolute paths
    if (abs === rawPath && !rawPath.startsWith('/') && !/^[A-Za-z]:[/\\]/.test(rawPath)) {
      // Still relative but currentDir is empty — can't resolve
      if (!currentDir) return null;
    }
    return abs;
  };

  let result = source;

  // 1. Process markdown images: ![alt](path)
  const mdRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
  for (const match of source.matchAll(mdRe)) {
    const [full, alt, rawPath] = match;
    const absPath = resolveLocal(rawPath);
    if (!absPath) continue;

    try {
      const b64 = await invoke<string>('read_image_base64', { path: absPath });
      const dataUri = `data:${mimeFromExt(rawPath)};base64,${b64}`;
      result = result.replaceAll(full, `![${alt}](${dataUri})`);
    } catch {
      // file not found or read error — leave path as-is
    }
  }

  // 2. Process raw HTML <img src="path">
  const htmlRe = /<img\s[^>]*?src\s*=\s*["']([^"']+)["'][^>]*>/g;
  for (const match of source.matchAll(htmlRe)) {
    const [fullTag, rawPath] = match;
    const absPath = resolveLocal(rawPath);
    if (!absPath) continue;

    try {
      const b64 = await invoke<string>('read_image_base64', { path: absPath });
      const dataUri = `data:${mimeFromExt(rawPath)};base64,${b64}`;
      const newTag = fullTag.replaceAll(rawPath, dataUri);
      result = result.replaceAll(fullTag, newTag);
    } catch {
      // file not found or read error — leave path as-is
    }
  }

  return result;
}

export function ExportDialog() {
  const source = useEditorStore(selectSource);
  const currentFile = useEditorStore(selectCurrentFile);
  const { currentDir, theme, setExportDialogOpen } = useEditorStore();
  const [selectedFormat, setSelectedFormat] = useState('html');
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  const handleExport = async () => {
    setExporting(true);
    setExportMsg('');

    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { invoke } = await import('@tauri-apps/api/core');

      const extMap: Record<string, string> = { html: 'html', pdf: 'pdf', docx: 'docx' };
      const ext = extMap[selectedFormat] || 'html';
      const defaultName = currentFile
        ? currentFile.replace(/\.(md|markdown)$/, '') + '.' + ext
        : `untitled.${ext}`;

      const filters: Record<string, { name: string; extensions: string[] }[]> = {
        html: [{ name: 'HTML', extensions: ['html'] }],
        pdf: [{ name: 'PDF', extensions: ['pdf'] }],
        docx: [{ name: 'Word Document', extensions: ['docx'] }],
      };

      const path = await save({
        defaultPath: defaultName,
        filters: filters[selectedFormat] || filters.html,
      });

      if (!path) {
        setExporting(false);
        return;
      }

      // Pre-process: embed local images as data URIs so exported files are self-contained
      const embeddedSource = await embedImagesInSource(source, currentDir || '');
      const basePath = currentDir || '';

      // Extract the currently active markdown theme CSS from the DOM
      const styleTag = document.getElementById('rmd-markdown-theme');
      const markdownThemeCss = styleTag?.textContent || '';

      switch (selectedFormat) {
        case 'html': {
          const html = await invoke('export_html', {
            source: embeddedSource,
            title: currentFile?.split(/[\\/]/).pop() || 'RMD Document',
            theme,
            basePath,
            markdownThemeCss: markdownThemeCss || undefined,
          });
          await invoke('save_file', { path, content: html });
          break;
        }
        case 'pdf':
          await invoke('export_pdf', {
            source,
            outputPath: path,
            basePath: currentDir || '',
            theme,
            markdownThemeCss: markdownThemeCss || undefined,
          });
          break;
        case 'docx':
          await invoke('export_docx', {
            source: embeddedSource,
            outputPath: path,
            basePath,
            markdownThemeCss: markdownThemeCss || undefined,
          });
          break;
      }

      setExportMsg(`✅ 成功导出为 ${selectedFormat.toUpperCase()} 格式`);
    } catch (e: any) {
      setExportMsg(`❌ 导出失败: ${e}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={() => setExportDialogOpen(false)}>
      <div className="dialog export-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>导出文档</h2>
          <button className="dialog-close" onClick={() => setExportDialogOpen(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="dialog-body">
          <div className="export-formats">
            {exportFormats.map((fmt) => (
              <button
                key={fmt.id}
                className={`export-format-card ${selectedFormat === fmt.id ? 'active' : ''}`}
                onClick={() => setSelectedFormat(fmt.id)}
              >
                <span className="format-icon">{fmt.icon}</span>
                <span className="format-name">{fmt.name}</span>
                <span className="format-desc">{fmt.desc}</span>
              </button>
            ))}
          </div>
          {exportMsg && <div className="export-msg">{exportMsg}</div>}
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={() => setExportDialogOpen(false)}>取消</button>
          <button className="btn btn-primary" onClick={handleExport} disabled={exporting}>
            {exporting ? '导出中...' : `导出为 ${exportFormats.find(f => f.id === selectedFormat)?.name}`}
          </button>
        </div>
      </div>
    </div>
  );
}
