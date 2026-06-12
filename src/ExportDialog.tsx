import { useState } from 'react';
import { useEditorStore, selectSource, selectCurrentFile } from './store';
import { resolveAbsolutePath } from './utils/image';

/**
 * Get Mermaid theme configuration matching the app theme (copied from MermaidNodeView)
 */
function getMermaidTheme() {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;

  // Read 12-color palette from CSS theme variables (fallbacks = light theme)
  const cp = (i: number) =>
    v(`--chart-color-${i}`,
      ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c',
        '#e67e22','#2980b9','#27ae60','#d35400','#8e44ad','#16a085'][i-1]);

  return {
    theme: 'base' as const,
    themeVariables: {
      // --- General / Structural ---
      background: v('--bg-primary', '#ffffff'),
      mainBkg: v('--bg-panel', '#ffffff'),
      primaryColor: v('--accent', '#4f6ef7'),
      primaryTextColor: v('--text-primary', '#1a1a2e'),
      primaryBorderColor: v('--border-color', '#e0e0e0'),
      lineColor: v('--text-muted', '#999'),
      secondaryColor: v('--bg-secondary', '#f8f9fa'),
      tertiaryColor: v('--bg-tertiary', '#f0f0f0'),
      nodeBorder: v('--border-color', '#e0e0e0'),
      clusterBkg: v('--bg-secondary', '#f8f9fa'),
      clusterBorder: v('--border-color', '#e0e0e0'),
      titleColor: v('--text-primary', '#1a1a2e'),
      edgeLabelBackground: v('--bg-panel', '#ffffff'),
      nodeTextColor: v('--text-primary', '#1a1a2e'),

      // --- Pie chart (uses 12-color palette via pie1-pie12 for per-sector colors) ---
      pie1: cp(1),  pie2: cp(2),  pie3: cp(3),
      pie4: cp(4),  pie5: cp(5),  pie6: cp(6),
      pie7: cp(7),  pie8: cp(8),  pie9: cp(9),
      pie10: cp(10), pie11: cp(11), pie12: cp(12),
      pieStroke: v('--border-color', '#e0e0e0'),
      pieTitleTextColor: v('--text-primary', '#1a1a2e'),
      pieSectionTextColor: v('--text-primary', '#1a1a2e'),

      // --- Sequence diagram ---
      actorBkg: v('--bg-secondary', '#f8f9fa'),
      actorBorder: v('--border-color', '#e0e0e0'),
      actorTextColor: v('--text-primary', '#1a1a2e'),
      actorLineColor: v('--border-color', '#e0e0e0'),
      signalColor: v('--text-muted', '#999'),
      signalTextColor: v('--text-primary', '#1a1a2e'),
      labelBoxBkgColor: v('--bg-secondary', '#f8f9fa'),
      labelBoxBorderColor: v('--accent', '#4f6ef7'),

      // --- Class diagram ---
      classText: v('--text-primary', '#1a1a2e'),
      classTextSecondary: v('--text-secondary', '#666'),
      classBkg: v('--bg-secondary', '#f8f9fa'),
      classBorder: v('--border-color', '#e0e0e0'),

      // --- State diagram ---
      stateLabelColor: v('--text-primary', '#1a1a2e'),
      stateBkg: v('--bg-secondary', '#f8f9fa'),
      stateBorder: v('--border-color', '#e0e0e0'),

      // --- Gantt chart ---
      taskBkg: v('--accent-light', '#eef1ff'),
      taskBorder: v('--accent', '#4f6ef7'),
      taskTextColor: v('--text-primary', '#1a1a2e'),
      taskTextOutsideColor: v('--text-secondary', '#666'),
      activeTaskBkg: v('--accent', '#4f6ef7'),
      activeTaskBorder: v('--accent-hover', '#3b5de7'),
      gridColor: v('--border-color', '#e0e0e0'),
      todayLineColor: v('--accent', '#4f6ef7'),

      // --- ER diagram ---
      entityBkg: v('--bg-panel', '#ffffff'),
      entityBorder: v('--border-color', '#e0e0e0'),
      entityTextColor: v('--text-primary', '#1a1a2e'),
      attributeBkg: v('--bg-secondary', '#f8f9fa'),
      attributeBorder: v('--border-color', '#e0e0e0'),
      attributeTextColor: v('--text-primary', '#1a1a2e'),
    },
  };
}

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

/**
 * Render ```mermaid code blocks to base64 SVG data URIs in markdown source.
 * Dynamically imports the Mermaid library — no window global dependency.
 * Falls back gracefully if Mermaid is unavailable or a block fails to render.
 * Replaced blocks become markdown image syntax: ![mermaid diagram](data:image/svg+xml;base64,...)
 */
/** Convert SVG to a base64 data URI (Word 2016+ supports SVG natively). */
function svgToDataUri(svg: string): string {
  const utf8Bytes = new TextEncoder().encode(svg);
  const binaryStr = Array.from(utf8Bytes).map(b => String.fromCharCode(b)).join('');
  return `data:image/svg+xml;base64,${btoa(binaryStr)}`;
}

async function renderMermaidBlocks(source: string, onProgress?: (msg: string) => void): Promise<string> {
  const regex = /```mermaid[ \t]*\n?([\s\S]*?)```/g;
  const blocks: { index: number; full: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    blocks.push({ index: match.index, full: match[0] });
  }
  if (blocks.length === 0) return source;

  const totalMatches = blocks.length;
  const replacements: { index: number; full: string; dataUri: string }[] = [];

  // Phase 1: Extract SVGs already rendered in the editor DOM (WYSIWYG mode)
  // These SVGs have foreignObject with text that Word renders natively.
  const domSvgs = document.querySelectorAll('.mermaid-preview svg');
  let mermaidLib: any;

  for (let i = 0; i < blocks.length; i++) {
    const { index, full } = blocks[i];
    onProgress?.(`[Export] 处理图表 ${i + 1}/${totalMatches}...`);

    // Try DOM extraction first (exact SVG from editor — preserves all text)
    if (i < domSvgs.length) {
      try {
        const serializer = new XMLSerializer();
        const svgStr = serializer.serializeToString(domSvgs[i]);
        const dataUri = svgToDataUri(svgStr);
        replacements.push({ index, full, dataUri });
        continue;
      } catch {
        // DOM extraction failed — fall through to mermaid.render()
      }
    }

    // Phase 2: Fallback — render with mermaid
    try {
      if (!mermaidLib) {
        const mod = await import('mermaid');
        mermaidLib = mod.default || mod;
        mermaidLib.initialize({
          startOnLoad: false,
          htmlLabels: false,
          ...getMermaidTheme(),
        });
      }
      const definition = full.replace(/```mermaid[ \t]*\n?/, '').replace(/```$/, '').trim();
      const { svg } = await mermaidLib.render(`rmd-mermaid-${i + 1}`, definition);
      const dataUri = svgToDataUri(svg);
      replacements.push({ index, full, dataUri });
    } catch (e) {
      console.warn(`[ExportDialog] Failed to render mermaid block #${i + 1}:`, e);
      // Leave block unchanged
    }
  }

  // Apply replacements in reverse index order to preserve positions
  let result = source;
  replacements.sort((a, b) => b.index - a.index);
  for (const { index, full, dataUri } of replacements) {
    result = result.slice(0, index) + `![mermaid diagram](${dataUri})` + result.slice(index + full.length);
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

      // Pre-process: render Mermaid blocks first, then embed local images as data URIs
      let embeddedSource = source;
      setExportMsg('正在渲染图表...');
      embeddedSource = await renderMermaidBlocks(embeddedSource, (msg) => setExportMsg(msg));
      setExportMsg('正在嵌入本地图片...');
      embeddedSource = await embedImagesInSource(embeddedSource, currentDir || '');
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
