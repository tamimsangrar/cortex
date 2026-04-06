/**
 * IPC handlers for all data source connectors (iMessage, WhatsApp, Apple Notes, Obsidian, Notion, Web Clipper).
 */
import { ipcMain, IpcMainInvokeEvent, dialog } from 'electron';
import {
  checkAccess,
  getContacts,
  sync,
  getConfig,
  SyncOptions,
} from '../services/connectors/imessage';
import { clipUrl, listClips } from '../services/connectors/webclip';
import { parseExport, listImports } from '../services/connectors/whatsapp';
import {
  checkAccess as checkAppleNotesAccess,
  getNotes as getAppleNotes,
  sync as syncAppleNotes,
} from '../services/connectors/applenotes';
import {
  importVault,
  listImports as listObsidianImports,
} from '../services/connectors/obsidian';
import {
  importExport as importNotionExport,
  listImports as listNotionImports,
} from '../services/connectors/notion';

export function registerConnectorHandlers(): void {
  // ── iMessage ──────────────────────────────────────────────────────────
  ipcMain.handle('connector:imessage:check-access', async () => {
    return checkAccess();
  });

  ipcMain.handle('connector:imessage:get-contacts', async () => {
    return getContacts();
  });

  ipcMain.handle(
    'connector:imessage:sync',
    async (event: IpcMainInvokeEvent, options?: SyncOptions) => {
      const stats = await sync(options, (progress) => {
        event.sender.send('connector:imessage:progress', progress);
      });
      return stats;
    },
  );

  ipcMain.handle('connector:imessage:get-config', async () => {
    return getConfig();
  });

  // ── Web Clipper ───────────────────────────────────────────────────────
  ipcMain.handle(
    'connector:webclip:clip',
    async (event: IpcMainInvokeEvent, url: string) => {
      const result = await clipUrl(url, (progress) => {
        event.sender.send('connector:webclip:progress', progress);
      });
      return result;
    },
  );

  ipcMain.handle('connector:webclip:list', async () => {
    return listClips();
  });

  // ── WhatsApp ──────────────────────────────────────────────────────────
  ipcMain.handle(
    'connector:whatsapp:import',
    async (event: IpcMainInvokeEvent, options?: { filePath?: string }) => {
      let filePath = options?.filePath;
      if (!filePath) {
        const result = await dialog.showOpenDialog({
          title: 'Select WhatsApp Export File',
          filters: [
            { name: 'WhatsApp Export', extensions: ['zip', 'txt'] },
          ],
          properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) {
          return { cancelled: true };
        }
        filePath = result.filePaths[0];
      }
      const importResult = await parseExport(filePath, (progress) => {
        event.sender.send('connector:whatsapp:progress', progress);
      });
      return importResult;
    },
  );

  ipcMain.handle('connector:whatsapp:list', async () => {
    return listImports();
  });

  // ── Apple Notes ───────────────────────────────────────────────────────
  ipcMain.handle('connector:applenotes:check-access', async () => {
    return checkAppleNotesAccess();
  });

  ipcMain.handle(
    'connector:applenotes:sync',
    async (event: IpcMainInvokeEvent) => {
      const result = await syncAppleNotes((progress) => {
        event.sender.send('connector:applenotes:progress', progress);
      });
      return result;
    },
  );

  ipcMain.handle('connector:applenotes:list', async () => {
    return getAppleNotes();
  });

  // ── Obsidian ──────────────────────────────────────────────────────────
  ipcMain.handle(
    'connector:obsidian:import',
    async (event: IpcMainInvokeEvent, options?: { vaultPath?: string }) => {
      let vaultPath = options?.vaultPath;
      if (!vaultPath) {
        const result = await dialog.showOpenDialog({
          title: 'Select Obsidian Vault Folder',
          properties: ['openDirectory'],
        });
        if (result.canceled || result.filePaths.length === 0) {
          return { cancelled: true };
        }
        vaultPath = result.filePaths[0];
      }
      const importResult = await importVault(vaultPath, (progress) => {
        event.sender.send('connector:obsidian:progress', progress);
      });
      return importResult;
    },
  );

  ipcMain.handle('connector:obsidian:list', async () => {
    return listObsidianImports();
  });

  // ── Notion ────────────────────────────────────────────────────────────
  ipcMain.handle(
    'connector:notion:import',
    async (event: IpcMainInvokeEvent, options?: { filePath?: string }) => {
      let filePath = options?.filePath;
      if (!filePath) {
        const result = await dialog.showOpenDialog({
          title: 'Select Notion Export File',
          filters: [
            { name: 'Notion Export', extensions: ['zip', 'md', 'csv'] },
          ],
          properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) {
          return { cancelled: true };
        }
        filePath = result.filePaths[0];
      }
      const importResult = await importNotionExport(filePath, (progress) => {
        event.sender.send('connector:notion:progress', progress);
      });
      return importResult;
    },
  );

  ipcMain.handle('connector:notion:list', async () => {
    return listNotionImports();
  });
}
