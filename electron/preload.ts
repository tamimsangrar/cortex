/**
 * Cortex — Electron preload script.
 * Exposes a type-safe IPC bridge to the renderer via `window.cortex`.
 * Every renderer call goes through `ipcRenderer.invoke` (async request/response)
 * or `ipcRenderer.on` (push events from main process).
 */
import { contextBridge, ipcRenderer } from 'electron';

interface WikiNode {
  id: string;
  title: string;
  type: string;
  linkCount: number;
}

interface WikiEdge {
  source: string;
  target: string;
}

interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

const api = {
  // Config
  getConfig: (): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('config:get'),
  setConfig: (key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke('config:set', key, value),
  getDataDir: (): Promise<string> =>
    ipcRenderer.invoke('config:data-dir'),

  // Filesystem
  readDir: (relativePath: string): Promise<string[]> =>
    ipcRenderer.invoke('fs:read-dir', relativePath),
  readFile: (relativePath: string): Promise<string> =>
    ipcRenderer.invoke('fs:read-file', relativePath),

  // Wiki
  getWikiTree: (): Promise<unknown[]> =>
    ipcRenderer.invoke('wiki:get-tree'),
  readArticle: (relativePath: string): Promise<string> =>
    ipcRenderer.invoke('wiki:read-article', relativePath),
  saveArticle: (relativePath: string, content: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('wiki:save-article', relativePath, content),
  deleteArticle: (relativePath: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('wiki:delete-article', relativePath),
  getWikiGraph: (): Promise<{ nodes: WikiNode[]; edges: WikiEdge[] }> =>
    ipcRenderer.invoke('wiki:get-graph'),

  // App info
  getVersion: (): Promise<string> =>
    ipcRenderer.invoke('app:version'),
  getPlatform: (): Promise<string> =>
    ipcRenderer.invoke('app:platform'),
  getLogs: (): Promise<unknown> =>
    ipcRenderer.invoke('app:get-logs'),

  // Settings
  getProvider: (): Promise<{ provider: string | null; model: string | null; fastModel: string | null }> =>
    ipcRenderer.invoke('settings:get-provider'),
  setProvider: (provider: string, model: string, fastModel?: string): Promise<void> =>
    ipcRenderer.invoke('settings:set-provider', provider, model, fastModel),
  setApiKey: (provider: string, key: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:set-api-key', provider, key),
  hasApiKey: (provider: string): Promise<boolean> =>
    ipcRenderer.invoke('settings:has-api-key', provider),
  testConnection: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:test-connection'),
  getModels: (provider: string): Promise<{ id: string; name: string }[]> =>
    ipcRenderer.invoke('settings:get-models', provider),
  fetchModels: (provider: string): Promise<{ id: string; name: string; provider: string }[]> =>
    ipcRenderer.invoke('settings:fetch-models', provider),

  // GitHub OAuth Device Flow
  startGitHubAuth: (): Promise<{ success: boolean; userCode?: string; verificationUri?: string; deviceCode?: string; interval?: number; expiresIn?: number; error?: string }> =>
    ipcRenderer.invoke('auth:github:start-device-flow'),
  pollGitHubToken: (deviceCode: string, interval: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('auth:github:poll-token', deviceCode, interval),
  getGitHubAuthStatus: (): Promise<{ hasToken: boolean }> =>
    ipcRenderer.invoke('auth:github:status'),
  detectGitHubCLIToken: (): Promise<{ success: boolean; tokenPrefix?: string; error?: string }> =>
    ipcRenderer.invoke('auth:github:detect-cli-token'),

  // LLM
  llmChat: (messages: LLMChatMessage[], options?: LLMChatOptions): Promise<unknown> =>
    ipcRenderer.invoke('llm:chat', messages, options),

  // iMessage connector
  checkIMessageAccess: () => ipcRenderer.invoke('connector:imessage:check-access'),
  getIMessageContacts: () => ipcRenderer.invoke('connector:imessage:get-contacts'),
  syncIMessage: (options?: { contacts?: string[]; dateFrom?: string; dateTo?: string; fullResync?: boolean }) =>
    ipcRenderer.invoke('connector:imessage:sync', options),
  getIMessageConfig: () => ipcRenderer.invoke('connector:imessage:get-config'),
  onIMessageProgress: (callback: (data: unknown) => void) => {
    const sub = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('connector:imessage:progress', sub);
    return () => ipcRenderer.removeListener('connector:imessage:progress', sub);
  },

  // Web Clipper connector
  clipUrl: (url: string) => ipcRenderer.invoke('connector:webclip:clip', url),
  listClips: () => ipcRenderer.invoke('connector:webclip:list'),
  onClipProgress: (callback: (data: unknown) => void) => {
    const sub = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('connector:webclip:progress', sub);
    return () => ipcRenderer.removeListener('connector:webclip:progress', sub);
  },

  // WhatsApp connector
  importWhatsApp: () => ipcRenderer.invoke('connector:whatsapp:import'),
  listWhatsAppImports: () => ipcRenderer.invoke('connector:whatsapp:list'),
  onWhatsAppProgress: (callback: (data: unknown) => void) => {
    const sub = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('connector:whatsapp:progress', sub);
    return () => ipcRenderer.removeListener('connector:whatsapp:progress', sub);
  },

  // Apple Notes connector
  checkAppleNotesAccess: () => ipcRenderer.invoke('connector:applenotes:check-access'),
  syncAppleNotes: () => ipcRenderer.invoke('connector:applenotes:sync'),
  listAppleNotes: () => ipcRenderer.invoke('connector:applenotes:list'),
  onAppleNotesProgress: (callback: (data: unknown) => void) => {
    const sub = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('connector:applenotes:progress', sub);
    return () => ipcRenderer.removeListener('connector:applenotes:progress', sub);
  },

  // Obsidian connector
  importObsidianVault: () => ipcRenderer.invoke('connector:obsidian:import'),
  listObsidianImports: () => ipcRenderer.invoke('connector:obsidian:list'),
  onObsidianProgress: (callback: (data: unknown) => void) => {
    const sub = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('connector:obsidian:progress', sub);
    return () => ipcRenderer.removeListener('connector:obsidian:progress', sub);
  },

  // Notion connector
  importNotion: () => ipcRenderer.invoke('connector:notion:import'),
  listNotionImports: () => ipcRenderer.invoke('connector:notion:list'),
  onNotionProgress: (callback: (data: unknown) => void) => {
    const sub = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('connector:notion:progress', sub);
    return () => ipcRenderer.removeListener('connector:notion:progress', sub);
  },

  // Nuke all data
  nukeAll: (): Promise<{ success: boolean; deletedEntries: number; deletedArticles: number; deletedChats: number }> =>
    ipcRenderer.invoke('app:nuke-all'),

  // User profile
  getUserProfile: (): Promise<{ name: string; nicknames: string[] }> =>
    ipcRenderer.invoke('app:get-user-profile'),

  // MCP server
  startMcpServer: () => ipcRenderer.invoke('mcp:start'),
  stopMcpServer: () => ipcRenderer.invoke('mcp:stop'),
  getMcpStatus: () => ipcRenderer.invoke('mcp:status'),

  // Compiler
  startCompiler: (sourceType?: string) => ipcRenderer.invoke('compiler:start', sourceType),
  pauseCompiler: () => ipcRenderer.invoke('compiler:pause'),
  resumeCompiler: () => ipcRenderer.invoke('compiler:resume'),
  stopCompiler: () => ipcRenderer.invoke('compiler:stop'),
  getCompilerState: () => ipcRenderer.invoke('compiler:get-state'),
  onCompilerProgress: (callback: (state: unknown) => void) => {
    const sub = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on('compiler:progress', sub);
    return () => ipcRenderer.removeListener('compiler:progress', sub);
  },

  // Chat
  sendChatMessage: (chatId: string, message: string, history: unknown[]) =>
    ipcRenderer.invoke('chat:send', chatId, message, history),
  fileAnswer: (answer: string, chatId: string) =>
    ipcRenderer.invoke('chat:file-answer', answer, chatId),
  listChats: () => ipcRenderer.invoke('chat:list'),
  getChat: (id: string) => ipcRenderer.invoke('chat:get', id),
  deleteChat: (id: string) => ipcRenderer.invoke('chat:delete', id),
  newChat: () => ipcRenderer.invoke('chat:new'),
  onChatThinking: (callback: (step: string) => void) => {
    const sub = (_event: any, step: string) => callback(step);
    ipcRenderer.on('chat:thinking', sub);
    return () => ipcRenderer.removeListener('chat:thinking', sub);
  },

  // Search
  searchQuery: (query: string) => ipcRenderer.invoke('search:query', query),
  searchReindex: () => ipcRenderer.invoke('search:reindex'),

  // Lint
  runLint: () => ipcRenderer.invoke('lint:run'),
  getLintResults: () => ipcRenderer.invoke('lint:get-results'),

  // Sources management
  listEntries: (filters?: { dateFrom?: string; dateTo?: string; sourceType?: string }) =>
    ipcRenderer.invoke('sources:list-entries', filters),
  readEntry: (entryPath: string): Promise<string> =>
    ipcRenderer.invoke('sources:read-entry', entryPath),
  deleteEntries: (paths: string[]) =>
    ipcRenderer.invoke('sources:delete-entries', paths),
  getDateRange: () =>
    ipcRenderer.invoke('sources:get-date-range'),
  getExcludes: (): Promise<string[]> =>
    ipcRenderer.invoke('sources:get-excludes'),
  setExcludes: (excludes: string[]): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('sources:set-excludes', excludes),
  getEntryCountBySource: (): Promise<Record<string, number>> =>
    ipcRenderer.invoke('sources:get-entry-count-by-source'),
  getArticlesBySource: (sourceType: string) =>
    ipcRenderer.invoke('sources:get-articles-by-source', sourceType),

  // Wiki management
  listWikiArticles: () =>
    ipcRenderer.invoke('wiki:list-articles'),
  deleteWikiArticles: (paths: string[]) =>
    ipcRenderer.invoke('wiki:delete-articles', paths),

  // Rebuild
  rebuildWiki: () =>
    ipcRenderer.invoke('compiler:rebuild'),

  // Cleanup & Breakdown
  cleanupWiki: () => ipcRenderer.invoke('compiler:cleanup'),
  breakdownWiki: () => ipcRenderer.invoke('compiler:breakdown'),

  // Generic event listener for streaming (compiler progress, chat tokens, etc.)
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
};

contextBridge.exposeInMainWorld('cortex', api);

export type CortexAPI = typeof api;
