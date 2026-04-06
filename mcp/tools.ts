/**
 * MCP tool implementations — search, read, and list wiki articles and source entries.
 * Pure functions with no Electron dependency; used by both stdio and HTTP MCP servers.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const DATA_DIR = process.env.CORTEX_DATA_DIR
  ? process.env.CORTEX_DATA_DIR.replace(/^~/, os.homedir())
  : path.join(os.homedir(), 'BrainDump');

const WIKI_DIR = path.join(DATA_DIR, 'wiki');
const ENTRIES_DIR = path.join(DATA_DIR, 'raw', 'entries');

// --- Frontmatter parsing ---

interface Frontmatter {
  [key: string]: string;
}

function parseFrontmatter(content: string): { data: Frontmatter; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { data: {}, body: content };

  const raw = match[1];
  const data: Frontmatter = {};
  for (const line of raw.split('\n')) {
    const kv = line.match(/^(\w[\w_]*)\s*:\s*(.+)$/);
    if (kv) {
      data[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
    }
  }
  const body = content.slice(match[0].length).trim();
  return { data, body };
}

// --- File scanning ---

function walkDir(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, ext));
    } else if (entry.name.endsWith(ext) && !entry.name.startsWith('_')) {
      results.push(full);
    }
  }
  return results;
}

// --- Tool implementations ---

export function searchWiki(query: string): string {
  const files = walkDir(WIKI_DIR, '.md');
  if (files.length === 0) return 'No wiki articles found.';

  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  if (terms.length === 0) return 'Empty search query.';

  const results: { path: string; title: string; score: number; snippet: string }[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const { data, body } = parseFrontmatter(content);
    const title = data.title || path.basename(file, '.md');
    const lowerTitle = title.toLowerCase();
    const lowerBody = body.toLowerCase();

    let score = 0;
    let bestIdx = -1;

    for (const term of terms) {
      const titleHits = countOccurrences(lowerTitle, term);
      const bodyHits = countOccurrences(lowerBody, term);
      score += titleHits * 3 + bodyHits;

      if (bestIdx === -1 && bodyHits > 0) {
        bestIdx = lowerBody.indexOf(term);
      }
    }

    if (score > 0) {
      const snippet = bestIdx >= 0
        ? extractSnippet(body, bestIdx)
        : body.slice(0, 150);
      const relPath = path.relative(WIKI_DIR, file);
      results.push({ path: relPath, title, score, snippet });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, 20);

  if (top.length === 0) return `No results for "${query}".`;

  return top
    .map(r => `[${r.path}] ${r.title} (score: ${r.score})\n${r.snippet}`)
    .join('\n\n---\n\n');
}

export function readArticle(articlePath: string): string {
  const full = path.join(WIKI_DIR, articlePath);
  if (!fs.existsSync(full)) return `Article not found: ${articlePath}`;
  return fs.readFileSync(full, 'utf-8');
}

export function listArticles(type?: string): string {
  const files = walkDir(WIKI_DIR, '.md');
  if (files.length === 0) return 'No wiki articles found.';

  const articles: { path: string; title: string; type: string; created: string }[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const { data } = parseFrontmatter(content);
    const relPath = path.relative(WIKI_DIR, file);
    const entry = {
      path: relPath,
      title: data.title || path.basename(file, '.md'),
      type: data.type || 'unknown',
      created: data.created || '',
    };
    if (type && entry.type !== type) continue;
    articles.push(entry);
  }

  if (articles.length === 0) {
    return type ? `No articles of type "${type}".` : 'No articles found.';
  }

  return articles
    .map(a => `${a.path} | ${a.title} | type: ${a.type} | created: ${a.created}`)
    .join('\n');
}

export function readIndex(): string {
  const indexPath = path.join(WIKI_DIR, '_index.md');
  if (!fs.existsSync(indexPath)) return 'Wiki index not found.';
  return fs.readFileSync(indexPath, 'utf-8');
}

export function listSources(sourceType?: string): string {
  const files = walkDir(ENTRIES_DIR, '.md');
  if (files.length === 0) return 'No source entries found.';

  // Include files starting with _ for entries (override walkDir skip)
  const allFiles = fs.existsSync(ENTRIES_DIR)
    ? walkDirAll(ENTRIES_DIR, '.md')
    : [];
  if (allFiles.length === 0) return 'No source entries found.';

  const entries: { id: string; date: string; sourceType: string; title: string; path: string }[] = [];

  for (const file of allFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const { data } = parseFrontmatter(content);
    const relPath = path.relative(ENTRIES_DIR, file);
    const entry = {
      id: data.id || path.basename(file, '.md'),
      date: data.date || '',
      sourceType: data.source_type || 'unknown',
      title: data.title || path.basename(file, '.md'),
      path: relPath,
    };
    if (sourceType && entry.sourceType !== sourceType) continue;
    entries.push(entry);
  }

  if (entries.length === 0) {
    return sourceType ? `No entries of type "${sourceType}".` : 'No entries found.';
  }

  return entries
    .map(e => `${e.path} | ${e.title} | source: ${e.sourceType} | date: ${e.date}`)
    .join('\n');
}

export function readSource(sourcePath: string): string {
  const full = path.join(ENTRIES_DIR, sourcePath);
  if (!fs.existsSync(full)) return `Source entry not found: ${sourcePath}`;
  return fs.readFileSync(full, 'utf-8');
}

export function searchSources(query: string): string {
  const files = fs.existsSync(ENTRIES_DIR)
    ? walkDirAll(ENTRIES_DIR, '.md')
    : [];
  if (files.length === 0) return 'No source entries found.';

  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  if (terms.length === 0) return 'Empty search query.';

  const results: { path: string; title: string; score: number; snippet: string }[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const { data, body } = parseFrontmatter(content);
    const title = data.title || path.basename(file, '.md');
    const lowerTitle = title.toLowerCase();
    const lowerBody = body.toLowerCase();

    let score = 0;
    let bestIdx = -1;

    for (const term of terms) {
      const titleHits = countOccurrences(lowerTitle, term);
      const bodyHits = countOccurrences(lowerBody, term);
      score += titleHits * 3 + bodyHits;

      if (bestIdx === -1 && bodyHits > 0) {
        bestIdx = lowerBody.indexOf(term);
      }
    }

    if (score > 0) {
      const snippet = bestIdx >= 0
        ? extractSnippet(body, bestIdx)
        : body.slice(0, 150);
      const relPath = path.relative(ENTRIES_DIR, file);
      results.push({ path: relPath, title, score, snippet });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, 20);

  if (top.length === 0) return `No results for "${query}".`;

  return top
    .map(r => `[${r.path}] ${r.title} (score: ${r.score})\n${r.snippet}`)
    .join('\n\n---\n\n');
}

export function getWikiStats(): string {
  const wikiFiles = walkDir(WIKI_DIR, '.md');
  const entryFiles = fs.existsSync(ENTRIES_DIR)
    ? walkDirAll(ENTRIES_DIR, '.md')
    : [];

  const categories: Record<string, number> = {};
  for (const file of wikiFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const { data } = parseFrontmatter(content);
    const t = data.type || 'unknown';
    categories[t] = (categories[t] || 0) + 1;
  }

  const topCategories = Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([cat, count]) => `${cat}: ${count}`)
    .join(', ');

  const logPath = path.join(WIKI_DIR, '_log.md');
  let lastCompiled = 'unknown';
  if (fs.existsSync(logPath)) {
    const stat = fs.statSync(logPath);
    lastCompiled = stat.mtime.toISOString().split('T')[0];
  }

  return [
    `Article count: ${wikiFiles.length}`,
    `Source count: ${entryFiles.length}`,
    `Last compiled: ${lastCompiled}`,
    `Top categories: ${topCategories || 'none'}`,
  ].join('\n');
}

// --- Helpers ---

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function extractSnippet(text: string, matchIdx: number): string {
  const start = Math.max(0, matchIdx - 50);
  const end = Math.min(text.length, matchIdx + 100);
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}

/** Like walkDir but does not skip underscore-prefixed files (used for raw entries). */
function walkDirAll(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDirAll(full, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}
