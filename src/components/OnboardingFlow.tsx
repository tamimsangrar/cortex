'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CortexLogo } from './CortexLogo';
import {
  IMessageIcon,
  WhatsAppIcon,
  ObsidianIcon,
  NotionIcon,
  AppleNotesIcon,
  WebClipIcon,
} from './ConnectorIcons';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const TOTAL_STEPS = 7;

const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
];

const CONNECTORS = [
  { id: 'imessage', label: 'iMessage', desc: 'Import conversations from Apple Messages', href: '/sources/imessage', Icon: IMessageIcon },
  { id: 'whatsapp', label: 'WhatsApp', desc: 'Import a WhatsApp chat export', href: '/sources/whatsapp', Icon: WhatsAppIcon },
  { id: 'webclip', label: 'Web Clips', desc: 'Save content from any web page', href: '/sources/webclips', Icon: WebClipIcon },
  { id: 'apple-notes', label: 'Apple Notes', desc: 'Sync notes from macOS Notes', href: '/sources/notes', Icon: AppleNotesIcon },
  { id: 'obsidian', label: 'Obsidian', desc: 'Import markdown files from a vault', href: '/sources/obsidian', Icon: ObsidianIcon },
  { id: 'notion', label: 'Notion', desc: 'Import a Notion workspace export', href: '/sources/notion', Icon: NotionIcon },
];

const HOW_IT_WORKS = [
  { icon: 'link', title: 'Connect', desc: 'Bring in your iMessage, WhatsApp, Notes, Obsidian, or web articles' },
  { icon: 'auto_awesome', title: 'Compile', desc: 'AI reads your data and builds interlinked wiki articles about people, patterns, and themes' },
  { icon: 'explore', title: 'Explore', desc: 'Search, chat, and discover insights in your personal knowledge base' },
];

/* ------------------------------------------------------------------ */
/*  Keyframes (injected once via <style>)                             */
/* ------------------------------------------------------------------ */

const KEYFRAMES = `
@keyframes ob-fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes ob-slideInRight {
  from { opacity: 0; transform: translateX(40px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes ob-slideInLeft {
  from { opacity: 0; transform: translateX(-40px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes ob-slideOutLeft {
  from { opacity: 1; transform: translateX(0); }
  to   { opacity: 0; transform: translateX(-40px); }
}
@keyframes ob-slideOutRight {
  from { opacity: 1; transform: translateX(0); }
  to   { opacity: 0; transform: translateX(40px); }
}
@keyframes ob-staggerIn {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes ob-drawCheck {
  to { stroke-dashoffset: 0; }
}
@keyframes ob-scaleIn {
  from { opacity: 0; transform: scale(0.85); }
  to   { opacity: 1; transform: scale(1); }
}
`;

/* ------------------------------------------------------------------ */
/*  Shared style helpers                                              */
/* ------------------------------------------------------------------ */

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  background: '#fbf9f7',
  backgroundImage: 'radial-gradient(circle, rgba(136,114,108,0.12) 1px, transparent 1px)',
  backgroundSize: '20px 20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'Inter, sans-serif',
};

const wizardBox: React.CSSProperties = {
  width: '100%',
  maxWidth: 780,
  padding: '0 24px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const primaryBtn = (enabled: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 32px',
  background: enabled ? '#d97757' : '#efedec',
  color: enabled ? '#ffffff' : '#88726c',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: enabled ? 'pointer' : 'default',
  fontFamily: 'Inter, sans-serif',
  transition: 'background 0.15s',
});

const largePrimaryBtn: React.CSSProperties = {
  ...primaryBtn(true),
  padding: '14px 44px',
  fontSize: 15,
};

const secondaryBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 24px',
  background: 'transparent',
  color: '#88726c',
  border: '1px solid rgba(219,193,185,0.35)',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'Inter, sans-serif',
  transition: 'border-color 0.15s',
};

const skipLink: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#88726c',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'Inter, sans-serif',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  marginTop: 12,
};

const headline = (size: number): React.CSSProperties => ({
  fontSize: size,
  fontWeight: 400,
  fontFamily: 'Newsreader, serif',
  fontStyle: 'italic',
  color: '#1b1c1b',
  margin: 0,
  lineHeight: 1.2,
});

const bodyMuted: React.CSSProperties = {
  fontSize: 14,
  color: '#88726c',
  lineHeight: 1.7,
  fontFamily: 'Inter, sans-serif',
  margin: 0,
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface OnboardingFlowProps {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [mounted, setMounted] = useState(false);

  // User profile
  const [userName, setUserName] = useState('');
  const [userNicknames, setUserNicknames] = useState('');

  // AI config state
  const [provider, setProvider] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');

  // Source selection
  const [selectedSource, setSelectedSource] = useState<string | null>(null);

  const router = useRouter();
  const ipc = typeof window !== 'undefined' ? window.cortex : null;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!ipc) return;
    ipc.hasApiKey(provider).then((has) => {
      setKeySaved(has);
    }).catch(() => {});
  }, [provider, ipc]);

  /* ---- Navigation ---- */

  const goNext = useCallback(() => {
    if (animating) return;
    setDirection('forward');
    setAnimating(true);
    setTimeout(() => { setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1)); setAnimating(false); }, 300);
  }, [animating]);

  const goBack = useCallback(() => {
    if (animating) return;
    setDirection('back');
    setAnimating(true);
    setTimeout(() => { setStep((s) => Math.max(s - 1, 0)); setAnimating(false); }, 300);
  }, [animating]);

  /* ---- AI key handlers ---- */

  const handleSaveKey = useCallback(async () => {
    if (!ipc || !apiKey.trim()) return;
    setSaving(true);
    try {
      const result = await ipc.setApiKey(provider, apiKey.trim());
      if (result.success) {
        await ipc.setProvider(provider, '');
        setKeySaved(true);
        setApiKey('');
      }
    } catch {
      // silent
    }
    setSaving(false);
  }, [ipc, apiKey, provider]);

  const handleTest = useCallback(async () => {
    if (!ipc) return;
    setTestStatus('testing');
    await ipc.setProvider(provider, '');
    const result = await ipc.testConnection();
    if (result.success) {
      setTestStatus('success');
    } else {
      setTestStatus('error');
      setTestError(result.error || 'Connection failed');
    }
  }, [ipc, provider]);

  /* ---- Finish ---- */

  const handleFinish = useCallback(async () => {
    if (!ipc) return;
    try {
      await ipc.setConfig('onboardingCompleted', true);
      await ipc.setConfig('welcomeCompleted', true);
    } catch {
      // silent
    }
    onComplete();
    if (selectedSource) {
      const connector = CONNECTORS.find((c) => c.id === selectedSource);
      if (connector) router.push(connector.href);
    } else {
      router.push('/sources');
    }
  }, [ipc, onComplete, selectedSource, router]);

  const handleSourceNext = useCallback(async () => {
    goNext();
  }, [goNext]);

  /* ---- Animation wrapper ---- */

  const stepAnimation = (): React.CSSProperties => {
    if (animating) {
      return {
        animation: direction === 'forward'
          ? 'ob-slideOutLeft 0.3s ease forwards'
          : 'ob-slideOutRight 0.3s ease forwards',
      };
    }
    return {
      animation: direction === 'forward'
        ? 'ob-slideInRight 0.35s ease both'
        : 'ob-slideInLeft 0.35s ease both',
    };
  };

  /* ---- Step dots ---- */

  const renderDots = (): ReactNode => (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 40 }}>
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <div
          key={i}
          style={{
            width: i === step ? 24 : 8,
            height: 8,
            borderRadius: 4,
            background: i === step ? '#d97757' : i < step ? 'rgba(217,119,87,0.45)' : '#efedec',
            transition: 'all 0.3s ease',
          }}
        />
      ))}
    </div>
  );

  /* ---- Nav row ---- */

  const renderNav = (opts: { nextEnabled?: boolean; nextLabel?: string; onNext?: () => void; showBack?: boolean; showSkip?: boolean; onSkip?: () => void }): ReactNode => {
    const { nextEnabled = true, nextLabel = 'Next', onNext = goNext, showBack = step > 0, showSkip = false, onSkip } = opts;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, marginTop: 32, width: '100%' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {showBack && (
            <button onClick={goBack} style={secondaryBtn}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
              Back
            </button>
          )}
          <button onClick={onNext} disabled={!nextEnabled} style={primaryBtn(nextEnabled)}>
            {nextLabel}
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
          </button>
        </div>
        {showSkip && (
          <button onClick={onSkip} style={skipLink}>Skip for now</button>
        )}
      </div>
    );
  };

  /* ================================================================ */
  /*  STEPS                                                           */
  /* ================================================================ */

  const renderStep = (): ReactNode => {
    switch (step) {

      /* ------ Step 0: Welcome ------ */
      case 0:
        return (
          <div style={{ textAlign: 'center', animation: mounted ? 'ob-fadeIn 0.6s ease both' : 'none' }}>
            <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'center' }}>
              <CortexLogo size={48} />
            </div>
            <h1 style={{ ...headline(36), marginBottom: 4 }}>Cortex</h1>
            <p style={{
              fontSize: 18,
              fontFamily: 'Newsreader, serif',
              fontStyle: 'italic',
              color: '#88726c',
              margin: '8px 0 24px',
            }}>
              Your digital life, compiled
            </p>
            <p style={{
              ...bodyMuted,
              maxWidth: 420,
              margin: '0 auto 36px',
            }}>
              Connect your messages, notes, and articles. AI compiles them into a personal knowledge wiki.
            </p>
            <button onClick={goNext} style={primaryBtn(true)}>
              Get Started
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
            </button>
          </div>
        );

      /* ------ Step 1: Tell Us About You ------ */
      case 1:
        return (
          <div style={{ width: '100%', maxWidth: 480, margin: '0 auto' }}>
            <h2 style={{ ...headline(28), textAlign: 'center', marginBottom: 8, fontStyle: 'normal' }}>Tell us about you</h2>
            <p style={{ ...bodyMuted, textAlign: 'center', marginBottom: 28 }}>
              Cortex writes a wiki about your life. Knowing your name helps it write from your perspective.
            </p>

            <div style={{
              background: '#ffffff',
              borderRadius: 14,
              padding: 24,
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              border: '1px solid rgba(219,193,185,0.18)',
              marginBottom: 16,
            }}>
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#55433d', display: 'block', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.04em', fontFamily: 'Inter, sans-serif' }}>
                  What's your name?
                </label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Your name"
                  style={{
                    width: '100%',
                    background: '#fbf9f7',
                    border: '1px solid rgba(219,193,185,0.3)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    fontSize: 14,
                    color: '#1b1c1b',
                    outline: 'none',
                    fontFamily: 'Inter, sans-serif',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#55433d', display: 'block', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.04em', fontFamily: 'Inter, sans-serif' }}>
                  Any nicknames or aliases you use in messages?
                </label>
                <input
                  type="text"
                  value={userNicknames}
                  onChange={(e) => setUserNicknames(e.target.value)}
                  placeholder="e.g. Alex, AJ, buddy"
                  style={{
                    width: '100%',
                    background: '#fbf9f7',
                    border: '1px solid rgba(219,193,185,0.3)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    fontSize: 14,
                    color: '#1b1c1b',
                    outline: 'none',
                    fontFamily: 'Inter, sans-serif',
                    boxSizing: 'border-box',
                  }}
                />
                <p style={{ fontSize: 12, color: '#88726c', marginTop: 6, marginBottom: 0, fontFamily: 'Inter, sans-serif' }}>
                  This helps Cortex identify you in conversations. Comma-separated.
                </p>
              </div>
            </div>

            {renderNav({
              nextEnabled: userName.trim().length > 0,
              onNext: async () => {
                if (ipc && userName.trim()) {
                  await ipc.setConfig('userProfile', {
                    name: userName.trim(),
                    nicknames: userNicknames.split(',').map(s => s.trim()).filter(Boolean),
                  });
                }
                goNext();
              },
            })}
          </div>
        );

      /* ------ Step 2: How It Works ------ */
      case 2:
        return (
          <div style={{ textAlign: 'center', width: '100%' }}>
            <h2 style={{ ...headline(28), marginBottom: 32, fontStyle: 'normal' }}>How it works</h2>
            <div style={{ display: 'flex', gap: 20, marginBottom: 0, width: '100%' }}>
              {HOW_IT_WORKS.map((card, i) => (
                <div
                  key={card.title}
                  style={{
                    flex: 1,
                    background: '#ffffff',
                    borderRadius: 16,
                    padding: '40px 24px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                    border: '1px solid rgba(219,193,185,0.18)',
                    textAlign: 'center',
                    animation: `ob-staggerIn 0.4s ease ${150 + i * 120}ms both`,
                  }}
                >
                  <div style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: 'rgba(217,119,87,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px',
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 28, color: '#d97757', fontVariationSettings: "'FILL' 1" }}>{card.icon}</span>
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 600, color: '#1b1c1b', marginBottom: 10, fontFamily: 'Inter, sans-serif', margin: '0 0 10px' }}>{card.title}</h3>
                  <p style={{ fontSize: 14, color: '#88726c', lineHeight: 1.6, fontFamily: 'Inter, sans-serif', margin: 0 }}>{card.desc}</p>
                </div>
              ))}
            </div>
            {renderNav({})}
          </div>
        );

      /* ------ Step 3: Your Data, Your Control ------ */
      case 3:
        return (
          <div style={{ width: '100%', maxWidth: 600, margin: '0 auto' }}>
            <h2 style={{ ...headline(28), textAlign: 'center', marginBottom: 8, fontStyle: 'normal' }}>Your data, your control</h2>
            <p style={{ ...bodyMuted, textAlign: 'center', marginBottom: 32 }}>
              Cortex is local-first. Here is exactly what stays private and what is processed by AI.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div style={{
                background: '#ffffff', borderRadius: 14, padding: 24,
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid rgba(219,193,185,0.18)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#006b5f', fontVariationSettings: "'FILL' 1" }}>lock</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#1b1c1b', fontFamily: 'Inter, sans-serif' }}>Stays on your device</span>
                </div>
                <ul style={{ fontSize: 13, color: '#55433d', lineHeight: 2.2, listStyle: 'none', padding: 0, margin: 0, fontFamily: 'Inter, sans-serif' }}>
                  <li>All messages and conversations</li>
                  <li>All imported notes and files</li>
                  <li>Your compiled wiki articles</li>
                  <li>Chat history and search index</li>
                  <li>API keys (encrypted in OS keychain)</li>
                </ul>
              </div>
              <div style={{
                background: '#ffffff', borderRadius: 14, padding: 24,
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)', border: '1px solid rgba(219,193,185,0.18)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#d97757', fontVariationSettings: "'FILL' 1" }}>cloud_upload</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#1b1c1b', fontFamily: 'Inter, sans-serif' }}>Sent to your LLM provider</span>
                </div>
                <ul style={{ fontSize: 13, color: '#55433d', lineHeight: 2.2, listStyle: 'none', padding: 0, margin: 0, fontFamily: 'Inter, sans-serif' }}>
                  <li>Entry text during compilation</li>
                  <li>Wiki articles during chat Q&A</li>
                  <li>Wiki index for article discovery</li>
                </ul>
                <p style={{ fontSize: 11, color: '#88726c', marginTop: 12, lineHeight: 1.5, fontFamily: 'Inter, sans-serif' }}>
                  Only the minimum content needed for each operation. Nothing sent without your action.
                </p>
              </div>
            </div>

            <p style={{ textAlign: 'center', fontSize: 12, color: '#88726c', fontFamily: 'Inter, sans-serif' }}>
              No analytics. No telemetry. No tracking. Zero data sent to Cortex servers.
            </p>
            {renderNav({})}
          </div>
        );

      /* ------ Step 4: Connect Your AI ------ */
      case 4: {
        const canProceed = keySaved;
        return (
          <div style={{ width: '100%', maxWidth: 480, margin: '0 auto' }}>
            <h2 style={{ ...headline(28), textAlign: 'center', marginBottom: 8, fontStyle: 'normal' }}>Connect your AI</h2>
            <p style={{ ...bodyMuted, textAlign: 'center', marginBottom: 28 }}>
              Cortex needs an LLM provider to compile your knowledge base.
            </p>

            <div style={{
              background: '#ffffff',
              borderRadius: 14,
              padding: 24,
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              border: '1px solid rgba(219,193,185,0.18)',
              marginBottom: 16,
            }}>
              {/* Provider */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#55433d', display: 'block', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.04em', fontFamily: 'Inter, sans-serif' }}>
                  Provider
                </label>
                <select
                  value={provider}
                  onChange={(e) => { setProvider(e.target.value); setTestStatus('idle'); }}
                  style={{
                    width: '100%',
                    background: '#fbf9f7',
                    border: '1px solid rgba(219,193,185,0.3)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    fontSize: 14,
                    color: '#1b1c1b',
                    outline: 'none',
                    cursor: 'pointer',
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* API Key */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#55433d', display: 'block', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.04em', fontFamily: 'Inter, sans-serif' }}>
                  API Key
                  {keySaved && (
                    <span style={{ color: '#006b5f', marginLeft: 8, textTransform: 'none' as const, letterSpacing: 0, fontWeight: 500 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 2, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                      Connected
                    </span>
                  )}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={keySaved ? 'Key saved securely' : provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey(); }}
                    style={{
                      flex: 1,
                      background: '#fbf9f7',
                      border: '1px solid rgba(219,193,185,0.3)',
                      borderRadius: 8,
                      padding: '10px 14px',
                      fontSize: 14,
                      color: '#1b1c1b',
                      outline: 'none',
                      fontFamily: 'Inter, sans-serif',
                    }}
                  />
                  <button
                    onClick={handleSaveKey}
                    disabled={!apiKey.trim() || saving}
                    style={{
                      padding: '10px 20px',
                      background: apiKey.trim() && !saving ? '#d97757' : '#efedec',
                      color: apiKey.trim() && !saving ? '#ffffff' : '#88726c',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: apiKey.trim() && !saving ? 'pointer' : 'default',
                      fontFamily: 'Inter, sans-serif',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>

              {/* Test connection */}
              <button
                onClick={handleTest}
                disabled={!keySaved || testStatus === 'testing'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 20px',
                  background: keySaved ? 'rgba(217,119,87,0.1)' : '#efedec',
                  color: keySaved ? '#d97757' : '#88726c',
                  border: keySaved ? '1px solid rgba(217,119,87,0.25)' : '1px solid transparent',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: keySaved ? 'pointer' : 'default',
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                {testStatus === 'testing' ? 'Testing...' : testStatus === 'success' ? 'Connected' : 'Test Connection'}
                {testStatus === 'success' && (
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#006b5f', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                )}
                {testStatus === 'error' && (
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#ba1a1a', fontVariationSettings: "'FILL' 1" }}>error</span>
                )}
              </button>
              {testStatus === 'error' && (
                <p style={{ fontSize: 12, color: '#ba1a1a', marginTop: 8, marginBottom: 0, fontFamily: 'Inter, sans-serif' }}>{testError}</p>
              )}
            </div>

            <p style={{ fontSize: 12, color: '#88726c', textAlign: 'center', margin: '0 0 0', fontFamily: 'Inter, sans-serif' }}>
              Get an API key at console.anthropic.com or platform.openai.com
            </p>

            {renderNav({
              nextEnabled: canProceed,
              showSkip: true,
              onSkip: goNext,
            })}
          </div>
        );
      }

      /* ------ Step 5: Add Your First Source ------ */
      case 5:
        return (
          <div style={{ textAlign: 'center', width: '100%' }}>
            <h2 style={{ ...headline(28), marginBottom: 8, fontStyle: 'normal' }}>Add your first source</h2>
            <p style={{ ...bodyMuted, marginBottom: 24 }}>
              Choose a data source to start building your knowledge base.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 0 }}>
              {CONNECTORS.map((c, i) => {
                const active = selectedSource === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedSource(active ? null : c.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                      padding: '20px 12px 16px',
                      background: active ? 'rgba(217,119,87,0.06)' : '#ffffff',
                      border: active ? '2px solid #d97757' : '1px solid rgba(219,193,185,0.2)',
                      borderRadius: 12,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      animation: `ob-staggerIn 0.35s ease ${80 + i * 60}ms both`,
                    }}
                  >
                    <c.Icon size={28} />
                    <span style={{
                      fontSize: 12.5,
                      fontWeight: active ? 600 : 500,
                      color: active ? '#d97757' : '#55433d',
                      fontFamily: 'Inter, sans-serif',
                    }}>
                      {c.label}
                    </span>
                    <span style={{
                      fontSize: 11,
                      color: '#88726c',
                      lineHeight: 1.4,
                      fontFamily: 'Inter, sans-serif',
                    }}>
                      {c.desc}
                    </span>
                  </button>
                );
              })}
            </div>

            {renderNav({
              nextLabel: selectedSource ? 'Next' : 'Next',
              onNext: handleSourceNext,
              showSkip: true,
              onSkip: () => { setSelectedSource(null); goNext(); },
            })}
          </div>
        );

      /* ------ Step 6: Ready ------ */
      case 6: {
        const chosenConnector = selectedSource
          ? CONNECTORS.find((c) => c.id === selectedSource) ?? null
          : null;
        return (
          <div style={{ textAlign: 'center' }}>
            {/* Animated checkmark SVG */}
            <div style={{ margin: '0 auto 28px', width: 72, height: 72 }}>
              <svg width="72" height="72" viewBox="0 0 72 72" fill="none" style={{ animation: 'ob-scaleIn 0.5s ease both' }}>
                <circle cx="36" cy="36" r="34" stroke="rgba(217,119,87,0.15)" strokeWidth="2.5" fill="rgba(217,119,87,0.06)" />
                <path
                  d="M22 36 L32 46 L50 28"
                  stroke="#d97757"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  style={{
                    strokeDasharray: 50,
                    strokeDashoffset: 50,
                    animation: 'ob-drawCheck 0.5s ease 0.35s forwards',
                  }}
                />
              </svg>
            </div>

            <h2 style={{ ...headline(32), marginBottom: 12, fontStyle: 'normal' }}>You{'\u2019'}re all set</h2>
            <p style={{
              ...bodyMuted,
              maxWidth: 380,
              margin: '0 auto 36px',
            }}>
              Your knowledge base will grow with every source you add and every question you ask.
            </p>
            <button onClick={handleFinish} style={largePrimaryBtn}>
              {chosenConnector ? (
                <>
                  <chosenConnector.Icon size={18} />
                  Start with {chosenConnector.label}
                </>
              ) : (
                'Start Using Cortex'
              )}
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
            </button>
          </div>
        );
      }

      default:
        return null;
    }
  };

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div style={overlay}>
        <div style={wizardBox}>
          <div
            key={step}
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              ...stepAnimation(),
            }}
          >
            {renderStep()}
          </div>
          {renderDots()}
        </div>
      </div>
    </>
  );
}
