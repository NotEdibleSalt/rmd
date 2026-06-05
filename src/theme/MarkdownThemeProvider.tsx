import { useEffect, useRef, useMemo, useCallback } from 'react';
import { useEditorStore } from '../store';
import {
  initMarkdownTheme,
  loadExternalThemeCSS,
  getBuiltinThemeList,
  activateMarkdownTheme,
  autoSelectThemeForAppTheme,
  appThemeToMdMode,
  configureThemeStorageDir,
  uploadExternalThemeZip,
  getExternalThemeList,
  deleteExternalTheme,
  getExternalThemeDir,
} from './theme-manager';

/**
 * Load external theme list from disk and sync into the shared store.
 * Every consumer of useMarkdownTheme reads from the same store value.
 */
export async function refreshExternalThemeEntries(): Promise<void> {
  try {
    const list = await getExternalThemeList();
    const entries = list.map((t) => ({
      id: 'custom-' + t.name,
      name: t.name,
      path: t.path,
    }));
    useEditorStore.getState().setExternalThemeEntries(entries);
  } catch {
    useEditorStore.getState().setExternalThemeEntries([]);
  }
}

/**
 * MarkdownThemeProvider initializes the markdown content theme on mount,
 * loads external theme list into the shared store,
 * and auto-switches when app chrome theme changes.
 */
export function MarkdownThemeProvider({ children }: { children: React.ReactNode }) {
  const initialized = useRef(false);
  const appTheme = useEditorStore((s) => s.theme);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    initMarkdownTheme();
    refreshExternalThemeEntries();
  }, []);

  useEffect(() => {
    if (!initialized.current) return;
    autoSelectThemeForAppTheme(appTheme);
  }, [appTheme]);

  return <>{children}</>;
}

/**
 * React hook to switch markdown themes.
 * All external CSS themes in the storage directory appear in the
 * dropdown alongside built-in themes — selecting one loads it directly.
 *
 * External theme entries are stored in the shared Zustand store so
 * that all consumers (toolbar, settings panel) see the same list.
 */
export function useMarkdownTheme() {
  const store = useEditorStore();

  // Read external entries from the shared store
  const externalEntries = store.externalThemeEntries;

  // Merge built-in + external themes into the dropdown list
  const allThemes = useMemo(() => {
    const mode = appThemeToMdMode(store.theme);
    const builtin = getBuiltinThemeList(mode);
    const external = externalEntries.map((e) => ({ id: e.id, name: e.name }));
    return [...builtin, ...external];
  }, [store.theme, externalEntries]);

  // Switch: built-in → activateMarkdownTheme, external → loadExternalThemeCSS
  const switchTheme = useCallback(
    async (themeId: string) => {
      const ext = externalEntries.find((e) => e.id === themeId);
      if (ext) {
        await loadExternalThemeCSS(ext.path);
      } else {
        await activateMarkdownTheme(themeId);
      }
    },
    [externalEntries],
  );

  const loadExternal = useCallback(async (filePath: string) => {
    await loadExternalThemeCSS(filePath);
    await refreshExternalThemeEntries();
  }, []);

  return {
    currentTheme: store.markdownTheme,
    currentThemeName: store.markdownThemeName,
    externalThemePath: store.externalThemePath,
    externalThemeDir: store.config.external_theme_dir,
    themes: allThemes,
    switchTheme,
    loadExternal,
    refreshExternal: refreshExternalThemeEntries,
    configureThemeStorageDir,
    uploadExternalThemeZip,
    getExternalThemeList,
    deleteExternalTheme,
    getExternalThemeDir,
  };
}
