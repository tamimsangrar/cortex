/**
 * Full-text search engine for wiki articles and raw source entries.
 * Builds an in-memory inverted index and scores results by term frequency
 * with a 3× boost for title matches.
 */
import fs from 'fs';
import path from 'path';

export interface SearchResult {
  path: string;
  title: string;
  type: 'wiki' | 'raw';
  snippet: string;
  score: number;
}

interface IndexEntry {
  title: string;
  content: string;
  type: 'wiki' | 'raw';
  path: string;
}

export class SearchEngine {
  private index: Map<string, IndexEntry> = new Map();
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async buildIndex(): Promise<void> {
    this.index.clear();
    const wikiDir = path.join(this.baseDir, 'wiki');
    const rawDir = path.join(this.baseDir, 'raw', 'entries');

    if (fs.existsSync(wikiDir)) {
      this.scanDirectory(wikiDir, '', 'wiki');
    }
    if (fs.existsSync(rawDir)) {
      this.scanDirectory(rawDir, '', 'raw');
    }
  }

  private scanDirectory(dir: string, relative: string, type: 'wiki' | 'raw'): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = relative ? `${relative}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        this.scanDirectory(fullPath, relPath, type);
      } else if (entry.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const title = this.extractTitle(content, entry.name);
          this.index.set(`${type}:${relPath}`, { title, content, type, path: relPath });
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  private extractTitle(content: string, filename: string): string {
    // Try YAML frontmatter title
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const titleLine = fmMatch[1].match(/^title:\s*(.+)$/m);
      if (titleLine) return titleLine[1].replace(/^["']|["']$/g, '').trim();
    }
    // Try first heading
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) return headingMatch[1].trim();
    // Fall back to filename
    return filename.replace(/\.md$/, '');
  }

  search(query: string, limit = 20): SearchResult[] {
    if (!query.trim()) return [];

    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    const results: SearchResult[] = [];

    for (const entry of this.index.values()) {
      const titleLower = entry.title.toLowerCase();
      const contentLower = entry.content.toLowerCase();

      let score = 0;
      let bestMatchIndex = -1;
      let bestMatchTerm = '';

      for (const term of terms) {
        // Title matches (3x weight)
        let idx = 0;
        let titleCount = 0;
        while ((idx = titleLower.indexOf(term, idx)) !== -1) {
          titleCount++;
          idx += term.length;
        }
        score += titleCount * 3;

        // Content matches (1x weight)
        idx = 0;
        let contentCount = 0;
        while ((idx = contentLower.indexOf(term, idx)) !== -1) {
          if (contentCount === 0 && (bestMatchIndex === -1 || term.length > bestMatchTerm.length)) {
            bestMatchIndex = idx;
            bestMatchTerm = term;
          }
          contentCount++;
          idx += term.length;
        }
        score += contentCount;
      }

      if (score === 0) continue;

      const snippet = this.buildSnippet(entry.content, bestMatchIndex, bestMatchTerm, terms);
      results.push({
        path: entry.path,
        title: entry.title,
        type: entry.type,
        snippet,
        score,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  private buildSnippet(
    content: string,
    matchIndex: number,
    matchTerm: string,
    terms: string[],
  ): string {
    // Strip frontmatter for snippet generation
    let text = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
    // Collapse whitespace
    text = text.replace(/\s+/g, ' ').trim();

    if (matchIndex === -1 || !matchTerm) {
      // No content match found; take start of text
      const raw = text.slice(0, 120);
      return this.highlightTerms(raw, terms);
    }

    // Recalculate index in stripped text
    const textLower = text.toLowerCase();
    const idx = textLower.indexOf(matchTerm.toLowerCase());
    if (idx === -1) {
      const raw = text.slice(0, 120);
      return this.highlightTerms(raw, terms);
    }

    const start = Math.max(0, idx - 50);
    const end = Math.min(text.length, idx + matchTerm.length + 50);
    let snippet = text.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';

    return this.highlightTerms(snippet, terms);
  }

  private highlightTerms(text: string, terms: string[]): string {
    if (!terms.length) return text;
    // Escape regex special chars in terms, sort longest first
    const sorted = [...terms].sort((a, b) => b.length - a.length);
    const escaped = sorted.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }
}
