/**
 * IPC handlers for the wiki structural linter.
 */
import { ipcMain } from 'electron';
import path from 'path';
import { getCortexDataDir } from '../main';
import { runStructuralChecks, LintIssue } from '../services/lint';

let cachedResults: LintIssue[] = [];

export function registerLintHandlers(): void {
  ipcMain.handle('lint:run', async () => {
    const wikiDir = path.join(getCortexDataDir(), 'wiki');
    cachedResults = await runStructuralChecks(wikiDir);
    return cachedResults;
  });

  ipcMain.handle('lint:get-results', async () => {
    return cachedResults;
  });
}
