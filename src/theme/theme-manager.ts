import { useEditorStore } from '../store';

// Raw CSS imports from built-in themes
import goodseeLight from './goodsee/goodsee.css?raw';
import goodseeDark from './goodsee/goodsee-dark.css?raw';
export type MdThemeMode = 'light' | 'dark';

export interface MdThemeEntry {
  id: string;
  name: string;
  category: 'builtin' | 'custom';
  mode: MdThemeMode;
  css: string;
  isExternal?: boolean;
  externalPath?: string;
}

// Built-in theme definitions
const BUILTIN_THEMES: MdThemeEntry[] = [
  { id: 'goodsee', name: 'Goodsee', category: 'builtin', mode: 'light', css: goodseeLight },
  { id: 'goodsee-dark', name: 'Goodsee Dark', category: 'builtin', mode: 'dark', css: goodseeDark },
];

const STYLE_ID = 'rmd-markdown-theme';


export function adaptCssFile(css: string): string {

  let result = css
    .replace(/@include-when-export[^;]+;/g, '')
    .replace(/@media\s+print\s*\{[\s\S]*?\}/g, ''); // Remove print styles


  result = result
    // #write::before / #write::after → .ProseMirror::before/after
    .replace(/#write::before/g, '.wysiwyg-editor .ProseMirror::before')
    .replace(/#write::after/g, '.wysiwyg-editor .ProseMirror::after')
    // #write > h3.md-focus → .wysiwyg-editor .ProseMirror > h3
    .replace(/#write\s*>\s*/g, '.wysiwyg-editor .ProseMirror > ')
    // #write .md-fences → .wysiwyg-editor .ProseMirror pre
    // MUST come before the general .md-fences replacement to avoid double .ProseMirror
    .replace(/#write\s+\.md-fences/g, '.wysiwyg-editor .ProseMirror pre')
    // Standalone .md-fences (no #write prefix) → .ProseMirror pre
    .replace(/\.md-fences/g, '.ProseMirror pre')
    // #write .CodeMirror-* → keep but scope
    .replace(/#write\s+\.CodeMirror/g, '.wysiwyg-editor .ProseMirror .CodeMirror')
    // #write at start of selector → .wysiwyg-editor .ProseMirror
    .replace(/#write\s+/g, '.wysiwyg-editor .ProseMirror ')
    .replace(/#write\s*\{/g, '.wysiwyg-editor .ProseMirror {')
    .replace(/#write\s*\./g, '.wysiwyg-editor .ProseMirror .')
    // body / html as content base
    .replace(/^html\s*\{/gm, '.wysiwyg-editor .ProseMirror {')
    .replace(/^body\s*\{/gm, '.wysiwyg-editor .ProseMirror {');
    // .md-image → keep (used for images)
    // .md-task-list-item → keep
    // .md-toc → keep
    // Keep .cm-s-inner for code block highlighting
  
  result = result.replace(/[.#][\w-]*(?:megamenu|ty-quick|file-tree|file-list|sidebar-tabs|outline-btn|footer-item|info-panel)[\w-]*\s*\{[\s\S]*?\}/gi, '');

  return result;
}

/**
 * Inject CSS text into a <style> tag with the given id.
 * Returns the style element.
 */
function injectStyleTag(id: string, css: string): HTMLStyleElement {
  let style = document.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = id;
    style.setAttribute('type', 'text/css');
    document.head.appendChild(style);
  }
  style.textContent = css;
  return style;
}

/**
 * Determine the markdown theme mode from an app chrome theme name.
 * eye-care and minimal are treated as light mode.
 */
export function appThemeToMdMode(appTheme: string): MdThemeMode {
  return appTheme === 'dark' ? 'dark' : 'light';
}

/**
 * Get all built-in theme entries (id/name pairs for UI).
 * If mode is specified, only return themes compatible with that mode.
 */
export function getBuiltinThemeList(mode?: MdThemeMode): { id: string; name: string }[] {
  const list = mode
    ? BUILTIN_THEMES.filter(t => t.mode === mode)
    : BUILTIN_THEMES;
  return list.map(t => ({ id: t.id, name: t.name }));
}

/**
 * Auto-select a compatible markdown theme for the given app chrome theme.
 * If the current markdown theme is already compatible, leaves it unchanged.
 * Otherwise switches to the first available theme for the target mode.
 */
export function autoSelectThemeForAppTheme(appTheme: string): void {
  const targetMode = appThemeToMdMode(appTheme);
  const store = useEditorStore.getState();
  const current = store.markdownTheme;

  // Check if current theme is compatible
  const currentEntry = BUILTIN_THEMES.find(t => t.id === current);
  if (currentEntry && currentEntry.mode === targetMode) return;

  // Find first theme matching the target mode
  const fallback = BUILTIN_THEMES.find(t => t.mode === targetMode);
  if (fallback) {
    activateMarkdownTheme(fallback.id);
  }
}

/**
 * Check if a theme ID is a built-in theme.
 */
export function isBuiltinTheme(id: string): boolean {
  return BUILTIN_THEMES.some(t => t.id === id);
}

/**
 * Get a theme entry by id.
 */
function getThemeById(id: string): MdThemeEntry | undefined {
  return BUILTIN_THEMES.find(t => t.id === id);
}

/**
 * Set the active markdown theme by id.
 * For built-in themes, uses pre-bundled CSS.
 * For external themes, reloads CSS from the persisted path.
 */
export async function activateMarkdownTheme(themeId: string): Promise<void> {
  const store = useEditorStore.getState();

  if (isBuiltinTheme(themeId)) {
    const theme = getThemeById(themeId);
    if (!theme) return;
    const adapted = adaptCssFile(theme.css);
    injectStyleTag(STYLE_ID, adapted);
    store.setMarkdownTheme(themeId);
    store.setMarkdownThemeName(theme.name);
  } else {
    // External theme: reload CSS from the persisted path
    const extPath = store.externalThemePath;
    if (extPath) {
      await loadExternalThemeCSS(extPath);
    } else {
      store.setMarkdownTheme(themeId);
      store.setMarkdownThemeName(themeId);
    }
  }
}

/**
 * Persist the external theme path to app config.
 */
function persistExternalThemePath(filePath: string | null): void {
  const store = useEditorStore.getState();
  const config = { ...store.config, external_theme_path: filePath ?? '' };
  store.setConfig(config);
}

/**
 * Load a theme CSS file from an external path (via Tauri fs).
 * Returns the CSS text.
 */
export async function loadExternalThemeCSS(filePath: string): Promise<string> {
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const css = await readTextFile(filePath);
    const adapted = adaptCssFile(css);
    injectStyleTag(STYLE_ID, adapted);

    const store = useEditorStore.getState();
    const fileName = filePath.split(/[\\/]/).pop() || '自定义主题';
    store.setMarkdownTheme('custom-' + fileName);
    store.setMarkdownThemeName(fileName);
    store.setExternalThemePath(filePath);
    persistExternalThemePath(filePath);

    return css;
  } catch (e) {
    console.error('Failed to load external theme:', e);
    throw e;
  }
}

/**
 * Initialize the markdown theme system.
 * Called once on app startup.
 * - If a persisted external theme path exists, loads it.
 */
export async function initMarkdownTheme(): Promise<void> {
  const store = useEditorStore.getState();
  const saved = store.markdownTheme;
  const externalPath = store.config.external_theme_path;

  // If there's a saved built-in theme, activate it
  if (saved && saved !== 'default' && isBuiltinTheme(saved)) {
    await activateMarkdownTheme(saved);
    return;
  }

  // If there's a persisted external theme path, load it
  if (externalPath) {
    try {
      await loadExternalThemeCSS(externalPath);
      return;
    } catch (e) {
      console.warn('Failed to load persisted external theme, falling back to built-in:', e);
    }
  }

  // Default: activate goodsee
  await activateMarkdownTheme('goodsee');
}

/* ─── External theme storage dir & zip upload ─── */

/**
 * Open a folder dialog to select/configure the external theme storage directory.
 * Once set, uploaded zip themes will be extracted here.
 */
export async function configureThemeStorageDir(): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择外部主题存放目录',
    });
    if (!selected) return null;

    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_external_theme_dir', { path: selected });

    const store = useEditorStore.getState();
    store.setConfig({ ...store.config, external_theme_dir: selected });

    return selected;
  } catch (e) {
    console.error('Failed to configure theme storage dir:', e);
    return null;
  }
}

/**
 * Pick a zip file containing CSS themes, upload and extract it to the
 * theme storage directory. Returns the list of extracted CSS theme files.
 */
export async function uploadExternalThemeZip(): Promise<{ path: string; name: string; dir_name: string }[] | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      filters: [{ name: 'ZIP 压缩文件', extensions: ['zip'] }],
      title: '选择主题 ZIP 文件',
    });
    if (!selected) return null;

    const { invoke } = await import('@tauri-apps/api/core');
    const themes = await invoke<{ path: string; name: string; dir_name: string }[]>('upload_external_theme', { zipPath: selected });
    return themes;
  } catch (e) {
    console.error('Failed to upload external theme zip:', e);
    return null;
  }
}

/**
 * List all available external CSS themes in the storage directory.
 */
export async function getExternalThemeList(): Promise<{ path: string; name: string; dir_name: string }[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<{ path: string; name: string; dir_name: string }[]>('list_external_themes');
  } catch (e) {
    console.error('Failed to list external themes:', e);
    return [];
  }
}

/**
 * Delete an external theme CSS file.
 */
export async function deleteExternalTheme(themePath: string): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('delete_external_theme', { themePath });
    return true;
  } catch (e) {
    console.error('Failed to delete external theme:', e);
    return false;
  }
}

/**
 * Get the current external theme storage directory path.
 */
export function getExternalThemeDir(): string {
  return useEditorStore.getState().config.external_theme_dir;
}


