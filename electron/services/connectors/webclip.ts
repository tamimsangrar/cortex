/**
 * Web clipper connector.
 * Fetches a URL, extracts readable content with Readability, converts to
 * markdown, downloads images locally, and saves as a raw entry.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getCortexDataDir } from '../../main';

const { parseHTML } = require('linkedom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');

// ── Types ──────────────────────────────────────────────────────────────────

export interface ClipProgress {
  phase: 'fetching' | 'extracting' | 'downloading-images' | 'saving' | 'done';
  detail?: string;
}

export interface ClipResult {
  title: string;
  wordCount: number;
  entryPath: string;
}

export interface ClipRecord {
  title: string;
  sourceUrl: string;
  date: string;
  wordCount: number;
  entryPath: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeHash(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex').slice(0, 8);
}

function getAssetsDir(): string {
  const dir = path.join(getCortexDataDir(), 'data', 'web-clips', 'assets');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getClipsDir(): string {
  const dir = path.join(getCortexDataDir(), 'data', 'web-clips');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getEntriesDir(): string {
  const dir = path.join(getCortexDataDir(), 'raw', 'entries');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function toDateString(d: Date): string {
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function extensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return ext;
  } catch {}
  return 'png';
}

function extensionFromContentType(contentType: string | null): string {
  if (!contentType) return 'png';
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
  };
  for (const [mime, ext] of Object.entries(map)) {
    if (contentType.includes(mime)) return ext;
  }
  return 'png';
}

async function downloadImage(
  imgUrl: string,
  assetsDir: string,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const resp = await fetch(imgUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Cortex/1.0 WebClipper' },
    });
    clearTimeout(timeout);

    if (!resp.ok) return null;

    const buffer = Buffer.from(await resp.arrayBuffer());
    // Skip tracking pixels (< 1KB)
    if (buffer.length < 1024) return null;

    const contentType = resp.headers.get('content-type');
    const ext = extensionFromContentType(contentType) || extensionFromUrl(imgUrl);
    const hash = crypto.createHash('md5').update(buffer).digest('hex').slice(0, 12);
    const filename = `${hash}.${ext}`;
    const filepath = path.join(assetsDir, filename);

    fs.writeFileSync(filepath, buffer);
    return filename;
  } catch {
    return null;
  }
}

// ── Core Functions ─────────────────────────────────────────────────────────

export async function clipUrl(
  url: string,
  onProgress?: (progress: ClipProgress) => void,
): Promise<ClipResult> {
  // 1. Fetch
  onProgress?.({ phase: 'fetching', detail: url });

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch URL: ${resp.status} ${resp.statusText}`);
  }

  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('application/pdf')) {
    throw new Error('PDF URLs are not supported. Please download the PDF manually.');
  }

  const html = await resp.text();

  // 2. Extract readable content
  onProgress?.({ phase: 'extracting' });

  const dom = parseHTML(html);
  const reader = new Readability(dom.document);
  const article = reader.parse();

  if (!article || !article.content) {
    throw new Error('Could not extract readable content from this page.');
  }

  const title = article.title || 'Untitled';
  const author = article.byline || '';
  const siteName = article.siteName || new URL(url).hostname;

  // 3. Convert to markdown
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  let markdown = turndown.turndown(article.content);

  // 4. Download images
  onProgress?.({ phase: 'downloading-images' });

  const assetsDir = getAssetsDir();
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const matches = [...markdown.matchAll(imgRegex)];

  for (const match of matches) {
    const [fullMatch, alt, imgUrl] = match;
    // Resolve relative URLs
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(imgUrl, url).href;
    } catch {
      continue;
    }

    const localFilename = await downloadImage(absoluteUrl, assetsDir);
    if (localFilename) {
      const localPath = `../data/web-clips/assets/${localFilename}`;
      markdown = markdown.replace(fullMatch, `![${alt}](${localPath})`);
    }
    // If download failed, keep the original URL
  }

  // 5. Save
  onProgress?.({ phase: 'saving' });

  const now = new Date();
  const dateStr = toDateString(now);
  const urlHash = makeHash(url);
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;

  // Save original HTML
  const htmlPath = path.join(getClipsDir(), `${urlHash}.html`);
  fs.writeFileSync(htmlPath, html, 'utf-8');

  // Save entry
  const entryFilename = `${dateStr}_clip_${urlHash}.md`;
  const entryPath = path.join(getEntriesDir(), entryFilename);

  const frontmatter = [
    '---',
    `id: clip_${dateStr}_${urlHash}`,
    `date: ${dateStr}`,
    'source_type: web-clip',
    `source_url: "${url}"`,
    `title: "${title.replace(/"/g, '\\"')}"`,
    `author: "${author.replace(/"/g, '\\"')}"`,
    `site_name: "${siteName.replace(/"/g, '\\"')}"`,
    `word_count: ${wordCount}`,
    `clipped_at: "${now.toISOString()}"`,
    '---',
  ].join('\n');

  const content = `${frontmatter}\n\n# ${title}\n\n${markdown}\n`;
  fs.writeFileSync(entryPath, content, 'utf-8');

  onProgress?.({ phase: 'done' });

  return { title, wordCount, entryPath: `raw/entries/${entryFilename}` };
}

export function listClips(): ClipRecord[] {
  const entriesDir = path.join(getCortexDataDir(), 'raw', 'entries');
  if (!fs.existsSync(entriesDir)) return [];

  const files = fs.readdirSync(entriesDir).filter(f => f.includes('_clip_') && f.endsWith('.md'));
  const records: ClipRecord[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(entriesDir, file), 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      const fm = fmMatch[1];
      const title = fm.match(/title:\s*"(.*)"/)?.[1] || 'Untitled';
      const sourceUrl = fm.match(/source_url:\s*"(.*)"/)?.[1] || '';
      const date = fm.match(/date:\s*([\d-]+)/)?.[1] || '';
      const wordCount = parseInt(fm.match(/word_count:\s*(\d+)/)?.[1] || '0', 10);

      records.push({
        title,
        sourceUrl,
        date,
        wordCount,
        entryPath: `raw/entries/${file}`,
      });
    } catch {}
  }

  return records.sort((a, b) => b.date.localeCompare(a.date));
}
