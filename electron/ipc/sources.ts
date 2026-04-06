/**
 * IPC handlers for raw source entry management (list, read, delete, exclude).
 */
import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { getCortexDataDir } from '../main';
import { safePath } from './index';

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && val && !val.startsWith('-') && !val.startsWith('[')) {
      fm[key] = val;
    }
  }
  return fm;
}

interface EntryInfo {
  id: string;
  date: string;
  sourceType: string;
  title: string;
  path: string;
  contactName: string;
  messageCount: number;
}

function scanEntries(filters?: { dateFrom?: string; dateTo?: string; sourceType?: string }): EntryInfo[] {
  const entriesDir = path.join(getCortexDataDir(), 'raw', 'entries');
  if (!fs.existsSync(entriesDir)) return [];

  const files = fs.readdirSync(entriesDir).filter(f => f.endsWith('.md')).sort();
  const entries: EntryInfo[] = [];

  for (const file of files) {
    const fullPath = path.join(entriesDir, file);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const fm = parseFrontmatter(content);

    const entryDate = fm.date || '';
    const sourceType = fm.source_type || fm.sourceType || fm.type || 'unknown';
    const title = fm.title || file.replace('.md', '');
    const id = fm.id || file.replace('.md', '');

    if (filters) {
      if (filters.dateFrom && entryDate && entryDate < filters.dateFrom) continue;
      if (filters.dateTo && entryDate && entryDate > filters.dateTo) continue;
      if (filters.sourceType && filters.sourceType !== 'all' && sourceType !== filters.sourceType) continue;
    }

    entries.push({
      id,
      date: entryDate,
      sourceType,
      title,
      path: file,
      contactName: fm.contact_name || fm.contactName || title,
      messageCount: parseInt(fm.message_count || fm.messageCount || '0', 10) || 0,
    });
  }

  return entries;
}

function loadConfig(): Record<string, unknown> {
  const configPath = path.join(getCortexDataDir(), 'config.json');
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveConfigKey(key: string, value: unknown): void {
  const configPath = path.join(getCortexDataDir(), 'config.json');
  const config = loadConfig();
  config[key] = value;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

const SOURCE_PREFIXES: Record<string, string> = {
  imessage: 'imessage',
  whatsapp: 'whatsapp',
  clip: 'web-clip',
  note: 'apple-notes',
  obsidian: 'obsidian',
  notion: 'notion',
};

function detectSourceType(entryId: string): string {
  for (const [prefix, sourceType] of Object.entries(SOURCE_PREFIXES)) {
    if (entryId.startsWith(prefix + '_')) return sourceType;
  }
  return 'unknown';
}

export function registerSourcesHandlers(): void {
  ipcMain.handle('sources:list-entries', async (_, filters?: { dateFrom?: string; dateTo?: string; sourceType?: string }) => {
    return scanEntries(filters);
  });

  ipcMain.handle('sources:read-entry', async (_, entryPath: string) => {
    const entriesDir = path.join(getCortexDataDir(), 'raw', 'entries');
    const fullPath = safePath(entriesDir, entryPath);
    if (!fs.existsSync(fullPath)) throw new Error('Entry not found');
    return fs.readFileSync(fullPath, 'utf-8');
  });

  ipcMain.handle('sources:delete-entries', async (_, paths: string[]) => {
    const entriesDir = path.join(getCortexDataDir(), 'raw', 'entries');
    let deleted = 0;
    for (const filePath of paths) {
      const fullPath = safePath(entriesDir, filePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        deleted++;
      }
    }
    return { deleted };
  });

  ipcMain.handle('sources:get-date-range', async () => {
    const entries = scanEntries();
    const dates = entries.map(e => e.date).filter(d => d).sort();
    if (dates.length === 0) return { earliest: '', latest: '' };
    return { earliest: dates[0], latest: dates[dates.length - 1] };
  });

  ipcMain.handle('sources:get-excludes', async () => {
    const config = loadConfig();
    return (config.compilationExcludes as string[]) || [];
  });

  ipcMain.handle('sources:set-excludes', async (_, excludes: string[]) => {
    saveConfigKey('compilationExcludes', excludes);
    return { success: true };
  });

  ipcMain.handle('sources:get-entry-count-by-source', async () => {
    const entries = scanEntries();
    const counts: Record<string, number> = {};
    for (const entry of entries) {
      const src = entry.sourceType || 'unknown';
      counts[src] = (counts[src] || 0) + 1;
    }
    return counts;
  });

  ipcMain.handle('sources:get-articles-by-source', async (_, sourceType: string) => {
    const wikiDir = path.join(getCortexDataDir(), 'wiki');
    const logPath = path.join(wikiDir, '_absorb_log.json');
    if (!fs.existsSync(logPath)) return { articlesCreated: [], articlesUpdated: [] };

    let log: { entryId: string; articlesCreated: string[]; articlesUpdated: string[] }[];
    try {
      log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    } catch {
      return { articlesCreated: [], articlesUpdated: [] };
    }

    const createdSet = new Set<string>();
    const updatedSet = new Set<string>();

    for (const entry of log) {
      const entrySourceType = detectSourceType(entry.entryId);
      if (entrySourceType !== sourceType) continue;
      for (const a of entry.articlesCreated || []) createdSet.add(a);
      for (const a of entry.articlesUpdated || []) updatedSet.add(a);
    }

    // Remove from updated if also in created
    for (const a of createdSet) updatedSet.delete(a);

    return {
      articlesCreated: Array.from(createdSet),
      articlesUpdated: Array.from(updatedSet),
    };
  });
}
