'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IMessageIcon,
  WhatsAppIcon,
  WebClipIcon,
  AppleNotesIcon,
  ObsidianIcon,
  NotionIcon,
} from './ConnectorIcons';
import { CortexLogo } from './CortexLogo';

const navItems = [
  { href: '/sources', label: 'Sources', icon: 'database' },
  { href: '/wiki', label: 'Wiki', icon: 'book' },
  { href: '/chat', label: 'Chat', icon: 'message' },
];

const sourceSubItems = [
  { href: '/sources/imessage', label: 'iMessage', Icon: IMessageIcon },
  { href: '/sources/whatsapp', label: 'WhatsApp', Icon: WhatsAppIcon },
  { href: '/sources/webclips', label: 'Web Clips', Icon: WebClipIcon },
  { href: '/sources/notes', label: 'Notes', Icon: AppleNotesIcon },
  { href: '/sources/obsidian', label: 'Obsidian', Icon: ObsidianIcon },
  { href: '/sources/notion', label: 'Notion', Icon: NotionIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const sourcesActive = pathname.startsWith('/sources');

  return (
    <aside
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        height: '100%',
        width: 264,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        paddingTop: 32,
        paddingBottom: 16,
        background: '#efedec',
        overflow: 'hidden',
      }}
      className="titlebar-no-drag"
    >
      {/* Traffic lights clearance */}
      <div style={{ height: 36, flexShrink: 0 }} />

      {/* Brand */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        paddingLeft: 24,
        paddingRight: 24,
        marginBottom: 32,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CortexLogo size={28} />
          <h1 style={{
            fontSize: 24,
            fontWeight: 500,
            fontFamily: 'Newsreader, serif',
            fontStyle: 'italic',
            color: '#1b1c1b',
            letterSpacing: '-0.01em',
          }}>
            Cortex
          </h1>
        </div>
        <span style={{
          fontSize: 10,
          fontFamily: 'Inter, sans-serif',
          textTransform: 'uppercase' as const,
          letterSpacing: '0.2em',
          color: '#88726c',
          marginTop: 4,
        }}>
          Your Digital Life, Compiled
        </span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 12px', overflowY: 'auto', overflowX: 'hidden' }}>
        {navItems.map(({ href, label, icon }) => {
          const isActive = href === '/sources' ? pathname === '/sources' : pathname.startsWith(href);
          const isSourcesSection = href === '/sources' && sourcesActive;
          return (
            <div key={href}>
              <Link
                href={href}
                className="titlebar-no-drag nav-item"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 40,
                  paddingLeft: 12,
                  paddingRight: 12,
                  borderRadius: '8px 0 0 8px',
                  background: 'transparent',
                  color: isActive || isSourcesSection ? '#99462a' : '#55433d',
                  fontWeight: isActive || isSourcesSection ? 600 : 400,
                  fontFamily: 'Inter, sans-serif',
                  textDecoration: 'none',
                  flexShrink: 0,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                  position: 'relative',
                  borderRight: isActive || isSourcesSection ? '3px solid #d97757' : '3px solid transparent',
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    flexShrink: 0,
                    fontSize: 20,
                    ...(isActive || isSourcesSection ? { fontVariationSettings: "'FILL' 1" } : {}),
                  }}
                >
                  {icon}
                </span>
                <span style={{ marginLeft: 12, whiteSpace: 'nowrap', fontSize: 13, letterSpacing: '-0.01em' }}>
                  {label}
                </span>
              </Link>
            </div>
          );
        })}
      </nav>

      {/* Feedback link */}
      <button
        onClick={() => { window.open('https://github.com/tamimsangrar/cortex/issues/new', '_blank'); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 20px', margin: '0 12px 8px',
          color: '#88726c', fontSize: 13, fontFamily: 'Inter, sans-serif',
          background: 'none', border: 'none', borderRadius: 8,
          cursor: 'pointer', transition: 'background 0.15s', width: 'calc(100% - 24px)',
        }}
        className="nav-item"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>feedback</span>
        Send Feedback
      </button>

      {/* User profile area */}
      <UserProfileArea />
    </aside>
  );
}

function UserProfileArea() {
  const pathname = usePathname();
  const [name, setName] = useState('');
  const [initials, setInitials] = useState('U');
  const ipc = typeof window !== 'undefined' ? (window as any).cortex : null;
  const isActive = pathname === '/settings';

  useEffect(() => {
    if (!ipc || !ipc.getConfig) return;
    ipc.getConfig().then((config: any) => {
      const profile = config?.userProfile;
      if (profile?.name) {
        setName(profile.name);
        const parts = profile.name.trim().split(/\s+/);
        setInitials(parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase());
      } else {
        setName('');
        setInitials('U');
      }
    }).catch(() => {});
  }, [pathname]);

  return (
    <Link
      href="/settings"
      className="nav-item titlebar-no-drag"
      style={{
        padding: '12px 16px',
        marginTop: 8,
        borderTop: '1px solid rgba(219,193,185,0.3)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        textDecoration: 'none',
        cursor: 'pointer',
        background: isActive ? 'rgba(153,70,42,0.06)' : 'transparent',
        borderRight: isActive ? '3px solid #d97757' : '3px solid transparent',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: '50%', background: '#dbc1b9',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700, color: '#55433d', fontFamily: 'Inter, sans-serif',
        flexShrink: 0,
      }}>
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#1b1c1b', fontFamily: 'Inter, sans-serif', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
          {name || 'User'}
        </span>
        <span style={{ fontSize: 10, color: '#88726c', display: 'block', fontFamily: 'Inter, sans-serif' }}>
          All data stored locally
        </span>
      </div>
      <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#88726c', flexShrink: 0 }}>settings</span>
    </Link>
  );
}
