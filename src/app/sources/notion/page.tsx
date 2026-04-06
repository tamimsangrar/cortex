'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { CompileButton } from '@/components/CompileButton';
import { EntryReaderPanel, useEntryReader } from '@/components/EntryReader';
import { NotionIcon } from '@/components/ConnectorIcons';

interface EntryInfo {
  id: string;
  date: string;
  sourceType: string;
  title: string;
  path: string;
  contactName: string;
  messageCount: number;
}

export default function NotionPage() {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ entriesCreated: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const [entries, setEntries] = useState<EntryInfo[]>([]);
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [displayCount, setDisplayCount] = useState(50);

  const [excludes, setExcludes] = useState<Set<string>>(new Set());
  const [excludesDirty, setExcludesDirty] = useState(false);

  const { selectedEntryPath, selectedEntryContent, entryLoading, openEntry, closeEntry } = useEntryReader();

  const ipc = typeof window !== 'undefined' ? window.cortex : null;

  const [articles, setArticles] = useState<{ articlesCreated: string[]; articlesUpdated: string[] }>({ articlesCreated: [], articlesUpdated: [] });

  useEffect(() => {
    if (!ipc || !ipc.getArticlesBySource) return;
    ipc.getArticlesBySource('notion').then((data: any) => setArticles(data || { articlesCreated: [], articlesUpdated: [] })).catch(() => {});
  }, []);

  const loadEntries = useCallback(async () => {
    if (!ipc) return;
    setEntriesLoading(true);
    try {
      const result = await ipc.listEntries({ sourceType: 'notion' });
      const sorted = (result || []).sort((a: EntryInfo, b: EntryInfo) => b.date.localeCompare(a.date));
      setEntries(sorted);
      setEntriesLoaded(true);
    } catch { /* silent */ }
    setEntriesLoading(false);
  }, [ipc]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  useEffect(() => {
    if (!ipc) return;
    ipc.getExcludes().then((ex: string[]) => setExcludes(new Set(ex))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!excludesDirty || !ipc) return;
    const timer = setTimeout(() => { ipc.setExcludes(Array.from(excludes)); setExcludesDirty(false); }, 500);
    return () => clearTimeout(timer);
  }, [excludes, excludesDirty, ipc]);

  const handleImport = useCallback(async () => {
    if (!ipc || !ipc.importNotion) return;
    setImporting(true);
    setError(null);
    setImportResult(null);
    try {
      const res = await ipc.importNotion();
      if (res.cancelled) { setImporting(false); return; }
      setImportResult({ entriesCreated: res.entriesCreated });
      loadEntries();
    } catch (e: any) {
      setError(e.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  }, [ipc, loadEntries]);

  const toggleExclude = (id: string) => {
    setExcludes(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    setExcludesDirty(true);
  };
  const selectAll = () => { setExcludes(prev => { const n = new Set(prev); for (const e of entries) n.delete(e.id); return n; }); setExcludesDirty(true); };
  const deselectAll = () => { setExcludes(prev => { const n = new Set(prev); for (const e of entries) n.add(e.id); return n; }); setExcludesDirty(true); };

  const handleDeleteEntry = useCallback(async (entryPath: string) => {
    if (!ipc) return;
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    try { await ipc.deleteEntries([entryPath]); setEntries(prev => prev.filter(e => e.path !== entryPath)); closeEntry(); } catch { /* silent */ }
  }, [ipc, closeEntry]);

  const selectedCount = entries.filter(e => !excludes.has(e.id)).length;

  return (
    <div className="page-transition" style={{ height: '100%', overflowY: 'auto', fontFamily: 'Inter, sans-serif' }}>
      <header style={{ height: 48, display: 'flex', alignItems: 'center', paddingLeft: 32, paddingRight: 32, gap: 16 }}>
          <Link href="/sources" style={{ color: '#88726c', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
          Sources
        </Link>
        <span style={{ color: '#dbc1b9' }}>/</span>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: '#1b1c1b', fontFamily: 'Newsreader, serif' }}>Notion</h2>
      </header>


      <div style={{ padding: '0 32px 32px 32px', maxWidth: 960 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleImport}
              disabled={importing}
              style={{
                padding: '8px 20px', background: importing ? '#e4e2e0' : '#d97757',
                color: importing ? '#88726c' : '#ffffff', borderRadius: 6,
                fontSize: 13, fontWeight: 600, border: 'none',
                cursor: importing ? 'default' : 'pointer',
              }}
            >
              {importing ? 'Importing...' : 'Import Notion Export'}
            </button>
            <CompileButton sourceType="notion" />
          </div>
          <span style={{ fontSize: 13, color: '#55433d' }}>
            {entries.length > 0 ? `${entries.length} entries` : 'No entries yet'}
          </span>
        </div>

        {/* How to export */}
        <div style={{ marginBottom: 24 }}>
          <button
            onClick={() => setShowHelp(!showHelp)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#88726c', fontSize: 13, fontFamily: 'Inter, sans-serif',
              padding: 0,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16, transition: 'transform 0.2s', transform: showHelp ? 'rotate(90deg)' : 'none' }}>chevron_right</span>
            How to export from Notion
          </button>
          {showHelp && (
            <div style={{ marginTop: 12, padding: 16, background: '#f5f3f1', borderRadius: 10, fontSize: 13, color: '#55433d', lineHeight: 1.8, fontFamily: 'Inter, sans-serif' }}>
              <ol style={{ paddingLeft: 20, margin: 0 }}>
                <li>Open Notion in your browser</li>
                <li>Go to Settings &gt; Workspace &gt; Export all workspace content</li>
                <li>Choose &quot;Markdown &amp; CSV&quot; as the export format</li>
                <li>Click &quot;Export&quot; and wait for the download</li>
                <li>Click &quot;Import Notion Export&quot; above and select the downloaded .zip file</li>
              </ol>
            </div>
          )}
        </div>

        {error && (
          <div style={{ background: 'rgba(186,26,26,0.15)', borderRadius: 8, padding: 12, marginBottom: 16, border: '1px solid rgba(186,26,26,0.2)' }}>
            <p style={{ fontSize: 13, color: '#ba1a1a', margin: 0 }}>{error}</p>
          </div>
        )}

        {importResult && (
          <div style={{ background: '#ffffff', borderRadius: 12, padding: 20, marginBottom: 24, border: '1px solid rgba(153,70,42,0.1)', display: 'flex', alignItems: 'center', gap: 16 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#99462a', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            <span style={{ fontSize: 14, color: '#55433d' }}>{importResult.entriesCreated} entries created</span>
          </div>
        )}

        {/* Entry list */}
        {entriesLoaded && entries.length > 0 && (
          <div style={{ background: '#f5f3f1', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <button onClick={selectAll} style={{ fontSize: 11, color: '#99462a', background: 'none', border: 'none', cursor: 'pointer' }}>Select All</button>
                <button onClick={deselectAll} style={{ fontSize: 11, color: '#99462a', background: 'none', border: 'none', cursor: 'pointer' }}>Deselect All</button>
                <span style={{ fontSize: 12, color: '#88726c' }}>{selectedCount} of {entries.length} selected</span>
              </div>
              <button onClick={loadEntries} disabled={entriesLoading} style={{ background: 'none', border: 'none', color: '#99462a', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 500, overflowY: 'auto' }}>
              {entries.slice(0, displayCount).map((entry) => {
                const included = !excludes.has(entry.id);
                const isOpen = selectedEntryPath === entry.path;
                return (
                  <div key={entry.path} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 6, background: isOpen ? 'rgba(153,70,42,0.08)' : 'transparent' }}>
                    <input type="checkbox" checked={included} onChange={() => toggleExclude(entry.id)} style={{ accentColor: '#99462a', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: '#1b1c1b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.contactName || entry.title}</div>
                      <div style={{ fontSize: 11, color: '#88726c', marginTop: 2 }}>{entry.date}</div>
                    </div>
                    <button onClick={() => openEntry(entry.path)} style={{ background: 'none', border: 'none', color: '#99462a', cursor: 'pointer', fontSize: 12, padding: '4px 8px', flexShrink: 0 }}>View</button>
                  </div>
                );
              })}
              {entries.length > displayCount && (
                <button onClick={() => setDisplayCount(prev => prev + 50)} style={{ marginTop: 8, padding: '8px 0', width: '100%', background: '#ffffff', color: '#99462a', border: '1px solid rgba(219,193,185,0.1)', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Load more ({entries.length - displayCount} remaining)
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(219,193,185,0.1)' }}>
              <button
                onClick={async () => { if (!ipc) return; const sel = entries.filter(e => !excludes.has(e.id)); if (sel.length === 0) return; if (!confirm(`Delete ${sel.length} selected entries?`)) return; await ipc.deleteEntries(sel.map(e => e.path)); loadEntries(); }}
                style={{ padding: '6px 14px', background: 'rgba(186,26,26,0.08)', color: '#ba1a1a', border: '1px solid rgba(186,26,26,0.15)', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
              >Delete Selected</button>
              <button
                onClick={async () => { if (!ipc) return; const unsel = entries.filter(e => excludes.has(e.id)); if (unsel.length === 0) return; if (!confirm(`Delete ${unsel.length} unselected entries?`)) return; await ipc.deleteEntries(unsel.map(e => e.path)); loadEntries(); }}
                style={{ padding: '6px 14px', background: 'rgba(186,26,26,0.08)', color: '#ba1a1a', border: '1px solid rgba(186,26,26,0.15)', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
              >Delete Unselected</button>
            </div>
          </div>
        )}

        {entriesLoading && !entriesLoaded && (
          <div style={{ padding: '48px 0', textAlign: 'center' }}><p style={{ fontSize: 14, color: '#55433d' }}>Loading entries...</p></div>
        )}
        {entriesLoaded && entries.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 48, paddingBottom: 48, textAlign: 'center' }}>
            <div style={{ marginBottom: 16 }}><NotionIcon size={48} /></div>
            <p style={{ fontSize: 14, color: '#55433d' }}>No Notion entries yet. Import a Notion export to get started.</p>
          </div>
        )}

        {(articles.articlesCreated.length > 0 || articles.articlesUpdated.length > 0) && (
          <div style={{ background: '#f5f3f1', borderRadius: 12, padding: 20, marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#99462a' }}>auto_stories</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1b1c1b', fontFamily: 'Inter, sans-serif' }}>Wiki articles from this source</span>
              <span style={{ fontSize: 11, color: '#88726c', marginLeft: 4 }}>
                {articles.articlesCreated.length + articles.articlesUpdated.length} articles created from Notion
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 300, overflowY: 'auto' }}>
              {articles.articlesCreated.map((a) => (
                <Link key={a} href="/wiki" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 6 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#99462a' }}>auto_stories</span>
                  <span style={{ fontSize: 13, color: '#1b1c1b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.replace(/\.md$/, '').replace(/\//g, ' / ')}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, background: 'rgba(153,70,42,0.1)', color: '#99462a', padding: '2px 6px', borderRadius: 3, letterSpacing: '0.05em' }}>created</span>
                </Link>
              ))}
              {articles.articlesUpdated.map((a) => (
                <Link key={a} href="/wiki" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 6 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#99462a' }}>auto_stories</span>
                  <span style={{ fontSize: 13, color: '#1b1c1b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.replace(/\.md$/, '').replace(/\//g, ' / ')}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, background: 'rgba(85,67,61,0.08)', color: '#55433d', padding: '2px 6px', borderRadius: 3, letterSpacing: '0.05em' }}>updated</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {selectedEntryPath && (
        <EntryReaderPanel entryPath={selectedEntryPath} entryContent={selectedEntryContent} loading={entryLoading} entry={entries.find(e => e.path === selectedEntryPath)} onClose={closeEntry} onDelete={handleDeleteEntry} />
      )}
    </div>
  );
}
