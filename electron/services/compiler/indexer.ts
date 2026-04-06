/**
 * Wiki indexer — scans articles to build _index.md and _backlinks.json.
 * Also provides the appendLog utility for the absorption log (_log.md).
 */
import fs from 'fs';
import path from 'path';
import { indexPrompt } from './prompts';

interface ArticleMeta {
  path: string;
  title: string;
  type: string;
  aliases: string[];
}

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

function parseAliases(content: string): string[] {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];
  const fmBlock = match[1];
  const aliasMatch = fmBlock.match(/^also:\s*\[([^\]]*)\]/m);
  if (aliasMatch) {
    return aliasMatch[1]
      .split(',')
      .map(s => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  const aliasStart = fmBlock.match(/^also:\s*$/m);
  if (aliasStart) {
    const lines = fmBlock.split('\n');
    const idx = lines.findIndex(l => /^also:\s*$/.test(l));
    const aliases: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      const itemMatch = lines[i].match(/^\s+-\s+["']?([^"'\n]+)["']?\s*$/);
      if (itemMatch) aliases.push(itemMatch[1].trim());
      else break;
    }
    return aliases;
  }
  // Single-line also: value
  const singleMatch = fmBlock.match(/^also:\s+(.+)$/m);
  if (singleMatch) {
    const val = singleMatch[1].trim();
    if (val.startsWith('[')) {
      return val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    return val.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  // Generate aliases from title
  return [];
}

function generateDefaultAliases(title: string, filePath: string): string[] {
  const aliases: string[] = [];
  const basename = path.basename(filePath, '.md');
  const titleLower = title.toLowerCase();
  const baseFormatted = basename.replace(/-/g, ' ');
  if (baseFormatted !== titleLower) {
    aliases.push(baseFormatted);
  }
  return aliases;
}

function scanArticles(wikiDir: string): ArticleMeta[] {
  const articles: ArticleMeta[] = [];

  function walk(dir: string, relativeTo: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('_')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relativeTo);
      } else if (entry.name.endsWith('.md')) {
        const relPath = path.relative(relativeTo, fullPath).replace(/\\/g, '/');
        const content = fs.readFileSync(fullPath, 'utf-8');
        const fm = parseFrontmatter(content);
        const explicitAliases = parseAliases(content);
        const defaultAliases = generateDefaultAliases(
          fm.title || entry.name.replace('.md', ''),
          relPath,
        );
        const allAliases = [...new Set([...explicitAliases, ...defaultAliases])];
        articles.push({
          path: relPath,
          title: fm.title || entry.name.replace('.md', ''),
          type: fm.type || 'unknown',
          aliases: allAliases,
        });
      }
    }
  }

  walk(wikiDir, wikiDir);
  return articles;
}

export function rebuildIndex(wikiDir: string): void {
  const articles = scanArticles(wikiDir);
  const indexContent = indexPrompt(articles);
  fs.writeFileSync(path.join(wikiDir, '_index.md'), indexContent, 'utf-8');
}

export function rebuildBacklinks(wikiDir: string): Record<string, string[]> {
  const backlinks: Record<string, string[]> = {};
  const wikilinkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

  function walk(dir: string, relativeTo: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('_')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relativeTo);
      } else if (entry.name.endsWith('.md')) {
        const sourcePath = path.relative(relativeTo, fullPath).replace(/\\/g, '/');
        const content = fs.readFileSync(fullPath, 'utf-8');
        let match: RegExpExecArray | null;
        while ((match = wikilinkPattern.exec(content)) !== null) {
          let target = match[1].trim();
          if (!target.endsWith('.md')) target += '.md';
          if (!backlinks[target]) backlinks[target] = [];
          if (!backlinks[target].includes(sourcePath)) {
            backlinks[target].push(sourcePath);
          }
        }
      }
    }
  }

  walk(wikiDir, wikiDir);
  fs.writeFileSync(
    path.join(wikiDir, '_backlinks.json'),
    JSON.stringify(backlinks, null, 2),
    'utf-8',
  );
  return backlinks;
}

interface LogEntry {
  entryTitle: string;
  entryId: string;
  created: string[];
  updated: string[];
}

export function appendLog(wikiDir: string, logEntry: LogEntry): void {
  const logPath = path.join(wikiDir, '_log.md');
  const timestamp = new Date().toISOString();

  let content = '';
  if (fs.existsSync(logPath)) {
    content = fs.readFileSync(logPath, 'utf-8');
  } else {
    content = '# Absorption Log\n\n';
  }

  const lines: string[] = [];
  lines.push(`## ${timestamp} - Absorbed: ${logEntry.entryTitle}`);
  for (const p of logEntry.created) {
    lines.push(`- **Created**: [[${p}]]`);
  }
  for (const p of logEntry.updated) {
    lines.push(`- **Updated**: [[${p}]]`);
  }
  lines.push(`- Source entry: \`${logEntry.entryId}\``);
  lines.push('');

  content += lines.join('\n') + '\n';
  fs.writeFileSync(logPath, content, 'utf-8');
}
