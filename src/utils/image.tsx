import { convertFileSrc } from '@tauri-apps/api/core';
import { useEditorStore } from '../store';

/**
 * Resolve a potentially-relative image path against currentDir into an absolute filesystem path.
 * Returns the original src unchanged for data:/http:/https: URLs or already-absolute paths.
 */
export function resolveAbsolutePath(src: string, currentDir: string): string {
  if (!src || src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  }
  if (/^[A-Za-z]:[/\\]/.test(src) || src.startsWith('/') || src.startsWith('\\')) {
    return src;
  }
  if (!currentDir) return src;
  return `${currentDir.replace(/\\/g, '/').replace(/\/+$/, '')}/${src}`;
}

/**
 * Try to make a single image path relative to `normDir`.
 * Returns null if the path cannot/should not be normalized (already relative,
 * remote URL, data URI, or not under normDir).
 */
function normalizeSingleImagePath(rawPath: string, normDir: string): string | null {
  // Skip data URIs and remote URLs
  if (rawPath.startsWith('data:') || rawPath.startsWith('https://')) return null;

  let filePath: string;

  // Tauri asset protocol: http://asset.localhost/<URL-encoded path>
  if (rawPath.startsWith('http://asset.localhost/')) {
    try {
      filePath = decodeURIComponent(rawPath.slice('http://asset.localhost/'.length));
    } catch {
      return null;
    }
  } else {
    filePath = rawPath;
  }

  // Normalize separators
  filePath = filePath.replace(/\\/g, '/');

  // Check if it's an absolute path (Windows drive letter or Unix root)
  const isAbsolute = /^[A-Za-z]:[/\\]/.test(filePath) || filePath.startsWith('/');
  if (!isAbsolute) return null; // already relative

  // Try to make relative to normDir
  if (filePath.startsWith(normDir + '/')) {
    return filePath.substring(normDir.length + 1);
  }

  // Absolute path but not under currentDir — leave unchanged
  return null;
}

/**
 * Normalize image paths in markdown source to relative paths (relative to currentDir).
 *
 * Handles:
 * - `![](C:\absolute\path\to\img.png)` → `![](relative/path/img.png)`
 * - `![](http://asset.localhost/C%3A%5C...%5Cimg.png)` → `![](relative/path/img.png)`
 * - Leaves data:/https: URLs and already-relative paths unchanged
 */
export function normalizeImagePaths(source: string, currentDir: string): string {
  if (!currentDir) return source;

  const normDir = currentDir.replace(/\\/g, '/').replace(/\/+$/, '');

  // 1. Normalize markdown image syntax: ![alt](path)
  let result = source.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt: string, rawPath: string) => {
      const normalized = normalizeSingleImagePath(rawPath, normDir);
      if (normalized === null) return match;
      return `![${alt}](${normalized})`;
    },
  );

  // 2. Normalize HTML <img src="path"> tags
  result = result.replace(
    /<img\s[^>]*?src\s*=\s*["']([^"']+)["'][^>]*>/g,
    (match, rawPath: string) => {
      const normalized = normalizeSingleImagePath(rawPath, normDir);
      if (normalized === null) return match;
      return match.replace(rawPath, normalized);
    },
  );

  return result;
}

/**
 * Synchronous image component for markdown preview.
 * Uses Tauri's asset protocol (`convertFileSrc`) to serve files directly from disk
 * instead of base64-encoding them through IPC.
 *
 * - data:/http: URLs pass through unchanged
 * - Relative file paths are resolved against currentDir → converted to asset:// URLs
 */
export function MarkdownImg({ src, alt, style, className, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const currentDir = useEditorStore((s) => s.currentDir);

  let displaySrc = src;
  if (src && !src.startsWith('data:') && !src.startsWith('http://') && !src.startsWith('https://')) {
    const absPath = resolveAbsolutePath(src, currentDir);
    if (absPath !== src) {
      try {
        displaySrc = convertFileSrc(absPath);
      } catch {
        displaySrc = absPath;
      }
    }
  }

  return <img src={displaySrc} alt={alt || ''} style={style} className={className} {...props} />;
}
