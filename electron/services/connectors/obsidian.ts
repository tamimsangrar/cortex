/**
 * Obsidian vault importer.
 * Scans an Obsidian vault folder for .md files and converts them to raw entries.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getCortexDataDir } from '../../main';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ImportProgress {
  phase: 'scanning' | 'importing' | 'done';
  current?: number;
  total?: number;
  detail?: string;
}

export interface ImportResult {
  entriesCreated: number;
  filesFound: number;
  vaultPath: string;
}

export interface ImportRecord {
  title: string;
  date: string;
  originalPath: string;
  wordCount: number;
  entryPath: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeHash(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex').slice(0, 8);
}

function toDateString(d: Date): string {
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getEntriesDir(): string {
  const dir = path.join(getCortexDataDir(), 'raw', 'entries');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getImportDir(): string {
  const dir = path.join(getCortexDataDir(), 'data', 'obsidian-import');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function scanMarkdownFiles(dir: string, relativeTo: string): { fullPath: string; relativePath: string }[] {
  const results: { fullPath: string; relativePath: string }[] = [];

  function walk(currentDir: string) {
    const items = fs.readdirSync(currentDir);
    for (const item of items) {
      if (item.startsWith('.')) continue;
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (item.endsWith('.md')) {
        results.push({
          fullPath,
          relativePath: path.relative(relativeTo, fullPath),
        });
      }
    }
  }

  walk(dir);
  return results;
}

function convertWikilinks(content: string): string {
  // Convert [[link|display]] to display
  // Convert [[link]] to link
  return content.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const parts = inner.split('|');
    return parts.length > 1 ? parts[1].trim() : parts[0].trim();
  });
}

function extractTitle(content: string, filename: string): string {
  // Try first heading
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  // Fall back to filename without extension
  return path.basename(filename, '.md');
}

function extractFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (match) {
    return { frontmatter: match[1], body: match[2] };
  }
  return { frontmatter: null, body: content };
}

// ── Core Functions ─────────────────────────────────────────────────────────

export async function importVault(
  vaultPath: string,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  if (!fs.existsSync(vaultPath)) {
    throw new Error(`Vault path does not exist: ${vaultPath}`);
  }

  onProgress?.({ phase: 'scanning' });

  const mdFiles = scanMarkdownFiles(vaultPath, vaultPath);

  if (mdFiles.length === 0) {
    throw new Error('No .md files found in the selected folder.');
  }

  onProgress?.({ phase: 'scanning', current: mdFiles.length, total: mdFiles.length });

  const entriesDir = getEntriesDir();
  let entriesCreated = 0;

  onProgress?.({ phase: 'importing', total: mdFiles.length });

  for (let i = 0; i < mdFiles.length; i++) {
    const file = mdFiles[i];

    onProgress?.({ phase: 'importing', current: i + 1, total: mdFiles.length, detail: file.relativePath });

    try {
      const rawContent = fs.readFileSync(file.fullPath, 'utf-8');
      const stat = fs.statSync(file.fullPath);
      const modDate = toDateString(stat.mtime);

      const { frontmatter: originalFm, body: originalBody } = extractFrontmatter(rawContent);
      const title = extractTitle(rawContent, file.relativePath);
      const bodyText = convertWikilinks(originalBody);
      const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
      const hash = makeHash(file.relativePath);

      const filename = `${modDate}_obsidian_${hash}.md`;
      const filepath = path.join(entriesDir, filename);

      const fmLines = [
        '---',
        `id: obsidian_${modDate}_${hash}`,
        `date: ${modDate}`,
        'source_type: obsidian',
        `title: "${title.replace(/"/g, '\\"')}"`,
        `original_path: "${file.relativePath.replace(/"/g, '\\"')}"`,
        `vault_path: "${vaultPath.replace(/"/g, '\\"')}"`,
        `word_count: ${wordCount}`,
      ];

      // Preserve original frontmatter fields
      if (originalFm) {
        fmLines.push(`original_frontmatter: true`);
      }

      fmLines.push('---');

      const content = `${fmLines.join('\n')}\n\n# ${title}\n\n${bodyText}\n`;
      fs.writeFileSync(filepath, content, 'utf-8');
      entriesCreated++;
    } catch (err) {
      console.error(`[Obsidian] Failed to import ${file.relativePath}:`, err);
    }
  }

  // Record the import metadata
  const importMeta = {
    vaultPath,
    importedAt: new Date().toISOString(),
    filesFound: mdFiles.length,
    entriesCreated,
  };
  const metaPath = path.join(getImportDir(), `import_${makeHash(vaultPath)}.json`);
  fs.writeFileSync(metaPath, JSON.stringify(importMeta, null, 2));

  onProgress?.({ phase: 'done' });

  return {
    entriesCreated,
    filesFound: mdFiles.length,
    vaultPath,
  };
}

export function listImports(): ImportRecord[] {
  const entriesDir = path.join(getCortexDataDir(), 'raw', 'entries');
  if (!fs.existsSync(entriesDir)) return [];

  const files = fs.readdirSync(entriesDir).filter(f => f.includes('_obsidian_') && f.endsWith('.md'));
  const records: ImportRecord[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(entriesDir, file), 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      const fm = fmMatch[1];
      const title = fm.match(/title:\s*"(.*)"/)?.[1] || 'Untitled';
      const date = fm.match(/date:\s*([\d-]+)/)?.[1] || '';
      const originalPath = fm.match(/original_path:\s*"(.*)"/)?.[1] || '';
      const wordCount = parseInt(fm.match(/word_count:\s*(\d+)/)?.[1] || '0', 10);

      records.push({
        title,
        date,
        originalPath,
        wordCount,
        entryPath: `raw/entries/${file}`,
      });
    } catch {}
  }

  return records.sort((a, b) => b.date.localeCompare(a.date));
}
