/**
 * Wiki structural linter.
 * Detects broken links, orphan pages, oversized/empty articles,
 * missing frontmatter, and new-article candidates.
 */
import fs from 'fs';
import path from 'path';

export interface LintIssue {
  id: string;
  severity: 'critical' | 'warning' | 'suggestion';
  type: string;
  title: string;
  description: string;
  affectedFiles: string[];
}

interface ArticleInfo {
  relativePath: string;
  content: string;
  lines: string[];
  frontmatter: Record<string, string>;
  bodyLines: string[];
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
  const matches = content.match(/\[\[([^\]]+)\]\]/g);
  if (!matches) return [];
  return matches.map(m => m.slice(2, -2).trim());
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function scanArticles(wikiDir: string): ArticleInfo[] {
  const articles: ArticleInfo[] = [];

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
        const wikilinks = extractWikilinks(content);
        articles.push({ relativePath: relPath, content, lines, frontmatter: meta, bodyLines, wikilinks });
      }
    }
  }

  walk(wikiDir, '');
  return articles;
}

export async function runStructuralChecks(wikiDir: string): Promise<LintIssue[]> {
  const issues: LintIssue[] = [];
  const articles = scanArticles(wikiDir);

  // Build lookup: slug -> relativePath, and filename (without ext) -> relativePath
  const slugToPath = new Map<string, string>();
  const nameToPath = new Map<string, string>();
  for (const a of articles) {
    const fileName = path.basename(a.relativePath, '.md');
    slugToPath.set(slugify(fileName), a.relativePath);
    nameToPath.set(fileName.toLowerCase(), a.relativePath);
    // Also index by title from frontmatter
    if (a.frontmatter.title) {
      slugToPath.set(slugify(a.frontmatter.title), a.relativePath);
    }
  }

  // 1. Broken links & 6. New article candidates
  const missingTargets = new Map<string, string[]>(); // missing slug -> files referencing it
  for (const article of articles) {
    for (const link of article.wikilinks) {
      const slug = slugify(link);
      if (!slug) continue;
      const found = slugToPath.has(slug) || nameToPath.has(link.toLowerCase());
      if (!found) {
        const existing = missingTargets.get(link) || [];
        if (!existing.includes(article.relativePath)) existing.push(article.relativePath);
        missingTargets.set(link, existing);
      }
    }
  }

  // Broken links (critical)
  if (missingTargets.size > 0) {
    const affectedFiles: string[] = [];
    const descriptions: string[] = [];
    for (const [target, sources] of missingTargets) {
      for (const src of sources) {
        affectedFiles.push(src);
        descriptions.push(`${src} links to [[${target}]] which does not exist`);
      }
    }
    issues.push({
      id: 'broken-links',
      severity: 'critical',
      type: 'broken-link',
      title: `Broken Links (${descriptions.length})`,
      description: descriptions.join('\n'),
      affectedFiles: [...new Set(affectedFiles)],
    });
  }

  // 2. Orphan pages
  const inboundCounts = new Map<string, number>();
  for (const a of articles) inboundCounts.set(a.relativePath, 0);

  for (const article of articles) {
    const seen = new Set<string>();
    for (const link of article.wikilinks) {
      const slug = slugify(link);
      if (!slug) continue;
      const targetPath = slugToPath.get(slug) || (() => {
        const lower = link.toLowerCase();
        return nameToPath.get(lower);
      })();
      if (targetPath && targetPath !== article.relativePath && !seen.has(targetPath)) {
        seen.add(targetPath);
        inboundCounts.set(targetPath, (inboundCounts.get(targetPath) || 0) + 1);
      }
    }
  }

  const orphans = articles.filter(a => (inboundCounts.get(a.relativePath) || 0) === 0);
  if (orphans.length > 0) {
    issues.push({
      id: 'orphan-pages',
      severity: 'warning',
      type: 'orphan',
      title: `Orphan Pages (${orphans.length})`,
      description: orphans.map(a => `${a.relativePath} has 0 inbound links`).join('\n'),
      affectedFiles: orphans.map(a => a.relativePath),
    });
  }

  // 3. Oversized articles (>150 lines)
  const oversized = articles.filter(a => a.lines.length > 150);
  if (oversized.length > 0) {
    issues.push({
      id: 'oversized-articles',
      severity: 'warning',
      type: 'oversized',
      title: `Oversized Articles (${oversized.length})`,
      description: oversized.map(a => `${a.relativePath} has ${a.lines.length} lines (limit: 150)`).join('\n'),
      affectedFiles: oversized.map(a => a.relativePath),
    });
  }

  // 4. Missing frontmatter (title or type)
  const missingFm = articles.filter(a => !a.frontmatter.title || !a.frontmatter.type);
  if (missingFm.length > 0) {
    issues.push({
      id: 'missing-frontmatter',
      severity: 'warning',
      type: 'missing-frontmatter',
      title: `Missing Frontmatter (${missingFm.length})`,
      description: missingFm.map(a => {
        const missing: string[] = [];
        if (!a.frontmatter.title) missing.push('title');
        if (!a.frontmatter.type) missing.push('type');
        return `${a.relativePath} is missing: ${missing.join(', ')}`;
      }).join('\n'),
      affectedFiles: missingFm.map(a => a.relativePath),
    });
  }

  // 5. Empty articles (<15 lines of body content)
  const empty = articles.filter(a => a.bodyLines.length < 15);
  if (empty.length > 0) {
    issues.push({
      id: 'empty-articles',
      severity: 'warning',
      type: 'empty',
      title: `Empty Articles (${empty.length})`,
      description: empty.map(a => `${a.relativePath} has only ${a.bodyLines.length} lines of content`).join('\n'),
      affectedFiles: empty.map(a => a.relativePath),
    });
  }

  // 6. New article candidates (missing link targets mentioned in multiple articles)
  const candidates = [...missingTargets.entries()]
    .filter(([, sources]) => sources.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  if (candidates.length > 0) {
    issues.push({
      id: 'new-article-candidates',
      severity: 'suggestion',
      type: 'new-article',
      title: `New Article Candidates (${candidates.length})`,
      description: candidates.map(([name, sources]) =>
        `"${name}" is mentioned in ${sources.length} articles`
      ).join('\n'),
      affectedFiles: candidates.map(([name]) => name),
    });
  }

  return issues;
}
