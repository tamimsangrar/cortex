'use client';

import { useState, useCallback } from 'react';

interface EntryInfo {
  id: string;
  date: string;
  sourceType: string;
  title: string;
  path: string;
  contactName: string;
  messageCount: number;
}

interface ParsedMessage {
  speaker: string;
  time: string;
  text: string;
}

function parseMessages(content: string): ParsedMessage[] {
  const bodyMatch = content.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
  const body = bodyMatch ? bodyMatch[1] : content;

  const lines = body.split('\n');
  const messageLines: string[] = [];
  let pastHeading = false;
  for (const line of lines) {
    if (!pastHeading && line.startsWith('# ')) {
      pastHeading = true;
      continue;
    }
    if (pastHeading || !line.startsWith('#')) {
      messageLines.push(line);
    }
  }

  const text = messageLines.join('\n');
  const regex = /\*\*(.+?)\*\*\s*\(([^)]+)\):\s*([\s\S]*?)(?=\n\n\*\*|\s*$)/g;
  const messages: ParsedMessage[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    messages.push({
      speaker: match[1].trim(),
      time: match[2].trim(),
      text: match[3].trim(),
    });
  }

  return messages;
}

function ConversationRenderer({ content }: { content: string }) {
  const messages = parseMessages(content);

  if (messages.length === 0) {
    // Render as plain text if no chat messages detected
    const bodyMatch = content.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
    const body = bodyMatch ? bodyMatch[1] : content;
    const lines = body.split('\n');
    const textLines: string[] = [];
    let pastHeading = false;
    for (const line of lines) {
      if (!pastHeading && line.startsWith('# ')) {
        pastHeading = true;
        continue;
      }
      if (pastHeading || !line.startsWith('#')) {
        textLines.push(line);
      }
    }
    const plainText = textLines.join('\n').trim();
    if (!plainText) {
      return (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: '#88726c' }}>No content to display.</p>
        </div>
      );
    }
    return (
      <div style={{ fontSize: 14, color: '#1b1c1b', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {plainText}
      </div>
    );
  }

  let lastSpeaker = '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {messages.map((msg, i) => {
        const isMe = msg.speaker === 'Me';
        const showName = msg.speaker !== lastSpeaker;
        lastSpeaker = msg.speaker;

        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', marginTop: showName ? 12 : 2 }}>
            {showName && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#88726c', marginBottom: 4, paddingLeft: isMe ? 0 : 4, paddingRight: isMe ? 4 : 0 }}>
                {msg.speaker}
              </span>
            )}
            <div style={{
              maxWidth: '85%',
              padding: '8px 12px',
              borderRadius: 12,
              background: isMe ? 'rgba(153,70,42,0.08)' : '#ffffff',
              borderTopRightRadius: isMe ? 4 : 12,
              borderTopLeftRadius: isMe ? 12 : 4,
            }}>
              <p style={{ fontSize: 14, color: '#1b1c1b', lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {msg.text}
              </p>
              <span style={{ fontSize: 10, color: '#88726c', display: 'block', marginTop: 4, textAlign: isMe ? 'right' : 'left' }}>
                {msg.time}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function useEntryReader() {
  const [selectedEntryPath, setSelectedEntryPath] = useState<string | null>(null);
  const [selectedEntryContent, setSelectedEntryContent] = useState<string | null>(null);
  const [entryLoading, setEntryLoading] = useState(false);

  const openEntry = useCallback(async (entryPath: string) => {
    const ipc = typeof window !== 'undefined' ? window.cortex : null;
    if (!ipc || !ipc.readEntry) return;
    setSelectedEntryPath(entryPath);
    setEntryLoading(true);
    setSelectedEntryContent(null);
    try {
      const content = await ipc.readEntry(entryPath);
      setSelectedEntryContent(content);
    } catch {
      setSelectedEntryContent('Failed to load entry.');
    }
    setEntryLoading(false);
  }, []);

  const closeEntry = useCallback(() => {
    setSelectedEntryPath(null);
    setSelectedEntryContent(null);
  }, []);

  return { selectedEntryPath, selectedEntryContent, entryLoading, openEntry, closeEntry };
}

interface EntryReaderPanelProps {
  entryPath: string;
  entryContent: string | null;
  loading: boolean;
  entry?: EntryInfo;
  onClose: () => void;
  onDelete?: (path: string) => void;
}

export function EntryReaderPanel({ entryPath, entryContent, loading, entry, onClose, onDelete }: EntryReaderPanelProps) {
  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0,
      width: 400, background: '#f5f3f1', fontFamily: 'Inter, sans-serif',
      borderLeft: '1px solid rgba(219,193,185,0.15)',
      display: 'flex', flexDirection: 'column',
      zIndex: 100,
      boxShadow: '-4px 0 24px rgba(85,67,61,0.1)',
    }}>
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid rgba(219,193,185,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {entry && (
            <>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1b1c1b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.contactName || entry.title}
              </div>
              <div style={{ fontSize: 11, color: '#88726c', marginTop: 2 }}>
                {entry.date}{entry.messageCount > 0 ? ` -- ${entry.messageCount} messages` : ''}
              </div>
            </>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#88726c', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {loading && (
          <div style={{ padding: '32px 0', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: '#55433d' }}>Loading...</p>
          </div>
        )}
        {!loading && entryContent && (
          <ConversationRenderer content={entryContent} />
        )}
      </div>

      {onDelete && (
        <div style={{
          padding: '12px 20px', borderTop: '1px solid rgba(219,193,185,0.1)',
          flexShrink: 0,
        }}>
          <button
            onClick={() => onDelete(entryPath)}
            style={{
              width: '100%', padding: '8px 0',
              background: 'rgba(186,26,26,0.08)', color: '#ba1a1a',
              border: '1px solid rgba(186,26,26,0.15)', borderRadius: 6,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Delete Entry
          </button>
        </div>
      )}
    </div>
  );
}
