/**
 * IPC handlers for wiki article listing and bulk deletion.
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

interface WikiArticleInfo {
  path: string;
  title: string;
  type: string;
  created: string;
  last_updated: string;
}

function scanWikiArticles(): WikiArticleInfo[] {
  const wikiDir = path.join(getCortexDataDir(), 'wiki');
  if (!fs.existsSync(wikiDir)) return [];

  const articles: WikiArticleInfo[] = [];

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const relPath = path.relative(wikiDir, fullPath).replace(/\\/g, '/');
        const content = fs.readFileSync(fullPath, 'utf-8');
        const fm = parseFrontmatter(content);
        articles.push({
          path: relPath,
          title: fm.title || entry.name.replace('.md', ''),
          type: fm.type || 'unknown',
          created: fm.created || '',
          last_updated: fm.last_updated || fm.updated || '',
        });
      }
    }
  }

  walk(wikiDir);
  return articles;
}

export function registerWikiHandlers(): void {
  ipcMain.handle('wiki:list-articles', async () => {
    return scanWikiArticles();
  });

  ipcMain.handle('wiki:delete-articles', async (_, paths: string[]) => {
    const wikiDir = path.join(getCortexDataDir(), 'wiki');
    let deleted = 0;
    for (const relPath of paths) {
      const fullPath = safePath(wikiDir, relPath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        deleted++;
        // Remove empty parent directories
        let dir = path.dirname(fullPath);
        while (dir !== wikiDir) {
          try { const remaining = fs.readdirSync(dir); if (remaining.length === 0) { fs.rmdirSync(dir); dir = path.dirname(dir); } else { break; } } catch { break; }
        }
      }
    }

    // Rebuild index and backlinks after bulk delete
    const indexPath = path.join(wikiDir, '_index.md');
    if (fs.existsSync(indexPath)) {
      const deletedNames = new Set(paths.map(p => p.replace('.md', '')));
      const content = fs.readFileSync(indexPath, 'utf-8');
      const updated = content.split('\n').filter(line => {
        return !Array.from(deletedNames).some(name => line.includes(name));
      }).join('\n');
      fs.writeFileSync(indexPath, updated, 'utf-8');
    }

    const backlinksPath = path.join(wikiDir, '_backlinks.json');
    if (fs.existsSync(backlinksPath)) {
      try {
        const bl = JSON.parse(fs.readFileSync(backlinksPath, 'utf-8'));
        const deletedKeys = new Set(paths.map(p => p.replace('.md', '')));
        for (const key of deletedKeys) delete bl[key];
        for (const k of Object.keys(bl)) {
          if (bl[k].inbound) bl[k].inbound = bl[k].inbound.filter((x: string) => !deletedKeys.has(x));
          if (bl[k].outbound) bl[k].outbound = bl[k].outbound.filter((x: string) => !deletedKeys.has(x));
        }
        fs.writeFileSync(backlinksPath, JSON.stringify(bl, null, 2), 'utf-8');
      } catch {}
    }

    return { deleted };
  });
}
