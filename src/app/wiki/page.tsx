'use client';

import { useState, useEffect, useCallback } from 'react';
import GraphView from '@/components/GraphView';

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

interface GraphData {
  nodes: { id: string; title: string; type: string; linkCount: number }[];
  edges: { source: string; target: string }[];
}

type WikiTab = 'article' | 'graph' | 'health';

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!val.startsWith('-') && !val.startsWith('[')) meta[key] = val;
    }
  }
  return { meta, body: match[2] };
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '');
}

function simpleMarkdownToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3 style="font-family:Inter,sans-serif;font-size:14px;font-weight:500;margin-top:24px;margin-bottom:8px;color:#55433d">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-family:Inter,sans-serif;font-size:14px;font-weight:600;margin-top:32px;margin-bottom:12px;color:#55433d">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-family:Newsreader,serif;font-size:24px;font-weight:500;letter-spacing:-0.02em;margin-bottom:16px;color:#1b1c1b">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[\[([^\]]+)\]\]/g, '<a style="color:#99462a;border-bottom:1px solid rgba(153,70,42,0.2);text-decoration:none;cursor:pointer" data-wikilink="$1">$1</a>')
    .replace(/^> (.+)$/gm, '<blockquote style="border-left:2px solid rgba(153,70,42,0.3);padding-left:20px;margin:16px 0;font-style:italic;color:rgba(27,28,27,0.8)">$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li style="margin-bottom:6px;color:#55433d;margin-left:20px">$1</li>')
    .replace(/\n\n/g, '</p><p style="font-family:Inter,sans-serif;margin-bottom:16px;color:#55433d;line-height:1.7">')
    .replace(/^/, '<p style="font-family:Inter,sans-serif;margin-bottom:16px;color:#55433d;line-height:1.7">')
    + '</p>';
}

function FileTree({ nodes, selected, onSelect, depth = 0 }: {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <>
      {nodes.map((node) => {
        if (node.isDir) {
          const isOpen = expanded[node.path] !== false;
          return (
            <div key={node.path}>
              <div
                onClick={() => setExpanded(prev => ({ ...prev, [node.path]: !isOpen }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                  paddingLeft: 8 + depth * 16, cursor: 'pointer', borderRadius: 4,
                  fontSize: 13, fontFamily: 'Inter, sans-serif', color: '#55433d', userSelect: 'none',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#88726c', transition: 'transform 0.15s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>
                  chevron_right
                </span>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#d97757' }}>
                  {isOpen ? 'folder_open' : 'folder'}
                </span>
                <span>{node.name}</span>
              </div>
              {isOpen && node.children && (
                <FileTree nodes={node.children} selected={selected} onSelect={onSelect} depth={depth + 1} />
              )}
            </div>
          );
        }
        const isActive = selected === node.path;
        return (
          <div
            key={node.path}
            onClick={() => onSelect(node.path)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
              paddingLeft: 30 + depth * 16, cursor: 'pointer', borderRadius: 4,
              fontSize: 13, fontFamily: 'Inter, sans-serif', background: isActive ? '#efedec' : 'transparent',
              color: isActive ? '#99462a' : '#55433d',
              fontWeight: isActive ? 500 : 400,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: isActive ? '#99462a' : '#88726c' }}>description</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
          </div>
        );
      })}
    </>
  );
}

const SEVERITY_CONFIG: Record<string, { icon: string; color: string; borderColor: string; label: string }> = {
  critical: { icon: 'error', color: '#ba1a1a', borderColor: '#ba1a1a', label: 'critical' },
  warning: { icon: 'warning', color: '#8a6e00', borderColor: '#8a6e00', label: 'warnings' },
  suggestion: { icon: 'lightbulb', color: '#99462a', borderColor: '#99462a', label: 'suggestions' },
};

function HealthPanel({ issues, running, hasRun, onRun }: {
  issues: any[];
  running: boolean;
  hasRun: boolean;
  onRun: () => void;
}) {
  const [cleanupReport, setCleanupReport] = useState<any>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [breakdownReport, setBreakdownReport] = useState<any>(null);
  const [breakdownRunning, setBreakdownRunning] = useState(false);

  const ipc = typeof window !== 'undefined' ? window.cortex : null;

  const handleRunCleanup = async () => {
    if (!ipc || !ipc.cleanupWiki) return;
    setCleanupRunning(true);
    try {
      const report = await ipc.cleanupWiki();
      setCleanupReport(report);
    } catch {
      // cleanup failed silently
    }
    setCleanupRunning(false);
  };

  const handleRunBreakdown = async () => {
    if (!ipc || !ipc.breakdownWiki) return;
    setBreakdownRunning(true);
    try {
      const report = await ipc.breakdownWiki();
      setBreakdownReport(report);
    } catch {
      // breakdown failed silently
    }
    setBreakdownRunning(false);
  };

  const criticalCount = issues.filter((i: any) => i.severity === 'critical').length;
  const warningCount = issues.filter((i: any) => i.severity === 'warning').length;
  const suggestionCount = issues.filter((i: any) => i.severity === 'suggestion').length;

  const grouped = ['critical', 'warning', 'suggestion']
    .map(sev => ({ severity: sev, items: issues.filter((i: any) => i.severity === sev) }))
    .filter(g => g.items.length > 0);

  const CLEANUP_TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
    'diary-driven': { icon: 'calendar_today', color: '#8a6e00' },
    'bloated': { icon: 'expand', color: '#8a6e00' },
    'stub': { icon: 'short_text', color: '#8a6e00' },
    'banned-word': { icon: 'block', color: '#8a6e00' },
    'quote-density': { icon: 'format_quote', color: '#99462a' },
    'broken-link': { icon: 'link_off', color: '#ba1a1a' },
    'missing-link': { icon: 'add_link', color: '#99462a' },
    'incoherent': { icon: 'psychology', color: '#8a6e00' },
  };

  return (
    <div style={{ padding: '32px 48px', maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ fontFamily: 'Newsreader, serif', fontSize: 24, fontWeight: 500, color: '#1b1c1b', margin: 0 }}>Wiki Health</h2>
        <button
          onClick={onRun}
          disabled={running}
          style={{
            background: running ? '#efedec' : '#d97757', color: running ? '#88726c' : '#ffffff',
            padding: '8px 20px', borderRadius: 6, border: 'none', cursor: running ? 'default' : 'pointer',
            fontSize: 13, fontWeight: 600,
          }}
        >
          {running ? 'Running...' : 'Run Checks'}
        </button>
      </div>

      {hasRun && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#ba1a1a', fontWeight: 600 }}>{criticalCount} critical</span>
          <span style={{ fontSize: 13, color: '#8a6e00', fontWeight: 600 }}>{warningCount} warnings</span>
          <span style={{ fontSize: 13, color: '#99462a', fontWeight: 600 }}>{suggestionCount} suggestions</span>
        </div>
      )}

      {!hasRun && !running && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 80, color: '#88726c' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 40, marginBottom: 12 }}>health_and_safety</span>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13 }}>Run checks to analyze your wiki health</p>
        </div>
      )}

      {hasRun && issues.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 80, color: '#88726c' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 40, marginBottom: 12, color: '#006b5f' }}>check_circle</span>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#1b1c1b' }}>No issues found</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {grouped.map(({ severity, items }) => items.map((issue: any) => {
          const cfg = SEVERITY_CONFIG[severity];
          const descLines = (issue.description || '').split('\n').filter((l: string) => l.trim());
          return (
            <div
              key={issue.id}
              style={{
                background: '#ffffff', borderRadius: 8, padding: 16,
                borderLeft: `2px solid ${cfg.borderColor}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: cfg.color }}>{cfg.icon}</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500, color: '#1b1c1b' }}>{issue.title}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: issue.affectedFiles?.length ? 12 : 0 }}>
                {descLines.map((line: string, i: number) => (
                  <p key={i} style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#55433d', margin: 0, lineHeight: 1.5 }}>{line}</p>
                ))}
              </div>
              {issue.affectedFiles && issue.affectedFiles.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {issue.affectedFiles.map((f: string, i: number) => (
                    <span key={i} style={{ fontFamily: 'monospace', fontSize: 13, color: '#88726c' }}>{f}</span>
                  ))}
                </div>
              )}
            </div>
          );
        }))}
      </div>

      {/* Quality Audit section */}
      <div style={{ marginTop: 32, borderTop: '1px solid rgba(219,193,185,0.3)', paddingTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500, color: '#55433d', margin: 0 }}>Quality Audit</h3>
          <button
            onClick={handleRunCleanup}
            disabled={cleanupRunning}
            style={{
              background: cleanupRunning ? '#efedec' : '#55433d', color: cleanupRunning ? '#88726c' : '#ffffff',
              padding: '8px 20px', borderRadius: 6, border: 'none', cursor: cleanupRunning ? 'default' : 'pointer',
              fontSize: 13, fontWeight: 600,
            }}
          >
            {cleanupRunning ? 'Auditing...' : 'Run Quality Audit'}
          </button>
        </div>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#88726c', marginBottom: 16 }}>
          Checks every article for structure, tone, quote density, broken links, and missing connections.
        </p>

        {cleanupReport && !cleanupReport.error && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#55433d', background: '#efedec', padding: '4px 10px', borderRadius: 4 }}>
                {cleanupReport.totalArticles} articles scanned
              </span>
              {cleanupReport.summary.diaryDriven > 0 && (
                <span style={{ fontSize: 13, color: '#8a6e00', background: 'rgba(138,110,0,0.08)', padding: '4px 10px', borderRadius: 4 }}>
                  {cleanupReport.summary.diaryDriven} diary-driven
                </span>
              )}
              {cleanupReport.summary.bloated > 0 && (
                <span style={{ fontSize: 13, color: '#8a6e00', background: 'rgba(138,110,0,0.08)', padding: '4px 10px', borderRadius: 4 }}>
                  {cleanupReport.summary.bloated} bloated
                </span>
              )}
              {cleanupReport.summary.stubs > 0 && (
                <span style={{ fontSize: 13, color: '#8a6e00', background: 'rgba(138,110,0,0.08)', padding: '4px 10px', borderRadius: 4 }}>
                  {cleanupReport.summary.stubs} stubs
                </span>
              )}
              {cleanupReport.summary.bannedWords > 0 && (
                <span style={{ fontSize: 13, color: '#8a6e00', background: 'rgba(138,110,0,0.08)', padding: '4px 10px', borderRadius: 4 }}>
                  {cleanupReport.summary.bannedWords} tone issues
                </span>
              )}
              {cleanupReport.summary.quoteDensity > 0 && (
                <span style={{ fontSize: 13, color: '#99462a', background: 'rgba(153,70,42,0.08)', padding: '4px 10px', borderRadius: 4 }}>
                  {cleanupReport.summary.quoteDensity} over-quoted
                </span>
              )}
              {cleanupReport.summary.brokenLinks > 0 && (
                <span style={{ fontSize: 13, color: '#ba1a1a', background: 'rgba(186,26,26,0.08)', padding: '4px 10px', borderRadius: 4 }}>
                  {cleanupReport.summary.brokenLinks} broken links
                </span>
              )}
              {cleanupReport.summary.missingLinks > 0 && (
                <span style={{ fontSize: 13, color: '#99462a', background: 'rgba(153,70,42,0.08)', padding: '4px 10px', borderRadius: 4 }}>
                  {cleanupReport.summary.missingLinks} missing links
                </span>
              )}
            </div>

            {cleanupReport.issues.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 16, background: 'rgba(0,107,95,0.06)', borderRadius: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#006b5f' }}>check_circle</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#1b1c1b' }}>All articles pass quality checks.</span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cleanupReport.issues.map((issue: any, i: number) => {
                const typeCfg = CLEANUP_TYPE_CONFIG[issue.type] || { icon: 'info', color: '#88726c' };
                return (
                  <div key={i} style={{
                    background: '#ffffff', borderRadius: 8, padding: 12,
                    borderLeft: `2px solid ${issue.severity === 'critical' ? '#ba1a1a' : issue.severity === 'warning' ? '#8a6e00' : '#99462a'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: typeCfg.color }}>{typeCfg.icon}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#55433d', fontWeight: 600 }}>{issue.article}</span>
                    </div>
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#55433d', margin: 0, lineHeight: 1.5 }}>
                      {issue.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {cleanupReport && cleanupReport.error && (
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#ba1a1a' }}>{cleanupReport.error}</p>
        )}
      </div>

      {/* Missing Articles section */}
      <div style={{ marginTop: 32, borderTop: '1px solid rgba(219,193,185,0.3)', paddingTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 500, color: '#55433d', margin: 0 }}>Missing Articles</h3>
          <button
            onClick={handleRunBreakdown}
            disabled={breakdownRunning}
            style={{
              background: breakdownRunning ? '#efedec' : '#55433d', color: breakdownRunning ? '#88726c' : '#ffffff',
              padding: '8px 20px', borderRadius: 6, border: 'none', cursor: breakdownRunning ? 'default' : 'pointer',
              fontSize: 13, fontWeight: 600,
            }}
          >
            {breakdownRunning ? 'Scanning...' : 'Find Missing Articles'}
          </button>
        </div>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#88726c', marginBottom: 16 }}>
          Scans wikilinks and text for entities that are referenced but do not have their own pages.
        </p>

        {breakdownReport && !breakdownReport.error && (
          <>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#55433d', background: '#efedec', padding: '4px 10px', borderRadius: 4 }}>
                {breakdownReport.totalArticles} articles scanned
              </span>
              <span style={{ fontSize: 13, color: '#99462a', background: 'rgba(153,70,42,0.08)', padding: '4px 10px', borderRadius: 4 }}>
                {breakdownReport.candidateCount} candidates found
              </span>
            </div>

            {breakdownReport.candidates.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 16, background: 'rgba(0,107,95,0.06)', borderRadius: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#006b5f' }}>check_circle</span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#1b1c1b' }}>No missing articles detected.</span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {breakdownReport.candidates.map((candidate: any, i: number) => (
                <div key={i} style={{
                  background: '#ffffff', borderRadius: 8, padding: 12,
                  borderLeft: '2px solid #99462a',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#99462a' }}>add_circle_outline</span>
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: '#1b1c1b' }}>{candidate.name}</span>
                      <span style={{ fontSize: 11, color: '#88726c', background: '#efedec', padding: '2px 6px', borderRadius: 3 }}>{candidate.suggestedDir}/</span>
                    </div>
                    <span style={{ fontSize: 11, color: '#55433d', fontWeight: 600 }}>
                      {candidate.referenceCount} ref{candidate.referenceCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                    {candidate.mentionedIn.slice(0, 3).map((src: string, j: number) => (
                      <span key={j} style={{ fontFamily: 'monospace', fontSize: 11, color: '#88726c' }}>{src}</span>
                    ))}
                  </div>
                  {candidate.context && candidate.context.length > 0 && (
                    <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#88726c', margin: '6px 0 0', fontStyle: 'italic', lineHeight: 1.4 }}>
                      {candidate.context[0]}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {breakdownReport && breakdownReport.error && (
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#ba1a1a' }}>{breakdownReport.error}</p>
        )}
      </div>
    </div>
  );
}

const SOURCE_CHIP_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  imessage: { label: 'iMessage', color: '#99462a', bg: 'rgba(153,70,42,0.1)' },
  whatsapp: { label: 'WhatsApp', color: '#006b5f', bg: 'rgba(0,107,95,0.1)' },
  'web-clip': { label: 'Web Clip', color: '#55433d', bg: 'rgba(85,67,61,0.08)' },
  clip: { label: 'Web Clip', color: '#55433d', bg: 'rgba(85,67,61,0.08)' },
  'apple-notes': { label: 'Notes', color: '#006b5f', bg: 'rgba(0,107,95,0.1)' },
  note: { label: 'Notes', color: '#006b5f', bg: 'rgba(0,107,95,0.1)' },
  obsidian: { label: 'Obsidian', color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
  notion: { label: 'Notion', color: '#55433d', bg: 'rgba(85,67,61,0.08)' },
  'chat-answer': { label: 'Chat', color: '#99462a', bg: 'rgba(153,70,42,0.1)' },
};

function extractSourceTypes(rawContent: string): string[] {
  const match = rawContent.match(/^sources:\n((?:\s+-\s+.+\n?)*)/m);
  if (!match) return [];
  const items = match[1].match(/-\s*["']?([^"'\n]+)["']?/g);
  if (!items) return [];
  const prefixes = new Set<string>();
  for (const item of items) {
    const val = item.replace(/^- \s*["']?/, '').replace(/["']?$/, '').trim();
    const underscoreIdx = val.indexOf('_');
    if (underscoreIdx > 0) {
      prefixes.add(val.slice(0, underscoreIdx));
    }
  }
  return Array.from(prefixes);
}

export default function WikiPage() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [articleMeta, setArticleMeta] = useState<Record<string, string>>({});
  const [articleHtml, setArticleHtml] = useState<string>('');
  const [articleRaw, setArticleRaw] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [activeTab, setActiveTab] = useState<WikiTab>('article');
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [graphLoading, setGraphLoading] = useState(false);
  const [lintIssues, setLintIssues] = useState<any[]>([]);
  const [lintRunning, setLintRunning] = useState(false);
  const [lintRan, setLintRan] = useState(false);
  const [articleSources, setArticleSources] = useState<string[]>([]);

  // Filter state
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [articlesMeta, setArticlesMeta] = useState<{ path: string; title: string; type: string; created: string; last_updated: string }[]>([]);
  const [filterActive, setFilterActive] = useState(false);

  const ipc = typeof window !== 'undefined' ? window.cortex : null;

  const loadTree = useCallback(async () => {
    if (!ipc || !ipc.getWikiTree) { setLoading(false); return; }
    try {
      const t = await ipc.getWikiTree();
      setTree((t || []) as TreeNode[]);
    } catch {
      // tree load failed silently
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);
  useEffect(() => {
    const interval = setInterval(loadTree, 5000);
    return () => clearInterval(interval);
  }, [loadTree]);

  // Load article metadata for filtering
  useEffect(() => {
    if (!ipc || !ipc.listWikiArticles) return;
    ipc.listWikiArticles().then((articles: any[]) => {
      setArticlesMeta(articles || []);
    }).catch(() => {});
  }, [tree]);

  // Compute which article paths pass the filter
  const filteredPaths = (() => {
    if (!filterActive) return null; // null = no filter, show all
    const matching = new Set<string>();
    for (const a of articlesMeta) {
      if (filterType !== 'all' && a.type !== filterType) continue;
      const articleDate = a.created || a.last_updated || '';
      if (filterDateFrom && articleDate && articleDate < filterDateFrom) continue;
      if (filterDateTo && articleDate && articleDate > filterDateTo) continue;
      matching.add(a.path);
    }
    return matching;
  })();

  // Collect unique types for the dropdown
  const articleTypes = Array.from(new Set(articlesMeta.map(a => a.type).filter(t => t && t !== 'unknown'))).sort();

  // Filter tree nodes based on filteredPaths
  const filterTree = (nodes: TreeNode[]): TreeNode[] => {
    if (!filteredPaths) return nodes;
    return nodes.reduce<TreeNode[]>((acc, node) => {
      if (node.isDir) {
        const filteredChildren = filterTree(node.children || []);
        if (filteredChildren.length > 0) {
          acc.push({ ...node, children: filteredChildren });
        }
      } else {
        if (filteredPaths.has(node.path)) {
          acc.push(node);
        }
      }
      return acc;
    }, []);
  };

  const displayTree = filterTree(tree);

  // Collect all visible leaf paths for "Delete filtered"
  const visibleArticlePaths = (() => {
    if (!filteredPaths) return [];
    return Array.from(filteredPaths);
  })();

  const handleApplyFilter = () => {
    setFilterActive(true);
  };

  const handleClearFilter = () => {
    setFilterActive(false);
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterType('all');
  };

  const handleDeleteFiltered = async () => {
    if (!ipc || !ipc.deleteWikiArticles) return;
    if (visibleArticlePaths.length === 0) return;
    if (!confirm(`Delete ${visibleArticlePaths.length} articles? This cannot be undone.`)) return;
    try {
      await ipc.deleteWikiArticles(visibleArticlePaths);
      setSelectedPath(null);
      setArticleHtml('');
      setArticleRaw('');
      handleClearFilter();
      loadTree();
    } catch (e: any) {
      alert(`Failed to delete: ${e.message}`);
    }
  };

  useEffect(() => {
    if (!ipc || !selectedPath) return;
    setEditing(false);
    ipc.readArticle(selectedPath).then((content: string) => {
      setArticleRaw(content);
      const { meta, body } = parseFrontmatter(content);
      setArticleMeta(meta);
      setArticleHtml(sanitizeHtml(simpleMarkdownToHtml(body)));
      setArticleSources(extractSourceTypes(content));
    }).catch(() => {
      setArticleHtml('<p style="color:#ba1a1a">Article not found.</p>');
      setArticleMeta({});
      setArticleRaw('');
      setArticleSources([]);
    });
  }, [selectedPath]);

  const handleDelete = async () => {
    if (!ipc || !selectedPath) return;
    if (!confirm('Delete this article? This cannot be undone.')) return;
    await ipc.deleteArticle(selectedPath);
    setSelectedPath(null);
    setArticleHtml('');
    setArticleRaw('');
    loadTree();
  };

  // Load graph data when switching to graph tab
  useEffect(() => {
    if (activeTab !== 'graph' || !ipc || !ipc.getWikiGraph) return;
    setGraphLoading(true);
    ipc.getWikiGraph().then((data: GraphData) => {
      setGraphData(data);
    }).catch(() => {
    }).finally(() => {
      setGraphLoading(false);
    });
  }, [activeTab]);

  const handleGraphNodeClick = useCallback((nodePath: string) => {
    setSelectedPath(nodePath);
    setActiveTab('article');
  }, []);

  const handleSave = async () => {
    if (!ipc || !selectedPath) return;
    await ipc.saveArticle(selectedPath, editContent);
    setEditing(false);
    setArticleRaw(editContent);
    const { meta, body } = parseFrontmatter(editContent);
    setArticleMeta(meta);
    setArticleHtml(sanitizeHtml(simpleMarkdownToHtml(body)));
    setArticleSources(extractSourceTypes(editContent));
    // Refresh tree in case title changed
    loadTree();
  };

  const handleStartEdit = () => {
    setEditContent(articleRaw);
    setEditing(true);
  };

  const handleRunLint = async () => {
    if (!ipc || !ipc.runLint) return;
    setLintRunning(true);
    try {
      const results = await ipc.runLint();
      setLintIssues(results || []);
      setLintRan(true);
    } catch {
      // lint failed silently
    }
    setLintRunning(false);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#88726c' }}>
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', padding: 32 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#dbc1b9', marginBottom: 16 }}>book</span>
        <h1 style={{ fontFamily: 'Newsreader, serif', fontSize: 24, fontWeight: 500, color: '#1b1c1b', marginBottom: 8 }}>Your wiki is empty</h1>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#55433d' }}>Add some sources and run the compiler to build your knowledge base.</p>
      </div>
    );
  }

  return (
    <div className="page-transition" style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* File tree */}
      <div style={{ width: 240, borderRight: '1px solid rgba(219,193,185,0.3)', background: '#f5f3f1', overflowY: 'auto', paddingTop: 12, paddingBottom: 12, flexShrink: 0 }}>
        <div style={{ padding: '0 12px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em', color: '#55433d' }}>Explorer</span>
        </div>

        {/* Filter bar */}
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 6, borderBottom: '1px solid rgba(219,193,185,0.3)', marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              placeholder="From"
              style={{ flex: 1, background: '#ffffff', border: '1px solid rgba(219,193,185,0.3)', borderRadius: 4, padding: '3px 4px', fontSize: 10, color: '#55433d', outline: 'none', colorScheme: 'light', minWidth: 0 }}
            />
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              placeholder="To"
              style={{ flex: 1, background: '#ffffff', border: '1px solid rgba(219,193,185,0.3)', borderRadius: 4, padding: '3px 4px', fontSize: 10, color: '#55433d', outline: 'none', colorScheme: 'light', minWidth: 0 }}
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            style={{ background: '#ffffff', border: '1px solid rgba(219,193,185,0.3)', borderRadius: 4, padding: '3px 6px', fontSize: 10, color: '#55433d', outline: 'none', cursor: 'pointer' }}
          >
            <option value="all">All types</option>
            {articleTypes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={handleApplyFilter}
              style={{ flex: 1, background: '#d97757', color: '#ffffff', border: 'none', borderRadius: 4, padding: '4px 0', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
            >
              Filter
            </button>
            {filterActive && (
              <button
                onClick={handleClearFilter}
                style={{ background: '#efedec', color: '#55433d', border: 'none', borderRadius: 4, padding: '4px 8px', fontSize: 10, cursor: 'pointer' }}
              >
                Clear
              </button>
            )}
          </div>
          {filterActive && (
            <>
              <span style={{ fontSize: 10, color: '#88726c' }}>
                {visibleArticlePaths.length} article{visibleArticlePaths.length !== 1 ? 's' : ''} match
              </span>
              {visibleArticlePaths.length > 0 && (
                <button
                  onClick={handleDeleteFiltered}
                  style={{ background: 'rgba(186,26,26,0.08)', color: '#ba1a1a', border: '1px solid rgba(186,26,26,0.2)', borderRadius: 4, padding: '4px 0', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                >
                  Delete {visibleArticlePaths.length} filtered
                </button>
              )}
            </>
          )}
        </div>

        <FileTree nodes={displayTree} selected={selectedPath} onSelect={(p) => { setSelectedPath(p); setActiveTab('article'); }} />
      </div>

      {/* Main content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(219,193,185,0.3)', flexShrink: 0 }}>
          {(['article', 'graph', 'health'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: 'none', border: 'none', borderBottom: activeTab === tab ? '2px solid #99462a' : '2px solid transparent',
                color: activeTab === tab ? '#1b1c1b' : '#88726c', padding: '10px 20px',
                fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em',
                cursor: 'pointer',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: activeTab === 'graph' ? 'hidden' : 'auto' }}>
          {activeTab === 'health' ? (
            <HealthPanel
              issues={lintIssues}
              running={lintRunning}
              hasRun={lintRan}
              onRun={handleRunLint}
            />
          ) : activeTab === 'article' ? (
            <div style={{ padding: '32px 48px', maxWidth: 800 }}>
              {!selectedPath ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#88726c', paddingTop: 120 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 40, marginBottom: 12 }}>article</span>
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13 }}>Select an article from the sidebar</p>
                </div>
              ) : editing ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#55433d' }}>Editing: {selectedPath}</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setEditing(false)} style={{ background: '#efedec', color: '#55433d', padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13 }}>
                        Cancel
                      </button>
                      <button onClick={handleSave} style={{ background: '#d97757', color: '#ffffff', padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                        Save
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    style={{
                      width: '100%', height: 'calc(100vh - 200px)', background: '#ffffff', color: '#1b1c1b',
                      border: '1px solid rgba(219,193,185,0.3)', borderRadius: 8, padding: 16,
                      fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6, resize: 'none', outline: 'none',
                    }}
                  />
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
                    <button onClick={handleStartEdit} style={{ background: 'none', border: 'none', color: '#55433d', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span> Edit
                    </button>
                    <button onClick={handleDelete} style={{ background: 'none', border: 'none', color: '#ba1a1a', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span> Delete
                    </button>
                  </div>
                  {articleMeta.type && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
                      <span style={{ background: '#d97757', color: '#ffffff', fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                        {articleMeta.type}
                      </span>
                      {articleSources.map((prefix) => {
                        const cfg = SOURCE_CHIP_CONFIG[prefix];
                        if (!cfg) return null;
                        return (
                          <span key={prefix} style={{ background: cfg.bg, color: cfg.color, fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                            {cfg.label}
                          </span>
                        );
                      })}
                      {articleMeta.created && (
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#55433d' }}>Created: {articleMeta.created}</span>
                      )}
                    </div>
                  )}
                  <div
                    style={{ fontFamily: 'Inter, sans-serif', color: '#1b1c1b', lineHeight: 1.7, fontSize: 13 }}
                    dangerouslySetInnerHTML={{ __html: articleHtml }}
                  />
                </>
              )}
            </div>
          ) : activeTab === 'graph' ? (
            <div style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
              {graphLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#88726c' }}>
                  Loading graph...
                </div>
              ) : (
                <GraphView nodes={graphData.nodes} edges={graphData.edges} onNodeClick={handleGraphNodeClick} />
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
