/**
 * IPC handler registry — the bridge between renderer and main process.
 * Registers all channel handlers and provides the safePath utility for
 * preventing path-traversal attacks.
 */
import { ipcMain, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getCortexDataDir } from '../main';
import { registerSettingsHandlers } from './settings';
import { registerLlmHandlers } from './llm';
import { registerConnectorHandlers } from './connectors';
import { registerCompilerHandlers } from './compiler';
import { registerChatHandlers } from './chat';
import { registerSearchHandlers } from './search';
import { registerLintHandlers } from './lint';
import { registerSourcesHandlers } from './sources';
import { registerWikiHandlers } from './wiki';

/** Resolve a relative path within a base directory and verify containment. */
export function safePath(base: string, relative: string): string {
  const resolved = path.resolve(base, relative);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error('Access denied: path outside allowed directory');
  }
  return resolved;
}

export function registerIpcHandlers(): void {
  registerSettingsHandlers();
  registerLlmHandlers();
  registerConnectorHandlers();
  registerCompilerHandlers();
  registerChatHandlers();
  registerSearchHandlers();
  registerLintHandlers();
  registerSourcesHandlers();
  registerWikiHandlers();
  // Config handlers
  ipcMain.handle('config:get', async () => {
    const configPath = path.join(getCortexDataDir(), 'config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    return {};
  });

  ipcMain.handle('config:set', async (_, key: string, value: unknown) => {
    const configPath = path.join(getCortexDataDir(), 'config.json');
    const config = fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      : {};
    config[key] = value;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  });

  ipcMain.handle('config:data-dir', async () => {
    return getCortexDataDir();
  });

  // Filesystem handlers
  ipcMain.handle('fs:read-dir', async (_, relativePath: string) => {
    const fullPath = safePath(getCortexDataDir(), relativePath);
    if (!fs.existsSync(fullPath)) return [];
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    return entries.map(e => ({
      name: e.name,
      isDirectory: e.isDirectory(),
    }));
  });

  ipcMain.handle('fs:read-file', async (_, relativePath: string) => {
    const fullPath = safePath(getCortexDataDir(), relativePath);
    if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${relativePath}`);
    return fs.readFileSync(fullPath, 'utf-8');
  });

  // Wiki tree handler — returns nested directory structure of wiki/
  ipcMain.handle('wiki:get-tree', async () => {
    const wikiDir = path.join(getCortexDataDir(), 'wiki');
    if (!fs.existsSync(wikiDir)) return [];

    function scanDir(dir: string, relative: string): unknown[] {
      const names = fs.readdirSync(dir);
      const result: Record<string, unknown>[] = [];
      for (const name of names) {
        if (name.startsWith('.') || name.startsWith('_')) continue;
        const fullPath = path.join(dir, name);
        const relPath = relative ? `${relative}/${name}` : name;
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          const children = scanDir(fullPath, relPath);
          if (children.length > 0) {
            result.push({ name, path: relPath, isDir: true, children });
          }
        } else if (name.endsWith('.md')) {
          result.push({ name: name.replace('.md', ''), path: relPath, isDir: false });
        }
      }
      return result.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return String(a.name).localeCompare(String(b.name));
      });
    }

    return scanDir(wikiDir, '');
  });

  ipcMain.handle('wiki:read-article', async (_, relativePath: string) => {
    const wikiDir = path.join(getCortexDataDir(), 'wiki');
    const fullPath = safePath(wikiDir, relativePath);
    if (!fs.existsSync(fullPath)) throw new Error(`Article not found: ${relativePath}`);
    return fs.readFileSync(fullPath, 'utf-8');
  });

  ipcMain.handle('wiki:save-article', async (_, relativePath: string, content: string) => {
    const wikiDir = path.join(getCortexDataDir(), 'wiki');
    const fullPath = safePath(wikiDir, relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    return { success: true };
  });

  ipcMain.handle('wiki:delete-article', async (_, relativePath: string) => {
    const wikiDir = path.join(getCortexDataDir(), 'wiki');
    const fullPath = safePath(wikiDir, relativePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      // Remove empty parent directory
      const dir = path.dirname(fullPath);
      try { const remaining = fs.readdirSync(dir); if (remaining.length === 0) fs.rmdirSync(dir); } catch {}

      // Remove from _index.md
      const indexPath = path.join(wikiDir, '_index.md');
      if (fs.existsSync(indexPath)) {
        const indexContent = fs.readFileSync(indexPath, 'utf-8');
        const articleName = relativePath.replace('.md', '');
        const updated = indexContent.split('\n').filter(line => !line.includes(articleName)).join('\n');
        fs.writeFileSync(indexPath, updated, 'utf-8');
      }

      // Remove from _backlinks.json
      const backlinksPath = path.join(wikiDir, '_backlinks.json');
      if (fs.existsSync(backlinksPath)) {
        try {
          const bl = JSON.parse(fs.readFileSync(backlinksPath, 'utf-8'));
          const key = relativePath.replace('.md', '');
          delete bl[key];
          // Also remove from other entries' inbound/outbound
          for (const k of Object.keys(bl)) {
            if (bl[k].inbound) bl[k].inbound = bl[k].inbound.filter((x: string) => x !== key);
            if (bl[k].outbound) bl[k].outbound = bl[k].outbound.filter((x: string) => x !== key);
          }
          fs.writeFileSync(backlinksPath, JSON.stringify(bl, null, 2), 'utf-8');
        } catch {}
      }

      // Remove related entries from _absorb_log.json so the article doesn't get re-created
      const absorbPath = path.join(wikiDir, '_absorb_log.json');
      if (fs.existsSync(absorbPath)) {
        try {
          const log = JSON.parse(fs.readFileSync(absorbPath, 'utf-8')) as Array<Record<string, unknown>>;
          const updated = log.map((entry) => ({
            ...entry,
            articlesCreated: (entry.articlesCreated as string[] || []).filter((a: string) => a !== relativePath),
            articlesUpdated: (entry.articlesUpdated as string[] || []).filter((a: string) => a !== relativePath),
          }));
          fs.writeFileSync(absorbPath, JSON.stringify(updated, null, 2), 'utf-8');
        } catch {}
      }
    }
    return { success: true };
  });

  // Wiki graph handler — returns nodes and edges for the graph view
  ipcMain.handle('wiki:get-graph', async () => {
    const wikiDir = path.join(getCortexDataDir(), 'wiki');
    if (!fs.existsSync(wikiDir)) return { nodes: [], edges: [] };

    // Collect all .md files (excluding _*.md)
    const files: { relPath: string; fullPath: string }[] = [];
    function collectFiles(dir: string, relative: string) {
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('.') || name.startsWith('_')) continue;
        const full = path.join(dir, name);
        const rel = relative ? `${relative}/${name}` : name;
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          collectFiles(full, rel);
        } else if (name.endsWith('.md')) {
          files.push({ relPath: rel, fullPath: full });
        }
      }
    }
    collectFiles(wikiDir, '');

    // Build a set of valid article ids (relative path without .md, lowercased for matching)
    const articleIds = new Set(files.map(f => f.relPath));
    const idLookup = new Map<string, string>(); // lowercase basename -> relPath
    for (const f of files) {
      const base = path.basename(f.relPath, '.md').toLowerCase();
      idLookup.set(base, f.relPath);
    }

    const nodes: { id: string; title: string; type: string; linkCount: number }[] = [];
    const edgeSet = new Set<string>();
    const edges: { source: string; target: string }[] = [];
    const linkCounts = new Map<string, number>();

    // Initialize link counts
    for (const f of files) linkCounts.set(f.relPath, 0);

    // Parse each file
    for (const f of files) {
      const content = fs.readFileSync(f.fullPath, 'utf-8');

      // Parse frontmatter
      let title = path.basename(f.relPath, '.md');
      let type = '';
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        for (const line of fmMatch[1].split('\n')) {
          const idx = line.indexOf(':');
          if (idx > 0) {
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
            if (key === 'title' && val) title = val;
            if (key === 'type' && val) type = val;
          }
        }
      }

      // Find all [[wikilinks]]
      const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
      let match;
      while ((match = wikilinkRegex.exec(content)) !== null) {
        const linkText = match[1].trim();
        // Resolve link: try exact path match, then basename match
        let targetId: string | undefined;
        // Check if it matches a relPath directly (with .md)
        if (articleIds.has(linkText + '.md')) {
          targetId = linkText + '.md';
        } else if (articleIds.has(linkText)) {
          targetId = linkText;
        } else {
          // Try basename match (case-insensitive)
          targetId = idLookup.get(linkText.toLowerCase());
        }

        if (targetId && targetId !== f.relPath) {
          const edgeKey = [f.relPath, targetId].sort().join('->');
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            edges.push({ source: f.relPath, target: targetId });
          }
          linkCounts.set(f.relPath, (linkCounts.get(f.relPath) || 0) + 1);
          linkCounts.set(targetId, (linkCounts.get(targetId) || 0) + 1);
        }
      }

      nodes.push({ id: f.relPath, title, type, linkCount: 0 });
    }

    // Set final link counts
    for (const node of nodes) {
      node.linkCount = linkCounts.get(node.id) || 0;
    }

    return { nodes, edges };
  });

  // App info
  ipcMain.handle('app:version', async () => {
    return app.getVersion();
  });

  ipcMain.handle('app:platform', async () => {
    return process.platform;
  });
}
