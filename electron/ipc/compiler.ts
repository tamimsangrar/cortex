/**
 * IPC handlers for the wiki compiler: start, pause, resume, stop,
 * rebuild, cleanup, and breakdown operations.
 */
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { Compiler, CompilerState } from '../services/compiler';
import { setActiveProvider, getActiveProvider } from '../services/llm';
import { LLMProviderName } from '../services/llm/types';
import { loadApiKey } from '../services/keystore';
import { SearchEngine } from '../services/search';
import { getCortexDataDir } from '../main';
import { runCleanup } from '../services/compiler/cleanup';
import { runBreakdown } from '../services/compiler/breakdown';
import fs from 'fs';
import path from 'path';

let compiler: Compiler | null = null;
/** Queue of source types to compile after the current run finishes */
let compileQueue: Array<string | undefined> = [];
/** Track the IPC event sender so queued runs can emit progress */
let lastEventSender: Electron.WebContents | null = null;

function ensureProviderLoaded(): void {
  if (getActiveProvider()) return;

  const configPath = path.join(getCortexDataDir(), 'config.json');
  if (!fs.existsSync(configPath)) throw new Error('No config found. Set up your LLM provider in Settings.');
  
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const providerName = config.llmProvider as LLMProviderName | undefined;
  if (!providerName) throw new Error('No LLM provider configured. Go to Settings first.');

  const apiKey = loadApiKey(providerName);
  if (!apiKey) throw new Error(`No API key found for ${providerName}. Go to Settings and save your key.`);

  setActiveProvider(providerName, apiKey);
}

/** Count unprocessed entries for a given source type (or all if undefined) */
function countUnprocessedEntries(sourceType?: string): number {
  const baseDir = getCortexDataDir();
  const entriesDir = path.join(baseDir, 'raw', 'entries');
  const wikiDir = path.join(baseDir, 'wiki');

  if (!fs.existsSync(entriesDir)) return 0;

  // Load absorb log
  const logPath = path.join(wikiDir, '_absorb_log.json');
  let processedIds = new Set<string>();
  try {
    if (fs.existsSync(logPath)) {
      const log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
      processedIds = new Set(log.map((e: { entryId: string }) => e.entryId));
    }
  } catch { /* ignore */ }

  // Load excludes
  let excludedIds = new Set<string>();
  try {
    const configPath = path.join(baseDir, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (Array.isArray(config.compilationExcludes)) {
        excludedIds = new Set(config.compilationExcludes);
      }
    }
  } catch { /* ignore */ }

  const allFiles = fs.readdirSync(entriesDir).filter(f => f.endsWith('.md')).sort();
  let count = 0;

  for (const file of allFiles) {
    const content = fs.readFileSync(path.join(entriesDir, file), 'utf-8');
    const match = content.match(/^id:\s*(.+)$/m);
    const entryId = match ? match[1].trim() : '';
    const effectiveId = entryId || file.replace('.md', '');

    if (excludedIds.has(effectiveId)) continue;

    if (sourceType) {
      const sourcePrefix = sourceType === 'web-clip' ? 'clip' : sourceType === 'apple-notes' ? 'note' : sourceType;
      if (!effectiveId.startsWith(sourcePrefix + '_') && !file.includes('_' + sourcePrefix.slice(0, 2) + '_')) continue;
    }

    if (entryId && !processedIds.has(entryId)) {
      count++;
    } else if (!entryId && !processedIds.has(effectiveId)) {
      count++;
    }
  }
  return count;
}

/** Start the next queued compile job if any */
function processQueue(): void {
  if (compileQueue.length === 0) return;
  const nextSource = compileQueue.shift();
  startCompilation(nextSource);
}

/** Start a compilation run */
function startCompilation(sourceType?: string): void {
  compiler = new Compiler();

  compiler.start((state: CompilerState) => {
    try {
      lastEventSender?.send('compiler:progress', state);
    } catch {
      // Renderer may have been destroyed
    }
  }, sourceType).then(async () => {
    // Rebuild search index
    try {
      const searchEngine = new SearchEngine(getCortexDataDir());
      await searchEngine.buildIndex();
    } catch { /* best-effort */ }

    // Process next in queue
    processQueue();
  }).catch((err) => {
    console.error('Compiler error:', err);
    try {
      lastEventSender?.send('compiler:progress', {
        status: 'error',
        currentEntry: err instanceof Error ? err.message : 'Unknown error',
        entriesProcessed: 0,
        entriesTotal: 0,
        articlesCreated: 0,
        articlesUpdated: 0,
        tokensUsed: { input: 0, output: 0 },
      });
    } catch { /* ignore */ }

    // Still process queue on error
    processQueue();
  });
}

export function registerCompilerHandlers(): void {
  ipcMain.handle('compiler:start', async (event: IpcMainInvokeEvent, sourceType?: string) => {
    lastEventSender = event.sender;

    if (compiler && compiler.getState().status === 'running') {
      // Queue it and return the count of entries that will be added
      const queuedEntries = countUnprocessedEntries(sourceType);
      compileQueue.push(sourceType);
      return { queued: true, queuedEntries };
    }

    try {
      ensureProviderLoaded();
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Unknown error' };
    }

    startCompilation(sourceType);

    // Return immediately — progress comes via events
    return { success: true };
  });

  ipcMain.handle('compiler:pause', async () => {
    if (!compiler) return { error: 'No compiler instance' };
    compiler.pause();
    return { success: true };
  });

  ipcMain.handle('compiler:resume', async () => {
    if (!compiler) return { error: 'No compiler instance' };
    compiler.resume();
    return { success: true };
  });

  ipcMain.handle('compiler:stop', async () => {
    if (!compiler) return { error: 'No compiler instance' };
    compiler.stop();
    return { success: true };
  });

  ipcMain.handle('compiler:get-state', async () => {
    if (!compiler) {
      return {
        status: 'idle',
        currentEntry: null,
        entriesProcessed: 0,
        entriesTotal: 0,
        articlesCreated: 0,
        articlesUpdated: 0,
        tokensUsed: { input: 0, output: 0 },
      } satisfies CompilerState;
    }
    return compiler.getState();
  });

  ipcMain.handle('compiler:rebuild', async (event: IpcMainInvokeEvent) => {
    if (compiler && compiler.getState().status === 'running') {
      return { error: 'Compiler is already running' };
    }

    try {
      ensureProviderLoaded();
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Unknown error' };
    }

    const baseDir = getCortexDataDir();
    const wikiDir = path.join(baseDir, 'wiki');

    // Wipe wiki articles (keep _schema.md)
    if (fs.existsSync(wikiDir)) {
      const entries = fs.readdirSync(wikiDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(wikiDir, entry.name);
        if (entry.name === '_schema.md') continue;
        if (entry.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(fullPath);
        }
      }
    }

    lastEventSender = event.sender;
    startCompilation();

    return { success: true };
  });

  ipcMain.handle('compiler:cleanup', async () => {
    const baseDir = getCortexDataDir();
    const wikiDir = path.join(baseDir, 'wiki');
    if (!fs.existsSync(wikiDir)) {
      return { error: 'Wiki directory does not exist' };
    }
    try {
      const report = runCleanup(wikiDir);
      return report;
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('compiler:breakdown', async () => {
    const baseDir = getCortexDataDir();
    const wikiDir = path.join(baseDir, 'wiki');
    if (!fs.existsSync(wikiDir)) {
      return { error: 'Wiki directory does not exist' };
    }
    try {
      const report = runBreakdown(wikiDir);
      return report;
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });
}
