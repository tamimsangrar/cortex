/**
 * Wiki breakdown analyzer.
 * Identifies entities mentioned across multiple articles that don't yet have
 * their own pages — candidates for new wiki articles.
 */
import fs from 'fs';
import path from 'path';

export interface BreakdownCandidate {
  name: string;
  suggestedDir: string;
  referenceCount: number;
  mentionedIn: string[];
  context: string[];
}

export interface BreakdownReport {
  totalArticles: number;
  candidateCount: number;
  candidates: BreakdownCandidate[];
}

interface ArticleData {
  relativePath: string;
  content: string;
  bodyContent: string;
  frontmatter: Record<string, string>;
  wikilinks: string[];
}

function parseFrontmatter(content: string): { meta: Record<string, string>; bodyStart: number } {
  const lines = content.split('\n');
  const meta: Record<string, string> = {};
  if (lines[0]?.trim() !== '---') return { meta, bodyStart: 0 };
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { endIdx = i; break; }
    const idx = lines[i].indexOf(':');
    if (idx > 0) {
      const key = lines[i].slice(0, idx).trim();
      const val = lines[i].slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (val && !val.startsWith('-') && !val.startsWith('[')) meta[key] = val;
    }
  }
  return { meta, bodyStart: endIdx >= 0 ? endIdx + 1 : 0 };
}

function extractWikilinks(content: string): string[] {
  const matches = content.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);
  if (!matches) return [];
  return matches.map(m => {
    const inner = m.slice(2, -2);
    const pipeIdx = inner.indexOf('|');
    return pipeIdx >= 0 ? inner.slice(0, pipeIdx).trim() : inner.trim();
  });
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function scanArticles(wikiDir: string): ArticleData[] {
  const articles: ArticleData[] = [];

  function walk(dir: string, relative: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.name.endsWith('.md')) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        const { meta, bodyStart } = parseFrontmatter(content);
        const bodyContent = lines.slice(bodyStart).join('\n');
        const wikilinks = extractWikilinks(content);
        articles.push({ relativePath: relPath, content, bodyContent, frontmatter: meta, wikilinks });
      }
    }
  }

  walk(wikiDir, '');
  return articles;
}

function extractSurroundingContext(text: string, name: string): string {
  const lower = text.toLowerCase();
  const nameLower = name.toLowerCase();
  const idx = lower.indexOf(nameLower);
  if (idx === -1) return '';
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + name.length + 60);
  let snippet = text.slice(start, end).replace(/\n/g, ' ').trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';
  return snippet;
}

// Classify a candidate into a directory based on context clues
function classifyCandidate(name: string, contexts: string[]): string {
  const combined = contexts.join(' ').toLowerCase();

  // People indicators
  if (/\b(?:he|she|they|him|her|his|their|said|told|met|friend|colleague|mentor|boss|partner)\b/.test(combined)) {
    return 'people';
  }
  // Place indicators
  if (/\b(?:city|town|neighborhood|building|street|moved to|lived in|visited|located)\b/.test(combined)) {
    return 'places';
  }
  // Project indicators
  if (/\b(?:built|launched|shipped|project|app|tool|platform|startup|codebase|repo)\b/.test(combined)) {
    return 'projects';
  }
  // Restaurant indicators
  if (/\b(?:restaurant|cafe|bar|coffee|diner|brunch|dinner|ate|food)\b/.test(combined)) {
    return 'restaurants';
  }
  // Event indicators
  if (/\b(?:happened|event|conference|meeting|ceremony|celebration|party)\b/.test(combined)) {
    return 'events';
  }
  // Era indicators
  if (/\b(?:period|era|phase|chapter|years|time)\b/.test(combined)) {
    return 'eras';
  }

  return 'people';
}

export function runBreakdown(wikiDir: string): BreakdownReport {
  const articles = scanArticles(wikiDir);

  // Build set of existing article identifiers
  const existingSlugs = new Set<string>();
  const existingTitles = new Set<string>();
  for (const a of articles) {
    const fileName = path.basename(a.relativePath, '.md');
    existingSlugs.add(slugify(fileName));
    if (a.frontmatter.title) {
      existingSlugs.add(slugify(a.frontmatter.title));
      existingTitles.add(a.frontmatter.title.toLowerCase());
    }
  }

  // 1. Find wikilinks that point to non-existent pages
  const missingLinks = new Map<string, { count: number; sources: string[]; contexts: string[] }>();

  for (const article of articles) {
    for (const link of article.wikilinks) {
      const slug = slugify(link);
      if (!slug) continue;
      if (existingSlugs.has(slug)) continue;

      const displayName = link.includes('/') ? link.split('/').pop()! : link;
      const key = slugify(displayName);
      if (!key) continue;

      const existing = missingLinks.get(key) || { count: 0, sources: [], contexts: [] };
      existing.count++;
      if (!existing.sources.includes(article.relativePath)) {
        existing.sources.push(article.relativePath);
      }
      const ctx = extractSurroundingContext(article.bodyContent, displayName);
      if (ctx) existing.contexts.push(ctx);
      missingLinks.set(key, existing);
    }
  }

  // 2. Scan body text for capitalized proper nouns that appear frequently but aren't linked
  const properNounPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  const properNouns = new Map<string, { count: number; sources: string[]; contexts: string[] }>();

  for (const article of articles) {
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = properNounPattern.exec(article.bodyContent)) !== null) {
      const name = match[1];
      const slug = slugify(name);
      if (!slug || slug.length < 3) continue;
      if (existingSlugs.has(slug)) continue;
      if (seen.has(slug)) continue;
      seen.add(slug);

      // Skip common non-entity phrases
      if (/^(?:New York|San Francisco|Los Angeles|United States|The [A-Z])/.test(name) && existingSlugs.has(slug)) continue;

      const existing = properNouns.get(slug) || { count: 0, sources: [], contexts: [] };
      existing.count++;
      if (!existing.sources.includes(article.relativePath)) {
        existing.sources.push(article.relativePath);
      }
      const ctx = extractSurroundingContext(article.bodyContent, name);
      if (ctx) existing.contexts.push(ctx);
      properNouns.set(slug, { ...existing, count: existing.count });
    }
  }

  // 3. Merge both sources, deduplicating by slug
  const allCandidates = new Map<string, { name: string; count: number; sources: string[]; contexts: string[] }>();

  for (const [slug, data] of missingLinks) {
    const existing = allCandidates.get(slug);
    if (existing) {
      existing.count += data.count;
      for (const s of data.sources) {
        if (!existing.sources.includes(s)) existing.sources.push(s);
      }
      existing.contexts.push(...data.contexts);
    } else {
      // Recover display name from the link text
      const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      allCandidates.set(slug, { name, count: data.count, sources: data.sources, contexts: data.contexts });
    }
  }

  for (const [slug, data] of properNouns) {
    if (data.sources.length < 2) continue; // Only include proper nouns mentioned in 2+ articles
    const existing = allCandidates.get(slug);
    if (existing) {
      existing.count += data.count;
      for (const s of data.sources) {
        if (!existing.sources.includes(s)) existing.sources.push(s);
      }
      existing.contexts.push(...data.contexts);
    } else {
      const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      allCandidates.set(slug, { name, count: data.count, sources: data.sources, contexts: data.contexts });
    }
  }

  // 4. Rank by reference count and build result
  const candidates: BreakdownCandidate[] = Array.from(allCandidates.values())
    .map(c => ({
      name: c.name,
      suggestedDir: classifyCandidate(c.name, c.contexts),
      referenceCount: c.sources.length,
      mentionedIn: c.sources,
      context: c.contexts.slice(0, 3),
    }))
    .sort((a, b) => b.referenceCount - a.referenceCount);

  return {
    totalArticles: articles.length,
    candidateCount: candidates.length,
    candidates,
  };
}
