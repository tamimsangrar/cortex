'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { CompileButton } from '@/components/CompileButton';
import { EntryReaderPanel, useEntryReader } from '@/components/EntryReader';
import { IMessageIcon } from '@/components/ConnectorIcons';

type SyncPhase = 'idle' | 'checking' | 'no-access' | 'ready' | 'syncing' | 'done';

interface Contact {
  id: string;
  name: string;
  messageCount: number;
}

interface SyncProgress {
  phase: string;
  current: number;
  total: number;
  currentChat?: string;
}

interface SyncResult {
  entriesCreated: number;
  messagesProcessed: number;
  conversationsFound: number;
}

interface EntryInfo {
  id: string;
  date: string;
  sourceType: string;
  title: string;
  path: string;
  contactName: string;
  messageCount: number;
}

export default function IMessagePage() {
  const [phase, setPhase] = useState<SyncPhase>('idle');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [messageCount, setMessageCount] = useState(0);
  const [platform, setPlatform] = useState<string | null>(null);
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
    ipc.getArticlesBySource('imessage').then((data: any) => setArticles(data || { articlesCreated: [], articlesUpdated: [] })).catch(() => {});
  }, []);

  useEffect(() => {
    if (!ipc) return;
    if (ipc.getPlatform) {
      ipc.getPlatform().then((p: string) => setPlatform(p)).catch(() => setPlatform('unknown'));
    }
  }, []);

  const isMac = platform === 'darwin';

  useEffect(() => {
    if (!ipc) return;
    setPhase('checking');
    ipc.checkIMessageAccess().then((res: any) => {
      if (res.hasAccess) {
        setMessageCount(res.messageCount || 0);
        setPhase('ready');
        ipc.getIMessageContacts().then((c: any) => {
          setContacts(c.contacts || []);
          setSelectedContacts((c.contacts || []).map((x: Contact) => x.id));
        });
      } else {
        setPhase('no-access');
      }
    }).catch(() => setPhase('no-access'));
  }, []);

  // Load entries
  const loadEntries = useCallback(async () => {
    if (!ipc) return;
    setEntriesLoading(true);
    try {
      const result = await ipc.listEntries({ sourceType: 'imessage' });
      const sorted = (result || []).sort((a: EntryInfo, b: EntryInfo) => b.date.localeCompare(a.date));
      setEntries(sorted);
      setEntriesLoaded(true);
    } catch {
      // silent
    }
    setEntriesLoading(false);
  }, [ipc]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // Load excludes
  useEffect(() => {
    if (!ipc) return;
    ipc.getExcludes().then((ex: string[]) => setExcludes(new Set(ex))).catch(() => {});
  }, []);

  // Save excludes when dirty
  useEffect(() => {
    if (!excludesDirty || !ipc) return;
    const timer = setTimeout(() => {
      ipc.setExcludes(Array.from(excludes));
      setExcludesDirty(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [excludes, excludesDirty, ipc]);

  // Listen for progress events
  useEffect(() => {
    if (!ipc) return;
    const unsub = ipc.onIMessageProgress((data: any) => {
      setProgress(data);
    });
    return () => { unsub(); };
  }, []);

  // Reload entries after sync
  useEffect(() => {
    if (phase === 'done') loadEntries();
  }, [phase, loadEntries]);

  const handleSync = useCallback(async () => {
    if (!ipc) return;
    setPhase('syncing');
    setProgress({ phase: 'reading', current: 0, total: 0 });
    try {
      const res = await ipc.syncIMessage({
        contacts: selectedContacts.length < contacts.length ? selectedContacts : undefined,
      });
      setResult(res);
      setPhase('done');
    } catch {
      setPhase('ready');
    }
  }, [ipc, selectedContacts, contacts]);

  const handleFullResync = useCallback(async () => {
    if (!ipc) return;
    setPhase('syncing');
    setProgress({ phase: 'reading', current: 0, total: 0 });
    try {
      const res = await ipc.syncIMessage({
        contacts: selectedContacts.length < contacts.length ? selectedContacts : undefined,
        fullResync: true,
      });
      setResult(res);
      setPhase('done');
    } catch {
      setPhase('ready');
    }
  }, [ipc, selectedContacts, contacts]);

  const toggleExclude = (id: string) => {
    setExcludes(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
    setExcludesDirty(true);
  };

  const selectAll = () => {
    const entryIds = entries.map(e => e.id);
    setExcludes(prev => {
      const next = new Set(prev);
      for (const id of entryIds) next.delete(id);
      return next;
    });
    setExcludesDirty(true);
  };

  const deselectAll = () => {
    const entryIds = entries.map(e => e.id);
    setExcludes(prev => {
      const next = new Set(prev);
      for (const id of entryIds) next.add(id);
      return next;
    });
    setExcludesDirty(true);
  };

  const handleDeleteEntry = useCallback(async (entryPath: string) => {
    if (!ipc) return;
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    try {
      await ipc.deleteEntries([entryPath]);
      setEntries(prev => prev.filter(e => e.path !== entryPath));
      closeEntry();
    } catch {
      // silent
    }
  }, [ipc, closeEntry]);

  const selectedCount = entries.filter(e => !excludes.has(e.id)).length;
  const canSync = phase === 'ready' || phase === 'done';

  return (
    <div className="page-transition" style={{ height: '100%', overflowY: 'auto', fontFamily: 'Inter, sans-serif' }}>
      <header style={{ height: 48, display: 'flex', alignItems: 'center', paddingLeft: 32, paddingRight: 32, gap: 16 }}>
        <Link href="/sources" style={{ color: '#88726c', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
          Sources
        </Link>
        <span style={{ color: '#dbc1b9' }}>/</span>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: '#1b1c1b', fontFamily: 'Newsreader, serif' }}>iMessage</h2>
      </header>


      <div style={{ padding: '0 32px 32px 32px', maxWidth: 960 }}>
        {/* Sync controls + status */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={canSync ? handleSync : undefined}
              disabled={!canSync}
              style={{
                padding: '8px 20px', background: canSync ? '#d97757' : '#e4e2e0',
                color: canSync ? '#ffffff' : '#88726c', borderRadius: 6,
                fontSize: 13, fontWeight: 600, border: 'none',
                cursor: canSync ? 'pointer' : 'default',
              }}
            >
              {phase === 'syncing' ? 'Syncing...' : 'Sync Now'}
            </button>
            <button
              onClick={canSync ? handleFullResync : undefined}
              disabled={!canSync}
              style={{
                padding: '8px 16px', background: '#e4e2e0',
                color: canSync ? '#99462a' : '#88726c', borderRadius: 6,
                fontSize: 12, fontWeight: 600,
                border: canSync ? '1px solid rgba(153,70,42,0.2)' : '1px solid transparent',
                cursor: canSync ? 'pointer' : 'default',
              }}
            >
              Full Resync
            </button>
            <CompileButton sourceType="imessage" />
          </div>
          <span style={{ fontSize: 13, color: '#55433d' }}>
            {entries.length > 0 ? `${entries.length} entries synced` : phase === 'checking' ? 'Checking access...' : phase === 'no-access' ? 'No access' : `${messageCount.toLocaleString()} messages available`}
          </span>
        </div>

        {/* How it works */}
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
            How it works
          </button>
          {showHelp && (
            <div style={{ marginTop: 12, padding: 16, background: '#f5f3f1', borderRadius: 10, fontSize: 13, color: '#55433d', lineHeight: 1.8, fontFamily: 'Inter, sans-serif' }}>
              <ol style={{ paddingLeft: 20, margin: 0 }}>
                <li>Cortex reads your local iMessage database directly from this Mac</li>
                <li>Your messages are stored by macOS at ~/Library/Messages/chat.db</li>
                <li>Full Disk Access permission is required (System Settings &gt; Privacy &gt; Full Disk Access)</li>
                <li>Messages are read in read-only mode. Nothing is modified.</li>
                <li>Click &quot;Sync Now&quot; to import all text messages, or &quot;Full Resync&quot; to re-import everything</li>
              </ol>
            </div>
          )}
        </div>

        {/* Sync Progress */}
        {phase === 'syncing' && progress && (
          <div style={{ background: '#f5f3f1', borderRadius: 12, padding: 24, marginBottom: 24, border: '1px solid rgba(219,193,185,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: '#1b1c1b' }}>Syncing messages...</span>
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#99462a' }}>
                {progress.current.toLocaleString()} {progress.total > 0 ? `of ${progress.total.toLocaleString()}` : ''}
              </span>
            </div>
            <div style={{ height: 6, width: '100%', background: '#e4e2e0', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: '#d97757', width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '10%', transition: 'width 0.5s' }} />
            </div>
            {progress.currentChat && (
              <p style={{ marginTop: 12, fontSize: 12, color: '#55433d', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 6, height: 6, background: '#99462a', borderRadius: '50%', display: 'inline-block' }} />
                {progress.currentChat}
              </p>
            )}
          </div>
        )}

        {/* Sync result */}
        {phase === 'done' && result && (
          <div style={{ background: '#ffffff', borderRadius: 12, padding: 20, marginBottom: 24, border: '1px solid rgba(153,70,42,0.1)', display: 'flex', alignItems: 'center', gap: 16 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#99462a', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            <span style={{ fontSize: 14, color: '#55433d' }}>
              Created {result.entriesCreated} entries from {result.conversationsFound} conversations ({result.messagesProcessed.toLocaleString()} messages)
            </span>
          </div>
        )}

        {/* No-access prompt */}
        {phase === 'no-access' && (
          <div style={{ background: '#ffffff', borderRadius: 12, padding: 32, marginBottom: 24, border: '1px solid rgba(219,193,185,0.1)' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1b1c1b', marginBottom: 8 }}>Full Disk Access Required</h3>
            <p style={{ color: '#55433d', marginBottom: 16, lineHeight: 1.6, fontSize: 14 }}>
              Open System Settings, Privacy & Security, Full Disk Access. Toggle Cortex to ON.
            </p>
            <button
              onClick={() => { if (ipc) ipc.checkIMessageAccess().then((r: any) => r.hasAccess ? (setPhase('ready'), setMessageCount(r.messageCount || 0)) : null); }}
              style={{ background: '#d97757', color: '#ffffff', padding: '8px 20px', borderRadius: 6, fontWeight: 600, fontSize: 13, border: 'none', cursor: 'pointer' }}
            >
              Check Again
            </button>
          </div>
        )}

        {/* Contact filter */}
        {(phase === 'ready') && contacts.length > 0 && (
          <div style={{ background: '#f5f3f1', borderRadius: 12, padding: 20, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#55433d' }}>
                Sync contacts ({selectedContacts.length} of {contacts.length})
              </span>
              <button
                onClick={() => setSelectedContacts(selectedContacts.length === contacts.length ? [] : contacts.map(c => c.id))}
                style={{ fontSize: 11, color: '#99462a', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {selectedContacts.length === contacts.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {contacts.slice(0, 50).map((c) => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: selectedContacts.includes(c.id) ? 'rgba(239,237,236,0.5)' : 'transparent' }}>
                  <input
                    type="checkbox"
                    checked={selectedContacts.includes(c.id)}
                    onChange={() => setSelectedContacts(prev => prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id])}
                    style={{ accentColor: '#99462a' }}
                  />
                  <span style={{ fontSize: 13, color: '#1b1c1b', flex: 1 }}>{c.name || c.id}</span>
                  <span style={{ fontSize: 11, color: '#88726c', fontFamily: 'monospace' }}>{c.messageCount}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Entry list with selection */}
        {entriesLoaded && entries.length > 0 && (
          <div style={{ background: '#f5f3f1', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <button onClick={selectAll} style={{ fontSize: 11, color: '#99462a', background: 'none', border: 'none', cursor: 'pointer' }}>Select All</button>
                <button onClick={deselectAll} style={{ fontSize: 11, color: '#99462a', background: 'none', border: 'none', cursor: 'pointer' }}>Deselect All</button>
                <span style={{ fontSize: 12, color: '#88726c' }}>{selectedCount} of {entries.length} selected</span>
              </div>
              <button
                onClick={loadEntries}
                disabled={entriesLoading}
                style={{ background: 'none', border: 'none', color: '#99462a', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 500, overflowY: 'auto' }}>
              {entries.slice(0, displayCount).map((entry) => {
                const included = !excludes.has(entry.id);
                const isOpen = selectedEntryPath === entry.path;
                return (
                  <div
                    key={entry.path}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '8px 10px', borderRadius: 6,
                      background: isOpen ? 'rgba(153,70,42,0.08)' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={() => toggleExclude(entry.id)}
                      style={{ accentColor: '#99462a', flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: '#1b1c1b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.contactName || entry.title}
                      </div>
                      <div style={{ fontSize: 11, color: '#88726c', marginTop: 2 }}>
                        {entry.date}{entry.messageCount > 0 ? ` -- ${entry.messageCount} msgs` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => openEntry(entry.path)}
                      style={{ background: 'none', border: 'none', color: '#99462a', cursor: 'pointer', fontSize: 12, padding: '4px 8px', flexShrink: 0 }}
                    >
                      View
                    </button>
                  </div>
                );
              })}
              {entries.length > displayCount && (
                <button
                  onClick={() => setDisplayCount(prev => prev + 50)}
                  style={{
                    marginTop: 8, padding: '8px 0', width: '100%',
                    background: '#ffffff', color: '#99462a', border: '1px solid rgba(219,193,185,0.1)',
                    borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Load more ({entries.length - displayCount} remaining)
                </button>
              )}
            </div>

            {/* Delete actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(219,193,185,0.1)' }}>
              <button
                onClick={async () => {
                  if (!ipc) return;
                  const selected = entries.filter(e => !excludes.has(e.id));
                  if (selected.length === 0) return;
                  if (!confirm(`Delete ${selected.length} selected entries?`)) return;
                  await ipc.deleteEntries(selected.map(e => e.path));
                  loadEntries();
                }}
                style={{
                  padding: '6px 14px', background: 'rgba(186,26,26,0.08)', color: '#ba1a1a',
                  border: '1px solid rgba(186,26,26,0.15)', borderRadius: 6,
                  fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Delete Selected
              </button>
              <button
                onClick={async () => {
                  if (!ipc) return;
                  const unselected = entries.filter(e => excludes.has(e.id));
                  if (unselected.length === 0) return;
                  if (!confirm(`Delete ${unselected.length} unselected entries?`)) return;
                  await ipc.deleteEntries(unselected.map(e => e.path));
                  loadEntries();
                }}
                style={{
                  padding: '6px 14px', background: 'rgba(186,26,26,0.08)', color: '#ba1a1a',
                  border: '1px solid rgba(186,26,26,0.15)', borderRadius: 6,
                  fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Delete Unselected
              </button>
            </div>
          </div>
        )}

        {entriesLoading && !entriesLoaded && (
          <div style={{ padding: '48px 0', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: '#55433d' }}>Loading entries...</p>
          </div>
        )}

        {entriesLoaded && entries.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 48, paddingBottom: 48, textAlign: 'center' }}>
            <div style={{ marginBottom: 16 }}><IMessageIcon size={48} /></div>
            <p style={{ fontSize: 14, color: '#55433d' }}>No iMessage entries yet. Sync to get started.</p>
          </div>
        )}

        {(articles.articlesCreated.length > 0 || articles.articlesUpdated.length > 0) && (
          <div style={{ background: '#f5f3f1', borderRadius: 12, padding: 20, marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#99462a' }}>auto_stories</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1b1c1b', fontFamily: 'Inter, sans-serif' }}>Wiki articles from this source</span>
              <span style={{ fontSize: 11, color: '#88726c', marginLeft: 4 }}>
                {articles.articlesCreated.length + articles.articlesUpdated.length} articles created from iMessage
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
        <EntryReaderPanel
          entryPath={selectedEntryPath}
          entryContent={selectedEntryContent}
          loading={entryLoading}
          entry={entries.find(e => e.path === selectedEntryPath)}
          onClose={closeEntry}
          onDelete={handleDeleteEntry}
        />
      )}
    </div>
  );
}
