/**
 * Wiki quality auditor (cleanup).
 * Scans all articles for structural issues: diary-driven headings, bloated
 * pages, stubs, banned words, quote density, broken links, and missing links.
 */
import fs from 'fs';
import path from 'path';

export interface CleanupIssue {
  article: string;
  type: 'diary-driven' | 'bloated' | 'stub' | 'banned-word' | 'quote-density' | 'broken-link' | 'missing-link' | 'incoherent';
  severity: 'critical' | 'warning' | 'suggestion';
  description: string;
  details?: string;
}

export interface CleanupReport {
  totalArticles: number;
  issueCount: number;
  issues: CleanupIssue[];
  summary: {
    diaryDriven: number;
    bloated: number;
    stubs: number;
    bannedWords: number;
    quoteDensity: number;
    brokenLinks: number;
    missingLinks: number;
  };
}

interface ArticleData {
  relativePath: string;
  content: string;
  lines: string[];
  bodyLines: string[];
  bodyContent: string;
  frontmatter: Record<string, string>;
  wikilinks: string[];
  headings: string[];
}

const BANNED_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\u2014/g, label: 'em dash' },
  { pattern: /\blegendary\b/gi, label: '"legendary"' },
  { pattern: /\bvisionary\b/gi, label: '"visionary"' },
  { pattern: /\bgroundbreaking\b/gi, label: '"groundbreaking"' },
  { pattern: /\bdeeply\b/gi, label: '"deeply"' },
  { pattern: /\btruly\b/gi, label: '"truly"' },
  { pattern: /\binterestingly\b/gi, label: '"interestingly"' },
  { pattern: /\bimportantly\b/gi, label: '"importantly"' },
  { pattern: /it should be noted/gi, label: '"it should be noted"' },
  { pattern: /\bwould go on to\b/gi, label: '"would go on to"' },
  { pattern: /\bembarked on\b/gi, label: '"embarked on"' },
  { pattern: /\bthis journey\b/gi, label: '"this journey"' },
  { pattern: /\bgenuine\b/gi, label: '"genuine"' },
  { pattern: /\bprofound\b/gi, label: '"profound"' },
];

const DATE_HEADING_PATTERN = /^##\s+(?:(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d|(?:the\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)|(?:20\d{2}[-/]?\d{0,2})|(?:q[1-4]\s+20\d{2})|(?:week\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)))/i;

const DIARY_HEADING_PATTERN = /^##\s+(?:the\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|early|mid|late|spring|summer|fall|winter|first|second)\s/i;

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

function countDirectQuotes(body: string): number {
  const quoteBlocks = body.match(/^>\s+.+$/gm) || [];
  const inlineQuotes = body.match(/"[^"]{10,}"/g) || [];
  return quoteBlocks.length + inlineQuotes.length;
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
        const bodyLines = lines.slice(bodyStart);
        const bodyContent = bodyLines.join('\n');
        const headings = bodyLines.filter(l => /^##\s+/.test(l));
        const wikilinks = extractWikilinks(content);
        articles.push({
          relativePath: relPath,
          content,
          lines,
          bodyLines,
          bodyContent,
          frontmatter: meta,
          wikilinks,
          headings,
        });
      }
    }
  }

  walk(wikiDir, '');
  return articles;
}

export function runCleanup(wikiDir: string): CleanupReport {
  const articles = scanArticles(wikiDir);
  const issues: CleanupIssue[] = [];
  const summary = {
    diaryDriven: 0,
    bloated: 0,
    stubs: 0,
    bannedWords: 0,
    quoteDensity: 0,
    brokenLinks: 0,
    missingLinks: 0,
  };

  // Build article lookup for link checking
  const articlePaths = new Set(articles.map(a => a.relativePath));
  const slugToPath = new Map<string, string>();
  const nameToPath = new Map<string, string>();
  for (const a of articles) {
    const fileName = path.basename(a.relativePath, '.md');
    slugToPath.set(slugify(fileName), a.relativePath);
    nameToPath.set(fileName.toLowerCase(), a.relativePath);
    if (a.frontmatter.title) {
      slugToPath.set(slugify(a.frontmatter.title), a.relativePath);
    }
  }

  // Build all-text index for missing link detection
  const articleTitles = articles.map(a => ({
    title: a.frontmatter.title || path.basename(a.relativePath, '.md'),
    path: a.relativePath,
  }));

  for (const article of articles) {
    // 1. Structure: diary-driven check
    const dateHeadingCount = article.headings.filter(h =>
      DATE_HEADING_PATTERN.test(h) || DIARY_HEADING_PATTERN.test(h)
    ).length;
    const totalHeadings = article.headings.length;
    if (totalHeadings >= 2 && dateHeadingCount / totalHeadings > 0.5) {
      issues.push({
        article: article.relativePath,
        type: 'diary-driven',
        severity: 'warning',
        description: `${dateHeadingCount} of ${totalHeadings} section headings appear date/time-based. Restructure around themes.`,
        details: article.headings.filter(h => DATE_HEADING_PATTERN.test(h) || DIARY_HEADING_PATTERN.test(h)).join(', '),
      });
      summary.diaryDriven++;
    }

    // 2. Line count checks
    const bodyLineCount = article.bodyLines.filter(l => l.trim()).length;
    if (bodyLineCount > 120) {
      issues.push({
        article: article.relativePath,
        type: 'bloated',
        severity: 'warning',
        description: `${bodyLineCount} non-empty body lines exceeds 120-line threshold. Consider splitting into sub-articles.`,
      });
      summary.bloated++;
    }
    if (bodyLineCount < 15) {
      issues.push({
        article: article.relativePath,
        type: 'stub',
        severity: 'warning',
        description: `Only ${bodyLineCount} non-empty body lines. Minimum is 15. Enrich or merge into a parent article.`,
      });
      summary.stubs++;
    }

    // 3. Banned words
    const foundBanned: string[] = [];
    for (const { pattern, label } of BANNED_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(article.bodyContent)) {
        foundBanned.push(label);
      }
    }
    // Check for rhetorical questions (sentences ending with ? that aren't in quotes)
    const nonQuoteLines = article.bodyLines.filter(l => !l.startsWith('>') && !l.startsWith('"'));
    const rhetoricalCount = nonQuoteLines.filter(l => /\?\s*$/.test(l.trim())).length;
    if (rhetoricalCount > 0) {
      foundBanned.push(`${rhetoricalCount} rhetorical question(s)`);
    }
    if (foundBanned.length > 0) {
      issues.push({
        article: article.relativePath,
        type: 'banned-word',
        severity: 'warning',
        description: `Tone issues: ${foundBanned.join(', ')}`,
      });
      summary.bannedWords++;
    }

    // 4. Quote density
    const quoteCount = countDirectQuotes(article.bodyContent);
    if (quoteCount > 2) {
      issues.push({
        article: article.relativePath,
        type: 'quote-density',
        severity: 'suggestion',
        description: `${quoteCount} direct quotes found. Maximum is 2 per article. Keep only the ones that hit hardest.`,
      });
      summary.quoteDensity++;
    }

    // 5. Broken wikilinks
    for (const link of article.wikilinks) {
      const slug = slugify(link);
      if (!slug) continue;
      let target = link;
      if (!target.endsWith('.md')) target += '.md';
      const found = articlePaths.has(target) ||
        articlePaths.has(link) ||
        slugToPath.has(slug) ||
        nameToPath.has(link.toLowerCase());
      if (!found) {
        issues.push({
          article: article.relativePath,
          type: 'broken-link',
          severity: 'critical',
          description: `Links to [[${link}]] which does not exist.`,
        });
        summary.brokenLinks++;
      }
    }

    // 6. Missing links to existing articles mentioned in text
    const bodyLower = article.bodyContent.toLowerCase();
    for (const other of articleTitles) {
      if (other.path === article.relativePath) continue;
      const titleLower = other.title.toLowerCase();
      if (titleLower.length < 3) continue;
      if (bodyLower.includes(titleLower)) {
        const alreadyLinked = article.wikilinks.some(l => {
          const linkSlug = slugify(l);
          const otherSlug = slugify(other.title);
          return linkSlug === otherSlug || l.toLowerCase().includes(path.basename(other.path, '.md'));
        });
        if (!alreadyLinked) {
          issues.push({
            article: article.relativePath,
            type: 'missing-link',
            severity: 'suggestion',
            description: `Mentions "${other.title}" but does not link to [[${other.path.replace('.md', '')}]].`,
          });
          summary.missingLinks++;
        }
      }
    }
  }

  return {
    totalArticles: articles.length,
    issueCount: issues.length,
    issues,
    summary,
  };
}
