'use client';

import { useState, useEffect, useRef } from 'react';
import { CortexLogo } from '@/components/CortexLogo';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  timestamp: string;
}

interface ChatListItem {
  id: string;
  title: string;
  messageCount: number;
}

export default function ChatPage() {
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState<string | null>(null);
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [filing, setFiling] = useState<number | null>(null); // index of message being filed
  const scrollRef = useRef<HTMLDivElement>(null);

  const ipc = typeof window !== 'undefined' ? window.cortex : null;

  // Load chat list
  useEffect(() => {
    if (!ipc || !ipc.listChats) return;
    ipc.listChats().then((list: ChatListItem[]) => setChatList(list || []));
  }, [chatId]);

  // Listen for thinking events
  useEffect(() => {
    if (!ipc || !ipc.onChatThinking) return;
    const unsub = ipc.onChatThinking((step: string) => {
      setThinking(step);
    });
    return () => { unsub(); };
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, thinking]);

  const handleNewChat = async () => {
    if (!ipc) return;
    const chat = await ipc.newChat();
    setChatId(chat.id);
    setMessages([]);
    setThinking(null);
  };

  const handleLoadChat = async (id: string) => {
    if (!ipc) return;
    const chat = await ipc.getChat(id);
    setChatId(chat.id);
    setMessages(chat.messages || []);
  };

  const handleSend = async () => {
    if (!ipc || !input.trim() || sending) return;

    // Create chat if needed
    let currentChatId = chatId;
    if (!currentChatId) {
      const chat = await ipc.newChat();
      currentChatId = chat.id;
      setChatId(currentChatId);
    }

    const userMsg: Message = { role: 'user', content: input.trim(), timestamp: new Date().toISOString() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setSending(true);
    setThinking('Reading index...');

    try {
      const history = newMessages.map(m => ({ role: m.role, content: m.content }));
      const result = await ipc.sendChatMessage(currentChatId!, userMsg.content, history);

      const assistantMsg: Message = {
        role: 'assistant',
        content: result.content || result.error || 'No response',
        sources: result.sources,
        timestamp: new Date().toISOString(),
      };
      setMessages([...newMessages, assistantMsg]);
    } catch (e: unknown) {
      const errorMsg: Message = {
        role: 'assistant',
        content: `Error: ${e instanceof Error ? e.message : 'Failed to get response'}`,
        timestamp: new Date().toISOString(),
      };
      setMessages([...newMessages, errorMsg]);
    }
    setSending(false);
    setThinking(null);
  };

  const handleFileAnswer = async (idx: number) => {
    if (!ipc || !chatId) return;
    const msg = messages[idx];
    if (!msg || msg.role !== 'assistant') return;
    setFiling(idx);
    try {
      const result = await ipc.fileAnswer(msg.content, chatId);
      alert(`Article saved to wiki/${result.path || 'unknown'}`);
    } catch (e: unknown) {
      alert(`Failed to file: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
    setFiling(null);
  };

  const handleDeleteArticle = async (articlePath: string, msgIdx: number) => {
    if (!ipc) return;
    if (!confirm(`Delete wiki article "${articlePath}"? This cannot be undone.`)) return;
    try {
      await ipc.deleteArticle(articlePath);
      // Remove from message sources
      setMessages(prev => prev.map((msg, i) => {
        if (i === msgIdx && msg.sources) {
          return { ...msg, sources: msg.sources.filter(s => s !== articlePath) };
        }
        return msg;
      }));
    } catch (e: unknown) {
      alert(`Failed to delete: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  const [previewArticle, setPreviewArticle] = useState<{ path: string; content: string } | null>(null);

  const handlePreviewArticle = async (articlePath: string) => {
    if (!ipc) return;
    try {
      const content = await ipc.readArticle(articlePath);
      setPreviewArticle({ path: articlePath, content });
    } catch {
      setPreviewArticle({ path: articlePath, content: 'Article not found.' });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Render wikilinks in text
  const renderContent = (text: string) => {
    const parts = text.split(/(\[\[[^\]]+\]\])/g);
    return parts.map((part, i) => {
      if (part.startsWith('[[') && part.endsWith(']]')) {
        const link = part.slice(2, -2);
        return <span key={i} style={{ color: '#99462a', borderBottom: '1px solid rgba(153,70,42,0.2)' }}>{link}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="page-transition" style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', background: '#fbf9f7' }}>
      {/* Top bar */}
      <header style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 24, paddingRight: 24, flexShrink: 0, borderBottom: '1px solid rgba(219,193,185,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: '#99462a', fontFamily: 'Inter, sans-serif' }}>Cortex</span>
          <div style={{ height: 16, width: 1, background: 'rgba(219,193,185,0.3)' }} />
          <span style={{ fontSize: 13, color: '#55433d', fontFamily: 'Inter, sans-serif' }}>{chatId ? 'Active Chat' : 'New Chat'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {chatList.length > 0 && (
            <select
              onChange={(e) => e.target.value && handleLoadChat(e.target.value)}
              style={{ background: '#f5f3f1', border: '1px solid #dbc1b9', borderRadius: 6, padding: '4px 8px', fontSize: 13, color: '#55433d', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
            >
              <option value="">History...</option>
              {chatList.map((c) => (
                <option key={c.id} value={c.id}>{c.title} ({c.messageCount})</option>
              ))}
            </select>
          )}
          <button
            onClick={handleNewChat}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: '#d97757', color: '#ffffff', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'Inter, sans-serif' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
            New Chat
          </button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {messages.length === 0 && !sending && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 120, color: '#88726c' }}>
              <div style={{ marginBottom: 16, opacity: 0.6 }}>
                <CortexLogo size={48} />
              </div>
              <p style={{ fontSize: 13, marginBottom: 4, fontFamily: 'Inter, sans-serif' }}>Ask anything about your wiki</p>
              <p style={{ fontSize: 13, color: '#dbc1b9', fontFamily: 'Inter, sans-serif' }}>The LLM reads your compiled articles and synthesizes answers</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {msg.role === 'user' ? (
                <div style={{ maxWidth: '80%', background: '#ffffff', borderRadius: 12, padding: '12px 16px', fontSize: 13, lineHeight: 1.6, color: '#1b1c1b', boxShadow: '0 2px 8px rgba(85,67,61,0.06)', fontFamily: 'Inter, sans-serif' }}>
                  {msg.content}
                </div>
              ) : (
                <div style={{ width: '100%' }}>
                  <div style={{ fontSize: 13, lineHeight: 1.7, color: '#55433d', whiteSpace: 'pre-wrap', fontFamily: 'Inter, sans-serif' }}>
                    {renderContent(msg.content)}
                  </div>
                  {msg.sources && msg.sources.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 11, color: 'rgba(85,67,61,0.5)', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.04em', fontWeight: 600, fontFamily: 'Inter, sans-serif' }}>Referenced articles</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {msg.sources.map((source, si) => (
                          <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#ffffff', border: '1px solid rgba(219,193,185,0.4)', borderRadius: 6, padding: '4px 8px', fontSize: 13 }}>
                            <span
                              onClick={() => handlePreviewArticle(source)}
                              style={{ color: '#99462a', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
                            >
                              {source.replace('.md', '').split('/').pop()}
                            </span>
                            <button
                              onClick={() => handleDeleteArticle(source, i)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#88726c', padding: 0, display: 'flex', alignItems: 'center' }}
                              title="Delete this article from wiki"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => handleFileAnswer(i)}
                    disabled={filing === i}
                    style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: '#efedec', border: '1px solid rgba(219,193,185,0.3)', borderRadius: 8, color: '#99462a', fontSize: 13, cursor: 'pointer', fontWeight: 500, fontFamily: 'Inter, sans-serif' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>auto_stories</span>
                    {filing === i ? 'Filing...' : 'File into wiki'}
                  </button>
                </div>
              )}
              <span style={{ marginTop: 4, fontSize: 10, color: '#dbc1b9', textTransform: 'uppercase' as const, letterSpacing: '0.05em', fontFamily: 'Inter, sans-serif' }}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}

          {/* Thinking indicator */}
          {thinking && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', background: '#fbf9f7',
                border: '1.5px solid rgba(217,119,87,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                animation: 'pulse 1.5s infinite',
              }}>
                <CortexLogo size={20} />
              </div>
              <div style={{ background: '#f5f3f1', border: '1px solid rgba(219,193,185,0.3)', borderRadius: 8, padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#55433d', fontFamily: 'Inter, sans-serif' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#d97757', animation: 'pulse 1.5s infinite' }} />
                  {thinking}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <footer style={{ padding: 24, flexShrink: 0 }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ background: '#f5f3f1', border: '1px solid rgba(219,193,185,0.4)', borderRadius: 16, padding: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px' }}>
              <span className="material-symbols-outlined" style={{ color: 'rgba(153,70,42,0.4)', fontSize: 20, fontVariationSettings: "'FILL' 1" }}>edit_note</span>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Inquire your anthology..."
                disabled={sending}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: '#1b1c1b', padding: '8px 0', fontFamily: 'Inter, sans-serif' }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                style={{
                  width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: input.trim() && !sending ? '#d97757' : '#e4e2e0',
                  color: input.trim() && !sending ? '#ffffff' : '#88726c',
                  border: 'none', cursor: input.trim() && !sending ? 'pointer' : 'default',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>arrow_upward</span>
              </button>
            </div>
          </div>
          <p style={{ marginTop: 8, textAlign: 'center', fontSize: 11, color: 'rgba(85,67,61,0.3)', fontFamily: 'Inter, sans-serif' }}>
            Answers are based on your compiled wiki articles
          </p>
        </div>
      </footer>

      {/* Article Preview Panel */}
      {previewArticle && (
        <>
          <div
            onClick={() => setPreviewArticle(null)}
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(85,67,61,0.4)', zIndex: 10,
            }}
          />
          <div style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, width: 300,
            background: '#ffffff', borderLeft: '1px solid rgba(219,193,185,0.4)',
            zIndex: 11, display: 'flex', flexDirection: 'column',
            boxShadow: '-4px 0 24px rgba(85,67,61,0.12)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', borderBottom: '1px solid rgba(219,193,185,0.3)', flexShrink: 0,
            }}>
              <span style={{ fontSize: 13, color: '#55433d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontFamily: 'Inter, sans-serif' }}>
                {previewArticle.path}
              </span>
              <button
                onClick={() => setPreviewArticle(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#88726c', padding: 0, display: 'flex', alignItems: 'center', marginLeft: 8 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              <pre style={{
                fontSize: 13, lineHeight: 1.6, color: '#55433d',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontFamily: 'monospace', margin: 0,
              }}>
                {previewArticle.content}
              </pre>
            </div>
            <div style={{ padding: 16, borderTop: '1px solid rgba(219,193,185,0.3)', flexShrink: 0 }}>
              <button
                onClick={() => {
                  if (!previewArticle) return;
                  const articlePath = previewArticle.path;
                  setPreviewArticle(null);
                  if (!confirm(`Delete wiki article "${articlePath}"? This cannot be undone.`)) return;
                  if (ipc) {
                    ipc.deleteArticle(articlePath).catch((e: unknown) => {
                      alert(`Failed to delete: ${e instanceof Error ? e.message : 'Unknown error'}`);
                    });
                  }
                }}
                style={{
                  width: '100%', padding: '8px 0', background: 'rgba(186,26,26,0.1)',
                  color: '#ba1a1a', borderRadius: 6, fontSize: 13, fontWeight: 600,
                  border: '1px solid rgba(186,26,26,0.2)', cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                }}
              >
                Delete Article
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
