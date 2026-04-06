/**
 * IPC handlers for full-text search across wiki and raw entries.
 */
import { ipcMain } from 'electron';
import { getCortexDataDir } from '../main';
import { SearchEngine } from '../services/search';

let engine: SearchEngine | null = null;
let indexed = false;

function getEngine(): SearchEngine {
  if (!engine) {
    engine = new SearchEngine(getCortexDataDir());
  }
  return engine;
}

export function registerSearchHandlers(): void {
  ipcMain.handle('search:query', async (_, query: string) => {
    const eng = getEngine();
    if (!indexed) {
      await eng.buildIndex();
      indexed = true;
    }
    return eng.search(query);
  });

  ipcMain.handle('search:reindex', async () => {
    const eng = getEngine();
    await eng.buildIndex();
    indexed = true;
  });
}
