'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface SearchResult {
  path: string;
  title: string;
  type: 'wiki' | 'raw';
  snippet: string;
  score: number;
}

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function SearchOverlay({ open, onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  // Focus input when overlay opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setActiveIndex(0);
      return;
    }
    try {
      const api = window.cortex;
      if (api?.searchQuery) {
        const res = await api.searchQuery(q);
        setResults(res);
        setActiveIndex(0);
      }
    } catch {
      // search unavailable
    }
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 150);
  };

  // Group results
  const wikiResults = results.filter((r) => r.type === 'wiki');
  const rawResults = results.filter((r) => r.type === 'raw');
  const allOrdered = [...wikiResults, ...rawResults];

  const navigateToResult = (result: SearchResult) => {
    onClose();
    if (result.type === 'wiki') {
      const articlePath = result.path.replace(/\.md$/, '');
      router.push(`/wiki?article=${encodeURIComponent(articlePath)}`);
    } else {
      router.push('/sources');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (allOrdered.length > 0) {
        setActiveIndex((prev) => (prev + 1) % allOrdered.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (allOrdered.length > 0) {
        setActiveIndex((prev) => (prev - 1 + allOrdered.length) % allOrdered.length);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (allOrdered[activeIndex]) {
        navigateToResult(allOrdered[activeIndex]);
      }
      return;
    }
  };

  // Scroll active result into view
  useEffect(() => {
    const el = document.getElementById(`search-result-${activeIndex}`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  let resultIndex = 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(85,67,61,0.3)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '15vh',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 600,
          maxHeight: 500,
          background: '#ffffff',
          borderRadius: 12,
          border: '1px solid rgba(219,193,185,0.15)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(85,67,61,0.12)',
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid rgba(219,193,185,0.15)',
            gap: 10,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ color: '#dbc1b9', fontSize: 20 }}
          >
            search
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="Search Cortex..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#1b1c1b',
              fontSize: 14,
              fontFamily: 'Inter, sans-serif',
            }}
          />
          <span
            style={{
              color: '#dbc1b9',
              fontSize: 10,
              padding: '2px 6px',
              border: '1px solid rgba(219,193,185,0.3)',
              borderRadius: 4,
            }}
          >
            ESC
          </span>
        </div>

        {/* Results area */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
          {query.trim() && results.length === 0 && (
            <div
              style={{
                padding: '24px 16px',
                textAlign: 'center',
                color: '#dbc1b9',
                fontSize: 13,
              }}
            >
              No results found
            </div>
          )}

          {wikiResults.length > 0 && (
            <div>
              <div
                style={{
                  padding: '8px 16px 4px',
                  color: '#55433d',
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                }}
              >
                Wiki Articles
              </div>
              {wikiResults.map((result) => {
                const idx = resultIndex++;
                return (
                  <ResultItem
                    key={`wiki-${result.path}`}
                    result={result}
                    index={idx}
                    isActive={idx === activeIndex}
                    onClick={() => navigateToResult(result)}
                    onMouseEnter={() => setActiveIndex(idx)}
                  />
                );
              })}
            </div>
          )}

          {rawResults.length > 0 && (
            <div>
              <div
                style={{
                  padding: '8px 16px 4px',
                  color: '#55433d',
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  marginTop: wikiResults.length > 0 ? 8 : 0,
                }}
              >
                Raw Entries
              </div>
              {rawResults.map((result) => {
                const idx = resultIndex++;
                return (
                  <ResultItem
                    key={`raw-${result.path}`}
                    result={result}
                    index={idx}
                    isActive={idx === activeIndex}
                    onClick={() => navigateToResult(result)}
                    onMouseEnter={() => setActiveIndex(idx)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div
            style={{
              padding: '8px 16px',
              borderTop: '1px solid rgba(219,193,185,0.15)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ color: '#dbc1b9', fontSize: 10 }}>
              {results.length} result{results.length !== 1 ? 's' : ''}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: '#dbc1b9', fontSize: 10 }}>
                Arrow keys to navigate
              </span>
              <span style={{ color: '#dbc1b9', fontSize: 10 }}>
                Enter to open
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function sanitizeSnippet(html: string): string {
  // Strip all HTML tags except <mark> and </mark>, then remove dangerous patterns
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<\/?(?!mark\b)[^>]+>/gi, '');
}

function ResultItem({
  result,
  index,
  isActive,
  onClick,
  onMouseEnter,
}: {
  result: SearchResult;
  index: number;
  isActive: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  const icon = result.type === 'wiki' ? 'article' : 'chat_bubble';

  return (
    <div
      id={`search-result-${index}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={{
        padding: '8px 16px',
        cursor: 'pointer',
        background: isActive ? '#efedec' : 'transparent',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
      }}
    >
      <span
        className="material-symbols-outlined"
        style={{
          fontSize: 16,
          color: isActive ? '#99462a' : '#dbc1b9',
          marginTop: 2,
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            color: '#1b1c1b',
            fontSize: 13,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {result.title}
        </div>
        <div
          style={{
            color: '#55433d',
            fontSize: 13,
            marginTop: 2,
            lineHeight: 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
          dangerouslySetInnerHTML={{
            __html: sanitizeSnippet(result.snippet).replace(
              /<mark>(.*?)<\/mark>/g,
              '<span style="color:#99462a;font-weight:700">$1</span>',
            ),
          }}
        />
      </div>
    </div>
  );
}
