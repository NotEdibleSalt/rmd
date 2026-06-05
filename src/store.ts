import { create } from 'zustand';
import { debounce } from './utils/debounce';
import { normalizeImagePaths } from './utils/image';
import { WorkspaceIndex, WorkspaceFile, BacklinkEntry, GraphData } from './lib/workspaceIndex';

export interface TocItem {
  level: number;
  text: string;
  id: string;
}

export interface DocumentStats {
  word_count: number;
  char_count: number;
  line_count: number;
  heading_count: number;
  code_block_count: number;
  image_count: number;
  table_count: number;
  list_count: number;
}

export interface MarkdownOutput {
  html: string;
  toc: TocItem[];
  stats: DocumentStats;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_file: boolean;
  modified: string;
  size: number;
  extension: string;
}

export interface AppConfig {
  theme: string;
  font_size: number;
  font_family: string;
  auto_save: boolean;
  line_numbers: boolean;
  word_wrap: boolean;
  default_view: string;
  editor_font_size: number;
  preview_font_size: number;
  line_height: number;
  auto_format: boolean;
  spell_check: boolean;
  syntax_hint: boolean;
  last_file: string;
  recent_files: string[];
  image_save_dir: string;
  external_theme_path: string;
  external_theme_dir: string;
  workspace_root: string;
}

export type ViewMode = 'wysiwyg' | 'source' | 'doc';

const MAX_RECENT_FILES = 10;

/* ─── Tab Model ─── */

export interface Tab {
  id: string;
  path: string | null;   // null = untitled new doc
  name: string;           // display name (filename or "未命名")
  source: string;
  isModified: boolean;
  output: MarkdownOutput | null;
  imageSaveDir: string;
}

/* ─── Active tab selectors (reactive, no new object per render) ─── */

export const selectSource = (s: EditorStore) =>
  s.tabs.find(t => t.id === s.activeTabId)?.source ?? '';
export const selectCurrentFile = (s: EditorStore) =>
  s.tabs.find(t => t.id === s.activeTabId)?.path ?? null;
export const selectTabName = (s: EditorStore) =>
  s.tabs.find(t => t.id === s.activeTabId)?.name ?? '';
export const selectIsModified = (s: EditorStore) =>
  s.tabs.find(t => t.id === s.activeTabId)?.isModified ?? false;
export const selectOutput = (s: EditorStore) =>
  s.tabs.find(t => t.id === s.activeTabId)?.output ?? null;
export const selectImageSaveDir = (s: EditorStore) =>
  s.tabs.find(t => t.id === s.activeTabId)?.imageSaveDir ?? '';
export const selectActiveTab = (s: EditorStore) =>
  s.tabs.find(t => t.id === s.activeTabId) ?? null;
export const selectAllTabsModified = (s: EditorStore) =>
  s.tabs.some(t => t.isModified);

interface EditorStore {
  // Tab state
  tabs: Tab[];
  activeTabId: string;

  // UI state
  viewMode: ViewMode;
  theme: string;
  config: AppConfig;

  // File browser
  fileBrowserOpen: boolean;
  currentDir: string;
  files: FileEntry[];
  sidebarLeftWidth: number;
  sidebarRightWidth: number;

  // Outline sidebar
  outlineOpen: boolean;

  // Export dialog
  exportDialogOpen: boolean;

  // Settings
  settingsOpen: boolean;

  // Search (file search)
  searchOpen: boolean;
  searchQuery: string;

  // Find & Replace (in-document)
  findReplaceOpen: boolean;
  findQuery: string;
  replaceQuery: string;

  // Keyboard shortcuts help
  shortcutsOpen: boolean;

  // Markdown theme
  markdownTheme: string;
  markdownThemeName: string;
  externalThemePath: string | null;
  externalThemeEntries: { id: string; name: string; path: string }[];

  // Image insertion
  imageInsertData: { markdownSrc: string; dataUrl: string } | null;
  /** Per-document image save directory — chosen on first image insertion */
  imageSaveDir: string;

  // Save status indicator
  saveStatus: 'idle' | 'saving' | 'saved';

  // Misc
  recentFiles: string[];

  // Workspace (bi-directional links)
  workspaceRoot: string | null;
  workspaceIndex: WorkspaceIndex;
  backlinksPanelOpen: boolean;
  activeRightTab: 'outline' | 'backlinks';
  backlinks: BacklinkEntry[];
  graphViewOpen: boolean;
  graphData: GraphData | null;

  // Actions
  setSaveStatus: (status: 'idle' | 'saving' | 'saved') => void;
  setViewMode: (mode: ViewMode) => void;
  setTheme: (theme: string) => void;
  setConfig: (config: AppConfig) => void;
  setFileBrowserOpen: (open: boolean) => void;
  setCurrentDir: (dir: string) => void;
  setFiles: (files: FileEntry[]) => void;
  setOutlineOpen: (open: boolean) => void;
  setSidebarLeftWidth: (w: number) => void;
  setSidebarRightWidth: (w: number) => void;
  setExportDialogOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchQuery: (q: string) => void;
  setFindReplaceOpen: (open: boolean) => void;
  setFindQuery: (q: string) => void;
  setReplaceQuery: (q: string) => void;
  setShortcutsOpen: (open: boolean) => void;
  setMarkdownTheme: (id: string) => void;
  setMarkdownThemeName: (name: string) => void;
  setExternalThemePath: (path: string | null) => void;
  setExternalThemeEntries: (entries: { id: string; name: string; path: string }[]) => void;
  setRecentFiles: (files: string[]) => void;

  // Tab management
  newTab: () => string;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;

  // Active tab content setters (convenience wrappers)
  setSource: (source: string) => void;
  setCurrentFile: (path: string | null) => void;
  setIsModified: (v: boolean) => void;
  setOutput: (output: MarkdownOutput | null) => void;
  setImageSaveDir: (dir: string) => void;

  // Commands
  parseMarkdown: () => void;
  openFile: (path: string) => Promise<void>;
  saveFile: () => Promise<void>;
  saveTab: (tabId: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  renameFile: (oldPath: string, newPath: string) => Promise<void>;
  refreshFiles: () => Promise<void>;
  trackFileHistory: (path: string) => void;
  insertImageFromPath: (path: string) => Promise<void>;
  clearImageInsert: () => void;

  // Workspace actions
  setWorkspaceRoot: (path: string) => Promise<void>;
  autoResolveWorkspace: (currentFilePath: string | null) => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  findBacklinks: () => Promise<void>;
  navigateToWikiLink: (target: string) => Promise<void>;
  promptCreateWikiLink: (target: string) => Promise<void>;
  openGraphView: () => Promise<void>;
  closeGraphView: () => void;
  setActiveRightTab: (tab: 'outline' | 'backlinks') => void;
  setBacklinksPanelOpen: (open: boolean) => void;
  setWorkspaceIndexInstance: (idx: WorkspaceIndex) => void;
  setWorkspaceFiles: (files: WorkspaceFile[]) => void;
}

/* ─── Invoke helper ─── */

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke(cmd, args);
}

const DEBOUNCE_MS = 300;

/* ─── Save status auto-reset ─── */

let saveStatusTimer: ReturnType<typeof setTimeout> | null = null;

function setSaveStatusWithReset(status: 'idle' | 'saving' | 'saved') {
  const store = useEditorStore.getState();
  store.setSaveStatus(status);
  if (saveStatusTimer) clearTimeout(saveStatusTimer);
  if (status === 'saved') {
    saveStatusTimer = setTimeout(() => {
      useEditorStore.getState().setSaveStatus('idle');
    }, 2000);
  }
}

/* ─── Debounced auto-save (active tab) ─── */

const debouncedAutoSave = debounce(async () => {
  const s = useEditorStore.getState();
  const tab = s.tabs.find(t => t.id === s.activeTabId);
  if (!tab?.path || !tab.isModified) return;
  setSaveStatusWithReset('saving');
  try {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    await tauriInvoke('save_file', { path: tab.path, content: tab.source });
    useEditorStore.getState().setIsModified(false);
    setSaveStatusWithReset('saved');
  } catch (e) {
    console.error('Auto-save error:', e);
    setSaveStatusWithReset('idle');
  }
}, 2000);

/* ─── Tab ID counter ─── */

let tabCounter = 0;
function nextTabId() {
  return `tab_${++tabCounter}`;
}

/* ─── Default home tab ─── */

function homeTab(): Tab {
  const id = nextTabId();
  return { id, path: null, name: '未命名', source: '', isModified: false, output: null, imageSaveDir: '' };
}

/* ─── Store ─── */

export const useEditorStore = create<EditorStore>((set, get) => {
  const initialTab = homeTab();
  return {
    // Tab state
    tabs: [initialTab],
    activeTabId: initialTab.id,

    // UI state
    viewMode: 'wysiwyg',
    theme: 'light',
    config: {
      theme: 'light',
      font_size: 16,
      font_family: 'system-ui',
      auto_save: true,
      line_numbers: true,
      word_wrap: true,
      default_view: 'rich',
      editor_font_size: 15,
      preview_font_size: 16,
      line_height: 1.7,
      auto_format: true,
      spell_check: false,
      syntax_hint: true,
      last_file: '',
      recent_files: [],
      image_save_dir: '',
      external_theme_path: '',
      external_theme_dir: '',
      workspace_root: '',
    },
    recentFiles: [],
    workspaceRoot: null,
    workspaceIndex: new WorkspaceIndex(),
    backlinksPanelOpen: false,
    activeRightTab: 'outline',
    backlinks: [],
    graphViewOpen: false,
    graphData: null,
    fileBrowserOpen: true,
    currentDir: '',
    files: [],
    sidebarLeftWidth: 300,
    sidebarRightWidth: 260,
    outlineOpen: false,
    exportDialogOpen: false,
    settingsOpen: false,
    searchOpen: false,
    searchQuery: '',
    findReplaceOpen: false,
    findQuery: '',
    replaceQuery: '',
    shortcutsOpen: false,
    markdownTheme: '',
    markdownThemeName: '',
    externalThemePath: null,
    externalThemeEntries: [],
    imageInsertData: null,
    imageSaveDir: '',
    saveStatus: 'idle',

    setSaveStatus: (status) => set({ saveStatus: status }),
    setViewMode: (mode) => set({ viewMode: mode }),
    setTheme: (theme) => {
      set({ theme });
      document.documentElement.setAttribute('data-theme', theme);
    },
    setConfig: (config) => {
      set({ config });
      invoke('set_config', { newConfig: config }).catch(() => {});
      const state = get();
      if (config.workspace_root && state.workspaceIndex.root !== config.workspace_root) {
        state.workspaceIndex.build(config.workspace_root)
          .then(() => {
            set({ workspaceRoot: config.workspace_root });
          })
          .catch(e => console.error('Failed to build workspace from config:', e));
      }
    },
    setFileBrowserOpen: (open) => set({ fileBrowserOpen: open }),
    setCurrentDir: (dir) => set({ currentDir: dir }),
    setFiles: (files) => set({ files }),
    setOutlineOpen: (open) => set({ outlineOpen: open }),
    setSidebarLeftWidth: (w) => set({ sidebarLeftWidth: w }),
    setSidebarRightWidth: (w) => set({ sidebarRightWidth: w }),
    setExportDialogOpen: (open) => set({ exportDialogOpen: open }),
    setSettingsOpen: (open) => set({ settingsOpen: open }),
    setSearchOpen: (open) => set({ searchOpen: open }),
    setSearchQuery: (q) => set({ searchQuery: q }),
    setFindReplaceOpen: (open) => set({ findReplaceOpen: open, findQuery: '', replaceQuery: '' }),
    setFindQuery: (q) => set({ findQuery: q }),
    setReplaceQuery: (q) => set({ replaceQuery: q }),
    setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
    setMarkdownTheme: (id) => set({ markdownTheme: id }),
    setMarkdownThemeName: (name) => set({ markdownThemeName: name }),
    setExternalThemePath: (path) => set({ externalThemePath: path }),
    setExternalThemeEntries: (entries) => set({ externalThemeEntries: entries }),
    setRecentFiles: (files) => set({ recentFiles: files }),

    /* ─── Tab management ─── */

    newTab: () => {
      const tab = homeTab();
      set(state => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
      // Trigger parse on mount (empty doc)
      setTimeout(() => get().parseMarkdown(), 0);
      return tab.id;
    },

    closeTab: (tabId: string) => {
      const state = get();
      // Allow closing last tab (welcome screen shown in App.tsx)

      const remaining = state.tabs.filter(t => t.id !== tabId);

      let newActiveId = state.activeTabId;
      if (state.activeTabId === tabId) {
        const idx = state.tabs.findIndex(t => t.id === tabId);
        const neighborIdx = Math.min(idx, remaining.length - 1);
        newActiveId = remaining[neighborIdx]?.id ?? remaining[0]?.id ?? '';
      }

      set({ tabs: remaining, activeTabId: newActiveId });
      // Re-parse for the newly active tab
      setTimeout(() => get().parseMarkdown(), 0);
    },

    switchTab: (tabId: string) => {
      const state = get();
      if (tabId === state.activeTabId) return;
      set({ activeTabId: tabId });
      // Re-parse for the switched-to tab
      setTimeout(() => get().parseMarkdown(), 0);
      get().findBacklinks().catch(() => {});
    },

    /* ─── Active tab content setters ─── */

    setSource: (source) => {
      set(state => ({
        tabs: state.tabs.map(t =>
          t.id === state.activeTabId ? { ...t, source, isModified: true } : t
        ),
      }));
      get().parseMarkdown();
      const s = get();
      const activeTab = s.tabs.find(t => t.id === s.activeTabId);
      if (s.config.auto_save && activeTab?.path) {
        debouncedAutoSave();
      }
    },

    setCurrentFile: (path) => {
      set(state => {
        const name = path
          ? path.replace(/\\/g, '/').split('/').pop() || path
          : '未命名';
        return {
          tabs: state.tabs.map(t =>
            t.id === state.activeTabId ? { ...t, path, name } : t
          ),
        };
      });
    },

    setIsModified: (v) => {
      set(state => ({
        tabs: state.tabs.map(t =>
          t.id === state.activeTabId ? { ...t, isModified: v } : t
        ),
      }));
    },

    setOutput: (output) => {
      set(state => ({
        tabs: state.tabs.map(t =>
          t.id === state.activeTabId ? { ...t, output } : t
        ),
      }));
    },

    setImageSaveDir: (dir) => {
      set(state => ({
        tabs: state.tabs.map(t =>
          t.id === state.activeTabId ? { ...t, imageSaveDir: dir } : t
        ),
      }));
    },

    /* ─── Commands ─── */

    parseMarkdown: debounce(async () => {
      const s = get();
      const activeTab = s.tabs.find(t => t.id === s.activeTabId);
      if (!activeTab) return;
      try {
        const result = await invoke<MarkdownOutput>('parse_markdown', {
          source: activeTab.source,
        });
        get().setOutput(result);
      } catch (e) {
        console.error('Parse error:', e);
      }
    }, DEBOUNCE_MS),

    openFile: async (path: string) => {
      try {
        const content = await invoke<string>('open_file', { path });
        const dir = path.replace(/\\/g, '/').replace(/\/[^/]+$/, '');
        const normalized = normalizeImagePaths(content, dir);
        const name = path.replace(/\\/g, '/').split('/').pop() || path;

        // Check if already open in a tab
        const state = get();
        const existing = state.tabs.find(t => t.path === path);
        if (existing) {
          // Update content and switch to it
          set(state => ({
            tabs: state.tabs.map(t =>
              t.id === existing.id
                ? { ...t, source: normalized, isModified: false, output: null, imageSaveDir: '' }
                : t
            ),
            currentDir: dir,
            activeTabId: existing.id,
          }));
        } else {
          // Create new tab
          const id = nextTabId();
          const tab: Tab = {
            id, path, name, source: normalized,
            isModified: false, output: null, imageSaveDir: '',
          };
          set(state => ({
            tabs: [...state.tabs, tab],
            activeTabId: id,
            currentDir: dir,
          }));
        }
        get().parseMarkdown();
        get().trackFileHistory(path);
        await get().autoResolveWorkspace(path);
        await get().findBacklinks();
      } catch (e) {
        // File not found → remove from recent list
        if (String(e).includes('File not found') || String(e).includes('未找到')) {
          const state = get();
          const updated = state.recentFiles.filter(p => p !== path);
          if (updated.length !== state.recentFiles.length) {
            const newConfig = { ...state.config, recent_files: updated, last_file: '' };
            set({ recentFiles: updated, config: newConfig });
            invoke('set_config', { newConfig }).catch(() => {});
          }
        } else {
          console.error('Open error:', e);
        }
      }
    },

    trackFileHistory: (path: string) => {
      const state = get();
      const recent = [path, ...state.recentFiles.filter(p => p !== path)].slice(0, MAX_RECENT_FILES);
      const newConfig = { ...state.config, last_file: path, recent_files: recent };
      set({ recentFiles: recent, config: newConfig });
      invoke('set_config', { newConfig }).catch(() => {});
    },

    saveTab: async (tabId: string) => {
      const state = get();
      const tab = state.tabs.find(t => t.id === tabId);
      if (!tab?.path) return;
      setSaveStatusWithReset('saving');
      try {
        await invoke('save_file', { path: tab.path, content: tab.source });
        set(state => ({
          tabs: state.tabs.map(t =>
            t.id === tabId ? { ...t, isModified: false } : t
          ),
        }));
        setSaveStatusWithReset('saved');
        await get().findBacklinks();
      } catch (e) {
        console.error('Save error:', e);
        setSaveStatusWithReset('idle');
      }
    },

    saveFile: async () => {
      const state = get();
      const tab = state.tabs.find(t => t.id === state.activeTabId);
      if (!tab) return;
      await get().saveTab(tab.id);
    },

    refreshFiles: async () => {
      const { currentDir } = get();
      if (!currentDir) return;
      try {
        const files = await invoke<FileEntry[]>('read_dir', { path: currentDir });
        set({ files });
      } catch (e) {
        console.error('Refresh error:', e);
      }
    },

    deleteFile: async (path: string) => {
      try {
        await invoke('delete_file', { path });
        const state = get();

        // Close / orphan tabs pointing to deleted file
        const remaining = state.tabs.filter(t => t.path !== path);
        let newActiveId = state.activeTabId;
        if (!remaining.find(t => t.id === state.activeTabId)) {
          const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
          const neighborIdx = Math.min(idx, remaining.length - 1);
          newActiveId = remaining[neighborIdx]?.id ?? remaining[0]?.id ?? '';
        }

        set({
          tabs: remaining.map(t =>
            t.path === path ? { ...t, path: null, name: '未命名' } : t
          ),
          activeTabId: newActiveId,
        });

        // Remove from recent list
        if (state.recentFiles.includes(path)) {
          const updated = state.recentFiles.filter(p => p !== path);
          const newConfig = { ...state.config, recent_files: updated };
          set({ recentFiles: updated, config: newConfig });
          invoke('set_config', { newConfig }).catch(() => {});
        }
        await get().refreshFiles();
      } catch (e) {
        console.error('Delete error:', e);
        throw e;
      }
    },

    renameFile: async (oldPath: string, newPath: string) => {
      try {
        await invoke('rename_file', { oldPath, newPath });
        const newName = newPath.replace(/\\/g, '/').split('/').pop() || newPath;
        set(state => ({
          tabs: state.tabs.map(t =>
            t.path === oldPath ? { ...t, path: newPath, name: newName } : t
          ),
        }));
        await get().refreshFiles();
      } catch (e) {
        console.error('Rename error:', e);
        throw e;
      }
    },

    insertImageFromPath: async (path: string) => {
      const state = get();
      const currentDir = state.currentDir;

      // If it's already a data URL, just pass through
      if (path.startsWith('data:')) {
        set({ imageInsertData: { markdownSrc: path, dataUrl: path } });
        return;
      }

      // Convert absolute path to relative if under currentDir
      let markdownSrc = path;
      if (currentDir) {
        const normDir = currentDir.replace(/\\/g, '/').replace(/\/+$/, '');
        const normPath = path.replace(/\\/g, '/');
        if (normPath.startsWith(normDir + '/')) {
          markdownSrc = normPath.substring(normDir.length + 1);
        }
      }

      // Try asset protocol first, fall back to base64 IPC if unavailable
      try {
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        const displayUrl = convertFileSrc(path);
        set({ imageInsertData: { markdownSrc, dataUrl: displayUrl } });
      } catch (e) {
        console.warn('convertFileSrc failed, falling back to read_image_base64:', e);
        try {
          const dataUrl = await invoke<string>('read_image_base64', { path });
          set({ imageInsertData: { markdownSrc, dataUrl } });
        } catch (e2) {
          console.error('All image load methods failed:', e2);
          set({ imageInsertData: { markdownSrc, dataUrl: path } });
        }
      }
    },

    clearImageInsert: () => {
      set({ imageInsertData: null });
    },

    /* ─── Workspace (bi-directional links) ─── */

    setWorkspaceRoot: async (path: string) => {
      const state = get();
      try {
        await state.workspaceIndex.build(path);
        const newConfig = { ...state.config, workspace_root: path };
        set({ workspaceRoot: path, config: newConfig });
        invoke('set_config', { newConfig }).catch(() => {});
        await get().findBacklinks();
      } catch (e) {
        console.error('setWorkspaceRoot error:', e);
      }
    },

    autoResolveWorkspace: async (currentFilePath: string | null) => {
      const state = get();
      if (state.workspaceRoot) {
        if (state.workspaceIndex.root !== state.workspaceRoot) {
          try {
            await state.workspaceIndex.build(state.workspaceRoot);
          } catch (e) {
            console.error('autoResolveWorkspace (explicit root) error:', e);
          }
        }
        return;
      }
      try {
        await state.workspaceIndex.autoResolve(currentFilePath);
      } catch (e) {
        console.error('autoResolveWorkspace error:', e);
      }
    },

    refreshWorkspace: async () => {
      const state = get();
      const root = state.workspaceRoot || state.workspaceIndex.root;
      if (!root) return;
      try {
        await state.workspaceIndex.build(root);
        set({ workspaceRoot: root });
        await get().findBacklinks();
      } catch (e) {
        console.error('refreshWorkspace error:', e);
      }
    },

    findBacklinks: async () => {
      const state = get();
      const activeTab = state.tabs.find(t => t.id === state.activeTabId);
      if (!activeTab?.path) {
        set({ backlinks: [] });
        return;
      }
      const root = state.workspaceRoot || state.workspaceIndex.root;
      if (!root) {
        set({ backlinks: [] });
        return;
      }
      const fileName = activeTab.path.replace(/\\/g, '/').split('/').pop() || '';
      const targetName = fileName.replace(/\.[^.]+$/, '');
      try {
        const entries = await invoke<BacklinkEntry[]>('find_backlinks', {
          workspaceRoot: root,
          targetName,
        });
        set({ backlinks: entries });
      } catch (e) {
        console.error('findBacklinks error:', e);
      }
    },

    navigateToWikiLink: async (target: string) => {
      const state = get();
      const file = state.workspaceIndex.resolve(target);
      if (!file) {
        await get().promptCreateWikiLink(target);
        return;
      }
      await get().openFile(file.full_path);
      await get().findBacklinks();
    },

    promptCreateWikiLink: async (target: string) => {
      const state = get();

      // If a file with this name appeared in the workspace (e.g. user created
      // it manually between mark and click), just open it.
      const existing = state.workspaceIndex.resolve(target);
      if (existing) {
        await get().openFile(existing.full_path);
        return;
      }

      // Decide where the new file should live:
      //   1. Explicit workspace root (preferred — matches BacklinksPanel etc.)
      //   2. Auto-resolved workspaceIndex root (built from current file's dir)
      //   3. Active tab's current directory (last-resort fallback)
      const root =
        state.workspaceRoot ||
        state.workspaceIndex.root ||
        state.currentDir;
      if (!root) {
        console.warn(
          'promptCreateWikiLink: no workspace root or current dir to create file in',
        );
        return;
      }

      const safeTarget = target.replace(/[\\/:*?"<>|]/g, '_');
      const newPath = `${root.replace(/[\\/]+$/, '')}/${safeTarget}.md`;

      try {
        const { ask } = await import('@tauri-apps/plugin-dialog');
        const confirmed = await ask(`Create new note "${safeTarget}.md"?`, {
          title: 'Create Wiki Link Target',
          kind: 'info',
        });
        if (!confirmed) return;

        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('create_file', { path: newPath });

        if (state.workspaceRoot) {
          await get().refreshWorkspace();
        }
        await get().openFile(newPath);
      } catch (e) {
        console.error('promptCreateWikiLink: failed to create file', e);
      }
    },

    openGraphView: async () => {
      set({ graphViewOpen: true });
      const state = get();
      const root = state.workspaceRoot || state.workspaceIndex.root;
      if (!root) return;
      try {
        const data = await invoke<GraphData>('get_graph_data', { workspaceRoot: root });
        set({ graphData: data });
      } catch (e) {
        console.error('openGraphView error:', e);
      }
    },

    closeGraphView: () => set({ graphViewOpen: false }),

    setActiveRightTab: (tab) => set({ activeRightTab: tab }),

    setBacklinksPanelOpen: (open) => set({ backlinksPanelOpen: open }),

    setWorkspaceIndexInstance: (idx) => set({ workspaceIndex: idx }),

    setWorkspaceFiles: (files) => {
      const idx = get().workspaceIndex;
      idx.files.clear();
      idx.nameToPath.clear();
      for (const f of files) {
        idx.files.set(f.full_path, f);
        idx.nameToPath.set(f.name.toLowerCase(), f.full_path);
      }
    },
  };
});

/* ─── Image save directory resolution ─── */

let _pendingDirPicker: Promise<string | null> | null = null;

/**
 * Ensure a per-document image save directory exists.
 * First call pops a directory picker and remembers the choice;
 * subsequent calls reuse the same directory without prompting.
 * Concurrent calls share a single dialog — fixing the "two dialogs" race.
 * Returns null if the user cancels.
 */
export async function ensureImageSaveDir(): Promise<string | null> {
  const state = useEditorStore.getState();
  const activeTab = state.tabs.find(t => t.id === state.activeTabId);
  if (activeTab?.imageSaveDir) return activeTab.imageSaveDir;

  if (_pendingDirPicker) return _pendingDirPicker;

  _pendingDirPicker = (async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const dir = await open({
      directory: true,
      multiple: false,
      title: '选择图片保存目录',
    });
    if (!dir) {
      _pendingDirPicker = null;
      return null;
    }
    useEditorStore.getState().setImageSaveDir(dir);
    _pendingDirPicker = null;
    return dir;
  })();

  return _pendingDirPicker;
}
