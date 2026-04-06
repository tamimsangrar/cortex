'use client';

import { useState, useEffect, useRef } from 'react';
import { CortexLogo } from './CortexLogo';

interface CompilerState {
  status: 'idle' | 'running' | 'paused' | 'error';
  currentEntry: string | null;
  entriesProcessed: number;
  entriesTotal: number;
  articlesCreated: number;
  articlesUpdated: number;
  tokensUsed: { input: number; output: number };
}

const THINKING_MESSAGES = [
  'Reading your conversations...',
  'Understanding what matters...',
  'Finding recurring patterns...',
  'Connecting ideas across entries...',
  'Identifying key people and relationships...',
  'Looking for emerging themes...',
  'Writing with care, not speed...',
  'Building the map of your mind...',
  'Every entry tells a story...',
  'Organizing by meaning, not chronology...',
];

function formatEta(seconds: number): string {
  if (seconds < 60) return 'less than a minute';
  if (seconds < 120) return '~1 minute';
  if (seconds < 3600) return `~${Math.ceil(seconds / 60)} minutes`;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.ceil((seconds % 3600) / 60);
  return `~${hrs}h ${mins}m`;
}

export function CompilerBar() {
  const [state, setState] = useState<CompilerState | null>(null);
  const [visible, setVisible] = useState(false);
  const [completedMessage, setCompletedMessage] = useState<string | null>(null);
  const [thinkingMsg, setThinkingMsg] = useState(0);
  const [eta, setEta] = useState<string | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStatusRef = useRef<string>('idle');
  const startTimeRef = useRef<number>(0);
  const lastProcessedRef = useRef<number>(0);

  useEffect(() => {
    const ipc = typeof window !== 'undefined' ? window.cortex : null;
    if (!ipc) return;

    ipc.getCompilerState().then((s: CompilerState) => {
      setState(s);
      if (s.status === 'running' || s.status === 'paused') {
        setVisible(true);
      }
      prevStatusRef.current = s.status;
    }).catch(() => {});

    const unsub = ipc.onCompilerProgress((s: any) => {
      setState(s);

      if (s.status === 'running' || s.status === 'paused') {
        setVisible(true);
        setCompletedMessage(null);
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }

        // Track start time for ETA
        if (prevStatusRef.current !== 'running' && s.status === 'running') {
          startTimeRef.current = Date.now();
          lastProcessedRef.current = s.entriesProcessed;
        }

        // Ensure startTime is set (e.g. component mounted mid-compilation)
        if (s.status === 'running' && startTimeRef.current === 0) {
          startTimeRef.current = Date.now();
          lastProcessedRef.current = s.entriesProcessed;
        }

        // Calculate ETA based on elapsed time and progress
        if (s.entriesProcessed > lastProcessedRef.current && s.entriesTotal > 0) {
          const elapsed = (Date.now() - startTimeRef.current) / 1000;
          const processed = s.entriesProcessed - lastProcessedRef.current;
          if (elapsed > 5 && processed > 0) {
            const rate = processed / elapsed;
            const remaining = s.entriesTotal - s.entriesProcessed;
            const etaSeconds = remaining / rate;
            // Only show ETA if it's reasonable (under 24h)
            if (etaSeconds < 86400) {
              setEta(formatEta(etaSeconds));
            } else {
              setEta(null);
            }
          }
        }
      } else if (s.status === 'idle' && prevStatusRef.current === 'running') {
        const msg = `Done! Created ${s.articlesCreated} articles, updated ${s.articlesUpdated} from ${s.entriesProcessed} entries`;
        setCompletedMessage(msg);
        setEta(null);
        setVisible(true);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => {
          setVisible(false);
          setCompletedMessage(null);
        }, 6000);
      } else if (s.status === 'error') {
        setVisible(true);
        setEta(null);
      } else if (s.status === 'idle') {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => {
          setVisible(false);
        }, 2000);
      }

      prevStatusRef.current = s.status;
    });

    return () => {
      unsub();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Rotate thinking messages
  useEffect(() => {
    if (state?.status === 'running') {
      setThinkingMsg(0);
      thinkingTimerRef.current = setInterval(() => {
        setThinkingMsg(prev => (prev + 1) % THINKING_MESSAGES.length);
      }, 4000);
    } else {
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
    }
    return () => {
      if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    };
  }, [state?.status]);

  const ipc = typeof window !== 'undefined' ? window.cortex : null;
  const [confirmAction, setConfirmAction] = useState<'pause' | 'stop' | null>(null);

  const handlePause = () => {
    if (!ipc) return;
    if (state?.status === 'paused') {
      ipc.resumeCompiler();
      setConfirmAction(null);
    } else {
      setConfirmAction('pause');
    }
  };

  const handleStop = () => {
    if (!ipc) return;
    setConfirmAction('stop');
  };

  const handleConfirm = () => {
    if (!ipc || !confirmAction) return;
    if (confirmAction === 'pause') {
      ipc.pauseCompiler();
    } else {
      ipc.stopCompiler();
    }
    setConfirmAction(null);
  };

  const handleCancel = () => {
    setConfirmAction(null);
  };

  if (!visible || !state) return null;

  const pct = state.entriesTotal > 0 ? Math.round((state.entriesProcessed / state.entriesTotal) * 100) : 0;
  const isRunning = state.status === 'running' || state.status === 'paused';

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 264,
      right: 0,
      background: '#f5f3f1',
      borderTop: '1px solid rgba(219,193,185,0.2)',
      zIndex: 90,
      transition: 'height 0.3s ease',
    }}>
      {completedMessage ? (
        <div style={{ height: 40, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#006b5f', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: '#55433d', flex: 1, fontFamily: 'Inter, sans-serif' }}>
            {completedMessage}
          </span>
        </div>
      ) : state.status === 'error' ? (
        <div style={{ height: 40, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ba1a1a', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: '#ba1a1a', flex: 1, fontFamily: 'Inter, sans-serif' }}>
            Compilation error{state.currentEntry ? `: ${state.currentEntry}` : ''}
          </span>
        </div>
      ) : isRunning ? (
        <div style={{ padding: '10px 20px' }}>
          {/* Top row: thinking message + controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ flexShrink: 0, animation: 'pulse 2s infinite' }}>
              <CortexLogo size={18} />
            </div>
            <span style={{
              fontSize: 13, color: '#55433d', flex: 1,
              fontFamily: 'Inter, sans-serif', fontStyle: 'italic',
              transition: 'opacity 0.3s',
            }}>
              {state.status === 'paused'
                ? 'Paused — ready when you are'
                : state.entriesProcessed === 0
                  ? 'Starting up — this may take a while for large collections'
                  : THINKING_MESSAGES[thinkingMsg]}
            </span>
            {confirmAction ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: confirmAction === 'stop' ? '#ba1a1a' : '#55433d', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}>
                  {confirmAction === 'stop' ? 'Stop compilation?' : 'Pause?'}
                </span>
                <button
                  onClick={handleConfirm}
                  style={{
                    background: confirmAction === 'stop' ? '#ba1a1a' : '#55433d',
                    color: '#fff', border: 'none', borderRadius: 4,
                    padding: '2px 10px', fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                  }}
                >
                  Yes
                </button>
                <button
                  onClick={handleCancel}
                  style={{
                    background: '#efedec', color: '#55433d', border: 'none', borderRadius: 4,
                    padding: '2px 10px', fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                  }}
                >
                  No
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={handlePause}
                  style={{
                    background: 'none', border: 'none', color: '#55433d',
                    cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center',
                  }}
                  title={state.status === 'paused' ? 'Resume' : 'Pause'}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                    {state.status === 'paused' ? 'play_arrow' : 'pause'}
                  </span>
                </button>
                <button
                  onClick={handleStop}
                  style={{
                    background: 'none', border: 'none', color: '#ba1a1a',
                    cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center',
                  }}
                  title="Stop"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>stop</span>
                </button>
              </>
            )}
          </div>

          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: '#88726c', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
              {state.entriesProcessed}/{state.entriesTotal}
            </span>
            <div style={{
              flex: 1, height: 4, background: '#e4e2e0', borderRadius: 2,
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', background: '#d97757', borderRadius: 2,
                width: `${pct}%`, transition: 'width 0.5s',
              }} />
            </div>
            <span style={{ fontSize: 11, color: '#88726c', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}>
              {pct}%
            </span>
          </div>

          {/* Bottom row: stats + ETA */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 6 }}>
            {(state.articlesCreated > 0 || state.articlesUpdated > 0) && (
              <span style={{ fontSize: 11, color: '#88726c', fontFamily: 'Inter, sans-serif' }}>
                {state.articlesCreated > 0 ? `${state.articlesCreated} new articles` : ''}
                {state.articlesCreated > 0 && state.articlesUpdated > 0 ? ', ' : ''}
                {state.articlesUpdated > 0 ? `${state.articlesUpdated} enriched` : ''}
              </span>
            )}
            <span style={{ flex: 1 }} />
            {eta && state.status === 'running' && (
              <span style={{ fontSize: 11, color: '#88726c', fontFamily: 'Inter, sans-serif' }}>
                {eta} remaining
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
