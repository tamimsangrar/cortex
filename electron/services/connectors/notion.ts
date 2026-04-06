/**
 * Notion connector.
 * Imports Notion exports (.zip, .md, .csv) into raw entries.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getCortexDataDir } from '../../main';

const AdmZip = require('adm-zip');

// ── Types ──────────────────────────────────────────────────────────────────

export interface ImportProgress {
  phase: 'reading' | 'parsing' | 'writing' | 'done';
  current?: number;
  total?: number;
  detail?: string;
}

export interface ImportResult {
  entriesCreated: number;
  filesProcessed: number;
  sourceFile: string;
}

export interface ImportRecord {
  title: string;
  date: string;
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

function getExportDir(): string {
  const dir = path.join(getCortexDataDir(), 'data', 'notion-export');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extractTitle(content: string, filename: string): string {
  // Try first heading
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  // Notion filenames often have a hash suffix: "Page Name abc123def456.md"
  const cleanName = path.basename(filename, path.extname(filename));
  // Strip trailing hex hash (Notion appends 32-char IDs)
  const stripped = cleanName.replace(/\s+[a-f0-9]{32}$/, '');
  return stripped || cleanName;
}

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

// ── Core Functions ─────────────────────────────────────────────────────────

export async function importExport(
  filePath: string,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  onProgress?.({ phase: 'reading' });

  const ext = path.extname(filePath).toLowerCase();
  const contentFiles: { name: string; content: string; type: 'md' | 'csv' }[] = [];

  if (ext === '.zip') {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const entryName = entry.entryName;
      const entryExt = path.extname(entryName).toLowerCase();

      if (entryExt === '.md') {
        contentFiles.push({
          name: entryName,
          content: zip.readAsText(entry),
          type: 'md',
        });
      } else if (entryExt === '.csv') {
        contentFiles.push({
          name: entryName,
          content: zip.readAsText(entry),
          type: 'csv',
        });
      }
    }
  } else if (ext === '.md') {
    contentFiles.push({
      name: path.basename(filePath),
      content: fs.readFileSync(filePath, 'utf-8'),
      type: 'md',
    });
  } else if (ext === '.csv') {
    contentFiles.push({
      name: path.basename(filePath),
      content: fs.readFileSync(filePath, 'utf-8'),
      type: 'csv',
    });
  } else {
    throw new Error('Unsupported file type. Please provide a .zip, .md, or .csv file.');
  }

  if (contentFiles.length === 0) {
    throw new Error('No .md or .csv files found in the archive.');
  }

  onProgress?.({ phase: 'parsing', total: contentFiles.length });

  const entriesDir = getEntriesDir();
  const now = new Date();
  const dateStr = toDateString(now);
  let entriesCreated = 0;

  onProgress?.({ phase: 'writing', total: contentFiles.length });

  for (let i = 0; i < contentFiles.length; i++) {
    const file = contentFiles[i];

    onProgress?.({ phase: 'writing', current: i + 1, total: contentFiles.length, detail: file.name });

    if (file.type === 'md') {
      const title = extractTitle(file.content, file.name);
      const hash = makeHash(file.name + dateStr);

      // Strip frontmatter if present and use body
      const fmMatch = file.content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
      const body = fmMatch ? fmMatch[1].trim() : file.content.trim();
      const wordCount = body.split(/\s+/).filter(Boolean).length;

      const filename = `${dateStr}_notion_${hash}.md`;
      const filepath = path.join(entriesDir, filename);

      const frontmatter = [
        '---',
        `id: notion_${dateStr}_${hash}`,
        `date: ${dateStr}`,
        'source_type: notion',
        `title: "${title.replace(/"/g, '\\"')}"`,
        `original_file: "${file.name.replace(/"/g, '\\"')}"`,
        `word_count: ${wordCount}`,
        `imported_at: "${now.toISOString()}"`,
        '---',
      ].join('\n');

      const content = `${frontmatter}\n\n# ${title}\n\n${body}\n`;
      fs.writeFileSync(filepath, content, 'utf-8');
      entriesCreated++;
    } else if (file.type === 'csv') {
      // Parse CSV: first row is headers, each subsequent row becomes an entry
      const lines = file.content.split('\n').filter(l => l.trim());
      if (lines.length < 2) continue;

      const headers = parseCsvRow(lines[0]);

      for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
        const values = parseCsvRow(lines[rowIdx]);
        if (values.length === 0 || values.every(v => !v)) continue;

        // Use first column as title
        const title = values[0] || `Row ${rowIdx}`;
        const hash = makeHash(file.name + title + rowIdx);

        // Format row as readable content
        const bodyLines: string[] = [];
        for (let col = 0; col < headers.length; col++) {
          if (values[col]) {
            bodyLines.push(`**${headers[col]}**: ${values[col]}`);
          }
        }
        const body = bodyLines.join('\n\n');
        const wordCount = body.split(/\s+/).filter(Boolean).length;

        const filename = `${dateStr}_notion_${hash}.md`;
        const filepath = path.join(entriesDir, filename);

        const frontmatter = [
          '---',
          `id: notion_${dateStr}_${hash}`,
          `date: ${dateStr}`,
          'source_type: notion',
          `title: "${title.replace(/"/g, '\\"')}"`,
          `original_file: "${file.name.replace(/"/g, '\\"')}"`,
          `word_count: ${wordCount}`,
          `imported_at: "${now.toISOString()}"`,
          '---',
        ].join('\n');

        const content = `${frontmatter}\n\n# ${title}\n\n${body}\n`;
        fs.writeFileSync(filepath, content, 'utf-8');
        entriesCreated++;
      }
    }
  }

  // Copy original file to data/notion-export/
  const originalName = path.basename(filePath);
  const exportCopy = path.join(getExportDir(), `${makeHash(filePath)}_${originalName}`);
  fs.copyFileSync(filePath, exportCopy);

  onProgress?.({ phase: 'done' });

  return {
    entriesCreated,
    filesProcessed: contentFiles.length,
    sourceFile: path.basename(filePath),
  };
}

export function listImports(): ImportRecord[] {
  const entriesDir = path.join(getCortexDataDir(), 'raw', 'entries');
  if (!fs.existsSync(entriesDir)) return [];

  const files = fs.readdirSync(entriesDir).filter(f => f.includes('_notion_') && f.endsWith('.md'));
  const records: ImportRecord[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(entriesDir, file), 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      const fm = fmMatch[1];
      const title = fm.match(/title:\s*"(.*)"/)?.[1] || 'Untitled';
      const date = fm.match(/date:\s*([\d-]+)/)?.[1] || '';
      const wordCount = parseInt(fm.match(/word_count:\s*(\d+)/)?.[1] || '0', 10);

      records.push({
        title,
        date,
        wordCount,
        entryPath: `raw/entries/${file}`,
      });
    } catch {}
  }

  return records.sort((a, b) => b.date.localeCompare(a.date));
}
