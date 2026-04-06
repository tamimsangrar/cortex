'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  IMessageIcon,
  WhatsAppIcon,
  WebClipIcon,
  AppleNotesIcon,
  ObsidianIcon,
  NotionIcon,
} from '@/components/ConnectorIcons';

interface SourceCard {
  id: string;
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
  href: string;
  macOnly?: boolean;
}

const sources: SourceCard[] = [
  { id: 'imessage', label: 'iMessage', Icon: IMessageIcon, href: '/sources/imessage', macOnly: true },
  { id: 'whatsapp', label: 'WhatsApp', Icon: WhatsAppIcon, href: '/sources/whatsapp' },
  { id: 'web-clip', label: 'Web Clips', Icon: WebClipIcon, href: '/sources/webclips' },
  { id: 'apple-notes', label: 'Apple Notes', Icon: AppleNotesIcon, href: '/sources/notes', macOnly: true },
  { id: 'obsidian', label: 'Obsidian', Icon: ObsidianIcon, href: '/sources/obsidian' },
  { id: 'notion', label: 'Notion', Icon: NotionIcon, href: '/sources/notion' },
];

export default function SourcesHubPage() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [excludes, setExcludes] = useState<string[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [loading, setLoading] = useState(true);

  const ipc = typeof window !== 'undefined' ? window.cortex : null;

  const loadData = useCallback(async () => {
    if (!ipc) { setLoading(false); return; }
    try {
      const [c, ex] = await Promise.all([
        ipc.getEntryCountBySource(),
        ipc.getExcludes(),
      ]);
      setCounts(c || {});
      setExcludes(ex || []);
      const total = Object.values(c || {}).reduce((a: number, b: number) => a + b, 0);
      setTotalEntries(total);
    } catch {
      // silent
    }
    setLoading(false);
  }, [ipc]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCompile = useCallback(async () => {
    if (!ipc) return;
    try {
      await ipc.startCompiler();
    } catch {
      // Compiler errors shown in CompilerBar
    }
  }, [ipc]);

  return (
    <div className="page-transition" style={{ height: '100%', overflowY: 'auto', background: '#f5f3f1', fontFamily: 'Inter, sans-serif' }}>
      <header style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 32, paddingRight: 32, borderBottom: '1px solid rgba(219,193,185,0.1)' }}>
        <h2 style={{ fontSize: 14, fontWeight: 500, color: '#55433d', fontFamily: 'Inter, sans-serif', margin: 0 }}>Knowledge Sources</h2>
      </header>

      {loading ? (
        <div style={{ padding: '64px 32px', textAlign: 'center' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 32, color: '#88726c', marginBottom: 12, display: 'block' }}>hourglass_top</span>
          <p style={{ fontSize: 13, color: '#88726c', fontFamily: 'Inter, sans-serif' }}>Loading sources...</p>
        </div>
      ) : (
      <div style={{ padding: '0 32px 32px 32px', maxWidth: 960 }}>
        {/* Hero section */}
        <div style={{ paddingTop: 40, paddingBottom: 32 }}>
          <h1 style={{ fontSize: 24, fontWeight: 500, color: '#1b1c1b', fontFamily: 'Newsreader, serif', margin: 0, lineHeight: 1.1 }}>Central Repository</h1>
          <p style={{ fontSize: 14, color: '#55433d', fontFamily: 'Inter, sans-serif', marginTop: 8, marginBottom: 0 }}>All your knowledge sources, unified in one place</p>
        </div>

        {/* Summary row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <span style={{ fontSize: 24, fontWeight: 500, color: '#1b1c1b', fontFamily: 'Newsreader, serif' }}>{totalEntries}</span>
              <span style={{ fontSize: 11, color: '#88726c', marginLeft: 8, textTransform: 'uppercase' as const, letterSpacing: '0.04em', fontWeight: 600, fontFamily: 'Inter, sans-serif' }}>total entries</span>
            </div>
            {excludes.length > 0 && (
              <div>
                <span style={{ fontSize: 24, fontWeight: 500, color: '#88726c', fontFamily: 'Newsreader, serif' }}>{excludes.length}</span>
                <span style={{ fontSize: 11, color: '#88726c', marginLeft: 8, textTransform: 'uppercase' as const, letterSpacing: '0.04em', fontWeight: 600, fontFamily: 'Inter, sans-serif' }}>excluded</span>
              </div>
            )}
          </div>
          <button
            onClick={handleCompile}
            style={{
              background: '#d97757', color: '#ffffff',
              padding: '8px 20px', borderRadius: 6, fontWeight: 600, fontSize: 13,
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: 'Inter, sans-serif',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#99462a'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#d97757'; }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
            Compile Wiki
          </button>
        </div>

        {/* Connector cards grid */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          {sources.map((src) => {
            const count = counts[src.id] || 0;
            return (
              <Link
                key={src.id}
                href={src.href}
                style={{ textDecoration: 'none' }}
              >
                <div
                  style={{
                    background: '#ffffff', padding: 20, borderRadius: 16,
                    border: '1px solid rgba(219,193,185,0.1)',
                    cursor: 'pointer',
                    transition: 'box-shadow 0.2s, border-color 0.15s',
                    display: 'flex', flexDirection: 'column', gap: 16,
                    boxShadow: '0 1px 3px rgba(85,67,61,0.04)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = '0 12px 32px -4px rgba(85,67,61,0.08)';
                    e.currentTarget.style.borderColor = 'rgba(219,193,185,0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = '0 1px 3px rgba(85,67,61,0.04)';
                    e.currentTarget.style.borderColor = 'rgba(219,193,185,0.1)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{
                      width: 40, height: 40, background: '#fbf9f7', borderRadius: 8,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <src.Icon size={28} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {src.macOnly && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, color: '#88726c',
                          background: '#efedec', padding: '2px 8px', borderRadius: 4,
                          letterSpacing: '0.02em', fontFamily: 'Inter, sans-serif',
                        }}>macOS</span>
                      )}
                      <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#88726c' }}>chevron_right</span>
                    </div>
                  </div>
                  <div>
                    <h3 style={{ color: '#1b1c1b', fontWeight: 500, fontSize: 14, margin: 0, fontFamily: 'Inter, sans-serif' }}>{src.label}</h3>
                    <p style={{ color: '#55433d', fontSize: 13, marginTop: 4, marginBottom: 0, fontFamily: 'Inter, sans-serif' }}>
                      {count > 0 ? `${count} entries` : 'No entries yet'}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </section>
      </div>
      )}
    </div>
  );
}
